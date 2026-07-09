/**
 * Player service — full MusicKit JS v3 playback.
 *
 * KEY: MusicKit JS v3 setQueue({ songs: [...] }) expects CATALOG IDs.
 * Library track IDs (i.xxxxxxxx) must be passed as typed item descriptors:
 *   { id, type: 'library-songs' }
 * Passing library IDs into the 'songs' key silently fails — no stream starts.
 */
import { getMusicKit } from './musickit';
import type { Track } from '@/types/music';

export async function playTrack(track: Track, queue: Track[] = [track], index = 0): Promise<void> {
  const mk = await getMusicKit();

  // Build typed item descriptors for the full queue.
  // type 'library-songs' tells MusicKit to resolve from the user's library.
  const items = queue.map((t) => ({ id: t.id, type: 'library-songs' as const }));

  await mk.setQueue({ items, startPosition: index } as unknown as MusicKit.SetQueueOptions);
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
