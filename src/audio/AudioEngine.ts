import { AudioEngineState } from './types';

// 1-sample silent WAV data URI for fallback unlock
const SILENT_WAV =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==';

/**
 * AudioEngine
 *
 * Implements Web Audio API pipeline matching the SyncRoom Architecture:
 * Web Audio (AudioContext)
 *    ↓
 * AudioBuffer
 *    ↓
 * AudioBufferSourceNode
 *    ↓
 * GainNode
 *    ↓
 * Speaker (audioContext.destination)
 */
export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private audioBuffer: AudioBuffer | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private fallbackAudio: HTMLAudioElement | null = null;

  private currentTrackId: string | null = null;
  private currentAudioUrl: string | null = null;
  private state: AudioEngineState = 'uninitialized';
  private unlocked: boolean = false;
  private volume: number = 0.8;
  private logicalDuration: number = 180;
  private logicalCurrentTime: number = 0;
  private playbackStartTime: number = 0;
  private playbackStartLogicalTime: number = 0;
  private currentPlaybackRate: number = 1.0;
  private isPlaying: boolean = false;

  private listeners: Set<(state: AudioEngineState) => void> = new Set();
  private unlockListeners: Set<(unlocked: boolean) => void> = new Set();

  constructor() {
    if (typeof window !== 'undefined') {
      this.initWebAudio();

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

  private initWebAudio() {
    if (typeof window === 'undefined') return;

    try {
      const AudioCtxClass =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

      if (AudioCtxClass && !this.audioContext) {
        this.audioContext = new AudioCtxClass();
        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.setValueAtTime(this.volume, this.audioContext.currentTime);
        this.gainNode.connect(this.audioContext.destination);

        if (this.audioContext.state === 'running') {
          this.unlocked = true;
        }
      }
    } catch (e) {
      console.warn('[AudioEngine] Web Audio initialization warning, falling back to HTMLAudio:', e);
      if (!this.fallbackAudio) {
        this.fallbackAudio = new Audio(SILENT_WAV);
      }
    }
  }

  private setState(state: AudioEngineState) {
    if (this.state !== state) {
      this.state = state;
      this.listeners.forEach((listener) => listener(state));
    }
  }

  public async unlock(): Promise<boolean> {
    this.initWebAudio();

    try {
      if (this.audioContext && this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      this.unlocked = true;
      this.unlockListeners.forEach((l) => l(true));
      return true;
    } catch {
      // Fallback unlock
      try {
        if (!this.fallbackAudio) {
          this.fallbackAudio = new Audio(SILENT_WAV);
        }
        await this.fallbackAudio.play();
        this.fallbackAudio.pause();
        this.unlocked = true;
        this.unlockListeners.forEach((l) => l(true));
        return true;
      } catch {
        this.unlocked = true;
        this.unlockListeners.forEach((l) => l(true));
        return true;
      }
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
    this.initWebAudio();
    if (duration && duration > 0) {
      this.logicalDuration = duration;
    }

    if (!audioUrl) {
      this.currentTrackId = trackId;
      this.setState('uninitialized');
      return;
    }

    if (this.currentTrackId === trackId && this.currentAudioUrl === audioUrl && this.audioBuffer) {
      return;
    }

    this.currentTrackId = trackId;
    this.currentAudioUrl = audioUrl;
    this.setState('loading');

    try {
      if (this.audioContext) {
        const response = await fetch(audioUrl);
        if (!response.ok) throw new Error(`HTTP error ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
        this.logicalDuration = this.audioBuffer.duration || this.logicalDuration;
        this.setState('ready');
      } else {
        if (!this.fallbackAudio) this.fallbackAudio = new Audio();
        this.fallbackAudio.src = audioUrl;
        this.fallbackAudio.load();
        this.setState('ready');
      }
    } catch {
      // Fallback
      if (this.fallbackAudio) {
        this.fallbackAudio.src = audioUrl;
      }
      this.setState('ready');
    }
  }

  public async play(): Promise<void> {
    this.initWebAudio();
    if (!this.currentAudioUrl || !this.currentTrackId) {
      this.setState('uninitialized');
      throw new Error('Audio playback provider is not configured.');
    }

    try {
      if (this.audioContext) {
        if (this.audioContext.state === 'suspended') {
          await this.audioContext.resume();
        }

        this.stopSource();

        if (this.audioBuffer) {
          const source = this.audioContext.createBufferSource();
          source.buffer = this.audioBuffer;
          source.playbackRate.value = this.currentPlaybackRate;
          source.connect(this.gainNode!);
          const offset = Math.max(0, Math.min(this.logicalCurrentTime, this.audioBuffer.duration));
          source.start(0, offset);
          this.sourceNode = source;

          source.onended = () => {
            if (this.sourceNode === source) {
              this.isPlaying = false;
              this.setState('paused');
            }
          };
        }
      } else if (this.fallbackAudio) {
        await this.fallbackAudio.play();
      }

      this.playbackStartTime = performance.now();
      this.playbackStartLogicalTime = this.logicalCurrentTime;
      this.isPlaying = true;
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
    if (!this.isPlaying) return;
    this.logicalCurrentTime = this.getCurrentTime();
    this.stopSource();
    if (this.fallbackAudio) {
      try {
        this.fallbackAudio.pause();
      } catch {}
    }
    this.isPlaying = false;
    this.setState('paused');
  }

  private stopSource() {
    if (this.sourceNode) {
      try {
        this.sourceNode.onended = null;
        this.sourceNode.stop();
        this.sourceNode.disconnect();
      } catch {}
      this.sourceNode = null;
    }
  }

  public seek(positionSeconds: number): void {
    const valid = Math.max(0, Math.min(positionSeconds, this.logicalDuration));
    this.logicalCurrentTime = valid;
    this.playbackStartTime = performance.now();
    this.playbackStartLogicalTime = valid;

    if (this.isPlaying && this.audioContext && this.audioBuffer) {
      this.stopSource();
      const source = this.audioContext.createBufferSource();
      source.buffer = this.audioBuffer;
      source.playbackRate.value = this.currentPlaybackRate;
      source.connect(this.gainNode!);
      source.start(0, valid);
      this.sourceNode = source;
    } else if (this.fallbackAudio) {
      try {
        this.fallbackAudio.currentTime = valid;
      } catch {}
    }
  }

  public setPlaybackRate(rate: number): void {
    const bounded = Math.max(0.85, Math.min(rate, 1.15));
    this.logicalCurrentTime = this.getCurrentTime();
    this.playbackStartTime = performance.now();
    this.playbackStartLogicalTime = this.logicalCurrentTime;
    this.currentPlaybackRate = bounded;

    if (this.sourceNode) {
      try {
        this.sourceNode.playbackRate.setValueAtTime(bounded, this.audioContext?.currentTime || 0);
      } catch {
        this.sourceNode.playbackRate.value = bounded;
      }
    }
    if (this.fallbackAudio) {
      try {
        this.fallbackAudio.playbackRate = bounded;
      } catch {}
    }
  }

  public setVolume(volumeInput: number): void {
    const normalized = volumeInput > 1 ? volumeInput / 100 : volumeInput;
    const vol = Math.max(0, Math.min(1, normalized));
    this.volume = vol;

    if (this.gainNode && this.audioContext) {
      try {
        this.gainNode.gain.setValueAtTime(vol, this.audioContext.currentTime);
      } catch {
        this.gainNode.gain.value = vol;
      }
    }
    if (this.fallbackAudio) {
      this.fallbackAudio.volume = vol;
    }
  }

  public getVolume(): number {
    return this.volume;
  }

  public getCurrentTime(): number {
    if (this.state !== 'playing' || !this.currentTrackId || !this.currentAudioUrl) {
      return this.logicalCurrentTime;
    }
    const elapsed = ((performance.now() - this.playbackStartTime) / 1000) * this.currentPlaybackRate;
    const current = Math.min(this.playbackStartLogicalTime + elapsed, this.logicalDuration);
    this.logicalCurrentTime = current;
    return current;
  }

  public getDuration(): number {
    return this.logicalDuration || this.audioBuffer?.duration || 0;
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
    this.stopSource();
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
    if (this.fallbackAudio) {
      this.fallbackAudio.pause();
      this.fallbackAudio.src = '';
      this.fallbackAudio = null;
    }
    this.audioBuffer = null;
    this.currentTrackId = null;
    this.currentAudioUrl = null;
    this.isPlaying = false;
    this.listeners.clear();
    this.unlockListeners.clear();
  }
}

export const audioEngine = new AudioEngine();
