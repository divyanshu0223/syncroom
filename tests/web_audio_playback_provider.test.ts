import test from 'node:test';
import assert from 'node:assert/strict';
import { WebAudioPlaybackProvider } from '../src/audio/WebAudioPlaybackProvider';
import { PlaybackManager } from '../src/audio/PlaybackProvider';
import { SpotifyPlaybackProvider } from '../src/audio/SpotifyPlaybackProvider';
import { YouTubePlaybackProvider } from '../src/audio/YouTubePlaybackProvider';
import { Track } from '../src/types';

function createAudioTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'audio-track-1',
    provider: 'audio',
    providerTrackId: 'stream-123',
    title: 'Ambient Waves',
    artist: 'SyncRoom Soundscape',
    artists: ['SyncRoom Soundscape'],
    album: 'Original Sessions',
    albumArtUrl: null,
    duration: 180,
    durationMs: 180000,
    externalUrl: 'https://example.com/audio/waves.mp3',
    isPlayable: true,
    playbackStatus: 'AVAILABLE',
    restrictionReason: null,
    spotifyIsPlayable: false,
    audioSource: 'local',
    ...overrides,
  };
}

test('WEB AUDIO ARCHITECTURE 1: WebAudioPlaybackProvider conforms to PlaybackProvider contract', () => {
  const provider = new WebAudioPlaybackProvider();
  assert.equal(provider.id, 'audio');
  assert.equal(provider.name, 'Web Audio Player');
  assert.equal(provider.isConfigured, true);
  assert.equal(provider.getDeviceId(), 'web-audio-speaker');
  assert.equal(provider.getCurrentTrackId(), null);
  assert.equal(provider.getPosition(), 0);
  assert.equal(provider.getDuration(), 0);
});

test('WEB AUDIO ARCHITECTURE 2: canPlayTrack recognizes direct audio streams and local/licensed providers', () => {
  const provider = new WebAudioPlaybackProvider();

  // Valid audio provider track
  const audioTrack = createAudioTrack();
  assert.equal(provider.canPlayTrack(audioTrack).canPlay, true);

  // Local media track
  const localTrack = createAudioTrack({ provider: 'local', audioSource: 'local' });
  assert.equal(provider.canPlayTrack(localTrack).canPlay, true);

  // MP3 file URL
  const mp3Track = createAudioTrack({ externalUrl: 'https://cdn.example.com/song.mp3' });
  assert.equal(provider.canPlayTrack(mp3Track).canPlay, true);

  // Unrelated Spotify metadata-only track
  const spotifyTrack = createAudioTrack({
    provider: 'spotify',
    audioSource: 'spotify',
    externalUrl: 'https://open.spotify.com/track/1234',
  });
  assert.equal(provider.canPlayTrack(spotifyTrack).canPlay, false);
});

test('WEB AUDIO ARCHITECTURE 3: Volume controls clamp between [0, 100]', () => {
  const provider = new WebAudioPlaybackProvider();
  provider.setVolume(50);
  assert.equal(provider.getVolume(), 50);

  provider.setVolume(150);
  assert.equal(provider.getVolume(), 100);

  provider.setVolume(-20);
  assert.equal(provider.getVolume(), 0);
});

test('WEB AUDIO ARCHITECTURE 4: PlaybackManager transitions across all three providers (Spotify, YouTube, Audio)', () => {
  const manager = new PlaybackManager();
  const spotify = new SpotifyPlaybackProvider();
  const youtube = new YouTubePlaybackProvider();
  const audio = new WebAudioPlaybackProvider();

  const statusHistory: string[] = [];
  manager.onProviderChange((p, status) => {
    statusHistory.push(`${p.id}:${status}`);
  });

  // Switch to Spotify
  manager.setProvider(spotify);
  assert.equal(manager.getProvider().id, 'spotify');

  // Switch to YouTube
  manager.setProvider(youtube);
  assert.equal(manager.getProvider().id, 'youtube');

  // Switch to Web Audio
  manager.setProvider(audio);
  assert.equal(manager.getProvider().id, 'audio');

  assert.ok(statusHistory.length >= 3);
});

test('WEB AUDIO ARCHITECTURE 5: loadTrack idempotency preserves playback without restarting active track', async () => {
  const provider = new WebAudioPlaybackProvider();
  const track = createAudioTrack({ externalUrl: '' });

  // Initial load
  await provider.loadTrack(track, 30, false);
  assert.equal(provider.getCurrentTrackId(), track.id);
  assert.equal(provider.getPosition(), 30);

  // Re-calling loadTrack with same track and position does not reset state
  await provider.loadTrack(track, 30, false);
  assert.equal(provider.getCurrentTrackId(), track.id);
});
