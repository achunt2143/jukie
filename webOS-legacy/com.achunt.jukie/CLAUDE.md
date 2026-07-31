# Jukie — unified webOS Apple Music Client package

This is a **Palm/HP webOS** application (original 2009–2012 platform, not LG webOS).

## Session Setup

At the start of every session, load the full webOS platform context:

```
webos://knowledge/all
```

This gives you knowledge of the Mojo/Enyo frameworks, Luna service bus, SDK tools
(including novacom), app structure conventions, and common gotchas.

## What this directory is

`com.achunt.jukie/` is **one webOS package that bundles two complete front-ends** — an
Enyo build (webOS 3.x, TouchPad/Pre3 era) and a Mojo build (webOS 2.x, Pre2 era) — under a
single app id, and picks the right one **at launch, on-device**, instead of requiring a
human to know which device they're installing to. This exists because Enyo never shipped
on webOS 2.x, so there's no way to run one UI framework on both device families, but the
underlying product (catalog, playback, DRM, business logic) is identical either way.

webOS's own `packageinfo.json` format only supports **one** `app` entry per package
(confirmed from the SDK's own schema doc) — so "one package containing two literal apps"
isn't possible. What *is* possible, and what this is, is one app whose entry point detects
the device and loads the right framework. This pattern is modeled directly on a real
shipped webOS app that does the same thing for the same reason:
`dev-stuff/com.preciouscoders.pre.auctionmatepro` (AuctionMate Pro for eBay) bundles both
Mojo and Enyo in one package with a framework-less `index.html` switcher.

```
com.achunt.jukie/
  appinfo.json     ← the ONE manifest for the whole package (main: index.html)
  index.html       ← framework-less switcher (see below) — the actual "main"
  icon.png, icon-256x256.png       ← shared app icon (referenced by appinfo.json only)
  enyo/            ← full Enyo/webOS3 build — see enyo/CLAUDE.md
  mojo/            ← full Mojo/webOS2 build — see mojo/CLAUDE.md
```

Each of `enyo/` and `mojo/` is a self-contained, unmodified copy of what used to be its own
top-level package directory (`com.achunt.jukie/` and `com.achunt.jukie.mojo/`,
respectively) — its own `index.html`, its own manifest/dependency file
(`enyo/depends.js` / `mojo/sources.json`), and everything each references, all still
relative to *its own* location. Nothing inside either subtree had to be rewritten to move:
both Enyo's and Mojo's framework bootstraps resolve their manifest via a relative URL
against wherever their own entry HTML currently sits, not a fixed app-root path (confirmed
by reading Enyo's own bootstrap loader; both trees were also grepped for any *absolute*
local resource reference and came up clean — the only absolute paths in either tree are the
expected `/usr/palm/frameworks/...` framework script tags).

## The switcher (`index.html`)

Framework-less — no `<script>` tags, nothing that depends on Enyo or Mojo being loaded.
Reads `window.PalmSystem.deviceInfo` (a JSON string the webOS shell injects into every page
*before* any UI framework loads — confirmed present pre-framework-load in both Enyo's and
Mojo's own framework source) and checks `platformVersionMajor`:

- `>= 3` (or `PalmSystem` missing/unparseable) → redirect to `enyo/index.html`
- `< 3` → redirect to `mojo/index.html`

Defaulting to Enyo on any detection failure matches the real AuctionMate app's own choice
(same fallback logic, same field). Both builds are independently confirmed working on real
hardware as of 2026-07-30 (TouchPad and Pre2), so this default is just a safe fallback for
an edge case, not a statement that one build is more trustworthy than the other.

## jukie-drm: the other half of "one package, dynamically correct"

The Widevine/DRM helper (`../jukie-drm/`) has the same two-webOS-versions problem as the UI:
a `webos3` build (GOARM=7, standard Go toolchain) and a `webos2` build (GOARM=5, patched
toolchain — see `../jukie-drm/goruntime-patch/FINDINGS.md`) are mutually incompatible
binaries. `com.achunt.jukie.service` now ships **both** (`jukie-drm-webos3`,
`jukie-drm-webos2`) and `JukieAudioService.js` picks the right one at service load using
the same hardware probe it already used to pick the AAC decode path (TouchPad-class jails
can reach `/dev/DspBridge`; webOS2-class jails can't) — one probe, two decisions, instead of
a second device check that could drift out of sync with the first. See
`../com.achunt.jukie.service/CLAUDE.md`.

## Deploy

One script now, from the repo root, regardless of which device is connected:

```
powershell -ExecutionPolicy Bypass -File ../deploy-jukie.ps1
palm-launch com.achunt.jukie
```

It builds both jukie-drm targets, packages this unified app + `com.achunt.jukie.service` +
`com.achunt.jukie.package` into one `.ipk`, stamps the executable bit onto whichever
jukie-drm binaries got bundled (`fix-ipk-exec.py` — Windows has no POSIX exec bit for
`palm-package` to copy) as a first attempt, installs it, then `post-install-jukie.ps1`
registers the service on LS2 **and** `chmod +x`'s both jukie-drm binaries again on-device
as a required backstop — confirmed on real hardware (2026-07-31) that `fix-ipk-exec.py`'s
package-level stamp does not reliably survive `palm-install` on every device (Pre2 landed
files at 644 regardless, breaking every jukie-drm spawn with "Permission denied"; TouchPad
lands them executable on its own either way and rejects an explicit chmod outright, so the
on-device chmod is a real fix on one device family and a harmless no-op on the other). This
replaced the old split of `deploy-jukie.ps1` (Enyo/TouchPad-only) +
`deploy-jukie-mojo.ps1` (Mojo/webOS2-only), which used to fight over a single shared
`jukie-drm` binary slot — see `../jukie-drm/build.ps1`'s header comment for that history.

## Confirmed on real Pre2 hardware (2026-07-30 to 2026-07-31) — three real bugs found and fixed

The switcher mechanism itself (redirect + `platformVersionMajor` detection +
`mojo/sources.json` resolving relative to its own nested location) all worked correctly
on the first real-device pass. Three things did NOT, all now fixed:

1. **Mojo's own explicit `"main"` stage name collided with the switcher's implicit one.**
   `mojo/app/controllers/app-assistant.js`'s `handleLaunch` explicitly does
   `createStageWithCallback({name: "main", ...})` (needed because `noWindow: true` turns
   off the framework's default auto-stage, and Exhibition Mode needs its own separate
   "dock" stage anyway). Before this restructure, Mojo's `index.html` WAS the system's
   literal `main` launch entry, so there was nothing else to collide with. Now that
   `mojo/index.html` is reached via the switcher's `window.location.replace()` (an
   in-place navigation of the SAME underlying stage/window the system already associated
   with the app's `main` entry point), that stage creation call fails outright on its
   very first call: `Uncaught Error: require Failed: createStageWithCallback: cannot
   create two stages with the same name : main` — confirmed via `/var/log/messages` on a
   real Pre2, full stack trace pointed straight at `app-assistant.js`'s
   `createStageWithCallback` call. Notably `getStageController("main")` (the JS-level "does
   it already exist" check `handleLaunch` already had) returned nothing, so the collision
   is with something the framework/system tracks below that JS-visible layer — a JS-level
   existence guard can't fix it. **Fix:** renamed the stage from `"main"` to `"jukiemain"`
   (an app-specific name that can't collide with whatever the system implicitly reserves
   for the launch entry) — see `handleLaunch`'s own comment in `app-assistant.js` for the
   full account.
2. **Mojo's framework bootstrap needs its OWN local `appinfo.json`, separate from the
   package-level one.** This restructure originally deleted `mojo/appinfo.json`, reasoning
   that ONE merged manifest at the package root (`../appinfo.json`) should cover
   everything — true for the OS-level package manifest, but NOT true for the Mojo
   framework's own internal bootstrap, which independently re-reads an `appinfo.json`
   relative to wherever it's loaded from (the same "resolve relative to current document"
   convention as `sources.json`, just a separate fetch). Without it, `mojo/index.html`
   failed with `Cannot use 'in' operator to search for 'noWindow' in undefined`
   immediately followed by `The scene assistant 'MainAssistant' is not defined` (the
   framework falling back to some generic default scene-push behavior once its own
   config read came back `undefined`) — confirmed via the same on-device log. **Fix:**
   restored `mojo/appinfo.json` with the original (pre-merge) Mojo manifest content.
   **Consequence:** `mojo/appinfo.json` and the package-root `appinfo.json` now both
   exist and must be kept roughly in sync for any Mojo-relevant field (`noWindow`,
   `dockMode`, `touchstoneMode`, `universalSearch`, icons) — there is no single source of
   truth for these across both. `enyo/` needed no equivalent restoration; Enyo's bootstrap
   (confirmed by reading `enyo.js` itself) only ever fetches `depends.js` relative to
   itself, and reads `noWindow`/`dockMode`-type info via `PalmSystem` APIs directly rather
   than re-fetching its own manifest copy.
3. **jukie-drm's executable bit didn't survive `palm-install` on this device.** Surfaced
   as "playback stopped working" after the two fixes above got it launching - NOT a wrong
   binary being selected (a natural first guess, since the service picks between two
   binaries now), but neither binary being executable at all:
   `/media/cryptofs/apps/usr/palm/services/com.achunt.jukie.service/jukie-drm-webos2` was
   `-rw-r--r--` (644), and running it directly over novacom confirmed `Permission denied`.
   **Fix at the time:** `post-install-jukie.ps1` now does `chmod +x` on both jukie-drm
   binaries as a backstop, in addition to `fix-ipk-exec.py`'s package-level stamp. **This
   diagnosis turned out to be incomplete - see bug #4 below, found the same day during a
   fully manual (no-script) reinstall test.** The chmod backstop is harmless and stays in
   place, but it likely wasn't fixing a genuine "Pre2 doesn't preserve tar modes" quirk at
   all - bug #4 is a much more direct explanation for why the stamped mode wasn't landing.
4. **The REAL cause of #3: `fix-ipk-exec.py` was producing a corrupt package that this
   device's `ipkg` can't fully parse - confirmed by a manual, no-script
   uninstall→build→permission→package→install pass.** `palm-install`'s own log claimed
   success (`AI_ERR_NONE`), but manually re-running the exact `ipkg install` command it
   used (found in `/var/log/messages`) surfaced what it was actually hiding:
   `ipkg: Unknown typeflag: 0x78: Illegal seek`, repeated, then
   `Don't know how to handle /media/cryptofs/apps/./@PaxHeader`. Typeflag `0x78` = `'x'`
   = a PAX extended-header tar entry. Python 3's `tarfile` module defaults to
   `PAX_FORMAT` when writing, and `fix-ipk-exec.py`'s `set_modes()` rewrites the whole
   `data.tar.gz` through `tarfile` to stamp the exec bit - so every rebuilt package got
   PAX headers baked in, silently. This device's `ipkg` predates PAX entirely and can't
   skip an extended-header entry it doesn't understand; worse, failing to parse ONE entry
   desyncs its read position for the REST of the archive. Files packed before the first
   PAX header (the app, alphabetically first) installed fine; everything packed after
   (the service - `JukieAudioService.js`, both jukie-drm binaries, `services.json`,
   etc.) silently never landed at all. `doInstall` even logged
   `0 services detected for package com.achunt.jukie` - and `palm-install` reported
   success anyway. **This directly explains bug #3's symptom without needing "Pre2
   doesn't honor tar modes" as an explanation**: a corrupted/desynced tar read plausibly
   produces a wrong-but-plausible-looking mode for whatever entry actually landed, rather
   than the stamped 0755 - and confirmed live: rebuilding with the fix below, the exec
   bit landed as `-rwxr-xr-x` on a fresh install with **no on-device chmod at all**.
   **Fix:** `fix-ipk-exec.py`'s output `tarfile.open(...)` call now passes
   `format=tarfile.GNU_FORMAT` explicitly - GNU format needs no extended headers for
   filenames/sizes this small, and has been supported by tar implementations far longer
   than PAX. The `post-install-jukie.ps1` chmod backstop (bug #3's fix) stays as
   defense-in-depth regardless - cheap insurance, and TouchPad's cryptofs mount
   genuinely does reject `chmod` outright (confirmed separately, unrelated to this bug),
   so a backstop that's a no-op there costs nothing to keep.

Verified after all four fixes: `com.achunt.jukie` shows twice in
`palm://com.palm.applicationManager/running` (the hidden noWindow background context plus
the visible `jukiemain` card), `com.achunt.jukie.service/getStatus` responds normally, and
`jukie-drm-webos2` now executes instead of `Permission denied` when invoked directly. Also
separately verified with a fully manual (no deploy script) uninstall → `build.ps1` →
`fix-ipk-exec.py` → `palm-package` → `palm-install` pass: the rebuilt `.ipk` has zero PAX
tar entries, the service directory fully populates (previously silently empty), and both
jukie-drm binaries land `-rwxr-xr-x` with no on-device chmod needed at all.
**Not yet re-verified: an actual real-song full-track play call** (needs valid pushed
credentials + a real catalog id to exercise the whole webPlayback→license→decrypt chain,
not something this session could manufacture standalone) - the exec-bit fix removes the
specific failure that was blocking it, but confirm a real play still works next session
rather than assuming it from this alone.

**Enyo/TouchPad side confirmed too (same day).** Deployed the same unified package to a
connected TouchPad and it came up clean through the switcher on the first try - full
`MusicPlayerApp.create()` → `rendered()` → library load → Songs list sequence in
`/var/log/messages` with no `com.achunt.jukie`-attributed errors, and
`com.achunt.jukie.service/getStatus` responded normally there too. No equivalent of either
Mojo fix above was needed - consistent with Enyo's bootstrap only ever fetching
`depends.js` relative to itself (confirmed by reading `enyo.js`) and getting
`noWindow`/`dockMode` info via `PalmSystem` directly rather than re-reading its own
manifest copy. Both platforms are now confirmed working through the merged switcher.

## Self-service dialog for the jukie-drm permission bug (2026-07-31)

Because bug #3 above is real and can recur on any device whose `palm-install` doesn't
preserve `fix-ipk-exec.py`'s stamp (only Pre2 confirmed affected so far, but nothing
guarantees it's the only one), the whole chain now surfaces it as an actionable in-app
message instead of a silent playback failure:

- **Service** (`JukieAudioService.js`): a jukie-drm `spawn()` failure is checked for
  `EACCES` (`isDrmPermissionError`); if it matches, `permissionError: true` rides along in
  the `status()` object everywhere else already returns `error`.
- **Mojo**: `playback-service.js` reads it off `getStatus`/`play` responses; on the
  `"error"` state transition it calls `Jukie.showPermissionErrorDialog()`
  (`app-assistant.js`) - reaches the ACTIVE scene directly via `getStageController(...)
  .activeScene()` and `showAlertDialog`, same reasoning as the existing
  `Jukie.enterExhibition`/`playNext` cross-scene calls (has to fire no matter what's on
  screen). Uses the SAME `showAlertDialog` API already confirmed working from the earlier
  on-device Mojo fixes this session - high confidence.
- **Enyo**: the same flag threads through `kindAudioPlayer` → a new `onPermissionError`
  event on `kindPlayback` → `app.js`'s `onPlaybackPermissionError`, which lazily builds
  and shows a dynamically-created `enyo.ModalDialog` (`createComponent` + `.render()` +
  `.openAtCenter()`). This is the first dynamically-created top-level popup anywhere in
  this app (everything else is statically declared in a component tree) - built from
  reading the SDK's `Popup.js`/`ModalDialog.js` source, NOT verified live: attempted to
  force-trigger it on the connected TouchPad by revoking jukie-drm's exec bit, but this
  device's cryptofs mount silently ignores `chmod` in either direction (confirmed:
  `chmod -x` left the file at `-rwxrwxrwx`, unchanged) - which also explains why TouchPad
  never needed bug #3's on-device chmod fix in the first place, but means the dialog path
  itself couldn't be forced to fire here. Only syntax-checked + confirmed no load-time
  errors. Worth a real trigger-and-look pass next time this specific failure mode shows up
  on a device where it's reproducible (a Pre2/Veer with the bit actually reverted).

The message includes the exact fix command:
`chmod +x /media/cryptofs/apps/usr/palm/services/com.achunt.jukie.service/jukie-drm-webos2
/media/cryptofs/apps/usr/palm/services/com.achunt.jukie.service/jukie-drm-webos3` (both
binaries, unconditionally - the dialog doesn't know which one was actually being invoked).

See `enyo/CLAUDE.md` and `mojo/CLAUDE.md` for each build's own (extensive) on-device
history and remaining framework-specific gotchas.
