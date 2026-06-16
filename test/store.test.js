'use strict';

/**
 * Red/green TDD for T4: store.js credential + settings round-trip, including the
 * (insecure) plaintext fallback when safeStorage is unavailable.
 *
 * store.js guards `require('electron')`, so outside Electron it uses
 * ~/.ia-desktop. We point HOME at a tmpdir per run so nothing touches the real
 * user data, and require the module fresh after setting HOME.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const store = require('../src/main/store');

/** Point store.js at a throwaway data dir via its test seam (no Electron). */
function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-store-'));
  store.__setDataDir(dir);
  return {
    store,
    home: dir, // the data dir IS the dir here (no nested .ia-desktop)
    cleanup: () => {
      store.__setDataDir(undefined);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('credentials round-trip through save/load (plaintext fallback path)', () => {
  const { store, cleanup } = freshStore();
  try {
    const creds = { access: 'A', secret: 'S', screenname: 'Me', cookies: { x: '1' } };
    store.saveCredentials(creds);
    const loaded = store.loadCredentials();
    assert.deepEqual(loaded, creds);
  } finally {
    cleanup();
  }
});

test('loadCredentials returns null when nothing is saved', () => {
  const { store, cleanup } = freshStore();
  try {
    assert.equal(store.loadCredentials(), null);
  } finally {
    cleanup();
  }
});

test('clearCredentials removes the stored credentials', () => {
  const { store, cleanup } = freshStore();
  try {
    store.saveCredentials({ access: 'A', secret: 'S' });
    store.clearCredentials();
    assert.equal(store.loadCredentials(), null);
  } finally {
    cleanup();
  }
});

test('updateSettings merges onto existing settings', () => {
  const { store, cleanup } = freshStore();
  try {
    store.saveSettings({ destRoot: '/tmp/dl', format: 'pdf' });
    const next = store.updateSettings({ format: 'epub', viewMode: 'compact' });
    assert.equal(next.destRoot, '/tmp/dl', 'untouched key preserved');
    assert.equal(next.format, 'epub', 'patched key overwritten');
    assert.equal(next.viewMode, 'compact', 'new key added');
  } finally {
    cleanup();
  }
});

test('loadSettings returns {} for a corrupt settings file', () => {
  const { store, home, cleanup } = freshStore();
  try {
    const file = path.join(home, 'settings.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ this is not json');
    assert.deepEqual(store.loadSettings(), {});
  } finally {
    cleanup();
  }
});

/**
 * Documents (T4) the plaintext-fallback behavior so it is a conscious decision:
 * when safeStorage is unavailable (the no-Electron test path), credentials must
 * be written with owner-only permissions (M7) — not world-readable defaults.
 */
test('plaintext credential fallback file is written with 0600 permissions (M7)', { skip: process.platform === 'win32' ? 'POSIX mode bits not supported on Windows (NTFS uses ACLs)' : false }, () => {
  const { store, home, cleanup } = freshStore();
  try {
    store.saveCredentials({ access: 'A', secret: 'S' });
    // Find the credentials file under the data dir.
    const dataDir = home;
    const files = fs.readdirSync(dataDir).filter((f) => f.startsWith('credentials'));
    assert.ok(files.length === 1, 'one credentials file should exist');
    const mode = fs.statSync(path.join(dataDir, files[0])).mode & 0o777;
    assert.equal(mode, 0o600, `credentials file must be owner-only, got ${mode.toString(8)}`);
  } finally {
    cleanup();
  }
});
