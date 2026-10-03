import React, { useState } from 'react';
import { User } from '../types';
import { Crown, Headphones, Smartphone, Laptop, Tablet, Radio, UserMinus, AlertCircle } from 'lucide-react';

interface ParticipantItemProps {
  participant: User;
  isAdminUser?: boolean;
  onRemove?: (userId: string, name: string) => void;
}

export const ParticipantItem: React.FC<ParticipantItemProps> = ({
  participant,
  isAdminUser = false,
  onRemove,
}) => {
  const { id, name, role, isSelf, device, isOnline = true, driftMs = 0 } = participant;
  const isTargetAdmin = role === 'admin';
  const [showConfirm, setShowConfirm] = useState(false);

  const getDeviceIcon = () => {
    switch (device) {
      case 'mobile':
        return <Smartphone className="w-3.5 h-3.5 text-neutral-400" />;
      case 'tablet':
        return <Tablet className="w-3.5 h-3.5 text-neutral-400" />;
      case 'speaker':
        return <Radio className="w-3.5 h-3.5 text-neutral-400" />;
      case 'desktop':
      default:
        return <Laptop className="w-3.5 h-3.5 text-neutral-400" />;
    }
  };

  const getInitials = (userName: string) => {
    return userName
      .split(' ')
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  };

  return (
    <div className="relative">
      <div
        className={`flex items-center justify-between p-2.5 rounded-xl border transition-all ${
          isOnline
            ? 'bg-neutral-900/40 hover:bg-neutral-800/40 border-transparent'
            : 'bg-neutral-950/40 border-neutral-900/60 opacity-60'
        }`}
      >
        {/* Avatar & Name & Role */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative shrink-0">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold text-white shadow-sm ${
                isTargetAdmin
                  ? 'bg-gradient-to-br from-amber-500 to-amber-700 ring-1 ring-amber-400/40'
                  : 'bg-neutral-800 text-neutral-300 border border-neutral-700'
              }`}
            >
              {getInitials(name)}
            </div>
            {/* Status Dot */}
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-neutral-950 ${
                isOnline ? 'bg-emerald-400' : 'bg-neutral-600'
              }`}
              title={isOnline ? 'Online' : 'Offline'}
            />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-neutral-200 truncate">
                {name}
              </span>
              {isSelf && (
                <span className="text-[10px] text-amber-400/90 font-mono">
                  (You)
                </span>
              )}
            </div>

            {/* Role & Online status */}
            <div className="flex items-center gap-2 text-[11px] text-neutral-400 mt-0.5">
              {isTargetAdmin ? (
                <span className="flex items-center gap-1 text-amber-400 font-medium">
                  <Crown className="w-3 h-3 shrink-0" />
                  <span>Admin</span>
                </span>
              ) : (
                <span className="flex items-center gap-1 text-neutral-400">
                  <Headphones className="w-3 h-3 shrink-0" />
                  <span>Listener</span>
                </span>
              )}

              <span className="text-neutral-700" aria-hidden="true">·</span>

              <span className={isOnline ? 'text-emerald-400/90' : 'text-neutral-500'}>
                {isOnline ? 'Online' : 'Offline'}
              </span>
            </div>
          </div>
        </div>

        {/* Device & Admin Remove Button */}
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <div
            className="p-1.5 rounded-lg bg-neutral-800/60"
            title={`Device: ${device || 'Desktop'}`}
          >
            {getDeviceIcon()}
          </div>

          {/* Admin Remove Button (Only for listeners, not self, not other admin) */}
          {isAdminUser && !isTargetAdmin && !isSelf && onRemove && (
            <button
              type="button"
              onClick={() => setShowConfirm(true)}
              className="min-w-[36px] min-h-[36px] p-2 rounded-lg text-neutral-400 hover:text-rose-400 hover:bg-rose-500/10 active:bg-rose-500/20 flex items-center justify-center transition-colors touch-manipulation"
              title={`Remove ${name} from room`}
              aria-label={`Remove ${name} from room`}
            >
              <UserMinus className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Confirmation Dialog Overlay */}
      {showConfirm && (
        <div className="absolute inset-0 z-10 flex items-center justify-between p-2 rounded-xl bg-neutral-900 border border-rose-500/40 shadow-xl backdrop-blur-md">
          <div className="flex items-center gap-2 text-xs text-rose-300 min-w-0 pr-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span className="truncate">Remove {name}?</span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowConfirm(false)}
              className="min-h-[36px] px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-medium transition-colors touch-manipulation"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setShowConfirm(false);
                onRemove?.(id, name);
              }}
              className="min-h-[36px] px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-colors touch-manipulation shadow-sm"
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
