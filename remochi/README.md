# Jukie — Remochi (Web)

The modern web platform variant of Jukie, built with:

- **React 18** + **TypeScript**
- **Vite** for fast dev and optimised builds
- **Remochi** component library for all UI primitives

This is a clean-room reimplementation of the Jukie feature set. The Apple Music
backend is wired through the `src/api/` service layer so the UI never talks to
Any music provider API directly — swap the implementation there without touching
any view code.

## Getting started

```bash
cd remochi
npm install
npm run dev
```

## Project structure

```
remochi/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
└── src/
    ├── main.tsx          # Entry point — mounts ThemeWrapper + App
    ├── App.tsx           # Root router / shell
    ├── api/              # Backend service layer (stub → real impl)
    │   ├── index.ts
    │   ├── library.ts
    │   ├── search.ts
    │   └── player.ts
    ├── store/            # Lightweight React context stores
    │   ├── PlayerStore.tsx
    │   └── LibraryStore.tsx
    ├── views/            # Top-level routed views
    │   ├── LibraryView.tsx
    │   ├── ArtistsView.tsx
    │   ├── ArtistDetailView.tsx
    │   ├── AlbumsView.tsx
    │   ├── AlbumDetailView.tsx
    │   ├── SongsView.tsx
    │   ├── GenresView.tsx
    │   ├── GenreDetailView.tsx
    │   ├── PlaylistsView.tsx
    │   ├── PlaylistDetailView.tsx
    │   ├── SearchView.tsx
    │   ├── NowPlayingView.tsx
    │   └── SettingsView.tsx
    ├── components/       # Shared presentational components
    │   ├── NavSidebar.tsx
    │   ├── PlayerBar.tsx
    │   ├── TrackList.tsx
    │   ├── AlbumArtCard.tsx
    │   └── AlphaScroller.tsx
    └── types/
        └── music.ts      # Shared domain types
```

## Feature parity with webOS-legacy

| Legacy feature | Remochi equivalent |
|---|---|
| Songs / Artists / Albums library with A-Z scrubber | `SongsView`, `ArtistsView`, `AlbumsView` + `AlphaScroller` |
| Genre browsing | `GenresView` + `GenreDetailView` |
| Playlist management | `PlaylistsView` + `PlaylistDetailView` |
| Full Apple Music catalog search | `SearchView` |
| Now Playing cover-art view | `NowPlayingView` |
| Play controls (play/pause/skip/scrub/shuffle/repeat) | `PlayerBar` + `PlayerStore` |
| Settings | `SettingsView` |
