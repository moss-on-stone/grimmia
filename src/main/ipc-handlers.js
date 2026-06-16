'use strict';

/**
 * ipc-handlers.js
 *
 * Extracted, dependency-injected bodies for the heavier IPC handlers so they
 * can be unit-tested without Electron or the network (T2). The Electron
 * `ipcMain.handle` closures in main.js are thin wrappers that build the
 * `{ ia, send }` deps and delegate here.
 */

const path = require('node:path');

const { resolveDownloadPlan, isRealFile, parsePatterns, formatForItem, FORMAT_PRESETS } = require('./download-prefs');
const { normalizePrefs } = require('../shared/view-prefs');
const { validateDownloadItems, validateDestRoot, containWithin } = require('./ipc-validate');
const { verifyFile } = require('./checksum');
const { runQueue } = require('./download-queue');
const logger = require('./logger');

// Downloads always run ONE AT A TIME. archive.org throttles parallel transfers
// (503 SlowDown), so we never download more than one file concurrently. The
// queue is still used for its automatic retry/backoff on transient failures.
const DOWNLOAD_CONCURRENCY = 1;

// Short, user-facing names for format keys (for the fallback notice).
const FORMAT_LABELS = {
  pdf: 'PDF',
  text_pdf: 'searchable text PDF',
  epub: 'EPUB',
  text: 'plain text / DjVu',
  all: 'all available files',
};
function formatLabel(key) {
  if (FORMAT_LABELS[key]) return FORMAT_LABELS[key];
  const p = FORMAT_PRESETS.find((x) => x.key === key);
  return (p && p.label) || key;
}

/** Default inter-item pause (#16); injectable as `sleep` for tests. */
function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sanitize an identifier into a single safe directory segment. */
function sanitizeDir(name) {
  // eslint-disable-next-line no-control-regex
  return String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 200) || 'item';
}

/** Keep IA's internal subdirectories but strip traversal and unsafe chars. */
function sanitizeRel(name) {
  return String(name)
    .split('/')
    // eslint-disable-next-line no-control-regex
    .map((seg) => seg.replace(/[<>:"\\|?*\x00-\x1f]/g, '_'))
    .filter((seg) => seg && seg !== '.' && seg !== '..')
    .join(path.sep);
}

/**
 * Build the flat download work list from validated items. Items without a file
 * list have their metadata fetched via `ia.getMetadata`. Each entry carries the
 * item directory and the local save-as name.
 */
async function buildWorkList(items, { formatText, formatOther, rename, include, exclude, subfolders }, destRoot, ia) {
  const work = [];
  const fallbacks = []; // { identifier, usedFormat } per item that fell back
  let lastDir = destRoot;
  for (const item of items) {
    let files = item.files;
    let mediatype = item.mediatype;
    if (!files || !files.length) {
      const md = await ia.getMetadata(item.identifier);
      files = (md.files || []).filter(isRealFile);
      if (!item.title && md.metadata) {
        item.title = Array.isArray(md.metadata.title) ? md.metadata.title[0] : md.metadata.title;
      }
      if (mediatype == null && md.metadata) mediatype = md.metadata.mediatype;
    }
    // Choose the format from the item's mediatype: a "texts" item follows the
    // Text dropdown, anything else the Other dropdown. The texts fallback tail
    // (largest vs all) tracks the Other dropdown too.
    const { format, fallbackTail } = formatForItem(mediatype, formatText, formatOther);
    // Graceful fallback: if the chosen format matches nothing for this item,
    // take the next-best readable file instead of failing outright.
    const { plan, usedFormat, fellBack } = resolveDownloadPlan(files, {
      format,
      fallbackTail,
      rename,
      title: item.title || '',
      include,
      exclude,
    });
    if (fellBack) fallbacks.push({ identifier: item.identifier, usedFormat, requestedFormat: format });
    // #5: a per-item subfolder only when the pref is on; otherwise files go
    // straight into the destination folder (the default, "flat").
    const itemDir = subfolders ? path.join(destRoot, sanitizeDir(item.identifier)) : destRoot;
    lastDir = itemDir;
    for (const p of plan) {
      work.push({
        identifier: item.identifier,
        remote: p.name,
        saveAs: p.saveAs,
        size: p.size,
        itemDir,
        checksums: { md5: p.md5, sha1: p.sha1, crc32: p.crc32 },
      });
    }
  }
  return { work, lastDir, fallbacks };
}

/**
 * Run a download job. `deps.send(payload)` emits a `download:progress`-shaped
 * event; `deps.ia` is the IA client (real or a stub). `signal` is an optional
 * AbortSignal. Returns `{ ok, dir?, count?, error? }`.
 *
 * @param {{items: import('../shared/types').DownloadItem[], prefs: Object, destRoot: string, signal?: AbortSignal}} args
 * @param {{ia: Object, send: (p: import('../shared/types').ProgressEvent) => void, verify?: Function, log?: Object}} deps
 */
async function handleDownloadStart(
  { items, prefs, destRoot, signal },
  { ia, send, verify = verifyFile, log = logger, sleep = defaultSleep }
) {
  const np = normalizePrefs(prefs || {});
  // Two-dropdown format model: texts items use formatText (pdf/text_pdf/epub/
  // text), other mediatypes use formatOther (largest/all). Per-item choice is
  // made in buildWorkList via formatForItem.
  const formatText = np.formatText;
  const formatOther = np.formatOther;
  const rename = np.rename;
  const subfolders = np.downloadSubfolders; // #5
  const delayMs = np.downloadDelaySec * 1000; // #16: pause between items
  // #3: per-download glob include/exclude filters (raw strings from prefs).
  const include = parsePatterns((prefs || {}).includeGlobs);
  const exclude = parsePatterns((prefs || {}).excludeGlobs);

  try {
    validateDownloadItems(items);
    validateDestRoot(destRoot);

    const { work, lastDir, fallbacks } = await buildWorkList(items, { formatText, formatOther, rename, include, exclude, subfolders }, destRoot, ia);

    if (!work.length) {
      log.warn('download: no matching files', { items: items.length, formatText, formatOther });
      send({ phase: 'error', message: 'This item has no downloadable files.' });
      return { ok: false, error: 'No files to download.' };
    }
    // Soft warning: one or more items didn't have the chosen format, so we fell
    // back to the next-best file. Tell the user instead of failing.
    if (fallbacks && fallbacks.length) {
      const first = fallbacks[0];
      const used = formatLabel(first.usedFormat);
      const requested = formatLabel(first.requestedFormat);
      const message =
        fallbacks.length === 1
          ? `No “${requested}” for this item — downloading ${used} instead.`
          : `${fallbacks.length} item(s) had no “${requested}” — downloading ${used} instead.`;
      log.warn('download: format fallback', { requested: first.requestedFormat, used: first.usedFormat, items: fallbacks.length });
      send({ phase: 'notice', level: 'warn', message });
    }
    log.info('download started', { items: items.length, files: work.length, formatText, formatOther, dest: destRoot });

    // Resolve + containment-check every destPath up front so a traversal fails
    // fast before any network work (M3).
    const total = work.length;
    for (const w of work) {
      w.destPath = path.join(w.itemDir, sanitizeRel(w.saveAs));
      if (!containWithin(w.itemDir, w.destPath) || !containWithin(destRoot, w.destPath)) {
        throw new ia.IAError(`Refusing to write outside the download folder: ${w.saveAs}.`);
      }
    }

    // Run the files through the queue serially, with retry/backoff on 503s.
    let done = 0;
    // #16: pause `delayMs` between consecutive ITEMS (when the identifier
    // changes), never before the first file and never within one item's files.
    let prevIdentifier = null;

    const runner = async (w, i) => {
      if (delayMs > 0 && prevIdentifier != null && w.identifier !== prevIdentifier) {
        await sleep(delayMs);
      }
      prevIdentifier = w.identifier;
      send({ phase: 'file-start', index: i, total, name: w.saveAs });
      const r = await ia.downloadFile({
        url: ia.downloadUrl(w.identifier, w.remote),
        destPath: w.destPath,
        expectedSize: w.size,
        signal,
        onProgress: ({ received, total: t }) =>
          send({ phase: 'file-progress', index: i, total, name: w.saveAs, received, totalBytes: t }),
      });

      // #4: verify against the published checksum (skip already-complete files).
      let verified;
      if (!r.skipped) {
        try {
          verified = await verify(w.destPath, w.checksums || {});
        } catch {
          verified = 'unknown';
        }
      }
      done++;
      if (verified === 'mismatch') log.warn('download: checksum mismatch', { name: w.saveAs, identifier: w.identifier });
      else log.info('download: file done', { name: w.saveAs, skipped: !!r.skipped, verified: verified || 'n/a' });
      send({ phase: 'file-done', index: i, total, completed: done, name: w.saveAs, skipped: r.skipped, verified });
      return r;
    };

    const results = await runQueue(work, runner, {
      concurrency: DOWNLOAD_CONCURRENCY,
      maxRetries: 3,
      signal,
      onEvent: (e) => {
        if (e.type === 'retry') {
          log.warn('download: retrying file', { name: work[e.index].saveAs, attempt: e.attempt });
          send({ phase: 'file-retry', index: e.index, total, attempt: e.attempt, name: work[e.index].saveAs });
        }
      },
    });

    const failed = results.filter((r) => r && !r.ok);
    if (failed.length) {
      const first = failed[0].error;
      log.error('download: files failed', { failed: failed.length, reason: (first && first.message) || 'unknown' });
      // Abort/cancel produces failures too; surface the first real message.
      send({ phase: 'error', message: (first && first.message) || `${failed.length} file(s) failed to download.` });
      return { ok: false, error: (first && first.message) || 'Some files failed.' };
    }

    log.info('download complete', { count: done, dir: lastDir });
    send({ phase: 'complete', dir: lastDir, count: done });
    return { ok: true, dir: lastDir, count: done };
  } catch (err) {
    log.error('download error', { reason: err.message });
    send({ phase: 'error', message: err.message });
    return { ok: false, error: err.message };
  }
}

module.exports = { sanitizeDir, sanitizeRel, buildWorkList, handleDownloadStart };
