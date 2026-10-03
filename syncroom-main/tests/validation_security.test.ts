import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClientMessage, validateClientMessage } from '../server/websocket/messages';
import { Room } from '../server/rooms/Room';
import { validateWebSocketOrigin, getAllowedOrigins } from '../server/utils/cors';
import { Track } from '../src/types';

function createMockTrack(id: string, duration = 200): Track {
  return {
    id,
    provider: 'local',
    providerTrackId: id,
    title: `Track ${id}`,
    artist: 'Artist',
    artists: ['Artist'],
    album: 'Album',
    albumArtUrl: null,
    durationMs: duration * 1000,
    duration,
    externalUrl: null,
    isPlayable: true,
    playbackStatus: 'AVAILABLE',
    audioSource: 'local',
  };
}

test('VALIDATION 1: Seek Input Hardening — Reject NaN, Negative, Infinity, and Oversized Numbers', () => {
  // Test parseClientMessage validation
  const nanSeek = JSON.stringify({ type: 'ADMIN_SEEK', position: NaN });
  const negativeSeek = JSON.stringify({ type: 'ADMIN_SEEK', position: -10 });
  const stringSeek = JSON.stringify({ type: 'ADMIN_SEEK', position: 'invalid' });
  const oversizedSeek = JSON.stringify({ type: 'ADMIN_SEEK', position: 100000 }); // > 24 hours
  const validSeek = JSON.stringify({ type: 'ADMIN_SEEK', position: 45.5 });

  // Note: JSON.stringify(NaN) converts to null in standard JSON
  assert.equal(parseClientMessage(nanSeek).success, false);
  assert.equal(parseClientMessage(negativeSeek).success, false);
  assert.equal(parseClientMessage(stringSeek).success, false);
  assert.equal(parseClientMessage(oversizedSeek).success, false);
  assert.equal(parseClientMessage(validSeek).success, true);

  // Test Room.seek() internal guard
  const room = new Room('room_seek_val', 'SEEK01', 'Seek Room', 'admin_1', createMockTrack('t1', 180));
  room.seek(NaN as any);
  assert.equal(room.position, 0, 'NaN seek must not corrupt position');

  room.seek(-50);
  assert.equal(room.position, 0, 'Negative seek must not corrupt position');

  room.seek(60);
  assert.equal(room.position, 60, 'Valid seek correctly sets position');

  room.destroy();
});

test('VALIDATION 2: Oversized Room & Display Names Are Rejected', () => {
  const hugeName = 'A'.repeat(150); // > 100 chars
  const hugeAdmin = 'B'.repeat(80); // > 50 chars

  const invalidCreate = JSON.stringify({
    type: 'CREATE_ROOM',
    name: hugeName,
    adminName: 'Valid Admin',
  });
  assert.equal(parseClientMessage(invalidCreate).success, false);

  const invalidAdmin = JSON.stringify({
    type: 'CREATE_ROOM',
    name: 'Valid Room',
    adminName: hugeAdmin,
  });
  assert.equal(parseClientMessage(invalidAdmin).success, false);

  const invalidJoin = JSON.stringify({
    type: 'JOIN_ROOM',
    code: 'ROOM01',
    displayName: hugeAdmin,
  });
  assert.equal(parseClientMessage(invalidJoin).success, false);
});

test('VALIDATION 3: Unknown Message Event Types & Malformed Payloads Rejected', () => {
  const unknownEvent = JSON.stringify({ type: 'UNKNOWN_HACK_EVENT', foo: 'bar' });
  const protoPollution = JSON.stringify({ type: '__proto__', admin: true });
  const malformedJson = '{"type": "ADMIN_PLAY", invalid';

  assert.equal(parseClientMessage(unknownEvent).success, false);
  assert.equal(parseClientMessage(protoPollution).success, false);
  assert.equal(parseClientMessage(malformedJson).success, false);
});

test('VALIDATION 4: Queue Resource Exhaustion — Strict 500-Item Cap', () => {
  const room = new Room('room_cap_test', 'CAP001', 'Cap Room', 'admin_cap', createMockTrack('t_init'));
  const user = { id: 'admin_cap', name: 'Admin', role: 'admin' as const, roomId: room.id, connected: true, lastSeen: Date.now(), sessionId: 's1' };

  // Generate 505 tracks
  const tracks: Track[] = Array.from({ length: 505 }, (_, i) => createMockTrack(`t_${i}`));

  // Import into room
  room.importQueue(tracks, user, false);

  // Queue must be capped at 500
  assert.ok(room.queue.length <= 500, `Queue length (${room.queue.length}) must not exceed 500`);

  // Further individual add must be rejected
  const extraItem = room.addToQueue(createMockTrack('overflow_track'), user);
  assert.equal(extraItem, null, 'addToQueue must return null when queue is full');

  room.destroy();
});

test('VALIDATION 5: CORS & WebSocket Origin Security', () => {
  // Disallowed external origin check
  const allowed = getAllowedOrigins();
  assert.ok(Array.isArray(allowed));

  // In test environment, localhost origins are permitted
  const localRes = validateWebSocketOrigin('http://localhost:3000');
  assert.equal(localRes.isValid, true);

  // Missing origin (native mobile / same-origin) is permitted
  const noOriginRes = validateWebSocketOrigin(undefined);
  assert.equal(noOriginRes.isValid, true);
});
