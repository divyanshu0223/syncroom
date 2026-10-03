import { MusicProvider, Track } from '../../types';
import { getApiBaseUrl } from '../../config/runtime';

const SEARCH_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MATCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class YouTubeMusicProvider implements MusicProvider {
  // Query search cache to prevent repeat API calls for the same query
  private searchCache: Map<string, { tracks: Track[]; expiresAt: number }> = new Map();
  // In-flight searches deduplication map
  private inFlightSearches: Map<string, Promise<Track[]>> = new Map();

  // Song match cache to avoid re-searching YouTube for already matched tracks
  private matchCache: Map<string, Track | null> = new Map();
  // In-flight matches deduplication map
  private inFlightMatches: Map<string, Promise<Track | null>> = new Map();

  // Video metadata cache
  private videoCache: Map<string, Track | null> = new Map();

  // Client-side circuit breaker: stops repeat calls if quota limit is active
  private quotaExceededUntil: number = 0;

  public isQuotaExceeded(): boolean {
    return Date.now() < this.quotaExceededUntil;
  }

  public getQuotaCooldownSeconds(): number {
    return Math.max(0, Math.ceil((this.quotaExceededUntil - Date.now()) / 1000));
  }

  public setQuotaExceeded(cooldownSeconds = 600): void {
    this.quotaExceededUntil = Date.now() + cooldownSeconds * 1000;
  }

  public clearCache(): void {
    this.searchCache.clear();
    this.inFlightSearches.clear();
    this.matchCache.clear();
    this.inFlightMatches.clear();
    this.videoCache.clear();
    this.quotaExceededUntil = 0;
  }

  /**
   * Checks current YouTube configuration and quota status on the backend.
   */
  public async getStatus(): Promise<{ configured: boolean; quotaExceeded?: boolean; message?: string }> {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
      return { configured: false, message: 'Backend connection not configured.' };
    }
    try {
      const res = await fetch(`${baseUrl}/api/youtube/status`);
      if (!res.ok) return { configured: false };
      const data = await res.json();
      if (data.quotaExceeded) {
        this.setQuotaExceeded(data.cooldownSeconds || 600);
      }
      return data;
    } catch {
      return { configured: false };
    }
  }

  /**
   * Searches YouTube Data API v3 via backend proxy with caching and in-flight deduplication.
   */
  public async searchTracks(query: string): Promise<Track[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const normQuery = trimmed.toLowerCase().replace(/\s+/g, ' ');

    // 1. Check in-memory search cache
    const cached = this.searchCache.get(normQuery);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.tracks;
    }

    // 2. Return active in-flight request for identical query (prevents duplicate requests)
    const activePromise = this.inFlightSearches.get(normQuery);
    if (activePromise) {
      return activePromise;
    }

    // 3. Check client circuit breaker
    if (this.isQuotaExceeded()) {
      const err: any = new Error('YouTube search quota limit reached for today. You can still paste any direct YouTube video URL in the "Paste Link" tab!');
      err.code = 'YOUTUBE_QUOTA_EXCEEDED';
      err.status = 429;
      throw err;
    }

    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return [];

    const searchPromise = (async () => {
      try {
        const res = await fetch(`${baseUrl}/api/youtube/search?q=${encodeURIComponent(trimmed)}`);
        
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const isQuota = res.status === 429 || errData.code === 'YOUTUBE_QUOTA_EXCEEDED' || errData.quotaExceeded;
          if (isQuota) {
            this.setQuotaExceeded(errData.retryAfterSeconds || 600);
            const quotaErr: any = new Error(
              'YouTube search quota limit reached for today. You can still paste any direct YouTube video URL in the "Paste Link" tab!'
            );
            quotaErr.code = 'YOUTUBE_QUOTA_EXCEEDED';
            quotaErr.status = 429;
            throw quotaErr;
          }
          throw new Error(errData.error || 'Failed to search YouTube tracks.');
        }

        const data = await res.json();
        const tracks: Track[] = data.tracks || [];

        // Save in search cache
        this.searchCache.set(normQuery, {
          tracks,
          expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
        });

        // Pre-populate video and match caches
        for (const track of tracks) {
          const vId = track.youtubeVideoId || track.providerTrackId;
          if (vId) {
            this.videoCache.set(vId, track);
            const mKey = `${track.title.toLowerCase().replace(/\s+/g, ' ')}::${track.artist.toLowerCase().replace(/\s+/g, ' ')}`;
            this.matchCache.set(mKey, track);
          }
        }

        return tracks;
      } finally {
        this.inFlightSearches.delete(normQuery);
      }
    })();

    this.inFlightSearches.set(normQuery, searchPromise);
    return searchPromise;
  }

  /**
   * Finds the best corresponding YouTube video for a given song title and artist.
   * Caches results in memory and deduplicates in-flight requests.
   */
  public async findMatch(title: string, artist?: string): Promise<Track | null> {
    const cleanTitle = title.trim();
    if (!cleanTitle) return null;

    const normKey = `${cleanTitle.toLowerCase().replace(/\s+/g, ' ')}::${(artist || '').trim().toLowerCase().replace(/\s+/g, ' ')}`;
    
    // 1. Check in-memory match cache
    if (this.matchCache.has(normKey)) {
      return this.matchCache.get(normKey) || null;
    }

    // 2. Return in-flight promise if already matching
    const inFlight = this.inFlightMatches.get(normKey);
    if (inFlight) {
      return inFlight;
    }

    // 3. Skip network call if quota is currently exhausted
    if (this.isQuotaExceeded()) {
      return null;
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

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          if (res.status === 429 || errData.code === 'YOUTUBE_QUOTA_EXCEEDED' || errData.quotaExceeded) {
            this.setQuotaExceeded(errData.retryAfterSeconds || 600);
          }
          return null;
        }

        const data = await res.json();
        const track: Track | null = data.track || null;
        this.matchCache.set(normKey, track);
        if (track && (track.youtubeVideoId || track.providerTrackId)) {
          this.videoCache.set(track.youtubeVideoId || track.providerTrackId, track);
        }
        return track;
      } catch (err) {
        console.warn('[YouTubeMusicProvider] findMatch failed:', err);
        return null;
      } finally {
        this.inFlightMatches.delete(normKey);
      }
    })();

    this.inFlightMatches.set(normKey, fetchPromise);
    return fetchPromise;
  }

  /**
   * Fetches track metadata for a specific YouTube video ID with caching.
   */
  public async getVideo(videoId: string): Promise<Track | null> {
    const trimmed = videoId.trim();
    if (!trimmed) return null;

    if (this.videoCache.has(trimmed)) {
      return this.videoCache.get(trimmed) || null;
    }

    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return null;

    try {
      const res = await fetch(`${baseUrl}/api/youtube/video/${encodeURIComponent(trimmed)}`);
      if (!res.ok) {
        if (res.status === 429) {
          this.setQuotaExceeded(600);
        }
        return null;
      }
      const data = await res.json();
      const track: Track | null = data.track || null;
      this.videoCache.set(trimmed, track);
      return track;
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
