import { pgTable, text, timestamp, boolean, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// 1. Users table
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 2. Rooms table
export const rooms = pgTable('rooms', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  adminUserId: text('admin_user_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  lastActiveAt: timestamp('last_active_at').defaultNow().notNull(),
  status: text('status').notNull().default('ACTIVE'), // ACTIVE | ENDED
}, (table) => [
  uniqueIndex('rooms_code_idx').on(table.code),
  index('rooms_status_idx').on(table.status),
]);

// 3. Device Sessions table
export const deviceSessions = pgTable('device_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roomId: text('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  sessionTokenHash: text('session_token_hash').notNull().unique(),
  role: text('role').notNull().default('LISTENER'), // ADMIN | LISTENER
  createdAt: timestamp('created_at').defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at'),
  revokedAt: timestamp('revoked_at'),
  userAgent: text('user_agent'),
  deviceName: text('device_name'),
}, (table) => [
  uniqueIndex('device_sessions_token_hash_idx').on(table.sessionTokenHash),
  index('device_sessions_user_id_idx').on(table.userId),
  index('device_sessions_room_id_idx').on(table.roomId),
]);

// 4. Room Members table
export const roomMembers = pgTable('room_members', {
  id: text('id').primaryKey(),
  roomId: text('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('LISTENER'), // ADMIN | LISTENER
  joinedAt: timestamp('joined_at').defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
  isActive: boolean('is_active').default(true).notNull(),
}, (table) => [
  index('room_members_room_id_idx').on(table.roomId),
  index('room_members_user_id_idx').on(table.userId),
]);

// 5. Tracks table
export const tracks = pgTable('tracks', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull().default('spotify'), // spotify | local | licensed
  providerTrackId: text('provider_track_id').notNull(),
  title: text('title').notNull(),
  artist: text('artist').notNull(),
  artists: text('artists').notNull(), // JSON array string
  album: text('album').notNull(),
  albumArtUrl: text('album_art_url'),
  durationMs: integer('duration_ms').notNull(),
  externalUrl: text('external_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('tracks_provider_idx').on(table.provider, table.providerTrackId),
]);

// 6. Imported Playlists table
export const importedPlaylists = pgTable('imported_playlists', {
  id: text('id').primaryKey(),
  roomId: text('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull().default('spotify'),
  providerPlaylistId: text('provider_playlist_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  imageUrl: text('image_url'),
  trackCount: integer('track_count').default(0).notNull(),
  importedAt: timestamp('imported_at').defaultNow().notNull(),
}, (table) => [
  index('imported_playlists_room_id_idx').on(table.roomId),
]);

// 7. Queue Items table
export const queueItems = pgTable('queue_items', {
  id: text('id').primaryKey(),
  roomId: text('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  trackId: text('track_id').notNull().references(() => tracks.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  addedAt: timestamp('added_at').defaultNow().notNull(),
  addedBy: text('added_by').notNull(), // JSON string { id, name, role }
}, (table) => [
  index('queue_items_room_id_idx').on(table.roomId),
  index('queue_items_position_idx').on(table.roomId, table.position),
]);

// 8. Playback States table
export const playbackStates = pgTable('playback_states', {
  roomId: text('room_id').primaryKey().references(() => rooms.id, { onDelete: 'cascade' }),
  trackId: text('track_id').references(() => tracks.id, { onDelete: 'set null' }),
  isPlaying: boolean('is_playing').default(false).notNull(),
  positionMs: integer('position_ms').default(0).notNull(),
  startedAt: timestamp('started_at'),
  version: integer('version').default(1).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('playback_states_room_id_idx').on(table.roomId),
]);

// 9. Room Activities (Audit Log) table
export const roomActivities = pgTable('room_activities', {
  id: text('id').primaryKey(),
  roomId: text('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  userId: text('user_id'),
  action: text('action').notNull(),
  metadata: text('metadata'), // JSON metadata string
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('room_activities_room_id_idx').on(table.roomId),
  index('room_activities_room_id_created_at_idx').on(table.roomId, table.createdAt),
]);

// Relationships
export const usersRelations = relations(users, ({ many }) => ({
  deviceSessions: many(deviceSessions),
  roomMembers: many(roomMembers),
  adminRooms: many(rooms),
}));

export const roomsRelations = relations(rooms, ({ one, many }) => ({
  adminUser: one(users, {
    fields: [rooms.adminUserId],
    references: [users.id],
  }),
  deviceSessions: many(deviceSessions),
  members: many(roomMembers),
  queueItems: many(queueItems),
  importedPlaylists: many(importedPlaylists),
  activities: many(roomActivities),
  playbackState: one(playbackStates, {
    fields: [rooms.id],
    references: [playbackStates.roomId],
  }),
}));

export const deviceSessionsRelations = relations(deviceSessions, ({ one }) => ({
  user: one(users, {
    fields: [deviceSessions.userId],
    references: [users.id],
  }),
  room: one(rooms, {
    fields: [deviceSessions.roomId],
    references: [rooms.id],
  }),
}));

export const roomMembersRelations = relations(roomMembers, ({ one }) => ({
  room: one(rooms, {
    fields: [roomMembers.roomId],
    references: [rooms.id],
  }),
  user: one(users, {
    fields: [roomMembers.userId],
    references: [users.id],
  }),
}));

export const tracksRelations = relations(tracks, ({ many }) => ({
  queueItems: many(queueItems),
  playbackStates: many(playbackStates),
}));

export const queueItemsRelations = relations(queueItems, ({ one }) => ({
  room: one(rooms, {
    fields: [queueItems.roomId],
    references: [rooms.id],
  }),
  track: one(tracks, {
    fields: [queueItems.trackId],
    references: [tracks.id],
  }),
}));

export const playbackStatesRelations = relations(playbackStates, ({ one }) => ({
  room: one(rooms, {
    fields: [playbackStates.roomId],
    references: [rooms.id],
  }),
  track: one(tracks, {
    fields: [playbackStates.trackId],
    references: [tracks.id],
  }),
}));
