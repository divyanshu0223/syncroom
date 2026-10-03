import { Track } from '../types';

export type SpotifyPlayerStatus =
  | 'INITIALIZING'
  | 'CONNECT_SPOTIFY'
  | 'CONNECTING_PLAYER'
  | 'PLAYER_READY'
  | 'PLAYING'
  | 'PAUSED'
  | 'DEVICE_NOT_READY'
  | 'AUTH_REQUIRED'
  | 'PREMIUM_REQUIRED'
  | 'PLAYBACK_ERROR'
  | 'AUTOPLAY_BLOCKED'
  | 'PROVIDER_UNAVAILABLE';

export interface PlaybackProvider {
  readonly id: string;
  readonly name: string;
  readonly isConfigured: boolean;

  getStatus(): SpotifyPlayerStatus | string;
  getErrorMessage?(): string | null;
  getDeviceId?(): string | null;

  getCurrentTrackId?(): string | null;

  initialize(): Promise<boolean>;
  activateElement?(): Promise<void>;
  canPlayTrack(track: Track): { canPlay: boolean; reason: string };
  loadTrack(track: Track | string, positionSeconds?: number, autoplay?: boolean): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seek(positionSeconds: number): void;
  getPosition(): number;
  getDuration(): number;
  setVolume(volume0to100: number): void;
  getVolume(): number;
  onStatusChange?(listener: (status: SpotifyPlayerStatus | string, error?: string | null) => void): () => void;
  destroy(): void;
}

/**
 * UnconfiguredPlaybackProvider
 *
 * Active when no real audio playback provider is configured.
 * Strictly adheres to developer terms: does NOT generate fake audio,
 * does NOT simulate playback, and accurately reports that real playback is not configured.
 */
export class UnconfiguredPlaybackProvider implements PlaybackProvider {
  public readonly id = 'unconfigured';
  public readonly name = 'No Audio Provider';
  public readonly isConfigured = false;

  public getStatus(): SpotifyPlayerStatus {
    return 'PROVIDER_UNAVAILABLE';
  }

  public getErrorMessage(): string | null {
    return 'Audio playback provider is not configured.';
  }

  public getDeviceId(): string | null {
    return null;
  }

  public getCurrentTrackId(): string | null {
    return null;
  }

  public async initialize(): Promise<boolean> {
    return false;
  }

  public canPlayTrack(track: Track): { canPlay: boolean; reason: string } {
    if (track.restrictionReason) {
      return {
        canPlay: false,
        reason: `Track restricted by Spotify (${track.restrictionReason}).`,
      };
    }
    return {
      canPlay: false,
      reason:
        'Audio playback provider is not configured. Spotify tracks are imported as metadata only. Real-time audio requires a configured playback provider (e.g. Spotify Web Playback SDK with Spotify Premium).',
    };
  }

  public async loadTrack(_track: Track | string, _positionSeconds?: number, _autoplay?: boolean): Promise<void> {
    throw new Error('Audio playback provider is not configured.');
  }

  public async play(): Promise<void> {
    throw new Error('Audio playback provider is not configured.');
  }

  public pause(): void {
    // No-op
  }

  public seek(_positionSeconds: number): void {
    // No-op
  }

  public getPosition(): number {
    return 0;
  }

  public getDuration(): number {
    return 0;
  }

  public setVolume(_volume0to100: number): void {
    // No-op
  }

  public getVolume(): number {
    return 0;
  }

  public destroy(): void {
    // No-op
  }
}

/**
 * PlaybackManager
 *
 * Central registry for active playback provider in SyncRoom.
 */
export class PlaybackManager {
  private activeProvider: PlaybackProvider = new UnconfiguredPlaybackProvider();
  private listeners: Set<(provider: PlaybackProvider, status: SpotifyPlayerStatus | string) => void> = new Set();
  private unregisterProviderListener: (() => void) | null = null;

  public getProvider(): PlaybackProvider {
    return this.activeProvider;
  }

  public setProvider(provider: PlaybackProvider, destroyPrevious = false): void {
    if (this.activeProvider === provider) {
      return;
    }
    if (this.unregisterProviderListener) {
      this.unregisterProviderListener();
      this.unregisterProviderListener = null;
    }
    if (destroyPrevious) {
      this.activeProvider.destroy();
    } else {
      try {
        this.activeProvider.pause();
      } catch {}
    }
    this.activeProvider = provider;

    if (provider.onStatusChange) {
      this.unregisterProviderListener = provider.onStatusChange((status) => {
        this.notify(status);
      });
    }

    this.notify(provider.getStatus());
  }

  public getStatus(): SpotifyPlayerStatus | string {
    return this.activeProvider.getStatus();
  }

  public isConfigured(): boolean {
    return this.activeProvider.isConfigured;
  }

  public canPlayTrack(track: Track): { canPlay: boolean; reason: string } {
    return this.activeProvider.canPlayTrack(track);
  }

  public async activateElement(): Promise<void> {
    if (this.activeProvider.activateElement) {
      await this.activeProvider.activateElement();
    }
  }

  public onProviderChange(
    listener: (provider: PlaybackProvider, status: SpotifyPlayerStatus | string) => void
  ): () => void {
    this.listeners.add(listener);
    listener(this.activeProvider, this.activeProvider.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(status: SpotifyPlayerStatus | string) {
    this.listeners.forEach((l) => l(this.activeProvider, status));
  }
}

export const playbackManager = new PlaybackManager();
