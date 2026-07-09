/**
 * Library service — Apple Music personal library via MusicKit JS v3.
 *
 * All endpoints hit the user's iCloud Music Library, so MusicKit must be
 * authorized before any of these are called. The LibraryStore handles that
 * guard via AuthStore.
 *
 * Pagination: Apple's library endpoints return up to 100 items per page.
 * Each helper fetches all pages automatically.
 */
import { getMusicKit } from './musickit';
import type { Track, Album, Artist, Genre, Playlist } from '@/types/music';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function artUrl(artwork?: { url: string }, size = 300): string | undefined {
  if (!artwork?.url) return undefined;
  return artwork.url.replace('{w}', String(size)).replace('{h}', String(size));
}

async function fetchAllPages<T>(
  mk: MusicKit.MusicKitInstance,
  path: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  const results: T[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const res = await mk.api.music(path, { ...params, limit, offset }) as {
      data: { data: T[]; next?: string }
    };
    const items = res.data?.data ?? [];
    results.push(...items);
    if (!res.data?.next || items.length < limit) break;
    offset += limit;
  }

  return results;
}

// ---------------------------------------------------------------------------
// Tracks / Songs
// ---------------------------------------------------------------------------

export async function getTracks(): Promise<Track[]> {
  const mk = await getMusicKit();
  const items = await fetchAllPages<MusicKit.MediaItem>(mk, '/v1/me/library/songs');
  return items.map(itemToTrack);
}

function itemToTrack(item: MusicKit.MediaItem): Track {
  const a = item.attributes;
  return {
    id: item.id,
    title: a.name,
    artist: a.artistName,
    album: a.albumName,
    albumArtUrl: artUrl(a.artwork),
    durationMs: a.durationInMillis,
    trackNumber: a.trackNumber,
    discNumber: a.discNumber,
    genre: a.genreNames?.[0],
  };
}

// ---------------------------------------------------------------------------
// Albums
// ---------------------------------------------------------------------------

export async function getAlbums(): Promise<Album[]> {
  const mk = await getMusicKit();
  const items = await fetchAllPages<{ id: string; attributes: Record<string, unknown> }>(
    mk, '/v1/me/library/albums'
  );
  return items.map((item) => ({
    id: item.id,
    title: item.attributes.name as string,
    artist: item.attributes.artistName as string,
    artUrl: artUrl(item.attributes.artwork as { url: string } | undefined),
    trackCount: (item.attributes.trackCount as number) ?? 0,
  }));
}

export async function getAlbumById(id: string): Promise<Album | null> {
  const mk = await getMusicKit();
  const res = await mk.api.music(`/v1/me/library/albums/${id}`, {
    include: 'tracks',
  }) as { data: { data: Array<{ id: string; attributes: Record<string, unknown>; relationships?: Record<string, unknown> }> } };
  const item = res.data?.data?.[0];
  if (!item) return null;

  const rawTracks = (item.relationships?.tracks as { data: MusicKit.MediaItem[] } | undefined)?.data ?? [];

  return {
    id: item.id,
    title: item.attributes.name as string,
    artist: item.attributes.artistName as string,
    artUrl: artUrl(item.attributes.artwork as { url: string } | undefined),
    year: item.attributes.releaseDate ? new Date(item.attributes.releaseDate as string).getFullYear() : undefined,
    trackCount: rawTracks.length,
    tracks: rawTracks.map(itemToTrack),
  };
}

// ---------------------------------------------------------------------------
// Artists
// ---------------------------------------------------------------------------

export async function getArtists(): Promise<Artist[]> {
  const mk = await getMusicKit();
  const items = await fetchAllPages<{ id: string; attributes: Record<string, unknown> }>(
    mk, '/v1/me/library/artists'
  );
  return items.map((item) => ({
    id: item.id,
    name: item.attributes.name as string,
    albumCount: 0, // populated lazily in getArtistById
  }));
}

export async function getArtistById(id: string): Promise<Artist | null> {
  const mk = await getMusicKit();
  const res = await mk.api.music(`/v1/me/library/artists/${id}`, {
    include: 'albums',
  }) as { data: { data: Array<{ id: string; attributes: Record<string, unknown>; relationships?: Record<string, unknown> }> } };
  const item = res.data?.data?.[0];
  if (!item) return null;

  const rawAlbums = (item.relationships?.albums as { data: Array<{ id: string; attributes: Record<string, unknown> }> } | undefined)?.data ?? [];

  const albums: Album[] = rawAlbums.map((a) => ({
    id: a.id,
    title: a.attributes.name as string,
    artist: item.attributes.name as string,
    artUrl: artUrl(a.attributes.artwork as { url: string } | undefined),
    trackCount: (a.attributes.trackCount as number) ?? 0,
    year: a.attributes.releaseDate ? new Date(a.attributes.releaseDate as string).getFullYear() : undefined,
  }));

  return {
    id: item.id,
    name: item.attributes.name as string,
    albumCount: albums.length,
    albums,
  };
}

// ---------------------------------------------------------------------------
// Genres
// ---------------------------------------------------------------------------

export async function getGenres(): Promise<Genre[]> {
  const mk = await getMusicKit();
  // Library songs endpoint is the source of truth for genres in a user's library.
  const tracks = await getTracks();
  const map = new Map<string, number>();
  for (const t of tracks) {
    if (t.genre) map.set(t.genre, (map.get(t.genre) ?? 0) + 1);
  }
  return Array.from(map.entries()).map(([name, trackCount], i) => ({
    id: `genre-${i}`,
    name,
    trackCount,
  }));
}

export async function getTracksByGenre(genreId: string): Promise<Track[]> {
  // genreId is "genre-{index}" — resolve by matching genre name from full track list.
  const tracks = await getTracks();
  const genres = await getGenres();
  const genre = genres.find((g) => g.id === genreId);
  if (!genre) return [];
  return tracks.filter((t) => t.genre === genre.name);
}

// ---------------------------------------------------------------------------
// Playlists
// ---------------------------------------------------------------------------

export async function getPlaylists(): Promise<Playlist[]> {
  const mk = await getMusicKit();
  const items = await fetchAllPages<{ id: string; attributes: Record<string, unknown> }>(
    mk, '/v1/me/library/playlists'
  );
  return items.map((item) => ({
    id: item.id,
    name: item.attributes.name as string,
    description: item.attributes.description as string | undefined,
    artUrl: artUrl(item.attributes.artwork as { url: string } | undefined),
    trackCount: (item.attributes.trackCount as number) ?? 0,
  }));
}

export async function getPlaylistById(id: string): Promise<Playlist | null> {
  const mk = await getMusicKit();
  const res = await mk.api.music(`/v1/me/library/playlists/${id}`, {
    include: 'tracks',
  }) as { data: { data: Array<{ id: string; attributes: Record<string, unknown>; relationships?: Record<string, unknown> }> } };
  const item = res.data?.data?.[0];
  if (!item) return null;

  const rawTracks = (item.relationships?.tracks as { data: MusicKit.MediaItem[] } | undefined)?.data ?? [];

  return {
    id: item.id,
    name: item.attributes.name as string,
    description: item.attributes.description as string | undefined,
    artUrl: artUrl(item.attributes.artwork as { url: string } | undefined),
    trackCount: rawTracks.length,
    tracks: rawTracks.map(itemToTrack),
  };
}
