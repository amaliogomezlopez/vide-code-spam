#!/usr/bin/env bash
set -euo pipefail

# Download and warm up local STT models for the current user.
# Run from the repository root after scripts/setup.sh.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
PYTHON="$ROOT/backend/.venv/bin/python"

if [ ! -x "$PYTHON" ]; then
    echo "Python virtualenv not found. Run ./scripts/setup.sh first."
    exit 1
fi

cd "$ROOT"
"$PYTHON" -m backend.app.tools.install_models
