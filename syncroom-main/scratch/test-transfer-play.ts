import 'dotenv/config';
import { getValidAccessToken } from '../server/spotify/spotifyAuth';

async function testTransferPlay() {
  const sessionId = 'syncroom_session_5b734058e413230a103cc69fda5f3c3a2a5510efe71c67708d12f5776c1cacfb';
  const token = await getValidAccessToken(sessionId);
  
  // Let's get devices first
  const devRes = await fetch('https://api.spotify.com/v1/me/player/devices', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const devData = await devRes.json();
  console.log('Devices:', devData.devices);

  const activeDev = devData.devices.find((d: any) => d.is_active) || devData.devices[0];
  if (!activeDev) {
    console.log('No devices found!');
    return;
  }
  console.log('Target device:', activeDev.id, activeDev.name);

  // 1. Transfer playback with play: true
  console.log('Transferring playback to', activeDev.id, 'with play: true...');
  const transferRes = await fetch('https://api.spotify.com/v1/me/player', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      device_ids: [activeDev.id],
      play: true
    })
  });
  console.log('Transfer status:', transferRes.status);

  // Wait 500ms
  await new Promise(r => setTimeout(r, 500));

  // 2. Start track
  const trackUri = 'spotify:track:5Cyba0XQl1Aux3riLECMuD';
  console.log('Starting track', trackUri, 'on', activeDev.id);
  const playRes = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(activeDev.id)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      uris: [trackUri],
      position_ms: 0
    })
  });
  console.log('Play status:', playRes.status);

  // Wait 1s and check playback state
  await new Promise(r => setTimeout(r, 1000));
  const pbRes = await fetch('https://api.spotify.com/v1/me/player', {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (pbRes.status === 200) {
    const pb = await pbRes.json();
    console.log('After play - is_playing:', pb.is_playing, 'progress_ms:', pb.progress_ms, 'device:', pb.device?.name);
  } else {
    console.log('Playback state status:', pbRes.status);
  }
}

testTransferPlay().catch(console.error);
