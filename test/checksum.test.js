'use strict';

/**
 * Red/green TDD for idea #4: verify downloaded files against the checksum IA
 * publishes in item metadata (md5 / sha1 / crc32 per file).
 *
 *  - pickChecksum(file): choose the strongest available published hash.
 *  - hashFile(path, algo): stream-hash a local file.
 *  - verifyFile(path, file): true/false/'unknown' against the file's metadata.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { pickChecksum, hashFile, verifyFile } = require('../src/main/checksum');

function tmpWith(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-ck-'));
  const p = path.join(dir, 'f.bin');
  fs.writeFileSync(p, content);
  return p;
}

/* ------------------------------ pickChecksum ------------------------------ */

test('pickChecksum prefers sha1 over md5 over crc32', () => {
  assert.deepEqual(pickChecksum({ sha1: 'aaa', md5: 'bbb', crc32: 'ccc' }), { algo: 'sha1', value: 'aaa' });
  assert.deepEqual(pickChecksum({ md5: 'bbb', crc32: 'ccc' }), { algo: 'md5', value: 'bbb' });
  assert.deepEqual(pickChecksum({ crc32: 'ccc' }), { algo: 'crc32', value: 'ccc' });
});

test('pickChecksum returns null when no usable checksum is present', () => {
  assert.equal(pickChecksum({}), null);
  assert.equal(pickChecksum({ size: '10' }), null);
  assert.equal(pickChecksum(null), null);
});

/* -------------------------------- hashFile -------------------------------- */

test('hashFile computes the md5 of a file', async () => {
  const content = 'hello world';
  const p = tmpWith(content);
  const expected = crypto.createHash('md5').update(content).digest('hex');
  assert.equal(await hashFile(p, 'md5'), expected);
});

test('hashFile computes the sha1 of a file', async () => {
  const content = 'archive.org';
  const p = tmpWith(content);
  const expected = crypto.createHash('sha1').update(content).digest('hex');
  assert.equal(await hashFile(p, 'sha1'), expected);
});

/* -------------------------------- verifyFile ------------------------------ */

test('verifyFile returns "ok" when the md5 matches', async () => {
  const content = 'verify me';
  const p = tmpWith(content);
  const md5 = crypto.createHash('md5').update(content).digest('hex');
  assert.equal(await verifyFile(p, { md5 }), 'ok');
});

test('verifyFile returns "mismatch" when the checksum differs', async () => {
  const p = tmpWith('actual content');
  assert.equal(await verifyFile(p, { md5: 'deadbeefdeadbeefdeadbeefdeadbeef' }), 'mismatch');
});

test('verifyFile is case-insensitive on the hex digest', async () => {
  const content = 'CASE';
  const p = tmpWith(content);
  const md5 = crypto.createHash('md5').update(content).digest('hex').toUpperCase();
  assert.equal(await verifyFile(p, { md5 }), 'ok');
});

test('verifyFile returns "unknown" when the file has no published checksum', async () => {
  const p = tmpWith('whatever');
  assert.equal(await verifyFile(p, {}), 'unknown');
  assert.equal(await verifyFile(p, { size: '8' }), 'unknown');
});

test('verifyFile prefers sha1 when available', async () => {
  const content = 'sha-preferred';
  const p = tmpWith(content);
  const sha1 = crypto.createHash('sha1').update(content).digest('hex');
  // Wrong md5 but correct sha1 → must verify via sha1 and pass.
  assert.equal(await verifyFile(p, { sha1, md5: 'wrongwrongwrongwrongwrongwrongwr' }), 'ok');
});
