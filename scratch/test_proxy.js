async function testProxy() {
  const tokenCache = JSON.parse(await import('fs').then(fs => fs.readFileSync('c:/Users/Victus/Downloads/syncroom (1)/.spotify_auth_cache.json', 'utf8')));
  const session = tokenCache['default-session'] || Object.values(tokenCache)[0];
  const accessToken = session.tokens.accessToken;

  // Let's get device
  const devicesRes = await fetch('https://api.spotify.com/v1/me/player/devices', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const { devices } = await devicesRes.json();
  const device = devices.find(d => d.name === 'SyncRoom Web Player');
  console.log('Device:', device?.id);

  if (!device) return;

  const res = await fetch('http://localhost:3000/api/spotify/playback/play', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-session-id': 'default-session'
    },
    body: JSON.stringify({
      sessionId: 'default-session',
      deviceId: device.id,
      uris: ['spotify:track:5MPLeS9KdZlA04OOCUb5Bt'],
      positionMs: 0
    })
  });

  console.log('Proxy response status:', res.status);
  const text = await res.text();
  console.log('Proxy response body:', text);
}

testProxy().catch(console.error);
