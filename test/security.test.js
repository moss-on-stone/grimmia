'use strict';

/**
 * Red/green TDD for L5: scheme/path guards for shell operations.
 *
 *  - setWindowOpenHandler must only openExternal for https:/mailto: URLs.
 *  - shell:openPath must only open a folder that lives under the chosen
 *    download root (openPath on an executable is a code-exec risk).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { isAllowedExternalUrl, isAllowedOpenPath } = require('../src/main/security');

/* --------------------------- isAllowedExternalUrl ------------------------- */

test('allows https and mailto, rejects everything else', () => {
  assert.equal(isAllowedExternalUrl('https://archive.org/details/x'), true);
  assert.equal(isAllowedExternalUrl('mailto:info@archive.org'), true);
  assert.equal(isAllowedExternalUrl('http://insecure.example'), false);
  assert.equal(isAllowedExternalUrl('file:///etc/passwd'), false);
  assert.equal(isAllowedExternalUrl('javascript:alert(1)'), false);
  assert.equal(isAllowedExternalUrl('data:text/html,<script>'), false);
  assert.equal(isAllowedExternalUrl('not a url'), false);
  assert.equal(isAllowedExternalUrl(''), false);
});

/* ----------------------------- isAllowedOpenPath -------------------------- */

test('allows opening a directory under the download root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-open-'));
  const sub = path.join(root, 'item-123');
  fs.mkdirSync(sub);
  try {
    assert.equal(isAllowedOpenPath(sub, root), true);
    assert.equal(isAllowedOpenPath(root, root), true, 'the root itself is allowed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a path outside the download root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-open-'));
  try {
    assert.equal(isAllowedOpenPath('/etc', root), false);
    assert.equal(isAllowedOpenPath(path.join(root, '..', 'elsewhere'), root), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a file (non-directory) even under the root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-open-'));
  const file = path.join(root, 'app.exe');
  fs.writeFileSync(file, 'x');
  try {
    assert.equal(isAllowedOpenPath(file, root), false, 'openPath on a file is a code-exec risk');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects when the root is empty/missing', () => {
  assert.equal(isAllowedOpenPath('/tmp', ''), false);
  assert.equal(isAllowedOpenPath('/tmp', undefined), false);
});
