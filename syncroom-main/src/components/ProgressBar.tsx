import React, { useState, useRef, useCallback } from 'react';

interface ProgressBarProps {
  position: number; // in seconds
  duration: number; // in seconds
  onSeek?: (position: number) => void;
  isAdmin?: boolean;
  disabled?: boolean;
  className?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  position,
  duration,
  onSeek,
  isAdmin = true,
  disabled = false,
  className = '',
}) => {
  const [hoverPosition, setHoverPosition] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const barRef = useRef<HTMLDivElement>(null);

  const formatTime = (seconds: number): string => {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const currentDisplayPosition = isDragging && hoverPosition !== null ? hoverPosition : position;
  const percentage = duration > 0 ? Math.min(100, Math.max(0, (currentDisplayPosition / duration) * 100)) : 0;

  const calculateTargetSeconds = useCallback((clientX: number): { seconds: number; boundedX: number } | null => {
    if (!barRef.current || duration === 0) return null;
    const rect = barRef.current.getBoundingClientRect();
    const clickX = clientX - rect.left;
    const boundedX = Math.max(0, Math.min(clickX, rect.width));
    const seconds = (boundedX / rect.width) * duration;
    return { seconds, boundedX };
  }, [duration]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isAdmin || disabled) return;
    const result = calculateTargetSeconds(e.clientX);
    if (!result) return;
    setHoverPosition(result.seconds);
    setHoverX(result.boundedX);
  };

  const handleMouseLeave = () => {
    if (!isDragging) {
      setHoverPosition(null);
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isAdmin || disabled || !onSeek) return;
    const result = calculateTargetSeconds(e.clientX);
    if (!result) return;
    onSeek(Math.floor(result.seconds));
  };

  // Touch Event Handlers for Mobile devices (Item 4 & 13)
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isAdmin || disabled || !onSeek || e.touches.length === 0) return;
    setIsDragging(true);
    const result = calculateTargetSeconds(e.touches[0].clientX);
    if (result) {
      setHoverPosition(result.seconds);
      setHoverX(result.boundedX);
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isAdmin || disabled || !isDragging || e.touches.length === 0) return;
    const result = calculateTargetSeconds(e.touches[0].clientX);
    if (result) {
      setHoverPosition(result.seconds);
      setHoverX(result.boundedX);
    }
  };

  const handleTouchEnd = () => {
    if (!isAdmin || disabled || !isDragging) return;
    setIsDragging(false);
    if (hoverPosition !== null && onSeek) {
      onSeek(Math.floor(hoverPosition));
    }
    setHoverPosition(null);
  };

  const handleTouchCancel = () => {
    setIsDragging(false);
    setHoverPosition(null);
  };

  // Keyboard navigation for Accessibility (Item 12)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isAdmin || disabled || !onSeek || duration === 0) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onSeek(Math.max(0, Math.floor(position - 5)));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onSeek(Math.min(duration, Math.floor(position + 5)));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onSeek(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      onSeek(Math.floor(duration));
    }
  };

  return (
    <div className={`w-full flex flex-col gap-1.5 ${className}`}>
      {/* Interactive bar track with 44px min touch target hit-area */}
      <div
        ref={barRef}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        onKeyDown={handleKeyDown}
        tabIndex={isAdmin && !disabled ? 0 : -1}
        className={`group relative min-h-[44px] flex items-center select-none touch-none focus:outline-none ${
          isAdmin && !disabled ? 'cursor-pointer' : 'cursor-default'
        }`}
        role={isAdmin && !disabled ? 'slider' : 'progressbar'}
        aria-valuenow={Math.round(currentDisplayPosition)}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-label="Track playback timeline"
      >
        {/* Background track */}
        <div className="w-full h-1.5 rounded-full bg-neutral-800/90 overflow-hidden group-hover:h-2 group-focus-visible:h-2 transition-all duration-150">
          {/* Progress fill */}
          <div
            className="h-full bg-gradient-to-r from-amber-500 to-amber-400 rounded-full transition-all duration-75 relative"
            style={{ width: `${percentage}%` }}
          />
        </div>

        {/* Hover / Scrub preview tooltip for Admin */}
        {isAdmin && !disabled && (hoverPosition !== null || isDragging) && (
          <div
            className="absolute -top-6 -translate-x-1/2 px-2 py-0.5 rounded bg-neutral-900 border border-neutral-700 text-[11px] font-mono text-amber-300 tabular-nums shadow-lg pointer-events-none z-20"
            style={{ left: `${hoverX}px` }}
          >
            {formatTime(hoverPosition !== null ? hoverPosition : position)}
          </div>
        )}

        {/* Scrubber thumb - touch-accessible on mobile, hover-revealed on desktop */}
        {isAdmin && !disabled && (
          <div
            className={`absolute w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full bg-white shadow-[0_0_10px_rgba(251,191,36,0.6)] transition-transform duration-100 -translate-x-1/2 pointer-events-none ${
              isDragging
                ? 'scale-125 opacity-100'
                : 'opacity-70 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-visible:opacity-100'
            }`}
            style={{ left: `${percentage}%` }}
          />
        )}
      </div>

      {/* Timestamps */}
      <div className="flex items-center justify-between text-xs font-mono text-neutral-400 tabular-nums -mt-2">
        <span>{formatTime(currentDisplayPosition)}</span>
        {!isAdmin && (
          <span className="text-[11px] font-sans text-neutral-500 hidden sm:inline">
            Playback synchronized by Host
          </span>
        )}
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
};
