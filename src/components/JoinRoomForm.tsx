import React, { useState } from 'react';
import { Button } from './Button';
import { validateRoomCode, normalizeRoomCode } from '../utils/roomCode';
import { ArrowLeft, Headphones, Radio, Users, ChevronRight, AlertCircle } from 'lucide-react';

interface JoinRoomFormProps {
  onJoinRoom: (roomCode: string, displayName: string) => Promise<unknown> | void;
  onBack: () => void;
}

export const JoinRoomForm: React.FC<JoinRoomFormProps> = ({
  onJoinRoom,
  onBack,
}) => {
  const [roomCode, setRoomCode] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const codeParam = params.get('code');
      if (codeParam) return normalizeRoomCode(codeParam);
    }
    return '';
  });
  const [displayName, setDisplayName] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedName = displayName.trim();
    if (!trimmedName) {
      setErrorMessage('Please enter your name');
      return;
    }

    const normalizedCode = normalizeRoomCode(roomCode);
    const validation = validateRoomCode(normalizedCode);
    if (!validation.isValid) {
      setErrorMessage('Enter a valid 6-character room code');
      return;
    }

    setIsSubmitting(true);
    try {
      await onJoinRoom(normalizedCode, trimmedName);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Room not found';
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8 sm:py-12">
      {/* Back button */}
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition-colors mb-6 sm:mb-8 group min-h-[44px] py-2 touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50 rounded-lg"
      >
        <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
        <span>Back to Home</span>
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
        {/* Left column: Join Form */}
        <div className="lg:col-span-7">
          <div className="mb-6">
            <span className="text-xs font-semibold tracking-wider uppercase text-sky-400">
              Tune In
            </span>
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-white mt-1">
              Join a Listening Room
            </h1>
            <p className="text-sm text-neutral-400 mt-2">
              Enter the 6-character room code shared by your host to join synchronized audio playback.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Error Message Display */}
            {errorMessage && (
              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2.5">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Room Code */}
            <div>
              <label htmlFor="roomCode" className="block text-xs font-medium text-neutral-300 mb-1.5">
                Room Code
              </label>
              <input
                id="roomCode"
                type="text"
                maxLength={6}
                value={roomCode}
                onChange={(e) => {
                  setRoomCode(e.target.value.toUpperCase());
                  if (errorMessage) setErrorMessage(null);
                }}
                placeholder="e.g. A7K9P2"
                required
                className="w-full font-mono text-base uppercase tracking-wider bg-neutral-900/90 border border-neutral-800 rounded-xl px-4 py-3 text-white placeholder-neutral-500 focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400 transition-colors"
              />
              <p className="text-[11px] text-neutral-500 mt-1">
                Must be an exact 6-character uppercase code (e.g. A7K9P2)
              </p>
            </div>

            {/* Display Name */}
            <div>
              <label htmlFor="displayName" className="block text-xs font-medium text-neutral-300 mb-1.5">
                Your Display Name
              </label>
              <div className="relative">
                <input
                  id="displayName"
                  type="text"
                  value={displayName}
                  onChange={(e) => {
                    setDisplayName(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder="e.g. Rahul"
                  required
                  className="w-full bg-neutral-900/90 border border-neutral-800 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400 transition-colors"
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-neutral-400 flex items-center gap-1">
                  <Headphones className="w-3.5 h-3.5" />
                  <span className="text-[11px] font-medium hidden sm:inline">Listener</span>
                </span>
              </div>
            </div>

            {/* Submit button */}
            <div className="pt-2">
              <Button
                type="submit"
                variant="primary"
                size="lg"
                isLoading={isSubmitting}
                className="w-full bg-sky-400 hover:bg-sky-300 text-neutral-950 shadow-lg shadow-sky-500/20"
                rightIcon={<ChevronRight className="w-4 h-4" />}
              >
                Join Room &amp; Sync Playback
              </Button>
            </div>
          </form>
        </div>

        {/* Right column: Joining Guidance */}
        <div className="lg:col-span-5">
          <div className="sticky top-6 space-y-4">
            <div className="p-5 rounded-2xl bg-neutral-900/50 border border-neutral-800">
              <h3 className="font-display font-semibold text-white text-sm mb-3 flex items-center gap-2">
                <Radio className="w-4 h-4 text-sky-400" />
                <span>How SyncRoom Works</span>
              </h3>

              <ul className="space-y-3 text-xs text-neutral-300">
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-sky-500/20 text-sky-400 flex items-center justify-center font-bold text-[11px] shrink-0">
                    1
                  </span>
                  <span>
                    <strong className="text-white">6-Character Code:</strong> Ask your host for the room's unique code to connect.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-sky-500/20 text-sky-400 flex items-center justify-center font-bold text-[11px] shrink-0">
                    2
                  </span>
                  <span>
                    <strong className="text-white">Sub-10ms Precision:</strong> Web Audio SyncEngine locks your device to the host's playback clock in real-time.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-sky-500/20 text-sky-400 flex items-center justify-center font-bold text-[11px] shrink-0">
                    3
                  </span>
                  <span>
                    <strong className="text-white">Session Persistence:</strong> Reconnects automatically if your phone locks, goes offline, or browser refreshes.
                  </span>
                </li>
              </ul>
            </div>

            <div className="p-3.5 rounded-xl bg-neutral-950/60 border border-neutral-800/60 text-xs text-neutral-400 flex items-start gap-2.5">
              <Headphones className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
              <span>
                As a listener, you join in listening mode. The host maintains control of music playback and track queues.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

