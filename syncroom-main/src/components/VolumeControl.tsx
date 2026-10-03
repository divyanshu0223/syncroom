import React, { useState } from 'react';
import { Volume2, Volume1, VolumeX } from 'lucide-react';

interface VolumeControlProps {
  initialVolume?: number;
  onVolumeChange?: (volume: number) => void;
  className?: string;
}

export const VolumeControl: React.FC<VolumeControlProps> = ({
  initialVolume = 80,
  onVolumeChange,
  className = '',
}) => {
  const [volume, setVolume] = useState<number>(initialVolume);
  const [previousVolume, setPreviousVolume] = useState<number>(initialVolume);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setVolume(val);
    onVolumeChange?.(val);
  };

  const toggleMute = () => {
    if (volume > 0) {
      setPreviousVolume(volume);
      setVolume(0);
      onVolumeChange?.(0);
    } else {
      const restored = previousVolume || 50;
      setVolume(restored);
      onVolumeChange?.(restored);
    }
  };

  const getVolumeIcon = () => {
    if (volume === 0) return <VolumeX className="w-4 h-4 text-neutral-500" />;
    if (volume < 50) return <Volume1 className="w-4 h-4 text-neutral-300" />;
    return <Volume2 className="w-4 h-4 text-neutral-200" />;
  };

  return (
    <div className={`flex items-center gap-2 select-none ${className}`}>
      <button
        type="button"
        onClick={toggleMute}
        className="min-w-[36px] min-h-[36px] p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800/60 flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 touch-manipulation active:scale-95"
        aria-label={volume === 0 ? 'Unmute' : 'Mute'}
      >
        {getVolumeIcon()}
      </button>

      <div className="relative w-20 sm:w-24 flex items-center">
        <input
          type="range"
          min="0"
          max="100"
          value={volume}
          onChange={handleSliderChange}
          className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-amber-400 touch-none py-1.5"
          aria-label="Volume slider"
        />
      </div>
      <span className="text-[11px] font-mono text-neutral-400 w-7 text-right tabular-nums">
        {volume}%
      </span>
    </div>
  );
};
