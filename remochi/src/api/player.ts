/**
 * Player service — full MusicKit JS v3 playback.
 *
 * The PlayerStore subscribes to MusicKit player events for real-time state
 * sync (playback state changes, now-playing item changes, time updates).
 * These functions are the imperative command surface.
 */
import { getMusicKit } from './musickit';
import type { Track } from '@/types/music';

export async function playTrack(track: Track, queue: Track[] = [track], index = 0): Promise<void> {
  const mk = await getMusicKit();
  // Build queue from song IDs. For library tracks the IDs are library song IDs.
  const ids = queue.map((t) => t.id);
  await mk.setQueue({ songs: ids, startPosition: index });
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
