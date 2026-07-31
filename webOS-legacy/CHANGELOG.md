# Jukie — Changelog

For the full feature rundown, see [RELEASE_NOTES.md](RELEASE_NOTES.md).

## v2.0.0

### Added

- **Mojo build for webOS 2.x devices** (Pre2, Veer, and other older phones) - a full port
  with the same core feature set as the Enyo build (library sync, catalog search,
  full-track playback, Just Type, Touchstone/Exhibition Mode), minus the persistent
  dashboard mini-player. Extensively tested on real Pre2 hardware.
- **Unified package**: `com.achunt.jukie` now bundles both the Enyo (`enyo/`) and Mojo
  (`mojo/`) builds under one app id and one `appinfo.json`. A framework-less `index.html`
  switcher reads `PalmSystem.deviceInfo.platformVersionMajor` and loads the right one -
  modeled on a real precedent app that solved the same problem the same way.
- **jukie-drm ships both webOS-version builds** (`jukie-drm-webos2`, `jukie-drm-webos3`,
  renamed from the old `pre2`/`touchpad` target names). `JukieAudioService.js` picks the
  correct one at load time via the same hardware probe already used to select the AAC
  decode path, instead of a human staging the right one ahead of time.
- **Self-service in-app dialog** for jukie-drm's executable-permission failure mode: the
  service detects it (both a spawn-level `EACCES` and this platform's actual observed
  failure shape, an `execvp(): Permission denied` exit) and both UIs show the exact
  `chmod` command to fix it, instead of playback just silently failing.
- **Unified `deploy-jukie.ps1`** - one script, builds and stages both jukie-drm targets,
  packages the unified app, fixes up permissions, installs, and registers the service on
  LS2. Replaces the old `deploy-jukie.ps1` (Enyo-only) / `deploy-jukie-mojo.ps1`
  (Mojo-only) split, which used to fight over a single shared `jukie-drm` binary slot.

### Fixed

- **Mojo's own UI stage name collided with the switcher's launch entry.** Before the
  merge, Mojo's `index.html` was the system's literal launch entry; reached via the
  switcher's redirect instead, its explicit `createStageWithCallback({name: "main"})`
  call collided with whatever the OS already associates with that entry
  (`cannot create two stages with the same name : main`). Renamed the stage to
  `"jukiemain"`.
- **Mojo's framework bootstrap silently lost its own local `appinfo.json`.** The merge
  assumed one package-level manifest would cover everything; Mojo's framework actually
  re-fetches its own `appinfo.json` relative to wherever it's loaded from (same
  convention as `sources.json`), independent of the package manifest. Missing it produced
  `Cannot use 'in' operator to search for 'noWindow' in undefined` followed by a fallback
  scene push for a nonexistent `MainAssistant`. Restored.
- **jukie-drm's executable bit not surviving `palm-install` on some devices - root cause
  found.** `fix-ipk-exec.py` rewrites the package's tar to stamp the executable bit, and
  was doing so in Python's default PAX format. This platform's `ipkg` can't parse PAX
  extended-header entries at all, and failing to parse one desyncs its read position for
  the rest of the archive - so everything packed after the first PAX header can be
  silently dropped from an install that still reports success (`AI_ERR_NONE`). Fixed by
  forcing `format=tarfile.GNU_FORMAT` on the rewritten tar. A device-side `chmod +x`
  backstop in `post-install-jukie.ps1` also remains as defense-in-depth.

## v1.0.1

### Added

- **The app's own catalog/library browsing now auto-refreshes its Developer Token**,
  the same way `jukie-drm` already does for full-track playback. `utility/webtoken.js`
  is a client-side port of `jukie-drm`'s `internal/appleauth/webtoken.go`: it scrapes
  the public "AMPWebPlay" web-player token straight from music.apple.com (no login) when
  the current one is missing or within a day of expiry, and reactively on a live 401 too
  (`AppleMusicService.request()` retries once after a forced refresh). A refreshed token
  is written through to `secrets.local.json` immediately and best-effort persisted to
  Settings/db8. This was expected to be blocked by cross-origin restrictions (this app's
  `fetch()` isn't running on music.apple.com's own origin) - confirmed on-device that this
  webOS build's WebKit doesn't enforce that, so it works.

### Fixed

- **Settings Save could silently fail to reach `secrets.local.json`.** The credentials
  file write (`Playback.setCredentials`, what `jukie-drm` actually reads for full-track
  playback) only ran after the Settings db8 record finished saving. `kindDB8` serializes
  every db8 call app-wide through one queue, shared with the library sync — so a Save
  made while that sync was still running (the common case: fresh install, empty
  library, pasting your first tokens) could sit queued indefinitely, while the
  Settings screen closed immediately regardless and looked like it had worked. The
  credentials file write is now applied immediately on Save, independent of the db8
  round-trip.
- **"Your Library" could come back empty with a 401, even with a valid, freshly-issued
  Developer Token.** `api.music.apple.com` rejects the public "AMPWebPlay" web-player
  token unless the request carries an `Origin: https://music.apple.com` header — a
  real browser sends this automatically for the site's own scripts, but Jukie's
  `AppleMusicService` (calling the API from outside that origin) never set it. Added
  `Origin`/`Referer` headers to all Apple Music API requests.

## v1.0 — Initial Release

See [RELEASE_NOTES.md](RELEASE_NOTES.md).
