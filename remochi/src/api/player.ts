/**
 * Player service — MusicKit JS v3.
 *
 * In v3, ALL playback methods and properties live directly on the
 * MusicKit instance (mk), not on a mk.player sub-object.
 *
 * To enable skip next/prev, the entire queue must be passed to setQueue
 * as a `songs` array of playParams IDs with startPosition for the
 * clicked index.
 *
 * setQueue shape for library queue:
 *   { songs: ['i.ABC', 'i.DEF', ...], startPosition: n, startPlaying: true }
 */
import { getMusicKit } from './musickit';
import type { Track } from '@/types/music';

function trackId(track: Track): string {
  // playParams.id is the correct ID for library tracks (e.g. 'i.AbCdEfG')
  return track.playParams?.id ?? track.id;
}

export async function playTrack(track: Track, queue: Track[] = [track], index = 0): Promise<void> {
  const mk = await getMusicKit();

  const ids = queue.map(trackId);
  console.log('[player] setQueue songs:', ids, 'startPosition:', index);

  await mk.setQueue({
    songs: ids,
    startPosition: index,
    startPlaying: true,
  } as unknown as MusicKit.SetQueueOptions);
}

export async function pause(): Promise<void> {
  const mk = await getMusicKit();
  mk.pause();
}

export async function resume(): Promise<void> {
  const mk = await getMusicKit();
  await mk.play();
}

export async function seek(positionMs: number): Promise<void> {
  const mk = await getMusicKit();
  await mk.seekToTime(positionMs / 1000);
}

export async function skipNext(): Promise<void> {
  const mk = await getMusicKit();
  await mk.skipToNextItem();
}

export async function skipPrev(): Promise<void> {
  const mk = await getMusicKit();
  await mk.skipToPreviousItem();
}

export async function setShuffle(on: boolean): Promise<void> {
  const mk = await getMusicKit();
  (mk as unknown as { shuffleMode: number }).shuffleMode = on ? 1 : 0;
}

export async function setRepeat(mode: 'none' | 'one' | 'all'): Promise<void> {
  const mk = await getMusicKit();
  (mk as unknown as { repeatMode: number }).repeatMode =
    mode === 'none' ? 0 : mode === 'one' ? 1 : 2;
}

export async function getCurrentTime(): Promise<number> {
  const mk = await getMusicKit();
  return (mk as unknown as { currentPlaybackTime: number }).currentPlaybackTime * 1000;
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
