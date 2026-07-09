import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Header, List, ListItem, Spinner, Divider } from 'remochi';
import { useLibrary } from '@/store/LibraryStore';
import AlphaScroller from '@/components/AlphaScroller';

export default function ArtistsView() {
  const { artists, loading } = useLibrary();
  const navigate = useNavigate();
  const sorted = [...artists].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div style={{ position: 'relative' }}>
      <Header content='Artists' />
      <div style={{ marginBottom: 8 }} />
      <Divider />
      {loading ? <Spinner active styleType="dark" size="normal" /> : (
        <List>
          {sorted.map((a) => (
            <><ListItem key={a.id} onSelect={() => navigate(`/library/artists/${a.id}`)}>
              {a.name}
              <span style={{ opacity: 0.5, fontSize: 12, marginLeft: 8 }}>{a.albumCount} albums</span>
            </ListItem><div style={{ marginBottom: 4 }} /></>
          ))}
        </List>
      )}
      <AlphaScroller onSelect={() => {}} />
    </div>
  );
}
