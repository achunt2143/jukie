# jukie-drm

A static, CGO-free Go helper that lets [Jukie](../com.achunt.jukie) play **full Apple
Music tracks** (not just 30-second previews) on a legacy webOS device that has none of
the modern crypto/TLS stack this would normally need.

## What it does

Apple Music's native mobile delivery is FairPlay-DRM'd. Apple's **web player**
(music.apple.com), however, serves Widevine-protected streams to non-Safari browsers.
`jukie-drm` authenticates as that web player, does the Widevine license exchange for a
track, downloads the protected audio, decrypts it, and writes a plain, playable `.m4a`.
The [Luna service](../com.achunt.jukie.service) spawns it, parses one line of JSON off
stdout, and plays the resulting file with a hand-built GStreamer pipeline.

It's a single static ARMv7 binary (`GOOS=linux GOARCH=arm GOARM=7 CGO_ENABLED=0`) — this
device runs a 2.6.35 kernel, well below the ~3.2 floor modern glibc-linked toolchains
require, so a CGO-free static Go binary was the only realistic way to get a modern
TLS/crypto stack running on-device at all.

## Why Go, not Python

The obvious tool for a Widevine license exchange is `pywidevine`. It needs a modern
Python (3.7+) and a glibc new enough to satisfy its own dependency chain — neither of
which this device's ancient userland/kernel can host without a full chroot, which
brings its own compatibility swamp. Go's static binaries have no glibc dependency and
Go's own floor (kernel 2.6.32) comfortably covers this device. The Widevine license
protocol itself is implemented via
[`gowidevine`](https://github.com/iyear/gowidevine).

## Requirements to actually run this

Two things are **not included** in this repo and must be supplied yourself:

- **`secrets.local.json`** — `{ "webDeveloperToken": "...", "musicUserToken": "..." }`.
  See the main [Jukie README](../com.achunt.jukie#getting-your-apple-music-tokens) for
  how to obtain both.
- **`device.wvd`** — a Widevine **L3** (software) device credential: a client-ID blob +
  RSA private key, in the format the [`pywidevine`](https://github.com/devine-dl/pywidevine)
  ecosystem uses. This is standard practice across the entire unofficial-Widevine-client
  space (the same requirement applies to yt-dlp-adjacent tools, personal media backup
  tools, etc.) — obtaining one is left as an exercise; this repo doesn't include a device
  credential or a walkthrough for extracting one. **Never share a `.wvd` file** — leaked
  device credentials get their client IDs revoked once detected.

Both are read from the working directory first, then from next to the binary — so the
same build works both for local testing and once deployed into the service directory
on-device.

## CLI

```
jukie-drm [-o out.m4a] [-json] <songId> [universalLibraryId]
```

With `-json`, exactly one JSON result line is printed to stdout (all progress goes to
stderr), which is what the Luna service parses:

```json
{"ok":true,"path":"/tmp/jukie-123.m4a","title":"...","artist":"...","durationMs":201335}
```

There's also a small `jukie-auth` helper (`cmd/auth`) for credential management:

```
jukie-auth webtoken   # fetch + cache the public web-player token (no login needed)
```

This automatically refreshes the short-lived public web-developer-token so you don't
have to re-paste one every few weeks. Manually pasting a Music User Token extracted
from your own browser session (see the main README) is the supported way to get that
second credential — there's no automated sign-in flow here.

## Building

Requires a local Go toolchain (developed against `go1.21`+).

```powershell
# Cross-compiles to build/jukie-<cmd> for GOOS=linux GOARCH=arm GOARM=7, CGO disabled
powershell -File build.ps1 jukie-drm
powershell -File build.ps1 auth
```

Drop the resulting binary into `com.achunt.jukie.service/` (alongside your own
`device.wvd` + `secrets.local.json`) before running the app's own `deploy-jukie.ps1`.

## Project layout

- `cmd/jukie-drm/` — the main playback helper described above.
- `cmd/auth/` — the credential/token helper.
- `cmd/manifest/`, `cmd/smoke/` — development/debugging tools used while building this
  out; not part of the runtime path.
- `internal/apple/` — the Apple Music web-playback + license-exchange client.
- `internal/appleauth/` — the public web-token auto-refresh.

## A note on scope

This project is a personal interoperability effort: getting a subscription and hardware
the author owns to work together, not a general-purpose circumvention tool. Please keep
it that way if you build on it — don't share device credentials or tokens, and don't
turn this into a bulk-downloading tool.
