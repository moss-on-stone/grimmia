'use strict';

/**
 * Red/green TDD for M7 read-side: when safeStorage IS available, loadCredentials
 * must REQUIRE decryption and must NOT trust a plaintext file dropped in beside
 * it. Uses store.js's explicit test seams (__setSafeStorage/__setDataDir) so we
 * never need Electron.
 *
 * NOTE: store.js's seams are module-global, and `node --test` runs tests within
 * a file concurrently — so all assertions that depend on the seam live in ONE
 * test body to avoid racing the shared override.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const store = require('../src/main/store');

/**
 * A reversible fake keychain. It tags + base64-obscures the payload so the
 * plaintext secret does NOT appear verbatim on disk (mimicking real encryption)
 * while staying perfectly decryptable in-process.
 */
const TAG = Buffer.from('ENC:', 'utf8');
const fakeKeychain = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.concat([TAG, Buffer.from(Buffer.from(s, 'utf8').toString('base64'), 'utf8')]),
  decryptString: (buf) => {
    if (!buf.subarray(0, TAG.length).equals(TAG)) throw new Error('not encrypted by us');
    return Buffer.from(buf.subarray(TAG.length).toString('utf8'), 'base64').toString('utf8');
  },
};

test('M7 read-side: encryption available ⇒ encrypted at rest, plaintext ignored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-store-enc-'));
  store.__setDataDir(dir);
  store.__setSafeStorage(fakeKeychain);
  try {
    // (a) creds are encrypted at rest and round-trip
    store.saveCredentials({ access: 'A', secret: 'S' });
    const onDisk = fs.readFileSync(path.join(dir, 'credentials.enc'), 'utf8');
    assert.match(onDisk, /^ENC:/, 'file must be encrypted, not plaintext');
    assert.ok(!onDisk.includes('"secret":"S"'), 'secret must not appear in plaintext on disk');
    assert.deepEqual(store.loadCredentials(), { access: 'A', secret: 'S' });

    // (b) an encrypted save removes any stale plaintext fallback file
    fs.writeFileSync(path.join(dir, 'credentials.plain.json'), 'stale');
    store.saveCredentials({ access: 'A', secret: 'S' });
    assert.equal(fs.existsSync(path.join(dir, 'credentials.plain.json')), false, 'stale plaintext must be deleted');

    // (c) a dropped-in plaintext file is NOT trusted when encryption is available
    store.clearCredentials();
    fs.writeFileSync(path.join(dir, 'credentials.plain.json'), JSON.stringify({ access: 'EVIL', secret: 'EVIL' }));
    assert.equal(store.loadCredentials(), null, 'plaintext file must not be trusted under encryption');
  } finally {
    store.__setSafeStorage(undefined);
    store.__setDataDir(undefined);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
