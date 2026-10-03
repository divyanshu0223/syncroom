import { Track, Playlist, PlaybackStatus, RestrictionReason, PlaylistImportStatus, UserPlaylistSummary } from '../../src/types';

/**
 * Custom error class for Spotify playlist operations with explicit status codes.
 */
export class SpotifyPlaylistError extends Error {
  public readonly status: PlaylistImportStatus | string;
  public readonly httpStatus: number;

  constructor(status: PlaylistImportStatus | string, message: string, httpStatus: number = 400) {
    super(message);
    this.name = 'SpotifyPlaylistError';
    this.status = status;
    this.httpStatus = httpStatus;
  }

  public get code(): string {
    return String(this.status);
  }

  public get statusCode(): number {
    return this.httpStatus;
  }
}

/**
 * Extracts and validates a Spotify Playlist ID from various formats:
 * - https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=...
 * - https://open.spotify.com/intl-ja/playlist/37i9dQZF1DXcBWIGoYBM5M
 * - spotify:playlist:37i9dQZF1DXcBWIGoYBM5M
 * - 37i9dQZF1DXcBWIGoYBM5M (direct alphanumeric 22 chars)
 */
export function extractSpotifyPlaylistId(input: string): string | null {
  if (!input || typeof input !== 'string') return null;

  const trimmed = input.trim();

  // Format 1: spotify:playlist:ID
  const uriMatch = trimmed.match(/^spotify:playlist:([a-zA-Z0-9]{22})$/i);
  if (uriMatch) {
    return uriMatch[1];
  }

  // Format 2: https://open.spotify.com/.../playlist/ID
  const urlMatch = trimmed.match(/open\.spotify\.com\/(?:[a-z]{2,5}(?:-[a-z]{2,5})?\/)?playlist\/([a-zA-Z0-9]{22})/i);
  if (urlMatch) {
    return urlMatch[1];
  }

  // Format 3: Direct 22-character Spotify ID
  if (/^[a-zA-Z0-9]{22}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

const GRADIENT_PALETTES = [
  { from: '#18181b', via: '#27272a', to: '#09090b', accent: '#1db954', pattern: 'geometry' as const },
  { from: '#1e1b4b', via: '#0f172a', to: '#020617', accent: '#38bdf8', pattern: 'aurora' as const },
  { from: '#292524', via: '#1c1917', to: '#0c0a09', accent: '#f59e0b', pattern: 'rings' as const },
  { from: '#134e4a', via: '#042f2e', to: '#021614', accent: '#2dd4bf', pattern: 'grid' as const },
  { from: '#312e81', via: '#1e1b4b', to: '#0f0e17', accent: '#c084fc', pattern: 'waves' as const },
];

function generateCoverGradient(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % GRADIENT_PALETTES.length;
  return GRADIENT_PALETTES[idx];
}

/**
 * Normalizes Spotify track object into SyncRoom Track model.
 * Inspects: id, name, artists, album, duration_ms, is_playable, restrictions, external_urls.spotify.
 * Handles both modern 2026 schema ({ item: { ... } }) and legacy schema ({ track: { ... } }).
 */
export function normalizeSpotifyTrack(rawTrack: any, index: number): Track | null {
  if (!rawTrack || typeof rawTrack !== 'object') return null;

  // Handle Spotify 2026 schema ({ item: { ... } }), legacy schema ({ track: { ... } }), or direct track
  const track = (rawTrack.item && typeof rawTrack.item === 'object' && rawTrack.item.id)
    ? rawTrack.item
    : (rawTrack.track && typeof rawTrack.track === 'object' && rawTrack.track.id)
    ? rawTrack.track
    : (rawTrack.id ? rawTrack : (rawTrack.item || rawTrack.track || rawTrack));

  // Skip podcast episodes, non-track objects, or unavailable items missing an ID
  if (!track || !track.id || track.type === 'episode') {
    return null;
  }

  const artistsList: string[] = Array.isArray(track.artists)
    ? track.artists.map((a: any) => a?.name).filter(Boolean)
    : [];

  const artistString = artistsList.length > 0 ? artistsList.join(', ') : 'Unknown Artist';
  const durationMs = Number(track.duration_ms) || 180000;
  const albumImages = Array.isArray(track.album?.images) ? track.album.images : [];
  const albumArtUrl = albumImages[0]?.url || albumImages[1]?.url || null;

  const trackId = `spotify-${track.id}`;

  // Handle Spotify restriction reasons: market, product, explicit, unknown
  const rawRestriction = track.restrictions?.reason?.toLowerCase();
  let restrictionReason: RestrictionReason = null;
  if (rawRestriction === 'market') {
    restrictionReason = 'market';
  } else if (rawRestriction === 'product') {
    restrictionReason = 'product';
  } else if (rawRestriction === 'explicit') {
    restrictionReason = 'explicit';
  } else if (rawRestriction) {
    restrictionReason = 'unknown';
  } else if (track.is_playable === false) {
    restrictionReason = 'unknown';
  }

  // Playback status: distinguish Spotify restrictions from available tracks
  let playbackStatus: PlaybackStatus = 'AVAILABLE';
  if (restrictionReason !== null || track.is_playable === false) {
    playbackStatus = 'PROVIDER_RESTRICTED';
  }

  return {
    id: trackId,
    provider: 'spotify',
    providerTrackId: track.id,
    title: track.name || `Track ${index + 1}`,
    artist: artistString,
    artists: artistsList,
    album: track.album?.name || (typeof track.album === 'string' ? track.album : 'Spotify Single'),
    albumArtUrl,
    durationMs,
    duration: Math.max(1, Math.round(durationMs / 1000)),
    externalUrl: track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`,
    isPlayable: Boolean(track.is_playable !== false && !restrictionReason),
    playbackStatus,
    restrictionReason,
    spotifyIsPlayable: typeof track.is_playable === 'boolean' ? track.is_playable : null,
    audioSource: 'unavailable',
    genre: 'Spotify Catalog',
    coverGradient: generateCoverGradient(track.id),
  };
}

/**
 * Fetches playlist metadata and all tracks from the official Spotify Web API.
 * Uses the current /playlists/{id}/items endpoint and parses modern 2026 `items` schema.
 * Strictly distinguishes:
 * - PLAYLIST_IMPORTED
 * - PLAYLIST_ACTUALLY_EMPTY
 * - PLAYLIST_ITEMS_UNAVAILABLE
 * - PLAYLIST_NOT_FOUND
 * - SPOTIFY_AUTH_REQUIRED
 * - SPOTIFY_API_ERROR
 */
export async function fetchSpotifyPlaylist(
  playlistId: string,
  accessToken: string,
  userMarket?: string,
): Promise<Playlist> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  // Safe diagnostic log (NEVER logs tokens or secrets)
  console.log(`[Spotify API] Fetching playlist metadata: ${playlistId}, userMarket: ${userMarket || 'none'}`);

  // 1. Fetch playlist metadata object
  let res = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, { headers });

  if (!res.ok) {
    const errorText = await res.text();
    if (res.status === 404) {
      throw new SpotifyPlaylistError('PLAYLIST_NOT_FOUND', 'Spotify playlist not found.', 404);
    }
    if (res.status === 401) {
      throw new SpotifyPlaylistError('SPOTIFY_AUTH_REQUIRED', 'Connect Spotify to import this playlist.', 401);
    }
    if (res.status === 403) {
      throw new SpotifyPlaylistError(
        'PLAYLIST_ITEMS_UNAVAILABLE',
        'This playlist is visible on Spotify, but Spotify does not provide its track list to this account. Import a playlist you own or collaborate on.',
        403
      );
    }
    throw new SpotifyPlaylistError('SPOTIFY_API_ERROR', `Spotify API error (${res.status}): ${errorText}`, res.status);
  }

  const data = await res.json();
  const playlistName = data.name || 'Imported Spotify Playlist';
  const description = data.description || '';
  const imageUrl = data.images?.[0]?.url || null;
  const ownerName = data.owner?.display_name || data.owner?.id || 'Spotify Curator';
  const ownerId = data.owner?.id;
  const collaborative = Boolean(data.collaborative);

  const seenTrackIds = new Set<string>();
  const tracks: Track[] = [];

  // Check if items were embedded directly in the root payload
  // In Spotify 2026 schema, data.items is a PagingObject { items: [...], total, next }
  const embeddedItemsObj = data.items || data.tracks;
  let rawItems: any[] | null = null;
  let totalReported: number | null = null;
  let nextUrl: string | null = null;

  if (embeddedItemsObj && typeof embeddedItemsObj === 'object') {
    if (Array.isArray(embeddedItemsObj.items)) {
      rawItems = embeddedItemsObj.items;
      totalReported = typeof embeddedItemsObj.total === 'number' ? embeddedItemsObj.total : embeddedItemsObj.items.length;
      nextUrl = embeddedItemsObj.next || null;
    } else if (Array.isArray(embeddedItemsObj)) {
      rawItems = embeddedItemsObj;
      totalReported = embeddedItemsObj.length;
    }
  }

  // 2. If items were not provided in root metadata (e.g. third-party playlist or omitted items), fetch /items endpoint
  if (rawItems === null) {
    console.log(`[Spotify API] Items omitted from metadata for ${playlistId}. Fetching /items endpoint...`);
    const itemsUrl = `https://api.spotify.com/v1/playlists/${playlistId}/items?limit=100${userMarket ? `&market=${encodeURIComponent(userMarket)}` : ''}`;
    const itemsRes = await fetch(itemsUrl, { headers });

    if (itemsRes.status === 403) {
      console.warn(`[Spotify API Diagnostics] Playlist ${playlistId} returned 403 Forbidden on /items. Owner: ${ownerId}, Collaborative: ${collaborative}`);
      throw new SpotifyPlaylistError(
        'PLAYLIST_ITEMS_UNAVAILABLE',
        'This playlist is visible on Spotify, but Spotify does not provide its track list to this account. Import a playlist you own or collaborate on.',
        403
      );
    }

    if (itemsRes.status === 404) {
      throw new SpotifyPlaylistError('PLAYLIST_NOT_FOUND', 'Spotify playlist not found.', 404);
    }

    if (itemsRes.status === 401) {
      throw new SpotifyPlaylistError('SPOTIFY_AUTH_REQUIRED', 'Connect Spotify to import this playlist.', 401);
    }

    if (!itemsRes.ok) {
      const errText = await itemsRes.text();
      throw new SpotifyPlaylistError('SPOTIFY_API_ERROR', `Spotify API error (${itemsRes.status}): ${errText}`, itemsRes.status);
    }

    const itemsData = await itemsRes.json();
    const parsedItems = Array.isArray(itemsData.items) ? itemsData.items : [];
    rawItems = parsedItems;
    totalReported = typeof itemsData.total === 'number' ? itemsData.total : parsedItems.length;
    nextUrl = itemsData.next || null;
  }

  const safeItems: any[] = rawItems || [];

  // Process first page of raw items
  for (const item of safeItems) {
    const normalized = normalizeSpotifyTrack(item, tracks.length);
    if (normalized && !seenTrackIds.has(normalized.providerTrackId)) {
      seenTrackIds.add(normalized.providerTrackId);
      tracks.push(normalized);
    }
  }

  // 3. Process remaining pages until nextUrl is null (Section 5 Pagination requirement)
  let pageCount = 1;
  const maxPages = 50; // Safely supports up to 5,000 tracks

  while (nextUrl && pageCount < maxPages) {
    pageCount++;
    try {
      const pageRes = await fetch(nextUrl, { headers });
      if (!pageRes.ok) {
        console.warn(`[Spotify API] Pagination stopped at page ${pageCount} (HTTP ${pageRes.status})`);
        break;
      }

      const pageData: any = await pageRes.json();
      const pageItems: any[] = Array.isArray(pageData.items) ? pageData.items : [];

      for (const item of pageItems) {
        const normalized = normalizeSpotifyTrack(item, tracks.length);
        if (normalized && !seenTrackIds.has(normalized.providerTrackId)) {
          seenTrackIds.add(normalized.providerTrackId);
          tracks.push(normalized);
        }
      }

      nextUrl = pageData.next || null;
    } catch (err) {
      console.warn(`[Spotify API] Pagination fetch failed on page ${pageCount}:`, (err as Error)?.message);
      break;
    }
  }

  // 4. Distinguish exact playlist import state (Section 2 requirement)
  let importStatus: PlaylistImportStatus;
  let statusMessage: string;

  if (tracks.length > 0) {
    importStatus = 'PLAYLIST_IMPORTED';
    statusMessage = `Imported ${tracks.length} tracks.`;
  } else if (totalReported === 0 || safeItems.length === 0) {
    importStatus = 'PLAYLIST_ACTUALLY_EMPTY';
    statusMessage = 'This Spotify playlist is empty.';
  } else {
    importStatus = 'PLAYLIST_ITEMS_UNAVAILABLE';
    statusMessage = 'This playlist is visible on Spotify, but Spotify does not provide its track list to this account. Import a playlist you own or collaborate on.';
  }

  // Safe Diagnostic Counters (Section 12 requirement - NEVER logs tokens or secrets)
  let playableCount = 0;
  let marketRestricted = 0;
  let productRestricted = 0;
  let explicitRestricted = 0;
  let unknownRestricted = 0;

  for (const t of tracks) {
    if (t.spotifyIsPlayable === true) playableCount++;
    if (t.restrictionReason === 'market') marketRestricted++;
    else if (t.restrictionReason === 'product') productRestricted++;
    else if (t.restrictionReason === 'explicit') explicitRestricted++;
    else if (t.restrictionReason === 'unknown') unknownRestricted++;
  }

  console.log(`[Spotify Playlist Import Diagnostics]`, {
    playlistId,
    playlistName,
    httpStatus: res.status,
    itemsFieldPresent: Boolean(embeddedItemsObj),
    itemsCount: safeItems.length,
    trackCount: tracks.length,
    playableCount,
    restrictedCount: marketRestricted + productRestricted + explicitRestricted + unknownRestricted,
    ownerId,
    ownerName,
    collaborative,
    status: importStatus,
  });

  return {
    id: playlistId,
    name: playlistName,
    description,
    imageUrl,
    ownerName,
    ownerId,
    collaborative,
    totalTracks: Math.max(totalReported || 0, tracks.length),
    tracks,
    externalUrl: data.external_urls?.spotify || `https://open.spotify.com/playlist/${playlistId}`,
    unplayableCount: marketRestricted + productRestricted + explicitRestricted + unknownRestricted,
    restrictionsSummary: {
      market: marketRestricted,
      product: productRestricted,
      explicit: explicitRestricted,
      unknown: unknownRestricted,
    },
    providerConfigured: false,
    importStatus,
    statusMessage,
  };
}

/**
 * Fetches playlists accessible to the authenticated Spotify user using /v1/me/playlists.
 * Implements "My Spotify Playlists" feature (Section 9).
 */
export async function fetchUserPlaylists(
  accessToken: string,
  currentUserId?: string
): Promise<UserPlaylistSummary[]> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  const res = await fetch('https://api.spotify.com/v1/me/playlists?limit=50', { headers });

  if (!res.ok) {
    const errorText = await res.text();
    if (res.status === 401) {
      throw new SpotifyPlaylistError('SPOTIFY_AUTH_REQUIRED', 'Connect Spotify to import this playlist.', 401);
    }
    throw new SpotifyPlaylistError('SPOTIFY_API_ERROR', `Failed to fetch your playlists from Spotify (${res.status}): ${errorText}`, res.status);
  }

  const data = await res.json();
  const items: any[] = Array.isArray(data.items) ? data.items : [];
  const playlists: UserPlaylistSummary[] = [];

  for (const p of items) {
    if (!p || !p.id) continue;
    const isOwner = Boolean(currentUserId && p.owner?.id === currentUserId);
    const imageUrl = p.images?.[0]?.url || null;
    const totalTracks = Number(p.items?.total ?? p.tracks?.total ?? p.total ?? 0);

    playlists.push({
      id: p.id,
      name: p.name || 'Untitled Playlist',
      description: p.description || '',
      imageUrl,
      ownerName: p.owner?.display_name || p.owner?.id || 'Unknown Curator',
      ownerId: p.owner?.id,
      isOwner,
      collaborative: Boolean(p.collaborative),
      totalTracks,
      externalUrl: p.external_urls?.spotify || `https://open.spotify.com/playlist/${p.id}`,
    });
  }

  return playlists;
}

/**
 * Searches tracks on Spotify using official Web API /v1/search.
 */
export async function searchSpotifyTracks(
  query: string,
  accessToken: string,
  limit: number = 20,
): Promise<Track[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  const url = `https://api.spotify.com/v1/search?type=track&q=${encodeURIComponent(trimmed)}&limit=${limit}`;
  const res = await fetch(url, { headers });

  if (!res.ok) {
    const errorText = await res.text();
    if (res.status === 401 || res.status === 403) {
      throw new Error('Spotify authorization expired or permission denied. Please reconnect Spotify.');
    }
    throw new Error(`Spotify Search API error (${res.status}): ${errorText}`);
  }

  const data: any = await res.json();
  const items = Array.isArray(data.tracks?.items)
    ? data.tracks.items
    : Array.isArray(data.items?.items)
    ? data.items.items
    : Array.isArray(data.tracks)
    ? data.tracks
    : Array.isArray(data.items)
    ? data.items
    : [];
  const tracks: Track[] = [];

  for (let i = 0; i < items.length; i++) {
    const normalized = normalizeSpotifyTrack(items[i], i);
    if (normalized) {
      tracks.push(normalized);
    }
  }

  return tracks;
}

/**
 * Robustly parses and validates Spotify track identifiers from various URL formats.
 * Supported formats:
 * 1. https://open.spotify.com/track/TRACK_ID
 * 2. https://open.spotify.com/intl-xx/track/TRACK_ID
 * 3. spotify:track:TRACK_ID
 * 4. URLs containing query parameters such as ?si=...
 * 5. Direct 22-character alphanumeric Spotify ID
 */
export function parseSpotifyTrackId(input: string): { trackId: string | null; error?: string } {
  if (!input || typeof input !== 'string') {
    return { trackId: null, error: 'Please enter a Spotify track URL or ID.' };
  }

  const trimmed = input.trim();

  // spotify:track:TRACK_ID
  const uriMatch = trimmed.match(/^spotify:track:([a-zA-Z0-9]{22})$/i);
  if (uriMatch) {
    return { trackId: uriMatch[1] };
  }

  // https://open.spotify.com/.../track/TRACK_ID (supports international prefixes e.g. /intl-de/track/...)
  const urlMatch = trimmed.match(/open\.spotify\.com\/(?:[a-z]{2,5}(?:-[a-z]{2,5})?\/)?track\/([a-zA-Z0-9]{22})/i);
  if (urlMatch) {
    return { trackId: urlMatch[1] };
  }

  // 22-character alphanumeric Spotify ID
  if (/^[a-zA-Z0-9]{22}$/.test(trimmed)) {
    return { trackId: trimmed };
  }

  return { trackId: null, error: 'Invalid Spotify track URL or ID format.' };
}

/**
 * Fetches a single track from the official Spotify Web API GET /v1/tracks/{id}.
 */
export async function fetchSpotifyTrack(
  trackIdOrUrl: string,
  accessToken: string,
  userMarket?: string,
): Promise<Track> {
  const { trackId, error } = parseSpotifyTrackId(trackIdOrUrl);
  if (!trackId) {
    throw new SpotifyPlaylistError('INVALID_TRACK_ID', error || 'Invalid Spotify track format.', 400);
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  const marketQuery = userMarket ? `?market=${encodeURIComponent(userMarket)}` : '';
  const url = `https://api.spotify.com/v1/tracks/${trackId}${marketQuery}`;

  const res = await fetch(url, { headers });

  if (!res.ok) {
    const errorText = await res.text();
    if (res.status === 404) {
      throw new SpotifyPlaylistError('TRACK_NOT_FOUND', 'Spotify track not found.', 404);
    }
    if (res.status === 401) {
      throw new SpotifyPlaylistError('SPOTIFY_AUTH_REQUIRED', 'Spotify authorization required to fetch track.', 401);
    }
    if (res.status === 403) {
      throw new SpotifyPlaylistError('TRACK_UNAVAILABLE', 'Spotify track is restricted or unavailable in your region.', 403);
    }
    throw new SpotifyPlaylistError('SPOTIFY_API_ERROR', `Spotify API error (${res.status}): ${errorText}`, res.status);
  }

  const rawTrack = await res.json();
  const normalized = normalizeSpotifyTrack(rawTrack, 0);

  if (!normalized) {
    throw new SpotifyPlaylistError('TRACK_UNAVAILABLE', 'Track exists on Spotify but could not be processed as an audio track.', 400);
  }

  return normalized;
}
