import React from 'react';
import { Button, ProgressBar, Slider } from 'remochi';
import { usePlayer } from '@/store/PlayerStore';
import * as playerApi from '@/api/player';

function fmt(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function PlayerBar() {
  const { state, dispatch } = usePlayer();
  const { currentTrack, isPlaying, positionMs, shuffle, repeat } = state;

  return (
    <div style={{
      gridArea: 'player',
      borderTop: '1px solid var(--mochi-border)',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '0 20px',
    }}>
      {/* Track info */}
      <div style={{ minWidth: 180 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{currentTrack?.title ?? '—'}</div>
        <div style={{ fontSize: 12, opacity: 0.6 }}>{currentTrack?.artist}</div>
      </div>

      {/* Transport */}
      <Button onClick={() => { dispatch({ type: 'PREV' }); playerApi.skipPrev(); }}>⏮</Button>
      <Button
        onClick={() => {
          if (isPlaying) { dispatch({ type: 'PAUSE' }); playerApi.pause(); }
          else { dispatch({ type: 'RESUME' }); playerApi.resume(); }
        }}
      >
        {isPlaying ? '⏸' : '▶'}
      </Button>
      <Button onClick={() => { dispatch({ type: 'NEXT' }); playerApi.skipNext(); }}>⏭</Button>

      {/* Scrubber */}
      <span style={{ fontSize: 12, opacity: 0.6 }}>{fmt(positionMs)}</span>
      <div style={{ flex: 1, margin: "0px 32px" }}>
        <Slider
          value={currentTrack ? (positionMs / currentTrack.durationMs) * 100 : 0}
          onChange={(v) => {
            if (!currentTrack) return;
            const ms = (v / 100) * currentTrack.durationMs;
            dispatch({ type: 'SEEK', positionMs: ms });
            playerApi.seek(ms);
          }}
        />
      </div>
      <span style={{ fontSize: 12, opacity: 0.6 }}>
        {currentTrack ? fmt(currentTrack.durationMs) : '--:--'}
      </span>

      {/* Modes */}
      <Button
        variant={shuffle ? 'blue' : 'normal'}
        onClick={() => dispatch({ type: 'TOGGLE_SHUFFLE' })}
      >⇄</Button>
      <Button
        variant={repeat !== 'none' ? 'blue' : 'normal'}
        onClick={() => dispatch({ type: 'CYCLE_REPEAT' })}
      >{repeat === 'one' ? '🔂' : '🔁'}</Button>
    </div>
  );
}
