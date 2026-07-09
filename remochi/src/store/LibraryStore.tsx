import React, { createContext, useContext, useState, useEffect } from 'react';
import type { Track, Album, Artist, Genre, Playlist } from '@/types/music';
import { getTracks, getAlbums, getArtists, getGenres, getPlaylists } from '@/api';

interface LibraryState {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
  genres: Genre[];
  playlists: Playlist[];
  loading: boolean;
}

const LibraryContext = createContext<LibraryState | null>(null);

export function LibraryStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<LibraryState>({
    tracks: [], albums: [], artists: [], genres: [], playlists: [], loading: true,
  });

  useEffect(() => {
    Promise.all([getTracks(), getAlbums(), getArtists(), getGenres(), getPlaylists()])
      .then(([tracks, albums, artists, genres, playlists]) => {
        setState({ tracks, albums, artists, genres, playlists, loading: false });
      });
  }, []);

  return <LibraryContext.Provider value={state}>{children}</LibraryContext.Provider>;
}

export function useLibrary() {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary must be used within LibraryStoreProvider');
  return ctx;
}
