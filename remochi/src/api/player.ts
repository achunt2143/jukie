/**
 * Player service — full MusicKit JS v3 playback.
 *
 * setQueue({ items }) must receive actual MusicKit.MediaItem objects.
 * We pull them from rawItemCache (populated by library.ts on fetch).
 * Any cache miss is resolved with a live fetch before queuing.
 */
import { getMusicKit } from './musickit';
import { getRawItem, fetchRawItemsByIds } from './library';
import type { Track } from '@/types/music';

export async function playTrack(track: Track, queue: Track[] = [track], index = 0): Promise<void> {
  const mk = await getMusicKit();

  // Find which IDs are missing from the cache.
  const missingIds = queue.map((t) => t.id).filter((id) => !getRawItem(id));

  // Fetch any missing items in one batch call, which also populates the cache.
  if (missingIds.length > 0) {
    await fetchRawItemsByIds(missingIds);
  }

  // Now resolve the full queue from cache.
  const rawItems = queue
    .map((t) => getRawItem(t.id))
    .filter((item): item is MusicKit.MediaItem => item !== undefined);

  if (rawItems.length === 0) {
    console.error('[player] Could not resolve any tracks — check library permissions.');
    return;
  }

  await mk.setQueue({ items: rawItems, startPosition: index } as unknown as MusicKit.SetQueueOptions);
  await mk.player.play();
}

export async function pause(): Promise<void> {
  const mk = await getMusicKit();
  mk.player.pause();
}

export async function resume(): Promise<void> {
  const mk = await getMusicKit();
  await mk.player.play();
}

export async function seek(positionMs: number): Promise<void> {
  const mk = await getMusicKit();
  await mk.player.seekToTime(positionMs / 1000);
}

export async function skipNext(): Promise<void> {
  const mk = await getMusicKit();
  await mk.player.skipToNextItem();
}

export async function skipPrev(): Promise<void> {
  const mk = await getMusicKit();
  await mk.player.skipToPreviousItem();
}

export async function setShuffle(on: boolean): Promise<void> {
  const mk = await getMusicKit();
  mk.player.shuffleMode = on ? 1 : 0;
}

export async function setRepeat(mode: 'none' | 'one' | 'all'): Promise<void> {
  const mk = await getMusicKit();
  mk.player.repeatMode = mode === 'none' ? 0 : mode === 'one' ? 1 : 2;
}

export type PlayerEventCallback = (event: unknown) => void;

export async function addPlayerListener(event: string, cb: PlayerEventCallback): Promise<void> {
  const mk = await getMusicKit();
  mk.addEventListener(event, cb);
}

export async function removePlayerListener(event: string, cb: PlayerEventCallback): Promise<void> {
  const mk = await getMusicKit();
  mk.removeEventListener(event, cb);
}
