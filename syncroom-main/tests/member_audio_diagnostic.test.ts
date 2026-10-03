import test from 'node:test';
import assert from 'node:assert/strict';
import { SpotifyPlaybackProvider } from '../src/audio/SpotifyPlaybackProvider';
import { PlaybackManager, playbackManager } from '../src/audio/PlaybackProvider';
import { SyncEngine, syncEngine } from '../src/audio/SyncEngine';
import { PlaybackState } from '../server/types';
import { Track } from '../src/types';

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

test('MEMBER AUDIO DIAGNOSTIC 1: Admin browser only (Authenticated Host with Premium & Ready Device)', async () => {
  const adminProvider = new SpotifyPlaybackProvider() as any;

  // 1. Simulate authenticated Spotify token
  adminProvider.cachedToken = 'mock_admin_token_abcdef';
  adminProvider.tokenExpiresAt = Date.now() + 3600000;
  adminProvider.isPremium = true;

  // 2. Simulate ready event with real device ID
  adminProvider.deviceId = 'admin_device_desktop_987';
  adminProvider.connectSucceeded = true;
  adminProvider.status = 'PLAYER_READY';
  adminProvider.errorMessage = null;

  assert.equal(adminProvider.hasValidToken(), true);
  assert.equal(adminProvider.isPlayerReady(), true);
  assert.equal(adminProvider.getDeviceId(), 'admin_device_desktop_987');
  assert.equal(adminProvider.getStatus(), 'PLAYER_READY');

  // Verify safe log telemetry
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: any[]) => logs.push(args.join(' '));
  try {
    adminProvider.logMemberAudio('admin_session');
    assert.equal(logs.length, 1);
    assert.match(logs[0], /\[MEMBER_AUDIO\] \[admin_session\]/);
    assert.match(logs[0], /spotifyTokenAvailable=true/);
    assert.match(logs[0], /ready=true/);
    assert.match(logs[0], /deviceIdPresent=true/);
  } finally {
    console.log = origLog;
  }
});

test('MEMBER AUDIO DIAGNOSTIC 2: Member browser only (Unauthenticated Listener connects to room)', () => {
  const memberProvider = new SpotifyPlaybackProvider() as any;

  // 1. Unauthenticated state (No Spotify token exists for member session)
  memberProvider.cachedToken = null;
  memberProvider.tokenExpiresAt = 0;
  memberProvider.status = 'CONNECT_SPOTIFY';
  memberProvider.errorMessage = 'Connect Spotify to enable playback.';
  memberProvider.deviceId = null;
  memberProvider.connectSucceeded = false;

  assert.equal(memberProvider.hasValidToken(), false);
  assert.equal(memberProvider.isPlayerReady(), false);
  assert.equal(memberProvider.getDeviceId(), null);
  assert.equal(memberProvider.getStatus(), 'CONNECT_SPOTIFY');
  assert.equal(memberProvider.getErrorMessage(), 'Connect Spotify to enable playback.');

  // Room connection is independent from Spotify playback state
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: any[]) => logs.push(args.join(' '));
  try {
    memberProvider.logMemberAudio('member_unauthenticated');
    assert.equal(logs.length, 1);
    assert.match(logs[0], /spotifyTokenAvailable=false/);
    assert.match(logs[0], /ready=false/);
    assert.match(logs[0], /deviceIdPresent=false/);
    assert.match(logs[0], /playbackState=unavailable/);
  } finally {
    console.log = origLog;
  }
});

test('MEMBER AUDIO DIAGNOSTIC 3: Admin + Member Desktop (Room state reaches member, retained until player ready)', async () => {
  const syncEngine = new SyncEngine();
  const playbackManager = new PlaybackManager();
  const memberProvider = new SpotifyPlaybackProvider() as any;
  playbackManager.setProvider(memberProvider);

  // Member starts unauthenticated
  memberProvider.cachedToken = null;
  memberProvider.status = 'CONNECT_SPOTIFY';
  memberProvider.deviceId = null;

  // Admin broadcasts playing state
  const adminPlaybackState: PlaybackState = {
    trackId: 'spotify-4cOdK2wGLETKBW3PvgPWqT',
    isPlaying: true,
    position: 45,
    serverTimestamp: Date.now(),
    startedAt: Date.now() - 45000,
    startAt: null,
    duration: 213,
    version: 2,
  };

  // Member receives room state while player is not ready
  await syncEngine.handlePlaybackState(adminPlaybackState);

  // Verify member retains room state without playing audio
  assert.equal(syncEngine.getSyncStatus().status, 'buffering');
  assert.notEqual(memberProvider.getStatus(), 'PLAYING', 'Unauthenticated member must not enter PLAYING state');

  // Member completes Spotify auth and player fires ready
  memberProvider.cachedToken = 'mock_member_token_123';
  memberProvider.tokenExpiresAt = Date.now() + 3600000;
  memberProvider.deviceId = 'member_device_ready_456';
  memberProvider.status = 'PLAYER_READY';

  assert.equal(memberProvider.hasValidToken(), true);
  assert.equal(memberProvider.isPlayerReady(), true);
});

test('MEMBER AUDIO DIAGNOSTIC 4: Admin + Member Mobile (Browser autoplay blocked)', () => {
  const memberProvider = new SpotifyPlaybackProvider() as any;

  // Member is authenticated but on mobile browser where autoplay policy blocks audio
  memberProvider.cachedToken = 'mock_mobile_token_555';
  memberProvider.tokenExpiresAt = Date.now() + 3600000;
  memberProvider.deviceId = 'mobile_device_777';
  memberProvider.status = 'AUTOPLAY_BLOCKED';
  memberProvider.errorMessage = 'Tap Enable Audio to start playback.';

  assert.equal(memberProvider.getStatus(), 'AUTOPLAY_BLOCKED');
  assert.equal(memberProvider.getErrorMessage(), 'Tap Enable Audio to start playback.');

  // Safe telemetry logs autoplay_blocked state
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: any[]) => logs.push(args.join(' '));
  try {
    memberProvider.logMemberPlaybackLifecycle('mobile_autoplay');
    assert.match(logs[0], /player_state=autoplay_blocked/);
  } finally {
    console.log = origLog;
  }
});

test('MEMBER AUDIO DIAGNOSTIC 5: Member after page refresh (Session restoration & single player instance)', () => {
  const memberProvider = new SpotifyPlaybackProvider() as any;
  memberProvider.deviceId = 'old_device_session';
  memberProvider.connectSucceeded = true;
  memberProvider.status = 'PLAYER_READY';

  // Simulating refresh cleanup
  memberProvider.destroy();
  assert.equal(memberProvider.getDeviceId(), null);
  assert.equal(memberProvider.getStatus(), 'INITIALIZING');
  assert.equal(memberProvider.connectSucceeded, false);

  // Re-instantiating fresh player
  memberProvider.deviceId = 'new_device_after_refresh';
  memberProvider.status = 'PLAYER_READY';
  memberProvider.connectSucceeded = true;

  assert.equal(memberProvider.getDeviceId(), 'new_device_after_refresh');
  assert.equal(memberProvider.isPlayerReady(), true);
});

test('MEMBER AUDIO DIAGNOSTIC 6: Member after Spotify token expiry (Auth error caught, prompt to reconnect)', () => {
  const memberProvider = new SpotifyPlaybackProvider() as any;
  memberProvider.cachedToken = 'expired_token';
  memberProvider.tokenExpiresAt = Date.now() - 10000; // Expired 10 seconds ago

  assert.equal(memberProvider.hasValidToken(), false);

  // Authentication error fired
  memberProvider.cachedToken = null;
  memberProvider.status = 'AUTH_REQUIRED';
  memberProvider.errorMessage = 'Authentication failed: Token expired. Connect Spotify to enable playback.';

  assert.equal(memberProvider.getStatus(), 'AUTH_REQUIRED');
  assert.match(memberProvider.getErrorMessage(), /Connect Spotify to enable playback/);
});

test('MEMBER AUDIO DIAGNOSTIC 7: Member after temporary network loss (Offline -> Online Reconnect)', () => {
  const memberProvider = new SpotifyPlaybackProvider() as any;

  // Device goes offline: device_id lost
  memberProvider.deviceId = null;
  memberProvider.status = 'DEVICE_NOT_READY';
  memberProvider.errorMessage = 'Spotify playback device went offline.';

  assert.equal(memberProvider.isPlayerReady(), false);
  assert.equal(memberProvider.getStatus(), 'DEVICE_NOT_READY');

  // Network restores: player reconnects
  memberProvider.deviceId = 'restored_device_999';
  memberProvider.status = 'PLAYER_READY';
  memberProvider.errorMessage = null;

  assert.equal(memberProvider.isPlayerReady(), true);
  assert.equal(memberProvider.getStatus(), 'PLAYER_READY');
});

test('MEMBER AUDIO DIAGNOSTIC 8: Mobile member with explicit "Enable Audio" interaction (Unlock Autoplay)', async () => {
  const memberProvider = new SpotifyPlaybackProvider() as any;
  playbackManager.setProvider(memberProvider);

  memberProvider.cachedToken = 'valid_mobile_token';
  memberProvider.tokenExpiresAt = Date.now() + 3600000;
  memberProvider.deviceId = 'mobile_element_activated';
  memberProvider.status = 'AUTOPLAY_BLOCKED';

  let elementActivated = false;
  memberProvider.activateElement = async () => {
    elementActivated = true;
  };

  // User taps "Tap Enable Audio"
  await syncEngine.unlockAutoplay();

  assert.equal(elementActivated, true, 'activateElement must be called on genuine user interaction');
});
