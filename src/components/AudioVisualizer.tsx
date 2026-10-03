import React from 'react';

interface AudioVisualizerProps {
  isPlaying: boolean;
  barCount?: number;
  className?: string;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  isPlaying,
  barCount = 18,
  className = '',
}) => {
  // Pre-calculated heights for sleek visual distribution
  const baseHeights = [
    25, 45, 70, 90, 60, 35, 80, 100, 75, 40, 65, 85, 95, 55, 30, 70, 50, 35,
  ];

  return (
    <div
      className={`flex items-end gap-[3px] h-6 px-1 ${className}`}
      aria-label={isPlaying ? 'Audio playing' : 'Audio paused'}
    >
      {Array.from({ length: barCount }).map((_, index) => {
        const heightPercent = baseHeights[index % baseHeights.length];
        return (
          <div
            key={index}
            className={`w-[2.5px] rounded-full transition-all duration-300 ease-out ${
              isPlaying
                ? 'bg-amber-400'
                : 'bg-neutral-600/60'
            }`}
            style={{
              height: isPlaying ? `${Math.max(15, heightPercent)}%` : '20%',
              animation: isPlaying
                ? `pulseBar ${0.8 + ((index * 0.13) % 0.7)}s ease-in-out ${(index * 0.08) % 0.5}s infinite alternate`
                : 'none',
            }}
          />
        );
      })}
      <style>{`
        @keyframes pulseBar {
          0% { height: 18%; opacity: 0.5; }
          100% { height: 100%; opacity: 1; }
        }
      `}</style>
    </div>
  );
};
