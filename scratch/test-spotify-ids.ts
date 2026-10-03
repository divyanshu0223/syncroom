import 'dotenv/config';
import { getClientCredentialsToken } from '../server/spotify/spotifyAuth';

async function testPlaylists() {
  const token = await getClientCredentialsToken();
  console.log('App token exists:', Boolean(token));
  if (!token) return;

  // Let's test a few well-known public playlists:
  // 1. Spotify's "Today's Top Hits" ID
  // 2. Spotify's "Rock Classics"
  // 3. User's Gym playlist
  const testIds = [
    '37i9dQZF1DXcBWIGoYBM5M', // Today's Top Hits
    '37i9dQZF1DWXRqgorJj26U', // Rock Classics
    '37i9dQZF1DX4WYpdgoIcn6', // Chill Hits
    '4BRvZLlUWoT1hZGgpthAY7', // User's playlist
  ];

  for (const id of testIds) {
    console.log(`\n--- Testing ${id} ---`);
    const res = await fetch(`https://api.spotify.com/v1/playlists/${id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log(`Status: ${res.status}`);
    if (res.ok) {
      const data: any = await res.json();
      console.log(`Name: ${data.name}, Public: ${data.public}`);
      console.log(`tracks field present?: ${Boolean(data.tracks)}`);
      if (data.tracks) {
        console.log(`tracks.total: ${data.tracks.total}`);
        console.log(`tracks.items length: ${data.tracks.items?.length}`);
        if (data.tracks.items?.length > 0) {
          const item0 = data.tracks.items[0];
          const t = item0.track || item0;
          console.log(`Track 0: "${t.name}" by ${t.artists?.map((a: any) => a.name).join(', ')}`);
          console.log(`is_playable: ${t.is_playable}`);
          console.log(`restrictions:`, t.restrictions);
        }
      }
    } else {
      console.log(`Error body:`, await res.text());
    }
  }
}

testPlaylists().catch(console.error);
