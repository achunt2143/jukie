/**
 * Ambient TypeScript declarations for MusicKit JS v3.
 * MusicKit is loaded via CDN script tag and exposed on window.MusicKit.
 */
declare namespace MusicKit {
  type AuthorizationStatus = 'authorized' | 'unauthorized' | 'unknown';
  type PlaybackStates = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

  interface MediaItem {
    id: string;
    type: string;
    attributes: {
      name: string;
      artistName: string;
      albumName: string;
      artwork?: { url: string; width: number; height: number };
      durationInMillis: number;
      trackNumber?: number;
      discNumber?: number;
      genreNames?: string[];
    };
  }

  interface Queue {
    items: MediaItem[];
    position: number;
  }

  interface Player {
    nowPlayingItem: MediaItem | null;
    playbackState: PlaybackStates;
    currentPlaybackTime: number;
    currentPlaybackDuration: number;
    shuffleMode: number;  // 0 = off, 1 = songs
    repeatMode: number;   // 0 = none, 1 = one, 2 = all
    queue: Queue;
    play(): Promise<void>;
    pause(): void;
    skipToNextItem(): Promise<void>;
    skipToPreviousItem(): Promise<void>;
    seekToTime(time: number): Promise<void>;
    prepareToPlay(descriptor: string | MediaItem | object, options?: object): Promise<void>;
  }

  interface MusicKitInstance {
    developerToken: string;
    musicUserToken: string | null;
    authorizationStatus: AuthorizationStatus;
    isAuthorized: boolean;
    player: Player;
    authorize(): Promise<string>;
    unauthorize(): Promise<void>;
    api: MusicKitAPI;
    addEventListener(event: string, callback: (event: unknown) => void): void;
    removeEventListener(event: string, callback: (event: unknown) => void): void;
    setQueue(options: SetQueueOptions): Promise<Queue>;
  }

  interface SetQueueOptions {
    song?: string;
    songs?: string[];
    album?: string;
    playlist?: string;
    startPosition?: number;
    url?: string;
  }

  interface MusicKitAPI {
    music(path: string, params?: Record<string, unknown>): Promise<{ data: unknown }>;
  }

  interface ConfigureOptions {
    developerToken: string;
    app: {
      name: string;
      build: string;
      version?: string;
    };
  }

  function configure(options: ConfigureOptions): MusicKitInstance;
  function getInstance(): MusicKitInstance;
}

interface Window {
  MusicKit: typeof MusicKit;
}
