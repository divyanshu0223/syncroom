import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

const SENSITIVE_KEYS = new Set([
  'sessiontoken',
  'sessiontokenhash',
  'token',
  'secret',
  'password',
  'authorization',
  'cookie',
  'spotify_client_secret',
  'client_secret',
  'accesstoken',
  'refreshtoken',
  'database_url',
  'db_password',
  'sql_password',
  'sql_admin_password',
]);

/**
 * Recursively deep-clones an object while redacting sensitive fields.
 */
export function sanitizeLogData(data: any): any {
  if (data === null || data === undefined) return data;
  if (typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeLogData(item));
  }

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    let isSensitive = false;
    for (const sens of SENSITIVE_KEYS) {
      if (lowerKey.includes(sens)) {
        isSensitive = true;
        break;
      }
    }

    if (isSensitive) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeLogData(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

const isProduction = process.env.NODE_ENV === 'production';

export const logger = {
  info(message: string, context?: Record<string, any>) {
    const timestamp = new Date().toISOString();
    if (isProduction) {
      console.log(
        JSON.stringify({
          timestamp,
          level: 'INFO',
          message,
          ...(context ? sanitizeLogData(context) : {}),
        }),
      );
    } else {
      const extra = context ? ` ${JSON.stringify(sanitizeLogData(context))}` : '';
      console.log(`[${timestamp}] \x1b[36mINFO\x1b[0m ${message}${extra}`);
    }
  },

  warn(message: string, context?: Record<string, any>) {
    const timestamp = new Date().toISOString();
    if (isProduction) {
      console.warn(
        JSON.stringify({
          timestamp,
          level: 'WARN',
          message,
          ...(context ? sanitizeLogData(context) : {}),
        }),
      );
    } else {
      const extra = context ? ` ${JSON.stringify(sanitizeLogData(context))}` : '';
      console.warn(`[${timestamp}] \x1b[33mWARN\x1b[0m ${message}${extra}`);
    }
  },

  error(message: string, error?: unknown, context?: Record<string, any>) {
    const timestamp = new Date().toISOString();
    const errObj =
      error instanceof Error
        ? { errorName: error.name, errorMessage: error.message, stack: isProduction ? undefined : error.stack }
        : error
        ? { error: String(error) }
        : {};

    if (isProduction) {
      console.error(
        JSON.stringify({
          timestamp,
          level: 'ERROR',
          message,
          ...errObj,
          ...(context ? sanitizeLogData(context) : {}),
        }),
      );
    } else {
      const extra = context ? ` ${JSON.stringify(sanitizeLogData(context))}` : '';
      console.error(`[${timestamp}] \x1b[31mERROR\x1b[0m ${message}${extra}`, error || '');
    }
  },

  debug(message: string, context?: Record<string, any>) {
    if (!isProduction) {
      const timestamp = new Date().toISOString();
      const extra = context ? ` ${JSON.stringify(sanitizeLogData(context))}` : '';
      console.log(`[${timestamp}] \x1b[90mDEBUG\x1b[0m ${message}${extra}`);
    }
  },
};

/**
 * Express HTTP request logging middleware with correlation IDs.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  // Skip logging vite internal HMR / asset requests in dev
  if (req.path.startsWith('/@') || req.path.startsWith('/src/')) {
    return next();
  }

  // Attach or propagate request correlation ID
  const correlationId =
    (req.headers['x-correlation-id'] as string) ||
    (req.headers['x-request-id'] as string) ||
    `req_${crypto.randomBytes(8).toString('hex')}`;

  (req as any).correlationId = correlationId;
  res.setHeader('X-Correlation-Id', correlationId);

  const startTime = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    const statusCode = res.statusCode;

    const logContext = {
      correlationId,
      status: statusCode,
      durationMs,
      ip: req.ip || req.socket.remoteAddress,
      userAgent: req.get('user-agent'),
    };

    // Categorize log level based on response status
    if (statusCode >= 500) {
      logger.error(`HTTP ${req.method} ${req.path}`, undefined, logContext);
    } else if (statusCode >= 400) {
      logger.warn(`HTTP ${req.method} ${req.path}`, logContext);
    } else {
      logger.info(`HTTP ${req.method} ${req.path}`, {
        correlationId,
        status: statusCode,
        durationMs,
      });
    }
  });

  next();
}
