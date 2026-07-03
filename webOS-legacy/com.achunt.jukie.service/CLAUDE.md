# Jukie Audio Service — webOS JS Service

This is the Luna (Node) service half of **Jukie**, a Palm/HP webOS Apple Music client.
The app lives in the sibling `com.achunt.jukie/` directory.

## Session Setup

At the start of every session, load the full webOS platform context:

```
webos://knowledge/all
```

This gives you knowledge of the Mojo/Enyo frameworks, Luna service bus, SDK tools (including novacom), app structure conventions, and common gotchas — so we don't have to re-establish basics each time.

## Local SDK reference (PREFER over probing the device)

The HP webOS SDK is installed locally at `C:\Program Files (x86)\HP webOS\SDK\share`.
Read the Enyo 1 framework source under
`…\SDK\share\framework\enyo\1.0\framework\source\` for real kind APIs instead of grepping
the minified on-device build. Sample apps live in `…\SDK\share\samplecode\`.

---

## Project Details

**Service ID:** `com.achunt.jukie.service` (must begin with the app ID `com.achunt.jukie`)
**Engine:** Node 0.4 (legacy webOS JS service framework, Foundations library)
**Bus:** public (all commands `public: true`)

## Why this service exists

webOS's HTML5 `<audio>` and the `com.palm.mediad` MediaPlayer route through a
playbin GStreamer pipeline that needs the `audioresample` element — **absent on this
device**, so our streams won't play. This service drives a hand-built `gst-launch-0.10`
pipeline instead and exposes playback over the Luna bus.

**Playback path = curl-then-filesrc (NOT direct streaming).** The service runs inside a
webOS jail whose `/dev` has `urandom` but **no `/dev/random`**. `gst souphttpsrc` over HTTPS
uses gnutls/libgcrypt, which aborts there (`no entropy gathering module detected` → SIGABRT)
before the TLS handshake. So `_spawn` first downloads the preview with `curl` (its OpenSSL
seeds fine from `/dev/urandom`) to `/tmp/jukie-preview.m4a`, then `_playFile` plays it with
`filesrc ! decodebin ! audioconvert ! pulsesink` — no TLS, no entropy needed. See memory
`jail-no-dev-random-tls`. (Do not "simplify" this back to a single souphttpsrc pipeline.)

## Package structure (webOS JS service convention)

Per the SDK "Creating a Hello World Service" guide, a service is one of **three** sibling
dirs, tied together by a package descriptor:

```
com.achunt.jukie/          ← the app
com.achunt.jukie.service/  ← THIS service
com.achunt.jukie.package/  ← packageinfo.json  ("app" + "services" arrays)
```

Files in this directory:
- `services.json` — bus name + the commands, each mapped to an assistant; `activityTimeout`
  is set high (600s) so the service isn't reaped mid-playback.
- `sources.json` — loads the Foundations library + `JukieAudioService.js`.
- `JukieAudioService.js` — the whole implementation (singleton player + command assistants).

There is **no `package.json`** in a webOS JS service — source loading is driven by
`sources.json`, and the package manifest is `packageinfo.json` in the package dir. (Don't
re-add an npm-style `package.json`; it's a common mistake.)

## Implementation notes (`JukieAudioService.js`)

- **Singleton `JukiePlayer`** holds all state; it persists across Luna requests because all
  command assistants run in the one Node process.
- **Pause/resume = `SIGSTOP`/`SIGCONT`** on the `gst-launch` child (freeze/thaw) — preserves
  position without re-fetching the stream.
- **Position** is wall-clock derived (`startTime` re-anchored on resume), not queried from
  GStreamer. `duration` defaults to 30s (Apple preview clips), refined once a full track's
  real duration is known.
- **Seek** kills the pipeline, cuts a fragment from the cached file with `ffmpeg -ss <t>
  -acodec copy -f mp4` (this device's ffmpeg is an ancient 2011 build - no modern `-c`
  shorthand, no ADTS muxer), and plays that fragment. See `seekTo`/`_runSeek`.
- **Volume** is NOT the real system volume - com.palm.audio's `media/setVolume`/`getVolume`
  are private-bus-only and unreachable from a 3rd-party app (confirmed live: a public-bus call
  gets "Unknown method", and our own service's role has no outbound private-bus permission
  either). Instead `setVolume`/`_applyVolume` set the gain of our OWN PulseAudio sink-input
  directly via `pactl set-sink-input-volume` (the `pcm_output` hw sink itself always stays at
  100%/0dB - all per-app gain lives at the sink-input layer). A fresh gst spawn gets a fresh
  sink-input at a PulseAudio-assigned default, so `_playFile` re-applies the stored volume
  after every spawn, retrying briefly since the sink-input doesn't register with PulseAudio
  the instant gst starts.
- **`setCredentials`** exists because `jukie-drm` (the full-track/Widevine helper) has no
  way to receive tokens per-invocation - it only ever reads a static `secrets.local.json`
  next to itself (fresh, every spawn - it's a separate process each time, no shared state
  with this service). The app's Settings screen has no filesystem access of its own, so
  this is the only path for a pasted Developer/Music User Token to actually reach
  `jukie-drm`. Merges into the existing file rather than overwriting it (only writes
  fields actually provided), so a partial update or an empty-string field never blanks an
  already-working credential.
- Each command assistant is `var XCommandAssistant = function(){}; .prototype.run = function(future){ future.result = JukiePlayer.<op>(); return future; }` — the spec's pattern. Args come from `this.controller.args`.

## Commands (call as `palm://com.achunt.jukie.service/<cmd>`)

| Command      | Params                         | Returns (status object)                                   |
|--------------|---------------------------------|-----------------------------------------------------------|
| `play`       | `{ url }` or `{ songId, libraryId }` | `{ returnValue, state, isPlaying, buffering, position, duration, volume, url, songId, error }` |
| `pause`      | —                                | same status object                                         |
| `resume`     | —                                | same                                                        |
| `stop`       | —                                | same                                                        |
| `getStatus`  | —                                | same                                                        |
| `seek`       | `{ seconds }`                    | same                                                        |
| `setVolume`  | `{ volume }` (0-100)              | same                                                        |
| `getVolume`  | —                                | `{ returnValue, volume }`                                   |
| `clearCache` | —                                | `{ returnValue, removed, freedBytes }`                      |
| `setCredentials` | `{ webDeveloperToken, musicUserToken }` (either optional) | `{ returnValue }` or `{ returnValue: false, error }` |

`state` ∈ `idle | playing | paused | ended | error`. Calling `play` with the same URL/song while
paused resumes in place.

## Deploying (use the script — manual install is NOT enough)

`palm-install` alone leaves the service broken on the TouchPad. Use the project-root helper:

```powershell
powershell -ExecutionPolicy Bypass -File deploy-jukie.ps1   # package + install + register + restart
```

It handles the three things `palm-install` doesn't (see memory `js-service-ls2-registration`):
1. **LS2 bus registration** — creates the role/service files under `/var/palm/ls2/{roles,services}/{pub,prv}/`
   and runs `ls-control scan-services` (else: `Service does not exist`). These get wiped every reinstall.
2. **Restart** — kills the running `<svc>.js` process so new code loads (a live JS service serves
   stale code until killed; live file-push fails because `/media/cryptofs/apps` is a jailed FUSE mount).

```bash
# Smoke-test over the bus from a device shell (novacom -t open tty://):
luna-send -n 1 palm://com.achunt.jukie.service/play '{"url":"https://.../preview.m4a"}'
luna-send -n 1 palm://com.achunt.jukie.service/getStatus '{}'
# Service console.log goes to /var/log/messages:  grep JukiePlayer /var/log/messages | tail
```
