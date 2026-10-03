import React, { useState } from 'react';
import { Volume2, VolumeX, Radio, Headphones, ShieldCheck, Sparkles } from 'lucide-react';

interface ListeningViewProps {
  adminName: string;
  isUnlocked: boolean;
  onEnableAudio: () => void;
  volume: number;
  onVolumeChange: (vol: number) => void;
  syncOffsetMs?: number;
  className?: string;
}

export const ListeningView: React.FC<ListeningViewProps> = ({
  adminName,
  isUnlocked,
  onEnableAudio,
  volume,
  onVolumeChange,
  syncOffsetMs = 0,
  className = '',
}) => {
  const [isMuted, setIsMuted] = useState(false);
  const [previousVolume, setPreviousVolume] = useState(volume || 80);

  const handleToggleMute = () => {
    if (isMuted) {
      setIsMuted(false);
      onVolumeChange(previousVolume || 80);
    } else {
      setPreviousVolume(volume);
      setIsMuted(true);
      onVolumeChange(0);
    }
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (val === 0) {
      setIsMuted(true);
    } else if (isMuted) {
      setIsMuted(false);
    }
    onVolumeChange(val);
  };

  return (
    <div
      className={`w-full flex flex-col gap-4 p-4 sm:p-5 rounded-2xl bg-neutral-900/50 border border-neutral-800/80 backdrop-blur-md ${className}`}
    >
      {/* Listening Mode Banner */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-neutral-800/70">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <Headphones className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-neutral-100">Listening Mode</span>
              <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-medium bg-amber-400/10 text-amber-300 border border-amber-400/20">
                Listener
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 mt-0.5">
              Playback is controlled by Host <span className="text-neutral-200 font-medium">({adminName})</span>
            </p>
          </div>
        </div>

        {/* Sync Status Badge */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-400 font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>Synced</span>
        </div>
      </div>

      {/* Autoplay unlock notice if audio not yet initialized */}
      {!isUnlocked && (
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-amber-200">
            <VolumeX className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Browser audio is paused. Click to listen.</span>
          </div>
          <button
            type="button"
            onClick={onEnableAudio}
            className="px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-neutral-950 font-semibold text-xs transition-colors shrink-0"
          >
            Enable Audio
          </button>
        </div>
      )}

      {/* Personal Audio Controls (Only affects this device) */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs text-neutral-400">
          <span className="font-medium text-neutral-300">Your Local Device Volume</span>
          <span className="font-mono text-neutral-400">{Math.round(isMuted ? 0 : volume)}%</span>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleToggleMute}
            className="min-w-[44px] min-h-[44px] p-2.5 rounded-xl text-neutral-400 hover:text-white hover:bg-neutral-800 flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 touch-manipulation active:scale-95"
            title={isMuted ? 'Unmute' : 'Mute'}
            aria-label={isMuted ? 'Unmute personal audio' : 'Mute personal audio'}
          >
            {isMuted || volume <= 0 ? (
              <VolumeX className="w-5 h-5 text-rose-400" />
            ) : (
              <Volume2 className="w-5 h-5 text-neutral-300" />
            )}
          </button>

          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={isMuted ? 0 : volume}
            onChange={handleSliderChange}
            className="flex-1 h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-amber-400 focus:outline-none touch-none py-2"
            aria-label="Personal device volume slider"
          />
        </div>

        <p className="text-[11px] text-neutral-500 mt-1 leading-relaxed">
          Personal volume only affects your speaker/headphones. Synchronized room timing is preserved.
        </p>
      </div>
    </div>
  );
};
