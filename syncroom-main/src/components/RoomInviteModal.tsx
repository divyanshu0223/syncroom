import React, { useState } from 'react';
import { X, Copy, Check, Share2, Users, QrCode } from 'lucide-react';
import { useToast } from '../context/ToastContext';

interface RoomInviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomCode: string;
  roomName: string;
}

export const RoomInviteModal: React.FC<RoomInviteModalProps> = ({
  isOpen,
  onClose,
  roomCode,
  roomName,
}) => {
  const { showToast } = useToast();
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  if (!isOpen) return null;

  const inviteUrl = typeof window !== 'undefined'
    ? `${window.location.origin}?code=${roomCode}`
    : `https://syncroom.app?code=${roomCode}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedLink(true);
      showToast({
        type: 'success',
        title: 'Invite Link Copied!',
        description: 'Share this link with friends to listen together in sync.',
      });
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      showToast({
        type: 'error',
        title: 'Failed to Copy',
        description: 'Please copy the link manually.',
      });
    }
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopiedCode(true);
      showToast({
        type: 'success',
        title: 'Room Code Copied!',
        description: `Code: ${roomCode}`,
      });
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      showToast({
        type: 'error',
        title: 'Failed to Copy',
        description: 'Please copy the code manually.',
      });
    }
  };

  const handleNativeShare = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: `Join ${roomName} on SyncRoom`,
          text: `Listen along with me in real-time on SyncRoom! Room code: ${roomCode}`,
          url: inviteUrl,
        });
      } catch (err) {
        // User cancelled share
      }
    } else {
      handleCopyLink();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-md rounded-3xl bg-neutral-900 border border-neutral-800 p-6 shadow-2xl flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 id="invite-modal-title" className="text-base font-bold text-white">
                Invite Listeners
              </h2>
              <p className="text-xs text-neutral-400">Share your room to sync music with friends</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Room Code Display */}
        <div className="flex flex-col items-center justify-center p-4 rounded-2xl bg-neutral-950/60 border border-neutral-800/80 text-center gap-2">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-neutral-400">
            Room Code
          </span>
          <div className="flex items-center gap-3">
            <span className="text-3xl sm:text-4xl font-mono font-bold tracking-widest text-amber-400">
              {roomCode}
            </span>
            <button
              type="button"
              onClick={handleCopyCode}
              className="p-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white transition-colors"
              title="Copy Room Code"
              aria-label="Copy Room Code"
            >
              {copiedCode ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Invite Link input */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-neutral-300">Invite Link</label>
          <div className="flex items-center gap-2 p-1.5 rounded-xl bg-neutral-950 border border-neutral-800">
            <input
              type="text"
              readOnly
              value={inviteUrl}
              className="flex-1 bg-transparent px-2.5 py-1 text-xs text-neutral-300 font-mono truncate focus:outline-none"
            />
            <button
              type="button"
              onClick={handleCopyLink}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium transition-colors shrink-0"
            >
              {copiedLink ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          {typeof navigator !== 'undefined' && 'share' in navigator && (
            <button
              type="button"
              onClick={handleNativeShare}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-neutral-950 font-semibold text-xs transition-colors"
            >
              <Share2 className="w-4 h-4" />
              <span>Share Room</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleCopyLink}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-medium text-xs transition-colors"
          >
            <Copy className="w-4 h-4" />
            <span>Copy Link</span>
          </button>
        </div>
      </div>
    </div>
  );
};
