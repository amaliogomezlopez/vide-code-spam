# Build a Windows NSIS installer and portable package.
# Run from the repository root in PowerShell.

param(
    [switch]$Cuda,
    [switch]$AllowUnsigned
)

$ErrorActionPreference = "Stop"

$ROOT = $PSScriptRoot | Split-Path -Parent
$variant = if ($Cuda) { "CUDA" } else { "CPU" }

Write-Host "[1/2] Building packaged backend..." -ForegroundColor Cyan
& "$ROOT\scripts\build-backend-exe.ps1" -Cuda:$Cuda

Write-Host "[2/2] Building Electron installer and portable package..." -ForegroundColor Cyan
& "$ROOT\scripts\build-inserter.ps1"
Set-Location "$ROOT\frontend"
$releaseDir = "$ROOT\frontend\release\$variant"
if (Test-Path $releaseDir) {
    Remove-Item -Recurse -Force $releaseDir
}
npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed (exit $LASTEXITCODE)" }
npm run build
if ($LASTEXITCODE -ne 0) { throw "frontend build failed (exit $LASTEXITCODE)" }
npm run electron:compile
if ($LASTEXITCODE -ne 0) { throw "Electron TypeScript compile failed (exit $LASTEXITCODE)" }

$oldTemp = $env:TEMP
$oldTmp = $env:TMP
$nsisTemp = "$ROOT\tmp\nsis"
New-Item -ItemType Directory -Force -Path $nsisTemp | Out-Null
try {
    $env:TEMP = $nsisTemp
    $env:TMP = $nsisTemp
    $installerName = '${productName}-Setup-${version}-' + $variant + '-${arch}.${ext}'
    npx electron-builder "--config.directories.output=release/$variant" "--config.artifactName=$installerName" --win nsis
    if ($LASTEXITCODE -ne 0) { throw "electron-builder NSIS release failed (exit $LASTEXITCODE)" }
    $portableName = '${productName}-Portable-${version}-' + $variant + '-${arch}.${ext}'
    npx electron-builder "--config.directories.output=release/$variant" "--config.artifactName=$portableName" --win portable
    if ($LASTEXITCODE -ne 0) { throw "electron-builder portable release failed (exit $LASTEXITCODE)" }
} finally {
    $env:TEMP = $oldTemp
    $env:TMP = $oldTmp
}

if (-not $AllowUnsigned) {
    $artifacts = Get-ChildItem "$ROOT\frontend\release\$variant" -Filter "*.exe" -File
    $invalid = $artifacts | Where-Object {
        (Get-AuthenticodeSignature -LiteralPath $_.FullName).Status -ne "Valid"
    }
    if ($invalid) {
        throw "Unsigned release artifacts detected. Configure CSC_LINK/CSC_KEY_PASSWORD or use -AllowUnsigned only for local testing."
    }
}

Write-Host "Windows $variant release artifacts are in frontend/release/$variant/" -ForegroundColor Green
Write-Host "The model is not committed or bundled; it downloads on first launch or via scripts/install-models.ps1." -ForegroundColor Yellow
