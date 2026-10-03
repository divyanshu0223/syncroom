import fs from 'fs';

async function checkDevices() {
  const tokenCache = JSON.parse(fs.readFileSync('c:/Users/Victus/Downloads/syncroom (1)/.spotify_auth_cache.json', 'utf8'));
  const session = tokenCache['default-session'] || Object.values(tokenCache)[0];
  const accessToken = session.tokens.accessToken;

  const res = await fetch('https://api.spotify.com/v1/me/player/devices', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  console.log('Status:', res.status);
  const data = await res.json();
  console.log('Devices:', JSON.stringify(data, null, 2));

  const playerRes = await fetch('https://api.spotify.com/v1/me/player', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  console.log('Player status:', playerRes.status);
  if (playerRes.status === 200) {
    const playerData = await playerRes.json();
    console.log('Current player:', playerData?.device);
  }
}

checkDevices().catch(console.error);
