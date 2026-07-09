import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Header, List, ListItem, Spinner, Divider } from 'remochi';
import { useLibrary } from '@/store/LibraryStore';

export default function PlaylistsView() {
  const { playlists, loading } = useLibrary();
  const navigate = useNavigate();

  return (
    <div>
      <Header>Playlists</Header>
      <Divider />
      {loading ? <Spinner active styleType="dark" size="normal" /> : (
        <List>
          {playlists.map((p) => (
            <><ListItem key={p.id} onSelect={() => navigate(`/library/playlists/${p.id}`)}>
              {p.name}
              <span style={{ opacity: 0.5, fontSize: 12, marginLeft: 8 }}>{p.trackCount} songs</span>
            </ListItem><div style={{ marginBottom: 4 }} /></>
          ))}
        </List>
      )}
    </div>
  );
}
