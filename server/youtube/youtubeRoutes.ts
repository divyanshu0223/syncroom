import { Router, Request, Response } from 'express';
import { youtubeService } from './youtubeService';
import { youtubeRateLimiter } from '../utils/rateLimiter';
import { logger } from '../utils/logger';

export const youtubeRouter = Router();

/**
 * GET /api/youtube/status
 * Returns whether YouTube API key is configured on the server and current quota state.
 */
youtubeRouter.get('/status', (_req: Request, res: Response) => {
  const configured = youtubeService.isConfigured();
  const quotaExceeded = youtubeService.isQuotaExceeded();
  return res.json({
    configured,
    quotaExceeded,
    cooldownSeconds: youtubeService.getQuotaCooldownSeconds(),
    provider: 'youtube',
    message: configured
      ? quotaExceeded
        ? 'YouTube search quota is currently exhausted. Direct link playback is still supported.'
        : 'YouTube API is configured.'
      : 'YOUTUBE_API_KEY is not set in environment.',
  });
});

/**
 * GET /api/youtube/search
 * Searches tracks on YouTube using official YouTube Data API v3 with caching and rate limiting.
 */
youtubeRouter.get('/search', youtubeRateLimiter, async (req: Request, res: Response) => {
  const query = (req.query.q as string) || '';
  if (!query.trim()) {
    return res.json({ tracks: [], configured: youtubeService.isConfigured() });
  }

  if (!youtubeService.isConfigured()) {
    return res.status(200).json({
      tracks: [],
      configured: false,
      error: 'YouTube API is not configured on the server. Please set YOUTUBE_API_KEY in .env.',
    });
  }

  try {
    const tracks = await youtubeService.searchTracks(query);
    return res.json({ tracks, configured: true });
  } catch (err: any) {
    const statusCode = typeof err.statusCode === 'number' ? err.statusCode : 500;
    const isQuota = err.code === 'YOUTUBE_QUOTA_EXCEEDED' || statusCode === 429;
    if (isQuota) {
      res.setHeader('Retry-After', youtubeService.getQuotaCooldownSeconds() || 900);
    }
    return res.status(statusCode).json({
      tracks: [],
      configured: true,
      quotaExceeded: isQuota,
      retryAfterSeconds: isQuota ? youtubeService.getQuotaCooldownSeconds() : undefined,
      error: err.message || 'Failed to search YouTube tracks.',
      code: err.code || 'YOUTUBE_SEARCH_FAILED',
    });
  }
});

/**
 * POST /api/youtube/find-match
 * Finds the corresponding YouTube video for a given song title and artist.
 */
youtubeRouter.post('/find-match', youtubeRateLimiter, async (req: Request, res: Response) => {
  const { title, artist } = req.body || {};
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Title is required to find YouTube match.' });
  }

  if (!youtubeService.isConfigured()) {
    return res.status(200).json({
      track: null,
      videoId: null,
      configured: false,
      error: 'YouTube API is not configured on the server. Please set YOUTUBE_API_KEY in .env.',
    });
  }

  try {
    const track = await youtubeService.findMatch(title, artist);
    return res.json({
      track,
      videoId: track ? track.providerTrackId : null,
      configured: true,
    });
  } catch (err: any) {
    const statusCode = typeof err.statusCode === 'number' ? err.statusCode : 500;
    const isQuota = err.code === 'YOUTUBE_QUOTA_EXCEEDED' || statusCode === 429;
    if (isQuota) {
      res.setHeader('Retry-After', youtubeService.getQuotaCooldownSeconds() || 900);
    }
    return res.status(statusCode).json({
      track: null,
      videoId: null,
      configured: true,
      quotaExceeded: isQuota,
      error: err.message || 'Failed to find YouTube match.',
      code: err.code || 'YOUTUBE_MATCH_FAILED',
    });
  }
});

/**
 * GET /api/youtube/video/:videoId
 * Fetches single video metadata by YouTube video ID.
 */
youtubeRouter.get('/video/:videoId', youtubeRateLimiter, async (req: Request, res: Response) => {
  const videoId = req.params.videoId;
  if (!videoId || !videoId.trim()) {
    return res.status(400).json({ error: 'Video ID is required.' });
  }

  try {
    const track = await youtubeService.getVideoById(videoId);
    if (!track) {
      return res.status(404).json({ error: 'YouTube video not found.' });
    }
    return res.json({ track, configured: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to retrieve YouTube video.' });
  }
});


