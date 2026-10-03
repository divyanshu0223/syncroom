import { Request, Response, NextFunction } from 'express';

interface RateLimitRecord {
  timestamps: number[];
}

export class RateLimiter {
  private records: Map<string, RateLimitRecord> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Periodically clean up expired records every 60 seconds
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
    this.cleanupInterval.unref(); // Ensure interval doesn't prevent graceful exit
  }

  /**
   * Check if a key has exceeded maxRequests within windowMs.
   * If allowed, records the request and returns true.
   * If limited, returns false.
   */
  public checkLimit(key: string, maxRequests: number, windowMs: number): boolean {
    const now = Date.now();
    let record = this.records.get(key);

    if (!record) {
      record = { timestamps: [] };
      this.records.set(key, record);
    }

    // Filter out timestamps outside the active window
    record.timestamps = record.timestamps.filter((ts) => now - ts < windowMs);

    if (record.timestamps.length >= maxRequests) {
      return false; // Rate limited
    }

    record.timestamps.push(now);
    return true; // Allowed
  }

  /**
   * Returns current count and reset time for rate limit headers.
   */
  public getStatus(key: string, windowMs: number): { current: number; oldestTimestamp: number } {
    const now = Date.now();
    const record = this.records.get(key);
    if (!record) return { current: 0, oldestTimestamp: now };
    const valid = record.timestamps.filter((ts) => now - ts < windowMs);
    return {
      current: valid.length,
      oldestTimestamp: valid.length > 0 ? valid[0] : now,
    };
  }

  public reset() {
    this.records.clear();
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, record] of this.records.entries()) {
      record.timestamps = record.timestamps.filter((ts) => now - ts < 120000);
      if (record.timestamps.length === 0) {
        this.records.delete(key);
      }
    }
  }

  public destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.records.clear();
  }
}

export const rateLimiter = new RateLimiter();

/**
 * Creates an Express rate-limiting middleware.
 */
export function createApiRateLimiter(options: {
  max?: number;
  windowMs?: number;
  message?: string;
  prefix?: string;
}) {
  const windowMs = options.windowMs || parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
  const max = options.max || parseInt(process.env.RATE_LIMIT_MAX || '100', 10);
  const prefix = options.prefix || 'api';
  const message = options.message || 'Too many requests. Please try again later.';

  return (req: Request, res: Response, next: NextFunction) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${prefix}_${clientIp}`;

    const isAllowed = rateLimiter.checkLimit(key, max, windowMs);
    const status = rateLimiter.getStatus(key, windowMs);

    const remaining = Math.max(0, max - status.current);
    const resetTime = Math.ceil((status.oldestTimestamp + windowMs) / 1000);

    res.setHeader('RateLimit-Limit', max);
    res.setHeader('RateLimit-Remaining', remaining);
    res.setHeader('RateLimit-Reset', resetTime);

    if (!isAllowed) {
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      return res.status(429).json({
        error: message,
        retryAfterSeconds: Math.ceil(windowMs / 1000),
      });
    }

    next();
  };
}

// Configurable middleware instances
export const authRateLimiter = createApiRateLimiter({
  max: parseInt(process.env.RATE_LIMIT_AUTH_MAX || '30', 10),
  windowMs: 60000,
  prefix: 'auth',
  message: 'Too many authentication attempts. Please slow down.',
});

export const spotifyRateLimiter = createApiRateLimiter({
  max: parseInt(process.env.RATE_LIMIT_SPOTIFY_MAX || '40', 10),
  windowMs: 60000,
  prefix: 'spotify',
  message: 'Too many Spotify requests. Please slow down.',
});
