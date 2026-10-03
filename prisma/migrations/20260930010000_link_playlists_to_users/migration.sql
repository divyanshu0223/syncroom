-- AlterTable User: add tokenHash column and unique index
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tokenHash" TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'User_tokenHash_key' AND n.nspname = 'public'
    ) THEN
        CREATE UNIQUE INDEX "User_tokenHash_key" ON "User"("tokenHash");
    END IF;
END $$;

-- Add foreign key constraint from playlists(ownerId) to User(id)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'playlists_ownerId_fkey'
    ) THEN
        ALTER TABLE "playlists" ADD CONSTRAINT "playlists_ownerId_fkey" 
            FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
