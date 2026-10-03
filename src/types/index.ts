export type UserRole = 'admin' | 'listener';

export interface User {
  id: string;
  name: string;
  role: UserRole;
  joinedAt: number;
  isOnline: boolean;
  isSelf?: boolean;
  avatarColor?: string;
  device?: 'desktop' | 'mobile' | 'tablet' | 'speaker';
  driftMs?: number;
  isSynced?: boolean;
}

export type PlaybackStatus =
  | 'AVAILABLE'
  | 'UNAVAILABLE'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PROVIDER_RESTRICTED';

export type RestrictionReason = 'market' | 'product' | 'explicit' | 'unknown' | null;

export interface Track {
  id: string;
  provider: 'spotify' | 'local' | 'licensed' | 'youtube' | 'audio';
  providerTrackId: string;

  title: string;
  artist: string;
  artists: string[];

  album: string;
  albumArtUrl: string | null;

  durationMs: number;
  duration: number; // in seconds (for player UI and engine backwards compatibility)

  externalUrl: string | null;

  isPlayable: boolean;
  playbackStatus: PlaybackStatus;
  restrictionReason?: RestrictionReason;
  spotifyIsPlayable?: boolean | null;
  audioSource: 'spotify' | 'licensed' | 'local' | 'unavailable' | 'youtube' | 'audio';
  youtubeVideoId?: string;

  // Procedural gradient styling fallback for UI artwork display
  coverGradient?: {
    from: string;
    via?: string;
    to: string;
    accent: string;
    pattern: 'geometry' | 'rings' | 'waves' | 'grid' | 'aurora';
  };
  genre?: string;
  year?: number;
}

export type PlaylistImportStatus =
  | 'PLAYLIST_IMPORTED'
  | 'PLAYLIST_ACTUALLY_EMPTY'
  | 'PLAYLIST_ITEMS_UNAVAILABLE'
  | 'PLAYLIST_NOT_FOUND'
  | 'SPOTIFY_AUTH_REQUIRED'
  | 'SPOTIFY_API_ERROR';

export interface UserPlaylistSummary {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string | null;
  ownerName?: string;
  ownerId?: string;
  isOwner?: boolean;
  collaborative?: boolean;
  totalTracks?: number;
  externalUrl?: string | null;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string | null;
  ownerName?: string;
  ownerId?: string;
  collaborative?: boolean;
  totalTracks: number;
  tracks: Track[];
  externalUrl?: string | null;
  unplayableCount?: number;
  restrictionsSummary?: {
    market: number;
    product: number;
    explicit: number;
    unknown: number;
  };
  providerConfigured?: boolean;
  importStatus?: PlaylistImportStatus;
  statusMessage?: string;
}

export interface CustomPlaylistSummary {
  id: string;
  ownerId: string;
  name: string;
  description?: string | null;
  trackCount: number;
  totalDurationMs: number;
  artworkUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomPlaylistDetail extends CustomPlaylistSummary {
  tracks: Track[];
}

export interface MusicProvider {
  searchTracks(query: string): Promise<Track[]>;
  getPlaylist?(playlistId: string): Promise<Playlist>;
  getPlaylistItems?(playlistId: string): Promise<Track[]>;
}

export interface QueueItem {
  id: string; // unique queue item id
  track: Track;
  addedBy: {
    id: string;
    name: string;
    role: UserRole;
  };
  addedAt: number;
}

export interface PlayerState {
  trackId: string | null;
  isPlaying: boolean;
  position: number; // current position in seconds
  duration: number; // track total duration in seconds
  startedAt: number | null; // in milliseconds
  startAt?: number | null; // in milliseconds (scheduled future playback)
  serverTimestamp?: number; // in milliseconds
  version?: number; // monotonic state version
}

export interface Room {
  id: string;
  code: string;
  name: string;
  adminId: string;
  createdAt: number;
  users: User[];
  currentTrack: Track | null;
  queue: QueueItem[];
  queueVersion?: number;
  playerState: PlayerState;
}

export type ConnectionStatusType =
  | 'connected'
  | 'good'
  | 'degraded'
  | 'syncing'
  | 'reconnecting'
  | 'offline'
  | 'config_error';

export type AppView = 'landing' | 'create' | 'join' | 'room';

export interface StoredSession {
  roomCode: string;
  roomId: string;
  userId: string;
  role: UserRole;
  displayName: string;
  savedAt: number;
}

export interface ActivityItem {
  id: string;
  action: string;
  metadata?: any;
  createdAt: number;
}
