# Jukie — Release Notes

## v2.1 — Offline Play, a Cache You Control, Lunacy, and Emoji

Jukie 2.1 makes the music you care about available without a connection, lets you decide how
much space it may use, runs on **Lunacy** (webOS on Android), and finally shows emoji in your
playlist and song names on the TouchPad. Full detail is in the [CHANGELOG](CHANGELOG.md).

### What's new

- **Save songs for offline play.** Press and hold a song (Pre2/Mojo) or tap the download
  arrow at the end of a row (TouchPad/Enyo). Saved songs are kept on the device, never
  evicted, and play with no network. A **Saved Offline** list shows them (swipe a row
  away to remove it), including songs that aren't in your synced library. A grey arrow marks a
  song that is merely cached from listening; a red one means you saved it.
- **Offline-aware playback.** With no connection, songs that aren't on the device are dimmed,
  skipped by next/previous, and say so immediately instead of hanging on a timeout.
- **Choose your cache size.** Settings → Cache size (Off to 8 GB, default 512 MB), with a live
  usage readout. It is now a true least-recently-used cache; the track you're playing and your
  saved songs are never evicted.
- **Lunacy support.** Library sync and full-track playback work on Lunacy phones and tablets
  (arm64 helper, in-page audio with accurate duration and seeking). The Pre-style UI gains a
  back button, a full-width seek bar and a layout that uses tall screens.
- **Emoji (TouchPad with the EmojiShim patch).** `90s 🥰` now shows the emoji instead of a
  tofu box, in lists, headers, Now Playing and the player. It is capability-driven, so devices that
  can't draw emoji simply show the text as before. **Refresh Library once** after updating so
  existing records are stored in the new form.
- **A more webOS-looking download indicator.**

### Under the hood

- **Emoji can't cross webOS's service bus or db8 as real characters.** Verified on a TouchPad: a
  service reply turns an emoji into `??`, and db8 hands one back as a single replacement
  character; a Pre2 swallows the reply outright. Jukie now carries emoji as a reversible ASCII
  marker through the service, `jukie-drm` and the database, and only turns it back into the
  real character at the last moment, if the device can show it.
- **A packaged `.ipk` used to contain real credentials.** `palm-package` ignores `.gitignore`, so a
  development token file was bundled and a fresh install appeared to have a library with no
  tokens entered. The deploy script now excludes it and verifies the finished package.
- **Publishing a package no longer risks the Widevine credential.** The personal build must
  contain your `device.wvd`; the new `make-release-ipk.ps1` builds from a staged copy without it
  and refuses to finish if any `.wvd` is inside.

### Known limitations

- Emoji are only drawn where something can draw them: the TouchPad with the EmojiShim patch, or a
  modern engine such as Lunacy's (not yet verified on a Lunacy device). Elsewhere they are removed.
  The status-bar banner and lock screen are native and can't show emoji at all.
- Saving songs for offline play needs a connection to download them.
- The published package has no Widevine credential; full-track playback needs your own `device.wvd`
  in the service folder (library browsing, search and previews work without it).

## v2.0 — webOS 2.x Support (Pre2, Veer) + a Unified Package

Jukie now runs on **two generations of webOS from one install**: the original
TouchPad/Pre3-era Enyo build, and a full new Mojo port for webOS 2.x devices (Pre2, Veer,
and other older phones). One package, one app id, one deploy step — it figures out which
UI to load and which native helper binary to use on its own, per device.

### Core experience

- **webOS 2.x devices are now fully supported** — a ground-up Mojo port with the same
  core experience as the Enyo build: full library sync, Apple Music catalog search,
  full-track playback, a real pause, offline caching, and Just Type integration. Extensively
  tested on real Pre2 hardware.
- **Touchstone dock support on Mojo** — a proper chrome-free Exhibition Mode presentation
  (clock, full-bleed album art, transport controls) for devices with a dock, matching the
  Enyo build's own dashboard-adjacent presentation.
- **One install, either device** — you no longer need to know or pick which build you're
  installing. The app detects the connected device at launch and loads the right UI
  automatically; the playback service does the same for its native helper.
- **A self-service fix for a known device quirk.** A small number of devices don't
  preserve the playback helper's executable permission through install. Jukie now detects
  this specific failure and tells you exactly what to run to fix it, instead of just
  failing to play with no explanation.

### Under the hood

Making one package work correctly on two webOS generations, with two totally different UI
frameworks (Enyo never shipped on webOS 2.x), turned up several real, device-specific
problems that only showed up on physical hardware - not something a simulator or code
review would have caught:

- **Device-detecting bootstrap.** A tiny framework-less entry page reads the platform
  version webOS itself reports and loads the Enyo or Mojo build accordingly - modeled on
  a real precedent (a Palm-era app that solved the identical problem the same way).
- **One native helper binary, chosen automatically.** The Widevine helper (`jukie-drm`)
  needs a different build per webOS generation; the playback service now ships both and
  picks the right one at load time using the same hardware probe it already used for
  audio decode path selection, instead of a human choosing the right build ahead of time.
- **A stage-naming collision, found and fixed on real Pre2 hardware.** The Mojo build's
  own explicit UI stage happened to collide with the name the OS itself reserves for an
  app's launch entry, once that entry became a shared switcher instead of the Mojo app
  directly - a one-line rename, but only findable by actually launching on-device and
  reading the crash.
- **A silent packaging bug that could drop half an install without any error.** The
  tool that fixes up the helper binary's executable permission was (invisibly)
  producing a package format this era's installer can't fully read - it would silently
  stop partway through extracting the package, on some devices, while still reporting a
  successful install. Found by manually re-running the installer's own underlying command
  and reading what it actually said. Fixed at the source.

### Known limitations (in addition to the ones below, carried over from v1.0)

- The Mojo (webOS 2.x) build doesn't yet have the Enyo build's persistent
  dashboard/notification mini-player - full playback control still works from Now Playing
  and Exhibition Mode.

## v1.0 — Initial Release

Jukie is an unofficial Apple Music client for legacy Palm/HP webOS (TouchPad and Pre 3,
2011–2012 hardware). It started from the bones of the original stock Palm Music app and
ended up a fully working, full-track Apple Music player on hardware that hasn't seen an
update in over a decade. This is everything that went into it.

For a screenshot tour of what it actually looks like, see [FEATURES.md](FEATURES.md).

### Core experience

- **Full library sync** — songs, artists, albums, and playlists (including track order),
  pulled from your real Apple Music library, with the same fast A-Z scrubber the
  original webOS Music app had.
- **Full Apple Music catalog search** — not limited to your own library; browse any
  artist's complete discography.
- **Full-track playback**, not 30-second previews, with a real, draggable scrubber and
  accurate track lengths.
- **A real pause** — not "acts like mute."
- **A working volume slider.**
- **An Apple-Music-red theme** applied over the stock Enyo/Onyx look, with custom
  slider/divider/arrow art.
- **Offline caching**, with a Settings screen to manage it.
- **A self-contained Help screen**, and a Settings screen for account/playback config.
- **Native webOS integration**: Just Type search, lock screen controls, and a status
  bar/dashboard mini-player — it feels like a real webOS citizen, not a bolted-on app.

### Under the hood

The headline engineering problem: this device's stock HTML5 `<audio>` pipeline is
missing a required GStreamer element and simply cannot play Jukie's audio, at all. Every
piece of playback had to be rebuilt from scratch on top of a hand-driven `gst-launch`
pipeline, run by a custom Luna service (`com.achunt.jukie.service`):

- **Full-track playback** comes from Apple's Widevine-protected web-player stream
  (Apple's native mobile delivery is FairPlay; the web player serves Widevine to
  non-Safari clients instead). A dedicated Go helper, `jukie-drm`, does the whole
  license-exchange-and-decrypt flow and hands back a plain, playable file — a single
  static ARMv7 binary with no dependency on this device's ancient/absent crypto stack.
- **Seeking**: `gst-launch` has no live seek control at all, so a seek kills the
  pipeline, cuts a fragment with `ffmpeg` starting at the target time, and plays that
  fragment instead.
- **Pause**: SIGSTOP alone only freezes GStreamer — PulseAudio's own clock keeps
  draining its buffer as silence. Real pause suspends the PulseAudio sink itself.
- **Volume**: the platform doesn't allow 3rd-party apps to touch the real system
  volume at all (confirmed via live testing — it's private-bus-only, not just
  unwired). The slider instead controls Jukie's own PulseAudio stream gain directly —
  a real, independently-working control, just scoped to Jukie's own output.
- **Auto-refreshing web token** — the short-lived Apple web-player token that used to
  need manual re-pasting every ~35 days now refreshes itself automatically.
- **Settings tokens actually reach full-track playback** — `jukie-drm` runs as a
  separate process with no shared state with the app, so a Developer Token / Music
  User Token pasted into Settings now gets written through to it via a dedicated Luna
  command, rather than silently only affecting catalog search like it used to.

### Known limitations

- The volume slider adjusts Jukie's own output level, not the device's master volume —
  a hard platform restriction for 3rd-party apps, not a bug.
- There's no in-app Apple ID sign-in flow. A native login was attempted and works in
  principle, but tripped Apple's anti-abuse system hard enough to lock a real account
  during testing, so it's parked. Pasting a Music User Token extracted from your own
  browser session is the supported path (see the app's Help screen).
- Full-track playback needs a Widevine L3 device credential, which isn't something
  Jukie walks you through obtaining — without one, library browsing,
  catalog search, and previews all still work fine.

### Project structure

This repo is organized by platform, starting with `webOS-legacy/` (this one) — more
variants may follow, which is why it isn't just assumed to be the only target. Inside:
`com.achunt.jukie` (the Enyo app), `com.achunt.jukie.service` (the Luna audio-playback
service), and `jukie-drm` (the Go DRM helper), each with their own README.

### Thanks

Huge thanks to the **webOS Archive Team**, whose TLS upgrade for these devices' system
libraries is the only reason reaching Apple's modern HTTPS-only servers is possible at
all on hardware this old.
