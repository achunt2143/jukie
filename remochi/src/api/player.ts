/**
 * Player service — MusicKit JS v3 playback via playParams.
 *
 * The ONLY correct way to play library tracks in MusicKit JS v3 is via
 * the item's own playParams object (item.attributes.playParams).
 *
 * playParams shape: { id: string, kind: string, isLibrary?: boolean }
 *
 * setQueue accepts { [kind]: id } derived from playParams, e.g.:
 *   { song: 'i.AbCdEfG' }   <- library song
 *   { song: '1234567890' }  <- catalog song
 *
 * For a queue of multiple tracks, we use startPlaying (v3 preferred over
 * autoplay) so playback begins immediately after the queue is set.
 *
 * Reference: https://forums.developer.apple.com/forums/thread/704565
 */
import { getMusicKit } from './musickit';
import type { Track } from '@/types/music';

function trackToQueueDescriptor(track: Track): Record<string, unknown> {
  const pp = track.playParams;
  if (pp?.kind && pp?.id) {
    // Use playParams directly: { [kind]: id }
    return { [pp.kind]: pp.id };
  }
  // Fallback for catalog tracks without explicit playParams
  return { song: track.id };
}

export async function playTrack(track: Track, queue: Track[] = [track], index = 0): Promise<void> {
  const mk = await getMusicKit();

  const descriptor = trackToQueueDescriptor(track);
  console.log('[player] setQueue descriptor:', descriptor, 'playParams:', track.playParams);

  // For a single track or start of a queue, set the queue with startPlaying.
  // startPlaying is the v3 replacement for the deprecated autoplay property.
  await mk.setQueue({
    ...descriptor,
    startPosition: 0,
    startPlaying: true,
  } as unknown as MusicKit.SetQueueOptions);
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
