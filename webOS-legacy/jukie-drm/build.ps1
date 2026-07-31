# Cross-compile a jukie-drm command for a webOS version target.
#
# Usage:  powershell -ExecutionPolicy Bypass -File build.ps1 [cmdName] [-Target webos2|webos3]
#   cmdName defaults to "smoke" -> builds .\cmd\<cmdName>
#   -Target defaults to "webos3"
#
# Two webOS generations need DIFFERENT toolchains/settings (see goruntime-patch\FINDINGS.md
# for the full story) - this script does NOT guess which one you want, so always pass
# -Target explicitly for anything that gets deployed to a device:
#
#   webos3: webOS 3.x (TouchPad; kernel 2.6.35+, VFPv3 hardware float). The STANDARD
#           on-PATH Go toolchain, GOARM=7. This is the original, long-confirmed-working
#           build.
#   webos2: webOS 2.x (Pre2 and other older phones; kernel < 2.6.27, no VFPv3 FPU). Stock
#           Go's runtime calls syscalls that don't exist on that kernel, so this REQUIRES
#           the patched toolchain built by goruntime-patch\apply.ps1 (default
#           $env:USERPROFILE\sdk\go1.26-pre2), plus GOARM=5 (software float).
#
# For the jukie-drm command specifically, output goes to build\jukie-drm-<target> (e.g.
# build\jukie-drm-webos3, build\jukie-drm-webos2) so BOTH webOS-version builds can coexist
# on disk without clobbering each other. Other commands (smoke/auth/manifest) keep their
# plain build\jukie-<cmd> name regardless of -Target, since only jukie-drm is currently
# built for more than one webOS version.
#
# Named for the webOS version, not the device codename, because that's the axis the
# unified Jukie package actually picks on at runtime (see com.achunt.jukie.service's
# JukieAudioService.js, which now ships both binaries and self-selects) - "webos2"/
# "webos3" reads directly next to that logic; "pre2"/"touchpad" would not.
#
# deploy-jukie.ps1 builds BOTH targets and ships both binaries in the service package
# (no more picking one at packaging time) - see that script for the up-to-date staging
# step. (Historical note: before this, deploy-jukie.ps1 and deploy-jukie-mojo.ps1 each
# staged the ONE binary they needed into a single shared jukie-drm slot, and whichever
# deploy script ran last decided what was sitting there - a 2026-07-29 incident deployed
# a Pre2 build to a TouchPad this way. Shipping both binaries removes that failure mode
# entirely.)

param(
    [string]$Cmd = "smoke",
    [ValidateSet("webos2", "webos3")]
    [string]$Target = "webos3"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if ($Target -eq "webos2") {
    $go = "$env:USERPROFILE\sdk\go1.26-pre2\bin\go.exe"
    if (-not (Test-Path $go)) {
        throw "Patched webOS2 Go toolchain not found at $go - build it first with goruntime-patch\apply.ps1 (see goruntime-patch\FINDINGS.md)."
    }
    $env:GOARM = "5"  # webOS2-era CPUs (e.g. Pre2) have no VFPv3 hardware float unit
} else {
    $go = @("$env:ProgramFiles\Go\bin\go.exe", "$env:LOCALAPPDATA\Programs\Go\bin\go.exe") |
        Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $go) { throw "go.exe not found - install Go (winget install GoLang.Go)" }
    $env:GOARM = "7"
}

$env:GOOS = "linux"; $env:GOARCH = "arm"; $env:CGO_ENABLED = "0"

New-Item -ItemType Directory -Force -Path build | Out-Null
$out = if ($Cmd -eq "jukie-drm") { "build\jukie-drm-$Target" } else { "build\jukie-$Cmd" }
& $go build -trimpath -ldflags "-s -w" -o $out ".\cmd\$Cmd"
if ($LASTEXITCODE -ne 0) { throw "build failed" }

Get-Item $out | Select-Object Name, @{n="KB";e={[int]($_.Length/1KB)}}
Write-Host "built $out for linux/arm (GOARM=$($env:GOARM), $Target toolchain)" -ForegroundColor Green
