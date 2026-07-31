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

    Remove-Item -Force 'com.achunt.jukie_*_all.ipk' -ErrorAction SilentlyContinue
    & palm-package.bat com.achunt.jukie com.achunt.jukie.service com.achunt.jukie.package

    $drmBins = @('jukie-drm-webos3', 'jukie-drm-webos2') | Where-Object { Test-Path "$svc\$_" }
    if ($drmBins.Count -gt 0) {
        $ipkForFix = Get-ChildItem 'com.achunt.jukie_*_all.ipk' | Select-Object -First 1
        & python fix-ipk-exec.py $ipkForFix.Name @drmBins
        if ($LASTEXITCODE -ne 0) { throw "fix-ipk-exec.py failed" }
    }
}

$ipk = Get-ChildItem 'com.achunt.jukie_*_all.ipk' | Select-Object -First 1
& palm-install.bat $ipk.Name

& powershell -ExecutionPolicy Bypass -File post-install-jukie.ps1

Write-Host "`nDone. Launch with: palm-launch com.achunt.jukie" -ForegroundColor Green
