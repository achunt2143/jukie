/**
 * Player service — full MusicKit JS v3 playback.
 *
 * MusicKit JS v3 setQueue({ items }) must receive the actual
 * MusicKit.MediaItem objects that MusicKit itself returned — NOT
 * { id, type } descriptor strings. The type-descriptor approach causes
 * MusicKit to try to pluralise the type string to build a URL path, which
 * produces "/v1/me/library/undefineds/..." for any unrecognised type.
 *
 * Raw items are kept alive in the rawItemCache in library.ts and retrieved
 * here via getRawItem() before every setQueue call.
 */
import { getMusicKit } from './musickit';
import { getRawItem } from './library';
import type { Track } from '@/types/music';

export async function playTrack(track: Track, queue: Track[] = [track], index = 0): Promise<void> {
  const mk = await getMusicKit();

  // Resolve raw MusicKit.MediaItem objects for the full queue.
  // Any item not yet cached falls back to a minimal descriptor that MusicKit
  // can still use if the library fetch already populated its internal cache.
  const rawItems = queue
    .map((t) => getRawItem(t.id))
    .filter((item): item is MusicKit.MediaItem => item !== undefined);

  if (rawItems.length === 0) {
    console.warn('[player] No raw items found in cache — library may not have finished loading.');
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
