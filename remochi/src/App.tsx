import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import NavSidebar from '@/components/NavSidebar';
import PlayerBar from '@/components/PlayerBar';
import { PlayerStoreProvider } from '@/store/PlayerStore';
import { LibraryStoreProvider } from '@/store/LibraryStore';
import LibraryView from '@/views/LibraryView';
import SongsView from '@/views/SongsView';
import ArtistsView from '@/views/ArtistsView';
import ArtistDetailView from '@/views/ArtistDetailView';
import AlbumsView from '@/views/AlbumsView';
import AlbumDetailView from '@/views/AlbumDetailView';
import GenresView from '@/views/GenresView';
import GenreDetailView from '@/views/GenreDetailView';
import PlaylistsView from '@/views/PlaylistsView';
import PlaylistDetailView from '@/views/PlaylistDetailView';
import SearchView from '@/views/SearchView';
import NowPlayingView from '@/views/NowPlayingView';
import SettingsView from '@/views/SettingsView';
import './app.css';
import { Panel } from 'remochi';

export default function App() {
  return (
    <BrowserRouter>
      <LibraryStoreProvider>
        <PlayerStoreProvider>
          <div className="jukie-shell">
            <Panel style='shadow'><NavSidebar /></Panel>
            <Panel>
            <main className="jukie-main">
              <Routes>
                <Route path="/" element={<Navigate to="/library" replace />} />
                <Route path="/library" element={<LibraryView />} />
                <Route path="/library/songs" element={<SongsView />} />
                <Route path="/library/artists" element={<ArtistsView />} />
                <Route path="/library/artists/:id" element={<ArtistDetailView />} />
                <Route path="/library/albums" element={<AlbumsView />} />
                <Route path="/library/albums/:id" element={<AlbumDetailView />} />
                <Route path="/library/genres" element={<GenresView />} />
                <Route path="/library/genres/:id" element={<GenreDetailView />} />
                <Route path="/library/playlists" element={<PlaylistsView />} />
                <Route path="/library/playlists/:id" element={<PlaylistDetailView />} />
                <Route path="/search" element={<SearchView />} />
                <Route path="/now-playing" element={<NowPlayingView />} />
                <Route path="/settings" element={<SettingsView />} />
              </Routes>
            </main>
            </Panel>
            <PlayerBar />
          </div>
        </PlayerStoreProvider>
      </LibraryStoreProvider>
    </BrowserRouter>
  );
}
