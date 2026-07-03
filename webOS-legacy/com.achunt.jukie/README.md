# Jukie

An unofficial Apple Music client for legacy **Palm/HP webOS** — built for the TouchPad
and Pre 3 era (webOS 2.x–3.x, 2011–2012 hardware), not LG's modern webOS TV platform.

Jukie reuses the structure of the original Palm Music app (album/artist/genre/song/
playlist views, a Now Playing dashboard, drag-to-reorder playlists) but sources its
catalog, library, and playback from the **Apple Music API** instead of the on-device
media database.

See [**FEATURES.md**](../FEATURES.md) for a screenshot tour of what it can do, or
[**RELEASE_NOTES.md**](../RELEASE_NOTES.md) for a full summary of what went into it.

## Features

- Full library browsing and sync: songs, albums, artists, and playlists (including
  playlist track order), synced from your Apple Music library.
- Apple Music catalog search, with artist and album detail pages.
- **Full-track playback**, not just 30-second previews — see
  [`com.achunt.jukie.service`](../com.achunt.jukie.service) and [`jukie-drm`](../jukie-drm)
  for how.
- Real seeking and a working, real pause (not "pause acts like mute").
- A-Z fast-scroll (`AlphaPicker`) on the Songs/Artists/Albums lists.
- An Apple-Music-styled red theme applied over the stock Enyo/Onyx look (nav, dividers,
  sliders, player controls, grouped settings sections).
- A working volume slider — see the caveat below.
- Offline track caching, with a Settings screen to manage it.
- A self-contained in-app Help screen (there's no real way to plug into webOS's system
  Help app as a 3rd-party app — see `source/helpView.js` for why).

## What it is *not*

- **Not** a FairPlay client. Apple's native mobile delivery is FairPlay-DRM'd; Jukie
  instead authenticates as the Apple Music **web player**, which serves Widevine to
  non-Safari browsers. See [`jukie-drm`](../jukie-drm)'s README for the full chain.
- **Not** able to set the device's real system volume. `com.palm.audio`'s
  `media/setVolume`/`getVolume` are private-bus-only on this webOS build — unreachable
  from any 3rd-party app (confirmed via live testing, not assumed). Jukie's volume
  slider instead controls its own PulseAudio stream gain directly, which is a real,
  independently-working volume control — just scoped to Jukie's own output, not the
  whole device.

## Requirements

- A Palm/HP webOS 2.x–3.x device (TouchPad or Pre 3) with **Developer Mode** enabled and
  novacom access, or the HP webOS SDK's emulator.
- The [HP webOS SDK](https://www.webosarchive.org/) (for `palm-package`/`palm-install`
  and novacom).
- An Apple Music subscription, plus two credentials (see **Getting tokens** below):
  a Developer Token and a Music User Token.
- For full-track playback specifically: a Widevine L3 device credential for
  [`jukie-drm`](../jukie-drm) — optional; without one, Jukie still works great for
  library browsing, catalog search, and previews.

## Getting your Apple Music tokens

- **Developer Token** — either a real Apple Developer Program MusicKit JWT (requires
  a paid Developer Program membership: create a MusicKit identifier + private key,
  sign an ES256 JWT), or the short-lived public token music.apple.com's own web player
  uses (visible in your browser's network inspector as the `Authorization: Bearer`
  header on `api.music.apple.com` requests — expires roughly monthly).
- **Music User Token** — identifies your personal library/subscription. Sign in to
  music.apple.com in a desktop browser, open dev tools, and grab the
  `media-user-token` cookie (or the `Music-User-Token` request header). Long-lived
  (months), so this is normally a one-time paste.

Paste both into Settings once the app is running (see `source/settingsView.js`), or
supply a build-time developer token via a git-ignored `source/dev-token.local.js` that
sets `window.APPLE_MUSIC_DEVELOPER_TOKEN`.

## Building & deploying

This app packages together with its sibling Luna service (see
[`com.achunt.jukie.service`](../com.achunt.jukie.service)) via a shared
[`com.achunt.jukie.package`](../com.achunt.jukie.package) descriptor:

```powershell
powershell -ExecutionPolicy Bypass -File deploy-jukie.ps1
```

This does a full `palm-package` + `palm-install`, then (critically) registers the JS
service on the device's LS2 bus and restarts it — `palm-install` alone leaves the
service silently broken on a real device. See the service's own README for why.

```bash
# Manual equivalent, if you're not using the script:
palm-package com.achunt.jukie com.achunt.jukie.service com.achunt.jukie.package
palm-install com.achunt.jukie_0.0.1_all.ipk
palm-launch com.achunt.jukie
```

## Project structure

- `appinfo.json` / `index.html` / `launch/MusicAppLauncher.js` — app manifest and entry point.
- `source/app.js` — root `MusicPlayerApp` kind; wires PalmServices, managers, and panes.
- `source/*.js` — view kinds: album art carousel, per-type list views (songs/albums/
  artists/genres/playlists), navigation panel, player controls, Settings, Help.
- `controls/*.js` — reusable controls: list views, the A-Z `AlphaPicker`, search input,
  media item menus.
- `utility/*.js` — non-UI logic: media index, playback orchestration, playlist/dashboard
  managers, the audio player facade, and `applemusicservice.js` (the client-side wrapper
  over the Apple Music REST API for catalog/search — distinct from the Luna
  *playback* service; see the note below).
- `dashboard.html` / `dashboard/` — the Now Playing dashboard.
- `spec/` — Jasmine unit specs mirroring `source/`, `controls/`, `utility/`.

**Two senses of "Apple Music" in this codebase**: `utility/applemusicservice.js` is a
plain client-side Enyo component hitting Apple's REST API for catalog/search. Full-track
*playback* (DRM, decoding, the actual audio pipeline) is an entirely separate Luna
service — see `com.achunt.jukie.service`. Don't conflate the two.

## Architecture notes / known gotchas

- This webOS build's HTML5 `<audio>` element (and the `com.palm.mediad` pipeline behind
  it) is missing the GStreamer `audioresample` element, so it can't play Jukie's audio
  at all — this is the whole reason a custom Luna service exists.
- Enyo's `VFlexBox`/`HFlexBox` (and anything using its `layoutKind` mechanism) needs an
  explicit `flex` or `height` on children — several UI bugs this project hit traced back
  to a child silently not getting sized without one.
- `enyo.Component.createComponent(inInfo, inMoreInfo)` defaults `owner` to whatever
  object `createComponent` was called *on*, not automatically the enclosing kind. Calling
  it on a child control (e.g. `this.$.someList.createComponent(...)`) without explicitly
  passing `{owner: this}` silently breaks event dispatch — this caused more than one
  "tap does nothing" bug during development.
- `enyo.RowGroup`'s native 9-slice border-image frame doesn't render reliably on this
  particular device/theme build (confirmed by direct on-device screenshot comparison
  against the stock Sounds & Ringtones app). Settings and Help both draw their own
  explicit bordered box (`.jukieBoxSection`) instead of relying on it.

## Credits

Huge thanks to the **webOS Archive Team**, whose TLS upgrade for these devices' system
libraries is the only reason reaching Apple's modern HTTPS-only servers is possible at
all on hardware this old.

Built on the bones of the original Palm/HP **Music** app for webOS.
