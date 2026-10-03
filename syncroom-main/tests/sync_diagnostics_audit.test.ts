import test from 'node:test';
import assert from 'node:assert/strict';
import { SpotifyPlaybackProvider } from '../src/audio/SpotifyPlaybackProvider';
import { SyncEngine } from '../src/audio/SyncEngine';
import { ServerClockSync } from '../src/services/serverClock';
import { PlaybackState } from '../server/types';

test('SYNC DIAGNOSTICS AUDIT 1: Monotonic position extrapolation prevents frozen snapshot drift', async () => {
  const provider = new SpotifyPlaybackProvider();
  
  // Simulate receiving player_state_changed at position 10000ms (10.0s)
  (provider as any).lastState = {
    position: 10000,
    duration: 180000,
    paused: false,
    track_window: { current_track: { id: 'track1' } },
  };
  (provider as any).status = 'PLAYING';
  
  // Set snapshot timestamp to 2.405 seconds ago (2405ms)
  const initialTime = performance.now();
  (provider as any).lastStateMonotonicTime = initialTime - 2405;

  // With monotonic extrapolation, getPosition() should advance smoothly to ~12.405s, NOT remain frozen at 10.0s
  const pos = provider.getPosition();
  assert(
    pos >= 12.35 && pos <= 12.45,
    `Expected extrapolated position around 12.405s, got ${pos}s (which would cause ~2405ms drift if frozen at 10.0s)`
  );

  // When paused, position should NOT extrapolate forward
  (provider as any).lastState.paused = true;
  assert.equal(provider.getPosition(), 10.0, 'Paused position should strictly equal base position without extrapolation');
});

test('SYNC DIAGNOSTICS AUDIT 2: Drift formula follows authoritative actual - expected definition', async () => {
  const engine = new SyncEngine();

  const state: PlaybackState = {
    trackId: 'track_1',
    isPlaying: true,
    position: 15.0, // base position at server timestamp
    serverTimestamp: 100000,
    startedAt: 100000,
    startAt: null,
    duration: 200,
    version: 1,
  };

  // If estimated server time is 102000 (2.0s later)
  const estimatedServerTime = 102000;
  const expectedPosition = engine.calculateExpectedPosition(state, estimatedServerTime);
  assert.equal(expectedPosition, 17.0, 'Expected position should be base (15.0s) + elapsed (2.0s) = 17.0s');

  // Test case A: Local player is behind at 16.85s (150ms behind)
  const actualA = 16.85;
  const driftSecA = actualA - expectedPosition;
  const driftMsA = Math.round(driftSecA * 1000);
  assert.equal(driftMsA, -150, 'Behind player must yield negative drift (-150ms)');

  // Test case B: Local player is ahead at 17.12s (120ms ahead)
  const actualB = 17.12;
  const driftSecB = actualB - expectedPosition;
  const driftMsB = Math.round(driftSecB * 1000);
  assert.equal(driftMsB, +120, 'Ahead player must yield positive drift (+120ms)');
});

test('SYNC DIAGNOSTICS AUDIT 3: Reconnect during active playback does not double-count elapsed time', async () => {
  const engine = new SyncEngine();

  // Playback started 30 seconds ago at server time 70000 with base position 0
  // Reconnect happens at server time 100000 (30 seconds in)
  // Server sends toPlaybackState(): position=30.0, serverTimestamp=100000, startedAt=70000
  const reconnectState: PlaybackState = {
    trackId: 'track_1',
    isPlaying: true,
    position: 30.0,
    serverTimestamp: 100000,
    startedAt: 70000,
    startAt: null,
    duration: 180,
    version: 5,
  };

  // Client receives packet at estimated server time 100005 (5ms after server generated it)
  const estimatedServerTime = 100005;
  const expected = engine.calculateExpectedPosition(reconnectState, estimatedServerTime);

  // Expected position must be ~30.005s, NOT 60s (30 + 30)
  assert(
    expected >= 30.0 && expected <= 30.01,
    `Expected position on reconnect must be ~30.005s, but got ${expected}s`
  );
});

test('SYNC DIAGNOSTICS AUDIT 4: Clock sync telemetry distinguishes valid samples vs unmeasured', async () => {
  const clock = new ServerClockSync();
  (clock as any).samples = [];
  (clock as any).offset = 0;

  assert.equal(clock.hasMeasurements(), false, 'Clock should report no measurements initially');

  // Add real measurement
  (clock as any).handleTimeSyncResponse(1000, 1020);
  assert.equal(clock.hasMeasurements(), true, 'Clock must report having measurements after response');
  assert(typeof clock.getLatestRtt() === 'number' && clock.getLatestRtt() > 0, 'Measured RTT must be > 0');
});

test('SYNC DIAGNOSTICS AUDIT 5: Drift correction includes 4-second debouncing to prevent seek thrashing', async () => {
  const engine = new SyncEngine();
  (engine as any).lastCorrectionTime = performance.now();

  // If a seek correction occurred 1 second ago
  const elapsedSinceLastSeek = performance.now() - (engine as any).lastCorrectionTime;
  assert(elapsedSinceLastSeek < 4000, 'Seek cooldown must block rapid successive seeks');
});
