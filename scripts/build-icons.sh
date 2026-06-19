#!/bin/bash
#
# build-icons.sh — regenerate the Grimmia app icons from the artwork master.
#
# Input:  build/icon-source.png  — the master artwork (a green rounded-square
#         "moss cushion on a book" tile, generated art, on a WHITE background).
# Output (smooth 8-bit RGBA alpha):
#   build/icon.png        1024×1024 master raster (white made transparent)
#   build/icon-1024.png   copy of the master
#   build/icon.icns       macOS iconset (all required sizes, via iconutil)
#   build/icon.ico        Windows multi-resolution icon
#
# How the white is removed: a contiguous flood-fill from a corner with a fuzz
# tolerance turns the near-white background transparent while LEAVING the green
# tile and its soft drop shadow intact (the fill is connected-from-corner, so it
# can't bleed into the tile). The result is trimmed to the art, padded to a
# centered square, then downscaled.
#
# Requires: ImageMagick 7 (`magick`) and macOS `iconutil`.
# Idempotent: safe to re-run; overwrites the generated files in place.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/build"
SOURCE="$BUILD/icon-source.png"

MAGICK="/opt/homebrew/bin/magick"
command -v "$MAGICK" >/dev/null 2>&1 || MAGICK="magick"
command -v "$MAGICK" >/dev/null 2>&1 || { echo "[ERROR] ImageMagick (magick) not found" >&2; exit 1; }
[ -f "$SOURCE" ] || { echo "[ERROR] missing master artwork: $SOURCE" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Fuzz tolerance for the white flood-fill. ~12% removes the near-white paper and
# the lightest shadow halo without touching the green tile.
FUZZ=12%

echo "[INFO] removing white background (flood-fill, fuzz=${FUZZ})"
# Border 1px white so the corner seed always sits on background; floodfill that
# corner to transparent; shave the border back off; trim to the art.
"$MAGICK" "$SOURCE" \
  -alpha set -bordercolor white -border 1 \
  -fuzz ${FUZZ} -fill none -draw "alpha 0,0 floodfill" \
  -shave 1x1 \
  -trim +repage \
  "$TMP/trimmed.png"

echo "[INFO] padding to a centered square + downscaling to 1024 (8-bit alpha)"
SIDE="$("$MAGICK" identify -format "%[fx:max(w,h)]" "$TMP/trimmed.png")"
"$MAGICK" "$TMP/trimmed.png" \
  -background none -gravity center -extent "${SIDE}x${SIDE}" \
  -filter Lanczos -resize 1024x1024 -depth 8 "PNG32:$BUILD/icon.png"
command cp -f "$BUILD/icon.png" "$BUILD/icon-1024.png"

# --- macOS .icns -----------------------------------------------------------
echo "[INFO] building icon.icns"
ICONSET="$TMP/icon.iconset"
mkdir -p "$ICONSET"
gen() { # gen <size> <filename>
  "$MAGICK" "$BUILD/icon.png" -filter Lanczos -resize "${1}x${1}" \
    -depth 8 "PNG32:$ICONSET/$2"
}
gen 16   icon_16x16.png
gen 32   icon_16x16@2x.png
gen 32   icon_32x32.png
gen 64   icon_32x32@2x.png
gen 128  icon_128x128.png
gen 256  icon_128x128@2x.png
gen 256  icon_256x256.png
gen 512  icon_256x256@2x.png
gen 512  icon_512x512.png
gen 1024 icon_512x512@2x.png
iconutil -c icns "$ICONSET" -o "$BUILD/icon.icns"

# --- Windows .ico ----------------------------------------------------------
echo "[INFO] building icon.ico (multi-resolution)"
"$MAGICK" "$BUILD/icon.png" \
  -define icon:auto-resize=256,128,64,48,32,16 \
  -depth 8 "$BUILD/icon.ico"

echo "[INFO] done:"
ls -lh "$BUILD/icon.png" "$BUILD/icon.icns" "$BUILD/icon.ico"
