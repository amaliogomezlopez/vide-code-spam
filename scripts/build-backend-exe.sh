#!/usr/bin/env bash
set -euo pipefail

# Build the Python backend as a portable PyInstaller directory.
# Run from the repository root.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
PYINSTALLER="$ROOT/backend/.venv/bin/pyinstaller"
BACKEND_DIST="$ROOT/frontend/backend-dist"
BACKEND_BUILD_DIST="$ROOT/frontend/backend-dist-build"

# PyInstaller defaults to ~/Library/Application Support on macOS. A disposable
# cache keeps builds reproducible in CI/sandboxes and avoids polluting user data.
if [ -z "${PYINSTALLER_CONFIG_DIR:-}" ]; then
    VIBE_SPAM_PYINSTALLER_CACHE="$(mktemp -d "${TMPDIR:-/tmp}/vibe-spam-pyinstaller.XXXXXX")"
    export PYINSTALLER_CONFIG_DIR="$VIBE_SPAM_PYINSTALLER_CACHE"
    trap 'rm -rf "$VIBE_SPAM_PYINSTALLER_CACHE"' EXIT
fi

if [ ! -x "$PYINSTALLER" ]; then
    if command -v pyinstaller &>/dev/null; then
        PYINSTALLER="$(command -v pyinstaller)"
    else
        echo "PyInstaller not found. Install it first:"
        echo "  $ROOT/backend/.venv/bin/pip install pyinstaller"
        exit 1
    fi
fi

rm -rf "$BACKEND_DIST" "$BACKEND_BUILD_DIST"

cd "$ROOT"
VIBE_SPAM_PYINSTALLER_ARGS=(
  --clean
  --noconfirm
  --onedir
  --name vibe-spam-backend
  --distpath frontend/backend-dist-build
  --specpath build
  --paths "$ROOT"
  --collect-submodules backend.app
  --collect-all ctranslate2
)
if [ "${VIBE_SPAM_CUDA_BUILD:-0}" = "1" ]; then
  VIBE_SPAM_PYINSTALLER_ARGS+=(--collect-all nvidia)
fi
"$PYINSTALLER" \
  "${VIBE_SPAM_PYINSTALLER_ARGS[@]}" \
  --collect-all faster_whisper \
  --hidden-import backend.app.main \
  backend/run.py

BUILT_DIR="$BACKEND_BUILD_DIST/vibe-spam-backend"
if [ ! -x "$BUILT_DIR/vibe-spam-backend" ]; then
    echo "PyInstaller did not produce vibe-spam-backend"
    exit 1
fi

mv "$BUILT_DIR" "$BACKEND_DIST"
rm -rf "$BACKEND_BUILD_DIST"

echo "Backend executable built at frontend/backend-dist/vibe-spam-backend"
