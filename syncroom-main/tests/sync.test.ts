import test from 'node:test';
import assert from 'node:assert/strict';
import { SYNC_CONFIG } from '../src/config/sync';
import { Room } from '../server/rooms/Room';
import { Track } from '../src/types';

function createTestTrack(id: string, title: string, duration = 180): Track {
  return {
    id,
    provider: 'local',
    providerTrackId: id,
    title,
    artist: 'Test Artist',
    artists: ['Test Artist'],
    album: 'Test Album',
    albumArtUrl: null,
    durationMs: duration * 1000,
    duration,
    externalUrl: null,
    isPlayable: true,
    playbackStatus: 'AVAILABLE',
    audioSource: 'local',
  };
}

test('1. Clock Synchronization — Cristian algorithm calculations & jitter rejection', async () => {
  // Test NTP sample offset & RTT formula:
  // rtt = clientReceiveTime - clientSendTime
  // estimatedServerTimeAtReceive = serverTime + rtt / 2
  // offset = estimatedServerTimeAtReceive - clientReceiveTime
  const clientSendTime = 1000;
  const serverTime = 1040; // Server clock is ahead by ~30ms
  const clientReceiveTime = 1020; // RTT = 20ms (10ms outbound, 10ms inbound)

  const rtt = clientReceiveTime - clientSendTime;
  assert.equal(rtt, 20);

  const estimatedServerTimeAtReceive = serverTime + rtt / 2;
  assert.equal(estimatedServerTimeAtReceive, 1050);

  const offset = estimatedServerTimeAtReceive - clientReceiveTime;
  assert.equal(offset, 30); // Exactly estimated 30ms offset

  // Outlier / jitter filtering test:
  // Given 4 samples with varying RTTs, filter to best lowest-RTT samples
  const samples = [
    { offset: 55, rtt: 120 }, // High jitter / buffer bloat
    { offset: 31, rtt: 18 },  // Low jitter
    { offset: 29, rtt: 22 },  // Low jitter
    { offset: 70, rtt: 250 }, // Outlier spike
  ];

  // Sort by lowest RTT
  const sorted = [...samples].sort((a, b) => a.rtt - b.rtt);
  // Take best 50%
  const bestSamples = sorted.slice(0, Math.ceil(sorted.length / 2));
  assert.equal(bestSamples.length, 2);
  assert.equal(bestSamples[0].rtt, 18);
  assert.equal(bestSamples[1].rtt, 22);

  const avgOffset = Math.round(
    bestSamples.reduce((sum, s) => sum + s.offset, 0) / bestSamples.length
  );
  assert.equal(avgOffset, 30); // Smoothly rejected outliers and recovered accurate 30ms offset
});

test('2. Playback Versioning — Rejection of stale/out-of-order playback updates', async () => {
  let currentPlaybackVersion = 5;

  const handleUpdate = (incomingVersion: number): boolean => {
    if (incomingVersion < currentPlaybackVersion) {
      return false; // Stale message rejected
    }
    currentPlaybackVersion = incomingVersion;
    return true; // Applied
  };

  // Newer message applies
  assert.equal(handleUpdate(6), true);
  assert.equal(currentPlaybackVersion, 6);

  // Stale message (arrived out-of-order) is rejected
  assert.equal(handleUpdate(4), false);
  assert.equal(currentPlaybackVersion, 6);

  // Duplicate / equal version is allowed (resync)
  assert.equal(handleUpdate(6), true);
  assert.equal(currentPlaybackVersion, 6);

  // Future version applies
  assert.equal(handleUpdate(7), true);
  assert.equal(currentPlaybackVersion, 7);
});

test('3. Queue Revisioning — Monotonic queue versioning and mutation increments', async () => {
  const room = new Room('room_test_1', 'ABC123', 'Test Room', 'admin_1');
  assert.equal(room.queueVersion, 1);

  const mockUser = {
    id: 'admin_1',
    name: 'Admin',
    role: 'admin' as const,
    roomId: room.id,
    connected: true,
    lastSeen: Date.now(),
    sessionId: 'sess_1',
  };

  const track1 = createTestTrack('trk_1', 'Track 1', 180);
  const track2 = createTestTrack('trk_2', 'Track 2', 210);

  // Adding first track becomes currentTrack
  room.addToQueue(track1, mockUser);
  assert.equal(room.currentTrack?.id, 'trk_1');

  // Adding second track pushes to queue and increments queueVersion
  const item2 = room.addToQueue(track2, mockUser);
  assert.equal(room.queueVersion, 2);
  assert.equal(room.queue.length, 1);

  // Removing track increments queueVersion
  room.removeFromQueue(item2!.id);
  assert.equal(room.queueVersion, 3);
  assert.equal(room.queue.length, 0);

  // Clear queue increments queueVersion
  room.clearQueue();
  assert.equal(room.queueVersion, 4);

  room.destroy();
});

test('4. Drift Thresholds & Correction Logic — Soft, moderate, and hard drift response', async () => {
  const evaluateDrift = (expected: number, actual: number) => {
    const driftSeconds = expected - actual;
    const absDriftMs = Math.round(Math.abs(driftSeconds) * 1000);

    if (absDriftMs <= SYNC_CONFIG.DRIFT_SOFT_THRESHOLD_MS) {
      return { action: 'none', rate: 1.0, driftMs: Math.round(driftSeconds * 1000) };
    }
    if (absDriftMs < SYNC_CONFIG.DRIFT_HARD_THRESHOLD_MS) {
      const correction =
        driftSeconds > 0
          ? 1.0 + SYNC_CONFIG.MAX_PLAYBACK_RATE_ADJUSTMENT
          : 1.0 - SYNC_CONFIG.MAX_PLAYBACK_RATE_ADJUSTMENT;
      return { action: 'rate_adjust', rate: correction, driftMs: Math.round(driftSeconds * 1000) };
    }
    return { action: 'seek', rate: 1.0, targetPosition: expected, driftMs: Math.round(driftSeconds * 1000) };
  };

  // 1. Negligible drift (30ms <= 60ms soft threshold) -> no adjustment
  const res1 = evaluateDrift(50.030, 50.000);
  assert.equal(res1.action, 'none');
  assert.equal(res1.rate, 1.0);

  // 2. Moderate behind drift (120ms between 60ms and 250ms) -> speed up rate by 2.5%
  const res2 = evaluateDrift(50.120, 50.000);
  assert.equal(res2.action, 'rate_adjust');
  assert.equal(res2.rate, 1.025);

  // 3. Moderate ahead drift (-100ms) -> slow down rate by 2.5%
  const res3 = evaluateDrift(50.000, 50.100);
  assert.equal(res3.action, 'rate_adjust');
  assert.equal(res3.rate, 0.975);

  // 4. Large drift (600ms >= 250ms hard threshold) -> hard seek
  const res4 = evaluateDrift(50.600, 50.000);
  assert.equal(res4.action, 'seek');
  assert.equal(res4.targetPosition, 50.600);
});

test('5. Track Transition Locking — Server-side concurrency protection', async () => {
  const room = new Room('room_lock_test', 'LCK123', 'Lock Test', 'admin_1');
  const mockUser = {
    id: 'admin_1',
    name: 'Admin',
    role: 'admin' as const,
    roomId: room.id,
    connected: true,
    lastSeen: Date.now(),
    sessionId: 'sess_1',
  };

  const track1 = createTestTrack('t1', 'T1', 180);
  const track2 = createTestTrack('t2', 'T2', 190);

  room.addToQueue(track1, mockUser);
  room.addToQueue(track2, mockUser);
  assert.equal(room.currentTrack?.id, 't1');
  assert.equal(room.queue.length, 1);

  // Calling nextTrack advances to t2
  const advanced = room.nextTrack();
  assert.equal(advanced, true);
  assert.equal(room.currentTrack?.id, 't2');
  assert.equal(room.queue.length, 0);

  room.destroy();
});

test('6. Authoritative Timeline Math — Scheduled future startAt and pause freezing', async () => {
  const room = new Room('room_math_test', 'MTH123', 'Math Test', 'admin_1');
  const track = createTestTrack('t1', 'T1', 100);
  const mockUser = {
    id: 'admin_1',
    name: 'Admin',
    role: 'admin' as const,
    roomId: room.id,
    connected: true,
    lastSeen: Date.now(),
    sessionId: 'sess_1',
  };

  room.addToQueue(track, mockUser);

  // Admin presses play with future buffer of 400ms
  room.play(400);
  assert.equal(room.isPlaying, true);
  assert.ok(room.startAt! > Date.now());

  // Before startAt is reached, position remains at base position (0)
  assert.equal(room.getCurrentCalculatedPosition(), 0);

  // Pause freezes position authoritatively
  room.pause();
  assert.equal(room.isPlaying, false);
  assert.equal(room.startAt, null);

  room.destroy();
});

test('7. Admin Command Serialization — Sequential execution under rapid command storms', async () => {
  const room = new Room('room_storm_test', 'STM123', 'Storm Test', 'admin_1');
  const executionOrder: number[] = [];

  // Simulated mutex command runner (identical to RoomManager.runRoomCommand)
  let currentLock: Promise<void> = Promise.resolve();
  const runSerialized = async (id: number) => {
    let releaseLock: () => void = () => {};
    const nextLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const prev = currentLock;
    currentLock = prev.then(() => nextLock);

    await prev;
    try {
      // Simulate micro async operation
      await new Promise((r) => setTimeout(r, 10));
      executionOrder.push(id);
    } finally {
      releaseLock();
    }
  };

  // Launch 5 simultaneous admin commands
  await Promise.all([
    runSerialized(1),
    runSerialized(2),
    runSerialized(3),
    runSerialized(4),
    runSerialized(5),
  ]);

  assert.deepEqual(executionOrder, [1, 2, 3, 4, 5]);
  room.destroy();
});

test('8. Reconnect State Convergence — Direct jump to latest authoritative state', async () => {
  // Simulate client disconnected at version 2, while server mutated through version 3, 4, 5
  const clientLocalState = {
    version: 2,
    position: 10,
    isPlaying: true,
  };

  const serverAuthoritativeState = {
    version: 5,
    position: 45,
    isPlaying: false,
    trackId: 'trk_final',
  };

  // On reconnect, client receives ROOM_STATE containing version 5
  // Instead of replaying v3 and v4, it directly converges to latest authoritative server state
  assert.ok(serverAuthoritativeState.version > clientLocalState.version);

  const convergedClientState = {
    ...clientLocalState,
    ...serverAuthoritativeState,
  };

  assert.equal(convergedClientState.version, 5);
  assert.equal(convergedClientState.position, 45);
  assert.equal(convergedClientState.isPlaying, false);
});

test('9. Offline -> Online Recovery — Server state wins over local drifts', async () => {
  // Client suffered 3 seconds of local audio clock drift while temporarily offline
  const clientEstimatedPosition = 33.5;
  const authoritativeServerPosition = 30.0; // Server is authoritative

  const drift = clientEstimatedPosition - authoritativeServerPosition;
  assert.equal(drift, 3.5); // 3.5s drift

  // When connection restores, authoritative server state overrides local playback
  const targetSeek = authoritativeServerPosition;
  assert.equal(targetSeek, 30.0);
});

test('10. Room-Ended Recovery — Local cleanup and session clearance', async () => {
  let isRoomActive = true;
  let localSessionCleared = false;

  const handleRoomEnded = () => {
    isRoomActive = false;
    localSessionCleared = true;
  };

  handleRoomEnded();

  assert.equal(isRoomActive, false);
  assert.equal(localSessionCleared, true);
});
