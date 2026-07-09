/**
 * Library service — stub implementation.
 *
 * Replace these with real Apple Music API (or alternative backend) calls.
 * All functions return Promises so the real impl can be async/fetch-based.
 */
import type { Track, Album, Artist, Genre, Playlist } from '@/types/music';

export async function getTracks(): Promise<Track[]> {
  return [];
}

export async function getAlbums(): Promise<Album[]> {
  return [];
}

export async function getAlbumById(id: string): Promise<Album | null> {
  return null;
}

export async function getArtists(): Promise<Artist[]> {
  return [];
}

export async function getArtistById(id: string): Promise<Artist | null> {
  return null;
}

export async function getGenres(): Promise<Genre[]> {
  return [];
}

export async function getTracksByGenre(genreId: string): Promise<Track[]> {
  return [];
}

export async function getPlaylists(): Promise<Playlist[]> {
  return [];
}

export async function getPlaylistById(id: string): Promise<Playlist | null> {
  return null;
}
