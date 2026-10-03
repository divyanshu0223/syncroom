import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Track } from '../types';
import { spotifyMusicProvider } from '../services/music/SpotifyMusicProvider';
import { youtubeMusicProvider } from '../services/music/YouTubeMusicProvider';
import { parseSpotifyTrackId, parseYouTubeVideoId } from '../services/music/MusicProvider';
import { ArtworkDisplay } from './ArtworkDisplay';
import { X, Search, Plus, Check, Music, Loader2, Link2, AlertCircle, ExternalLink } from 'lucide-react';

interface AddTrackModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddTrack: (track: Track) => void;
  existingTrackIds?: string[];
  onOpenImportSpotify?: () => void;
}

export const AddTrackModal: React.FC<AddTrackModalProps> = ({
  isOpen,
  onClose,
  onAddTrack,
  existingTrackIds = [],
  onOpenImportSpotify,
}) => {
  const [activeTab, setActiveTab] = useState<'search' | 'url'>('search');
  const [searchProvider, setSearchProvider] = useState<'spotify' | 'youtube'>('spotify');

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [matchingTrackId, setMatchingTrackId] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // URL resolution state
  const [urlInput, setUrlInput] = useState('');
  const [isResolvingUrl, setIsResolvingUrl] = useState(false);
  const [urlResolvedTrack, setUrlResolvedTrack] = useState<Track | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleResolveUrl = useCallback(async (inputStr: string) => {
    const trimmed = inputStr.trim();
    if (!trimmed) {
      setUrlError('Please enter a Spotify track URL or YouTube video URL.');
      setUrlResolvedTrack(null);
      return;
    }

    // Check Spotify first
    const { trackId: spotifyTrackId } = parseSpotifyTrackId(trimmed);
    const { videoId: youtubeVideoId } = parseYouTubeVideoId(trimmed);

    if (!spotifyTrackId && !youtubeVideoId) {
      setUrlError('Invalid link format. Supported: Spotify track links or YouTube video links (e.g. https://youtu.be/... or https://youtube.com/watch?v=...)');
      setUrlResolvedTrack(null);
      return;
    }

    setIsResolvingUrl(true);
    setUrlError(null);
    setUrlResolvedTrack(null);
    setActionError(null);

    try {
      if (spotifyTrackId) {
        const track = await spotifyMusicProvider.resolveTrack(spotifyTrackId);
        setUrlResolvedTrack(track);
      } else if (youtubeVideoId) {
        const track = await youtubeMusicProvider.resolveTrack(youtubeVideoId);
        setUrlResolvedTrack(track);
      }
    } catch (err: any) {
      setUrlResolvedTrack(null);
      if (err.status === 'TRACK_NOT_FOUND') {
        setUrlError('Track or video not found. Please verify the link.');
      } else if (err.status === 'SPOTIFY_AUTH_REQUIRED') {
        setUrlError('Spotify authorization required to fetch this track metadata. Please connect Spotify.');
      } else if (err.status === 'TRACK_UNAVAILABLE') {
        setUrlError('This track is restricted or unavailable in this region.');
      } else {
        setUrlError(err.message || 'Failed to resolve link.');
      }
    } finally {
      setIsResolvingUrl(false);
    }
  }, []);

  const doSearch = useCallback(async (query: string, provider: 'spotify' | 'youtube') => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearchError(null);
      setIsSearching(false);
      return;
    }

    // Auto-detect only if user pasted an explicit URL into the search box!
    const isExplicitUrl =
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('spotify:') ||
      trimmed.includes('youtube.com') ||
      trimmed.includes('youtu.be') ||
      trimmed.includes('open.spotify.com');

    if (isExplicitUrl) {
      const spotCheck = parseSpotifyTrackId(trimmed);
      const ytCheck = parseYouTubeVideoId(trimmed);
      if (spotCheck.trackId || ytCheck.videoId) {
        setActiveTab('url');
        setUrlInput(trimmed);
        handleResolveUrl(trimmed);
        return;
      }
    }

    setIsSearching(true);
    setSearchError(null);
    setActionError(null);
    try {
      if (provider === 'youtube') {
        const results = await youtubeMusicProvider.searchTracks(trimmed);
        setSearchResults(results);
      } else {
        const results = await spotifyMusicProvider.searchTracks(trimmed);
        setSearchResults(results);
      }
    } catch (err: unknown) {
      setSearchResults([]);
      const msg = err instanceof Error ? err.message : 'Search failed';
      setSearchError(msg);
    } finally {
      setIsSearching(false);
    }
  }, [handleResolveUrl]);

  useEffect(() => {
    if (activeTab !== 'search') return;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      doSearch(searchQuery, searchProvider);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, searchProvider, doSearch, activeTab]);

  if (!isOpen) return null;

  const handleAdd = (track: Track, customKey?: string) => {
    onAddTrack(track);
    const markId = customKey || track.id;
    setJustAddedId(markId);
    setTimeout(() => {
      setJustAddedId((curr) => (curr === markId ? null : curr));
    }, 1500);
  };

  const handleAddViaYouTube = async (track: Track) => {
    setActionError(null);
    setMatchingTrackId(track.id);
    try {
      // If already a YouTube track, add directly
      if (track.provider === 'youtube' && track.youtubeVideoId) {
        handleAdd(track, `${track.id}-yt`);
        return;
      }

      // Search real YouTube API for closest match
      const ytTrack = await youtubeMusicProvider.findMatch(track.title, track.artist);
      if (!ytTrack) {
        setActionError(`No YouTube match found for "${track.title}" by ${track.artist}.`);
        return;
      }
      handleAdd(ytTrack, `${track.id}-yt`);
    } catch (err: any) {
      setActionError(err.message || 'Failed to find YouTube match');
    } finally {
      setMatchingTrackId(null);
    }
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-track-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-lg rounded-2xl bg-neutral-900 border border-neutral-800 shadow-2xl p-5 sm:p-6 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
          <div>
            <h3 id="add-track-modal-title" className="font-display font-bold text-lg text-white">
              Add Songs to Queue
            </h3>
            <p className="text-xs text-neutral-400 mt-0.5">
              Choose <span className="text-[#1ed760] font-medium">Spotify</span> or <span className="text-[#ff4e4e] font-medium">YouTube</span> for any song
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[36px] min-h-[36px] p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 flex items-center justify-center transition-colors touch-manipulation"
            aria-label="Close add songs modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1.5 p-1 bg-neutral-950/80 rounded-xl border border-neutral-800/80 my-3">
          <button
            type="button"
            onClick={() => setActiveTab('search')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'search'
                ? 'bg-neutral-800 text-white shadow-sm font-semibold'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Search className="w-3.5 h-3.5 text-amber-400" />
            <span>Search Catalog</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('url')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'url'
                ? 'bg-neutral-800 text-white shadow-sm font-semibold'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Link2 className="w-3.5 h-3.5 text-amber-400" />
            <span>Paste Link</span>
          </button>
        </div>

        {/* Action Error Banner */}
        {actionError && (
          <div className="mb-2 p-2.5 rounded-xl bg-rose-950/50 border border-rose-800/60 flex items-center gap-2 text-xs text-rose-300">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="flex-1">{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="text-rose-400 hover:text-white p-1"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Tab 1: Search Catalog */}
        {activeTab === 'search' && (
          <div className="flex-1 flex flex-col min-h-[260px]">
            {/* Search Input and Catalog Toggle */}
            <div className="flex flex-col gap-2 mb-3">
              <div className="relative">
                <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder={searchProvider === 'youtube' ? 'Search YouTube videos & music...' : 'Search Spotify tracks, artists, albums...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-neutral-950/80 border border-neutral-800 rounded-xl pl-9 pr-4 py-2.5 text-xs sm:text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400 transition-colors"
                  autoFocus
                />
              </div>

              {/* Catalog filter pills: Spotify vs YouTube */}
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[11px] text-neutral-500 font-medium">Search source:</span>
                <div className="inline-flex rounded-lg bg-neutral-950 p-0.5 border border-neutral-800">
                  <button
                    type="button"
                    onClick={() => {
                      setSearchProvider('spotify');
                      if (searchQuery.trim()) doSearch(searchQuery, 'spotify');
                    }}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                      searchProvider === 'spotify'
                        ? 'bg-[#1db954]/20 text-[#1ed760] border border-[#1db954]/30'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
                      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                    </svg>
                    <span>Spotify</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchProvider('youtube');
                      if (searchQuery.trim()) doSearch(searchQuery, 'youtube');
                    }}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                      searchProvider === 'youtube'
                        ? 'bg-red-600/20 text-[#ff4e4e] border border-red-500/30'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
                      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                    </svg>
                    <span>YouTube</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1 max-h-[300px]">
              {isSearching ? (
                <div className="py-12 text-center text-neutral-500 text-sm flex flex-col items-center gap-3">
                  <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
                  <span>Searching {searchProvider === 'youtube' ? 'YouTube' : 'Spotify'}...</span>
                </div>
              ) : searchError ? (
                <div className="py-8 px-4 text-center text-neutral-400 text-sm flex flex-col items-center gap-3 bg-neutral-950/60 rounded-xl border border-neutral-800">
                  <Music className="w-8 h-8 text-amber-400/80" />
                  <div>
                    <p className="font-medium text-neutral-200">{searchError}</p>
                    <p className="text-xs text-neutral-500 mt-1">
                      {searchProvider === 'spotify'
                        ? 'Connect Spotify, or switch to YouTube search to find music without a Spotify account.'
                        : 'Please check your connection and search query.'}
                    </p>
                  </div>
                  {searchProvider === 'spotify' && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSearchProvider('youtube');
                          if (searchQuery.trim()) doSearch(searchQuery, 'youtube');
                        }}
                        className="px-3.5 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/30 border border-red-500/40 text-xs text-[#ff4e4e] font-semibold transition-colors flex items-center gap-1.5"
                      >
                        <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
                          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                        </svg>
                        <span>Switch to YouTube Search</span>
                      </button>
                      {onOpenImportSpotify && (
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onOpenImportSpotify();
                          }}
                          className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-300 font-medium transition-colors"
                        >
                          Connect Spotify
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ) : searchQuery.trim() && searchResults.length === 0 ? (
                <div className="py-12 text-center text-neutral-500 text-sm">
                  No matching tracks found. Try a different query.
                </div>
              ) : searchResults.length === 0 ? (
                <div className="py-12 text-center text-neutral-500 text-sm flex flex-col items-center gap-3">
                  <Music className="w-8 h-8 text-neutral-600" />
                  <p>Search for songs by title, artist, or paste a link.</p>
                </div>
              ) : (
                searchResults.map((track) => {
                  const wasSpotifyAdded = justAddedId === track.id || justAddedId === `${track.id}-spotify`;
                  const wasYouTubeAdded = justAddedId === `${track.id}-yt` || (track.provider === 'youtube' && justAddedId === track.id);
                  const isMatchingThis = matchingTrackId === track.id;

                  return (
                    <div
                      key={track.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between p-2.5 rounded-xl bg-neutral-950/50 hover:bg-neutral-800/40 border border-neutral-800/60 transition-all gap-2"
                    >
                      {/* Left: Thumbnail & Song Info */}
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 border border-neutral-800">
                          <ArtworkDisplay track={track} size="sm" showVinylPeek={false} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-neutral-200 truncate">
                            {track.title}
                          </p>
                          <p className="text-xs text-neutral-400 truncate">
                            {track.artist} · <span className="font-mono tabular-nums">{formatDuration(track.duration)}</span>
                          </p>
                        </div>
                      </div>

                      {/* Right: Explicit Provider Choice Buttons [ Spotify ] [ YouTube ] */}
                      <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                        {/* Spotify Choice Button */}
                        <button
                          type="button"
                          onClick={() => {
                            if (track.provider === 'spotify') {
                              handleAdd(track, `${track.id}-spotify`);
                            } else {
                              // If track was found via YouTube search, adapt to spotify
                              handleAdd({
                                ...track,
                                provider: 'spotify',
                                audioSource: 'spotify',
                              }, `${track.id}-spotify`);
                            }
                          }}
                          disabled={wasSpotifyAdded}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                            wasSpotifyAdded
                              ? 'bg-emerald-500/20 text-[#1ed760] border border-emerald-500/30'
                              : 'bg-neutral-800/90 hover:bg-[#1db954]/20 hover:text-[#1ed760] hover:border-[#1db954]/40 text-neutral-300 border border-neutral-700/60'
                          }`}
                          title="Add to queue via Spotify"
                        >
                          <svg className="w-3.5 h-3.5 fill-current text-[#1ed760]" viewBox="0 0 24 24">
                            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                          </svg>
                          <span>{wasSpotifyAdded ? 'Added!' : 'Spotify'}</span>
                        </button>

                        {/* YouTube Choice Button */}
                        <button
                          type="button"
                          onClick={() => handleAddViaYouTube(track)}
                          disabled={wasYouTubeAdded || isMatchingThis}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                            wasYouTubeAdded
                              ? 'bg-red-500/20 text-[#ff4e4e] border border-red-500/30'
                              : 'bg-neutral-800/90 hover:bg-red-600/20 hover:text-[#ff4e4e] hover:border-red-500/40 text-neutral-300 border border-neutral-700/60'
                          }`}
                          title="Find & add via YouTube player"
                        >
                          {isMatchingThis ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-red-400" />
                              <span>Finding...</span>
                            </>
                          ) : (
                            <>
                              <svg className="w-3.5 h-3.5 fill-current text-red-500" viewBox="0 0 24 24">
                                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                              </svg>
                              <span>{wasYouTubeAdded ? 'Added!' : 'YouTube'}</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Paste Link (Spotify or YouTube) */}
        {activeTab === 'url' && (
          <div className="flex-1 flex flex-col min-h-[240px] space-y-3 overflow-y-auto">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleResolveUrl(urlInput);
              }}
              className="space-y-2"
            >
              <div className="relative flex items-center gap-2">
                <div className="relative flex-1">
                  <Link2 className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Paste Spotify track or YouTube video link..."
                    value={urlInput}
                    onChange={(e) => {
                      setUrlInput(e.target.value);
                      setUrlError(null);
                    }}
                    onPaste={(e) => {
                      const pasted = e.clipboardData.getData('text');
                      setUrlInput(pasted);
                      handleResolveUrl(pasted);
                    }}
                    className="w-full bg-neutral-950/80 border border-neutral-800 rounded-xl pl-9 pr-4 py-2.5 text-xs sm:text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400 transition-colors"
                    autoFocus
                  />
                </div>
                <button
                  type="submit"
                  disabled={isResolvingUrl || !urlInput.trim()}
                  className="px-4 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:opacity-40 disabled:pointer-events-none text-neutral-950 text-xs sm:text-sm font-semibold shrink-0 transition-colors flex items-center gap-1.5"
                >
                  {isResolvingUrl ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Resolving...</span>
                    </>
                  ) : (
                    <span>Resolve</span>
                  )}
                </button>
              </div>
              <p className="text-[11px] text-neutral-500">
                Supports Spotify tracks (<code className="text-neutral-400">open.spotify.com/track/...</code>) and YouTube links (<code className="text-neutral-400">youtube.com/watch?v=...</code> or <code className="text-neutral-400">youtu.be/...</code>).
              </p>
            </form>

            {/* Error state */}
            {urlError && (
              <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/50 flex items-start gap-2.5 text-xs text-rose-300 animate-in fade-in">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span className="flex-1">{urlError}</span>
              </div>
            )}

            {/* Resolved Track Result */}
            {urlResolvedTrack && (
              <div className="p-4 rounded-xl bg-neutral-950/70 border border-neutral-800 flex flex-col gap-3 animate-in fade-in">
                <div className="flex items-center gap-3.5">
                  <div className="w-14 h-14 rounded-lg overflow-hidden shrink-0 border border-neutral-800 shadow-md">
                    <ArtworkDisplay track={urlResolvedTrack} size="md" showVinylPeek={false} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <h4 className="text-sm font-semibold text-white truncate">
                        {urlResolvedTrack.title}
                      </h4>
                      {urlResolvedTrack.provider === 'youtube' ? (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-600/20 text-[#ff4e4e] border border-red-500/30 leading-none">
                          YouTube
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#1db954]/20 text-[#1ed760] border border-[#1db954]/30 leading-none">
                          Spotify
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-neutral-400 truncate mt-0.5">
                      {urlResolvedTrack.artist}
                    </p>
                    <p className="text-[11px] text-neutral-500 truncate mt-0.5">
                      {urlResolvedTrack.album || 'Single'} · <span className="font-mono tabular-nums">{formatDuration(urlResolvedTrack.duration)}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-neutral-800/80">
                  <div className="flex items-center gap-2">
                    {existingTrackIds.includes(urlResolvedTrack.id) && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-neutral-800 text-neutral-400 border border-neutral-700">
                        In Queue
                      </span>
                    )}
                    {urlResolvedTrack.externalUrl && (
                      <a
                        href={urlResolvedTrack.externalUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-neutral-400 hover:text-amber-400 transition-colors"
                      >
                        <span>Open source</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>

                  {/* Provider Options for Resolved Track */}
                  <div className="flex items-center gap-2">
                    {urlResolvedTrack.provider === 'spotify' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleAdd(urlResolvedTrack, 'resolved-spotify')}
                          disabled={justAddedId === 'resolved-spotify'}
                          className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                            justAddedId === 'resolved-spotify'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-[#1db954]/20 text-[#1ed760] hover:bg-[#1db954]/30 border border-[#1db954]/40'
                          }`}
                        >
                          <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                          </svg>
                          <span>{justAddedId === 'resolved-spotify' ? 'Added!' : 'Add Spotify'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleAddViaYouTube(urlResolvedTrack)}
                          disabled={justAddedId === `${urlResolvedTrack.id}-yt` || matchingTrackId === urlResolvedTrack.id}
                          className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                            justAddedId === `${urlResolvedTrack.id}-yt`
                              ? 'bg-red-500/20 text-[#ff4e4e] border border-red-500/30'
                              : 'bg-red-600/20 text-[#ff4e4e] hover:bg-red-600/30 border border-red-500/40'
                          }`}
                        >
                          {matchingTrackId === urlResolvedTrack.id ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Finding...</span>
                            </>
                          ) : (
                            <>
                              <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                              </svg>
                              <span>{justAddedId === `${urlResolvedTrack.id}-yt` ? 'Added!' : 'Add YouTube'}</span>
                            </>
                          )}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleAdd(urlResolvedTrack, 'resolved-yt')}
                        disabled={justAddedId === 'resolved-yt'}
                        className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                          justAddedId === 'resolved-yt'
                            ? 'bg-red-500/20 text-[#ff4e4e] border border-red-500/30'
                            : 'bg-red-600 text-white hover:bg-red-500 shadow-md shadow-red-600/20'
                        }`}
                      >
                        <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                        </svg>
                        <span>{justAddedId === 'resolved-yt' ? 'Added to Queue!' : 'Add to Queue'}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {!urlResolvedTrack && !urlError && !isResolvingUrl && (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-neutral-500 text-xs gap-2">
                <Music className="w-8 h-8 text-neutral-700" />
                <p>Paste any real Spotify song link or YouTube video link above.</p>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="pt-3 mt-3 border-t border-neutral-800 flex items-center justify-between">
          {onOpenImportSpotify ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenImportSpotify();
              }}
              className="px-3 py-1.5 rounded-xl bg-[#1db954]/15 hover:bg-[#1db954]/25 border border-[#1db954]/30 text-xs text-[#1ed760] font-semibold transition-colors flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
              </svg>
              <span>Import Spotify Playlist</span>
            </button>
          ) : (
            <div />
          )}

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-sm text-neutral-200 font-medium transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
