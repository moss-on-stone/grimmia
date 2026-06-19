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

## How the white (and shadow) is removed

A contiguous **flood-fill from a corner** with a fuzz tolerance (`FUZZ=35%`)
turns the near-white background AND the light-grey drop-shadow halo transparent,
stopping at the much darker green tile edge (the fill is connected-from-corner
and can't reach the light moss inside the dark tile). Dropping the baked-in
shadow avoids a grey fringe against dark UI — macOS/Windows add their own shadow.

## Sizing (Apple macOS icon grid)

macOS 11+ (Big Sur and later) does **not** auto-mask third-party `.icns` — it
shows the artwork as-is (plus a system shadow). Apple's icon grid places the
rounded body at **824×824 on a 1024 canvas** (~100px transparent margin per
side, ≈80%). The script squares the isolated tile, resizes it to **824**, and
centers it on a **1024** transparent canvas so Grimmia renders the same
proportional size as other macOS apps (not oversized/edge-to-edge).

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
