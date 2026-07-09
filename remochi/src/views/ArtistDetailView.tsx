import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { Header, Subheader, Spinner, Divider, List, ListItem } from 'remochi';
import type { Artist } from '@/types/music';
import { getArtistById } from '@/api';

export default function ArtistDetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [artist, setArtist] = useState<Artist | null>(null);

  useEffect(() => {
    if (id) getArtistById(id).then(setArtist);
  }, [id]);

  if (!artist) return <Spinner active styleType="dark" size="large" />;

  return (
    <div>
      <Header>{artist.name}</Header>
      <Subheader content={`${artist.albumCount} albums`} />
      <Divider />
      <List>
        {(artist.albums ?? []).map((album) => (
          <ListItem key={album.id} onSelect={() => navigate(`/library/albums/${album.id}`)}>
            {album.title}
            <span style={{ opacity: 0.5, fontSize: 12, marginLeft: 8 }}>{album.year}</span>
          </ListItem>
        ))}
      </List>
    </div>
  );
}
