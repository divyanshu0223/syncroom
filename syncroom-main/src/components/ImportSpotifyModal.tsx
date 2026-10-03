import React, { useState, useEffect } from 'react';
import { Track, Playlist, UserPlaylistSummary } from '../types';
import { spotifyMusicProvider } from '../services/music/SpotifyMusicProvider';
import { parseSpotifyPlaylistId } from '../services/music/MusicProvider';
import { useToast } from '../context/ToastContext';
import {
  X,
  Music,
  ExternalLink,
  AlertCircle,
  Loader2,
  ListPlus,
  LogIn,
  LogOut,
  FolderHeart,
  Link as LinkIcon,
  UserCheck,
  Users,
} from 'lucide-react';

interface ImportSpotifyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportTracks: (tracks: Track[], replaceQueue: boolean) => void;
}

export const ImportSpotifyModal: React.FC<ImportSpotifyModalProps> = ({
  isOpen,
  onClose,
  onImportTracks,
}) => {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'my-playlists' | 'url'>('my-playlists');
  const [playlistInput, setPlaylistInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingPlaylists, setIsLoadingPlaylists] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewPlaylist, setPreviewPlaylist] = useState<Playlist | null>(null);
  const [replaceQueue, setReplaceQueue] = useState(false);
  const [myPlaylists, setMyPlaylists] = useState<UserPlaylistSummary[]>([]);

  // Spotify Auth status
  const [authStatus, setAuthStatus] = useState<{
    configured: boolean;
    connected: boolean;
    user?: { id: string; displayName: string; email?: string; imageUrl?: string } | null;
    redirectUri?: string;
  }>({
    configured: false,
    connected: false,
  });

  const loadUserPlaylists = async () => {
    setIsLoadingPlaylists(true);
    try {
      const lists = await spotifyMusicProvider.getMyPlaylists();
      setMyPlaylists(lists);
    } catch {
      setMyPlaylists([]);
    } finally {
      setIsLoadingPlaylists(false);
    }
  };

  const checkStatus = async () => {
    try {
      const status = await spotifyMusicProvider.getStatus();
      setAuthStatus(status);
      if (status.connected) {
        loadUserPlaylists();
      } else {
        setMyPlaylists([]);
      }
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    if (isOpen) {
      checkStatus();
    } else {
      setErrorMessage(null);
      setPreviewPlaylist(null);
      setPlaylistInput('');
    }
  }, [isOpen]);

  // Listen for OAuth messages from the popup
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        checkStatus();
        showToast({
          type: 'success',
          title: 'Spotify Connected',
          description: 'Your Spotify account has been successfully linked.',
        });
      } else if (event.data?.type === 'OAUTH_AUTH_ERROR') {
        const err = event.data?.error || 'Spotify authorization was denied or failed.';
        setErrorMessage(`Spotify authorization failed: ${err}`);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [showToast]);

  if (!isOpen) return null;

  const handleConnectSpotify = async () => {
    setErrorMessage(null);
    try {
      const auth = await spotifyMusicProvider.getAuthUrl();
      if (!auth.configured || !auth.url) {
        setErrorMessage(
          auth.message ||
            'Spotify credentials are not configured in environment variables. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.',
        );
        return;
      }

      const popup = window.open(
        auth.url,
        'spotify_oauth',
        'width=600,height=720,status=no,toolbar=no,menubar=no',
      );

      if (!popup) {
        setErrorMessage('Popup blocked. Please allow popups for this site to connect Spotify.');
      }
    } catch (err: unknown) {
      setErrorMessage((err as Error)?.message || 'Failed to initiate Spotify login');
    }
  };

  const handleDisconnectSpotify = async () => {
    await spotifyMusicProvider.logout();
    await checkStatus();
    setPreviewPlaylist(null);
    showToast({
      type: 'info',
      title: 'Spotify Disconnected',
      description: 'Your Spotify account has been disconnected.',
    });
  };

  const handleFetchPlaylist = async (urlOrId: string) => {
    setErrorMessage(null);
    const parsed = parseSpotifyPlaylistId(urlOrId);

    if (!parsed.playlistId) {
      setErrorMessage('Invalid Spotify playlist format.');
      return;
    }

    setIsLoading(true);
    try {
      const playlist = await spotifyMusicProvider.getPlaylist(parsed.playlistId);

      // Section 2: Explicitly distinguish states
      if (playlist.importStatus === 'PLAYLIST_ACTUALLY_EMPTY' || (playlist.totalTracks === 0 && playlist.tracks.length === 0)) {
        setErrorMessage('This Spotify playlist is empty.');
        setPreviewPlaylist(null);
        return;
      }

      if (playlist.importStatus === 'PLAYLIST_ITEMS_UNAVAILABLE' || (!playlist.tracks || playlist.tracks.length === 0)) {
        setErrorMessage(
          'This playlist is visible on Spotify, but Spotify does not provide its track list to this account. Import a playlist you own or collaborate on.'
        );
        setPreviewPlaylist(null);
        return;
      }

      setPreviewPlaylist(playlist);
    } catch (err: any) {
      if (err.status === 'PLAYLIST_NOT_FOUND') {
        setErrorMessage('Spotify playlist not found.');
      } else if (err.status === 'SPOTIFY_AUTH_REQUIRED') {
        setErrorMessage('Connect Spotify to import this playlist.');
      } else if (err.status === 'PLAYLIST_ITEMS_UNAVAILABLE') {
        setErrorMessage(
          'This playlist is visible on Spotify, but Spotify does not provide its track list to this account. Import a playlist you own or collaborate on.'
        );
      } else if (err.status === 'PLAYLIST_ACTUALLY_EMPTY') {
        setErrorMessage('This Spotify playlist is empty.');
      } else {
        setErrorMessage(err.message || 'Spotify could not provide the playlist contents right now.');
      }
      setPreviewPlaylist(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!playlistInput.trim()) {
      setErrorMessage('Invalid Spotify playlist.');
      return;
    }
    handleFetchPlaylist(playlistInput);
  };

  const handleConfirmImport = () => {
    if (!previewPlaylist || previewPlaylist.tracks.length === 0) return;

    onImportTracks(previewPlaylist.tracks, replaceQueue);

    showToast({
      type: 'success',
      title: 'Playlist Imported',
      description: `Imported ${previewPlaylist.tracks.length} tracks.`,
    });
    onClose();
  };

  const formatTotalTime = (tracks: Track[]): string => {
    const totalSecs = tracks.reduce((sum, t) => sum + t.duration, 0);
    const mins = Math.floor(totalSecs / 60);
    const hours = Math.floor(mins / 60);
    if (hours > 0) {
      return `${hours} hr ${mins % 60} min`;
    }
    return `${mins} min`;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="spotify-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-xl rounded-2xl bg-neutral-900 border border-neutral-800 shadow-2xl p-5 sm:p-6 flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-neutral-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#1db954]/15 border border-[#1db954]/30 flex items-center justify-center text-[#1db954]">
              {/* Spotify SVG icon */}
              <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
              </svg>
            </div>
            <div>
              <h3 id="spotify-modal-title" className="font-display font-bold text-base sm:text-lg text-white">
                Import from Spotify
              </h3>
              <p className="text-xs text-neutral-400">
                Sync real Spotify playlists into the SyncRoom queue
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="min-w-[36px] min-h-[36px] p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 flex items-center justify-center transition-colors touch-manipulation"
            aria-label="Close Spotify import modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto py-4 space-y-4 pr-1">
          {/* Connection status card */}
          <div className="p-3.5 rounded-xl bg-neutral-950/70 border border-neutral-800 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2.5 min-w-0">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  authStatus.connected ? 'bg-[#1db954]' : 'bg-neutral-600'
                }`}
              />
              <div className="min-w-0">
                <p className="font-medium text-neutral-200 truncate">
                  {authStatus.connected
                    ? `Connected as ${authStatus.user?.displayName || 'Spotify User'}`
                    : 'Spotify Account Not Linked'}
                </p>
                <p className="text-[11px] text-neutral-400">
                  {authStatus.connected
                    ? 'Authorized for your personal & collaborative playlists'
                    : 'Connect account to import private or collaborative playlists'}
                </p>
              </div>
            </div>

            {authStatus.connected ? (
              <button
                type="button"
                onClick={handleDisconnectSpotify}
                className="px-2.5 py-1 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors flex items-center gap-1 shrink-0 font-medium"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Disconnect</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleConnectSpotify}
                className="px-3 py-1.5 rounded-lg bg-[#1db954] hover:bg-[#1ed760] text-neutral-950 font-semibold transition-colors flex items-center gap-1.5 shrink-0"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Connect Spotify</span>
              </button>
            )}
          </div>

          {/* Navigation Tabs: My Spotify Playlists vs Paste URL (Section 9) */}
          <div className="flex border-b border-neutral-800 text-xs">
            <button
              type="button"
              onClick={() => {
                setActiveTab('my-playlists');
                setErrorMessage(null);
              }}
              className={`flex items-center gap-2 py-2 px-3 font-medium transition-colors border-b-2 -mb-px ${
                activeTab === 'my-playlists'
                  ? 'border-[#1db954] text-[#1db954]'
                  : 'border-transparent text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <FolderHeart className="w-3.5 h-3.5" />
              <span>My Spotify Playlists</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('url');
                setErrorMessage(null);
              }}
              className={`flex items-center gap-2 py-2 px-3 font-medium transition-colors border-b-2 -mb-px ${
                activeTab === 'url'
                  ? 'border-[#1db954] text-[#1db954]'
                  : 'border-transparent text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <LinkIcon className="w-3.5 h-3.5" />
              <span>Paste Playlist URL</span>
            </button>
          </div>

          {/* Error banner */}
          {errorMessage && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs flex items-start gap-2 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Tab 1: My Spotify Playlists */}
          {activeTab === 'my-playlists' && (
            <div className="space-y-3">
              {!authStatus.connected ? (
                <div className="p-6 rounded-xl bg-neutral-950/60 border border-neutral-800 text-center space-y-3">
                  <FolderHeart className="w-8 h-8 text-neutral-500 mx-auto" />
                  <p className="text-sm font-semibold text-neutral-200">
                    Connect your account to access your Spotify playlists
                  </p>
                  <p className="text-xs text-neutral-400 max-w-sm mx-auto">
                    View and select playlists you own or collaborate on directly without copying URLs.
                  </p>
                  <button
                    type="button"
                    onClick={handleConnectSpotify}
                    className="px-4 py-2 rounded-xl bg-[#1db954] hover:bg-[#1ed760] text-neutral-950 font-semibold text-xs transition-colors inline-flex items-center gap-1.5"
                  >
                    <LogIn className="w-4 h-4" />
                    <span>Connect Spotify</span>
                  </button>
                </div>
              ) : isLoadingPlaylists ? (
                <div className="p-8 text-center text-neutral-400 space-y-2">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-[#1db954]" />
                  <p className="text-xs">Loading your Spotify playlists...</p>
                </div>
              ) : myPlaylists.length === 0 ? (
                <div className="p-6 rounded-xl bg-neutral-950/60 border border-neutral-800 text-center text-neutral-400 text-xs">
                  No playlists found in your Spotify account.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-64 overflow-y-auto pr-1">
                  {myPlaylists.map((pl) => (
                    <div
                      key={pl.id}
                      onClick={() => handleFetchPlaylist(pl.id)}
                      className="cursor-pointer group p-2.5 rounded-xl bg-neutral-950/60 hover:bg-neutral-800/60 border border-neutral-800/80 hover:border-[#1db954]/40 transition-all flex items-center justify-between gap-2.5"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {pl.imageUrl ? (
                          <img
                            src={pl.imageUrl}
                            alt={pl.name}
                            className="w-11 h-11 rounded-lg object-cover shrink-0 border border-neutral-800"
                          />
                        ) : (
                          <div className="w-11 h-11 rounded-lg bg-neutral-800 flex items-center justify-center shrink-0">
                            <Music className="w-5 h-5 text-neutral-400" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-neutral-200 group-hover:text-white truncate">
                            {pl.name}
                          </p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {pl.isOwner ? (
                              <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-0.5">
                                <UserCheck className="w-2.5 h-2.5" />
                                <span>Owner</span>
                              </span>
                            ) : pl.collaborative ? (
                              <span className="text-[9px] px-1 py-0.2 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center gap-0.5">
                                <Users className="w-2.5 h-2.5" />
                                <span>Collab</span>
                              </span>
                            ) : (
                              <span className="text-[9px] text-neutral-500">by {pl.ownerName}</span>
                            )}
                            <span className="text-[10px] text-neutral-400">· {pl.totalTracks || 0} tracks</span>
                          </div>
                        </div>
                      </div>
                      <span className="text-[11px] text-[#1db954] font-medium group-hover:underline shrink-0 pr-1">
                        Select →
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Paste URL */}
          {activeTab === 'url' && (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label
                  htmlFor="spotify-playlist-url"
                  className="block text-xs font-medium text-neutral-300 mb-1.5"
                >
                  Spotify Playlist Link or URI
                </label>
                <div className="flex gap-2">
                  <input
                    id="spotify-playlist-url"
                    type="text"
                    placeholder="https://open.spotify.com/playlist/... or spotify:playlist:..."
                    value={playlistInput}
                    onChange={(e) => {
                      setPlaylistInput(e.target.value);
                      if (errorMessage) setErrorMessage(null);
                    }}
                    className="flex-1 bg-neutral-950/90 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-[#1db954] transition-colors"
                  />
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="px-4 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-neutral-950 font-semibold text-xs sm:text-sm transition-all flex items-center gap-1.5 shrink-0"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Fetching...</span>
                      </>
                    ) : (
                      <span>Import Playlist</span>
                    )}
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* Playlist Preview Card (If loaded) */}
          {previewPlaylist && (
            <div className="rounded-xl bg-neutral-950/80 border border-[#1db954]/40 p-4 space-y-3 animate-in fade-in">
              <div className="flex items-start gap-3.5">
                {previewPlaylist.imageUrl ? (
                  <img
                    src={previewPlaylist.imageUrl}
                    alt={previewPlaylist.name}
                    className="w-16 h-16 rounded-lg object-cover border border-neutral-800 shrink-0"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-lg bg-neutral-800 flex items-center justify-center text-neutral-400 shrink-0">
                    <Music className="w-6 h-6" />
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#1db954]/20 text-[#1db954] border border-[#1db954]/30 uppercase tracking-wider">
                      Spotify Playlist
                    </span>
                    <span className="text-xs text-neutral-400">by {previewPlaylist.ownerName}</span>
                  </div>
                  <h4 className="font-display font-bold text-base text-white truncate mt-1">
                    {previewPlaylist.name}
                  </h4>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    {previewPlaylist.tracks.length} tracks · {formatTotalTime(previewPlaylist.tracks)}
                  </p>
                </div>
              </div>

              {/* Tracks preview table */}
              <div className="max-h-48 overflow-y-auto rounded-lg border border-neutral-800/80 bg-neutral-900/60 divide-y divide-neutral-800/60 text-xs">
                {previewPlaylist.tracks.slice(0, 20).map((track, idx) => (
                  <div key={track.id} className="p-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-neutral-500 font-mono w-4 text-center">{idx + 1}</span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-neutral-200 font-medium truncate">{track.title}</p>
                          {track.restrictionReason && (
                            <span className="px-1 py-0.2 rounded text-[9px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30 uppercase tracking-tight shrink-0">
                              Restricted: {track.restrictionReason}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-neutral-400 truncate">
                          {track.artist} · <span className="text-neutral-500">{track.album}</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {track.externalUrl && (
                        <a
                          href={track.externalUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-neutral-500 hover:text-[#1db954] transition-colors p-1"
                          title="Open on Spotify"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      <span className="text-neutral-400 font-mono tabular-nums text-[11px]">
                        {Math.floor(track.duration / 60)}:
                        {String(track.duration % 60).padStart(2, '0')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Replace vs Append Option */}
              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 text-xs text-neutral-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={replaceQueue}
                    onChange={(e) => setReplaceQueue(e.target.checked)}
                    className="rounded border-neutral-700 bg-neutral-800 text-amber-400 focus:ring-0"
                  />
                  <span>Replace current queue completely</span>
                </label>

                <button
                  type="button"
                  onClick={handleConfirmImport}
                  className="px-4 py-2 rounded-xl bg-[#1db954] hover:bg-[#1ed760] text-neutral-950 font-bold text-xs flex items-center gap-1.5 transition-colors shadow-lg shadow-[#1db954]/20"
                >
                  <ListPlus className="w-4 h-4" />
                  <span>Enqueue All {previewPlaylist.tracks.length} Songs</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-neutral-800 flex items-center justify-between">
          <p className="text-[11px] text-neutral-500">
            Playback is synchronized via SyncRoom authoritative engine.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-200 font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
