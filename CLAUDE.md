# IA Desktop — project instructions

## After fixing anything: bump, commit, rebuild

Whenever a bug is fixed, an issue is resolved, or a change is verified working,
ALWAYS do all three of the following, in order, without being asked:

1. **Bump** the version by 0.0.1 (patch) in `package.json` (`version`). The
   `USER_AGENT` is now **derived** from this version in
   `src/shared/constants.js`, so there is no second string to keep in sync (L7).
   Verify nothing else hardcodes the old version: `ggrep -rn "<old-version>"
   package.json src/`.
2. **Commit** the change (only after the test suite passes — `npm test`).
   End commit messages with the required Co-Authored-By trailer.
3. **Rebuild** the installers so `dist/` reflects the new version:
   `npx electron-builder --mac` (and `--win` when on / targeting Windows).
   Clean stale artifacts first (`rm -f dist/*.dmg dist/*.blockmap;
   rm -rf dist/mac dist/mac-arm64`) so old-version DMGs don't linger.

> Note: bumping the version alone does NOT update `dist/` — the installers must
> be rebuilt explicitly, or `dist/` keeps serving the old version.

## Red/green TDD (always)

This project uses strict red/green TDD for ALL coding, editing, fixing, and
enhancement (see the user's global CLAUDE.md). Write the test first, show it
fail (red), then implement until it passes (green). Never edit a test merely to
make it pass. For Electron-glue or UI logic that's awkward to unit-test,
extract the decision logic into a pure, importable module and test that.

- Test runner: `npm test` (Node's built-in `node --test`, no third-party deps).

## Verifying the UI yourself

Don't ask the user for screenshots — capture the real window yourself:

```bash
scripts/screenshot.sh [output.png]      # headless capture of the live window
```

It uses the app's `--screenshot=<path>` flag, which is gated behind `--dev`
(H3 — the file-write must never be reachable in a normal production launch), so
the wrapper passes `--dev` for you (see `docs/readme-screenshot.md`).
Capture the **packaged** app too when verifying a release (pass `--dev` so the
screenshot path is honored):
`"dist/mac-arm64/IA Desktop.app/Contents/MacOS/IA Desktop" --dev --screenshot=<path>`.

## Architecture notes

- Pure logic lives in testable modules: `src/main/ia-core.js`,
  `src/main/menu-template.js`, `src/renderer/ui-util.js`. Prefer adding logic
  there (with tests) over inlining it in Electron glue.
- Networked client: `src/main/ia-client.js` (no third-party deps; Node
  fetch/https only — keeps the install small).
- Security posture: contextIsolation on, nodeIntegration off, strict CSP in the
  renderer, all privileged work behind IPC. Preserve this.
