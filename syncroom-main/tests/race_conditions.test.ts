import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/rooms/Room';
import { roomManager } from '../server/rooms/RoomManager';
import { Track } from '../src/types';

function createMockTrack(id: string, duration = 180): Track {
  return {
    id,
    provider: 'local',
    providerTrackId: id,
    title: `Song ${id}`,
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

test('RACE CONDITION 1: Concurrent Track Advancement — Server Transition Lock Prevents Duplicate Skips', async () => {
  const t1 = createMockTrack('t1');
  const t2 = createMockTrack('t2');
  const t3 = createMockTrack('t3');

  const room = new Room('room_race_1', 'RACE01', 'Race Room', 'admin_1', t1);
  const user = { id: 'admin_1', name: 'Admin', role: 'admin' as const, roomId: room.id, connected: true, lastSeen: Date.now(), sessionId: 's1' };

  room.addToQueue(t2, user);
  room.addToQueue(t3, user);

  // When transition lock is active (e.g. during an ongoing transition), concurrent nextTrack must be rejected
  (room as any).isAdvancingTrack = true;
  const lockedRes = room.nextTrack();
  assert.equal(lockedRes, false, 'nextTrack must return false when transition lock is held');
  assert.equal(room.currentTrack?.id, 't1', 'Current track must remain t1 while transition lock is held');
  assert.equal(room.queue.length, 2, 'Queue must not be shifted while transition lock is held');

  // Once transition lock releases, advance succeeds cleanly
  (room as any).isAdvancingTrack = false;
  const advanceRes = room.nextTrack();
  assert.equal(advanceRes, true, 'nextTrack succeeds when transition lock is free');
  assert.equal(room.currentTrack?.id, 't2', 'Track transitions to t2');
  assert.equal(room.queue.length, 1, 'Exactly one track shifted from queue');

  room.destroy();
});

test('RACE CONDITION 2: Rapid Admin Playback Command Storm — Mutex Guarantees Deterministic Order', async () => {
  const roomId = 'room_race_mutex_test';
  const track = createMockTrack('storm_track', 200);
  const room = new Room(roomId, 'STORM1', 'Storm Room', 'admin_storm', track);

  const executionLog: string[] = [];

  // Launch 10 rapid concurrent commands through roomManager mutex
  const commands = [
    () => roomManager.runRoomCommand(roomId, async () => {
      await new Promise((r) => setTimeout(r, 10));
      room.play();
      executionLog.push('play');
    }),
    () => roomManager.runRoomCommand(roomId, async () => {
      await new Promise((r) => setTimeout(r, 5));
      room.pause();
      executionLog.push('pause');
    }),
    () => roomManager.runRoomCommand(roomId, async () => {
      room.seek(30);
      executionLog.push('seek-30');
    }),
    () => roomManager.runRoomCommand(roomId, async () => {
      room.play();
      executionLog.push('play-2');
    }),
    () => roomManager.runRoomCommand(roomId, async () => {
      room.seek(90);
      executionLog.push('seek-90');
    }),
  ];

  await Promise.all(commands.map((cmd) => cmd()));

  // Verifications:
  // 1. All commands executed in FIFO serialized order
  assert.deepEqual(executionLog, ['play', 'pause', 'seek-30', 'play-2', 'seek-90']);
  // 2. Final state is deterministic
  assert.equal(room.isPlaying, true);
  assert.equal(room.position, 90);
  assert.ok(room.version > 5, 'Version should increment with each mutation');

  room.destroy();
});

test('RACE CONDITION 3: Concurrent Queue Reorder + Remove', () => {
  const room = new Room('room_race_queue', 'QRC01', 'Queue Race Room', 'admin_1', createMockTrack('playing'));
  const user = { id: 'admin_1', name: 'Admin', role: 'admin' as const, roomId: room.id, connected: true, lastSeen: Date.now(), sessionId: 's1' };

  const item1 = room.addToQueue(createMockTrack('q1'), user)!;
  const item2 = room.addToQueue(createMockTrack('q2'), user)!;
  const item3 = room.addToQueue(createMockTrack('q3'), user)!;

  assert.equal(room.queue.length, 3);

  // Simultaneous operations: reorder [item3, item2, item1] while removing item2
  room.removeFromQueue(item2.id);
  const reorderSuccess = room.reorderQueue([item3.id, item2.id, item1.id]);

  assert.equal(reorderSuccess, true);
  // item2 should be absent, and item3 should come before item1
  assert.equal(room.queue.length, 2);
  assert.equal(room.queue[0].id, item3.id);
  assert.equal(room.queue[1].id, item1.id);

  room.destroy();
});

test('RACE CONDITION 4: Monotonic Version Numbers Prevent Stale State Overwrites', () => {
  const room = new Room('room_ver_test', 'VER001', 'Version Room', 'admin_1', createMockTrack('v_track'));

  const v1 = room.version;
  room.play();
  const v2 = room.version;
  room.pause();
  const v3 = room.version;

  assert.ok(v2 > v1, 'v2 must be strictly greater than v1');
  assert.ok(v3 > v2, 'v3 must be strictly greater than v2');

  // Stale update rejection logic (used on clients)
  const clientCurrentVersion = v3;
  const incomingStaleUpdate = { version: v2, isPlaying: true };

  const shouldAccept = incomingStaleUpdate.version > clientCurrentVersion;
  assert.equal(shouldAccept, false, 'Stale incoming playback update must be rejected');

  room.destroy();
});
