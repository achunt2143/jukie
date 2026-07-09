/**
 * PlayerStore — MusicKit JS v3 events as single source of truth.
 *
 * v3 event shapes (from official docs):
 *   nowPlayingItemDidChange  -> callback({ item: MediaItem | undefined })
 *   playbackStateDidChange   -> callback({ state: MusicKit.PlaybackStates })
 *
 * All MK properties live on mk directly:
 *   mk.currentPlaybackTime  mk.isPlaying  mk.nowPlayingItem
 */
import React, { createContext, useContext, useReducer, useEffect, useRef } from 'react';
import type { PlayerState, Track, PlayParams } from '@/types/music';
import { addPlayerListener, removePlayerListener, getCurrentTime } from '@/api/player';

type Action =
  | { type: 'SET_CURRENT_TRACK'; track: Track }  // optimistic on click
  | { type: 'SET_QUEUE'; queue: Track[] }
  | { type: 'TOGGLE_SHUFFLE' }
  | { type: 'CYCLE_REPEAT' }
  | { type: 'MK_NOW_PLAYING'; track: Track | null }
  | { type: 'MK_PLAYBACK_STATE'; isPlaying: boolean }
  | { type: 'MK_TIME'; positionMs: number };

export type PlayerAction = Action;

const initial: PlayerState = {
  currentTrack: null,
  queue: [],
  queueIndex: 0,
  isPlaying: false,
  positionMs: 0,
  shuffle: false,
  repeat: 'none',
};

function mkItemToTrack(item: MusicKit.MediaItem): Track {
  const a = item.attributes;
  const pp = (a as unknown as { playParams?: PlayParams }).playParams;
  return {
    id: item.id,
    title: a.name,
    artist: a.artistName,
    album: a.albumName,
    albumArtUrl: a.artwork?.url.replace('{w}', '300').replace('{h}', '300'),
    durationMs: a.durationInMillis,
    playParams: pp,
  };
}

function reducer(state: PlayerState, action: Action): PlayerState {
  switch (action.type) {
    case 'SET_CURRENT_TRACK':
      return { ...state, currentTrack: action.track, positionMs: 0, isPlaying: true };
    case 'SET_QUEUE':
      return { ...state, queue: action.queue };
    case 'TOGGLE_SHUFFLE':
      return { ...state, shuffle: !state.shuffle };
    case 'CYCLE_REPEAT':
      return { ...state, repeat: state.repeat === 'none' ? 'all' : state.repeat === 'all' ? 'one' : 'none' };
    case 'MK_NOW_PLAYING':
      if (!action.track) return { ...state, currentTrack: null, isPlaying: false, positionMs: 0 };
      return { ...state, currentTrack: action.track, positionMs: 0 };
    case 'MK_PLAYBACK_STATE':
      return { ...state, isPlaying: action.isPlaying };
    case 'MK_TIME':
      return { ...state, positionMs: action.positionMs };
    default:
      return state;
  }
}

const PlayerContext = createContext<{ state: PlayerState; dispatch: React.Dispatch<Action> } | null>(null);

export function PlayerStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const isPlayingRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  isPlayingRef.current = state.isPlaying;

  // rAF loop — polls mk.currentPlaybackTime every frame while playing
  useEffect(() => {
    function tick() {
      if (!isPlayingRef.current) {
        rafRef.current = null;
        return;
      }
      getCurrentTime().then((ms) => {
        if (!isNaN(ms)) dispatch({ type: 'MK_TIME', positionMs: ms });
      });
      rafRef.current = requestAnimationFrame(tick);
    }

    if (state.isPlaying) {
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(tick);
    } else {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }
    return () => {
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, [state.isPlaying]);

  // MusicKit event listeners
  useEffect(() => {
    // playbackStateDidChange: { state: MusicKit.PlaybackStates }
    // PlaybackStates.playing = 2
    const onPlaybackState = (event: unknown) => {
      const e = event as { state: number };
      dispatch({ type: 'MK_PLAYBACK_STATE', isPlaying: e.state === 2 });
    };

    // nowPlayingItemDidChange: { item: MediaItem | undefined }
    const onNowPlaying = (event: unknown) => {
      const e = event as { item?: MusicKit.MediaItem };
      dispatch({
        type: 'MK_NOW_PLAYING',
        track: e.item ? mkItemToTrack(e.item) : null,
      });
    };

    addPlayerListener('playbackStateDidChange', onPlaybackState);
    addPlayerListener('nowPlayingItemDidChange', onNowPlaying);

    return () => {
      removePlayerListener('playbackStateDidChange', onPlaybackState);
      removePlayerListener('nowPlayingItemDidChange', onNowPlaying);
    };
  }, []);

  return (
    <PlayerContext.Provider value={{ state, dispatch }}>
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used within PlayerStoreProvider');
  return ctx;
}
