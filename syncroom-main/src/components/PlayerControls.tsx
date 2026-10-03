import React from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Lock,
} from 'lucide-react';
import { UserRole } from '../types';

interface PlayerControlsProps {
  role: UserRole;
  isPlaying: boolean;
  onPlayPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  isShuffle?: boolean;
  onToggleShuffle?: () => void;
  repeatMode?: 'off' | 'all' | 'one';
  onToggleRepeat?: () => void;
  adminName?: string;
  className?: string;
}

export const PlayerControls: React.FC<PlayerControlsProps> = ({
  role,
  isPlaying,
  onPlayPause,
  onNext,
  onPrevious,
  isShuffle = false,
  onToggleShuffle,
  repeatMode = 'off',
  onToggleRepeat,
  adminName = 'Elena Vance',
  className = '',
}) => {
  const isAdmin = role === 'admin';

  if (!isAdmin) {
    return (
      <div
        className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl bg-neutral-900/60 border border-neutral-800/80 backdrop-blur-md ${className}`}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-neutral-800 flex items-center justify-center text-neutral-400">
            <Lock className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <p className="text-xs font-semibold text-neutral-200">
              Listening mode
            </p>
            <p className="text-[11px] text-neutral-400">
              Controlled by Host ({adminName}) · Synchronized stream
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-neutral-800/80 border border-neutral-700/50 text-[11px] text-neutral-300 font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>Synced</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center gap-2 select-none ${className}`}>
      {/* Control buttons row */}
      <div className="flex items-center justify-center gap-4 sm:gap-6">
        {/* Shuffle */}
        <button
          type="button"
          onClick={onToggleShuffle}
          className={`p-2.5 rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
            isShuffle
              ? 'text-amber-400 bg-amber-400/10'
              : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/60'
          }`}
          title="Shuffle Queue"
          aria-label="Shuffle Queue"
        >
          <Shuffle className="w-4 h-4" />
        </button>

        {/* Previous */}
        <button
          type="button"
          onClick={onPrevious}
          className="p-3 rounded-xl text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 active:scale-95"
          title="Previous Track"
          aria-label="Previous Track"
        >
          <SkipBack className="w-5 h-5 fill-current" />
        </button>

        {/* Big Central Play / Pause Button */}
        <button
          type="button"
          onClick={onPlayPause}
          className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-amber-400 hover:bg-amber-300 text-neutral-950 flex items-center justify-center shadow-lg shadow-amber-500/20 hover:shadow-amber-500/30 transition-all duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
          title={isPlaying ? 'Pause' : 'Play'}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <Pause className="w-6 h-6 sm:w-7 sm:h-7 fill-current stroke-current" />
          ) : (
            <Play className="w-6 h-6 sm:w-7 sm:h-7 fill-current stroke-current ml-0.5" />
          )}
        </button>

        {/* Next */}
        <button
          type="button"
          onClick={onNext}
          className="p-3 rounded-xl text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 active:scale-95"
          title="Next Track"
          aria-label="Next Track"
        >
          <SkipForward className="w-5 h-5 fill-current" />
        </button>

        {/* Repeat */}
        <button
          type="button"
          onClick={onToggleRepeat}
          className={`p-2.5 rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 relative ${
            repeatMode !== 'off'
              ? 'text-amber-400 bg-amber-400/10'
              : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/60'
          }`}
          title={`Repeat: ${repeatMode}`}
          aria-label={`Repeat: ${repeatMode}`}
        >
          <Repeat className="w-4 h-4" />
          {repeatMode === 'one' && (
            <span className="absolute top-1 right-1 text-[9px] font-bold font-mono text-amber-400">
              1
            </span>
          )}
        </button>
      </div>
    </div>
  );
};
