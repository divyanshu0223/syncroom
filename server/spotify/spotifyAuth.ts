import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface SpotifyTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // timestamp in ms
  scope?: string;
}

export interface SpotifyUserProfile {
  id: string;
  displayName: string;
  email?: string;
  imageUrl?: string;
  country?: string;
  product?: string;
}

interface StoredSessionAuth {
  tokens: SpotifyTokens;
  profile?: SpotifyUserProfile;
}

// In-memory Spotify authentication storage.
// IMPORTANT: tokens are strictly scoped to the exact sessionId.
const sessionSpotifyAuth = new Map<string, StoredSessionAuth>();

const CACHE_FILE = path.resolve(process.cwd(), '.spotify_auth_cache.json');

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
      const data = JSON.parse(raw);

      if (typeof data === 'object' && data !== null) {
        for (const [key, value] of Object.entries(data)) {
          if (
            value &&
            typeof value === 'object' &&
            'tokens' in value
          ) {
            sessionSpotifyAuth.set(key, value as StoredSessionAuth);
          }
        }
      }
    }
  } catch {
    // Non-fatal: application can continue without persisted Spotify auth.
  }
}

function saveCache() {
  try {
    const obj: Record<string, StoredSessionAuth> = {};

    for (const [key, value] of sessionSpotifyAuth.entries()) {
      obj[key] = value;
    }

    fs.writeFileSync(
      CACHE_FILE,
      JSON.stringify(obj, null, 2),
      'utf-8',
    );
  } catch {
    // Non-fatal.
  }
}

loadCache();

// State parameter storage with 10-minute expiration for CSRF protection.
interface PendingState {
  sessionId: string;
  createdAt: number;
}

const pendingStates = new Map<string, PendingState>();

// Periodic cleanup of expired OAuth states.
setInterval(() => {
  const now = Date.now();

  for (const [state, data] of pendingStates.entries()) {
    if (now - data.createdAt > 10 * 60 * 1000) {
      pendingStates.delete(state);
    }
  }
}, 60 * 1000);

export function getSpotifyConfig() {
  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim() || '';
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim() || '';

  const configured = Boolean(clientId && clientSecret);

  return {
    clientId,
    clientSecret,
    configured,
  };
}

export function generateAuthState(sessionId: string): string {
  const state = crypto.randomBytes(24).toString('hex');

  pendingStates.set(state, {
    sessionId,
    createdAt: Date.now(),
  });

  return state;
}

export function validateAuthState(state: string): string | null {
  const data = pendingStates.get(state);

  if (!data) {
    return null;
  }

  pendingStates.delete(state);

  if (Date.now() - data.createdAt > 10 * 60 * 1000) {
    return null;
  }

  return data.sessionId;
}

/**
 * Returns Spotify tokens ONLY for the exact requested session.
 *
 * IMPORTANT:
 * Do not fall back to another session or default-session.
 * Otherwise one user's Spotify connection can leak into another session
 * and a logged-out session can appear connected again.
 */
export function getStoredTokens(sessionId: string): SpotifyTokens | null {
  return sessionSpotifyAuth.get(sessionId)?.tokens || null;
}

/**
 * Returns Spotify profile ONLY for the exact requested session.
 */
export function getStoredProfile(
  sessionId: string,
): SpotifyUserProfile | undefined {
  return sessionSpotifyAuth.get(sessionId)?.profile;
}

/**
 * Stores Spotify tokens and profile for the exact session.
 */
export function setStoredTokens(
  sessionId: string,
  tokens: SpotifyTokens,
  profile?: SpotifyUserProfile,
) {
  sessionSpotifyAuth.set(sessionId, {
    tokens,
    profile,
  });

  saveCache();
}

/**
 * Tracks logout generations.
 *
 * Every logout increments the generation for that session.
 * Any refresh operation that started before logout becomes stale
 * and is prevented from restoring the Spotify session.
 */
const logoutVersions = new Map<string, number>();

function getLogoutVersion(sessionId: string): number {
  return logoutVersions.get(sessionId) || 0;
}

/**
 * Clears Spotify authentication for exactly one session.
 *
 * Also invalidates any currently tracked refresh operation.
 */
export function clearStoredTokens(sessionId: string) {
  const currentVersion = getLogoutVersion(sessionId);

  logoutVersions.set(
    sessionId,
    currentVersion + 1,
  );

  activeRefreshes.delete(sessionId);

  sessionSpotifyAuth.delete(sessionId);

  saveCache();
}

/**
 * Active token refresh operations.
 *
 * Prevents multiple simultaneous refresh requests for the same session.
 */
const activeRefreshes = new Map<
  string,
  Promise<string | null>
>();

/**
 * Ensures an active, unexpired Spotify access token for the given session.
 *
 * Automatically refreshes an expired token using the refresh token.
 *
 * Concurrency-safe:
 * - parallel refresh requests are deduplicated
 * - logout invalidates the current refresh generation
 * - stale refresh operations cannot recreate a logged-out session
 */
export async function getValidAccessToken(
  sessionId: string,
): Promise<string | null> {
  const tokens = getStoredTokens(sessionId);

  if (!tokens) {
    return null;
  }

  // If token is valid for at least another 60 seconds, return it.
  if (tokens.expiresAt > Date.now() + 60000) {
    return tokens.accessToken;
  }

  // Token expired and no refresh token is available.
  if (!tokens.refreshToken) {
    return null;
  }

  const {
    clientId,
    clientSecret,
  } = getSpotifyConfig();

  if (!clientId || !clientSecret) {
    return null;
  }

  // Reuse an already-running refresh operation.
  const existingRefresh = activeRefreshes.get(sessionId);

  if (existingRefresh) {
    return existingRefresh;
  }

  // Capture the logout generation before starting refresh.
  const refreshLogoutVersion = getLogoutVersion(sessionId);

  const refreshPromise = (async () => {
    try {
      const basic = Buffer
        .from(`${clientId}:${clientSecret}`)
        .toString('base64');

      const response = await fetch(
        'https://accounts.spotify.com/api/token',
        {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${basic}`,
            'Content-Type':
              'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: tokens.refreshToken!,
          }),
          signal: AbortSignal.timeout(8000),
        },
      );

      if (!response.ok) {
        console.error(
          '[Spotify Auth] Failed to refresh token:',
          await response.text(),
        );

        return null;
      }

      const data = await response.json();

      /**
       * IMPORTANT:
       * If logout happened while Spotify was refreshing,
       * this refresh result is stale and MUST NOT restore
       * the deleted session.
       */
      if (
        getLogoutVersion(sessionId) !==
        refreshLogoutVersion
      ) {
        return null;
      }

      /**
       * Also verify that the session still exists.
       * Logout removes the session from storage.
       */
      const currentAuth =
        sessionSpotifyAuth.get(sessionId);

      if (!currentAuth) {
        return null;
      }

      const updatedTokens: SpotifyTokens = {
        accessToken: data.access_token,
        refreshToken:
          data.refresh_token ||
          tokens.refreshToken,
        expiresAt:
          Date.now() +
          (data.expires_in || 3600) * 1000,
        scope:
          data.scope ||
          tokens.scope,
      };

      /**
       * Final race protection before restoring tokens.
       */
      if (
        getLogoutVersion(sessionId) !==
        refreshLogoutVersion
      ) {
        return null;
      }

      setStoredTokens(
        sessionId,
        updatedTokens,
        currentAuth.profile,
      );

      return updatedTokens.accessToken;
    } catch (err) {
      console.error(
        '[Spotify Auth] Error refreshing token:',
        err,
      );

      return null;
    } finally {
      activeRefreshes.delete(sessionId);
    }
  })();

  activeRefreshes.set(
    sessionId,
    refreshPromise,
  );

  return refreshPromise;
}

/**
 * Application-level Spotify token using Client Credentials flow.
 *
 * This token is NOT tied to a user's Spotify account.
 * It is used only for operations that Spotify permits through
 * Client Credentials authentication.
 */
let appToken: {
  token: string;
  expiresAt: number;
} | null = null;

export async function getClientCredentialsToken(): Promise<string | null> {
  const {
    clientId,
    clientSecret,
    configured,
  } = getSpotifyConfig();

  if (!configured) {
    return null;
  }

  if (
    appToken &&
    appToken.expiresAt > Date.now() + 60000
  ) {
    return appToken.token;
  }

  try {
    const basic = Buffer
      .from(`${clientId}:${clientSecret}`)
      .toString('base64');

    const response = await fetch(
      'https://accounts.spotify.com/api/token',
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basic}`,
          'Content-Type':
            'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
        }),
      },
    );

    if (!response.ok) {
      console.error(
        '[Spotify Auth] Client credentials error:',
        await response.text(),
      );

      return null;
    }

    const data = await response.json();

    appToken = {
      token: data.access_token,
      expiresAt:
        Date.now() +
        (data.expires_in || 3600) * 1000,
    };

    return appToken.token;
  } catch (err) {
    console.error(
      '[Spotify Auth] Error getting client credentials token:',
      err,
    );

    return null;
  }
}