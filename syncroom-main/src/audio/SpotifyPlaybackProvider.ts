import { Track } from '../types';
import { playbackManager, PlaybackProvider, SpotifyPlayerStatus } from './PlaybackProvider';
import { getApiBaseUrl } from '../config/runtime';
import { getSession } from '../services/session';
import { socketService } from '../services/socket';

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: {
      Player: new (options: {
        name: string;
        getOAuthToken: (cb: (token: string) => void) => void;
        volume?: number;
      }) => SpotifyPlayerInstance;
    };
  }
}

export interface SpotifyPlayerInstance {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: 'ready' | 'not_ready', cb: (data: { device_id: string }) => void): boolean;
  addListener(event: 'player_state_changed', cb: (state: SpotifyWebPlaybackState | null) => void): boolean;
  addListener(
    event: 'initialization_error' | 'authentication_error' | 'account_error' | 'playback_error',
    cb: (data: { message: string }) => void
  ): boolean;
  addListener(event: 'autoplay_failed', cb: () => void): boolean;
  removeListener(event: string, cb?: Function): boolean;
  getCurrentState(): Promise<SpotifyWebPlaybackState | null>;
  setName(name: string): Promise<void>;
  getVolume(): Promise<number>;
  setVolume(volume: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  togglePlay(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  previousTrack(): Promise<void>;
  nextTrack(): Promise<void>;
}

export interface SpotifyWebPlaybackState {
  context: {
    uri: string | null;
    metadata: any;
  };
  bitrate: number;
  position: number;
  duration: number;
  paused: boolean;
  shuffle: boolean;
  repeat_mode: number;
  track_window: {
    current_track: {
      id: string;
      uri: string;
      type: string;
      media_type: string;
      name: string;
      is_playable: boolean;
      album: {
        uri: string;
        name: string;
        images: Array<{ url: string }>;
      };
      artists: Array<{ uri: string; name: string }>;
    };
    next_tracks: any[];
    previous_tracks: any[];
  };
}

/**
 * SpotifyPlaybackProvider
 *
 * Official Spotify Web Playback SDK implementation for SyncRoom.
 * Streams real audio directly via the browser Spotify.Player device.
 * Strictly adheres to developer terms and official Spotify API limits.
 */
export class SpotifyPlaybackProvider implements PlaybackProvider {
  public readonly id = 'spotify';
  public readonly name = 'Spotify Web Player';

  private player: SpotifyPlayerInstance | null = null;
  private deviceId: string | null = null;
  private status: SpotifyPlayerStatus = 'INITIALIZING';
  private errorMessage: string | null = null;
  private isPremium: boolean = false;
  private volume: number = 0.8;
  private currentTrackId: string | null = null;
  private lastState: SpotifyWebPlaybackState | null = null;
  private lastStateMonotonicTime: number = 0;
  private statusListeners: Set<(status: SpotifyPlayerStatus, error?: string | null) => void> = new Set();
  private sdkLoadingPromise: Promise<boolean> | null = null;
  private reconnectTimer: number | null = null;
  private initPromise: Promise<boolean> | null = null;
  private cachedToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private tokenInFlight: Promise<string | null> | null = null;
  private transferredDeviceId: string | null = null;
  private transferPromise: Promise<void> | null = null;
  private connectSucceeded: boolean = false;

  public get isConfigured(): boolean {
    return (
      (this.status === 'PLAYER_READY' || this.status === 'PLAYING' || this.status === 'PAUSED' || this.status === 'PLAYBACK_ERROR') &&
      Boolean(this.deviceId)
    );
  }

  public getStatus(): SpotifyPlayerStatus {
    return this.status;
  }

  public getErrorMessage(): string | null {
    return this.errorMessage;
  }

  public getDeviceId(): string | null {
    return this.deviceId;
  }

  public onStatusChange(
    listener: (status: SpotifyPlayerStatus, error?: string | null) => void
  ): () => void {
    this.statusListeners.add(listener);
    listener(this.status, this.errorMessage);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    this.statusListeners.forEach((l) => l(this.status, this.errorMessage));
  }

  private getSessionId(): string {
    if (typeof window === 'undefined') return 'default-session';
    const stored = getSession();
    if (stored?.sessionToken) return stored.sessionToken;
    return localStorage.getItem('syncroom_session_id') || 'default-session';
  }

  /**
   * Fetches fresh access token from backend for the active session.
   * Caches token in memory and deduplicates in-flight calls to eliminate network latency.
   */
  public async fetchFreshToken(): Promise<string | null> {
    // 1. Return in-memory cached token if valid for >60s
    if (this.cachedToken && Date.now() < this.tokenExpiresAt - 60000) {
      return this.cachedToken;
    }

    // 2. Return in-flight token fetch promise to avoid concurrent redundant requests
    if (this.tokenInFlight) {
      return this.tokenInFlight;
    }

    this.tokenInFlight = this.doFetchFreshToken().finally(() => {
      this.tokenInFlight = null;
    });

    return this.tokenInFlight;
  }

  private async doFetchFreshToken(): Promise<string | null> {
    const sessionId = this.getSessionId();
    const baseUrl = getApiBaseUrl();

    if (!baseUrl) {
      this.logDiagnostic('Access token available', false);
      this.status = 'PROVIDER_UNAVAILABLE';
      this.errorMessage = 'Backend connection not configured. Please configure VITE_API_URL.';
      this.notifyListeners();
      return null;
    }

    try {
      const res = await fetch(`${baseUrl}/api/spotify/token?sessionId=${encodeURIComponent(sessionId)}`, {
        headers: { 'x-session-id': sessionId },
        signal: AbortSignal.timeout(6000),
      });

      if (!res.ok) {
        this.logDiagnostic('Access token expired', true);
        if (res.status === 401) {
          this.status = 'CONNECT_SPOTIFY';
          this.errorMessage = 'Connect Spotify to enable playback.';
          this.logMemberPlaybackLifecycle('token_fetch_unauthenticated');
          this.notifyListeners();
        }
        return null;
      }

      const data = await res.json();
      this.logDiagnostic('Access token expired', false);
      this.isPremium = data.isPremium === true || data.product === 'premium';
      const token = data.accessToken || null;
      if (token) {
        this.cachedToken = token;
        const expiresInSec = typeof data.expiresIn === 'number' ? data.expiresIn : 3600;
        this.tokenExpiresAt = Date.now() + expiresInSec * 1000;
      }
      return token;
    } catch (err) {
      this.logDiagnostic('Access token expired', true);
      console.warn('[Spotify Playback Provider] Token fetch error:', (err as Error)?.message);
      return null;
    }
  }

  public hasValidToken(): boolean {
    return Boolean(this.cachedToken && Date.now() < this.tokenExpiresAt);
  }

  public isPlayerReady(): boolean {
    return Boolean(this.deviceId && (this.status === 'PLAYER_READY' || this.status === 'PLAYING' || this.status === 'PAUSED'));
  }

  /**
   * Safe diagnostics logger - NEVER logs tokens, secrets, or sensitive headers
   */
  private logDiagnostic(key: string, value: any): void {
    if (typeof value === 'string' && (value.length > 80 || /bearer|token|secret|authorization/i.test(key))) {
      return;
    }
    console.log(`[Spotify Playback Diagnostics] ${key}:`, value);
  }

  /**
   * Safe structured audio logger for Member session verification.
   * Format:
   * [MEMBER_AUDIO] roomConnected=true/false spotifyTokenAvailable=true/false playerCreated=true/false playerConnected=true/false ready=true/false deviceIdPresent=true/false playbackState=playing/paused/unavailable
   * Strictly NEVER logs access tokens, refresh tokens, secrets, or authorization headers.
   */
  public logMemberAudio(context?: string): void {
    const isSocketConnected = typeof window !== 'undefined' && socketService ? socketService.getStatus() === 'connected' : false;
    const spotifyTokenAvailable = this.hasValidToken();
    const playerCreated = Boolean(this.player);
    const playerConnected = Boolean(this.connectSucceeded);
    const ready = this.isPlayerReady();
    const deviceIdPresent = Boolean(this.deviceId);
    const playbackState =
      this.status === 'PLAYING' ? 'playing' :
      this.status === 'PAUSED' ? 'paused' :
      'unavailable';

    console.log(
      `[MEMBER_AUDIO]${context ? ` [${context}]` : ''} roomConnected=${isSocketConnected} spotifyTokenAvailable=${spotifyTokenAvailable} playerCreated=${playerCreated} playerConnected=${playerConnected} ready=${ready} deviceIdPresent=${deviceIdPresent} playbackState=${playbackState}`
    );
  }

  /**
   * Safe structured lifecycle event logger for Member & Host Playback sessions.
   * Strictly verifies and logs:
   * room_connected, spotify_token_available, spotify_player_initialized,
   * spotify_connect, spotify_ready, device_id, player_state.
   * NEVER logs access tokens, refresh tokens, secrets, or authorization headers.
   */
  public logMemberPlaybackLifecycle(eventContext?: string): void {
    const isSocketConnected = typeof window !== 'undefined' && socketService ? socketService.getStatus() === 'connected' : false;
    const tokenAvailable = Boolean(this.cachedToken && Date.now() < this.tokenExpiresAt);
    const playerInitialized = Boolean(this.player);
    const connectStatus = this.connectSucceeded ? 'true' : 'false';
    const isReady = Boolean(this.deviceId && (this.status === 'PLAYER_READY' || this.status === 'PLAYING' || this.status === 'PAUSED'));
    const deviceIdState = this.deviceId ? 'present' : 'absent';
    const playerState =
      this.status === 'PLAYING' ? 'playing' :
      this.status === 'PAUSED' ? 'paused' :
      this.status === 'AUTOPLAY_BLOCKED' ? 'autoplay_blocked' :
      this.status === 'AUTH_REQUIRED' || this.status === 'CONNECT_SPOTIFY' ? 'auth_required' :
      this.status === 'PREMIUM_REQUIRED' ? 'premium_required' :
      this.status === 'DEVICE_NOT_READY' ? 'not_ready' :
      'unavailable';

    console.log(
      `[MEMBER_PLAYBACK]${eventContext ? ` [${eventContext}]` : ''} room_connected=${isSocketConnected} spotify_token_available=${tokenAvailable} spotify_player_initialized=${playerInitialized} spotify_connect=${connectStatus} spotify_ready=${isReady} device_id=${deviceIdState} player_state=${playerState}`
    );
  }

  /**
   * Injects and loads the official Spotify Web Playback SDK script tag safely.
   */
  private loadSDKScript(): Promise<boolean> {
    if (typeof window === 'undefined') return Promise.resolve(false);
    if (window.Spotify && window.Spotify.Player) {
      this.logDiagnostic('SDK script loaded', true);
      this.logDiagnostic('SDK callback fired', true);
      return Promise.resolve(true);
    }

    if (this.sdkLoadingPromise) {
      return this.sdkLoadingPromise;
    }

    this.sdkLoadingPromise = new Promise((resolve) => {
      let resolved = false;
      const safeResolve = (success: boolean) => {
        if (!resolved) {
          resolved = true;
          this.logDiagnostic('SDK script loaded', success);
          resolve(success);
        }
      };

      const checkSdkReady = () => {
        if (window.Spotify && window.Spotify.Player) {
          this.logDiagnostic('SDK callback fired', true);
          safeResolve(true);
          return true;
        }
        return false;
      };

      // 1. Check if already marked ready and Player constructor exists
      if (checkSdkReady()) {
        return;
      }

      // 2. Register with global ready callbacks
      if (!(window as any).__spotifySdkReadyCallbacks) {
        (window as any).__spotifySdkReadyCallbacks = [];
      }
      (window as any).__spotifySdkReadyCallbacks.push(() => {
        checkSdkReady();
      });

      const prevReady = window.onSpotifyWebPlaybackSDKReady;
      window.onSpotifyWebPlaybackSDKReady = () => {
        if (prevReady) {
          try { prevReady(); } catch {}
        }
        (window as any).__spotifySdkReady = true;
        checkSdkReady();
      };

      // 3. Ensure script tag exists in DOM
      let script = document.querySelector('script[src*="spotify-player.js"]') as HTMLScriptElement;
      if (!script) {
        script = document.createElement('script');
        script.src = 'https://sdk.scdn.co/spotify-player.js';
        script.async = true;
        script.onerror = () => {
          this.logDiagnostic('SDK script loaded', false);
          this.status = 'PROVIDER_UNAVAILABLE';
          this.errorMessage = 'Failed to load Spotify Web Playback SDK. Please check your network connection.';
          this.notifyListeners();
          safeResolve(false);
        };
        document.head.appendChild(script);
      }

      // 4. Polling safeguard: check for window.Spotify.Player every 100ms up to 5s
      let checks = 0;
      const pollTimer = setInterval(() => {
        checks++;
        if (checkSdkReady()) {
          clearInterval(pollTimer);
        } else if (checks > 50) {
          clearInterval(pollTimer);
          if (!window.Spotify?.Player) {
            console.warn('[Spotify Playback Provider] SDK script load timed out after 5s.');
            safeResolve(false);
          }
        }
      }, 100);
    });

    return this.sdkLoadingPromise;
  }

  /**
   * Initializes the real Spotify Web Playback SDK instance.
   */
  public async initialize(): Promise<boolean> {
    if (this.initPromise) {
      return this.initPromise;
    }
    this.initPromise = this.doInitialize().finally(() => {
      this.initPromise = null;
    });
    return this.initPromise;
  }

  private async doInitialize(): Promise<boolean> {
    if (typeof window === 'undefined') {
      this.status = 'PROVIDER_UNAVAILABLE';
      return false;
    }

    // If player is already active and device is ready, keep it
    if (this.player && this.deviceId && (this.status === 'PLAYER_READY' || this.status === 'PLAYING' || this.status === 'PAUSED')) {
      return true;
    }

    this.status = 'INITIALIZING';
    this.errorMessage = null;
    this.notifyListeners();

    // 1. Verify token & premium status from authenticated session
    const token = await this.fetchFreshToken();
    if (!token) {
      this.logDiagnostic('Access token available', false);
      this.status = 'CONNECT_SPOTIFY';
      this.errorMessage = 'Connect Spotify to enable playback.';
      this.logMemberPlaybackLifecycle('initialize_no_token');
      this.notifyListeners();
      return false;
    }

    this.logDiagnostic('Access token available', true);

    // 2. Enforce Spotify account eligibility: Premium required
    if (!this.isPremium) {
      this.logDiagnostic('account_error message', 'Spotify Premium is required for Web Playback.');
      this.status = 'PREMIUM_REQUIRED';
      this.errorMessage = 'Spotify Premium is required for Web Playback SDK audio streaming.';
      this.logMemberPlaybackLifecycle('account_error_non_premium');
      this.notifyListeners();
      return false;
    }

    // 3. Load SDK script
    const loaded = await this.loadSDKScript();
    if (!loaded || !window.Spotify?.Player) {
      this.status = 'PROVIDER_UNAVAILABLE';
      this.errorMessage = 'Spotify Web Playback SDK is not supported or failed to load in this browser.';
      this.notifyListeners();
      return false;
    }

    // 4. Clean up previous player if exists
    if (this.player) {
      try { this.player.disconnect(); } catch {}
      this.player = null;
    }

    // 5. Create new Spotify.Player with non-hanging getOAuthToken
    try {
      this.player = new window.Spotify.Player({
        name: 'SyncRoom Web Player',
        getOAuthToken: (cb) => {
          this.fetchFreshToken().then((freshToken) => {
            if (freshToken) {
              this.logDiagnostic('Access token available', true);
              this.logMemberPlaybackLifecycle('token_refresh_success');
              cb(freshToken);
            } else {
              this.logDiagnostic('Access token available', false);
              this.logMemberPlaybackLifecycle('token_refresh_failed');
              cb(''); // Pass empty string to trigger auth error rather than hanging SDK
            }
          }).catch((err) => {
            this.logDiagnostic('Access token fetch error', (err as Error)?.message);
            this.logMemberPlaybackLifecycle('token_refresh_error');
            cb('');
          });
        },
        volume: this.volume,
      });
      this.logDiagnostic('Spotify.Player created', true);
      this.logMemberPlaybackLifecycle('player_created');
    } catch (err: unknown) {
      this.logDiagnostic('Spotify.Player created', false);
      this.status = 'PLAYBACK_ERROR';
      this.errorMessage = (err as Error)?.message || 'Failed to instantiate Spotify Player.';
      this.logMemberPlaybackLifecycle('player_creation_failed');
      this.notifyListeners();
      return false;
    }

    // 6. Register all official event listeners
    this.player.addListener('ready', async ({ device_id }) => {
      this.deviceId = device_id;
      this.status = 'PLAYER_READY';
      this.errorMessage = null;
      this.logDiagnostic('ready event received', true);
      this.logDiagnostic('device_id available', true);
      console.log(`[Spotify Playback Provider] Event: ready. Real device ready: ${device_id}`);
      this.logMemberPlaybackLifecycle('ready');
      this.notifyListeners();

      // Automatically transfer playback to this web player device so Spotify recognizes it
      try {
        await this.transferPlayback(device_id);
      } catch (err) {
        console.warn('[Spotify Playback Provider] Transfer playback notice:', err);
      }
    });

    this.player.addListener('not_ready', ({ device_id }) => {
      this.logDiagnostic('not_ready event received', true);
      console.warn(`[Spotify Playback Provider] Event: not_ready. Device went offline: ${device_id}`);
      if (this.deviceId === device_id) {
        this.deviceId = null;
      }
      this.status = 'DEVICE_NOT_READY';
      this.errorMessage = 'Spotify playback device went offline.';
      this.logMemberPlaybackLifecycle('not_ready');
      this.notifyListeners();
      this.scheduleReconnect();
    });

    this.player.addListener('player_state_changed', (state) => {
      this.lastState = state;
      this.lastStateMonotonicTime = performance.now();
      if (!state) return;

      console.log(
        `[MEMBER_PLAYBACK_STATE] track=${state.track_window?.current_track?.id || 'none'} position=${state.position} duration=${state.duration} paused=${state.paused} position_timestamp=${Date.now()}`
      );
      console.log(
        `[SYNC] event=local_spotify_state track=${state.track_window?.current_track?.id || 'none'} paused=${state.paused} posMs=${state.position}`
      );

      if (state.paused) {
        if (this.status === 'PLAYING') {
          this.status = 'PAUSED';
          this.logMemberPlaybackLifecycle('player_state_paused');
          this.notifyListeners();
        }
      } else {
        if (this.status !== 'PLAYING') {
          this.status = 'PLAYING';
          this.logMemberPlaybackLifecycle('player_state_playing');
          this.notifyListeners();
        }
      }
    });

    this.player.addListener('initialization_error', ({ message }) => {
      this.logDiagnostic('initialization_error message', message);
      console.error('[Spotify Playback Provider] Event: initialization_error:', message);
      this.status = 'PLAYBACK_ERROR';
      this.errorMessage = `Initialization failed: ${message}. Web Playback requires EME/DRM browser support.`;
      this.logMemberPlaybackLifecycle('initialization_error');
      this.notifyListeners();
    });

    this.player.addListener('authentication_error', ({ message }) => {
      this.logDiagnostic('authentication_error message', message);
      console.error('[Spotify Playback Provider] Event: authentication_error:', message);
      this.cachedToken = null;
      this.status = 'AUTH_REQUIRED';
      this.errorMessage = `Authentication failed: ${message}. Connect Spotify to enable playback.`;
      this.logMemberPlaybackLifecycle('authentication_error');
      this.notifyListeners();
    });

    this.player.addListener('account_error', ({ message }) => {
      this.logDiagnostic('account_error message', message);
      console.error('[Spotify Playback Provider] Event: account_error (Premium required):', message);
      this.status = 'PREMIUM_REQUIRED';
      this.errorMessage = 'Spotify Premium is required for Web Playback SDK audio streaming.';
      this.logMemberPlaybackLifecycle('account_error');
      this.notifyListeners();
    });

    this.player.addListener('playback_error', ({ message }) => {
      const msg = String(message || '');
      this.logDiagnostic('playback_error message', msg);
      console.error('[Spotify Playback Provider] Event: playback_error:', msg);
      if (/no list was loaded/i.test(msg)) {
        // Transient SDK error caused when seek or resume is invoked before Spotify's dealer buffers the audio
        // If we know the current track ID and aren't already playing, trigger a Web API load to recover smoothly
        if (this.currentTrackId && this.status !== 'PLAYING') {
          this.loadTrack(this.currentTrackId, this.getPosition()).catch(() => {});
        }
        return;
      }
      this.status = 'PLAYBACK_ERROR';
      this.errorMessage = `Playback error: ${msg}`;
      this.logMemberPlaybackLifecycle('playback_error');
      this.notifyListeners();
    });

    this.player.addListener('autoplay_failed', () => {
      this.logDiagnostic('autoplay_failed', true);
      console.warn('[Spotify Playback Provider] Event: autoplay_failed. Browser autoplay blocked.');
      this.status = 'AUTOPLAY_BLOCKED';
      this.errorMessage = 'Tap Enable Audio to start playback.';
      this.logMemberPlaybackLifecycle('autoplay_failed');
      this.notifyListeners();
    });

    // 7. Connect player to Spotify
    this.status = 'CONNECTING_PLAYER';
    this.notifyListeners();
    this.logMemberPlaybackLifecycle('player_connect_start');

    const connected = await this.player.connect();
    this.connectSucceeded = Boolean(connected);
    this.logDiagnostic('player.connect() result', connected);
    this.logMemberPlaybackLifecycle('player_connect_result');

    if (!connected) {
      this.status = 'PLAYBACK_ERROR';
      this.errorMessage = 'Failed to connect Spotify Web Player.';
      this.notifyListeners();
      return false;
    }

    // Safety timeout: If ready doesn't fire within 14 seconds, transition to DEVICE_NOT_READY
    setTimeout(() => {
      if (this.status === 'CONNECTING_PLAYER' && !this.deviceId) {
        console.warn('[Spotify Playback Provider] Device ready event wait timeout.');
        this.status = 'DEVICE_NOT_READY';
        this.errorMessage = 'Spotify web player device is connecting. Please wait a moment or click reconnect.';
        this.notifyListeners();
      }
    }, 14000);

    return true;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.deviceId && this.player) {
        console.log('[Spotify Playback Provider] Attempting to reconnect device...');
        try {
          await this.player.connect();
        } catch (err) {
          console.warn('[Spotify Playback Provider] Reconnect attempt failed:', err);
        }
      }
    }, 3000);
  }

  public canPlayTrack(track: Track): { canPlay: boolean; reason: string } {
    if (track.provider !== 'spotify') {
      return { canPlay: false, reason: 'Track is not a Spotify track.' };
    }

    if (track.restrictionReason) {
      return {
        canPlay: false,
        reason: `Track restricted by Spotify (${track.restrictionReason}).`,
      };
    }

    if (this.status === 'CONNECT_SPOTIFY' || this.status === 'AUTH_REQUIRED') {
      return {
        canPlay: false,
        reason: 'Please connect your Spotify account to enable playback.',
      };
    }

    if (this.status === 'PREMIUM_REQUIRED') {
      return {
        canPlay: false,
        reason: 'Spotify Premium is required for Web Playback SDK audio streaming.',
      };
    }

    if (!this.deviceId) {
      return {
        canPlay: false,
        reason: 'Spotify web player device is connecting. Please wait a moment.',
      };
    }

    return { canPlay: true, reason: '' };
  }

  public getCurrentTrackId(): string | null {
    return this.currentTrackId;
  }

  /**
   * Activates the Spotify Web Playback SDK audio element on genuine user interaction.
   * Resolves browser autoplay restrictions in Edge/Chrome/Firefox.
   */
  public async activateElement(): Promise<void> {
    if (this.player && typeof (this.player as any).activateElement === 'function') {
      try {
        await (this.player as any).activateElement();
        console.log('[Spotify Playback Provider] Audio element activated for browser autoplay.');
      } catch (err) {
        console.warn('[Spotify Playback Provider] activateElement notice:', err);
      }
    }
  }

  /**
   * Transfers active playback to the browser Web Playback SDK device.
   * Deduplicates concurrent and redundant transfer calls.
   */
  public async transferPlayback(deviceId: string, play: boolean = false): Promise<void> {
    console.log(`[SYNC] event=transfer_playback deviceId=${deviceId} play=${play}`);
    if (this.transferredDeviceId === deviceId && !play) {
      return;
    }

    if (this.transferPromise) {
      return this.transferPromise;
    }

    this.transferPromise = this.doTransferPlayback(deviceId, play).finally(() => {
      this.transferPromise = null;
    });

    return this.transferPromise;
  }

  private async doTransferPlayback(deviceId: string, play: boolean = false): Promise<void> {
    const token = await this.fetchFreshToken();
    if (!token) return;

    try {
      const res = await fetch('https://api.spotify.com/v1/me/player', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          device_ids: [deviceId],
          play: Boolean(play),
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok || res.status === 204) {
        this.transferredDeviceId = deviceId;
        return;
      }

      const baseUrl = getApiBaseUrl();
      const sessionId = this.getSessionId();
      const proxyRes = await fetch(`${baseUrl}/api/spotify/playback/transfer`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': sessionId,
        },
        body: JSON.stringify({ deviceId, play: Boolean(play), sessionId }),
        signal: AbortSignal.timeout(6000),
      });
      if (proxyRes.ok) {
        const data = await proxyRes.json().catch(() => ({}));
        if (data?.resolvedDeviceId && !this.deviceId) {
          this.deviceId = data.resolvedDeviceId;
        }
        this.transferredDeviceId = this.deviceId || data?.resolvedDeviceId || deviceId;
      }
    } catch (err) {
      console.warn('[Spotify Playback Provider] Transfer playback notice:', (err as Error)?.message);
    }
  }

  /**
   * Helper to wait for deviceId readiness when player is initializing or connecting.
   */
  public async waitForDevice(timeoutMs = 4000): Promise<boolean> {
    if (this.deviceId) return true;
    return new Promise((resolve) => {
      const start = Date.now();
      const interval = setInterval(() => {
        if (this.deviceId) {
          clearInterval(interval);
          resolve(true);
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(interval);
          resolve(Boolean(this.deviceId));
        }
      }, 100);
    });
  }

  /**
   * Loads and begins playback of a Spotify track at the given position.
   */
  public async loadTrack(trackOrId: Track | string, positionSeconds = 0): Promise<void> {
    if (!this.deviceId) {
      if (this.status === 'CONNECTING_PLAYER' || this.status === 'INITIALIZING') {
        const ready = await this.waitForDevice(4000);
        if (!ready || !this.deviceId) {
          throw new Error('Spotify web player device is connecting. Please wait a moment.');
        }
      } else {
        throw new Error('Spotify player device is not ready.');
      }
    }

    if (this.status === 'PLAYBACK_ERROR') {
      this.status = 'PLAYER_READY';
      this.errorMessage = null;
      this.notifyListeners();
    }

    // 1. Activate element on genuine user interaction to satisfy browser autoplay policy
    await this.activateElement();

    // 2. Ensure non-zero volume is applied to the Spotify player
    if (this.player) {
      const vol = this.volume > 0 ? this.volume : 0.8;
      this.player.setVolume(vol).catch(() => {});
    }

    const token = await this.fetchFreshToken();
    if (!token) {
      this.status = 'AUTH_REQUIRED';
      this.notifyListeners();
      throw new Error('Spotify authentication required.');
    }

    const trackId = typeof trackOrId === 'string' ? trackOrId : trackOrId.id;
    const providerTrackId = typeof trackOrId === 'string'
      ? trackOrId.replace(/^spotify-/, '')
      : trackOrId.providerTrackId || trackOrId.id.replace(/^spotify-/, '');

    const uri = `spotify:track:${providerTrackId}`;
    const positionMs = Math.max(0, Math.round(positionSeconds * 1000));

    console.log(`[SYNC] event=load_track trackId=${providerTrackId} targetPosSec=${positionSeconds.toFixed(2)} targetPosMs=${positionMs}`);

    // Log safe metadata only (NEVER secrets or tokens)
    console.log('[Spotify Playback Provider] Starting track playback:', {
      title: typeof trackOrId === 'object' ? trackOrId.title : undefined,
      artist: typeof trackOrId === 'object' ? trackOrId.artist : undefined,
      trackId: providerTrackId,
      uri,
      deviceId: this.deviceId,
      positionMs,
      volumePercent: this.getVolume(),
    });

    // 3. Ensure playback is transferred to this real device only if not already active
    if (this.transferredDeviceId !== this.deviceId) {
      await this.transferPlayback(this.deviceId, false);
      await new Promise((r) => setTimeout(r, 100));
    }

    const playUrl = `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(this.deviceId)}`;
    let success = false;
    let lastErrorReason = '';

    try {
      const res = await fetch(playUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uris: [uri],
          position_ms: positionMs,
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok || res.status === 204) {
        success = true;
        this.transferredDeviceId = this.deviceId;
      } else {
        const errText = await res.text();
        let parsed: any = null;
        try { parsed = JSON.parse(errText); } catch {}
        lastErrorReason = parsed?.error?.reason || parsed?.error?.message || errText;

        if (res.status === 403 && lastErrorReason.includes('PREMIUM_REQUIRED')) {
          this.status = 'PREMIUM_REQUIRED';
          this.errorMessage = 'Spotify Premium subscription is required for audio streaming.';
          this.notifyListeners();
          throw new Error(this.errorMessage);
        }
      }
    } catch (e: any) {
      if (this.status === 'PREMIUM_REQUIRED') {
        throw e;
      }
      lastErrorReason = e?.message || 'Network error connecting to Spotify API';
    }

    // 4. Fallback to backend proxy route if direct call was blocked
    if (!success) {
      try {
        const baseUrl = getApiBaseUrl();
        const sessionId = this.getSessionId();
        const proxyRes = await fetch(`${baseUrl}/api/spotify/playback/play`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'x-session-id': sessionId,
          },
          body: JSON.stringify({
            sessionId,
            deviceId: this.deviceId,
            uris: [uri],
            positionMs,
          }),
          signal: AbortSignal.timeout(6000),
        });

        if (proxyRes.ok) {
          const proxyData = await proxyRes.json().catch(() => ({}));
          if (proxyData?.resolvedDeviceId && !this.deviceId) {
            this.deviceId = proxyData.resolvedDeviceId;
          }
          this.transferredDeviceId = this.deviceId || proxyData?.resolvedDeviceId || null;
          success = true;
        } else {
          const proxyErr = await proxyRes.json().catch(() => ({}));
          const reason = proxyErr.error || lastErrorReason || 'Failed to start Spotify playback';
          if (reason.includes('PREMIUM_REQUIRED')) {
            this.status = 'PREMIUM_REQUIRED';
            this.errorMessage = 'Spotify Premium subscription is required for audio streaming.';
            this.notifyListeners();
            throw new Error(this.errorMessage);
          }
          throw new Error(reason);
        }
      } catch (err: any) {
        throw err;
      }
    }

    this.currentTrackId = trackId;
    this.status = 'PLAYING';
    this.errorMessage = null;
    this.notifyListeners();
  }

  public async play(): Promise<void> {
    console.log(`[SYNC] event=play_command track=${this.currentTrackId || 'none'}`);
    if (!this.player) throw new Error('Player not initialized');
    if (!this.deviceId) throw new Error('Spotify player device not ready');

    // 1. Activate element if available
    await this.activateElement();

    // 2. Ensure volume is applied
    const vol = this.volume > 0 ? this.volume : 0.8;
    this.player.setVolume(vol).catch(() => {});

    // 3. Clear transient error state if any
    if (this.status === 'PLAYBACK_ERROR') {
      this.status = 'PLAYER_READY';
      this.errorMessage = null;
      this.notifyListeners();
    }

    // 4. If track is already loaded in SDK player and is explicitly paused, resume local playback
    if (this.lastState?.track_window?.current_track && this.status === 'PAUSED') {
      try {
        await this.player.resume();
        this.status = 'PLAYING';
        this.notifyListeners();
        return;
      } catch (err: unknown) {
        console.warn('[Spotify Playback Provider] Resume error, falling back to Web API:', err);
      }
    }

    // 5. If current track ID is known, load it cleanly via Web API
    if (this.currentTrackId) {
      await this.loadTrack(this.currentTrackId, this.getPosition());
      return;
    }

    // 6. Fallback Web API play call via backend proxy
    const baseUrl = getApiBaseUrl();
    const sessionId = this.getSessionId();
    const proxyRes = await fetch(`${baseUrl}/api/spotify/playback/play`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': sessionId,
      },
      body: JSON.stringify({
        sessionId,
        deviceId: this.deviceId,
      }),
    });
    if (proxyRes.ok) {
      const data = await proxyRes.json().catch(() => ({}));
      if (data?.resolvedDeviceId) {
        this.deviceId = data.resolvedDeviceId;
      }
      this.status = 'PLAYING';
      this.notifyListeners();
      return;
    }
  }

  public pause(): void {
    console.log('[SYNC] event=pause_command');
    if (this.player) {
      this.player.pause().catch((err) => {
        console.warn('[Spotify Playback Provider] Pause error:', err);
      });
      this.status = 'PAUSED';
      this.notifyListeners();
    }
  }

  public seek(positionSeconds: number): void {
    if (this.player && this.lastState?.track_window?.current_track && this.status === 'PLAYING') {
      const positionMs = Math.max(0, Math.round(positionSeconds * 1000));
      this.lastState = {
        ...this.lastState,
        position: positionMs,
      };
      this.lastStateMonotonicTime = performance.now();
      console.log(`[SYNC] event=seek_command targetSec=${positionSeconds.toFixed(2)} targetMs=${positionMs}`);
      this.player.seek(positionMs).catch((err) => {
        console.warn('[Spotify Playback Provider] Seek error:', err);
      });
    }
  }

  public getPosition(): number {
    if (!this.lastState || typeof this.lastState.position !== 'number') {
      return 0;
    }
    const baseSeconds = this.lastState.position / 1000;
    if (this.lastState.paused || this.status !== 'PLAYING') {
      return baseSeconds;
    }
    // High-resolution monotonic extrapolation between player_state_changed events
    const elapsedSeconds = Math.max(0, (performance.now() - this.lastStateMonotonicTime) / 1000);
    const duration = this.getDuration();
    if (duration > 0) {
      return Math.min(baseSeconds + elapsedSeconds, duration);
    }
    return baseSeconds + elapsedSeconds;
  }

  public getDuration(): number {
    if (this.lastState && typeof this.lastState.duration === 'number') {
      return this.lastState.duration / 1000;
    }
    return 0;
  }

  public setVolume(volume0to100: number): void {
    const vol = Math.max(0, Math.min(100, volume0to100));
    this.volume = vol / 100;
    if (this.player) {
      this.player.setVolume(this.volume).catch(() => {});
    }
  }

  public getVolume(): number {
    return Math.round(this.volume * 100);
  }

  public destroy(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.player) {
      try { this.player.disconnect(); } catch {}
      this.player = null;
    }
    this.deviceId = null;
    this.connectSucceeded = false;
    this.status = 'INITIALIZING';
    this.statusListeners.clear();
  }
}

export const spotifyPlaybackProvider = new SpotifyPlaybackProvider();

// Register with PlaybackManager so SyncRoom automatically uses the official Spotify Web Player
playbackManager.setProvider(spotifyPlaybackProvider);

// Automatically re-initialize provider when Spotify OAuth finishes in popup
if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'OAUTH_AUTH_SUCCESS' && event.data?.provider === 'spotify') {
      spotifyPlaybackProvider.initialize().catch((err) => {
        console.warn('[Spotify Playback Provider] Auto-init after OAuth notice:', err);
      });
    }
  });

  // Auto-reconnect player when window regains focus or tab becomes visible (debounced to once per 5s)
  let lastFocusInit = 0;
  const safeFocusInit = () => {
    const now = Date.now();
    if (now - lastFocusInit < 5000) return;
    lastFocusInit = now;
    if (!spotifyPlaybackProvider.getDeviceId() || spotifyPlaybackProvider.getStatus() === 'DEVICE_NOT_READY') {
      spotifyPlaybackProvider.initialize().catch((err) => {
        console.warn('[Spotify Playback Provider] Focus auto-reconnect notice:', err);
      });
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') safeFocusInit();
  });

  window.addEventListener('focus', safeFocusInit);
}
