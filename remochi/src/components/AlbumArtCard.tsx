import React from 'react';
import type { Album } from '@/types/music';

interface Props {
  album: Album;
  onClick?: () => void;
}

export default function AlbumArtCard({ album, onClick }: Props) {
  return (
    <div
      onClick={onClick}
      style={{
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{
        width: '100%',
        aspectRatio: '1',
        background: 'var(--mochi-surface)',
        borderRadius: 8,
        overflow: 'hidden',
      }}>
        {album.artUrl
          ? <img src={album.artUrl} alt={album.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>🎵</div>
        }
      </div>
      <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{album.title}</div>
      <div style={{ fontSize: 12, opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{album.artist}</div>
    </div>
  );
}
