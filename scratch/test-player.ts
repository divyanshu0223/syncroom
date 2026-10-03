import 'dotenv/config';
import { getValidAccessToken } from '../server/spotify/spotifyAuth';

async function checkPlayer() {
  const sessionId = 'syncroom_session_5b734058e413230a103cc69fda5f3c3a2a5510efe71c67708d12f5776c1cacfb';
  const token = await getValidAccessToken(sessionId);
  console.log('Token exists:', Boolean(token));
  if (!token) return;

  // 1. Get available devices
  const devRes = await fetch('https://api.spotify.com/v1/me/player/devices', {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log('Devices status:', devRes.status);
  const devData = await devRes.json();
  console.log('Available devices:', JSON.stringify(devData, null, 2));

  // 2. Get current playback state
  const pbRes = await fetch('https://api.spotify.com/v1/me/player', {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log('Playback state status:', pbRes.status);
  if (pbRes.status === 200) {
    const pbData = await pbRes.json();
    console.log('Current device:', pbData?.device?.name, 'id:', pbData?.device?.id);
    console.log('Is playing:', pbData?.is_playing);
    console.log('Track:', pbData?.item?.name, 'uri:', pbData?.item?.uri);
  }
}

checkPlayer().catch(console.error);
