# Jukie (Mojo) — webOS 2.x Apple Music client

This is the **Mojo** build of Jukie, for **webOS 2.x** devices (Palm Pre2/Pre3/Veer
era). It lives at `com.achunt.jukie/mojo/`, sibling to the Enyo app at `../enyo/` (webOS
3.x / TouchPad) — both are now nested inside one unified `com.achunt.jukie` package that
picks between them at launch. Same product, same app id (`com.achunt.jukie`), same bundled
playback service — different UI framework because Enyo never shipped on webOS 2.x. See the
top-level `../CLAUDE.md` for how the switcher/packaging works; this file stays focused on
Mojo-specific implementation detail.

**Status (2026-07-30): extensively tested on real Pre2 hardware, feature-complete except
for one item** (see "Missing vs. the Enyo app" below). Authored 2026-07-28 by porting the
Enyo app's logic against Palm's real extracted Music Player app as the Mojo reference,
then hardened over many rounds of on-device testing.

## What carries over vs. what's new

The whole business-logic layer is a near-verbatim port of the Enyo `utility/` services —
that code was already framework-agnostic Promise/`fetch` logic wrapped in a thin
`enyo.kind` shell. The port swaps the shell for a plain constructor; the logic is
unchanged. The one real rewrite is the db8 wrapper (Enyo `PalmService` components →
`Mojo.Service.Request`), which keeps an identical Promise API so callers are untouched.

| Concern | Enyo app | This Mojo app |
|---|---|---|
| db8 access | `utility/db8.js` (kindDB8 + serial queue) | `app/models/db8-service.js` (Db8Service; no queue needed — Mojo requests are independent) |
| Settings/tokens | `utility/settings.js` | `app/models/settings-service.js` |
| Apple Music API | `utility/applemusicservice.js` | `app/models/applemusic-service.js` |
| Web-token auto-refresh | `utility/webtoken.js` | `scripts/webtoken.js` (**verbatim copy** — pure IIFE) |
| Library sync/cache | `utility/librarycache.js` | `app/models/librarycache-service.js` |
| Playback (Luna bridge) | `utility/audioplayer.js` | `app/models/playback-service.js` |
| fetch/Promise polyfills | `utility/*-polyfill.js` | `scripts/*-polyfill.js` (**verbatim copies**) |
| UI | Enyo kinds (`source/`, `controls/`) | Mojo scenes/assistants (`app/controllers/` + `app/views/`) |
| Playback engine | `com.achunt.jukie.service` (shared) | `com.achunt.jukie.service` (**the same shared service**) |
| DRM/decrypt helper | `jukie-drm-webos3` (GOARM=7 build) | `jukie-drm-webos2` (**GOARM=5, patched-toolchain build** — see below) |
| Exhibition Mode | Separate cross-window architecture (`enyo.windows`, its own standalone-resume engine) | Same-process dedicated stage (`noWindow` + a `dockMode`-typed stage) — see below |
| Dashboard/notification controller | `utility/dashboardmanager.js` + `dashboard.html` | **Not built** — the one feature this port is missing, see below |

## App structure

- `appinfo.json` / `index.html` / `sources.json` — Mojo bootstrap. `index.html`'s
  framework `<script>` paths mirror Palm's own extracted Music Player exactly.
  `appinfo.json` also carries `noWindow`/`dockMode`/`touchstoneMode` (Exhibition) and a
  `universalSearch.dbsearch` block (Just Type).
- `scripts/` — framework-agnostic helpers (webtoken + polyfills), verbatim from the Enyo app.
- `app/models/` — the ported service layer (Db8Service, SettingsService,
  AppleMusicService, LibraryCacheService, PlaybackService).
- `app/controllers/` — scene assistants. `app-assistant.js` builds the global `Jukie`
  singleton (all model instances), does async bootstrap (load settings → apply tokens →
  push credentials to the service → refresh web token), owns all stage creation (`main`
  and the Exhibition `dock` stage — see below), and handles Just Type launches. Scenes
  reach the models through `Jukie.*`.
- `app/views/<scene>/<scene>-scene.html` — one per scene (Mojo naming convention).
- `stylesheets/jukie.css` — Apple-Music-red theme over palm-dark, plus custom
  slider/grabber images on Now Playing's scrubber.

### Scenes

- **mainmenu** — library landing: Songs / Albums / Artists / Playlists / Search, in a
  `.palm-group`/`.palm-group-title` section titled with the live song count. App menu:
  Preferences, Refresh Library, Exhibition Mode (manual entry, no dock needed).
- **songs** — a track list. No args = whole library (A-Z alphabetical divider headers).
  With args it powers album/artist/playlist detail too: `{albumName,artistName}` (a
  single album, no dividers), `{artistName}` (an artist's songs, grouped by ALBUM NAME
  instead of alphabet), or `{tracks}` (a playlist, no dividers). Tap → play, opens
  Now Playing. Each list has a live client-side filter (header search icon reveals a
  TextField; filters whatever's already loaded, no new network/db8 call).
- **albums / artists** — library browse lists (from the db8 cache), also A-Z
  divider-grouped, that push the songs scene for detail.
- **playlists** — library browse list (from the db8 cache; each record carries its own
  nested `tracks` array, fetched separately per playlist during sync).
- **nowplaying** — the player. Metadata + art, elapsed/duration, seek slider (custom
  `jukie-grabber.png`/`jukie-slider.png` images, rounded track), play/pause/prev/next,
  a buffering spinner over the play button. Auto-advances to the next queued track when
  one ends (`PlaybackService`'s own "ended" handling calls `Jukie.playNext()` and fires
  an `onTrackChanged` callback so the active scene repaints art/metadata for the new
  track — this doesn't just happen for free from the queue index changing).
- **exhibition** — ambient full-screen now-playing display for Touchstone dock. See its
  own section below.
- **preferences** — Developer Token + Music User Token entry, storefront, search-result
  limit, cache toggle, Save, Refresh Library, Clear Cache.
- **search** — Apple Music catalog search with a Song/Album/Artist type picker
  (`popupSubmenu`-based header pill); tap → play (songs) or re-search (artist/album).

All local-media concepts from Palm's sample (device media indexing, MSM/USB handling,
music-store launch, local-file shuffle) were intentionally stripped — Jukie's library is
Apple's, synced via API into db8, not the device's local files.

## Exhibition Mode (Touchstone dock)

Real system dock-mode presentation, confirmed working on a physical Pre2 — proper
chrome-free system presentation (no status bar), clock, full-bleed album art, track
metadata, working transport controls, both from an actual dock event and from the
app-menu's manual "Exhibition Mode" entry (both go through the same code path).

**Architecture note, since this differs from what an early version of this port assumed:**
Mojo's dock mode is **not** just another scene on the app's regular card stage. It needs:
- `appinfo.json`: `"noWindow": true` (the framework does NOT auto-create a default stage
  or `StageAssistant` — there is none in this app; `AppAssistant.handleLaunch` is the ONE
  place that creates stages) plus `"dockMode": true` and `"touchstoneMode": "enabled"`.
- `Jukie.enterExhibition()` (`app-assistant.js`) creates a **dedicated stage** named
  `"dock"`, typed `"dockMode"` (the 3rd arg to `createStageWithCallback`) — that stage
  TYPE, not any per-scene CSS/JS trick, is what gets the real chrome-free presentation
  from the system. Confirmed the hard way: `PalmSystem.enableFullScreenMode` (tried
  first) rendered the scene correctly but left the normal card status bar on screen.
- Re-entering an already-running dock stage uses the documented Palm pattern for reusing
  a stage across multiple entries — `popScenesTo()` + `pushScene()` + `activate()` (from
  `dev-guide/mojo/basics-stages.html`) — not `swapScene()`/`window.focus()`, which looked
  plausible but left stale track info on re-entry.
- Because the dock stage is a genuinely separate stage, it runs in its own JS
  context/instance of everything (its own `Jukie` singleton, its own `PlaybackService`
  instance) — `Jukie.currentTrack` and the play queue set on the `main` stage do NOT
  carry over automatically. Track metadata is bridged via a small db8 singleton
  (`Jukie.saveNowPlaying`/`loadNowPlaying`, kind `com.achunt.jukie.nowplaying:1`) written
  on every `Jukie.playAt()`. A nice side effect: this also makes Exhibition show the
  last-played song (and let you resume it) if Jukie is *closed* when Exhibition starts.
  Playback control itself (play/pause/prev/next) works from Exhibition regardless,
  since those are direct Luna service calls, unaffected by which JS context makes them —
  but its own `PlaybackService` instance needs an explicit one-shot `refreshStatus()` at
  setup to get real `isPlaying`/`buffering` state rather than trusting stale constructor
  defaults (confirmed on-device as a stuck buffering spinner and an unresponsive
  play/pause button otherwise).
- Prev/Next from *within* Exhibition only work if that stage's own queue has something in
  it (rare, since the track is normally started from `main`) — a known, narrower gap than
  the metadata sync above; not yet addressed.

## Just Type (universalSearch) integration

`appinfo.json`'s `universalSearch.dbsearch` lets the system launcher query the
`com.achunt.jukie.libitem:1` db8 kind directly and show matches inline in Just Type.
Picking a result launches with `launchParam: "libItemId"`; `Jukie.showLibraryItemById`/
`showLibraryRecord` (`app-assistant.js`) look it up and either auto-play it (song), open
its detail (album/artist), or land on mainmenu (playlist — not deep-linkable, matching
the Enyo app's own fallback). Direct port of the Enyo app's `source/app.js` equivalent.

**Gotcha, already hit once:** the `com.palm.launcher` read grant Just Type needs on the
`libitem` kind MUST be a separate `putPermissions` call from the app's own grant, not
bundled into the same array — `putPermissions` is atomic on this webOS build, so a
rejected launcher grant previously took the app's own grant down with it too, breaking
every library read with "db: permission denied". See
`librarycache-service.js`'s `_grantLauncherReadBestEffort`.

## Missing vs. the Enyo app

**Persistent dashboard/notification music controller.** The Enyo app has a Dashboard
(`utility/dashboardmanager.js`, `dashboard.html`) — a small always-present now-playing
control that lives in the notification/dashboard area while Jukie is backgrounded. This
Mojo port has no equivalent yet. (Mojo's own analogous mechanism would be a `lightweight`
dashboard-type stage, per `webos://knowledge/system-features`'s
`AppAssistant.prototype.createDashboard` pattern — not yet attempted here.)

## The playback path (why this works on 2.x at all)

Tapping a song calls `PlaybackService.load(catalogId)` + `play()`, which calls the shared
`com.achunt.jukie.service` over the Luna bus exactly as the Enyo app does. The service
runs `jukie-drm` to fetch + Widevine-decrypt the track to a plain `.m4a`, then plays that
decrypted **standard .m4a** file with a hand-built gst pipeline. Because the file is an
ordinary decoded m4a, playing it is normal local-file playback — the missing-`audioresample`
streaming issue doesn't apply. The whole fetch→license→decrypt→play chain was already
proven end-to-end on a Pre2 (see `../../jukie-drm/goruntime-patch/FINDINGS.md`).

The decode pipeline itself is adaptive (hardware AAC on TouchPad, software `ffdec_aac` on
Pre2-class jails that can't reach `/dev/DspBridge`) — decided proactively at service load,
not hardcoded; see `../../com.achunt.jukie.service/CLAUDE.md`'s "adaptive decode path"
section.

**Deploy detail (now automatic):** the service ships BOTH `jukie-drm-webos3` (GOARM=7,
standard toolchain) and `jukie-drm-webos2` (GOARM=5, patched toolchain from
`../../jukie-drm/goruntime-patch/apply.ps1`), and `JukieAudioService.js` picks the right
one at load time using the same hardware probe it already uses for the AAC decode path
(see `../../com.achunt.jukie.service/CLAUDE.md`). Running the TouchPad's GOARM=7 binary on
a 2.x kernel crashes it, which is exactly why this used to require a human to stage the
right one by hand — that's no longer necessary.

**Volume is independent of the system/hardware volume**, same platform limitation as the
Enyo app (`com.palm.audio/system`'s real setVolume/getVolume are privileged, unreachable
without a `com.palm.*` app id) — Jukie's own slider sets its own PulseAudio stream gain
instead. Open, not-yet-investigated finding: the very FIRST track played after a fresh
service start ignores the hardware volume rocker; the second and later tracks respect it
correctly. See memory `jukie-first-track-volume-finding` and this file's own service-side
CLAUDE.md for where to pick this up.

## Deploy

There's one deploy script for the whole unified package now — it's the same one used for
the Enyo/TouchPad side. See `../../deploy-jukie.ps1` / the top-level `../CLAUDE.md`:

```
powershell -ExecutionPolicy Bypass -File ../../deploy-jukie.ps1
palm-launch com.achunt.jukie
```

## Confirmed on real hardware (formerly "open risks")

1. **Framework path.** `/usr/palm/frameworks/mojo2/mojo.js` works on this Pre2.
2. **Remote artwork over HTTPS.** Confirmed the TLS handshake to Apple's art hosts fails
   from this device's WebKit (status 000); `Jukie.artUrl` forces plain `http:` and art
   loads fine that way.
3. **`fetch` on 2.x WebKit.** The XHR-backed `fetch-polyfill.js` works for the token
   scrape + API calls.
4. **Mojo widget quirks**, each confirmed by reading the real on-device framework source
   (`palmInitFramework2112`) rather than the SDK's docs/samples, which differ from it in
   several places:
   - `List` is virtualized and throws "Failed to specify a datasource" without an
     explicit `dataSource` — `Mojo.DataSource.LocalDataSourceAssistant` wraps a plain
     array for the fixed-model case the SDK docs describe differently.
   - `List`'s built-in `dividers: {labelCallback, template}` option (confirmed against
     Palm's own real Music Player app, not the SDK) does grouped section headers -
     used for the A-Z and album-name dividers above.
   - `Spinner`'s `"large"` is 128px, `"small"` is 32px (SDK docs undersell how big
     "large" actually is).
   - `-webkit-box-pack: justify` does not work on this WebKit; use a flex-grow spacer
     div instead (confirmed via on-device screenshot).
   - `Mojo.Widget.FilterList` was tried as a replacement for the hand-rolled header
     search icon + TextField filter bar above and **reverted** — it left lists stuck on
     "Loading…" through two rounds of fixes, and this build's exact
     `filterFunction`/`setupWidget` timing contract couldn't be pinned down without live
     interactive device debugging. Plain `List` + the custom filter bar is what's
     actually deployed.
5. **`count:true` in db8.** Confirmed rejected; counts go through paged `find` scans
   instead (`LibraryCacheService.count`), matching the Enyo app.
