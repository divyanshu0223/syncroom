import React, { useState } from 'react';
import { Button } from './Button';
import { ArrowLeft, Sparkles, Crown, Radio, Disc3 } from 'lucide-react';

interface CreateRoomFormProps {
  onCreateRoom: (roomName: string, adminName: string) => Promise<unknown> | void;
  onBack: () => void;
}

export const CreateRoomForm: React.FC<CreateRoomFormProps> = ({
  onCreateRoom,
  onBack,
}) => {
  const [roomName, setRoomName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const suggestions = [
    'Deep Work Focus',
    'Midnight Beats',
    'Acoustic Den',
    'Studio Sessions',
    'Weekend Jam',
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedRoom = roomName.trim();
    const trimmedAdmin = adminName.trim();

    if (!trimmedRoom) {
      setErrorMessage('Please enter a room name');
      return;
    }

    if (!trimmedAdmin) {
      setErrorMessage('Please enter your name');
      return;
    }

    setIsSubmitting(true);
    try {
      await onCreateRoom(trimmedRoom, trimmedAdmin);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create room';
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
        className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition-colors mb-6 sm:mb-8 group min-h-[44px] py-2 touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 rounded-lg"
      >
        <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
        <span>Back to Home</span>
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
        {/* Left column: Form */}
        <div className="lg:col-span-7">
          <div className="mb-6">
            <span className="text-xs font-semibold tracking-wider uppercase text-amber-400">
              Host a Session
            </span>
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-white mt-1">
              Create a SyncRoom
            </h1>
            <p className="text-sm text-neutral-400 mt-2">
              You will be the session Host. You control track selection, queue order, and real-time playback synchronization.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Error banner */}
            {errorMessage && (
              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Room Name */}
            <div>
              <label htmlFor="roomName" className="block text-xs font-medium text-neutral-300 mb-1.5">
                Room Name
              </label>
              <input
                id="roomName"
                type="text"
                value={roomName}
                onChange={(e) => {
                  setRoomName(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                placeholder="e.g. Late Night Vibes"
                required
                className="w-full bg-neutral-900/90 border border-neutral-800 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition-colors"
              />

              {/* Suggestions */}
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <span className="text-[11px] text-neutral-500 mr-1">Suggestions:</span>
                {suggestions.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => {
                      setRoomName(name);
                      if (errorMessage) setErrorMessage(null);
                    }}
                    className="text-[11px] px-2 py-0.5 rounded-md bg-neutral-900 border border-neutral-800/80 text-neutral-400 hover:text-amber-300 hover:border-neutral-700 transition-colors"
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>

            {/* Host Display Name */}
            <div>
              <label htmlFor="adminName" className="block text-xs font-medium text-neutral-300 mb-1.5">
                Your Display Name (Host)
              </label>
              <div className="relative">
                <input
                  id="adminName"
                  type="text"
                  value={adminName}
                  onChange={(e) => {
                    setAdminName(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder="e.g. Alex"
                  required
                  className="w-full bg-neutral-900/90 border border-neutral-800 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition-colors"
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-amber-400 flex items-center gap-1">
                  <Crown className="w-3.5 h-3.5" />
                  <span className="text-[11px] font-medium hidden sm:inline">Room Admin</span>
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
                className="w-full shadow-lg shadow-amber-500/20"
                rightIcon={<Sparkles className="w-4 h-4" />}
              >
                Create Room &amp; Launch Player
              </Button>
            </div>
          </form>
        </div>

        {/* Right column: Live Room Preview */}
        <div className="lg:col-span-5">
          <div className="sticky top-6">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-neutral-400">
                Live Room Preview
              </span>
              <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                Ready to stream
              </span>
            </div>

            {/* Preview Card */}
            <div className="rounded-2xl bg-neutral-900/60 border border-neutral-800/80 p-5 shadow-2xl backdrop-blur-xl relative overflow-hidden">
              {/* Header preview */}
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-neutral-800">
                <div className="min-w-0">
                  <p className="text-xs font-mono text-neutral-500 uppercase tracking-wider">
                    Room Code: SYNC-••••
                  </p>
                  <h4 className="font-display font-bold text-white text-base truncate mt-0.5">
                    {roomName || 'Untitled Room'}
                  </h4>
                </div>
                <div className="w-8 h-8 rounded-xl bg-amber-400/10 border border-amber-400/30 flex items-center justify-center text-amber-400">
                  <Crown className="w-4 h-4" />
                </div>
              </div>

              {/* Artwork preview banner */}
              <div className="aspect-[16/9] w-full rounded-xl bg-gradient-to-br from-neutral-800 via-neutral-900 to-black border border-neutral-800 relative overflow-hidden flex items-center justify-center mb-4">
                <div className="absolute inset-0 bg-radial from-amber-500/10 via-transparent to-transparent" />
                <Disc3 className="w-12 h-12 text-neutral-700 animate-[spin_10s_linear_infinite]" />
                <div className="absolute bottom-2.5 left-3 right-3 flex items-center justify-between text-[11px] text-neutral-400 font-mono">
                  <span>Host: {adminName || 'Admin'}</span>
                  <span>1 Device</span>
                </div>
              </div>

              {/* Host privileges notice */}
              <div className="space-y-2 text-xs text-neutral-400">
                <div className="flex items-center gap-2">
                  <Radio className="w-3.5 h-3.5 text-amber-400" />
                  <span>Full playback, scrubbing, and skip authority</span>
                </div>
                <div className="flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>Instant invite link generated upon creation</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
