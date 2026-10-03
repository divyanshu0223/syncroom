import React, { useState } from 'react';
import { UserRole, Room } from '../types';
import { spotifyPlaybackProvider } from '../audio/SpotifyPlaybackProvider';
import { socketService } from '../services/socket';
import { syncEngine } from '../audio/SyncEngine';
import { Activity, Radio, Volume2, VolumeX, ShieldCheck, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';

interface AudioDiagnosticsBlockProps {
  currentRole: UserRole;
  room: Room;
  onConnectSpotify?: () => void;
  className?: string;
}

export const AudioDiagnosticsBlock: React.FC<AudioDiagnosticsBlockProps> = ({
  currentRole,
  room,
  onConnectSpotify,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const isSocketConnected = socketService.getStatus() === 'connected';
  const hasToken = spotifyPlaybackProvider.hasValidToken();
  const isReady = spotifyPlaybackProvider.isPlayerReady();
  const deviceId = spotifyPlaybackProvider.getDeviceId();
  const providerStatus = spotifyPlaybackProvider.getStatus();
  const errorMessage = spotifyPlaybackProvider.getErrorMessage();

  // Host state (derived from current user if host, or from room authoritative state if member)
  const isHost = currentRole === 'admin';
  const hostRoom = isSocketConnected ? 'CONNECTED' : 'DISCONNECTED';
  const hostAuth = isHost ? (hasToken ? 'YES' : 'NO') : 'YES'; // Host created the room with Spotify
  const hostPlayer = isHost ? (isReady ? 'READY' : 'NOT READY') : 'READY';
  const hostDeviceId = isHost ? (deviceId ? 'PRESENT' : 'ABSENT') : 'PRESENT';
  const hostPlayback = room.playerState.isPlaying ? 'PLAYING' : 'PAUSED';
  const hostError = isHost ? (errorMessage || 'None') : 'None';

  // Member state (derived from current user if member, or pending listener session if host)
  const memberRoom = isSocketConnected ? 'CONNECTED' : 'DISCONNECTED';
  const memberAuth = !isHost ? (hasToken ? 'YES' : 'NO') : 'PENDING_MEMBER_AUTH';
  const memberPlayer = !isHost ? (isReady ? 'READY' : 'NOT READY') : 'PENDING_MEMBER_PLAYER';
  const memberDeviceId = !isHost ? (deviceId ? 'PRESENT' : 'ABSENT') : 'PENDING_MEMBER_DEVICE';
  const memberPlayback = !isHost
    ? (providerStatus === 'PLAYING' ? 'PLAYING' : providerStatus === 'PAUSED' ? 'PAUSED' : 'UNAVAILABLE')
    : (room.playerState.isPlaying ? 'SYNCED' : 'PAUSED');
  const memberError = !isHost
    ? (errorMessage || (hasToken ? 'None' : 'Connect Spotify to enable playback'))
    : 'None';

  const firstDifference = !isHost && memberAuth === 'NO'
    ? 'Spotify Auth (Member is not authenticated with Spotify)'
    : !isHost && providerStatus === 'AUTOPLAY_BLOCKED'
    ? 'Mobile Browser Autoplay Policy (User interaction required)'
    : !isHost && !isReady
    ? 'Player Device (Connecting to Spotify Web Player)'
    : null;

  return (
    <div className={`w-full rounded-2xl bg-neutral-900/60 border border-neutral-800/80 p-4 transition-all ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between text-left focus:outline-none"
      >
        <div className="flex items-center gap-2.5">
          <Activity className="w-4 h-4 text-amber-400" />
          <span className="font-semibold text-xs tracking-wider uppercase text-neutral-300">
            Audio Diagnostics (Host vs Member)
          </span>
          {firstDifference && (
            <span className="px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[10px] font-mono">
              Issue Detected
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white">
          <span>{isOpen ? 'Hide' : 'Inspect'}</span>
          {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {isOpen && (
        <div className="mt-4 pt-3 border-t border-neutral-800/80 space-y-4 text-xs font-mono">
          {firstDifference && (
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Point of divergence: </span>
                <span>{firstDifference}</span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* HOST BLOCK */}
            <div className="p-3 rounded-xl bg-neutral-950/70 border border-neutral-800 space-y-1.5">
              <div className="flex items-center justify-between pb-1.5 border-b border-neutral-800/80">
                <span className="font-bold text-amber-300">HOST</span>
                {isHost && <span className="text-[10px] text-neutral-400">(This Device)</span>}
              </div>
              <div className="flex justify-between"><span className="text-neutral-500">Room:</span> <span className="text-emerald-400">{hostRoom}</span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Spotify Auth:</span> <span className={hostAuth === 'YES' ? 'text-emerald-400' : 'text-rose-400'}>{hostAuth}</span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Player:</span> <span className={hostPlayer === 'READY' ? 'text-emerald-400' : 'text-amber-400'}>{hostPlayer}</span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Device ID:</span> <span className={hostDeviceId === 'PRESENT' ? 'text-emerald-400' : 'text-rose-400'}>{hostDeviceId}</span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Playback:</span> <span className={hostPlayback === 'PLAYING' ? 'text-emerald-400 font-bold' : 'text-neutral-400'}>{hostPlayback}</span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Error:</span> <span className="text-neutral-300 truncate max-w-[140px]">{hostError}</span></div>
            </div>

            {/* MEMBER BLOCK */}
            <div className="p-3 rounded-xl bg-neutral-950/70 border border-neutral-800 space-y-1.5">
              <div className="flex items-center justify-between pb-1.5 border-b border-neutral-800/80">
                <span className="font-bold text-emerald-400">MEMBER</span>
                {!isHost && <span className="text-[10px] text-neutral-400">(This Device)</span>}
              </div>
              <div className="flex justify-between"><span className="text-neutral-500">Room:</span> <span className="text-emerald-400">{memberRoom}</span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Spotify Auth:</span> <span className={memberAuth === 'YES' ? 'text-emerald-400' : 'text-rose-400 font-bold'}>{memberAuth}</span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Player:</span> <span className={memberPlayer === 'READY' ? 'text-emerald-400' : 'text-amber-400'}>{memberPlayer}</span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Device ID:</span> <span className={memberDeviceId === 'PRESENT' ? 'text-emerald-400' : 'text-rose-400'}>{memberDeviceId}</span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Playback:</span> <span className={memberPlayback === 'PLAYING' ? 'text-emerald-400 font-bold' : 'text-neutral-400'}>{memberPlayback}</span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Error:</span> <span className="text-rose-300 truncate max-w-[140px]" title={memberError}>{memberError}</span></div>
            </div>
          </div>

          {/* Quick Action Trigger for Member */}
          {!isHost && memberAuth === 'NO' && onConnectSpotify && (
            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={onConnectSpotify}
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold text-xs transition-colors shadow-md shadow-emerald-500/20"
              >
                Connect Spotify to enable playback
              </button>
            </div>
          )}

          {!isHost && providerStatus === 'AUTOPLAY_BLOCKED' && (
            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => syncEngine.unlockAutoplay()}
                className="px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-neutral-950 font-bold text-xs transition-colors shadow-md shadow-amber-400/20"
              >
                Tap Enable Audio
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
