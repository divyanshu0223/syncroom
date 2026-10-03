import { useEffect, useState } from 'react';
import { ToastProvider } from './context/ToastContext';
import { RoomProvider, useRoom } from './context/RoomContext';
import { AppView } from './types';
import { LandingPage } from './views/LandingPage';
import { CreateRoomForm } from './components/CreateRoomForm';
import { JoinRoomForm } from './components/JoinRoomForm';
import { RoomView } from './views/RoomView';
import { RoomCreatedModal } from './components/RoomCreatedModal';
import { MyPlaylistsModal } from './components/MyPlaylistsModal';
import { Logo } from './components/Logo';
import { InstallPwaBanner } from './components/InstallPwaBanner';

function SyncRoomApp() {
  const {
    currentRoom,
    currentUser,
    activeView,
    setActiveView,
    connectionStatus,
    createdRoomNotice,
    clearCreatedRoomNotice,
    createRoom,
    joinRoom,
    leaveRoom,
    playPause,
    seek,
    nextTrack,
    previousTrack,
    addToQueue,
    importQueue,
    removeFromQueue,
    clearQueue,
    playNow,
    moveQueueUp,
    moveQueueDown,
    removeUser,
    renameRoom,
    endRoom,
    activities,
    loadActivities,
    switchCurrentTrackProvider,
  } = useRoom();

  const [isLandingPlaylistsOpen, setIsLandingPlaylistsOpen] = useState(false);

  // Handle initial URL path and popstate browser navigation for /syncroom/, /create, /join
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const parseViewFromUrl = (): AppView | null => {
      const path = window.location.pathname.replace(/^\/syncroom/, '') || '/';
      const params = new URLSearchParams(window.location.search);
      if (params.get('code') || path === '/join' || path.startsWith('/join/')) {
        return 'join';
      }
      if (path === '/create' || path.startsWith('/create/')) {
        return 'create';
      }
      if (path === '/' || path === '') {
        return 'landing';
      }
      return null;
    };

    if (!currentRoom) {
      const initialView = parseViewFromUrl();
      if (initialView && initialView !== activeView) {
        setActiveView(initialView);
      }
    }

    const handlePopState = () => {
      if (!currentRoom) {
        const view = parseViewFromUrl();
        if (view) setActiveView(view);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [currentRoom, setActiveView]);

  // Synchronize browser history path when activeView changes outside an active room
  useEffect(() => {
    if (typeof window === 'undefined' || currentRoom) return;

    const isSubpath = window.location.pathname.startsWith('/syncroom');
    const basePath = isSubpath ? '/syncroom' : '';
    let targetPath = basePath || '/';
    if (activeView === 'create') {
      targetPath = `${basePath}/create`;
    } else if (activeView === 'join') {
      const search = window.location.search;
      targetPath = `${basePath}/join${search}`;
    }

    if (window.location.pathname !== targetPath.split('?')[0]) {
      window.history.replaceState({ view: activeView }, '', targetPath);
    }
  }, [activeView, currentRoom]);

  return (
    <div className="min-h-screen bg-[#08080a] text-neutral-100 flex flex-col font-sans">
      {/* Subtle PWA Install Banner */}
      <InstallPwaBanner />

      {/* Reconnecting / Offline Notice Banner (Item 7) */}
      {(connectionStatus === 'reconnecting' || connectionStatus === 'offline') && activeView === 'room' && (
        <div
          role="status"
          aria-live="polite"
          className="bg-amber-950/90 border-b border-amber-500/40 px-4 py-2 text-amber-200 text-xs sm:text-sm flex items-center justify-between sticky top-0 z-50 backdrop-blur-md animate-in fade-in"
        >
          <div className="flex items-center gap-2.5 max-w-4xl mx-auto">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse shrink-0 shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
            <span className="font-semibold text-white">Reconnecting…</span>
            <span className="text-amber-300/80">Restoring synchronized room playback connection</span>
          </div>
        </div>
      )}

      {/* Production Security Alert Banner */}
      {connectionStatus === 'config_error' && (
        <div className="bg-red-950/90 border-b border-red-500/50 px-4 py-3 text-red-200 text-xs sm:text-sm flex items-center justify-between sticky top-0 z-50 backdrop-blur-md">
          <div className="flex items-center gap-2 max-w-4xl mx-auto">
            <span className="font-bold text-red-400 uppercase tracking-wider text-[11px] bg-red-900/60 px-2 py-0.5 rounded border border-red-700/50">
              Security Violation
            </span>
            <span>
              SyncRoom detected an insecure WebSocket connection (<code>ws://</code>) in a production environment. Secure WebSockets (<code>wss://</code>) are strictly required.
            </span>
          </div>
        </div>
      )}

      {/* Active Room Created Confirmation Modal */}
      {createdRoomNotice && (
        <RoomCreatedModal
          room={createdRoomNotice.room}
          adminUser={createdRoomNotice.adminUser}
          onClose={clearCreatedRoomNotice}
        />
      )}

      {/* Standalone Persistent "My Playlists" Modal (Accessible Outside Room) */}
      <MyPlaylistsModal
        isOpen={isLandingPlaylistsOpen}
        onClose={() => setIsLandingPlaylistsOpen(false)}
        roomId={currentRoom?.id}
        isAdmin={currentUser?.role === 'admin'}
        onImportToQueue={currentRoom ? (tracks, replace) => importQueue(tracks, replace) : undefined}
      />

      {/* Screen 1: Landing Page */}
      {activeView === 'landing' && (
        <LandingPage
          onCreateRoomClick={() => setActiveView('create')}
          onJoinRoomClick={() => setActiveView('join')}
          onMyPlaylistsClick={() => setIsLandingPlaylistsOpen(true)}
        />
      )}

      {/* Screen 2: Create Room Screen */}
      {activeView === 'create' && (
        <div className="min-h-screen flex flex-col">
          <header className="border-b border-neutral-800/80 bg-neutral-950/70 px-6 py-4">
            <div className="max-w-7xl mx-auto flex items-center justify-between">
              <Logo size="md" onClick={() => setActiveView('landing')} />
              <button
                type="button"
                onClick={() => setActiveView('join')}
                className="text-xs text-neutral-400 hover:text-white transition-colors"
              >
                Already have a code? <span className="text-amber-400 font-medium">Join room</span>
              </button>
            </div>
          </header>
          <main className="flex-1 flex items-center justify-center">
            <CreateRoomForm
              onCreateRoom={createRoom}
              onBack={() => setActiveView('landing')}
            />
          </main>
        </div>
      )}

      {/* Screen 3: Join Room Screen */}
      {activeView === 'join' && (
        <div className="min-h-screen flex flex-col">
          <header className="border-b border-neutral-800/80 bg-neutral-950/70 px-6 py-4">
            <div className="max-w-7xl mx-auto flex items-center justify-between">
              <Logo size="md" onClick={() => setActiveView('landing')} />
              <button
                type="button"
                onClick={() => setActiveView('create')}
                className="text-xs text-neutral-400 hover:text-white transition-colors"
              >
                Want to host instead? <span className="text-amber-400 font-medium">Create room</span>
              </button>
            </div>
          </header>
          <main className="flex-1 flex items-center justify-center">
            <JoinRoomForm
              onJoinRoom={joinRoom}
              onBack={() => setActiveView('landing')}
            />
          </main>
        </div>
      )}

      {/* Screen 4: Room Dashboard Screen */}
      {activeView === 'room' && currentRoom && currentUser && (
        <RoomView
          room={currentRoom}
          currentRole={currentUser.role}
          connectionStatus={connectionStatus}
          onLeaveRoom={leaveRoom}
          onPlayPause={playPause}
          onNext={nextTrack}
          onPrevious={previousTrack}
          onSeek={seek}
          onAddToQueue={addToQueue}
          onImportTracks={importQueue}
          onRemoveFromQueue={removeFromQueue}
          onClearQueue={clearQueue}
          onPlayNow={playNow}
          onMoveQueueUp={moveQueueUp}
          onMoveQueueDown={moveQueueDown}
          onRemoveUser={removeUser}
          onRenameRoom={renameRoom}
          onEndRoom={endRoom}
          activities={activities}
          onLoadActivities={loadActivities}
          onSwitchProvider={switchCurrentTrackProvider}
        />
      )}

      {/* Fallback if Room is missing but state was set to 'room' */}
      {activeView === 'room' && (!currentRoom || !currentUser) && (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
          <div className="max-w-sm rounded-2xl bg-neutral-900 border border-neutral-800 p-6">
            <h3 className="font-display font-bold text-lg text-white mb-2">No Active Room</h3>
            <p className="text-sm text-neutral-400 mb-6">
              The session could not be found or has expired.
            </p>
            <button
              type="button"
              onClick={() => setActiveView('landing')}
              className="px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-neutral-950 font-medium text-sm transition-colors"
            >
              Return to Home
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <RoomProvider>
        <SyncRoomApp />
      </RoomProvider>
    </ToastProvider>
  );
}
