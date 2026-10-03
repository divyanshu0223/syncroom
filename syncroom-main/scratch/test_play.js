import fs from 'fs';

async function testPlay() {
  const tokenCache = JSON.parse(fs.readFileSync('c:/Users/Victus/Downloads/syncroom (1)/.spotify_auth_cache.json', 'utf8'));
  const session = tokenCache['default-session'] || Object.values(tokenCache)[0];
  const accessToken = session.tokens.accessToken;

  const devicesRes = await fetch('https://api.spotify.com/v1/me/player/devices', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const { devices } = await devicesRes.json();
  const device = devices.find(d => d.name === 'SyncRoom Web Player');
  console.log('Target device:', device);

  if (!device) {
    console.log('Device not found!');
    return;
  }

  // First transfer
  const transferRes = await fetch('https://api.spotify.com/v1/me/player', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      device_ids: [device.id],
      play: false
    })
  });
  console.log('Transfer status:', transferRes.status);
  if (!transferRes.ok && transferRes.status !== 204) {
    console.log('Transfer err:', await transferRes.text());
  }

  // Now play track
  const trackUri = 'spotify:track:5MPLeS9KdZlA04OOCUb5Bt';
  const playRes = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(device.id)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      uris: [trackUri]
    })
  });
  console.log('Play status:', playRes.status);
  if (!playRes.ok && playRes.status !== 204) {
    console.log('Play err:', await playRes.text());
  } else {
    console.log('Play SUCCESSFUL!');
  }
}

testPlay().catch(console.error);
