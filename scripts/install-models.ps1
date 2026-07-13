# Download and warm up local STT models for the current user.
# Run from the repository root after scripts/setup.ps1.

$ErrorActionPreference = "Stop"
$ROOT = $PSScriptRoot | Split-Path -Parent
$PYTHON = "$ROOT\backend\.venv\Scripts\python.exe"

if (-not (Test-Path $PYTHON)) {
    throw "Python virtualenv not found. Run .\scripts\setup.ps1 first."
}

Set-Location $ROOT
& $PYTHON -m backend.app.tools.install_models
if ($LASTEXITCODE -ne 0) { throw "model installation failed (exit $LASTEXITCODE)" }
