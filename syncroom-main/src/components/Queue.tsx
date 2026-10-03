import React, { useState } from 'react';
import { QueueItem as QueueItemType, UserRole } from '../types';
import { QueueItem } from './QueueItem';
import { ListMusic, Plus, Clock, Trash2, AlertCircle } from 'lucide-react';

interface QueueProps {
  queue: QueueItemType[];
  role: UserRole;
  onPlayNow?: (item: QueueItemType) => void;
  onRemove?: (id: string) => void;
  onMoveUp?: (index: number) => void;
  onMoveDown?: (index: number) => void;
  onClearQueue?: () => void;
  onOpenAddTrack?: () => void;
  onOpenImportSpotify?: () => void;
  onOpenMyPlaylists?: () => void;
  className?: string;
}

export const Queue: React.FC<QueueProps> = ({
  queue,
  role,
  onPlayNow,
  onRemove,
  onMoveUp,
  onMoveDown,
  onClearQueue,
  onOpenAddTrack,
  onOpenImportSpotify,
  onOpenMyPlaylists,
  className = '',
}) => {
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const totalSeconds = queue.reduce((sum, item) => sum + item.track.duration, 0);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const isAdmin = role === 'admin';

  return (
    <div
      className={`flex flex-col h-full rounded-2xl bg-neutral-900/40 border border-neutral-800/80 backdrop-blur-xl p-4 sm:p-5 ${className}`}
    >
      {/* Queue Header */}
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-neutral-800/80">
        <div className="flex items-center gap-2.5">
          <ListMusic className="w-4 h-4 text-amber-400" />
          <h3 className="font-display font-semibold text-sm tracking-tight text-white">
            Upcoming Queue
          </h3>
          <span className="text-xs font-mono text-neutral-400 tabular-nums">
            ({queue.length})
          </span>
        </div>

        <div className="flex items-center gap-2">
          {queue.length > 0 && (
            <div className="hidden sm:flex items-center gap-1 text-[11px] font-mono text-neutral-400 tabular-nums mr-1">
              <Clock className="w-3 h-3 text-neutral-500" />
              <span>{totalMinutes} min</span>
            </div>
          )}

          {isAdmin && queue.length > 0 && onClearQueue && (
            <button
              type="button"
              onClick={() => setShowClearConfirm(true)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-neutral-400 hover:text-rose-400 hover:bg-rose-500/10 text-xs transition-colors"
              title="Clear entire queue"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Clear</span>
            </button>
          )}

          {isAdmin && onOpenImportSpotify && (
            <button
              type="button"
              onClick={onOpenImportSpotify}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#1db954]/15 hover:bg-[#1db954]/25 border border-[#1db954]/30 text-xs font-medium text-[#1ed760] transition-colors"
              title="Import Spotify Playlist into Queue"
            >
              <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
              </svg>
              <span>Import</span>
            </button>
          )}

          {onOpenMyPlaylists && (
            <button
              type="button"
              onClick={onOpenMyPlaylists}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-neutral-200 transition-colors"
              title="Open My SyncRoom Playlists"
            >
              <ListMusic className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">My Playlists</span>
            </button>
          )}

          {isAdmin && onOpenAddTrack && (
            <button
              type="button"
              onClick={onOpenAddTrack}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-neutral-200 transition-colors"
            >
              <Plus className="w-3.5 h-3.5 text-amber-400" />
              <span>Add Song</span>
            </button>
          )}
        </div>
      </div>

      {/* Clear Queue Confirmation Notice */}
      {showClearConfirm && (
        <div className="mb-3 p-3 rounded-xl bg-rose-950/30 border border-rose-800/40 flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-rose-300">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>Clear all {queue.length} songs from the queue?</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setShowClearConfirm(false)}
              className="px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setShowClearConfirm(false);
                onClearQueue?.();
              }}
              className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold"
            >
              Clear Queue
            </button>
          </div>
        </div>
      )}

      {/* Queue list container */}
      <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 min-h-[220px] max-h-[380px] sm:max-h-[460px]">
        {queue.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center text-neutral-500 min-h-[200px]">
            <ListMusic className="w-8 h-8 stroke-neutral-700 mb-2" />
            <p className="text-sm font-medium text-neutral-400">Queue is empty</p>
            <p className="text-xs text-neutral-500 mt-1 max-w-[240px]">
              {isAdmin
                ? 'Add songs from the catalog or import a Spotify playlist to build the room playlist.'
                : 'The host has not enqueued any songs yet.'}
            </p>
            {isAdmin && (
              <div className="flex items-center gap-2 mt-4 flex-wrap justify-center">
                {onOpenImportSpotify && (
                  <button
                    type="button"
                    onClick={onOpenImportSpotify}
                    className="px-3 py-1.5 rounded-lg bg-[#1db954]/20 hover:bg-[#1db954]/30 border border-[#1db954]/40 text-xs text-[#1ed760] font-medium transition-colors flex items-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                    </svg>
                    <span>Import Spotify Playlist</span>
                  </button>
                )}
                {onOpenAddTrack && (
                  <button
                    type="button"
                    onClick={onOpenAddTrack}
                    className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs text-amber-400 font-medium transition-colors"
                  >
                    + Browse Library
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          queue.map((item, index) => (
            <QueueItem
              key={item.id}
              item={item}
              index={index}
              totalItems={queue.length}
              role={role}
              onPlayNow={onPlayNow}
              onRemove={onRemove}
              onMoveUp={onMoveUp}
              onMoveDown={onMoveDown}
            />
          ))
        )}
      </div>
    </div>
  );
};
