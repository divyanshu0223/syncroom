/**
 * Client Session Service (Phase 6)
 * Manages persistent user device session tokens for SyncRoom.
 *
 * The raw session token is saved securely in the browser and passed to the server
 * upon WebSocket reconnection. The server hashes the token with SHA-256 and validates
 * it against the PostgreSQL database.
 */

export interface StoredSession {
  sessionToken: string;
  userId: string;
  roomId: string;
  roomCode?: string;
  role?: 'admin' | 'listener';
  userName?: string;
  createdAt: number;
}

const STORAGE_KEY = 'syncroom_device_session_v6';
const LEGACY_STORAGE_KEY = 'syncroom_session_id';

/**
 * Saves the active session to browser storage.
 */
export function saveSession(session: {
  sessionToken: string;
  userId: string;
  roomId: string;
  roomCode?: string;
  role?: 'admin' | 'listener';
  userName?: string;
}): void {
  if (typeof window === 'undefined') return;

  const data: StoredSession = {
    sessionToken: session.sessionToken,
    userId: session.userId,
    roomId: session.roomId,
    roomCode: session.roomCode,
    role: session.role,
    userName: session.userName,
    createdAt: Date.now(),
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    // Also save legacy key for backward compatibility
    localStorage.setItem(LEGACY_STORAGE_KEY, session.sessionToken);
  } catch (err) {
    console.error('[SyncRoom Session] Failed to save session:', err);
  }
}

/**
 * Retrieves the currently active stored session, if any.
 */
export function getSession(): StoredSession | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredSession;
      if (parsed.sessionToken && parsed.userId && parsed.roomId) {
        return parsed;
      }
    }

    // Fallback: check legacy session id key
    const legacyToken = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyToken) {
      return {
        sessionToken: legacyToken,
        userId: '',
        roomId: '',
        createdAt: Date.now(),
      };
    }
  } catch (err) {
    console.error('[SyncRoom Session] Failed to read session:', err);
  }

  return null;
}

/**
 * Clears the stored session on leave or logout.
 */
export function clearSession(): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch (err) {
    console.error('[SyncRoom Session] Failed to clear session:', err);
  }
}

/**
 * Checks if a session currently exists in storage.
 */
export function hasSession(): boolean {
  return getSession() !== null;
}
