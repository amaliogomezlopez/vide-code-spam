# Build the Python backend as a portable PyInstaller directory.
# Run from the repository root in PowerShell.

param([switch]$Cuda)

$ErrorActionPreference = "Stop"

$ROOT = $PSScriptRoot | Split-Path -Parent
Set-Location $ROOT

$PYINST = "$ROOT\backend\.venv\Scripts\pyinstaller.exe"
$BACKEND_DIST = "$ROOT\frontend\backend-dist"
$BACKEND_BUILD_DIST = "$ROOT\frontend\backend-dist-build"
if (-not (Test-Path $PYINST)) {
    Write-Host "PyInstaller not found in venv. Install it first:" -ForegroundColor Red
    Write-Host "  .\backend\.venv\Scripts\pip.exe install pyinstaller" -ForegroundColor Red
    exit 1
}

if (Test-Path $BACKEND_DIST) {
    Remove-Item -Recurse -Force $BACKEND_DIST
}
if (Test-Path $BACKEND_BUILD_DIST) {
    Remove-Item -Recurse -Force $BACKEND_BUILD_DIST
}

$CUDA_ARGS = @()
if ($Cuda) {
  $CUDA_ARGS = @('--collect-all', 'nvidia')
}

& $PYINST `
  --clean `
  --noconfirm `
  --onedir `
  --name vibe-spam-backend `
  --distpath frontend/backend-dist-build `
  --specpath build `
  --paths $ROOT `
  --collect-submodules backend.app `
  --collect-binaries winpty `
  --collect-data winpty `
  --collect-all ctranslate2 `
  @CUDA_ARGS `
  --collect-all faster_whisper `
  --hidden-import backend.app.main `
  backend/run.py

$BUILT_DIR = "$BACKEND_BUILD_DIST\vibe-spam-backend"
if (-not (Test-Path "$BUILT_DIR\vibe-spam-backend.exe")) {
    throw "PyInstaller did not produce vibe-spam-backend.exe"
}

$moved = $false
for ($attempt = 1; $attempt -le 8; $attempt++) {
    try {
        Move-Item -Path $BUILT_DIR -Destination $BACKEND_DIST -ErrorAction Stop
        $moved = $true
        break
    } catch {
        if ($attempt -eq 8) {
            throw
        }
        Write-Host "Move failed because a generated file is still locked; retrying ($attempt/8)..." -ForegroundColor Yellow
        Start-Sleep -Milliseconds 750
    }
}

if (-not $moved) {
    throw "Could not move backend build output to frontend/backend-dist"
}
Remove-Item -Recurse -Force $BACKEND_BUILD_DIST

if ($Cuda) {
    Set-Content -LiteralPath "$BACKEND_DIST\cuda-build.marker" -Value "cuda" -Encoding ascii
}

Write-Host "Backend executable built at frontend/backend-dist/vibe-spam-backend.exe" -ForegroundColor Green
