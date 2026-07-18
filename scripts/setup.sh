#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."

echo "[1/4] Creating Python virtualenv and installing backend deps..."
VIBE_SPAM_PYTHON_BIN="${VIBE_SPAM_PYTHON:-}"
if [ -z "$VIBE_SPAM_PYTHON_BIN" ]; then
    for candidate in python3.12 python3.11 python3; do
        if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; raise SystemExit(not ((3, 11) <= sys.version_info[:2] < (3, 13)))'; then
            VIBE_SPAM_PYTHON_BIN="$(command -v "$candidate")"
            break
        fi
    done
fi
if [ -z "$VIBE_SPAM_PYTHON_BIN" ] || ! "$VIBE_SPAM_PYTHON_BIN" -c 'import sys; raise SystemExit(not ((3, 11) <= sys.version_info[:2] < (3, 13)))' >/dev/null 2>&1; then
    echo "Python 3.11 or 3.12 is required. On macOS: brew install python@3.12" >&2
    echo "You can also set VIBE_SPAM_PYTHON=/full/path/to/python3.12" >&2
    exit 1
fi
VIBE_SPAM_VENV_PYTHON="$ROOT/backend/.venv/bin/python"
"$VIBE_SPAM_PYTHON_BIN" -m venv "$ROOT/backend/.venv"
"$VIBE_SPAM_VENV_PYTHON" -m pip install --upgrade pip
"$VIBE_SPAM_VENV_PYTHON" -m pip install -r "$ROOT/backend/requirements.txt"

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
"$VIBE_SPAM_VENV_PYTHON" -m backend.app.tools.install_models

echo "Done. Run:"
echo "  source backend/.venv/bin/activate && uvicorn backend.app.main:app --reload"
echo "  cd frontend && npm run dev"
