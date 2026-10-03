import React, { useState } from 'react';
import {
  X,
  Plus,
  Share2,
  Settings,
  AlertTriangle,
  Radio,
  Sliders,
  Sparkles,
} from 'lucide-react';

interface AdminMobileSheetProps {
  isOpen: boolean;
  onClose: () => void;
  roomName: string;
  roomCode: string;
  onlineCount: number;
  onOpenAddTrack: () => void;
  onOpenImportSpotify: () => void;
  onOpenInvite: () => void;
  onOpenSettings: () => void;
  onEndRoom?: () => void;
}

export const AdminMobileSheet: React.FC<AdminMobileSheetProps> = ({
  isOpen,
  onClose,
  roomName,
  roomCode,
  onlineCount,
  onOpenAddTrack,
  onOpenImportSpotify,
  onOpenInvite,
  onOpenSettings,
  onEndRoom,
}) => {
  const [showEndConfirm, setShowEndConfirm] = useState(false);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-sheet-title"
      className="fixed inset-0 z-50 flex flex-col justify-end lg:hidden bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setShowEndConfirm(false);
          onClose();
        }
      }}
    >
      {/* Bottom Sheet Drawer */}
      <div className="w-full bg-neutral-900 border-t border-neutral-800 rounded-t-3xl p-5 shadow-2xl flex flex-col gap-4 max-h-[85vh] overflow-y-auto animate-in slide-in-from-bottom duration-200">
        {/* Swipe / drag indicator */}
        <div className="w-12 h-1.5 rounded-full bg-neutral-700 mx-auto -mt-1 mb-1" />

        {/* Drawer Header */}
        <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-400/15 border border-amber-400/25 flex items-center justify-center text-amber-400">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h2 id="admin-sheet-title" className="text-base font-bold text-white font-display">
                Host Controls
              </h2>
              <p className="text-xs text-neutral-400">
                {roomName} · <span className="font-mono text-amber-400">{roomCode}</span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setShowEndConfirm(false);
              onClose();
            }}
            className="p-2 rounded-xl text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
            aria-label="Close host controls"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Room Status Pill */}
        <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-neutral-950/70 border border-neutral-800/80 text-xs text-neutral-300">
          <div className="flex items-center gap-2">
            <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            <span className="font-medium">Active Room</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-mono text-neutral-400">
            <span>{onlineCount} {onlineCount === 1 ? 'Listener' : 'Listeners'}</span>
          </div>
        </div>

        {/* Quick Action Grid */}
        <div className="grid grid-cols-2 gap-2.5">
          {/* Add Track */}
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenAddTrack();
            }}
            className="flex flex-col items-start gap-1.5 p-3 rounded-2xl bg-neutral-800/70 hover:bg-neutral-800 border border-neutral-700/60 text-left transition-colors active:scale-[0.98]"
          >
            <div className="w-8 h-8 rounded-xl bg-amber-400/10 text-amber-400 flex items-center justify-center">
              <Plus className="w-4 h-4" />
            </div>
            <span className="text-xs font-semibold text-white">Add Song</span>
            <span className="text-[10px] text-neutral-400">Search catalog</span>
          </button>

          {/* Import Spotify */}
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenImportSpotify();
            }}
            className="flex flex-col items-start gap-1.5 p-3 rounded-2xl bg-[#1db954]/10 hover:bg-[#1db954]/20 border border-[#1db954]/25 text-left transition-colors active:scale-[0.98]"
          >
            <div className="w-8 h-8 rounded-xl bg-[#1db954]/20 text-[#1ed760] flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <span className="text-xs font-semibold text-white">Import Spotify</span>
            <span className="text-[10px] text-[#1ed760]/80">Playlist sync</span>
          </button>

          {/* Invite Listeners */}
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenInvite();
            }}
            className="flex flex-col items-start gap-1.5 p-3 rounded-2xl bg-neutral-800/70 hover:bg-neutral-800 border border-neutral-700/60 text-left transition-colors active:scale-[0.98]"
          >
            <div className="w-8 h-8 rounded-xl bg-sky-400/10 text-sky-400 flex items-center justify-center">
              <Share2 className="w-4 h-4" />
            </div>
            <span className="text-xs font-semibold text-white">Invite Link</span>
            <span className="text-[10px] text-neutral-400">Share or copy</span>
          </button>

          {/* Room Settings */}
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenSettings();
            }}
            className="flex flex-col items-start gap-1.5 p-3 rounded-2xl bg-neutral-800/70 hover:bg-neutral-800 border border-neutral-700/60 text-left transition-colors active:scale-[0.98]"
          >
            <div className="w-8 h-8 rounded-xl bg-purple-400/10 text-purple-400 flex items-center justify-center">
              <Settings className="w-4 h-4" />
            </div>
            <span className="text-xs font-semibold text-white">Room Settings</span>
            <span className="text-[10px] text-neutral-400">Rename &amp; audit</span>
          </button>
        </div>

        {/* Danger Zone: End Room */}
        {onEndRoom && (
          <div className="pt-2 border-t border-neutral-800/80">
            {showEndConfirm ? (
              <div className="p-3.5 rounded-2xl bg-rose-950/40 border border-rose-800/50 flex flex-col gap-2.5">
                <div className="flex items-center gap-2 text-rose-300 text-xs">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span className="font-semibold">End room for all participants?</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowEndConfirm(false)}
                    className="flex-1 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-medium transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowEndConfirm(false);
                      onClose();
                      onEndRoom();
                    }}
                    className="flex-1 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-colors shadow-md shadow-rose-600/30"
                  >
                    End Room
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowEndConfirm(true)}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/25 text-rose-400 text-xs font-semibold transition-colors active:scale-[0.99]"
              >
                <AlertTriangle className="w-4 h-4" />
                <span>End Listening Room</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
