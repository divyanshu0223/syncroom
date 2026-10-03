// server.ts
import "dotenv/config";

// server/index.ts
import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import path2 from "path";
import { fileURLToPath } from "url";

// server/rooms/RoomManager.ts
import { WebSocket } from "ws";

// server/rooms/Room.ts
var Room = class {
  constructor(id, code, name, adminId, initialTrack, onStateChange) {
    // monotonic queue revision
    this.isAdvancingTrack = false;
    // transition lock to prevent race conditions
    this.timer = null;
    this.id = id;
    this.code = code;
    this.name = name;
    this.adminId = adminId;
    this.createdAt = Date.now();
    this.users = /* @__PURE__ */ new Map();
    this.currentTrack = initialTrack !== void 0 ? initialTrack : null;
    this.isPlaying = false;
    this.position = 0;
    this.startedAt = null;
    this.startAt = null;
    this.serverTimestamp = Date.now();
    this.version = 1;
    this.queueVersion = 1;
    this.onStateChange = onStateChange;
    this.queue = [];
    this.startPlaybackTicker();
  }
  setOnStateChange(cb) {
    this.onStateChange = cb;
  }
  /**
   * Calculates the exact authoritative playback position at this millisecond.
   */
  getCurrentCalculatedPosition() {
    if (!this.isPlaying || !this.currentTrack) {
      return this.position;
    }
    const now = Date.now();
    if (this.startAt && now < this.startAt) {
      return this.position;
    }
    const origin = this.startedAt || this.startAt || now;
    const elapsed = Math.max(0, (now - origin) / 1e3);
    return Math.min(this.position + elapsed, this.currentTrack.duration);
  }
  startPlaybackTicker() {
    this.timer = setInterval(() => {
      if (!this.isPlaying || !this.currentTrack) return;
      const currentPos = this.getCurrentCalculatedPosition();
      if (currentPos >= this.currentTrack.duration) {
        this.nextTrack(800);
      }
    }, 1e3);
    this.timer.unref();
  }
  destroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isPlaying = false;
    this.startAt = null;
    this.startedAt = null;
    this.onStateChange = void 0;
  }
  addUser(user) {
    this.users.set(user.id, user);
  }
  getUser(userId) {
    return this.users.get(userId);
  }
  removeUser(userId) {
    this.users.delete(userId);
  }
  updateUserStatus(userId, connected) {
    const user = this.users.get(userId);
    if (user) {
      user.connected = connected;
      user.lastSeen = Date.now();
    }
  }
  /**
   * ADMIN PLAY: Schedules future start time so all network clients synchronize cleanly.
   * Returns false if no track or if playback is not available / provider not configured.
   */
  play(futureBufferMs = 600) {
    if (!this.currentTrack) return false;
    if (this.currentTrack.playbackStatus && this.currentTrack.playbackStatus !== "AVAILABLE") {
      return false;
    }
    const now = Date.now();
    this.position = this.getCurrentCalculatedPosition();
    this.startAt = now + futureBufferMs;
    this.startedAt = this.startAt;
    this.isPlaying = true;
    this.serverTimestamp = now;
    this.version++;
    this.onStateChange?.();
    return true;
  }
  /**
   * ADMIN PAUSE: Freezes playback at authoritative current position.
   */
  pause() {
    const now = Date.now();
    this.position = this.getCurrentCalculatedPosition();
    this.isPlaying = false;
    this.startAt = null;
    this.startedAt = null;
    this.serverTimestamp = now;
    this.version++;
    this.onStateChange?.();
  }
  /**
   * ADMIN SEEK: Calculates new position and schedules future restart if playing.
   */
  seek(targetPosition, futureBufferMs = 500) {
    if (typeof targetPosition !== "number" || !Number.isFinite(targetPosition) || targetPosition < 0) {
      return;
    }
    const maxDur = this.currentTrack?.duration || 0;
    const clamped = Math.max(0, Math.min(targetPosition, maxDur));
    const now = Date.now();
    this.position = clamped;
    if (this.isPlaying) {
      this.startAt = now + futureBufferMs;
      this.startedAt = this.startAt;
    } else {
      this.startAt = null;
      this.startedAt = null;
    }
    this.serverTimestamp = now;
    this.version++;
    this.onStateChange?.();
  }
  /**
   * ADMIN NEXT: Switches track and schedules synchronized start for all clients.
   * Uses server-side transition lock to prevent race conditions when multiple triggers occur.
   */
  nextTrack(futureBufferMs = 700) {
    if (this.isAdvancingTrack) return false;
    this.isAdvancingTrack = true;
    try {
      const now = Date.now();
      if (this.queue.length > 0) {
        const nextItem = this.queue.shift();
        this.currentTrack = nextItem.track;
        this.queueVersion++;
      } else {
        this.currentTrack = null;
        this.isPlaying = false;
        this.startAt = null;
        this.startedAt = null;
      }
      this.position = 0;
      const canPlay = this.currentTrack?.playbackStatus === "AVAILABLE";
      if (this.isPlaying && canPlay) {
        this.startAt = now + futureBufferMs;
        this.startedAt = this.startAt;
      } else {
        this.isPlaying = false;
        this.startAt = null;
        this.startedAt = null;
      }
      this.serverTimestamp = now;
      this.version++;
      this.onStateChange?.();
      return true;
    } finally {
      this.isAdvancingTrack = false;
    }
  }
  /**
   * ADMIN PREVIOUS: Restarts track or steps backward in catalog.
   */
  previousTrack(futureBufferMs = 700) {
    const now = Date.now();
    const currentPos = this.getCurrentCalculatedPosition();
    if (currentPos > 3) {
      this.position = 0;
    } else {
      this.position = 0;
    }
    if (this.isPlaying) {
      this.startAt = now + futureBufferMs;
      this.startedAt = this.startAt;
    } else {
      this.startAt = null;
      this.startedAt = null;
    }
    this.serverTimestamp = now;
    this.version++;
    this.onStateChange?.();
  }
  addToQueue(track, user) {
    const item = {
      id: `q-srv-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      track,
      addedBy: {
        id: user.id,
        name: user.name,
        role: user.role
      },
      addedAt: Date.now()
    };
    if (this.queue.length >= 500) {
      return null;
    }
    if (!this.currentTrack) {
      this.currentTrack = track;
      this.position = 0;
      this.isPlaying = false;
      this.version++;
    } else {
      this.queue.push(item);
      this.queueVersion++;
    }
    this.onStateChange?.();
    return item;
  }
  importQueue(tracks, user, replace = false) {
    const now = Date.now();
    const items = tracks.map((track, i) => ({
      id: `q-srv-${now}-${i}-${Math.random().toString(36).substring(2, 6)}`,
      track,
      addedBy: {
        id: user.id,
        name: user.name,
        role: user.role
      },
      addedAt: now + i
    }));
    if (replace) {
      this.queue = items.slice(0, 500);
      this.queueVersion++;
      if (!this.currentTrack && this.queue.length > 0) {
        const first = this.queue.shift();
        this.currentTrack = first.track;
        this.position = 0;
        const canPlay = first.track.playbackStatus === "AVAILABLE";
        this.startAt = canPlay ? now + 600 : null;
        this.startedAt = canPlay ? this.startAt : null;
        this.isPlaying = canPlay;
      }
    } else {
      const remainingSlots = Math.max(0, 500 - this.queue.length);
      this.queue.push(...items.slice(0, remainingSlots));
      this.queueVersion++;
      if (!this.currentTrack && this.queue.length > 0) {
        const first = this.queue.shift();
        this.currentTrack = first.track;
        this.position = 0;
        const canPlay = first.track.playbackStatus === "AVAILABLE";
        this.startAt = canPlay ? now + 600 : null;
        this.startedAt = canPlay ? this.startAt : null;
        this.isPlaying = canPlay;
      }
    }
    this.serverTimestamp = now;
    this.version++;
    this.onStateChange?.();
  }
  removeFromQueue(queueItemId) {
    const initialLen = this.queue.length;
    this.queue = this.queue.filter((q) => q.id !== queueItemId);
    const changed = this.queue.length !== initialLen;
    if (changed) {
      this.queueVersion++;
      this.onStateChange?.();
    }
    return changed;
  }
  reorderQueue(orderedIds) {
    const map = new Map(this.queue.map((q) => [q.id, q]));
    const nextQueue = [];
    for (const id of orderedIds) {
      const item = map.get(id);
      if (item) {
        nextQueue.push(item);
        map.delete(id);
      }
    }
    for (const item of map.values()) {
      nextQueue.push(item);
    }
    this.queue = nextQueue;
    this.queueVersion++;
    this.onStateChange?.();
    return true;
  }
  clearQueue() {
    this.queue = [];
    this.queueVersion++;
    this.onStateChange?.();
  }
  selectTrack(trackId, futureBufferMs = 600) {
    const now = Date.now();
    const queueIndex = this.queue.findIndex((q) => q.track.id === trackId || q.id === trackId);
    if (queueIndex !== -1) {
      const item = this.queue.splice(queueIndex, 1)[0];
      this.currentTrack = item.track;
      this.queueVersion++;
    } else {
      return;
    }
    this.position = 0;
    const canPlay = this.currentTrack?.playbackStatus === "AVAILABLE";
    if (canPlay) {
      this.startAt = now + futureBufferMs;
      this.startedAt = this.startAt;
      this.isPlaying = true;
    } else {
      this.isPlaying = false;
      this.startAt = null;
      this.startedAt = null;
    }
    this.serverTimestamp = now;
    this.version++;
    this.onStateChange?.();
  }
  setCurrentTrack(track, autoplay = true, futureBufferMs = 600) {
    const now = Date.now();
    this.currentTrack = track;
    this.position = 0;
    const canPlay = track.playbackStatus === "AVAILABLE";
    if (autoplay && canPlay) {
      this.startAt = now + futureBufferMs;
      this.startedAt = this.startAt;
      this.isPlaying = true;
    } else {
      this.isPlaying = false;
      this.startAt = null;
      this.startedAt = null;
    }
    this.serverTimestamp = now;
    this.version++;
    this.onStateChange?.();
  }
  rename(newName) {
    this.name = newName.trim();
  }
  toPlaybackState() {
    return {
      trackId: this.currentTrack ? this.currentTrack.id : null,
      isPlaying: this.isPlaying,
      position: this.getCurrentCalculatedPosition(),
      serverTimestamp: Date.now(),
      startedAt: this.startedAt,
      startAt: this.startAt,
      duration: this.currentTrack ? this.currentTrack.duration : 0,
      version: this.version
    };
  }
  toClientState(selfUserId) {
    const clientUsers = Array.from(this.users.values()).map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      joinedAt: u.lastSeen,
      isOnline: u.connected,
      isSelf: selfUserId ? u.id === selfUserId : false,
      device: u.device || "desktop",
      driftMs: u.driftMs || 0
    }));
    return {
      id: this.id,
      code: this.code,
      name: this.name,
      adminId: this.adminId,
      createdAt: this.createdAt,
      users: clientUsers,
      currentTrack: this.currentTrack,
      queue: [...this.queue],
      queueVersion: this.queueVersion,
      playerState: this.toPlaybackState()
    };
  }
};

// src/utils/roomCode.ts
var SAFE_CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateRoomCode() {
  let result = "";
  const length = 6;
  const charactersLength = SAFE_CHARACTERS.length;
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * charactersLength);
    result += SAFE_CHARACTERS.charAt(randomIndex);
  }
  return result;
}
function normalizeRoomCode(code) {
  return code.trim().toUpperCase();
}
function validateRoomCode(code) {
  const normalized = normalizeRoomCode(code);
  if (!normalized) {
    return { isValid: false, error: "Enter a valid 6-character room code" };
  }
  if (normalized.length !== 6) {
    return { isValid: false, error: "Enter a valid 6-character room code" };
  }
  const validRegex = /^[A-Z0-9]{6}$/;
  if (!validRegex.test(normalized)) {
    return { isValid: false, error: "Room code must contain only letters and numbers" };
  }
  return { isValid: true };
}

// server/db/dbRepository.ts
import crypto2 from "crypto";

// src/db/prisma.ts
import { PrismaClient } from "@prisma/client";
var DEFAULT_NEON_DATABASE_URL = "postgresql://neondb_owner:npg_GpUrkAHmO0l4@ep-summer-credit-b5wmuyp7-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
function isDatabaseConfigured() {
  const url = process.env.DATABASE_URL?.trim() || DEFAULT_NEON_DATABASE_URL;
  return Boolean(url && url.startsWith("postgres"));
}
function getPrismaClient() {
  if (!global._prismaInstance) {
    const isProduction4 = process.env.NODE_ENV === "production";
    let dbUrl = process.env.DATABASE_URL?.trim() || DEFAULT_NEON_DATABASE_URL;
    if (dbUrl.includes("npg_nJk6zX4qOsuM")) {
      dbUrl = dbUrl.replace("npg_nJk6zX4qOsuM", "npg_GpUrkAHmO0l4");
    }
    if (dbUrl.includes("-pooler.") && !dbUrl.includes("pgbouncer=true")) {
      const sep = dbUrl.includes("?") ? "&" : "?";
      dbUrl = `${dbUrl}${sep}pgbouncer=true&connect_timeout=15`;
    }
    global._prismaInstance = new PrismaClient({
      datasources: dbUrl ? { db: { url: dbUrl } } : void 0,
      log: isProduction4 ? ["error", "warn"] : ["error", "warn"],
      errorFormat: isProduction4 ? "minimal" : "pretty"
    });
  }
  return global._prismaInstance;
}
var prisma = getPrismaClient();
async function checkDatabaseConnection() {
  if (!isDatabaseConfigured()) {
    return {
      isHealthy: false,
      latencyMs: 0,
      error: "DATABASE_URL is not configured in environment variables."
    };
  }
  const start = Date.now();
  try {
    const client = getPrismaClient();
    await client.$queryRaw`SELECT 1 as ping;`;
    const latencyMs = Date.now() - start;
    return { isHealthy: true, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const errorMsg = err?.message || "PostgreSQL database unreachable";
    return { isHealthy: false, latencyMs, error: errorMsg };
  }
}
async function closePrisma() {
  if (global._prismaInstance) {
    try {
      await global._prismaInstance.$disconnect();
    } catch (err) {
      console.error("[SyncRoom Prisma] Error disconnecting client:", err);
    } finally {
      global._prismaInstance = void 0;
    }
  }
}

// server/utils/logger.ts
import crypto from "crypto";
var SENSITIVE_KEYS = /* @__PURE__ */ new Set([
  "sessiontoken",
  "sessiontokenhash",
  "token",
  "secret",
  "password",
  "authorization",
  "cookie",
  "spotify_client_secret",
  "client_secret",
  "accesstoken",
  "refreshtoken",
  "database_url",
  "db_password",
  "sql_password",
  "sql_admin_password"
]);
function sanitizeLogData(data) {
  if (data === null || data === void 0) return data;
  if (typeof data !== "object") return data;
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeLogData(item));
  }
  const sanitized = {};
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
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeLogData(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
var isProduction = process.env.NODE_ENV === "production";
var logger = {
  info(message, context) {
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    if (isProduction) {
      console.log(
        JSON.stringify({
          timestamp,
          level: "INFO",
          message,
          ...context ? sanitizeLogData(context) : {}
        })
      );
    } else {
      const extra = context ? ` ${JSON.stringify(sanitizeLogData(context))}` : "";
      console.log(`[${timestamp}] \x1B[36mINFO\x1B[0m ${message}${extra}`);
    }
  },
  warn(message, context) {
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    if (isProduction) {
      console.warn(
        JSON.stringify({
          timestamp,
          level: "WARN",
          message,
          ...context ? sanitizeLogData(context) : {}
        })
      );
    } else {
      const extra = context ? ` ${JSON.stringify(sanitizeLogData(context))}` : "";
      console.warn(`[${timestamp}] \x1B[33mWARN\x1B[0m ${message}${extra}`);
    }
  },
  error(message, error, context) {
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const errObj = error instanceof Error ? { errorName: error.name, errorMessage: error.message, stack: isProduction ? void 0 : error.stack } : error ? { error: String(error) } : {};
    if (isProduction) {
      console.error(
        JSON.stringify({
          timestamp,
          level: "ERROR",
          message,
          ...errObj,
          ...context ? sanitizeLogData(context) : {}
        })
      );
    } else {
      const extra = context ? ` ${JSON.stringify(sanitizeLogData(context))}` : "";
      console.error(`[${timestamp}] \x1B[31mERROR\x1B[0m ${message}${extra}`, error || "");
    }
  },
  debug(message, context) {
    if (!isProduction) {
      const timestamp = (/* @__PURE__ */ new Date()).toISOString();
      const extra = context ? ` ${JSON.stringify(sanitizeLogData(context))}` : "";
      console.log(`[${timestamp}] \x1B[90mDEBUG\x1B[0m ${message}${extra}`);
    }
  }
};
function requestLogger(req, res, next) {
  if (req.path.startsWith("/@") || req.path.startsWith("/src/")) {
    return next();
  }
  const correlationId = req.headers["x-correlation-id"] || req.headers["x-request-id"] || `req_${crypto.randomBytes(8).toString("hex")}`;
  req.correlationId = correlationId;
  res.setHeader("X-Correlation-Id", correlationId);
  const startTime = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - startTime;
    const statusCode = res.statusCode;
    const logContext = {
      correlationId,
      status: statusCode,
      durationMs,
      ip: req.ip || req.socket.remoteAddress,
      userAgent: req.get("user-agent")
    };
    if (statusCode >= 500) {
      logger.error(`HTTP ${req.method} ${req.path}`, void 0, logContext);
    } else if (statusCode >= 400) {
      logger.warn(`HTTP ${req.method} ${req.path}`, logContext);
    } else {
      logger.info(`HTTP ${req.method} ${req.path}`, {
        correlationId,
        status: statusCode,
        durationMs
      });
    }
  });
  next();
}

// server/db/dbRepository.ts
import { performance } from "perf_hooks";
function generateSessionToken() {
  return `syncroom_session_${crypto2.randomBytes(32).toString("hex")}`;
}
function hashSessionToken(token) {
  return crypto2.createHash("sha256").update(token.trim()).digest("hex");
}
async function withDbRetry(fn, retries = 2) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      const isConnectionDrop = err?.code === "P1017" || err?.code === "P2028" || err?.message?.includes("closed the connection") || err?.message?.includes("10054");
      if (isConnectionDrop && attempt <= retries) {
        await new Promise((r) => setTimeout(r, 250 * attempt));
        continue;
      }
      throw err;
    }
  }
}
var DbRepository = class {
  ensureConfigured() {
    if (!isDatabaseConfigured()) {
      throw new Error(
        "DATABASE_NOT_CONFIGURED: PostgreSQL is required for persistent state. Please set DATABASE_URL in environment."
      );
    }
  }
  /**
   * Persists a newly created Room, its Host User, RoomMember, and DeviceSession
   * atomically in a single ACID database transaction.
   */
  async createRoom(params) {
    this.ensureConfigured();
    try {
      const now = /* @__PURE__ */ new Date();
      const maxAgeDays = Number(process.env.SESSION_MAX_AGE_DAYS) || 7;
      const expiresAt = new Date(now.getTime() + maxAgeDays * 24 * 60 * 60 * 1e3);
      const sessionToken = generateSessionToken();
      const sessionTokenHash = hashSessionToken(sessionToken);
      const sessionId = `ds_${crypto2.randomBytes(12).toString("hex")}`;
      const memberId = `rm_${crypto2.randomBytes(12).toString("hex")}`;
      const actId = `act_${Date.now()}_${crypto2.randomBytes(6).toString("hex")}`;
      const deviceName = params.deviceName || "desktop";
      const userAgent = params.userAgent || null;
      const metadataStr = JSON.stringify({ name: params.name, admin: params.adminName });
      const tQueryStart = performance.now();
      logger.info(`[ROOM_CREATE] db_query_start roomId=${params.roomId}`);
      await withDbRetry(async () => {
        try {
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
        } catch (rawErr) {
          logger.warn(`[SyncRoom DB] Raw CTE createRoom failed (${rawErr?.message}), falling back to interactive transaction`);
          await prisma.$transaction(async (tx) => {
            await tx.user.upsert({
              where: { id: params.adminUserId },
              create: { id: params.adminUserId, name: params.adminName, createdAt: now, updatedAt: now },
              update: { name: params.adminName, updatedAt: now }
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
                status: "ACTIVE"
              }
            });
            await tx.roomMember.create({
              data: {
                id: memberId,
                roomId: params.roomId,
                userId: params.adminUserId,
                role: "ADMIN",
                joinedAt: now,
                lastSeenAt: now,
                isActive: true
              }
            });
            await tx.deviceSession.create({
              data: {
                id: sessionId,
                userId: params.adminUserId,
                roomId: params.roomId,
                sessionTokenHash,
                role: "ADMIN",
                createdAt: now,
                lastSeenAt: now,
                expiresAt,
                userAgent,
                deviceName
              }
            });
            await tx.playbackState.create({
              data: {
                roomId: params.roomId,
                trackId: null,
                isPlaying: false,
                positionMs: 0,
                startedAt: null,
                version: 1,
                updatedAt: now
              }
            });
            await tx.auditLog.create({
              data: {
                id: actId,
                roomId: params.roomId,
                userId: params.adminUserId,
                action: "ROOM_CREATED",
                metadata: metadataStr,
                createdAt: now
              }
            });
          }, { timeout: 15e3, maxWait: 1e4 });
        }
      });
      const dbDurationMs = Math.round(performance.now() - tQueryStart);
      logger.info(`[ROOM_CREATE] db_query_end durationMs=${dbDurationMs} roomId=${params.roomId}`);
      return { sessionToken, sessionTokenHash, durationMs: dbDurationMs };
    } catch (error) {
      logger.error("[SyncRoom DB] Error creating room in PostgreSQL", error);
      throw new Error("DATABASE_ERROR: Failed to create room in database", { cause: error });
    }
  }
  /**
   * Persists a new listener joining an ACTIVE room atomically in a transaction.
   */
  async joinRoom(params) {
    this.ensureConfigured();
    try {
      const now = /* @__PURE__ */ new Date();
      return await prisma.$transaction(async (tx) => {
        const targetRoom = await tx.room.findFirst({
          where: {
            code: params.code,
            status: "ACTIVE"
          }
        });
        if (!targetRoom) {
          throw new Error("ROOM_NOT_FOUND");
        }
        const maxAgeDays = Number(process.env.SESSION_MAX_AGE_DAYS) || 7;
        const expiresAt = new Date(now.getTime() + maxAgeDays * 24 * 60 * 60 * 1e3);
        const sessionToken = generateSessionToken();
        const sessionTokenHash = hashSessionToken(sessionToken);
        const sessionId = `ds_${crypto2.randomBytes(12).toString("hex")}`;
        await tx.user.upsert({
          where: { id: params.userId },
          create: {
            id: params.userId,
            name: params.userName,
            createdAt: now,
            updatedAt: now
          },
          update: {
            name: params.userName,
            updatedAt: now
          }
        });
        await tx.roomMember.upsert({
          where: {
            roomId_userId: {
              roomId: targetRoom.id,
              userId: params.userId
            }
          },
          create: {
            id: `rm_${crypto2.randomBytes(12).toString("hex")}`,
            roomId: targetRoom.id,
            userId: params.userId,
            role: "LISTENER",
            joinedAt: now,
            lastSeenAt: now,
            isActive: true
          },
          update: {
            role: "LISTENER",
            lastSeenAt: now,
            isActive: true
          }
        });
        await tx.deviceSession.create({
          data: {
            id: sessionId,
            userId: params.userId,
            roomId: targetRoom.id,
            sessionTokenHash,
            role: "LISTENER",
            createdAt: now,
            lastSeenAt: now,
            expiresAt,
            userAgent: params.userAgent || null,
            deviceName: params.deviceName || null
          }
        });
        await tx.room.update({
          where: { id: targetRoom.id },
          data: { lastActiveAt: now }
        });
        await tx.auditLog.create({
          data: {
            id: `act_${Date.now()}_${crypto2.randomBytes(6).toString("hex")}`,
            roomId: targetRoom.id,
            userId: params.userId,
            action: "USER_JOINED",
            metadata: JSON.stringify({ name: params.userName }),
            createdAt: now
          }
        });
        return { sessionToken, sessionTokenHash, room: targetRoom };
      });
    } catch (error) {
      if (error?.message === "ROOM_NOT_FOUND") {
        throw error;
      }
      logger.error("[SyncRoom DB] Error joining room in PostgreSQL", error);
      throw new Error("DATABASE_ERROR: Failed to join room in database", { cause: error });
    }
  }
  /**
   * Validates a session token by computing its hash and querying PostgreSQL.
   * Restores user, room, role, queue, playback state, and members.
   */
  async validateAndRestoreSession(rawSessionToken) {
    this.ensureConfigured();
    try {
      const tokenHash = hashSessionToken(rawSessionToken);
      const now = /* @__PURE__ */ new Date();
      const session = await withDbRetry(() => prisma.deviceSession.findUnique({
        where: { sessionTokenHash: tokenHash },
        include: {
          user: true,
          room: {
            include: {
              members: {
                include: { user: true }
              },
              queueItems: {
                include: { track: true },
                orderBy: { position: "asc" }
              },
              playbackState: {
                include: { track: true }
              }
            }
          }
        }
      }));
      if (!session) {
        return null;
      }
      if (session.revokedAt) {
        return null;
      }
      if (session.expiresAt && session.expiresAt < now) {
        return null;
      }
      const room = session.room;
      if (!room || room.status !== "ACTIVE") {
        return null;
      }
      const user = session.user;
      if (!user) {
        return null;
      }
      await prisma.$transaction([
        prisma.deviceSession.update({
          where: { id: session.id },
          data: { lastSeenAt: now }
        }),
        prisma.room.update({
          where: { id: room.id },
          data: { lastActiveAt: now }
        })
      ]);
      const pbState = room.playbackState;
      let currentTrack = null;
      if (pbState && pbState.track) {
        const t = pbState.track;
        let parsedArtists = [t.artist];
        try {
          parsedArtists = JSON.parse(t.artists);
        } catch {
        }
        currentTrack = {
          id: t.id,
          provider: t.provider || "spotify",
          providerTrackId: t.providerTrackId,
          title: t.title,
          artist: t.artist,
          artists: parsedArtists,
          album: t.album,
          albumArtUrl: t.albumArtUrl,
          duration: Math.round(t.durationMs / 1e3),
          durationMs: t.durationMs,
          externalUrl: t.externalUrl,
          isPlayable: true,
          playbackStatus: t.provider === "spotify" ? "PROVIDER_NOT_CONFIGURED" : "AVAILABLE",
          audioSource: t.provider === "spotify" ? "unavailable" : "local"
        };
      }
      const queue = (room.queueItems || []).map((item) => {
        let addedByObj = { id: user.id, name: user.name, role: "listener" };
        try {
          addedByObj = JSON.parse(item.addedBy);
        } catch {
        }
        let parsedArtists = [item.track.artist];
        try {
          parsedArtists = JSON.parse(item.track.artists);
        } catch {
        }
        const normalizedTrack = {
          id: item.track.id,
          provider: item.track.provider || "spotify",
          providerTrackId: item.track.providerTrackId,
          title: item.track.title,
          artist: item.track.artist,
          artists: parsedArtists,
          album: item.track.album,
          albumArtUrl: item.track.albumArtUrl,
          duration: Math.round(item.track.durationMs / 1e3),
          durationMs: item.track.durationMs,
          externalUrl: item.track.externalUrl,
          isPlayable: true,
          playbackStatus: item.track.provider === "spotify" ? "PROVIDER_NOT_CONFIGURED" : "AVAILABLE",
          audioSource: item.track.provider === "spotify" ? "unavailable" : "local"
        };
        return {
          id: item.id,
          track: normalizedTrack,
          addedBy: addedByObj,
          addedAt: item.addedAt.getTime()
        };
      });
      const members = (room.members || []).map((m) => ({
        id: m.user.id,
        name: m.user.name,
        role: m.role === "ADMIN" ? "admin" : "listener",
        joinedAt: m.joinedAt.getTime(),
        isOnline: m.isActive
      }));
      const role = session.role === "ADMIN" ? "admin" : "listener";
      return {
        session,
        user,
        room,
        role,
        queue,
        playbackState: pbState,
        currentTrack,
        members
      };
    } catch (error) {
      logger.error("[SyncRoom DB] Error validating session in PostgreSQL", error);
      return null;
    }
  }
  /**
   * Persists track metadata safely into the tracks table.
   */
  async upsertTrack(track) {
    this.ensureConfigured();
    try {
      const now = /* @__PURE__ */ new Date();
      await prisma.track.upsert({
        where: { id: track.id },
        create: {
          id: track.id,
          provider: track.provider || "spotify",
          providerTrackId: track.providerTrackId || track.id,
          title: track.title || "Untitled Track",
          artist: track.artist || "Unknown Artist",
          artists: JSON.stringify(track.artists || [track.artist || "Unknown Artist"]),
          album: track.album || "Unknown Album",
          albumArtUrl: track.albumArtUrl || null,
          durationMs: track.durationMs || track.duration * 1e3 || 18e4,
          externalUrl: track.externalUrl || null,
          createdAt: now
        },
        update: {
          title: track.title,
          artist: track.artist,
          artists: JSON.stringify(track.artists || [track.artist]),
          album: track.album,
          albumArtUrl: track.albumArtUrl,
          durationMs: track.durationMs || track.duration * 1e3,
          externalUrl: track.externalUrl
        }
      });
    } catch (error) {
      logger.error("[SyncRoom DB] Error saving track to database", error);
    }
  }
  /**
   * Persists authoritative playback state to PostgreSQL.
   */
  async savePlaybackState(roomId, state) {
    this.ensureConfigured();
    try {
      const now = /* @__PURE__ */ new Date();
      let validTrackId = null;
      if (state.trackId) {
        const trackExists = await prisma.track.findUnique({
          where: { id: state.trackId },
          select: { id: true }
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
          updatedAt: now
        },
        update: {
          trackId: validTrackId,
          isPlaying: state.isPlaying,
          positionMs: state.positionMs,
          startedAt: state.startedAt ? new Date(state.startedAt) : null,
          version: state.version,
          updatedAt: now
        }
      });
    } catch (error) {
      logger.error("[SyncRoom DB] Error saving playback state to database", error);
    }
  }
  /**
   * Persists the current queue items of a room into PostgreSQL atomically in a transaction.
   */
  async saveQueue(roomId, items) {
    this.ensureConfigured();
    try {
      for (const item of items) {
        if (item.track) {
          await this.upsertTrack(item.track);
        }
      }
      await withDbRetry(
        () => prisma.$transaction(
          async (tx) => {
            await tx.queueItem.deleteMany({
              where: { roomId }
            });
            if (items.length > 0) {
              await tx.queueItem.createMany({
                data: items.map((item, index) => ({
                  id: item.id,
                  roomId,
                  trackId: item.track.id,
                  position: index,
                  addedAt: new Date(item.addedAt || Date.now()),
                  addedBy: JSON.stringify(item.addedBy)
                })),
                skipDuplicates: true
              });
            }
          },
          { timeout: 2e4, maxWait: 15e3 }
        )
      );
    } catch (error) {
      logger.error("[SyncRoom DB] Error saving queue to database", error);
    }
  }
  /**
   * Persists an imported playlist record.
   */
  async saveImportedPlaylist(roomId, playlist) {
    this.ensureConfigured();
    try {
      await prisma.importedPlaylist.create({
        data: {
          id: playlist.id || `pl_${crypto2.randomBytes(12).toString("hex")}`,
          roomId,
          provider: playlist.provider,
          providerPlaylistId: playlist.providerPlaylistId,
          name: playlist.name,
          description: playlist.description || null,
          imageUrl: playlist.imageUrl || null,
          trackCount: playlist.trackCount,
          importedAt: /* @__PURE__ */ new Date()
        }
      });
    } catch (error) {
      logger.error("[SyncRoom DB] Error saving imported playlist to database", error);
    }
  }
  /**
   * Updates a user's active presence in a room.
   */
  async updateMemberPresence(roomId, userId, isActive) {
    this.ensureConfigured();
    try {
      await prisma.roomMember.updateMany({
        where: { roomId, userId },
        data: {
          isActive,
          lastSeenAt: /* @__PURE__ */ new Date()
        }
      });
    } catch (error) {
      logger.error("[SyncRoom DB] Error updating member presence", error);
    }
  }
  /**
   * Records a room activity event into PostgreSQL audit log.
   */
  async recordActivity(roomId, action, userId, metadata) {
    this.ensureConfigured();
    try {
      const roomExists = await prisma.room.findUnique({ where: { id: roomId }, select: { id: true } });
      if (!roomExists) {
        logger.warn("[SyncRoom DB] Skipping audit log: room not found in database", { roomId, action });
        return;
      }
      await prisma.auditLog.create({
        data: {
          id: `act_${Date.now()}_${crypto2.randomBytes(6).toString("hex")}`,
          roomId,
          userId: userId || null,
          action,
          metadata: metadata ? JSON.stringify(metadata) : null,
          createdAt: /* @__PURE__ */ new Date()
        }
      });
    } catch (error) {
      logger.error("[SyncRoom DB] Error recording activity", error);
    }
  }
  /**
   * Fetches the recent activities of a room from the audit log.
   */
  async getRecentActivities(roomId, limit = 30) {
    this.ensureConfigured();
    try {
      const records = await prisma.auditLog.findMany({
        where: { roomId },
        orderBy: { createdAt: "desc" },
        take: limit
      });
      return records.map((r) => {
        let meta = null;
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
          createdAt: r.createdAt.getTime()
        };
      });
    } catch (error) {
      logger.error("[SyncRoom DB] Error fetching activities from database", error);
      return [];
    }
  }
  /**
   * Updates room name in database.
   */
  async renameRoom(roomId, newName) {
    this.ensureConfigured();
    try {
      const roomExists = await prisma.room.findUnique({ where: { id: roomId }, select: { id: true } });
      if (!roomExists) {
        logger.warn("[SyncRoom DB] Skipping rename: room not found in database", { roomId });
        return;
      }
      const now = /* @__PURE__ */ new Date();
      await prisma.$transaction([
        prisma.room.update({
          where: { id: roomId },
          data: {
            name: newName.trim(),
            updatedAt: now,
            lastActiveAt: now
          }
        }),
        prisma.auditLog.create({
          data: {
            id: `act_${Date.now()}_${crypto2.randomBytes(6).toString("hex")}`,
            roomId,
            action: "ROOM_RENAMED",
            metadata: JSON.stringify({ newName }),
            createdAt: now
          }
        })
      ]);
    } catch (error) {
      logger.error("[SyncRoom DB] Error renaming room in database", error);
      throw new Error("DATABASE_ERROR: Failed to rename room", { cause: error });
    }
  }
  /**
   * Sets room status to ENDED in database and revokes active device sessions.
   */
  async endRoom(roomId) {
    this.ensureConfigured();
    try {
      const roomExists = await prisma.room.findUnique({ where: { id: roomId }, select: { id: true } });
      if (!roomExists) {
        logger.warn("[SyncRoom DB] Skipping endRoom: room not found in database", { roomId });
        return;
      }
      const now = /* @__PURE__ */ new Date();
      await prisma.$transaction([
        prisma.room.update({
          where: { id: roomId },
          data: {
            status: "ENDED",
            updatedAt: now
          }
        }),
        prisma.deviceSession.updateMany({
          where: { roomId },
          data: { revokedAt: now }
        }),
        prisma.roomMember.updateMany({
          where: { roomId },
          data: { isActive: false }
        }),
        prisma.auditLog.create({
          data: {
            id: `act_${Date.now()}_${crypto2.randomBytes(6).toString("hex")}`,
            roomId,
            action: "ROOM_ENDED",
            createdAt: now
          }
        })
      ]);
    } catch (error) {
      logger.error("[SyncRoom DB] Error ending room in database", error);
      throw new Error("DATABASE_ERROR: Failed to end room", { cause: error });
    }
  }
  /**
   * Removes a member from a room and revokes their device sessions.
   */
  async removeMember(roomId, userId) {
    this.ensureConfigured();
    try {
      const roomExists = await prisma.room.findUnique({ where: { id: roomId }, select: { id: true } });
      if (!roomExists) {
        logger.warn("[SyncRoom DB] Skipping removeMember: room not found in database", { roomId, userId });
        return;
      }
      const now = /* @__PURE__ */ new Date();
      await prisma.$transaction([
        prisma.deviceSession.updateMany({
          where: { roomId, userId },
          data: { revokedAt: now }
        }),
        prisma.roomMember.deleteMany({
          where: { roomId, userId }
        }),
        prisma.auditLog.create({
          data: {
            id: `act_${Date.now()}_${crypto2.randomBytes(6).toString("hex")}`,
            roomId,
            userId,
            action: "USER_REMOVED",
            createdAt: now
          }
        })
      ]);
    } catch (error) {
      logger.error("[SyncRoom DB] Error removing member from database", error);
      throw new Error("DATABASE_ERROR: Failed to remove member", { cause: error });
    }
  }
  /**
   * Clears all queue items for a room in database.
   */
  async clearQueue(roomId) {
    this.ensureConfigured();
    try {
      await prisma.queueItem.deleteMany({
        where: { roomId }
      });
    } catch (error) {
      logger.error("[SyncRoom DB] Error clearing queue in database", error);
    }
  }
  /**
   * Updates lastSeenAt on the user's active device session and room membership.
   */
  async updateHeartbeat(userId, roomId) {
    if (!isDatabaseConfigured()) return;
    try {
      const now = /* @__PURE__ */ new Date();
      await prisma.deviceSession.updateMany({
        where: { userId },
        data: { lastSeenAt: now }
      });
      if (roomId) {
        await prisma.roomMember.updateMany({
          where: { roomId, userId },
          data: { lastSeenAt: now }
        });
      }
    } catch {
    }
  }
  /**
   * Recovers all ACTIVE rooms from PostgreSQL during backend server restart.
   * Restores rooms, playback state, ordered queue, and member sessions.
   */
  async getActiveRooms() {
    if (!isDatabaseConfigured()) return [];
    try {
      const activeRooms = await prisma.room.findMany({
        where: { status: "ACTIVE" },
        include: {
          playbackState: {
            include: { track: true }
          },
          queueItems: {
            include: { track: true },
            orderBy: { position: "asc" }
          },
          members: {
            include: { user: true }
          }
        }
      });
      return activeRooms.map((r) => {
        const queue = (r.queueItems || []).map((item) => {
          let addedByObj = { id: item.trackId, name: "Member", role: "listener" };
          try {
            addedByObj = JSON.parse(item.addedBy);
          } catch {
          }
          let parsedArtists = [item.track.artist];
          try {
            parsedArtists = JSON.parse(item.track.artists);
          } catch {
          }
          const track = {
            id: item.track.id,
            provider: item.track.provider || "spotify",
            providerTrackId: item.track.providerTrackId,
            title: item.track.title,
            artist: item.track.artist,
            artists: parsedArtists,
            album: item.track.album,
            albumArtUrl: item.track.albumArtUrl,
            duration: Math.round(item.track.durationMs / 1e3),
            durationMs: item.track.durationMs,
            externalUrl: item.track.externalUrl,
            isPlayable: true,
            playbackStatus: item.track.provider === "spotify" ? "PROVIDER_NOT_CONFIGURED" : "AVAILABLE",
            audioSource: item.track.provider === "spotify" ? "unavailable" : "local"
          };
          return {
            id: item.id,
            track,
            addedBy: addedByObj,
            addedAt: item.addedAt.getTime()
          };
        });
        const members = (r.members || []).map((m) => ({
          id: m.user.id,
          name: m.user.name,
          role: m.role === "ADMIN" ? "admin" : "listener",
          joinedAt: m.joinedAt.getTime(),
          isOnline: m.isActive
        }));
        return {
          room: r,
          playbackState: r.playbackState,
          queue,
          members
        };
      });
    } catch (error) {
      logger.error("[SyncRoom DB] Error loading active rooms from database", error);
      return [];
    }
  }
  // ==========================================
  // CUSTOM PLAYLISTS PERSISTENCE (Feature 2)
  // ==========================================
  async createCustomPlaylist(ownerId, name, description) {
    this.ensureConfigured();
    return await withDbRetry(
      () => prisma.customPlaylist.create({
        data: {
          ownerId,
          name: name.trim(),
          description: description?.trim() || null
        },
        include: {
          tracks: {
            orderBy: { position: "asc" }
          }
        }
      })
    );
  }
  async getUserCustomPlaylists(ownerId) {
    this.ensureConfigured();
    const playlists = await withDbRetry(
      () => prisma.customPlaylist.findMany({
        where: { ownerId },
        include: {
          tracks: {
            orderBy: { position: "asc" }
          }
        },
        orderBy: { updatedAt: "desc" }
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
        updatedAt: p.updatedAt.toISOString()
      };
    });
  }
  async getCustomPlaylistById(playlistId) {
    this.ensureConfigured();
    const playlist = await withDbRetry(
      () => prisma.customPlaylist.findUnique({
        where: { id: playlistId },
        include: {
          tracks: {
            orderBy: { position: "asc" }
          }
        }
      })
    );
    if (!playlist) return null;
    const totalDurationMs = playlist.tracks.reduce((sum, t) => sum + (t.durationMs || 0), 0);
    const artworkUrl = playlist.tracks[0]?.albumArtUrl || null;
    const normalizedTracks = playlist.tracks.map((t) => {
      let parsedArtists = [t.artist];
      try {
        parsedArtists = JSON.parse(t.artists);
      } catch {
      }
      return {
        id: `spotify-${t.spotifyTrackId}`,
        provider: "spotify",
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
        duration: Math.round(t.durationMs / 1e3),
        durationMs: t.durationMs,
        externalUrl: t.spotifyUrl,
        spotifyUrl: t.spotifyUrl,
        position: t.position,
        createdAt: t.createdAt.toISOString(),
        isPlayable: true,
        playbackStatus: "AVAILABLE",
        audioSource: "unavailable"
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
      rawTracks: playlist.tracks
    };
  }
  async updateCustomPlaylist(playlistId, data) {
    this.ensureConfigured();
    return await withDbRetry(
      () => prisma.customPlaylist.update({
        where: { id: playlistId },
        data: {
          ...data.name ? { name: data.name.trim() } : {},
          ...data.description !== void 0 ? { description: data.description?.trim() || null } : {},
          updatedAt: /* @__PURE__ */ new Date()
        }
      })
    );
  }
  async deleteCustomPlaylist(playlistId) {
    this.ensureConfigured();
    return await withDbRetry(
      () => prisma.customPlaylist.delete({
        where: { id: playlistId }
      })
    );
  }
  async addTrackToCustomPlaylist(playlistId, track) {
    this.ensureConfigured();
    return await withDbRetry(
      () => prisma.$transaction(async (tx) => {
        const existing = await tx.customPlaylistTrack.findUnique({
          where: {
            playlistId_spotifyTrackId: {
              playlistId,
              spotifyTrackId: track.providerTrackId
            }
          }
        });
        if (existing) {
          const err = new Error("Track already exists in this playlist.");
          err.code = "DUPLICATE_TRACK";
          throw err;
        }
        const lastTrack = await tx.customPlaylistTrack.findFirst({
          where: { playlistId },
          orderBy: { position: "desc" },
          select: { position: true }
        });
        const nextPosition = lastTrack ? lastTrack.position + 1 : 0;
        const now = /* @__PURE__ */ new Date();
        const artistsJson = JSON.stringify(track.artists && track.artists.length > 0 ? track.artists : [track.artist]);
        const spotifyUri = track.spotifyUri || `spotify:track:${track.providerTrackId}`;
        const created = await tx.customPlaylistTrack.create({
          data: {
            playlistId,
            spotifyTrackId: track.providerTrackId,
            spotifyUri,
            title: track.title,
            artist: track.artist,
            artists: artistsJson,
            album: track.album,
            durationMs: track.durationMs || track.duration * 1e3,
            albumArtUrl: track.albumArtUrl,
            spotifyUrl: track.externalUrl,
            position: nextPosition,
            createdAt: now
          }
        });
        await tx.customPlaylist.update({
          where: { id: playlistId },
          data: { updatedAt: now }
        });
        return created;
      })
    );
  }
  async removeTrackFromCustomPlaylist(playlistId, trackId) {
    this.ensureConfigured();
    return await withDbRetry(
      () => prisma.$transaction(async (tx) => {
        const trackToDelete = await tx.customPlaylistTrack.findFirst({
          where: {
            playlistId,
            OR: [
              { id: trackId },
              { spotifyTrackId: trackId.replace(/^spotify-/, "") }
            ]
          }
        });
        if (!trackToDelete) {
          const err = new Error("Track not found in playlist.");
          err.code = "TRACK_NOT_FOUND";
          throw err;
        }
        await tx.customPlaylistTrack.delete({
          where: { id: trackToDelete.id }
        });
        const remaining = await tx.customPlaylistTrack.findMany({
          where: { playlistId },
          orderBy: { position: "asc" }
        });
        for (let i = 0; i < remaining.length; i++) {
          if (remaining[i].position !== i) {
            await tx.customPlaylistTrack.update({
              where: { id: remaining[i].id },
              data: { position: i }
            });
          }
        }
        await tx.customPlaylist.update({
          where: { id: playlistId },
          data: { updatedAt: /* @__PURE__ */ new Date() }
        });
        return true;
      })
    );
  }
  async reorderCustomPlaylistTracks(playlistId, trackIds) {
    this.ensureConfigured();
    return await withDbRetry(
      () => prisma.$transaction(async (tx) => {
        const existing = await tx.customPlaylistTrack.findMany({
          where: { playlistId }
        });
        const idMap = /* @__PURE__ */ new Map();
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
              data: { position: pos++ }
            });
          }
        }
        await tx.customPlaylist.update({
          where: { id: playlistId },
          data: { updatedAt: /* @__PURE__ */ new Date() }
        });
        return true;
      })
    );
  }
};
var dbRepository = new DbRepository();

// server/auth/permissions.ts
function canControlPlayback(user) {
  return !!user && user.role === "admin" && user.connected;
}
function canModifyQueue(user) {
  return !!user && user.role === "admin" && user.connected;
}
function canRemoveMember(user) {
  return !!user && user.role === "admin";
}
function canManageRoom(user) {
  return !!user && user.role === "admin";
}

// server/rooms/RoomManager.ts
import { performance as performance2 } from "perf_hooks";
var RoomManager = class {
  constructor() {
    this.roomsById = /* @__PURE__ */ new Map();
    this.roomsByCode = /* @__PURE__ */ new Map();
    this.sessions = /* @__PURE__ */ new Map();
    this.userConnections = /* @__PURE__ */ new Map();
    this.connectionUsers = /* @__PURE__ */ new Map();
    this.staleSweepInterval = null;
    this.lastDbHeartbeats = /* @__PURE__ */ new Map();
    /**
     * Per-room async command queue / mutex to serialize rapid admin commands
     * and prevent concurrent mutation races.
     */
    this.roomLocks = /* @__PURE__ */ new Map();
    this.staleSweepInterval = setInterval(() => {
      this.sweepStaleConnections();
    }, 25e3);
    this.staleSweepInterval.unref();
  }
  /**
   * Recovers active rooms, queues, and playback states from PostgreSQL on server startup.
   */
  async initializeFromDatabase() {
    const activeRooms = await dbRepository.getActiveRooms();
    for (const item of activeRooms) {
      const { room: r, playbackState, queue, members } = item;
      const room = new Room(r.id, r.code, r.name, r.adminUserId, playbackState?.track);
      if (queue && queue.length > 0) {
        room.queue = queue;
      }
      if (playbackState) {
        room.isPlaying = playbackState.isPlaying;
        room.position = Math.round(playbackState.positionMs / 1e3);
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
          sessionId: ""
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
  sweepStaleConnections() {
    const now = Date.now();
    const STALE_THRESHOLD_MS = 45e3;
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
            dbRepository.updateMemberPresence(room.id, user.id, false).catch(() => {
            });
            this.broadcastToRoom(room.id, {
              type: "USER_UPDATED",
              user: {
                id: user.id,
                name: user.name,
                role: user.role,
                joinedAt: user.lastSeen,
                isOnline: false,
                device: user.device,
                driftMs: user.driftMs
              }
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
  handleHeartbeat(ws) {
    const meta = this.connectionUsers.get(ws);
    const now = Date.now();
    this.sendToWs(ws, { type: "PONG", timestamp: now });
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
      const lastDb = this.lastDbHeartbeats.get(meta.userId) || 0;
      if (now - lastDb > 6e4) {
        this.lastDbHeartbeats.set(meta.userId, now);
        dbRepository.updateHeartbeat(meta.userId, meta.roomId).catch(() => {
        });
      }
    }
  }
  /**
   * Retrieves active session details by session token/ID.
   */
  getSession(sessionIdOrToken) {
    return this.sessions.get(sessionIdOrToken);
  }
  /**
   * Graceful shutdown of RoomManager resources and active WebSocket connections.
   */
  shutdown() {
    if (this.staleSweepInterval) {
      clearInterval(this.staleSweepInterval);
      this.staleSweepInterval = null;
    }
    for (const [ws] of this.connectionUsers) {
      try {
        ws.close(1001, "Server Going Away");
      } catch {
      }
    }
    this.connectionUsers.clear();
    this.userConnections.clear();
  }
  /**
   * Attaches DB synchronization listeners to a room so that playback and queue state
   * are automatically persisted to PostgreSQL on changes.
   */
  attachRoomDbListeners(room) {
    room.setOnStateChange(() => {
      this.broadcastPlaybackState(room);
      this.broadcastQueue(room);
      const pbState = room.toPlaybackState();
      dbRepository.savePlaybackState(room.id, {
        trackId: pbState.trackId,
        isPlaying: pbState.isPlaying,
        positionMs: Math.round(pbState.position * 1e3),
        startedAt: pbState.startedAt,
        version: pbState.version
      }).catch((err) => console.error("[SyncRoom] DB savePlaybackState failed:", err));
      dbRepository.saveQueue(room.id, room.queue).catch((err) => console.error("[SyncRoom] DB saveQueue failed:", err));
    });
  }
  generateUniqueRoomCode() {
    let attempts = 0;
    while (attempts < 20) {
      const code = generateRoomCode();
      if (!this.roomsByCode.has(code)) {
        return code;
      }
      attempts++;
    }
    return "SR" + Math.floor(1e3 + Math.random() * 9e3);
  }
  /**
   * Creates a new server room with creator guaranteed as admin.
   * Persists Room, User, RoomMember, and DeviceSession to PostgreSQL.
   */
  async createRoom(name, adminName, ws, device) {
    const tStart = performance2.now();
    const roomId = `room_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const adminId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const code = this.generateUniqueRoomCode();
    let sessionToken = generateSessionToken();
    logger.info(`[ROOM_CREATE] db_connect_start roomId=${roomId} code=${code}`);
    const dbRes = await dbRepository.createRoom({
      roomId,
      code,
      name: name.trim() || "SyncRoom",
      adminUserId: adminId,
      adminName: adminName.trim() || "Admin",
      deviceName: device || "desktop"
    });
    sessionToken = dbRes.sessionToken;
    logger.info(`[ROOM_CREATE] db_connected dbDurationMs=${dbRes.durationMs}`);
    const adminUser = {
      id: adminId,
      name: adminName.trim() || "Admin",
      role: "admin",
      // Server strictly assigns admin role
      roomId,
      connected: Boolean(ws),
      lastSeen: Date.now(),
      sessionId: sessionToken,
      device: device || "desktop",
      driftMs: 0
    };
    const room = new Room(roomId, code, name.trim() || "SyncRoom", adminId);
    room.addUser(adminUser);
    this.attachRoomDbListeners(room);
    this.roomsById.set(roomId, room);
    this.roomsByCode.set(code, room);
    this.sessions.set(sessionToken, {
      sessionId: sessionToken,
      userId: adminId,
      roomId,
      role: "admin",
      name: adminUser.name,
      createdAt: Date.now(),
      lastSeen: Date.now()
    });
    if (ws) {
      this.registerConnection(ws, adminId, sessionToken, roomId);
    }
    if (room.queue.length > 0) {
      await dbRepository.saveQueue(roomId, room.queue);
    }
    const totalDurationMs = Math.round(performance2.now() - tStart);
    logger.info(`[ROOM_CREATE] room_created durationMs=${totalDurationMs} roomId=${roomId} code=${code}`);
    return { room, user: adminUser, sessionId: sessionToken, sessionToken };
  }
  /**
   * Joins an existing room with joiner guaranteed as listener.
   * Persists Listener User, RoomMember, and DeviceSession to PostgreSQL.
   */
  async joinRoom(code, displayName, ws, device) {
    const normalizedCode = normalizeRoomCode(code);
    const userId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    let room = this.roomsByCode.get(normalizedCode);
    let sessionToken = generateSessionToken();
    const dbRes = await dbRepository.joinRoom({
      userId,
      code: normalizedCode,
      userName: displayName.trim() || "Listener",
      deviceName: device || "mobile"
    });
    sessionToken = dbRes.sessionToken;
    if (!room && dbRes.room) {
      room = new Room(dbRes.room.id, dbRes.room.code, dbRes.room.name, dbRes.room.adminUserId);
      this.attachRoomDbListeners(room);
      this.roomsById.set(room.id, room);
      this.roomsByCode.set(room.code, room);
    }
    if (!room) {
      throw new Error("ROOM_NOT_FOUND");
    }
    const listenerUser = {
      id: userId,
      name: displayName.trim() || "Listener",
      role: "listener",
      // Server strictly assigns listener role
      roomId: room.id,
      connected: true,
      lastSeen: Date.now(),
      sessionId: sessionToken,
      device: device || "mobile",
      driftMs: 0
      // Real measurement recorded once client reports sync
    };
    room.addUser(listenerUser);
    this.sessions.set(sessionToken, {
      sessionId: sessionToken,
      userId,
      roomId: room.id,
      role: "listener",
      name: listenerUser.name,
      createdAt: Date.now(),
      lastSeen: Date.now()
    });
    this.registerConnection(ws, userId, sessionToken, room.id);
    this.broadcastToRoom(
      room.id,
      {
        type: "USER_JOINED",
        user: {
          id: listenerUser.id,
          name: listenerUser.name,
          role: listenerUser.role,
          joinedAt: listenerUser.lastSeen,
          isOnline: true,
          device: listenerUser.device,
          driftMs: listenerUser.driftMs
        }
      },
      userId
    );
    return { room, user: listenerUser, sessionId: sessionToken, sessionToken };
  }
  /**
   * Reconnects an existing session across browser refreshes, network drops, or server restarts.
   * Restores user identity, role, room, queue, and playback state from PostgreSQL.
   */
  async reconnectSession(tokenOrSessionId, ws) {
    const rawToken = tokenOrSessionId?.trim();
    if (!rawToken) {
      throw new Error("SESSION_NOT_FOUND");
    }
    const dbRestored = await dbRepository.validateAndRestoreSession(rawToken);
    if (!dbRestored) {
      throw new Error("SESSION_NOT_FOUND");
    }
    const { session, user: dbUser, room: dbRoom, role, queue, playbackState, currentTrack } = dbRestored;
    let room = this.roomsById.get(dbRoom.id);
    if (!room) {
      room = new Room(dbRoom.id, dbRoom.code, dbRoom.name, dbRoom.adminUserId, currentTrack);
      if (queue && queue.length > 0) {
        room.queue = queue;
      }
      if (playbackState) {
        room.isPlaying = playbackState.isPlaying;
        room.position = Math.round(playbackState.positionMs / 1e3);
        room.startedAt = playbackState.startedAt ? new Date(playbackState.startedAt).getTime() : null;
        room.startAt = room.startedAt;
        room.version = playbackState.version;
      }
      for (const m of dbRestored.members) {
        room.addUser({
          id: m.id,
          name: m.name,
          role: m.role,
          roomId: room.id,
          connected: m.id === dbUser.id,
          lastSeen: m.joinedAt,
          sessionId: ""
        });
      }
      this.attachRoomDbListeners(room);
      this.roomsById.set(room.id, room);
      this.roomsByCode.set(room.code, room);
    }
    let user = room.getUser(dbUser.id);
    if (!user) {
      user = {
        id: dbUser.id,
        name: dbUser.name,
        role,
        // Strictly assigned from PostgreSQL DeviceSession
        roomId: room.id,
        connected: true,
        lastSeen: Date.now(),
        sessionId: rawToken
      };
      room.addUser(user);
    } else {
      user.connected = true;
      user.lastSeen = Date.now();
      user.role = role;
    }
    this.registerConnection(ws, user.id, rawToken, room.id);
    await dbRepository.updateMemberPresence(room.id, user.id, true);
    this.broadcastToRoom(
      room.id,
      {
        type: "USER_UPDATED",
        user: {
          id: user.id,
          name: user.name,
          role: user.role,
          joinedAt: user.lastSeen,
          isOnline: true,
          device: user.device,
          driftMs: user.driftMs
        }
      },
      user.id
    );
    return { room, user, sessionToken: rawToken };
  }
  registerConnection(ws, userId, sessionId, roomId) {
    const existingWs = this.userConnections.get(userId);
    if (existingWs && existingWs !== ws) {
      try {
        this.connectionUsers.delete(existingWs);
        existingWs.close(1e3, "Replaced by newer connection");
      } catch {
      }
    }
    this.userConnections.set(userId, ws);
    this.connectionUsers.set(ws, { userId, sessionId, roomId });
  }
  handleDisconnect(ws) {
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
        dbRepository.updateMemberPresence(room.id, user.id, false).catch(() => {
        });
        this.broadcastToRoom(room.id, {
          type: "USER_UPDATED",
          user: {
            id: user.id,
            name: user.name,
            role: user.role,
            joinedAt: user.lastSeen,
            isOnline: false,
            device: user.device,
            driftMs: user.driftMs
          }
        });
      }
    }
  }
  leaveRoom(ws) {
    const meta = this.connectionUsers.get(ws);
    if (!meta) return;
    const room = this.roomsById.get(meta.roomId);
    if (room) {
      room.removeUser(meta.userId);
      dbRepository.updateMemberPresence(room.id, meta.userId, false).catch(() => {
      });
      this.broadcastToRoom(room.id, {
        type: "USER_LEFT",
        userId: meta.userId
      });
    }
    this.sessions.delete(meta.sessionId);
    this.connectionUsers.delete(ws);
    this.userConnections.delete(meta.userId);
  }
  getSessionByWs(ws) {
    return this.connectionUsers.get(ws);
  }
  getUser(userId) {
    for (const room of this.roomsById.values()) {
      const u = room.getUser(userId);
      if (u) return u;
    }
    return void 0;
  }
  getRoom(roomIdOrCode) {
    const normalized = normalizeRoomCode(roomIdOrCode);
    return this.roomsByCode.get(normalized) || this.roomsById.get(roomIdOrCode);
  }
  broadcastToRoom(roomId, message, excludeUserId) {
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
        }
      }
    }
  }
  broadcastPlaybackState(room) {
    const state = room.toPlaybackState();
    this.broadcastToRoom(room.id, {
      type: "PLAYBACK_STATE",
      state,
      isPlaying: state.isPlaying,
      position: state.position,
      currentTrackId: state.trackId,
      startedAt: state.startedAt
    });
  }
  broadcastQueue(room) {
    this.broadcastToRoom(room.id, {
      type: "QUEUE_UPDATED",
      queue: room.queue,
      currentTrack: room.currentTrack,
      queueVersion: room.queueVersion
    });
  }
  /**
   * Updates real measured drift reported by a client's SyncEngine.
   */
  updateUserDrift(ws, driftMs) {
    const meta = this.connectionUsers.get(ws);
    if (!meta) return;
    const room = this.roomsById.get(meta.roomId);
    if (!room) return;
    const user = room.getUser(meta.userId);
    if (!user) return;
    user.driftMs = Math.round(driftMs);
    user.lastSeen = Date.now();
  }
  async runRoomCommand(roomId, action) {
    const currentLock = this.roomLocks.get(roomId) || Promise.resolve();
    let releaseLock = () => {
    };
    const nextLock = new Promise((resolve) => {
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
  sendToWs(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch {
      }
    }
  }
  /**
   * ADMIN REMOVE USER: Removes a participant from the room, revokes their database session,
   * closes their connection, and informs them with USER_REMOVED.
   */
  async removeUserFromRoom(roomId, targetUserId, adminUser) {
    if (!canRemoveMember(adminUser)) {
      throw new Error("FORBIDDEN");
    }
    const room = this.roomsById.get(roomId);
    if (!room) {
      throw new Error("ROOM_NOT_FOUND");
    }
    const targetUser = room.getUser(targetUserId);
    if (!targetUser) return;
    room.removeUser(targetUserId);
    const targetWs = this.userConnections.get(targetUserId);
    if (targetWs) {
      this.sendToWs(targetWs, {
        type: "USER_REMOVED",
        userId: targetUserId,
        message: "You were removed from this room by the admin."
      });
      this.connectionUsers.delete(targetWs);
      this.userConnections.delete(targetUserId);
      try {
        targetWs.close(1e3, "REMOVED_BY_ADMIN");
      } catch {
      }
    }
    try {
      await dbRepository.removeMember(roomId, targetUserId);
      await dbRepository.recordActivity(roomId, "USER_REMOVED", adminUser.id, {
        targetUserId,
        targetUserName: targetUser.name
      });
    } catch (err) {
      console.error("[SyncRoom] DB removeMember failed:", err);
    }
    this.broadcastToRoom(roomId, {
      type: "USER_LEFT",
      userId: targetUserId
    });
  }
  /**
   * ADMIN RENAME ROOM: Renames the room in memory, updates PostgreSQL, and broadcasts ROOM_UPDATED.
   */
  async renameRoom(roomId, newName, adminUser) {
    if (!canManageRoom(adminUser)) {
      throw new Error("FORBIDDEN");
    }
    const room = this.roomsById.get(roomId);
    if (!room) {
      throw new Error("ROOM_NOT_FOUND");
    }
    const sanitizedName = newName.trim().slice(0, 50);
    if (!sanitizedName) {
      throw new Error("INVALID_MESSAGE");
    }
    room.rename(sanitizedName);
    try {
      await dbRepository.renameRoom(roomId, sanitizedName);
      await dbRepository.recordActivity(roomId, "ROOM_RENAMED", adminUser.id, {
        newName: sanitizedName
      });
    } catch (err) {
      console.error("[SyncRoom] DB renameRoom failed:", err);
    }
    this.broadcastToRoom(roomId, {
      type: "ROOM_UPDATED",
      room: room.toClientState()
    });
  }
  /**
   * ADMIN END ROOM: Ends the room, closes all active connections, updates PostgreSQL, and broadcasts ROOM_ENDED.
   */
  async endRoom(roomId, adminUser) {
    if (!canManageRoom(adminUser)) {
      throw new Error("FORBIDDEN");
    }
    const room = this.roomsById.get(roomId);
    if (!room) {
      throw new Error("ROOM_NOT_FOUND");
    }
    this.broadcastToRoom(roomId, {
      type: "ROOM_ENDED",
      message: "Room ended by the admin."
    });
    room.destroy();
    dbRepository.recordActivity(roomId, "ROOM_ENDED", adminUser.id).catch((err) => {
      console.error("[SyncRoom] DB recordActivity failed:", err);
    });
    dbRepository.endRoom(roomId).catch((err) => {
      console.error("[SyncRoom] DB endRoom failed:", err);
    });
    setTimeout(() => {
      for (const [userId] of room.users.entries()) {
        const clientWs = this.userConnections.get(userId);
        if (clientWs) {
          this.connectionUsers.delete(clientWs);
          this.userConnections.delete(userId);
          try {
            clientWs.close(1e3, "ROOM_ENDED");
          } catch {
          }
        }
      }
    }, 50);
    this.roomsById.delete(roomId);
    this.roomsByCode.delete(room.code);
  }
  /**
   * Retrieves recent audit log activities for the room.
   */
  async getRecentActivities(roomId) {
    return dbRepository.getRecentActivities(roomId);
  }
};
var roomManager = new RoomManager();

// server/websocket/messages.ts
var VALID_CLIENT_MESSAGE_TYPES = /* @__PURE__ */ new Set([
  "CREATE_ROOM",
  "JOIN_ROOM",
  "RECONNECT_SESSION",
  "LEAVE_ROOM",
  "PING",
  "TIME_SYNC_REQUEST",
  "REPORT_DRIFT",
  "PLAYBACK_READY",
  "ADMIN_PLAY",
  "ADMIN_PAUSE",
  "ADMIN_SEEK",
  "ADMIN_NEXT",
  "ADMIN_PREVIOUS",
  "ADMIN_SELECT_TRACK",
  "ADMIN_SET_CURRENT_TRACK",
  "ADMIN_ADD_QUEUE",
  "ADMIN_REMOVE_QUEUE",
  "ADMIN_REORDER_QUEUE",
  "ADMIN_CLEAR_QUEUE",
  "ADMIN_IMPORT_QUEUE",
  "ADMIN_REMOVE_USER",
  "ADMIN_RENAME_ROOM",
  "ADMIN_END_ROOM",
  "GET_ACTIVITIES"
]);
var ALLOWED_DEVICES = /* @__PURE__ */ new Set(["desktop", "mobile", "tablet", "speaker"]);
function validateClientMessage(msg) {
  switch (msg.type) {
    case "CREATE_ROOM": {
      if (typeof msg.name !== "string" || !msg.name.trim() || msg.name.trim().length > 100) {
        return { isValid: false, error: "Room name must be between 1 and 100 characters" };
      }
      if (typeof msg.adminName !== "string" || !msg.adminName.trim() || msg.adminName.trim().length > 50) {
        return { isValid: false, error: "Admin name must be between 1 and 50 characters" };
      }
      if (msg.device && !ALLOWED_DEVICES.has(msg.device)) {
        return { isValid: false, error: "Invalid device type" };
      }
      return { isValid: true };
    }
    case "JOIN_ROOM": {
      if (typeof msg.code !== "string" || !msg.code.trim() || msg.code.trim().length > 12) {
        return { isValid: false, error: "Invalid room code format" };
      }
      if (typeof msg.displayName !== "string" || !msg.displayName.trim() || msg.displayName.trim().length > 50) {
        return { isValid: false, error: "Display name must be between 1 and 50 characters" };
      }
      if (msg.device && !ALLOWED_DEVICES.has(msg.device)) {
        return { isValid: false, error: "Invalid device type" };
      }
      return { isValid: true };
    }
    case "RECONNECT_SESSION": {
      const token = msg.sessionToken || msg.sessionId;
      if (typeof token !== "string" || !token.trim() || token.length > 256) {
        return { isValid: false, error: "Valid session token is required" };
      }
      return { isValid: true };
    }
    case "ADMIN_SEEK": {
      if (typeof msg.position !== "number" || !Number.isFinite(msg.position) || msg.position < 0 || msg.position > 86400) {
        return { isValid: false, error: "Playback position must be a non-negative finite number (0-86400 seconds)" };
      }
      return { isValid: true };
    }
    case "ADMIN_SELECT_TRACK": {
      if (typeof msg.trackId !== "string" || !msg.trackId.trim() || msg.trackId.length > 128) {
        return { isValid: false, error: "Invalid track ID" };
      }
      return { isValid: true };
    }
    case "ADMIN_SET_CURRENT_TRACK": {
      const track = msg.track;
      if (!track || typeof track !== "object") {
        return { isValid: false, error: "Track payload is required" };
      }
      if (typeof track.id !== "string" || !track.id.trim() || track.id.length > 128) {
        return { isValid: false, error: "Invalid track ID" };
      }
      return { isValid: true };
    }
    case "ADMIN_ADD_QUEUE": {
      const track = msg.track;
      if (!track || typeof track !== "object") {
        return { isValid: false, error: "Track payload is required" };
      }
      if (typeof track.id !== "string" || !track.id.trim() || track.id.length > 128) {
        return { isValid: false, error: "Invalid track ID" };
      }
      const trackTitle = track.title || track.name;
      if (typeof trackTitle !== "string" || !trackTitle.trim() || trackTitle.length > 200) {
        return { isValid: false, error: "Invalid track title" };
      }
      if (typeof track.duration !== "number" || !Number.isFinite(track.duration) || track.duration <= 0 || track.duration > 86400) {
        return { isValid: false, error: "Invalid track duration (must be positive number up to 86400s)" };
      }
      if (!Array.isArray(track.artists) || !track.artists.every((a) => typeof a === "string" && a.length <= 100)) {
        return { isValid: false, error: "Invalid artists array" };
      }
      return { isValid: true };
    }
    case "ADMIN_IMPORT_QUEUE": {
      if (!Array.isArray(msg.tracks) || msg.tracks.length === 0 || msg.tracks.length > 200) {
        return { isValid: false, error: "Tracks array must contain between 1 and 200 items" };
      }
      for (const track of msg.tracks) {
        const title = track?.title || track?.name;
        if (!track || typeof track !== "object" || typeof track.id !== "string" || typeof title !== "string") {
          return { isValid: false, error: "One or more imported tracks has an invalid structure" };
        }
      }
      return { isValid: true };
    }
    case "ADMIN_REMOVE_QUEUE": {
      if (typeof msg.queueItemId !== "string" || !msg.queueItemId.trim() || msg.queueItemId.length > 128) {
        return { isValid: false, error: "Invalid queueItemId" };
      }
      return { isValid: true };
    }
    case "ADMIN_REORDER_QUEUE": {
      if (!Array.isArray(msg.queueItemIds) || msg.queueItemIds.length > 500 || !msg.queueItemIds.every((id) => typeof id === "string" && id.length <= 128)) {
        return { isValid: false, error: "Invalid queueItemIds array" };
      }
      return { isValid: true };
    }
    case "ADMIN_REMOVE_USER": {
      if (typeof msg.userId !== "string" || !msg.userId.trim() || msg.userId.length > 128) {
        return { isValid: false, error: "Invalid userId" };
      }
      return { isValid: true };
    }
    case "ADMIN_RENAME_ROOM": {
      if (typeof msg.newName !== "string" || !msg.newName.trim() || msg.newName.trim().length > 100) {
        return { isValid: false, error: "Room name must be between 1 and 100 characters" };
      }
      return { isValid: true };
    }
    case "TIME_SYNC_REQUEST": {
      if (typeof msg.clientSendTime !== "number" || !Number.isFinite(msg.clientSendTime) || msg.clientSendTime <= 0) {
        return { isValid: false, error: "Invalid clientSendTime" };
      }
      return { isValid: true };
    }
    case "REPORT_DRIFT": {
      if (typeof msg.driftMs !== "number" || !Number.isFinite(msg.driftMs) || Math.abs(msg.driftMs) > 3e5) {
        return { isValid: false, error: "Invalid driftMs measurement" };
      }
      return { isValid: true };
    }
    default:
      return { isValid: true };
  }
}
function parseClientMessage(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || typeof parsed.type !== "string") {
      return { success: false, error: "Invalid JSON payload structure" };
    }
    if (!VALID_CLIENT_MESSAGE_TYPES.has(parsed.type)) {
      return { success: false, error: `Unknown event type: ${String(parsed.type).slice(0, 50)}` };
    }
    const validation = validateClientMessage(parsed);
    if (!validation.isValid) {
      return { success: false, error: validation.error || "Invalid payload data" };
    }
    return { success: true, data: parsed };
  } catch {
    return { success: false, error: "Malformed JSON payload" };
  }
}
function formatErrorMessage(code, message) {
  return {
    type: "ERROR",
    code,
    message
  };
}

// server/utils/rateLimiter.ts
var RateLimiter = class {
  constructor() {
    this.records = /* @__PURE__ */ new Map();
    this.cleanupInterval = null;
    this.cleanupInterval = setInterval(() => this.cleanup(), 6e4);
    this.cleanupInterval.unref();
  }
  /**
   * Check if a key has exceeded maxRequests within windowMs.
   * If allowed, records the request and returns true.
   * If limited, returns false.
   */
  checkLimit(key, maxRequests, windowMs) {
    const now = Date.now();
    let record = this.records.get(key);
    if (!record) {
      record = { timestamps: [] };
      this.records.set(key, record);
    }
    record.timestamps = record.timestamps.filter((ts) => now - ts < windowMs);
    if (record.timestamps.length >= maxRequests) {
      return false;
    }
    record.timestamps.push(now);
    return true;
  }
  /**
   * Returns current count and reset time for rate limit headers.
   */
  getStatus(key, windowMs) {
    const now = Date.now();
    const record = this.records.get(key);
    if (!record) return { current: 0, oldestTimestamp: now };
    const valid = record.timestamps.filter((ts) => now - ts < windowMs);
    return {
      current: valid.length,
      oldestTimestamp: valid.length > 0 ? valid[0] : now
    };
  }
  reset() {
    this.records.clear();
  }
  cleanup() {
    const now = Date.now();
    for (const [key, record] of this.records.entries()) {
      record.timestamps = record.timestamps.filter((ts) => now - ts < 12e4);
      if (record.timestamps.length === 0) {
        this.records.delete(key);
      }
    }
  }
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.records.clear();
  }
};
var rateLimiter = new RateLimiter();
function createApiRateLimiter(options) {
  const windowMs = options.windowMs || parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10);
  const max = options.max || parseInt(process.env.RATE_LIMIT_MAX || "100", 10);
  const prefix = options.prefix || "api";
  const message = options.message || "Too many requests. Please try again later.";
  return (req, res, next) => {
    const clientIp = req.ip || req.socket.remoteAddress || "unknown";
    const key = `${prefix}_${clientIp}`;
    const isAllowed = rateLimiter.checkLimit(key, max, windowMs);
    const status = rateLimiter.getStatus(key, windowMs);
    const remaining = Math.max(0, max - status.current);
    const resetTime = Math.ceil((status.oldestTimestamp + windowMs) / 1e3);
    res.setHeader("RateLimit-Limit", max);
    res.setHeader("RateLimit-Remaining", remaining);
    res.setHeader("RateLimit-Reset", resetTime);
    if (!isAllowed) {
      res.setHeader("Retry-After", Math.ceil(windowMs / 1e3));
      return res.status(429).json({
        error: message,
        retryAfterSeconds: Math.ceil(windowMs / 1e3)
      });
    }
    next();
  };
}
var authRateLimiter = createApiRateLimiter({
  max: parseInt(process.env.RATE_LIMIT_AUTH_MAX || "30", 10),
  windowMs: 6e4,
  prefix: "auth",
  message: "Too many authentication attempts. Please slow down."
});
var spotifyRateLimiter = createApiRateLimiter({
  max: parseInt(process.env.RATE_LIMIT_SPOTIFY_MAX || "40", 10),
  windowMs: 6e4,
  prefix: "spotify",
  message: "Too many Spotify requests. Please slow down."
});

// server/utils/cors.ts
var isProduction2 = process.env.NODE_ENV === "production";
function getAllowedOrigins() {
  const envOrigins = [
    process.env.CLIENT_ORIGIN,
    process.env.ALLOWED_ORIGINS,
    process.env.FRONTEND_URL
  ];
  const list = [
    "https://ramkushwah1214.github.io"
  ];
  for (const envVal of envOrigins) {
    if (envVal?.trim()) {
      const parts = envVal.split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
      list.push(...parts);
    }
  }
  if (!isProduction2) {
    list.push(
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://localhost:5173",
      "http://127.0.0.1:5173"
    );
  }
  return Array.from(new Set(list));
}
function corsMiddleware(req, res, next) {
  const requestOrigin = req.headers.origin;
  const allowedOrigins = getAllowedOrigins();
  if (requestOrigin) {
    const isAllowed = allowedOrigins.includes(requestOrigin) || !isProduction2 && (requestOrigin.includes("localhost") || requestOrigin.includes("127.0.0.1"));
    if (isAllowed) {
      res.setHeader("Access-Control-Allow-Origin", requestOrigin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS"
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Session-Id, X-Session-Token, X-User-Id, X-User-Token, X-Device-Id, X-Correlation-Id"
      );
      res.setHeader("Access-Control-Max-Age", "86400");
    } else if (isProduction2) {
      if (req.method === "OPTIONS") {
        return res.status(403).json({ error: "CORS policy violation: Disallowed origin" });
      }
    }
  }
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Max-Age", "86400");
    return res.status(204).end();
  }
  next();
}
function validateWebSocketOrigin(origin) {
  if (!origin) {
    return { isValid: true };
  }
  const normalized = origin.replace(/\/$/, "");
  const allowedOrigins = getAllowedOrigins();
  const isAllowed = allowedOrigins.includes(normalized) || !isProduction2 && (normalized.includes("localhost") || normalized.includes("127.0.0.1"));
  if (!isAllowed && isProduction2) {
    return {
      isValid: false,
      reason: `WebSocket origin '${normalized}' is not in allowed origins list: ${allowedOrigins.join(", ")}`
    };
  }
  return { isValid: true };
}

// server/websocket/connection.ts
function setupWebSocketServer(wss, isShuttingDownGetter) {
  wss.on("connection", (ws, req) => {
    if (isShuttingDownGetter && isShuttingDownGetter()) {
      ws.close(1001, "Server is undergoing graceful shutdown");
      return;
    }
    const ip = req.socket.remoteAddress || "unknown";
    const maxConnPerMin = parseInt(process.env.WS_MAX_CONNECTIONS_PER_IP || "60", 10);
    if (!rateLimiter.checkLimit(`ws_conn_${ip}`, maxConnPerMin, 6e4)) {
      logger.warn("[SyncRoom WS] Rejected connection due to IP rate limiting", { ip });
      ws.close(1008, "Rate limit exceeded");
      return;
    }
    const origin = req.headers.origin;
    const originValidation = validateWebSocketOrigin(origin);
    if (!originValidation.isValid) {
      logger.warn("[SyncRoom WS] Rejected connection due to disallowed Origin", {
        origin,
        reason: originValidation.reason,
        ip
      });
      ws.close(1008, "Policy Violation: Origin not permitted");
      return;
    }
    const requestUrl = req.url || "";
    if (requestUrl.toLowerCase().includes("secret=") || requestUrl.toLowerCase().includes("token=")) {
      logger.warn("[SyncRoom WS] Connection query string contained sensitive parameter", {
        url: requestUrl.split("?")[0]
      });
    }
    logger.debug("[SyncRoom WS] Connection established", {
      origin,
      ip
    });
    let msgCount = 0;
    let windowStart = Date.now();
    ws.on("message", async (data) => {
      const now = Date.now();
      if (now - windowStart > 5e3) {
        msgCount = 1;
        windowStart = now;
      } else {
        msgCount++;
        if (msgCount > 100) {
          roomManager.sendToWs(
            ws,
            formatErrorMessage("RATE_LIMITED", "Message rate limit exceeded. Please slow down.")
          );
          return;
        }
      }
      const raw = typeof data === "string" ? data : Buffer.isBuffer(data) ? data.toString("utf-8") : Array.isArray(data) ? Buffer.concat(data).toString("utf-8") : Buffer.from(data).toString("utf-8");
      const parsed = parseClientMessage(raw);
      if (!parsed.success) {
        logger.warn("[SyncRoom WS] Invalid client message rejected", {
          error: parsed.error,
          ip
        });
        roomManager.sendToWs(ws, formatErrorMessage("INVALID_MESSAGE", parsed.error));
        return;
      }
      const msg = parsed.data;
      try {
        switch (msg.type) {
          case "PING": {
            roomManager.handleHeartbeat(ws);
            break;
          }
          case "TIME_SYNC_REQUEST": {
            roomManager.sendToWs(ws, {
              type: "TIME_SYNC_RESPONSE",
              clientSendTime: msg.clientSendTime,
              serverTime: Date.now()
            });
            break;
          }
          case "PLAYBACK_READY": {
            break;
          }
          case "CREATE_ROOM": {
            if (!rateLimiter.checkLimit(`create_${ip}`, 10, 6e4)) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage("RATE_LIMITED", "Too many room creations. Please slow down.")
              );
              return;
            }
            const trimmedName = msg.name?.trim();
            const trimmedAdmin = msg.adminName?.trim();
            if (!trimmedName || !trimmedAdmin) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage("INVALID_MESSAGE", "Room name and admin name are required")
              );
              return;
            }
            try {
              const { room, user, sessionId, sessionToken } = await roomManager.createRoom(
                trimmedName,
                trimmedAdmin,
                ws,
                msg.device
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
                driftMs: user.driftMs
              };
              roomManager.sendToWs(ws, {
                type: "ROOM_CREATED",
                room: clientState,
                user: clientUser,
                sessionId,
                sessionToken
              });
            } catch (err) {
              const errMsg = err?.message || "";
              if (errMsg.includes("DATABASE_NOT_CONFIGURED")) {
                roomManager.sendToWs(
                  ws,
                  formatErrorMessage("DATABASE_NOT_CONFIGURED", "PostgreSQL database is not configured. Set DATABASE_URL to enable persistence.")
                );
              } else {
                console.error("[SyncRoom] Error in CREATE_ROOM:", err);
                roomManager.sendToWs(
                  ws,
                  formatErrorMessage("INTERNAL_ERROR", "Failed to create room in database")
                );
              }
            }
            break;
          }
          case "JOIN_ROOM": {
            if (!rateLimiter.checkLimit(`join_${ip}`, 30, 6e4)) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage("RATE_LIMITED", "Too many room join attempts. Please slow down.")
              );
              return;
            }
            const trimmedName = msg.displayName?.trim();
            const normalizedCode = normalizeRoomCode(msg.code || "");
            if (!trimmedName) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage("INVALID_MESSAGE", "Please enter your name")
              );
              return;
            }
            const codeValidation = validateRoomCode(normalizedCode);
            if (!codeValidation.isValid) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage("INVALID_ROOM_CODE", "Enter a valid 6-character room code")
              );
              return;
            }
            try {
              const { room, user, sessionId, sessionToken } = await roomManager.joinRoom(
                normalizedCode,
                trimmedName,
                ws,
                msg.device
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
                driftMs: user.driftMs
              };
              roomManager.sendToWs(ws, {
                type: "ROOM_JOINED",
                room: clientState,
                user: clientUser,
                sessionId,
                sessionToken
              });
            } catch (err) {
              const errMsg = err?.message || "";
              if (errMsg.includes("DATABASE_NOT_CONFIGURED")) {
                roomManager.sendToWs(
                  ws,
                  formatErrorMessage("DATABASE_NOT_CONFIGURED", "PostgreSQL database is not configured. Set DATABASE_URL to enable persistence.")
                );
              } else if (errMsg === "ROOM_NOT_FOUND") {
                roomManager.sendToWs(
                  ws,
                  formatErrorMessage("ROOM_NOT_FOUND", "Room not found")
                );
              } else {
                console.error("[SyncRoom] Error in JOIN_ROOM:", err);
                roomManager.sendToWs(
                  ws,
                  formatErrorMessage("INTERNAL_ERROR", "Failed to join room")
                );
              }
            }
            break;
          }
          case "RECONNECT_SESSION": {
            if (!rateLimiter.checkLimit(`recon_${ip}`, 40, 6e4)) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage("RATE_LIMITED", "Too many reconnection attempts. Please wait a moment.")
              );
              return;
            }
            const rawToken = (msg.sessionToken || msg.sessionId)?.trim();
            if (!rawToken) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage("INVALID_SESSION", "Session token is missing")
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
                driftMs: user.driftMs
              };
              roomManager.sendToWs(ws, {
                type: "ROOM_STATE",
                room: clientState,
                user: clientUser,
                sessionId: sessionToken,
                sessionToken
              });
            } catch (err) {
              const errMsg = err?.message || "";
              if (errMsg.includes("DATABASE_NOT_CONFIGURED")) {
                roomManager.sendToWs(
                  ws,
                  formatErrorMessage("DATABASE_NOT_CONFIGURED", "PostgreSQL database is not configured. Set DATABASE_URL to enable persistence.")
                );
              } else {
                const errCode = errMsg === "ROOM_NOT_FOUND" ? "ROOM_NOT_FOUND" : "SESSION_NOT_FOUND";
                roomManager.sendToWs(
                  ws,
                  formatErrorMessage(errCode, "Session has expired or room no longer exists")
                );
              }
            }
            break;
          }
          case "LEAVE_ROOM": {
            roomManager.leaveRoom(ws);
            break;
          }
          case "REPORT_DRIFT": {
            if (typeof msg.driftMs === "number") {
              roomManager.updateUserDrift(ws, msg.driftMs);
            }
            break;
          }
          // ADMIN PLAYBACK COMMANDS - Server Authoritative & Serialized
          case "ADMIN_PLAY":
          case "ADMIN_PAUSE":
          case "ADMIN_SEEK":
          case "ADMIN_NEXT":
          case "ADMIN_PREVIOUS":
          case "ADMIN_SELECT_TRACK":
          case "ADMIN_SET_CURRENT_TRACK": {
            const meta = roomManager.getSessionByWs(ws);
            if (!meta) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage("SESSION_NOT_FOUND", "Active room session not found")
              );
              return;
            }
            const room = roomManager.getRoom(meta.roomId);
            if (!room) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage("ROOM_NOT_FOUND", "Room not found")
              );
              return;
            }
            const user = room.getUser(meta.userId);
            if (!canControlPlayback(user)) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage("FORBIDDEN", "Only the room admin can control playback.")
              );
              return;
            }
            if (!rateLimiter.checkLimit(`pb_${meta.userId}`, 40, 6e4)) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage("RATE_LIMITED", "Too many playback commands. Please slow down.")
              );
              return;
            }
            await roomManager.runRoomCommand(room.id, () => {
              if (msg.type === "ADMIN_PLAY") {
                const started = room.play();
                if (!started) {
                  const track = room.currentTrack;
                  const reason = !track ? "No track selected or queue is empty." : track.playbackStatus === "PROVIDER_NOT_CONFIGURED" ? "Audio playback provider is not configured." : track.playbackStatus === "PROVIDER_RESTRICTED" ? `Track restricted by Spotify (${track.restrictionReason || "restricted"}).` : "Track is not available for playback.";
                  roomManager.sendToWs(
                    ws,
                    formatErrorMessage("PLAYBACK_NOT_AVAILABLE", reason)
                  );
                }
              } else if (msg.type === "ADMIN_PAUSE") {
                room.pause();
              } else if (msg.type === "ADMIN_SEEK") {
                room.seek(msg.position);
              } else if (msg.type === "ADMIN_NEXT") {
                room.nextTrack();
              } else if (msg.type === "ADMIN_PREVIOUS") {
                room.previousTrack();
              } else if (msg.type === "ADMIN_SELECT_TRACK") {
                room.selectTrack(msg.trackId);
              } else if (msg.type === "ADMIN_SET_CURRENT_TRACK") {
                room.setCurrentTrack(msg.track, msg.autoplay !== false);
                roomManager.broadcastQueue(room);
              }
              roomManager.broadcastPlaybackState(room);
            });
            break;
          }
          // ADMIN QUEUE COMMANDS - Server Authoritative & Serialized
          case "ADMIN_ADD_QUEUE":
          case "ADMIN_REMOVE_QUEUE":
          case "ADMIN_REORDER_QUEUE":
          case "ADMIN_CLEAR_QUEUE":
          case "ADMIN_IMPORT_QUEUE": {
            const meta = roomManager.getSessionByWs(ws);
            if (!meta) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage("SESSION_NOT_FOUND", "Active room session not found")
              );
              return;
            }
            const room = roomManager.getRoom(meta.roomId);
            if (!room) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage("ROOM_NOT_FOUND", "Room not found")
              );
              return;
            }
            const user = room.getUser(meta.userId);
            if (!canModifyQueue(user)) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage("FORBIDDEN", "Only the room admin can modify the queue.")
              );
              return;
            }
            if (!rateLimiter.checkLimit(`q_${meta.userId}`, 30, 6e4)) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage("RATE_LIMITED", "Too many queue operations. Please slow down.")
              );
              return;
            }
            await roomManager.runRoomCommand(room.id, () => {
              if (msg.type === "ADMIN_ADD_QUEUE") {
                room.addToQueue(msg.track, user);
              } else if (msg.type === "ADMIN_REMOVE_QUEUE") {
                room.removeFromQueue(msg.queueItemId);
              } else if (msg.type === "ADMIN_REORDER_QUEUE") {
                room.reorderQueue(msg.queueItemIds);
              } else if (msg.type === "ADMIN_CLEAR_QUEUE") {
                room.clearQueue();
              } else if (msg.type === "ADMIN_IMPORT_QUEUE") {
                room.importQueue(msg.tracks || [], user, !!msg.replace);
                roomManager.broadcastPlaybackState(room);
              }
              roomManager.broadcastQueue(room);
            });
            break;
          }
          // ADMIN PARTICIPANT MANAGEMENT
          case "ADMIN_REMOVE_USER": {
            const meta = roomManager.getSessionByWs(ws);
            if (!meta) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage("SESSION_NOT_FOUND", "Active room session not found")
              );
              return;
            }
            const room = roomManager.getRoom(meta.roomId);
            if (!room) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage("ROOM_NOT_FOUND", "Room not found")
              );
              return;
            }
            const user = room.getUser(meta.userId);
            if (!canRemoveMember(user)) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage("FORBIDDEN", "Only the room admin can remove participants.")
              );
              return;
            }
            try {
              await roomManager.removeUserFromRoom(room.id, msg.userId, user);
            } catch (err) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage("INTERNAL_ERROR", "Failed to remove participant")
              );
            }
            break;
          }
          // ADMIN ROOM SETTINGS: RENAME ROOM
          case "ADMIN_RENAME_ROOM": {
            const meta = roomManager.getSessionByWs(ws);
            if (!meta) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage("SESSION_NOT_FOUND", "Active room session not found")
              );
              return;
            }
            const room = roomManager.getRoom(meta.roomId);
            if (!room) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage("ROOM_NOT_FOUND", "Room not found")
              );
              return;
            }
            const user = room.getUser(meta.userId);
            if (!canManageRoom(user)) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage("FORBIDDEN", "Only the room admin can rename this room.")
              );
              return;
            }
            try {
              await roomManager.renameRoom(room.id, msg.newName, user);
            } catch (err) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage("INTERNAL_ERROR", "Failed to rename room")
              );
            }
            break;
          }
          // ADMIN ROOM SETTINGS: END ROOM
          case "ADMIN_END_ROOM": {
            const meta = roomManager.getSessionByWs(ws);
            if (!meta) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage("SESSION_NOT_FOUND", "Active room session not found")
              );
              return;
            }
            const room = roomManager.getRoom(meta.roomId);
            if (!room) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage("ROOM_NOT_FOUND", "Room not found")
              );
              return;
            }
            const user = room.getUser(meta.userId);
            if (!canManageRoom(user)) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage("FORBIDDEN", "Only the room admin can end this room.")
              );
              return;
            }
            try {
              await roomManager.endRoom(room.id, user);
            } catch (err) {
              roomManager.sendToWs(
                ws,
                formatErrorMessage("INTERNAL_ERROR", "Failed to end room")
              );
            }
            break;
          }
          // AUDIT ACTIVITIES
          case "GET_ACTIVITIES": {
            const meta = roomManager.getSessionByWs(ws);
            if (!meta) return;
            const room = roomManager.getRoom(meta.roomId);
            if (!room) return;
            const user = room.getUser(meta.userId);
            if (!canManageRoom(user)) return;
            const activities = await roomManager.getRecentActivities(room.id);
            roomManager.sendToWs(ws, {
              type: "ACTIVITIES_LOADED",
              activities
            });
            break;
          }
          default:
            roomManager.sendToWs(
              ws,
              formatErrorMessage("INVALID_MESSAGE", "Unknown message type")
            );
        }
      } catch (err) {
        roomManager.sendToWs(
          ws,
          formatErrorMessage("INTERNAL_ERROR", "Internal server error processing message")
        );
      }
    });
    ws.on("close", (code, reason) => {
      logger.debug("[SyncRoom WS] Connection closed", { code, reason: reason?.toString() });
      roomManager.handleDisconnect(ws);
    });
    ws.on("error", (err) => {
      logger.warn("[SyncRoom WS] Connection socket error", { error: err.message });
      roomManager.handleDisconnect(ws);
    });
  });
}

// server/spotify/spotifyRoutes.ts
import { Router } from "express";

// server/spotify/spotifyAuth.ts
import crypto3 from "crypto";
import fs from "fs";
import path from "path";
var sessionSpotifyAuth = /* @__PURE__ */ new Map();
var CACHE_FILE = path.resolve(process.cwd(), ".spotify_auth_cache.json");
function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, "utf-8");
      const data = JSON.parse(raw);
      if (typeof data === "object" && data !== null) {
        for (const [key, value] of Object.entries(data)) {
          if (value && typeof value === "object" && "tokens" in value) {
            sessionSpotifyAuth.set(key, value);
          }
        }
      }
    }
  } catch {
  }
}
function saveCache() {
  try {
    const obj = {};
    for (const [key, value] of sessionSpotifyAuth.entries()) {
      obj[key] = value;
    }
    fs.writeFileSync(
      CACHE_FILE,
      JSON.stringify(obj, null, 2),
      "utf-8"
    );
  } catch {
  }
}
loadCache();
var pendingStates = /* @__PURE__ */ new Map();
setInterval(() => {
  const now = Date.now();
  for (const [state, data] of pendingStates.entries()) {
    if (now - data.createdAt > 10 * 60 * 1e3) {
      pendingStates.delete(state);
    }
  }
}, 60 * 1e3);
function getSpotifyConfig() {
  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim() || "";
  const configured = Boolean(clientId && clientSecret);
  return {
    clientId,
    clientSecret,
    configured
  };
}
function generateAuthState(sessionId) {
  const state = crypto3.randomBytes(24).toString("hex");
  pendingStates.set(state, {
    sessionId,
    createdAt: Date.now()
  });
  return state;
}
function validateAuthState(state) {
  const data = pendingStates.get(state);
  if (!data) {
    return null;
  }
  pendingStates.delete(state);
  if (Date.now() - data.createdAt > 10 * 60 * 1e3) {
    return null;
  }
  return data.sessionId;
}
function getStoredTokens(sessionId) {
  return sessionSpotifyAuth.get(sessionId)?.tokens || null;
}
function getStoredProfile(sessionId) {
  return sessionSpotifyAuth.get(sessionId)?.profile;
}
function setStoredTokens(sessionId, tokens, profile) {
  sessionSpotifyAuth.set(sessionId, {
    tokens,
    profile
  });
  saveCache();
}
var logoutVersions = /* @__PURE__ */ new Map();
function getLogoutVersion(sessionId) {
  return logoutVersions.get(sessionId) || 0;
}
function clearStoredTokens(sessionId) {
  const currentVersion = getLogoutVersion(sessionId);
  logoutVersions.set(
    sessionId,
    currentVersion + 1
  );
  activeRefreshes.delete(sessionId);
  sessionSpotifyAuth.delete(sessionId);
  saveCache();
}
var activeRefreshes = /* @__PURE__ */ new Map();
async function getValidAccessToken(sessionId) {
  const tokens = getStoredTokens(sessionId);
  if (!tokens) {
    return null;
  }
  if (tokens.expiresAt > Date.now() + 6e4) {
    return tokens.accessToken;
  }
  if (!tokens.refreshToken) {
    return null;
  }
  const {
    clientId,
    clientSecret
  } = getSpotifyConfig();
  if (!clientId || !clientSecret) {
    return null;
  }
  const existingRefresh = activeRefreshes.get(sessionId);
  if (existingRefresh) {
    return existingRefresh;
  }
  const refreshLogoutVersion = getLogoutVersion(sessionId);
  const refreshPromise = (async () => {
    try {
      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      const response = await fetch(
        "https://accounts.spotify.com/api/token",
        {
          method: "POST",
          headers: {
            "Authorization": `Basic ${basic}`,
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: tokens.refreshToken
          }),
          signal: AbortSignal.timeout(8e3)
        }
      );
      if (!response.ok) {
        console.error(
          "[Spotify Auth] Failed to refresh token:",
          await response.text()
        );
        return null;
      }
      const data = await response.json();
      if (getLogoutVersion(sessionId) !== refreshLogoutVersion) {
        return null;
      }
      const currentAuth = sessionSpotifyAuth.get(sessionId);
      if (!currentAuth) {
        return null;
      }
      const updatedTokens = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || tokens.refreshToken,
        expiresAt: Date.now() + (data.expires_in || 3600) * 1e3,
        scope: data.scope || tokens.scope
      };
      if (getLogoutVersion(sessionId) !== refreshLogoutVersion) {
        return null;
      }
      setStoredTokens(
        sessionId,
        updatedTokens,
        currentAuth.profile
      );
      return updatedTokens.accessToken;
    } catch (err) {
      console.error(
        "[Spotify Auth] Error refreshing token:",
        err
      );
      return null;
    } finally {
      activeRefreshes.delete(sessionId);
    }
  })();
  activeRefreshes.set(
    sessionId,
    refreshPromise
  );
  return refreshPromise;
}
var appToken = null;
async function getClientCredentialsToken() {
  const {
    clientId,
    clientSecret,
    configured
  } = getSpotifyConfig();
  if (!configured) {
    return null;
  }
  if (appToken && appToken.expiresAt > Date.now() + 6e4) {
    return appToken.token;
  }
  try {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const response = await fetch(
      "https://accounts.spotify.com/api/token",
      {
        method: "POST",
        headers: {
          "Authorization": `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          grant_type: "client_credentials"
        })
      }
    );
    if (!response.ok) {
      console.error(
        "[Spotify Auth] Client credentials error:",
        await response.text()
      );
      return null;
    }
    const data = await response.json();
    appToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1e3
    };
    return appToken.token;
  } catch (err) {
    console.error(
      "[Spotify Auth] Error getting client credentials token:",
      err
    );
    return null;
  }
}

// server/spotify/spotifyApi.ts
var SpotifyPlaylistError = class extends Error {
  constructor(status, message, httpStatus = 400) {
    super(message);
    this.name = "SpotifyPlaylistError";
    this.status = status;
    this.httpStatus = httpStatus;
  }
  get code() {
    return String(this.status);
  }
  get statusCode() {
    return this.httpStatus;
  }
};
function extractSpotifyPlaylistId(input) {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();
  const uriMatch = trimmed.match(/^spotify:playlist:([a-zA-Z0-9]{22})$/i);
  if (uriMatch) {
    return uriMatch[1];
  }
  const urlMatch = trimmed.match(/open\.spotify\.com\/(?:[a-z]{2,5}(?:-[a-z]{2,5})?\/)?playlist\/([a-zA-Z0-9]{22})/i);
  if (urlMatch) {
    return urlMatch[1];
  }
  if (/^[a-zA-Z0-9]{22}$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}
var GRADIENT_PALETTES = [
  { from: "#18181b", via: "#27272a", to: "#09090b", accent: "#1db954", pattern: "geometry" },
  { from: "#1e1b4b", via: "#0f172a", to: "#020617", accent: "#38bdf8", pattern: "aurora" },
  { from: "#292524", via: "#1c1917", to: "#0c0a09", accent: "#f59e0b", pattern: "rings" },
  { from: "#134e4a", via: "#042f2e", to: "#021614", accent: "#2dd4bf", pattern: "grid" },
  { from: "#312e81", via: "#1e1b4b", to: "#0f0e17", accent: "#c084fc", pattern: "waves" }
];
function generateCoverGradient(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % GRADIENT_PALETTES.length;
  return GRADIENT_PALETTES[idx];
}
function normalizeSpotifyTrack(rawTrack, index) {
  if (!rawTrack || typeof rawTrack !== "object") return null;
  const track = rawTrack.item && typeof rawTrack.item === "object" && rawTrack.item.id ? rawTrack.item : rawTrack.track && typeof rawTrack.track === "object" && rawTrack.track.id ? rawTrack.track : rawTrack.id ? rawTrack : rawTrack.item || rawTrack.track || rawTrack;
  if (!track || !track.id || track.type === "episode") {
    return null;
  }
  const artistsList = Array.isArray(track.artists) ? track.artists.map((a) => a?.name).filter(Boolean) : [];
  const artistString = artistsList.length > 0 ? artistsList.join(", ") : "Unknown Artist";
  const durationMs = Number(track.duration_ms) || 18e4;
  const albumImages = Array.isArray(track.album?.images) ? track.album.images : [];
  const albumArtUrl = albumImages[0]?.url || albumImages[1]?.url || null;
  const trackId = `spotify-${track.id}`;
  const rawRestriction = track.restrictions?.reason?.toLowerCase();
  let restrictionReason = null;
  if (rawRestriction === "market") {
    restrictionReason = "market";
  } else if (rawRestriction === "product") {
    restrictionReason = "product";
  } else if (rawRestriction === "explicit") {
    restrictionReason = "explicit";
  } else if (rawRestriction) {
    restrictionReason = "unknown";
  } else if (track.is_playable === false) {
    restrictionReason = "unknown";
  }
  let playbackStatus = "AVAILABLE";
  if (restrictionReason !== null || track.is_playable === false) {
    playbackStatus = "PROVIDER_RESTRICTED";
  }
  return {
    id: trackId,
    provider: "spotify",
    providerTrackId: track.id,
    title: track.name || `Track ${index + 1}`,
    artist: artistString,
    artists: artistsList,
    album: track.album?.name || (typeof track.album === "string" ? track.album : "Spotify Single"),
    albumArtUrl,
    durationMs,
    duration: Math.max(1, Math.round(durationMs / 1e3)),
    externalUrl: track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`,
    isPlayable: Boolean(track.is_playable !== false && !restrictionReason),
    playbackStatus,
    restrictionReason,
    spotifyIsPlayable: typeof track.is_playable === "boolean" ? track.is_playable : null,
    audioSource: "unavailable",
    genre: "Spotify Catalog",
    coverGradient: generateCoverGradient(track.id)
  };
}
async function fetchSpotifyPlaylist(playlistId, accessToken, userMarket) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json"
  };
  console.log(`[Spotify API] Fetching playlist metadata: ${playlistId}, userMarket: ${userMarket || "none"}`);
  let res = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, { headers });
  if (!res.ok) {
    const errorText = await res.text();
    if (res.status === 404) {
      throw new SpotifyPlaylistError("PLAYLIST_NOT_FOUND", "Spotify playlist not found.", 404);
    }
    if (res.status === 401) {
      throw new SpotifyPlaylistError("SPOTIFY_AUTH_REQUIRED", "Connect Spotify to import this playlist.", 401);
    }
    if (res.status === 403) {
      throw new SpotifyPlaylistError(
        "PLAYLIST_ITEMS_UNAVAILABLE",
        "This playlist is visible on Spotify, but Spotify does not provide its track list to this account. Import a playlist you own or collaborate on.",
        403
      );
    }
    throw new SpotifyPlaylistError("SPOTIFY_API_ERROR", `Spotify API error (${res.status}): ${errorText}`, res.status);
  }
  const data = await res.json();
  const playlistName = data.name || "Imported Spotify Playlist";
  const description = data.description || "";
  const imageUrl = data.images?.[0]?.url || null;
  const ownerName = data.owner?.display_name || data.owner?.id || "Spotify Curator";
  const ownerId = data.owner?.id;
  const collaborative = Boolean(data.collaborative);
  const seenTrackIds = /* @__PURE__ */ new Set();
  const tracks = [];
  const embeddedItemsObj = data.items || data.tracks;
  let rawItems = null;
  let totalReported = null;
  let nextUrl = null;
  if (embeddedItemsObj && typeof embeddedItemsObj === "object") {
    if (Array.isArray(embeddedItemsObj.items)) {
      rawItems = embeddedItemsObj.items;
      totalReported = typeof embeddedItemsObj.total === "number" ? embeddedItemsObj.total : embeddedItemsObj.items.length;
      nextUrl = embeddedItemsObj.next || null;
    } else if (Array.isArray(embeddedItemsObj)) {
      rawItems = embeddedItemsObj;
      totalReported = embeddedItemsObj.length;
    }
  }
  if (rawItems === null) {
    console.log(`[Spotify API] Items omitted from metadata for ${playlistId}. Fetching /items endpoint...`);
    const itemsUrl = `https://api.spotify.com/v1/playlists/${playlistId}/items?limit=100${userMarket ? `&market=${encodeURIComponent(userMarket)}` : ""}`;
    const itemsRes = await fetch(itemsUrl, { headers });
    if (itemsRes.status === 403) {
      console.warn(`[Spotify API Diagnostics] Playlist ${playlistId} returned 403 Forbidden on /items. Owner: ${ownerId}, Collaborative: ${collaborative}`);
      throw new SpotifyPlaylistError(
        "PLAYLIST_ITEMS_UNAVAILABLE",
        "This playlist is visible on Spotify, but Spotify does not provide its track list to this account. Import a playlist you own or collaborate on.",
        403
      );
    }
    if (itemsRes.status === 404) {
      throw new SpotifyPlaylistError("PLAYLIST_NOT_FOUND", "Spotify playlist not found.", 404);
    }
    if (itemsRes.status === 401) {
      throw new SpotifyPlaylistError("SPOTIFY_AUTH_REQUIRED", "Connect Spotify to import this playlist.", 401);
    }
    if (!itemsRes.ok) {
      const errText = await itemsRes.text();
      throw new SpotifyPlaylistError("SPOTIFY_API_ERROR", `Spotify API error (${itemsRes.status}): ${errText}`, itemsRes.status);
    }
    const itemsData = await itemsRes.json();
    const parsedItems = Array.isArray(itemsData.items) ? itemsData.items : [];
    rawItems = parsedItems;
    totalReported = typeof itemsData.total === "number" ? itemsData.total : parsedItems.length;
    nextUrl = itemsData.next || null;
  }
  const safeItems = rawItems || [];
  for (const item of safeItems) {
    const normalized = normalizeSpotifyTrack(item, tracks.length);
    if (normalized && !seenTrackIds.has(normalized.providerTrackId)) {
      seenTrackIds.add(normalized.providerTrackId);
      tracks.push(normalized);
    }
  }
  let pageCount = 1;
  const maxPages = 50;
  while (nextUrl && pageCount < maxPages) {
    pageCount++;
    try {
      const pageRes = await fetch(nextUrl, { headers });
      if (!pageRes.ok) {
        console.warn(`[Spotify API] Pagination stopped at page ${pageCount} (HTTP ${pageRes.status})`);
        break;
      }
      const pageData = await pageRes.json();
      const pageItems = Array.isArray(pageData.items) ? pageData.items : [];
      for (const item of pageItems) {
        const normalized = normalizeSpotifyTrack(item, tracks.length);
        if (normalized && !seenTrackIds.has(normalized.providerTrackId)) {
          seenTrackIds.add(normalized.providerTrackId);
          tracks.push(normalized);
        }
      }
      nextUrl = pageData.next || null;
    } catch (err) {
      console.warn(`[Spotify API] Pagination fetch failed on page ${pageCount}:`, err?.message);
      break;
    }
  }
  let importStatus;
  let statusMessage;
  if (tracks.length > 0) {
    importStatus = "PLAYLIST_IMPORTED";
    statusMessage = `Imported ${tracks.length} tracks.`;
  } else if (totalReported === 0 || safeItems.length === 0) {
    importStatus = "PLAYLIST_ACTUALLY_EMPTY";
    statusMessage = "This Spotify playlist is empty.";
  } else {
    importStatus = "PLAYLIST_ITEMS_UNAVAILABLE";
    statusMessage = "This playlist is visible on Spotify, but Spotify does not provide its track list to this account. Import a playlist you own or collaborate on.";
  }
  let playableCount = 0;
  let marketRestricted = 0;
  let productRestricted = 0;
  let explicitRestricted = 0;
  let unknownRestricted = 0;
  for (const t of tracks) {
    if (t.spotifyIsPlayable === true) playableCount++;
    if (t.restrictionReason === "market") marketRestricted++;
    else if (t.restrictionReason === "product") productRestricted++;
    else if (t.restrictionReason === "explicit") explicitRestricted++;
    else if (t.restrictionReason === "unknown") unknownRestricted++;
  }
  console.log(`[Spotify Playlist Import Diagnostics]`, {
    playlistId,
    playlistName,
    httpStatus: res.status,
    itemsFieldPresent: Boolean(embeddedItemsObj),
    itemsCount: safeItems.length,
    trackCount: tracks.length,
    playableCount,
    restrictedCount: marketRestricted + productRestricted + explicitRestricted + unknownRestricted,
    ownerId,
    ownerName,
    collaborative,
    status: importStatus
  });
  return {
    id: playlistId,
    name: playlistName,
    description,
    imageUrl,
    ownerName,
    ownerId,
    collaborative,
    totalTracks: Math.max(totalReported || 0, tracks.length),
    tracks,
    externalUrl: data.external_urls?.spotify || `https://open.spotify.com/playlist/${playlistId}`,
    unplayableCount: marketRestricted + productRestricted + explicitRestricted + unknownRestricted,
    restrictionsSummary: {
      market: marketRestricted,
      product: productRestricted,
      explicit: explicitRestricted,
      unknown: unknownRestricted
    },
    providerConfigured: false,
    importStatus,
    statusMessage
  };
}
async function fetchUserPlaylists(accessToken, currentUserId) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json"
  };
  const res = await fetch("https://api.spotify.com/v1/me/playlists?limit=50", { headers });
  if (!res.ok) {
    const errorText = await res.text();
    if (res.status === 401) {
      throw new SpotifyPlaylistError("SPOTIFY_AUTH_REQUIRED", "Connect Spotify to import this playlist.", 401);
    }
    throw new SpotifyPlaylistError("SPOTIFY_API_ERROR", `Failed to fetch your playlists from Spotify (${res.status}): ${errorText}`, res.status);
  }
  const data = await res.json();
  const items = Array.isArray(data.items) ? data.items : [];
  const playlists = [];
  for (const p of items) {
    if (!p || !p.id) continue;
    const isOwner = Boolean(currentUserId && p.owner?.id === currentUserId);
    const imageUrl = p.images?.[0]?.url || null;
    const totalTracks = Number(p.items?.total ?? p.tracks?.total ?? p.total ?? 0);
    playlists.push({
      id: p.id,
      name: p.name || "Untitled Playlist",
      description: p.description || "",
      imageUrl,
      ownerName: p.owner?.display_name || p.owner?.id || "Unknown Curator",
      ownerId: p.owner?.id,
      isOwner,
      collaborative: Boolean(p.collaborative),
      totalTracks,
      externalUrl: p.external_urls?.spotify || `https://open.spotify.com/playlist/${p.id}`
    });
  }
  return playlists;
}
async function searchSpotifyTracks(query, accessToken, limit = 20) {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json"
  };
  const url = `https://api.spotify.com/v1/search?type=track&q=${encodeURIComponent(trimmed)}&limit=${limit}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const errorText = await res.text();
    if (res.status === 401 || res.status === 403) {
      throw new Error("Spotify authorization expired or permission denied. Please reconnect Spotify.");
    }
    throw new Error(`Spotify Search API error (${res.status}): ${errorText}`);
  }
  const data = await res.json();
  const items = Array.isArray(data.tracks?.items) ? data.tracks.items : Array.isArray(data.items?.items) ? data.items.items : Array.isArray(data.tracks) ? data.tracks : Array.isArray(data.items) ? data.items : [];
  const tracks = [];
  for (let i = 0; i < items.length; i++) {
    const normalized = normalizeSpotifyTrack(items[i], i);
    if (normalized) {
      tracks.push(normalized);
    }
  }
  return tracks;
}
function parseSpotifyTrackId(input) {
  if (!input || typeof input !== "string") {
    return { trackId: null, error: "Please enter a Spotify track URL or ID." };
  }
  const trimmed = input.trim();
  const uriMatch = trimmed.match(/^spotify:track:([a-zA-Z0-9]{22})$/i);
  if (uriMatch) {
    return { trackId: uriMatch[1] };
  }
  const urlMatch = trimmed.match(/open\.spotify\.com\/(?:[a-z]{2,5}(?:-[a-z]{2,5})?\/)?track\/([a-zA-Z0-9]{22})/i);
  if (urlMatch) {
    return { trackId: urlMatch[1] };
  }
  if (/^[a-zA-Z0-9]{22}$/.test(trimmed)) {
    return { trackId: trimmed };
  }
  return { trackId: null, error: "Invalid Spotify track URL or ID format." };
}
async function fetchSpotifyTrack(trackIdOrUrl, accessToken, userMarket) {
  const { trackId, error } = parseSpotifyTrackId(trackIdOrUrl);
  if (!trackId) {
    throw new SpotifyPlaylistError("INVALID_TRACK_ID", error || "Invalid Spotify track format.", 400);
  }
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json"
  };
  const marketQuery = userMarket ? `?market=${encodeURIComponent(userMarket)}` : "";
  const url = `https://api.spotify.com/v1/tracks/${trackId}${marketQuery}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const errorText = await res.text();
    if (res.status === 404) {
      throw new SpotifyPlaylistError("TRACK_NOT_FOUND", "Spotify track not found.", 404);
    }
    if (res.status === 401) {
      throw new SpotifyPlaylistError("SPOTIFY_AUTH_REQUIRED", "Spotify authorization required to fetch track.", 401);
    }
    if (res.status === 403) {
      throw new SpotifyPlaylistError("TRACK_UNAVAILABLE", "Spotify track is restricted or unavailable in your region.", 403);
    }
    throw new SpotifyPlaylistError("SPOTIFY_API_ERROR", `Spotify API error (${res.status}): ${errorText}`, res.status);
  }
  const rawTrack = await res.json();
  const normalized = normalizeSpotifyTrack(rawTrack, 0);
  if (!normalized) {
    throw new SpotifyPlaylistError("TRACK_UNAVAILABLE", "Track exists on Spotify but could not be processed as an audio track.", 400);
  }
  return normalized;
}

// server/spotify/spotifyRoutes.ts
var spotifyRouter = Router();
function getRedirectUri(req) {
  if (process.env.SPOTIFY_REDIRECT_URI) {
    return process.env.SPOTIFY_REDIRECT_URI;
  }
  const appUrl = process.env.APP_URL;
  if (appUrl) {
    const cleaned = appUrl.endsWith("/") ? appUrl.slice(0, -1) : appUrl;
    return `${cleaned}/api/spotify/callback`;
  }
  const host = req.get("host") || "localhost:3000";
  const protocol = req.protocol === "https" || req.get("x-forwarded-proto") === "https" ? "https" : "http";
  return `${protocol}://${host}/api/spotify/callback`;
}
spotifyRouter.get("/login", authRateLimiter, (req, res) => {
  const { clientId, configured } = getSpotifyConfig();
  const sessionId = req.query.sessionId || "default-session";
  const redirectUri = getRedirectUri(req);
  if (!configured) {
    return res.status(200).json({
      configured: false,
      url: null,
      message: "SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are not set in environment.",
      redirectUri
    });
  }
  const state = generateAuthState(sessionId);
  const scopes = [
    "user-read-private",
    "playlist-read-private",
    "playlist-read-collaborative",
    "user-read-email",
    "streaming",
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-read-currently-playing"
  ].join(" ");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: scopes,
    redirect_uri: redirectUri,
    state,
    show_dialog: "true"
  });
  const authUrl = `https://accounts.spotify.com/authorize?${params.toString()}`;
  if (req.query.format === "json" || req.headers.accept?.includes("application/json")) {
    return res.json({
      configured: true,
      url: authUrl,
      redirectUri
    });
  }
  return res.redirect(authUrl);
});
function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
var callbackHandler = async (req, res) => {
  const code = req.query.code;
  const state = req.query.state;
  const rawError = req.query.error;
  if (rawError || !code) {
    const safeError = rawError ? escapeHtml(String(rawError).slice(0, 200)) : "No authorization code received from Spotify.";
    return res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>Spotify Authorization</title></head>
        <body style="font-family: system-ui, sans-serif; background: #09090b; color: #f43f5e; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
          <div style="text-align: center; padding: 24px; max-width: 400px;">
            <h3>Authorization Failed</h3>
            <p style="color: #a1a1aa; font-size: 14px;">${safeError}</p>
            <script>
              if (window.opener) {
                try {
                  window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', provider: 'spotify', error: '${safeError}' }, '*');
                } catch (e) {}
              }
              setTimeout(() => { if (window.opener) { window.close(); } }, 2500);
            </script>
          </div>
        </body>
      </html>
    `);
  }
  const sessionId = validateAuthState(state);
  if (!sessionId) {
    return res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>Spotify Authorization</title></head>
        <body style="font-family: system-ui, sans-serif; background: #09090b; color: #f43f5e; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
          <div style="text-align: center; padding: 24px; max-width: 400px;">
            <h3>Invalid State</h3>
            <p style="color: #a1a1aa; font-size: 14px;">The authorization state has expired. Please try connecting again.</p>
            <script>
              setTimeout(() => { if (window.opener) { window.close(); } }, 3000);
            </script>
          </div>
        </body>
      </html>
    `);
  }
  const { clientId, clientSecret } = getSpotifyConfig();
  const redirectUri = getRedirectUri(req);
  try {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri
      })
    });
    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      logger.error("[Spotify Auth] Token exchange failed with Spotify", void 0, { status: tokenRes.status });
      return res.status(500).send(`
        <!DOCTYPE html>
        <html>
          <body style="background: #09090b; color: #fff; font-family: sans-serif; text-align: center; padding: 40px;">
            <p>Failed to exchange token with Spotify.</p>
          </body>
        </html>
      `);
    }
    const tokenData = await tokenRes.json();
    const tokens = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1e3,
      scope: tokenData.scope
    };
    let profile;
    try {
      const meRes = await fetch("https://api.spotify.com/v1/me", {
        headers: { Authorization: `Bearer ${tokens.accessToken}` }
      });
      if (meRes.ok) {
        const me = await meRes.json();
        profile = {
          id: me.id,
          displayName: me.display_name || me.id,
          email: me.email,
          imageUrl: me.images?.[0]?.url,
          country: me.country,
          product: me.product
        };
      }
    } catch (err) {
      logger.warn("[Spotify Auth] Could not fetch profile details");
    }
    setStoredTokens(sessionId, tokens, profile);
    return res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Spotify Connected</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              background: #09090b;
              color: #f4f4f5;
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
            }
            .card {
              text-align: center;
              padding: 32px;
              border-radius: 16px;
              background: #18181b;
              border: 1px solid #27272a;
              max-width: 380px;
            }
            .icon {
              width: 48px;
              height: 48px;
              color: #1db954;
              margin-bottom: 16px;
            }
            h2 { margin: 0 0 8px 0; font-size: 20px; }
            p { margin: 0; color: #a1a1aa; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="card">
            <svg class="icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
            </svg>
            <h2>Connected to Spotify</h2>
            <p>Authentication successful. Closing window...</p>
          </div>
          <script>
            if (window.opener) {
              const allowed = ${JSON.stringify(getAllowedOrigins())};
              const targets = allowed.length > 0 ? allowed : [window.location.origin];
              for (const target of targets) {
                try {
                  window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', provider: 'spotify' }, target);
                } catch (e) {}
              }
              setTimeout(() => { window.close(); }, 800);
            } else {
              setTimeout(() => { window.location.href = '/'; }, 1500);
            }
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    logger.error("[Spotify Auth] Callback exception", err);
    return res.status(500).send("Authentication exception");
  }
};
spotifyRouter.get("/callback", authRateLimiter, callbackHandler);
spotifyRouter.get("/callback/", authRateLimiter, callbackHandler);
spotifyRouter.get("/status", (req, res) => {
  const sessionId = req.query.sessionId || req.headers["x-session-id"] || "default-session";
  const { configured, clientId } = getSpotifyConfig();
  const tokens = getStoredTokens(sessionId);
  const profile = getStoredProfile(sessionId);
  const connected = Boolean(tokens && tokens.expiresAt > Date.now() - 36e5);
  return res.json({
    configured,
    clientIdPresent: Boolean(clientId),
    connected,
    user: profile || null,
    redirectUri: getRedirectUri(req)
  });
});
spotifyRouter.get("/token", spotifyRateLimiter, async (req, res) => {
  const sessionId = req.query.sessionId || req.headers["x-session-id"] || "default-session";
  const token = await getValidAccessToken(sessionId);
  if (!token) {
    return res.status(401).json({
      error: "Not authenticated with Spotify or authorization expired. Please connect your Spotify account.",
      requiresAuth: true
    });
  }
  const profile = getStoredProfile(sessionId);
  const isPremium = profile?.product === "premium";
  return res.json({
    accessToken: token,
    product: profile?.product || "unknown",
    isPremium,
    user: profile || null
  });
});
async function resolveActiveSpotifyDeviceId(token, requestedDeviceId) {
  try {
    const res = await fetch("https://api.spotify.com/v1/me/player/devices", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return requestedDeviceId || null;
    const data = await res.json();
    const devices = data.devices || [];
    if (devices.length === 0) return requestedDeviceId || null;
    if (requestedDeviceId && devices.some((d) => d.id === requestedDeviceId)) {
      return requestedDeviceId;
    }
    const syncRoomDevice = devices.find((d) => d.name === "SyncRoom Web Player");
    if (syncRoomDevice?.id) {
      return syncRoomDevice.id;
    }
    const activeDevice = devices.find((d) => d.is_active);
    if (activeDevice?.id) {
      return activeDevice.id;
    }
    return devices[0]?.id || requestedDeviceId || null;
  } catch {
    return requestedDeviceId || null;
  }
}
spotifyRouter.get("/devices", spotifyRateLimiter, async (req, res) => {
  const sessionId = req.query?.sessionId || req.headers["x-session-id"] || "default-session";
  const token = await getValidAccessToken(sessionId);
  if (!token) return res.status(401).json({ error: "Spotify authorization required.", devices: [] });
  try {
    const spotifyRes = await fetch("https://api.spotify.com/v1/me/player/devices", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!spotifyRes.ok) return res.status(spotifyRes.status).json({ devices: [] });
    const data = await spotifyRes.json();
    return res.status(200).json({ devices: data.devices || [] });
  } catch {
    return res.status(500).json({ devices: [] });
  }
});
spotifyRouter.put("/playback/play", spotifyRateLimiter, async (req, res) => {
  const sessionId = req.body?.sessionId || req.headers["x-session-id"] || "default-session";
  const token = await getValidAccessToken(sessionId);
  if (!token) {
    return res.status(401).json({ error: "Spotify authorization required.", requiresAuth: true });
  }
  let { deviceId, uris, positionMs } = req.body || {};
  if (!deviceId) {
    deviceId = await resolveActiveSpotifyDeviceId(token);
  }
  if (!deviceId) {
    return res.status(400).json({ error: "Missing deviceId for Spotify playback." });
  }
  try {
    let playUrl = `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`;
    const body = {};
    if (Array.isArray(uris) && uris.length > 0) {
      body.uris = uris;
    }
    if (typeof positionMs === "number" && positionMs >= 0) {
      body.position_ms = Math.round(positionMs);
    }
    let spotifyRes = await fetch(playUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: Object.keys(body).length > 0 ? JSON.stringify(body) : void 0
    });
    if (spotifyRes.status === 404) {
      logger.info(`[Spotify Backend Play] Device ${deviceId} not found (404). Activating device...`);
      await fetch("https://api.spotify.com/v1/me/player", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ device_ids: [deviceId], play: false }),
        signal: AbortSignal.timeout(5e3)
      }).catch(() => {
      });
      await new Promise((r) => setTimeout(r, 250));
      spotifyRes = await fetch(playUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: Object.keys(body).length > 0 ? JSON.stringify(body) : void 0,
        signal: AbortSignal.timeout(5e3)
      });
      if (spotifyRes.status === 404) {
        logger.info(`[Spotify Backend Play] Still 404 after activating ${deviceId}. Resolving device list...`);
        const resolvedId = await resolveActiveSpotifyDeviceId(token, deviceId);
        if (resolvedId && resolvedId !== deviceId) {
          deviceId = resolvedId;
          playUrl = `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`;
          await fetch("https://api.spotify.com/v1/me/player", {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ device_ids: [deviceId], play: false }),
            signal: AbortSignal.timeout(5e3)
          }).catch(() => {
          });
          await new Promise((r) => setTimeout(r, 200));
          spotifyRes = await fetch(playUrl, {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json"
            },
            body: Object.keys(body).length > 0 ? JSON.stringify(body) : void 0,
            signal: AbortSignal.timeout(5e3)
          });
        }
      }
    }
    if (!spotifyRes.ok && spotifyRes.status !== 204) {
      const errText = await spotifyRes.text();
      let parsedErr = null;
      try {
        parsedErr = JSON.parse(errText);
      } catch {
      }
      const reason = parsedErr?.error?.reason || parsedErr?.error?.message || errText;
      logger.warn("[Spotify Backend Play Error]", {
        status: spotifyRes.status,
        reason,
        deviceId,
        uris,
        sessionId
      });
      return res.status(spotifyRes.status).json({
        error: reason,
        status: spotifyRes.status
      });
    }
    return res.status(200).json({ success: true, resolvedDeviceId: deviceId });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Failed to start playback on Spotify device." });
  }
});
spotifyRouter.put("/playback/pause", spotifyRateLimiter, async (req, res) => {
  const sessionId = req.body?.sessionId || req.headers["x-session-id"] || "default-session";
  const token = await getValidAccessToken(sessionId);
  if (!token) return res.status(401).json({ error: "Spotify authorization required.", requiresAuth: true });
  let { deviceId } = req.body || {};
  if (!deviceId) {
    deviceId = await resolveActiveSpotifyDeviceId(token);
  }
  try {
    const pauseUrl = deviceId ? `https://api.spotify.com/v1/me/player/pause?device_id=${encodeURIComponent(deviceId)}` : "https://api.spotify.com/v1/me/player/pause";
    const spotifyRes = await fetch(pauseUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!spotifyRes.ok && spotifyRes.status !== 204) {
      const errText = await spotifyRes.text();
      return res.status(spotifyRes.status).json({ error: errText });
    }
    return res.status(200).json({ success: true, resolvedDeviceId: deviceId });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Failed to pause playback." });
  }
});
spotifyRouter.put("/playback/seek", spotifyRateLimiter, async (req, res) => {
  const sessionId = req.body?.sessionId || req.headers["x-session-id"] || "default-session";
  const token = await getValidAccessToken(sessionId);
  if (!token) return res.status(401).json({ error: "Spotify authorization required.", requiresAuth: true });
  let { deviceId, positionMs } = req.body || {};
  if (!deviceId) {
    deviceId = await resolveActiveSpotifyDeviceId(token);
  }
  const pos = Math.round(Number(positionMs) || 0);
  try {
    const seekUrl = `https://api.spotify.com/v1/me/player/seek?position_ms=${pos}${deviceId ? `&device_id=${encodeURIComponent(deviceId)}` : ""}`;
    const spotifyRes = await fetch(seekUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!spotifyRes.ok && spotifyRes.status !== 204) {
      const errText = await spotifyRes.text();
      return res.status(spotifyRes.status).json({ error: errText });
    }
    return res.status(200).json({ success: true, resolvedDeviceId: deviceId });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Failed to seek playback." });
  }
});
var activeTransfers = /* @__PURE__ */ new Map();
spotifyRouter.put("/playback/transfer", spotifyRateLimiter, async (req, res) => {
  const sessionId = req.body?.sessionId || req.headers["x-session-id"] || "default-session";
  const token = await getValidAccessToken(sessionId);
  if (!token) return res.status(401).json({ error: "Spotify authorization required.", requiresAuth: true });
  let { deviceId, play } = req.body || {};
  if (!deviceId) {
    deviceId = await resolveActiveSpotifyDeviceId(token);
  }
  if (!deviceId) return res.status(400).json({ error: "Missing deviceId for transfer." });
  const transferKey = `${sessionId}_${deviceId}_${Boolean(play)}`;
  const existing = activeTransfers.get(transferKey);
  if (existing) {
    const result2 = await existing;
    return res.status(result2.status || 200).json(result2);
  }
  const transferPromise = (async () => {
    try {
      let spotifyRes = await fetch("https://api.spotify.com/v1/me/player", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          device_ids: [deviceId],
          play: Boolean(play)
        }),
        signal: AbortSignal.timeout(6e3)
      });
      if (spotifyRes.status === 404) {
        const resolvedId = await resolveActiveSpotifyDeviceId(token, deviceId);
        if (resolvedId && resolvedId !== deviceId) {
          deviceId = resolvedId;
          spotifyRes = await fetch("https://api.spotify.com/v1/me/player", {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              device_ids: [deviceId],
              play: Boolean(play)
            }),
            signal: AbortSignal.timeout(6e3)
          });
        }
      }
      if (!spotifyRes.ok && spotifyRes.status !== 204) {
        const errText = await spotifyRes.text();
        logger.warn("[Spotify Backend Transfer Error]", {
          status: spotifyRes.status,
          errText,
          deviceId,
          sessionId
        });
        return { success: false, status: spotifyRes.status, error: errText };
      }
      return { success: true, status: 200, resolvedDeviceId: deviceId };
    } catch (err) {
      return { success: false, status: 500, error: err?.message || "Failed to transfer playback." };
    } finally {
      activeTransfers.delete(transferKey);
    }
  })();
  activeTransfers.set(transferKey, transferPromise);
  const result = await transferPromise;
  return res.status(result.status || 200).json(result);
});
spotifyRouter.post("/logout", authRateLimiter, (req, res) => {
  const sessionId = req.body?.sessionId || req.headers["x-session-id"] || "default-session";
  clearStoredTokens(sessionId);
  return res.json({ success: true });
});
spotifyRouter.get("/search", spotifyRateLimiter, async (req, res) => {
  const query = req.query.q || "";
  if (!query.trim()) {
    return res.json({ tracks: [] });
  }
  const sessionId = req.query.sessionId || req.headers["x-session-id"] || "default-session";
  let token = await getValidAccessToken(sessionId);
  if (!token) {
    token = await getClientCredentialsToken();
  }
  if (!token) {
    const { configured } = getSpotifyConfig();
    return res.status(401).json({
      error: configured ? "Please connect your Spotify account to search tracks." : "Spotify credentials are not configured on the server.",
      configured,
      requiresAuth: true,
      tracks: []
    });
  }
  try {
    const tracks = await searchSpotifyTracks(query, token);
    return res.json({ tracks });
  } catch (err) {
    const message = err?.message || "Failed to search Spotify tracks";
    return res.status(400).json({ error: message, tracks: [] });
  }
});
spotifyRouter.get("/me/playlists", spotifyRateLimiter, async (req, res) => {
  const sessionId = req.query.sessionId || req.headers["x-session-id"] || "default-session";
  const token = await getValidAccessToken(sessionId);
  if (!token) {
    return res.status(401).json({
      error: "Connect Spotify to view your playlists.",
      requiresAuth: true,
      playlists: []
    });
  }
  const profile = getStoredProfile(sessionId);
  try {
    const playlists = await fetchUserPlaylists(token, profile?.id);
    return res.json({ playlists });
  } catch (err) {
    if (err instanceof SpotifyPlaylistError) {
      return res.status(err.httpStatus).json({ error: err.message, status: err.status, playlists: [] });
    }
    const message = err?.message || "Failed to fetch user playlists";
    return res.status(500).json({ error: message, playlists: [] });
  }
});
spotifyRouter.get("/playlist/:playlistId", spotifyRateLimiter, async (req, res) => {
  const rawId = req.params.playlistId;
  const playlistId = extractSpotifyPlaylistId(rawId);
  if (!playlistId) {
    return res.status(400).json({
      error: "Invalid Spotify playlist format.",
      status: "PLAYLIST_NOT_FOUND"
    });
  }
  const sessionId = req.query.sessionId || req.headers["x-session-id"] || "default-session";
  let token = await getValidAccessToken(sessionId);
  if (!token) {
    token = await getClientCredentialsToken();
  }
  if (!token) {
    return res.status(401).json({
      error: "Connect Spotify to import this playlist.",
      requiresAuth: true,
      status: "SPOTIFY_AUTH_REQUIRED"
    });
  }
  const profile = getStoredProfile(sessionId);
  const userMarket = profile?.country;
  try {
    const playlist = await fetchSpotifyPlaylist(playlistId, token, userMarket);
    return res.json(playlist);
  } catch (err) {
    if (err instanceof SpotifyPlaylistError) {
      return res.status(err.httpStatus).json({
        error: err.message,
        status: err.status
      });
    }
    const message = err?.message || "Spotify could not provide the playlist contents right now.";
    return res.status(400).json({ error: message, status: "SPOTIFY_API_ERROR" });
  }
});
spotifyRouter.post("/track/resolve", spotifyRateLimiter, async (req, res) => {
  const urlOrId = req.body?.urlOrId || req.body?.url || req.body?.trackId || req.query.urlOrId;
  if (!urlOrId || typeof urlOrId !== "string") {
    return res.status(400).json({
      error: "Please provide a valid Spotify track URL or ID.",
      status: "INVALID_TRACK_ID"
    });
  }
  const { trackId, error: parseError } = parseSpotifyTrackId(urlOrId);
  if (!trackId) {
    return res.status(400).json({
      error: parseError || "Invalid Spotify track URL or ID format.",
      status: "INVALID_TRACK_ID"
    });
  }
  const sessionId = req.headers["x-session-id"] || req.query.sessionId || "default-session";
  let token = await getValidAccessToken(sessionId);
  if (!token) {
    token = await getClientCredentialsToken();
  }
  if (!token) {
    return res.status(401).json({
      error: "Connect Spotify to resolve track metadata.",
      requiresAuth: true,
      status: "SPOTIFY_AUTH_REQUIRED"
    });
  }
  const profile = getStoredProfile(sessionId);
  const userMarket = profile?.country;
  try {
    const track = await fetchSpotifyTrack(trackId, token, userMarket);
    return res.json({ success: true, track });
  } catch (err) {
    if (err instanceof SpotifyPlaylistError) {
      return res.status(err.httpStatus).json({
        error: err.message,
        status: err.status
      });
    }
    const message = err?.message || "Spotify could not provide the track details right now.";
    return res.status(400).json({ error: message, status: "SPOTIFY_API_ERROR" });
  }
});
spotifyRouter.get("/track/:trackId", spotifyRateLimiter, async (req, res) => {
  const rawId = req.params.trackId;
  const { trackId, error: parseError } = parseSpotifyTrackId(rawId);
  if (!trackId) {
    return res.status(400).json({
      error: parseError || "Invalid Spotify track format.",
      status: "INVALID_TRACK_ID"
    });
  }
  const sessionId = req.query.sessionId || req.headers["x-session-id"] || "default-session";
  let token = await getValidAccessToken(sessionId);
  if (!token) {
    token = await getClientCredentialsToken();
  }
  if (!token) {
    return res.status(401).json({
      error: "Connect Spotify to resolve this track.",
      requiresAuth: true,
      status: "SPOTIFY_AUTH_REQUIRED"
    });
  }
  const profile = getStoredProfile(sessionId);
  const userMarket = profile?.country;
  try {
    const track = await fetchSpotifyTrack(trackId, token, userMarket);
    return res.json({ success: true, track });
  } catch (err) {
    if (err instanceof SpotifyPlaylistError) {
      return res.status(err.httpStatus).json({
        error: err.message,
        status: err.status
      });
    }
    const message = err?.message || "Spotify could not provide the track details right now.";
    return res.status(400).json({ error: message, status: "SPOTIFY_API_ERROR" });
  }
});

// server/youtube/youtubeRoutes.ts
import { Router as Router2 } from "express";

// server/youtube/youtubeService.ts
var SEARCH_CACHE_TTL_MS = 30 * 60 * 1e3;
var MATCH_CACHE_TTL_MS = 24 * 60 * 60 * 1e3;
var searchCache = /* @__PURE__ */ new Map();
var matchCache = /* @__PURE__ */ new Map();
var videoCache = /* @__PURE__ */ new Map();
var GRADIENT_PALETTES2 = [
  { from: "#18181b", via: "#27272a", to: "#09090b", accent: "#ff0000", pattern: "geometry" },
  { from: "#1e1b4b", via: "#0f172a", to: "#020617", accent: "#f43f5e", pattern: "aurora" },
  { from: "#292524", via: "#1c1917", to: "#0c0a09", accent: "#f59e0b", pattern: "rings" },
  { from: "#134e4a", via: "#042f2e", to: "#021614", accent: "#ec4899", pattern: "grid" },
  { from: "#312e81", via: "#1e1b4b", to: "#0f0e17", accent: "#ef4444", pattern: "waves" }
];
function generateCoverGradient2(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % GRADIENT_PALETTES2.length;
  return GRADIENT_PALETTES2[idx];
}
function decodeHtmlEntities(input) {
  if (!input) return "";
  return input.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
}
function parseIso8601Duration(isoDuration) {
  if (!isoDuration || typeof isoDuration !== "string") return 0;
  const match = isoDuration.match(/P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/i);
  if (!match) return 0;
  const days = parseInt(match[1] || "0", 10);
  const hours = parseInt(match[2] || "0", 10);
  const minutes = parseInt(match[3] || "0", 10);
  const seconds = parseInt(match[4] || "0", 10);
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}
var YouTubeService = class {
  getApiKey() {
    const key = process.env.YOUTUBE_API_KEY?.trim();
    return key || null;
  }
  isConfigured() {
    return Boolean(this.getApiKey());
  }
  /**
   * Normalizes a raw YouTube video item into a SyncRoom Track.
   */
  normalizeVideoToTrack(videoId, title, channelTitle, thumbnailUrl, durationSeconds) {
    const cleanTitle = decodeHtmlEntities(title);
    const cleanArtist = decodeHtmlEntities(channelTitle);
    const duration = Math.max(1, durationSeconds);
    return {
      id: `youtube-${videoId}`,
      provider: "youtube",
      providerTrackId: videoId,
      title: cleanTitle,
      artist: cleanArtist,
      artists: [cleanArtist],
      album: "YouTube",
      albumArtUrl: thumbnailUrl,
      durationMs: duration * 1e3,
      duration,
      externalUrl: `https://www.youtube.com/watch?v=${videoId}`,
      isPlayable: true,
      playbackStatus: "AVAILABLE",
      restrictionReason: null,
      spotifyIsPlayable: null,
      audioSource: "youtube",
      youtubeVideoId: videoId,
      coverGradient: generateCoverGradient2(videoId)
    };
  }
  /**
   * Searches YouTube Data API v3 for video results matching the query.
   */
  async searchTracks(query, maxResults = 10) {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const apiKey = this.getApiKey();
    if (!apiKey) {
      const err = new Error("YouTube API is not configured on the server. Please set YOUTUBE_API_KEY.");
      err.code = "YOUTUBE_NOT_CONFIGURED";
      err.statusCode = 503;
      throw err;
    }
    const cacheKey = `search:${trimmed.toLowerCase()}:${maxResults}`;
    const cached = searchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
    try {
      const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
      searchUrl.searchParams.set("part", "snippet");
      searchUrl.searchParams.set("type", "video");
      searchUrl.searchParams.set("maxResults", String(Math.min(maxResults, 20)));
      searchUrl.searchParams.set("q", trimmed);
      searchUrl.searchParams.set("key", apiKey);
      const searchRes = await fetch(searchUrl.toString(), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8e3)
      });
      if (!searchRes.ok) {
        const errorBody = await searchRes.text();
        let parsed;
        try {
          parsed = JSON.parse(errorBody);
        } catch {
        }
        const errorReason = parsed?.error?.errors?.[0]?.reason || parsed?.error?.message || errorBody;
        if (searchRes.status === 403 && (errorReason.includes("quota") || errorReason.includes("Quota"))) {
          const quotaErr = new Error("YouTube API quota exceeded. Please try again later.");
          quotaErr.code = "YOUTUBE_QUOTA_EXCEEDED";
          quotaErr.statusCode = 429;
          throw quotaErr;
        }
        const apiErr = new Error(`YouTube API request failed (${searchRes.status}): ${errorReason}`);
        apiErr.code = "YOUTUBE_API_ERROR";
        apiErr.statusCode = searchRes.status >= 400 && searchRes.status < 600 ? searchRes.status : 500;
        throw apiErr;
      }
      const searchData = await searchRes.json();
      const items = searchData.items || [];
      const videoIds = items.map((item) => item.id?.videoId).filter(Boolean);
      if (videoIds.length === 0) {
        searchCache.set(cacheKey, { data: [], expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
        return [];
      }
      const detailsUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
      detailsUrl.searchParams.set("part", "snippet,contentDetails");
      detailsUrl.searchParams.set("id", videoIds.join(","));
      detailsUrl.searchParams.set("key", apiKey);
      const detailsRes = await fetch(detailsUrl.toString(), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8e3)
      });
      const detailsMap = /* @__PURE__ */ new Map();
      if (detailsRes.ok) {
        const detailsData = await detailsRes.json();
        for (const v of detailsData.items || []) {
          const duration = parseIso8601Duration(v.contentDetails?.duration || "");
          const thumb = v.snippet?.thumbnails?.high?.url || v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url || null;
          detailsMap.set(v.id, {
            durationSeconds: duration,
            title: v.snippet?.title || "",
            channelTitle: v.snippet?.channelTitle || "",
            thumbnailUrl: thumb
          });
        }
      }
      const tracks = items.map((item) => {
        const vId = item.id?.videoId;
        if (!vId) return null;
        const details = detailsMap.get(vId);
        const title = details?.title || item.snippet?.title || "Unknown Title";
        const channel = details?.channelTitle || item.snippet?.channelTitle || "YouTube";
        const thumb = details?.thumbnailUrl || item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || null;
        const durationSec = details?.durationSeconds || 180;
        return this.normalizeVideoToTrack(vId, title, channel, thumb, durationSec);
      }).filter((t) => t !== null);
      searchCache.set(cacheKey, { data: tracks, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
      return tracks;
    } catch (err) {
      logger.warn("[YouTubeService] searchTracks exception", { error: err.message, code: err.code });
      throw err;
    }
  }
  /**
   * Finds the best matching YouTube video for a given song title and optional artist.
   * Useful when user clicks [YouTube] on a Spotify search result or playing track.
   */
  async findMatch(title, artist) {
    const cleanTitle = title.trim();
    if (!cleanTitle) return null;
    const cacheKey = `match:${cleanTitle.toLowerCase()}::${(artist || "").toLowerCase()}`;
    const cached = matchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
    const searchQuery = artist ? `${cleanTitle} ${artist}` : cleanTitle;
    const tracks = await this.searchTracks(searchQuery, 5);
    if (tracks.length === 0) {
      matchCache.set(cacheKey, { data: null, expiresAt: Date.now() + MATCH_CACHE_TTL_MS });
      return null;
    }
    const best = tracks[0];
    matchCache.set(cacheKey, { data: best, expiresAt: Date.now() + MATCH_CACHE_TTL_MS });
    return best;
  }
  /**
   * Fetches video metadata by video ID.
   */
  async getVideoById(videoId) {
    const cleanId = videoId.trim();
    if (!cleanId) return null;
    const cacheKey = `video:${cleanId}`;
    const cached = videoCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
    const apiKey = this.getApiKey();
    if (!apiKey) {
      const err = new Error("YouTube API is not configured on the server. Please set YOUTUBE_API_KEY.");
      err.code = "YOUTUBE_NOT_CONFIGURED";
      err.statusCode = 503;
      throw err;
    }
    try {
      const detailsUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
      detailsUrl.searchParams.set("part", "snippet,contentDetails");
      detailsUrl.searchParams.set("id", cleanId);
      detailsUrl.searchParams.set("key", apiKey);
      const res = await fetch(detailsUrl.toString(), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8e3)
      });
      if (!res.ok) {
        return null;
      }
      const data = await res.json();
      const item = data.items?.[0];
      if (!item) {
        return null;
      }
      const duration = parseIso8601Duration(item.contentDetails?.duration || "");
      const thumb = item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || null;
      const track = this.normalizeVideoToTrack(
        cleanId,
        item.snippet?.title || "Unknown Title",
        item.snippet?.channelTitle || "YouTube",
        thumb,
        duration
      );
      videoCache.set(cacheKey, { data: track, expiresAt: Date.now() + MATCH_CACHE_TTL_MS });
      return track;
    } catch (err) {
      logger.warn("[YouTubeService] getVideoById exception", { error: err.message, videoId });
      return null;
    }
  }
};
var youtubeService = new YouTubeService();

// server/youtube/youtubeRoutes.ts
var youtubeRouter = Router2();
youtubeRouter.get("/status", (_req, res) => {
  const configured = youtubeService.isConfigured();
  return res.json({
    configured,
    provider: "youtube",
    message: configured ? "YouTube API is configured." : "YOUTUBE_API_KEY is not set in environment."
  });
});
youtubeRouter.get("/search", spotifyRateLimiter, async (req, res) => {
  const query = req.query.q || "";
  if (!query.trim()) {
    return res.json({ tracks: [], configured: youtubeService.isConfigured() });
  }
  if (!youtubeService.isConfigured()) {
    return res.status(200).json({
      tracks: [],
      configured: false,
      error: "YouTube API is not configured on the server. Please set YOUTUBE_API_KEY in .env."
    });
  }
  try {
    const tracks = await youtubeService.searchTracks(query);
    return res.json({ tracks, configured: true });
  } catch (err) {
    const statusCode = typeof err.statusCode === "number" ? err.statusCode : 500;
    return res.status(statusCode).json({
      tracks: [],
      configured: true,
      error: err.message || "Failed to search YouTube tracks.",
      code: err.code || "YOUTUBE_SEARCH_FAILED"
    });
  }
});
youtubeRouter.post("/find-match", spotifyRateLimiter, async (req, res) => {
  const { title, artist } = req.body || {};
  if (!title || typeof title !== "string" || !title.trim()) {
    return res.status(400).json({ error: "Title is required to find YouTube match." });
  }
  if (!youtubeService.isConfigured()) {
    return res.status(200).json({
      track: null,
      videoId: null,
      configured: false,
      error: "YouTube API is not configured on the server. Please set YOUTUBE_API_KEY in .env."
    });
  }
  try {
    const track = await youtubeService.findMatch(title, artist);
    return res.json({
      track,
      videoId: track ? track.providerTrackId : null,
      configured: true
    });
  } catch (err) {
    const statusCode = typeof err.statusCode === "number" ? err.statusCode : 500;
    return res.status(statusCode).json({
      track: null,
      videoId: null,
      configured: true,
      error: err.message || "Failed to find YouTube match.",
      code: err.code || "YOUTUBE_MATCH_FAILED"
    });
  }
});
youtubeRouter.get("/video/:videoId", spotifyRateLimiter, async (req, res) => {
  const videoId = req.params.videoId;
  if (!videoId || !videoId.trim()) {
    return res.status(400).json({ error: "Video ID is required." });
  }
  if (!youtubeService.isConfigured()) {
    return res.status(200).json({
      track: null,
      configured: false,
      error: "YouTube API is not configured on the server. Please set YOUTUBE_API_KEY in .env."
    });
  }
  try {
    const track = await youtubeService.getVideoById(videoId);
    if (!track) {
      return res.status(404).json({ error: "YouTube video not found." });
    }
    return res.json({ track, configured: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to retrieve YouTube video." });
  }
});

// server/playlists/playlistRoutes.ts
import { Router as Router3 } from "express";

// server/auth/persistentUserAuth.ts
import crypto4 from "crypto";
async function resolveUserFromRequest(req) {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.substring(7).trim() : null;
  const customUserToken = req.headers["x-user-token"]?.trim() || req.query.userToken?.trim();
  const rawToken = customUserToken || (bearerToken?.startsWith("syncroom_usr_") ? bearerToken : null);
  if (rawToken && rawToken.length >= 16) {
    try {
      const tokenHash = hashSessionToken(rawToken);
      let user = await prisma.user.findUnique({
        where: { tokenHash }
      });
      if (user) {
        return user;
      }
      const clientName = req.headers["x-user-name"]?.trim() || "SyncRoom User";
      const userId = `usr_${Date.now()}_${crypto4.randomBytes(6).toString("hex")}`;
      user = await prisma.user.create({
        data: {
          id: userId,
          name: clientName,
          tokenHash
        }
      });
      logger.info("[SyncRoom Auth] Created new persistent user in PostgreSQL", { userId: user.id });
      return user;
    } catch (err) {
      logger.error("[SyncRoom Auth] Error resolving user by token hash", err);
    }
  }
  const sessionToken = req.headers["x-session-token"]?.trim() || (bearerToken?.startsWith("syncroom_session_") ? bearerToken : null);
  if (sessionToken && sessionToken.startsWith("syncroom_session_")) {
    try {
      const sessionTokenHash = hashSessionToken(sessionToken);
      const session = await prisma.deviceSession.findUnique({
        where: { sessionTokenHash },
        include: { user: true }
      });
      if (session && session.user) {
        return session.user;
      }
    } catch (err) {
      logger.error("[SyncRoom Auth] Error resolving user via device session", err);
    }
  }
  return null;
}
async function requirePersistentUser(req, res, next) {
  try {
    const user = await resolveUserFromRequest(req);
    if (!user) {
      return res.status(401).json({
        error: "Authentication required. Missing or invalid persistent user token.",
        status: "UNAUTHORIZED"
      });
    }
    req.user = user;
    next();
  } catch (err) {
    logger.error("[SyncRoom Auth] Middleware error", err);
    return res.status(500).json({
      error: "Authentication processing failure.",
      status: "AUTH_ERROR"
    });
  }
}

// server/playlists/playlistRoutes.ts
var playlistRouter = Router3();
playlistRouter.use(requirePersistentUser);
playlistRouter.post("/", async (req, res) => {
  const { name, description } = req.body || {};
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Playlist name is required.", status: "INVALID_NAME" });
  }
  const userId = req.user.id;
  try {
    const playlist = await dbRepository.createCustomPlaylist(userId, name.trim(), description);
    return res.status(201).json({ success: true, playlist });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to create playlist.", status: "INTERNAL_ERROR" });
  }
});
playlistRouter.get("/", async (req, res) => {
  const userId = req.user.id;
  try {
    const playlists = await dbRepository.getUserCustomPlaylists(userId);
    return res.json({ success: true, playlists, total: playlists.length });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to fetch playlists.", status: "INTERNAL_ERROR" });
  }
});
playlistRouter.get("/:playlistId", async (req, res) => {
  const { playlistId } = req.params;
  const userId = req.user.id;
  try {
    const playlist = await dbRepository.getCustomPlaylistById(playlistId);
    if (!playlist) {
      return res.status(404).json({ error: "Playlist not found.", status: "PLAYLIST_NOT_FOUND" });
    }
    if (playlist.ownerId !== userId) {
      return res.status(403).json({ error: "Access denied: You do not own this playlist.", status: "FORBIDDEN" });
    }
    return res.json({ success: true, playlist });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to fetch playlist.", status: "INTERNAL_ERROR" });
  }
});
playlistRouter.patch("/:playlistId", async (req, res) => {
  const { playlistId } = req.params;
  const { name, description } = req.body || {};
  const userId = req.user.id;
  try {
    const existing = await dbRepository.getCustomPlaylistById(playlistId);
    if (!existing) {
      return res.status(404).json({ error: "Playlist not found.", status: "PLAYLIST_NOT_FOUND" });
    }
    if (existing.ownerId !== userId) {
      return res.status(403).json({ error: "Access denied: You do not own this playlist.", status: "FORBIDDEN" });
    }
    if (name !== void 0 && (!name || typeof name !== "string" || !name.trim())) {
      return res.status(400).json({ error: "Playlist name cannot be empty.", status: "INVALID_NAME" });
    }
    const updated = await dbRepository.updateCustomPlaylist(playlistId, { name, description });
    return res.json({ success: true, playlist: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to update playlist.", status: "INTERNAL_ERROR" });
  }
});
playlistRouter.delete("/:playlistId", async (req, res) => {
  const { playlistId } = req.params;
  const userId = req.user.id;
  try {
    const existing = await dbRepository.getCustomPlaylistById(playlistId);
    if (!existing) {
      return res.status(404).json({ error: "Playlist not found.", status: "PLAYLIST_NOT_FOUND" });
    }
    if (existing.ownerId !== userId) {
      return res.status(403).json({ error: "Access denied: You do not own this playlist.", status: "FORBIDDEN" });
    }
    await dbRepository.deleteCustomPlaylist(playlistId);
    return res.json({ success: true, message: "Playlist deleted successfully." });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to delete playlist.", status: "INTERNAL_ERROR" });
  }
});
playlistRouter.post("/:playlistId/tracks", async (req, res) => {
  const { playlistId } = req.params;
  const userId = req.user.id;
  try {
    const existing = await dbRepository.getCustomPlaylistById(playlistId);
    if (!existing) {
      return res.status(404).json({ error: "Playlist not found.", status: "PLAYLIST_NOT_FOUND" });
    }
    if (existing.ownerId !== userId) {
      return res.status(403).json({ error: "Access denied: You do not own this playlist.", status: "FORBIDDEN" });
    }
    let trackToAdd = null;
    if (req.body?.track && req.body.track.providerTrackId) {
      trackToAdd = req.body.track;
    } else if (req.body?.spotifyTrackUrlOrId || req.body?.urlOrId || req.body?.url) {
      const urlOrId = req.body.spotifyTrackUrlOrId || req.body.urlOrId || req.body.url;
      const { trackId, error: parseError } = parseSpotifyTrackId(urlOrId);
      if (!trackId) {
        return res.status(400).json({
          error: parseError || "Invalid Spotify track URL or ID format.",
          status: "INVALID_TRACK_ID"
        });
      }
      const activeSession = req.headers["x-session-id"] || "default-session";
      let token = await getValidAccessToken(activeSession);
      if (!token) {
        token = await getClientCredentialsToken();
      }
      if (!token) {
        return res.status(503).json({
          error: "Spotify service is currently unavailable. Please connect your Spotify account.",
          status: "SPOTIFY_UNAVAILABLE"
        });
      }
      try {
        trackToAdd = await fetchSpotifyTrack(trackId, token);
      } catch (spotifyErr) {
        if (spotifyErr instanceof SpotifyPlaylistError) {
          return res.status(spotifyErr.statusCode || 400).json({
            error: spotifyErr.message,
            status: spotifyErr.code
          });
        }
        throw spotifyErr;
      }
    } else {
      return res.status(400).json({
        error: "Either a valid Spotify URL/ID or a track object must be provided.",
        status: "INVALID_REQUEST"
      });
    }
    if (!trackToAdd) {
      return res.status(400).json({ error: "Unable to resolve track metadata.", status: "TRACK_NOT_FOUND" });
    }
    const createdTrack = await dbRepository.addTrackToCustomPlaylist(playlistId, trackToAdd);
    return res.status(201).json({
      success: true,
      track: createdTrack,
      message: `Track "${trackToAdd.title}" added to playlist.`
    });
  } catch (err) {
    if (err.code === "DUPLICATE_TRACK") {
      return res.status(409).json({
        error: "This track is already in the playlist.",
        status: "DUPLICATE_TRACK"
      });
    }
    return res.status(500).json({ error: err.message || "Failed to add track to playlist.", status: "INTERNAL_ERROR" });
  }
});
playlistRouter.delete("/:playlistId/tracks/:trackId", async (req, res) => {
  const { playlistId, trackId } = req.params;
  const userId = req.user.id;
  try {
    const existing = await dbRepository.getCustomPlaylistById(playlistId);
    if (!existing) {
      return res.status(404).json({ error: "Playlist not found.", status: "PLAYLIST_NOT_FOUND" });
    }
    if (existing.ownerId !== userId) {
      return res.status(403).json({ error: "Access denied: You do not own this playlist.", status: "FORBIDDEN" });
    }
    await dbRepository.removeTrackFromCustomPlaylist(playlistId, trackId);
    return res.json({ success: true, message: "Track removed from playlist." });
  } catch (err) {
    if (err.code === "TRACK_NOT_FOUND") {
      return res.status(404).json({ error: "Track not found in playlist.", status: "TRACK_NOT_FOUND" });
    }
    return res.status(500).json({ error: err.message || "Failed to remove track.", status: "INTERNAL_ERROR" });
  }
});
playlistRouter.put("/:playlistId/tracks/reorder", async (req, res) => {
  const { playlistId } = req.params;
  const { trackIds } = req.body || {};
  const userId = req.user.id;
  if (!Array.isArray(trackIds)) {
    return res.status(400).json({ error: "trackIds array is required.", status: "INVALID_REQUEST" });
  }
  try {
    const existing = await dbRepository.getCustomPlaylistById(playlistId);
    if (!existing) {
      return res.status(404).json({ error: "Playlist not found.", status: "PLAYLIST_NOT_FOUND" });
    }
    if (existing.ownerId !== userId) {
      return res.status(403).json({ error: "Access denied: You do not own this playlist.", status: "FORBIDDEN" });
    }
    await dbRepository.reorderCustomPlaylistTracks(playlistId, trackIds);
    return res.json({ success: true, message: "Playlist tracks reordered successfully." });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to reorder playlist.", status: "INTERNAL_ERROR" });
  }
});
async function handleLoadPlaylistIntoRoomQueue(req, res) {
  const { roomId, playlistId } = req.params;
  const replace = Boolean(req.body?.replaceQueue);
  const user = await resolveUserFromRequest(req);
  const roomUserId = req.headers["x-user-id"]?.trim() || "";
  const sessionToken = req.headers["x-session-token"]?.trim() || req.headers["x-session-id"]?.trim() || "";
  const liveRoom = roomManager.getRoom(roomId);
  if (!liveRoom) {
    return res.status(404).json({ error: "Room not found.", status: "ROOM_NOT_FOUND" });
  }
  const memSession = sessionToken ? roomManager.getSession(sessionToken) : void 0;
  const effectiveUserId = memSession?.userId || roomUserId || user?.id || "";
  const roomUser = liveRoom.getUser(effectiveUserId) || (sessionToken ? Array.from(liveRoom.users.values()).find((u) => u.sessionId === sessionToken) : void 0);
  const isRoomAdmin = memSession && memSession.roomId === roomId && memSession.role === "admin" || roomUser && roomUser.role === "admin" || liveRoom.adminId === effectiveUserId || roomUserId && liveRoom.adminId === roomUserId;
  if (!isRoomAdmin) {
    return res.status(403).json({
      error: "Forbidden: Only the room host can load playlists into the room queue.",
      status: "FORBIDDEN"
    });
  }
  try {
    const playlist = await dbRepository.getCustomPlaylistById(playlistId);
    if (!playlist) {
      return res.status(404).json({ error: "Playlist not found.", status: "PLAYLIST_NOT_FOUND" });
    }
    if (playlist.tracks.length === 0) {
      return res.status(400).json({ error: "This playlist is empty (0 tracks).", status: "EMPTY_PLAYLIST" });
    }
    const userObj = roomUser || {
      id: effectiveUserId || liveRoom.adminId || "admin",
      name: memSession?.name || user?.name || "Admin",
      role: "admin",
      roomId,
      connected: true,
      lastSeen: Date.now(),
      sessionId: sessionToken || ""
    };
    await roomManager.runRoomCommand(roomId, () => {
      liveRoom.importQueue(playlist.tracks, userObj, replace);
      roomManager.broadcastPlaybackState(liveRoom);
      roomManager.broadcastQueue(liveRoom);
    });
    return res.json({
      success: true,
      count: playlist.tracks.length,
      message: `Imported ${playlist.tracks.length} tracks into room queue.`
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to load playlist into room queue.", status: "INTERNAL_ERROR" });
  }
}

// server/auth/userRoutes.ts
import { Router as Router4 } from "express";
var userRouter = Router4();
userRouter.get("/me", requirePersistentUser, async (req, res) => {
  const user = req.user;
  return res.json({
    success: true,
    user: {
      id: user.id,
      name: user.name,
      createdAt: user.createdAt
    }
  });
});
userRouter.patch("/me", requirePersistentUser, async (req, res) => {
  const user = req.user;
  const { name } = req.body || {};
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Name must be a non-empty string.", status: "INVALID_NAME" });
  }
  try {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { name: name.trim() }
    });
    return res.json({
      success: true,
      user: {
        id: updated.id,
        name: updated.name,
        createdAt: updated.createdAt
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to update user profile." });
  }
});

// server/rooms/roomRoutes.ts
import { Router as Router5 } from "express";
import { performance as performance3 } from "perf_hooks";
var roomRouter = Router5();
roomRouter.post("/", async (req, res) => {
  const tStart = performance3.now();
  const clientIp = req.ip || req.socket.remoteAddress || "127.0.0.1";
  logger.info(`[ROOM_CREATE] server_request_start method=POST path=/api/rooms ip=${clientIp}`);
  const tAuthStart = performance3.now();
  if (!rateLimiter.checkLimit(`create_${clientIp}`, 10, 6e4)) {
    return res.status(429).json({
      error: "Too many room creations. Please slow down.",
      code: "RATE_LIMITED"
    });
  }
  const authDurationMs = Math.round(performance3.now() - tAuthStart);
  const { name, adminName, device } = req.body || {};
  const trimmedName = typeof name === "string" ? name.trim() : "";
  const trimmedAdmin = typeof adminName === "string" ? adminName.trim() : "";
  if (!trimmedName || !trimmedAdmin) {
    return res.status(400).json({
      error: "Room name and admin name are required",
      code: "INVALID_INPUT"
    });
  }
  try {
    const tDbStart = performance3.now();
    const { room, user, sessionId, sessionToken } = await roomManager.createRoom(
      trimmedName,
      trimmedAdmin,
      void 0,
      // WebSocket connection will be established asynchronously by client
      device
    );
    const dbDurationMs = Math.round(performance3.now() - tDbStart);
    const clientState = room.toClientState(user.id);
    const clientUser = {
      id: user.id,
      name: user.name,
      role: user.role,
      joinedAt: user.lastSeen,
      isOnline: true,
      isSelf: true,
      device: user.device,
      driftMs: user.driftMs
    };
    const totalDurationMs = Math.round(performance3.now() - tStart);
    res.setHeader("Server-Timing", `total;dur=${totalDurationMs}, db;dur=${dbDurationMs}, auth;dur=${authDurationMs}`);
    logger.info(
      `[CREATE_ROOM] total=${totalDurationMs}ms auth=${authDurationMs}ms db=${dbDurationMs}ms roomId=${room.id} code=${room.code}`
    );
    logger.info(`[ROOM_CREATE] response_sent durationMs=${totalDurationMs} roomId=${room.id}`);
    return res.status(201).json({
      success: true,
      room: clientState,
      user: clientUser,
      sessionId,
      sessionToken,
      durationMs: totalDurationMs
    });
  } catch (err) {
    const totalDurationMs = Math.round(performance3.now() - tStart);
    const errMsg = err?.message || "";
    logger.error(`[ROOM_CREATE] error durationMs=${totalDurationMs} error=${errMsg}`, err);
    if (errMsg.includes("DATABASE_NOT_CONFIGURED")) {
      return res.status(503).json({
        error: "PostgreSQL database is not configured. Set DATABASE_URL to enable persistence.",
        code: "DATABASE_NOT_CONFIGURED"
      });
    }
    return res.status(500).json({
      error: "Failed to create room in database",
      code: "INTERNAL_ERROR"
    });
  }
});
roomRouter.get("/:roomId", (req, res) => {
  const room = roomManager.getRoom(req.params.roomId);
  if (!room) {
    return res.status(404).json({ error: "Room not found", code: "ROOM_NOT_FOUND" });
  }
  return res.status(200).json({ success: true, room: room.toClientState() });
});
roomRouter.get("/code/:code", (req, res) => {
  const room = roomManager.getRoom(req.params.code);
  if (!room) {
    return res.status(404).json({ error: "Room not found", code: "ROOM_NOT_FOUND" });
  }
  return res.status(200).json({
    success: true,
    room: {
      id: room.id,
      code: room.code,
      name: room.name,
      memberCount: room.users.size
    }
  });
});

// server/utils/securityHeaders.ts
var isProduction3 = process.env.NODE_ENV === "production";
function securityHeadersMiddleware(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-XSS-Protection", "0");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), encrypted-media=*, autoplay=*"
  );
  const isHttps = req.secure || req.get("x-forwarded-proto") === "https";
  if (isHttps || isProduction3) {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload"
    );
  }
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://sdk.scdn.co",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https://*.scdn.co https://*.spotifycdn.com https://i.scdn.co https://mosaic.scdn.co https://images.unsplash.com",
    "media-src 'self' data: blob: https: https://*.scdn.co https://*.spotifycdn.com",
    "connect-src 'self' ws: wss: https://*.spotify.com https://*.scdn.co https://api.spotify.com https://accounts.spotify.com wss://*.spotify.com wss://*.dealer.spotify.com https://*.spotifycdn.com",
    "frame-src 'self' https://sdk.scdn.co https://accounts.spotify.com https://open.spotify.com",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'"
  ];
  res.setHeader("Content-Security-Policy", cspDirectives.join("; "));
  next();
}

// server/config/envValidation.ts
function validateStartupEnv() {
  const nodeEnv = (process.env.NODE_ENV || "development").toLowerCase();
  const isProduction4 = nodeEnv === "production";
  const rawPort = process.env.PORT || "3000";
  const port = parseInt(rawPort, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    const errorMsg = `[SyncRoom Config] Invalid PORT environment variable: "${rawPort}". Must be a number between 1 and 65535.`;
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }
  const rawOrigins = process.env.CLIENT_ORIGIN || process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || "";
  const allowedOrigins = rawOrigins.split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
  if (isProduction4) {
    if (allowedOrigins.length === 0) {
      logger.warn(
        "[SyncRoom Config] No CLIENT_ORIGIN or ALLOWED_ORIGINS configured. Same-origin requests only will be accepted for CORS in production."
      );
    } else {
      const insecure = allowedOrigins.filter(
        (o) => o.startsWith("http://") && !o.includes("localhost") && !o.includes("127.0.0.1")
      );
      if (insecure.length > 0) {
        logger.warn(
          `[SyncRoom Config] Insecure HTTP origin configured in production: ${insecure.join(", ")}. Recommend HTTPS for all production clients.`
        );
      }
    }
  }
  const spotifyClientId = process.env.SPOTIFY_CLIENT_ID?.trim();
  const spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  let spotifyConfigured = false;
  if (spotifyClientId && spotifyClientSecret) {
    spotifyConfigured = true;
    logger.info("[SyncRoom Config] Spotify OAuth credentials detected and configured.");
  } else if (spotifyClientId || spotifyClientSecret) {
    logger.warn(
      "[SyncRoom Config] Partial Spotify configuration detected. Both SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are required. Spotify features will remain disabled."
    );
  } else {
    logger.info(
      "[SyncRoom Config] Spotify integration is unconfigured. Client requests will receive authentic unconfigured status."
    );
  }
  const youtubeApiKey = process.env.YOUTUBE_API_KEY?.trim();
  const youtubeConfigured = Boolean(youtubeApiKey);
  if (youtubeConfigured) {
    logger.info("[SyncRoom Config] YouTube Data API key detected and configured.");
  } else {
    logger.info("[SyncRoom Config] YouTube Data API is unconfigured.");
  }
  const hasDbUrl = Boolean(process.env.DATABASE_URL?.trim());
  const databaseConfigured = hasDbUrl;
  if (databaseConfigured) {
    logger.info("[SyncRoom Config] PostgreSQL configuration detected in environment (DATABASE_URL is set).");
  } else {
    logger.warn(
      "[SyncRoom Config] PostgreSQL not configured (DATABASE_URL unset). Persistent storage requires DATABASE_URL."
    );
  }
  const rawSessionDays = process.env.SESSION_MAX_AGE_DAYS || "7";
  const sessionMaxAgeDays = parseInt(rawSessionDays, 10);
  if (isNaN(sessionMaxAgeDays) || sessionMaxAgeDays < 1) {
    logger.warn(
      `[SyncRoom Config] Invalid SESSION_MAX_AGE_DAYS: "${rawSessionDays}". Defaulting to 7 days.`
    );
  }
  const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10);
  const max = parseInt(process.env.RATE_LIMIT_MAX || "100", 10);
  const authMax = parseInt(process.env.RATE_LIMIT_AUTH_MAX || "30", 10);
  const spotifyMax = parseInt(process.env.RATE_LIMIT_SPOTIFY_MAX || "40", 10);
  const rateLimit = {
    windowMs: isNaN(windowMs) || windowMs < 1e3 ? 6e4 : windowMs,
    max: isNaN(max) || max < 1 ? 100 : max,
    authMax: isNaN(authMax) || authMax < 1 ? 30 : authMax,
    spotifyMax: isNaN(spotifyMax) || spotifyMax < 1 ? 40 : spotifyMax
  };
  logger.info("[SyncRoom Config] Environment validation complete.", {
    environment: nodeEnv,
    port,
    allowedOriginsCount: allowedOrigins.length,
    spotifyConfigured,
    youtubeConfigured,
    databaseConfigured
  });
  return {
    nodeEnv,
    isProduction: isProduction4,
    port: isNaN(port) ? 3e3 : port,
    allowedOrigins,
    sessionMaxAgeDays: isNaN(sessionMaxAgeDays) ? 7 : sessionMaxAgeDays,
    spotifyConfigured,
    youtubeConfigured,
    databaseConfigured,
    rateLimit
  };
}

// server/index.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = path2.dirname(__filename);
async function startServer() {
  const validatedEnv = validateStartupEnv();
  const isProduction4 = validatedEnv.isProduction;
  const PORT = validatedEnv.port;
  const app = express();
  const server = createServer(app);
  let isShuttingDown = false;
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: 64 * 1024
    // 64 KB message size limit
  });
  setupWebSocketServer(wss, () => isShuttingDown);
  app.use(corsMiddleware);
  app.use(securityHeadersMiddleware);
  app.use(requestLogger);
  app.use(express.json({ limit: "2mb" }));
  app.use((_req, res, next) => {
    if (isShuttingDown) {
      res.setHeader("Connection", "close");
      return res.status(503).json({ error: "Server is currently undergoing graceful shutdown." });
    }
    next();
  });
  const handleHealth = (_req, res) => {
    res.status(200).json({
      status: "ok",
      service: "syncroom",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      activeConnections: wss.clients.size
    });
  };
  app.get("/health", handleHealth);
  app.get("/api/health", handleHealth);
  const handleReady = async (_req, res) => {
    if (isShuttingDown) {
      return res.status(503).json({
        status: "unhealthy",
        service: "syncroom",
        message: "Server is shutting down"
      });
    }
    if (validatedEnv.databaseConfigured) {
      const dbCheck = await checkDatabaseConnection();
      if (dbCheck.isHealthy) {
        return res.status(200).json({
          status: "ready",
          service: "syncroom",
          application: "healthy",
          trafficReady: true,
          mode: "database_backed",
          dependencies: {
            database: {
              configured: true,
              status: "connected",
              latencyMs: dbCheck.latencyMs
            },
            spotify: {
              configured: validatedEnv.spotifyConfigured,
              status: validatedEnv.spotifyConfigured ? "available" : "unconfigured"
            },
            youtube: {
              configured: validatedEnv.youtubeConfigured,
              status: validatedEnv.youtubeConfigured ? "available" : "unconfigured"
            }
          },
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      } else {
        return res.status(503).json({
          status: "unhealthy",
          service: "syncroom",
          application: "healthy",
          trafficReady: false,
          mode: "database_backed",
          dependencies: {
            database: {
              configured: true,
              status: "unreachable",
              error: dbCheck.error,
              latencyMs: dbCheck.latencyMs
            },
            spotify: {
              configured: validatedEnv.spotifyConfigured,
              status: validatedEnv.spotifyConfigured ? "available" : "unconfigured"
            },
            youtube: {
              configured: validatedEnv.youtubeConfigured,
              status: validatedEnv.youtubeConfigured ? "available" : "unconfigured"
            }
          },
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
    }
    return res.status(503).json({
      status: "unhealthy",
      service: "syncroom",
      application: "healthy",
      trafficReady: false,
      mode: "database_required",
      dependencies: {
        database: {
          configured: false,
          status: "not_configured",
          error: "PostgreSQL database connection is required for persistent traffic. Please set DATABASE_URL in environment."
        },
        spotify: {
          configured: validatedEnv.spotifyConfigured,
          status: validatedEnv.spotifyConfigured ? "available" : "unconfigured"
        },
        youtube: {
          configured: validatedEnv.youtubeConfigured,
          status: validatedEnv.youtubeConfigured ? "available" : "unconfigured"
        }
      },
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  };
  app.get("/ready", handleReady);
  app.get("/api/ready", handleReady);
  app.use("/api/spotify", spotifyRouter);
  app.use("/api/youtube", youtubeRouter);
  app.use("/api/user", userRouter);
  app.use("/api/rooms", roomRouter);
  app.use("/api/playlists", playlistRouter);
  app.post("/api/rooms/:roomId/queue/from-playlist/:playlistId", handleLoadPlaylistIntoRoomQueue);
  if (!isProduction4) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path2.resolve(process.cwd(), "dist");
    const assetsPath = path2.join(distPath, "assets");
    app.use("/assets", express.static(assetsPath, { maxAge: "1y", immutable: true }));
    app.use(express.static(distPath, { maxAge: 0 }));
    app.get("*", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.sendFile(path2.resolve(distPath, "index.html"));
    });
  }
  app.use(
    (err, req, res, _next) => {
      const correlationId = req.correlationId;
      logger.error(`Unhandled error during ${req.method} ${req.path}`, err, { correlationId });
      const statusCode = typeof err?.statusCode === "number" && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
      if (isProduction4) {
        res.status(statusCode).json({
          error: statusCode === 404 ? "Resource not found" : "An internal error occurred. Please try again.",
          correlationId
        });
      } else {
        res.status(statusCode).json({
          error: err?.message || "Internal server error",
          stack: err?.stack,
          correlationId
        });
      }
    }
  );
  const gracefulShutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info(`[SyncRoom Server] Received ${signal}. Initiating graceful shutdown...`);
    const forceExitTimer = setTimeout(() => {
      logger.error("[SyncRoom Server] Forced process exit after shutdown timeout");
      process.exit(1);
    }, 5e3);
    forceExitTimer.unref();
    try {
      roomManager.shutdown();
      rateLimiter.destroy();
      await new Promise((resolve) => {
        wss.close((err) => {
          if (err) logger.warn("[SyncRoom Server] Error closing WebSocket server", { error: err.message });
          resolve();
        });
      });
      await new Promise((resolve) => {
        server.close((err) => {
          if (err) logger.warn("[SyncRoom Server] Error closing HTTP server", { error: err.message });
          resolve();
        });
      });
      await closePrisma();
      logger.info("[SyncRoom Server] Graceful shutdown completed. Exiting cleanly.");
      process.exit(0);
    } catch (err) {
      logger.error("[SyncRoom Server] Error encountered during graceful shutdown", err);
      process.exit(1);
    }
  };
  process.once("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.once("SIGINT", () => gracefulShutdown("SIGINT"));
  server.listen(PORT, "0.0.0.0", () => {
    logger.info(`[SyncRoom Server] Full-stack engine running on http://0.0.0.0:${PORT}`, {
      environment: validatedEnv.nodeEnv,
      port: PORT,
      databaseConfigured: validatedEnv.databaseConfigured,
      spotifyConfigured: validatedEnv.spotifyConfigured,
      youtubeConfigured: validatedEnv.youtubeConfigured
    });
    if (validatedEnv.databaseConfigured) {
      roomManager.initializeFromDatabase().then((count) => {
        if (count > 0) {
          logger.info(`[SyncRoom Recovery] Restored ${count} active room(s) from PostgreSQL.`);
        }
      }).catch((err) => {
        logger.warn("[SyncRoom Recovery] Database recovery notice", { error: err.message });
      });
    }
    try {
      if (process.env.SPOTIFY_REDIRECT_URI) {
        const redirectUrl = new URL(process.env.SPOTIFY_REDIRECT_URI);
        const redirectPort = redirectUrl.port ? parseInt(redirectUrl.port, 10) : null;
        if (redirectPort && redirectPort !== PORT) {
          const auxServer = createServer(app);
          auxServer.listen(redirectPort, "0.0.0.0", () => {
            logger.info(`[SyncRoom Server] Auxiliary Spotify callback listener active on port ${redirectPort}`);
          });
        }
      }
    } catch {
    }
  });
  return { app, server, wss, gracefulShutdown };
}

// server.ts
process.on("unhandledRejection", (reason) => {
  console.warn("[SyncRoom Server] Unhandled Rejection (handled safely):", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[SyncRoom Server] Uncaught Exception (handled safely):", err);
});
startServer().catch((err) => {
  console.error("[SyncRoom Server] Failed to start server:", err);
  process.exit(1);
});
