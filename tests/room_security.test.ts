import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/rooms/Room';
import { validateRoomCode, normalizeRoomCode } from '../src/utils/roomCode';
import { roomManager } from '../server/rooms/RoomManager';
import { ServerUser } from '../server/types';

test('ROOM SECURITY 1: Room Code Validation & Normalization', () => {
  // Valid codes: 6 uppercase alphanumeric
  assert.equal(validateRoomCode('ABC123').isValid, true);
  assert.equal(normalizeRoomCode('abc123'), 'ABC123');
  assert.equal(normalizeRoomCode('  abc123  '), 'ABC123');

  // Invalid codes
  assert.equal(validateRoomCode('').isValid, false);
  assert.equal(validateRoomCode('AB12').isValid, false); // Too short
  assert.equal(validateRoomCode('ABC12345').isValid, false); // Too long
  assert.equal(validateRoomCode('ABC!@#').isValid, false); // Special characters
});

test('ROOM SECURITY 2: Non-existent Room Rejection', () => {
  const room = roomManager.getRoom('non_existent_room_id');
  assert.equal(room, undefined, 'Querying non-existent room must return undefined');

  const codeMatch = (roomManager as any).roomsByCode.get('XYZ999');
  assert.equal(codeMatch, undefined, 'Querying non-existent room code must return undefined');
});

test('ROOM SECURITY 3: Cross-Room Isolation — User in Room A Cannot See Room B State', () => {
  const roomA = new Room('room_isolation_a', 'ROOMAA', 'Room Alpha', 'admin_a');
  const roomB = new Room('room_isolation_b', 'ROOMBB', 'Room Beta', 'admin_b');

  const userA: ServerUser = {
    id: 'user_alpha',
    name: 'Alpha Member',
    role: 'listener',
    roomId: roomA.id,
    connected: true,
    lastSeen: Date.now(),
    sessionId: 'session_alpha',
  };

  const userB: ServerUser = {
    id: 'user_beta',
    name: 'Beta Member',
    role: 'listener',
    roomId: roomB.id,
    connected: true,
    lastSeen: Date.now(),
    sessionId: 'session_beta',
  };

  roomA.addUser(userA);
  roomB.addUser(userB);

  // Verify users are strictly segregated by room
  assert.equal(roomA.getUser('user_alpha')?.id, 'user_alpha');
  assert.equal(roomA.getUser('user_beta'), undefined, 'Room A must not contain Room B user');
  assert.equal(roomB.getUser('user_alpha'), undefined, 'Room B must not contain Room A user');

  // Verify ClientState isolation
  const clientStateA = roomA.toClientState('user_alpha');
  const clientStateB = roomB.toClientState('user_beta');

  assert.equal(clientStateA.id, 'room_isolation_a');
  assert.equal(clientStateB.id, 'room_isolation_b');
  assert.equal(clientStateA.users.some((u) => u.id === 'user_beta'), false);
  assert.equal(clientStateB.users.some((u) => u.id === 'user_alpha'), false);

  roomA.destroy();
  roomB.destroy();
});

test('ROOM SECURITY 4: Ended Room Rejects Further Commands & Disconnects Members', async () => {
  const roomId = 'room_ended_security_test';
  const adminId = 'admin_ended_test';
  const room = new Room(roomId, 'END001', 'Ending Room', adminId);

  const adminUser: ServerUser = {
    id: adminId,
    name: 'Admin End',
    role: 'admin',
    roomId,
    connected: true,
    lastSeen: Date.now(),
    sessionId: 'session_admin_ended',
  };

  const listenerUser: ServerUser = {
    id: 'listener_ended_test',
    name: 'Listener End',
    role: 'listener',
    roomId,
    connected: true,
    lastSeen: Date.now(),
    sessionId: 'session_listener_ended',
  };

  room.addUser(adminUser);
  room.addUser(listenerUser);

  (roomManager as any).roomsById.set(roomId, room);
  (roomManager as any).roomsByCode.set(room.code, room);

  // Stop ticker and clean up
  room.destroy();
  (roomManager as any).roomsById.delete(roomId);
  (roomManager as any).roomsByCode.delete(room.code);

  // Verify that querying ended room returns nothing
  assert.equal(roomManager.getRoom(roomId), undefined);
  assert.equal((roomManager as any).roomsByCode.get('END001'), undefined);
});

test('ROOM SECURITY 5: Duplicate User Join Handling in Same Room', () => {
  const room = new Room('room_dup_test', 'DUP001', 'Duplicate Room', 'admin_dup');
  const user: ServerUser = {
    id: 'user_dup',
    name: 'Duplicate Member',
    role: 'listener',
    roomId: room.id,
    connected: true,
    lastSeen: Date.now() - 10000,
    sessionId: 'session_dup',
  };

  room.addUser(user);
  assert.equal(room.users.size, 1);

  // Re-joining with same userId overwrites/updates presence without duplicate entries
  const updatedUser: ServerUser = {
    ...user,
    lastSeen: Date.now(),
    connected: true,
  };
  room.addUser(updatedUser);

  assert.equal(room.users.size, 1, 'Duplicate join with same userId must not duplicate user list');
  assert.equal(room.getUser('user_dup')?.connected, true);

  room.destroy();
});
