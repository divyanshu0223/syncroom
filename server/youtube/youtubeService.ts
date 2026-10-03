import { Track } from '../../src/types';
import { logger } from '../utils/logger';

export interface YouTubeSearchResult {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string | null;
  durationSeconds: number;
}

// In-memory cache for search queries and track matches to strictly preserve API quota
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const SEARCH_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MATCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const searchCache = new Map<string, CacheEntry<Track[]>>();
const matchCache = new Map<string, CacheEntry<Track | null>>();
const videoCache = new Map<string, CacheEntry<Track | null>>();

const GRADIENT_PALETTES = [
  { from: '#18181b', via: '#27272a', to: '#09090b', accent: '#ff0000', pattern: 'geometry' as const },
  { from: '#1e1b4b', via: '#0f172a', to: '#020617', accent: '#f43f5e', pattern: 'aurora' as const },
  { from: '#292524', via: '#1c1917', to: '#0c0a09', accent: '#f59e0b', pattern: 'rings' as const },
  { from: '#134e4a', via: '#042f2e', to: '#021614', accent: '#ec4899', pattern: 'grid' as const },
  { from: '#312e81', via: '#1e1b4b', to: '#0f0e17', accent: '#ef4444', pattern: 'waves' as const },
];

function generateCoverGradient(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % GRADIENT_PALETTES.length;
  return GRADIENT_PALETTES[idx];
}

/**
 * Decodes standard HTML entities commonly returned by YouTube Data API.
 */
export function decodeHtmlEntities(input: string): string {
  if (!input) return '';
  return input
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
}

/**
 * Parses ISO 8601 duration (e.g. PT3M45S, PT1H2M3S, PT52S) into seconds.
 */
export function parseIso8601Duration(isoDuration: string): number {
  if (!isoDuration || typeof isoDuration !== 'string') return 0;
  const match = isoDuration.match(/P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/i);
  if (!match) return 0;
  const days = parseInt(match[1] || '0', 10);
  const hours = parseInt(match[2] || '0', 10);
  const minutes = parseInt(match[3] || '0', 10);
  const seconds = parseInt(match[4] || '0', 10);
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

export const parseIsoDuration = parseIso8601Duration;

export class YouTubeService {
  private quotaExceededUntil = 0;

  private getApiKey(): string | null {
    const key = process.env.YOUTUBE_API_KEY?.trim();
    return key || null;
  }

  public isConfigured(): boolean {
    return Boolean(this.getApiKey());
  }

  public isQuotaExceeded(): boolean {
    return Date.now() < this.quotaExceededUntil;
  }

  public getQuotaCooldownSeconds(): number {
    return Math.max(0, Math.ceil((this.quotaExceededUntil - Date.now()) / 1000));
  }

  public setQuotaExceeded(cooldownMs = 15 * 60 * 1000): void {
    this.quotaExceededUntil = Date.now() + cooldownMs;
    logger.warn('[YouTubeService] Circuit breaker tripped: Quota/RateLimit exceeded. Cooling down for ms:', { cooldownMs });
  }

  public resetCircuitBreaker(): void {
    this.quotaExceededUntil = 0;
  }

  /**
   * Normalizes a raw YouTube video item into a SyncRoom Track.
   */
  public normalizeVideoToTrack(
    videoId: string,
    title: string,
    channelTitle: string,
    thumbnailUrl: string | null,
    durationSeconds: number,
  ): Track {
    const cleanTitle = decodeHtmlEntities(title);
    const cleanArtist = decodeHtmlEntities(channelTitle);
    const duration = Math.max(1, durationSeconds);

    return {
      id: `youtube-${videoId}`,
      provider: 'youtube',
      providerTrackId: videoId,
      title: cleanTitle,
      artist: cleanArtist,
      artists: [cleanArtist],
      album: 'YouTube',
      albumArtUrl: thumbnailUrl,
      durationMs: duration * 1000,
      duration,
      externalUrl: `https://www.youtube.com/watch?v=${videoId}`,
      isPlayable: true,
      playbackStatus: 'AVAILABLE',
      restrictionReason: null,
      spotifyIsPlayable: null,
      audioSource: 'youtube',
      youtubeVideoId: videoId,
      coverGradient: generateCoverGradient(videoId),
    };
  }

  /**
   * Searches YouTube Data API v3 for video results matching the query.
   */
  public async searchTracks(query: string, maxResults = 5): Promise<Track[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const normalized = trimmed.toLowerCase().replace(/\s+/g, ' ');
    const cappedMax = Math.min(Math.max(1, maxResults), 10);
    const cacheKey = `search:${normalized}:${cappedMax}`;
    const cached = searchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    // Circuit breaker check: avoid hammering Google if quota is known to be exhausted
    if (this.isQuotaExceeded()) {
      const err: any = new Error('YouTube search quota limit reached. Please paste a direct YouTube video link to play songs.');
      err.code = 'YOUTUBE_QUOTA_EXCEEDED';
      err.statusCode = 429;
      err.retryAfterSeconds = this.getQuotaCooldownSeconds();
      throw err;
    }

    const apiKey = this.getApiKey();
    if (!apiKey) {
      const err: any = new Error('YouTube API is not configured on the server. Please set YOUTUBE_API_KEY.');
      err.code = 'YOUTUBE_NOT_CONFIGURED';
      err.statusCode = 503;
      throw err;
    }


    try {
      // 1. Search videos with embeddable and syndicated flags
      const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
      searchUrl.searchParams.set('part', 'snippet');
      searchUrl.searchParams.set('type', 'video');
      searchUrl.searchParams.set('maxResults', String(cappedMax));
      searchUrl.searchParams.set('videoEmbeddable', 'true');
      searchUrl.searchParams.set('videoSyndicated', 'true');
      searchUrl.searchParams.set('q', trimmed);
      searchUrl.searchParams.set('key', apiKey);

      const searchRes = await fetch(searchUrl.toString(), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });

      if (!searchRes.ok) {
        const errorBody = await searchRes.text();
        let parsed: any;
        try { parsed = JSON.parse(errorBody); } catch {}
        const errorReason = parsed?.error?.errors?.[0]?.reason || parsed?.error?.message || errorBody;

        const isQuotaOrRateLimit =
          searchRes.status === 429 ||
          searchRes.status === 403 && (
            String(errorReason).toLowerCase().includes('quota') ||
            String(errorReason).toLowerCase().includes('ratelimit') ||
            String(errorReason).toLowerCase().includes('dailylimit') ||
            String(errorReason).toLowerCase().includes('userlimit')
          );

        if (isQuotaOrRateLimit) {
          this.setQuotaExceeded(15 * 60 * 1000);
          const quotaErr: any = new Error('YouTube API quota or rate limit exceeded. Please paste a direct YouTube video link instead.');
          quotaErr.code = 'YOUTUBE_QUOTA_EXCEEDED';
          quotaErr.statusCode = 429;
          quotaErr.retryAfterSeconds = this.getQuotaCooldownSeconds();
          throw quotaErr;
        }

        const apiErr: any = new Error(`YouTube API request failed (${searchRes.status}): ${errorReason}`);
        apiErr.code = 'YOUTUBE_API_ERROR';
        apiErr.statusCode = searchRes.status >= 400 && searchRes.status < 600 ? searchRes.status : 500;
        throw apiErr;
      }

      const searchData = await searchRes.json();
      const items: any[] = searchData.items || [];
      const videoIds = items.map((item) => item.id?.videoId).filter(Boolean);

      if (videoIds.length === 0) {
        searchCache.set(cacheKey, { data: [], expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
        return [];
      }

      // 2. Fetch video details to retrieve accurate durations
      const detailsMap = new Map<string, { durationSeconds: number; title: string; channelTitle: string; thumbnailUrl: string | null }>();

      try {
        const detailsUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
        detailsUrl.searchParams.set('part', 'snippet,contentDetails');
        detailsUrl.searchParams.set('id', videoIds.join(','));
        detailsUrl.searchParams.set('key', apiKey);

        const detailsRes = await fetch(detailsUrl.toString(), {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(8000),
        });

        if (detailsRes.ok) {
          const detailsData = await detailsRes.json();
          for (const v of detailsData.items || []) {
            const duration = parseIso8601Duration(v.contentDetails?.duration || '');
            const thumb =
              v.snippet?.thumbnails?.high?.url ||
              v.snippet?.thumbnails?.medium?.url ||
              v.snippet?.thumbnails?.default?.url ||
              null;
            detailsMap.set(v.id, {
              durationSeconds: duration,
              title: v.snippet?.title || '',
              channelTitle: v.snippet?.channelTitle || '',
              thumbnailUrl: thumb,
            });
          }
        }
      } catch (detailsErr) {
        logger.warn('[YouTubeService] Video details fetch failed, falling back to snippet', { error: detailsErr });
      }

      // 3. Transform to Track[]
      const tracks: Track[] = items
        .map((item) => {
          const vId = item.id?.videoId;
          if (!vId) return null;
          const details = detailsMap.get(vId);
          const title = details?.title || item.snippet?.title || 'Unknown Title';
          const channel = details?.channelTitle || item.snippet?.channelTitle || 'YouTube';
          const thumb =
            details?.thumbnailUrl ||
            item.snippet?.thumbnails?.high?.url ||
            item.snippet?.thumbnails?.medium?.url ||
            item.snippet?.thumbnails?.default?.url ||
            null;
          const durationSec = details?.durationSeconds || 180;

          return this.normalizeVideoToTrack(vId, title, channel, thumb, durationSec);
        })
        .filter((t): t is Track => t !== null);

      searchCache.set(cacheKey, { data: tracks, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });

      // Cross-populate video and match caches to save quota on subsequent clicks
      for (const track of tracks) {
        if (track.youtubeVideoId) {
          videoCache.set(`video:${track.youtubeVideoId}`, {
            data: track,
            expiresAt: Date.now() + MATCH_CACHE_TTL_MS,
          });
          const matchKey = `match:${track.title.toLowerCase().replace(/\s+/g, ' ')}::${track.artist.toLowerCase().replace(/\s+/g, ' ')}`;
          matchCache.set(matchKey, {
            data: track,
            expiresAt: Date.now() + MATCH_CACHE_TTL_MS,
          });
        }
      }

      return tracks;
    } catch (err: any) {
      logger.warn('[YouTubeService] searchTracks exception', { error: err.message, code: err.code });
      throw err;
    }
  }

  /**
   * Finds the best matching YouTube video for a given song title and optional artist.
   * Useful when user clicks [YouTube] on a Spotify search result or playing track.
   */
  public async findMatch(title: string, artist?: string): Promise<Track | null> {
    const cleanTitle = title.trim();
    if (!cleanTitle) return null;

    const normTitle = cleanTitle.toLowerCase().replace(/\s+/g, ' ');
    const normArtist = (artist || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const cacheKey = `match:${normTitle}::${normArtist}`;

    const cached = matchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    if (this.isQuotaExceeded()) {
      return null;
    }

    const searchQuery = artist ? `${cleanTitle} ${artist}` : cleanTitle;
    try {
      const tracks = await this.searchTracks(searchQuery, 5);

      if (tracks.length === 0) {
        matchCache.set(cacheKey, { data: null, expiresAt: Date.now() + MATCH_CACHE_TTL_MS });
        return null;
      }

      // Pick best match: prefer result with title/artist match, or first result
      const best = tracks[0];
      matchCache.set(cacheKey, { data: best, expiresAt: Date.now() + MATCH_CACHE_TTL_MS });
      return best;
    } catch (err: any) {
      if (err.code === 'YOUTUBE_QUOTA_EXCEEDED') {
        return null;
      }
      throw err;
    }
  }

  /**
   * Fetches video metadata by video ID.
   * If Data API quota is exceeded or not configured, gracefully resolves via
   * YouTube's quota-free public oEmbed service or reliable metadata fallback.
   */
  public async getVideoById(videoId: string): Promise<Track | null> {
    const cleanId = videoId.trim();
    if (!cleanId) return null;

    const cacheKey = `video:${cleanId}`;
    const cached = videoCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const apiKey = this.getApiKey();

    // 1. Try Google Data API if configured and quota is healthy
    if (apiKey && !this.isQuotaExceeded()) {
      try {
        const detailsUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
        detailsUrl.searchParams.set('part', 'snippet,contentDetails');
        detailsUrl.searchParams.set('id', cleanId);
        detailsUrl.searchParams.set('key', apiKey);

        const res = await fetch(detailsUrl.toString(), {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(6000),
        });

        if (res.ok) {
          const data = await res.json();
          const item = data.items?.[0];
          if (item) {
            const duration = parseIso8601Duration(item.contentDetails?.duration || '');
            const thumb =
              item.snippet?.thumbnails?.high?.url ||
              item.snippet?.thumbnails?.medium?.url ||
              item.snippet?.thumbnails?.default?.url ||
              null;

            const track = this.normalizeVideoToTrack(
              cleanId,
              item.snippet?.title || 'Unknown Title',
              item.snippet?.channelTitle || 'YouTube',
              thumb,
              duration,
            );

            videoCache.set(cacheKey, { data: track, expiresAt: Date.now() + MATCH_CACHE_TTL_MS });
            return track;
          }
        } else if (res.status === 429 || res.status === 403) {
          this.setQuotaExceeded(15 * 60 * 1000);
        }
      } catch (err: any) {
        logger.warn('[YouTubeService] Data API video fetch failed, falling back to oEmbed', { error: err.message, videoId });
      }
    }

    // 2. Quota-free official oEmbed fallback (0 quota units, no API key required)
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${cleanId}`)}&format=json`;
      const oembedRes = await fetch(oembedUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (oembedRes.ok) {
        const oembedData = await oembedRes.json();
        const track = this.normalizeVideoToTrack(
          cleanId,
          oembedData.title || `YouTube Video (${cleanId})`,
          oembedData.author_name || 'YouTube',
          oembedData.thumbnail_url || `https://i.ytimg.com/vi/${cleanId}/hqdefault.jpg`,
          180
        );

        videoCache.set(cacheKey, { data: track, expiresAt: Date.now() + MATCH_CACHE_TTL_MS });
        return track;
      }
    } catch (oembedErr) {
      logger.warn('[YouTubeService] oEmbed fallback failed', { error: oembedErr, videoId });
    }

    // 3. Direct metadata fallback ensures pasted links can ALWAYS be played
    const fallbackTrack = this.normalizeVideoToTrack(
      cleanId,
      `YouTube Track (${cleanId})`,
      'YouTube',
      `https://i.ytimg.com/vi/${cleanId}/hqdefault.jpg`,
      180
    );
    videoCache.set(cacheKey, { data: fallbackTrack, expiresAt: Date.now() + MATCH_CACHE_TTL_MS });
    return fallbackTrack;
  }
}


export const youtubeService = new YouTubeService();

