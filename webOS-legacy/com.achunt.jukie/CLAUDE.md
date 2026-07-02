# Jukie — webOS Apple Music Client

This is a **Palm/HP webOS** application (original 2009–2012 platform, not LG webOS).

## Session Setup

At the start of every session, load the full webOS platform context:

```
webos://knowledge/all
```

This gives you knowledge of the Mojo/Enyo frameworks, Luna service bus, SDK tools (including novacom), app structure conventions, and common gotchas — so we don't have to re-establish basics each time.

## Local SDK reference (PREFER over probing the device)

The HP webOS SDK is installed locally at:

```
C:\Program Files (x86)\HP webOS\SDK\share
```

- Enyo 1 framework source (the same generation the device runs as "0.10"):
  `…\SDK\share\framework\enyo\1.0\framework\source\` — read these for real kind APIs
  (published props, events, methods) instead of grepping the minified build on-device.
- Sample apps: `…\SDK\share\samplecode\`, docs: `…\SDK\share\documentation\`.

**AppMenu items are plain objects** `{caption, onclick}` (NOT a `MenuItem` kind); nest a
`components` array for submenus. Example:

```js
{kind: "AppMenu", components: [
    {caption: "New Card", onclick: "openNewCard"},
    {caption: "Help"},
    {caption: "Find", components: [
        {caption: "Find Next"},
        {caption: "Find Prev"}
    ]}
]}
```

Useful form kinds (confirmed in the SDK): `ToggleButton` (published `state`, event
`onChange(sender,state)`), `ListSelector` (`items:[{caption,value}]`, `value`,
`onChange(sender,value,old)`), `ModalDialog`, `Input`, `CheckBox`, `RadioButton`.

---

## Project Details

**App ID:** `com.achunt.jukie`
**Framework:** Enyo 1 (Enyo 0.10, loaded from `/usr/palm/frameworks/enyo/0.10/`)
**Target devices:** TouchPad / Pre 3 era (Enyo 0.10 ⇒ webOS 2.x–3.x)
**Vendor:** achunt

## What it is

Jukie is an **Apple Music client** for legacy webOS. It reuses the structure of the
original Palm Music app (album/artist/genre/song/playlist views, dashboard, drag-to-reorder
playlists) but sources its catalog from the **Apple Music API** instead of the on-device
media database.

## App Structure

This is a single combined package built from **three** sibling directories (see the
webOS "Hello World Service" guide):

```
com.achunt.jukie/          ← this app
com.achunt.jukie.service/  ← Node JS service (audio playback) — see its own CLAUDE.md
com.achunt.jukie.package/  ← packageinfo.json that bundles app + service
```

Key files in the app:
- `appinfo.json` — app manifest (`type: web`, `noWindow: true`, `main: index.html`)
- `index.html` — bootstraps Enyo and instantiates `MusicAppLauncher`
- `launch/MusicAppLauncher.js` — entry point / relaunch handler
- `source/app.js` — `MusicPlayerApp` root kind; wires PalmServices, managers, and panes
- `source/*.js` — view kinds (album art, list views per artist/album/genre/song/playlist, nav, player controls)
- `controls/*.js` — reusable UI controls (alphapicker, list views, search input, media item menu)
- `utility/*.js` — non-UI logic: media index, playback, playlist manager, dashboard manager, audio player
- `utility/applemusicservice.js` — `AppleMusicService` Enyo component: client-side wrapper over the Apple Music REST API (catalog/search). **Not** a Luna service.
- `dashboard.html` / `dashboard/` — Now Playing dashboard
- `spec/` — Jasmine unit specs mirroring `source/`, `controls/`, `utility/`

## Services

This app **does** include a backend Luna service: **`com.achunt.jukie.service`**
(in the sibling `com.achunt.jukie.service/` directory).

It exists because webOS's HTML5 `<audio>` / `com.palm.mediad` pipeline can't play our
streams on-device (missing GStreamer `audioresample`). The service drives a hand-built
`gst-launch` pipeline instead and exposes `play / pause / resume / stop / getStatus`
over the bus. See that directory's CLAUDE.md for details.

The app also calls many stock Palm services directly via `PalmService` kinds in
`source/app.js`: `com.palm.audio` (volume/media), `com.palm.display`, `com.palm.keys`
(AVRCP / headset), `com.palm.service.mediabroadcast`.

## Status & roadmap (2026-07-02)

- **Working: full-track playback**, not just previews. `com.achunt.jukie.service/jukie-drm`
  does the Apple Music **web** playback + **Widevine (L3)** license exchange and writes a
  plain decrypted `.m4a` to a persistent on-device cache
  (`/media/internal/.jukie/cache`); the Luna service plays that file with a hand-built
  gst pipeline (`filesrc → decodebin → audioconvert → pulsesink`, since webOS's stock HTML5
  `<audio>`/`com.palm.mediad` pipeline is missing the `audioresample` element it needs).
- **Working: real seeking.** `gst-launch-0.10` has no interactive seek control of its own, so
  a seek kills the current pipeline, cuts a fragment from the cached file with `ffmpeg -ss <t>
  -acodec copy -f mp4` (this device's ffmpeg is an ancient 2011 build - no modern `-c`
  shorthand, no ADTS muxer - use the old flags), and plays that fragment instead.
  See `JukieAudioService.js`'s `seekTo`/`_runSeek` for the position-offset bookkeeping this
  requires.
- **Working:** pause is a real pause (not "acts like mute") - PulseAudio sink-suspend
  freezes the audio device itself (SIGSTOP alone only freezes gst; Pulse's own clock kept
  draining its buffer as silence). See `_suspendSink`/`pause`/`resume` in
  `JukieAudioService.js`.
- **Working:** full library browsing/sync (songs/albums/artists/playlists incl. playlist
  tracks), Apple Music catalog search + artist/album detail pages, A-Z fast-scroll
  (`AlphaPicker`) on Songs/Artists/Albums, Apple-Music-red theme (nav, dividers, sliders,
  player controls - some backed by user-supplied custom images, see `com.achunt.jukie/images/
  jukie-*.png`), Settings (storefront picker, cache management).
- **Working: volume slider.** It does NOT set the real OS-wide volume - com.palm.audio's
  `media/setVolume`/`getVolume` are private-bus-only, confirmed unreachable from a 3rd-party
  app via live device testing (public bus returns "Unknown method"; our own service's role
  has no outbound private-bus permission either). Instead the slider controls Jukie's own
  PulseAudio stream gain directly (`pactl set-sink-input-volume` on our gst pipeline's
  sink-input), which is a real, independently working volume control - just local to Jukie's
  own output, not the whole device. See `JukieAudioService.js`'s `setVolume`/`_applyVolume`.
- **Working: self-contained Help.** The AppMenu's `HelpMenu` kind only makes sense for HP/Palm's
  own apps (a `palm.com` target opens the on-device Help app; anything else just opens the web
  browser) - there's no manifest hook or content-registration API for a 3rd-party app to plug
  into the system Help app, confirmed from `enyo.HelpMenu`'s own source/doc comment. Replaced it
  with Jukie's own full-screen Help scene (`source/helpView.js`, `kindHelpView`, opened via
  `openHelp` in app.js - same paneTop-swap mechanism as Preferences). Covers: what Jukie is,
  how to get a Developer Token + Music User Token, and a thanks to the webOS Archive Team for
  the TLS upgrade. Deliberately does NOT cover Widevine/device.wvd extraction - that's DRM
  circumvention how-to and doesn't belong in published source, even obfuscated.
- **Deploy:** `powershell -ExecutionPolicy Bypass -File deploy-jukie.ps1` (full repackage;
  code changes can't be hot-pushed into the jail).

## Development Notes

- **Two senses of "Apple Music":** `utility/applemusicservice.js` is a client-side Enyo
  component hitting the Apple REST API. The audio *playback* Luna service is the separate
  `com.achunt.jukie.service` package. Don't conflate them.
- **Developer token:** `app.js` reads `window.APPLE_MUSIC_DEVELOPER_TOKEN`; a local
  `source/dev-token.local.js` supplies it and is git-/build-ignored (see `build-ignore`).
- Enyo leaks windows on desktop browser refresh; `index.html` has a `!window.PalmSystem`
  guard that tears down stale windows when run outside a device.
- This codebase descends from the original Palm Music app, so many kind names and DB kinds
  (`com.palm.music.*`) are inherited.

## Useful Commands

```bash
# Build the combined app+service package (package dir LAST)
palm-package com.achunt.jukie com.achunt.jukie.service com.achunt.jukie.package
palm-install com.achunt.jukie_0.0.1_all.ipk
palm-launch com.achunt.jukie

# Watch logs
palm-log -f com.achunt.jukie

# Quick file push during active development
novacom put file:///usr/palm/applications/com.achunt.jukie/source/app.js < source/app.js
```
