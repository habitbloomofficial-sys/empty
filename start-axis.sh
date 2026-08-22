#!/usr/bin/env bash
# The macOS and Linux equivalent of START-Axis.bat.
set -euo pipefail
cd "$(dirname "$0")"

command -v node >/dev/null || {
  echo "Node.js isn't installed. Get it from https://nodejs.org/en/download"
  exit 1
}

mkdir -p data

# Install when the lock file has changed since the last successful install —
# not merely when node_modules is absent. A folder that exists but predates a
# new dependency is exactly how a build fails on something you never touched.
lock_hash=$(sha256sum package-lock.json | cut -d" " -f1)
if [ ! -d node_modules ] || [ "$(cat data/.deps-stamp 2>/dev/null)" != "$lock_hash" ]; then
  echo "Getting what Axis needs..."
  npm install
  echo "$lock_hash" > data/.deps-stamp
  rm -f .next/BUILD_ID
fi

# Rebuild when anything has changed since the last build.
if [ ! -f .next/BUILD_ID ] || [ -n "$(find src public package.json next.config.ts -newer .next/BUILD_ID 2>/dev/null | head -1)" ]; then
  echo "Preparing Axis..."
  npm run build
fi

# Already running? Use that one rather than failing to take the port.
if curl -sf -o /dev/null http://127.0.0.1:3000; then
  echo "Axis is already running - opening it."
  (xdg-open http://127.0.0.1:3000 2>/dev/null || open http://127.0.0.1:3000 2>/dev/null) &
  exit 0
fi

# Open the browser once the server answers, not before.
(
  for _ in $(seq 1 120); do
    if curl -sf -o /dev/null http://127.0.0.1:3000; then
      (xdg-open http://127.0.0.1:3000 2>/dev/null || open http://127.0.0.1:3000 2>/dev/null) &
      break
    fi
    sleep 0.5
  done
) &

echo "Starting Axis. Ctrl-C here shuts it down."
exec npm run start
