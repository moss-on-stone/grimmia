'use strict';

/**
 * Red/green TDD for L7: centralize HOST/S3_HOST in one constants module and
 * DERIVE the User-Agent from package.json's version — eliminating the manual
 * version-sync ritual (bump package.json AND a hardcoded USER_AGENT string).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const c = require('../src/shared/constants');
const pkg = require('../package.json');

test('constants exposes the archive.org hosts', () => {
  assert.equal(c.HOST, 'archive.org');
  assert.equal(c.S3_HOST, 's3.us.archive.org');
});

test('USER_AGENT is derived from the package.json version (no manual sync)', () => {
  // archive.org bot guidelines: identify the tool + version clearly, and give a
  // contact/identification path (the public project repo — no personal contact).
  assert.equal(c.USER_AGENT, `Grimmia/${pkg.version} (+https://github.com/moss-on-stone/grimmia)`);
  // It must actually contain the current version, so a version bump flows through.
  assert.ok(c.USER_AGENT.includes(pkg.version), 'User-Agent should embed the package version');
  // It must carry an identification URL so archive.org can identify the client.
  assert.match(c.USER_AGENT, /\(\+https?:\/\/\S+\)/, 'User-Agent should include a (+URL) identification reference');
});

test('shared/types.js loads without error (L8 typedefs module)', () => {
  const types = require('../src/shared/types');
  assert.deepEqual(types, {}, 'types module is typedef-only, exports nothing at runtime');
});
