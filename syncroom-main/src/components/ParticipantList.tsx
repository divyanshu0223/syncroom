import React, { useState } from 'react';
import { User } from '../types';
import { ParticipantItem } from './ParticipantItem';
import { Users, Copy, Check, Radio, UserPlus } from 'lucide-react';

interface ParticipantListProps {
  users?: User[];
  participants?: User[];
  roomCode: string;
  isAdminUser?: boolean;
  onRemoveUser?: (userId: string, name: string) => void;
  onOpenInvite?: () => void;
  className?: string;
}

export const ParticipantList: React.FC<ParticipantListProps> = ({
  users,
  participants,
  roomCode,
  isAdminUser = false,
  onRemoveUser,
  onOpenInvite,
  className = '',
}) => {
  const [copied, setCopied] = useState(false);
  const activeUsers = users || participants || [];

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const onlineUsers = activeUsers.filter((p) => p.isOnline !== false);
  const adminCount = onlineUsers.filter((p) => p.role === 'admin').length;
  const listenerCount = onlineUsers.filter((p) => p.role === 'listener').length;

  return (
    <div
      className={`flex flex-col h-full rounded-2xl bg-neutral-900/40 border border-neutral-800/80 backdrop-blur-xl p-4 sm:p-5 ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-neutral-800/80">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-amber-400" />
          <h3 className="font-display font-semibold text-sm tracking-tight text-white">
            Participants
          </h3>
          <span className="text-xs font-mono text-neutral-400 tabular-nums">
            ({onlineUsers.length} online)
          </span>
        </div>

        <div className="flex items-center gap-2">
          {onOpenInvite && (
            <button
              type="button"
              onClick={onOpenInvite}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-400/10 hover:bg-amber-400/20 border border-amber-400/25 text-xs text-amber-300 transition-colors"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Invite</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleCopyCode}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-mono text-neutral-300 transition-colors"
            title="Copy Room Invite Code"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400 font-sans">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3 text-neutral-400" />
                <span>{roomCode}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Sync summary bar */}
      <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-neutral-950/60 border border-neutral-800/60 text-xs mb-3">
        <div className="flex items-center gap-2 text-neutral-400">
          <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
          <span>Synchronized Room</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-neutral-400">
          <span>{adminCount} Host</span>
          <span className="text-neutral-700">·</span>
          <span>{listenerCount} Listeners</span>
        </div>
      </div>

      {/* Participants list */}
      <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 min-h-[160px] max-h-[300px]">
        {activeUsers.map((participant) => (
          <ParticipantItem
            key={participant.id}
            participant={participant}
            isAdminUser={isAdminUser}
            onRemove={onRemoveUser}
          />
        ))}
      </div>
    </div>
  );
};
