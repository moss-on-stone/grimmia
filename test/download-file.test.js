'use strict';

/**
 * Red/green TDD for H1: downloadFile resume/integrity (T1).
 *
 * Driven entirely over a loopback http server — no archive.org traffic.
 *
 * Covers:
 *  - skip when a complete file already exists (size known)
 *  - resume a partial file via a valid 206 Content-Range
 *  - a 206 whose Content-Range does NOT start at startByte is rejected/restarted
 *    rather than blindly appended (corruption guard)
 *  - a file with NO known size is downloaded fresh ('w'), not resumed/appended
 *  - a short body (received < known total) is rejected, not resolved "ok"
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ia = require('../src/main/ia-client');
const { startServer } = require('./helpers/loopback-server');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-dl-'));
  return path.join(dir, 'out.bin');
}

test('skips download when the file already exists at the expected size', async () => {
  const dest = tmpFile();
  fs.writeFileSync(dest, 'HELLO'); // 5 bytes
  let served = false;
  const srv = await startServer((_req, res) => {
    served = true;
    res.end('HELLO');
  });
  try {
    const r = await ia.downloadFile({ url: `${srv.url}/file`, destPath: dest, expectedSize: 5 });
    assert.equal(r.skipped, true);
    assert.equal(served, false, 'server must not be hit when the file is already complete');
  } finally {
    await srv.close();
  }
});

test('resumes a partial download via a valid 206 and ends with the full file', async () => {
  const dest = tmpFile();
  const full = 'ABCDEFGHIJ'; // 10 bytes
  fs.writeFileSync(dest, full.slice(0, 4)); // "ABCD" already present
  const srv = await startServer((req, res) => {
    const range = req.headers.range; // expect "bytes=4-"
    assert.ok(range, 'client should send a Range header to resume');
    const start = Number(range.replace('bytes=', '').split('-')[0]);
    const slice = full.slice(start);
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${full.length - 1}/${full.length}`,
      'Content-Length': String(slice.length),
    });
    res.end(slice);
  });
  try {
    const r = await ia.downloadFile({ url: `${srv.url}/file`, destPath: dest, expectedSize: 10 });
    assert.equal(r.skipped, false);
    assert.equal(fs.readFileSync(dest, 'utf8'), full, 'resumed file should equal the full content');
  } finally {
    await srv.close();
  }
});

test('rejects/restarts when a 206 Content-Range does not start at the requested byte', async () => {
  const dest = tmpFile();
  const full = 'ABCDEFGHIJ';
  fs.writeFileSync(dest, full.slice(0, 4)); // "ABCD", will request bytes=4-
  // Misbehaving server: ignores the Range and returns bytes from 0 with a 206
  // Content-Range claiming 0-. Blindly appending would corrupt ("ABCD"+full).
  const srv = await startServer((_req, res) => {
    res.writeHead(206, {
      'Content-Range': `bytes 0-${full.length - 1}/${full.length}`,
      'Content-Length': String(full.length),
    });
    res.end(full);
  });
  try {
    const r = await ia.downloadFile({ url: `${srv.url}/file`, destPath: dest, expectedSize: 10 });
    // Either way, the resulting file must be the correct full content, never the
    // corrupted "ABCD" + full concatenation.
    assert.equal(r.skipped, false);
    assert.equal(fs.readFileSync(dest, 'utf8'), full, 'must not blindly append a mismatched range');
  } finally {
    await srv.close();
  }
});

test('an existing same-name file is SKIPPED by default (the skip-if-downloaded feature)', async () => {
  const dest = tmpFile();
  fs.writeFileSync(dest, 'OLD CONTENT'); // already on disk, same name
  let served = false;
  const srv = await startServer((_req, res) => {
    served = true;
    res.end('NEW CONTENT');
  });
  try {
    // No known size, but the file exists → assume already downloaded, skip it.
    const r = await ia.downloadFile({ url: `${srv.url}/file`, destPath: dest, expectedSize: undefined });
    assert.equal(r.skipped, true, 'an existing same-name file is skipped');
    assert.equal(served, false, 'the server must not be hit when skipping');
    assert.equal(fs.readFileSync(dest, 'utf8'), 'OLD CONTENT', 'the existing file is left untouched');
  } finally {
    await srv.close();
  }
});

test('force overwrites an existing file fresh (no resume/append), even with unknown size', async () => {
  const dest = tmpFile();
  const full = 'ABCDEFGHIJ';
  // force=true (the reDownload pref) re-downloads. With unknown size it must NOT
  // send a Range header (no append) — it overwrites from byte 0.
  fs.writeFileSync(dest, 'STALE');
  let sawRange = null;
  const srv = await startServer((req, res) => {
    sawRange = req.headers.range || null;
    res.writeHead(200, { 'Content-Length': String(full.length) });
    res.end(full);
  });
  try {
    const r = await ia.downloadFile({ url: `${srv.url}/file`, destPath: dest, expectedSize: undefined, force: true });
    assert.equal(r.skipped, false, 'force must re-download, not skip');
    assert.equal(sawRange, null, 'no Range header when re-downloading fresh');
    assert.equal(fs.readFileSync(dest, 'utf8'), full, 'file is overwritten with the fresh content');
  } finally {
    await srv.close();
  }
});

test('rejects when the connection drops mid-stream (short of the known size)', async () => {
  const dest = tmpFile();
  // Server promises 10 bytes, writes 4, then destroys the socket — exactly what
  // a dropped connection looks like. This must NOT resolve "successfully" with a
  // truncated 4-byte file.
  const srv = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Length': '10' });
    res.write('ABCD');
    res.socket.destroy(); // drop the connection mid-body
  });
  try {
    await assert.rejects(
      ia.downloadFile({ url: `${srv.url}/file`, destPath: dest, expectedSize: 10 }),
      /incomplete|dropped|closed|connection|bytes|hang up|socket|reset/i
    );
  } finally {
    await srv.close();
  }
});

/* --------------------------- C1: idle timeout ----------------------------- */

test('rejects with a timeout when the server stalls before sending headers (C1)', async () => {
  const dest = tmpFile();
  // Server accepts the socket and never responds → without a timeout this hangs
  // forever (and would freeze the whole transfer queue).
  const srv = await startServer((_req, _res) => {
    /* never write, never end */
  });
  try {
    await assert.rejects(
      ia.downloadFile({ url: `${srv.url}/file`, destPath: dest, expectedSize: 10, timeoutMs: 150 }),
      /timed out|timeout/i
    );
  } finally {
    await srv.close();
  }
});

test('rejects with a timeout when the body STALLS mid-stream (idle timeout) (C1)', async () => {
  const dest = tmpFile();
  // Sends headers + a few bytes, then goes silent (socket stays open). Only an
  // idle timeout — not on('close')/on('aborted') — can catch this.
  const srv = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Length': '10' });
    res.write('AB');
    // never write the rest, never end, keep the socket open
  });
  try {
    await assert.rejects(
      ia.downloadFile({ url: `${srv.url}/file`, destPath: dest, expectedSize: 10, timeoutMs: 150 }),
      /timed out|timeout/i
    );
  } finally {
    await srv.close();
  }
});

test('a steady stream does NOT trip the idle timeout (timer resets per chunk) (C1)', async () => {
  const dest = tmpFile();
  const full = 'ABCDEFGHIJ';
  // Drip a byte every 40ms; total ~400ms > the 150ms idle timeout, but each
  // chunk resets the idle timer, so it should complete, not time out.
  const srv = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Length': String(full.length) });
    let i = 0;
    const t = setInterval(() => {
      if (i < full.length) {
        res.write(full[i++]);
      } else {
        clearInterval(t);
        res.end();
      }
    }, 40);
  });
  try {
    const r = await ia.downloadFile({ url: `${srv.url}/file`, destPath: dest, expectedSize: 10, timeoutMs: 150 });
    assert.equal(r.bytes, full.length);
    assert.equal(fs.readFileSync(dest, 'utf8'), full);
  } finally {
    await srv.close();
  }
});

/* ------------------ H3: force re-download bypasses skip -------------------- */

test('force:true re-downloads even when a same-size file already exists (H4/H3)', async () => {
  const dest = tmpFile();
  fs.writeFileSync(dest, 'WRONG'); // 5 bytes, same size, wrong content
  let served = false;
  const srv = await startServer((_req, res) => {
    served = true;
    res.writeHead(200, { 'Content-Length': '5' });
    res.end('RIGHT');
  });
  try {
    const r = await ia.downloadFile({ url: `${srv.url}/file`, destPath: dest, expectedSize: 5, force: true });
    assert.equal(served, true, 'force must hit the server despite the size match');
    assert.equal(r.skipped, false);
    assert.equal(fs.readFileSync(dest, 'utf8'), 'RIGHT', 'force overwrites the wrong file');
  } finally {
    await srv.close();
  }
});

test('rejects a cleanly-ended body that is shorter than the known size (finish check)', async () => {
  const dest = tmpFile();
  // Chunked (no Content-Length): the stream ends cleanly after 4 bytes, so no
  // socket error fires — only the on-finish size check (received !== known)
  // can catch this truncation.
  const srv = await startServer((_req, res) => {
    res.writeHead(200); // chunked transfer-encoding, no Content-Length
    res.end('ABCD'); // clean end, but only 4 of the expected 10 bytes
  });
  try {
    await assert.rejects(
      ia.downloadFile({ url: `${srv.url}/file`, destPath: dest, expectedSize: 10 }),
      /incomplete|of 10 bytes/i
    );
  } finally {
    await srv.close();
  }
});
