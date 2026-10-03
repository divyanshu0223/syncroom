import React from 'react';
import { Track, UserRole, PlayerState } from '../types';
import { ArtworkDisplay } from './ArtworkDisplay';
import { ProgressBar } from './ProgressBar';
import { AdminControls } from './AdminControls';
import { ListeningView } from './ListeningView';
import { AudioVisualizer } from './AudioVisualizer';
import { VolumeControl } from './VolumeControl';
import { Sparkles, Music, Radio, VolumeX, AlertCircle, ExternalLink, Loader2 } from 'lucide-react';
import { useSynchronizedPlayback } from '../hooks/useSynchronizedPlayback';
import { spotifyMusicProvider } from '../services/music/SpotifyMusicProvider';
import { youtubePlaybackProvider } from '../audio/YouTubePlaybackProvider';
import { playbackManager } from '../audio/PlaybackProvider';

interface MusicPlayerProps {
  track: Track | null;
  playerState: PlayerState;
  role: UserRole;
  adminName?: string;
  onPlayPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (position: number) => void;
  isShuffle?: boolean;
  onToggleShuffle?: () => void;
  repeatMode?: 'off' | 'all' | 'one';
  onToggleRepeat?: () => void;
  onOpenAddTrack?: () => void;
  onSwitchProvider?: (provider: 'spotify' | 'youtube') => void;
  className?: string;
}

export const MusicPlayer: React.FC<MusicPlayerProps> = ({
  track,
  playerState,
  role,
  adminName = 'Host',
  onPlayPause,
  onNext,
  onPrevious,
  onSeek,
  isShuffle,
  onToggleShuffle,
  repeatMode,
  onToggleRepeat,
  onOpenAddTrack,
  onSwitchProvider,
  className = '',
}) => {
  const isAdmin = role === 'admin';
  const [showVideo, setShowVideo] = React.useState(false);
  const attachedIframeRef = React.useRef<HTMLIFrameElement | null>(null);

  const handleIframeRef = React.useCallback((el: HTMLIFrameElement | null) => {
    if (el && attachedIframeRef.current !== el) {
      attachedIframeRef.current = el;
      youtubePlaybackProvider.attachIframe(el);
    }
  }, []);

  React.useEffect(() => {
    if (track?.provider === 'youtube') {
      if (playbackManager.getProvider().id !== 'youtube') {
        playbackManager.setProvider(youtubePlaybackProvider);
      }
      if (youtubePlaybackProvider.getCurrentTrackId() !== track.id) {
        youtubePlaybackProvider.loadTrack(track, playerState.position || 0, playerState.isPlaying);
      }
    }
  }, [track?.provider, track?.id, playerState.isPlaying]);
  const {
    isUnlocked,
    enableAudio,
    syncStatus,
    setVolume,
    volume,
    currentTime,
    providerStatus,
    providerError,
  } = useSynchronizedPlayback();

  const handlePlayPause = () => {
    if (track?.provider === 'youtube') {
      youtubePlaybackProvider.unMute();
      youtubePlaybackProvider.setVolume(100);
      setVolume(100);
      enableAudio();
    }
    onPlayPause();
  };

  const handleConnectSpotify = async () => {
    try {
      const auth = await spotifyMusicProvider.getAuthUrl();
      if (auth.url) {
        window.open(auth.url, 'spotify_oauth', 'width=600,height=720,status=no,toolbar=no,menubar=no');
      }
    } catch (err) {
      console.error('Failed to open Spotify OAuth', err);
    }
  };

  if (!track) {
    return (
      <div
        className={`flex flex-col items-center justify-center p-8 rounded-3xl bg-neutral-900/40 border border-neutral-800/80 min-h-[480px] text-center ${className}`}
      >
        <div className="w-16 h-16 rounded-2xl bg-neutral-800/60 border border-neutral-700/60 flex items-center justify-center text-neutral-400 mb-4">
          <Music className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-semibold text-neutral-200 mb-1">Queue is empty</h3>
        <p className="text-sm text-neutral-400 max-w-sm mb-6">
          Add tracks to the room queue to begin synchronized playback across all connected devices.
        </p>
        {isAdmin && onOpenAddTrack && (
          <button
            type="button"
            onClick={onOpenAddTrack}
            className="px-4 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-neutral-950 font-medium text-sm transition-all"
          >
            Add First Track
          </button>
        )}
      </div>
    );
  }

  // Display position smoothly from local audio or authoritative playerState
  const displayPosition =
    isUnlocked && playerState.isPlaying && currentTime > 0
      ? currentTime
      : playerState.position;

  return (
    <div
      className={`flex flex-col items-center justify-between w-full max-w-xl mx-auto px-3.5 sm:px-6 py-4 sm:py-6 rounded-3xl bg-neutral-900/40 border border-neutral-800/80 backdrop-blur-xl shadow-2xl relative overflow-hidden ${className}`}
    >
      {/* Ambient background glow matching current track accent */}
      <div
        className="absolute -top-32 left-1/2 -translate-x-1/2 w-80 h-80 rounded-full blur-[100px] opacity-15 pointer-events-none transition-colors duration-1000"
        style={{ backgroundColor: track.coverGradient?.accent || '#f59e0b' }}
      />

      {/* Autoplay restriction prompt for all listeners */}
      {(!isUnlocked || providerStatus === 'AUTOPLAY_BLOCKED') && (
        <div className="w-full mb-3 z-20">
          <button
            type="button"
            onClick={enableAudio}
            className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-200 transition-all text-xs group"
          >
            <div className="flex items-center gap-2">
              <VolumeX className="w-4 h-4 text-amber-400 animate-pulse shrink-0" />
              <span className="font-semibold">Tap to Enable Audio</span>
            </div>
            <span className="text-[11px] font-mono underline decoration-amber-400/50 group-hover:decoration-amber-300">
              Enable audio
            </span>
          </button>
        </div>
      )}

      {/* Dynamic Playback Provider Status Banners for Spotify Tracks */}
      {track.provider === 'spotify' && (
        <>
          {(providerStatus === 'CONNECT_SPOTIFY' || providerStatus === 'AUTH_REQUIRED') && (
            <div className="w-full mb-3 z-20 p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-xs flex items-center justify-between shadow-lg">
              <div className="flex items-center gap-2.5 min-w-0">
                <Radio className="w-4 h-4 text-emerald-400 shrink-0 animate-pulse" />
                <div className="flex flex-col text-left">
                  <span className="font-semibold text-emerald-100">Connect Spotify to enable audio</span>
                  <span className="text-[11px] text-emerald-300/80">Connect your Spotify Premium account so this device can stream synchronized audio.</span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleConnectSpotify}
                className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-semibold text-xs transition-colors shrink-0 ml-3"
              >
                Connect Spotify
              </button>
            </div>
          )}

          {providerStatus === 'PREMIUM_REQUIRED' && (
            <div className="w-full mb-3 z-20 p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs flex items-center justify-between shadow-lg">
              <div className="flex items-center gap-2.5 min-w-0">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <div className="flex flex-col text-left">
                  <span className="font-semibold text-rose-100">Spotify Premium Required</span>
                  <span className="text-[11px] text-rose-300/80">
                    The official Spotify Web Playback SDK requires an active Spotify Premium subscription.
                  </span>
                </div>
              </div>
              <a
                href="https://www.spotify.com/premium"
                target="_blank"
                rel="noreferrer noopener"
                className="px-3 py-1.5 rounded-lg bg-rose-500 hover:bg-rose-400 text-neutral-950 font-semibold text-xs transition-colors shrink-0 ml-3 flex items-center gap-1"
              >
                <span>Upgrade</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}

          {(providerStatus === 'CONNECTING_PLAYER' || providerStatus === 'INITIALIZING') && (
            <div className="w-full mb-3 z-20 p-2.5 rounded-xl bg-neutral-800/60 border border-neutral-700/60 text-neutral-300 text-xs flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin shrink-0" />
                <span className="truncate">Connecting Spotify Web Player device...</span>
              </div>
              <span className="text-[11px] text-neutral-500 font-mono">Initializing</span>
            </div>
          )}

          {providerStatus === 'DEVICE_NOT_READY' && (
            <div className="w-full mb-3 z-20 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-200 text-xs flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="truncate">Spotify player device offline. Reconnecting...</span>
              </div>
            </div>
          )}

          {providerStatus === 'AUTOPLAY_BLOCKED' && (
            <div className="w-full mb-3 z-20 p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-200 text-xs flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <VolumeX className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="truncate">Browser audio blocked. Tap Enable Audio to start playback.</span>
              </div>
              <button
                type="button"
                onClick={enableAudio}
                className="px-2.5 py-1 rounded-md bg-amber-400 hover:bg-amber-300 text-neutral-950 font-semibold text-[11px] shrink-0 ml-2"
              >
                Tap to Enable Audio
              </button>
            </div>
          )}

          {providerStatus === 'PLAYBACK_ERROR' && (
            <div className="w-full mb-3 z-20 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span className="truncate">{providerError || 'Spotify playback error occurred.'}</span>
              </div>
              {isAdmin && (
                <button
                  type="button"
                  onClick={onPlayPause}
                  className="px-2.5 py-1 rounded-md bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 font-medium text-[11px] shrink-0 ml-2 transition-colors"
                >
                  Retry
                </button>
              )}
            </div>
          )}

          {providerStatus === 'PROVIDER_UNAVAILABLE' && (
            <div className="w-full mb-3 z-20 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-200 text-xs flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="truncate">Audio playback provider is not configured.</span>
              </div>
              {track.externalUrl && (
                <a
                  href={track.externalUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-amber-400 hover:text-amber-300 font-semibold flex items-center gap-1 shrink-0 ml-2"
                >
                  <span>Spotify</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          )}

          {(providerStatus === 'PLAYER_READY' || providerStatus === 'PLAYING' || providerStatus === 'PAUSED') && (
            <div className="w-full mb-3 z-20 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="font-medium">Playing via Spotify Web Player</span>
              </div>
              <span className="font-mono text-emerald-400/80 uppercase text-[10px]">
                {providerStatus === 'PLAYING' ? 'Streaming Audio' : providerStatus}
              </span>
            </div>
          )}
        </>
      )}

      {/* Dynamic Playback Provider Status Banners for YouTube Tracks */}
      {track.provider === 'youtube' && (
        <div className="w-full mb-3 z-20 px-3 py-1.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-[11px] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="font-medium">Playing YouTube Audio</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                try {
                  youtubePlaybackProvider.unMute();
                  youtubePlaybackProvider.setVolume(100);
                  setVolume(100);
                  await youtubePlaybackProvider.play();
                  await enableAudio();
                } catch (e) {
                  console.warn('Unmute error:', e);
                }
              }}
              className="px-2.5 py-1 rounded-md bg-red-500 hover:bg-red-600 text-white font-semibold text-xs shadow-md transition-all flex items-center gap-1.5 cursor-pointer animate-pulse"
              title="Click to unmute and enable audio"
            >
              <span>🔊 Unmute Audio</span>
            </button>
            <button
              type="button"
              onClick={() => setShowVideo((prev) => !prev)}
              className="px-2 py-1 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white font-medium text-[11px] transition-all flex items-center gap-1"
              title={showVideo ? 'Switch to vinyl audio view' : 'Show YouTube video player'}
            >
              <span>{showVideo ? '🎵 Vinyl View' : '👁️ Video'}</span>
            </button>
            <span className="font-mono text-red-400/80 uppercase text-[10px] hidden sm:inline">
              {playerState.isPlaying ? 'Official Player Active' : 'Ready'}
            </span>
          </div>
        </div>
      )}

      {track.provider === 'youtube' && providerStatus === 'AUTOPLAY_BLOCKED' && (
        <div className="w-full mb-3 z-20 p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-200 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <VolumeX className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="truncate">Browser audio blocked. Tap Enable Audio to start playback.</span>
          </div>
          <button
            type="button"
            onClick={enableAudio}
            className="px-2.5 py-1 rounded-md bg-amber-400 hover:bg-amber-300 text-neutral-950 font-semibold text-[11px] shrink-0 ml-2"
          >
            Tap to Enable Audio
          </button>
        </div>
      )}

      {track.provider === 'youtube' && providerStatus === 'PLAYBACK_ERROR' && (
        <div className="w-full mb-3 z-20 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="truncate">{providerError || 'YouTube playback is unavailable for this video.'}</span>
          </div>
          {track.externalUrl && (
            <a
              href={track.externalUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-rose-400 hover:text-rose-300 font-semibold flex items-center gap-1 shrink-0 ml-2 text-[11px]"
            >
              <span>Open on YouTube</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}
      {track.playbackStatus === 'PROVIDER_RESTRICTED' && (
        <div className="w-full mb-3 z-20 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="truncate">Restricted by Spotify ({track.restrictionReason || 'restriction'})</span>
          </div>
          {track.externalUrl && (
            <a
              href={track.externalUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-rose-400 hover:text-rose-300 font-semibold flex items-center gap-1 shrink-0 ml-2"
            >
              <span>Spotify</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}

      {/* Track Category / Live Audio Visualizer Bar */}
      <div className="w-full flex items-center justify-between mb-4 z-10">
        <div className="flex items-center gap-2 text-xs text-neutral-400">
          <span className="flex items-center gap-1 text-amber-400/90 font-medium">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Now Playing</span>
          </span>
          <span className="text-neutral-700" aria-hidden="true">·</span>
          <span>{track.genre || 'Synchronized Room Audio'}</span>
        </div>

        <div className="flex items-center gap-3">
          {isUnlocked && (
            <div
              className="hidden sm:flex items-center gap-1.5 text-[11px] font-mono text-neutral-400"
              title={`Clock drift: ${syncStatus.driftMs > 0 ? '+' : ''}${syncStatus.driftMs}ms | Latency: ${syncStatus.rttMs}ms RTT`}
            >
              <Radio className="w-3 h-3 text-emerald-400" />
              <span>Sync: {syncStatus.driftMs > 0 ? '+' : ''}${syncStatus.driftMs}ms</span>
            </div>
          )}
          <AudioVisualizer isPlaying={playerState.isPlaying} />
        </div>
      </div>

      {/* Provider Selector: [ Spotify ] [ YouTube ] */}
      <div className="w-full flex items-center justify-between mb-3 z-20 px-1">
        <div className="flex items-center gap-1.5 text-xs text-neutral-400">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-neutral-500">Provider:</span>
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold ${
              track.provider === 'youtube'
                ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                : 'bg-[#1db954]/20 text-[#1ed760] border border-[#1db954]/30'
            }`}
          >
            {track.provider === 'youtube' ? 'YouTube' : 'Spotify'}
          </span>
        </div>

        {isAdmin && onSwitchProvider && (
          <div className="inline-flex items-center p-0.5 rounded-lg bg-neutral-950/80 border border-neutral-800 shadow-inner">
            <button
              type="button"
              onClick={() => onSwitchProvider('spotify')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                track.provider === 'spotify'
                  ? 'bg-[#1db954] text-neutral-950 shadow-sm'
                  : 'text-neutral-400 hover:text-white'
              }`}
              title="Play using Spotify"
            >
              <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
              </svg>
              <span>Spotify</span>
            </button>
            <button
              type="button"
              onClick={() => onSwitchProvider('youtube')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                track.provider === 'youtube'
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'text-neutral-400 hover:text-white'
              }`}
              title="Play using YouTube"
            >
              <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
              </svg>
              <span>YouTube</span>
            </button>
          </div>
        )}
      </div>

      {/* YouTube Audio/Video Engine */}
      {track.provider === 'youtube' && (track.youtubeVideoId || track.providerTrackId) && (
        <div
          className={
            showVideo
              ? 'my-2 sm:my-4 w-full max-w-[480px] aspect-video rounded-2xl overflow-hidden shadow-2xl border border-neutral-800 z-10 mx-auto'
              : 'overflow-hidden rounded-lg'
          }
          style={
            showVideo
              ? undefined
              : {
                  position: 'fixed',
                  bottom: '12px',
                  right: '12px',
                  width: '240px',
                  height: '135px',
                  opacity: 0.02,
                  pointerEvents: 'auto',
                  zIndex: 1,
                }
          }
          aria-hidden={!showVideo}
        >
          <iframe
            id="syncroom-youtube-iframe"
            src={`https://www.youtube.com/embed/${track.youtubeVideoId || track.providerTrackId}?enablejsapi=1&autoplay=1&playsinline=1&controls=1&rel=0&modestbranding=1${typeof window !== 'undefined' && window.location.origin ? `&origin=${window.location.origin}` : ''}`}
            title={track.title}
            style={{ width: '100%', height: '100%', border: 0 }}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            ref={handleIframeRef}
          />
        </div>
      )}

      {/* Large Music Artwork (Vinyl record + Album art - Pure Music Experience) */}
      {!showVideo && (
        <div className="my-2 sm:my-4 w-full flex justify-center z-10">
          <ArtworkDisplay
            track={track}
            isPlaying={playerState.isPlaying}
            size="lg"
            showVinylPeek={true}
          />
        </div>
      )}

      {/* Song title & Artist info */}
      <div className="w-full text-center my-2 sm:my-4 z-10 px-2">
        <h2 className="text-lg sm:text-2xl font-bold tracking-tight text-white font-display truncate">
          {track.title}
        </h2>
        <p className="text-xs sm:text-base text-neutral-400 mt-0.5 sm:mt-1 font-medium truncate">
          {track.artist}
        </p>
      </div>

      {/* Progress Bar (Interactive seek for Admin, Read-only progress for Listener) */}
      <div className="w-full z-10 mt-2 mb-4">
        <ProgressBar
          position={displayPosition}
          duration={track.duration}
          onSeek={onSeek}
          isAdmin={isAdmin}
        />
      </div>

      {/* Role-Specific Controls */}
      <div className="w-full z-10 mt-2">
        {isAdmin ? (
          /* Admin Controls */
          <div className="flex flex-col gap-4">
            <AdminControls
              isPlaying={playerState.isPlaying}
              isConnecting={track.provider === 'spotify' && (providerStatus === 'CONNECTING_PLAYER' || providerStatus === 'INITIALIZING')}
              onPlayPause={handlePlayPause}
              onNext={onNext}
              onPrevious={onPrevious}
              isShuffle={isShuffle}
              onToggleShuffle={onToggleShuffle}
              repeatMode={repeatMode}
              onToggleRepeat={onToggleRepeat}
            />

            {/* Local device volume & quick queue action */}
            <div className="flex items-center justify-between pt-3 border-t border-neutral-800/70 text-xs">
              <VolumeControl initialVolume={volume} onVolumeChange={setVolume} />

              {onOpenAddTrack && (
                <button
                  type="button"
                  onClick={onOpenAddTrack}
                  className="text-xs text-neutral-400 hover:text-amber-300 font-medium transition-colors flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-neutral-800/50"
                >
                  <span>+ Add to Queue</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          /* Listener View (Personal audio controls, listening status) */
          <ListeningView
            adminName={adminName}
            isUnlocked={isUnlocked}
            onEnableAudio={enableAudio}
            volume={volume}
            onVolumeChange={setVolume}
            syncOffsetMs={syncStatus.clockOffsetMs}
          />
        )}
      </div>
    </div>
  );
};
