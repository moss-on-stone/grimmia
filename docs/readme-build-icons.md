# readme-build-icons

Regenerate the app icons from a single reproducible source.

## What it does

`scripts/build-icons.sh` builds the IA Desktop icon and all platform
derivatives:

- `build/icon.png` / `build/icon-1024.png` — 1024×1024 master (full-color RGBA)
- `build/icon.icns` — macOS iconset (all 10 required sizes, via `iconutil`)
- `build/icon.ico` — Windows multi-resolution icon (256→16)

It draws the icon with ImageMagick primitives — a blue→purple vertical gradient
masked to a continuous-corner rounded rect, with a white "IA" wordmark — and
**supersamples at 4× (4096px) then downscales to 1024px**. That downscale is
what produces smooth, anti-aliased **8-bit alpha** edges.

## Why it exists (the bug it fixed)

The previous PNGs had **1-bit (binary) alpha**. Binary alpha can't anti-alias,
so the rounded corners were jagged and read as a harsh dark "boundary" around
the tile — out of step with current Apple/Windows icon guidance. Rebuilding with
smooth 8-bit alpha removes the boundary and gives a clean macOS-style rounded
tile (and a crisp full-bleed-safe square for Windows).

## Usage

```bash
scripts/build-icons.sh
```

Idempotent — safe to re-run; overwrites the generated files in place.

## Requirements

- ImageMagick 7 (`magick`) — `/opt/homebrew/bin/magick`
- macOS `iconutil` (system tool) for the `.icns`

## Notes

- `build/icon.svg` is kept as a human-readable **design reference only**.
  ImageMagick's built-in SVG renderer does NOT honor its gradient (it renders
  the tile solid black), so the script does not rasterize the SVG — it rebuilds
  the artwork natively. Edit both the SVG (for reference) and the coordinates in
  the script (the source of truth) if the design changes.
- After regenerating, rebuild the installers so `dist/` picks up the new icon
  (see `CLAUDE.md` → bump/commit/rebuild).
