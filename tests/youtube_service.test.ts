import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIsoDuration, decodeHtmlEntities, youtubeService } from '../server/youtube/youtubeService';

test('YOUTUBE SERVICE 1: ISO 8601 duration parser correctly converts video duration formats', () => {
  // Standard minutes and seconds
  assert.equal(parseIsoDuration('PT3M45S'), 225);

  // Hours, minutes, and seconds
  assert.equal(parseIsoDuration('PT1H2M10S'), 3730);

  // Seconds only
  assert.equal(parseIsoDuration('PT50S'), 50);

  // Minutes only
  assert.equal(parseIsoDuration('PT4M'), 240);

  // Hours only
  assert.equal(parseIsoDuration('PT2H'), 7200);

  // Days
  assert.equal(parseIsoDuration('P1D'), 86400);

  // Invalid or empty inputs gracefully fallback to 0
  assert.equal(parseIsoDuration(''), 0);
  assert.equal(parseIsoDuration('invalid'), 0);
});

test('YOUTUBE SERVICE 2: HTML entity decoder handles special characters in titles', () => {
  assert.equal(decodeHtmlEntities('Tom &amp; Jerry'), 'Tom & Jerry');
  assert.equal(decodeHtmlEntities('It&#39;s My Life'), "It's My Life");
  assert.equal(decodeHtmlEntities('&quot;Hello World&quot;'), '"Hello World"');
  assert.equal(decodeHtmlEntities('Rock &lt;Pop&gt;'), 'Rock <Pop>');
  assert.equal(decodeHtmlEntities('Clean Title Without Entities'), 'Clean Title Without Entities');
});

test('YOUTUBE SERVICE 3: YouTubeService reports configured status without exposing API key', () => {
  const isConfigured = youtubeService.isConfigured();
  assert.equal(typeof isConfigured, 'boolean');

  // Verify that neither the service object nor any public method exposes private key strings
  const stringified = JSON.stringify(youtubeService);
  assert.equal(stringified.includes('AIzaSy'), false, 'API key must not be exposed in serialized service');
});

test('YOUTUBE SERVICE 4: Search and Match gracefully handle missing or empty queries', async () => {
  // Empty search query
  const emptySearch = await youtubeService.searchTracks('');
  assert.deepEqual(emptySearch, []);

  // Empty match query
  const emptyMatch = await youtubeService.findMatch('', '');
  assert.equal(emptyMatch, null);
});

test('YOUTUBE SERVICE 5: Circuit breaker trips on quota limits and blocks redundant calls', async () => {
  youtubeService.resetCircuitBreaker();
  assert.equal(youtubeService.isQuotaExceeded(), false);
  assert.equal(youtubeService.getQuotaCooldownSeconds(), 0);

  // Manually trip circuit breaker (simulating a 429 RateLimitExceeded response)
  youtubeService.setQuotaExceeded(300 * 1000);
  assert.equal(youtubeService.isQuotaExceeded(), true);
  assert.ok(youtubeService.getQuotaCooldownSeconds() > 250);

  // searchTracks must immediately reject with 429 YOUTUBE_QUOTA_EXCEEDED without calling API
  await assert.rejects(
    async () => {
      await youtubeService.searchTracks('test song');
    },
    (err: any) => {
      assert.equal(err.code, 'YOUTUBE_QUOTA_EXCEEDED');
      assert.equal(err.statusCode, 429);
      assert.ok(err.retryAfterSeconds > 0);
      return true;
    }
  );

  // findMatch must safely return null without throwing or loop-retrying
  const matchResult = await youtubeService.findMatch('test song', 'test artist');
  assert.equal(matchResult, null);

  // Reset circuit breaker for clean state
  youtubeService.resetCircuitBreaker();
  assert.equal(youtubeService.isQuotaExceeded(), false);
});

test('YOUTUBE SERVICE 6: normalizeVideoToTrack creates complete Track with required YouTube fields', () => {
  const track = youtubeService.normalizeVideoToTrack(
    'dQw4w9WgXcQ',
    'Never Gonna Give You Up &amp; More',
    'Rick Astley',
    'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    213
  );

  assert.equal(track.id, 'youtube-dQw4w9WgXcQ');
  assert.equal(track.provider, 'youtube');
  assert.equal(track.providerTrackId, 'dQw4w9WgXcQ');
  assert.equal(track.youtubeVideoId, 'dQw4w9WgXcQ');
  assert.equal(track.audioSource, 'youtube');
  assert.equal(track.title, 'Never Gonna Give You Up & More'); // entities decoded
  assert.equal(track.artist, 'Rick Astley');
  assert.equal(track.duration, 213);
  assert.equal(track.durationMs, 213000);
  assert.equal(track.isPlayable, true);
  assert.ok(track.coverGradient);
});

