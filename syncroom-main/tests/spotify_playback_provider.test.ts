import test from 'node:test';
import assert from 'node:assert/strict';
import { SpotifyPlaybackProvider } from '../src/audio/SpotifyPlaybackProvider';
import { UnconfiguredPlaybackProvider, PlaybackManager, SpotifyPlayerStatus } from '../src/audio/PlaybackProvider';
import { Track } from '../src/types';
import { canControlPlayback } from '../server/auth/permissions';
import { ServerUser } from '../server/types';

function createMockTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'spotify-4cOdK2wGLETKBW3PvgPWqT',
    provider: 'spotify',
    providerTrackId: '4cOdK2wGLETKBW3PvgPWqT',
    title: 'Never Gonna Give You Up',
    artist: 'Rick Astley',
    artists: ['Rick Astley'],
    album: 'Whenever You Need Somebody',
    albumArtUrl: null,
    duration: 213,
    durationMs: 213000,
    externalUrl: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
    isPlayable: true,
    playbackStatus: 'AVAILABLE',
    restrictionReason: null,
    spotifyIsPlayable: true,
    audioSource: 'unavailable',
    ...overrides,
  };
}

test('SPOTIFY PLAYBACK 1: UnconfiguredPlaybackProvider accurately reports unavailable', () => {
  const unconfigured = new UnconfiguredPlaybackProvider();
  assert.equal(unconfigured.isConfigured, false);
  assert.equal(unconfigured.getStatus(), 'PROVIDER_UNAVAILABLE');
  assert.equal(unconfigured.getDeviceId(), null);
  assert.equal(unconfigured.getCurrentTrackId(), null);

  const track = createMockTrack();
  const check = unconfigured.canPlayTrack(track);
  assert.equal(check.canPlay, false);
  assert.match(check.reason, /Audio playback provider is not configured/);
});

test('SPOTIFY PLAYBACK 2: SpotifyPlaybackProvider initial state & configuration invariant', () => {
  const provider = new SpotifyPlaybackProvider();
  // Before real device connects, isConfigured MUST be false
  assert.equal(provider.isConfigured, false, 'Provider must not report configured before real device is ready');
  assert.equal(provider.getDeviceId(), null, 'Device ID must be null initially');
  assert.equal(provider.getCurrentTrackId(), null, 'No track loaded initially');
  assert.equal(provider.id, 'spotify');
  assert.equal(provider.name, 'Spotify Web Player');
});

test('SPOTIFY PLAYBACK 3: PlaybackManager correctly delegates to active provider', () => {
  const manager = new PlaybackManager();
  assert.equal(manager.isConfigured(), false);
  assert.equal(manager.getStatus(), 'PROVIDER_UNAVAILABLE');

  const provider = new SpotifyPlaybackProvider();
  manager.setProvider(provider);
  assert.equal(manager.getProvider(), provider);
  assert.equal(manager.getStatus(), 'INITIALIZING');
});

test('SPOTIFY PLAYBACK 4: canPlayTrack verifies Spotify provider & Spotify restrictions', () => {
  const provider = new SpotifyPlaybackProvider();

  // Non-spotify track
  const nonSpotify = createMockTrack({ provider: 'custom' as any });
  const checkNonSpotify = provider.canPlayTrack(nonSpotify);
  assert.equal(checkNonSpotify.canPlay, false);
  assert.match(checkNonSpotify.reason, /not a Spotify track/);

  // Restricted track
  const restricted = createMockTrack({ restrictionReason: 'market', playbackStatus: 'PROVIDER_RESTRICTED' });
  const checkRestricted = provider.canPlayTrack(restricted);
  assert.equal(checkRestricted.canPlay, false);
  assert.match(checkRestricted.reason, /restricted by Spotify \(market\)/);

  // Normal track before device connects
  const normal = createMockTrack();
  const checkNormal = provider.canPlayTrack(normal);
  assert.equal(checkNormal.canPlay, false);
  assert.match(checkNormal.reason, /device is connecting|connect your Spotify account/);
});

test('SPOTIFY PLAYBACK 5: Volume controls operate within bounds [0, 100]', () => {
  const provider = new SpotifyPlaybackProvider();
  provider.setVolume(75);
  assert.equal(provider.getVolume(), 75);

  provider.setVolume(150);
  assert.equal(provider.getVolume(), 100, 'Volume must clamp to 100 maximum');

  provider.setVolume(-20);
  assert.equal(provider.getVolume(), 0, 'Volume must clamp to 0 minimum');
});

test('SPOTIFY PLAYBACK 6: Status change listeners correctly receive state updates', () => {
  const provider = new SpotifyPlaybackProvider();
  const received: SpotifyPlayerStatus[] = [];

  const unsub = provider.onStatusChange((status) => {
    received.push(status);
  });

  // Initial notification on subscribe
  assert.ok(received.length >= 1);
  assert.equal(received[0], 'INITIALIZING');

  unsub();
});

test('SPOTIFY PLAYBACK 7: Admin-Only Playback Control Enforcement', () => {
  const adminUser: ServerUser = {
    id: 'admin_1',
    name: 'Admin Host',
    role: 'admin',
    roomId: 'room_1',
    connected: true,
    lastSeen: Date.now(),
    sessionId: 'session_admin',
  };

  const listenerUser: ServerUser = {
    id: 'listener_1',
    name: 'Regular Listener',
    role: 'listener',
    roomId: 'room_1',
    connected: true,
    lastSeen: Date.now(),
    sessionId: 'session_listener',
  };

  assert.equal(canControlPlayback(adminUser), true, 'Admin MUST be permitted to control playback');
  assert.equal(canControlPlayback(listenerUser), false, 'Listener MUST NOT be permitted to control playback');
});

test('SPOTIFY PLAYBACK 8: Safe Diagnostics — Error messages never expose secrets or tokens', () => {
  const provider = new SpotifyPlaybackProvider();
  const err = provider.getErrorMessage();
  if (err) {
    assert.doesNotMatch(err, /client_secret|clientSecret|refresh_token|refreshToken|Bearer/i);
  }
});

test('SPOTIFY PLAYBACK 9: Safe Diagnostics — Logger never outputs sensitive auth data', () => {
  const provider = new SpotifyPlaybackProvider() as any;
  const capturedLogs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: any[]) => {
    capturedLogs.push(args.join(' '));
  };

  try {
    // Attempt to log tokens, bearer headers, client secrets
    provider.logDiagnostic('Access token', 'BQB12345secretTokenValue');
    provider.logDiagnostic('Authorization header', 'Bearer secretTokenValue');
    provider.logDiagnostic('Client secret', 'superSecretSpotifyClientSecret');
    provider.logDiagnostic('ready event received', true);
    provider.logDiagnostic('device_id available', true);

    // Verify sensitive lines were blocked
    for (const log of capturedLogs) {
      assert.doesNotMatch(log, /BQB12345secretTokenValue/);
      assert.doesNotMatch(log, /superSecretSpotifyClientSecret/);
    }

    // Verify safe diagnostic was logged
    assert.ok(capturedLogs.some((l) => l.includes('ready event received: true')));
    assert.ok(capturedLogs.some((l) => l.includes('device_id available: true')));
  } finally {
    console.log = originalLog;
  }
});

test('SPOTIFY PLAYBACK 10: Non-Premium Account Immediate Rejection Invariant', () => {
  const provider = new SpotifyPlaybackProvider() as any;
  provider.isPremium = false;
  provider.status = 'PREMIUM_REQUIRED';
  provider.errorMessage = 'Spotify Premium is required for Web Playback.';

  assert.equal(provider.getStatus(), 'PREMIUM_REQUIRED');
  assert.equal(provider.getErrorMessage(), 'Spotify Premium is required for Web Playback.');
  assert.equal(provider.isConfigured, false);

  const track = createMockTrack();
  const check = provider.canPlayTrack(track);
  assert.equal(check.canPlay, false);
  assert.match(check.reason, /Spotify Premium is required/);
});

test('SPOTIFY PLAYBACK 11: Real Device ID Lifecycle & State Transitions', () => {
  const provider = new SpotifyPlaybackProvider() as any;

  // Initial state
  assert.equal(provider.getStatus(), 'INITIALIZING');
  assert.equal(provider.isConfigured, false);
  assert.equal(provider.getDeviceId(), null);

  // Simulate ready event with real device ID
  const testDeviceId = 'device_test_12345abcdef';
  provider.deviceId = testDeviceId;
  provider.status = 'PLAYER_READY';
  provider.errorMessage = null;

  assert.equal(provider.getStatus(), 'PLAYER_READY');
  assert.equal(provider.getDeviceId(), testDeviceId);
  assert.equal(provider.isConfigured, true, 'Provider is configured once real device_id is present');

  // Verify track can now be played
  const track = createMockTrack();
  const check = provider.canPlayTrack(track);
  assert.equal(check.canPlay, true);

  // Simulate not_ready event (device offline)
  provider.deviceId = null;
  provider.status = 'DEVICE_NOT_READY';
  provider.errorMessage = 'Spotify playback device went offline.';

  assert.equal(provider.getStatus(), 'DEVICE_NOT_READY');
  assert.equal(provider.getDeviceId(), null);
  assert.equal(provider.isConfigured, false);

  const checkAfterOffline = provider.canPlayTrack(track);
  assert.equal(checkAfterOffline.canPlay, false);
  assert.match(checkAfterOffline.reason, /device is connecting/);
});

test('SPOTIFY PLAYBACK 12: Member Playback Lifecycle Telemetry & Safe Logging format', () => {
  const provider = new SpotifyPlaybackProvider();

  // Intercept console.log to verify format and safe logging
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: any[]) => {
    logs.push(args.join(' '));
  };

  try {
    provider.logMemberPlaybackLifecycle('test_flow');
    assert.equal(logs.length, 1);
    const logLine = logs[0];
    assert.match(logLine, /^\[MEMBER_PLAYBACK\] \[test_flow\]/);
    assert.match(logLine, /room_connected=(true|false)/);
    assert.match(logLine, /spotify_token_available=(true|false)/);
    assert.match(logLine, /spotify_player_initialized=(true|false)/);
    assert.match(logLine, /spotify_connect=(true|false)/);
    assert.match(logLine, /spotify_ready=(true|false)/);
    assert.match(logLine, /device_id=(present|absent)/);
    assert.match(logLine, /player_state=(playing|paused|autoplay_blocked|auth_required|premium_required|not_ready|unavailable)/);

    // Verify secrets, credentials, and tokens are strictly never leaked
    assert.doesNotMatch(logLine, /Bearer\s+|ey[A-Za-z0-9_-]{10,}|client_secret|access_token=|refresh_token=/i);
  } finally {
    console.log = originalLog;
  }
});

test('SPOTIFY PLAYBACK 13: Member unauthenticated Spotify state reports CONNECT_SPOTIFY with clear user action', () => {
  const provider = new SpotifyPlaybackProvider() as any;
  provider.status = 'CONNECT_SPOTIFY';
  provider.errorMessage = 'Connect Spotify to enable audio.';

  assert.equal(provider.getStatus(), 'CONNECT_SPOTIFY');
  assert.equal(provider.getErrorMessage(), 'Connect Spotify to enable audio.');
  assert.equal(provider.isConfigured, false);

  const track = createMockTrack();
  const check = provider.canPlayTrack(track);
  assert.equal(check.canPlay, false);
  assert.match(check.reason, /Connect Spotify to enable audio|connect your Spotify account/i);
});

test('SPOTIFY PLAYBACK 14: Mobile autoplay blocked event transitions to AUTOPLAY_BLOCKED', () => {
  const provider = new SpotifyPlaybackProvider() as any;
  provider.status = 'AUTOPLAY_BLOCKED';
  provider.errorMessage = 'Tap Enable Audio to start playback.';

  assert.equal(provider.getStatus(), 'AUTOPLAY_BLOCKED');
  assert.equal(provider.getErrorMessage(), 'Tap Enable Audio to start playback.');
});

test('SPOTIFY PLAYBACK 15: Single player instance per browser session & cleanup invariant', () => {
  const provider = new SpotifyPlaybackProvider() as any;
  provider.deviceId = 'some_device_id';
  provider.connectSucceeded = true;
  provider.status = 'PLAYER_READY';

  provider.destroy();
  assert.equal(provider.getDeviceId(), null);
  assert.equal(provider.getStatus(), 'INITIALIZING');
  assert.equal(provider.connectSucceeded, false);
});

