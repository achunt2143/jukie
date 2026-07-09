import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ListHeader, Header, Divider } from 'remochi';

const libraryLinks = [
  { label: 'Songs',     path: '/library/songs' },
  { label: 'Artists',   path: '/library/artists' },
  { label: 'Albums',    path: '/library/albums' },
  { label: 'Genres',    path: '/library/genres' },
  { label: 'Playlists', path: '/library/playlists' },
];

const extraLinks = [
  { label: 'Search',      path: '/search',       section: 'Discover' },
  { label: 'Now Playing', path: '/now-playing',   section: null },
  { label: 'Settings',    path: '/settings',      section: null },
];

interface NavItemProps {
  label: string;
  path: string;
  active: boolean;
  onClick: () => void;
}

function NavItem({ label, active, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        background: active ? 'var(--mochi-accent, #0071e3)' : 'transparent',
        color: active ? '#fff' : 'inherit',
        border: 'none',
        borderRadius: 6,
        padding: '8px 14px',
        fontSize: 14,
        fontWeight: active ? 600 : 400,
        cursor: 'pointer',
        margin: '1px 6px',
        width: 'calc(100% - 12px)',
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'var(--mochi-hover, rgba(0,0,0,0.06))';
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
      }}
    >
      {label}
    </button>
  );
}

export default function NavSidebar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <nav style={{
      gridArea: 'nav',
      borderRight: '1px solid var(--mochi-border)',
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{ padding: '16px 14px 8px' }}>
        <Header content="Jukie" />
      </div>
      <Divider />

      <div style={{ padding: '8px 0' }}>
        <ListHeader content="Library" />
        {libraryLinks.map(({ label, path }) => (
          <NavItem
            key={path}
            label={label}
            path={path}
            active={pathname === path}
            onClick={() => navigate(path)}
          />
        ))}

        <ListHeader content="Discover" />
        <NavItem
          label="Search"
          path="/search"
          active={pathname === '/search'}
          onClick={() => navigate('/search')}
        />

        <div style={{ marginTop: 8 }}>
          <NavItem
            label="Now Playing"
            path="/now-playing"
            active={pathname === '/now-playing'}
            onClick={() => navigate('/now-playing')}
          />
          <NavItem
            label="Settings"
            path="/settings"
            active={pathname === '/settings'}
            onClick={() => navigate('/settings')}
          />
        </div>
      </div>
    </nav>
  );
}
