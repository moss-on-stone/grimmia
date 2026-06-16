'use strict';

/**
 * Red/green TDD for C1: item-detail downloads passed the wrong argument shape.
 *
 * `startDownload(items, label)` expects `items` to be an ARRAY of
 * { identifier, title, files? } objects. The item-modal buttons used to call it
 * with (identifierString, fileArray) — so main.js iterated the *characters* of
 * the identifier string. We extract a pure helper, `toDownloadItems`, that the
 * modal callers use to build the documented shape, and pin its contract here.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const u = require('../src/renderer/ui-util');

test('toDownloadItems wraps a single item with its files into the array shape', () => {
  const files = [{ name: 'a.pdf', size: 10 }, { name: 'b.txt', size: 5 }];
  const out = u.toDownloadItems('my-id', 'My Title', files);
  assert.deepEqual(out, [{ identifier: 'my-id', title: 'My Title', files }]);
});

test('toDownloadItems always returns an array (never a bare string)', () => {
  const out = u.toDownloadItems('my-id', 'My Title', [{ name: 'a.pdf' }]);
  assert.ok(Array.isArray(out), 'result must be an array');
  assert.equal(out.length, 1);
  assert.equal(typeof out[0], 'object');
  assert.equal(out[0].identifier, 'my-id');
});

test('toDownloadItems omits files when none are provided (let main fetch them)', () => {
  const out = u.toDownloadItems('my-id', 'My Title');
  assert.deepEqual(out, [{ identifier: 'my-id', title: 'My Title' }]);
  assert.ok(!('files' in out[0]), 'no files key when files omitted');
});

test('toDownloadItems omits files for an empty file array', () => {
  const out = u.toDownloadItems('my-id', 'My Title', []);
  assert.ok(!('files' in out[0]), 'empty file list should not be passed through');
});

test('toDownloadItems falls back to identifier when title is blank', () => {
  const out = u.toDownloadItems('my-id', '', [{ name: 'a.pdf' }]);
  assert.equal(out[0].title, 'my-id');
});

test('toDownloadItems carries mediatype when provided (for Text/Other format choice)', () => {
  const out = u.toDownloadItems('my-id', 'My Title', [{ name: 'a.pdf' }], 'texts');
  assert.equal(out[0].mediatype, 'texts');
});

test('toDownloadItems omits mediatype when not provided', () => {
  const out = u.toDownloadItems('my-id', 'My Title', [{ name: 'a.pdf' }]);
  assert.ok(!('mediatype' in out[0]), 'no mediatype key when omitted');
});

/* ----------------------------- makeJobIdFactory --------------------------- */
/**
 * H5: jobSeq reset to 0 on every renderer reload, so a reload during an
 * in-flight job could collide jobIds — and one job's cleanup would remove the
 * other's controller. A per-session random prefix makes two "sessions" (two
 * factories) never collide even when both start counting from 1.
 */

test('makeJobIdFactory yields unique ids within a session', () => {
  const next = u.makeJobIdFactory('abc123');
  const a = next();
  const b = next();
  assert.notEqual(a, b);
});

test('makeJobIdFactory ids carry the session prefix so two sessions never collide', () => {
  const s1 = u.makeJobIdFactory('aaaaaa');
  const s2 = u.makeJobIdFactory('bbbbbb');
  // Both sessions emit their first id; the prefixes must differ.
  assert.notEqual(s1(), s2());
  assert.match(s1(), /aaaaaa/);
  assert.match(s2(), /bbbbbb/);
});

test('makeJobIdFactory generates a random prefix when none is supplied', () => {
  const a = u.makeJobIdFactory();
  const b = u.makeJobIdFactory();
  // Independent factories with auto prefixes should not produce the same first id.
  assert.notEqual(a(), b());
});
