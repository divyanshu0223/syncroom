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
