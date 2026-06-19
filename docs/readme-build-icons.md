# readme-build-icons

Regenerate the app icons from the artwork master.

## What it does

`scripts/build-icons.sh` takes the master artwork and produces all platform
derivatives (smooth 8-bit RGBA alpha):

- `build/icon.png` / `build/icon-1024.png` — 1024×1024 master raster
- `build/icon.icns` — macOS iconset (all 10 required sizes, via `iconutil`)
- `build/icon.ico` — Windows multi-resolution icon (256→16)

## Input

- `build/icon-source.png` — the master artwork: the Grimmia "moss cushion on a
  book" green rounded-square tile, supplied on a **white background**.

The script makes the white transparent, then derives every size from it.

## How the white is removed

A contiguous **flood-fill from a corner** with a fuzz tolerance (`FUZZ=12%`)
turns the near-white background transparent while LEAVING the green tile and its
soft drop shadow intact — the fill is connected-from-corner, so it can't bleed
into the tile. The result is trimmed to the art, padded to a **centered square**,
then downscaled to 1024 with Lanczos for clean anti-aliased edges.

## Usage

```bash
scripts/build-icons.sh
```

Idempotent — safe to re-run; overwrites the generated files in place.

## Requirements

- ImageMagick 7 (`magick`) — `/opt/homebrew/bin/magick`
- macOS `iconutil` (system tool) for the `.icns`

## Notes

- To change the icon, replace `build/icon-source.png` with new artwork (a
  rounded-square tile on white) and re-run the script.
- If new artwork has a non-white background or a tighter shadow, adjust `FUZZ`
  in the script.
- After regenerating, rebuild the installers so `dist/` picks up the new icon
  (see `CLAUDE.md` → bump/commit/rebuild/release). The README's top icon shows
  `build/icon.png`, so it updates automatically.
