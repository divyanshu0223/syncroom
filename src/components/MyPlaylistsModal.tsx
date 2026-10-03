import React, { useState, useEffect, useCallback } from 'react';
import { CustomPlaylistSummary, CustomPlaylistDetail, Track } from '../types';
import { customPlaylistService } from '../services/customPlaylistService';
import { parseSpotifyTrackId } from '../services/music/MusicProvider';
import { ArtworkDisplay } from './ArtworkDisplay';
import { useToast } from '../context/ToastContext';
import {
  X,
  Plus,
  Music,
  Trash2,
  ChevronLeft,
  Clock,
  Play,
  ArrowUp,
  ArrowDown,
  Loader2,
  Link2,
  AlertCircle,
  ExternalLink,
  Edit2,
  Check,
  FolderPlus,
  ListMusic,
} from 'lucide-react';

interface MyPlaylistsModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomId?: string;
  isAdmin?: boolean;
  onImportToQueue?: (tracks: Track[], replaceQueue?: boolean) => void;
}

export const MyPlaylistsModal: React.FC<MyPlaylistsModalProps> = ({
  isOpen,
  onClose,
  roomId,
  isAdmin = false,
  onImportToQueue,
}) => {
  const { showToast } = useToast();

  // Navigation: 'list' or 'detail'
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [playlists, setPlaylists] = useState<CustomPlaylistSummary[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<CustomPlaylistDetail | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // Create Playlist State
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDesc, setNewPlaylistDesc] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Rename Playlist State
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');

  // Add Track via Spotify URL State
  const [showAddTrackModal, setShowAddTrackModal] = useState(false);
  const [trackUrlInput, setTrackUrlInput] = useState('');
  const [isResolvingTrack, setIsResolvingTrack] = useState(false);
  const [resolvedTrack, setResolvedTrack] = useState<Track | null>(null);
  const [addTrackError, setAddTrackError] = useState<string | null>(null);
  const [isAddingTrack, setIsAddingTrack] = useState(false);

  // Queue import state
  const [isLoadingQueueImport, setIsLoadingQueueImport] = useState(false);

  // Fetch all user playlists
  const loadPlaylists = useCallback(async () => {
    setIsLoadingList(true);
    try {
      const list = await customPlaylistService.getPlaylists();
      setPlaylists(list);
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Failed to load playlists',
        description: err.message || 'Could not fetch your custom playlists.',
      });
    } finally {
      setIsLoadingList(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (isOpen) {
      loadPlaylists();
    } else {
      setView('list');
      setSelectedPlaylist(null);
      setShowCreateForm(false);
      setShowAddTrackModal(false);
    }
  }, [isOpen, loadPlaylists]);

  // Open a specific playlist
  const handleOpenPlaylist = async (playlistId: string) => {
    setIsLoadingDetail(true);
    try {
      const detail = await customPlaylistService.getPlaylist(playlistId);
      setSelectedPlaylist(detail);
      setEditedName(detail.name);
      setView('detail');
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Error Opening Playlist',
        description: err.message || 'Could not open playlist.',
      });
    } finally {
      setIsLoadingDetail(false);
    }
  };

  // Create playlist
  const handleCreatePlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newPlaylistName.trim();
    if (!trimmed) return;

    setIsCreating(true);
    try {
      const created = await customPlaylistService.createPlaylist(trimmed, newPlaylistDesc.trim());
      setNewPlaylistName('');
      setNewPlaylistDesc('');
      setShowCreateForm(false);
      await loadPlaylists();
      await handleOpenPlaylist(created.id);
      showToast({
        type: 'success',
        title: 'Playlist Created',
        description: `"${created.name}" is ready.`,
      });
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Failed to Create Playlist',
        description: err.message || 'Could not create playlist.',
      });
    } finally {
      setIsCreating(false);
    }
  };

  // Rename playlist
  const handleSaveRename = async () => {
    if (!selectedPlaylist) return;
    const trimmed = editedName.trim();
    if (!trimmed || trimmed === selectedPlaylist.name) {
      setIsEditingName(false);
      return;
    }

    try {
      await customPlaylistService.updatePlaylist(selectedPlaylist.id, { name: trimmed });
      setSelectedPlaylist((prev) => (prev ? { ...prev, name: trimmed } : null));
      setIsEditingName(false);
      await loadPlaylists();
      showToast({
        type: 'success',
        title: 'Playlist Renamed',
        description: `Renamed to "${trimmed}".`,
      });
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Rename Failed',
        description: err.message || 'Could not update playlist name.',
      });
    }
  };

  // Delete playlist
  const handleDeletePlaylist = async (playlistId: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete the playlist "${name}"?`)) return;

    try {
      await customPlaylistService.deletePlaylist(playlistId);
      if (selectedPlaylist?.id === playlistId) {
        setView('list');
        setSelectedPlaylist(null);
      }
      await loadPlaylists();
      showToast({
        type: 'info',
        title: 'Playlist Deleted',
        description: `"${name}" was deleted.`,
      });
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Delete Failed',
        description: err.message || 'Could not delete playlist.',
      });
    }
  };

  // Resolve Spotify track URL
  const handleResolveTrackUrl = async (inputStr: string) => {
    const trimmed = inputStr.trim();
    if (!trimmed) {
      setAddTrackError('Please enter a Spotify song URL or ID.');
      setResolvedTrack(null);
      return;
    }

    const { trackId, error: parseError } = parseSpotifyTrackId(trimmed);
    if (!trackId) {
      setAddTrackError(parseError || 'Invalid Spotify track format.');
      setResolvedTrack(null);
      return;
    }

    setIsResolvingTrack(true);
    setAddTrackError(null);
    setResolvedTrack(null);

    try {
      const track = await customPlaylistService.resolveSpotifyTrack(trackId);
      // Check duplicate
      if (selectedPlaylist && selectedPlaylist.tracks.some((t) => t.providerTrackId === track.providerTrackId)) {
        setAddTrackError('This track already exists in this playlist.');
      }
      setResolvedTrack(track);
    } catch (err: any) {
      setResolvedTrack(null);
      if (err.status === 'TRACK_NOT_FOUND') {
        setAddTrackError('Spotify track not found.');
      } else if (err.status === 'SPOTIFY_AUTH_REQUIRED') {
        setAddTrackError('Connect Spotify to resolve track metadata.');
      } else if (err.status === 'TRACK_UNAVAILABLE') {
        setAddTrackError('Track is restricted or unavailable on Spotify in this region.');
      } else {
        setAddTrackError(err.message || 'Failed to resolve track.');
      }
    } finally {
      setIsResolvingTrack(false);
    }
  };

  // Add resolved track to selected playlist
  const handleConfirmAddTrack = async () => {
    if (!selectedPlaylist || !resolvedTrack) return;

    setIsAddingTrack(true);
    setAddTrackError(null);
    try {
      await customPlaylistService.addTrackToPlaylist(selectedPlaylist.id, resolvedTrack);
      showToast({
        type: 'success',
        title: 'Track Added',
        description: `Added "${resolvedTrack.title}" to playlist.`,
      });
      // Refresh playlist detail
      const updated = await customPlaylistService.getPlaylist(selectedPlaylist.id);
      setSelectedPlaylist(updated);
      await loadPlaylists();
      setTrackUrlInput('');
      setResolvedTrack(null);
      setShowAddTrackModal(false);
    } catch (err: any) {
      if (err.status === 'DUPLICATE_TRACK' || err.message?.includes('already exists')) {
        setAddTrackError('This track is already in the playlist.');
      } else {
        setAddTrackError(err.message || 'Failed to add track.');
      }
    } finally {
      setIsAddingTrack(false);
    }
  };

  // Remove track from playlist
  const handleRemoveTrack = async (trackId: string, trackTitle: string) => {
    if (!selectedPlaylist) return;

    try {
      await customPlaylistService.removeTrackFromPlaylist(selectedPlaylist.id, trackId);
      const updated = await customPlaylistService.getPlaylist(selectedPlaylist.id);
      setSelectedPlaylist(updated);
      await loadPlaylists();
      showToast({
        type: 'info',
        title: 'Track Removed',
        description: `Removed "${trackTitle}".`,
      });
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Remove Failed',
        description: err.message || 'Failed to remove track.',
      });
    }
  };

  // Move track Up/Down in playlist
  const handleMoveTrack = async (index: number, direction: 'up' | 'down') => {
    if (!selectedPlaylist) return;
    const tracks = [...selectedPlaylist.tracks];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;

    if (targetIndex < 0 || targetIndex >= tracks.length) return;

    // Swap
    const temp = tracks[index];
    tracks[index] = tracks[targetIndex];
    tracks[targetIndex] = temp;

    // Optimistic UI update
    setSelectedPlaylist({ ...selectedPlaylist, tracks });

    try {
      const orderedIds = tracks.map((t) => t.providerTrackId);
      await customPlaylistService.reorderPlaylist(selectedPlaylist.id, orderedIds);
    } catch (err: any) {
      // Revert on error
      const fresh = await customPlaylistService.getPlaylist(selectedPlaylist.id);
      setSelectedPlaylist(fresh);
      showToast({
        type: 'error',
        title: 'Reorder Failed',
        description: err.message || 'Could not update track order.',
      });
    }
  };

  // Load playlist into live room queue
  const handleLoadIntoRoomQueue = async (playlist: CustomPlaylistDetail | CustomPlaylistSummary) => {
    if (!roomId) {
      showToast({
        type: 'info',
        title: 'Not in a Room',
        description: 'Join or create a room to load this playlist into the room queue.',
      });
      return;
    }

    if (!isAdmin) {
      showToast({
        type: 'error',
        title: 'Host Only',
        description: 'Only the room host can load playlists into the queue.',
      });
      return;
    }

    setIsLoadingQueueImport(true);
    try {
      const result = await customPlaylistService.loadPlaylistIntoRoomQueue(roomId, playlist.id, false);
      showToast({
        type: 'success',
        title: 'Queue Updated',
        description: result.message || `Loaded ${playlist.trackCount} tracks into queue.`,
      });
      onClose();
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Import Failed',
        description: err.message || 'Could not load playlist into room queue.',
      });
    } finally {
      setIsLoadingQueueImport(false);
    }
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const formatTotalTime = (ms: number): string => {
    const totalMinutes = Math.floor(ms / (1000 * 60));
    if (totalMinutes < 60) return `${totalMinutes} min`;
    const hours = Math.floor(totalMinutes / 60);
    const remainingMins = totalMinutes % 60;
    return `${hours} hr ${remainingMins} min`;
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="my-playlists-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-2xl rounded-2xl bg-neutral-900 border border-neutral-800 shadow-2xl p-5 sm:p-6 flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-3.5 border-b border-neutral-800">
          <div className="flex items-center gap-2.5">
            {view === 'detail' && (
              <button
                type="button"
                onClick={() => {
                  setView('list');
                  setSelectedPlaylist(null);
                  setShowAddTrackModal(false);
                }}
                className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
                aria-label="Back to all playlists"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            <div className="p-1.5 rounded-lg bg-amber-400/10 text-amber-400">
              <ListMusic className="w-5 h-5" />
            </div>
            <div>
              <h3 id="my-playlists-modal-title" className="font-display font-bold text-lg text-white">
                {view === 'detail' && selectedPlaylist ? selectedPlaylist.name : 'My SyncRoom Playlists'}
              </h3>
              <p className="text-xs text-neutral-400 mt-0.5">
                {view === 'detail' && selectedPlaylist
                  ? `${selectedPlaylist.trackCount} ${selectedPlaylist.trackCount === 1 ? 'song' : 'songs'} · ${formatTotalTime(selectedPlaylist.totalDurationMs)}`
                  : 'Custom playlists stored in PostgreSQL'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {view === 'list' && !showCreateForm && (
              <button
                type="button"
                onClick={() => setShowCreateForm(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-neutral-950 text-xs font-semibold transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create Playlist</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="min-w-[36px] min-h-[36px] p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 flex items-center justify-center transition-colors"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ======================================================== */}
        {/* VIEW 1: PLAYLISTS LIST */}
        {/* ======================================================== */}
        {view === 'list' && (
          <div className="flex-1 flex flex-col overflow-y-auto mt-4 pr-1 min-h-[320px]">
            {/* Create Playlist Inline Form */}
            {showCreateForm && (
              <form
                onSubmit={handleCreatePlaylist}
                className="p-4 rounded-xl bg-neutral-950/70 border border-neutral-800 mb-4 space-y-3 animate-in fade-in"
              >
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                    <FolderPlus className="w-4 h-4 text-amber-400" />
                    <span>Create New Playlist</span>
                  </h4>
                  <button
                    type="button"
                    onClick={() => setShowCreateForm(false)}
                    className="text-xs text-neutral-400 hover:text-white"
                  >
                    Cancel
                  </button>
                </div>

                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Playlist name (e.g. Late Night Vibes)"
                    value={newPlaylistName}
                    onChange={(e) => setNewPlaylistName(e.target.value)}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3.5 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400 transition-colors"
                    autoFocus
                    required
                  />
                  <input
                    type="text"
                    placeholder="Description (optional)"
                    value={newPlaylistDesc}
                    onChange={(e) => setNewPlaylistDesc(e.target.value)}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400 transition-colors"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowCreateForm(false)}
                    className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isCreating || !newPlaylistName.trim()}
                    className="px-4 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-xs font-semibold text-neutral-950 transition-colors flex items-center gap-1.5"
                  >
                    {isCreating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    <span>Create</span>
                  </button>
                </div>
              </form>
            )}

            {/* Loading state */}
            {isLoadingList ? (
              <div className="py-16 text-center text-neutral-500 flex flex-col items-center gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
                <span className="text-sm">Loading your custom playlists...</span>
              </div>
            ) : playlists.length === 0 && !showCreateForm ? (
              <div className="py-16 text-center text-neutral-500 flex flex-col items-center gap-3">
                <Music className="w-10 h-10 text-neutral-700" />
                <div>
                  <p className="text-sm font-medium text-neutral-300">No Custom Playlists Yet</p>
                  <p className="text-xs text-neutral-500 mt-1 max-w-sm">
                    Create custom playlists in SyncRoom, save your favorite tracks from Spotify, and load them into any room queue.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCreateForm(true)}
                  className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-neutral-950 text-xs font-semibold transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create Your First Playlist</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {playlists.map((pl) => (
                  <div
                    key={pl.id}
                    onClick={() => handleOpenPlaylist(pl.id)}
                    className="group p-3.5 rounded-xl bg-neutral-950/60 hover:bg-neutral-800/40 border border-neutral-800/80 hover:border-neutral-700 transition-all cursor-pointer flex flex-col justify-between"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-lg bg-neutral-900 border border-neutral-800 overflow-hidden shrink-0 flex items-center justify-center">
                        {pl.artworkUrl ? (
                          <img src={pl.artworkUrl} alt={pl.name} className="w-full h-full object-cover" />
                        ) : (
                          <Music className="w-5 h-5 text-neutral-600" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-semibold text-white group-hover:text-amber-400 transition-colors truncate">
                          {pl.name}
                        </h4>
                        {pl.description && (
                          <p className="text-xs text-neutral-400 truncate mt-0.5">{pl.description}</p>
                        )}
                        <p className="text-[11px] text-neutral-500 mt-1 flex items-center gap-2">
                          <span>{pl.trackCount} {pl.trackCount === 1 ? 'song' : 'songs'}</span>
                          <span>·</span>
                          <span>{formatTotalTime(pl.totalDurationMs)}</span>
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 pt-2.5 border-t border-neutral-800/60 flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
                      {isAdmin && roomId && pl.trackCount > 0 ? (
                        <button
                          type="button"
                          onClick={() => handleLoadIntoRoomQueue(pl)}
                          disabled={isLoadingQueueImport}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-400/15 hover:bg-amber-400/25 border border-amber-400/30 text-[11px] font-semibold text-amber-300 transition-colors"
                        >
                          <Play className="w-3 h-3 fill-current" />
                          <span>Load to Queue</span>
                        </button>
                      ) : (
                        <span className="text-[10px] text-neutral-500">
                          {new Date(pl.updatedAt).toLocaleDateString()}
                        </span>
                      )}

                      <button
                        type="button"
                        onClick={() => handleDeletePlaylist(pl.id, pl.name)}
                        className="p-1 rounded-lg text-neutral-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                        title="Delete playlist"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ======================================================== */}
        {/* VIEW 2: PLAYLIST DETAIL */}
        {/* ======================================================== */}
        {view === 'detail' && selectedPlaylist && (
          <div className="flex-1 flex flex-col overflow-y-auto mt-3 pr-1 min-h-[340px]">
            {/* Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-neutral-950/70 border border-neutral-800 mb-3">
              <div className="flex items-center gap-2">
                {isEditingName ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={editedName}
                      onChange={(e) => setEditedName(e.target.value)}
                      className="bg-neutral-900 border border-neutral-700 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none focus:border-amber-400"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={handleSaveRename}
                      className="p-1.5 rounded-lg bg-amber-400 text-neutral-950 hover:bg-amber-300"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditedName(selectedPlaylist.name);
                        setIsEditingName(false);
                      }}
                      className="p-1.5 rounded-lg bg-neutral-800 text-neutral-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsEditingName(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-300 transition-colors"
                  >
                    <Edit2 className="w-3 h-3 text-neutral-400" />
                    <span>Rename</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setShowAddTrackModal(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-400 hover:bg-amber-300 text-neutral-950 text-xs font-semibold transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Song</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                {isAdmin && roomId && selectedPlaylist.tracks.length > 0 && (
                  <button
                    type="button"
                    onClick={() => handleLoadIntoRoomQueue(selectedPlaylist)}
                    disabled={isLoadingQueueImport}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#1db954]/20 hover:bg-[#1db954]/30 border border-[#1db954]/40 text-xs font-semibold text-[#1ed760] transition-colors"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    <span>Load into Room Queue</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => handleDeletePlaylist(selectedPlaylist.id, selectedPlaylist.name)}
                  className="p-1.5 rounded-lg text-neutral-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                  title="Delete playlist"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Add Track Submodal / Inline Panel */}
            {showAddTrackModal && (
              <div className="p-4 rounded-xl bg-neutral-950/80 border border-amber-400/40 mb-3 space-y-3 animate-in fade-in">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-white flex items-center gap-2">
                    <Link2 className="w-3.5 h-3.5 text-amber-400" />
                    <span>Paste Spotify Song URL to Add</span>
                  </h4>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddTrackModal(false);
                      setTrackUrlInput('');
                      setResolvedTrack(null);
                      setAddTrackError(null);
                    }}
                    className="text-xs text-neutral-400 hover:text-white"
                  >
                    Cancel
                  </button>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleResolveTrackUrl(trackUrlInput);
                  }}
                  className="flex items-center gap-2"
                >
                  <div className="relative flex-1">
                    <Link2 className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="https://open.spotify.com/track/... or spotify:track:..."
                      value={trackUrlInput}
                      onChange={(e) => {
                        setTrackUrlInput(e.target.value);
                        setAddTrackError(null);
                      }}
                      onPaste={(e) => {
                        const pasted = e.clipboardData.getData('text');
                        setTrackUrlInput(pasted);
                        handleResolveTrackUrl(pasted);
                      }}
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400"
                      autoFocus
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isResolvingTrack || !trackUrlInput.trim()}
                    className="px-3.5 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-neutral-950 text-xs font-semibold transition-colors flex items-center gap-1"
                  >
                    {isResolvingTrack ? <Loader2 className="w-3 h-3 animate-spin" /> : <span>Resolve</span>}
                  </button>
                </form>

                {addTrackError && (
                  <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-800/50 flex items-center gap-2 text-xs text-rose-300">
                    <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    <span>{addTrackError}</span>
                  </div>
                )}

                {resolvedTrack && (
                  <div className="p-3 rounded-lg bg-neutral-900 border border-neutral-800 flex items-center justify-between gap-3 animate-in fade-in">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-10 h-10 rounded overflow-hidden shrink-0 border border-neutral-800">
                        <ArtworkDisplay track={resolvedTrack} size="sm" showVinylPeek={false} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white truncate">{resolvedTrack.title}</p>
                        <p className="text-[11px] text-neutral-400 truncate">{resolvedTrack.artist}</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleConfirmAddTrack}
                      disabled={isAddingTrack}
                      className="px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-neutral-950 text-xs font-semibold shrink-0 transition-colors flex items-center gap-1.5"
                    >
                      {isAddingTrack ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                      <span>Add to Playlist</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Tracks List */}
            {selectedPlaylist.tracks.length === 0 ? (
              <div className="py-16 text-center text-neutral-500 flex flex-col items-center gap-3">
                <Music className="w-9 h-9 text-neutral-700" />
                <p className="text-sm font-medium text-neutral-300">This playlist is empty.</p>
                <p className="text-xs text-neutral-500 max-w-xs">
                  Click "Add Song" above and paste any Spotify track link to add real songs.
                </p>
                <button
                  type="button"
                  onClick={() => setShowAddTrackModal(true)}
                  className="mt-2 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-400 text-neutral-950 text-xs font-semibold"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add First Song</span>
                </button>
              </div>
            ) : (
              <div className="space-y-1.5">
                {selectedPlaylist.tracks.map((track, idx) => (
                  <div
                    key={`${track.providerTrackId}-${idx}`}
                    className="group flex items-center justify-between p-2 rounded-xl bg-neutral-950/40 hover:bg-neutral-800/40 border border-neutral-800/60 transition-all"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-5 text-center text-xs font-mono text-neutral-500 tabular-nums">
                        {idx + 1}
                      </span>
                      <div className="w-9 h-9 rounded-lg overflow-hidden shrink-0 border border-neutral-800">
                        <ArtworkDisplay track={track} size="sm" showVinylPeek={false} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-neutral-200 truncate">{track.title}</p>
                        <p className="text-[11px] text-neutral-400 truncate">
                          {track.artist} · <span className="font-mono tabular-nums">{formatDuration(track.duration)}</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                      {/* Reorder Buttons */}
                      <button
                        type="button"
                        onClick={() => handleMoveTrack(idx, 'up')}
                        disabled={idx === 0}
                        className="p-1 rounded text-neutral-400 hover:text-white disabled:opacity-20 hover:bg-neutral-800 transition-colors"
                        title="Move Up"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveTrack(idx, 'down')}
                        disabled={idx === selectedPlaylist.tracks.length - 1}
                        className="p-1 rounded text-neutral-400 hover:text-white disabled:opacity-20 hover:bg-neutral-800 transition-colors"
                        title="Move Down"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>

                      {track.externalUrl && (
                        <a
                          href={track.externalUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1 rounded text-neutral-400 hover:text-amber-400 hover:bg-neutral-800 transition-colors"
                          title="Open on Spotify"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}

                      <button
                        type="button"
                        onClick={() => handleRemoveTrack(track.providerTrackId, track.title)}
                        className="p-1 rounded text-neutral-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors ml-1"
                        title="Remove from playlist"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="pt-3 mt-3 border-t border-neutral-800 flex items-center justify-between text-xs text-neutral-500">
          <span>SyncRoom Custom Playlists</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
