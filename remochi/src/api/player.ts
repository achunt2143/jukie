/**
 * Player service — stub implementation.
 *
 * Handles playback commands. Wire this to the Web Audio API, MediaSession API,
 * or whatever backend streaming mechanism the remochi platform uses.
 */
import type { Track } from '@/types/music';

export async function playTrack(_track: Track): Promise<void> {}
export async function pause(): Promise<void> {}
export async function resume(): Promise<void> {}
export async function seek(_positionMs: number): Promise<void> {}
export async function skipNext(): Promise<void> {}
export async function skipPrev(): Promise<void> {}
