import fs from 'fs';

async function testDeviceResolution() {
  const tokenCache = JSON.parse(fs.readFileSync('c:/Users/Victus/Downloads/syncroom (1)/.spotify_auth_cache.json', 'utf8'));
  const session = tokenCache['default-session'] || Object.values(tokenCache)[0];
  const accessToken = session.tokens.accessToken;

  // Let's get the list of devices
  const res = await fetch('https://api.spotify.com/v1/me/player/devices', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await res.json();
  console.log('Available Spotify devices:', data.devices);

  // If a deviceId is "08285eaeeb051e4268bcf48e88d77fae581b10d8" (which was reported missing):
  const targetId = '08285eaeeb051e4268bcf48e88d77fae581b10d8';
  const found = data.devices?.find(d => d.id === targetId);
  console.log('Is targetId in devices list?', Boolean(found));

  // Find any device named "SyncRoom Web Player"
  const syncRoomDevice = data.devices?.find(d => d.name === 'SyncRoom Web Player');
  console.log('Found SyncRoom Web Player device:', syncRoomDevice);
}

testDeviceResolution().catch(console.error);
