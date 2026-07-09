import React, { createContext, useContext, useReducer, useEffect, useRef } from 'react';
import type { PlayerState, Track, PlayParams } from '@/types/music';
import { addPlayerListener, removePlayerListener } from '@/api/player';
import { getMusicKit } from '@/api/musickit';

type Action =
  | { type: 'SET_CURRENT_TRACK'; track: Track }   // optimistic: set immediately on click
  | { type: 'SET_QUEUE'; queue: Track[] }
  | { type: 'TOGGLE_SHUFFLE' }
  | { type: 'CYCLE_REPEAT' }
  | { type: 'MK_NOW_PLAYING'; track: Track | null } // MK confirmation/correction
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
      // Immediate optimistic update — shows title/artist/duration instantly
      return { ...state, currentTrack: action.track, positionMs: 0, isPlaying: true };
    case 'SET_QUEUE':
      return { ...state, queue: action.queue };
    case 'TOGGLE_SHUFFLE':
      return { ...state, shuffle: !state.shuffle };
    case 'CYCLE_REPEAT':
      return { ...state, repeat: state.repeat === 'none' ? 'all' : state.repeat === 'all' ? 'one' : 'none' };
    case 'MK_NOW_PLAYING':
      // MK confirmed the item — update with authoritative data (may differ slightly)
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

  // rAF loop — polls currentPlaybackTime every frame while playing
  useEffect(() => {
    function tick() {
      if (!isPlayingRef.current) {
        rafRef.current = null;
        return;
      }
      getMusicKit().then((mk) => {
        const t = mk.player.currentPlaybackTime;
        if (typeof t === 'number' && !isNaN(t)) {
          dispatch({ type: 'MK_TIME', positionMs: t * 1000 });
        }
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

  // MusicKit event listeners
  useEffect(() => {
    const onPlaybackState = (event: unknown) => {
      const e = event as { state: number };
      // 2 = Playing, 3 = Paused, 4 = Stopped, 5 = Ended
      dispatch({ type: 'MK_PLAYBACK_STATE', isPlaying: e.state === 2 });
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
