'use strict';

/**
 * Red/green TDD for the extracted IPC handler bodies (T2).
 *
 * The download:start logic is pulled out of the Electron `ipcMain.handle`
 * closure into `handleDownloadStart({items, prefs, destRoot, signal}, {ia, send})`
 * so it can be driven with a stub `ia` client and a `send` spy — asserting the
 * emitted progress-phase sequence, the early returns (C1/M2/M4 validation), and
 * the work-list construction, all without Electron or the network.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { handleDownloadStart, handleUploadStart, handleBulkUpload, sanitizeDir, sanitizeRel, boundedSaveAs } = require('../src/main/ipc-handlers');

// Keep logging out of the real userData during tests: point it at a throwaway
// dir. (node --test runs each file in its own process, so this is isolated.)
require('../src/main/logger').__setLogDir(fs.mkdtempSync(path.join(os.tmpdir(), 'ia-log-test-')));

/** A stub ia client: records downloadFile calls, never hits the network. */
function makeStubIa(overrides = {}) {
  const calls = [];
  return {
    calls,
    IAError: class IAError extends Error {},
    downloadUrl: (id, name) => `https://archive.org/download/${id}/${name}`,
    getMetadata: overrides.getMetadata || (async () => ({ metadata: { title: 'T' }, files: [] })),
    downloadFile: async (args) => {
      calls.push(args);
      if (args.onProgress) args.onProgress({ received: args.expectedSize || 1, total: args.expectedSize || 1 });
      return { path: args.destPath, bytes: args.expectedSize || 1, skipped: false };
    },
    ...overrides,
  };
}

function makeSendSpy() {
  const phases = [];
  return { send: (p) => phases.push(p), phases };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ia-dlstart-'));
}

/* --------- Windows-safe directory / relative-path sanitization ------------ */

test('sanitizeDir escapes a Windows reserved device name used as an identifier', () => {
  assert.notEqual(sanitizeDir('nul').toLowerCase(), 'nul');
  assert.notEqual(sanitizeDir('com1').toLowerCase(), 'com1');
});

test('sanitizeDir trims a trailing dot/space (Windows strips them on disk)', () => {
  assert.equal(sanitizeDir('my.item.'), 'my.item');
  assert.equal(sanitizeDir('spaced '), 'spaced');
});

test('sanitizeDir keeps an ordinary identifier and falls back to "item" for empties', () => {
  assert.equal(sanitizeDir('north-china-daily-news'), 'north-china-daily-news');
  assert.equal(sanitizeDir('...'), 'item');
});

test('sanitizeRel escapes reserved names and trims dots in EVERY interior segment', () => {
  // IA internal subdirectories: a reserved or trailing-dot interior segment must
  // be made Windows-safe too, not just the basename.
  const out = sanitizeRel('CON/sub./file.pdf');
  const segs = out.split(require('node:path').sep);
  assert.notEqual(segs[0].toLowerCase(), 'con', 'reserved interior dir escaped');
  assert.equal(segs[1], 'sub', 'trailing dot trimmed on interior dir');
  assert.equal(segs[2], 'file.pdf');
});

test('sanitizeRel drops . and .. traversal segments', () => {
  const out = sanitizeRel('a/../b/./c.txt');
  const segs = out.split(require('node:path').sep);
  assert.deepEqual(segs, ['a', 'b', 'c.txt']);
});

/* ---------------- Windows MAX_PATH (260) length bounding ------------------- */
// On Windows (without the long-path opt-in) the FULL path must stay under 260.
// boundedSaveAs shortens the filename's stem (keeping the extension) so
// itemDir + sep + saveAs fits. Driven with platform:'win32'.

test('boundedSaveAs leaves a short name unchanged', () => {
  assert.equal(boundedSaveAs('C:\\Dl\\item', 'book.pdf', 'win32'), 'book.pdf');
});

test('boundedSaveAs shortens an over-long filename but keeps the extension (win32)', () => {
  const itemDir = 'C:\\Downloads\\' + 'd'.repeat(150);
  const longName = 'n'.repeat(200) + '.pdf';
  const out = boundedSaveAs(itemDir, longName, 'win32');
  const full = itemDir + '\\' + out;
  assert.ok(full.length <= 260, `full path must fit 260, got ${full.length}`);
  assert.ok(out.endsWith('.pdf'), 'extension preserved');
  assert.ok(out.length > 4, 'still has a stem');
});

test('boundedSaveAs preserves the extension even when the dir is nearly 260 already (win32)', () => {
  const itemDir = 'C:\\' + 'x'.repeat(245);
  const out = boundedSaveAs(itemDir, 'report.pdf', 'win32');
  assert.ok(out.endsWith('.pdf'));
  const full = itemDir + '\\' + out;
  // Can't always fit (dir alone may already be huge), but the stem is minimized.
  assert.ok(out.length <= 'report.pdf'.length);
});

test('boundedSaveAs does NOT shorten on posix (long paths allowed)', () => {
  const itemDir = '/data/' + 'd'.repeat(300);
  const longName = 'n'.repeat(200) + '.pdf';
  assert.equal(boundedSaveAs(itemDir, longName, 'posix'), longName);
});

test('boundedSaveAs keeps interior IA subdirs intact, shortening only the basename (win32)', () => {
  const itemDir = 'C:\\Downloads\\' + 'd'.repeat(140);
  const rel = 'sub\\' + 'n'.repeat(200) + '.pdf';
  const out = boundedSaveAs(itemDir, rel, 'win32');
  assert.ok(out.startsWith('sub\\'), 'interior subdir preserved');
  assert.ok(out.endsWith('.pdf'));
  assert.ok((itemDir + '\\' + out).length <= 260);
});

test('rejects a non-array items payload with an error phase (C1)', async () => {
  const ia = makeStubIa();
  const { send, phases } = makeSendSpy();
  const dir = tmpDir();
  try {
    const res = await handleDownloadStart(
      { items: 'my-id', prefs: { format: 'all' }, destRoot: dir },
      { ia, send }
    );
    assert.equal(res.ok, false);
    assert.equal(phases.at(-1).phase, 'error');
    assert.match(phases.at(-1).message, /array|malformed/i);
    assert.equal(ia.calls.length, 0, 'must not download anything for a bad payload');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects an empty/absent destRoot with an error phase (M4)', async () => {
  const ia = makeStubIa();
  const { send, phases } = makeSendSpy();
  const res = await handleDownloadStart(
    { items: [{ identifier: 'good-id', files: [{ name: 'a.pdf', format: 'PDF', size: 1 }] }], prefs: {}, destRoot: '' },
    { ia, send }
  );
  assert.equal(res.ok, false);
  assert.equal(phases.at(-1).phase, 'error');
  assert.match(phases.at(-1).message, /folder|destination/i);
});

test('downloads provided files and emits the full phase sequence', async () => {
  const ia = makeStubIa();
  const { send, phases } = makeSendSpy();
  const dir = tmpDir();
  try {
    const res = await handleDownloadStart(
      {
        items: [{ identifier: 'good-id', title: 'My Title', files: [{ name: 'a.pdf', format: 'PDF', size: 100 }] }],
        prefs: { format: 'pdf', rename: 'off' },
        destRoot: dir,
      },
      { ia, send }
    );
    assert.equal(res.ok, true);
    assert.equal(res.count, 1);
    const seq = phases.map((p) => p.phase);
    assert.deepEqual(seq, ['file-start', 'file-progress', 'file-done', 'complete']);
    // #5: by default (no downloadSubfolders) the file goes straight into destRoot.
    assert.equal(ia.calls.length, 1);
    assert.equal(ia.calls[0].destPath, path.join(dir, 'a.pdf'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ----------------- per-download subfolders, flat default (#5) ------------- */

test('#5 default (flat): files download straight into the destination folder', async () => {
  const ia = makeStubIa();
  const { send } = makeSendSpy();
  const dir = tmpDir();
  try {
    const res = await handleDownloadStart(
      { items: [{ identifier: 'good-id', files: [{ name: 'a.pdf', format: 'PDF', size: 1 }] }], prefs: { format: 'pdf', rename: 'off' }, destRoot: dir },
      { ia, send }
    );
    assert.equal(res.ok, true);
    assert.equal(ia.calls[0].destPath, path.join(dir, 'a.pdf'), 'no per-item subfolder by default');
    assert.equal(res.dir, dir, 'open-folder points at the destination root');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('#5 with downloadSubfolders on: each item gets its own subfolder', async () => {
  const ia = makeStubIa();
  const { send } = makeSendSpy();
  const dir = tmpDir();
  try {
    const res = await handleDownloadStart(
      { items: [{ identifier: 'good-id', files: [{ name: 'a.pdf', format: 'PDF', size: 1 }] }], prefs: { format: 'pdf', rename: 'off', downloadSubfolders: true }, destRoot: dir },
      { ia, send }
    );
    assert.equal(res.ok, true);
    assert.equal(ia.calls[0].destPath, path.join(dir, 'good-id', 'a.pdf'), 'file under destRoot/<id>/');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* -------- mediatype-driven format: Text dropdown vs Other dropdown -------- */

test('a texts item follows the Text dropdown (formatText=pdf → image PDF only)', async () => {
  const ia = makeStubIa();
  const { send } = makeSendSpy();
  const dir = tmpDir();
  try {
    const files = [
      { name: 'book.pdf', format: 'Image Container PDF', size: 100 },
      { name: 'book_jp2.zip', format: 'Single Page Processed JP2 ZIP', size: 900 },
    ];
    const res = await handleDownloadStart(
      {
        items: [{ identifier: 'a-text', mediatype: 'texts', files }],
        prefs: { formatText: 'pdf', formatOther: 'largest', rename: 'off' },
        destRoot: dir,
      },
      { ia, send }
    );
    assert.equal(res.ok, true);
    assert.equal(ia.calls.length, 1, 'only the image PDF for a texts item on formatText=pdf');
    assert.match(ia.calls[0].destPath, /book\.pdf$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a non-texts item follows the Other dropdown (formatOther=largest)', async () => {
  const ia = makeStubIa();
  const { send } = makeSendSpy();
  const dir = tmpDir();
  try {
    // An audio item: largest format = the two MP3s (400) over the FLAC (350).
    const files = [
      { name: 'a.flac', format: 'FLAC', size: 350 },
      { name: 't1.mp3', format: 'VBR MP3', size: 200 },
      { name: 't2.mp3', format: 'VBR MP3', size: 200 },
    ];
    const res = await handleDownloadStart(
      {
        items: [{ identifier: 'an-audio', mediatype: 'audio', files }],
        prefs: { formatText: 'pdf', formatOther: 'largest', rename: 'off' },
        destRoot: dir,
      },
      { ia, send }
    );
    assert.equal(res.ok, true);
    const got = ia.calls.map((c) => c.destPath).sort();
    assert.equal(got.length, 2, 'both MP3s (largest format) download');
    assert.match(got[0], /t1\.mp3$/);
    assert.match(got[1], /t2\.mp3$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mediatype is read from fetched metadata when the item has no files', async () => {
  const ia = makeStubIa({
    getMetadata: async () => ({
      metadata: { title: 'Vid', mediatype: 'movies' },
      files: [
        { name: 'v.mp4', format: 'h.264', size: 900 },
        { name: 'v.gif', format: 'Animated GIF', size: 30 },
      ],
    }),
  });
  const { send } = makeSendSpy();
  const dir = tmpDir();
  try {
    const res = await handleDownloadStart(
      { items: [{ identifier: 'needs-meta' }], prefs: { formatText: 'pdf', formatOther: 'largest', rename: 'off' }, destRoot: dir },
      { ia, send }
    );
    assert.equal(res.ok, true);
    assert.equal(ia.calls.length, 1, 'largest format (mp4) only');
    assert.match(ia.calls[0].destPath, /v\.mp4$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* --------------------- inter-download delay (#16) ------------------------- */

test('#16 waits the configured delay BETWEEN items (not before the first, not within an item)', async () => {
  const ia = makeStubIa();
  const { send } = makeSendSpy();
  const dir = tmpDir();
  const sleeps = [];
  const sleep = async (ms) => { sleeps.push(ms); };
  try {
    const res = await handleDownloadStart(
      {
        items: [
          { identifier: 'item-a', files: [{ name: 'a1.pdf', format: 'PDF', size: 1 }, { name: 'a2.pdf', format: 'PDF', size: 1 }] },
          { identifier: 'item-b', files: [{ name: 'b1.pdf', format: 'PDF', size: 1 }] },
        ],
        prefs: { format: 'pdf', rename: 'off', downloadDelaySec: 5 },
        destRoot: dir,
      },
      { ia, send, sleep }
    );
    assert.equal(res.ok, true);
    // Exactly one inter-item pause (between item-a and item-b), of 5000ms.
    assert.deepEqual(sleeps, [5000], 'one 5s pause between the two items');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('#16 the inter-item sleep RECEIVES the abort signal so it can wake early (H6)', async () => {
  const ia = makeStubIa();
  const { send } = makeSendSpy();
  const dir = tmpDir();
  const controller = new AbortController();
  let sawSignal = false;
  const sleep = async (_ms, signal) => { sawSignal = !!(signal && typeof signal.aborted === 'boolean'); };
  try {
    await handleDownloadStart(
      {
        items: [
          { identifier: 'item-a', mediatype: 'texts', files: [{ name: 'a.pdf', format: 'Image Container PDF', size: 1 }] },
          { identifier: 'item-b', mediatype: 'texts', files: [{ name: 'b.pdf', format: 'Image Container PDF', size: 1 }] },
        ],
        prefs: { formatText: 'pdf', formatOther: 'largest', rename: 'off', downloadDelaySec: 5 },
        destRoot: dir,
        signal: controller.signal,
      },
      { ia, send, sleep }
    );
    assert.equal(sawSignal, true, 'the runner must pass the abort signal into sleep (H6)');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('#16 a cancel DURING the inter-item delay stops the queue before the next item (H6)', async () => {
  const ia = makeStubIa();
  const { send } = makeSendSpy();
  const dir = tmpDir();
  const controller = new AbortController();
  // Simulate the user cancelling while the pause is in progress: the sleep
  // aborts the controller and resolves. The runner must then NOT start item-b.
  const sleep = async (_ms) => { controller.abort(); };
  try {
    await handleDownloadStart(
      {
        items: [
          { identifier: 'item-a', mediatype: 'texts', files: [{ name: 'a.pdf', format: 'Image Container PDF', size: 1 }] },
          { identifier: 'item-b', mediatype: 'texts', files: [{ name: 'b.pdf', format: 'Image Container PDF', size: 1 }] },
        ],
        prefs: { formatText: 'pdf', formatOther: 'largest', rename: 'off', downloadDelaySec: 5 },
        destRoot: dir,
        signal: controller.signal,
      },
      { ia, send, sleep }
    );
    assert.equal(ia.calls.length, 1, 'cancel during the pause must stop item-b from downloading');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('#16 a zero delay pauses for nothing', async () => {
  const ia = makeStubIa();
  const { send } = makeSendSpy();
  const dir = tmpDir();
  const sleeps = [];
  const sleep = async (ms) => { sleeps.push(ms); };
  try {
    await handleDownloadStart(
      {
        items: [
          { identifier: 'item-a', files: [{ name: 'a1.pdf', format: 'PDF', size: 1 }] },
          { identifier: 'item-b', files: [{ name: 'b1.pdf', format: 'PDF', size: 1 }] },
        ],
        prefs: { format: 'pdf', rename: 'off', downloadDelaySec: 0 },
        destRoot: dir,
      },
      { ia, send, sleep }
    );
    assert.deepEqual(sleeps, [], 'no pauses when the delay is 0');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fetches metadata when an item arrives without files', async () => {
  let fetched = null;
  const ia = makeStubIa({
    getMetadata: async (id) => {
      fetched = id;
      return { metadata: { title: 'Fetched' }, files: [{ name: 'doc.pdf', format: 'PDF', size: 5 }] };
    },
  });
  const { send, phases } = makeSendSpy();
  const dir = tmpDir();
  try {
    const res = await handleDownloadStart(
      { items: [{ identifier: 'needs-meta' }], prefs: { format: 'pdf' }, destRoot: dir },
      { ia, send }
    );
    assert.equal(fetched, 'needs-meta');
    assert.equal(res.ok, true);
    assert.equal(phases.at(-1).phase, 'complete');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('falls back (soft notice) instead of erroring when the format is missing but other files exist', async () => {
  const ia = makeStubIa();
  const { send, phases } = makeSendSpy();
  const dir = tmpDir();
  try {
    // A texts item: Text dropdown = pdf, but it only has a plain-text file →
    // text-first fallback lands on the .txt and emits a soft notice.
    const res = await handleDownloadStart(
      { items: [{ identifier: 'good-id', mediatype: 'texts', files: [{ name: 'a.txt', format: 'Text', size: 1 }] }], prefs: { formatText: 'pdf', formatOther: 'largest' }, destRoot: dir },
      { ia, send }
    );
    assert.equal(res.ok, true, 'should download the fallback, not fail');
    const notice = phases.find((p) => p.phase === 'notice');
    assert.ok(notice, 'a soft notice phase should be emitted');
    assert.equal(notice.level, 'warn');
    assert.match(notice.message, /instead/i);
    assert.equal(ia.calls.length, 1, 'the fallback file is actually downloaded');
    assert.match(ia.calls[0].destPath, /a\.txt$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('emits an error phase ONLY when the item has no downloadable files at all', async () => {
  const ia = makeStubIa();
  const { send, phases } = makeSendSpy();
  const dir = tmpDir();
  try {
    const res = await handleDownloadStart(
      { items: [{ identifier: 'good-id', files: [{ name: 'x_meta.xml', format: 'Metadata', source: 'metadata' }] }], prefs: { format: 'pdf' }, destRoot: dir },
      { ia, send }
    );
    assert.equal(res.ok, false);
    assert.equal(phases.at(-1).phase, 'error');
    assert.match(phases.at(-1).message, /no downloadable files/i);
    assert.equal(ia.calls.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* --------------------------- checksum verify (#4) ------------------------- */

const crypto = require('node:crypto');

/** A stub ia whose downloadFile WRITES `content` to disk so it can be hashed. */
function makeWritingIa(content) {
  return {
    calls: [],
    IAError: class IAError extends Error {},
    downloadUrl: (id, name) => `https://archive.org/download/${id}/${name}`,
    getMetadata: async () => ({ metadata: { title: 'T' }, files: [] }),
    downloadFile: async (args) => {
      fs.mkdirSync(path.dirname(args.destPath), { recursive: true });
      fs.writeFileSync(args.destPath, content);
      return { path: args.destPath, bytes: content.length, skipped: false };
    },
  };
}

test('verifies a downloaded file against its published md5 and reports ok', async () => {
  const content = 'real bytes';
  const md5 = crypto.createHash('md5').update(content).digest('hex');
  const ia = makeWritingIa(content);
  const { send, phases } = makeSendSpy();
  const dir = tmpDir();
  try {
    const res = await handleDownloadStart(
      { items: [{ identifier: 'good-id', files: [{ name: 'a.pdf', format: 'PDF', size: content.length, md5 }] }], prefs: { format: 'pdf' }, destRoot: dir },
      { ia, send }
    );
    assert.equal(res.ok, true);
    const doneEvt = phases.find((p) => p.phase === 'file-done');
    assert.equal(doneEvt.verified, 'ok', 'file-done should report a verified checksum');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('flags a checksum mismatch on file-done (corrupt download)', async () => {
  const ia = makeWritingIa('corrupted content on disk');
  const { send, phases } = makeSendSpy();
  const dir = tmpDir();
  try {
    const res = await handleDownloadStart(
      {
        items: [{ identifier: 'good-id', files: [{ name: 'a.pdf', format: 'PDF', size: 5, md5: 'deadbeefdeadbeefdeadbeefdeadbeef' }] }],
        prefs: { format: 'pdf' },
        destRoot: dir,
      },
      { ia, send }
    );
    assert.equal(res.ok, true, 'job still completes (mismatch is a warning, not a hard fail)');
    const doneEvt = phases.find((p) => p.phase === 'file-done');
    assert.equal(doneEvt.verified, 'mismatch');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reports verified="unknown" when the file has no published checksum', async () => {
  const ia = makeWritingIa('anything');
  const { send, phases } = makeSendSpy();
  const dir = tmpDir();
  try {
    await handleDownloadStart(
      { items: [{ identifier: 'good-id', files: [{ name: 'a.pdf', format: 'PDF', size: 8 }] }], prefs: { format: 'pdf' }, destRoot: dir },
      { ia, send }
    );
    const doneEvt = phases.find((p) => p.phase === 'file-done');
    assert.equal(doneEvt.verified, 'unknown');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('downloads run ONE AT A TIME regardless of any concurrency hint (IA dislikes parallel)', async () => {
  // Track peak in-flight downloads; a serial pipeline never exceeds 1.
  let active = 0;
  let peak = 0;
  const ia = {
    IAError: class IAError extends Error {},
    downloadUrl: (id, name) => `https://archive.org/download/${id}/${name}`,
    getMetadata: async () => ({ metadata: {}, files: [] }),
    downloadFile: async (args) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setImmediate(r));
      active--;
      return { path: args.destPath, bytes: 1, skipped: false };
    },
  };
  const { send, phases } = makeSendSpy();
  const dir = tmpDir();
  try {
    const files = Array.from({ length: 6 }, (_, i) => ({ name: `f${i}.pdf`, format: 'PDF', size: 1 }));
    // Even if a stale `concurrency` setting is present, it must be ignored.
    const res = await handleDownloadStart(
      { items: [{ identifier: 'good-id', files }], prefs: { format: 'pdf', concurrency: 6 }, destRoot: dir },
      { ia, send, verify: async () => 'unknown' }
    );
    assert.equal(res.ok, true);
    assert.equal(res.count, 6, 'all six files downloaded');
    assert.equal(peak, 1, 'at most one download in flight at a time');
    assert.equal(phases.filter((p) => p.phase === 'file-done').length, 6);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('retries a transient 503 and emits a file-retry phase (#1)', async () => {
  let attempts = 0;
  const ia = {
    IAError: class IAError extends Error {},
    downloadUrl: (id, name) => `https://archive.org/download/${id}/${name}`,
    getMetadata: async () => ({ metadata: {}, files: [] }),
    downloadFile: async (args) => {
      attempts++;
      if (attempts < 2) throw { status: 503, message: 'SlowDown' };
      return { path: args.destPath, bytes: 1, skipped: false };
    },
  };
  const { send, phases } = makeSendSpy();
  const dir = tmpDir();
  try {
    const res = await handleDownloadStart(
      { items: [{ identifier: 'good-id', files: [{ name: 'a.pdf', format: 'PDF', size: 1 }] }], prefs: { format: 'pdf' }, destRoot: dir },
      { ia, send, verify: async () => 'unknown' }
    );
    assert.equal(res.ok, true);
    assert.equal(attempts, 2, 'one retry after the 503');
    assert.ok(phases.some((p) => p.phase === 'file-retry'), 'a file-retry phase should be emitted');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reports failure when a non-transient download error occurs (#1)', async () => {
  const ia = {
    IAError: class IAError extends Error {},
    downloadUrl: (id, name) => `https://archive.org/download/${id}/${name}`,
    getMetadata: async () => ({ metadata: {}, files: [] }),
    downloadFile: async () => {
      const e = new Error('Download failed (HTTP 404).');
      e.status = 404;
      throw e;
    },
  };
  const { send, phases } = makeSendSpy();
  const dir = tmpDir();
  try {
    const res = await handleDownloadStart(
      { items: [{ identifier: 'good-id', files: [{ name: 'a.pdf', format: 'PDF', size: 1 }] }], prefs: { format: 'pdf' }, destRoot: dir },
      { ia, send }
    );
    assert.equal(res.ok, false);
    assert.equal(phases.at(-1).phase, 'error');
    assert.match(phases.at(-1).message, /404|failed/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('applies per-download glob exclude filters (#3)', async () => {
  const ia = makeStubIa();
  const { send } = makeSendSpy();
  const dir = tmpDir();
  try {
    const res = await handleDownloadStart(
      {
        items: [
          {
            identifier: 'good-id',
            files: [
              { name: 'book_text.pdf', format: 'PDF', size: 1 },
              { name: 'book_bw.pdf', format: 'PDF', size: 1 },
            ],
          },
        ],
        prefs: { format: 'pdf', excludeGlobs: '*_bw.pdf' },
        destRoot: dir,
      },
      { ia, send }
    );
    assert.equal(res.ok, true);
    assert.equal(ia.calls.length, 1, 'only the non-excluded file should download');
    assert.match(ia.calls[0].destPath, /book_text\.pdf$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ---------- H4: verify checksum even on a size-based skip ------------------ */

test('a size-matched but checksum-MISMATCHED existing file is re-downloaded (H4)', async () => {
  // First call reports skipped (size matched on disk); verify says mismatch →
  // the runner must force a real re-download, then verify ok.
  let call = 0;
  const ia = {
    IAError: class IAError extends Error {},
    downloadUrl: (id, name) => `https://archive.org/download/${id}/${name}`,
    getMetadata: async () => ({ metadata: {}, files: [] }),
    downloadFile: async (args) => {
      call++;
      // 1st call: pretend the file already exists at the right size → skipped.
      if (call === 1 && !args.force) return { path: args.destPath, bytes: 5, skipped: true };
      // forced re-download writes fresh bytes.
      return { path: args.destPath, bytes: 5, skipped: false };
    },
  };
  const verifyCalls = [];
  const verify = async (_p, sums) => {
    verifyCalls.push(sums.md5);
    // mismatch on the first (skipped) check, ok after the forced re-download.
    return verifyCalls.length === 1 ? 'mismatch' : 'ok';
  };
  const { send, phases } = makeSendSpy();
  const dir = tmpDir();
  try {
    const res = await handleDownloadStart(
      { items: [{ identifier: 'good-id', mediatype: 'texts', files: [{ name: 'a.pdf', format: 'Image Container PDF', size: 5, md5: 'abc' }] }], prefs: { formatText: 'pdf', formatOther: 'largest' }, destRoot: dir },
      { ia, send, verify }
    );
    assert.equal(res.ok, true);
    assert.equal(call, 2, 'a checksum mismatch on the skipped file forces a re-download');
    const done = phases.find((p) => p.phase === 'file-done');
    assert.equal(done.verified, 'ok', 'the re-downloaded file verifies ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a size-matched checksum-OK existing file is NOT re-downloaded (H4 happy path)', async () => {
  let call = 0;
  const ia = {
    IAError: class IAError extends Error {},
    downloadUrl: (id, name) => `https://archive.org/download/${id}/${name}`,
    getMetadata: async () => ({ metadata: {}, files: [] }),
    downloadFile: async (args) => { call++; return { path: args.destPath, bytes: 5, skipped: true }; },
  };
  const verify = async () => 'ok';
  const { send, phases } = makeSendSpy();
  const dir = tmpDir();
  try {
    await handleDownloadStart(
      { items: [{ identifier: 'good-id', mediatype: 'texts', files: [{ name: 'a.pdf', format: 'Image Container PDF', size: 5, md5: 'abc' }] }], prefs: { formatText: 'pdf', formatOther: 'largest' }, destRoot: dir },
      { ia, send, verify }
    );
    assert.equal(call, 1, 'a verified-ok skipped file is not re-downloaded');
    const done = phases.find((p) => p.phase === 'file-done');
    assert.equal(done.verified, 'ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a skipped file with NO published checksum is not verified (nothing to check against)', async () => {
  const ia = {
    IAError: class IAError extends Error {},
    downloadUrl: (id, name) => `https://archive.org/download/${id}/${name}`,
    getMetadata: async () => ({ metadata: {}, files: [] }),
    downloadFile: async (args) => ({ path: args.destPath, bytes: 0, skipped: true }),
  };
  let verifyCalled = false;
  const verify = async () => { verifyCalled = true; return 'ok'; };
  const { send, phases } = makeSendSpy();
  const dir = tmpDir();
  try {
    // No md5/sha1/crc32 on the file → no checksum to verify against (H4).
    await handleDownloadStart(
      { items: [{ identifier: 'good-id', mediatype: 'texts', files: [{ name: 'a.pdf', format: 'Image Container PDF', size: 5 }] }], prefs: { formatText: 'pdf', formatOther: 'largest' }, destRoot: dir },
      { ia, send, verify }
    );
    const doneEvt = phases.find((p) => p.phase === 'file-done');
    assert.equal(doneEvt.skipped, true);
    assert.equal(verifyCalled, false, 'no checksum → skip verification');
    assert.ok(doneEvt.verified == null, 'no verification result when there is no checksum');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ===================== upload resilience (overload) ======================= */
// The old upload handlers aborted the ENTIRE batch on a single 503. Now uploads
// go through the same runQueue retry path as downloads, and consecutive
// transient failures escalate to the overload gate.

/** Stub ia with a programmable uploadFile. `behavior(callIndex, args)` returns a
 *  value (success) or throws (failure). Records every call's args. */
function makeUploadIa(behavior) {
  const calls = [];
  return {
    calls,
    IAError: class IAError extends Error {
      constructor(m, o = {}) {
        super(m);
        Object.assign(this, o);
      }
    },
    uploadFile: async (args) => {
      const idx = calls.length;
      calls.push(args);
      if (args.onProgress) args.onProgress({ sent: 1, total: 1 });
      return behavior(idx, args); // may throw
    },
  };
}

// backoffDelay:()=>0 so retries don't actually wait in tests.
const FAST = { backoffDelay: () => 0 };

test('upload retries a transient 503 on one file, then succeeds (no batch abort)', async () => {
  let firstFileTries = 0;
  const ia = makeUploadIa((idx, args) => {
    // First file 503s once, then succeeds; other files succeed immediately.
    if (args.filePath === '/f1') {
      firstFileTries++;
      if (firstFileTries < 2) throw Object.assign(new Error('SlowDown'), { status: 503 });
    }
    return { identifier: args.identifier, remote: args.filePath, bytes: 1 };
  });
  const { send, phases } = makeSendSpy();
  const res = await handleUploadStart(
    { jobId: 'u1', identifier: 'my-item', files: [{ name: 'a', path: '/f1' }, { name: 'b', path: '/f2' }], metadata: { title: 'T' } },
    { ia, send, queueOpts: FAST }
  );
  assert.equal(res.ok, true);
  assert.ok(phases.some((p) => p.phase === 'file-retry'), 'emitted a file-retry');
  assert.equal(phases.filter((p) => p.phase === 'file-done').length, 2, 'both files done');
  assert.ok(phases.some((p) => p.phase === 'complete'));
});

test('upload: a file that keeps 503ing fails THAT file but the batch continues', async () => {
  const ia = makeUploadIa((idx, args) => {
    if (args.filePath === '/bad') throw Object.assign(new Error('SlowDown'), { status: 503 });
    return { identifier: args.identifier, remote: args.filePath, bytes: 1 };
  });
  const { send, phases } = makeSendSpy();
  const res = await handleUploadStart(
    { jobId: 'u2', identifier: 'my-item', files: [{ name: 'ok', path: '/ok' }, { name: 'bad', path: '/bad' }], metadata: {} },
    { ia, send, queueOpts: FAST }
  );
  // The good file still completed even though /bad never did.
  assert.ok(phases.some((p) => p.phase === 'file-done' && p.name === 'ok'), 'good file finished');
  assert.equal(res.ok, false, 'overall result flags the failure');
});

test('upload: makeBucket is true only for the first file, and on its retry', async () => {
  let f0tries = 0;
  const ia = makeUploadIa((idx, args) => {
    if (idx === 0 && f0tries++ < 1) throw Object.assign(new Error('SlowDown'), { status: 503 });
    return { identifier: args.identifier, remote: args.filePath, bytes: 1 };
  });
  const { send } = makeSendSpy();
  await handleUploadStart(
    { jobId: 'u3', identifier: 'my-item', files: [{ name: 'a', path: '/a' }, { name: 'b', path: '/b' }], metadata: {} },
    { ia, send, queueOpts: FAST }
  );
  // Calls: [file0 attempt1 (makeBucket true), file0 retry (still true), file1 (false)]
  const bucketFlags = ia.calls.map((c) => c.makeBucket);
  assert.deepEqual(bucketFlags, [true, true, false], 'bucket-create only for index 0, preserved on retry');
});

test('upload: when the first file PERMANENTLY fails, the next file creates the bucket', () => {
  // makeBucket must follow the first file that actually TRANSFERS, not list index
  // 0 — otherwise files 1..n PUT to a never-created bucket and all fail.
  let f0 = 0;
  const ia = makeUploadIa((idx, args) => {
    if (args.filePath === '/a') {
      f0++;
      throw Object.assign(new Error('SlowDown'), { status: 503 }); // file 0 never succeeds
    }
    return { identifier: args.identifier, remote: args.filePath, bytes: 1 };
  });
  const { send } = makeSendSpy();
  return handleUploadStart(
    { jobId: 'u5', identifier: 'my-item', files: [{ name: 'a', path: '/a' }, { name: 'b', path: '/b' }], metadata: { title: 'T' }, derive: false },
    { ia, send, queueOpts: FAST }
  ).then(() => {
    // file 'b' is the first to transfer → it must create the bucket AND carry the metadata.
    const bCall = ia.calls.find((c) => c.filePath === '/b');
    assert.ok(bCall, 'file b was attempted');
    assert.equal(bCall.makeBucket, true, 'the first successfully-transferring file creates the bucket');
    assert.deepEqual(bCall.metadata, { title: 'T' }, 'metadata travels with the bucket-creating file');
  });
});

test('upload waits on the overload gate before each file and reports failures to it', async () => {
  const observed = [];
  let waited = 0;
  const overload = {
    wait: async () => {
      waited++;
    },
    observe: (e) => observed.push(e.type),
  };
  const ia = makeUploadIa((idx, args) => ({ identifier: args.identifier, remote: args.filePath, bytes: 1 }));
  const { send } = makeSendSpy();
  await handleUploadStart(
    { jobId: 'u4', identifier: 'my-item', files: [{ name: 'a', path: '/a' }, { name: 'b', path: '/b' }], metadata: {} },
    { ia, send, overload, queueOpts: FAST }
  );
  assert.equal(waited, 2, 'gate.wait() awaited before each file');
  assert.ok(observed.includes('done'), 'overload.observe saw the queue events');
});

test('bulk upload retries transient failures per file and keeps going across items', async () => {
  let bad = 0;
  const ia = makeUploadIa((idx, args) => {
    if (args.filePath === '/i1f1' && bad++ < 1) throw Object.assign(new Error('SlowDown'), { status: 503 });
    return { identifier: args.identifier, remote: args.filePath, bytes: 1 };
  });
  const { send, phases } = makeSendSpy();
  const plan = [
    { identifier: 'item1', metadata: {}, files: [{ rel: 'f1', path: '/i1f1', exists: true }] },
    { identifier: 'item2', metadata: {}, files: [{ rel: 'f2', path: '/i2f1', exists: true }] },
  ];
  const res = await handleBulkUpload({ jobId: 'b1', plan }, { ia, send, queueOpts: FAST, existsSync: () => true });
  assert.equal(res.ok, true);
  assert.equal(phases.filter((p) => p.phase === 'item-done').length, 2, 'both items completed');
  assert.ok(phases.some((p) => p.phase === 'file-retry'), 'retried the transient failure');
});

test('bulk upload re-checks file existence at run time (stale exists from queue.json)', async () => {
  // On crash-resume the persisted f.exists is from parse time. A file present NOW
  // but recorded exists:false must still be uploaded (and vice-versa).
  const ia = makeUploadIa((idx, args) => ({ identifier: args.identifier, remote: args.filePath, bytes: 1 }));
  const { send, phases } = makeSendSpy();
  const plan = [
    { identifier: 'item1', metadata: {}, files: [{ rel: 'now-here', path: '/present', exists: false }] }, // stale false
    { identifier: 'item2', metadata: {}, files: [{ rel: 'now-gone', path: '/absent', exists: true }] }, // stale true
  ];
  // Inject existence: only /present exists now.
  const res = await handleBulkUpload(
    { jobId: 'b3', plan },
    { ia, send, queueOpts: FAST, existsSync: (p) => p === '/present' }
  );
  const uploaded = ia.calls.map((c) => c.filePath);
  assert.ok(uploaded.includes('/present'), 'a now-present file is uploaded despite stale exists:false');
  assert.ok(!uploaded.includes('/absent'), 'a now-absent file is skipped despite stale exists:true');
  // item2 had no existing files now → item-skip.
  assert.ok(phases.some((p) => p.phase === 'item-skip' && p.identifier === 'item2'));
  assert.equal(res.ok, true);
});

test('bulk upload STOPS at the next item when cancelled mid-plan', async () => {
  // Abort after the first item; the plan loop must not churn the remaining items.
  const ac = new AbortController();
  const ia = makeUploadIa((idx, args) => {
    if (args.identifier === 'item1') ac.abort(); // cancel during/after item1
    return { identifier: args.identifier, remote: args.filePath, bytes: 1 };
  });
  const { send, phases } = makeSendSpy();
  const plan = [
    { identifier: 'item1', metadata: {}, files: [{ rel: 'f1', path: '/a', exists: true }] },
    { identifier: 'item2', metadata: {}, files: [{ rel: 'f2', path: '/b', exists: true }] },
    { identifier: 'item3', metadata: {}, files: [{ rel: 'f3', path: '/c', exists: true }] },
  ];
  const res = await handleBulkUpload({ jobId: 'b2', plan, signal: ac.signal }, { ia, send, queueOpts: FAST, existsSync: () => true });
  const started = phases.filter((p) => p.phase === 'item-start').map((p) => p.identifier);
  assert.ok(!started.includes('item3'), 'must not start item3 after cancel');
  assert.equal(res.ok, false, 'a cancelled bulk is not a success');
  assert.match(res.error || '', /cancel/i);
});

test('bulk upload rejects an empty/non-array plan', async () => {
  const ia = makeUploadIa(() => ({ bytes: 1 }));
  const { send, phases } = makeSendSpy();
  const res = await handleBulkUpload({ jobId: 'be', plan: [] }, { ia, send, queueOpts: FAST });
  assert.equal(res.ok, false);
  assert.ok(phases.some((p) => p.phase === 'error'), 'emits an error phase');
});

test('bulk upload item-skips an item whose files are all absent, and still completes others', async () => {
  const ia = makeUploadIa((idx, args) => ({ identifier: args.identifier, remote: args.filePath, bytes: 1 }));
  const { send, phases } = makeSendSpy();
  const plan = [
    { identifier: 'empty', metadata: {}, files: [{ rel: 'gone', path: '/gone', exists: true }] },
    { identifier: 'real', metadata: {}, files: [{ rel: 'here', path: '/here', exists: true }] },
  ];
  const res = await handleBulkUpload({ jobId: 'bs', plan }, { ia, send, queueOpts: FAST, existsSync: (p) => p === '/here' });
  assert.ok(phases.some((p) => p.phase === 'item-skip' && p.identifier === 'empty'));
  assert.ok(phases.some((p) => p.phase === 'item-done' && p.identifier === 'real'));
  assert.equal(res.ok, true);
});

test('bulk upload reports ok:false when an item has a persistently-failing file, but still completes + continues', async () => {
  const ia = makeUploadIa((idx, args) => {
    if (args.filePath === '/bad') throw Object.assign(new Error('SlowDown'), { status: 503 });
    return { identifier: args.identifier, remote: args.filePath, bytes: 1 };
  });
  const { send, phases } = makeSendSpy();
  const plan = [
    { identifier: 'i1', metadata: {}, files: [{ rel: 'bad', path: '/bad', exists: true }] },
    { identifier: 'i2', metadata: {}, files: [{ rel: 'ok', path: '/ok', exists: true }] },
  ];
  const res = await handleBulkUpload({ jobId: 'bf', plan }, { ia, send, queueOpts: FAST, existsSync: () => true });
  assert.equal(res.ok, false, 'a failed file makes the bulk ok:false');
  assert.equal(phases.filter((p) => p.phase === 'item-done').length, 2, 'both items still emit item-done');
  assert.ok(phases.some((p) => p.phase === 'complete'), 'complete still fires');
});

test('handleUploadStart errors on an empty / missing file list', async () => {
  const ia = makeUploadIa(() => ({ bytes: 1 }));
  const a = makeSendSpy();
  const r1 = await handleUploadStart({ jobId: 'e1', identifier: 'i', files: [], metadata: {} }, { ia, send: a.send, queueOpts: FAST });
  assert.equal(r1.ok, false);
  assert.ok(a.phases.some((p) => p.phase === 'error' && /no files/i.test(p.message)));
  const b = makeSendSpy();
  const r2 = await handleUploadStart({ jobId: 'e2', identifier: 'i', metadata: {} }, { ia, send: b.send, queueOpts: FAST });
  assert.equal(r2.ok, false, 'missing files also errors');
});
