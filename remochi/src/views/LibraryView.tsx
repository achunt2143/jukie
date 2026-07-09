import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Header, List, ListItem, Divider } from 'remochi';

const sections = [
  { label: 'Songs',     path: '/library/songs',     icon: '🎵' },
  { label: 'Artists',   path: '/library/artists',   icon: '👤' },
  { label: 'Albums',    path: '/library/albums',    icon: '💿' },
  { label: 'Genres',    path: '/library/genres',    icon: '🎼' },
  { label: 'Playlists', path: '/library/playlists', icon: '📋' },
];

export default function LibraryView() {
  const navigate = useNavigate();
  return (
    <div>
      <Header>My Library</Header>
      <Divider />
      <List>
        {sections.map(({ label, path, icon }) => (
          <ListItem key={path} onSelect={() => navigate(path)}>
            {icon} {label}
          </ListItem>
        ))}
      </List>
    </div>
  );
}
