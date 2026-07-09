import React from 'react';
import { Badge } from 'remochi';
import type { Track } from '@/types/music';
import { usePlayer } from '@/store/PlayerStore';
import * as playerApi from '@/api/player';

function fmt(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

interface Props {
  tracks: Track[];
  onTrackClick?: (track: Track, index: number) => void;
}

export default function TrackList({ tracks, onTrackClick }: Props) {
  const { state, dispatch } = usePlayer();

  return (
    <div role="list">
      {tracks.map((track, i) => {
        const active = state.currentTrack?.id === track.id;
        return (
          <div
            key={track.id}
            role="listitem"
            onClick={() => {
              // Optimistic: show track info in PlayerBar immediately
              dispatch({ type: 'SET_CURRENT_TRACK', track });
              if (onTrackClick) {
                onTrackClick(track, i);
              } else {
                playerApi.playTrack(track, tracks, i);
              }
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 14px',
              borderRadius: 6,
              marginBottom: 2,
              cursor: 'pointer',
              background: active ? 'var(--mochi-accent, #0071e3)' : 'transparent',
              color: active ? '#fff' : 'inherit',
              userSelect: 'none',
            }}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.background = 'var(--mochi-hover, rgba(0,0,0,0.06))';
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.background = 'transparent';
            }}
          >
            <span style={{ flex: 1, fontSize: 14, fontWeight: active ? 600 : 400 }}>
              {track.title}
            </span>
            <span style={{ opacity: active ? 0.8 : 0.5, fontSize: 12, marginRight: 8 }}>
              {track.artist}
            </span>
            {active && (
              <Badge content="▶" background="rgba(255,255,255,0.25)" color="#fff" />
            )}
            <span style={{ opacity: active ? 0.8 : 0.4, fontSize: 12 }}>
              {fmt(track.durationMs)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
