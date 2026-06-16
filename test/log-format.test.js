'use strict';

/**
 * Red/green TDD for the pure logging helpers (no filesystem):
 *  - formatLine(level, message, fields, now) → one-line, timestamped, no newline
 *  - shouldRotate(size, max) → whether the log file should roll over
 *  - LEVELS / levelEnabled(threshold, level) → level filtering
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { formatLine, shouldRotate, levelEnabled, LEVELS } = require('../src/main/log-format');

/* -------------------------------- formatLine ------------------------------ */

test('formatLine produces a single ISO-timestamped line with the level', () => {
  const line = formatLine('INFO', 'download started', null, new Date('2026-06-07T12:00:00.000Z'));
  assert.equal(line, '2026-06-07T12:00:00.000Z INFO download started');
  assert.ok(!line.includes('\n'), 'must be a single line');
});

test('formatLine appends key=value fields', () => {
  const line = formatLine('ERROR', 'failed', { id: 'abc', status: 503 }, new Date('2026-06-07T12:00:00.000Z'));
  assert.match(line, /ERROR failed /);
  assert.match(line, /id=abc/);
  assert.match(line, /status=503/);
});

test('formatLine escapes newlines in the message so one entry stays one line', () => {
  const line = formatLine('WARNING', 'a\nb', null, new Date('2026-06-07T12:00:00.000Z'));
  assert.ok(!line.includes('\n'));
  assert.match(line, /a\\nb/);
});

test('formatLine quotes field values that contain spaces', () => {
  const line = formatLine('INFO', 'x', { name: 'two words' }, new Date('2026-06-07T12:00:00.000Z'));
  assert.match(line, /name="two words"/);
});

test('formatLine normalizes an unknown level to INFO', () => {
  const line = formatLine('chatty', 'x', null, new Date('2026-06-07T12:00:00.000Z'));
  assert.match(line, / INFO x$/);
});

/* ------------------------------- shouldRotate ----------------------------- */

test('shouldRotate is true once the size meets/exceeds the cap', () => {
  assert.equal(shouldRotate(1000, 1000), true);
  assert.equal(shouldRotate(1001, 1000), true);
  assert.equal(shouldRotate(999, 1000), false);
});

/* ------------------------------- levelEnabled ----------------------------- */

test('LEVELS orders debug < info < warning < error', () => {
  assert.ok(LEVELS.DEBUG < LEVELS.INFO);
  assert.ok(LEVELS.INFO < LEVELS.WARNING);
  assert.ok(LEVELS.WARNING < LEVELS.ERROR);
});

test('levelEnabled filters by threshold', () => {
  assert.equal(levelEnabled('INFO', 'ERROR'), true, 'ERROR passes an INFO threshold');
  assert.equal(levelEnabled('INFO', 'DEBUG'), false, 'DEBUG is below an INFO threshold');
  assert.equal(levelEnabled('WARNING', 'WARNING'), true);
});
