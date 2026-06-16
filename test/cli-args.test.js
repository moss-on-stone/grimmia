'use strict';

/**
 * Red/green TDD for H3: the --screenshot=<path> file-write primitive must be
 * gated behind --dev. In a packaged production app, anyone able to pass argv
 * could otherwise make the app capturePage() + fs.writeFileSync to an arbitrary
 * path. `resolveScreenshotPath` returns the path ONLY in dev.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { isDevFromArgv, resolveScreenshotPath, isSelfTest, resolveDemo } = require('../src/main/cli-args');

/* --------------------------------- demo ----------------------------------- */

test('resolveDemo returns the query in dev, null otherwise', () => {
  assert.equal(resolveDemo(['node', 'app', '--dev', '--demo=grateful dead']), 'grateful dead');
  assert.equal(resolveDemo(['node', 'app', '--demo=grateful dead']), null, 'gated behind --dev');
  assert.equal(resolveDemo(['node', 'app', '--dev']), null);
});

/* -------------------------------- selftest -------------------------------- */

test('isSelfTest detects --selftest only in dev mode', () => {
  assert.equal(isSelfTest(['node', 'app', '--dev', '--selftest']), true);
  assert.equal(isSelfTest(['node', 'app', '--selftest']), false, 'requires --dev (gated like screenshot)');
  assert.equal(isSelfTest(['node', 'app', '--dev']), false);
});

test('isDevFromArgv detects --dev', () => {
  assert.equal(isDevFromArgv(['node', 'app', '--dev']), true);
  assert.equal(isDevFromArgv(['node', 'app']), false);
});

test('resolveScreenshotPath returns the path when in dev', () => {
  const argv = ['node', 'app', '--dev', '--screenshot=/tmp/out.png'];
  assert.equal(resolveScreenshotPath(argv), '/tmp/out.png');
});

test('resolveScreenshotPath returns null in production even if --screenshot is passed (H3)', () => {
  const argv = ['node', 'app', '--screenshot=/tmp/evil.png'];
  assert.equal(resolveScreenshotPath(argv), null);
});

test('resolveScreenshotPath returns null when no --screenshot arg is present', () => {
  assert.equal(resolveScreenshotPath(['node', 'app', '--dev']), null);
});

test('resolveScreenshotPath preserves = and paths with extra equals signs', () => {
  const argv = ['node', 'app', '--dev', '--screenshot=/tmp/a=b/out.png'];
  assert.equal(resolveScreenshotPath(argv), '/tmp/a=b/out.png');
});
