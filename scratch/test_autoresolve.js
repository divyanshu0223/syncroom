async function testAutoResolution() {
  const tokenCache = JSON.parse(await import('fs').then(fs => fs.readFileSync('c:/Users/Victus/Downloads/syncroom (1)/.spotify_auth_cache.json', 'utf8')));
  const session = tokenCache['default-session'] || Object.values(tokenCache)[0];

  // We pass an outdated / non-existent deviceId to trigger auto-resolution
  const staleDeviceId = '08285eaeeb051e4268bcf48e88d77fae581b10d8';

  console.log('Testing PUT /api/spotify/playback/play with outdated deviceId:', staleDeviceId);
  const res = await fetch('http://localhost:3000/api/spotify/playback/play', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-session-id': 'default-session'
    },
    body: JSON.stringify({
      sessionId: 'default-session',
      deviceId: staleDeviceId,
      uris: ['spotify:track:5MPLeS9KdZlA04OOCUb5Bt'],
      positionMs: 0
    })
  });

  console.log('Status code:', res.status);
  const data = await res.json();
  console.log('Response body:', data);
}

testAutoResolution().catch(console.error);
