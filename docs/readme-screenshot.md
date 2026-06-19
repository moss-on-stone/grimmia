# readme-screenshot

Self-screenshot the Grimmia window — no human needed to send screenshots.

## What it does

The Electron main process supports a `--screenshot=<path>` flag (honored only
alongside `--dev`). When present, the app launches, loads the UI, waits ~700ms
for layout to settle, captures the real rendered window with
`webContents.capturePage()`, writes a PNG to `<path>`, and quits. This captures
exactly what a user sees (it renders the actual web contents), so the UI can be
verified programmatically.

> **Security (H3):** the screenshot path is a `fs.writeFileSync` to a
> caller-chosen location, so it is gated behind dev mode — in a packaged
> production build `--screenshot` is ignored entirely. Always pass `--dev`.

## Usage

```bash
# Convenience wrapper (auto-named file in ./screenshots/)
scripts/screenshot.sh

# Or specify an output path
scripts/screenshot.sh screenshots/login.png

# Raw form (note: --dev is required)
./node_modules/.bin/electron . --dev --screenshot=/abs/path/out.png

# Capture a POPULATED UI: --demo=<query> auto-runs a real search first (grid
# view by default; add #view=compact handling via the renderer for list mode).
# The screenshot settle is extended so the search has time to render.
./node_modules/.bin/electron . --dev "--demo=apollo 11" --screenshot=/abs/grid.png
```

The wrapper wraps the call in `gtimeout 30` so it can never hang, makes the
output path absolute, and prints the saved path on the last line.

## Notes

- Captures whatever state the app boots into. Logged out → the login screen.
  Logged in (credentials stored) → the search screen.
- `screenshots/` is gitignored.
- Useful for debugging visual issues (this is how the stray "empty modal bar"
  over the login screen was diagnosed and confirmed fixed).

## How it’s wired

- Flag parse: `screenshotPath` near the top of `src/main/main.js`.
- Capture+quit: in `createWindow()`, gated on `screenshotPath`.
- DevTools is suppressed during a screenshot run so it can’t obscure the window.
