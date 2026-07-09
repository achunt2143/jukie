import React from 'react';
import { Header, Subheader, ProgressBar, Button, Divider } from 'remochi';
import { usePlayer } from '@/store/PlayerStore';
import * as playerApi from '@/api/player';

export default function NowPlayingView() {
  const { state, dispatch } = usePlayer();
  const { currentTrack, isPlaying, positionMs, shuffle, repeat } = state;

  const progress = currentTrack ? (positionMs / currentTrack.durationMs) * 100 : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, padding: 32 }}>
      {/* Album art */}
      <div style={{
        width: 280, height: 280, borderRadius: 16, overflow: 'hidden',
        background: 'var(--mochi-surface)', boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
      }}>
        {currentTrack?.albumArtUrl
          ? <img src={currentTrack.albumArtUrl} alt="Album art" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 64 }}>🎵</div>
        }
      </div>

      <div style={{ textAlign: 'center' }}>
        <Header>{currentTrack?.title ?? 'Nothing playing'}</Header>
        <Subheader content={currentTrack ? `${currentTrack.artist} · ${currentTrack.album}` : ''} />
      </div>

      <div style={{ width: '100%', maxWidth: 400 }}>
        <ProgressBar value={progress} />
      </div>

      <Divider />

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <Button variant={shuffle ? 'blue' : 'normal'} onClick={() => dispatch({ type: 'TOGGLE_SHUFFLE' })}>⇄ Shuffle</Button>
        <Button onClick={() => { dispatch({ type: 'PREV' }); playerApi.skipPrev(); }}>⏮ Prev</Button>
        <Button onClick={() => {
          if (isPlaying) { dispatch({ type: 'PAUSE' }); playerApi.pause(); }
          else { dispatch({ type: 'RESUME' }); playerApi.resume(); }
        }}>
          {isPlaying ? '⏸ Pause' : '▶ Play'}
        </Button>
        <Button onClick={() => { dispatch({ type: 'NEXT' }); playerApi.skipNext(); }}>⏭ Next</Button>
        <Button variant={repeat !== 'none' ? 'blue' : 'normal'} onClick={() => dispatch({ type: 'CYCLE_REPEAT' })}>
          {repeat === 'one' ? '🔂 One' : '🔁 Repeat'}
        </Button>
      </div>
    </div>
  );
}
