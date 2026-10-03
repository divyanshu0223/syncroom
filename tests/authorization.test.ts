import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAdmin,
  canControlPlayback,
  canModifyQueue,
  canImportPlaylist,
  canRemoveMember,
  canManageRoom,
} from '../server/auth/permissions';
import { ServerUser } from '../server/types';

function createMockUser(role: 'admin' | 'listener', connected = true): ServerUser {
  return {
    id: `user_${role}_test`,
    name: `${role} User`,
    role,
    roomId: 'room_auth_privilege',
    connected,
    lastSeen: Date.now(),
    sessionId: `session_${role}`,
  };
}

test('AUTHORIZATION 1: Admin Permission Verification', () => {
  const admin = createMockUser('admin', true);

  assert.equal(isAdmin(admin), true, 'isAdmin should return true for admin');
  assert.equal(canControlPlayback(admin), true, 'Admin can control playback');
  assert.equal(canModifyQueue(admin), true, 'Admin can modify queue');
  assert.equal(canImportPlaylist(admin), true, 'Admin can import playlist');
  assert.equal(canRemoveMember(admin), true, 'Admin can remove member');
  assert.equal(canManageRoom(admin), true, 'Admin can manage room');
});

test('AUTHORIZATION 2: Server Strictly Rejects Listener From Controlling Playback (Play, Pause, Seek, Next, Previous)', () => {
  const listener = createMockUser('listener', true);

  assert.equal(isAdmin(listener), false, 'isAdmin must be false for listener');
  assert.equal(canControlPlayback(listener), false, 'Listener MUST NOT be able to control playback (play/pause/seek/next/prev)');
});

test('AUTHORIZATION 3: Server Strictly Rejects Listener From Modifying Queue (Add, Remove, Reorder, Clear)', () => {
  const listener = createMockUser('listener', true);

  assert.equal(canModifyQueue(listener), false, 'Listener MUST NOT be able to add/remove/reorder/clear queue');
});

test('AUTHORIZATION 4: Server Strictly Rejects Listener From Importing Playlists / Spotify Import', () => {
  const listener = createMockUser('listener', true);

  assert.equal(canImportPlaylist(listener), false, 'Listener MUST NOT be able to import playlist');
});

test('AUTHORIZATION 5: Server Strictly Rejects Listener From Removing Participants', () => {
  const listener = createMockUser('listener', true);

  assert.equal(canRemoveMember(listener), false, 'Listener MUST NOT be able to remove other participants');
});

test('AUTHORIZATION 6: Server Strictly Rejects Listener From Room Settings & Ending Room', () => {
  const listener = createMockUser('listener', true);

  assert.equal(canManageRoom(listener), false, 'Listener MUST NOT be able to rename or end room');
});

test('AUTHORIZATION 7: Server Rejects Disconnected Admin Commands', () => {
  const disconnectedAdmin = createMockUser('admin', false);

  assert.equal(canControlPlayback(disconnectedAdmin), false, 'Disconnected admin cannot execute active playback commands');
  assert.equal(canModifyQueue(disconnectedAdmin), false, 'Disconnected admin cannot execute active queue mutations');
});

test('AUTHORIZATION 8: Server Rejects Undefined or Null Users', () => {
  assert.equal(isAdmin(null), false);
  assert.equal(isAdmin(undefined), false);
  assert.equal(canControlPlayback(null), false);
  assert.equal(canModifyQueue(undefined), false);
  assert.equal(canImportPlaylist(null), false);
  assert.equal(canRemoveMember(undefined), false);
  assert.equal(canManageRoom(null), false);
});
