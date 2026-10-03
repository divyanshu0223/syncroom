import { PlaybackProvider, SpotifyPlayerStatus } from './PlaybackProvider';
import { Track } from '../types';

/**
 * WebAudioPlaybackProvider
 *
 * Implements the SyncRoom Audio Architecture:
 * SYNCROOM
 *   ├── Spotify (Spotify SDK)
 *   ├── YouTube (YouTube IFrame)
 *   └── Audio (Web Audio API)
 *         └── AudioBuffer
 *               └── AudioBufferSourceNode
 *                     └── GainNode
 *                           └── Speaker (audioContext.destination)
 *
 * Guarantees lifecycle stability:
 * - Reuses existing AudioContext across UI renders, tab switches, and modal changes.
 * - Does NOT pause or destroy AudioContext on visibilitychange or document.hidden.
 * - Idempotent loadTrack prevents restarting active tracks on re-renders.
 */
export class WebAudioPlaybackProvider implements PlaybackProvider {
  public readonly id = 'audio';
  public readonly name = 'Web Audio Player';
  public readonly isConfigured = true;

  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private currentBuffer: AudioBuffer | null = null;
  private currentSourceNode: AudioBufferSourceNode | null = null;
  private currentTrackId: string | null = null;
  private currentAudioUrl: string | null = null;

  private durationSeconds: number = 0;
  private positionOffsetSeconds: number = 0;
  private playbackStartedAt: number = 0;
  private isPlaying: boolean = false;
  private volume: number = 0.8; // 0.0 - 1.0
  private playbackRate: number = 1.0;

  private status: SpotifyPlayerStatus = 'INITIALIZING';
  private errorMessage: string | null = null;
  private statusListeners: Set<(status: SpotifyPlayerStatus, error?: string | null) => void> = new Set();
  private isUnlocked: boolean = false;

  constructor() {
    this.initAudioContext();
  }

  private initAudioContext() {
    if (typeof window === 'undefined') return;

    try {
      const AudioCtxClass =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtxClass) {
        this.status = 'PROVIDER_UNAVAILABLE';
        this.errorMessage = 'Web Audio API is not supported in this browser.';
        return;
      }

      if (!this.audioContext) {
        this.audioContext = new AudioCtxClass();
      }

      if (!this.gainNode && this.audioContext) {
        // GainNode -> Speaker (audioContext.destination)
        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.setValueAtTime(this.volume, this.audioContext.currentTime);
        this.gainNode.connect(this.audioContext.destination);
      }

      if (this.audioContext.state === 'running') {
        this.isUnlocked = true;
        this.setStatus('PLAYER_READY');
      } else {
        this.setStatus('PLAYER_READY');
      }
    } catch (err: unknown) {
      this.status = 'PLAYBACK_ERROR';
      this.errorMessage = (err as Error)?.message || 'Failed to initialize Web Audio context';
    }
  }

  public getStatus(): SpotifyPlayerStatus {
    return this.status;
  }

  public getErrorMessage(): string | null {
    return this.errorMessage;
  }

  public getDeviceId(): string | null {
    return 'web-audio-speaker';
  }

  public getCurrentTrackId(): string | null {
    return this.currentTrackId;
  }

  public getPosition(): number {
    if (!this.isPlaying || !this.audioContext) {
      return this.positionOffsetSeconds;
    }
    const elapsed = (this.audioContext.currentTime - this.playbackStartedAt) * this.playbackRate;
    const current = this.positionOffsetSeconds + elapsed;
    return Math.min(current, this.durationSeconds || current);
  }

  public getDuration(): number {
    return this.durationSeconds;
  }

  public setVolume(volume0to100: number): void {
    const clamped = Math.max(0, Math.min(100, volume0to100));
    this.volume = clamped / 100;
    if (this.gainNode && this.audioContext) {
      try {
        this.gainNode.gain.setValueAtTime(this.volume, this.audioContext.currentTime);
      } catch {
        this.gainNode.gain.value = this.volume;
      }
    }
  }

  public getVolume(): number {
    return Math.round(this.volume * 100);
  }

  public async initialize(): Promise<boolean> {
    if (!this.audioContext) {
      this.initAudioContext();
    }
    await this.activateElement();
    return this.audioContext?.state === 'running';
  }

  /**
   * Resumes AudioContext within a user gesture without tearing down the node graph.
   */
  public async activateElement(): Promise<void> {
    if (!this.audioContext) {
      this.initAudioContext();
    }
    if (this.audioContext && this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
        this.isUnlocked = true;
      } catch (err) {
        console.warn('[WebAudioPlaybackProvider] AudioContext resume failed:', err);
      }
    }
  }

  public canPlayTrack(track: Track): { canPlay: boolean; reason: string } {
    if (
      track.provider === 'audio' ||
      track.provider === 'local' ||
      track.provider === 'licensed' ||
      track.audioSource === 'local' ||
      track.audioSource === 'licensed'
    ) {
      return { canPlay: true, reason: '' };
    }

    if (track.externalUrl && track.externalUrl.match(/\.(mp3|wav|ogg|m4a|aac)(\?.*)?$/i)) {
      return { canPlay: true, reason: '' };
    }

    return {
      canPlay: false,
      reason: 'Track is not a supported direct audio stream.',
    };
  }

  /**
   * Idempotent track loading.
   * If the song is already loaded and active, avoids reloading or restarting from 0.
   */
  public async loadTrack(
    trackOrId: Track | string,
    positionSeconds = 0,
    autoplay = true
  ): Promise<void> {
    const trackId = typeof trackOrId === 'string' ? trackOrId : trackOrId.id;
    const url = typeof trackOrId === 'string' ? '' : trackOrId.externalUrl || '';

    // Idempotency: Avoid restarting the audio if it is already loaded and active
    if (
      this.currentTrackId === trackId &&
      this.currentBuffer &&
      (this.status === 'PLAYING' || this.status === 'PLAYER_READY')
    ) {
      if (Math.abs(this.getPosition() - positionSeconds) > 2) {
        this.seek(positionSeconds);
      }
      if (autoplay && !this.isPlaying) {
        await this.play();
      }
      return;
    }

    this.currentTrackId = trackId;
    this.currentAudioUrl = url;
    this.positionOffsetSeconds = Math.max(0, positionSeconds);

    if (typeof trackOrId !== 'string' && trackOrId.duration) {
      this.durationSeconds = trackOrId.duration;
    }

    if (!url) {
      this.setStatus('PLAYER_READY');
      return;
    }

    this.setStatus('CONNECTING_PLAYER');

    try {
      if (!this.audioContext) {
        this.initAudioContext();
      }

      // 1. Fetch ArrayBuffer
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch audio stream: ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();

      // 2. Decode into AudioBuffer
      if (!this.audioContext) {
        throw new Error('AudioContext unavailable');
      }
      this.currentBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      this.durationSeconds = this.currentBuffer.duration;

      this.setStatus('PLAYER_READY');

      if (autoplay) {
        await this.play();
      }
    } catch (err: unknown) {
      console.warn('[WebAudioPlaybackProvider] Failed to decode audio buffer:', err);
      this.errorMessage = (err as Error)?.message || 'Audio buffer decode failed';
      this.setStatus('PLAYBACK_ERROR');
    }
  }

  /**
   * Connects AudioBufferSourceNode -> GainNode -> Speaker (audioContext.destination)
   */
  public async play(): Promise<void> {
    if (!this.audioContext) {
      this.initAudioContext();
    }
    if (!this.audioContext) {
      throw new Error('AudioContext is unavailable');
    }

    if (this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
        this.isUnlocked = true;
      } catch (err) {
        this.setStatus('AUTOPLAY_BLOCKED');
        throw err;
      }
    }

    if (!this.currentBuffer) {
      this.isPlaying = true;
      this.setStatus('PLAYING');
      return;
    }

    // Stop existing source if any
    this.stopCurrentSourceNode();

    // AudioBufferSourceNode
    const sourceNode = this.audioContext.createBufferSource();
    sourceNode.buffer = this.currentBuffer;
    sourceNode.playbackRate.value = this.playbackRate;

    // Connect: AudioBufferSourceNode -> GainNode -> Speaker
    if (!this.gainNode) {
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.setValueAtTime(this.volume, this.audioContext.currentTime);
      this.gainNode.connect(this.audioContext.destination);
    }
    sourceNode.connect(this.gainNode);

    const offset = Math.max(0, Math.min(this.positionOffsetSeconds, this.currentBuffer.duration));
    sourceNode.start(0, offset);

    this.playbackStartedAt = this.audioContext.currentTime;
    this.currentSourceNode = sourceNode;
    this.isPlaying = true;

    sourceNode.onended = () => {
      if (this.currentSourceNode === sourceNode) {
        this.isPlaying = false;
        this.positionOffsetSeconds = this.currentBuffer?.duration || 0;
        this.setStatus('PAUSED');
      }
    };

    this.setStatus('PLAYING');
  }

  public pause(): void {
    if (!this.isPlaying) return;

    if (this.audioContext) {
      const elapsed = (this.audioContext.currentTime - this.playbackStartedAt) * this.playbackRate;
      this.positionOffsetSeconds = Math.max(0, this.positionOffsetSeconds + elapsed);
    }

    this.stopCurrentSourceNode();
    this.isPlaying = false;
    this.setStatus('PAUSED');
  }

  public seek(positionSeconds: number): void {
    const valid = Math.max(0, Math.min(positionSeconds, this.durationSeconds || positionSeconds));
    this.positionOffsetSeconds = valid;

    if (this.isPlaying && this.audioContext && this.currentBuffer) {
      this.stopCurrentSourceNode();
      const source = this.audioContext.createBufferSource();
      source.buffer = this.currentBuffer;
      source.playbackRate.value = this.playbackRate;
      source.connect(this.gainNode!);
      source.start(0, valid);
      this.playbackStartedAt = this.audioContext.currentTime;
      this.currentSourceNode = source;
    }
  }

  public setPlaybackRate(rate: number): void {
    const bounded = Math.max(0.5, Math.min(rate, 2.0));
    if (this.isPlaying && this.audioContext) {
      const elapsed = (this.audioContext.currentTime - this.playbackStartedAt) * this.playbackRate;
      this.positionOffsetSeconds += elapsed;
      this.playbackStartedAt = this.audioContext.currentTime;
    }
    this.playbackRate = bounded;
    if (this.currentSourceNode) {
      try {
        this.currentSourceNode.playbackRate.setValueAtTime(bounded, this.audioContext?.currentTime || 0);
      } catch {
        this.currentSourceNode.playbackRate.value = bounded;
      }
    }
  }

  private stopCurrentSourceNode() {
    if (this.currentSourceNode) {
      try {
        this.currentSourceNode.onended = null;
        this.currentSourceNode.stop();
        this.currentSourceNode.disconnect();
      } catch {
        // Ignored
      }
      this.currentSourceNode = null;
    }
  }

  public onStatusChange(listener: (status: SpotifyPlayerStatus, error?: string | null) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status, this.errorMessage);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private setStatus(status: SpotifyPlayerStatus) {
    if (this.status !== status) {
      this.status = status;
      this.statusListeners.forEach((l) => l(status, this.errorMessage));
    }
  }

  /**
   * Only called on explicit session termination, NEVER on UI navigation or tab switches.
   */
  public destroy(): void {
    this.stopCurrentSourceNode();
    if (this.gainNode) {
      try {
        this.gainNode.disconnect();
      } catch {}
      this.gainNode = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch {}
      this.audioContext = null;
    }
    this.currentBuffer = null;
    this.currentTrackId = null;
    this.currentAudioUrl = null;
    this.isPlaying = false;
    this.statusListeners.clear();
  }
}

export const webAudioPlaybackProvider = new WebAudioPlaybackProvider();
