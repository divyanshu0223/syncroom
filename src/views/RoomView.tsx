import React, { useState, useEffect } from 'react';
import { Room, Track, UserRole, QueueItem as QueueItemType, ConnectionStatusType, ActivityItem } from '../types';
import { RoomHeader } from '../components/RoomHeader';
import { MusicPlayer } from '../components/MusicPlayer';
import { Queue } from '../components/Queue';
import { ParticipantList } from '../components/ParticipantList';
import { AddTrackModal } from '../components/AddTrackModal';
import { ImportSpotifyModal } from '../components/ImportSpotifyModal';
import { RoomInviteModal } from '../components/RoomInviteModal';
import { RoomSettingsModal } from '../components/RoomSettingsModal';
import { AdminMobileSheet } from '../components/AdminMobileSheet';
import { MyPlaylistsModal } from '../components/MyPlaylistsModal';
import { ListMusic, Users, UserPlus, Sparkles, VolumeX, Sliders, Radio } from 'lucide-react';
import { syncEngine } from '../audio/SyncEngine';
import { SyncStatus } from '../audio/types';
import { playbackManager, SpotifyPlayerStatus } from '../audio/PlaybackProvider';
import { openSpotifyLoginPopup } from '../services/music/SpotifyMusicProvider';

import { AudioDiagnosticsBlock } from '../components/AudioDiagnosticsBlock';

interface RoomViewProps {
  room: Room;
  currentRole: UserRole;
  connectionStatus?: ConnectionStatusType;
  onLeaveRoom: () => void;
  onToggleRole?: () => void;
  onPlayPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (position: number) => void;
  onAddToQueue: (track: Track) => void;
  onImportTracks?: (tracks: Track[], replaceQueue?: boolean) => void;
  onRemoveFromQueue: (id: string) => void;
  onClearQueue?: () => void;
  onPlayNow: (item: QueueItemType) => void;
  onMoveQueueUp: (index: number) => void;
  onMoveQueueDown: (index: number) => void;
  onRemoveUser?: (userId: string, name: string) => void;
  onRenameRoom?: (newName: string) => void;
  onEndRoom?: () => void;
  activities?: ActivityItem[];
  onLoadActivities?: () => void;
  onSwitchProvider?: (provider: 'spotify' | 'youtube') => Promise<void>;
}

export const RoomView: React.FC<RoomViewProps> = ({
  room,
  currentRole,
  connectionStatus = 'connected',
  onLeaveRoom,
  onToggleRole,
  onPlayPause,
  onNext,
  onPrevious,
  onSeek,
  onAddToQueue,
  onImportTracks,
  onRemoveFromQueue,
  onClearQueue,
  onPlayNow,
  onMoveQueueUp,
  onMoveQueueDown,
  onRemoveUser,
  onRenameRoom,
  onEndRoom,
  activities = [],
  onLoadActivities,
  onSwitchProvider,
}) => {
  const [activeMobileTab, setActiveMobileTab] = useState<'player' | 'queue' | 'participants'>('player');
  const [isAddTrackOpen, setIsAddTrackOpen] = useState(false);
  const [isImportSpotifyOpen, setIsImportSpotifyOpen] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAdminSheetOpen, setIsAdminSheetOpen] = useState(false);
  const [isMyPlaylistsOpen, setIsMyPlaylistsOpen] = useState(false);
  const [isShuffle, setIsShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<'off' | 'all' | 'one'>('off');
  const [realDriftMs, setRealDriftMs] = useState<number>(0);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(syncEngine.getSyncStatus());
  const [providerStatus, setProviderStatus] = useState<SpotifyPlayerStatus | string>(
    playbackManager.getStatus()
  );

  useEffect(() => {
    const unsubSync = syncEngine.onSyncStatusChange((st) => {
      setSyncStatus(st);
      setRealDriftMs(st.driftMs);
    });

    const unsubProvider = playbackManager.onProviderChange((_, st) => {
      setProviderStatus(st);
    });

    return () => {
      unsubSync();
      unsubProvider();
    };
  }, []);

  const users = room.users || [];
  const adminUser = users.find((p) => p.role === 'admin');
  const adminName = adminUser ? adminUser.name : 'Host';
  const onlineUsers = users.filter((u) => u.isOnline !== false);
  const onlineCount = onlineUsers.length;
  const isAdmin = currentRole === 'admin';
  const isAloneInRoom = isAdmin && onlineCount <= 1;

  const handleToggleRepeat = () => {
    setRepeatMode((prev) => (prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off'));
  };

  const handleToggleShuffle = () => {
    setIsShuffle((prev) => !prev);
  };

  return (
    <div className="min-h-screen bg-[#08080a] text-neutral-100 flex flex-col selection:bg-amber-400/20 selection:text-amber-200">
      {/* Autoplay Restriction Unblock Banner */}
      {(syncStatus.status === 'autoplay_blocked' || providerStatus === 'AUTOPLAY_BLOCKED') && (
        <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2.5 flex items-center justify-between z-30 sticky top-0 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <VolumeX className="w-5 h-5 text-amber-400 animate-pulse shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-200">Browser blocked audio autoplay</p>
              <p className="text-xs text-amber-300/80">Tap Enable Audio to start listening in sync with everyone</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => syncEngine.unlockAutoplay()}
            className="px-4 py-1.5 rounded-lg bg-amber-400 text-neutral-950 font-semibold text-xs hover:bg-amber-300 transition-colors shadow-md shadow-amber-400/20"
          >
            Tap Enable Audio
          </button>
        </div>
      )}

      {/* Member Spotify Not Connected Prompt Banner */}
      {room.currentTrack?.provider !== 'youtube' && (providerStatus === 'CONNECT_SPOTIFY' || providerStatus === 'AUTH_REQUIRED') && (
        <div className="bg-emerald-500/15 border-b border-emerald-500/30 px-4 py-2.5 flex items-center justify-between z-30 sticky top-0 backdrop-blur-md">
          <div className="flex items-center gap-2.5 min-w-0">
            <Radio className="w-4 h-4 text-emerald-400 shrink-0 animate-pulse" />
            <div className="flex flex-col text-left min-w-0">
              <span className="font-semibold text-emerald-200 text-xs">Connect Spotify to enable playback</span>
              <span className="text-[11px] text-emerald-300/80 truncate">
                Each listener browser requires its own authenticated Spotify account to play music.
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={openSpotifyLoginPopup}
            className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold text-xs transition-colors shrink-0 ml-3 shadow-md shadow-emerald-500/20"
          >
            Connect Spotify to enable playback
          </button>
        </div>
      )}

      {/* Room Header */}
      <RoomHeader
        roomName={room.name}
        roomCode={room.code}
        role={currentRole}
        participantCount={onlineCount}
        connectionStatus={connectionStatus}
        spotifyStatus={providerStatus}
        onConnectSpotify={openSpotifyLoginPopup}
        driftMs={realDriftMs}
        onLeaveRoom={onLeaveRoom}
        onToggleRole={onToggleRole}
        onOpenInvite={() => setIsInviteOpen(true)}
        onOpenSettings={isAdmin ? () => setIsSettingsOpen(true) : undefined}
        onOpenAdminSheet={isAdmin ? () => setIsAdminSheetOpen(true) : undefined}
      />

      {/* Mobile Tab Switcher */}
      <nav aria-label="Mobile Navigation" className="lg:hidden flex items-center justify-around border-b border-neutral-800/80 bg-neutral-950/80 backdrop-blur-md px-2 py-1.5 sticky top-[57px] z-20">
        <button
          type="button"
          onClick={() => setActiveMobileTab('player')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            activeMobileTab === 'player'
              ? 'bg-amber-400/10 text-amber-300 border border-amber-400/20'
              : 'text-neutral-400 hover:text-white'
          }`}
          aria-current={activeMobileTab === 'player' ? 'page' : undefined}
        >
          <span>Now Playing</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveMobileTab('queue')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            activeMobileTab === 'queue'
              ? 'bg-amber-400/10 text-amber-300 border border-amber-400/20'
              : 'text-neutral-400 hover:text-white'
          }`}
          aria-current={activeMobileTab === 'queue' ? 'page' : undefined}
        >
          <ListMusic className="w-3.5 h-3.5" />
          <span>Queue ({room.queue.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveMobileTab('participants')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            activeMobileTab === 'participants'
              ? 'bg-amber-400/10 text-amber-300 border border-amber-400/20'
              : 'text-neutral-400 hover:text-white'
          }`}
          aria-current={activeMobileTab === 'participants' ? 'page' : undefined}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Listeners ({onlineCount})</span>
        </button>

        {/* Mobile Admin Quick Drawer Tab */}
        {isAdmin && (
          <button
            type="button"
            onClick={() => setIsAdminSheetOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-amber-300 bg-amber-400/15 hover:bg-amber-400/25 border border-amber-400/30 transition-colors"
            title="Host Controls & Room Settings"
            aria-label="Host Controls & Room Settings"
          >
            <Sliders className="w-3.5 h-3.5 text-amber-400" />
            <span>Host</span>
          </button>
        )}
      </nav>

      {/* Main Room Layout */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col justify-center">
        {/* Admin Alone in Room Banner / Notice */}
        {isAloneInRoom && (
          <div className="w-full mb-6 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-amber-400/20 flex items-center justify-center text-amber-300 shrink-0">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <p className="font-semibold text-neutral-100">You're the only one here.</p>
                <p className="text-neutral-400">Share the room link to invite listeners and sync your music.</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsInviteOpen(true)}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-neutral-950 font-semibold transition-colors shrink-0"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Invite Listeners</span>
            </button>
          </div>
        )}

        {/* Desktop View: Grid layout with Player on Left, Queue & Members on Right */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
          {/* Main Music Player Stage */}
          <div
            className={`lg:col-span-7 xl:col-span-8 flex flex-col gap-4 ${
              activeMobileTab !== 'player'
                ? 'max-lg:opacity-0 max-lg:pointer-events-none max-lg:absolute max-lg:-left-[9999px] max-lg:top-0 max-lg:h-0 max-lg:overflow-hidden flex'
                : 'flex'
            }`}
          >
            <MusicPlayer
              track={room.currentTrack}
              playerState={room.playerState}
              role={currentRole}
              adminName={adminName}
              onPlayPause={onPlayPause}
              onNext={onNext}
              onPrevious={onPrevious}
              onSeek={onSeek}
              isShuffle={isShuffle}
              onToggleShuffle={handleToggleShuffle}
              repeatMode={repeatMode}
              onToggleRepeat={handleToggleRepeat}
              onOpenAddTrack={isAdmin ? () => setIsAddTrackOpen(true) : undefined}
              onSwitchProvider={onSwitchProvider}
              className="w-full"
            />
            <AudioDiagnosticsBlock
              currentRole={currentRole}
              room={room}
              onConnectSpotify={openSpotifyLoginPopup}
            />
          </div>

          {/* Secondary Column: Queue & Connected Participants */}
          <div
            className={`lg:col-span-5 xl:col-span-4 flex flex-col gap-6 w-full ${
              activeMobileTab === 'player' ? 'hidden lg:flex' : 'flex'
            }`}
          >
            {/* Show Queue if desktop OR if mobile tab is 'queue' */}
            <div
              className={`w-full ${
                activeMobileTab === 'participants' ? 'hidden lg:block' : 'block'
              }`}
            >
              <Queue
                queue={room.queue}
                role={currentRole}
                onPlayNow={onPlayNow}
                onRemove={onRemoveFromQueue}
                onMoveUp={onMoveQueueUp}
                onMoveDown={onMoveQueueDown}
                onClearQueue={onClearQueue}
                onOpenAddTrack={isAdmin ? () => setIsAddTrackOpen(true) : undefined}
                onOpenImportSpotify={isAdmin ? () => setIsImportSpotifyOpen(true) : undefined}
                onOpenMyPlaylists={() => setIsMyPlaylistsOpen(true)}
              />
            </div>

            {/* Show Participants if desktop OR if mobile tab is 'participants' */}
            <div
              className={`w-full ${
                activeMobileTab === 'queue' ? 'hidden lg:block' : 'block'
              }`}
            >
              <ParticipantList
                users={users}
                roomCode={room.code}
                isAdminUser={isAdmin}
                onRemoveUser={onRemoveUser}
                onOpenInvite={() => setIsInviteOpen(true)}
              />
            </div>
          </div>
        </div>
      </main>

      {/* Add Track to Queue Modal */}
      <AddTrackModal
        isOpen={isAddTrackOpen}
        onClose={() => setIsAddTrackOpen(false)}
        onAddTrack={(track) => {
          onAddToQueue(track);
        }}
        existingTrackIds={room.queue.map((q) => q.track.id)}
        onOpenImportSpotify={isAdmin ? () => setIsImportSpotifyOpen(true) : undefined}
      />

      {/* Import Spotify Playlist Modal (Admin Only) */}
      <ImportSpotifyModal
        isOpen={isImportSpotifyOpen}
        onClose={() => setIsImportSpotifyOpen(false)}
        onImportTracks={(tracks, replaceQueue) => {
          if (onImportTracks) {
            onImportTracks(tracks, replaceQueue);
          } else {
            tracks.forEach((t) => onAddToQueue(t));
          }
        }}
      />

      {/* My Custom SyncRoom Playlists Modal */}
      <MyPlaylistsModal
        isOpen={isMyPlaylistsOpen}
        onClose={() => setIsMyPlaylistsOpen(false)}
        roomId={room.id}
        isAdmin={isAdmin}
        onImportToQueue={onImportTracks}
      />

      {/* Room Invite Modal */}
      <RoomInviteModal
        isOpen={isInviteOpen}
        onClose={() => setIsInviteOpen(false)}
        roomCode={room.code}
        roomName={room.name}
      />

      {/* Room Settings Modal (Admin Only) */}
      {isAdmin && onRenameRoom && onEndRoom && (
        <RoomSettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          roomName={room.name}
          roomCode={room.code}
          queueVersion={room.queueVersion || 1}
          onRenameRoom={onRenameRoom}
          onEndRoom={onEndRoom}
          activities={activities}
          onLoadActivities={onLoadActivities}
        />
      )}

      {/* Admin Mobile Quick Actions Sheet (Item 3) */}
      {isAdmin && (
        <AdminMobileSheet
          isOpen={isAdminSheetOpen}
          onClose={() => setIsAdminSheetOpen(false)}
          roomName={room.name}
          roomCode={room.code}
          onlineCount={onlineCount}
          onOpenAddTrack={() => setIsAddTrackOpen(true)}
          onOpenImportSpotify={() => setIsImportSpotifyOpen(true)}
          onOpenInvite={() => setIsInviteOpen(true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onEndRoom={onEndRoom}
        />
      )}
    </div>
  );
};
