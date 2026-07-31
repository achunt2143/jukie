# Jukie (Enyo) — webOS Apple Music Client

This is a **Palm/HP webOS** application (original 2009–2012 platform, not LG webOS).

This is the **Enyo** build, for **webOS 3.x** devices (TouchPad/Pre3 era). It lives at
`com.achunt.jukie/enyo/`, sibling to the Mojo build at `../mojo/` (webOS 2.x) — both are
nested inside one unified `com.achunt.jukie` package that picks between them at launch. See
the top-level `../CLAUDE.md` for how the switcher/packaging works; this file stays focused
on Enyo-specific implementation detail.

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

The overall package is built from **three** sibling directories at the repo root (see the
webOS "Hello World Service" guide) — see the top-level `../CLAUDE.md` for the full picture:

```
com.achunt.jukie/          ← the unified app (this dir's parent) - a device-detecting
                              switcher at its root, THIS enyo/ subtree, and a mojo/ sibling
com.achunt.jukie.service/  ← Node JS service (audio playback) — see its own CLAUDE.md
com.achunt.jukie.package/  ← packageinfo.json that bundles app + service
```

There is no `appinfo.json` inside this `enyo/` subtree — the one manifest for the whole
package lives at `../appinfo.json` (`main` points at the top-level switcher, not directly
at this dir's `index.html`).

Key files in this Enyo build:
- `index.html` — bootstraps Enyo and instantiates `MusicAppLauncher` (reached via the
  top-level switcher's redirect, not launched directly)
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
  **This is TouchPad's path specifically** - the service now also targets older devices
  (Pre2) that need a different, software-decode pipeline; see
  `com.achunt.jukie.service/CLAUDE.md`'s "adaptive decode path" section before touching
  `JukieAudioService.js`'s `_playFile` - it self-selects at runtime, don't hardcode either
  pipeline as "the" one.
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
- **[NEW - architecture + clean load verified on-device; final visuals/persistence pending
  a user eyeball after the 3-fix round below] Exhibition Mode** - a Touchstone-dock
  presentation window (`appinfo.json` `dockMode:true`), mirroring the old AccuWeather Enyo
  sample's dock-mode architecture and reusing Jukie's own pre-existing minimize-time
  Dashboard cross-window pattern (`utility/dashboardmanager.js`) for the plumbing. `launch/
  MusicAppLauncher.js`'s `appSelect()` inspects launch params for
  `{windowType:"dockModeWindow", dockMode:true}` and opens `exhibition.html` (kind
  `ExhibitionApp`, `exhibition/exhibitionView.js`+`.css`) instead of the normal player
  window. `source/app.js` has a new `ExhibitionManager` component
  (`utility/exhibitionmanager.js`) that pushes track info/play-state/elapsed time into the
  Exhibition window via `enyo.windows.setWindowParams` (same channel Dashboard already
  uses), and receives prev/playpause/next taps back via the existing `cmdType`/
  `processDashCommand` channel - no new receiving-side code needed there. Shows clock,
  song/artist/album, elapsed/duration, and a large art background; no scrubber/volume
  (deliberately minimal, per Exhibition Mode's own design guidelines). AppMenu >
  "Exhibition Mode" opens it manually (`onClick_ExhibitionMode`) for testing without
  physical Touchstone dock hardware.
  - **GOTCHA - must open as `{window:"dockMode"}`, not a plain card.** The exhibition window
    is opened via `enyo.windows.activate(path, name, params, attributes)` where attributes =
    `{window:"dockMode"}` (carried on the launcher's `faces.exhibition.attributes`, and passed
    explicitly in `onClick_ExhibitionMode`). Opening it as a normal card made webOS's
    Exhibition manager not recognize it as the dock surface and revert to the built-in Clock
    app after ~a minute. `activate()` forwards the 4th arg straight to `openWindow`, which
    honors `attributes.window` (verified in the SDK's windows.js).
  - **GOTCHA - elapsed time is a WALL-CLOCK model in the Exhibition window.** While
    Exhibition is foreground the main card is backgrounded and webOS throttles its JS timers,
    so the main window's 500ms status poll (which drives the time pushes) fires only every
    several seconds. `ExhibitionApp` therefore derives elapsed from
    `_baseElapsed + (now - _baseAt)` while playing (`_currentElapsed()`), re-basing on each
    push. A naive "increment a counter each second AND snap to every push" jittered +/-1s
    because the service's reported position samples don't line up with a local counter; the
    wall-clock derivation is monotonic between pushes, and a push only re-bases FORWARD
    (small backward jitter `< 5s` behind is ignored; real seeks / track changes still snap).
    `kindPlayback.intUpdateRateChanged` is a no-op, so this can't be fixed by changing the
    poll rate; it's OS-level background-timer throttling.
  - **GOTCHA - dock-mode windows crash enyo's pending-params flush; hardened in the
    launcher.** A dock-mode window is cross-process, so on this WebKit the "enyoWindowReady"
    postMessage it sends to its opener (the root/`index.html` window) arrives with an
    UNDEFINED `e.source`. enyo's message listener then calls
    `enyo.windows.manager.executePendingWindowParams(undefined)`, which dereferences
    `inWindow.name` and throws an uncaught TypeError on every single dock entry. It's
    harmless (the pending-params flush can't work for a cross-process window anyway - its
    name isn't resolvable, so the pending list is empty), but noisy. `MusicAppLauncher`'s
    `hardenWindowManager()` (called first thing in `startup()`, which runs in the root
    window) wraps `executePendingWindowParams` to no-op when the source is undefined and
    forward all real windows through. Verified via `/var/log/messages`: the error no longer
    fires when the exhibition window opens.
  - **Transport icons** use the white `images/btn_dashboard_*.png` sprites on translucent
    dark circular backings (`exhibitionView.css`) so they read on ANY album art - the dark
    circle gives contrast for the white glyph on light art, the white glyph pops on dark art.
    (The dark-glyph `btn_controls_*` set was invisible against dark album art.)
  - **[Confirmed working on-device 2026-07-29] Standalone resume when Jukie isn't running.**
    If you dock while the Jukie app is closed, Exhibition shows the last-played song,
    re-queues the rest, and resumes from where you left off - instead of an empty/idle
    screen. (One early test looked broken - a stale LunaSysMgr/window state after heavy
    redeploy/dock churn during development; a Luna restart cleared it and it's worked
    since. Not a bug in this feature itself, but worth remembering if it ever seems to
    "not resume" again after a lot of redeploy/dock cycling in one session.)
    - **Persistence: `utility/playbacksession.js` (`kindPlaybackSession`)** - a db8 singleton
      (`com.achunt.jukie.playbacksession:1`) storing `{queue (lean track refs), index,
      position, playing, shuffle, repeat, originListID, listQuery}`. Same singleton pattern as
      `kindSettings`, but it carries its OWN `kindDB8` (not the app-wide `this.$.DB8` that
      LibraryCache/Settings share) so its frequent progress writes don't contend on that one
      queue (see [[settings-save-db8-queue-bug]]). `save()` writes the whole session (only on
      queue change); `saveProgress()` db8-MERGEs just index/position/playing (the frequent
      path) so the queue isn't rewritten each tick. Queue is windowed to `MAX_QUEUE=400`
      around the current track so a play-all-library doesn't make a huge doc.
    - **`kindPlayback.getSessionSnapshot()`** returns that snapshot; `source/app.js` saves it:
      full save on `onPlaybackListSet` (queue changed), progress save on `onTrackSrcChanged` /
      `onTrackPausePlay` / a ~7s-throttled `onUpdateTrackTime` / `unloadHandler`. All saves are
      fire-and-forget + guarded so a db8 hiccup can't disturb playback.
    - **Resume driver lives IN the Exhibition window.** `ExhibitionApp` now hosts its own
      dormant `kindPlayback` + `kindPlaybackSession`. On create it checks
      `enyo.windows.fetchWindow("com.achunt.jukie")`: if the main window EXISTS -> passive mode
      (the confirmed-working push-driven display; the engine stays dormant and never touches
      the service). If ABSENT -> standalone mode: load the session and
      `Playback.setPlaybackList({...intStartTrackTime: position})` to resume+autoplay, wiring
      the engine's own `onTrackSrcChanged/onUpdateTrackTime/onTrackPausePlay/onSongEnd` into
      the SAME display methods the pushes use. Transport buttons branch on `_standalone`
      (drive the local engine vs. forward `cmdType` to the main window). This keeps the two
      modes from ever both driving the service. **Reason it's a separate engine, not a hidden
      main window:** it avoids touching the main window's delicate hidden/deactivated/unload
      lifecycle handlers (which pause/stop playback) - the standalone path is fully
      self-contained in the foreground dock window.
    - **Auto-play on resume is intentional** (user asked to "start playing from where we left
      off"), even if the session was paused when saved. A non-empty sentinel
      `strOriginListID:"exhresume"` is used so `kindPlaybackList` treats it as a fresh list to
      load rather than a same-list track switch.
    - **Known v1 edge (not yet exercised):** if the user opens the full Jukie app WHILE
      Exhibition is standalone-playing, the service keeps playing but the main app opens
      idle/unaware - acceptable, no crash, just not unified state.
- **Deploy:** from the repo root (`webOS-legacy/`), `powershell -ExecutionPolicy Bypass
  -File deploy-jukie.ps1` (full repackage; code changes can't be hot-pushed into the
  jail). One script now covers both this Enyo build and the Mojo build — see the
  top-level `../CLAUDE.md`.

## Development Notes

- **Two senses of "Apple Music":** `utility/applemusicservice.js` is a client-side Enyo
  component hitting the Apple REST API. The audio *playback* Luna service is the separate
  `com.achunt.jukie.service` package. Don't conflate them.
- **Developer token:** `app.js` reads `window.APPLE_MUSIC_DEVELOPER_TOKEN`; a local
  `source/dev-token.local.js` supplies it, loaded via a plain `<script>` tag in
  `main.html` with an `onerror` fallback to `''` (so a missing file fails gracefully,
  not with a broken app). It's git-ignored (`*.local.*` at the repo root) - but
  **`build-ignore` does NOT actually exclude it from a real `palm-package` build**,
  despite listing `*.local.js`. Verified by extracting a built `.ipk`: `jasminerunner.html`
  and `spec/`, also in `build-ignore`, were both inside it too. That file is leftover
  from this project's original Ruby/Rake build tooling - the modern SDK's
  `palm-package.bat` (what `deploy-jukie.ps1` actually uses) doesn't read it at all. A
  package built for personal use with an intentionally-empty token (so Settings starts
  blank) has to physically move the file out of the directory before packaging - see
  `dev-stuff/build-personal-package.ps1`.
- Enyo leaks windows on desktop browser refresh; `index.html` has a `!window.PalmSystem`
  guard that tears down stale windows when run outside a device.
- This codebase descends from the original Palm Music app, so many kind names and DB kinds
  (`com.palm.music.*`) are inherited.

## Useful Commands

Run from the repo root (`webOS-legacy/`), not from this `enyo/` dir:

```bash
# Build the combined app+service package (package dir LAST)
palm-package com.achunt.jukie com.achunt.jukie.service com.achunt.jukie.package
palm-install com.achunt.jukie_0.0.1_all.ipk
palm-launch com.achunt.jukie

# Watch logs
palm-log -f com.achunt.jukie

# Quick file push during active development (note the enyo/ prefix on the device side -
# this build now installs nested under the unified app)
novacom put file:///usr/palm/applications/com.achunt.jukie/enyo/source/app.js < source/app.js
```
