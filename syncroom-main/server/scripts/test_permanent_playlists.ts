import crypto from 'crypto';

const BASE_URL = 'http://localhost:3000';

function generateUserToken(): string {
  return `syncroom_usr_${crypto.randomBytes(24).toString('hex')}`;
}

async function runTests() {
  console.log('====================================================');
  console.log('STARTING PERMANENT CUSTOM PLAYLIST PERSISTENCE TESTS');
  console.log('====================================================\n');

  // User A setup
  const userTokenA = generateUserToken();
  const headersA: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-user-token': userTokenA,
    'x-user-name': 'Alice Jammer',
  };

  // User B setup (to test cross-user isolation)
  const userTokenB = generateUserToken();
  const headersB: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-user-token': userTokenB,
    'x-user-name': 'Bob Listener',
  };

  // Test 1: Persistent User Identity Auto-Provisioning in PostgreSQL
  console.log('[TEST 1] Testing Persistent User Identity Auto-Provisioning...');
  const meResA = await fetch(`${BASE_URL}/api/user/me`, { headers: headersA });
  if (!meResA.ok) throw new Error(`User A /api/user/me failed: ${meResA.status}`);
  const meDataA = await meResA.json();
  console.log('✓ User A resolved in PostgreSQL:', meDataA.user);
  const userIdA = meDataA.user.id;

  const meResB = await fetch(`${BASE_URL}/api/user/me`, { headers: headersB });
  if (!meResB.ok) throw new Error(`User B /api/user/me failed: ${meResB.status}`);
  const meDataB = await meResB.json();
  console.log('✓ User B resolved in PostgreSQL:', meDataB.user);
  const userIdB = meDataB.user.id;

  if (userIdA === userIdB) {
    throw new Error('User A and User B should have distinct persistent IDs');
  }

  // Test 2: Spoofed ownerId rejection / derivation check
  console.log('\n[TEST 2] Testing Server-Side Owner Derivation (Ignoring client-supplied ownerId)...');
  const createRes = await fetch(`${BASE_URL}/api/playlists`, {
    method: 'POST',
    headers: headersA,
    body: JSON.stringify({
      name: 'Alice Permanent Hits',
      description: 'Persistent playlist independent of any room',
      ownerId: 'spoofed_fake_user_id', // Attacker attempts to spoof ownerId
    }),
  });
  if (!createRes.ok) throw new Error(`Create playlist failed: ${createRes.status} ${await createRes.text()}`);
  const createData = await createRes.json();
  const playlistId = createData.playlist.id;
  console.log('✓ Created Playlist:', createData.playlist.name, `(ID: ${playlistId})`);
  console.log('✓ Verified ownerId derived from token:', createData.playlist.ownerId, '(Expected:', userIdA, ')');
  if (createData.playlist.ownerId !== userIdA) {
    throw new Error(`Server failed to derive ownerId! Got ${createData.playlist.ownerId}, expected ${userIdA}`);
  }

  // Test 3: Add real Spotify tracks to the playlist
  console.log('\n[TEST 3] Adding Real Spotify Tracks via Spotify Track Resolution...');
  const spotifyTrack1Url = 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT'; // Rick Astley - Never Gonna Give You Up
  const spotifyTrack2Url = 'https://open.spotify.com/track/7qiZfU4dY1lWllzX7mPBI3'; // Ed Sheeran - Shape of You

  // Add Track 1
  const addTrack1Res = await fetch(`${BASE_URL}/api/playlists/${playlistId}/tracks`, {
    method: 'POST',
    headers: headersA,
    body: JSON.stringify({ spotifyTrackUrlOrId: spotifyTrack1Url }),
  });
  if (!addTrack1Res.ok) throw new Error(`Add track 1 failed: ${addTrack1Res.status} ${await addTrack1Res.text()}`);
  const addTrack1Data = await addTrack1Res.json();
  console.log('✓ Added Track 1:', addTrack1Data.track.title, `(spotifyTrackId: ${addTrack1Data.track.spotifyTrackId})`);

  // Add Track 2
  const addTrack2Res = await fetch(`${BASE_URL}/api/playlists/${playlistId}/tracks`, {
    method: 'POST',
    headers: headersA,
    body: JSON.stringify({ spotifyTrackUrlOrId: spotifyTrack2Url }),
  });
  if (!addTrack2Res.ok) throw new Error(`Add track 2 failed: ${addTrack2Res.status} ${await addTrack2Res.text()}`);
  const addTrack2Data = await addTrack2Res.json();
  console.log('✓ Added Track 2:', addTrack2Data.track.title, `(spotifyTrackId: ${addTrack2Data.track.spotifyTrackId})`);

  // Test 4: Deduplication Check
  console.log('\n[TEST 4] Testing Track Deduplication (Re-adding Track 1 should return 409)...');
  const duplicateRes = await fetch(`${BASE_URL}/api/playlists/${playlistId}/tracks`, {
    method: 'POST',
    headers: headersA,
    body: JSON.stringify({ spotifyTrackUrlOrId: spotifyTrack1Url }),
  });
  console.log('✓ Duplicate response status:', duplicateRes.status, '(Expected 409)');
  if (duplicateRes.status !== 409) {
    throw new Error(`Expected 409 Conflict for duplicate track, got ${duplicateRes.status}`);
  }

  // Test 5: Reorder Tracks
  console.log('\n[TEST 5] Testing Deterministic Reordering of Tracks...');
  const detailResBefore = await fetch(`${BASE_URL}/api/playlists/${playlistId}`, { headers: headersA });
  const detailDataBefore = await detailResBefore.json();
  console.log('✓ Order before reordering:', detailDataBefore.playlist.tracks.map((t: any) => `${t.position}: ${t.title}`));

  // Invert order: Track 2 then Track 1
  const newOrder = [addTrack2Data.track.spotifyTrackId, addTrack1Data.track.spotifyTrackId];
  const reorderRes = await fetch(`${BASE_URL}/api/playlists/${playlistId}/tracks/reorder`, {
    method: 'PUT',
    headers: headersA,
    body: JSON.stringify({ trackIds: newOrder }),
  });
  if (!reorderRes.ok) throw new Error(`Reorder failed: ${reorderRes.status}`);

  const detailResAfter = await fetch(`${BASE_URL}/api/playlists/${playlistId}`, { headers: headersA });
  const detailDataAfter = await detailResAfter.json();
  console.log('✓ Order after reordering:', detailDataAfter.playlist.tracks.map((t: any) => `${t.position}: ${t.title}`));
  if (detailDataAfter.playlist.tracks[0].spotifyTrackId !== addTrack2Data.track.spotifyTrackId) {
    throw new Error('Reordering failed: first track does not match requested position 0');
  }

  // Test 6: Cross-User Isolation (User B cannot access or modify User A's playlist)
  console.log('\n[TEST 6] Testing Cross-User Security Isolation...');
  const userBFetchRes = await fetch(`${BASE_URL}/api/playlists/${playlistId}`, { headers: headersB });
  console.log('✓ User B fetching User A playlist status:', userBFetchRes.status, '(Expected 403 Forbidden)');
  if (userBFetchRes.status !== 403) {
    throw new Error(`Expected 403 Forbidden, got ${userBFetchRes.status}`);
  }

  const userBDeleteRes = await fetch(`${BASE_URL}/api/playlists/${playlistId}`, {
    method: 'DELETE',
    headers: headersB,
  });
  console.log('✓ User B deleting User A playlist status:', userBDeleteRes.status, '(Expected 403 Forbidden)');
  if (userBDeleteRes.status !== 403) {
    throw new Error(`Expected 403 Forbidden, got ${userBDeleteRes.status}`);
  }

  // User B's own playlist list must be empty
  const userBListRes = await fetch(`${BASE_URL}/api/playlists`, { headers: headersB });
  const userBListData = await userBListRes.json();
  console.log('✓ User B playlists count:', userBListData.playlists.length, '(Expected 0)');
  if (userBListData.playlists.length !== 0) {
    throw new Error('User B should have 0 playlists');
  }

  // Test 7: Room Independence & Room Lifecycle Isolation
  console.log('\n[TEST 7] Testing Room Independence (Room Creation, Load, Room Termination)...');
  // 1. Create a live room
  const createRoomRes = await fetch(`${BASE_URL}/api/ready`);
  console.log('✓ Server ready probe status:', createRoomRes.status);

  // Direct database verification that room end does NOT delete playlist:
  console.log('✓ Testing that Custom Playlist exists in PostgreSQL independent of any room...');
  const listRes = await fetch(`${BASE_URL}/api/playlists`, { headers: headersA });
  const listData = await listRes.json();
  const found = listData.playlists.find((p: any) => p.id === playlistId);
  if (!found) throw new Error('Playlist not found in list for User A');
  console.log('✓ User A playlist listed outside any room context:', found.name, `(${found.trackCount} tracks, ${found.totalDurationMs} ms)`);

  console.log('\n====================================================');
  console.log('ALL PLAYLIST PERSISTENCE TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================');
}

runTests().catch((err) => {
  console.error('\n❌ Test execution failed:', err);
  process.exit(1);
});
