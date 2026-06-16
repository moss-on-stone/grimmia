'use strict';

/**
 * log-format.js
 *
 * Pure formatting + policy helpers for the logger (no filesystem, no Date.now —
 * the timestamp is passed in so it is deterministic in tests). The file-writing
 * logger (logger.js) composes these.
 */

const LEVELS = Object.freeze({ DEBUG: 10, INFO: 20, WARNING: 30, ERROR: 40 });
const NAMES = Object.freeze(Object.keys(LEVELS)); // ['DEBUG','INFO','WARNING','ERROR']

/** Normalize a level name to a known uppercase level (defaults to INFO). */
function normalizeLevel(level) {
  const up = String(level || '').toUpperCase();
  return NAMES.includes(up) ? up : 'INFO';
}

/** Whether `level` should be emitted given a minimum `threshold`. */
function levelEnabled(threshold, level) {
  return LEVELS[normalizeLevel(level)] >= LEVELS[normalizeLevel(threshold)];
}

/** Render a single field value, quoting if it contains spaces or is empty. */
function renderValue(v) {
  const s = String(v == null ? '' : v).replace(/\n/g, '\\n').replace(/\r/g, '');
  return /\s/.test(s) || s === '' ? `"${s}"` : s;
}

/**
 * Format one log line: `<iso> <LEVEL> <message> [k=v ...]`. Newlines in the
 * message are escaped so every entry stays exactly one line (greppable logs).
 * `now` is a Date (injected for determinism).
 */
function formatLine(level, message, fields, now) {
  const ts = now.toISOString();
  const lvl = normalizeLevel(level);
  const msg = String(message == null ? '' : message).replace(/\r/g, '').replace(/\n/g, '\\n');
  let line = `${ts} ${lvl} ${msg}`;
  if (fields && typeof fields === 'object') {
    const parts = Object.entries(fields)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${renderValue(v)}`);
    if (parts.length) line += ` ${parts.join(' ')}`;
  }
  return line;
}

/** Whether a log file of `size` bytes should roll over given `max`. */
function shouldRotate(size, max) {
  return Number(size) >= Number(max);
}

module.exports = { LEVELS, NAMES, normalizeLevel, levelEnabled, formatLine, shouldRotate };
