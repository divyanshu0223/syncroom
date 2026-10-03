-- CreateTable
CREATE TABLE IF NOT EXISTS "playlists" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "playlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "playlist_tracks" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "spotifyTrackId" TEXT NOT NULL,
    "spotifyUri" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "artists" TEXT NOT NULL,
    "album" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "albumArtUrl" TEXT,
    "spotifyUrl" TEXT,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "playlist_tracks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "playlists_ownerId_idx" ON "playlists"("ownerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "playlists_ownerId_createdAt_idx" ON "playlists"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "playlist_tracks_playlistId_idx" ON "playlist_tracks"("playlistId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "playlist_tracks_playlistId_position_idx" ON "playlist_tracks"("playlistId", "position");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "playlist_tracks_playlistId_spotifyTrackId_key" ON "playlist_tracks"("playlistId", "spotifyTrackId");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'playlist_tracks_playlistId_fkey'
    ) THEN
        ALTER TABLE "playlist_tracks" ADD CONSTRAINT "playlist_tracks_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "playlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
