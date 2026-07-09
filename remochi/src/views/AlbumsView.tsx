import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Header, Spinner, Divider } from 'remochi';
import { useLibrary } from '@/store/LibraryStore';
import AlbumArtCard from '@/components/AlbumArtCard';

export default function AlbumsView() {
  const { albums, loading } = useLibrary();
  const navigate = useNavigate();
  const sorted = [...albums].sort((a, b) => a.title.localeCompare(b.title));

  return (
    <div>
      <Header content='Albums' />
      <div style={{ marginBottom: 8 }} />
      <Divider />
      {loading ? <Spinner active styleType="dark" size="large" /> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 16 }}>
          {sorted.map((album) => (
            <AlbumArtCard key={album.id} album={album} onClick={() => navigate(`/library/albums/${album.id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}
