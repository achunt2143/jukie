/**
 * Search service — Apple Music catalog + library search via MusicKit JS v3.
 *
 * Uses the /v1/catalog/{storefront}/search endpoint for full catalog results
 * and /v1/me/library/search for personal library results.
 * Both are merged and deduped in the return value.
 */
import { getMusicKit } from './musickit';
import type { SearchResults, Track, Album, Artist } from '@/types/music';

function artUrl(artwork?: { url: string }, size = 300): string | undefined {
  if (!artwork?.url) return undefined;
  return artwork.url.replace('{w}', String(size)).replace('{h}', String(size));
}

async function getStorefront(mk: MusicKit.MusicKitInstance): Promise<string> {
  try {
    const res = await mk.api.music('/v1/me/storefront') as { data: { data: Array<{ id: string }> } };
    return res.data?.data?.[0]?.id ?? 'us';
  } catch {
    return 'us';
  }
}

export async function search(query: string): Promise<SearchResults> {
  if (!query.trim()) return { tracks: [], albums: [], artists: [] };

  const mk = await getMusicKit();
  const storefront = await getStorefront(mk);

  const [catalogRes, libraryRes] = await Promise.allSettled([
    mk.api.music(`/v1/catalog/${storefront}/search`, {
      term: query,
      types: 'songs,albums,artists',
      limit: 25,
    }),
    mk.api.music('/v1/me/library/search', {
      term: query,
      types: 'library-songs,library-albums,library-artists',
      limit: 25,
    }),
  ]);

  const tracks: Track[] = [];
  const albums: Album[] = [];
  const artists: Artist[] = [];
  const seenIds = new Set<string>();

  function addTrack(item: MusicKit.MediaItem) {
    if (seenIds.has(item.id)) return;
    seenIds.add(item.id);
    tracks.push({
      id: item.id,
      title: item.attributes.name,
      artist: item.attributes.artistName,
      album: item.attributes.albumName,
      albumArtUrl: artUrl(item.attributes.artwork),
      durationMs: item.attributes.durationInMillis,
      genre: item.attributes.genreNames?.[0],
    });
  }

  function addAlbum(item: { id: string; attributes: Record<string, unknown> }) {
    if (seenIds.has(item.id)) return;
    seenIds.add(item.id);
    albums.push({
      id: item.id,
      title: item.attributes.name as string,
      artist: item.attributes.artistName as string,
      artUrl: artUrl(item.attributes.artwork as { url: string } | undefined),
      trackCount: (item.attributes.trackCount as number) ?? 0,
    });
  }

  function addArtist(item: { id: string; attributes: Record<string, unknown> }) {
    if (seenIds.has(item.id)) return;
    seenIds.add(item.id);
    artists.push({
      id: item.id,
      name: item.attributes.name as string,
      albumCount: 0,
    });
  }

  // Catalog results
  if (catalogRes.status === 'fulfilled') {
    const d = (catalogRes.value as { data: { results: Record<string, { data: unknown[] }> } }).data?.results;
    (d?.songs?.data ?? []).forEach((i) => addTrack(i as MusicKit.MediaItem));
    (d?.albums?.data ?? []).forEach((i) => addAlbum(i as { id: string; attributes: Record<string, unknown> }));
    (d?.artists?.data ?? []).forEach((i) => addArtist(i as { id: string; attributes: Record<string, unknown> }));
  }

  // Library results (may overlap with catalog — deduped via seenIds)
  if (libraryRes.status === 'fulfilled') {
    const d = (libraryRes.value as { data: { results: Record<string, { data: unknown[] }> } }).data?.results;
    (d?.['library-songs']?.data ?? []).forEach((i) => addTrack(i as MusicKit.MediaItem));
    (d?.['library-albums']?.data ?? []).forEach((i) => addAlbum(i as { id: string; attributes: Record<string, unknown> }));
    (d?.['library-artists']?.data ?? []).forEach((i) => addArtist(i as { id: string; attributes: Record<string, unknown> }));
  }

  return { tracks, albums, artists };
}
