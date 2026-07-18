#!/usr/bin/env bash
set -euo pipefail

# Build the Electron desktop app for macOS/Linux.
# Run from the repository root after building the backend exe.

cd frontend
npm ci
npm run build
if [ "$(uname -s)" = "Darwin" ] && \
   [ -z "${CSC_LINK:-}" ] && \
   [ -z "${CSC_NAME:-}" ] && \
   [ "${VIBE_SPAM_MAC_SIGNING:-adhoc}" != "auto" ]; then
  # A random development certificate discovered in the login keychain is not
  # a reproducible distribution identity and can leave local builds invalid.
  # Use explicit ad-hoc signing unless release credentials (or an intentional
  # keychain auto-discovery override) are provided.
  npm run electron:pack -- --config.mac.identity=- --config.mac.hardenedRuntime=false
else
  npm run electron:pack
fi
cd ..

echo "Electron release artifacts built in frontend/release/"
