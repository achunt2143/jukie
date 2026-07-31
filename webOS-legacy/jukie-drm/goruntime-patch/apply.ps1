# Builds a patched Go toolchain that can run on kernels older than Linux 2.6.27
# (webOS TouchPad and Pre2's custom kernels: 2.6.35 and 2.6.24 respectively).
#
# Modern Go's runtime and net package call several syscalls added in Linux
# 2.6.27 (epoll_create1, eventfd2, the combined SOCK_NONBLOCK|SOCK_CLOEXEC
# socket() flags) with no fallback, and Palm's Pre2 kernel additionally lacks
# epoll_pwait even though mainline added it earlier (2.6.19) - see FINDINGS.md
# in this directory for the full story and why patching the deps instead
# (go1.13, etc.) is a dead end.
#
# Usage:  powershell -ExecutionPolicy Bypass -File apply.ps1 [-Dest <path>]
#   Default -Dest is $env:USERPROFILE\sdk\go1.26-pre2
#
# Requires an existing Go installation to bootstrap from (uses whatever
# `go` is on PATH, or edit $bootstrap below) and a POSIX `diff`/`patch`
# (Git Bash's usr/bin, already on most Windows dev machines with Git).

param(
    [string]$Dest = "$env:USERPROFILE\sdk\go1.26-pre2"
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot

$bootstrapGo = (Get-Command go -ErrorAction SilentlyContinue).Source
if (-not $bootstrapGo) { throw "no 'go' on PATH to bootstrap from" }
$bootstrapRoot = (& $bootstrapGo env GOROOT)
Write-Host "Bootstrapping from $bootstrapRoot ($((& $bootstrapGo version)))"

if (Test-Path $Dest) { throw "$Dest already exists - remove it first or pick a different -Dest" }
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Write-Host "Copying GOROOT to $Dest ..."
robocopy $bootstrapRoot $Dest /E /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
# robocopy exit code 1 = files copied successfully, not an error

$patchExe = (Get-Command patch -ErrorAction SilentlyContinue).Source
if (-not $patchExe) { $patchExe = "C:\Program Files\Git\usr\bin\patch.exe" }
if (-not (Test-Path $patchExe)) { throw "no 'patch' binary found (expected Git Bash's usr/bin/patch.exe)" }

Write-Host "Applying patches..."
& $patchExe -p0 --binary -d $Dest -i "$here\netpoll_epoll.go.diff"
& $patchExe -p0 --binary -d $Dest -i "$here\defs_linux_arm.go.diff"
& $patchExe -p0 --binary -d $Dest -i "$here\sock_cloexec.go.diff"
Copy-Item "$here\sock_cloexec_linux.go.new" "$Dest\src\net\sock_cloexec_linux.go"

Write-Host "Self-building patched toolchain..."
$env:GOROOT_BOOTSTRAP = $bootstrapRoot
Push-Location "$Dest\src"
try {
    & .\make.bat
} finally {
    Pop-Location
    Remove-Item Env:\GOROOT_BOOTSTRAP -ErrorAction SilentlyContinue
}

Write-Host "`nDone. Cross-compile with:" -ForegroundColor Green
Write-Host "  `$env:GOOS='linux'; `$env:GOARCH='arm'; `$env:GOARM='5'; `$env:CGO_ENABLED='0'"
Write-Host "  & '$Dest\bin\go.exe' build -o jukie-drm-pre2 .\cmd\jukie-drm"
Write-Host "`nNote: the ARM syscall numbers are only added to defs_linux_arm.go." -ForegroundColor Yellow
Write-Host "Cross-compiling for other GOARCH targets with this toolchain will fail" -ForegroundColor Yellow
Write-Host "until the same constants are added to that arch's defs_linux_*.go." -ForegroundColor Yellow
