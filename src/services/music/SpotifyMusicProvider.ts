import { MusicProvider, Playlist, Track, UserPlaylistSummary } from '../../types';
import { parseSpotifyPlaylistId } from './MusicProvider';
import { getApiBaseUrl } from '../../config/runtime';
import { getSession } from '../session';

export class SpotifyMusicProvider implements MusicProvider {
  private getSessionId(): string {
    if (typeof window === 'undefined') return 'default-session';
    const stored = getSession();
    if (stored?.sessionToken) return stored.sessionToken;
    return localStorage.getItem('syncroom_session_id') || 'default-session';
  }

  /**
   * Fetches playlist metadata and items for a given playlist ID or Spotify URL.
   */
  public async getPlaylist(playlistIdOrUrl: string): Promise<Playlist> {
    const parsed = parseSpotifyPlaylistId(playlistIdOrUrl);
    if (!parsed.playlistId) {
      const err = new Error(parsed.error || 'Invalid Spotify playlist format.') as any;
      err.status = 'PLAYLIST_NOT_FOUND';
      throw err;
    }

    const sessionId = this.getSessionId();
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/spotify/playlist/${encodeURIComponent(parsed.playlistId)}?sessionId=${encodeURIComponent(sessionId)}`, {
      headers: {
        'x-session-id': sessionId,
      },
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Failed to fetch Spotify playlist') as any;
      err.status = data.status;
      throw err;
    }

    return data as Playlist;
  }

  /**
   * Fetches the normalized tracks of a playlist.
   */
  public async getPlaylistItems(playlistIdOrUrl: string): Promise<Track[]> {
    const playlist = await this.getPlaylist(playlistIdOrUrl);
    return playlist.tracks;
  }

  /**
   * Resolves a single real Spotify track from a URL or track ID (Feature 1).
   */
  public async resolveTrack(urlOrId: string): Promise<Track> {
    const sessionId = this.getSessionId();
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/spotify/track/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': sessionId,
      },
      body: JSON.stringify({ urlOrId }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Failed to resolve Spotify track') as any;
      err.status = data.status;
      throw err;
    }

    return data.track as Track;
  }

  /**
   * Searches tracks on Spotify using official Web API /api/spotify/search endpoint.
   */
  public async searchTracks(query: string): Promise<Track[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const sessionId = this.getSessionId();
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
      return [];
    }

    const res = await fetch(
      `${baseUrl}/api/spotify/search?q=${encodeURIComponent(trimmed)}&sessionId=${encodeURIComponent(sessionId)}`,
      {
        headers: {
          'x-session-id': sessionId,
        },
      },
    );

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to search Spotify tracks');
    }

    const data = await res.json();
    return data.tracks || [];
  }

  /**
   * Checks current Spotify connection status for the active admin session.
   */
  public async getStatus(): Promise<{
    configured: boolean;
    connected: boolean;
    user?: { id: string; displayName: string; email?: string; imageUrl?: string } | null;
    redirectUri?: string;
  }> {
    const sessionId = this.getSessionId();
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
      return { configured: false, connected: false };
    }
    try {
      const res = await fetch(`${baseUrl}/api/spotify/status?sessionId=${encodeURIComponent(sessionId)}`, {
        headers: { 'x-session-id': sessionId },
      });
      if (!res.ok) {
        return { configured: false, connected: false };
      }
      return await res.json();
    } catch {
      return { configured: false, connected: false };
    }
  }

  /**
   * Gets the authorization URL for popup OAuth flow.
   */
  public async getAuthUrl(): Promise<{
    configured: boolean;
    url: string | null;
    redirectUri?: string;
    message?: string;
  }> {
    const sessionId = this.getSessionId();
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
      return { configured: false, url: null, message: 'Backend connection not configured. Please set VITE_API_URL.' };
    }
    const res = await fetch(`${baseUrl}/api/spotify/login?format=json&sessionId=${encodeURIComponent(sessionId)}`, {
      headers: {
        Accept: 'application/json',
        'x-session-id': sessionId,
      },
    });
    return await res.json();
  }

  /**
   * Disconnects Spotify for this session.
   */
  public async logout(): Promise<void> {
    const sessionId = this.getSessionId();
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return;
    await fetch(`${baseUrl}/api/spotify/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': sessionId,
      },
      body: JSON.stringify({ sessionId }),
    });
  }

  /**
   * Fetches real playlists accessible to the authenticated user ("My Spotify Playlists").
   */
  public async getMyPlaylists(): Promise<UserPlaylistSummary[]> {
    const sessionId = this.getSessionId();
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return [];
    try {
      const res = await fetch(`${baseUrl}/api/spotify/me/playlists?sessionId=${encodeURIComponent(sessionId)}`, {
        headers: { 'x-session-id': sessionId },
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.playlists || [];
    } catch {
      return [];
    }
  }

  /**
   * Fetches the current session's valid access token and Premium status for the Web Playback SDK.
   */
  public async getToken(): Promise<{
    accessToken: string;
    product: string;
    isPremium: boolean;
    user?: any;
  } | null> {
    const sessionId = this.getSessionId();
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return null;
    try {
      const res = await fetch(`${baseUrl}/api/spotify/token?sessionId=${encodeURIComponent(sessionId)}`, {
        headers: { 'x-session-id': sessionId },
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  /**
   * Starts playback on a specific device using Spotify Connect Web API.
   */
  public async playTrack(deviceId: string, uris: string[], positionMs = 0): Promise<boolean> {
    const sessionId = this.getSessionId();
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return false;
    const res = await fetch(`${baseUrl}/api/spotify/playback/play`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': sessionId,
      },
      body: JSON.stringify({ sessionId, deviceId, uris, positionMs }),
    });
    return res.ok;
  }
}

export const spotifyMusicProvider = new SpotifyMusicProvider();

/**
 * Opens popup for Spotify OAuth authentication for the current browser session.
 */
export async function openSpotifyLoginPopup(): Promise<Window | null> {
  try {
    const auth = await spotifyMusicProvider.getAuthUrl();
    if (auth.url) {
      return window.open(auth.url, 'spotify_oauth', 'width=600,height=720,status=no,toolbar=no,menubar=no');
    }
  } catch (err) {
    console.error('[Spotify] Failed to open OAuth login popup:', err);
  }
  return null;
}
