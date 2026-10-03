import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { roomManager } from '../rooms/RoomManager';
import { parseClientMessage, formatErrorMessage } from './messages';
import {
  canControlPlayback,
  canModifyQueue,
  canRemoveMember,
  canManageRoom,
} from '../auth/permissions';
import { validateRoomCode, normalizeRoomCode } from '../../src/utils/roomCode';
import { rateLimiter } from '../utils/rateLimiter';
import { validateWebSocketOrigin } from '../utils/cors';
import { logger } from '../utils/logger';

export function setupWebSocketServer(wss: WebSocketServer, isShuttingDownGetter?: () => boolean) {
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    if (isShuttingDownGetter && isShuttingDownGetter()) {
      ws.close(1001, 'Server is undergoing graceful shutdown');
      return;
    }

    const ip = req.socket.remoteAddress || 'unknown';

    const maxConnPerMin = parseInt(process.env.WS_MAX_CONNECTIONS_PER_IP || '60', 10);
    if (!rateLimiter.checkLimit(`ws_conn_${ip}`, maxConnPerMin, 60000)) {
      logger.warn('[SyncRoom WS] Rejected connection due to IP rate limiting', { ip });
      ws.close(1008, 'Rate limit exceeded');
      return;
    }

    // 2. Origin Security Validation for Production
    const origin = req.headers.origin;
    const originValidation = validateWebSocketOrigin(origin);
    if (!originValidation.isValid) {
      logger.warn('[SyncRoom WS] Rejected connection due to disallowed Origin', {
        origin,
        reason: originValidation.reason,
        ip,
      });
      ws.close(1008, 'Policy Violation: Origin not permitted');
      return;
    }

    // 3. Reject sensitive secrets in query strings (enforce secure in-message handshake)
    const requestUrl = req.url || '';
    if (requestUrl.toLowerCase().includes('secret=') || requestUrl.toLowerCase().includes('token=')) {
      logger.warn('[SyncRoom WS] Connection query string contained sensitive parameter', {
        url: requestUrl.split('?')[0],
      });
    }

    logger.debug('[SyncRoom WS] Connection established', {
      origin,
      ip,
    });

    let msgCount = 0;
    let windowStart = Date.now();

    ws.on('message', async (data: string | Buffer) => {
      const now = Date.now();
      if (now - windowStart > 5000) {
        msgCount = 1;
        windowStart = now;
      } else {
        msgCount++;
        if (msgCount > 100) {
          roomManager.sendToWs(
            ws,
            formatErrorMessage('RATE_LIMITED', 'Message rate limit exceeded. Please slow down.'),
          );
          return;
        }
      }

      const raw =
        typeof data === 'string'
          ? data
          : Buffer.isBuffer(data)
          ? data.toString('utf-8')
          : Array.isArray(data)
          ? Buffer.concat(data).toString('utf-8')
          : Buffer.from(data).toString('utf-8');

      const parsed = parseClientMessage(raw);

      if (!parsed.success) {
        logger.warn('[SyncRoom WS] Invalid client message rejected', {
          error: parsed.error,
          ip,
        });
        roomManager.sendToWs(ws, formatErrorMessage('INVALID_MESSAGE', parsed.error));
        return;
      }

      const msg = parsed.data;

      try {
        switch (msg.type) {
          case 'PING': {
            roomManager.handleHeartbeat(ws);
            break;
          }

          case 'TIME_SYNC_REQUEST': {
            roomManager.sendToWs(ws, {
              type: 'TIME_SYNC_RESPONSE',
              clientSendTime: msg.clientSendTime,
              serverTime: Date.now(),
            });
            break;
          }

          case 'PLAYBACK_READY': {
            // Client confirmed track is preloaded and ready to sync
            break;
          }

          case 'CREATE_ROOM': {
            if (!rateLimiter.checkLimit(`create_${ip}`, 10, 60000)) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage('RATE_LIMITED', 'Too many room creations. Please slow down.'),
              );
              return;
            }

            const trimmedName = msg.name?.trim();
            const trimmedAdmin = msg.adminName?.trim();

            if (!trimmedName || !trimmedAdmin) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage('INVALID_MESSAGE', 'Room name and admin name are required'),
              );
              return;
            }

            try {
              const { room, user, sessionId, sessionToken } = await roomManager.createRoom(
                trimmedName,
                trimmedAdmin,
                ws,
                msg.device,
              );

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

              roomManager.sendToWs(ws, {
                type: 'ROOM_CREATED',
                room: clientState,
                user: clientUser,
                sessionId,
                sessionToken,
              });
            } catch (err: unknown) {
              const errMsg = (err as Error)?.message || '';
              if (errMsg.includes('DATABASE_NOT_CONFIGURED')) {
                roomManager.sendToWs(
                  ws,
                  formatErrorMessage('DATABASE_NOT_CONFIGURED', 'PostgreSQL database is not configured. Set DATABASE_URL to enable persistence.'),
                );
              } else {
                console.error('[SyncRoom] Error in CREATE_ROOM:', err);
                roomManager.sendToWs(
                  ws,
                  formatErrorMessage('INTERNAL_ERROR', 'Failed to create room in database'),
                );
              }
            }
            break;
          }

          case 'JOIN_ROOM': {
            if (!rateLimiter.checkLimit(`join_${ip}`, 30, 60000)) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage('RATE_LIMITED', 'Too many room join attempts. Please slow down.'),
              );
              return;
            }

            const trimmedName = msg.displayName?.trim();
            const normalizedCode = normalizeRoomCode(msg.code || '');

            if (!trimmedName) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage('INVALID_MESSAGE', 'Please enter your name'),
              );
              return;
            }

            const codeValidation = validateRoomCode(normalizedCode);
            if (!codeValidation.isValid) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage('INVALID_ROOM_CODE', 'Enter a valid 6-character room code'),
              );
              return;
            }

            try {
              const { room, user, sessionId, sessionToken } = await roomManager.joinRoom(
                normalizedCode,
                trimmedName,
                ws,
                msg.device,
              );

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

              roomManager.sendToWs(ws, {
                type: 'ROOM_JOINED',
                room: clientState,
                user: clientUser,
                sessionId,
                sessionToken,
              });
            } catch (err: unknown) {
              const errMsg = (err as Error)?.message || '';
              if (errMsg.includes('DATABASE_NOT_CONFIGURED')) {
                roomManager.sendToWs(
                  ws,
                  formatErrorMessage('DATABASE_NOT_CONFIGURED', 'PostgreSQL database is not configured. Set DATABASE_URL to enable persistence.'),
                );
              } else if (errMsg === 'ROOM_NOT_FOUND') {
                roomManager.sendToWs(
                  ws,
                  formatErrorMessage('ROOM_NOT_FOUND', 'Room not found'),
                );
              } else {
                console.error('[SyncRoom] Error in JOIN_ROOM:', err);
                roomManager.sendToWs(
                  ws,
                  formatErrorMessage('INTERNAL_ERROR', 'Failed to join room'),
                );
              }
            }
            break;
          }

          case 'RECONNECT_SESSION': {
            if (!rateLimiter.checkLimit(`recon_${ip}`, 40, 60000)) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage('RATE_LIMITED', 'Too many reconnection attempts. Please wait a moment.'),
              );
              return;
            }

            const rawToken = (msg.sessionToken || msg.sessionId)?.trim();
            if (!rawToken) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage('INVALID_SESSION', 'Session token is missing'),
              );
              return;
            }

            try {
              const { room, user, sessionToken } = await roomManager.reconnectSession(rawToken, ws);
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

              roomManager.sendToWs(ws, {
                type: 'ROOM_STATE',
                room: clientState,
                user: clientUser,
                sessionId: sessionToken,
                sessionToken,
              });
            } catch (err: unknown) {
              const errMsg = (err as Error)?.message || '';
              if (errMsg.includes('DATABASE_NOT_CONFIGURED')) {
                roomManager.sendToWs(
                  ws,
                  formatErrorMessage('DATABASE_NOT_CONFIGURED', 'PostgreSQL database is not configured. Set DATABASE_URL to enable persistence.'),
                );
              } else {
                const errCode = errMsg === 'ROOM_NOT_FOUND' ? 'ROOM_NOT_FOUND' : 'SESSION_NOT_FOUND';
                roomManager.sendToWs(
                  ws,
                  formatErrorMessage(errCode, 'Session has expired or room no longer exists'),
                );
              }
            }
            break;
          }

          case 'LEAVE_ROOM': {
            roomManager.leaveRoom(ws);
            break;
          }

          case 'REPORT_DRIFT': {
            if (typeof msg.driftMs === 'number') {
              roomManager.updateUserDrift(ws, msg.driftMs);
            }
            break;
          }

          // ADMIN PLAYBACK COMMANDS - Server Authoritative & Serialized
          case 'ADMIN_PLAY':
          case 'ADMIN_PAUSE':
          case 'ADMIN_SEEK':
          case 'ADMIN_NEXT':
          case 'ADMIN_PREVIOUS':
          case 'ADMIN_SELECT_TRACK':
          case 'ADMIN_SET_CURRENT_TRACK': {
            const meta = roomManager.getSessionByWs(ws);
            if (!meta) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage('SESSION_NOT_FOUND', 'Active room session not found'),
              );
              return;
            }

            const room = roomManager.getRoom(meta.roomId);
            if (!room) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage('ROOM_NOT_FOUND', 'Room not found'),
              );
              return;
            }

            const user = room.getUser(meta.userId);
            if (!canControlPlayback(user)) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage('FORBIDDEN', 'Only the room admin can control playback.'),
              );
              return;
            }

            if (!rateLimiter.checkLimit(`pb_${meta.userId}`, 40, 60000)) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage('RATE_LIMITED', 'Too many playback commands. Please slow down.'),
              );
              return;
            }

            await roomManager.runRoomCommand(room.id, () => {
              if (msg.type === 'ADMIN_PLAY') {
                const started = room.play();
                if (!started) {
                  const track = room.currentTrack;
                  const reason = !track
                    ? 'No track selected or queue is empty.'
                    : track.playbackStatus === 'PROVIDER_NOT_CONFIGURED'
                    ? 'Audio playback provider is not configured.'
                    : track.playbackStatus === 'PROVIDER_RESTRICTED'
                    ? `Track restricted by Spotify (${track.restrictionReason || 'restricted'}).`
                    : 'Track is not available for playback.';
                  roomManager.sendToWs(
                    ws,
                    formatErrorMessage('PLAYBACK_NOT_AVAILABLE', reason)
                  );
                }
              } else if (msg.type === 'ADMIN_PAUSE') {
                room.pause();
              } else if (msg.type === 'ADMIN_SEEK') {
                room.seek(msg.position);
              } else if (msg.type === 'ADMIN_NEXT') {
                room.nextTrack();
              } else if (msg.type === 'ADMIN_PREVIOUS') {
                room.previousTrack();
              } else if (msg.type === 'ADMIN_SELECT_TRACK') {
                room.selectTrack(msg.trackId);
              } else if (msg.type === 'ADMIN_SET_CURRENT_TRACK') {
                room.setCurrentTrack(msg.track, msg.autoplay !== false);
                roomManager.broadcastQueue(room);
              }

              roomManager.broadcastPlaybackState(room);
            });
            break;
          }

          // ADMIN QUEUE COMMANDS - Server Authoritative & Serialized
          case 'ADMIN_ADD_QUEUE':
          case 'ADMIN_REMOVE_QUEUE':
          case 'ADMIN_REORDER_QUEUE':
          case 'ADMIN_CLEAR_QUEUE':
          case 'ADMIN_IMPORT_QUEUE': {
            const meta = roomManager.getSessionByWs(ws);
            if (!meta) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage('SESSION_NOT_FOUND', 'Active room session not found'),
              );
              return;
            }

            const room = roomManager.getRoom(meta.roomId);
            if (!room) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage('ROOM_NOT_FOUND', 'Room not found'),
              );
              return;
            }

            const user = room.getUser(meta.userId);
            if (!canModifyQueue(user)) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage('FORBIDDEN', 'Only the room admin can modify the queue.'),
              );
              return;
            }

            if (!rateLimiter.checkLimit(`q_${meta.userId}`, 30, 60000)) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage('RATE_LIMITED', 'Too many queue operations. Please slow down.'),
              );
              return;
            }

            await roomManager.runRoomCommand(room.id, () => {
              if (msg.type === 'ADMIN_ADD_QUEUE') {
                room.addToQueue(msg.track, user!);
              } else if (msg.type === 'ADMIN_REMOVE_QUEUE') {
                room.removeFromQueue(msg.queueItemId);
              } else if (msg.type === 'ADMIN_REORDER_QUEUE') {
                room.reorderQueue(msg.queueItemIds);
              } else if (msg.type === 'ADMIN_CLEAR_QUEUE') {
                room.clearQueue();
              } else if (msg.type === 'ADMIN_IMPORT_QUEUE') {
                room.importQueue(msg.tracks || [], user!, !!msg.replace);
                roomManager.broadcastPlaybackState(room);
              }

              roomManager.broadcastQueue(room);
            });
            break;
          }

          // ADMIN PARTICIPANT MANAGEMENT
          case 'ADMIN_REMOVE_USER': {
            const meta = roomManager.getSessionByWs(ws);
            if (!meta) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage('SESSION_NOT_FOUND', 'Active room session not found'),
              );
              return;
            }

            const room = roomManager.getRoom(meta.roomId);
            if (!room) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage('ROOM_NOT_FOUND', 'Room not found'),
              );
              return;
            }

            const user = room.getUser(meta.userId);
            if (!canRemoveMember(user)) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage('FORBIDDEN', 'Only the room admin can remove participants.'),
              );
              return;
            }

            try {
              await roomManager.removeUserFromRoom(room.id, msg.userId, user!);
            } catch (err: unknown) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage('INTERNAL_ERROR', 'Failed to remove participant'),
              );
            }
            break;
          }

          // ADMIN ROOM SETTINGS: RENAME ROOM
          case 'ADMIN_RENAME_ROOM': {
            const meta = roomManager.getSessionByWs(ws);
            if (!meta) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage('SESSION_NOT_FOUND', 'Active room session not found'),
              );
              return;
            }

            const room = roomManager.getRoom(meta.roomId);
            if (!room) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage('ROOM_NOT_FOUND', 'Room not found'),
              );
              return;
            }

            const user = room.getUser(meta.userId);
            if (!canManageRoom(user)) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage('FORBIDDEN', 'Only the room admin can rename this room.'),
              );
              return;
            }

            try {
              await roomManager.renameRoom(room.id, msg.newName, user!);
            } catch (err: unknown) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage('INTERNAL_ERROR', 'Failed to rename room'),
              );
            }
            break;
          }

          // ADMIN ROOM SETTINGS: END ROOM
          case 'ADMIN_END_ROOM': {
            const meta = roomManager.getSessionByWs(ws);
            if (!meta) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage('SESSION_NOT_FOUND', 'Active room session not found'),
              );
              return;
            }

            const room = roomManager.getRoom(meta.roomId);
            if (!room) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage('ROOM_NOT_FOUND', 'Room not found'),
              );
              return;
            }

            const user = room.getUser(meta.userId);
            if (!canManageRoom(user)) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage('FORBIDDEN', 'Only the room admin can end this room.'),
              );
              return;
            }

            try {
              await roomManager.endRoom(room.id, user!);
            } catch (err: unknown) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage('INTERNAL_ERROR', 'Failed to end room'),
              );
            }
            break;
          }

          // AUDIT ACTIVITIES
          case 'GET_ACTIVITIES': {
            const meta = roomManager.getSessionByWs(ws);
            if (!meta) return;

            const room = roomManager.getRoom(meta.roomId);
            if (!room) return;

            const user = room.getUser(meta.userId);
            if (!canManageRoom(user)) return;

            const activities = await roomManager.getRecentActivities(room.id);
            roomManager.sendToWs(ws, {
              type: 'ACTIVITIES_LOADED',
              activities,
            });
            break;
          }

          default:
            roomManager.sendToWs(
              ws,
              formatErrorMessage('INVALID_MESSAGE', 'Unknown message type'),
            );
        }
      } catch (err: unknown) {
        roomManager.sendToWs(
          ws,
          formatErrorMessage('INTERNAL_ERROR', 'Internal server error processing message'),
        );
      }
    });

    ws.on('close', (code, reason) => {
      logger.debug('[SyncRoom WS] Connection closed', { code, reason: reason?.toString() });
      roomManager.handleDisconnect(ws);
    });

    ws.on('error', (err) => {
      logger.warn('[SyncRoom WS] Connection socket error', { error: err.message });
      roomManager.handleDisconnect(ws);
    });
  });
}
