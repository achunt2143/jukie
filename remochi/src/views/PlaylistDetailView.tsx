import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Header, Subheader, Spinner, Divider } from 'remochi';
import type { Playlist } from '@/types/music';
import { getPlaylistById } from '@/api';
import TrackList from '@/components/TrackList';

export default function PlaylistDetailView() {
  const { id } = useParams<{ id: string }>();
  const [playlist, setPlaylist] = useState<Playlist | null>(null);

  useEffect(() => {
    if (id) getPlaylistById(id).then(setPlaylist);
  }, [id]);

  if (!playlist) return <Spinner active styleType="dark" size="large" />;

  return (
    <div>
      <Header content={playlist.name} />
      {playlist.description && <Subheader content={playlist.description} />}
      <div style={{ marginBottom: 8 }} />
      <Divider />
      <div style={{ marginBottom: 8 }} />
      <TrackList tracks={playlist.tracks ?? []} />
    </div>
  );
}
