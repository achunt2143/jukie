# Deploy Jukie to whichever webOS device is connected - one script, one package, works on
# either a TouchPad (webOS 3.x) or a Pre2/older phone (webOS 2.x).
#
# Why this is one script now: com.achunt.jukie is a single unified package. Its
# index.html is a framework-less switcher that detects the connected device
# (PalmSystem.deviceInfo.platformVersionMajor) and loads the Enyo or Mojo build
# accordingly, and com.achunt.jukie.service's JukieAudioService.js picks the matching
# jukie-drm binary the same way. There's no more "human has to know which device this is
# and run the matching script" step - this replaces the old deploy-jukie.ps1
# (Enyo/TouchPad-only) + deploy-jukie-mojo.ps1 (Mojo/webOS2-only) split, which also used
# to fight over a single shared jukie-drm binary slot (2026-07-29 incident: a leftover
# webOS2 build got deployed to a TouchPad because whichever script ran last won). Both
# binaries are now built and shipped together, so that failure mode is gone entirely.
#
# What palm-install alone does NOT do, that this script still has to handle:
#   1. jukie-drm's executable bit - Windows/NTFS has no exec bit for palm-package to
#      copy, so every file lands in a Windows-built .ipk as 0644. fix-ipk-exec.py stamps
#      0755 onto whichever jukie-drm-webos2/-webos3 binaries got bundled, directly inside
#      the built .ipk, before install - so the installed files are already executable and
#      nothing needs fixing on-device (on-device chmod never worked reliably on
#      TouchPad's jail anyway).
#   2. LS2 bus registration - palm-install drops the service files but never registers
#      them on the bus, and the registration files under /var/palm/ls2 are wiped on every
#      reinstall. post-install-jukie.ps1 (re)creates them and restarts the service so new
#      code loads.
#   3. Keeping credentials out of the .ipk - palm-package doesn't honor .gitignore or
#      enyo/build-ignore, so real-token *.local.js files get packaged unless excluded.
#      The palm-package call excludes them, and check-ipk-secrets.py then verifies the
#      finished .ipk (any *.local.* file fails the build; the service's blank
#      secrets.local.json placeholder passes only while its token fields are empty).
#
# Usage:  powershell -ExecutionPolicy Bypass -File deploy-jukie.ps1
#         add  -NoPackage   to skip the rebuild/repackage and just reinstall + reregister
#              whatever .ipk is already sitting here (matches the old scripts' behavior).
#         add  -SkipWebos2  to skip the webOS2/Pre2 jukie-drm cross-build (e.g. the
#              patched toolchain isn't set up on this machine) - webOS3/TouchPad playback
#              is unaffected either way; only webOS2-device full-track playback needs it.
#              A missing/failed webOS2 build is a WARN, not a hard failure, either way.

param(
    [switch]$NoPackage,
    [switch]$SkipWebos2
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$svc = 'com.achunt.jukie.service'

if (-not $NoPackage) {
    Write-Host "==> Building jukie-drm (webOS3/TouchPad, GOARM=7)..." -ForegroundColor Cyan
    Push-Location jukie-drm
    & powershell -ExecutionPolicy Bypass -File build.ps1 jukie-drm -Target webos3
    $webos3Exit = $LASTEXITCODE
    Pop-Location
    if ($webos3Exit -ne 0) { throw "jukie-drm webOS3 build failed" }
    Copy-Item -Force 'jukie-drm\build\jukie-drm-webos3' "$svc\jukie-drm-webos3"
    Write-Host "staged jukie-drm-webos3 (webOS3/TouchPad build) into the service dir" -ForegroundColor Cyan

    if (-not $SkipWebos2) {
        Write-Host "==> Building jukie-drm (webOS2/Pre2, GOARM=5, patched toolchain)..." -ForegroundColor Cyan
        Push-Location jukie-drm
        & powershell -ExecutionPolicy Bypass -File build.ps1 jukie-drm -Target webos2
        $webos2Exit = $LASTEXITCODE
        Pop-Location
        if ($webos2Exit -ne 0) {
            Write-Host "WARN: jukie-drm webOS2 build failed - continuing without it. webOS2 devices won't get full-track playback until it's built (see jukie-drm/goruntime-patch/FINDINGS.md)." -ForegroundColor Yellow
        } else {
            Copy-Item -Force 'jukie-drm\build\jukie-drm-webos2' "$svc\jukie-drm-webos2"
            Write-Host "staged jukie-drm-webos2 (webOS2/Pre2 build) into the service dir" -ForegroundColor Cyan
        }
    }

    # Android arm64 build for Lunacy phones (64-bit-only chips can't run the 32-bit webOS builds).
    Write-Host "==> Building jukie-drm (Android arm64, for Lunacy)..." -ForegroundColor Cyan
    Push-Location jukie-drm
    & powershell -ExecutionPolicy Bypass -File build.ps1 jukie-drm -Target android-arm64
    $androidExit = $LASTEXITCODE
    Pop-Location
    if ($androidExit -ne 0) {
        Write-Host "WARN: jukie-drm Android arm64 build failed - continuing without it. Lunacy phones won't get API/playback until it's built." -ForegroundColor Yellow
    } else {
        Copy-Item -Force 'jukie-drm\build\jukie-drm-android-arm64' "$svc\jukie-drm-android-arm64"
        Write-Host "staged jukie-drm-android-arm64 (Lunacy/arm64 build) into the service dir" -ForegroundColor Cyan
    }

    Remove-Item -Force 'com.achunt.jukie_*_all.ipk' -ErrorAction SilentlyContinue
    # --exclude: palm-package ignores .gitignore and enyo/build-ignore, so real-credential
    # *.local.js files (enyo/source/dev-token.local.js) would otherwise ship in the .ipk.
    & palm-package.bat '--exclude=*.local.js' com.achunt.jukie com.achunt.jukie.service com.achunt.jukie.package

    $drmBins = @('jukie-drm-webos3', 'jukie-drm-webos2', 'jukie-drm-android-arm64') | Where-Object { Test-Path "$svc\$_" }
    if ($drmBins.Count -gt 0) {
        $ipkForFix = Get-ChildItem 'com.achunt.jukie_*_all.ipk' | Select-Object -First 1
        & python fix-ipk-exec.py $ipkForFix.Name @drmBins
        if ($LASTEXITCODE -ne 0) { throw "fix-ipk-exec.py failed" }
    }
}

$ipk = Get-ChildItem 'com.achunt.jukie_*_all.ipk' | Select-Object -First 1

# Backstop for the --exclude above (and for -NoPackage): refuse to install, and delete the
# .ipk so it can't be shared by accident, if any *.local.* credential file is inside it.
& python check-ipk-secrets.py $ipk.Name
if ($LASTEXITCODE -ne 0) {
    Remove-Item -Force $ipk.Name
    throw "$($ipk.Name) contained local-only secret files and was deleted - see check-ipk-secrets output above"
}

& palm-install.bat $ipk.Name

& powershell -ExecutionPolicy Bypass -File post-install-jukie.ps1

Write-Host "`nDone. Launch with: palm-launch com.achunt.jukie" -ForegroundColor Green
