#!/bin/bash
# Axis, on a Mac.
#
# The .command extension is what makes this double-clickable in Finder. It is
# an ordinary shell script; nothing here needs Homebrew, Xcode, or a password.
#
# Everything below mirrors START-AXIS.bat one for one, so the two platforms
# behave the same and neither drifts. Your settings and memories live in the
# data folder and are never touched by any of this.

set -u
cd "$(dirname "$0")" || exit 1

echo
echo "  A X I S"
echo "  -------"
echo

# Node is the only thing Axis needs that macOS doesn't ship with.
if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js isn't installed on this Mac."
  echo "  Opening the download page - install it, then run this again."
  echo
  echo "  Take the button marked LTS, and the .pkg installer. It asks no"
  echo "  questions worth thinking about."
  echo
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

# node_modules existing is not the same as it being up to date: after an update
# adds a library the folder is still there and the library isn't, and the
# failure lands somewhere unrelated. So the lockfile is fingerprinted.
stamp="data/.deps-stamp"
want="$(shasum -a 256 package-lock.json 2>/dev/null | cut -d' ' -f1)"
have="$(cat "$stamp" 2>/dev/null || true)"

if [ ! -d node_modules ] || [ -z "$want" ] || [ "$want" != "$have" ]; then
  echo "  Getting what Axis needs. This is a few hundred files, so on a slow"
  echo "  connection it can take five minutes or more."
  echo
  echo "  >> Do not close this window. It looks frozen while it works."
  echo
  npm install > "data/last-run.log" 2>&1 || fail
  printf '%s' "$want" > "$stamp"
  rm -f .next/BUILD_ID
  echo "  Done."
  echo
fi

# Build only when something actually changed, rather than on every start.
needs_build=0
if [ ! -f .next/BUILD_ID ]; then
  needs_build=1
elif [ -n "$(find src public package.json next.config.ts -newer .next/BUILD_ID 2>/dev/null | head -n 1)" ]; then
  needs_build=1
fi

if [ "$needs_build" -eq 1 ]; then
  echo "  Preparing Axis. This happens after an update, not every time,"
  echo "  and it takes two to five minutes with nothing on screen."
  echo
  echo "  >> Do not close this window. This is the slow bit."
  echo
  npm run build > "data/last-run.log" 2>&1 || fail
  echo "  Ready."
  echo
fi

echo "  Axis is starting. Your browser will open in a moment."
echo "  Leave this window open - closing it stops him."
echo

# Open the browser once the server is actually answering, rather than at a
# guessed moment that lands on a connection error half the time.
( for _ in $(seq 1 60); do
    if curl -s -o /dev/null "http://127.0.0.1:3000"; then
      open "http://127.0.0.1:3000"
      break
    fi
    sleep 1
  done ) &
opener=$!

npm run start

# Stop waiting for a server that has gone. Without this, a start that fails
# immediately leaves this window polling for a full minute and then opening a
# browser onto nothing.
kill "$opener" 2>/dev/null

echo
echo "  Axis has stopped."
read -r -p "  Press return to close. " _
