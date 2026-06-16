# IA Desktop — Independent Code Review (June 2026)

Read-only audit of the codebase with a focus on **macOS + Windows cross-platform
correctness**, plus security, networking, and build/packaging. Findings are
ranked by severity. Each cites `file:line`.

> **STATUS: all findings below were FIXED with red/green TDD (v0.1.21).** Tests
> now run on macOS + Windows + Linux in CI. Summary of fixes:
> - **C1** idle timeouts on `request()`/`downloadFile`/`uploadFile` (reset per chunk).
> - **H1** `containWithin` is case-insensitive + drive-root-safe on Windows (platform-aware).
> - **H2** sanitizers escape Windows reserved names (CON/NUL/COM1…) + trim trailing dots/spaces, via a shared `sanitizeSegment`.
> - **H3** `downloadFile` settles only after the write fd closes (no Windows lock on retry); abort + timeout carried through redirects.
> - **H4** size-based skip now verifies the checksum when one is published; re-downloads (`force`) on mismatch.
> - **H5** CI matrix now includes `windows-latest` + `ubuntu-latest`.
> - **H6** the inter-item delay is cancellable (abort-aware sleep + post-sleep check).
> - **M1** total path bounded to Windows MAX_PATH via `boundedSaveAs` (shortens the stem, keeps the extension/subdirs).
> - **M3** plaintext-credential warning is now platform-honest about NTFS ACLs vs 0600.
> - **M5** backoff has jitter (`jitteredBackoff`). **M6** `item:metadata` re-validates the identifier.
> - **L1** dead `el(html:)` innerHTML sink removed. **L2** `<code>` is monospace (Consolas fallback). **L3** Braille drag glyph swapped. **L5** `win.publisherName` set (no email leak). **L6** dev flags inert when `app.isPackaged`.
> - **L4 (auto-update)** intentionally deferred — see below.

**Overall:** the app is well-built — strong Electron security posture
(contextIsolation, sandbox, strict CSP, `connect-src 'none'`, IPC re-validation),
pure-logic modules with good test coverage, and clean packaging. The weaknesses
cluster in two places: **(a) network robustness (no timeouts)** and **(b)
Windows-specific filesystem behavior** that never surfaces during macOS-only
development and CI.

---

## CRITICAL

### C1. No network timeout on any request — a hung connection stalls the whole transfer queue forever
`src/main/ia-client.js:32-39` (`request()`), `:206` (`downloadFile`), `:369` (`uploadFile`)

No fetch/https call sets a timeout. The existing `res.on('aborted'/'close')`
guards only fire on a dropped connection — **not** on a server that accepts the
socket and then stalls (no data, no FIN). The promise never settles. Because all
transfers are serialized through one gate (`main.js:63`), a single stalled job
**never releases the gate**, freezing every queued download and upload behind it
with no error. Ironically `isTransient` already matches `'timeout'`
(`download-queue.js:26`) and would retry — but nothing ever generates the timeout.

**Fix:** add an idle timeout to all three paths (`req.setTimeout(...)` for the
https paths, reset on each `data` chunk; `AbortSignal.timeout()` combined with the
caller's signal for `request()`).

---

## HIGH

### H1. `containWithin` is case-sensitive and mishandles drive roots — breaks/weakens the traversal guard on Windows
`src/main/ipc-validate.js:89-93` (mirrored in `src/main/security.js` `isAllowedOpenPath`)

```js
return c.startsWith(r + path.sep);
```
- **Case:** Windows (and default macOS) filesystems are case-insensitive, but the
  check is a raw `startsWith`. A drive letter normalized to `C:\` by `path.resolve`
  vs. a stored `c:\` root yields a false "outside the folder" rejection — legit
  downloads refused. (Pure-`..` traversal is still caught because `path.resolve`
  collapses it, so this is mainly correctness + guard robustness.)
- **Drive root:** if `destRoot` is a drive root (`D:\`), `r + path.sep` becomes
  `D:\\`, so **every** download under it is refused, and opening the folder is
  refused too.

**Fix:** lower-case both sides on `win32` before comparing; strip a trailing
separator from `r` before appending exactly one; or use `path.relative` and check
the result isn't `..`-prefixed/absolute.

### H2. Sanitizers don't reject Windows reserved device names (CON, NUL, COM1…) — download fails on Windows
`src/main/ipc-handlers.js:46-59` (`sanitizeDir`, `sanitizeRel`), `src/main/download-prefs.js:202-217` (`sanitizeFilename`)

All strip illegal *characters* but none reject reserved *basenames*
(`CON, PRN, AUX, NUL, COM1-9, LPT1-9`, with/without extension). An IA item with
identifier `nul`, or a remote file `CON.pdf`, passes validation and makes
`mkdirSync`/`createWriteStream` throw `EINVAL`/`ENOENT` **on Windows only**. The
format-fallback logic doesn't cover this error class, so the download fails
outright. Invisible on macOS.

**Fix:** in each sanitizer, after char-stripping, test the stem against
`/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i` and prefix it (e.g. `_name`).

### H3. `downloadFile` rejects before the write fd is closed — Windows retry can hit a locked/half-open file
`src/main/ia-client.js:240-296`

On failure, `out.destroy()` is async but the promise rejects immediately. The
runner may **retry the same file** (transient classification) and open a *second*
`createWriteStream` on the same path while the first fd is still closing. On
Windows an open handle locks the file → spurious failure or corrupt append. Also
the abort listener isn't wired during the **redirect** recursion
(`:207-212`), so a cancel landing in the redirect window isn't honored.

**Fix:** gate the reject on `out`'s `'close'` event; register the abort listener
before issuing the request and around the redirect recursion.

### H4. "Already complete" is decided by **file size only** — checksum verify is skipped for resumed files
`src/main/ia-client.js:190-195` (skip when `size` matches), `src/main/ipc-handlers.js:196-204` (`if (!r.skipped) verify(...)`)

A previously-truncated/corrupt file whose byte count happens to equal the recorded
size is treated as done forever and **never checksum-verified** (verification is
gated behind `!r.skipped`). The checksum protection that should catch this is
bypassed precisely on the resume path.

**Fix:** when a published crypto checksum exists, verify the existing file before
honoring the size-based skip; re-download on mismatch.

### H5. CI runs tests only on macOS — Windows-specific failures slip to release
`.github/workflows/ci.yml:12,39` (both jobs `runs-on: macos-latest`)

Every finding above (H1–H4, M-series) is the kind that passes on macOS and fails
on Windows. We already hit one (the 0600-perms test) at release time. Without a
Windows job, this class of bug is undetected until users report it.

**Fix:** add `windows-latest` (and ideally `ubuntu-latest`) to the test matrix.
Single cheapest insurance for the whole "Windows blind spot" theme.

### H6. Inter-item download delay is not cancellable
`src/main/ipc-handlers.js:40-43` (`defaultSleep`), `:181-184` (runner)

The user-configurable pause between items (default 5s) is a bare `setTimeout`
with no signal. Cancelling during the pause doesn't take effect until the sleep
fully elapses. Cancel feels broken on multi-item downloads.

**Fix:** make `sleep(ms, signal)` resolve early on abort; pass the signal in and
re-check `signal.aborted` after.

---

## MEDIUM

### M1. Full path can exceed Windows MAX_PATH (260) despite the 200-char filename cap
`src/main/download-prefs.js:210`, `src/main/ipc-handlers.js:98,169`

The filename and identifier segments are each capped at 200, but the **total**
(`destRoot` + subfolder + IA sub-dirs + basename) is unbounded. Deep IA trees clear
260 on classic Windows builds → `ENAMETOOLONG`/`ENOENT`. macOS (~1024) never hits
it. **Fix:** bound the assembled path (hash-truncate the deepest segment) or
prefix long writes with `\\?\` on Windows; at minimum surface a clear error.

### M2. `sanitizeDir`/`sanitizeRel` don't trim trailing dots/spaces — Windows folder-name mismatch breaks resume
`src/main/ipc-handlers.js:46-59`

`sanitizeFilename` trims trailing `[\s.]` but `sanitizeDir`/`sanitizeRel` segments
don't. An identifier like `foo.bar.` (passes `IDENTIFIER_RE`) yields a dir ending
in `.`; Windows silently strips it on disk, so the path the code computes ≠ what
exists → skip-if-exists/resume re-downloads or "not found" on the next run.
**Fix:** apply the same trailing-`[\s.]` trim to those segments.

### M3. Plaintext credential fallback's `0o600` is a no-op on Windows; the warning over-claims
`src/main/store.js:86-99`

On Windows, POSIX mode bits are mostly ignored (NTFS uses ACLs), so the
"owner-readable only" warning is inaccurate there. Real exposure is low because
`safeStorage` (DPAPI) is normally available on Windows, so this branch rarely
runs — but the claim is wrong. **Fix:** make the warning platform-honest;
optionally set an ACL via `icacls` or keep creds session-only on that path. (The
encrypted `.enc` path is fine — its protection is from safeStorage, not 0600.)

### M4. Drag-and-drop upload depends on the deprecated `File.path`
`src/shared/upload-templates.js:54-58`, `src/renderer/renderer.js:1913`

`extractDroppedFiles` reads `f.path`, which Electron deprecated and **removed in
Electron 32** (replaced by `webUtils.getPathForFile`, callable only from preload).
*Correction to one reviewer's claim:* the `^31.0.0` range is `>=31.0.0 <32.0.0`,
so `npm install` will **not** silently jump to 32 — this is a *latent upgrade
hazard*, not an imminent break, and there's no test covering the real drop path.
**Fix:** when upgrading past Electron 31, expose `webUtils.getPathForFile` via the
preload; for now, add a comment/pin so the dependency is visible.

### M5. Retry backoff has no jitter
`src/main/download-queue.js:12-17`

`min(30000, 500 * 2^attempt)` is deterministic. Concurrency-1 limits the blast
radius, but many files of a collection hitting `503 SlowDown` retry in lockstep,
prolonging throttling. **Fix:** multiply by `(0.5 + random*0.5)`.

### M6. `item:metadata` IPC handler skips `validateIdentifier`
`src/main/main.js:290-292`

The only identifier-consuming handler that doesn't re-validate (all others do).
Impact is low (`encodeURIComponent` + hard-coded host prevent off-host/traversal),
but it's the one gap in an otherwise uniform discipline. **Fix:** add
`validateIdentifier(identifier)` as the first line.

---

## LOW / polish

- **L1. Dead `el(..., {html:...})` innerHTML sink** (`renderer.js:35`): no caller
  uses it, but it's a latent XSS foot-gun if someone routes metadata through it.
  Remove the branch (add a test asserting its absence). Untrusted metadata is
  otherwise correctly rendered via `textContent` everywhere — verified.
- **L2. `<code>` has no monospace font** (`styles.css`): inline code/globs/paths
  render in the proportional UI font on both OSes. Add
  `code { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }`.
- **L3. Braille drag-handle glyph `⠿`** (`styles.css:407`): risks tofu on Windows
  (incomplete Braille coverage in Segoe UI). Swap for `⋮⋮`/`≡`/a CSS dot-grid.
  The other glyphs (★ ☰ ▦ ↑ ↓ ⤓ ✓ ✕) are Segoe-safe.
- **L4. No auto-update mechanism** (whole repo): users are frozen on the installed
  version and re-trigger SmartScreen/Gatekeeper on every manual update. The release
  pipeline already produces GitHub Releases, so an `electron-updater` GitHub feed is
  half-built (NSIS auto-update works unsigned; macOS needs signing). Decide
  intentionally — at minimum add an in-app "check for updates" link.
- **L5. Windows installer metadata** (`package.json:63-72`): no `win.publisherName`,
  so electron-builder derives it from `author` — which now embeds the protonmail
  email into installer metadata. Set `"publisherName": "IA Desktop"`. Consider a
  `portable` target.
- **L6. `--screenshot`/`--selftest` dev flags are gated on argv only, not
  `app.isPackaged`** (`main.js:114`, `cli-args.js:33`): correctly require `--dev`,
  but a packaged app can be relaunched with arbitrary argv locally. Belt-and-
  suspenders: also force dev flags off when `app.isPackaged`. (No live exploit —
  CSP still blocks script injection in the relaxed selftest window.)

---

## Verified-OK (checked, no action needed)

CSP is strong (`default-src 'none'`, scoped `img-src`, `connect-src 'none'`, no
`unsafe-inline`); credentialed requests don't follow redirects (no auth leak);
download destinations are double-containment-checked; `safeLocalName` and
`upload-templates` basename handle both `/` and `\`; menu-template handles Windows
(Ctrl, no app menu); no hardcoded `metaKey` shortcuts; font stack has a Segoe UI
fallback; `notarize.js`/entitlements are inert without creds; the `files` array and
`.gitignore` keep tests/dev-deps/dist out of the installer; downloads/uploads
stream to/from disk (no whole-file buffering).

---

## Suggested fix order

1. **C1** network timeouts (highest impact — affects every operation).
2. **H5** add Windows CI (catches the rest of this list going forward).
3. **H1 + H2** the Windows path guard + reserved-name rejection (real Windows breakage).
4. **H3 + H4** download fd-close gating + verify-on-resume (data integrity).
5. **H6** cancellable inter-item sleep.
6. M-series, then L-series polish.
