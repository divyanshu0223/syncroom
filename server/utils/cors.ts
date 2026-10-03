import { Request, Response, NextFunction } from 'express';

const isProduction = process.env.NODE_ENV === 'production';

export function getAllowedOrigins(): string[] {
  const envOrigins = [
    process.env.CLIENT_ORIGIN,
    process.env.ALLOWED_ORIGINS,
    process.env.FRONTEND_URL,
  ];

  const list: string[] = [
    'https://ramkushwah1214.github.io',
  ];

  for (const envVal of envOrigins) {
    if (envVal?.trim()) {
      // Support comma-separated origins if multiple domains are configured
      const parts = envVal
        .split(',')
        .map((s) => s.trim().replace(/\/$/, ''))
        .filter(Boolean);
      list.push(...parts);
    }
  }

  // Common development origins
  if (!isProduction) {
    list.push(
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    );
  }

  return Array.from(new Set(list));
}

/**
 * Validates incoming HTTP Origin against production-configured CLIENT_ORIGIN / ALLOWED_ORIGINS.
 * Never uses wildcard '*' in production for authenticated APIs.
 */
export function corsMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestOrigin = req.headers.origin;
  const allowedOrigins = getAllowedOrigins();

  if (requestOrigin) {
    const isAllowed =
      allowedOrigins.includes(requestOrigin) ||
      (!isProduction && (requestOrigin.includes('localhost') || requestOrigin.includes('127.0.0.1')));

    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader(
        'Access-Control-Allow-Methods',
        'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      );
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Session-Id, X-Session-Token, X-User-Id, X-User-Token, X-Device-Id, X-Correlation-Id',
      );
      res.setHeader('Access-Control-Max-Age', '86400');
    } else if (isProduction) {
      // In production, unauthorized origins are strictly blocked for cross-origin preflight requests
      if (req.method === 'OPTIONS') {
        return res.status(403).json({ error: 'CORS policy violation: Disallowed origin' });
      }
    }
  }

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }

  next();
}

/**
 * Validates Origin for incoming WebSocket upgrade/connection requests.
 */
export function validateWebSocketOrigin(origin: string | undefined): {
  isValid: boolean;
  reason?: string;
} {
  // If no origin header is provided (e.g. native app or direct same-origin connection), permit
  if (!origin) {
    return { isValid: true };
  }

  const normalized = origin.replace(/\/$/, '');
  const allowedOrigins = getAllowedOrigins();

  const isAllowed =
    allowedOrigins.includes(normalized) ||
    (!isProduction && (normalized.includes('localhost') || normalized.includes('127.0.0.1')));

  if (!isAllowed && isProduction) {
    return {
      isValid: false,
      reason: `WebSocket origin '${normalized}' is not in allowed origins list: ${allowedOrigins.join(', ')}`,
    };
  }

  return { isValid: true };
}
