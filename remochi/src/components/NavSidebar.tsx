import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { List, ListItem, ListHeader, Header, Divider } from 'remochi';

const libraryLinks = [
  { label: 'Songs',     path: '/library/songs' },
  { label: 'Artists',   path: '/library/artists' },
  { label: 'Albums',    path: '/library/albums' },
  { label: 'Genres',    path: '/library/genres' },
  { label: 'Playlists', path: '/library/playlists' },
];

export default function NavSidebar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <nav style={{ gridArea: 'nav', borderRight: '1px solid var(--mochi-border)', overflowY: 'auto' }}>
      <div style={{ padding: '16px 12px 8px' }}>
        <Header>Jukie</Header>
      </div>
      <Divider />
      <List>
        <ListHeader content="Library" />
        {libraryLinks.map(({ label, path }) => (
          <ListItem
            key={path}
            onSelect={() => navigate(path)}
            style={{ fontWeight: pathname === path ? 600 : undefined }}
          >
            {label}
          </ListItem>
        ))}
        <ListHeader content="Discover" />
        <ListItem onSelect={() => navigate('/search')} style={{ fontWeight: pathname === '/search' ? 600 : undefined }}>
          Search
        </ListItem>
        <ListHeader content="" />
        <ListItem onSelect={() => navigate('/now-playing')} style={{ fontWeight: pathname === '/now-playing' ? 600 : undefined }}>
          Now Playing
        </ListItem>
        <ListItem onSelect={() => navigate('/settings')} style={{ fontWeight: pathname === '/settings' ? 600 : undefined }}>
          Settings
        </ListItem>
      </List>
    </nav>
  );
}
