#!/bin/bash
# Axis on your phone, over your own Wi-Fi.
#
# The Windows version of this spends most of its length fighting Windows
# Firewall. macOS has no equivalent fight: the firewall is off by default, and
# when it is on it asks you once, in a dialog, with a button marked Allow. So
# this is the same script with that whole section replaced by one sentence.

set -u
cd "$(dirname "$0")" || exit 1

echo
echo "  Axis on your phone"
echo "  ------------------"
echo
echo "  This serves Axis to your own Wi-Fi so your phone can reach it."
echo "  Leave this window open while you use it."
echo

if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js isn't installed. Opening the download page."
  open "https://nodejs.org/en/download" 2>/dev/null
  read -r -p "  Press return to close. " _
  exit 1
fi

mkdir -p data

fail() {
  echo
  echo "  That didn't work. Here are the last lines of what it said:"
  echo
  tail -n 20 "data/last-run.log" 2>/dev/null
  echo
  echo "  The whole of it is in:  data/last-run.log"
  echo
  read -r -p "  Press return to close. " _
  exit 1
}

stamp="data/.deps-stamp"
want="$(shasum -a 256 package-lock.json 2>/dev/null | cut -d' ' -f1)"
have="$(cat "$stamp" 2>/dev/null || true)"

if [ ! -d node_modules ] || [ -z "$want" ] || [ "$want" != "$have" ]; then
  echo "  Getting what Axis needs. This can take five minutes the first time."
  echo
  echo "  >> Do not close this window. It looks frozen while it works."
  echo
  npm install > "data/last-run.log" 2>&1 || fail
  printf '%s' "$want" > "$stamp"
  rm -f .next/BUILD_ID
  echo "  Done."
  echo
fi

needs_build=0
if [ ! -f .next/BUILD_ID ]; then
  needs_build=1
elif [ -n "$(find src public package.json next.config.ts -newer .next/BUILD_ID 2>/dev/null | head -n 1)" ]; then
  needs_build=1
fi

if [ "$needs_build" -eq 1 ]; then
  echo "  Preparing Axis. Two to five minutes, with nothing on screen."
  echo
  echo "  >> Do not close this window. This is the slow bit."
  echo
  npm run build > "data/last-run.log" 2>&1 || fail
  echo "  Ready."
  echo
fi

echo "  If macOS asks whether to allow incoming connections, click Allow."
echo "  Without it your phone cannot reach this Mac."
echo

node scripts/phone-server.mjs
echo
echo "  Axis has stopped."
read -r -p "  Press return to close. " _
