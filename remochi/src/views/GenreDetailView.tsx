import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Header, Spinner, Divider } from 'remochi';
import type { Track } from '@/types/music';
import { getTracksByGenre } from '@/api';
import TrackList from '@/components/TrackList';

export default function GenreDetailView() {
  const { id } = useParams<{ id: string }>();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) getTracksByGenre(id).then((t) => { setTracks(t); setLoading(false); });
  }, [id]);

  return (
    <div>
      <Header>Genre</Header>
      <Divider />
      {loading ? <Spinner active styleType="dark" size="normal" /> : <TrackList tracks={tracks} />}
    </div>
  );
}
