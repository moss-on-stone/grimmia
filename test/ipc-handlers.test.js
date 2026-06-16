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

const { handleDownloadStart } = require('../src/main/ipc-handlers');

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
    // Requested 'pdf' but the item only has a plain-text file → fall back to it.
    const res = await handleDownloadStart(
      { items: [{ identifier: 'good-id', files: [{ name: 'a.txt', format: 'Text', size: 1 }] }], prefs: { format: 'pdf' }, destRoot: dir },
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

test('skips verification for an already-complete (skipped) file', async () => {
  const ia = {
    IAError: class IAError extends Error {},
    downloadUrl: (id, name) => `https://archive.org/download/${id}/${name}`,
    getMetadata: async () => ({ metadata: {}, files: [] }),
    downloadFile: async (args) => ({ path: args.destPath, bytes: 0, skipped: true }),
  };
  const { send, phases } = makeSendSpy();
  const dir = tmpDir();
  try {
    await handleDownloadStart(
      { items: [{ identifier: 'good-id', files: [{ name: 'a.pdf', format: 'PDF', size: 5, md5: 'x' }] }], prefs: { format: 'pdf' }, destRoot: dir },
      { ia, send }
    );
    const doneEvt = phases.find((p) => p.phase === 'file-done');
    assert.equal(doneEvt.skipped, true);
    assert.ok(doneEvt.verified == null, 'skipped files are not re-verified');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
