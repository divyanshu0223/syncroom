import { prisma } from '../../src/db/prisma';

async function main() {
  try {
    const users = await prisma.user.findMany({ select: { id: true, name: true } });
    const playlists = await prisma.customPlaylist.findMany({ select: { id: true, ownerId: true, name: true } });
    console.log('User count:', users.length);
    console.log('Users sample:', users.slice(0, 5));
    console.log('Playlist count:', playlists.length);
    console.log('Playlists sample:', playlists.slice(0, 5));

    for (const p of playlists) {
      const u = await prisma.user.findUnique({ where: { id: p.ownerId } });
      console.log(`Playlist ${p.id} owner ${p.ownerId} exists in User table:`, !!u);
    }
  } catch (err) {
    console.error('Error querying DB:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
