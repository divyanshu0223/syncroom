import crypto from 'crypto';
import { prisma, isDatabaseConfigured } from '../../src/db/prisma';
import { Track, QueueItem } from '../../src/types';
import { ActivityItem } from '../types';
import { logger } from '../utils/logger';

import { performance } from 'perf_hooks';

/**
 * Generates a cryptographically secure random session token.
 * Format: syncroom_session_<64-hex-chars>
 */
export function generateSessionToken(): string {
  return `syncroom_session_${crypto.randomBytes(32).toString('hex')}`;
}

/**
 * Computes a secure SHA-256 one-way hash of a session token for safe storage.
 */
export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

/**
 * Executes a database operation with automatic retry on transient connection drops (P1017, P2028).
 */
async function withDbRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      attempt++;
      const isConnectionDrop =
        err?.code === 'P1017' ||
        err?.code === 'P2028' ||
        err?.message?.includes('closed the connection') ||
        err?.message?.includes('10054');
      if (isConnectionDrop && attempt <= retries) {
        await new Promise((r) => setTimeout(r, 250 * attempt));
        continue;
      }
      throw err;
    }
  }
}

export class DbRepository {
  private ensureConfigured() {
    if (!isDatabaseConfigured()) {
      throw new Error(
        'DATABASE_NOT_CONFIGURED: PostgreSQL is required for persistent state. Please set DATABASE_URL in environment.',
      );
    }
  }

  /**
   * Persists a newly created Room, its Host User, RoomMember, and DeviceSession
   * atomically in a single ACID database transaction.
   */
  public async createRoom(params: {
    roomId: string;
    code: string;
    name: string;
    adminUserId: string;
    adminName: string;
    userAgent?: string;
    deviceName?: string;
  }): Promise<{ sessionToken: string; sessionTokenHash: string; durationMs: number }> {
    this.ensureConfigured();

    try {
      const now = new Date();
      const maxAgeDays = Number(process.env.SESSION_MAX_AGE_DAYS) || 7;
      const expiresAt = new Date(now.getTime() + maxAgeDays * 24 * 60 * 60 * 1000);
      const sessionToken = generateSessionToken();
      const sessionTokenHash = hashSessionToken(sessionToken);
      const sessionId = `ds_${crypto.randomBytes(12).toString('hex')}`;
      const memberId = `rm_${crypto.randomBytes(12).toString('hex')}`;
      const actId = `act_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
      const deviceName = params.deviceName || 'desktop';
      const userAgent = params.userAgent || null;
      const metadataStr = JSON.stringify({ name: params.name, admin: params.adminName });

      const tQueryStart = performance.now();
      logger.info(`[ROOM_CREATE] db_query_start roomId=${params.roomId}`);

      await withDbRetry(async () => {
        try {
          // Single-roundtrip atomic CTE transaction executes in 1 WAN network trip
          await prisma.$executeRaw`
            WITH ins_user AS (
              INSERT INTO "User" ("id", "name", "createdAt", "updatedAt")
              VALUES (${params.adminUserId}, ${params.adminName}, ${now}, ${now})
              ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "updatedAt" = ${now}
              RETURNING "id"
            ),
            ins_room AS (
              INSERT INTO "Room" ("id", "code", "name", "adminUserId", "createdAt", "updatedAt", "lastActiveAt", "status")
              SELECT ${params.roomId}, ${params.code}, ${params.name}, "id", ${now}, ${now}, ${now}, 'ACTIVE'::"RoomStatus"
              FROM ins_user
              RETURNING "id"
            ),
            ins_member AS (
              INSERT INTO "RoomMember" ("id", "roomId", "userId", "role", "joinedAt", "lastSeenAt", "isActive")
              SELECT ${memberId}, "id", ${params.adminUserId}, 'ADMIN'::"Role", ${now}, ${now}, true
              FROM ins_room
            ),
            ins_session AS (
              INSERT INTO "DeviceSession" ("id", "userId", "roomId", "sessionTokenHash", "role", "createdAt", "lastSeenAt", "expiresAt", "userAgent", "deviceName")
              SELECT ${sessionId}, ${params.adminUserId}, "id", ${sessionTokenHash}, 'ADMIN'::"Role", ${now}, ${now}, ${expiresAt}, ${userAgent}, ${deviceName}
              FROM ins_room
            ),
            ins_pb AS (
              INSERT INTO "PlaybackState" ("roomId", "isPlaying", "positionMs", "version", "updatedAt")
              SELECT "id", false, 0, 1, ${now}
              FROM ins_room
            )
            INSERT INTO "AuditLog" ("id", "roomId", "userId", "action", "metadata", "createdAt")
            SELECT ${actId}, "id", ${params.adminUserId}, 'ROOM_CREATED', ${metadataStr}, ${now}
            FROM ins_room;
          `;
        } catch (rawErr: any) {
          logger.warn(`[SyncRoom DB] Raw CTE createRoom failed (${rawErr?.message}), falling back to interactive transaction`);
          await prisma.$transaction(async (tx) => {
            await tx.user.upsert({
              where: { id: params.adminUserId },
              create: { id: params.adminUserId, name: params.adminName, createdAt: now, updatedAt: now },
              update: { name: params.adminName, updatedAt: now },
            });
            await tx.room.create({
              data: {
                id: params.roomId,
                code: params.code,
                name: params.name,
                adminUserId: params.adminUserId,
                createdAt: now,
                updatedAt: now,
                lastActiveAt: now,
                status: 'ACTIVE',
              },
            });
            await tx.roomMember.create({
              data: {
                id: memberId,
                roomId: params.roomId,
                userId: params.adminUserId,
                role: 'ADMIN',
                joinedAt: now,
                lastSeenAt: now,
                isActive: true,
              },
            });
            await tx.deviceSession.create({
              data: {
                id: sessionId,
                userId: params.adminUserId,
                roomId: params.roomId,
                sessionTokenHash,
                role: 'ADMIN',
                createdAt: now,
                lastSeenAt: now,
                expiresAt,
                userAgent,
                deviceName,
              },
            });
            await tx.playbackState.create({
              data: {
                roomId: params.roomId,
                trackId: null,
                isPlaying: false,
                positionMs: 0,
                startedAt: null,
                version: 1,
                updatedAt: now,
              },
            });
            await tx.auditLog.create({
              data: {
                id: actId,
                roomId: params.roomId,
                userId: params.adminUserId,
                action: 'ROOM_CREATED',
                metadata: metadataStr,
                createdAt: now,
              },
            });
          }, { timeout: 15000, maxWait: 10000 });
        }
      });

      const dbDurationMs = Math.round(performance.now() - tQueryStart);
      logger.info(`[ROOM_CREATE] db_query_end durationMs=${dbDurationMs} roomId=${params.roomId}`);

      return { sessionToken, sessionTokenHash, durationMs: dbDurationMs };
    } catch (error) {
      logger.error('[SyncRoom DB] Error creating room in PostgreSQL', error);
      throw new Error('DATABASE_ERROR: Failed to create room in database', { cause: error });
    }
  }

  /**
   * Persists a new listener joining an ACTIVE room atomically in a transaction.
   */
  public async joinRoom(params: {
    userId: string;
    code: string;
    userName: string;
    userAgent?: string;
    deviceName?: string;
  }): Promise<{
    sessionToken: string;
    sessionTokenHash: string;
    room: any;
  }> {
    this.ensureConfigured();

    try {
      const now = new Date();

      return await prisma.$transaction(async (tx) => {
        // 1. Validate active room
        const targetRoom = await tx.room.findFirst({
          where: {
            code: params.code,
            status: 'ACTIVE',
          },
        });

        if (!targetRoom) {
          throw new Error('ROOM_NOT_FOUND');
        }

        const maxAgeDays = Number(process.env.SESSION_MAX_AGE_DAYS) || 7;
        const expiresAt = new Date(now.getTime() + maxAgeDays * 24 * 60 * 60 * 1000);
        const sessionToken = generateSessionToken();
        const sessionTokenHash = hashSessionToken(sessionToken);
        const sessionId = `ds_${crypto.randomBytes(12).toString('hex')}`;

        // 2. Create or upsert User
        await tx.user.upsert({
          where: { id: params.userId },
          create: {
            id: params.userId,
            name: params.userName,
            createdAt: now,
            updatedAt: now,
          },
          update: {
            name: params.userName,
            updatedAt: now,
          },
        });

        // 3. Upsert RoomMember with LISTENER role
        await tx.roomMember.upsert({
          where: {
            roomId_userId: {
              roomId: targetRoom.id,
              userId: params.userId,
            },
          },
          create: {
            id: `rm_${crypto.randomBytes(12).toString('hex')}`,
            roomId: targetRoom.id,
            userId: params.userId,
            role: 'LISTENER',
            joinedAt: now,
            lastSeenAt: now,
            isActive: true,
          },
          update: {
            role: 'LISTENER',
            lastSeenAt: now,
            isActive: true,
          },
        });

        // 4. Create DeviceSession
        await tx.deviceSession.create({
          data: {
            id: sessionId,
            userId: params.userId,
            roomId: targetRoom.id,
            sessionTokenHash,
            role: 'LISTENER',
            createdAt: now,
            lastSeenAt: now,
            expiresAt,
            userAgent: params.userAgent || null,
            deviceName: params.deviceName || null,
          },
        });

        // 5. Update room lastActiveAt
        await tx.room.update({
          where: { id: targetRoom.id },
          data: { lastActiveAt: now },
        });

        // 6. Record AuditLog entry
        await tx.auditLog.create({
          data: {
            id: `act_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`,
            roomId: targetRoom.id,
            userId: params.userId,
            action: 'USER_JOINED',
            metadata: JSON.stringify({ name: params.userName }),
            createdAt: now,
          },
        });

        return { sessionToken, sessionTokenHash, room: targetRoom };
      });
    } catch (error) {
      if ((error as Error)?.message === 'ROOM_NOT_FOUND') {
        throw error;
      }
      logger.error('[SyncRoom DB] Error joining room in PostgreSQL', error);
      throw new Error('DATABASE_ERROR: Failed to join room in database', { cause: error });
    }
  }

  /**
   * Validates a session token by computing its hash and querying PostgreSQL.
   * Restores user, room, role, queue, playback state, and members.
   */
  public async validateAndRestoreSession(rawSessionToken: string): Promise<{
    session: any;
    user: any;
    room: any;
    role: 'admin' | 'listener';
    queue: QueueItem[];
    playbackState: any;
    currentTrack: Track | null;
    members: Array<{
      id: string;
      name: string;
      role: 'admin' | 'listener';
      joinedAt: number;
      isOnline: boolean;
    }>;
  } | null> {
    this.ensureConfigured();

    try {
      const tokenHash = hashSessionToken(rawSessionToken);
      const now = new Date();

      // Find valid session
      const session = await withDbRetry(() => prisma.deviceSession.findUnique({
        where: { sessionTokenHash: tokenHash },
        include: {
          user: true,
          room: {
            include: {
              members: {
                include: { user: true },
              },
              queueItems: {
                include: { track: true },
                orderBy: { position: 'asc' },
              },
              playbackState: {
                include: { track: true },
              },
            },
          },
        },
      }));

      if (!session) {
        return null;
      }

      // Check if session revoked or expired
      if (session.revokedAt) {
        return null;
      }
      if (session.expiresAt && session.expiresAt < now) {
        return null;
      }

      const room = session.room;
      if (!room || room.status !== 'ACTIVE') {
        return null;
      }

      const user = session.user;
      if (!user) {
        return null;
      }

      // Update session lastSeenAt and room lastActiveAt
      await prisma.$transaction([
        prisma.deviceSession.update({
          where: { id: session.id },
          data: { lastSeenAt: now },
        }),
        prisma.room.update({
          where: { id: room.id },
          data: { lastActiveAt: now },
        }),
      ]);

      // Normalize Playback State & Current Track
      const pbState = room.playbackState;
      let currentTrack: Track | null = null;
      if (pbState && pbState.track) {
        const t = pbState.track;
        let parsedArtists: string[] = [t.artist];
        try {
          parsedArtists = JSON.parse(t.artists);
        } catch {
          // Keep default
        }

        currentTrack = {
          id: t.id,
          provider: (t.provider as 'spotify' | 'local' | 'licensed') || 'spotify',
          providerTrackId: t.providerTrackId,
          title: t.title,
          artist: t.artist,
          artists: parsedArtists,
          album: t.album,
          albumArtUrl: t.albumArtUrl,
          duration: Math.round(t.durationMs / 1000),
          durationMs: t.durationMs,
          externalUrl: t.externalUrl,
          isPlayable: true,
          playbackStatus: t.provider === 'spotify' ? 'PROVIDER_NOT_CONFIGURED' : 'AVAILABLE',
          audioSource: t.provider === 'spotify' ? 'unavailable' : 'local',
        };
      }

      // Normalize Queue Items
      const queue: QueueItem[] = (room.queueItems || []).map((item) => {
        let addedByObj = { id: user.id, name: user.name, role: 'listener' as const };
        try {
          addedByObj = JSON.parse(item.addedBy);
        } catch {
          // Keep default
        }

        let parsedArtists: string[] = [item.track.artist];
        try {
          parsedArtists = JSON.parse(item.track.artists);
        } catch {
          // Keep default
        }

        const normalizedTrack: Track = {
          id: item.track.id,
          provider: (item.track.provider as 'spotify' | 'local' | 'licensed') || 'spotify',
          providerTrackId: item.track.providerTrackId,
          title: item.track.title,
          artist: item.track.artist,
          artists: parsedArtists,
          album: item.track.album,
          albumArtUrl: item.track.albumArtUrl,
          duration: Math.round(item.track.durationMs / 1000),
          durationMs: item.track.durationMs,
          externalUrl: item.track.externalUrl,
          isPlayable: true,
          playbackStatus: item.track.provider === 'spotify' ? 'PROVIDER_NOT_CONFIGURED' : 'AVAILABLE',
          audioSource: item.track.provider === 'spotify' ? 'unavailable' : 'local',
        };

        return {
          id: item.id,
          track: normalizedTrack,
          addedBy: addedByObj,
          addedAt: item.addedAt.getTime(),
        };
      });

      // Normalize Members
      const members = (room.members || []).map((m) => ({
        id: m.user.id,
        name: m.user.name,
        role: (m.role === 'ADMIN' ? 'admin' : 'listener') as 'admin' | 'listener',
        joinedAt: m.joinedAt.getTime(),
        isOnline: m.isActive,
      }));

      const role = session.role === 'ADMIN' ? 'admin' : 'listener';

      return {
        session,
        user,
        room,
        role,
        queue,
        playbackState: pbState,
        currentTrack,
        members,
      };
    } catch (error) {
      logger.error('[SyncRoom DB] Error validating session in PostgreSQL', error);
      return null;
    }
  }

  /**
   * Persists track metadata safely into the tracks table.
   */
  public async upsertTrack(track: Track): Promise<void> {
    this.ensureConfigured();

    try {
      const now = new Date();
      await prisma.track.upsert({
        where: { id: track.id },
        create: {
          id: track.id,
          provider: track.provider || 'spotify',
          providerTrackId: track.providerTrackId || track.id,
          title: track.title || 'Untitled Track',
          artist: track.artist || 'Unknown Artist',
          artists: JSON.stringify(track.artists || [track.artist || 'Unknown Artist']),
          album: track.album || 'Unknown Album',
          albumArtUrl: track.albumArtUrl || null,
          durationMs: track.durationMs || track.duration * 1000 || 180000,
          externalUrl: track.externalUrl || null,
          createdAt: now,
        },
        update: {
          title: track.title,
          artist: track.artist,
          artists: JSON.stringify(track.artists || [track.artist]),
          album: track.album,
          albumArtUrl: track.albumArtUrl,
          durationMs: track.durationMs || track.duration * 1000,
          externalUrl: track.externalUrl,
        },
      });
    } catch (error) {
      logger.error('[SyncRoom DB] Error saving track to database', error);
    }
  }

  /**
   * Persists authoritative playback state to PostgreSQL.
   */
  public async savePlaybackState(
    roomId: string,
    state: {
      trackId: string | null;
      isPlaying: boolean;
      positionMs: number;
      startedAt: number | null;
      version: number;
    },
  ): Promise<void> {
    this.ensureConfigured();

    try {
      const now = new Date();
      let validTrackId: string | null = null;
      if (state.trackId) {
        const trackExists = await prisma.track.findUnique({
          where: { id: state.trackId },
          select: { id: true },
        });
        if (trackExists) {
          validTrackId = state.trackId;
        }
      }

      await prisma.playbackState.upsert({
        where: { roomId },
        create: {
          roomId,
          trackId: validTrackId,
          isPlaying: state.isPlaying,
          positionMs: state.positionMs,
          startedAt: state.startedAt ? new Date(state.startedAt) : null,
          version: state.version,
          updatedAt: now,
        },
        update: {
          trackId: validTrackId,
          isPlaying: state.isPlaying,
          positionMs: state.positionMs,
          startedAt: state.startedAt ? new Date(state.startedAt) : null,
          version: state.version,
          updatedAt: now,
        },
      });
    } catch (error) {
      logger.error('[SyncRoom DB] Error saving playback state to database', error);
    }
  }

  /**
   * Persists the current queue items of a room into PostgreSQL atomically in a transaction.
   */
  public async saveQueue(roomId: string, items: QueueItem[]): Promise<void> {
    this.ensureConfigured();

    try {
      // 1. Upsert all tracks first
      for (const item of items) {
        if (item.track) {
          await this.upsertTrack(item.track);
        }
      }

      // 2. Atomically delete and recreate ordered queue items in a transaction
      await withDbRetry(() =>
        prisma.$transaction(
          async (tx) => {
            await tx.queueItem.deleteMany({
              where: { roomId },
            });

            if (items.length > 0) {
              await tx.queueItem.createMany({
                data: items.map((item, index) => ({
                  id: item.id,
                  roomId,
                  trackId: item.track.id,
                  position: index,
                  addedAt: new Date(item.addedAt || Date.now()),
                  addedBy: JSON.stringify(item.addedBy),
                })),
                skipDuplicates: true,
              });
            }
          },
          { timeout: 20000, maxWait: 15000 }
        )
      );
    } catch (error) {
      logger.error('[SyncRoom DB] Error saving queue to database', error);
    }
  }

  /**
   * Persists an imported playlist record.
   */
  public async saveImportedPlaylist(
    roomId: string,
    playlist: {
      id?: string;
      provider: string;
      providerPlaylistId: string;
      name: string;
      description?: string;
      imageUrl?: string;
      trackCount: number;
    },
  ): Promise<void> {
    this.ensureConfigured();

    try {
      await prisma.importedPlaylist.create({
        data: {
          id: playlist.id || `pl_${crypto.randomBytes(12).toString('hex')}`,
          roomId,
          provider: playlist.provider,
          providerPlaylistId: playlist.providerPlaylistId,
          name: playlist.name,
          description: playlist.description || null,
          imageUrl: playlist.imageUrl || null,
          trackCount: playlist.trackCount,
          importedAt: new Date(),
        },
      });
    } catch (error) {
      logger.error('[SyncRoom DB] Error saving imported playlist to database', error);
    }
  }

  /**
   * Updates a user's active presence in a room.
   */
  public async updateMemberPresence(roomId: string, userId: string, isActive: boolean): Promise<void> {
    this.ensureConfigured();

    try {
      await prisma.roomMember.updateMany({
        where: { roomId, userId },
        data: {
          isActive,
          lastSeenAt: new Date(),
        },
      });
    } catch (error) {
      logger.error('[SyncRoom DB] Error updating member presence', error);
    }
  }

  /**
   * Records a room activity event into PostgreSQL audit log.
   */
  public async recordActivity(
    roomId: string,
    action: string,
    userId?: string,
    metadata?: any,
  ): Promise<void> {
    this.ensureConfigured();

    try {
      // Guard: verify room exists in database before inserting audit log
      // to prevent P2003 foreign key constraint violation on AuditLog_roomId_fkey
      const roomExists = await prisma.room.findUnique({ where: { id: roomId }, select: { id: true } });
      if (!roomExists) {
        logger.warn('[SyncRoom DB] Skipping audit log: room not found in database', { roomId, action });
        return;
      }

      await prisma.auditLog.create({
        data: {
          id: `act_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`,
          roomId,
          userId: userId || null,
          action,
          metadata: metadata ? JSON.stringify(metadata) : null,
          createdAt: new Date(),
        },
      });
    } catch (error) {
      logger.error('[SyncRoom DB] Error recording activity', error);
    }
  }

  /**
   * Fetches the recent activities of a room from the audit log.
   */
  public async getRecentActivities(roomId: string, limit = 30): Promise<ActivityItem[]> {
    this.ensureConfigured();

    try {
      const records = await prisma.auditLog.findMany({
        where: { roomId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      return records.map((r) => {
        let meta: any = null;
        if (r.metadata) {
          try {
            meta = JSON.parse(r.metadata);
          } catch {
            meta = r.metadata;
          }
        }
        return {
          id: r.id,
          action: r.action,
          metadata: meta,
          createdAt: r.createdAt.getTime(),
        };
      });
    } catch (error) {
      logger.error('[SyncRoom DB] Error fetching activities from database', error);
      return [];
    }
  }

  /**
   * Updates room name in database.
   */
  public async renameRoom(roomId: string, newName: string): Promise<void> {
    this.ensureConfigured();

    try {
      // Guard: verify room exists before attempting update to prevent P2025
      const roomExists = await prisma.room.findUnique({ where: { id: roomId }, select: { id: true } });
      if (!roomExists) {
        logger.warn('[SyncRoom DB] Skipping rename: room not found in database', { roomId });
        return;
      }

      const now = new Date();
      await prisma.$transaction([
        prisma.room.update({
          where: { id: roomId },
          data: {
            name: newName.trim(),
            updatedAt: now,
            lastActiveAt: now,
          },
        }),
        prisma.auditLog.create({
          data: {
            id: `act_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`,
            roomId,
            action: 'ROOM_RENAMED',
            metadata: JSON.stringify({ newName }),
            createdAt: now,
          },
        }),
      ]);
    } catch (error) {
      logger.error('[SyncRoom DB] Error renaming room in database', error);
      throw new Error('DATABASE_ERROR: Failed to rename room', { cause: error });
    }
  }

  /**
   * Sets room status to ENDED in database and revokes active device sessions.
   */
  public async endRoom(roomId: string): Promise<void> {
    this.ensureConfigured();

    try {
      // Guard: verify room exists in database before attempting transactional update
      // to prevent P2025 (record not found) when room was only in-memory
      const roomExists = await prisma.room.findUnique({ where: { id: roomId }, select: { id: true } });
      if (!roomExists) {
        logger.warn('[SyncRoom DB] Skipping endRoom: room not found in database', { roomId });
        return;
      }

      const now = new Date();
      await prisma.$transaction([
        prisma.room.update({
          where: { id: roomId },
          data: {
            status: 'ENDED',
            updatedAt: now,
          },
        }),
        prisma.deviceSession.updateMany({
          where: { roomId },
          data: { revokedAt: now },
        }),
        prisma.roomMember.updateMany({
          where: { roomId },
          data: { isActive: false },
        }),
        prisma.auditLog.create({
          data: {
            id: `act_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`,
            roomId,
            action: 'ROOM_ENDED',
            createdAt: now,
          },
        }),
      ]);
    } catch (error) {
      logger.error('[SyncRoom DB] Error ending room in database', error);
      throw new Error('DATABASE_ERROR: Failed to end room', { cause: error });
    }
  }

  /**
   * Removes a member from a room and revokes their device sessions.
   */
  public async removeMember(roomId: string, userId: string): Promise<void> {
    this.ensureConfigured();

    try {
      // Guard: verify room exists in database before transactional member removal
      const roomExists = await prisma.room.findUnique({ where: { id: roomId }, select: { id: true } });
      if (!roomExists) {
        logger.warn('[SyncRoom DB] Skipping removeMember: room not found in database', { roomId, userId });
        return;
      }

      const now = new Date();
      await prisma.$transaction([
        prisma.deviceSession.updateMany({
          where: { roomId, userId },
          data: { revokedAt: now },
        }),
        prisma.roomMember.deleteMany({
          where: { roomId, userId },
        }),
        prisma.auditLog.create({
          data: {
            id: `act_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`,
            roomId,
            userId,
            action: 'USER_REMOVED',
            createdAt: now,
          },
        }),
      ]);
    } catch (error) {
      logger.error('[SyncRoom DB] Error removing member from database', error);
      throw new Error('DATABASE_ERROR: Failed to remove member', { cause: error });
    }
  }

  /**
   * Clears all queue items for a room in database.
   */
  public async clearQueue(roomId: string): Promise<void> {
    this.ensureConfigured();

    try {
      await prisma.queueItem.deleteMany({
        where: { roomId },
      });
    } catch (error) {
      logger.error('[SyncRoom DB] Error clearing queue in database', error);
    }
  }

  /**
   * Updates lastSeenAt on the user's active device session and room membership.
   */
  public async updateHeartbeat(userId: string, roomId?: string): Promise<void> {
    if (!isDatabaseConfigured()) return;

    try {
      const now = new Date();
      await prisma.deviceSession.updateMany({
        where: { userId },
        data: { lastSeenAt: now },
      });

      if (roomId) {
        await prisma.roomMember.updateMany({
          where: { roomId, userId },
          data: { lastSeenAt: now },
        });
      }
    } catch {
      // Non-blocking background heartbeat write
    }
  }

  /**
   * Recovers all ACTIVE rooms from PostgreSQL during backend server restart.
   * Restores rooms, playback state, ordered queue, and member sessions.
   */
  public async getActiveRooms(): Promise<
    Array<{
      room: any;
      playbackState: any;
      queue: QueueItem[];
      members: Array<{
        id: string;
        name: string;
        role: 'admin' | 'listener';
        joinedAt: number;
        isOnline: boolean;
      }>;
    }>
  > {
    if (!isDatabaseConfigured()) return [];

    try {
      const activeRooms = await prisma.room.findMany({
        where: { status: 'ACTIVE' },
        include: {
          playbackState: {
            include: { track: true },
          },
          queueItems: {
            include: { track: true },
            orderBy: { position: 'asc' },
          },
          members: {
            include: { user: true },
          },
        },
      });

      return activeRooms.map((r) => {
        const queue: QueueItem[] = (r.queueItems || []).map((item) => {
          let addedByObj = { id: item.trackId, name: 'Member', role: 'listener' as const };
          try {
            addedByObj = JSON.parse(item.addedBy);
          } catch {
            // Keep default
          }

          let parsedArtists: string[] = [item.track.artist];
          try {
            parsedArtists = JSON.parse(item.track.artists);
          } catch {
            // Keep default
          }

          const track: Track = {
            id: item.track.id,
            provider: (item.track.provider as 'spotify' | 'local' | 'licensed') || 'spotify',
            providerTrackId: item.track.providerTrackId,
            title: item.track.title,
            artist: item.track.artist,
            artists: parsedArtists,
            album: item.track.album,
            albumArtUrl: item.track.albumArtUrl,
            duration: Math.round(item.track.durationMs / 1000),
            durationMs: item.track.durationMs,
            externalUrl: item.track.externalUrl,
            isPlayable: true,
            playbackStatus: item.track.provider === 'spotify' ? 'PROVIDER_NOT_CONFIGURED' : 'AVAILABLE',
            audioSource: item.track.provider === 'spotify' ? 'unavailable' : 'local',
          };

          return {
            id: item.id,
            track,
            addedBy: addedByObj,
            addedAt: item.addedAt.getTime(),
          };
        });

        const members = (r.members || []).map((m) => ({
          id: m.user.id,
          name: m.user.name,
          role: (m.role === 'ADMIN' ? 'admin' : 'listener') as 'admin' | 'listener',
          joinedAt: m.joinedAt.getTime(),
          isOnline: m.isActive,
        }));

        return {
          room: r,
          playbackState: r.playbackState,
          queue,
          members,
        };
      });
    } catch (error) {
      logger.error('[SyncRoom DB] Error loading active rooms from database', error);
      return [];
    }
  }

  // ==========================================
  // CUSTOM PLAYLISTS PERSISTENCE (Feature 2)
  // ==========================================

  public async createCustomPlaylist(ownerId: string, name: string, description?: string) {
    this.ensureConfigured();
    return await withDbRetry(() =>
      prisma.customPlaylist.create({
        data: {
          ownerId,
          name: name.trim(),
          description: description?.trim() || null,
        },
        include: {
          tracks: {
            orderBy: { position: 'asc' },
          },
        },
      })
    );
  }

  public async getUserCustomPlaylists(ownerId: string) {
    this.ensureConfigured();
    const playlists = await withDbRetry(() =>
      prisma.customPlaylist.findMany({
        where: { ownerId },
        include: {
          tracks: {
            orderBy: { position: 'asc' },
          },
        },
        orderBy: { updatedAt: 'desc' },
      })
    );

    return playlists.map((p) => {
      const totalDurationMs = p.tracks.reduce((sum, t) => sum + (t.durationMs || 0), 0);
      const artworkUrl = p.tracks[0]?.albumArtUrl || null;
      return {
        id: p.id,
        ownerId: p.ownerId,
        name: p.name,
        description: p.description,
        trackCount: p.tracks.length,
        totalDurationMs,
        artworkUrl,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      };
    });
  }

  public async getCustomPlaylistById(playlistId: string) {
    this.ensureConfigured();
    const playlist = await withDbRetry(() =>
      prisma.customPlaylist.findUnique({
        where: { id: playlistId },
        include: {
          tracks: {
            orderBy: { position: 'asc' },
          },
        },
      })
    );

    if (!playlist) return null;

    const totalDurationMs = playlist.tracks.reduce((sum, t) => sum + (t.durationMs || 0), 0);
    const artworkUrl = playlist.tracks[0]?.albumArtUrl || null;

    const normalizedTracks: Track[] = playlist.tracks.map((t) => {
      let parsedArtists: string[] = [t.artist];
      try {
        parsedArtists = JSON.parse(t.artists);
      } catch {
        // Fallback to single artist
      }

      return {
        id: `spotify-${t.spotifyTrackId}`,
        provider: 'spotify',
        providerTrackId: t.spotifyTrackId,
        spotifyTrackId: t.spotifyTrackId,
        spotifyUri: t.spotifyUri,
        title: t.title,
        trackName: t.title,
        artist: t.artist,
        artistName: t.artist,
        artists: parsedArtists,
        album: t.album,
        albumName: t.album,
        albumArtUrl: t.albumArtUrl,
        artworkUrl: t.albumArtUrl,
        duration: Math.round(t.durationMs / 1000),
        durationMs: t.durationMs,
        externalUrl: t.spotifyUrl,
        spotifyUrl: t.spotifyUrl,
        position: t.position,
        createdAt: t.createdAt.toISOString(),
        isPlayable: true,
        playbackStatus: 'AVAILABLE',
        audioSource: 'unavailable',
      };
    });

    return {
      id: playlist.id,
      ownerId: playlist.ownerId,
      name: playlist.name,
      description: playlist.description,
      trackCount: playlist.tracks.length,
      totalDurationMs,
      artworkUrl,
      createdAt: playlist.createdAt.toISOString(),
      updatedAt: playlist.updatedAt.toISOString(),
      tracks: normalizedTracks,
      rawTracks: playlist.tracks,
    };
  }

  public async updateCustomPlaylist(playlistId: string, data: { name?: string; description?: string }) {
    this.ensureConfigured();
    return await withDbRetry(() =>
      prisma.customPlaylist.update({
        where: { id: playlistId },
        data: {
          ...(data.name ? { name: data.name.trim() } : {}),
          ...(data.description !== undefined ? { description: data.description?.trim() || null } : {}),
          updatedAt: new Date(),
        },
      })
    );
  }

  public async deleteCustomPlaylist(playlistId: string) {
    this.ensureConfigured();
    return await withDbRetry(() =>
      prisma.customPlaylist.delete({
        where: { id: playlistId },
      })
    );
  }

  public async addTrackToCustomPlaylist(playlistId: string, track: Track) {
    this.ensureConfigured();
    return await withDbRetry(() =>
      prisma.$transaction(async (tx) => {
        // Deduplication: check if track already exists in this playlist
        const existing = await tx.customPlaylistTrack.findUnique({
          where: {
            playlistId_spotifyTrackId: {
              playlistId,
              spotifyTrackId: track.providerTrackId,
            },
          },
        });

        if (existing) {
          const err = new Error('Track already exists in this playlist.') as any;
          err.code = 'DUPLICATE_TRACK';
          throw err;
        }

        // Get max position
        const lastTrack = await tx.customPlaylistTrack.findFirst({
          where: { playlistId },
          orderBy: { position: 'desc' },
          select: { position: true },
        });

        const nextPosition = lastTrack ? lastTrack.position + 1 : 0;
        const now = new Date();

        const artistsJson = JSON.stringify(track.artists && track.artists.length > 0 ? track.artists : [track.artist]);
        const spotifyUri = (track as any).spotifyUri || `spotify:track:${track.providerTrackId}`;

        const created = await tx.customPlaylistTrack.create({
          data: {
            playlistId,
            spotifyTrackId: track.providerTrackId,
            spotifyUri,
            title: track.title,
            artist: track.artist,
            artists: artistsJson,
            album: track.album,
            durationMs: track.durationMs || track.duration * 1000,
            albumArtUrl: track.albumArtUrl,
            spotifyUrl: track.externalUrl,
            position: nextPosition,
            createdAt: now,
          },
        });

        // Touch playlist updatedAt
        await tx.customPlaylist.update({
          where: { id: playlistId },
          data: { updatedAt: now },
        });

        return created;
      })
    );
  }

  public async removeTrackFromCustomPlaylist(playlistId: string, trackId: string) {
    this.ensureConfigured();
    return await withDbRetry(() =>
      prisma.$transaction(async (tx) => {
        const trackToDelete = await tx.customPlaylistTrack.findFirst({
          where: {
            playlistId,
            OR: [
              { id: trackId },
              { spotifyTrackId: trackId.replace(/^spotify-/, '') },
            ],
          },
        });

        if (!trackToDelete) {
          const err = new Error('Track not found in playlist.') as any;
          err.code = 'TRACK_NOT_FOUND';
          throw err;
        }

        await tx.customPlaylistTrack.delete({
          where: { id: trackToDelete.id },
        });

        // Recompact positions
        const remaining = await tx.customPlaylistTrack.findMany({
          where: { playlistId },
          orderBy: { position: 'asc' },
        });

        for (let i = 0; i < remaining.length; i++) {
          if (remaining[i].position !== i) {
            await tx.customPlaylistTrack.update({
              where: { id: remaining[i].id },
              data: { position: i },
            });
          }
        }

        await tx.customPlaylist.update({
          where: { id: playlistId },
          data: { updatedAt: new Date() },
        });

        return true;
      })
    );
  }

  public async reorderCustomPlaylistTracks(playlistId: string, trackIds: string[]) {
    this.ensureConfigured();
    return await withDbRetry(() =>
      prisma.$transaction(async (tx) => {
        const existing = await tx.customPlaylistTrack.findMany({
          where: { playlistId },
        });

        const idMap = new Map<string, string>();
        for (const t of existing) {
          idMap.set(t.id, t.id);
          idMap.set(t.spotifyTrackId, t.id);
          idMap.set(`spotify-${t.spotifyTrackId}`, t.id);
        }

        let pos = 0;
        for (const tid of trackIds) {
          const realDbId = idMap.get(tid);
          if (realDbId) {
            await tx.customPlaylistTrack.update({
              where: { id: realDbId },
              data: { position: pos++ },
            });
          }
        }

        await tx.customPlaylist.update({
          where: { id: playlistId },
          data: { updatedAt: new Date() },
        });

        return true;
      })
    );
  }
}

export const dbRepository = new DbRepository();
