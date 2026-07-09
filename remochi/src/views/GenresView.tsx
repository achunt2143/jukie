import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Header, List, ListItem, Spinner, Divider } from 'remochi';
import { useLibrary } from '@/store/LibraryStore';

export default function GenresView() {
  const { genres, loading } = useLibrary();
  const navigate = useNavigate();

  return (
    <div>
      <Header>Genres</Header>
      <Divider />
      {loading ? <Spinner active styleType="dark" size="normal" /> : (
        <List>
          {genres.map((g) => (
            <ListItem key={g.id} onSelect={() => navigate(`/library/genres/${g.id}`)}>
              {g.name}
              <span style={{ opacity: 0.5, fontSize: 12, marginLeft: 8 }}>{g.trackCount} songs</span>
            </ListItem>
          ))}
        </List>
      )}
    </div>
  );
}
