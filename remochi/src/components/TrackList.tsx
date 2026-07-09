import React from 'react';
import { List, ListItem, Badge } from 'remochi';
import type { Track } from '@/types/music';
import { usePlayer } from '@/store/PlayerStore';
import * as playerApi from '@/api/player';

function fmt(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

interface Props {
  tracks: Track[];
}

export default function TrackList({ tracks }: Props) {
  const { state, dispatch } = usePlayer();

  return (
    <List>
      {tracks.map((track, i) => {
        const active = state.currentTrack?.id === track.id;
        return (
          <><ListItem
            key={track.id}
            onSelect={() => {
              dispatch({ type: 'PLAY', track, queue: tracks, index: i });
              playerApi.playTrack(track);
            } }
          >
            <span style={{ flex: 1 }}>{track.title}</span>
            <span style={{ opacity: 0.5, fontSize: 12, marginRight: 8 }}>{track.artist}</span>
            {active && <Badge content="▶" background="var(--mochi-accent)" color="#fff" />}
            <span style={{ opacity: 0.4, fontSize: 12 }}>{fmt(track.durationMs)}</span>
          </ListItem><div style={{ marginBottom: 4 }} /></>
        );
      })}
    </List>
  );
}
