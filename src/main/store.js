'use strict';

/**
 * store.js
 *
 * Tiny encrypted credential + settings store. Credentials (S3 keys + cookies)
 * are encrypted at rest with Electron's safeStorage (OS keychain-backed when
 * available) and written to the app's userData directory. Settings (download
 * folder, last query, etc.) are plain JSON.
 *
 * Credential security (M7):
 *   - When safeStorage encryption IS available, credentials are written
 *     encrypted to `credentials.enc` (mode 0600). On read we REQUIRE decryption
 *     and never trust a plaintext file dropped in beside it.
 *   - When encryption is NOT available (some Linux / misconfigured systems), we
 *     fall back to an HONESTLY-named `credentials.plain.json` with owner-only
 *     (0600) permissions, and warn loudly that creds are unencrypted at rest.
 *     This is a conscious trade-off so the app stays usable without a keychain.
 */

const fs = require('node:fs');
const path = require('node:path');

let app, safeStorage;
try {
  ({ app, safeStorage } = require('electron'));
} catch {
  /* allow require() outside Electron (e.g. for tests of pure paths) */
}

// Test seams: let tests substitute the keychain and the data directory without
// loading Electron. Production never calls these.
let safeStorageOverride; // undefined => use the real `safeStorage`
let dataDirOverride; // undefined => derive from app/userData/home

function __setSafeStorage(stub) {
  safeStorageOverride = stub;
}
function __setDataDir(dir) {
  dataDirOverride = dir;
}
function activeSafeStorage() {
  return safeStorageOverride !== undefined ? safeStorageOverride : safeStorage;
}

function userDataDir() {
  if (dataDirOverride) return dataDirOverride;
  if (app && app.getPath) return app.getPath('userData');
  return path.join(require('node:os').homedir(), '.ia-desktop');
}

const CREDS_FILE = () => path.join(userDataDir(), 'credentials.enc');
// Plaintext fallback (M7): a distinct name (NOT `.enc`, which would be a lie)
// and owner-only permissions, used only when safeStorage is unavailable.
const CREDS_PLAINTEXT_FILE = () => path.join(userDataDir(), 'credentials.plain.json');
const SETTINGS_FILE = () => path.join(userDataDir(), 'settings.json');

function encryptionAvailable() {
  const ss = activeSafeStorage();
  return Boolean(ss && ss.isEncryptionAvailable());
}

function ensureDir() {
  fs.mkdirSync(userDataDir(), { recursive: true });
}

/* ------------------------------- credentials ------------------------------ */

function saveCredentials(creds) {
  ensureDir();
  const plain = JSON.stringify(creds);
  if (encryptionAvailable()) {
    const enc = activeSafeStorage().encryptString(plain);
    fs.writeFileSync(CREDS_FILE(), enc, { mode: 0o600 });
    // Never leave a stale plaintext file alongside the encrypted one.
    try {
      fs.unlinkSync(CREDS_PLAINTEXT_FILE());
    } catch {
      /* none to remove */
    }
  } else {
    // M7: encryption unavailable (some Linux/misconfigured systems). We can't
    // encrypt, so write the plaintext fallback with OWNER-ONLY permissions and
    // an honest filename, and warn loudly. The credentials still work for this
    // session; the user is told they are not encrypted at rest.
    fs.writeFileSync(CREDS_PLAINTEXT_FILE(), plain, { mode: 0o600, encoding: 'utf8' });
    // Tighten in case the file already existed with looser perms.
    try {
      fs.chmodSync(CREDS_PLAINTEXT_FILE(), 0o600);
    } catch {
      /* best effort */
    }
    // eslint-disable-next-line no-console
    console.warn(
      'WARNING: OS encryption (safeStorage) is unavailable; archive.org credentials ' +
        'are being stored UNENCRYPTED (owner-readable only) at ' +
        CREDS_PLAINTEXT_FILE() +
        '. Consider enabling a system keychain.'
    );
  }
}

function loadCredentials() {
  if (encryptionAvailable()) {
    // When encryption is available, REQUIRE decryption — do not trust a
    // dropped-in plaintext file (M7). A plaintext file present here is ignored.
    try {
      const buf = fs.readFileSync(CREDS_FILE());
      return JSON.parse(activeSafeStorage().decryptString(buf));
    } catch {
      return null;
    }
  }
  // No encryption available: read the honest plaintext fallback only.
  try {
    const buf = fs.readFileSync(CREDS_PLAINTEXT_FILE());
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
}

function clearCredentials() {
  for (const file of [CREDS_FILE(), CREDS_PLAINTEXT_FILE()]) {
    try {
      fs.unlinkSync(file);
    } catch {
      /* nothing to clear */
    }
  }
}

/* -------------------------------- settings -------------------------------- */

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8'));
  } catch {
    return {};
  }
}

function saveSettings(settings) {
  ensureDir();
  fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2), 'utf8');
}

function updateSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  saveSettings(next);
  return next;
}

module.exports = {
  userDataDir,
  saveCredentials,
  loadCredentials,
  clearCredentials,
  loadSettings,
  saveSettings,
  updateSettings,
  // Test-only seams (not used in production).
  __setSafeStorage,
  __setDataDir,
};
