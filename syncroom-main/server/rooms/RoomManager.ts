import { WebSocket } from 'ws';
import { Room } from './Room';
import { ServerUser, SessionData, ServerMessage, ActivityItem } from '../types';
import { generateRoomCode, normalizeRoomCode } from '../../src/utils/roomCode';
import { dbRepository, generateSessionToken } from '../db/dbRepository';
import { canRemoveMember, canManageRoom } from '../auth/permissions';
import { logger } from '../utils/logger';
import { performance } from 'perf_hooks';

export class RoomManager {
  private roomsById: Map<string, Room> = new Map();
  private roomsByCode: Map<string, Room> = new Map();
  private sessions: Map<string, SessionData> = new Map();
  private userConnections: Map<string, WebSocket> = new Map();
  private connectionUsers: Map<WebSocket, { userId: string; sessionId: string; roomId: string }> = new Map();
  private staleSweepInterval: NodeJS.Timeout | null = null;
  private lastDbHeartbeats: Map<string, number> = new Map();

  constructor() {
    // Production stale connection check: sweeps every 25 seconds
    this.staleSweepInterval = setInterval(() => {
      this.sweepStaleConnections();
    }, 25000);
    this.staleSweepInterval.unref();
  }

  /**
   * Recovers active rooms, queues, and playback states from PostgreSQL on server startup.
   */
  public async initializeFromDatabase(): Promise<number> {
    const activeRooms = await dbRepository.getActiveRooms();
    for (const item of activeRooms) {
      const { room: r, playbackState, queue, members } = item;
      const room = new Room(r.id, r.code, r.name, r.adminUserId, playbackState?.track);
      if (queue && queue.length > 0) {
        room.queue = queue;
      }
      if (playbackState) {
        room.isPlaying = playbackState.isPlaying;
        room.position = Math.round(playbackState.positionMs / 1000);
        room.startedAt = playbackState.startedAt ? new Date(playbackState.startedAt).getTime() : null;
        room.startAt = room.startedAt;
        room.version = playbackState.version;
      }

      for (const m of members) {
        room.addUser({
          id: m.id,
          name: m.name,
          role: m.role,
          roomId: room.id,
          connected: false,
          lastSeen: m.joinedAt,
          sessionId: '',
        });
      }

      this.attachRoomDbListeners(room);
      this.roomsById.set(room.id, room);
      this.roomsByCode.set(room.code, room);
    }

    return activeRooms.length;
  }

  /**
   * Sweeps rooms for inactive or dead connections.
   * If a connection has dropped or sent no heartbeat for 45s, marks user offline
   * without deleting the session so they can seamlessly reconnect.
   */
  private sweepStaleConnections() {
    const now = Date.now();
    const STALE_THRESHOLD_MS = 45000;

    for (const room of this.roomsById.values()) {
      for (const user of room.users.values()) {
        if (user.connected) {
          const ws = this.userConnections.get(user.id);
          const isWsDead = !ws || ws.readyState !== WebSocket.OPEN;
          const isStale = now - user.lastSeen > STALE_THRESHOLD_MS;

          if (isWsDead || isStale) {
            user.connected = false;
            user.lastSeen = now;
            if (ws) {
              this.connectionUsers.delete(ws);
              this.userConnections.delete(user.id);
            }
            dbRepository.updateMemberPresence(room.id, user.id, false).catch(() => {});

            this.broadcastToRoom(room.id, {
              type: 'USER_UPDATED',
              user: {
                id: user.id,
                name: user.name,
                role: user.role,
                joinedAt: user.lastSeen,
                isOnline: false,
                device: user.device,
                driftMs: user.driftMs,
              },
            });
          }
        }
      }
    }
  }

  /**
   * Processes heartbeat PING from client: updates in-memory and database lastSeen,
   * keeping the session active and returning PONG.
   */
  public handleHeartbeat(ws: WebSocket) {
    const meta = this.connectionUsers.get(ws);
    const now = Date.now();
    // 1. Send PONG response immediately so client measures true network RTT
    this.sendToWs(ws, { type: 'PONG', timestamp: now });

    if (meta) {
      const room = this.roomsById.get(meta.roomId);
      if (room) {
        const user = room.getUser(meta.userId);
        if (user) {
          user.lastSeen = now;
          user.connected = true;
        }
      }
      const session = this.sessions.get(meta.sessionId);
      if (session) {
        session.lastSeen = now;
      }

      // 2. Throttle WAN database heartbeat to once every 60s per user to avoid pooling saturation
      const lastDb = this.lastDbHeartbeats.get(meta.userId) || 0;
      if (now - lastDb > 60000) {
        this.lastDbHeartbeats.set(meta.userId, now);
        dbRepository.updateHeartbeat(meta.userId, meta.roomId).catch(() => {});
      }
    }
  }

  /**
   * Retrieves active session details by session token/ID.
   */
  public getSession(sessionIdOrToken: string): SessionData | undefined {
    return this.sessions.get(sessionIdOrToken);
  }

  /**
   * Graceful shutdown of RoomManager resources and active WebSocket connections.
   */
  public shutdown() {
    if (this.staleSweepInterval) {
      clearInterval(this.staleSweepInterval);
      this.staleSweepInterval = null;
    }
    for (const [ws] of this.connectionUsers) {
      try {
        ws.close(1001, 'Server Going Away');
      } catch {
        // Ignore
      }
    }
    this.connectionUsers.clear();
    this.userConnections.clear();
  }



  /**
   * Attaches DB synchronization listeners to a room so that playback and queue state
   * are automatically persisted to PostgreSQL on changes.
   */
  private attachRoomDbListeners(room: Room) {
    room.setOnStateChange(() => {
      this.broadcastPlaybackState(room);
      this.broadcastQueue(room);

      // Asynchronously persist state to PostgreSQL
      const pbState = room.toPlaybackState();
      dbRepository
        .savePlaybackState(room.id, {
          trackId: pbState.trackId,
          isPlaying: pbState.isPlaying,
          positionMs: Math.round(pbState.position * 1000),
          startedAt: pbState.startedAt,
          version: pbState.version,
        })
        .catch((err) => console.error('[SyncRoom] DB savePlaybackState failed:', err));

      dbRepository
        .saveQueue(room.id, room.queue)
        .catch((err) => console.error('[SyncRoom] DB saveQueue failed:', err));
    });
  }

  private generateUniqueRoomCode(): string {
    let attempts = 0;
    while (attempts < 20) {
      const code = generateRoomCode();
      if (!this.roomsByCode.has(code)) {
        return code;
      }
      attempts++;
    }
    return 'SR' + Math.floor(1000 + Math.random() * 9000);
  }

  /**
   * Creates a new server room with creator guaranteed as admin.
   * Persists Room, User, RoomMember, and DeviceSession to PostgreSQL.
   */
  public async createRoom(
    name: string,
    adminName: string,
    ws?: WebSocket,
    device?: 'desktop' | 'mobile' | 'tablet' | 'speaker',
  ): Promise<{ room: Room; user: ServerUser; sessionId: string; sessionToken: string }> {
    const tStart = performance.now();
    const roomId = `room_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const adminId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const code = this.generateUniqueRoomCode();

    let sessionToken = generateSessionToken();

    logger.info(`[ROOM_CREATE] db_connect_start roomId=${roomId} code=${code}`);

    // 1. Persist to PostgreSQL database atomically
    const dbRes = await dbRepository.createRoom({
      roomId,
      code,
      name: name.trim() || 'SyncRoom',
      adminUserId: adminId,
      adminName: adminName.trim() || 'Admin',
      deviceName: device || 'desktop',
    });
    sessionToken = dbRes.sessionToken;

    logger.info(`[ROOM_CREATE] db_connected dbDurationMs=${dbRes.durationMs}`);

    const adminUser: ServerUser = {
      id: adminId,
      name: adminName.trim() || 'Admin',
      role: 'admin', // Server strictly assigns admin role
      roomId,
      connected: Boolean(ws),
      lastSeen: Date.now(),
      sessionId: sessionToken,
      device: device || 'desktop',
      driftMs: 0,
    };

    const room = new Room(roomId, code, name.trim() || 'SyncRoom', adminId);
    room.addUser(adminUser);
    this.attachRoomDbListeners(room);

    this.roomsById.set(roomId, room);
    this.roomsByCode.set(code, room);

    // Save in-memory fast session lookup
    this.sessions.set(sessionToken, {
      sessionId: sessionToken,
      userId: adminId,
      roomId,
      role: 'admin',
      name: adminUser.name,
      createdAt: Date.now(),
      lastSeen: Date.now(),
    });

    if (ws) {
      this.registerConnection(ws, adminId, sessionToken, roomId);
    }

    // Note: PlaybackState is already initialized in PostgreSQL during the atomic createRoom transaction.
    // If room has preloaded initial queue items, persist them; otherwise avoid redundant empty deleteMany roundtrip.
    if (room.queue.length > 0) {
      await dbRepository.saveQueue(roomId, room.queue);
    }

    const totalDurationMs = Math.round(performance.now() - tStart);
    logger.info(`[ROOM_CREATE] room_created durationMs=${totalDurationMs} roomId=${roomId} code=${code}`);

    return { room, user: adminUser, sessionId: sessionToken, sessionToken };
  }

  /**
   * Joins an existing room with joiner guaranteed as listener.
   * Persists Listener User, RoomMember, and DeviceSession to PostgreSQL.
   */
  public async joinRoom(
    code: string,
    displayName: string,
    ws: WebSocket,
    device?: 'desktop' | 'mobile' | 'tablet' | 'speaker',
  ): Promise<{ room: Room; user: ServerUser; sessionId: string; sessionToken: string }> {
    const normalizedCode = normalizeRoomCode(code);
    const userId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    let room = this.roomsByCode.get(normalizedCode);
    let sessionToken = generateSessionToken();

    // 1. Persist Listener to PostgreSQL database (Mandatory in Phase 9)
    const dbRes = await dbRepository.joinRoom({
      userId,
      code: normalizedCode,
      userName: displayName.trim() || 'Listener',
      deviceName: device || 'mobile',
    });
    sessionToken = dbRes.sessionToken;
    if (!room && dbRes.room) {
      // Rehydrate room from database if server restarted
      room = new Room(dbRes.room.id, dbRes.room.code, dbRes.room.name, dbRes.room.adminUserId);
      this.attachRoomDbListeners(room);
      this.roomsById.set(room.id, room);
      this.roomsByCode.set(room.code, room);
    }

    if (!room) {
      throw new Error('ROOM_NOT_FOUND');
    }

    const listenerUser: ServerUser = {
      id: userId,
      name: displayName.trim() || 'Listener',
      role: 'listener', // Server strictly assigns listener role
      roomId: room.id,
      connected: true,
      lastSeen: Date.now(),
      sessionId: sessionToken,
      device: device || 'mobile',
      driftMs: 0, // Real measurement recorded once client reports sync
    };

    room.addUser(listenerUser);

    // Save in-memory fast session lookup
    this.sessions.set(sessionToken, {
      sessionId: sessionToken,
      userId,
      roomId: room.id,
      role: 'listener',
      name: listenerUser.name,
      createdAt: Date.now(),
      lastSeen: Date.now(),
    });

    this.registerConnection(ws, userId, sessionToken, room.id);

    // Broadcast user joined to other room members
    this.broadcastToRoom(
      room.id,
      {
        type: 'USER_JOINED',
        user: {
          id: listenerUser.id,
          name: listenerUser.name,
          role: listenerUser.role,
          joinedAt: listenerUser.lastSeen,
          isOnline: true,
          device: listenerUser.device,
          driftMs: listenerUser.driftMs,
        },
      },
      userId,
    );

    return { room, user: listenerUser, sessionId: sessionToken, sessionToken };
  }

  /**
   * Reconnects an existing session across browser refreshes, network drops, or server restarts.
   * Restores user identity, role, room, queue, and playback state from PostgreSQL.
   */
  public async reconnectSession(
    tokenOrSessionId: string,
    ws: WebSocket,
  ): Promise<{ room: Room; user: ServerUser; sessionToken: string }> {
    const rawToken = tokenOrSessionId?.trim();
    if (!rawToken) {
      throw new Error('SESSION_NOT_FOUND');
    }

    // 1. Check in-memory sessions first
    const inMem = this.sessions.get(rawToken);
    if (inMem) {
      const room = this.roomsById.get(inMem.roomId);
      if (room) {
        const user = room.getUser(inMem.userId);
        if (user) {
          user.connected = true;
          user.lastSeen = Date.now();
          this.registerConnection(ws, user.id, rawToken, room.id);
          this.broadcastToRoom(
            room.id,
            {
              type: 'USER_UPDATED',
              user: {
                id: user.id,
                name: user.name,
                role: user.role,
                joinedAt: user.lastSeen,
                isOnline: true,
                device: user.device,
                driftMs: user.driftMs,
              },
            },
            user.id,
          );
          return { room, user, sessionToken: rawToken };
        }
      }
    }

    // 2. Validate session token in PostgreSQL database
    let dbRestored: any = null;
    try {
      dbRestored = await dbRepository.validateAndRestoreSession(rawToken);
    } catch {
      // Database not configured or connection error
    }

    if (!dbRestored) {
      throw new Error('SESSION_NOT_FOUND');
    }

    const { session, user: dbUser, room: dbRoom, role, queue, playbackState, currentTrack } = dbRestored;

    // Ensure room is in memory
    let room = this.roomsById.get(dbRoom.id);
    if (!room) {
      // Recover Room state completely after server restart
      room = new Room(dbRoom.id, dbRoom.code, dbRoom.name, dbRoom.adminUserId, currentTrack);
      if (queue && queue.length > 0) {
        room.queue = queue;
      }
      if (playbackState) {
        room.isPlaying = playbackState.isPlaying;
        room.position = Math.round(playbackState.positionMs / 1000);
        room.startedAt = playbackState.startedAt ? new Date(playbackState.startedAt).getTime() : null;
        room.startAt = room.startedAt;
        room.version = playbackState.version;
      }

      // Restore other members known in room
      for (const m of dbRestored.members) {
        room.addUser({
          id: m.id,
          name: m.name,
          role: m.role,
          roomId: room.id,
          connected: m.id === dbUser.id,
          lastSeen: m.joinedAt,
          sessionId: '',
        });
      }

      this.attachRoomDbListeners(room);
      this.roomsById.set(room.id, room);
      this.roomsByCode.set(room.code, room);
    }

    // Restore user in room
    let user = room.getUser(dbUser.id);
    if (!user) {
      user = {
        id: dbUser.id,
        name: dbUser.name,
        role, // Strictly assigned from PostgreSQL DeviceSession
        roomId: room.id,
        connected: true,
        lastSeen: Date.now(),
        sessionId: rawToken,
      };
      room.addUser(user);
    } else {
      user.connected = true;
      user.lastSeen = Date.now();
      user.role = role; // Enforce DB role
    }

    this.registerConnection(ws, user.id, rawToken, room.id);
    await dbRepository.updateMemberPresence(room.id, user.id, true);

    // Notify others that user is back online
    this.broadcastToRoom(
      room.id,
      {
        type: 'USER_UPDATED',
        user: {
          id: user.id,
          name: user.name,
          role: user.role,
          joinedAt: user.lastSeen,
          isOnline: true,
          device: user.device,
          driftMs: user.driftMs,
        },
      },
      user.id,
    );

    return { room, user, sessionToken: rawToken };
  }

  public registerConnection(ws: WebSocket, userId: string, sessionId: string, roomId: string) {
    const existingWs = this.userConnections.get(userId);
    if (existingWs && existingWs !== ws) {
      try {
        this.connectionUsers.delete(existingWs);
        existingWs.close(1000, 'Replaced by newer connection');
      } catch {
        // Ignore socket close error
      }
    }
    this.userConnections.set(userId, ws);
    this.connectionUsers.set(ws, { userId, sessionId, roomId });
  }

  public handleDisconnect(ws: WebSocket) {
    const meta = this.connectionUsers.get(ws);
    if (!meta) return;

    this.connectionUsers.delete(ws);
    this.userConnections.delete(meta.userId);

    const room = this.roomsById.get(meta.roomId);
    if (room) {
      const user = room.getUser(meta.userId);
      if (user) {
        user.connected = false;
        user.lastSeen = Date.now();

        // Update DB member presence
        dbRepository.updateMemberPresence(room.id, user.id, false).catch(() => {});

        // Broadcast to remaining room members that user is offline
        this.broadcastToRoom(room.id, {
          type: 'USER_UPDATED',
          user: {
            id: user.id,
            name: user.name,
            role: user.role,
            joinedAt: user.lastSeen,
            isOnline: false,
            device: user.device,
            driftMs: user.driftMs,
          },
        });
      }
    }
  }

  public leaveRoom(ws: WebSocket) {
    const meta = this.connectionUsers.get(ws);
    if (!meta) return;

    const room = this.roomsById.get(meta.roomId);
    if (room) {
      room.removeUser(meta.userId);
      dbRepository.updateMemberPresence(room.id, meta.userId, false).catch(() => {});

      // Broadcast user left
      this.broadcastToRoom(room.id, {
        type: 'USER_LEFT',
        userId: meta.userId,
      });
    }

    this.sessions.delete(meta.sessionId);
    this.connectionUsers.delete(ws);
    this.userConnections.delete(meta.userId);
  }

  public getSessionByWs(ws: WebSocket) {
    return this.connectionUsers.get(ws);
  }

  public getUser(userId: string): ServerUser | undefined {
    for (const room of this.roomsById.values()) {
      const u = room.getUser(userId);
      if (u) return u;
    }
    return undefined;
  }

  public getRoom(roomIdOrCode: string): Room | undefined {
    const normalized = normalizeRoomCode(roomIdOrCode);
    return this.roomsByCode.get(normalized) || this.roomsById.get(roomIdOrCode);
  }

  public broadcastToRoom(roomId: string, message: ServerMessage, excludeUserId?: string) {
    const room = this.roomsById.get(roomId);
    if (!room) return;

    const payload = JSON.stringify(message);

    for (const [userId] of room.users.entries()) {
      if (excludeUserId && userId === excludeUserId) continue;
      const clientWs = this.userConnections.get(userId);
      if (clientWs && clientWs.readyState === WebSocket.OPEN) {
        try {
          clientWs.send(payload);
        } catch {
          // Send failed
        }
      }
    }
  }

  public broadcastPlaybackState(room: Room) {
    const state = room.toPlaybackState();
    this.broadcastToRoom(room.id, {
      type: 'PLAYBACK_STATE',
      state,
      isPlaying: state.isPlaying,
      position: state.position,
      currentTrackId: state.trackId,
      startedAt: state.startedAt,
    });
  }

  public broadcastQueue(room: Room) {
    this.broadcastToRoom(room.id, {
      type: 'QUEUE_UPDATED',
      queue: room.queue,
      currentTrack: room.currentTrack,
      queueVersion: room.queueVersion,
    });
  }

  /**
   * Updates real measured drift reported by a client's SyncEngine.
   */
  public updateUserDrift(ws: WebSocket, driftMs: number) {
    const meta = this.connectionUsers.get(ws);
    if (!meta) return;
    const room = this.roomsById.get(meta.roomId);
    if (!room) return;
    const user = room.getUser(meta.userId);
    if (!user) return;

    user.driftMs = Math.round(driftMs);
    user.lastSeen = Date.now();
  }

  /**
   * Per-room async command queue / mutex to serialize rapid admin commands
   * and prevent concurrent mutation races.
   */
  private roomLocks: Map<string, Promise<void>> = new Map();

  public async runRoomCommand<T>(roomId: string, action: () => Promise<T> | T): Promise<T> {
    const currentLock = this.roomLocks.get(roomId) || Promise.resolve();
    let releaseLock: () => void = () => {};
    const nextLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    this.roomLocks.set(roomId, currentLock.then(() => nextLock));

    try {
      await currentLock;
      return await action();
    } finally {
      releaseLock();
      if (this.roomLocks.get(roomId) === nextLock) {
        this.roomLocks.delete(roomId);
      }
    }
  }

  public sendToWs(ws: WebSocket, message: ServerMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch {
        // Ignored
      }
    }
  }

  /**
   * ADMIN REMOVE USER: Removes a participant from the room, revokes their database session,
   * closes their connection, and informs them with USER_REMOVED.
   */
  public async removeUserFromRoom(roomId: string, targetUserId: string, adminUser: ServerUser): Promise<void> {
    if (!canRemoveMember(adminUser)) {
      throw new Error('FORBIDDEN');
    }

    const room = this.roomsById.get(roomId);
    if (!room) {
      throw new Error('ROOM_NOT_FOUND');
    }

    const targetUser = room.getUser(targetUserId);
    if (!targetUser) return;

    // 1. Remove user from room state
    room.removeUser(targetUserId);

    // 2. Locate their active WebSocket connection if open
    const targetWs = this.userConnections.get(targetUserId);
    if (targetWs) {
      this.sendToWs(targetWs, {
        type: 'USER_REMOVED',
        userId: targetUserId,
        message: 'You were removed from this room by the admin.',
      });

      this.connectionUsers.delete(targetWs);
      this.userConnections.delete(targetUserId);

      try {
        targetWs.close(1000, 'REMOVED_BY_ADMIN');
      } catch {
        // Ignored
      }
    }

    // 3. Invalidate room membership and revoke session in PostgreSQL
    try {
      await dbRepository.removeMember(roomId, targetUserId);
      await dbRepository.recordActivity(roomId, 'USER_REMOVED', adminUser.id, {
        targetUserId,
        targetUserName: targetUser.name,
      });
    } catch (err) {
      console.error('[SyncRoom] DB removeMember failed:', err);
    }

    // 5. Broadcast to remaining participants that user left
    this.broadcastToRoom(roomId, {
      type: 'USER_LEFT',
      userId: targetUserId,
    });
  }

  /**
   * ADMIN RENAME ROOM: Renames the room in memory, updates PostgreSQL, and broadcasts ROOM_UPDATED.
   */
  public async renameRoom(roomId: string, newName: string, adminUser: ServerUser): Promise<void> {
    if (!canManageRoom(adminUser)) {
      throw new Error('FORBIDDEN');
    }

    const room = this.roomsById.get(roomId);
    if (!room) {
      throw new Error('ROOM_NOT_FOUND');
    }

    const sanitizedName = newName.trim().slice(0, 50);
    if (!sanitizedName) {
      throw new Error('INVALID_MESSAGE');
    }

    room.rename(sanitizedName);
    try {
      await dbRepository.renameRoom(roomId, sanitizedName);
      await dbRepository.recordActivity(roomId, 'ROOM_RENAMED', adminUser.id, {
        newName: sanitizedName,
      });
    } catch (err) {
      console.error('[SyncRoom] DB renameRoom failed:', err);
    }

    // Broadcast updated state to all participants
    this.broadcastToRoom(roomId, {
      type: 'ROOM_UPDATED',
      room: room.toClientState(),
    });
  }

  /**
   * ADMIN END ROOM: Ends the room, closes all active connections, updates PostgreSQL, and broadcasts ROOM_ENDED.
   */
  public async endRoom(roomId: string, adminUser: ServerUser): Promise<void> {
    if (!canManageRoom(adminUser)) {
      throw new Error('FORBIDDEN');
    }

    const room = this.roomsById.get(roomId);
    if (!room) {
      throw new Error('ROOM_NOT_FOUND');
    }

    // 1. Broadcast ROOM_ENDED to all participants immediately
    this.broadcastToRoom(roomId, {
      type: 'ROOM_ENDED',
      message: 'Room ended by the admin.',
    });

    // 2. Stop room playback ticker
    room.destroy();

    // 3. Record activity and update DB asynchronously
    dbRepository.recordActivity(roomId, 'ROOM_ENDED', adminUser.id).catch((err) => {
      console.error('[SyncRoom] DB recordActivity failed:', err);
    });
    dbRepository.endRoom(roomId).catch((err) => {
      console.error('[SyncRoom] DB endRoom failed:', err);
    });

    // 4. Disconnect all clients in this room after brief flush tick so ROOM_ENDED payload is received
    setTimeout(() => {
      for (const [userId] of room.users.entries()) {
        const clientWs = this.userConnections.get(userId);
        if (clientWs) {
          this.connectionUsers.delete(clientWs);
          this.userConnections.delete(userId);
          try {
            clientWs.close(1000, 'ROOM_ENDED');
          } catch {
            // Ignored
          }
        }
      }
    }, 50);

    // 5. Clean up from memory maps
    this.roomsById.delete(roomId);
    this.roomsByCode.delete(room.code);
  }

  /**
   * Retrieves recent audit log activities for the room.
   */
  public async getRecentActivities(roomId: string): Promise<ActivityItem[]> {
    return dbRepository.getRecentActivities(roomId);
  }
}

export const roomManager = new RoomManager();
