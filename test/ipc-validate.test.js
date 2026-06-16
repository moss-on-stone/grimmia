'use strict';

/**
 * Red/green TDD for the IPC validation layer (C1 guard + M2 + M4).
 *
 * Handlers must not trust renderer payloads. These pure validators assert the
 * shape of download:start / upload:start / metadata:modify inputs and the
 * destination root, so a malformed payload is rejected with a clear message
 * rather than silently iterating a string's characters (C1) or writing to a
 * CWD-relative path (M4).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const v = require('../src/main/ipc-validate');

/* --------------------------- validateDownloadItems ------------------------ */

test('validateDownloadItems rejects a non-array (e.g. a bare identifier string)', () => {
  assert.throws(() => v.validateDownloadItems('my-id'), /array/i);
});

test('validateDownloadItems rejects an empty array', () => {
  assert.throws(() => v.validateDownloadItems([]), /no items|empty/i);
});

test('validateDownloadItems rejects items with an invalid identifier', () => {
  assert.throws(() => v.validateDownloadItems([{ identifier: 'Bad Id!' }]), /identifier/i);
  assert.throws(() => v.validateDownloadItems([{ identifier: '' }]), /identifier/i);
});

test('validateDownloadItems accepts well-formed items and returns them', () => {
  const items = [
    { identifier: 'good-id', title: 'T' },
    { identifier: 'another_id.v2', files: [{ name: 'a.pdf' }] },
  ];
  assert.deepEqual(v.validateDownloadItems(items), items);
});

test('validateDownloadItems rejects a files field that is not an array', () => {
  assert.throws(() => v.validateDownloadItems([{ identifier: 'good-id', files: 'a.pdf' }]), /files/i);
});

/* ------------------------------ validateDestRoot -------------------------- */

test('validateDestRoot rejects empty / non-string roots (M4)', () => {
  assert.throws(() => v.validateDestRoot(''), /folder|destination|directory/i);
  assert.throws(() => v.validateDestRoot(undefined), /folder|destination|directory/i);
  assert.throws(() => v.validateDestRoot(42), /folder|destination|directory/i);
});

test('validateDestRoot rejects a relative path', () => {
  assert.throws(() => v.validateDestRoot('relative/dir'), /absolute/i);
});

test('validateDestRoot rejects a path that does not exist', () => {
  const missing = path.join(os.tmpdir(), 'ia-desktop-does-not-exist-xyz');
  assert.throws(() => v.validateDestRoot(missing), /exist|directory/i);
});

test('validateDestRoot accepts an existing absolute directory and returns it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-destroot-'));
  try {
    assert.equal(v.validateDestRoot(dir), dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateDestRoot rejects a path that exists but is a file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-destroot-'));
  const file = path.join(dir, 'afile');
  fs.writeFileSync(file, 'x');
  try {
    assert.throws(() => v.validateDestRoot(file), /directory/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ----------------------------- validateIdentifier ------------------------- */

test('validateIdentifier returns the id when valid, throws otherwise', () => {
  assert.equal(v.validateIdentifier('valid-id_1.v2'), 'valid-id_1.v2');
  assert.throws(() => v.validateIdentifier('Has Space'), /identifier/i);
  assert.throws(() => v.validateIdentifier('../etc/passwd'), /identifier/i);
});

test('validateIdentifier ACCEPTS uppercase IA identifiers (regression: NPTCM…)', () => {
  // Real archive.org identifiers contain uppercase — these must not be rejected.
  assert.equal(v.validateIdentifier('NPTCM19400622'), 'NPTCM19400622');
  assert.equal(v.validateIdentifier('NPWK19610823'), 'NPWK19610823');
  assert.equal(v.validateIdentifier('GratefulDead-SanFrancisco6-9-1977'), 'GratefulDead-SanFrancisco6-9-1977');
});

/* ------------------------- containWithin (M3) ----------------------------- */

test('containWithin returns true for a path inside the root', () => {
  const root = path.join(os.tmpdir(), 'root');
  assert.equal(v.containWithin(root, path.join(root, 'item', 'file.pdf')), true);
});

test('containWithin returns false for a traversal escaping the root', () => {
  const root = path.join(os.tmpdir(), 'root');
  assert.equal(v.containWithin(root, path.join(root, '..', 'evil.pdf')), false);
});

test('containWithin treats the root itself as not "within" (must be a child)', () => {
  const root = path.join(os.tmpdir(), 'root');
  assert.equal(v.containWithin(root, root), false);
});

/* ------------- Windows path semantics (case-insensitive + drive roots) ----- */
// Driven with platform:'win32' so the win32 path rules are exercised on macOS.

test('containWithin is case-INSENSITIVE on Windows (drive-letter / dir case differs)', () => {
  // Same folder, different case → must still be "within".
  assert.equal(v.containWithin('C:\\Users\\Foo\\Downloads', 'c:\\users\\foo\\downloads\\a.pdf', 'win32'), true);
  assert.equal(v.containWithin('C:\\Dl', 'C:\\DL\\sub\\b.pdf', 'win32'), true);
});

test('containWithin still blocks real traversal on Windows', () => {
  assert.equal(v.containWithin('C:\\Dl', 'C:\\Dl\\..\\evil.pdf', 'win32'), false);
  assert.equal(v.containWithin('C:\\Dl', 'D:\\other\\x.pdf', 'win32'), false, 'different drive is outside');
});

test('containWithin works when the root is a DRIVE ROOT on Windows (C:\\)', () => {
  // r + sep used to become "C:\\\\" and reject everything under a drive root.
  assert.equal(v.containWithin('C:\\', 'C:\\Downloads\\a.pdf', 'win32'), true);
  assert.equal(v.containWithin('D:\\', 'D:\\file.pdf', 'win32'), true);
});

test('containWithin remains case-SENSITIVE on posix', () => {
  assert.equal(v.containWithin('/data/Root', '/data/root/a.pdf', 'posix'), false, 'posix is case-sensitive');
  assert.equal(v.containWithin('/data/Root', '/data/Root/a.pdf', 'posix'), true);
});

test('containWithin handles a posix root that is just "/"', () => {
  assert.equal(v.containWithin('/', '/etc/x', 'posix'), true);
  assert.equal(v.containWithin('/', '/', 'posix'), false, 'root itself not within');
});
