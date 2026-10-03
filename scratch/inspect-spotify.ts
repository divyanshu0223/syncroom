import 'dotenv/config';
import { getClientCredentialsToken } from '../server/spotify/spotifyAuth';

async function test() {
  const token = await getClientCredentialsToken();
  if (!token) return;

  const playlistId = '4BRvZLlUWoT1hZGgpthAY7';
  
  // Test 1: /tracks
  const resTracks = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=10`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log('Test 1 (/tracks) status:', resTracks.status);
  const dataTracks = await resTracks.json();
  console.log('Test 1 body:', JSON.stringify(dataTracks).slice(0, 300));

  // Test 2: public playlist like Today's Top Hits (37i9dQZF1DXcBWIGoYBM5M)
  const topHits = '37i9dQZF1DXcBWIGoYBM5M';
  const resTop = await fetch(`https://api.spotify.com/v1/playlists/${topHits}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log('Test 2 (Top Hits) status:', resTop.status);
  const dataTop: any = await resTop.json();
  console.log('Test 2 tracks total:', dataTop.tracks?.total, 'items len:', dataTop.tracks?.items?.length);
  if (dataTop.tracks?.items?.length > 0) {
    console.log('Top Hits track 0:', dataTop.tracks.items[0]?.track?.name);
  }
}

test().catch(console.error);
