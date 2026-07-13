#!/usr/bin/env bash
set -euo pipefail

# Build the Electron desktop app for macOS/Linux.
# Run from the repository root after building the backend exe.

cd frontend
npm ci
npm run build
npm run electron:pack
cd ..

echo "Electron release artifacts built in frontend/release/"
