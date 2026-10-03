import { getApiBaseUrl } from '../config/runtime';

const USER_TOKEN_KEY = 'syncroom_user_token_v1';
const USER_NAME_KEY = 'syncroom_user_name_v1';
const USER_ID_KEY = 'syncroom_user_id_v1';

export interface PersistentUser {
  id: string;
  name: string;
  createdAt?: string;
}

function generateRandomHex(length: number): string {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
    const arr = new Uint8Array(length);
    window.crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

class PersistentUserService {
  /**
   * Returns the permanent user token for this browser.
   * Auto-generates a high-entropy cryptographically secure token on first visit.
   * This token is NEVER cleared on room exit or room closure.
   */
  public getUserToken(): string {
    if (typeof window === 'undefined') return '';

    let token = localStorage.getItem(USER_TOKEN_KEY);
    if (!token || token.length < 16) {
      token = `syncroom_usr_${generateRandomHex(24)}`;
      try {
        localStorage.setItem(USER_TOKEN_KEY, token);
      } catch (err) {
        console.error('[SyncRoom] Failed to persist user token to localStorage:', err);
      }
    }
    return token;
  }

  public getCachedUser(): PersistentUser | null {
    if (typeof window === 'undefined') return null;
    const id = localStorage.getItem(USER_ID_KEY);
    const name = localStorage.getItem(USER_NAME_KEY) || 'SyncRoom User';
    if (!id) return null;
    return { id, name };
  }

  /**
   * Fetches the user profile from PostgreSQL (via /api/user/me),
   * auto-provisioning the user if this is their first request.
   */
  public async getOrCreateUser(): Promise<PersistentUser> {
    const token = this.getUserToken();
    const baseUrl = getApiBaseUrl();

    try {
      const res = await fetch(`${baseUrl}/api/user/me`, {
        headers: {
          'Content-Type': 'application/json',
          'x-user-token': token,
          'Authorization': `Bearer ${token}`,
          'x-user-name': localStorage.getItem(USER_NAME_KEY) || 'SyncRoom User',
        },
      });

      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          localStorage.setItem(USER_ID_KEY, data.user.id);
          localStorage.setItem(USER_NAME_KEY, data.user.name);
          return data.user;
        }
      }
    } catch (err) {
      console.warn('[SyncRoom User] Error connecting to user profile API:', err);
    }

    // Fallback to cached or stub
    const cached = this.getCachedUser();
    if (cached) return cached;

    return {
      id: localStorage.getItem(USER_ID_KEY) || 'pending_sync',
      name: localStorage.getItem(USER_NAME_KEY) || 'SyncRoom User',
    };
  }

  /**
   * Updates the user's permanent display name in PostgreSQL.
   */
  public async updateUserName(name: string): Promise<PersistentUser> {
    const token = this.getUserToken();
    const baseUrl = getApiBaseUrl();

    const res = await fetch(`${baseUrl}/api/user/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-user-token': token,
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ name }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to update user name');
    }

    const data = await res.json();
    if (data.user) {
      localStorage.setItem(USER_ID_KEY, data.user.id);
      localStorage.setItem(USER_NAME_KEY, data.user.name);
      return data.user;
    }
    return { id: '', name };
  }
}

export const persistentUserService = new PersistentUserService();
