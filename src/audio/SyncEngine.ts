import { AudioEngine, audioEngine } from './AudioEngine';
import { TrackAudioSource } from './types';
import { demoAudioSource } from './DemoAudioSource';
import { serverClock } from '../services/serverClock';
import { socketService } from '../services/socket';
import { PlaybackState } from '../../server/types';
import { SyncStatus, SyncEngineConfig } from './types';
import { SYNC_CONFIG } from '../config/sync';
import { playbackManager } from './PlaybackProvider';

export class SyncEngine {
  private audio: AudioEngine;
  private audioSource: TrackAudioSource;
  private currentPlaybackState: PlaybackState | null = null;
  private pendingPlaybackState: PlaybackState | null = null;
  private lastVersion: number = 0;
  private scheduledPlayTimer: number | null = null;
  private driftCheckTimer: number | null = null;
  private statusListeners: Set<(status: SyncStatus) => void> = new Set();
  private lastReportedDriftMs: number | null = null;
  private isTabActive: boolean = true;
  private lastCorrectionTime: number = 0;

  private syncStatus: SyncStatus = {
    driftSeconds: 0,
    driftMs: 0,
    status: 'idle',
    playbackRate: 1.0,
    rttMs: 0,
    clockOffsetMs: 0,
  };

  private config: SyncEngineConfig = {
    driftSoftThreshold: SYNC_CONFIG.DRIFT_SOFT_THRESHOLD_MS / 1000,
    driftHardThreshold: SYNC_CONFIG.DRIFT_HARD_THRESHOLD_MS / 1000,
    driftCheckIntervalMs: SYNC_CONFIG.SYNC_CHECK_INTERVAL_MS,
    softRateCorrection: SYNC_CONFIG.MAX_PLAYBACK_RATE_ADJUSTMENT,
  };

  constructor(audio: AudioEngine = audioEngine, audioSource: TrackAudioSource = demoAudioSource) {
    this.audio = audio;
    this.audioSource = audioSource;
    this.setupVisibilityListeners();

    playbackManager.onProviderChange((provider, status) => {
      if (status === 'AUTOPLAY_BLOCKED') {
        this.updateSyncStatus({ status: 'autoplay_blocked' });
      }

      if (
        (provider.id === 'spotify' || provider.id === 'youtube') &&
        status === 'PLAYER_READY' &&
        (this.pendingPlaybackState || this.currentPlaybackState?.isPlaying)
      ) {
        const stateToReconcile = this.pendingPlaybackState || this.currentPlaybackState;
        this.pendingPlaybackState = null;
        if (stateToReconcile) {
          console.log(
            `[SYNC] event=reconcile_playback_on_ready provider=${provider.id} track=${stateToReconcile.trackId || 'none'} isPlaying=${stateToReconcile.isPlaying}`
          );
          this.handlePlaybackState(stateToReconcile, true);
        }
      }
    });
  }

  private setupVisibilityListeners() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        const isVisible = !document.hidden;
        this.isTabActive = isVisible;

        if (isVisible) {
          // Returning to foreground: resume drift timer and evaluate recovery
          this.start();
          if (this.currentPlaybackState?.isPlaying) {
            const provider = playbackManager.getProvider();
            // If the provider was paused by the browser while backgrounded, resume it cleanly without restarting
            if (provider.id === 'youtube' || provider.id === 'spotify') {
              if (provider.getStatus() === 'PAUSED' || provider.getStatus() === 'PLAYER_READY') {
                provider.play().catch(() => {});
              }
            }
            this.checkDrift();
          }
        } else {
          // Tab hidden / device locked: pause high-frequency drift timer to save CPU/battery, but DO NOT pause audio!
          if (this.driftCheckTimer) {
            clearInterval(this.driftCheckTimer);
            this.driftCheckTimer = null;
          }
        }
      });
    }
  }

  public setConfig(custom: Partial<SyncEngineConfig>) {
    this.config = { ...this.config, ...custom };
  }

  public start() {
    // Only clear previous interval without stopping audio!
    if (this.driftCheckTimer) {
      clearInterval(this.driftCheckTimer);
      this.driftCheckTimer = null;
    }
    if (!this.isTabActive) return;

    this.driftCheckTimer = window.setInterval(() => {
      this.checkDrift();
    }, this.config.driftCheckIntervalMs);
  }

  public stop() {
    if (this.scheduledPlayTimer) {
      clearTimeout(this.scheduledPlayTimer);
      this.scheduledPlayTimer = null;
    }
    if (this.driftCheckTimer) {
      clearInterval(this.driftCheckTimer);
      this.driftCheckTimer = null;
    }
    this.audio.pause();
    const provider = playbackManager.getProvider();
    if (provider.id === 'spotify' || provider.id === 'youtube') {
      provider.pause();
    }
  }

  public onSyncStatusChange(listener: (status: SyncStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.syncStatus);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private updateSyncStatus(patch: Partial<SyncStatus>) {
    this.syncStatus = {
      ...this.syncStatus,
      ...patch,
      rttMs: serverClock.getLatestRtt(),
      clockOffsetMs: serverClock.getClockOffset(),
    };
    this.statusListeners.forEach((l) => l(this.syncStatus));

    // Send real measured drift report to server if changed by >= 10ms
    if (
      this.syncStatus.status !== 'idle' &&
      (this.lastReportedDriftMs === null ||
        Math.abs(this.syncStatus.driftMs - this.lastReportedDriftMs) >= 10)
    ) {
      this.lastReportedDriftMs = this.syncStatus.driftMs;
      if (socketService.getStatus() === 'connected') {
        socketService.send({
          type: 'REPORT_DRIFT',
          driftMs: this.syncStatus.driftMs,
        });
      }
    }
  }

  /**
   * Calculates the authoritative expected playback position at the given server time.
   * Conceptually: expectedPosition = authoritativePositionAtCommandOrTimestamp + elapsedTime * playbackRate
   */
  public calculateExpectedPosition(state: PlaybackState, estimatedServerTime: number): number {
    if (!state.isPlaying) {
      return state.position;
    }
    const duration = state.duration || Infinity;

    // 1. If scheduled future start has not arrived yet, remain at base position
    if (state.startAt && estimatedServerTime < state.startAt) {
      return Math.min(state.position, duration);
    }

    // 2. Determine reference time:
    // If future start occurred, reference is startAt.
    // If state was broadcast during active playback, reference is serverTimestamp (when state.position was measured).
    // Otherwise fallback to startedAt.
    let referenceTime: number;
    if (state.startAt && state.serverTimestamp && state.startAt >= state.serverTimestamp) {
      referenceTime = state.startAt;
    } else if (state.serverTimestamp) {
      referenceTime = state.serverTimestamp;
    } else if (state.startedAt) {
      referenceTime = state.startedAt;
    } else {
      referenceTime = estimatedServerTime;
    }

    const elapsedSeconds = Math.max(0, (estimatedServerTime - referenceTime) / 1000);
    return Math.min(state.position + elapsedSeconds, duration);
  }

  /**
   * Main entry point when server broadcasts PLAYBACK_STATE.
   * Monotonically checks version to discard out-of-order, delayed, or stale updates.
   */
  public async handlePlaybackState(state: PlaybackState, force = false): Promise<void> {
    // 1. Version Check: Ignore stale messages unless explicitly forced by unlockAutoplay
    if (!force && state.version !== undefined && state.version < this.lastVersion) {
      return;
    }
    this.lastVersion = state.version || this.lastVersion + 1;
    this.currentPlaybackState = state;

    console.log(
      `[SYNC] event=server_playback_state track=${state.trackId || 'none'} isPlaying=${state.isPlaying} pos=${state.position} version=${state.version}`
    );

    // 2. Clear any pending scheduled start
    if (this.scheduledPlayTimer) {
      clearTimeout(this.scheduledPlayTimer);
      this.scheduledPlayTimer = null;
    }

    const provider = playbackManager.getProvider();
    const isManagedProvider = provider.id === 'spotify' || provider.id === 'youtube';

    if (isManagedProvider) {
      // Pause HTML audio element
      this.audio.pause();

      if (!provider.isConfigured) {
        // Provider is still initializing, connecting, or waiting for device ready
        // Retain playback state so it can be reconciled as soon as Spotify player is ready
        this.pendingPlaybackState = state;
        console.log(
          `[SYNC] event=playback_state_retained_pending_ready track=${state.trackId || 'none'} isPlaying=${state.isPlaying}`
        );
        this.updateSyncStatus({ status: 'buffering', driftSeconds: 0, driftMs: 0, playbackRate: 1.0 });
        return;
      }

      const trackId = state.trackId;
      if (!trackId) {
        provider.pause();
        this.updateSyncStatus({ status: 'idle', driftSeconds: 0, driftMs: 0, playbackRate: 1.0 });
        return;
      }

      // Handle PAUSED state
      if (!state.isPlaying) {
        provider.pause();
        if (provider.getCurrentTrackId?.() === trackId && provider.getStatus() === 'PLAYING') {
          provider.seek(state.position);
        }
        this.updateSyncStatus({ status: 'idle', driftSeconds: 0, driftMs: 0, playbackRate: 1.0 });
        return;
      }

      // Handle PLAYING state with Authoritative Scheduled Start
      const estimatedServerTime = serverClock.getEstimatedServerTime();
      const scheduledStartAt = state.startAt || state.startedAt || estimatedServerTime;
      const delay = scheduledStartAt - estimatedServerTime;

      // If this track is ALREADY actively playing, do not reload or interrupt audio buffer
      if (provider.getCurrentTrackId?.() === trackId && provider.getStatus() === 'PLAYING') {
        this.start();
        this.updateSyncStatus({
          status: 'synced',
          driftSeconds: 0,
          driftMs: 0,
          playbackRate: 1.0,
        });
        return;
      }

      // If this track is loaded but paused or cued/ready, resume playback directly
      if (
        provider.getCurrentTrackId?.() === trackId &&
        (provider.getStatus() === 'PAUSED' || provider.getStatus() === 'PLAYER_READY')
      ) {
        try {
          await provider.play();
          this.start();
          this.updateSyncStatus({
            status: 'synced',
            driftSeconds: 0,
            driftMs: 0,
            playbackRate: 1.0,
          });
        } catch {
          this.updateSyncStatus({ status: 'autoplay_blocked' });
        }
        return;
      }

      if (delay > 0) {
        // Only seek if already actively playing this track
        if (provider.getCurrentTrackId?.() === trackId && provider.getStatus() === 'PLAYING') {
          provider.seek(state.position);
        }
        this.updateSyncStatus({
          status: 'synced',
          driftSeconds: 0,
          driftMs: 0,
          playbackRate: 1.0,
        });

        this.scheduledPlayTimer = window.setTimeout(async () => {
          this.scheduledPlayTimer = null;
          try {
            if (provider.getCurrentTrackId?.() !== trackId || provider.getStatus() !== 'PLAYING') {
              await provider.loadTrack(trackId, state.position, true);
              if (state.isPlaying) {
                await provider.play().catch(() => {});
              }
            }
            this.start();
          } catch {
            this.updateSyncStatus({ status: 'autoplay_blocked' });
          }
        }, delay);
      } else {
        const targetPosition = this.calculateExpectedPosition(state, estimatedServerTime);

        try {
          if (provider.getCurrentTrackId?.() !== trackId || provider.getStatus() !== 'PLAYING') {
            await provider.loadTrack(trackId, targetPosition, true);
            if (state.isPlaying) {
              await provider.play().catch(() => {});
            }
          }
          this.start();
          this.updateSyncStatus({
            status: 'synced',
            driftSeconds: 0,
            driftMs: 0,
            playbackRate: 1.0,
          });
        } catch {
          this.updateSyncStatus({ status: 'autoplay_blocked' });
        }
      }
      return;
    }

    // Default HTML5 audio engine branch
    if (!state.trackId || state.trackId.startsWith('spotify-') || state.trackId.startsWith('youtube-')) {
      this.audio.pause();
      this.updateSyncStatus({ status: 'idle', driftSeconds: 0, driftMs: 0, playbackRate: 1.0 });
      return;
    }

    // Ensure track audio is loaded
    if (state.duration && state.duration > 0) {
      this.audio.setDuration(state.duration);
    }
    if (this.audio.getCurrentTrackId() !== state.trackId) {
      this.updateSyncStatus({ status: 'buffering' });
      try {
        const audioUrl = await this.audioSource.getAudioUrl(state.trackId);
        if (!audioUrl) {
          this.audio.pause();
          this.updateSyncStatus({ status: 'idle', driftSeconds: 0, driftMs: 0, playbackRate: 1.0 });
          return;
        }
        await this.audio.loadTrack(audioUrl, state.trackId, state.duration);
      } catch (err) {
        console.error('[SyncEngine] Failed to load track audio:', err);
        this.audio.pause();
        this.updateSyncStatus({ status: 'idle', driftSeconds: 0, driftMs: 0, playbackRate: 1.0 });
        return;
      }
    }

    // Handle PAUSED state
    if (!state.isPlaying) {
      this.audio.setPlaybackRate(1.0);
      this.audio.pause();
      this.audio.seek(state.position);
      this.updateSyncStatus({ status: 'idle', driftSeconds: 0, driftMs: 0, playbackRate: 1.0 });
      return;
    }

    // Handle PLAYING state with Authoritative Scheduled Start
    const estimatedServerTime = serverClock.getEstimatedServerTime();
    const scheduledStartAt = state.startAt || state.startedAt || estimatedServerTime;
    const delay = scheduledStartAt - estimatedServerTime;

    if (delay > 0) {
      this.audio.seek(state.position);
      this.updateSyncStatus({
        status: 'synced',
        driftSeconds: 0,
        driftMs: 0,
        playbackRate: 1.0,
      });

      this.scheduledPlayTimer = window.setTimeout(async () => {
        this.scheduledPlayTimer = null;
        this.audio.seek(state.position);
        try {
          await this.audio.play();
          this.start();
        } catch {
          this.updateSyncStatus({ status: 'autoplay_blocked' });
        }
      }, delay);
    } else {
      const targetPosition = this.calculateExpectedPosition(state, estimatedServerTime);

      this.audio.seek(targetPosition);
      try {
        await this.audio.play();
        this.start();
        this.updateSyncStatus({
          status: 'synced',
          driftSeconds: 0,
          driftMs: 0,
          playbackRate: 1.0,
        });
      } catch {
        this.updateSyncStatus({ status: 'autoplay_blocked' });
      }
    }
  }

  /**
   * Periodic Drift Correction Engine.
   * Compares authoritative server timeline position vs actual audio/player position.
   * Conceptually: drift = actualPosition - expectedPosition
   */
  public checkDrift() {
    if (!this.currentPlaybackState || !this.currentPlaybackState.isPlaying) {
      return;
    }

    const state = this.currentPlaybackState;
    const estimatedServerTime = serverClock.getEstimatedServerTime();
    const expectedPosition = this.calculateExpectedPosition(state, estimatedServerTime);

    const provider = playbackManager.getProvider();
    if (provider.id === 'spotify' || provider.id === 'youtube') {
      if (!provider.isConfigured) return;
      if (provider.getStatus() !== 'PLAYING') return; // Do not drift-seek while buffering or paused
      const actualPosition = provider.getPosition();
      // Allow 4 seconds initial buffer room before evaluating drift
      if (actualPosition === 0 && expectedPosition < 4) {
        return;
      }

      // Authoritative definition: drift = actualPosition - expectedPosition
      const driftSeconds = actualPosition - expectedPosition;
      const driftMs = Math.round(driftSeconds * 1000);
      const absDriftSeconds = Math.abs(driftSeconds);

      console.log(
        `[SYNC] event=drift_calculation provider=${provider.id} track=${state.trackId || 'none'} expectedMs=${Math.round(expectedPosition * 1000)} actualMs=${Math.round(actualPosition * 1000)} driftMs=${driftMs} state=${state.isPlaying ? 'playing' : 'paused'}`
      );

      const tolerance = provider.id === 'youtube' ? 2.5 : 1.5;
      // Rule: Small drift (within tolerance) -> In sync, no seek needed
      if (absDriftSeconds <= tolerance) {
        this.updateSyncStatus({ driftSeconds, driftMs, status: 'synced', playbackRate: 1.0 });
        return;
      }

      // Rule: Moderate to large drift (> tolerance) -> Controlled seek with 4s cooldown
      const now = performance.now();
      if (now - this.lastCorrectionTime > 4000) {
        this.lastCorrectionTime = now;
        console.log(
          `[SYNC] event=seek_correction provider=${provider.id} track=${state.trackId || 'none'} targetSec=${expectedPosition.toFixed(2)} driftMs=${driftMs}`
        );
        provider.seek(expectedPosition);
        this.updateSyncStatus({ driftSeconds: 0, driftMs: 0, status: 'seeking', playbackRate: 1.0 });
      } else {
        // In cooldown settling window: report actual drift without issuing rapid seek commands
        this.updateSyncStatus({ driftSeconds, driftMs, status: 'adjusting', playbackRate: 1.0 });
      }
      return;
    }

    const actualPosition = this.audio.getCurrentTime();
    const driftSeconds = actualPosition - expectedPosition;
    const driftMs = Math.round(driftSeconds * 1000);
    const absDriftSeconds = Math.abs(driftSeconds);

    console.log(
      `[SYNC] event=drift_calculation track=${state.trackId || 'none'} expectedMs=${Math.round(expectedPosition * 1000)} actualMs=${Math.round(actualPosition * 1000)} driftMs=${driftMs} state=${state.isPlaying ? 'playing' : 'paused'}`
    );

    // Rule 1: Negligible drift (within soft threshold) -> Keep 1.0x playback rate
    if (absDriftSeconds <= this.config.driftSoftThreshold) {
      this.audio.setPlaybackRate(1.0);
      this.updateSyncStatus({
        driftSeconds,
        driftMs,
        status: 'synced',
        playbackRate: 1.0,
      });
      return;
    }

    // Rule 2: Moderate drift (between soft and hard threshold) -> micro-adjust playback rate smoothly
    // If actual is ahead (driftSeconds > 0), slow down (1.0 - rate). If actual is behind (driftSeconds < 0), speed up (1.0 + rate).
    if (absDriftSeconds < this.config.driftHardThreshold) {
      const correction =
        driftSeconds > 0
          ? 1.0 - this.config.softRateCorrection
          : 1.0 + this.config.softRateCorrection;
      this.audio.setPlaybackRate(correction);
      this.updateSyncStatus({
        driftSeconds,
        driftMs,
        status: 'adjusting',
        playbackRate: correction,
      });
      return;
    }

    // Rule 3: Large drift (beyond hard threshold) -> Authoritative hard seek with debounce
    const now = performance.now();
    if (now - this.lastCorrectionTime > 3000) {
      this.lastCorrectionTime = now;
      console.log(
        `[SYNC] event=seek_correction track=${state.trackId || 'none'} targetSec=${expectedPosition.toFixed(2)} driftMs=${driftMs}`
      );
      this.audio.seek(expectedPosition);
      this.audio.setPlaybackRate(1.0);
      this.updateSyncStatus({
        driftSeconds: 0,
        driftMs: 0,
        status: 'seeking',
        playbackRate: 1.0,
      });
    } else {
      this.updateSyncStatus({ driftSeconds, driftMs, status: 'adjusting', playbackRate: 1.0 });
    }
  }

  /**
   * User interaction trigger to unlock audio playback when browser blocks autoplay.
   */
  public async unlockAutoplay(): Promise<void> {
    try {
      await playbackManager.activateElement();
    } catch (err) {
      console.warn('[SyncEngine] activateElement error:', err);
    }

    const provider = playbackManager.getProvider();
    if (provider.id === 'spotify' || provider.id === 'youtube') {
      await provider.play().catch(() => {});
    } else {
      await this.audio.unlock();
    }

    const stateToReconcile = this.pendingPlaybackState || this.currentPlaybackState;
    if (stateToReconcile && stateToReconcile.isPlaying) {
      this.pendingPlaybackState = null;
      await this.handlePlaybackState(stateToReconcile, true);
    }
  }

  public getCurrentPlaybackState(): PlaybackState | null {
    return this.currentPlaybackState;
  }

  public getSyncStatus(): SyncStatus {
    return this.syncStatus;
  }
}

export const syncEngine = new SyncEngine();
