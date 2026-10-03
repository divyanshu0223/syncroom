import { MusicProvider, Track } from '../../types';
import { getApiBaseUrl } from '../../config/runtime';

export class YouTubeMusicProvider implements MusicProvider {
  private matchCache: Map<string, Track | null> = new Map();
  private inFlightMatches: Map<string, Promise<Track | null>> = new Map();

  /**
   * Checks current YouTube configuration status on the backend.
   */
  public async getStatus(): Promise<{ configured: boolean; message?: string }> {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
      return { configured: false, message: 'Backend connection not configured.' };
    }
    try {
      const res = await fetch(`${baseUrl}/api/youtube/status`);
      if (!res.ok) return { configured: false };
      return await res.json();
    } catch {
      return { configured: false };
    }
  }

  /**
   * Searches YouTube Data API v3 via backend proxy.
   */
  public async searchTracks(query: string): Promise<Track[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return [];

    const res = await fetch(`${baseUrl}/api/youtube/search?q=${encodeURIComponent(trimmed)}`);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to search YouTube tracks.');
    }

    const data = await res.json();
    return data.tracks || [];
  }

  /**
   * Finds the best corresponding YouTube video for a given song title and artist.
   * Caches results in memory and deduplicates in-flight requests.
   */
  public async findMatch(title: string, artist?: string): Promise<Track | null> {
    const key = `${title.trim().toLowerCase()}::${(artist || '').trim().toLowerCase()}`;
    if (this.matchCache.has(key)) {
      return this.matchCache.get(key) || null;
    }

    const inFlight = this.inFlightMatches.get(key);
    if (inFlight) {
      return inFlight;
    }

    const fetchPromise = (async () => {
      const baseUrl = getApiBaseUrl();
      if (!baseUrl) return null;

      try {
        const res = await fetch(`${baseUrl}/api/youtube/find-match`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, artist }),
        });

        if (!res.ok) return null;
        const data = await res.json();
        const track: Track | null = data.track || null;
        this.matchCache.set(key, track);
        return track;
      } catch (err) {
        console.warn('[YouTubeMusicProvider] findMatch failed:', err);
        return null;
      } finally {
        this.inFlightMatches.delete(key);
      }
    })();

    this.inFlightMatches.set(key, fetchPromise);
    return fetchPromise;
  }

  /**
   * Fetches track metadata for a specific YouTube video ID.
   */
  public async getVideo(videoId: string): Promise<Track | null> {
    const trimmed = videoId.trim();
    if (!trimmed) return null;

    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return null;

    try {
      const res = await fetch(`${baseUrl}/api/youtube/video/${encodeURIComponent(trimmed)}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.track || null;
    } catch {
      return null;
    }
  }

  /**
   * Resolves a YouTube track or throws an error (compatible with resolveTrack interface).
   */
  public async resolveTrack(videoId: string): Promise<Track> {
    const track = await this.getVideo(videoId);
    if (!track) {
      const err: any = new Error('YouTube video not found or unavailable');
      err.status = 'TRACK_NOT_FOUND';
      throw err;
    }
    return track;
  }
}

export const youtubeMusicProvider = new YouTubeMusicProvider();
