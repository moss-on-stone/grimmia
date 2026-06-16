#!/bin/bash
#
# build-icons.sh — regenerate the app icons.
#
# Builds the icon entirely with ImageMagick primitives (a blue→purple gradient
# masked to a continuous-corner rounded rect, with a white "IA" wordmark),
# SUPERSAMPLED at 4× then downscaled — which yields smooth 8-bit anti-aliased
# alpha. The previous PNG had 1-bit (binary) alpha, whose aliased rounded
# corners read as a harsh dark "boundary"; this fixes that and brings the icon
# in line with current Apple/Windows recommendations (smooth edges, no border,
# proper rounded macOS tile, full-bleed-square-safe for Windows).
#
# Outputs (with smooth 8-bit alpha):
#   build/icon.png        1024×1024 master raster (full-color RGBA)
#   build/icon-1024.png   copy of the master
#   build/icon.icns       macOS iconset (all required sizes, via iconutil)
#   build/icon.ico        Windows multi-resolution icon
#
# Requires: ImageMagick 7 (`magick`) and macOS `iconutil`.
# Idempotent: safe to re-run; overwrites the generated files in place.
#
# NOTE: ImageMagick's built-in SVG renderer does NOT honor the gradient in
# build/icon.svg (it rasterizes the tile as solid black). icon.svg is kept as
# the human-readable design reference ONLY; this script does not use it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/build"

MAGICK="/opt/homebrew/bin/magick"
command -v "$MAGICK" >/dev/null 2>&1 || MAGICK="magick"
command -v "$MAGICK" >/dev/null 2>&1 || { echo "[ERROR] ImageMagick (magick) not found" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Supersample factor: design coords are in 1024 space; we render at 4× = 4096
# then downscale to 1024 so all edges (rounded corners, letters) anti-alias.
SS=4096
GRAD_TOP="#5B7CFA"
GRAD_BOTTOM="#8A6CF6"

echo "[INFO] rendering supersampled master (${SS}px → 1024px, 8-bit alpha)"

# 1) vertical gradient
"$MAGICK" -size ${SS}x${SS} gradient:"${GRAD_TOP}-${GRAD_BOTTOM}" "$TMP/g.png"

# 2) rounded-rect alpha mask. 1024-space inset 70 / corner 198 → ×4.
"$MAGICK" -size ${SS}x${SS} xc:none -fill white \
  -draw "roundrectangle 280,280 3812,3812 792,792" "$TMP/m.png"

# 3) gradient tile = gradient with the rounded-rect as its alpha
"$MAGICK" "$TMP/g.png" "$TMP/m.png" -alpha off -compose CopyOpacity -composite "$TMP/tile.png"

# 4) white "IA" wordmark (coords are 1024-space ×4)
#    I: rect 318,300→404,724 ; A: outer polygon ; counter: inner triangle
"$MAGICK" -size ${SS}x${SS} xc:none -fill white \
  -draw "rectangle 1272,1200 1616,2896" \
  -draw "path 'M 2240 1200 L 2528 1200 L 3040 2896 L 2688 2896 L 2592 2552 L 2176 2552 L 2080 2896 L 1728 2896 Z'" \
  "$TMP/letters.png"
"$MAGICK" -size ${SS}x${SS} xc:none -fill white \
  -draw "path 'M 2384 1632 L 2264 2248 L 2504 2248 Z'" "$TMP/counter.png"
"$MAGICK" "$TMP/letters.png" "$TMP/counter.png" -compose Dst_Out -composite "$TMP/letters_final.png"

# 5) composite letters onto the tile, then downscale (anti-aliasing happens here)
"$MAGICK" "$TMP/tile.png" "$TMP/letters_final.png" -compose over -composite \
  -filter Lanczos -resize 1024x1024 -depth 8 "PNG32:$BUILD/icon.png"
command cp -f "$BUILD/icon.png" "$BUILD/icon-1024.png"

# --- macOS .icns -----------------------------------------------------------
echo "[INFO] building icon.icns"
ICONSET="$TMP/icon.iconset"
mkdir -p "$ICONSET"
# Each size is downscaled from the 1024 master for crisp, anti-aliased results.
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
