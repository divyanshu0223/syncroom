import { CustomPlaylistSummary, CustomPlaylistDetail, Track } from '../types';
import { getApiBaseUrl } from '../config/runtime';
import { getSession } from './session';
import { persistentUserService } from './persistentUserService';

class CustomPlaylistService {
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (typeof window !== 'undefined') {
      // 1. Persistent User Identity Token (PostgreSQL ownership key)
      const userToken = persistentUserService.getUserToken();
      if (userToken) {
        headers['x-user-token'] = userToken;
        headers['Authorization'] = `Bearer ${userToken}`;
      }

      // 2. Room Session context (optional, if currently joined to a room)
      const stored = getSession();
      if (stored?.sessionToken) {
        headers['x-session-token'] = stored.sessionToken;
      }
      if (stored?.userId) {
        headers['x-user-id'] = stored.userId;
      }
      const legacySessionId = localStorage.getItem('syncroom_session_id');
      if (legacySessionId) {
        headers['x-session-id'] = legacySessionId;
      }
    }

    return headers;
  }

  public async getPlaylists(): Promise<CustomPlaylistSummary[]> {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/playlists`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to fetch custom playlists');
    }
    const data = await res.json();
    return data.playlists || [];
  }

  public async getPlaylist(playlistId: string): Promise<CustomPlaylistDetail> {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/playlists/${encodeURIComponent(playlistId)}`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to fetch playlist details');
    }
    const data = await res.json();
    return data.playlist;
  }

  public async createPlaylist(name: string, description?: string): Promise<CustomPlaylistSummary> {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/playlists`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ name, description }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to create playlist');
    }
    const data = await res.json();
    return data.playlist;
  }

  public async updatePlaylist(playlistId: string, data: { name?: string; description?: string }): Promise<void> {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/playlists/${encodeURIComponent(playlistId)}`, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to update playlist');
    }
  }

  public async deletePlaylist(playlistId: string): Promise<void> {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/playlists/${encodeURIComponent(playlistId)}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to delete playlist');
    }
  }

  public async resolveSpotifyTrack(urlOrId: string): Promise<Track> {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/spotify/track/resolve`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ urlOrId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Failed to resolve Spotify track') as any;
      err.status = data.status;
      throw err;
    }
    return data.track;
  }

  public async addTrackToPlaylist(playlistId: string, trackOrUrl: Track | string): Promise<void> {
    const baseUrl = getApiBaseUrl();
    const body = typeof trackOrUrl === 'string'
      ? { spotifyTrackUrlOrId: trackOrUrl }
      : { track: trackOrUrl };

    const res = await fetch(`${baseUrl}/api/playlists/${encodeURIComponent(playlistId)}/tracks`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const errorObj = new Error(err.error || 'Failed to add track to playlist') as any;
      errorObj.status = err.status;
      throw errorObj;
    }
  }

  public async removeTrackFromPlaylist(playlistId: string, trackId: string): Promise<void> {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/playlists/${encodeURIComponent(playlistId)}/tracks/${encodeURIComponent(trackId)}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to remove track from playlist');
    }
  }

  public async reorderPlaylist(playlistId: string, trackIds: string[]): Promise<void> {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/playlists/${encodeURIComponent(playlistId)}/reorder`, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify({ trackIds }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to reorder playlist tracks');
    }
  }

  public async loadPlaylistIntoRoomQueue(
    roomId: string,
    playlistId: string,
    replaceQueue = false,
  ): Promise<{ count: number; message: string }> {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/rooms/${encodeURIComponent(roomId)}/queue/from-playlist/${encodeURIComponent(playlistId)}`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ replaceQueue }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Failed to load playlist into room queue') as any;
      err.status = data.status;
      throw err;
    }
    return data;
  }
}

export const customPlaylistService = new CustomPlaylistService();
