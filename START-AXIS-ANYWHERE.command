#!/bin/bash
# Axis on the open internet, for as long as this window is open.
#
# Same as the Windows version, with one real difference: Cloudflare ships the
# Mac build as a tarball rather than a bare executable, and there are two of
# them - one for Apple Silicon, one for the older Intel Macs. Which one you
# need is decided below by asking the Mac, not by asking you.

set -u
cd "$(dirname "$0")" || exit 1

echo
echo "  Axis, from anywhere"
echo "  -------------------"
echo
echo "  This gives Axis a web address that works from any phone, on any"
echo "  network, anywhere in the world. Leave this window open while you"
echo "  are away - closing it takes him off the internet."
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

# ---------------------------------------------------------------------------
# cloudflared makes the tunnel. One file from Cloudflare, kept in this folder,
# so nothing is installed system-wide and deleting the folder takes it with you.
# ---------------------------------------------------------------------------
if [ ! -x "data/cloudflared" ]; then
  # arm64 on Apple Silicon, x86_64 on the Intel Macs. uname knows which.
  case "$(uname -m)" in
    arm64) arch="arm64" ;;
    *)     arch="amd64" ;;
  esac

  echo "  Getting the tunnel program from Cloudflare, once ($arch)..."
  echo

  url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-$arch.tgz"
  if ! curl -fsSL "$url" -o "data/cloudflared.tgz"; then
    echo "  That download failed. Check your internet connection and try again."
    echo
    read -r -p "  Press return to close. " _
    exit 1
  fi

  tar xzf "data/cloudflared.tgz" -C data || fail
  rm -f "data/cloudflared.tgz"
  chmod +x "data/cloudflared"

  # Downloaded files are quarantined by macOS, which otherwise refuses to run
  # this with a dialog about an unidentified developer. It came from
  # Cloudflare's own release page over HTTPS a second ago.
  xattr -d com.apple.quarantine "data/cloudflared" 2>/dev/null || true
fi

# Start Axis itself in the background, then tunnel to it.
npm run start > "data/last-run.log" 2>&1 &
engine=$!
# However this window ends - Ctrl-C, closing it, an error - the engine goes too,
# rather than being left holding port 3000 against the next run.
trap 'kill "$engine" 2>/dev/null' EXIT INT TERM

echo "  Starting Axis and opening the tunnel. This takes a few seconds."
echo

node scripts/anywhere.mjs

echo
echo "  Axis is off the internet again."
read -r -p "  Press return to close. " _
