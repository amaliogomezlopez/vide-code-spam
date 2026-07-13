# Build the Electron desktop app for Windows.
# Run from the repository root in PowerShell after building the backend exe.
# NOTE: building the NSIS installer requires admin rights to extract winCodeSign.
#       This script builds a portable folder you can run directly.

param(
    [ValidateSet("CPU", "CUDA")]
    [string]$Variant = "CPU"
)

$ErrorActionPreference = "Stop"

$ROOT = $PSScriptRoot | Split-Path -Parent
Set-Location $ROOT\frontend

& "$ROOT\scripts\build-inserter.ps1"

npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed (exit $LASTEXITCODE)" }
npm run build
if ($LASTEXITCODE -ne 0) { throw "frontend build failed (exit $LASTEXITCODE)" }
npm run electron:compile
if ($LASTEXITCODE -ne 0) { throw "Electron TypeScript compile failed (exit $LASTEXITCODE)" }
$outputDir = "release/$Variant"
npx electron-builder "--config.directories.output=$outputDir" --dir
if ($LASTEXITCODE -ne 0) { throw "electron-builder failed (exit $LASTEXITCODE)" }

# Move the portable app to the project root for easy double-click usage.
$SOURCE = "$ROOT\frontend\release\$Variant\win-unpacked"
$TARGET = if ($Variant -eq "CUDA") { "$ROOT\VibeSpam-Portable-CUDA" } else { "$ROOT\VibeSpam-Portable" }
if (Test-Path $TARGET) {
    Remove-Item -Recurse -Force $TARGET
}
Move-Item -Path $SOURCE -Destination $TARGET

Write-Host "Portable $Variant app ready at: $TARGET\Vibe Spam.exe" -ForegroundColor Green
Write-Host "To create an NSIS installer, run as Administrator: npx electron-builder" -ForegroundColor Yellow
