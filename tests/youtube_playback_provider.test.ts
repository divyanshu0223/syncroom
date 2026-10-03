import test from 'node:test';
import assert from 'node:assert/strict';
import { YouTubePlaybackProvider } from '../src/audio/YouTubePlaybackProvider';
import { SpotifyPlaybackProvider } from '../src/audio/SpotifyPlaybackProvider';
import { PlaybackManager } from '../src/audio/PlaybackProvider';
import { parseYouTubeVideoId } from '../src/services/music/MusicProvider';
import { Track } from '../src/types';

function createMockTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'yt-dQw4w9WgXcQ',
    provider: 'youtube',
    providerTrackId: 'dQw4w9WgXcQ',
    youtubeVideoId: 'dQw4w9WgXcQ',
    title: 'Never Gonna Give You Up',
    artist: 'Rick Astley',
    artists: ['Rick Astley'],
    album: 'Official Music Video',
    albumArtUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    duration: 213,
    durationMs: 213000,
    externalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    isPlayable: true,
    playbackStatus: 'AVAILABLE',
    restrictionReason: null,
    spotifyIsPlayable: false,
    audioSource: 'youtube',
    ...overrides,
  };
}

test('YOUTUBE PLAYBACK 1: YouTubePlaybackProvider initial state conforms to contract', () => {
  const provider = new YouTubePlaybackProvider();
  assert.equal(provider.id, 'youtube');
  assert.equal(provider.name, 'YouTube Player');
  assert.equal(provider.getStatus(), 'INITIALIZING');
  assert.equal(provider.getDeviceId(), null);
  assert.equal(provider.getCurrentTrackId(), null);
  assert.equal(provider.getPosition(), 0);
  assert.equal(provider.getDuration(), 0);
  assert.equal(provider.isConfigured, false);
});

test('YOUTUBE PLAYBACK 2: canPlayTrack correctly enforces YouTube provider and video ID requirement', () => {
  const provider = new YouTubePlaybackProvider();

  // Valid YouTube track
  const validYt = createMockTrack();
  const validCheck = provider.canPlayTrack(validYt);
  assert.equal(validCheck.canPlay, true);

  // Missing youtubeVideoId
  const missingId = createMockTrack({ youtubeVideoId: undefined, providerTrackId: '' });
  const missingCheck = provider.canPlayTrack(missingId);
  assert.equal(missingCheck.canPlay, false);
  assert.match(missingCheck.reason, /missing a valid YouTube video ID/);

  // Spotify track cannot be played directly on YouTube provider
  const spotifyTrack: Track = {
    id: 'spotify-12345',
    provider: 'spotify',
    providerTrackId: '12345',
    title: 'Test',
    artist: 'Artist',
    artists: ['Artist'],
    album: 'Album',
    albumArtUrl: null,
    duration: 180,
    durationMs: 180000,
    externalUrl: null,
    isPlayable: true,
    playbackStatus: 'AVAILABLE',
    restrictionReason: null,
    spotifyIsPlayable: true,
    audioSource: 'spotify',
  };
  const spotCheck = provider.canPlayTrack(spotifyTrack);
  assert.equal(spotCheck.canPlay, false);
  assert.match(spotCheck.reason, /Requires YouTube audio source/);
});

test('YOUTUBE PLAYBACK 3: Volume controls clamp between [0, 100]', async () => {
  const provider = new YouTubePlaybackProvider();

  await provider.setVolume(150);
  assert.equal(provider.getVolume(), 100);

  await provider.setVolume(-25);
  assert.equal(provider.getVolume(), 0);

  await provider.setVolume(75);
  assert.equal(provider.getVolume(), 75);
});

test('YOUTUBE PLAYBACK 4: PlaybackManager smoothly transitions between Spotify and YouTube providers', async () => {
  const manager = new PlaybackManager();
  const spotifyProvider = new SpotifyPlaybackProvider();
  const youtubeProvider = new YouTubePlaybackProvider();

  // Initially set to Spotify
  manager.setProvider(spotifyProvider);
  assert.equal(manager.getProvider().id, 'spotify');

  // Switch to YouTube without throwing
  manager.setProvider(youtubeProvider);
  assert.equal(manager.getProvider().id, 'youtube');
  assert.equal(manager.getStatus(), 'INITIALIZING');

  // Switch back to Spotify
  manager.setProvider(spotifyProvider);
  assert.equal(manager.getProvider().id, 'spotify');
});

test('YOUTUBE PLAYBACK 5: parseYouTubeVideoId correctly identifies diverse YouTube URL formats', () => {
  // Standard watch URL
  const res1 = parseYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(res1.videoId, 'dQw4w9WgXcQ');

  // Short URL
  const res2 = parseYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ');
  assert.equal(res2.videoId, 'dQw4w9WgXcQ');

  // URL with timestamp and query params
  const res3 = parseYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&feature=shared');
  assert.equal(res3.videoId, 'dQw4w9WgXcQ');

  // Embed URL
  const res4 = parseYouTubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ');
  assert.equal(res4.videoId, 'dQw4w9WgXcQ');

  // Direct 11-char ID
  const res5 = parseYouTubeVideoId('dQw4w9WgXcQ');
  assert.equal(res5.videoId, 'dQw4w9WgXcQ');

  // Invalid strings
  const res6 = parseYouTubeVideoId('not-a-youtube-url');
  assert.equal(res6.videoId, null);
  assert.ok(res6.error);

  const res7 = parseYouTubeVideoId('');
  assert.equal(res7.videoId, null);
});
