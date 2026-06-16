# readme-selftest

Headless end-to-end self-test of the real renderer.

## What it does

`scripts/selftest.sh` (or `npm run selftest`) boots the app with
`--dev --selftest`. In that mode the renderer loads a driver
(`src/renderer/selftest.js`) that:

1. Installs a **fake `window.ia`** backed by static fixtures — so the REAL
   renderer code runs against deterministic data with **no network, no
   credentials, and no uploads**.
2. Drives the actual DOM and asserts outcomes across the feature set:
   - login → app shown
   - basic search → all result cards render, result count
   - facet sidebar appears; clicking a mediatype facet narrows results; the
     active-filter chip removes it again
   - favoriting a result → it appears in the Favorites tab
   - compact view reveals the sort control; sort-by-downloads-desc orders cards
   - the item modal opens with a file table + file-type summary
   - saving a search adds it to the saved dropdown (via the in-app prompt modal)
   - switching the theme sets `data-theme`
3. Prints `SELFTEST_RESULT {json}`; the main process reads it, logs it, and
   **exits 0 (all pass) or non-zero (any fail)** — so it's CI/script-runnable.

## Usage

```bash
npm run selftest          # or: scripts/selftest.sh
```

Output ends with `SELFTEST PASS 16/16` (or `SELFTEST FAIL …` + per-failure
lines). The process exit code reflects the result.

## Why it runs without the preload

The contextBridge-exposed `window.ia` is read-only, so the fake can't replace
it. Under `--dev --selftest` ONLY, the window is created without the preload
(and with contextIsolation off) so the driver can install its fake backend.
This relaxed configuration is gated behind `--selftest` (itself gated behind
`--dev`) and never applies to a normal or packaged launch — `cli-args.isSelfTest`
enforces this, and it's unit-tested.

## What it does NOT cover

Uploads and whole-collection downloads (never exercised — by design). The real
network client is covered separately by the unit suite (fake-fetch + a loopback
HTTP server). This harness covers the renderer DOM glue that unit tests can't.

## Live smoke test (opt-in)

For real end-to-end confidence against archive.org, `scripts/smoke-live.js` runs
a REAL search + metadata fetch + one small file download (never an upload, never
a whole collection):

```bash
node scripts/smoke-live.js            # search + metadata only
node scripts/smoke-live.js --download # also download the smallest small file
```

It is intentionally NOT part of `npm test` (the suite stays network-free).

## Extending it

Add checks in `src/renderer/selftest.js` via `check(name, condition)`. Keep the
fixtures in that file deterministic. The harness surfaced a real bug on first
run (inline `style=` attributes were being dropped by the strict CSP) — treat
new failures as real until proven otherwise.
