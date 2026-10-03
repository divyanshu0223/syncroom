import { Track } from '../types';

export interface MediaSessionCallbacks {
  onPlay?: () => void;
  onPause?: () => void;
  onSeek?: (positionSeconds: number) => void;
  onNext?: () => void;
  onPrevious?: () => void;
}

class MediaSessionService {
  private callbacks: MediaSessionCallbacks = {};
  private currentTrack: Track | null = null;
  private isPlaying: boolean = false;
  private currentPosition: number = 0;

  constructor() {
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      this.initActionHandlers();
    }
  }

  private initActionHandlers() {
    try {
      navigator.mediaSession.setActionHandler('play', () => {
        this.callbacks.onPlay?.();
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        this.callbacks.onPause?.();
      });
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        this.callbacks.onPrevious?.();
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        this.callbacks.onNext?.();
      });
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime !== undefined && this.callbacks.onSeek) {
          this.currentPosition = details.seekTime;
          this.callbacks.onSeek(details.seekTime);
        }
      });
      navigator.mediaSession.setActionHandler('seekbackward', (details) => {
        const offset = details.seekOffset || 10;
        if (this.callbacks.onSeek) {
          const target = Math.max(0, this.currentPosition - offset);
          this.currentPosition = target;
          this.callbacks.onSeek(target);
        }
      });
      navigator.mediaSession.setActionHandler('seekforward', (details) => {
        const offset = details.seekOffset || 10;
        if (this.callbacks.onSeek) {
          const target = this.currentPosition + offset;
          this.currentPosition = target;
          this.callbacks.onSeek(target);
        }
      });
    } catch (e) {
      console.warn('[MediaSession] Action handler registration error:', e);
    }
  }

  public setCallbacks(callbacks: MediaSessionCallbacks) {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  public updateTrack(track: Track | null) {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    this.currentTrack = track;
    if (!track) {
      navigator.mediaSession.metadata = null;
      return;
    }

    try {
      const artwork = [];
      if (track.albumArtUrl) {
        artwork.push(
          { src: track.albumArtUrl, sizes: '96x96', type: 'image/jpeg' },
          { src: track.albumArtUrl, sizes: '128x128', type: 'image/jpeg' },
          { src: track.albumArtUrl, sizes: '256x256', type: 'image/jpeg' },
          { src: track.albumArtUrl, sizes: '512x512', type: 'image/jpeg' }
        );
      }
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist || 'SyncRoom Artist',
        album: track.album || 'SyncRoom Room Audio',
        artwork,
      });
    } catch (e) {
      console.warn('[MediaSession] Error setting metadata:', e);
    }
  }

  public updatePlaybackState(isPlaying: boolean, position = 0, duration = 0) {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    this.isPlaying = isPlaying;
    this.currentPosition = position;
    try {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';

      if (duration > 0 && typeof navigator.mediaSession.setPositionState === 'function') {
        const pos = Math.max(0, Math.min(position, duration));
        navigator.mediaSession.setPositionState({
          duration,
          playbackRate: 1.0,
          position: pos,
        });
      }
    } catch {
      // Ignore positionState errors
    }
  }
}

export const mediaSessionService = new MediaSessionService();
