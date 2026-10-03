import React from 'react';
import { Track } from '../types';

interface ArtworkDisplayProps {
  track: Track | null;
  isPlaying?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'hero';
  className?: string;
  showVinylPeek?: boolean;
}

export const ArtworkDisplay: React.FC<ArtworkDisplayProps> = ({
  track,
  isPlaying = false,
  size = 'lg',
  className = '',
  showVinylPeek = true,
}) => {
  if (!track) {
    return (
      <div
        className={`aspect-square w-full rounded-2xl bg-neutral-900/80 border border-neutral-800 flex flex-col items-center justify-center p-6 text-center text-neutral-500 ${className}`}
      >
        <svg
          className="w-12 h-12 stroke-neutral-700 mb-2"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
          />
        </svg>
        <p className="text-sm font-medium">No track playing</p>
      </div>
    );
  }

  const [imageError, setImageError] = React.useState(false);

  // Reset image error when track changes
  React.useEffect(() => {
    setImageError(false);
  }, [track.id, track.albumArtUrl]);

  const fallbackGradient = {
    from: '#18181b',
    via: '#27272a',
    to: '#09090b',
    accent: '#1db954',
    pattern: 'geometry' as const,
  };

  const coverGradient = track.coverGradient || fallbackGradient;
  const { title, artist, albumArtUrl } = track;
  const hasValidImage = Boolean(albumArtUrl && !imageError);

  // Patterns for original artwork generator
  const renderPattern = () => {
    if (hasValidImage) return null;
    switch (coverGradient.pattern) {
      case 'geometry':
        return (
          <svg className="absolute inset-0 w-full h-full opacity-40 mix-blend-overlay" viewBox="0 0 200 200">
            <polygon points="0,0 200,200 0,200" fill="currentColor" className="text-neutral-100" />
            <polygon points="50,0 200,150 200,0" fill="currentColor" className="text-neutral-400" />
            <circle cx="100" cy="100" r="45" fill="none" stroke={coverGradient.accent} strokeWidth="3" />
            <line x1="0" y1="100" x2="200" y2="100" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
          </svg>
        );
      case 'rings':
        return (
          <svg className="absolute inset-0 w-full h-full opacity-50" viewBox="0 0 200 200">
            <circle cx="100" cy="100" r="85" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            <circle cx="100" cy="100" r="70" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1.5" />
            <circle cx="100" cy="100" r="55" fill="none" stroke={coverGradient.accent} strokeWidth="2.5" />
            <circle cx="100" cy="100" r="40" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
            <circle cx="100" cy="100" r="22" fill={coverGradient.accent} opacity="0.3" />
          </svg>
        );
      case 'aurora':
        return (
          <div className="absolute inset-0 overflow-hidden opacity-60">
            <div
              className="absolute -top-1/4 -left-1/4 w-[150%] h-[150%] rounded-full blur-3xl opacity-70"
              style={{
                background: `radial-gradient(circle, ${coverGradient.accent} 0%, rgba(99, 102, 241, 0.4) 40%, transparent 70%)`,
              }}
            />
          </div>
        );
      case 'waves':
        return (
          <svg className="absolute inset-0 w-full h-full opacity-40" viewBox="0 0 200 200">
            <path
              d="M0 60 Q 50 30, 100 60 T 200 60 L 200 200 L 0 200 Z"
              fill="rgba(255,255,255,0.05)"
            />
            <path
              d="M0 100 Q 50 70, 100 100 T 200 100"
              fill="none"
              stroke={coverGradient.accent}
              strokeWidth="2"
            />
            <path
              d="M0 130 Q 50 160, 100 130 T 200 130"
              fill="none"
              stroke="rgba(255,255,255,0.15)"
              strokeWidth="1.5"
            />
          </svg>
        );
      case 'grid':
      default:
        return (
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage: `linear-gradient(to right, rgba(255,255,255,0.2) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.2) 1px, transparent 1px)`,
              backgroundSize: '24px 24px',
            }}
          />
        );
    }
  };

  const containerSizes = {
    sm: 'w-12 h-12 rounded-lg',
    md: 'w-20 h-20 rounded-xl',
    lg: 'w-full max-w-[260px] xs:max-w-[300px] sm:max-w-[360px] lg:max-w-[400px] aspect-square rounded-2xl',
    hero: 'w-full max-w-[280px] aspect-square rounded-xl',
  };

  return (
    <div className={`relative flex items-center justify-center select-none ${className}`}>
      {/* Vinyl Disc Peek behind the sleeve */}
      {showVinylPeek && (size === 'lg' || size === 'hero') && (
        <div
          className={`absolute right-[-6%] sm:right-[-12%] top-1/2 -translate-y-1/2 w-[88%] sm:w-[90%] aspect-square rounded-full bg-neutral-950 border-2 border-neutral-800 shadow-2xl transition-transform duration-700 ease-out -z-10 ${
            isPlaying ? 'translate-x-4 sm:translate-x-8' : 'translate-x-0'
          }`}
          style={{
            backgroundImage:
              'repeating-radial-gradient(circle, #171717 0, #171717 3px, #0a0a0a 4px, #0a0a0a 6px)',
          }}
          aria-hidden="true"
        >
          {/* Vinyl center label */}
          <div
            className={`absolute inset-0 m-auto w-1/3 aspect-square rounded-full border border-neutral-700 flex items-center justify-center ${
              isPlaying ? 'animate-[spin_12s_linear_infinite]' : ''
            }`}
            style={{ backgroundColor: coverGradient.from }}
          >
            <div className="w-2.5 h-2.5 rounded-full bg-neutral-950 border border-neutral-600" />
          </div>
        </div>
      )}

      {/* Main Album Sleeve */}
      <div
        className={`relative overflow-hidden shadow-2xl shadow-black/80 border border-neutral-800/80 transition-transform duration-300 ${
          containerSizes[size]
        } ${isPlaying ? 'shadow-amber-500/5' : ''}`}
        style={{
          background: hasValidImage
            ? '#09090b'
            : `linear-gradient(145deg, ${coverGradient.from} 0%, ${
                coverGradient.via || coverGradient.to
              } 50%, ${coverGradient.to} 100%)`,
        }}
      >
        {/* Real Album Artwork Image if available */}
        {hasValidImage ? (
          <img
            src={albumArtUrl!}
            alt={`${title} by ${artist}`}
            className="w-full h-full object-cover select-none"
            referrerPolicy="no-referrer"
            onError={() => setImageError(true)}
            loading={size === 'sm' ? 'eager' : 'lazy'}
          />
        ) : (
          <>
            {/* Subtle physical sleeve texture overlay */}
            <div className="absolute inset-0 bg-gradient-to-tr from-black/50 via-transparent to-white/10 pointer-events-none" />

            {/* Abstract pattern */}
            {renderPattern()}
          </>
        )}

        {/* Gloss highlight on top left */}
        <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-white/10 to-transparent pointer-events-none" />

        {/* Subtle sleeve spine shadow */}
        <div className="absolute left-0 top-0 bottom-0 w-2 bg-gradient-to-r from-black/40 to-transparent pointer-events-none" />

        {/* Track info overlay on card when large */}
        {(size === 'lg' || size === 'hero') && (
          <div className="absolute inset-x-0 bottom-0 p-5 bg-gradient-to-t from-black/85 via-black/40 to-transparent flex flex-col justify-end">
            {track.genre && (
              <span className="text-[11px] font-medium tracking-wider uppercase text-neutral-400 mb-1">
                {track.genre}
              </span>
            )}
            <div className="flex items-center justify-between">
              <span className="text-xs text-neutral-300 font-mono tracking-tight">
                {track.album}
              </span>
              <span className="text-xs font-mono text-neutral-400 tabular-nums">
                {track.year}
              </span>
            </div>
          </div>
        )}

        {/* Compact thumbnail title for small sizes when artwork is missing */}
        {size === 'sm' && !hasValidImage && (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white/90">
            {title.charAt(0)}
          </div>
        )}
      </div>
    </div>
  );
};
