/**
 * PlayerStore — MusicKit JS v3 events are the single source of truth.
 *
 * playbackStateDidChange  → isPlaying (drives rAF loop)
 * nowPlayingItemDidChange → currentTrack (with playParams + durationMs)
 *
 * Optimistic UI dispatch is intentionally removed — MusicKit fires these
 * events fast enough (~immediate) that there is no perceivable lag.
 */
import React, { createContext, useContext, useReducer, useEffect, useRef } from 'react';
import type { PlayerState, Track, PlayParams } from '@/types/music';
import { addPlayerListener, removePlayerListener } from '@/api/player';
import { getMusicKit } from '@/api/musickit';

type Action =
  | { type: 'SET_QUEUE'; queue: Track[] }
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
    case 'SET_QUEUE':
      return { ...state, queue: action.queue };
    case 'TOGGLE_SHUFFLE':
      return { ...state, shuffle: !state.shuffle };
    case 'CYCLE_REPEAT':
      return { ...state, repeat: state.repeat === 'none' ? 'all' : state.repeat === 'all' ? 'one' : 'none' };
    case 'MK_NOW_PLAYING':
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

  // ---------------------------------------------------------------------------
  // rAF time polling — only runs while MusicKit reports playing
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
  // MusicKit event listeners — single source of truth for all playback state
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const onPlaybackState = (event: unknown) => {
      // MusicKit JS v3 PlaybackStates: 0=none,1=loading,2=playing,3=paused,
      // 4=stopped,5=ended,6=seeking,7=waiting,8=stalled,9=completed,10=interrupted
      const e = event as { state: number };
      const playing = e.state === 2; // Playing
      dispatch({ type: 'MK_PLAYBACK_STATE', isPlaying: playing });
    };

    const onNowPlaying = () => {
      getMusicKit().then((mk) => {
        const item = mk.player.nowPlayingItem;
        dispatch({
          type: 'MK_NOW_PLAYING',
          track: item ? mkItemToTrack(item) : null,
        });
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
