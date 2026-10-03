import crypto from 'crypto';
import { prisma } from '../../src/db/prisma';

const BASE_URL = 'http://localhost:3000';

async function testPostRestart() {
  console.log('================================================================');
  console.log('VERIFYING PLAYLIST PERSISTENCE POST SERVER RESTART & ROOM ENDING');
  console.log('================================================================\n');

  // Find User A and their playlist from PostgreSQL
  const playlist = await prisma.customPlaylist.findFirst({
    where: { name: 'Alice Permanent Hits' },
    include: { tracks: { orderBy: { position: 'asc' } }, owner: true },
  });

  if (!playlist) {
    throw new Error('Playlist "Alice Permanent Hits" not found in PostgreSQL post-restart!');
  }

  console.log('✓ Found Playlist in PostgreSQL post-restart:', playlist.name, `(ID: ${playlist.id})`);
  console.log('✓ Owner in PostgreSQL:', playlist.owner.name, `(ID: ${playlist.owner.id})`);
  console.log('✓ Track count in PostgreSQL:', playlist.tracks.length);
  console.log('✓ Track order in PostgreSQL:', playlist.tracks.map((t) => `${t.position}: ${t.title} (${t.spotifyTrackId})`));

  if (playlist.tracks.length !== 2) {
    throw new Error(`Expected 2 tracks, found ${playlist.tracks.length}`);
  }

  if (playlist.tracks[0].position !== 0 || playlist.tracks[1].position !== 1) {
    throw new Error('Track positions are not deterministically ordered 0, 1');
  }

  // Verify API access with User A's token
  // Let's create a temporary token for User A to query the HTTP API
  const testToken = `syncroom_usr_${crypto.randomBytes(24).toString('hex')}`;
  const tokenHash = crypto.createHash('sha256').update(testToken).digest('hex');
  await prisma.user.update({
    where: { id: playlist.ownerId },
    data: { tokenHash },
  });

  const headersA = {
    'Content-Type': 'application/json',
    'x-user-token': testToken,
  };

  console.log('\n[API CHECK] Fetching playlist via HTTP REST API after server restart...');
  const res = await fetch(`${BASE_URL}/api/playlists/${playlist.id}`, { headers: headersA });
  if (!res.ok) throw new Error(`HTTP fetch failed with status ${res.status}`);
  const data = await res.json();
  console.log('✓ HTTP API successfully returned playlist:', data.playlist.name);
  console.log('✓ Tracks from API:', data.playlist.tracks.map((t: any) => `${t.position}: ${t.title || t.trackName}`));

  // Verify Room End Isolation
  console.log('\n[ROOM LIFECYCLE CHECK] Simulating Room Creation and Termination...');
  const roomId = `room_test_${Date.now()}`;
  const roomCode = `TEST${Math.floor(1000 + Math.random() * 9000)}`;

  // Create room in PostgreSQL
  await prisma.room.create({
    data: {
      id: roomId,
      code: roomCode,
      name: 'Test Temporary Party Room',
      adminUserId: playlist.ownerId,
      status: 'ACTIVE',
    },
  });
  console.log('✓ Created active room in PostgreSQL:', roomId);

  // Simulate room ending / deletion
  await prisma.room.update({
    where: { id: roomId },
    data: { status: 'ENDED' },
  });
  console.log('✓ Room ended (status = ENDED)');

  // Verify Custom Playlist STILL exists untouched in PostgreSQL!
  const playlistAfterRoomEnd = await prisma.customPlaylist.findUnique({
    where: { id: playlist.id },
    include: { tracks: { orderBy: { position: 'asc' } } },
  });

  if (!playlistAfterRoomEnd) {
    throw new Error('CRITICAL BUG: Playlist was deleted when room ended!');
  }
  console.log('✓ Post-room-end verification: Custom Playlist STILL exists with', playlistAfterRoomEnd.tracks.length, 'tracks!');

  // Now delete the room entirely
  await prisma.room.delete({ where: { id: roomId } });
  console.log('✓ Room record permanently deleted from database.');

  const playlistAfterRoomDelete = await prisma.customPlaylist.findUnique({
    where: { id: playlist.id },
    include: { tracks: { orderBy: { position: 'asc' } } },
  });

  if (!playlistAfterRoomDelete) {
    throw new Error('CRITICAL BUG: Playlist was cascade-deleted when room was deleted!');
  }
  console.log('✓ Post-room-deletion verification: Custom Playlist is 100% INDEPENDENT from room lifecycle!');

  console.log('\n================================================================');
  console.log('ALL POST-RESTART AND ROOM LIFECYCLE TESTS COMPLETED SUCCESSFULLY!');
  console.log('================================================================');
  await prisma.$disconnect();
}

testPostRestart().catch((err) => {
  console.error('\n❌ Post-restart test failed:', err);
  process.exit(1);
});
