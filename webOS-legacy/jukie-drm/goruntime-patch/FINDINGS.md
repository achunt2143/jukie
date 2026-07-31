# Running jukie-drm on the Pre2: findings

Session date: 2026-07-28. Device: physical Palm Pre2 (novacom device name
`roadrunner-linux`, hostname `AndrewHuntsPre2`), kernel `2.6.24-palm-joplin-3430`.
Jukie/jukie-drm had never been installed on a Pre2 before this session — only the
TouchPad (kernel 2.6.35) had been verified working.

## tl;dr

The Pre2's kernel is old enough that neither system `curl` nor a stock modern Go
toolchain can talk to Apple's servers at all. Backporting jukie-drm's real
dependencies to an old-enough Go toolchain is a dead end (`google.golang.org/protobuf`
requires `go:embed`, a compiler feature, not just an API). Instead, **patching 4
specific syscall call sites in Go's runtime/stdlib to add fallbacks for pre-2.6.27
kernels** lets the *unmodified* real `jukie-drm` binary (real `go.mod`, real
`gowidevine`/`protobuf` deps) run completely — proven end-to-end with a real
`musicUserToken`: full webPlayback → Widevine license exchange → download → decrypt,
producing a playable `.m4a`.

The patch and a build script live in this directory (`goruntime-patch/`).

## The starting problem

1. **System curl is too old.** `curl 7.21.3` / `OpenSSL 0.9.8k` (~2009) can't
   complete a TLS handshake with `www.apple.com` or `amp-api.music.apple.com`:
   `SSL23_GET_SERVER_HELLO:tlsv1 alert protocol version`. Apple's edge has long since
   dropped whatever protocol/ciphers that stack offers.

2. **Modern Go's runtime won't even start networking on this kernel.** A stock
   go1.26 build of jukie-drm's `cmd/smoke` test (after fixing an unrelated `GOARM=7`
   problem — the Pre2's CPU has no VFPv3 hardware float unit, so cross-builds for this
   device must use `GOARM=5`) crashed instantly on `crypto/rand`'s first read:
   ```
   runtime: epollcreate failed with 38
   fatal error: runtime: netpollinit failed
   ```
   Root cause: `runtime/netpoll_epoll.go`'s `netpollinit()` calls `epoll_create1`
   unconditionally with no fallback. `epoll_create1` was added in Linux **2.6.27**;
   this kernel is **2.6.24**.

## Two ways to fix it, one of which is a dead end

### Rejected: backport jukie-drm + deps to an old-enough Go

Every Go version from 1.4 through 1.19 keeps a fallback from `epoll_create1` to the
legacy `epoll_create()`. But Go 1.14 *also* switched `netpollBreak`'s wakeup mechanism
to `pipe2()` (another 2.6.27-only syscall) with no fallback. So **Go 1.13** is the
only version with neither problem — verified by diffing
`src/runtime/netpoll_epoll.go` across every release tag on GitHub.

That's promising until you try to actually build jukie-drm with it:
```
cannot load embed: malformed module path "embed": missing dot in first path element
```
`google.golang.org/protobuf`'s core runtime (`internal/editiondefaults/defaults.go`,
real code, not test-only) uses `go:embed` — a **compiler** feature added in Go 1.16,
not something you can polyfill from userspace. Widevine license/PSSH parsing needs
protobuf, so this isn't optional. Fixing it means forking protobuf-go to hand-inline
that one file, then continuing to hunt for the next such wall in `gowidevine`/`mp4ff`/
`cmac-go` the same way — open-ended effort, plus a permanent fork to maintain forever.
**Abandoned.**

### Chosen: patch the Go runtime instead, keep the real go1.21 toolchain and deps

Copy the installed GOROOT to a side install so the main toolchain is untouched, patch
4 call sites, self-build via `src/make.bat` (bootstrapped from the original,
unpatched Go — completely standard Go-contributor workflow), and cross-compile the
real, unmodified `cmd/jukie-drm`.

Each patch was found empirically, one crash at a time, by running the *real* binary
(not a synthetic probe) and fixing whatever it hit next:

1. **`epoll_create1` → `epoll_create`** (`runtime/netpoll_epoll.go`,
   `netpollinit()`). The original Go 1.13-era fallback, ported to the current
   syscall-wrapper style.

2. **`eventfd2` → `eventfd`** (same function; modern Go's `netpollBreak` wakeup
   mechanism moved from a pipe to an eventfd at some point after 1.19, and that call
   is *also* unconditional). Legacy `eventfd(2)` (no flags) has existed since Linux
   2.6.22, so it's safely older than this kernel.

3. **`epoll_pwait` → `epoll_wait`** (`runtime/netpoll_epoll.go`, `netpoll()`,
   called from the background `sysmon` thread). This one was a genuine surprise:
   mainline Linux added `epoll_pwait` in **2.6.19**, which predates this kernel's
   2.6.24 — by version-number logic it should have been fine. It wasn't: this
   device's kernel is a **custom Palm build ("joplin")** that returns `ENOSYS` for it
   anyway. Lesson: don't trust "mainline added it in version X" as proof a vendor
   kernel has it — verify empirically. Falls back to plain `epoll_wait` once ENOSYS
   is observed once (cached in a package-level bool for the rest of the process).

4. **Combined `socket(..., SOCK_NONBLOCK|SOCK_CLOEXEC, ...)` → plain `socket()` +
   separate `fcntl` calls** (`net/sock_cloexec.go`, `sysSocket()`). This is *not* in
   the runtime — it's in the `net` package's low-level socket constructor, hit by
   the pure-Go DNS resolver's UDP query (`dial udp 127.0.0.1:53: socket: invalid
   argument`). Go already ships this exact fallback for aix/darwin
   (`net/sys_cloexec.go`); linux was split out of the fast-path file into a new
   `net/sock_cloexec_linux.go` with the same fallback pattern, triggered on
   `EINVAL`/`ENOSYS`.

Syscall numbers used in the fallbacks (`epoll_create`=250, `eventfd`=351,
`epoll_wait`=252 on ARM EABI) were verified against the upstream kernel's
`arch/arm/tools/syscall.tbl`, not guessed.

**Known limitation:** the syscall-number constants were only added to
`internal/runtime/syscall/linux/defs_linux_arm.go` (ARM-specific). This patched
toolchain will fail to cross-compile for other `GOARCH` targets (amd64, arm64, ...)
until the same constants are added to those archs' `defs_linux_*.go` files too. Not
needed for Pre2/TouchPad work, so not done.

## Proof: full pipeline, twice

**Pass 1** (web token only, no real `musicUserToken`, to sanity-check the patched
runtime under real load): got through DNS, TLS handshake, and a real authenticated
POST to `play.music.apple.com/WebObjects/MZPlay.woa/wa/webPlayback`, correctly
parsing Apple's JSON. Apple legitimately rejected the session (no real subscriber
token supplied) — an expected auth-layer stop, not a crash.

**Pass 2** (real `musicUserToken` pulled from the TouchPad's live
`secrets.local.json`, plus the real `device.wvd`, both pushed to the Pre2 over
novacom): **complete success**.
```
== webPlayback 1888621165 ==
  Sunshine Girl — Lenka (201335 ms)
  manifest: https://aod-ssl.itunes.apple.com/...
  key-id: 000000007092126d001d9768abfefc49
  cert provider: irdeto.com
== license exchange ==
  got 2 content key(s)
== download + decrypt ==
  downloaded 6798535 bytes
  decrypted -> Sunshine Girl.m4a
{"ok":true,"path":"Sunshine Girl.m4a","title":"Sunshine Girl","artist":"Lenka","durationMs":201335}
```
Pulled the file back over novacom and confirmed it plays. The entire real pipeline —
auth, Widevine CDM license negotiation, download, AES decrypt — runs unmodified on
the Pre2.

Both passes used `SSL_CERT_FILE` pointed at a pushed copy of curl's public Mozilla CA
bundle (`https://curl.se/ca/cacert.pem`), because the device has no system trust
store at any of the paths Go's `crypto/x509` checks by default. This is a separate,
already-understood gap (not a kernel/syscall issue) — a real deployment needs to
either embed a CA bundle in the binary or place one at a well-known path on-device.
Notably jukie-drm has *no* embedded CA bundle today and it already works on the
TouchPad, implying the TouchPad's rootfs does have a usable system cert store that
the Pre2's doesn't.

## How to reapply this patch

```powershell
powershell -ExecutionPolicy Bypass -File goruntime-patch\apply.ps1
```
Builds a side toolchain at `~/sdk/go1.26-pre2` (or `-Dest <path>`), bootstrapped from
whatever `go` is currently on PATH. Does not touch the main Go install. See
`apply.ps1` for the manual steps if you'd rather do it by hand, and the individual
`.diff`/`.new` files in this directory for the exact changes.

## What's left before this is shippable, not just proven

- **CA bundle story.** Embed a bundle in the binary (simplest, but adds ~200KB and a
  maintenance burden to keep it current) vs. relying on a known on-device path (need
  to confirm what, if anything, exists on a stock Pre2 vs. what Jukie's installer
  would need to place there).
- **This is jukie-drm only — no audio *output* has been tested on the Pre2 at all.**
  This session proved fetch+decrypt-to-file. Actually hearing sound out of the device
  is a separate, untested problem; see `PRE2_MOJO_PORT_PLAN.md` at the `webOS-legacy/`
  root for what's already known to work on the TouchPad and what has to be verified
  fresh on Pre2's older multimedia stack.
- **Multi-arch support for the patched toolchain**, if it's ever needed beyond ARM.
