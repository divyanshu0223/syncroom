import { ClientMessage, ServerMessage, ErrorCode } from '../types';

export const VALID_CLIENT_MESSAGE_TYPES = new Set([
  'CREATE_ROOM',
  'JOIN_ROOM',
  'RECONNECT_SESSION',
  'LEAVE_ROOM',
  'PING',
  'TIME_SYNC_REQUEST',
  'REPORT_DRIFT',
  'PLAYBACK_READY',
  'ADMIN_PLAY',
  'ADMIN_PAUSE',
  'ADMIN_SEEK',
  'ADMIN_NEXT',
  'ADMIN_PREVIOUS',
  'ADMIN_SELECT_TRACK',
  'ADMIN_SET_CURRENT_TRACK',
  'ADMIN_ADD_QUEUE',
  'ADMIN_REMOVE_QUEUE',
  'ADMIN_REORDER_QUEUE',
  'ADMIN_CLEAR_QUEUE',
  'ADMIN_IMPORT_QUEUE',
  'ADMIN_REMOVE_USER',
  'ADMIN_RENAME_ROOM',
  'ADMIN_END_ROOM',
  'GET_ACTIVITIES',
]);

const ALLOWED_DEVICES = new Set(['desktop', 'mobile', 'tablet', 'speaker']);

export function validateClientMessage(msg: ClientMessage): { isValid: boolean; error?: string } {
  switch (msg.type) {
    case 'CREATE_ROOM': {
      if (typeof msg.name !== 'string' || !msg.name.trim() || msg.name.trim().length > 100) {
        return { isValid: false, error: 'Room name must be between 1 and 100 characters' };
      }
      if (typeof msg.adminName !== 'string' || !msg.adminName.trim() || msg.adminName.trim().length > 50) {
        return { isValid: false, error: 'Admin name must be between 1 and 50 characters' };
      }
      if (msg.device && !ALLOWED_DEVICES.has(msg.device)) {
        return { isValid: false, error: 'Invalid device type' };
      }
      return { isValid: true };
    }

    case 'JOIN_ROOM': {
      if (typeof msg.code !== 'string' || !msg.code.trim() || msg.code.trim().length > 12) {
        return { isValid: false, error: 'Invalid room code format' };
      }
      if (typeof msg.displayName !== 'string' || !msg.displayName.trim() || msg.displayName.trim().length > 50) {
        return { isValid: false, error: 'Display name must be between 1 and 50 characters' };
      }
      if (msg.device && !ALLOWED_DEVICES.has(msg.device)) {
        return { isValid: false, error: 'Invalid device type' };
      }
      return { isValid: true };
    }

    case 'RECONNECT_SESSION': {
      const token = msg.sessionToken || msg.sessionId;
      if (typeof token !== 'string' || !token.trim() || token.length > 256) {
        return { isValid: false, error: 'Valid session token is required' };
      }
      return { isValid: true };
    }

    case 'ADMIN_SEEK': {
      if (typeof msg.position !== 'number' || !Number.isFinite(msg.position) || msg.position < 0 || msg.position > 86400) {
        return { isValid: false, error: 'Playback position must be a non-negative finite number (0-86400 seconds)' };
      }
      return { isValid: true };
    }

    case 'ADMIN_SELECT_TRACK': {
      if (typeof msg.trackId !== 'string' || !msg.trackId.trim() || msg.trackId.length > 128) {
        return { isValid: false, error: 'Invalid track ID' };
      }
      return { isValid: true };
    }

    case 'ADMIN_SET_CURRENT_TRACK': {
      const track = msg.track;
      if (!track || typeof track !== 'object') {
        return { isValid: false, error: 'Track payload is required' };
      }
      if (typeof track.id !== 'string' || !track.id.trim() || track.id.length > 128) {
        return { isValid: false, error: 'Invalid track ID' };
      }
      return { isValid: true };
    }

    case 'ADMIN_ADD_QUEUE': {
      const track = msg.track;
      if (!track || typeof track !== 'object') {
        return { isValid: false, error: 'Track payload is required' };
      }
      if (typeof track.id !== 'string' || !track.id.trim() || track.id.length > 128) {
        return { isValid: false, error: 'Invalid track ID' };
      }
      const trackTitle = (track as any).title || (track as any).name;
      if (typeof trackTitle !== 'string' || !trackTitle.trim() || trackTitle.length > 200) {
        return { isValid: false, error: 'Invalid track title' };
      }
      if (typeof track.duration !== 'number' || !Number.isFinite(track.duration) || track.duration <= 0 || track.duration > 86400) {
        return { isValid: false, error: 'Invalid track duration (must be positive number up to 86400s)' };
      }
      if (!Array.isArray(track.artists) || !track.artists.every((a) => typeof a === 'string' && a.length <= 100)) {
        return { isValid: false, error: 'Invalid artists array' };
      }
      return { isValid: true };
    }

    case 'ADMIN_IMPORT_QUEUE': {
      if (!Array.isArray(msg.tracks) || msg.tracks.length === 0 || msg.tracks.length > 200) {
        return { isValid: false, error: 'Tracks array must contain between 1 and 200 items' };
      }
      for (const track of msg.tracks) {
        const title = (track as any)?.title || (track as any)?.name;
        if (!track || typeof track !== 'object' || typeof track.id !== 'string' || typeof title !== 'string') {
          return { isValid: false, error: 'One or more imported tracks has an invalid structure' };
        }
      }
      return { isValid: true };
    }

    case 'ADMIN_REMOVE_QUEUE': {
      if (typeof msg.queueItemId !== 'string' || !msg.queueItemId.trim() || msg.queueItemId.length > 128) {
        return { isValid: false, error: 'Invalid queueItemId' };
      }
      return { isValid: true };
    }

    case 'ADMIN_REORDER_QUEUE': {
      if (!Array.isArray(msg.queueItemIds) || msg.queueItemIds.length > 500 || !msg.queueItemIds.every((id) => typeof id === 'string' && id.length <= 128)) {
        return { isValid: false, error: 'Invalid queueItemIds array' };
      }
      return { isValid: true };
    }

    case 'ADMIN_REMOVE_USER': {
      if (typeof msg.userId !== 'string' || !msg.userId.trim() || msg.userId.length > 128) {
        return { isValid: false, error: 'Invalid userId' };
      }
      return { isValid: true };
    }

    case 'ADMIN_RENAME_ROOM': {
      if (typeof msg.newName !== 'string' || !msg.newName.trim() || msg.newName.trim().length > 100) {
        return { isValid: false, error: 'Room name must be between 1 and 100 characters' };
      }
      return { isValid: true };
    }

    case 'TIME_SYNC_REQUEST': {
      if (typeof msg.clientSendTime !== 'number' || !Number.isFinite(msg.clientSendTime) || msg.clientSendTime <= 0) {
        return { isValid: false, error: 'Invalid clientSendTime' };
      }
      return { isValid: true };
    }

    case 'REPORT_DRIFT': {
      if (typeof msg.driftMs !== 'number' || !Number.isFinite(msg.driftMs) || Math.abs(msg.driftMs) > 300000) {
        return { isValid: false, error: 'Invalid driftMs measurement' };
      }
      return { isValid: true };
    }

    default:
      return { isValid: true };
  }
}

export type ParseClientMessageResult =
  | { success: true; data: ClientMessage; error?: never }
  | { success: false; error: string; data?: never };

export function parseClientMessage(raw: string): ParseClientMessageResult {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
      return { success: false, error: 'Invalid JSON payload structure' };
    }

    if (!VALID_CLIENT_MESSAGE_TYPES.has(parsed.type)) {
      return { success: false, error: `Unknown event type: ${String(parsed.type).slice(0, 50)}` };
    }

    const validation = validateClientMessage(parsed as ClientMessage);
    if (!validation.isValid) {
      return { success: false, error: validation.error || 'Invalid payload data' };
    }

    return { success: true, data: parsed as ClientMessage };
  } catch {
    return { success: false, error: 'Malformed JSON payload' };
  }
}

export function formatErrorMessage(code: ErrorCode, message: string): ServerMessage {
  return {
    type: 'ERROR',
    code,
    message,
  };
}

