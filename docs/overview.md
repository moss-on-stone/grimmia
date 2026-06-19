# Grimmia — Architecture Overview

_A developer-oriented map of what this app is, how it's structured, and how the
pieces fit together. For user-facing install/usage, see the top-level
`README.md`; for review findings and the backlog, see `recs.md` and `ideas.md`._

Version at time of writing: **0.1.3**.

---

## 1. What it is

A cross-platform **desktop app for the Internet Archive** (archive.org) that does
the core jobs of the official `ia` command-line tool — search, browse, download,
upload, and (groundwork for) metadata editing — with a point-and-click UI and **no
command line required**. It runs on macOS and Windows.

**Key design choice:** it talks to archive.org's web APIs **directly in
JavaScript** — there is no bundled Python and **no third-party runtime
dependencies** (only Electron itself). It uses Node's built-in `fetch` and
`https`. This keeps the installer small (~90 MB) and audit-clean.

---

## 2. Technology

| Concern        | Choice |
| -------------- | ------ |
| Shell          | Electron (`contextIsolation: true`, `nodeIntegration: false`) |
| UI             | Plain HTML/CSS/JS (no framework, no bundler) loaded via `loadFile` |
| Networking     | Node built-in `fetch` (JSON APIs) + `node:https`/`http` (streaming up/down) |
| Credentials    | Electron `safeStorage` (OS keychain), with a plaintext fallback |
| Packaging      | `electron-builder` → `.dmg` (mac, arm64 + x64) and NSIS `.exe` (Windows) |
| Tests          | Node's built-in test runner (`node --test`), no test deps |
| Runtime deps   | **none** (devDeps: electron, electron-builder) |

---

## 3. Process model & security boundary

Electron has two process types; this app keeps a strict boundary between them.

```
┌─────────────────────────────────────────────────────────────────┐
│ MAIN process (Node, full privileges)                              │
│   src/main/*.js                                                    │
│   - owns credentials, the network, and the filesystem             │
│   - registers IPC handlers; does all archive.org calls            │
└───────────────▲───────────────────────────────────────────────────┘
                │  IPC (ipcMain.handle / ipcRenderer.invoke + events)
┌───────────────┴───────────────────────────────────────────────────┐
│ PRELOAD (bridge)  src/preload/preload.js                           │
│   - the ONLY thing the renderer can see of the main world          │
│   - exposes a minimal, explicit `window.ia` API via contextBridge  │
└───────────────▲───────────────────────────────────────────────────┘
                │  window.ia.*
┌───────────────┴───────────────────────────────────────────────────┐
│ RENDERER (sandboxed-ish browser context)  src/renderer/*           │
│   - the UI; no Node, no direct network, no credentials             │
│   - strict CSP (default-src 'none'; connect-src 'none')            │
└───────────────────────────────────────────────────────────────────┘
```

The renderer never touches the network, the filesystem, or credentials. It can
only call the named methods on `window.ia`, each of which forwards to a specific
IPC channel in the main process.

---

## 4. Source layout

```
src/
  main/                 # MAIN process — privileged
    main.js             # window creation, IPC handlers, app lifecycle
    ia-client.js        # networked archive.org client (login/search/download/upload/…)
    ia-core.js          # pure helpers: URL building, meta-header encoding, login parse
    ia-query.js         # pure: build Lucene queries from advanced-search fields
    download-prefs.js   # pure: format filtering, filename sanitize/rename, planDownload
    store.js            # encrypted credential store + JSON settings (safeStorage)
    menu-template.js    # pure: application menu template builder

  preload/
    preload.js          # contextBridge — exposes window.ia.* over IPC

  renderer/             # RENDERER process — UI only
    index.html          # markup + CSP; loads the scripts below
    styles.css          # all styling (dark theme, CSS custom properties)
    renderer.js         # the UI controller (search, results, downloads, upload, prefs)
    ui-util.js          # pure UI helpers (formatBytes, escapeHtml, parseSubjects, …)
    view-prefs.js       # pure: defaults + view/display prefs (also required by main)

build/                  # app icons (.icns / .ico / .png) for electron-builder
scripts/                # screenshot.sh (headless self-screenshot helper)
test/                   # node --test unit tests (one file per pure module)
docs/                   # this file + readme-screenshot.md
dist/                   # build output (gitignored): .dmg / .exe installers
```

### The "pure logic in testable modules" pattern

A deliberate, consistent rule runs through the codebase: **decision logic lives in
pure, side-effect-free modules** (no network, no DOM, no Electron) so it can be
unit-tested with `node --test`. The I/O-bound code (Electron glue, network,
filesystem) is kept thin and composes those pure modules.

| Pure module            | Tested by                | Responsibility |
| ---------------------- | ------------------------ | -------------- |
| `ia-core.js`           | `test/ia-core.test.js`   | search-URL building, metadata-header encoding (IAS3 rules), login-response parsing, download-URL/path helpers |
| `ia-query.js`          | `test/ia-query.test.js`  | compose archive.org Lucene queries from structured fields (title/subject/creator/language/mediatype/date) |
| `download-prefs.js`    | `test/download-prefs.test.js` | format presets, file filtering, filename sanitize + title rename, `planDownload`, collision de-dup |
| `view-prefs.js`        | `test/view-prefs.test.js` | default prefs (PDF-only download default), prefs normalization, thumbnail URL, subject-list parsing |
| `ui-util.js`           | `test/ui-util.test.js`   | `formatBytes`, `percent`, `escapeHtml`, `parseSubjects`, `buildUploadMetadata`, `validIdentifier` |
| `menu-template.js`     | `test/menu.test.js`      | application-menu template (excludes macOS-injected dictation/find items) |

Two extra tests guard against specific regressions by reading the shipped files:
`test/css-hidden.test.js` (the `[hidden]` CSS rule) and `test/login-form.test.js`
(autocomplete-off on the login form). Total: **79 tests**.

> Note: `view-prefs.js` physically lives under `src/renderer/` but is also
> `require`d by `src/main/main.js` (it's written UMD-style to load in both). This
> cross-boundary import is flagged in `recs.md` (M9) — shared pure logic should
> arguably move to a `src/shared/` directory.

---

## 5. The IPC surface

The renderer↔main contract. Each `window.ia.*` call (left) maps to an
`ipcMain.handle` channel (right) in `main.js`.

| `window.ia` method                | IPC channel            | Does |
| --------------------------------- | ---------------------- | ---- |
| `auth.status()`                   | `auth:status`          | is there a logged-in session? |
| `auth.login(email, pw)`           | `auth:login`           | xauthn login → store S3 keys/cookies |
| `auth.logout()`                   | `auth:logout`          | clear stored credentials |
| `search.query(q, opts)`           | `search:query`         | basic search (advancedsearch.php) |
| `search.advanced(fields, opts)`   | `search:advanced`      | build Lucene query from fields, then search |
| `search.buildQuery(fields)`       | `search:buildQuery`    | live query preview (no network) |
| `item.metadata(id)`               | `item:metadata`        | full item metadata + file list |
| `prefs.formatPresets()`           | `prefs:formatPresets`  | list download format presets |
| `settings.get()` / `.update(p)`   | `settings:get/update`  | read (normalized) / persist settings |
| `dialog.chooseFolder()`           | `dialog:chooseFolder`  | native folder picker |
| `upload.chooseFiles()`            | `dialog:chooseFiles`   | native multi-file picker |
| `download.start(args)`            | `download:start`       | download item(s): filter + rename + fetch |
| `download.cancel(jobId)`          | `download:cancel`      | abort a running job |
| `upload.start(args)`              | `upload:start`         | create item + PUT files via S3 |
| `metadata.modify(id, patches)`    | `metadata:modify`      | metadata write (currently no UI caller) |
| `shell.openPath(p)`               | `shell:openPath`       | reveal a folder in the OS |

Progress for long jobs is pushed back from main to the renderer over event
channels `download:progress` and `upload:progress`, with phases
`file-start → file-progress → file-done → complete` (or `error`). The renderer
subscribes via `window.ia.download.onProgress(...)`.

---

## 6. archive.org endpoints used

The same endpoints the official `internetarchive` library uses:

- **Login:** `POST https://archive.org/services/xauthn/?op=login` → returns S3
  `access`/`secret` keys + `logged-in-user`/`logged-in-sig` cookies + screenname.
- **Search:** `GET https://archive.org/advancedsearch.php` (paged JSON).
- **Metadata (read):** `GET https://archive.org/metadata/{identifier}`.
- **Metadata (write):** `POST https://archive.org/metadata/{identifier}`.
- **Download:** `https://archive.org/download/{identifier}/{file}` (redirects to a
  storage node; handled by `downloadFile`).
- **Upload (S3-like):** `PUT https://s3.us.archive.org/{identifier}/{file}` with
  `Authorization: LOW access:secret` and `x-archive-meta*` headers.
- **Thumbnails:** `https://archive.org/services/img/{identifier}`.

---

## 7. Feature walkthrough (where each lives)

- **Login** — `renderer.js` login form → `auth:login` → `ia-client.login` →
  `ia-core.parseLoginResponse` → `store.saveCredentials` (encrypted).
- **Search (basic + advanced)** — `renderer.js` search/advanced panel →
  `search:query` / `search:advanced` → `ia-query.buildAdvancedQuery` +
  `ia-client.search`. Live query preview via `search:buildQuery`.
- **Results: grid vs compact list, subject tags** — `renderer.js renderResults`
  using `view-prefs` (`shouldShowThumbs`, `toSubjectList`); thumbnails are `<img>`
  elements that remove themselves on load error.
- **Selection + batch download** — checkboxes per result + "select all on page" +
  "Download selected" → `download:start` with an array of items.
- **Download** — `download:start` resolves each item's files (if absent),
  `download-prefs.planDownload` applies the **format filter** (default: PDF only)
  and **filename rename** (off / replace-with-title / append-title, illegal chars
  stripped, collisions auto-numbered), then `ia-client.downloadFile` streams each
  file with progress, **resume**, and **skip-if-complete**.
- **Upload** — upload form → `upload:start` → `ia-client.uploadFile` (S3 PUT;
  `makeBucket` on the first file creates the item, metadata via `x-archive-meta*`).
- **Preferences** — Preferences tab + toolbar controls; persisted via
  `settings:update`; defaults come from `view-prefs.DEFAULT_PREFS`
  (PDF-only download, grid view, subjects hidden, no rename).

---

## 8. Build, run, test

```bash
npm install            # Electron + electron-builder (no runtime deps)
npm start              # run the app
npm run dev            # run with DevTools (and only then)
npm test               # 79 unit tests (node --test, no network)
npm run dist:mac       # build macOS .dmg (arm64 + x64) into dist/
npm run dist:win       # build Windows .exe (run on/for Windows)

scripts/screenshot.sh [out.png]   # headless self-screenshot of the live window
```

The app's `--screenshot=<path>` flag drives the self-screenshot used to verify the
UI without a human (see `readme-screenshot.md`).

### Project conventions (see `CLAUDE.md`)

- **Red/green TDD** for all code: write the failing test first, then implement.
  Awkward-to-test glue gets its logic extracted into a pure module that is tested.
- **After any fix: bump → commit → rebuild.** Patch-bump the version in both
  `package.json` and the `USER_AGENT` in `ia-client.js`, commit, then rebuild the
  installers (a version bump alone leaves `dist/` stale).

---

## 9. Known issues & roadmap

This overview describes the structure as built; it does **not** claim everything
is bug-free. A thorough independent review is in **`recs.md`** (notably a critical
bug in item-detail downloads, download-resume integrity, and the security/testing
gaps), and a 20-item feature backlog is in **`ideas.md`**.
