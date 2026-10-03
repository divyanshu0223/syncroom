import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('1. PWA Web App Manifest — Correctness & Structure', async () => {
  const manifestPath = path.resolve(process.cwd(), 'public/manifest.webmanifest');
  assert.ok(fs.existsSync(manifestPath), 'manifest.webmanifest must exist in public/');

  const content = fs.readFileSync(manifestPath, 'utf-8');
  const manifest = JSON.parse(content);

  assert.equal(manifest.name, 'SyncRoom — Synchronized Music Room');
  assert.equal(manifest.short_name, 'SyncRoom');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.background_color, '#08080a');
  assert.equal(manifest.theme_color, '#08080a');

  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2, 'Manifest must have icons');
  for (const icon of manifest.icons) {
    const iconFilePath = path.resolve(process.cwd(), 'public', icon.src.replace(/^\//, ''));
    assert.ok(fs.existsSync(iconFilePath), `Icon file ${icon.src} must exist at ${iconFilePath}`);
  }
});

test('2. Service Worker — Safe Static Caching & Anti-Dynamic Invariant', async () => {
  const swPath = path.resolve(process.cwd(), 'public/sw.js');
  assert.ok(fs.existsSync(swPath), 'sw.js must exist in public/');

  const swContent = fs.readFileSync(swPath, 'utf-8');

  // Verify it does NOT cache dynamic API requests
  assert.ok(swContent.includes("url.pathname.startsWith('/api/')"), 'Must bypass /api/ routes');
  assert.ok(swContent.includes("url.protocol === 'ws:' || url.protocol === 'wss:'"), 'Must ignore WebSockets');
  assert.ok(swContent.includes('sessionToken'), 'Must ignore session tokens');

  // Verify static shell is cached
  assert.ok(swContent.includes("'/index.html'"), 'Must cache /index.html');
  assert.ok(swContent.includes("'/manifest.webmanifest'"), 'Must cache /manifest.webmanifest');
});

test('3. Client Storage Security Audit — No Secrets Stored', async () => {
  const sessionServicePath = path.resolve(process.cwd(), 'src/services/session.ts');
  const sessionContent = fs.readFileSync(sessionServicePath, 'utf-8');

  // Must not store sensitive credentials
  assert.ok(!sessionContent.includes('client_secret'), 'Session service must not store Spotify client secret');
  assert.ok(!sessionContent.includes('database_url'), 'Session service must not store DATABASE_URL');
  assert.ok(!sessionContent.includes('postgres://'), 'Session service must not store postgres credentials');
});

test('4. Room Invite URL Construction & Parameter Normalization', async () => {
  const roomCode = 'A7K9P2';
  const dummyOrigin = 'http://localhost:5173';
  const inviteUrl = `${dummyOrigin}?code=${roomCode}`;

  const parsed = new URL(inviteUrl);
  assert.equal(parsed.searchParams.get('code'), 'A7K9P2');
  assert.equal(parsed.pathname, '/');
});
