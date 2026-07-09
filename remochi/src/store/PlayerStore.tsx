import React, { createContext, useContext, useReducer } from 'react';
import type { PlayerState, Track } from '@/types/music';

type Action =
  | { type: 'PLAY'; track: Track; queue: Track[]; index: number }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'SEEK'; positionMs: number }
  | { type: 'NEXT' }
  | { type: 'PREV' }
  | { type: 'TOGGLE_SHUFFLE' }
  | { type: 'CYCLE_REPEAT' };

const initial: PlayerState = {
  currentTrack: null,
  queue: [],
  queueIndex: 0,
  isPlaying: false,
  positionMs: 0,
  shuffle: false,
  repeat: 'none',
};

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
    default:
      return state;
  }
}

const PlayerContext = createContext<{ state: PlayerState; dispatch: React.Dispatch<Action> } | null>(null);

export function PlayerStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  return <PlayerContext.Provider value={{ state, dispatch }}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used within PlayerStoreProvider');
  return ctx;
}
