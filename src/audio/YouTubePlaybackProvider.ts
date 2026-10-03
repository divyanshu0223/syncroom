import { Track } from '../types';
import { PlaybackProvider, SpotifyPlayerStatus } from './PlaybackProvider';

declare global {
  interface Window {
    onYouTubeIframeAPIReady?: () => void;
    YT?: {
      Player: new (
        element: string | HTMLElement,
        options: {
          height?: string | number;
          width?: string | number;
          videoId?: string;
          playerVars?: Record<string, any>;
          events?: {
            onReady?: (event: { target: any }) => void;
            onStateChange?: (event: { data: number; target: any }) => void;
            onError?: (event: { data: number; target: any }) => void;
            onPlaybackRateChange?: (event: { data: number; target: any }) => void;
          };
        }
      ) => YouTubePlayerInstance;
      PlayerState: {
        UNSTARTED: number;
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
        BUFFERING: number;
        CUED: number;
      };
    };
  }
}

export interface YouTubePlayerInstance {
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead?: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getVolume(): number;
  setVolume(volume0to100: number): void;
  unMute(): void;
  mute(): void;
  isMuted(): boolean;
  getPlayerState(): number;
  loadVideoById(videoId: string | { videoId: string; startSeconds?: number }, startSeconds?: number): void;
  cueVideoById(videoId: string | { videoId: string; startSeconds?: number }, startSeconds?: number): void;
  destroy(): void;
  getIframe(): HTMLIFrameElement;
}

/**
 * YouTubePlaybackProvider
 *
 * Official YouTube IFrame Player API implementation for SyncRoom.
 * Streams real video/audio directly using YouTube's official embedded player.
 * Strictly adheres to YouTube API terms of service.
 */
export class YouTubePlaybackProvider implements PlaybackProvider {
  public readonly id = 'youtube';
  public readonly name = 'YouTube Player';

  private player: YouTubePlayerInstance | null = null;
  private status: SpotifyPlayerStatus | string = 'INITIALIZING';
  private errorMessage: string | null = null;
  private volume: number = 80;
  private currentTrackId: string | null = null;
  private currentVideoId: string | null = null;
  private duration: number = 0;
  private isPlayerReady: boolean = false;
  private statusListeners: Set<(status: SpotifyPlayerStatus | string, error?: string | null) => void> = new Set();
  private initPromise: Promise<boolean> | null = null;
  private containerElement: HTMLElement | null = null;
  private iframeElement: HTMLIFrameElement | null = null;
  private pendingVideoLoad: { videoId: string; positionSeconds: number; autoplay: boolean } | null = null;

  public get isConfigured(): boolean {
    return this.isPlayerReady && Boolean(this.player);
  }

  public getStatus(): SpotifyPlayerStatus | string {
    return this.status;
  }

  public getErrorMessage(): string | null {
    return this.errorMessage;
  }

  public getDeviceId(): string | null {
    return this.isPlayerReady && this.currentVideoId ? `youtube-${this.currentVideoId}` : null;
  }

  public getCurrentTrackId(): string | null {
    return this.currentTrackId;
  }

  public getCurrentVideoId(): string | null {
    return this.currentVideoId;
  }

  public onStatusChange(
    listener: (status: SpotifyPlayerStatus | string, error?: string | null) => void
  ): () => void {
    this.statusListeners.add(listener);
    listener(this.status, this.errorMessage);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private notify(newStatus: SpotifyPlayerStatus | string, error: string | null = null) {
    if (this.status === newStatus && this.errorMessage === error) {
      return;
    }
    this.status = newStatus;
    this.errorMessage = error;
    this.statusListeners.forEach((l) => {
      try {
        l(this.status, this.errorMessage);
      } catch (err) {
        console.error('[YouTubePlaybackProvider] Listener error:', err);
      }
    });
  }

  private getIframeElement(): HTMLIFrameElement | null {
    if (this.iframeElement) return this.iframeElement;
    if (typeof document !== 'undefined') {
      return document.getElementById('syncroom-youtube-iframe') as HTMLIFrameElement | null;
    }
    return null;
  }

  /**
   * Directly attaches the rendered YouTube iframe element.
   */
  public attachIframe(iframe: HTMLIFrameElement | null) {
    if (!iframe) return;
    if (this.iframeElement === iframe && this.player) {
      return;
    }
    const isNew = this.iframeElement !== iframe;
    this.iframeElement = iframe;
    this.isPlayerReady = true;

    if (this.status !== 'PLAYER_READY' && this.status !== 'PLAYING') {
      this.notify('PLAYER_READY');
    }

    if (isNew || !this.player) {
      this.initialize().then(() => {
        if (this.iframeElement === iframe) {
          this.bindIframePlayer(iframe);
        }
      }).catch(() => {});
    }
  }

  /**
   * Binds an existing DOM container to mount the YouTube IFrame player.
   */
  public attachContainer(element: HTMLElement | null) {
    if (!element) return;
    if (this.containerElement === element) return;
    this.containerElement = element;
    const iframe = element.querySelector('iframe') as HTMLIFrameElement | null;
    if (iframe) {
      this.attachIframe(iframe);
      return;
    }

    this.initialize().then(() => {
      this.createPlayerInstance();
    }).catch(() => {});
  }

  /**
   * Initializes the official YouTube IFrame API script tag with resilient polling.
   */
  public async initialize(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    if (this.isConfigured) return true;
    if (this.initPromise) return this.initPromise;

    if (this.status !== 'PLAYER_READY' && this.status !== 'PLAYING') {
      this.notify('INITIALIZING');
    }

    this.initPromise = new Promise<boolean>((resolve) => {
      let settled = false;
      let pollInterval: ReturnType<typeof setInterval> | null = null;

      const finishInit = () => {
        if (settled) return;
        settled = true;
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
        if (this.iframeElement) {
          this.bindIframePlayer(this.iframeElement);
        } else {
          this.createPlayerInstance();
        }
        resolve(true);
      };

      // 1. If YouTube IFrame API is already loaded in page
      if (window.YT && window.YT.Player) {
        finishInit();
        return;
      }

      if ((window as any).__ytIframeApiReady) {
        finishInit();
        return;
      }

      if ((window as any).__ytIframeApiReadyCallbacks) {
        (window as any).__ytIframeApiReadyCallbacks.push(() => {
          finishInit();
        });
      }

      // 2. Poll periodically in case onYouTubeIframeAPIReady already fired
      pollInterval = setInterval(() => {
        if (window.YT && window.YT.Player) {
          finishInit();
        }
      }, 50);

      // Stop polling after 12 seconds
      setTimeout(() => {
        if (!settled && pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
      }, 12000);

      // 3. Set up global callback
      const previousCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof previousCallback === 'function') {
          try { previousCallback(); } catch {}
        }
        finishInit();
      };

      // 4. Inject script tag if not already present
      const existingScript = document.getElementById('syncroom-yt-api-script');
      if (!existingScript) {
        const tag = document.createElement('script');
        tag.id = 'syncroom-yt-api-script';
        tag.src = 'https://www.youtube.com/iframe_api';
        tag.async = true;
        const firstScriptTag = document.getElementsByTagName('script')[0];
        if (firstScriptTag && firstScriptTag.parentNode) {
          firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
        } else {
          document.head.appendChild(tag);
        }
      }
    });

    return this.initPromise;
  }

  private bindIframePlayer(iframe: HTMLIFrameElement) {
    if (typeof window === 'undefined' || !window.YT || !window.YT.Player) return;

    try {
      if (this.player) {
        try {
          if (typeof this.player.getIframe === 'function') {
            const current = this.player.getIframe();
            if (current === iframe || (current && iframe && current.id && current.id === iframe.id)) {
              return; // Already attached to this iframe! Keep existing player!
            }
          }
          this.player.destroy();
        } catch {}
        this.player = null;
      }

      this.player = new window.YT.Player(iframe, {
        events: {
          onReady: (event) => {
            this.isPlayerReady = true;
            try {
              if (typeof event.target.unMute === 'function') {
                event.target.unMute();
              }
              if (typeof event.target.setVolume === 'function') {
                event.target.setVolume(this.volume || 100);
              }
            } catch {}
            if (this.pendingVideoLoad) {
              const pending = this.pendingVideoLoad;
              this.pendingVideoLoad = null;
              this.loadTrackInternal(pending.videoId, pending.positionSeconds, pending.autoplay);
            } else if (this.status === 'PLAYING') {
              try {
                event.target.playVideo();
              } catch {}
            } else if (this.status !== 'PLAYER_READY') {
              this.notify('PLAYER_READY');
            }
          },
          onStateChange: (event) => {
            this.handlePlayerStateChange(event.data);
          },
          onError: (event) => {
            this.handlePlayerError(event.data);
          },
        },
      });
    } catch (err) {
      console.warn('[YouTubePlaybackProvider] bindIframePlayer error:', err);
    }
  }

  /**
   * Creates or attaches the YT.Player instance to the container element.
   */
  private createPlayerInstance() {
    if (typeof window === 'undefined' || !window.YT || !window.YT.Player) return;

    // Check if direct iframe is present
    const directIframe = this.getIframeElement();
    if (directIframe) {
      this.bindIframePlayer(directIframe);
      return;
    }

    const mountEl = this.containerElement || (typeof document !== 'undefined' ? document.getElementById('syncroom-youtube-player-mount') : null);
    if (!mountEl) return;

    try {
      mountEl.innerHTML = '';
      const playerTarget = document.createElement('div');
      playerTarget.id = `yt-player-target-${Date.now()}`;
      playerTarget.style.width = '100%';
      playerTarget.style.height = '100%';
      mountEl.appendChild(playerTarget);

      this.player = new window.YT.Player(playerTarget, {
        width: '100%',
        height: '100%',
        videoId: this.currentVideoId || undefined,
        playerVars: {
          autoplay: 0,
          controls: 1,
          enablejsapi: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
        },
        events: {
          onReady: (event) => {
            this.isPlayerReady = true;
            try {
              if (typeof event.target.unMute === 'function') {
                event.target.unMute();
              }
              event.target.setVolume(this.volume || 100);
            } catch {}
            this.notify('PLAYER_READY');

            if (this.pendingVideoLoad) {
              const pending = this.pendingVideoLoad;
              this.pendingVideoLoad = null;
              this.loadTrackInternal(pending.videoId, pending.positionSeconds, pending.autoplay);
            } else if (this.currentVideoId) {
              this.loadTrackInternal(this.currentVideoId, 0, false);
            }
          },
          onStateChange: (event) => {
            this.handlePlayerStateChange(event.data);
          },
          onError: (event) => {
            this.handlePlayerError(event.data);
          },
        },
      });
    } catch (err) {
      console.warn('[YouTubePlaybackProvider] Failed to instantiate YT.Player:', err);
      this.notify('PLAYBACK_ERROR', 'Failed to initialize official YouTube player.');
    }
  }

  private handlePlayerStateChange(state: number) {
    if (typeof window === 'undefined' || !window.YT) return;

    switch (state) {
      case window.YT.PlayerState.PLAYING:
        this.unMute();
        this.notify('PLAYING');
        break;
      case window.YT.PlayerState.PAUSED:
        this.notify('PAUSED');
        break;
      case window.YT.PlayerState.BUFFERING:
        break;
      case window.YT.PlayerState.CUED:
        this.notify('PLAYER_READY');
        break;
      case window.YT.PlayerState.ENDED:
        this.notify('PAUSED');
        break;
      case -1: // UNSTARTED
        this.notify('PLAYER_READY');
        break;
    }
  }

  private handlePlayerError(errorCode: number) {
    let message = 'YouTube playback is unavailable for this video.';
    if (errorCode === 2) {
      message = 'Invalid YouTube video ID parameter.';
    } else if (errorCode === 5) {
      message = 'This video cannot be played in an HTML5 embedded player.';
    } else if (errorCode === 100) {
      message = 'YouTube video not found or removed.';
    } else if (errorCode === 101 || errorCode === 150) {
      message = 'The owner of this YouTube video does not allow embedded playback.';
    }

    console.warn(`[YouTubePlaybackProvider] YouTube player error ${errorCode}: ${message}`);
    this.notify('PLAYBACK_ERROR', message);
  }

  public canPlayTrack(track: Track): { canPlay: boolean; reason: string } {
    if (track.provider !== 'youtube' && !track.youtubeVideoId) {
      return { canPlay: false, reason: 'Requires YouTube audio source or matching YouTube video.' };
    }
    const videoId = track.youtubeVideoId || track.providerTrackId;
    if (!videoId) {
      return { canPlay: false, reason: 'Track is missing a valid YouTube video ID.' };
    }
    return { canPlay: true, reason: 'Official YouTube player ready.' };
  }

  /**
   * Loads a track by track object or video ID.
   */
  public async loadTrack(track: Track | string, positionSeconds = 0, autoplay = true): Promise<void> {
    let videoId: string;
    let trackId: string;

    if (typeof track === 'string') {
      videoId = track.startsWith('youtube-') ? track.replace(/^youtube-/, '') : track;
      trackId = track.startsWith('youtube-') ? track : `youtube-${track}`;
    } else {
      videoId = track.youtubeVideoId || track.providerTrackId || track.id.replace(/^youtube-/, '');
      trackId = track.id;
      if (track.duration) {
        this.duration = track.duration;
      }
    }

    // IDEMPOTENCY GUARD: If this video is ALREADY active and playing/ready, do NOT reload from 0s!
    if (
      this.currentTrackId === trackId &&
      this.currentVideoId === videoId &&
      (this.status === 'PLAYING' || this.status === 'PLAYER_READY')
    ) {
      if (autoplay && this.status !== 'PLAYING') {
        await this.play();
      }
      return;
    }

    this.currentTrackId = trackId;
    this.currentVideoId = videoId;
    this.isPlayerReady = true;

    if (autoplay) {
      this.notify('PLAYING');
    } else {
      this.notify('PLAYER_READY');
    }

    if (this.player) {
      await this.loadTrackInternal(videoId, positionSeconds, autoplay);
      return;
    }

    this.pendingVideoLoad = { videoId, positionSeconds, autoplay };
    await this.initialize();
  }

  private async loadTrackInternal(videoId: string, positionSeconds: number, autoplay: boolean) {
    const startSec = Math.max(0, Math.floor(positionSeconds));
    if (this.player) {
      try {
        if (autoplay) {
          try {
            if (typeof this.player.unMute === 'function') {
              this.player.unMute();
            }
            if (typeof this.player.setVolume === 'function') {
              this.player.setVolume(this.volume || 100);
            }
          } catch {}
          if (typeof this.player.loadVideoById === 'function') {
            this.player.loadVideoById(videoId, startSec);
          }
          this.notify('PLAYING');
        } else {
          if (typeof this.player.cueVideoById === 'function') {
            this.player.cueVideoById(videoId, startSec);
          }
          this.notify('PLAYER_READY');
        }
      } catch (err) {
        console.warn('[YouTubePlaybackProvider] Error loading video:', err);
      }
    }

    // Direct postMessage fallback
    const iframe = this.getIframeElement();
    if (iframe && iframe.contentWindow) {
      try {
        if (autoplay) {
          iframe.contentWindow.postMessage(
            JSON.stringify({ event: 'command', func: 'unMute', args: [] }),
            '*'
          );
          iframe.contentWindow.postMessage(
            JSON.stringify({ event: 'command', func: 'setVolume', args: [this.volume || 100] }),
            '*'
          );
        }
        iframe.contentWindow.postMessage(
          JSON.stringify({
            event: 'command',
            func: autoplay ? 'loadVideoById' : 'cueVideoById',
            args: [videoId, startSec],
          }),
          '*'
        );
        if (autoplay) {
          iframe.contentWindow.postMessage(
            JSON.stringify({ event: 'command', func: 'playVideo', args: [] }),
            '*'
          );
          this.notify('PLAYING');
        }
      } catch {}
    }
  }

  public unMute(): void {
    if (this.player) {
      try {
        if (typeof this.player.unMute === 'function') {
          this.player.unMute();
        }
        if (typeof this.player.setVolume === 'function') {
          this.player.setVolume(this.volume || 100);
        }
      } catch {}
    }

    const iframe = this.getIframeElement();
    if (iframe && iframe.contentWindow) {
      try {
        iframe.contentWindow.postMessage(
          JSON.stringify({ event: 'command', func: 'unMute', args: [] }),
          '*'
        );
        iframe.contentWindow.postMessage(
          JSON.stringify({ event: 'command', func: 'setVolume', args: [this.volume || 100] }),
          '*'
        );
      } catch {}
    }
  }

  public mute(): void {
    if (this.player) {
      try {
        if (typeof this.player.mute === 'function') {
          this.player.mute();
        }
      } catch {}
    }

    const iframe = this.getIframeElement();
    if (iframe && iframe.contentWindow) {
      try {
        iframe.contentWindow.postMessage(
          JSON.stringify({ event: 'command', func: 'mute', args: [] }),
          '*'
        );
      } catch {}
    }
  }

  public isMuted(): boolean {
    if (this.player && typeof this.player.isMuted === 'function') {
      try {
        return this.player.isMuted();
      } catch {}
    }
    return false;
  }

  public async activateElement(): Promise<void> {
    this.unMute();
    await this.setVolume(this.volume || 100);
  }

  public async play(): Promise<void> {
    this.unMute();

    if (this.player) {
      try {
        try {
          if (typeof this.player.unMute === 'function') {
            this.player.unMute();
          }
          if (typeof this.player.setVolume === 'function') {
            this.player.setVolume(this.volume || 100);
          }
        } catch {}
        if (typeof this.player.playVideo === 'function') {
          this.player.playVideo();
          this.notify('PLAYING');
          return;
        }
      } catch (err) {
        console.warn('[YouTubePlaybackProvider] playVideo error:', err);
      }
    }

    // Direct postMessage fallback
    const iframe = this.getIframeElement();
    if (iframe && iframe.contentWindow) {
      try {
        iframe.contentWindow.postMessage(
          JSON.stringify({ event: 'command', func: 'unMute', args: [] }),
          '*'
        );
        iframe.contentWindow.postMessage(
          JSON.stringify({ event: 'command', func: 'setVolume', args: [this.volume || 100] }),
          '*'
        );
        iframe.contentWindow.postMessage(
          JSON.stringify({ event: 'command', func: 'playVideo', args: [] }),
          '*'
        );
        this.notify('PLAYING');
      } catch {}
    }
  }

  public async resume(): Promise<void> {
    return this.play();
  }

  public pause(): void {
    if (this.player && this.isPlayerReady) {
      try {
        this.player.pauseVideo();
        this.notify('PAUSED');
        return;
      } catch {}
    }

    const iframe = this.getIframeElement();
    if (iframe && iframe.contentWindow) {
      try {
        iframe.contentWindow.postMessage(
          JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }),
          '*'
        );
        this.notify('PAUSED');
      } catch {}
    }
  }

  public seek(positionSeconds: number): void {
    const sec = Math.max(0, positionSeconds);
    if (this.player && this.isPlayerReady) {
      try {
        this.player.seekTo(sec, true);
        return;
      } catch {}
    }

    const iframe = this.getIframeElement();
    if (iframe && iframe.contentWindow) {
      try {
        iframe.contentWindow.postMessage(
          JSON.stringify({ event: 'command', func: 'seekTo', args: [sec, true] }),
          '*'
        );
      } catch {}
    }
  }

  public getPosition(): number {
    if (this.player && this.isPlayerReady) {
      try {
        const pos = this.player.getCurrentTime();
        return typeof pos === 'number' && !isNaN(pos) ? pos : 0;
      } catch {
        return 0;
      }
    }
    return 0;
  }

  public getDuration(): number {
    if (this.player && this.isPlayerReady) {
      try {
        const dur = this.player.getDuration();
        if (typeof dur === 'number' && dur > 0) {
          this.duration = dur;
        }
        return this.duration;
      } catch {
        return this.duration;
      }
    }
    return this.duration;
  }

  public getVolume(): number {
    return this.volume;
  }

  public async setVolume(volume0to100: number): Promise<void> {
    const clamped = Math.max(0, Math.min(100, Math.round(volume0to100)));
    this.volume = clamped;
    if (clamped > 0) {
      this.unMute();
    }
    if (this.player && this.isPlayerReady) {
      try {
        if (clamped > 0 && typeof this.player.unMute === 'function') {
          this.player.unMute();
        }
        this.player.setVolume(this.volume);
      } catch {}
    }

    const iframe = this.getIframeElement();
    if (iframe && iframe.contentWindow) {
      try {
        if (clamped > 0) {
          iframe.contentWindow.postMessage(
            JSON.stringify({ event: 'command', func: 'unMute', args: [] }),
            '*'
          );
        }
        iframe.contentWindow.postMessage(
          JSON.stringify({ event: 'command', func: 'setVolume', args: [this.volume] }),
          '*'
        );
      } catch {}
    }
  }

  public destroy(): void {
    if (this.player) {
      try {
        this.player.destroy();
      } catch {}
      this.player = null;
    }
    this.isPlayerReady = false;
    this.initPromise = null;
    this.containerElement = null;
    this.iframeElement = null;
    this.notify('INITIALIZING');
  }
}

export const youtubePlaybackProvider = new YouTubePlaybackProvider();
