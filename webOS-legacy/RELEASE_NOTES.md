# Jukie — Release Notes

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
