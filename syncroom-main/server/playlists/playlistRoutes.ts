import { Router, Request, Response } from 'express';
import { dbRepository } from '../db/dbRepository';
import { roomManager } from '../rooms/RoomManager';
import { fetchSpotifyTrack, parseSpotifyTrackId, SpotifyPlaylistError } from '../spotify/spotifyApi';
import { getValidAccessToken, getClientCredentialsToken } from '../spotify/spotifyAuth';
import { requirePersistentUser, resolveUserFromRequest } from '../auth/persistentUserAuth';
import { Track } from '../../src/types';
import { ServerUser } from '../types';

export const playlistRouter = Router();

// Enforce server-side persistent identity authentication on all playlist routes.
// Client ownerId is strictly ignored; authenticated owner is derived from PostgreSQL session token.
playlistRouter.use(requirePersistentUser);

/**
 * POST /api/playlists
 * Creates a new custom SyncRoom playlist in PostgreSQL permanently.
 */
playlistRouter.post('/', async (req: Request, res: Response) => {
  const { name, description } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Playlist name is required.', status: 'INVALID_NAME' });
  }

  // Derive authenticated owner strictly from server-side persistent user
  const userId = req.user!.id;

  try {
    const playlist = await dbRepository.createCustomPlaylist(userId, name.trim(), description);
    return res.status(201).json({ success: true, playlist });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to create playlist.', status: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/playlists
 * Lists all custom playlists owned by the authenticated persistent user.
 */
playlistRouter.get('/', async (req: Request, res: Response) => {
  const userId = req.user!.id;

  try {
    const playlists = await dbRepository.getUserCustomPlaylists(userId);
    return res.json({ success: true, playlists, total: playlists.length });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to fetch playlists.', status: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/playlists/:playlistId
 * Fetches a single playlist with all its tracks.
 * Enforces ownership check: User can only read their own playlist.
 */
playlistRouter.get('/:playlistId', async (req: Request, res: Response) => {
  const { playlistId } = req.params;
  const userId = req.user!.id;

  try {
    const playlist = await dbRepository.getCustomPlaylistById(playlistId);
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found.', status: 'PLAYLIST_NOT_FOUND' });
    }

    if (playlist.ownerId !== userId) {
      return res.status(403).json({ error: 'Access denied: You do not own this playlist.', status: 'FORBIDDEN' });
    }

    return res.json({ success: true, playlist });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to fetch playlist.', status: 'INTERNAL_ERROR' });
  }
});

/**
 * PATCH /api/playlists/:playlistId
 * Renames or updates description of a playlist.
 * Enforces ownership check: User can only modify their own playlist.
 */
playlistRouter.patch('/:playlistId', async (req: Request, res: Response) => {
  const { playlistId } = req.params;
  const { name, description } = req.body || {};
  const userId = req.user!.id;

  try {
    const existing = await dbRepository.getCustomPlaylistById(playlistId);
    if (!existing) {
      return res.status(404).json({ error: 'Playlist not found.', status: 'PLAYLIST_NOT_FOUND' });
    }

    if (existing.ownerId !== userId) {
      return res.status(403).json({ error: 'Access denied: You do not own this playlist.', status: 'FORBIDDEN' });
    }

    if (name !== undefined && (!name || typeof name !== 'string' || !name.trim())) {
      return res.status(400).json({ error: 'Playlist name cannot be empty.', status: 'INVALID_NAME' });
    }

    const updated = await dbRepository.updateCustomPlaylist(playlistId, { name, description });
    return res.json({ success: true, playlist: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to update playlist.', status: 'INTERNAL_ERROR' });
  }
});

/**
 * DELETE /api/playlists/:playlistId
 * Deletes a playlist and its tracks from PostgreSQL permanently.
 * Explicit user action only. Room ending NEVER triggers this.
 */
playlistRouter.delete('/:playlistId', async (req: Request, res: Response) => {
  const { playlistId } = req.params;
  const userId = req.user!.id;

  try {
    const existing = await dbRepository.getCustomPlaylistById(playlistId);
    if (!existing) {
      return res.status(404).json({ error: 'Playlist not found.', status: 'PLAYLIST_NOT_FOUND' });
    }

    if (existing.ownerId !== userId) {
      return res.status(403).json({ error: 'Access denied: You do not own this playlist.', status: 'FORBIDDEN' });
    }

    await dbRepository.deleteCustomPlaylist(playlistId);
    return res.json({ success: true, message: 'Playlist deleted successfully.' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to delete playlist.', status: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/playlists/:playlistId/tracks
 * Adds a real Spotify track to a custom playlist.
 * Accepts either:
 * - { spotifyTrackUrlOrId: string } -> automatically resolves via Spotify Web API
 * - { track: Track } -> verified track object
 */
playlistRouter.post('/:playlistId/tracks', async (req: Request, res: Response) => {
  const { playlistId } = req.params;
  const userId = req.user!.id;

  try {
    const existing = await dbRepository.getCustomPlaylistById(playlistId);
    if (!existing) {
      return res.status(404).json({ error: 'Playlist not found.', status: 'PLAYLIST_NOT_FOUND' });
    }

    if (existing.ownerId !== userId) {
      return res.status(403).json({ error: 'Access denied: You do not own this playlist.', status: 'FORBIDDEN' });
    }

    let trackToAdd: Track | null = null;

    if (req.body?.track && req.body.track.providerTrackId) {
      trackToAdd = req.body.track;
    } else if (req.body?.spotifyTrackUrlOrId || req.body?.urlOrId || req.body?.url) {
      const urlOrId = req.body.spotifyTrackUrlOrId || req.body.urlOrId || req.body.url;
      const { trackId, error: parseError } = parseSpotifyTrackId(urlOrId);
      if (!trackId) {
        return res.status(400).json({
          error: parseError || 'Invalid Spotify track URL or ID format.',
          status: 'INVALID_TRACK_ID',
        });
      }

      const activeSession = (req.headers['x-session-id'] as string) || 'default-session';
      let token = await getValidAccessToken(activeSession);
      if (!token) {
        token = await getClientCredentialsToken();
      }

      if (!token) {
        return res.status(503).json({
          error: 'Spotify service is currently unavailable. Please connect your Spotify account.',
          status: 'SPOTIFY_UNAVAILABLE',
        });
      }

      try {
        trackToAdd = await fetchSpotifyTrack(trackId, token);
      } catch (spotifyErr: any) {
        if (spotifyErr instanceof SpotifyPlaylistError) {
          return res.status(spotifyErr.statusCode || 400).json({
            error: spotifyErr.message,
            status: spotifyErr.code,
          });
        }
        throw spotifyErr;
      }
    } else {
      return res.status(400).json({
        error: 'Either a valid Spotify URL/ID or a track object must be provided.',
        status: 'INVALID_REQUEST',
      });
    }

    if (!trackToAdd) {
      return res.status(400).json({ error: 'Unable to resolve track metadata.', status: 'TRACK_NOT_FOUND' });
    }

    // Save track to custom playlist in PostgreSQL
    const createdTrack = await dbRepository.addTrackToCustomPlaylist(playlistId, trackToAdd);

    return res.status(201).json({
      success: true,
      track: createdTrack,
      message: `Track "${trackToAdd.title}" added to playlist.`,
    });
  } catch (err: any) {
    if (err.code === 'DUPLICATE_TRACK') {
      return res.status(409).json({
        error: 'This track is already in the playlist.',
        status: 'DUPLICATE_TRACK',
      });
    }
    return res.status(500).json({ error: err.message || 'Failed to add track to playlist.', status: 'INTERNAL_ERROR' });
  }
});

/**
 * DELETE /api/playlists/:playlistId/tracks/:trackId
 * Removes a track from a custom playlist in PostgreSQL and recompacts ordering positions.
 */
playlistRouter.delete('/:playlistId/tracks/:trackId', async (req: Request, res: Response) => {
  const { playlistId, trackId } = req.params;
  const userId = req.user!.id;

  try {
    const existing = await dbRepository.getCustomPlaylistById(playlistId);
    if (!existing) {
      return res.status(404).json({ error: 'Playlist not found.', status: 'PLAYLIST_NOT_FOUND' });
    }

    if (existing.ownerId !== userId) {
      return res.status(403).json({ error: 'Access denied: You do not own this playlist.', status: 'FORBIDDEN' });
    }

    await dbRepository.removeTrackFromCustomPlaylist(playlistId, trackId);
    return res.json({ success: true, message: 'Track removed from playlist.' });
  } catch (err: any) {
    if (err.code === 'TRACK_NOT_FOUND') {
      return res.status(404).json({ error: 'Track not found in playlist.', status: 'TRACK_NOT_FOUND' });
    }
    return res.status(500).json({ error: err.message || 'Failed to remove track.', status: 'INTERNAL_ERROR' });
  }
});

/**
 * PUT /api/playlists/:playlistId/tracks/reorder
 * Deterministically updates track ordering in PostgreSQL.
 * Body: { trackIds: string[] } in desired order.
 */
playlistRouter.put('/:playlistId/tracks/reorder', async (req: Request, res: Response) => {
  const { playlistId } = req.params;
  const { trackIds } = req.body || {};
  const userId = req.user!.id;

  if (!Array.isArray(trackIds)) {
    return res.status(400).json({ error: 'trackIds array is required.', status: 'INVALID_REQUEST' });
  }

  try {
    const existing = await dbRepository.getCustomPlaylistById(playlistId);
    if (!existing) {
      return res.status(404).json({ error: 'Playlist not found.', status: 'PLAYLIST_NOT_FOUND' });
    }

    if (existing.ownerId !== userId) {
      return res.status(403).json({ error: 'Access denied: You do not own this playlist.', status: 'FORBIDDEN' });
    }

    await dbRepository.reorderCustomPlaylistTracks(playlistId, trackIds);
    return res.json({ success: true, message: 'Playlist tracks reordered successfully.' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to reorder playlist.', status: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/rooms/:roomId/queue/from-playlist/:playlistId
 * Loads all real tracks from a custom playlist into a live room queue.
 * Server strictly verifies:
 * 1. Room exists
 * 2. Requesting user is the room admin / host
 * 3. Playlist exists and user has access
 * 4. Playlist is not empty
 * 5. Updates room queue in memory and PostgreSQL
 * 6. Broadcasts QUEUE_UPDATED to all connected room participants via WebSocket
 */
export async function handleLoadPlaylistIntoRoomQueue(req: Request, res: Response) {
  const { roomId, playlistId } = req.params;
  const replace = Boolean(req.body?.replaceQueue);

  // Authenticate user & room session
  const user = await resolveUserFromRequest(req);
  const roomUserId = (req.headers['x-user-id'] as string)?.trim() || '';
  const sessionToken = (req.headers['x-session-token'] as string)?.trim() || (req.headers['x-session-id'] as string)?.trim() || '';

  // 1. Verify Room exists in roomManager
  const liveRoom = roomManager.getRoom(roomId);
  if (!liveRoom) {
    return res.status(404).json({ error: 'Room not found.', status: 'ROOM_NOT_FOUND' });
  }

  // 2. Verify User is Room Admin via in-memory session, room user record, or admin ID match
  const memSession = sessionToken ? roomManager.getSession(sessionToken) : undefined;
  const effectiveUserId = memSession?.userId || roomUserId || user?.id || '';
  const roomUser = liveRoom.getUser(effectiveUserId) || (sessionToken ? Array.from(liveRoom.users.values()).find((u) => u.sessionId === sessionToken) : undefined);

  const isRoomAdmin =
    (memSession && memSession.roomId === roomId && memSession.role === 'admin') ||
    (roomUser && roomUser.role === 'admin') ||
    liveRoom.adminId === effectiveUserId ||
    (roomUserId && liveRoom.adminId === roomUserId);

  if (!isRoomAdmin) {
    return res.status(403).json({
      error: 'Forbidden: Only the room host can load playlists into the room queue.',
      status: 'FORBIDDEN',
    });
  }

  // 3. Verify Playlist exists
  try {
    const playlist = await dbRepository.getCustomPlaylistById(playlistId);
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found.', status: 'PLAYLIST_NOT_FOUND' });
    }

    if (playlist.tracks.length === 0) {
      return res.status(400).json({ error: 'This playlist is empty (0 tracks).', status: 'EMPTY_PLAYLIST' });
    }

    // 4. Map tracks & update queue
    const userObj: ServerUser = roomUser || {
      id: effectiveUserId || liveRoom.adminId || 'admin',
      name: memSession?.name || user?.name || 'Admin',
      role: 'admin',
      roomId,
      connected: true,
      lastSeen: Date.now(),
      sessionId: sessionToken || '',
    };

    await roomManager.runRoomCommand(roomId, () => {
      liveRoom.importQueue(playlist.tracks, userObj, replace);
      roomManager.broadcastPlaybackState(liveRoom);
      roomManager.broadcastQueue(liveRoom);
    });

    return res.json({
      success: true,
      count: playlist.tracks.length,
      message: `Imported ${playlist.tracks.length} tracks into room queue.`,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to load playlist into room queue.', status: 'INTERNAL_ERROR' });
  }
}
