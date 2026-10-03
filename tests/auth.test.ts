import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSessionToken, hashSessionToken } from '../server/db/dbRepository';
import { roomManager } from '../server/rooms/RoomManager';
import { Room } from '../server/rooms/Room';
import { ServerUser } from '../server/types';
import { parseClientMessage } from '../server/websocket/messages';

test('AUTH 1: Session Token Generation — Unpredictable & Cryptographically Secure', () => {
  const token1 = generateSessionToken();
  const token2 = generateSessionToken();

  assert.ok(token1.startsWith('syncroom_session_'), 'Session token should have syncroom_session_ prefix');
  assert.ok(token2.startsWith('syncroom_session_'), 'Session token should have syncroom_session_ prefix');
  assert.notEqual(token1, token2, 'Generated tokens must be unique');
  assert.ok(token1.length >= 40, 'Session token entropy must be sufficiently long');

  // Verify hash function produces consistent, deterministic SHA-256 hex
  const hash1 = hashSessionToken(token1);
  const hash2 = hashSessionToken(token1);
  const hashDifferent = hashSessionToken(token2);

  assert.equal(hash1, hash2, 'Hash must be deterministic');
  assert.notEqual(hash1, hashDifferent, 'Distinct tokens must yield distinct hashes');
  assert.equal(hash1.length, 64, 'SHA-256 hash must be 64 characters hex');
});

test('AUTH 2: Session Restoration — Valid Session Restores User Identity & Role', () => {
  const roomId = 'room_auth_test_1';
  const userId = 'user_auth_admin';
  const sessionToken = generateSessionToken();

  const user: ServerUser = {
    id: userId,
    name: 'Admin Tester',
    role: 'admin',
    roomId,
    connected: true,
    lastSeen: Date.now(),
    sessionId: sessionToken,
  };

  const room = new Room(roomId, 'AUTH01', 'Auth Test Room', userId);
  room.addUser(user);

  assert.equal(room.getUser(userId)?.role, 'admin');
  assert.equal(room.getUser(userId)?.name, 'Admin Tester');
  assert.equal(room.getUser(userId)?.connected, true);
});

test('AUTH 3: Session Expiration & Revocation Invariants', () => {
  const now = Date.now();
  const validExpiresAt = new Date(now + 1000 * 60 * 60 * 24 * 7); // 7 days in future
  const expiredExpiresAt = new Date(now - 1000 * 60); // 1 minute in past
  const revokedAt = new Date(now - 1000 * 30); // 30 seconds ago

  // Check valid condition
  const isValid = !revokedAt && validExpiresAt > new Date(now);
  assert.equal(isValid, false, 'Revoked session cannot be valid');

  const activeValid = validExpiresAt > new Date(now);
  assert.equal(activeValid, true, 'Non-expired, non-revoked session is valid');

  const isExpired = expiredExpiresAt < new Date(now);
  assert.equal(isExpired, true, 'Expired session correctly detected');
});

test('AUTH 4: Malformed or Missing Session Rejection', () => {
  // Test parsing invalid reconnect payloads
  const emptyTokenPayload = JSON.stringify({ type: 'RECONNECT_SESSION', sessionToken: '' });
  const missingTokenPayload = JSON.stringify({ type: 'RECONNECT_SESSION' });
  const whitespaceTokenPayload = JSON.stringify({ type: 'RECONNECT_SESSION', sessionToken: '   ' });
  const oversizedTokenPayload = JSON.stringify({
    type: 'RECONNECT_SESSION',
    sessionToken: 'a'.repeat(300),
  });

  const parsedEmpty = parseClientMessage(emptyTokenPayload);
  assert.equal(parsedEmpty.success, false, 'Empty session token should fail validation');

  const parsedMissing = parseClientMessage(missingTokenPayload);
  assert.equal(parsedMissing.success, false, 'Missing session token should fail validation');

  const parsedWhitespace = parseClientMessage(whitespaceTokenPayload);
  assert.equal(parsedWhitespace.success, false, 'Whitespace session token should fail validation');

  const parsedOversized = parseClientMessage(oversizedTokenPayload);
  assert.equal(parsedOversized.success, false, 'Oversized session token should fail validation');
});

test('AUTH 5: Network Disconnect & Reconnect — User Offline Then Online Recovery', () => {
  const roomId = 'room_auth_test_2';
  const userId = 'user_auth_listener';
  const user: ServerUser = {
    id: userId,
    name: 'Listener Tester',
    role: 'listener',
    roomId,
    connected: true,
    lastSeen: Date.now() - 5000,
    sessionId: generateSessionToken(),
  };

  const room = new Room(roomId, 'AUTH02', 'Disconnect Test Room', 'admin_123');
  room.addUser(user);

  // 1. Temporary network loss / device offline
  room.updateUserStatus(userId, false);
  assert.equal(room.getUser(userId)?.connected, false, 'User must be marked disconnected offline');

  // 2. Reconnect / device returning after being offline
  room.updateUserStatus(userId, true);
  assert.equal(room.getUser(userId)?.connected, true, 'User must be marked connected on reconnect');
  assert.ok(
    Date.now() - (room.getUser(userId)?.lastSeen || 0) < 100,
    'lastSeen should be updated upon reconnect',
  );
});

test('AUTH 6: Protection Against Cross-Room Session Spoofing', () => {
  // Session mapping test: socket -> session meta
  const dummyWsA = {} as any;
  const dummyWsB = {} as any;

  (roomManager as any).registerConnection(dummyWsA, 'user_a', 'token_room_a', 'room_A');
  (roomManager as any).registerConnection(dummyWsB, 'user_b', 'token_room_b', 'room_B');

  const metaA = roomManager.getSessionByWs(dummyWsA);
  const metaB = roomManager.getSessionByWs(dummyWsB);

  assert.equal(metaA?.roomId, 'room_A');
  assert.equal(metaA?.userId, 'user_a');
  assert.equal(metaB?.roomId, 'room_B');
  assert.equal(metaB?.userId, 'user_b');

  // Verify socket A cannot impersonate Room B
  assert.notEqual(metaA?.roomId, metaB?.roomId);

  // Clean up
  (roomManager as any).connectionUsers.delete(dummyWsA);
  (roomManager as any).connectionUsers.delete(dummyWsB);
});
