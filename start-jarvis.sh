#!/usr/bin/env bash
# The macOS and Linux equivalent of START-JARVIS.bat.
set -euo pipefail
cd "$(dirname "$0")"

command -v node >/dev/null || {
  echo "Node.js isn't installed. Get it from https://nodejs.org/en/download"
  exit 1
}

[ -d node_modules ] || npm install
[ -f .next/BUILD_ID ] || npm run build

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

echo "Starting JARVIS. Ctrl-C here shuts it down."
exec npm run start
