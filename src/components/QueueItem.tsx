import React from 'react';
import { QueueItem as QueueItemType, UserRole } from '../types';
import { Play, Trash2, ArrowUp, ArrowDown, ExternalLink } from 'lucide-react';
import { ArtworkDisplay } from './ArtworkDisplay';

interface QueueItemProps {
  item: QueueItemType;
  index: number;
  totalItems: number;
  role: UserRole;
  onPlayNow?: (item: QueueItemType) => void;
  onRemove?: (id: string) => void;
  onMoveUp?: (index: number) => void;
  onMoveDown?: (index: number) => void;
}

export const QueueItem: React.FC<QueueItemProps> = ({
  item,
  index,
  totalItems,
  role,
  onPlayNow,
  onRemove,
  onMoveUp,
  onMoveDown,
}) => {
  const { track, addedBy } = item;
  const isAdmin = role === 'admin';

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div className="group relative flex items-center justify-between p-2.5 rounded-xl bg-neutral-900/30 hover:bg-neutral-800/50 border border-transparent hover:border-neutral-800/80 transition-all duration-150">
      {/* Left side: Position index, thumbnail, track info */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span className="font-mono text-xs text-neutral-500 w-4 text-center tabular-nums group-hover:text-neutral-400">
          {index + 1}
        </span>

        {/* Artwork Thumbnail */}
        <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 border border-neutral-800">
          <ArtworkDisplay
            track={track}
            size="sm"
            showVinylPeek={false}
          />
        </div>

        {/* Track & submitter metadata */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="text-sm font-medium text-neutral-200 truncate group-hover:text-white transition-colors">
              {track.title}
            </p>
            {track.provider === 'spotify' && (
              <span className="inline-flex items-center text-[10px] font-bold text-[#1ed760] bg-[#1db954]/15 border border-[#1db954]/30 px-1 py-0.5 rounded leading-none shrink-0">
                Spotify
              </span>
            )}
            {track.provider === 'youtube' && (
              <span className="inline-flex items-center text-[10px] font-bold text-[#ff4e4e] bg-[#ff0000]/15 border border-[#ff0000]/30 px-1 py-0.5 rounded leading-none shrink-0">
                YouTube
              </span>
            )}
            {track.playbackStatus === 'PROVIDER_RESTRICTED' && (
              <span className="inline-flex items-center text-[9px] font-semibold text-rose-300 bg-rose-500/20 border border-rose-500/30 px-1 py-0.5 rounded leading-none shrink-0">
                Restricted ({track.restrictionReason || 'Spotify'})
              </span>
            )}
            {track.playbackStatus === 'PROVIDER_NOT_CONFIGURED' && (
              <span className="inline-flex items-center text-[9px] font-semibold text-neutral-400 bg-neutral-800 border border-neutral-700/60 px-1 py-0.5 rounded leading-none shrink-0">
                Metadata Only
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-neutral-400">
            <span className="truncate">{track.artist}</span>
            <span className="text-neutral-700" aria-hidden="true">·</span>
            <span className="text-[11px] text-neutral-500 shrink-0">
              by {addedBy.name}
            </span>
            {track.externalUrl && (
              <>
                <span className="text-neutral-700" aria-hidden="true">·</span>
                <a
                  href={track.externalUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={`transition-colors inline-flex items-center gap-0.5 text-[11px] ${
                    track.provider === 'youtube' ? 'text-neutral-500 hover:text-[#ff4e4e]' : 'text-neutral-500 hover:text-[#1db954]'
                  }`}
                  title={track.provider === 'youtube' ? 'Open on YouTube' : 'Open on Spotify'}
                  onClick={(e) => e.stopPropagation()}
                >
                  <span>{track.provider === 'youtube' ? 'YouTube' : 'Spotify'}</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </>
            )}
            {!track.externalUrl && track.provider === 'youtube' && track.youtubeVideoId && (
              <>
                <span className="text-neutral-700" aria-hidden="true">·</span>
                <a
                  href={`https://www.youtube.com/watch?v=${track.youtubeVideoId}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-neutral-500 hover:text-[#ff4e4e] transition-colors inline-flex items-center gap-0.5 text-[11px]"
                  title="Open on YouTube"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span>YouTube</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Right side: Duration & Admin actions */}
      <div className="flex items-center gap-2 shrink-0 ml-3">
        <span className="font-mono text-xs text-neutral-400 tabular-nums">
          {formatDuration(track.duration)}
        </span>

        {/* Admin controls: visible directly on mobile, hover-revealed on desktop */}
        {isAdmin && (
          <div className="flex items-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity gap-1">
            {onMoveUp && index > 0 && (
              <button
                type="button"
                onClick={() => onMoveUp(index)}
                className="min-w-[36px] min-h-[36px] p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-700/60 active:bg-neutral-600/60 touch-manipulation flex items-center justify-center transition-colors"
                title="Move up"
                aria-label={`Move ${track.title} up in queue`}
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
            )}

            {onMoveDown && index < totalItems - 1 && (
              <button
                type="button"
                onClick={() => onMoveDown(index)}
                className="min-w-[36px] min-h-[36px] p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-700/60 active:bg-neutral-600/60 touch-manipulation flex items-center justify-center transition-colors"
                title="Move down"
                aria-label={`Move ${track.title} down in queue`}
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
            )}

            {onPlayNow && (
              <button
                type="button"
                onClick={() => onPlayNow(item)}
                className="min-w-[36px] min-h-[36px] p-2 rounded-lg text-amber-400 hover:text-amber-300 hover:bg-neutral-700/60 active:bg-neutral-600/60 touch-manipulation flex items-center justify-center transition-colors"
                title="Play track next"
                aria-label={`Play ${track.title} next`}
              >
                <Play className="w-3.5 h-3.5 fill-current" />
              </button>
            )}

            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                className="min-w-[36px] min-h-[36px] p-2 rounded-lg text-neutral-400 hover:text-rose-400 hover:bg-rose-500/10 active:bg-rose-500/20 touch-manipulation flex items-center justify-center transition-colors"
                title="Remove from queue"
                aria-label={`Remove ${track.title} from queue`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
