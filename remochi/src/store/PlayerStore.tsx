/**
 * PlayerStore — React context backed by real MusicKit player events.
 *
 * Time tracking uses a requestAnimationFrame loop instead of the unreliable
 * playbackTimeDidChange MusicKit event. The loop runs only while isPlaying
 * is true and is cancelled on pause/unmount.
 */
import React, { createContext, useContext, useReducer, useEffect, useRef } from 'react';
import type { PlayerState, Track } from '@/types/music';
import { addPlayerListener, removePlayerListener } from '@/api/player';
import { getMusicKit } from '@/api/musickit';

type Action =
  | { type: 'PLAY'; track: Track; queue: Track[]; index: number }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'SEEK'; positionMs: number }
  | { type: 'NEXT' }
  | { type: 'PREV' }
  | { type: 'TOGGLE_SHUFFLE' }
  | { type: 'CYCLE_REPEAT' }
  | { type: 'MK_NOW_PLAYING'; track: Track | null }
  | { type: 'MK_PLAYBACK_STATE'; isPlaying: boolean }
  | { type: 'MK_TIME'; positionMs: number };

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
  return {
    id: item.id,
    title: a.name,
    artist: a.artistName,
    album: a.albumName,
    albumArtUrl: a.artwork?.url
      .replace('{w}', '300')
      .replace('{h}', '300'),
    durationMs: a.durationInMillis,
  };
}

function reducer(state: PlayerState, action: Action): PlayerState {
  switch (action.type) {
    case 'PLAY':
      return { ...state, currentTrack: action.track, queue: action.queue, queueIndex: action.index, isPlaying: true, positionMs: 0 };
    case 'PAUSE':
      return { ...state, isPlaying: false };
    case 'RESUME':
      return { ...state, isPlaying: true };
    case 'SEEK':
      return { ...state, positionMs: action.positionMs };
    case 'NEXT': {
      const next = state.queueIndex + 1;
      if (next >= state.queue.length) return state;
      return { ...state, queueIndex: next, currentTrack: state.queue[next], positionMs: 0 };
    }
    case 'PREV': {
      const prev = Math.max(0, state.queueIndex - 1);
      return { ...state, queueIndex: prev, currentTrack: state.queue[prev], positionMs: 0 };
    }
    case 'TOGGLE_SHUFFLE':
      return { ...state, shuffle: !state.shuffle };
    case 'CYCLE_REPEAT':
      return { ...state, repeat: state.repeat === 'none' ? 'all' : state.repeat === 'all' ? 'one' : 'none' };
    case 'MK_NOW_PLAYING':
      return { ...state, currentTrack: action.track };
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

  // Keep a ref in sync with state.isPlaying so the rAF loop can read it
  // without a stale closure.
  isPlayingRef.current = state.isPlaying;

  // ---------------------------------------------------------------------------
  // rAF-based time polling — smooth, frame-accurate progress tracking.
  // Runs only while playing, cancelled immediately on pause or unmount.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    function tick() {
      if (!isPlayingRef.current) {
        rafRef.current = null;
        return;
      }
      getMusicKit().then((mk) => {
        dispatch({
          type: 'MK_TIME',
          positionMs: mk.player.currentPlaybackTime * 1000,
        });
      });
      rafRef.current = requestAnimationFrame(tick);
    }

    if (state.isPlaying) {
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(tick);
      }
    } else {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [state.isPlaying]);

  // ---------------------------------------------------------------------------
  // MusicKit event listeners
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // playbackState 2 = playing in MusicKit JS v3
    const onPlaybackState = (event: unknown) => {
      const e = event as { state: number };
      dispatch({ type: 'MK_PLAYBACK_STATE', isPlaying: e.state === 2 });
    };

    const onNowPlaying = () => {
      getMusicKit().then((mk) => {
        const item = mk.player.nowPlayingItem;
        dispatch({ type: 'MK_NOW_PLAYING', track: item ? mkItemToTrack(item) : null });
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
