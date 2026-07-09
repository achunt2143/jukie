/**
 * Search service — stub implementation.
 *
 * Searches both the user's library and the full catalog.
 */
import type { SearchResults } from '@/types/music';

export async function search(query: string): Promise<SearchResults> {
  return { tracks: [], albums: [], artists: [] };
}
