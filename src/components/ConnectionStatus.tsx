import React from 'react';
import { ConnectionStatusType } from '../types';

interface ConnectionStatusProps {
  status: ConnectionStatusType;
  driftMs?: number;
  className?: string;
  showDetails?: boolean;
}

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({
  status = 'connected',
  driftMs = 0,
  className = '',
  showDetails = true,
}) => {
  const statusConfig = {
    connected: {
      dotColor: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]',
      pulse: false,
      label: 'Connected',
    },
    good: {
      dotColor: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]',
      pulse: false,
      label: 'Good',
    },
    degraded: {
      dotColor: 'bg-amber-400',
      pulse: true,
      label: 'Degraded',
    },
    syncing: {
      dotColor: 'bg-amber-400',
      pulse: true,
      label: 'Adjusting Drift',
    },
    reconnecting: {
      dotColor: 'bg-amber-500',
      pulse: true,
      label: 'Reconnecting',
    },
    offline: {
      dotColor: 'bg-rose-500',
      pulse: false,
      label: 'Offline',
    },
    config_error: {
      dotColor: 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.7)]',
      pulse: true,
      label: 'Security Config Error',
    },
  };

  const current = statusConfig[status];

  return (
    <div
      className={`inline-flex items-center gap-2 text-xs text-neutral-300 ${className}`}
      title={`Connection status: ${current.label} (${driftMs}ms drift)`}
      aria-label={`Connection status: ${current.label}`}
    >
      <span className="relative flex h-2 w-2">
        {current.pulse && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
        )}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${current.dotColor}`} />
      </span>

      <span className="font-medium text-neutral-200">{current.label}</span>

      {showDetails && status === 'connected' && (
        <>
          <span className="text-neutral-600" aria-hidden="true">·</span>
          <span className="font-mono text-[11px] text-neutral-400 tabular-nums">
            {driftMs === 0 ? '0ms' : `${driftMs > 0 ? '+' : ''}${driftMs}ms`}
          </span>
        </>
      )}
    </div>
  );
};
