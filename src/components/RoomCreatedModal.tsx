import React, { useState } from 'react';
import { Room, User } from '../types';
import { Button } from './Button';
import { useToast } from '../context/ToastContext';
import { Copy, Check, Share2, Crown, Sparkles, ArrowRight } from 'lucide-react';

interface RoomCreatedModalProps {
  room: Room;
  adminUser: User;
  onClose: () => void;
}

export const RoomCreatedModal: React.FC<RoomCreatedModalProps> = ({
  room,
  adminUser,
  onClose,
}) => {
  const { showToast } = useToast();
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      setCopiedCode(true);
      showToast({
        type: 'success',
        title: 'Room Code Copied',
        description: `Code ${room.code} copied to clipboard`,
      });
      setTimeout(() => setCopiedCode(false), 2500);
    } catch {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2500);
    }
  };

  const handleShareRoom = async () => {
    const inviteUrl = typeof window !== 'undefined'
      ? `${window.location.origin}?code=${room.code}`
      : `https://syncroom.app?code=${room.code}`;

    const shareData = {
      title: `Join ${room.name} on SyncRoom`,
      text: `Join my synchronized listening room "${room.name}" on SyncRoom with code: ${room.code}`,
      url: inviteUrl,
    };

    if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
        showToast({
          type: 'success',
          title: 'Room Shared',
          description: 'Share sheet opened successfully',
        });
        return;
      } catch (err: unknown) {
        // User cancelled or share failed, fallback to copy
        if ((err as Error)?.name === 'AbortError') return;
      }
    }

    // Fallback: copy link
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedLink(true);
      showToast({
        type: 'success',
        title: 'Invite Link Copied',
        description: `Direct invite link with room code ${room.code} copied!`,
      });
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      showToast({
        type: 'info',
        title: 'Room Code',
        description: room.code,
      });
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="room-created-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-md rounded-3xl bg-neutral-900 border border-neutral-800 shadow-2xl p-6 sm:p-8 flex flex-col text-center overflow-hidden">
        {/* Ambient Top Glow */}
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-48 h-48 bg-amber-500/20 blur-[80px] pointer-events-none rounded-full" />

        {/* Top Kicker */}
        <div className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold tracking-wider uppercase text-amber-400 mb-2">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Room Created</span>
        </div>

        {/* Room Name */}
        <h2 id="room-created-title" className="font-display font-extrabold text-2xl sm:text-3xl text-white tracking-tight text-balance">
          {room.name}
        </h2>

        {/* Admin Badge */}
        <div className="inline-flex items-center justify-center gap-1.5 mt-2 text-xs text-neutral-300">
          <span className="flex items-center gap-1 text-amber-400 font-medium">
            <Crown className="w-3.5 h-3.5" />
            <span>{adminUser.name}</span>
          </span>
          <span className="text-neutral-600">·</span>
          <span className="text-neutral-400">Admin</span>
        </div>

        {/* Prominent Room Code Display */}
        <div className="my-6 p-5 rounded-2xl bg-neutral-950 border border-neutral-800/80 shadow-inner flex flex-col items-center">
          <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-500 mb-1">
            Room Code
          </span>
          <span className="font-mono text-3xl sm:text-4xl font-extrabold tracking-widest text-amber-400 selection:bg-amber-400/30 selection:text-white">
            {room.code}
          </span>
          <p className="text-[11px] text-neutral-400 mt-2">
            Share this 6-character code with listeners to tune into your stream
          </p>
        </div>

        {/* Action Buttons: Copy Code & Share Room */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={handleCopyCode}
            leftIcon={
              copiedCode ? (
                <Check className="w-4 h-4 text-emerald-400" />
              ) : (
                <Copy className="w-4 h-4 text-neutral-300" />
              )
            }
          >
            {copiedCode ? 'Copied Code' : 'Copy Code'}
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={handleShareRoom}
            leftIcon={
              copiedLink ? (
                <Check className="w-4 h-4 text-emerald-400" />
              ) : (
                <Share2 className="w-4 h-4 text-neutral-300" />
              )
            }
          >
            {copiedLink ? 'Link Copied' : 'Share Room'}
          </Button>
        </div>

        {/* Enter Room Button */}
        <Button
          type="button"
          variant="primary"
          size="lg"
          onClick={onClose}
          rightIcon={<ArrowRight className="w-4 h-4" />}
          className="w-full shadow-lg shadow-amber-500/20"
        >
          Enter Room &amp; Start Session
        </Button>
      </div>
    </div>
  );
};
