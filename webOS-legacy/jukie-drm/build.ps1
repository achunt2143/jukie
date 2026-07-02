# Cross-compile a jukie-drm command for the TouchPad (ARMv7, fully static, no glibc).
#
# Usage:  powershell -ExecutionPolicy Bypass -File build.ps1 [cmdName]
#   cmdName defaults to "smoke" -> builds .\cmd\smoke into .\build\jukie-<cmdName>
#
# The static-ARMv7 + CGO_ENABLED=0 combo is what lets the binary run on the
# TouchPad's 2.6.35 kernel inside the service jail with zero dependencies.

param([string]$Cmd = "smoke")

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$go = @("$env:ProgramFiles\Go\bin\go.exe", "$env:LOCALAPPDATA\Programs\Go\bin\go.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $go) { throw "go.exe not found - install Go (winget install GoLang.Go)" }

$env:GOOS = "linux"; $env:GOARCH = "arm"; $env:GOARM = "7"; $env:CGO_ENABLED = "0"

New-Item -ItemType Directory -Force -Path build | Out-Null
$out = "build\jukie-$Cmd"
& $go build -trimpath -ldflags "-s -w" -o $out ".\cmd\$Cmd"
if ($LASTEXITCODE -ne 0) { throw "build failed" }

Get-Item $out | Select-Object Name, @{n="KB";e={[int]($_.Length/1KB)}}
Write-Host "built $out for linux/arm (GOARM=7, static)" -ForegroundColor Green
