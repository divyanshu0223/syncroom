import React, { useRef } from 'react';
import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Loader2 } from 'lucide-react';

interface AdminControlsProps {
  isPlaying: boolean;
  isConnecting?: boolean;
  onPlayPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  isShuffle?: boolean;
  onToggleShuffle?: () => void;
  repeatMode?: 'off' | 'all' | 'one';
  onToggleRepeat?: () => void;
  className?: string;
}

export const AdminControls: React.FC<AdminControlsProps> = ({
  isPlaying,
  isConnecting = false,
  onPlayPause,
  onNext,
  onPrevious,
  isShuffle = false,
  onToggleShuffle,
  repeatMode = 'off',
  onToggleRepeat,
  className = '',
}) => {
  const lastActionTimestamp = useRef<number>(0);

  // Debounce helper to prevent accidental touch double-actions (Item 4)
  const debounceAction = (fn: () => void, cooldownMs = 250) => {
    if (isConnecting) return;
    const now = Date.now();
    if (now - lastActionTimestamp.current < cooldownMs) {
      return;
    }
    lastActionTimestamp.current = now;
    fn();
  };

  return (
    <div className={`flex flex-col items-center gap-2 select-none ${className}`}>
      {/* Control buttons row */}
      <div className="flex items-center justify-center gap-3 sm:gap-6">
        {/* Shuffle Button - Minimum 44x44px touch target */}
        <button
          type="button"
          onClick={() => debounceAction(() => onToggleShuffle?.(), 200)}
          className={`min-w-[44px] min-h-[44px] p-2.5 rounded-xl transition-colors flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 touch-manipulation active:scale-95 ${
            isShuffle
              ? 'text-amber-400 bg-amber-400/10'
              : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/60'
          }`}
          title="Shuffle Queue"
          aria-label="Shuffle Queue"
        >
          <Shuffle className="w-4 h-4" />
        </button>

        {/* Previous Track Button - Minimum 44x44px touch target */}
        <button
          type="button"
          onClick={() => debounceAction(onPrevious, 300)}
          className="min-w-[44px] min-h-[44px] p-3 rounded-xl text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 touch-manipulation active:scale-95"
          title="Previous Track"
          aria-label="Previous Track"
        >
          <SkipBack className="w-5 h-5 fill-current" />
        </button>

        {/* Big Central Play / Pause Button - 56x56px mobile, 64x64px desktop */}
        <button
          type="button"
          disabled={isConnecting}
          onClick={() => debounceAction(onPlayPause, 300)}
          className={`w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-amber-400 hover:bg-amber-300 text-neutral-950 flex items-center justify-center shadow-lg shadow-amber-500/25 hover:shadow-amber-500/35 transition-all duration-150 active:scale-95 touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 ${
            isConnecting ? 'opacity-80 cursor-wait' : ''
          }`}
          title={isConnecting ? 'Connecting to Spotify...' : isPlaying ? 'Pause Playback' : 'Start Playback'}
          aria-label={isConnecting ? 'Connecting to Spotify...' : isPlaying ? 'Pause Playback' : 'Start Playback'}
        >
          {isConnecting ? (
            <Loader2 className="w-6 h-6 sm:w-7 sm:h-7 animate-spin" />
          ) : isPlaying ? (
            <Pause className="w-6 h-6 sm:w-7 sm:h-7 fill-current stroke-current" />
          ) : (
            <Play className="w-6 h-6 sm:w-7 sm:h-7 fill-current stroke-current ml-0.5" />
          )}
        </button>

        {/* Next Track Button - Minimum 44x44px touch target */}
        <button
          type="button"
          onClick={() => debounceAction(onNext, 300)}
          className="min-w-[44px] min-h-[44px] p-3 rounded-xl text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 touch-manipulation active:scale-95"
          title="Next Track"
          aria-label="Next Track"
        >
          <SkipForward className="w-5 h-5 fill-current" />
        </button>

        {/* Repeat Button - Minimum 44x44px touch target */}
        <button
          type="button"
          onClick={() => debounceAction(() => onToggleRepeat?.(), 200)}
          className={`min-w-[44px] min-h-[44px] p-2.5 rounded-xl transition-colors flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 touch-manipulation active:scale-95 relative ${
            repeatMode !== 'off'
              ? 'text-amber-400 bg-amber-400/10'
              : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/60'
          }`}
          title={`Repeat mode: ${repeatMode}`}
          aria-label={`Repeat mode: ${repeatMode}`}
        >
          <Repeat className="w-4 h-4" />
          {repeatMode === 'one' && (
            <span className="absolute top-1.5 right-1.5 text-[9px] font-bold font-mono text-amber-400">
              1
            </span>
          )}
        </button>
      </div>
    </div>
  );
};
