'use strict';

/**
 * main.js — Electron main process.
 *
 * Creates the window, registers secure IPC handlers, and bridges the renderer
 * UI to the IA client. The renderer never touches the network or credentials
 * directly; it calls invokable IPC channels exposed through the preload.
 */

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');

// Disable Chromium's autofill / "save password" UI, which renders as a stray
// full-width bar (with an × dismiss button) over login forms. Also disable the
// spare renderer. These are comma-joined into one disable-features switch.
app.commandLine.appendSwitch(
  'disable-features',
  'AutofillServerCommunication,AutofillEnableAccountWalletStorage,SpareRendererForSitePerProcess'
);

const ia = require('./ia-client');
const store = require('./store');
const { buildMenuTemplate } = require('./menu-template');
const { buildAdvancedQuery, parseSearchInput } = require('./ia-query');
const { FORMAT_PRESETS } = require('./download-prefs');
const { DEFAULT_PREFS, normalizePrefs, nextZoomLevel } = require('../shared/view-prefs');
const { validateIdentifier } = require('./ipc-validate');
const { handleDownloadStart, handleUploadStart, handleBulkUpload } = require('./ipc-handlers');
const { createTransferQueue } = require('./transfer-queue');
const { createPauseGate } = require('./pause-gate');
const { createOverloadController, shouldReopenGateOnDrain } = require('./overload-policy');
const queueStore = require('./queue-store');
const { isDevFromArgv, resolveScreenshotPath, isSelfTest, resolveDemo } = require('./cli-args');
const { isAllowedExternalUrl, isAllowedOpenPath } = require('./security');
const csv = require('./csv');
const { parseTasks, buildMetadataPatch } = require('./json-patch');
const logger = require('./logger');

// L6: a packaged build NEVER honors dev flags, even if relaunched with --dev,
// so the relaxed selftest window and the --screenshot file-write are
// unreachable in production regardless of argv.
const isPackaged = app.isPackaged;
const isDev = isDevFromArgv(process.argv, isPackaged);
// `--screenshot=/abs/path.png` → capture the window to that file and quit.
// Honored ONLY in dev (H3): in production this arbitrary-file-write primitive
// is disabled regardless of argv.
const screenshotPath = resolveScreenshotPath(process.argv, isPackaged);
const selfTest = isSelfTest(process.argv, isPackaged);
const demoQuery = resolveDemo(process.argv, isPackaged);
const demoSelectFlag = process.argv.includes('--demo-select');

/** In-memory credentials (loaded from encrypted store at startup). */
let creds = null;

/**
 * Active job controllers keyed by job id, so the UI can cancel. Downloads and
 * uploads use SEPARATE maps so a jobId collision after a renderer reload can't
 * make one job's cleanup remove the other's controller (H5).
 */
const downloadJobs = new Map();
const uploadJobs = new Map();

// Transfers run ONE JOB AT A TIME across BOTH downloads and uploads
// (archive.org throttles parallel transfers). A download in progress blocks an
// upload and vice versa — they all wait on this single queue. Unlike a plain
// mutex, the WAITING jobs form a user-reorderable list (drag-to-reorder in the
// UI); the active job is pinned and the next job is taken from the front.
const transferQueue = createTransferQueue();
// Per-job metadata (kind + label) so the renderer can render the queue order
// without re-deriving it. Keyed by jobId; cleaned up when the job ends.
const jobMeta = new Map();

// Server-overload resilience: a shared pause gate the transfer runner awaits
// before each item, plus a controller that escalates to pause/delay after a run
// of transient failures. Transfers run one-at-a-time (concurrency 1), so the
// active runner is the one that blocks at the gate; queued jobs are held by the
// transfer queue behind it. The gate stays closed until resume()/the delay timer.
const pauseGate = createPauseGate();
const overload = createOverloadController({
  gate: pauseGate,
  getPrefs: () => normalizePrefs(store.loadSettings()),
  broadcast: () => broadcastQueueDepth(),
});

// Phase 2 — persist each in-progress transfer's descriptor to queue.json so an
// app crash/restart can offer to resume it. Persisted on start; removed on
// success or user discard/cancel (a crash leaves it pending → offered next launch).
function persistJob(descriptor) {
  try {
    store.saveQueue(queueStore.upsertJob(store.loadQueue(), descriptor));
  } catch (err) {
    logger.warn('queue: failed to persist job', { jobId: descriptor && descriptor.jobId, reason: err.message });
  }
}
function forgetJob(jobId) {
  try {
    store.saveQueue(queueStore.removeJob(store.loadQueue(), jobId));
  } catch (err) {
    logger.warn('queue: failed to forget job', { jobId, reason: err.message });
  }
}
// Pending jobs loaded from a previous session, offered to the renderer on startup.
let pendingResumeJobs = [];

let mainWindow = null;

/** Broadcast the transfer queue (active + ordered waiting) so the renderer can
 *  badge the count and render/realign the queued cards. Includes the overload
 *  block (mode + resumeAt) when the gate is closed, so the renderer can show the
 *  paused/auto-resuming alert. */
function broadcastQueueDepth() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  const snap = transferQueue.snapshot();
  const describe = (id) => ({ jobId: id, ...(jobMeta.get(id) || {}) });
  const gs = pauseGate.state();
  mainWindow.webContents.send('transfer:queue', {
    downloads: downloadJobs.size,
    uploads: uploadJobs.size,
    active: snap.active ? describe(snap.active) : null,
    waiting: snap.waiting.map(describe),
    overload: pauseGate.isOpen()
      ? null
      : { mode: gs.mode, resumeAt: gs.resumeAt, reason: 'Server appears to be overloaded or down.' },
  });
}

/**
 * Enter the shared transfer queue for `jobId`. Records the job's kind/label for
 * the UI, tells the renderer when the job is queued behind others, and resolves
 * with the queue's `release` once this job is active. `send` posts progress for
 * this job's channel.
 */
async function enterTransferQueue(jobId, meta, send) {
  jobMeta.set(jobId, meta);
  const acquirePromise = transferQueue.acquire(jobId);
  const snap = transferQueue.snapshot();
  broadcastQueueDepth();
  if (snap.active !== jobId) {
    const position = snap.waiting.indexOf(jobId) + 1; // 1-based among waiting
    send({ phase: 'queued', position });
  }
  return acquirePromise;
}

/** Leave the queue: run the release, drop metadata, and re-broadcast. If the
 *  queue has fully drained, reopen the pause gate so a stale overload pause
 *  (e.g. left closed after the active job was cancelled) can't strand future
 *  transfers (review HIGH #1). */
function leaveTransferQueue(jobId, release) {
  if (release) release();
  transferQueue.remove(jobId); // no-op if it was the active job
  jobMeta.delete(jobId);
  if (!pauseGate.isOpen() && shouldReopenGateOnDrain(transferQueue.snapshot())) {
    pauseGate.resume();
  }
  broadcastQueueDepth();
}

function createWindow() {
  // Self-test runs WITHOUT the preload so selftest.js can install a fake
  // `window.ia` (the contextBridge-exposed one is read-only). This relaxed
  // config only ever applies under `--dev --selftest`, never in production.
  const webPreferences = selfTest
    ? { contextIsolation: false, nodeIntegration: false, sandbox: false }
    : {
        preload: path.join(__dirname, '..', 'preload', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        // L4: enable Chromium's OS-level renderer sandbox. The preload uses only
        // contextBridge + ipcRenderer (both sandbox-compatible), so this is a
        // safe defense-in-depth hardening.
        sandbox: true,
      };
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 880,
    minHeight: 560,
    title: 'Grimmia',
    backgroundColor: '#0f1115',
    webPreferences,
  });

  const demoView = process.argv.includes('--demo-list') ? 'compact' : 'grid';
  const demoSelect = process.argv.includes('--demo-select') ? '&select' : '';
  const demoSubjects = process.argv.includes('--demo-subjects') ? '&subjects' : '';
  const demoTabArg = process.argv.find((a) => a.startsWith('--demo-tab='));
  const demoTab = demoTabArg ? `&tab=${demoTabArg.split('=')[1]}` : '';
  const demoBadgeArg = process.argv.find((a) => a.startsWith('--demo-badge='));
  const demoBadge = demoBadgeArg ? `&badge=${demoBadgeArg.split('=')[1]}` : '';
  const demoBadgeUpArg = process.argv.find((a) => a.startsWith('--demo-badgeup='));
  const demoBadgeUp = demoBadgeUpArg ? `&badgeup=${demoBadgeUpArg.split('=')[1]}` : '';
  const demoQueueFlag = process.argv.includes('--demo-queue') ? '&queue' : '';
  const loadOpts = selfTest
    ? { hash: 'selftest' }
    : demoQuery
      ? { hash: `demo=${encodeURIComponent(demoQuery)}&view=${demoView}${demoSelect}${demoSubjects}${demoTab}${demoBadge}${demoBadgeUp}${demoQueueFlag}` }
      : undefined;
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), loadOpts);
  // Only open DevTools when explicitly started with --dev, and only after the
  // page is ready so it never floats over a half-loaded window.
  if (isDev && !screenshotPath && !selfTest) {
    mainWindow.webContents.once('did-finish-load', () =>
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    );
  }

  // Phase 2: once the renderer is ready, offer to resume any transfers left
  // unfinished by a previous session. Skipped in self-test/screenshot modes so it
  // never interferes with the headless harness.
  if (!selfTest && !screenshotPath) {
    mainWindow.webContents.once('did-finish-load', () => {
      if (pendingResumeJobs.length && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('transfer:resume-offer', pendingResumeJobs.map(queueStore.jobSummary));
      }
    });
  }

  // Headless self-test (`electron . --dev --selftest`): the renderer drives its
  // own DOM against a fake backend and prints SELFTEST_RESULT; we read it, log
  // it, and exit 0/1 so the harness is CI/script-runnable.
  if (selfTest) {
    mainWindow.webContents.on('console-message', (_e, _level, message) => {
      // eslint-disable-next-line no-console
      if (isDev) console.log(`[renderer] ${message}`);
      const m = /^SELFTEST_RESULT (.+)$/.exec(message);
      if (!m) return;
      let report;
      try {
        report = JSON.parse(m[1]);
      } catch {
        report = { passed: 0, total: 0, failures: ['unparseable result'] };
      }
      const ok = report.failures.length === 0 && report.passed === report.total && report.total > 0;
      logger.info('selftest finished', { passed: report.passed, total: report.total, ok });
      // eslint-disable-next-line no-console
      console.log(`SELFTEST ${ok ? 'PASS' : 'FAIL'} ${report.passed}/${report.total}`);
      for (const f of report.failures) {
        // eslint-disable-next-line no-console
        console.log(`SELFTEST_FAIL ${f}`);
      }
      app.exit(ok ? 0 : 1);
    });
    // Safety net: never hang if the renderer never reports.
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        // eslint-disable-next-line no-console
        console.log('SELFTEST FAIL timeout');
        app.exit(1);
      }, 20000);
    });
  }

  // Headless self-screenshot: `electron . --screenshot=/path/out.png`
  // Loads, captures the real rendered window, writes the PNG, and quits. Lets
  // the dev verify the actual UI without a human sending screenshots.
  if (screenshotPath) {
    // When also running a --demo search, wait longer so the network search +
    // render completes before capturing (even longer for the selection demo).
    const settle = demoSelectFlag ? 8000 : demoQuery ? 4500 : 700;
    mainWindow.webContents.once('did-finish-load', async () => {
      setTimeout(async () => {
        try {
          const image = await mainWindow.webContents.capturePage();
          fs.writeFileSync(screenshotPath, image.toPNG());
          console.log(`SCREENSHOT_SAVED ${screenshotPath}`);
        } catch (err) {
          console.error('SCREENSHOT_FAILED', err.message);
        } finally {
          app.exit(0);
        }
      }, settle);
    });
  }

  // Open external links in the user's browser, not in-app — but only for
  // https:/mailto: (L5). Anything else (file:, javascript:, data:, http:) is
  // denied outright.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // L5: never let the renderer navigate the window away from our bundled UI.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow.webContents.getURL();
    if (url !== current) event.preventDefault();
  });
}

/**
 * Build an explicit application menu. Without this, Electron installs a default
 * menu and macOS auto-adds "Start Dictation", "Emoji & Symbols", and a system
 * find bar — any of which can appear as a stray overlay over the window.
 * We keep only standard, expected items.
 */
function buildMenu() {
  const template = buildMenuTemplate({
    isMac: process.platform === 'darwin',
    isDev,
    appName: app.name,
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------- IPC: auth -------------------------------- */

ipcMain.handle('auth:status', async () => {
  return creds
    ? { loggedIn: true, screenname: creds.screenname, itemname: creds.itemname, email: creds.email }
    : { loggedIn: false };
});

ipcMain.handle('auth:login', async (_e, { email, password }) => {
  try {
    const result = await ia.login(email, password);
    creds = result;
    store.saveCredentials(result);
    logger.info('auth: login ok', { screenname: result.screenname });
    return { loggedIn: true, screenname: result.screenname, itemname: result.itemname, email: result.email };
  } catch (err) {
    logger.warn('auth: login failed', { reason: err.message });
    throw err;
  }
});

ipcMain.handle('auth:logout', async () => {
  creds = null;
  store.clearCredentials();
  logger.info('auth: logout');
  return { loggedIn: false };
});

/* ------------------------------ IPC: search ------------------------------- */

ipcMain.handle('search:query', async (_e, { query, page, rows, sort }) => {
  return ia.search(query, { page, rows, sort });
});

// Build a Lucene query from structured advanced-search fields, then search.
ipcMain.handle('search:advanced', async (_e, { fields, page, rows, sort }) => {
  const query = buildAdvancedQuery(fields || {});
  const result = await ia.search(query, { page, rows, sort });
  return { ...result, query };
});

ipcMain.handle('search:buildQuery', async (_e, { fields }) => buildAdvancedQuery(fields || {}));

// #13: parse `field:value` meta keywords from the basic search box.
ipcMain.handle('search:parseInput', async (_e, { input, scope }) => parseSearchInput(input || '', scope));

ipcMain.handle('item:metadata', async (_e, { identifier }) => {
  validateIdentifier(identifier); // M6: re-validate at the boundary like every other handler
  return ia.getMetadata(identifier);
});

// #16: read-only derive/catalog task status for an item.
ipcMain.handle('item:tasks', async (_e, { identifier }) => {
  validateIdentifier(identifier);
  const json = await ia.getTasks(identifier);
  return parseTasks(json);
});

ipcMain.handle('prefs:formatPresets', async () =>
  FORMAT_PRESETS.map(({ key, label }) => ({ key, label }))
);

/* ----------------------------- IPC: settings ------------------------------ */

// Return settings with display/download prefs normalized to defaults (so a
// fresh install downloads PDF only, uses grid view, etc.).
ipcMain.handle('settings:get', async () => {
  const s = store.loadSettings();
  return { ...s, ...normalizePrefs(s) };
});
ipcMain.handle('settings:update', async (_e, patch) => {
  const next = store.updateSettings(patch);
  // #1: keep the logger's on/off state in sync when the pref changes.
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'logging')) {
    applyLoggingPref(next);
  }
  return next;
});
ipcMain.handle('settings:defaults', async () => ({ ...DEFAULT_PREFS }));

ipcMain.handle('dialog:chooseFolder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose download folder',
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

ipcMain.handle('shell:openPath', async (_e, p) => {
  // L5: only open a folder under the configured download root — never an
  // arbitrary path (opening a file would be a code-execution vector).
  const destRoot = store.loadSettings().destRoot || '';
  if (!isAllowedOpenPath(p, destRoot)) {
    return 'Refused: only the download folder can be opened.';
  }
  return shell.openPath(p);
});

// Open an external https URL in the user's browser (e.g. an item's details
// page after upload). Restricted to archive.org over https so the renderer
// can't turn this into an arbitrary-URL opener.
ipcMain.handle('shell:openExternal', async (_e, url) => {
  let host = '';
  try {
    const u = new URL(String(url));
    host = u.hostname;
    if (u.protocol !== 'https:' || !(host === 'archive.org' || host.endsWith('.archive.org'))) {
      return 'Refused: only https archive.org links can be opened.';
    }
  } catch {
    return 'Refused: invalid URL.';
  }
  await shell.openExternal(url);
  return '';
});

// Step the window zoom (banner +/- buttons), same effect as the View menu.
ipcMain.handle('view:zoom', async (event, delta) => {
  const wc = event.sender;
  const level = nextZoomLevel(wc.getZoomLevel(), delta);
  wc.setZoomLevel(level);
  return level;
});

// Open the app's own logs folder (a known, app-controlled path — safe).
ipcMain.handle('logs:open', async () => {
  const dir = logger.logDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* best effort */
  }
  return shell.openPath(dir);
});

/* ----------------------------- IPC: download ------------------------------ */

/**
 * Download one or more items. Each item is { identifier, title, files }.
 * `prefs` is { format, rename } — files are filtered by format preset and the
 * item title is optionally applied to each local filename (planDownload).
 *
 * For a single item with files already provided, this preserves the old shape.
 * If an item arrives without a file list, its metadata is fetched first.
 *
 * Progress is sent on 'download:progress'; the payload's `name` is the local
 * save-as name shown to the user.
 *
 * @param {import('../shared/types').DownloadStartPayload} payload
 */
ipcMain.handle('download:start', async (event, { jobId, items, prefs, destRoot, label }) => {
  const controller = new AbortController();
  downloadJobs.set(jobId, controller);
  const send = (payload) => {
    if (!event.sender.isDestroyed()) event.sender.send('download:progress', { jobId, ...payload });
  };
  const labelText = label || (items && items[0] && items[0].identifier) || 'download';
  persistJob(queueStore.describeDownloadJob({ jobId, items, prefs, destRoot, label: labelText }));
  const release = await enterTransferQueue(jobId, { kind: 'download', label: labelText }, send);
  try {
    // Cancelled while waiting in the queue — don't start the transfer.
    if (controller.signal.aborted) {
      send({ phase: 'error', message: 'Cancelled.' });
      return { ok: false, error: 'Cancelled.' };
    }
    return await handleDownloadStart({ items, prefs, destRoot, signal: controller.signal }, { ia, send, overload });
  } finally {
    downloadJobs.delete(jobId);
    // If the handler RETURNED at all (success, cancel, or handled failure), the
    // process didn't crash — so there's nothing to resume; drop the persisted
    // descriptor. Only an actual crash skips this finally and leaves it pending.
    forgetJob(jobId);
    leaveTransferQueue(jobId, release);
  }
});

/**
 * Download every member of a collection (#2). Scrapes the member identifiers
 * via the cursor-paged scraping API, then runs them through the normal download
 * pipeline (format filter, queue, checksum verify). Bounded by maxItems.
 */
ipcMain.handle('collection:download', async (event, { jobId, collection, prefs, destRoot, maxItems }) => {
  const controller = new AbortController();
  downloadJobs.set(jobId, controller);
  const send = (payload) => {
    if (!event.sender.isDestroyed()) event.sender.send('download:progress', { jobId, ...payload });
  };
  const collLabel = `Collection: ${collection}`;
  persistJob(queueStore.describeCollectionJob({ jobId, collection, prefs, destRoot, maxItems, label: collLabel }));
  const release = await enterTransferQueue(jobId, { kind: 'download', label: collLabel }, send);
  try {
    if (controller.signal.aborted) {
      send({ phase: 'error', message: 'Cancelled.' });
      return { ok: false, error: 'Cancelled.' };
    }
    validateIdentifier(collection);
    logger.info('collection: listing members', { collection });
    send({ phase: 'listing', message: `Listing members of ${collection}…` });
    const ids = await ia.scrapeAll(`collection:${collection}`, {
      maxItems: Number(maxItems) > 0 ? Number(maxItems) : Infinity,
      onProgress: ({ count }) => send({ phase: 'listing', message: `Found ${count} members…` }),
    });
    logger.info('collection: members listed', { collection, members: ids.length });
    if (!ids.length) {
      send({ phase: 'error', message: `No members found in collection "${collection}".` });
      return { ok: false, error: 'Empty collection.' };
    }
    const items = ids.map((identifier) => ({ identifier }));
    return await handleDownloadStart({ items, prefs, destRoot, signal: controller.signal }, { ia, send, overload });
  } catch (err) {
    logger.error('collection: download error', { collection, reason: err.message });
    send({ phase: 'error', message: err.message });
    return { ok: false, error: err.message };
  } finally {
    downloadJobs.delete(jobId);
    forgetJob(jobId); // returned (any outcome) ⇒ no crash ⇒ nothing to resume
    leaveTransferQueue(jobId, release);
  }
});

ipcMain.handle('download:cancel', async (_e, { jobId }) => {
  const c = downloadJobs.get(jobId);
  if (c) c.abort();
  return { cancelled: !!c };
});

// Reorder a WAITING transfer in the shared queue (drag-to-reorder). The active
// job can't be moved; the index is clamped inside the queue model.
ipcMain.handle('transfer:reorder', async (_e, { jobId, toIndex }) => {
  transferQueue.move(jobId, toIndex);
  broadcastQueueDepth();
  return { ok: true };
});

// Manually resume transfers after a server-overload pause/delay (the alert's
// "Resume" / "Resume now" button). Opens the gate immediately.
ipcMain.handle('transfer:resume', async () => {
  pauseGate.resume();
  broadcastQueueDepth();
  return { ok: true };
});

// Phase 2: the renderer accepted the resume offer — return the FULL pending
// descriptors so it can re-issue each via the normal start path (reusing the
// persisted jobId). The renderer drives re-issue; main can't (handlers need the
// renderer's event.sender for progress).
ipcMain.handle('transfer:resume-jobs', async () => {
  const jobs = pendingResumeJobs;
  pendingResumeJobs = []; // consumed — the renderer re-issues (and re-persists) them
  return jobs;
});

// Phase 2: the user discarded the resume offer — drop the persisted queue.
ipcMain.handle('transfer:discard-queue', async () => {
  store.clearQueue();
  pendingResumeJobs = [];
  return { ok: true };
});

/* ------------------------------ IPC: upload ------------------------------- */

ipcMain.handle('dialog:chooseFiles', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    title: 'Choose files to upload',
  });
  if (res.canceled) return [];
  return res.filePaths.map((p) => ({ path: p, name: path.basename(p), size: safeSize(p) }));
});

ipcMain.handle('upload:start', async (event, { jobId, identifier, files, metadata, derive }) => {
  if (!creds) return { ok: false, error: 'You must be logged in to upload.' };
  const controller = new AbortController();
  uploadJobs.set(jobId, controller);
  const send = (payload) => {
    if (!event.sender.isDestroyed()) event.sender.send('upload:progress', { jobId, ...payload });
  };
  // Serialize against downloads AND other uploads — one transfer at a time.
  persistJob(queueStore.describeUploadJob({ jobId, identifier, files, metadata, derive }));
  const release = await enterTransferQueue(jobId, { kind: 'upload', label: identifier }, send);
  try {
    if (controller.signal.aborted) {
      send({ phase: 'error', message: 'Cancelled.' });
      return { ok: false, error: 'Cancelled.' };
    }
    validateIdentifier(identifier);
    // Files go through the shared retry queue so a transient 503/429 is retried
    // (and honors Retry-After) instead of aborting the whole batch; consecutive
    // transient failures escalate to the overload pause/delay gate.
    return await handleUploadStart(
      { identifier, files, metadata, derive, signal: controller.signal },
      { ia, send, creds, overload }
    );
  } catch (err) {
    logger.error('upload error', { identifier, reason: err.message });
    send({ phase: 'error', message: err.message });
    return { ok: false, error: err.message };
  } finally {
    uploadJobs.delete(jobId);
    forgetJob(jobId); // returned (any outcome) ⇒ no crash ⇒ nothing to resume
    leaveTransferQueue(jobId, release);
  }
});

ipcMain.handle('upload:cancel', async (_e, { jobId }) => {
  const c = uploadJobs.get(jobId);
  if (c) c.abort();
  return { cancelled: !!c };
});

/* --------------------------- IPC: bulk upload (#14) ----------------------- */

// Choose a CSV and return a parsed upload plan (no upload happens here).
ipcMain.handle('bulk:choose', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Choose an upload spreadsheet (CSV)',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (res.canceled || !res.filePaths.length) return null;
  const csvPath = res.filePaths[0];
  try {
    const text = fs.readFileSync(csvPath, 'utf8');
    const rows = csv.parseCsv(text);
    const { plan, errors } = csv.buildUploadPlan(rows, { withErrors: true });
    // Resolve each file relative to the CSV's directory and flag missing files.
    const baseDir = path.dirname(csvPath);
    const resolved = plan.map((item) => {
      const files = item.files.map((rel) => {
        const abs = csv.resolveBulkFilePath(baseDir, rel);
        return { rel, path: abs, exists: fs.existsSync(abs), size: safeSize(abs) };
      });
      return { ...item, files };
    });
    logger.info('bulk: parsed CSV', { csvPath, items: resolved.length, errors: errors.length });
    return { csvPath, plan: resolved, errors };
  } catch (err) {
    logger.error('bulk: CSV parse error', { csvPath, reason: err.message });
    return { csvPath, plan: [], errors: [err.message] };
  }
});

// Run a parsed bulk plan: each item becomes a new IA upload. Reuses uploadFile.
ipcMain.handle('bulk:upload', async (event, { jobId, plan, derive }) => {
  if (!creds) return { ok: false, error: 'You must be logged in to upload.' };
  const controller = new AbortController();
  uploadJobs.set(jobId, controller);
  const send = (payload) => {
    if (!event.sender.isDestroyed()) event.sender.send('upload:progress', { jobId, ...payload });
  };
  const bulkLabel = `Bulk upload (${(plan || []).length} items)`;
  persistJob({ ...queueStore.describeBulkJob({ jobId, plan, derive }), label: bulkLabel });
  const release = await enterTransferQueue(jobId, { kind: 'upload', label: bulkLabel }, send);
  try {
    if (controller.signal.aborted) {
      send({ phase: 'error', message: 'Cancelled.' });
      return { ok: false, error: 'Cancelled.' };
    }
    // Each item's files go through the shared retry queue; the overload counter
    // persists across items so a server going down mid-bulk escalates correctly.
    return await handleBulkUpload(
      { plan, derive, signal: controller.signal },
      { ia, send, creds, overload, validateIdentifier }
    );
  } catch (err) {
    logger.error('bulk: upload error', { reason: err.message });
    send({ phase: 'error', message: err.message });
    return { ok: false, error: err.message };
  } finally {
    uploadJobs.delete(jobId);
    forgetJob(jobId); // returned (any outcome) ⇒ no crash ⇒ nothing to resume
    leaveTransferQueue(jobId, release);
  }
});

/* ----------------------------- IPC: metadata ------------------------------ */

ipcMain.handle('metadata:modify', async (_e, { identifier, patches }) => {
  if (!creds) return { ok: false, error: 'You must be logged in to edit metadata.' };
  try {
    validateIdentifier(identifier); // M2: don't trust the renderer-supplied id
    const r = await ia.modifyMetadata(identifier, patches, creds);
    return { ok: true, result: r };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// #16: build a JSON-Patch from an edit and apply it (server-side patch build).
ipcMain.handle('metadata:edit', async (_e, { identifier, original, edited }) => {
  if (!creds) return { ok: false, error: 'You must be logged in to edit metadata.' };
  try {
    validateIdentifier(identifier);
    const patch = buildMetadataPatch(original || {}, edited || {});
    if (!patch.length) return { ok: true, noChange: true };
    const r = await ia.modifyMetadata(identifier, patch, creds);
    return { ok: true, result: r, patch };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

/* ------------------------------- helpers ---------------------------------- */

function safeSize(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

/* ------------------------------ app lifecycle ----------------------------- */

/** #1: enable/disable the logger from the normalized `logging` pref. */
function applyLoggingPref(settings) {
  const prefs = normalizePrefs(settings || store.loadSettings());
  logger.setEnabled(prefs.logging);
}

app.whenReady().then(() => {
  if (isDev) logger.setThreshold('DEBUG');
  // #1: diagnostics/logging is OFF by default; honor the saved pref at startup.
  applyLoggingPref();
  logger.info('app: ready', { version: app.getVersion(), isDev });
  creds = store.loadCredentials();
  // Phase 2: load any transfers left unfinished by a previous session (crash or
  // quit mid-transfer). They're offered to the renderer once it has loaded.
  pendingResumeJobs = queueStore.pendingJobs(store.loadQueue());
  if (pendingResumeJobs.length) logger.info('queue: pending transfers from a previous session', { count: pendingResumeJobs.length });
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  logger.info('app: window-all-closed');
  if (process.platform !== 'darwin') app.quit();
});
