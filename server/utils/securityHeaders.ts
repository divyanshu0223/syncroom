import { Request, Response, NextFunction } from 'express';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Production-ready Security Headers Middleware.
 * Protects against clickjacking, MIME sniffing, referrer leakage, and content injection.
 */
export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction) {
  // 1. Prevent MIME-type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // 2. Prevent clickjacking / framing
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  // 3. Control referrer leakage
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // 4. Disable obsolete XSS auditor in modern browsers
  res.setHeader('X-XSS-Protection', '0');

  // 5. Restrict browser feature permissions (explicitly allow encrypted-media and autoplay for Spotify Web Playback SDK)
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), encrypted-media=*, autoplay=*',
  );

  // 6. Strict Transport Security (HSTS) when on HTTPS
  const isHttps = req.secure || req.get('x-forwarded-proto') === 'https';
  if (isHttps || isProduction) {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload',
    );
  }

  // 7. Content Security Policy (CSP)
  // Structured to support SyncRoom React UI, Google Fonts, WebSockets, and Spotify APIs
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://sdk.scdn.co https://www.youtube.com https://s.ytimg.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https://*.scdn.co https://*.spotifycdn.com https://i.scdn.co https://mosaic.scdn.co https://images.unsplash.com https://i.ytimg.com https://*.ytimg.com https://*.youtube.com",
    "media-src 'self' data: blob: https: https://*.scdn.co https://*.spotifycdn.com",
    "connect-src 'self' ws: wss: https://*.spotify.com https://*.scdn.co https://api.spotify.com https://accounts.spotify.com wss://*.spotify.com wss://*.dealer.spotify.com https://*.spotifycdn.com https://*.youtube.com https://*.google.com https://*.googleapis.com",
    "frame-src 'self' https://sdk.scdn.co https://accounts.spotify.com https://open.spotify.com https://www.youtube.com https://www.youtube-nocookie.com",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
  ];

  res.setHeader('Content-Security-Policy', cspDirectives.join('; '));

  next();
}
