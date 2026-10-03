import React, { useState } from 'react';
import { Logo } from './Logo';
import { ConnectionStatus } from './ConnectionStatus';
import { ConnectionStatusType, UserRole } from '../types';
import { Copy, Check, Users, LogOut, Crown, Headphones, Settings, UserPlus, Sliders } from 'lucide-react';

interface RoomHeaderProps {
  roomName: string;
  roomCode: string;
  role: UserRole;
  participantCount: number;
  connectionStatus?: ConnectionStatusType;
  spotifyStatus?: string;
  onConnectSpotify?: () => void;
  driftMs?: number;
  onLeaveRoom: () => void;
  onToggleRole?: () => void;
  onOpenSettings?: () => void;
  onOpenInvite?: () => void;
  onOpenAdminSheet?: () => void;
  onLogoClick?: () => void;
  className?: string;
}

export const RoomHeader: React.FC<RoomHeaderProps> = ({
  roomName,
  roomCode,
  role,
  participantCount,
  connectionStatus = 'connected',
  spotifyStatus,
  onConnectSpotify,
  driftMs = 0,
  onLeaveRoom,
  onToggleRole,
  onOpenSettings,
  onOpenInvite,
  onOpenAdminSheet,
  onLogoClick,
  className = '',
}) => {
  const [copied, setCopied] = useState(false);
  const isAdmin = role === 'admin';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <header
      className={`w-full border-b border-neutral-800/80 bg-neutral-950/70 backdrop-blur-md px-4 sm:px-6 py-3.5 z-30 transition-all ${className}`}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        {/* Left Zone: Brand + Room Name Lockup */}
        <div className="flex items-center gap-3 sm:gap-5 min-w-0">
          <Logo size="sm" onClick={onLogoClick} />

          <div className="h-4 w-[1px] bg-neutral-800 hidden sm:block" />

          {/* Room Name & Code */}
          <div className="min-w-0 flex items-center gap-2">
            <h1 className="font-display font-bold text-sm sm:text-base text-white tracking-tight truncate max-w-[140px] sm:max-w-[220px]">
              {roomName}
            </h1>

            {/* Quick 1-click Code Pill */}
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-neutral-900 border border-neutral-800 text-[11px] font-mono text-neutral-300 hover:text-white hover:border-neutral-700 transition-colors"
              title="Click to copy room code"
            >
              <span>{roomCode}</span>
              {copied ? (
                <Check className="w-3 h-3 text-emerald-400" />
              ) : (
                <Copy className="w-3 h-3 text-neutral-500" />
              )}
            </button>
          </div>
        </div>

        {/* Center Zone: Connection status & participants */}
        <div className="hidden md:flex items-center gap-3 text-xs">
          {/* Room WebSocket Connection */}
          <div className="flex items-center gap-1.5" title="SyncRoom WebSocket Connection Status">
            <span className="text-[11px] text-neutral-400 font-medium">Room:</span>
            <ConnectionStatus status={connectionStatus} driftMs={driftMs} showDetails={false} />
          </div>

          <span className="text-neutral-700" aria-hidden="true">·</span>

          {/* Local Spotify Playback Connection */}
          <div className="flex items-center gap-1.5" title="Local Spotify Playback Session Status">
            <span className="text-[11px] text-neutral-400 font-medium">Spotify:</span>
            {spotifyStatus === 'PLAYING' ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-medium text-[11px]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Playing
              </span>
            ) : spotifyStatus === 'PAUSED' ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-neutral-800 border border-neutral-700 text-neutral-300 text-[11px]">
                <span className="w-1.5 h-1.5 rounded-full bg-neutral-400" />
                Paused
              </span>
            ) : spotifyStatus === 'PLAYER_READY' ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Ready
              </span>
            ) : spotifyStatus === 'CONNECT_SPOTIFY' || spotifyStatus === 'AUTH_REQUIRED' ? (
              <button
                type="button"
                onClick={onConnectSpotify}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 font-medium text-[11px] transition-colors"
                title="Click to connect Spotify account"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                Not Connected (Connect)
              </button>
            ) : spotifyStatus === 'PREMIUM_REQUIRED' ? (
              <a
                href="https://www.spotify.com/premium"
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[11px]"
                title="Spotify Premium required for Web Playback"
              >
                Premium Required
              </a>
            ) : spotifyStatus === 'AUTOPLAY_BLOCKED' ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px] animate-pulse">
                Tap to Enable Audio
              </span>
            ) : spotifyStatus === 'CONNECTING_PLAYER' || spotifyStatus === 'INITIALIZING' ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-neutral-800 border border-neutral-700 text-neutral-400 text-[11px]">
                Connecting...
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-neutral-800 border border-neutral-700 text-neutral-400 text-[11px]">
                {spotifyStatus || 'Not Connected'}
              </span>
            )}
          </div>

          <span className="text-neutral-700" aria-hidden="true">·</span>

          <div className="flex items-center gap-1.5 text-neutral-400 font-mono">
            <Users className="w-3.5 h-3.5 text-neutral-500" />
            <span className="tabular-nums">{participantCount}</span>
            <span className="font-sans text-neutral-500">online</span>
          </div>
        </div>

        {/* Right Zone: Invite, Settings, Role preview & Leave button */}
        <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
          {/* Invite Button */}
          {onOpenInvite && (
            <button
              type="button"
              onClick={onOpenInvite}
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-amber-400/10 hover:bg-amber-400/20 border border-amber-400/30 text-xs font-semibold text-amber-300 transition-colors"
              title="Invite listeners to room"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Invite</span>
            </button>
          )}

          {/* Admin Room Settings (Desktop) */}
          {isAdmin && onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="hidden lg:flex p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs font-medium text-neutral-300 hover:text-white transition-colors"
              title="Room Settings & Management"
              aria-label="Room Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          )}

          {/* Admin Mobile Quick Sheet Trigger */}
          {isAdmin && onOpenAdminSheet && (
            <button
              type="button"
              onClick={onOpenAdminSheet}
              className="lg:hidden p-1.5 rounded-xl bg-amber-400/10 hover:bg-amber-400/20 border border-amber-400/30 text-xs font-semibold text-amber-300 transition-colors"
              title="Host Controls"
              aria-label="Host Controls"
            >
              <Sliders className="w-4 h-4" />
            </button>
          )}

          {/* Role Indicator / Switcher */}
          {onToggleRole && (
            <button
              type="button"
              onClick={onToggleRole}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all ${
                role === 'admin'
                  ? 'bg-amber-400/10 text-amber-300 border border-amber-400/30 hover:bg-amber-400/20'
                  : 'bg-neutral-800/80 text-neutral-300 border border-neutral-700/60 hover:bg-neutral-700/60'
              }`}
              title="Click to preview between Admin host view and Listener view"
            >
              {role === 'admin' ? (
                <>
                  <Crown className="w-3.5 h-3.5 text-amber-400" />
                  <span className="hidden sm:inline">Role:</span>
                  <span className="font-semibold text-amber-400">Admin</span>
                </>
              ) : (
                <>
                  <Headphones className="w-3.5 h-3.5 text-sky-400" />
                  <span className="hidden sm:inline">Role:</span>
                  <span className="font-semibold text-sky-300">Listener</span>
                </>
              )}
            </button>
          )}

          {/* Leave Room Button */}
          <button
            type="button"
            onClick={onLeaveRoom}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-xs font-medium text-neutral-300 hover:text-white border border-neutral-800 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-400"
            title="Leave this listening room"
          >
            <LogOut className="w-3.5 h-3.5 text-neutral-400" />
            <span className="hidden xs:inline">Leave</span>
          </button>
        </div>
      </div>
    </header>
  );
};
