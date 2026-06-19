'use strict';

/**
 * logger.js
 *
 * Tiny no-dependency structured logger. Writes one-line, ISO-timestamped,
 * leveled entries to `<userData>/logs/grimmia.log` AND mirrors them to the
 * console. Rotates the file when it exceeds a size cap (keeping one `.1`
 * backup), so the log can't grow unbounded.
 *
 * Pure formatting/policy lives in log-format.js; this module owns the file I/O.
 * Test seams (__setLogDir/__setClock/__setMaxBytes/__reset) let tests run it
 * against a tmpdir with a deterministic clock and no Electron.
 */

const fs = require('node:fs');
const path = require('node:path');

const { formatLine, shouldRotate, levelEnabled } = require('./log-format');

let app;
try {
  ({ app } = require('electron'));
} catch {
  /* allow require() outside Electron */
}

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // 2 MB before rotating

// Overridable state (production uses the defaults).
let logDirOverride;
let clock = () => new Date();
let maxBytes = DEFAULT_MAX_BYTES;
let threshold = 'INFO';
let enabled = true; // diagnostics on/off (#1); app sets this from the `logging` pref
let dirEnsured = false;

function __setLogDir(dir) {
  logDirOverride = dir;
  dirEnsured = false;
}
function __setClock(fn) {
  clock = fn || (() => new Date());
}
function __setMaxBytes(n) {
  maxBytes = n == null ? DEFAULT_MAX_BYTES : n;
}
function __reset() {
  dirEnsured = false;
}
function setThreshold(level) {
  threshold = level;
}
/**
 * Turn diagnostics/logging on or off (#1). When disabled, write() is a complete
 * no-op — no file is created and nothing is mirrored to the console. The app
 * keeps this off by default and flips it on only when the `logging` pref is set.
 */
function setEnabled(on) {
  enabled = Boolean(on);
}

function logDir() {
  if (logDirOverride) return logDirOverride;
  if (app && app.getPath) return path.join(app.getPath('userData'), 'logs');
  return path.join(require('node:os').homedir(), '.grimmia', 'logs');
}

function logFilePath() {
  return path.join(logDir(), 'grimmia.log');
}

function ensureDir() {
  if (dirEnsured) return;
  fs.mkdirSync(logDir(), { recursive: true });
  dirEnsured = true;
}

function rotateIfNeeded(file) {
  try {
    const { size } = fs.statSync(file);
    if (shouldRotate(size, maxBytes)) {
      const backup = file + '.1';
      try {
        fs.rmSync(backup, { force: true });
      } catch {
        /* ignore */
      }
      fs.renameSync(file, backup);
    }
  } catch {
    /* no file yet — nothing to rotate */
  }
}

function mirrorToConsole(level, line) {
  // eslint-disable-next-line no-console
  const fn = level === 'ERROR' ? console.error : level === 'WARNING' ? console.warn : console.log;
  fn(line);
}

function write(level, message, fields) {
  if (!enabled) return; // logging turned off (#1)
  if (!levelEnabled(threshold, level)) return;
  let line;
  try {
    line = formatLine(level, message, fields, clock());
  } catch {
    line = `${new Date(0).toISOString()} ERROR <log-format-error>`;
  }
  try {
    ensureDir();
    const file = logFilePath();
    rotateIfNeeded(file);
    fs.appendFileSync(file, line + '\n', { encoding: 'utf8', mode: 0o600 });
  } catch {
    /* never let logging crash the app */
  }
  mirrorToConsole(level, line);
}

const debug = (m, f) => write('DEBUG', m, f);
const info = (m, f) => write('INFO', m, f);
const warn = (m, f) => write('WARNING', m, f);
const error = (m, f) => write('ERROR', m, f);

module.exports = {
  debug,
  info,
  warn,
  error,
  logDir,
  logFilePath,
  setThreshold,
  setEnabled,
  // test seams (no-ops in production)
  __setLogDir,
  __setClock,
  __setMaxBytes,
  __reset,
};
