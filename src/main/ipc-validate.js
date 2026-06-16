'use strict';

/**
 * ipc-validate.js
 *
 * Pure validators for the IPC trust boundary. The renderer is not a security
 * boundary, so every handler that consumes a renderer payload must re-validate
 * it here before touching the network or filesystem. No Electron, no I/O beyond
 * a stat for directory checks — unit-testable with `node --test`.
 *
 * Guards:
 *   - C1: download:start `items` must be an array of well-formed items, not a
 *     bare identifier string (which would iterate its characters).
 *   - M2: identifiers must match the IA identifier rule.
 *   - M3: computed destination paths must stay under the item directory.
 *   - M4: destRoot must be a non-empty, absolute, existing directory.
 */

const fs = require('node:fs');
const path = require('node:path');

const { IAError } = require('./ia-core');

/**
 * The archive.org identifier rule, shared with the renderer's validIdentifier.
 * Real identifiers DO contain uppercase (e.g. "NPTCM19400622"), so the rule is
 * case-insensitive: start with an alphanumeric, then alphanumerics / . _ -.
 */
const IDENTIFIER_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;

function validateIdentifier(id) {
  if (typeof id !== 'string' || !IDENTIFIER_RE.test(id)) {
    throw new IAError(`Invalid item identifier: ${JSON.stringify(id)}.`);
  }
  return id;
}

/**
 * Validate the `items` array for download:start. Returns the array unchanged
 * when valid; throws an IAError otherwise.
 */
function validateDownloadItems(items) {
  if (!Array.isArray(items)) {
    throw new IAError('Download request is malformed: items must be an array.');
  }
  if (items.length === 0) {
    throw new IAError('Nothing to download: no items provided.');
  }
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      throw new IAError('Download request is malformed: each item must be an object.');
    }
    validateIdentifier(item.identifier);
    if (item.files != null && !Array.isArray(item.files)) {
      throw new IAError(`Download request is malformed: "files" for ${item.identifier} must be an array.`);
    }
  }
  return items;
}

/**
 * Validate the destination root: must be a non-empty, absolute path that exists
 * and is a directory. Returns it unchanged when valid.
 */
function validateDestRoot(destRoot) {
  if (typeof destRoot !== 'string' || destRoot.trim() === '') {
    throw new IAError('No download folder is set. Choose a destination folder first.');
  }
  if (!path.isAbsolute(destRoot)) {
    throw new IAError('Download folder must be an absolute path.');
  }
  let stat;
  try {
    stat = fs.statSync(destRoot);
  } catch {
    throw new IAError(`Download folder does not exist: ${destRoot}.`);
  }
  if (!stat.isDirectory()) {
    throw new IAError(`Download destination is not a directory: ${destRoot}.`);
  }
  return destRoot;
}

/**
 * Containment check (M3): is `candidate` strictly inside `root`? Canonicalizes
 * with path.resolve and requires the candidate to be a proper descendant (the
 * root itself does not count).
 */
function containWithin(root, candidate, platform = process.platform) {
  // Use the matching path semantics (Windows is case-insensitive and uses '\';
  // posix is case-sensitive and uses '/'). The `platform` arg lets tests drive
  // win32 rules deterministically on any host.
  const isWin = platform === 'win32';
  const p = isWin ? path.win32 : path.posix;
  let r = p.resolve(root);
  let c = p.resolve(candidate);
  if (isWin) {
    // Windows filesystems are case-insensitive — compare case-folded.
    r = r.toLowerCase();
    c = c.toLowerCase();
  }
  if (c === r) return false; // the root itself is not "within"
  // Append exactly one separator (a drive/posix root already ends in one, e.g.
  // 'C:\\' or '/'), so a child is detected without a double separator.
  const prefix = r.endsWith(p.sep) ? r : r + p.sep;
  return c.startsWith(prefix);
}

module.exports = {
  IDENTIFIER_RE,
  validateIdentifier,
  validateDownloadItems,
  validateDestRoot,
  containWithin,
};
