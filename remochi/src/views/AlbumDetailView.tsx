import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Header, Subheader, Spinner, Divider } from 'remochi';
import type { Album } from '@/types/music';
import { getAlbumById } from '@/api';
import TrackList from '@/components/TrackList';

export default function AlbumDetailView() {
  const { id } = useParams<{ id: string }>();
  const [album, setAlbum] = useState<Album | null>(null);

  useEffect(() => {
    if (id) getAlbumById(id).then(setAlbum);
  }, [id]);

  if (!album) return <Spinner active styleType="dark" size="large" />;

  return (
    <div>
      <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
        <div style={{ width: 140, height: 140, borderRadius: 8, overflow: 'hidden', background: 'var(--mochi-surface)', flexShrink: 0 }}>
          {album.artUrl
            ? <img src={album.artUrl} alt={album.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40 }}>🎵</div>}
        </div>
        <div>
          <Header>{album.title}</Header>
          <Subheader content={`${album.artist}${album.year ? ` · ${album.year}` : ''} · ${album.trackCount} tracks`} />
        </div>
      </div>
      <Divider />
      <TrackList tracks={album.tracks ?? []} />
    </div>
  );
}
