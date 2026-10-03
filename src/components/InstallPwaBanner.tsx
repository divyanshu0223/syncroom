import React from 'react';
import { Download, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface InstallPwaBannerProps {
  className?: string;
  variant?: 'banner' | 'pill';
}

export const InstallPwaBanner: React.FC<InstallPwaBannerProps> = ({
  className = '',
  variant = 'banner',
}) => {
  const { canInstall, installApp, dismissInstall } = usePWAInstall();

  if (!canInstall) {
    return null;
  }

  if (variant === 'pill') {
    return (
      <button
        type="button"
        onClick={() => installApp()}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-400/10 hover:bg-amber-400/20 border border-amber-400/30 text-xs font-medium text-amber-300 transition-colors ${className}`}
        title="Install SyncRoom as a standalone app"
      >
        <Download className="w-3.5 h-3.5 text-amber-400" />
        <span>Install App</span>
      </button>
    );
  }

  return (
    <div
      role="region"
      aria-label="App installation banner"
      className={`w-full bg-gradient-to-r from-neutral-900 via-neutral-900/95 to-neutral-900 border-b border-neutral-800/80 px-4 py-2 text-xs flex items-center justify-between gap-3 text-neutral-300 z-40 ${className}`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-6 h-6 rounded-lg bg-amber-400/20 text-amber-400 flex items-center justify-center shrink-0">
          <Download className="w-3.5 h-3.5" />
        </div>
        <p className="truncate">
          <span className="font-semibold text-white">Install SyncRoom:</span> Add to your home screen for full-screen synchronized playback.
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => installApp()}
          className="px-3 py-1 rounded-lg bg-amber-400 hover:bg-amber-300 text-neutral-950 font-semibold text-xs transition-colors shadow-sm"
        >
          Install
        </button>
        <button
          type="button"
          onClick={dismissInstall}
          className="p-1 rounded-md text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
          aria-label="Dismiss install banner"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
