'use strict';

/**
 * security.js
 *
 * Pure guards for the shell operations exposed to the renderer (L5). Keeping
 * the decision logic here (no Electron) makes it unit-testable; main.js applies
 * the verdicts in `setWindowOpenHandler` and the `shell:openPath` handler.
 */

const fs = require('node:fs');
const path = require('node:path');

const { containWithin } = require('./ipc-validate');

/** Only allow opening external links over https: or mailto:. */
function isAllowedExternalUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' || u.protocol === 'mailto:';
  } catch {
    return false;
  }
}

/**
 * Allow `shell.openPath` only for a DIRECTORY that is the download root itself
 * or a folder beneath it. Opening an arbitrary path (especially a file) is a
 * code-execution risk, so files and out-of-root paths are refused.
 */
function isAllowedOpenPath(target, destRoot) {
  if (typeof destRoot !== 'string' || destRoot.trim() === '') return false;
  if (typeof target !== 'string' || target.trim() === '') return false;

  const resolvedRoot = path.resolve(destRoot);
  const resolvedTarget = path.resolve(target);

  // Must be the root itself or contained within it.
  const inRoot = resolvedTarget === resolvedRoot || containWithin(resolvedRoot, resolvedTarget);
  if (!inRoot) return false;

  // Must be an existing directory (never open a file).
  try {
    return fs.statSync(resolvedTarget).isDirectory();
  } catch {
    return false;
  }
}

module.exports = { isAllowedExternalUrl, isAllowedOpenPath };
