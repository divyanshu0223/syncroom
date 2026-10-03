import React from 'react';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
  className?: string;
  showTagline?: boolean;
}

export const Logo: React.FC<LogoProps> = ({
  size = 'md',
  onClick,
  className = '',
  showTagline = false,
}) => {
  const iconSizes = {
    sm: 'w-6 h-6',
    md: 'w-8 h-8',
    lg: 'w-10 h-10',
  };

  const textSizes = {
    sm: 'text-base',
    md: 'text-xl',
    lg: 'text-2xl',
  };

  const content = (
    <div className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      {/* Original Soundwave Sync Emblem */}
      <div
        className={`${iconSizes[size]} relative flex items-center justify-center rounded-xl bg-gradient-to-br from-neutral-800 to-neutral-900 border border-neutral-700/60 shadow-lg shadow-black/40 overflow-hidden shrink-0`}
      >
        {/* Subtle interior glow */}
        <div className="absolute inset-0 bg-radial from-amber-500/10 via-transparent to-transparent opacity-80" />
        
        {/* Concentric sound sync bars */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-5/6 h-5/6 text-neutral-100"
        >
          {/* Central sync core */}
          <circle cx="12" cy="12" r="2.5" fill="currentColor" className="text-amber-400" />
          {/* Synchronized waveforms */}
          <path d="M7.5 9a6.5 6.5 0 0 0 0 6" className="text-neutral-300" />
          <path d="M16.5 9a6.5 6.5 0 0 1 0 6" className="text-neutral-300" />
          <path d="M4 6.5a11 11 0 0 0 0 11" className="text-neutral-500" />
          <path d="M20 6.5a11 11 0 0 1 0 11" className="text-neutral-500" />
        </svg>
      </div>

      <div className="flex flex-col">
        <div className="flex items-center gap-1.5">
          <span className={`font-display font-bold tracking-tight text-white ${textSizes[size]}`}>
            Sync<span className="text-amber-400">Room</span>
          </span>
        </div>
        {showTagline && (
          <span className="text-[11px] text-neutral-400 tracking-wide">
            Multi-device listening
          </span>
        )}
      </div>
    </div>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="group text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 rounded-xl transition-transform hover:opacity-90 active:scale-[0.98]"
        aria-label="SyncRoom Home"
      >
        {content}
      </button>
    );
  }

  return content;
};
