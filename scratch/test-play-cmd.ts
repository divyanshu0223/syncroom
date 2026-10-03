import 'dotenv/config';
import { getValidAccessToken } from '../server/spotify/spotifyAuth';

async function testPlay() {
  const sessionId = 'syncroom_session_5b734058e413230a103cc69fda5f3c3a2a5510efe71c67708d12f5776c1cacfb';
  const token = await getValidAccessToken(sessionId);
  const deviceId = '7c6ef4ea8a715cf5942b1e942b6e595a93387b4b';

  console.log('Sending PUT /v1/me/player/play to device', deviceId);
  const playRes = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      uris: ['spotify:track:5Cyba0XQl1Aux3riLECMuD'],
      position_ms: 0
    })
  });

  console.log('Play status:', playRes.status);
  const text = await playRes.text();
  console.log('Play response body:', text || '(empty 204)');
}

testPlay().catch(console.error);
