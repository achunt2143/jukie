/**
 * LibraryStore — fetches the user's full Apple Music library.
 * Only runs after the user is authorized (guarded by AuthStore).
 */
import React, { createContext, useContext, useState, useEffect } from 'react';
import type { Track, Album, Artist, Genre, Playlist } from '@/types/music';
import { getTracks, getAlbums, getArtists, getGenres, getPlaylists } from '@/api';
import { useAuth } from './AuthStore';

interface LibraryState {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
  genres: Genre[];
  playlists: Playlist[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

const LibraryContext = createContext<LibraryState | null>(null);

export function LibraryStoreProvider({ children }: { children: React.ReactNode }) {
  const { isAuthorized } = useAuth();
  const [state, setState] = useState<Omit<LibraryState, 'reload'>>({
    tracks: [], albums: [], artists: [], genres: [], playlists: [], loading: false, error: null,
  });

  function load() {
    if (!isAuthorized) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.all([getTracks(), getAlbums(), getArtists(), getGenres(), getPlaylists()])
      .then(([tracks, albums, artists, genres, playlists]) => {
        setState({ tracks, albums, artists, genres, playlists, loading: false, error: null });
      })
      .catch((err: Error) => {
        setState((s) => ({ ...s, loading: false, error: err.message }));
      });
  }

  useEffect(() => { load(); }, [isAuthorized]);

  return (
    <LibraryContext.Provider value={{ ...state, reload: load }}>
      {children}
    </LibraryContext.Provider>
  );
}

export function useLibrary() {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary must be used within LibraryStoreProvider');
  return ctx;
}
