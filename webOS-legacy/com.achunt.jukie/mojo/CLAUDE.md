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

## Cache size, offline play, Lunacy adjustments (written 2026-10-17, NOT yet tested on a device)

Everything in this section was written and syntax-checked but never run on hardware - treat
it as unverified until a real Pre2 / Lunacy phone pass.

- **Cache size** (`preferences-*`): a "Cache size" selector replaces the old (dead) cache
  toggle; value is `cacheLimitMB` in the prefs record, pushed to the service with
  `setCacheLimit` at boot and on Save. The usage line comes from the service's `getCacheInfo`.
- **Offline play**: `Jukie.online` (connection manager subscription, `navigator.onLine`
  fallback), `Jukie.offlineIds` / `savedIds` (from the service's `listOffline`),
  `Jukie.watchOffline(fn)` to repaint, `Jukie.saveOffline` / `removeOffline`,
  `Jukie.offlineDecor(id)` for row classes. Song rows get a badge (filled red = saved, hollow
  red = saved but still downloading/failed, hollow grey = cached only) and, when offline and
  not on the device, are dimmed; tapping one shows an alert, and `Jukie.playAt/playNext/
  playPrev` skip them. Press-and-hold a song row (`Mojo.Event.hold`, via the list widget's
  `getItemByNode`) for Save / Remove; Now Playing's app menu does the same for the current
  track; mainmenu's "Saved Offline" opens the songs scene with `{offline:true}`, built from
  the service's manifest (so it also lists saved songs that aren't in the library).
- **Badge art / swipe-to-remove (written 2026-10-17, NOT yet tried on the folded phone):** the
  badge is the owner's sprite `images/toaster-icon-downloads.png` (32x64; top = cached grey,
  bottom = saved red, pending = bottom dimmed), see `.jukie-offline-badge` in `jukie.css`. The
  Saved Offline list (`args.offline`) sets `swipeToDelete` on the List widget
  (`JukieListAssistant`: `swipeToDelete`/`autoconfirmDelete:false` = Delete/Undo pair, `onListDelete`
  preventDefault()s the widget's own model edit, splices `_records`, calls `deleteRecord`;
  `SongsAssistant.deleteRecord` -> `Jukie.removeOffline` then `load()`). Unverified against the
  Lunacy/Pre2 framework builds' custom-dataSource List - check on a device; the hold menu's
  "Remove from offline" remains as a fallback.
- **Lunacy** (webOS on Android; no gesture area): **confirmed 2026-10-17 on a Lunacy 0.8.0
  phone (Samsung SM-F966U1, Android 17, arm64) that the launch switcher already sends Lunacy
  phones to THIS Mojo build** (so Lunacy's phone profile reports `platformVersionMajor < 3`;
  the window is 411x904 CSS px at dpr 2.625). That also means `deviceInfo` can't identify
  Lunacy, so `Jukie.detectLunacy()` asks Lunacy's own bus service
  (`palm://org.webosarchive.lunacy/system/getEnvironment`) at boot; `Jukie.whenLunacy(fn)` /
  `Jukie.isLunacy()` expose the answer, and it gates the header **back button** (`#back-btn`,
  `Jukie.setupBack`, hidden on real Palm devices). Now Playing's seek bar track is fluid
  (`.jukie-np-slider .palm-slider-background {width:auto}`) and the scene switches to a
  stretched vertical layout above 500px of window height (`NowplayingAssistant.layout`).
  **Verified on the phone:** library refresh, Songs list, back arrow, saved/cached badges and
  the press-and-hold save menu, Now Playing layout/seek bar, and **playback** (below). To get
  a build onto a Lunacy phone from Windows you need a *debuggable* Lunacy build (a release one
  ignores `adb ... --es install`) - see memory `lunacy-bringup-status`.
- **Lunacy playback** (`PlaybackService`'s `_wa*` methods + `app/models/adts.js`): there is
  no gst/pulse on Android, so `play()` calls the service's `prepareSong` (jukie-drm fetches
  and decrypts into the cache), reads the cached raw-ADTS file over XHR from
  `/media/internal/.jukie/cache/<id>.m4a` (Lunacy serves that path on the app origin),
  indexes its frames with `JukieAdts` (exact duration, any seek lands on a frame boundary),
  and plays it from a Blob through an `<audio>`. Position = base + `currentTime`; a seek
  swaps in a Blob starting at the target frame. Every state change is fed through
  `onStatus()` as a synthesized service response, so scenes, auto-advance and the
  callbacks are unchanged. Chosen at runtime by `Jukie.isLunacy()`; `play()` waits for the
  boot-time probe (4s timeout) so the first tap can't pick the wrong backend. The browser
  can refuse audio that doesn't start from a tap - that falls back to "paused" so the play
  button (a gesture) works. Verified on the phone: play cached + uncached, pause/resume,
  seek, auto-advance, and it keeps playing when the app is sent to the background (checked
  for ~20s only). Exhibition mode has its own PlaybackService instance and does not see
  this audio element.

## Emoji (2026-10-17; written, NOT yet run on a Pre2 or Lunacy)

`app/models/emoji.js` is `JukieEmoji`, a verbatim copy of `../enyo/utility/emoji.js` (see that
build's CLAUDE.md and `../../com.achunt.jukie.service/CLAUDE.md` for why emoji are carried as the
ASCII marker `{{e:1F970}}`). A stock Pre2 has no EmojiShim and cannot draw them, so there
`JukieEmoji.text()` removes them - the same result as before, because `apiGet` still strips
(only a device where `JukieEmoji.canRender()` asks for markers). `canRender()` is true when
`EmojiShim` exists or a load-time canvas test finds the engine draws colour emoji (Lunacy's Android
WebView should - **unverified, the phone was not connected**; the test itself was checked in
desktop Edge). List rows (`toRow`), Now Playing, Exhibition and search results go through
`JukieEmoji.text`; db8 writes and `pinSong` encode. Note the EmojiShim installer patches
`/usr/palm/frameworks/mojo/mojo.js`, but this build loads `mojo2/mojo.js`, so on a patched Mojo
device the shim's `Mojo.View.render` hook would not run here - and plain `text()` could not show
its `<img>` anyway; a Mojo device with the patch would need an HTML sink. Not built (no such
device).

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
