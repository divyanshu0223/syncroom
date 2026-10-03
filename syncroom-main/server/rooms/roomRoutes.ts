import { Router, Request, Response } from 'express';
import { roomManager } from './RoomManager';
import { rateLimiter } from '../utils/rateLimiter';
import { logger } from '../utils/logger';
import { performance } from 'perf_hooks';

export const roomRouter = Router();

/**
 * POST /api/rooms
 * Creates a new SyncRoom atomically and returns persisted room and session credentials.
 * Decoupled from WebSocket connection to eliminate WebSocket handshake blocking during room creation.
 */
roomRouter.post('/', async (req: Request, res: Response) => {
  const tStart = performance.now();
  const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';

  logger.info(`[ROOM_CREATE] server_request_start method=POST path=/api/rooms ip=${clientIp}`);

  // Rate Limiting (10 creations per 60s per IP)
  const tAuthStart = performance.now();
  if (!rateLimiter.checkLimit(`create_${clientIp}`, 10, 60000)) {
    return res.status(429).json({
      error: 'Too many room creations. Please slow down.',
      code: 'RATE_LIMITED',
    });
  }
  const authDurationMs = Math.round(performance.now() - tAuthStart);

  const { name, adminName, device } = req.body || {};
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  const trimmedAdmin = typeof adminName === 'string' ? adminName.trim() : '';

  if (!trimmedName || !trimmedAdmin) {
    return res.status(400).json({
      error: 'Room name and admin name are required',
      code: 'INVALID_INPUT',
    });
  }

  try {
    const tDbStart = performance.now();
    const { room, user, sessionId, sessionToken } = await roomManager.createRoom(
      trimmedName,
      trimmedAdmin,
      undefined, // WebSocket connection will be established asynchronously by client
      device,
    );
    const dbDurationMs = Math.round(performance.now() - tDbStart);

    const clientState = room.toClientState(user.id);
    const clientUser = {
      id: user.id,
      name: user.name,
      role: user.role,
      joinedAt: user.lastSeen,
      isOnline: true,
      isSelf: true,
      device: user.device,
      driftMs: user.driftMs,
    };

    const totalDurationMs = Math.round(performance.now() - tStart);

    // Set Server-Timing headers for standard performance profiling
    res.setHeader('Server-Timing', `total;dur=${totalDurationMs}, db;dur=${dbDurationMs}, auth;dur=${authDurationMs}`);

    logger.info(
      `[CREATE_ROOM] total=${totalDurationMs}ms auth=${authDurationMs}ms db=${dbDurationMs}ms roomId=${room.id} code=${room.code}`,
    );
    logger.info(`[ROOM_CREATE] response_sent durationMs=${totalDurationMs} roomId=${room.id}`);

    return res.status(201).json({
      success: true,
      room: clientState,
      user: clientUser,
      sessionId,
      sessionToken,
      durationMs: totalDurationMs,
    });
  } catch (err: unknown) {
    const totalDurationMs = Math.round(performance.now() - tStart);
    const errMsg = (err as Error)?.message || '';
    logger.error(`[ROOM_CREATE] error durationMs=${totalDurationMs} error=${errMsg}`, err);

    if (errMsg.includes('DATABASE_NOT_CONFIGURED')) {
      return res.status(503).json({
        error: 'PostgreSQL database is not configured. Set DATABASE_URL to enable persistence.',
        code: 'DATABASE_NOT_CONFIGURED',
      });
    }

    return res.status(500).json({
      error: 'Failed to create room in database',
      code: 'INTERNAL_ERROR',
    });
  }
});

/**
 * GET /api/rooms/:roomId
 * Returns current room state for validation or metadata fetch.
 */
roomRouter.get('/:roomId', (req: Request, res: Response) => {
  const room = roomManager.getRoom(req.params.roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found', code: 'ROOM_NOT_FOUND' });
  }
  return res.status(200).json({ success: true, room: room.toClientState() });
});

/**
 * GET /api/rooms/code/:code
 * Resolves room code to basic room info.
 */
roomRouter.get('/code/:code', (req: Request, res: Response) => {
  const room = roomManager.getRoom(req.params.code);
  if (!room) {
    return res.status(404).json({ error: 'Room not found', code: 'ROOM_NOT_FOUND' });
  }
  return res.status(200).json({
    success: true,
    room: {
      id: room.id,
      code: room.code,
      name: room.name,
      memberCount: room.users.size,
    },
  });
});
