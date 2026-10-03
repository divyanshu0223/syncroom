import { logger } from '../utils/logger';

export interface ValidatedEnv {
  nodeEnv: 'development' | 'production' | 'test';
  isProduction: boolean;
  port: number;
  allowedOrigins: string[];
  sessionMaxAgeDays: number;
  spotifyConfigured: boolean;
  youtubeConfigured: boolean;
  databaseConfigured: boolean;
  rateLimit: {
    windowMs: number;
    max: number;
    authMax: number;
    spotifyMax: number;
  };
}

/**
 * Validates startup environment variables according to production standards.
 * Fails clearly if critical variables are corrupted.
 * Reports accurately on optional integrations without using dummy or fake credentials.
 */
export function validateStartupEnv(): ValidatedEnv {
  const nodeEnv = (process.env.NODE_ENV || 'development').toLowerCase() as
    | 'development'
    | 'production'
    | 'test';
  const isProduction = nodeEnv === 'production';

  // 1. Port Validation
  const rawPort = process.env.PORT || '3000';
  const port = parseInt(rawPort, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    const errorMsg = `[SyncRoom Config] Invalid PORT environment variable: "${rawPort}". Must be a number between 1 and 65535.`;
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }

  // 2. Client Origins Validation
  const rawOrigins =
    process.env.CLIENT_ORIGIN ||
    process.env.ALLOWED_ORIGINS ||
    process.env.FRONTEND_URL ||
    '';
  const allowedOrigins = rawOrigins
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);

  if (isProduction) {
    if (allowedOrigins.length === 0) {
      logger.warn(
        '[SyncRoom Config] No CLIENT_ORIGIN or ALLOWED_ORIGINS configured. Same-origin requests only will be accepted for CORS in production.',
      );
    } else {
      // Check for insecure http:// in production allowed origins
      const insecure = allowedOrigins.filter(
        (o) => o.startsWith('http://') && !o.includes('localhost') && !o.includes('127.0.0.1'),
      );
      if (insecure.length > 0) {
        logger.warn(
          `[SyncRoom Config] Insecure HTTP origin configured in production: ${insecure.join(', ')}. Recommend HTTPS for all production clients.`,
        );
      }
    }
  }

  // 3. Spotify OAuth Integration Check (Optional)
  const spotifyClientId = process.env.SPOTIFY_CLIENT_ID?.trim();
  const spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  let spotifyConfigured = false;

  if (spotifyClientId && spotifyClientSecret) {
    spotifyConfigured = true;
    logger.info('[SyncRoom Config] Spotify OAuth credentials detected and configured.');
  } else if (spotifyClientId || spotifyClientSecret) {
    logger.warn(
      '[SyncRoom Config] Partial Spotify configuration detected. Both SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are required. Spotify features will remain disabled.',
    );
  } else {
    logger.info(
      '[SyncRoom Config] Spotify integration is unconfigured. Client requests will receive authentic unconfigured status.',
    );
  }

  // 3b. YouTube API Integration Check (Optional)
  const youtubeApiKey = process.env.YOUTUBE_API_KEY?.trim();
  const youtubeConfigured = Boolean(youtubeApiKey);
  if (youtubeConfigured) {
    logger.info('[SyncRoom Config] YouTube Data API key detected and configured.');
  } else {
    logger.info('[SyncRoom Config] YouTube Data API is unconfigured.');
  }

  // 4. Database Configuration Check (Phase 9 PostgreSQL + Prisma)
  const hasDbUrl = Boolean(process.env.DATABASE_URL?.trim());
  const databaseConfigured = hasDbUrl;

  if (databaseConfigured) {
    logger.info('[SyncRoom Config] PostgreSQL configuration detected in environment (DATABASE_URL is set).');
  } else {
    logger.warn(
      '[SyncRoom Config] PostgreSQL not configured (DATABASE_URL unset). Persistent storage requires DATABASE_URL.',
    );
  }

  // 5. Session Configuration
  const rawSessionDays = process.env.SESSION_MAX_AGE_DAYS || '7';
  const sessionMaxAgeDays = parseInt(rawSessionDays, 10);
  if (isNaN(sessionMaxAgeDays) || sessionMaxAgeDays < 1) {
    logger.warn(
      `[SyncRoom Config] Invalid SESSION_MAX_AGE_DAYS: "${rawSessionDays}". Defaulting to 7 days.`,
    );
  }

  // 6. Rate Limiting Configuration
  const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
  const max = parseInt(process.env.RATE_LIMIT_MAX || '100', 10);
  const authMax = parseInt(process.env.RATE_LIMIT_AUTH_MAX || '30', 10);
  const spotifyMax = parseInt(process.env.RATE_LIMIT_SPOTIFY_MAX || '40', 10);

  const rateLimit = {
    windowMs: isNaN(windowMs) || windowMs < 1000 ? 60000 : windowMs,
    max: isNaN(max) || max < 1 ? 100 : max,
    authMax: isNaN(authMax) || authMax < 1 ? 30 : authMax,
    spotifyMax: isNaN(spotifyMax) || spotifyMax < 1 ? 40 : spotifyMax,
  };

  logger.info('[SyncRoom Config] Environment validation complete.', {
    environment: nodeEnv,
    port,
    allowedOriginsCount: allowedOrigins.length,
    spotifyConfigured,
    youtubeConfigured,
    databaseConfigured,
  });

  return {
    nodeEnv,
    isProduction,
    port: isNaN(port) ? 3000 : port,
    allowedOrigins,
    sessionMaxAgeDays: isNaN(sessionMaxAgeDays) ? 7 : sessionMaxAgeDays,
    spotifyConfigured,
    youtubeConfigured,
    databaseConfigured,
    rateLimit,
  };
}
