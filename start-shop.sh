#!/usr/bin/env bash
# The webshop.
#
# Same server as Axis — the shop is a room inside it, at /shop rather than at
# the front door. Running start-axis.sh opens Axis and never shows the shop,
# which is the wrong first impression to hand a customer.
set -euo pipefail
cd "$(dirname "$0")"

echo
echo "  A U R E A  —  Trade Portal"
echo "  Access code: camilla"
echo

export OPEN_URL="http://127.0.0.1:3000/shop"
exec ./start-axis.sh
