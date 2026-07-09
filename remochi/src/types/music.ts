export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumArtUrl?: string;
  durationMs: number;
  trackNumber?: number;
  discNumber?: number;
  genre?: string;
}

export interface Album {
  id: string;
  title: string;
  artist: string;
  artUrl?: string;
  year?: number;
  trackCount: number;
  tracks?: Track[];
}

export interface Artist {
  id: string;
  name: string;
  artUrl?: string;
  albumCount: number;
  albums?: Album[];
}

export interface Genre {
  id: string;
  name: string;
  trackCount: number;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  artUrl?: string;
  trackCount: number;
  tracks?: Track[];
}

export interface PlayerState {
  currentTrack: Track | null;
  queue: Track[];
  queueIndex: number;
  isPlaying: boolean;
  positionMs: number;
  shuffle: boolean;
  repeat: 'none' | 'one' | 'all';
}

export interface SearchResults {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
}
