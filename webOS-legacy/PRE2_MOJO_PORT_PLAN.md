# Porting Jukie to webOS 2.x (Mojo / Pre2)

Status: **built (2026-07-28) and extensively tested on real Pre2 hardware (through
2026-07-30), feature-complete except for one item** (see `com.achunt.jukie/mojo/CLAUDE.md`'s
"Missing vs. the Enyo app"). As of 2026-07-30 the Mojo app was also merged into a single
unified package with the Enyo app: it now lives at `com.achunt.jukie/mojo/` (moved from the
former standalone `com.achunt.jukie.mojo/`), sibling to the Enyo build at
`com.achunt.jukie/enyo/`, with a device-detecting switcher at `com.achunt.jukie/index.html`
picking between them at launch - see `com.achunt.jukie/CLAUDE.md` for that architecture.
See `com.achunt.jukie/mojo/CLAUDE.md` for the as-built structure, the Enyo→Mojo mapping
table, and confirmed on-device findings. The plan below is retained as the original design
rationale; most of its "open questions" section has since been resolved on real hardware
(now documented in `mojo/CLAUDE.md`'s "Confirmed on real hardware" section). Written
originally as planning-only; kept for context.

## Why this needs a real port, not a reskin

Jukie today (`com.achunt.jukie/`) is built on **Enyo 1 (0.10)**, which only ever
shipped on **TouchPad/webOS 3.x**. The **Pre2 runs webOS 2.1, which only has
Mojo** — Enyo was never on it. There is no "just deploy the Enyo app to the Pre2"
option; the UI layer has to be rewritten against Mojo's Scene/Assistant model. This
isn't a guess - confirmed by extracting a real Mojo app and comparing frameworks
directly (see below).

## Reference material (both already on disk)

- **Mojo UI reference:** `dev-stuff/usr/palm/applications/com.palm.app.musicplayer/`
  — the real Palm-authored Music Player app for webOS 2.x, extracted from a device
  ROM. This is a *complete, working* Mojo app: scene/assistant pairs for
  mainmenu/albums/artists/genres/playlists/songs/list/dashboard/localnowplaying, a
  `sources.json` load manifest (Mojo's equivalent of Enyo's `depends.js`), DB8 access
  via `app/models/mojodb-service.js`, and playback via a plain HTML5 `<audio>`
  element wrapped in `scripts/MusicController.js` + `scripts/MusicPlayer.js`.
- **Business-logic reference:** `com.achunt.jukie/utility/` — Jukie's existing
  Apple-Music-specific logic (catalog fetch, token refresh, DB8 caching, playback
  orchestration, settings). This is what gets *carried over*, not replaced.
- **Playback engine (unchanged, reused as-is):** `com.achunt.jukie.service/` — the
  Luna service that does the actual GStreamer playback. Called over the Luna bus, so
  it's UI-framework-agnostic; a Mojo app calls it exactly like the Enyo app does, just
  with `Mojo.Service.Request` instead of a `PalmService` kind (see mapping below).
- **jukie-drm on Pre2:** `jukie-drm/goruntime-patch/FINDINGS.md` — full story of why
  Pre2 needs a specially-patched Go toolchain and how to build with it. Already
  proven end-to-end (real download + Widevine decrypt succeeded on-device).

## Architecture comparison

| Layer | Enyo (TouchPad, today) | Mojo (Pre2, to build) |
|---|---|---|
| UI framework | Enyo 1 kinds, `depends.js` | Mojo scenes/assistants, `sources.json` |
| App entry | `launch/MusicAppLauncher.js` | `app/controllers/app-assistant.js` + `StageAssistant` |
| Non-visual service objects | `enyo.kind({kind:"enyo.Component", published:{...}, events:{...}})` | plain JS constructor functions returning an object literal (see `mojodb-service.js`, `mediaevents-service.js`) — **no framework base class needed** |
| DB8 access | `utility/db8.js` (`kindDB8`, `PalmService` components, hand-rolled promise queue) | `Mojo.Service.Request('palm://com.palm.db', {method, parameters, onSuccess, onFailure})` — same bus, same `find`/`put`/`merge`/`del` verbs |
| Playback service call | `PalmService` kind, `service: "palm://com.achunt.jukie.service/"` | `Mojo.Service.Request('palm://com.achunt.jukie.service/', {method, parameters, onSuccess, onFailure})` — **identical service, identical methods, only the call wrapper changes** |
| Now Playing / dashboard | `utility/dashboardmanager.js`, `dashboard.html` | `app/controllers/dashboard-assistant.js`, `dashboard.html` (sample has one already) |

## What to reuse vs. strip from the Mojo sample

**Strip (local-media-specific, not relevant to a streaming Apple Music client):**
- `mojodb-service.js`'s queries against `com.palm.media.audio.*` kinds (artist/album/
  song/genre/playlist DB kinds populated by the device's own media indexer scanning
  local files). Jukie doesn't use the device's local media DB at all — it has its own
  `kindDB8` schema caching the *Apple Music catalog*. Keep the *pattern*
  (`Mojo.Service.Request` wrapper functions), not the *kind identifiers* or the
  local-file-specific fields.
- Anything about MSM (mass storage mode) / USB media sync (`storagedProgress` in
  `app-assistant.js`) — irrelevant, there's no local media to protect during a USB
  mount.
- Local file scanning/indexing concepts generally (`AppAssistant.subscribeForSongCount`
  watching the local DB8 song count) — Jukie's "library" is Apple Music's, synced via
  API + its own cache, not indexed from local storage.

**Reuse near-verbatim (framework-agnostic core logic, already written and tested):**
- `utility/applemusicservice.js`, `utility/webtoken.js`, `utility/settings.js`,
  `utility/librarycache.js`, `utility/librarytools.js`, `utility/mediaindex.js`,
  `utility/playback.js`, `utility/playbacklist.js`, `utility/playlistmanager.js` —
  all of these are `fetch`/`Promise`-based vanilla JS wrapped in a thin
  `enyo.kind({...})` shell. The wrapper is the only Enyo-specific part; swap it for a
  plain constructor function matching the Mojo sample's own model pattern (e.g.
  `MojoDBService`, `MediaEventsService`) and the actual logic inside barely changes.
- `com.achunt.jukie.service/` (the Luna playback service) — **zero changes**, called
  identically from either framework.
- `jukie-drm/` — **zero changes** to app logic; only the *build* differs for Pre2
  (patched toolchain, see FINDINGS.md).
- Secrets/token storage pattern (`settings.js`, `secrets.local.json` handling) — same
  DB8/local-file approach works under Mojo.

**Reuse the *shape* of, rewrite the *content* of:**
- Scene/assistant pairs (mainmenu, albums, artists, genres, songs, playlists, list,
  dashboard, localnowplaying) — keep the Mojo file/scene structure from the sample,
  but swap the local-DB8 queries for calls into Jukie's Apple-Music-backed
  `librarycache`/`db8` layer.
- `MusicController.js`/`MusicPlayer.js` — the sample drives a plain `<audio>`
  element, which per `com.achunt.jukie/CLAUDE.md` **doesn't work for Jukie's streams**
  on this platform (missing GStreamer `audioresample` in the stock pipeline). Replace
  this whole layer with calls to the existing `com.achunt.jukie.service` Luna service
  (see `utility/audioplayer.js` on the Enyo side for the exact method surface: play/
  pause/resume/stop/getStatus/seek/setVolume/getVolume/clearCache/setCredentials).

## Open questions to resolve early (don't assume, verify on-device)

1. **Does `com.achunt.jukie.service` even run on the Pre2?** This session only
   proved `jukie-drm` (the Go DRM helper) runs there — the actual audio-output Luna
   service (gst-launch pipeline, LS2 registration) has never been tried on Pre2. Do
   this *first*, before writing any UI: register the service via the same manual LS2
   file technique already used for TouchPad (see the `js-service-ls2-registration`
   memory / `deploy-jukie.ps1`), point it at a locally-cached test file, and confirm
   sound comes out. If GStreamer on Pre2 is missing different elements than TouchPad,
   this is where you'd find out, before any UI work is wasted.
2. **CA bundle for jukie-drm on Pre2** (see FINDINGS.md) — needs a real answer before
   packaging, not just `SSL_CERT_FILE` set by hand over novacom.
3. **`count:true` in DB8 queries** — Jukie's existing memory notes say `count:true` is
   unsupported in kindDB8 usage: `count:true unsupported, 500-row page cap`, but the
   *Palm-authored* `mojodb-service.js` sample uses `count:true` in several places
   (`formatParams`, `subscribeSongCount`). Either the constraint is narrower than
   currently believed, or the sample hits it too and nobody noticed. Worth an actual
   test rather than assuming either way.
4. **Mojo's JS engine age vs. Enyo's.** Jukie's Enyo side needed `fetch-polyfill.js`
   and `promise-polyfill.js`. Mojo/webOS 2.x's WebKit is older still - check whether
   `fetch`/`Promise` exist at all before relying on the polyfills being sufficient;
   the sample app's own code (`Mojo.Service.Request` patterns, no visible `fetch`
   usage) suggests native fetch may not exist in this environment and the polyfill
   approach may need to go further (e.g. an XHR-based fetch polyfill instead of a
   thin fetch-shape-check).
5. **App packaging for Mojo.** Confirm `palm-package`/`palm-install` handle a Mojo
   `type: "web"` app (with `sources.json` instead of `depends.js`) the same way as
   Enyo - the sample's `appinfo.json` has no explicit framework field, so this may
   just work, but hasn't been tried through this project's actual build tooling.

## Suggested build order

1. Prove `com.achunt.jukie.service` runs on Pre2 (open question #1) — cheapest way to
   find any Pre2-specific GStreamer/audio surprises before investing in UI.
2. Stand up a minimal Mojo app skeleton (`com.achunt.jukie.mojo/` or similar) that
   does nothing but call the playback service and play one hardcoded cached file —
   proves the packaging + Luna-bus-from-Mojo path end to end.
3. Port `utility/` business logic (thin-wrapper swap, per table above).
4. Port scene/assistant UI, starting from the sample's structure, swapping local-DB8
   for Apple-Music-backed data.
5. Wire up jukie-drm invocation from the service side exactly as TouchPad does,
   built with the patched toolchain (`goruntime-patch/apply.ps1`) instead of stock Go
   for this target.
6. Full on-device pass: auth, browse, play, pause/resume, seek, offline cache -
   mirroring the working feature list already in `com.achunt.jukie/CLAUDE.md`.
