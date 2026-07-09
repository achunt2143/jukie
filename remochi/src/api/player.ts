/**
 * Player service — MusicKit JS v3.
 *
 * In v3, ALL playback methods and properties live directly on the
 * MusicKit instance (mk), not on a mk.player sub-object.
 *
 * Correct:   mk.pause()  mk.play()  mk.skipToNextItem()  mk.currentPlaybackTime
 * Wrong:     mk.player.pause()  mk.player.currentPlaybackTime  (undefined in v3)
 */
import { getMusicKit } from './musickit';
import type { Track, PlayParams } from '@/types/music';

function trackToDescriptor(track: Track): Record<string, unknown> {
  const pp = track.playParams;
  if (pp?.kind && pp?.id) return { [pp.kind]: pp.id };
  return { song: track.id };
}

export async function playTrack(track: Track, queue: Track[] = [track], _index = 0): Promise<void> {
  const mk = await getMusicKit();
  const descriptor = trackToDescriptor(track);
  console.log('[player] setQueue descriptor:', descriptor);
  await mk.setQueue({ ...descriptor, startPlaying: true } as unknown as MusicKit.SetQueueOptions);
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
  // PlayerShuffleMode: off = 0, songs = 1
  (mk as unknown as { shuffleMode: number }).shuffleMode = on ? 1 : 0;
}

export async function setRepeat(mode: 'none' | 'one' | 'all'): Promise<void> {
  const mk = await getMusicKit();
  // PlayerRepeatMode: none = 0, one = 1, all = 2
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
