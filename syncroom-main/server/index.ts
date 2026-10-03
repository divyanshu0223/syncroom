import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupWebSocketServer } from './websocket/connection';
import { spotifyRouter } from './spotify/spotifyRoutes';
import { youtubeRouter } from './youtube/youtubeRoutes';
import { playlistRouter, handleLoadPlaylistIntoRoomQueue } from './playlists/playlistRoutes';
import { userRouter } from './auth/userRoutes';
import { roomRouter } from './rooms/roomRoutes';
import { corsMiddleware } from './utils/cors';
import { securityHeadersMiddleware } from './utils/securityHeaders';
import { requestLogger, logger } from './utils/logger';
import { rateLimiter } from './utils/rateLimiter';
import { checkDatabaseConnection, closePool } from '../src/db/index';
import { roomManager } from './rooms/RoomManager';
import { validateStartupEnv } from './config/envValidation';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function startServer() {
  // 1. Startup Environment Validation
  const validatedEnv = validateStartupEnv();
  const isProduction = validatedEnv.isProduction;
  const PORT = validatedEnv.port;

  const app = express();
  const server = createServer(app);

  let isShuttingDown = false;

  // 2. Mount WebSocket Server on /ws path with 64KB max payload protection
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: 64 * 1024, // 64 KB message size limit
  });
  setupWebSocketServer(wss, () => isShuttingDown);

  // 3. Global Security, CORS & Logging Middlewares
  app.use(corsMiddleware);
  app.use(securityHeadersMiddleware);
  app.use(requestLogger);
  app.use(express.json({ limit: '2mb' }));

  // 4. In-flight request rejection during graceful shutdown
  app.use((_req, res, next) => {
    if (isShuttingDown) {
      res.setHeader('Connection', 'close');
      return res.status(503).json({ error: 'Server is currently undergoing graceful shutdown.' });
    }
    next();
  });

  // 5. Health Check Endpoint (GET /health and GET /api/health)
  const handleHealth = (_req: express.Request, res: express.Response) => {
    res.status(200).json({
      status: 'ok',
      service: 'syncroom',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      activeConnections: wss.clients.size,
    });
  };
  app.get('/health', handleHealth);
  app.get('/api/health', handleHealth);

  // 6. Readiness Probe (GET /ready and GET /api/ready)
  // Accurately reports readiness based on configured dependencies without pretending unconfigured dependencies are healthy
  const handleReady = async (_req: express.Request, res: express.Response) => {
    if (isShuttingDown) {
      return res.status(503).json({
        status: 'unhealthy',
        service: 'syncroom',
        message: 'Server is shutting down',
      });
    }

    if (validatedEnv.databaseConfigured) {
      const dbCheck = await checkDatabaseConnection();
      if (dbCheck.isHealthy) {
        return res.status(200).json({
          status: 'ready',
          service: 'syncroom',
          application: 'healthy',
          trafficReady: true,
          mode: 'database_backed',
          dependencies: {
            database: {
              configured: true,
              status: 'connected',
              latencyMs: dbCheck.latencyMs,
            },
            spotify: {
              configured: validatedEnv.spotifyConfigured,
              status: validatedEnv.spotifyConfigured ? 'available' : 'unconfigured',
            },
            youtube: {
              configured: validatedEnv.youtubeConfigured,
              status: validatedEnv.youtubeConfigured ? 'available' : 'unconfigured',
            },
          },
          timestamp: new Date().toISOString(),
        });
      } else {
        return res.status(503).json({
          status: 'unhealthy',
          service: 'syncroom',
          application: 'healthy',
          trafficReady: false,
          mode: 'database_backed',
          dependencies: {
            database: {
              configured: true,
              status: 'unreachable',
              error: dbCheck.error,
              latencyMs: dbCheck.latencyMs,
            },
            spotify: {
              configured: validatedEnv.spotifyConfigured,
              status: validatedEnv.spotifyConfigured ? 'available' : 'unconfigured',
            },
            youtube: {
              configured: validatedEnv.youtubeConfigured,
              status: validatedEnv.youtubeConfigured ? 'available' : 'unconfigured',
            },
          },
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Database is required for persistent traffic in Phase 9
    return res.status(503).json({
      status: 'unhealthy',
      service: 'syncroom',
      application: 'healthy',
      trafficReady: false,
      mode: 'database_required',
      dependencies: {
        database: {
          configured: false,
          status: 'not_configured',
          error: 'PostgreSQL database connection is required for persistent traffic. Please set DATABASE_URL in environment.',
        },
        spotify: {
          configured: validatedEnv.spotifyConfigured,
          status: validatedEnv.spotifyConfigured ? 'available' : 'unconfigured',
        },
        youtube: {
          configured: validatedEnv.youtubeConfigured,
          status: validatedEnv.youtubeConfigured ? 'available' : 'unconfigured',
        },
      },
      timestamp: new Date().toISOString(),
    });
  };
  app.get('/ready', handleReady);
  app.get('/api/ready', handleReady);

  // 7. Mount Spotify OAuth & Web API routes
  app.use('/api/spotify', spotifyRouter);

  // Mount YouTube Search & Video API routes
  app.use('/api/youtube', youtubeRouter);

  // Mount User Identity API
  app.use('/api/user', userRouter);

  // Mount Room Creation & Metadata API
  app.use('/api/rooms', roomRouter);

  // Mount Custom SyncRoom Playlists API (Feature 2)
  app.use('/api/playlists', playlistRouter);
  app.post('/api/rooms/:roomId/queue/from-playlist/:playlistId', handleLoadPlaylistIntoRoomQueue);

  // 8. Static Frontend Serving or Vite Development Middleware
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    // Cache hashed assets for 1 year, never cache index.html
    const assetsPath = path.join(distPath, 'assets');
    app.use('/assets', express.static(assetsPath, { maxAge: '1y', immutable: true }));
    app.use(express.static(distPath, { maxAge: 0 }));
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  // 9. Centralized Backend Error-Handling Middleware
  // Production responses strictly suppress stack traces, paths, and internal implementation details
  app.use(
    (
      err: any,
      req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const correlationId = (req as any).correlationId;
      logger.error(`Unhandled error during ${req.method} ${req.path}`, err, { correlationId });

      const statusCode =
        typeof err?.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600
          ? err.statusCode
          : 500;

      if (isProduction) {
        res.status(statusCode).json({
          error: statusCode === 404 ? 'Resource not found' : 'An internal error occurred. Please try again.',
          correlationId,
        });
      } else {
        res.status(statusCode).json({
          error: err?.message || 'Internal server error',
          stack: err?.stack,
          correlationId,
        });
      }
    },
  );

  // 10. Graceful Shutdown Handlers
  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`[SyncRoom Server] Received ${signal}. Initiating graceful shutdown...`);

    // Force exit timeout safeguard (5s)
    const forceExitTimer = setTimeout(() => {
      logger.error('[SyncRoom Server] Forced process exit after shutdown timeout');
      process.exit(1);
    }, 5000);
    forceExitTimer.unref();

    try {
      // 1. Terminate RoomManager stale sweeps & active room connections
      roomManager.shutdown();

      // 2. Clean up RateLimiter timers
      rateLimiter.destroy();

      // 3. Close WebSocket server cleanly
      await new Promise<void>((resolve) => {
        wss.close((err) => {
          if (err) logger.warn('[SyncRoom Server] Error closing WebSocket server', { error: err.message });
          resolve();
        });
      });

      // 4. Stop accepting new HTTP connections
      await new Promise<void>((resolve) => {
        server.close((err) => {
          if (err) logger.warn('[SyncRoom Server] Error closing HTTP server', { error: err.message });
          resolve();
        });
      });

      // 5. Drain PostgreSQL connection pool if configured
      await closePool();

      logger.info('[SyncRoom Server] Graceful shutdown completed. Exiting cleanly.');
      process.exit(0);
    } catch (err) {
      logger.error('[SyncRoom Server] Error encountered during graceful shutdown', err);
      process.exit(1);
    }
  };

  process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.once('SIGINT', () => gracefulShutdown('SIGINT'));

  server.listen(PORT, '0.0.0.0', () => {
    logger.info(`[SyncRoom Server] Full-stack engine running on http://0.0.0.0:${PORT}`, {
      environment: validatedEnv.nodeEnv,
      port: PORT,
      databaseConfigured: validatedEnv.databaseConfigured,
      spotifyConfigured: validatedEnv.spotifyConfigured,
      youtubeConfigured: validatedEnv.youtubeConfigured,
    });

    if (validatedEnv.databaseConfigured) {
      roomManager
        .initializeFromDatabase()
        .then((count) => {
          if (count > 0) {
            logger.info(`[SyncRoom Recovery] Restored ${count} active room(s) from PostgreSQL.`);
          }
        })
        .catch((err) => {
          logger.warn('[SyncRoom Recovery] Database recovery notice', { error: err.message });
        });
    }

    try {
      if (process.env.SPOTIFY_REDIRECT_URI) {
        const redirectUrl = new URL(process.env.SPOTIFY_REDIRECT_URI);
        const redirectPort = redirectUrl.port ? parseInt(redirectUrl.port, 10) : null;
        if (redirectPort && redirectPort !== PORT) {
          const auxServer = createServer(app);
          auxServer.listen(redirectPort, '0.0.0.0', () => {
            logger.info(`[SyncRoom Server] Auxiliary Spotify callback listener active on port ${redirectPort}`);
          });
        }
      }
    } catch {
      // Ignore invalid URL format
    }
  });

  return { app, server, wss, gracefulShutdown };
}
