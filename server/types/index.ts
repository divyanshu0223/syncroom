import { Track, QueueItem } from '../../src/types';

export type UserRole = 'admin' | 'listener';

export interface ServerUser {
  id: string;
  name: string;
  role: UserRole;
  roomId: string;
  connected: boolean;
  lastSeen: number;
  sessionId: string;
  device?: 'desktop' | 'mobile' | 'tablet' | 'speaker';
  driftMs?: number;
}

export interface SessionData {
  sessionId: string;
  userId: string;
  roomId: string;
  role: UserRole;
  name: string;
  createdAt: number;
  lastSeen: number;
}

export interface ClientUser {
  id: string;
  name: string;
  role: UserRole;
  joinedAt: number;
  isOnline: boolean;
  isSelf?: boolean;
  device?: 'desktop' | 'mobile' | 'tablet' | 'speaker';
  driftMs?: number;
}

export interface PlaybackState {
  trackId: string | null;
  isPlaying: boolean;
  position: number; // in seconds
  serverTimestamp: number; // in milliseconds
  startedAt: number | null; // in milliseconds
  startAt: number | null; // in milliseconds (future scheduled playback time)
  duration: number; // in seconds
  version: number; // monotonic version
}

export interface ClientRoomState {
  id: string;
  code: string;
  name: string;
  adminId: string;
  createdAt: number;
  users: ClientUser[];
  currentTrack: Track | null;
  queue: QueueItem[];
  queueVersion?: number;
  playerState: PlaybackState;
}

export type ErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'INVALID_ROOM_CODE'
  | 'SESSION_NOT_FOUND'
  | 'FORBIDDEN'
  | 'INVALID_MESSAGE'
  | 'INVALID_SESSION'
  | 'ROOM_FULL'
  | 'ROOM_ENDED'
  | 'USER_REMOVED'
  | 'RATE_LIMITED'
  | 'DATABASE_NOT_CONFIGURED'
  | 'DATABASE_ERROR'
  | 'PLAYBACK_NOT_AVAILABLE'
  | 'INTERNAL_ERROR';

export interface ActivityItem {
  id: string;
  action: string;
  metadata?: any;
  createdAt: number;
}

// WebSocket Client -> Server Messages
export type ClientMessage =
  | { type: 'CREATE_ROOM'; name: string; adminName: string; device?: 'desktop' | 'mobile' | 'tablet' | 'speaker' }
  | { type: 'JOIN_ROOM'; code: string; displayName: string; device?: 'desktop' | 'mobile' | 'tablet' | 'speaker' }
  | { type: 'RECONNECT_SESSION'; sessionId?: string; sessionToken?: string }
  | { type: 'LEAVE_ROOM' }
  | { type: 'PING' }
  | { type: 'TIME_SYNC_REQUEST'; clientSendTime: number }
  | { type: 'REPORT_DRIFT'; driftMs: number }
  | { type: 'PLAYBACK_READY'; trackId: string }
  | { type: 'ADMIN_PLAY' }
  | { type: 'ADMIN_PAUSE' }
  | { type: 'ADMIN_SEEK'; position: number }
  | { type: 'ADMIN_NEXT' }
  | { type: 'ADMIN_PREVIOUS' }
  | { type: 'ADMIN_SELECT_TRACK'; trackId: string }
  | { type: 'ADMIN_SET_CURRENT_TRACK'; track: Track; autoplay?: boolean }
  | { type: 'ADMIN_ADD_QUEUE'; track: Track }
  | { type: 'ADMIN_REMOVE_QUEUE'; queueItemId: string }
  | { type: 'ADMIN_REORDER_QUEUE'; queueItemIds: string[] }
  | { type: 'ADMIN_CLEAR_QUEUE' }
  | { type: 'ADMIN_IMPORT_QUEUE'; tracks: Track[]; replace?: boolean }
  | { type: 'ADMIN_REMOVE_USER'; userId: string }
  | { type: 'ADMIN_RENAME_ROOM'; newName: string }
  | { type: 'ADMIN_END_ROOM' }
  | { type: 'GET_ACTIVITIES' };

// WebSocket Server -> Client Messages
export type ServerMessage =
  | { type: 'ROOM_CREATED'; room: ClientRoomState; user: ClientUser; sessionId: string; sessionToken?: string }
  | { type: 'ROOM_JOINED'; room: ClientRoomState; user: ClientUser; sessionId: string; sessionToken?: string }
  | { type: 'ROOM_STATE'; room: ClientRoomState; user: ClientUser; sessionId: string; sessionToken?: string }
  | { type: 'ROOM_UPDATED'; room: ClientRoomState }
  | { type: 'ROOM_ENDED'; message: string }
  | { type: 'USER_JOINED'; user: ClientUser }
  | { type: 'USER_LEFT'; userId: string }
  | { type: 'USER_UPDATED'; user: ClientUser }
  | { type: 'USER_REMOVED'; userId: string; message: string }
  | {
      type: 'PLAYBACK_STATE';
      state: PlaybackState;
      // Flat properties for backward compatibility
      isPlaying?: boolean;
      position?: number;
      currentTrackId?: string | null;
      startedAt?: number | null;
    }
  | { type: 'PLAYBACK_CHANGED'; state: PlaybackState }
  | { type: 'TIME_SYNC_RESPONSE'; clientSendTime: number; serverTime: number }
  | { type: 'SYNC_REQUIRED'; reason: string }
  | { type: 'QUEUE_UPDATED'; queue: QueueItem[]; currentTrack: Track | null; queueVersion?: number }
  | { type: 'QUEUE_CHANGED'; queue: QueueItem[]; currentTrack: Track | null; queueVersion: number }
  | { type: 'ACTIVITIES_LOADED'; activities: ActivityItem[] }
  | { type: 'ERROR'; code: ErrorCode; message: string }
  | { type: 'PONG'; timestamp: number };
