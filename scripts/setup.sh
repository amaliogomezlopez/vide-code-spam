#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."

echo "[1/4] Creating Python virtualenv and installing backend deps..."
PYTHON="$ROOT/backend/.venv/bin/python"
python -m venv "$ROOT/backend/.venv"
"$PYTHON" -m pip install --upgrade pip
"$PYTHON" -m pip install -r "$ROOT/backend/requirements.txt"

echo "[2/4] Installing frontend deps..."
cd "$ROOT/frontend"
npm ci

echo "[3/4] Copying env example..."
cd "$ROOT"
if [ ! -f .env ]; then
    cp .env.example .env
    echo ".env created from .env.example"
fi

echo "[4/4] Downloading and warming up Whisper model..."
"$PYTHON" -m backend.app.tools.install_models

echo "Done. Run:"
echo "  source backend/.venv/bin/activate && uvicorn backend.app.main:app --reload"
echo "  cd frontend && npm run dev"
