# One-time setup for Windows.
# Run from the repository root in PowerShell.

$ErrorActionPreference = "Stop"
$ROOT = $PSScriptRoot | Split-Path -Parent

Write-Host "[1/4] Creating Python virtualenv and installing backend deps..." -ForegroundColor Cyan
Set-Location $ROOT\backend
python -m venv .venv
if ($LASTEXITCODE -ne 0) { throw "venv creation failed (exit $LASTEXITCODE)" }
& .venv\Scripts\pip.exe install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed (exit $LASTEXITCODE)" }
& .venv\Scripts\pip.exe install -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw "backend dependency install failed (exit $LASTEXITCODE)" }

Write-Host "[2/4] Installing frontend deps..." -ForegroundColor Cyan
Set-Location $ROOT\frontend
npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed (exit $LASTEXITCODE)" }

Write-Host "[3/4] Copying env example..." -ForegroundColor Cyan
Set-Location $ROOT
if (-not (Test-Path .env)) {
    Copy-Item .env.example .env
    Write-Host ".env created from .env.example"
}

Write-Host "[4/4] Downloading and warming up Whisper model (first run may take a while)..." -ForegroundColor Cyan
& $ROOT\backend\.venv\Scripts\python.exe -m backend.app.tools.install_models
if ($LASTEXITCODE -ne 0) { throw "model installation failed (exit $LASTEXITCODE)" }

Write-Host "Done. Run:`n  .\backend\.venv\Scripts\Activate.ps1; uvicorn backend.app.main:app --reload`n  cd frontend; npm run dev" -ForegroundColor Green
