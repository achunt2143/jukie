# Build the .ipk that is safe to PUBLISH (a GitHub release, an upload, a forum attachment).
#
# deploy-jukie.ps1 builds a PERSONAL package for your own devices: the service dir has to hold
# your device.wvd (the private Widevine device credential - never share it; leaked .wvd files get
# revoked) next to the compiled helpers, so that package contains it. This script packages a
# staged COPY of the three package dirs instead:
#   - device.wvd is left out (a user supplies their own - see jukie-drm/README.md),
#   - secrets.local.json is regenerated from yours with every token field blanked,
#   - *.local.* files (e.g. enyo/source/dev-token.local.js) are left out,
# then the same exec-bit fix-up as a normal deploy runs, and check-ipk-secrets.py --public must
# pass or the file is deleted. Your own working tree and device.wvd are never touched.
#
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File webOS-legacy\make-release-ipk.ps1
# Output:             webOS-legacy\release\com.achunt.jukie_<version>_all.ipk  (git-ignored: *.ipk)
#
# Needs the compiled helpers already staged in com.achunt.jukie.service\ (deploy-jukie.ps1 builds
# them; this script does not rebuild Go).

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$svc = 'com.achunt.jukie.service'
$bins = @('jukie-drm-webos3', 'jukie-drm-webos2', 'jukie-drm-android-arm64') | Where-Object { Test-Path "$svc\$_" }
if ($bins.Count -eq 0) { throw "no jukie-drm-* binaries in $svc - run deploy-jukie.ps1 first" }

$stage = Join-Path $env:TEMP 'jukie-release-stage'
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Path $stage | Out-Null

foreach ($d in @('com.achunt.jukie', 'com.achunt.jukie.service', 'com.achunt.jukie.package')) {
    # robocopy exit codes 0-7 are success/"files copied"; 8+ is a real failure.
    robocopy $d (Join-Path $stage $d) /E /XF device.wvd secrets.local.json *.local.* *.wvd /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed for $d (exit $LASTEXITCODE)" }
}

# Blank placeholder: the app pushes the user's tokens to the service on first launch.
$placeholder = Get-Content -Raw "$svc\secrets.local.json" | ConvertFrom-Json
foreach ($p in $placeholder.PSObject.Properties) {
    if (-not $p.Name.StartsWith('_') -and $p.Name -match 'token') { $p.Value = '' }
}
$placeholder | ConvertTo-Json | Set-Content -Encoding ASCII (Join-Path $stage "$svc\secrets.local.json")

Push-Location $stage
try {
    & palm-package.bat '--exclude=*.local.js' com.achunt.jukie com.achunt.jukie.service com.achunt.jukie.package
    $ipk = Get-ChildItem 'com.achunt.jukie_*_all.ipk' | Select-Object -First 1
    if (-not $ipk) { throw "palm-package produced no .ipk" }
    & py -3 (Join-Path $PSScriptRoot 'fix-ipk-exec.py') $ipk.Name @bins
    if ($LASTEXITCODE -ne 0) { throw "fix-ipk-exec.py failed" }
    & py -3 (Join-Path $PSScriptRoot 'check-ipk-secrets.py') --public $ipk.Name
    if ($LASTEXITCODE -ne 0) { throw "$($ipk.Name) failed the public secrets check - not releasing it" }
    New-Item -ItemType Directory -Force (Join-Path $PSScriptRoot 'release') | Out-Null
    Copy-Item -Force $ipk.FullName (Join-Path $PSScriptRoot 'release')
    Write-Host "`nRelease package: $(Join-Path $PSScriptRoot "release\$($ipk.Name)")" -ForegroundColor Green
} finally {
    Pop-Location
    Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
}
