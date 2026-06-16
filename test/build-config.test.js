'use strict';

/**
 * Guards the electron-builder packaging config so the macOS signing setup can't
 * silently regress.
 *
 * Why this matters: with no paid Developer ID, electron-builder SKIPS signing
 * on a CI runner — producing an app whose bundle is not validly signed, which
 * Gatekeeper reports as "is damaged and can't be opened" (the harsh dialog with
 * no "Open Anyway" button) instead of the friendly "unidentified developer"
 * prompt.
 *
 * Note: electron-builder 24 treats `mac.identity: null` as "skip signing", NOT
 * "ad-hoc sign" — that leaves the inner Electron binary ad-hoc-signed but the
 * outer .app bundle UNSEALED, which is exactly the "damaged" state. So we ad-hoc
 * sign the WHOLE bundle ourselves in an `afterPack` hook
 * (`build/adhoc-sign.js` → `codesign --force --deep --sign -`). That produces a
 * bundle that "satisfies its Designated Requirement" → the friendly dialog.
 *
 * An ad-hoc signature must NOT use the hardened runtime — that's only valid for
 * a notarized Developer-ID build and otherwise causes launch failures.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pkg = require('../package.json');
const mac = pkg.build && pkg.build.mac;

test('build config runs the ad-hoc signing afterPack hook', () => {
  assert.ok(pkg.build, 'package.json build must exist');
  assert.equal(pkg.build.afterPack, 'build/adhoc-sign.js', 'afterPack must run the ad-hoc signer');
  assert.ok(
    fs.existsSync(path.join(__dirname, '..', 'build', 'adhoc-sign.js')),
    'build/adhoc-sign.js must exist'
  );
});

test('the ad-hoc signer uses codesign --force --deep --sign - on macOS only', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'build', 'adhoc-sign.js'), 'utf8');
  assert.match(src, /codesign/, 'must invoke codesign');
  assert.match(src, /--deep/, 'must sign the whole bundle (--deep)');
  assert.match(src, /--force/, 'must replace any existing signature (--force)');
  assert.match(src, /['"]-['"]/, 'must use the ad-hoc identity "-"');
  assert.match(src, /darwin/, 'must be a no-op off macOS (Windows/Linux packing)');
});

test('build.mac does NOT use the hardened runtime with only an ad-hoc signature', () => {
  // hardenedRuntime is for notarized Developer-ID builds; with ad-hoc signing it
  // breaks launch. It must be off (or absent) until real notarization is wired.
  assert.notEqual(mac.hardenedRuntime, true, 'hardenedRuntime must be false for an ad-hoc build');
});
