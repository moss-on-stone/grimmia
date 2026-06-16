#!/bin/bash
#
# screenshot.sh — capture the IA Desktop window to a PNG, headless.
#
# Launches the app with --screenshot, waits for it to write the file and quit,
# then prints the path. Lets a developer/agent verify the real rendered UI
# without a human taking screenshots.
#
# Usage:
#   scripts/screenshot.sh [output.png]
#
# Default output: ./screenshots/app-<timestamp>.png
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT="${1:-}"
if [ -z "$OUT" ]; then
  mkdir -p screenshots
  TS="$(date +%Y%m%d-%H%M%S)"
  OUT="$ROOT/screenshots/app-$TS.png"
fi

# Make path absolute.
case "$OUT" in
  /*) : ;;
  *) OUT="$ROOT/$OUT" ;;
esac

echo "[INFO] capturing IA Desktop window -> $OUT"
# 30s ceiling so it can never hang the caller.
# --dev is required: the screenshot file-write is gated behind dev mode so it
# cannot be abused in a packaged production build (H3).
gtimeout 30 ./node_modules/.bin/electron . --dev "--screenshot=$OUT" >/dev/null 2>&1 || true

if [ -f "$OUT" ]; then
  echo "[INFO] saved: $OUT"
  echo "$OUT"
else
  echo "[ERROR] screenshot was not created" >&2
  exit 1
fi
