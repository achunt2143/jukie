import React, { useRef } from 'react';
import { Button, Slider } from 'remochi';
import { usePlayer } from '@/store/PlayerStore';
import * as playerApi from '@/api/player';

function fmt(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function PlayerBar() {
  const { state, dispatch } = usePlayer();
  const { currentTrack, isPlaying, positionMs, shuffle, repeat } = state;

  const isSeeking = useRef(false);
  // null = not currently dragging; number = ms position during drag
  const seekMs = useRef<number | null>(null);

  const duration = currentTrack?.durationMs ?? 0;
  const sliderValue = duration > 0
    ? Math.min(100, (positionMs / duration) * 100)
    : 0;

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
        <div style={{ fontSize: 12, opacity: 0.6 }}>{currentTrack?.artist ?? ''}</div>
      </div>

      {/* Transport */}
      <Button onClick={() => playerApi.skipPrev()}>⏮</Button>
      <Button onClick={() => {
        if (isPlaying) playerApi.pause();
        else playerApi.resume();
      }}>
        {isPlaying ? '⏸' : '▶'}
      </Button>
      <Button onClick={() => playerApi.skipNext()}>⏭</Button>

      {/* Scrubber */}
      <span style={{ fontSize: 12, opacity: 0.6 }}>{fmt(positionMs)}</span>
      <div
        style={{ flex: 1, margin: '0 32px' }}
        onMouseDown={() => {
          isSeeking.current = true;
          seekMs.current = positionMs; // capture current position as drag start
        }}
        onMouseUp={() => {
          isSeeking.current = false;
          // seekMs.current may be 0 (valid!) so check for null explicitly
          if (seekMs.current !== null) {
            playerApi.seek(seekMs.current);
          }
          seekMs.current = null;
        }}
      >
        <Slider
          value={
            isSeeking.current && seekMs.current !== null
              ? Math.min(100, (seekMs.current / (duration || 1)) * 100)
              : sliderValue
          }
          onChange={(v: number) => {
            const ms = (v / 100) * duration;
            seekMs.current = ms; // always update, even when ms === 0
            if (isSeeking.current) {
              dispatch({ type: 'MK_TIME', positionMs: ms });
            }
          }}
        />
      </div>
      <span style={{ fontSize: 12, opacity: 0.6 }}>
        {duration > 0 ? fmt(duration) : '--:--'}
      </span>

      {/* Shuffle & Repeat */}
      <Button
        variant={shuffle ? 'blue' : 'normal'}
        onClick={() => {
          const next = !shuffle;
          dispatch({ type: 'TOGGLE_SHUFFLE' });
          playerApi.setShuffle(next);
        }}
      >⇄</Button>
      <Button
        variant={repeat !== 'none' ? 'blue' : 'normal'}
        onClick={() => {
          const next = repeat === 'none' ? 'all' : repeat === 'all' ? 'one' : 'none';
          dispatch({ type: 'CYCLE_REPEAT' });
          playerApi.setRepeat(next);
        }}
      >{repeat === 'one' ? '🔂' : '🔁'}</Button>
    </div>
  );
}
