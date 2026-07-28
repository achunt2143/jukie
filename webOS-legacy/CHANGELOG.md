# Jukie — Changelog

For the full feature rundown, see [RELEASE_NOTES.md](RELEASE_NOTES.md) (v1.0).

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
