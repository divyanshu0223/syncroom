import { Router, Request, Response } from 'express';
import {
  getSpotifyConfig,
  generateAuthState,
  validateAuthState,
  setStoredTokens,
  clearStoredTokens,
  getStoredTokens,
  getStoredProfile,
  getValidAccessToken,
  getClientCredentialsToken,
  SpotifyTokens,
  SpotifyUserProfile,
} from './spotifyAuth';
import {
  extractSpotifyPlaylistId,
  fetchSpotifyPlaylist,
  fetchUserPlaylists,
  searchSpotifyTracks,
  fetchSpotifyTrack,
  parseSpotifyTrackId,
  SpotifyPlaylistError,
} from './spotifyApi';
import { authRateLimiter, spotifyRateLimiter } from '../utils/rateLimiter';
import { logger } from '../utils/logger';
import { getAllowedOrigins } from '../utils/cors';

export const spotifyRouter = Router();

function getRedirectUri(req: Request): string {
  if (process.env.SPOTIFY_REDIRECT_URI) {
    return process.env.SPOTIFY_REDIRECT_URI;
  }
  const appUrl = process.env.APP_URL;
  if (appUrl) {
    const cleaned = appUrl.endsWith('/') ? appUrl.slice(0, -1) : appUrl;
    return `${cleaned}/api/spotify/callback`;
  }
  const host = req.get('host') || 'localhost:3000';
  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  return `${protocol}://${host}/api/spotify/callback`;
}

/**
 * GET /api/spotify/login
 * Initiates the Spotify authorization flow.
 * Returns { url, configured } for popup window, or redirects if loaded directly.
 */
spotifyRouter.get('/login', authRateLimiter, (req: Request, res: Response) => {
  const { clientId, configured } = getSpotifyConfig();
  const sessionId = (req.query.sessionId as string) || 'default-session';
  const redirectUri = getRedirectUri(req);

  if (!configured) {
    return res.status(200).json({
      configured: false,
      url: null,
      message: 'SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are not set in environment.',
      redirectUri,
    });
  }

  const state = generateAuthState(sessionId);
  const scopes = [
    'user-read-private',
    'playlist-read-private',
    'playlist-read-collaborative',
    'user-read-email',
    'streaming',
    'user-read-playback-state',
    'user-modify-playback-state',
    'user-read-currently-playing',
  ].join(' ');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: scopes,
    redirect_uri: redirectUri,
    state,
    show_dialog: 'true',
  });

  const authUrl = `https://accounts.spotify.com/authorize?${params.toString()}`;

  if (req.query.format === 'json' || req.headers.accept?.includes('application/json')) {
    return res.json({
      configured: true,
      url: authUrl,
      redirectUri,
    });
  }

  return res.redirect(authUrl);
});

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * GET /api/spotify/callback & /api/spotify/callback/
 * Handles OAuth callback from Spotify and sends postMessage to popup opener.
 */
const callbackHandler = async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const state = req.query.state as string;
  const rawError = req.query.error as string;

  if (rawError || !code) {
    const safeError = rawError
      ? escapeHtml(String(rawError).slice(0, 200))
      : 'No authorization code received from Spotify.';

    return res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>Spotify Authorization</title></head>
        <body style="font-family: system-ui, sans-serif; background: #09090b; color: #f43f5e; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
          <div style="text-align: center; padding: 24px; max-width: 400px;">
            <h3>Authorization Failed</h3>
            <p style="color: #a1a1aa; font-size: 14px;">${safeError}</p>
            <script>
              if (window.opener) {
                try {
                  window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', provider: 'spotify', error: '${safeError}' }, '*');
                } catch (e) {}
              }
              setTimeout(() => { if (window.opener) { window.close(); } }, 2500);
            </script>
          </div>
        </body>
      </html>
    `);
  }

  const sessionId = validateAuthState(state);
  if (!sessionId) {
    return res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>Spotify Authorization</title></head>
        <body style="font-family: system-ui, sans-serif; background: #09090b; color: #f43f5e; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
          <div style="text-align: center; padding: 24px; max-width: 400px;">
            <h3>Invalid State</h3>
            <p style="color: #a1a1aa; font-size: 14px;">The authorization state has expired. Please try connecting again.</p>
            <script>
              setTimeout(() => { if (window.opener) { window.close(); } }, 3000);
            </script>
          </div>
        </body>
      </html>
    `);
  }

  const { clientId, clientSecret } = getSpotifyConfig();
  const redirectUri = getRedirectUri(req);

  try {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      logger.error('[Spotify Auth] Token exchange failed with Spotify', undefined, { status: tokenRes.status });
      return res.status(500).send(`
        <!DOCTYPE html>
        <html>
          <body style="background: #09090b; color: #fff; font-family: sans-serif; text-align: center; padding: 40px;">
            <p>Failed to exchange token with Spotify.</p>
          </body>
        </html>
      `);
    }

    const tokenData = await tokenRes.json();
    const tokens: SpotifyTokens = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000,
      scope: tokenData.scope,
    };

    // Fetch user profile
    let profile: SpotifyUserProfile | undefined;
    try {
      const meRes = await fetch('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (meRes.ok) {
        const me = await meRes.json();
        profile = {
          id: me.id,
          displayName: me.display_name || me.id,
          email: me.email,
          imageUrl: me.images?.[0]?.url,
          country: me.country,
          product: me.product,
        };
      }
    } catch (err) {
      logger.warn('[Spotify Auth] Could not fetch profile details');
    }

    setStoredTokens(sessionId, tokens, profile);

    return res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Spotify Connected</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              background: #09090b;
              color: #f4f4f5;
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
            }
            .card {
              text-align: center;
              padding: 32px;
              border-radius: 16px;
              background: #18181b;
              border: 1px solid #27272a;
              max-width: 380px;
            }
            .icon {
              width: 48px;
              height: 48px;
              color: #1db954;
              margin-bottom: 16px;
            }
            h2 { margin: 0 0 8px 0; font-size: 20px; }
            p { margin: 0; color: #a1a1aa; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="card">
            <svg class="icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
            </svg>
            <h2>Connected to Spotify</h2>
            <p>Authentication successful. Closing window...</p>
          </div>
          <script>
            if (window.opener) {
              const allowed = ${JSON.stringify(getAllowedOrigins())};
              const targets = allowed.length > 0 ? allowed : [window.location.origin];
              for (const target of targets) {
                try {
                  window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', provider: 'spotify' }, target);
                } catch (e) {}
              }
              setTimeout(() => { window.close(); }, 800);
            } else {
              setTimeout(() => { window.location.href = '/'; }, 1500);
            }
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    logger.error('[Spotify Auth] Callback exception', err);
    return res.status(500).send('Authentication exception');
  }
};

spotifyRouter.get('/callback', authRateLimiter, callbackHandler);
spotifyRouter.get('/callback/', authRateLimiter, callbackHandler);

/**
 * GET /api/spotify/status
 * Returns connection status and profile of the current session.
 */
spotifyRouter.get('/status', (req: Request, res: Response) => {
  const sessionId = (req.query.sessionId as string) || (req.headers['x-session-id'] as string) || 'default-session';
  const { configured, clientId } = getSpotifyConfig();
  const tokens = getStoredTokens(sessionId);
  const profile = getStoredProfile(sessionId);

  const connected = Boolean(tokens && tokens.expiresAt > Date.now() - 3600000);

  return res.json({
    configured,
    clientIdPresent: Boolean(clientId),
    connected,
    user: profile || null,
    redirectUri: getRedirectUri(req),
  });
});

/**
 * GET /api/spotify/token
 * Returns a valid, unexpired access token for the active session to power the Web Playback SDK.
 * Never exposes client secrets or refresh tokens.
 */
spotifyRouter.get('/token', spotifyRateLimiter, async (req: Request, res: Response) => {
  const sessionId = (req.query.sessionId as string) || (req.headers['x-session-id'] as string) || 'default-session';
  const token = await getValidAccessToken(sessionId);
  if (!token) {
    return res.status(401).json({
      error: 'Not authenticated with Spotify or authorization expired. Please connect your Spotify account.',
      requiresAuth: true,
    });
  }

  const profile = getStoredProfile(sessionId);
  const isPremium = profile?.product === 'premium';

  return res.json({
    accessToken: token,
    product: profile?.product || 'unknown',
    isPremium,
    user: profile || null,
  });
});

/**
 * Resolves the real active Spotify Connect device ID if the client's device ID is unknown or out of sync.
 */
async function resolveActiveSpotifyDeviceId(token: string, requestedDeviceId?: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.spotify.com/v1/me/player/devices', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return requestedDeviceId || null;
    const data = await res.json();
    const devices: any[] = data.devices || [];
    if (devices.length === 0) return requestedDeviceId || null;

    // 1. If requestedDeviceId is among available devices, use it
    if (requestedDeviceId && devices.some((d) => d.id === requestedDeviceId)) {
      return requestedDeviceId;
    }

    // 2. Find device named "SyncRoom Web Player"
    const syncRoomDevice = devices.find((d) => d.name === 'SyncRoom Web Player');
    if (syncRoomDevice?.id) {
      return syncRoomDevice.id;
    }

    // 3. Find any active device
    const activeDevice = devices.find((d) => d.is_active);
    if (activeDevice?.id) {
      return activeDevice.id;
    }

    // 4. Return first device
    return devices[0]?.id || requestedDeviceId || null;
  } catch {
    return requestedDeviceId || null;
  }
}

/**
 * GET /api/spotify/devices
 * Lists currently connected Spotify playback devices.
 */
spotifyRouter.get('/devices', spotifyRateLimiter, async (req: Request, res: Response) => {
  const sessionId = (req.query?.sessionId as string) || (req.headers['x-session-id'] as string) || 'default-session';
  const token = await getValidAccessToken(sessionId);
  if (!token) return res.status(401).json({ error: 'Spotify authorization required.', devices: [] });

  try {
    const spotifyRes = await fetch('https://api.spotify.com/v1/me/player/devices', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!spotifyRes.ok) return res.status(spotifyRes.status).json({ devices: [] });
    const data = await spotifyRes.json();
    return res.status(200).json({ devices: data.devices || [] });
  } catch {
    return res.status(500).json({ devices: [] });
  }
});

/**
 * PUT /api/spotify/playback/play
 * Starts or resumes playback on the specified Spotify device (Web Playback SDK player).
 */
spotifyRouter.put('/playback/play', spotifyRateLimiter, async (req: Request, res: Response) => {
  const sessionId = (req.body?.sessionId as string) || (req.headers['x-session-id'] as string) || 'default-session';
  const token = await getValidAccessToken(sessionId);
  if (!token) {
    return res.status(401).json({ error: 'Spotify authorization required.', requiresAuth: true });
  }

  let { deviceId, uris, positionMs } = req.body || {};
  if (!deviceId) {
    deviceId = await resolveActiveSpotifyDeviceId(token);
  }
  if (!deviceId) {
    return res.status(400).json({ error: 'Missing deviceId for Spotify playback.' });
  }

  try {
    let playUrl = `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`;
    const body: any = {};
    if (Array.isArray(uris) && uris.length > 0) {
      body.uris = uris;
    }
    if (typeof positionMs === 'number' && positionMs >= 0) {
      body.position_ms = Math.round(positionMs);
    }

    let spotifyRes = await fetch(playUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
    });

    // If 404 (Device not found), activate requested device first or resolve active device and retry
    if (spotifyRes.status === 404) {
      logger.info(`[Spotify Backend Play] Device ${deviceId} not found (404). Activating device...`);
      // First attempt: Transfer to requested deviceId directly to register it with Spotify
      await fetch('https://api.spotify.com/v1/me/player', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ device_ids: [deviceId], play: false }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});

      await new Promise((r) => setTimeout(r, 250));

      spotifyRes = await fetch(playUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(5000),
      });

      // Second attempt: If still 404, resolve device list
      if (spotifyRes.status === 404) {
        logger.info(`[Spotify Backend Play] Still 404 after activating ${deviceId}. Resolving device list...`);
        const resolvedId = await resolveActiveSpotifyDeviceId(token, deviceId);
        if (resolvedId && resolvedId !== deviceId) {
          deviceId = resolvedId;
          playUrl = `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`;
          
          await fetch('https://api.spotify.com/v1/me/player', {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ device_ids: [deviceId], play: false }),
            signal: AbortSignal.timeout(5000),
          }).catch(() => {});

          await new Promise((r) => setTimeout(r, 200));

          spotifyRes = await fetch(playUrl, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(5000),
          });
        }
      }
    }

    if (!spotifyRes.ok && spotifyRes.status !== 204) {
      const errText = await spotifyRes.text();
      let parsedErr: any = null;
      try { parsedErr = JSON.parse(errText); } catch {}
      const reason = parsedErr?.error?.reason || parsedErr?.error?.message || errText;
      logger.warn('[Spotify Backend Play Error]', {
        status: spotifyRes.status,
        reason,
        deviceId,
        uris,
        sessionId,
      });
      return res.status(spotifyRes.status).json({
        error: reason,
        status: spotifyRes.status,
      });
    }

    return res.status(200).json({ success: true, resolvedDeviceId: deviceId });
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error)?.message || 'Failed to start playback on Spotify device.' });
  }
});

/**
 * PUT /api/spotify/playback/pause
 * Pauses playback on the active Spotify device.
 */
spotifyRouter.put('/playback/pause', spotifyRateLimiter, async (req: Request, res: Response) => {
  const sessionId = (req.body?.sessionId as string) || (req.headers['x-session-id'] as string) || 'default-session';
  const token = await getValidAccessToken(sessionId);
  if (!token) return res.status(401).json({ error: 'Spotify authorization required.', requiresAuth: true });

  let { deviceId } = req.body || {};
  if (!deviceId) {
    deviceId = await resolveActiveSpotifyDeviceId(token);
  }

  try {
    const pauseUrl = deviceId
      ? `https://api.spotify.com/v1/me/player/pause?device_id=${encodeURIComponent(deviceId)}`
      : 'https://api.spotify.com/v1/me/player/pause';
    const spotifyRes = await fetch(pauseUrl, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!spotifyRes.ok && spotifyRes.status !== 204) {
      const errText = await spotifyRes.text();
      return res.status(spotifyRes.status).json({ error: errText });
    }
    return res.status(200).json({ success: true, resolvedDeviceId: deviceId });
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error)?.message || 'Failed to pause playback.' });
  }
});

/**
 * PUT /api/spotify/playback/seek
 * Seeks to a position in milliseconds on the active Spotify device.
 */
spotifyRouter.put('/playback/seek', spotifyRateLimiter, async (req: Request, res: Response) => {
  const sessionId = (req.body?.sessionId as string) || (req.headers['x-session-id'] as string) || 'default-session';
  const token = await getValidAccessToken(sessionId);
  if (!token) return res.status(401).json({ error: 'Spotify authorization required.', requiresAuth: true });

  let { deviceId, positionMs } = req.body || {};
  if (!deviceId) {
    deviceId = await resolveActiveSpotifyDeviceId(token);
  }
  const pos = Math.round(Number(positionMs) || 0);
  try {
    const seekUrl = `https://api.spotify.com/v1/me/player/seek?position_ms=${pos}${deviceId ? `&device_id=${encodeURIComponent(deviceId)}` : ''}`;
    const spotifyRes = await fetch(seekUrl, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!spotifyRes.ok && spotifyRes.status !== 204) {
      const errText = await spotifyRes.text();
      return res.status(spotifyRes.status).json({ error: errText });
    }
    return res.status(200).json({ success: true, resolvedDeviceId: deviceId });
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error)?.message || 'Failed to seek playback.' });
  }
});

// In-flight transfer deduplication to prevent hammering Spotify with parallel requests
const activeTransfers = new Map<string, Promise<{ success: boolean; resolvedDeviceId?: string; status?: number; error?: string }>>();

/**
 * PUT /api/spotify/playback/transfer
 * Transfers active playback to the given device ID.
 * Deduplicates in-flight transfers for the same session and device.
 */
spotifyRouter.put('/playback/transfer', spotifyRateLimiter, async (req: Request, res: Response) => {
  const sessionId = (req.body?.sessionId as string) || (req.headers['x-session-id'] as string) || 'default-session';
  const token = await getValidAccessToken(sessionId);
  if (!token) return res.status(401).json({ error: 'Spotify authorization required.', requiresAuth: true });

  let { deviceId, play } = req.body || {};
  if (!deviceId) {
    deviceId = await resolveActiveSpotifyDeviceId(token);
  }
  if (!deviceId) return res.status(400).json({ error: 'Missing deviceId for transfer.' });

  const transferKey = `${sessionId}_${deviceId}_${Boolean(play)}`;
  const existing = activeTransfers.get(transferKey);
  if (existing) {
    const result = await existing;
    return res.status(result.status || 200).json(result);
  }

  const transferPromise = (async () => {
    try {
      let spotifyRes = await fetch('https://api.spotify.com/v1/me/player', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          device_ids: [deviceId],
          play: Boolean(play),
        }),
        signal: AbortSignal.timeout(6000),
      });

      if (spotifyRes.status === 404) {
        const resolvedId = await resolveActiveSpotifyDeviceId(token, deviceId);
        if (resolvedId && resolvedId !== deviceId) {
          deviceId = resolvedId;
          spotifyRes = await fetch('https://api.spotify.com/v1/me/player', {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              device_ids: [deviceId],
              play: Boolean(play),
            }),
            signal: AbortSignal.timeout(6000),
          });
        }
      }

      if (!spotifyRes.ok && spotifyRes.status !== 204) {
        const errText = await spotifyRes.text();
        logger.warn('[Spotify Backend Transfer Error]', {
          status: spotifyRes.status,
          errText,
          deviceId,
          sessionId,
        });
        return { success: false, status: spotifyRes.status, error: errText };
      }
      return { success: true, status: 200, resolvedDeviceId: deviceId };
    } catch (err: unknown) {
      return { success: false, status: 500, error: (err as Error)?.message || 'Failed to transfer playback.' };
    } finally {
      activeTransfers.delete(transferKey);
    }
  })();

  activeTransfers.set(transferKey, transferPromise);
  const result = await transferPromise;
  return res.status(result.status || 200).json(result);
});

/**
 * POST /api/spotify/logout
 * Clears stored Spotify credentials for the given session.
 */
spotifyRouter.post('/logout', authRateLimiter, (req: Request, res: Response) => {
  const sessionId = (req.body?.sessionId as string) || (req.headers['x-session-id'] as string) || 'default-session';
  clearStoredTokens(sessionId);
  return res.json({ success: true });
});

/**
 * GET /api/spotify/search
 * Searches tracks on Spotify using either user token or client credentials token.
 */
spotifyRouter.get('/search', spotifyRateLimiter, async (req: Request, res: Response) => {
  const query = (req.query.q as string) || '';
  if (!query.trim()) {
    return res.json({ tracks: [] });
  }

  const sessionId = (req.query.sessionId as string) || (req.headers['x-session-id'] as string) || 'default-session';

  // 1. Try session's user access token
  let token = await getValidAccessToken(sessionId);

  // 2. Try application client credentials token
  if (!token) {
    token = await getClientCredentialsToken();
  }

  if (!token) {
    const { configured } = getSpotifyConfig();
    return res.status(401).json({
      error: configured
        ? 'Please connect your Spotify account to search tracks.'
        : 'Spotify credentials are not configured on the server.',
      configured,
      requiresAuth: true,
      tracks: [],
    });
  }

  try {
    const tracks = await searchSpotifyTracks(query, token);
    return res.json({ tracks });
  } catch (err: unknown) {
    const message = (err as Error)?.message || 'Failed to search Spotify tracks';
    return res.status(400).json({ error: message, tracks: [] });
  }
});

/**
 * GET /api/spotify/me/playlists
 * Fetches real Spotify playlists accessible to the authenticated user.
 */
spotifyRouter.get('/me/playlists', spotifyRateLimiter, async (req: Request, res: Response) => {
  const sessionId = (req.query.sessionId as string) || (req.headers['x-session-id'] as string) || 'default-session';
  const token = await getValidAccessToken(sessionId);
  if (!token) {
    return res.status(401).json({
      error: 'Connect Spotify to view your playlists.',
      requiresAuth: true,
      playlists: [],
    });
  }

  const profile = getStoredProfile(sessionId);
  try {
    const playlists = await fetchUserPlaylists(token, profile?.id);
    return res.json({ playlists });
  } catch (err: unknown) {
    if (err instanceof SpotifyPlaylistError) {
      return res.status(err.httpStatus).json({ error: err.message, status: err.status, playlists: [] });
    }
    const message = (err as Error)?.message || 'Failed to fetch user playlists';
    return res.status(500).json({ error: message, playlists: [] });
  }
});

/**
 * GET /api/spotify/playlist/:playlistId
 * Fetches playlist metadata and normalized track items.
 */
spotifyRouter.get('/playlist/:playlistId', spotifyRateLimiter, async (req: Request, res: Response) => {
  const rawId = req.params.playlistId;
  const playlistId = extractSpotifyPlaylistId(rawId);

  if (!playlistId) {
    return res.status(400).json({
      error: 'Invalid Spotify playlist format.',
      status: 'PLAYLIST_NOT_FOUND',
    });
  }

  const sessionId = (req.query.sessionId as string) || (req.headers['x-session-id'] as string) || 'default-session';

  // 1. Try session's user access token
  let token = await getValidAccessToken(sessionId);

  // 2. Try application client credentials token as fallback for public metadata
  if (!token) {
    token = await getClientCredentialsToken();
  }

  if (!token) {
    return res.status(401).json({
      error: 'Connect Spotify to import this playlist.',
      requiresAuth: true,
      status: 'SPOTIFY_AUTH_REQUIRED',
    });
  }

  const profile = getStoredProfile(sessionId);
  const userMarket = profile?.country; // Only authentic user market, never fake

  try {
    const playlist = await fetchSpotifyPlaylist(playlistId, token, userMarket);
    return res.json(playlist);
  } catch (err: unknown) {
    if (err instanceof SpotifyPlaylistError) {
      return res.status(err.httpStatus).json({
        error: err.message,
        status: err.status,
      });
    }
    const message = (err as Error)?.message || 'Spotify could not provide the playlist contents right now.';
    return res.status(400).json({ error: message, status: 'SPOTIFY_API_ERROR' });
  }
});

/**
 * POST /api/spotify/track/resolve
 * Resolves a real Spotify track by URL or ID (Feature 1).
 * Supports:
 * - https://open.spotify.com/track/TRACK_ID
 * - https://open.spotify.com/intl-xx/track/TRACK_ID
 * - spotify:track:TRACK_ID
 * - URLs with query parameters (?si=...)
 * - Direct 22-char ID
 */
spotifyRouter.post('/track/resolve', spotifyRateLimiter, async (req: Request, res: Response) => {
  const urlOrId = req.body?.urlOrId || req.body?.url || req.body?.trackId || req.query.urlOrId;

  if (!urlOrId || typeof urlOrId !== 'string') {
    return res.status(400).json({
      error: 'Please provide a valid Spotify track URL or ID.',
      status: 'INVALID_TRACK_ID',
    });
  }

  const { trackId, error: parseError } = parseSpotifyTrackId(urlOrId);
  if (!trackId) {
    return res.status(400).json({
      error: parseError || 'Invalid Spotify track URL or ID format.',
      status: 'INVALID_TRACK_ID',
    });
  }

  const sessionId = (req.headers['x-session-id'] as string) || (req.query.sessionId as string) || 'default-session';

  let token = await getValidAccessToken(sessionId);
  if (!token) {
    token = await getClientCredentialsToken();
  }

  if (!token) {
    return res.status(401).json({
      error: 'Connect Spotify to resolve track metadata.',
      requiresAuth: true,
      status: 'SPOTIFY_AUTH_REQUIRED',
    });
  }

  const profile = getStoredProfile(sessionId);
  const userMarket = profile?.country;

  try {
    const track = await fetchSpotifyTrack(trackId, token, userMarket);
    return res.json({ success: true, track });
  } catch (err: unknown) {
    if (err instanceof SpotifyPlaylistError) {
      return res.status(err.httpStatus).json({
        error: err.message,
        status: err.status,
      });
    }
    const message = (err as Error)?.message || 'Spotify could not provide the track details right now.';
    return res.status(400).json({ error: message, status: 'SPOTIFY_API_ERROR' });
  }
});

/**
 * GET /api/spotify/track/:trackId
 * REST endpoint to fetch a single track by ID.
 */
spotifyRouter.get('/track/:trackId', spotifyRateLimiter, async (req: Request, res: Response) => {
  const rawId = req.params.trackId;
  const { trackId, error: parseError } = parseSpotifyTrackId(rawId);

  if (!trackId) {
    return res.status(400).json({
      error: parseError || 'Invalid Spotify track format.',
      status: 'INVALID_TRACK_ID',
    });
  }

  const sessionId = (req.query.sessionId as string) || (req.headers['x-session-id'] as string) || 'default-session';

  let token = await getValidAccessToken(sessionId);
  if (!token) {
    token = await getClientCredentialsToken();
  }

  if (!token) {
    return res.status(401).json({
      error: 'Connect Spotify to resolve this track.',
      requiresAuth: true,
      status: 'SPOTIFY_AUTH_REQUIRED',
    });
  }

  const profile = getStoredProfile(sessionId);
  const userMarket = profile?.country;

  try {
    const track = await fetchSpotifyTrack(trackId, token, userMarket);
    return res.json({ success: true, track });
  } catch (err: unknown) {
    if (err instanceof SpotifyPlaylistError) {
      return res.status(err.httpStatus).json({
        error: err.message,
        status: err.status,
      });
    }
    const message = (err as Error)?.message || 'Spotify could not provide the track details right now.';
    return res.status(400).json({ error: message, status: 'SPOTIFY_API_ERROR' });
  }
});
