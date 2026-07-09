/**
 * PlayerBar — transport controls wired to MusicKit via playerApi.
 * Store state is driven entirely by MusicKit events, not optimistic dispatch.
 */
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
  const seekMs = useRef(0);

  const sliderValue = currentTrack && currentTrack.durationMs > 0
    ? (positionMs / currentTrack.durationMs) * 100
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

      {/* Transport — call API only, MusicKit events update the store */}
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
        onMouseDown={() => { isSeeking.current = true; }}
        onMouseUp={() => {
          if (!currentTrack) { isSeeking.current = false; return; }
          playerApi.seek(seekMs.current);
          isSeeking.current = false;
        }}
      >
        <Slider
          value={isSeeking.current ? (seekMs.current / (currentTrack?.durationMs ?? 1)) * 100 : sliderValue}
          onChange={(v: number) => {
            seekMs.current = (v / 100) * (currentTrack?.durationMs ?? 0);
          }}
        />
      </div>
      <span style={{ fontSize: 12, opacity: 0.6 }}>
        {currentTrack ? fmt(currentTrack.durationMs) : '--:--'}
      </span>

      {/* Shuffle & Repeat — dispatch to local store + sync to MusicKit */}
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
