# Jukie Audio Service

The Luna (Node) service half of [Jukie](../com.achunt.jukie), a Palm/HP webOS Apple
Music client. It exists for one reason: **this webOS build's stock audio pipeline can't
play Jukie's streams at all.**

## Why this service exists

webOS's HTML5 `<audio>` element (and the `com.palm.mediad` MediaPlayer it routes
through) uses a `playbin` GStreamer pipeline that's missing the `audioresample`
element — a hard requirement for the audio Jukie plays. A hand-built
`gst-launch-0.10` pipeline (`filesrc ! decodebin ! audioconvert ! pulsesink`) plays the
exact same files fine. This service drives that pipeline directly and exposes
play/pause/seek/volume/etc. over the Luna service bus, so the app never has to touch
`<audio>` at all.

**Two-stage playback (curl-then-filesrc), not direct streaming.** The service runs
inside a webOS jail whose `/dev` has `urandom` but no `/dev/random`. GStreamer's
`souphttpsrc` over HTTPS uses gnutls/libgcrypt, which aborts at init in that
environment (`no entropy gathering module detected`) before the TLS handshake ever
happens. So preview playback downloads the clip with `curl` first (its OpenSSL is happy
seeding from `/dev/urandom`), then plays the local file — no TLS, no entropy needed, in
the actual playback pipeline.

## Package structure

Per the webOS "Hello World Service" convention, a service ships as one of three sibling
directories tied together by a package descriptor:

```
com.achunt.jukie/          the app
com.achunt.jukie.service/  this service
com.achunt.jukie.package/  packageinfo.json ("app" + "services" arrays)
```

- `services.json` — bus name + commands, each mapped to an assistant.
- `sources.json` — loads the Foundations library + `JukieAudioService.js`.
- `JukieAudioService.js` — the whole implementation: a singleton player + one command
  assistant per bus method.

There is intentionally no npm-style `package.json` here — this is webOS's legacy Node
0.4 JS service framework, and source loading is driven entirely by `sources.json`.

## Implementation notes

- **Singleton `JukiePlayer`** holds all playback state; it persists across bus calls
  because every command assistant runs in the same long-lived Node process.
- **Pause/resume** is a real pause, not "acts like mute": `SIGSTOP`/`SIGCONT` alone only
  freezes GStreamer, while PulseAudio's own clock keeps draining its buffer as silence.
  Real pause suspends the PulseAudio sink itself (`pactl suspend-sink`), which actually
  stops the audio device.
- **Position** is wall-clock derived (re-anchored on resume/seek), not polled from
  GStreamer — `gst-launch` has no query interface for this.
- **Seeking**: `gst-launch-0.10` has no interactive seek control at all (no CLI flag, no
  stdin command) — it's fire-and-forget. A seek kills the pipeline, cuts a fragment
  starting at the target time with `ffmpeg -ss <t> -acodec copy -f mp4` (this device's
  ffmpeg is an ancient ~2011 build — no modern `-c` shorthand, no ADTS muxer compiled
  in), and plays that fragment instead.
- **Volume is *not* the device's real system volume.** `com.palm.audio`'s
  `media/setVolume`/`getVolume` are private-bus-only — confirmed via live testing that a
  3rd-party app gets `"Unknown method"` even over the public bus, and this service's own
  bus role has no outbound private-bus permission either. Instead, `setVolume` sets the
  gain of this service's *own* PulseAudio stream directly via
  `pactl set-sink-input-volume` (the hardware sink itself always stays at 100%/0dB — all
  per-app gain lives at the sink-input layer, so this can't affect any other app's
  audio). A fresh `gst-launch` spawn gets a fresh sink-input at PulseAudio's own default
  gain, so the stored volume is re-applied after every spawn.
- Each command assistant follows the standard webOS pattern:
  `var XCommandAssistant = function(){}; XCommandAssistant.prototype.run = function (future) { future.result = JukiePlayer.<op>(); return future; };`

## Commands

Call any of these as `palm://com.achunt.jukie.service/<command>`:

| Command      | Params                                | Returns                                                                          |
|--------------|----------------------------------------|-----------------------------------------------------------------------------------|
| `play`       | `{ url }` or `{ songId, libraryId }`   | `{ returnValue, state, isPlaying, buffering, position, duration, volume, url, songId, error }` |
| `pause`      | —                                      | same status object                                                                 |
| `resume`     | —                                      | same                                                                               |
| `stop`       | —                                      | same                                                                               |
| `getStatus`  | —                                      | same                                                                               |
| `seek`       | `{ seconds }`                          | same                                                                               |
| `setVolume`  | `{ volume }` (0–100)                   | same                                                                               |
| `getVolume`  | —                                      | `{ returnValue, volume }`                                                          |
| `clearCache` | —                                      | `{ returnValue, removed, freedBytes }`                                             |
| `setCredentials` | `{ webDeveloperToken, musicUserToken }` (either optional) | `{ returnValue }`                                     |

`setCredentials` merges a Developer Token / Music User Token pasted into the app's
Settings screen into `secrets.local.json`, so `jukie-drm` (which only ever reads that
static file, with no way to receive credentials per-invocation otherwise) picks them up.
Only the fields actually provided are written — a partial update never blanks an
already-working credential.

`state` is one of `idle | playing | paused | ended | error`. Calling `play` with the
same URL/song while paused resumes in place rather than restarting.

Full-track playback (`{ songId, libraryId }`) is handled by spawning the bundled
[`jukie-drm`](../jukie-drm) helper, which does the Apple Music web-playback + Widevine
license exchange and hands back a plain decrypted file to play.

## Deploying

**`palm-install` alone is not enough** — it drops the service's files but doesn't
register it on the device's LS2 bus (`Service does not exist`), and those registration
files get wiped on every reinstall anyway. A live JS service also keeps serving old code
until it's killed, and a raw file push can't reach it (the app's install directory is a
jailed FUSE mount). Use the project-root script, which handles all of this:

```powershell
powershell -ExecutionPolicy Bypass -File deploy-jukie.ps1
```

Smoke-test directly over the bus from a device shell (`novacom -t open tty://`):

```bash
luna-send -n 1 palm://com.achunt.jukie.service/play '{"url":"https://.../preview.m4a"}'
luna-send -n 1 palm://com.achunt.jukie.service/getStatus '{}'
# Service logs go to /var/log/messages:
grep JukiePlayer /var/log/messages | tail
```

## Secrets

`device.wvd` and `secrets.local.json` live in this directory alongside the compiled
`jukie-drm` binary — they're required here for full-track playback to work on-device,
and are git-ignored at the project root. See [`jukie-drm`](../jukie-drm)'s README before
touching either.
