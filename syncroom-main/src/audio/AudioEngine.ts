import { AudioEngineState } from './types';

// 1-sample silent WAV data URI for guaranteed cross-browser unlock
const SILENT_WAV =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==';

export class AudioEngine {
  private audio: HTMLAudioElement | null = null;
  private currentTrackId: string | null = null;
  private state: AudioEngineState = 'uninitialized';
  private unlocked: boolean = false;
  private volume: number = 0.8;
  private logicalDuration: number = 180;
  private logicalCurrentTime: number = 0;
  private playbackStartTime: number = 0;
  private playbackStartLogicalTime: number = 0;
  private currentPlaybackRate: number = 1.0;
  private listeners: Set<(state: AudioEngineState) => void> = new Set();
  private unlockListeners: Set<(unlocked: boolean) => void> = new Set();

  constructor() {
    if (typeof window !== 'undefined') {
      this.initAudioElement();

      // Automatically attempt unlock on ANY first user gesture on the page
      const autoUnlock = () => {
        this.unlock().catch(() => {});
        window.removeEventListener('pointerdown', autoUnlock, true);
        window.removeEventListener('touchstart', autoUnlock, true);
        window.removeEventListener('keydown', autoUnlock, true);
        window.removeEventListener('click', autoUnlock, true);
      };

      window.addEventListener('pointerdown', autoUnlock, { capture: true, passive: true });
      window.addEventListener('touchstart', autoUnlock, { capture: true, passive: true });
      window.addEventListener('keydown', autoUnlock, { capture: true, passive: true });
      window.addEventListener('click', autoUnlock, { capture: true, passive: true });
    }
  }

  private initAudioElement() {
    if (this.audio) return;
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.loop = true; // Crucial: loop continuously so audio never stops at 30 seconds
    this.audio.volume = this.volume;
    this.audio.src = SILENT_WAV;

    this.audio.addEventListener('playing', () => {
      this.setState('playing');
    });

    this.audio.addEventListener('pause', () => {
      if (this.state !== 'loading') {
        this.setState('paused');
      }
    });

    this.audio.addEventListener('canplay', () => {
      if (this.state === 'loading') {
        this.setState('ready');
      }
    });

    this.audio.addEventListener('error', () => {
      // Don't flag error on initial silent WAV
      if (this.audio?.src && !this.audio.src.startsWith('data:audio/wav')) {
        this.setState('error');
      }
    });
  }

  private setState(state: AudioEngineState) {
    if (this.state !== state) {
      this.state = state;
      this.listeners.forEach((listener) => listener(state));
    }
  }

  /**
   * Unlocks audio playback within a user gesture to satisfy browser autoplay restrictions.
   */
  public async unlock(): Promise<boolean> {
    if (!this.audio) this.initAudioElement();

    try {
      if (this.audio) {
        // If no real track has been loaded, play and pause the silent WAV to satisfy browser autoplay
        if (!this.currentTrackId || this.audio.src === SILENT_WAV) {
          if (!this.audio.src || this.audio.src === window.location.href) {
            this.audio.src = SILENT_WAV;
          }
          const playPromise = this.audio.play();
          if (playPromise !== undefined) {
            await playPromise;
            this.audio.pause();
          }
        }
      }
      this.unlocked = true;
      this.unlockListeners.forEach((l) => l(true));
      return true;
    } catch (err) {
      // Even if pause happens quickly, grant unlock attempt
      this.unlocked = true;
      this.unlockListeners.forEach((l) => l(true));
      return true;
    }
  }

  public isUnlocked(): boolean {
    return this.unlocked;
  }

  public onUnlockChange(listener: (unlocked: boolean) => void): () => void {
    this.unlockListeners.add(listener);
    listener(this.unlocked);
    return () => {
      this.unlockListeners.delete(listener);
    };
  }

  public onStateChange(listener: (state: AudioEngineState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async loadTrack(audioUrl: string, trackId: string, duration?: number): Promise<void> {
    if (!this.audio) this.initAudioElement();
    if (duration && duration > 0) {
      this.logicalDuration = duration;
    }

    if (!audioUrl) {
      this.currentTrackId = trackId;
      this.setState('uninitialized');
      return;
    }

    if (this.currentTrackId === trackId && this.audio!.src === audioUrl) {
      return;
    }

    this.currentTrackId = trackId;
    this.setState('loading');

    this.audio!.loop = true;
    this.audio!.src = audioUrl;
    this.audio!.load();

    return new Promise((resolve) => {
      const onCanPlay = () => {
        this.audio?.removeEventListener('canplay', onCanPlay);
        this.setState('ready');
        resolve();
      };
      this.audio?.addEventListener('canplay', onCanPlay, { once: true });

      // Fallback timeout in case event is missed
      setTimeout(() => {
        this.audio?.removeEventListener('canplay', onCanPlay);
        if (this.state === 'loading') this.setState('ready');
        resolve();
      }, 1500);
    });
  }

  public async play(): Promise<void> {
    if (!this.audio) this.initAudioElement();
    if (!this.audio!.src || this.audio!.src === SILENT_WAV || !this.currentTrackId) {
      this.setState('uninitialized');
      throw new Error('Audio playback provider is not configured.');
    }
    try {
      this.playbackStartTime = performance.now();
      this.playbackStartLogicalTime = this.logicalCurrentTime;
      this.audio!.loop = true;
      await this.audio!.play();
      this.unlocked = true;
      this.setState('playing');
      this.unlockListeners.forEach((l) => l(true));
    } catch (err: unknown) {
      console.warn('[AudioEngine] Play failed:', err);
      if ((err as Error)?.name === 'NotAllowedError') {
        this.unlocked = false;
        this.unlockListeners.forEach((l) => l(false));
      }
      throw err;
    }
  }

  public pause(): void {
    if (!this.audio) return;
    try {
      this.logicalCurrentTime = this.getCurrentTime();
      this.audio.pause();
      this.setState('paused');
    } catch {
      // Ignored
    }
  }

  public seek(positionSeconds: number): void {
    const valid = Math.max(0, Math.min(positionSeconds, this.logicalDuration));
    this.logicalCurrentTime = valid;
    this.playbackStartTime = performance.now();
    this.playbackStartLogicalTime = valid;

    if (!this.audio) return;
    try {
      if (this.audio.duration && Number.isFinite(this.audio.duration) && this.audio.duration > 0) {
        const loopOffset = valid % this.audio.duration;
        if (Math.abs(this.audio.currentTime - loopOffset) > 0.05) {
          this.audio.currentTime = loopOffset;
        }
      } else {
        this.audio.currentTime = 0;
      }
    } catch {
      // Ignored
    }
  }

  public setPlaybackRate(rate: number): void {
    const bounded = Math.max(0.85, Math.min(rate, 1.15));
    // Snapshot current position before changing rate
    this.logicalCurrentTime = this.getCurrentTime();
    this.playbackStartTime = performance.now();
    this.playbackStartLogicalTime = this.logicalCurrentTime;
    this.currentPlaybackRate = bounded;

    if (!this.audio) return;
    try {
      if (this.audio.playbackRate !== bounded) {
        this.audio.playbackRate = bounded;
      }
    } catch {
      // Ignored
    }
  }

  public setVolume(volumeInput: number): void {
    // Automatically accept either 0-1 (e.g. 0.8) or 0-100 (e.g. 80)
    const normalized = volumeInput > 1 ? volumeInput / 100 : volumeInput;
    const vol = Math.max(0, Math.min(1, normalized));
    this.volume = vol;
    if (this.audio) {
      this.audio.volume = vol;
    }
  }

  public getVolume(): number {
    return this.volume;
  }

  public getCurrentTime(): number {
    if (this.state !== 'playing' || !this.currentTrackId || !this.audio?.src || this.audio.src === SILENT_WAV) {
      return this.logicalCurrentTime;
    }
    const elapsed = ((performance.now() - this.playbackStartTime) / 1000) * this.currentPlaybackRate;
    const current = Math.min(this.playbackStartLogicalTime + elapsed, this.logicalDuration);
    this.logicalCurrentTime = current;
    return current;
  }

  public getDuration(): number {
    return this.logicalDuration || this.audio?.duration || 0;
  }

  public setDuration(durationSeconds: number): void {
    if (durationSeconds > 0) {
      this.logicalDuration = durationSeconds;
    }
  }

  public getCurrentTrackId(): string | null {
    return this.currentTrackId;
  }

  public destroy(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
      this.audio = null;
    }
    this.currentTrackId = null;
    this.listeners.clear();
    this.unlockListeners.clear();
  }
}

export const audioEngine = new AudioEngine();
