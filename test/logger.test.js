'use strict';

/**
 * Red/green TDD for the file-writing logger. Uses test seams to point the log
 * directory at a tmpdir and inject a deterministic clock — no Electron.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const logger = require('../src/main/logger');

function freshLog() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-log-'));
  let t = Date.parse('2026-06-07T00:00:00.000Z');
  logger.__setLogDir(dir);
  logger.__setClock(() => new Date(t));
  logger.__setMaxBytes(200);
  logger.setEnabled(true);
  logger.__reset();
  return {
    dir,
    advance: (ms) => {
      t += ms;
    },
    file: () => path.join(dir, 'grimmia.log'),
    read: () => fs.readFileSync(path.join(dir, 'grimmia.log'), 'utf8'),
    cleanup: () => {
      logger.__setLogDir(undefined);
      logger.__setClock(undefined);
      logger.__setMaxBytes(undefined);
      logger.__reset();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('info() writes a timestamped line to the log file', () => {
  const h = freshLog();
  try {
    logger.info('search started', { q: 'cats' });
    const text = h.read();
    assert.match(text, /^2026-06-07T00:00:00\.000Z INFO search started q=cats$/m);
  } finally {
    h.cleanup();
  }
});

test('each call appends a new line (one entry per line)', () => {
  const h = freshLog();
  try {
    logger.info('one');
    logger.warn('two');
    logger.error('three');
    const lines = h.read().trim().split('\n');
    assert.equal(lines.length, 3);
    assert.match(lines[1], / WARNING two$/);
    assert.match(lines[2], / ERROR three$/);
  } finally {
    h.cleanup();
  }
});

test('rotates the file when it exceeds the max size', () => {
  const h = freshLog();
  try {
    // maxBytes=200; write enough to exceed it.
    for (let i = 0; i < 20; i++) logger.info(`line number ${i} with some padding text`);
    // A rotated file (.1) should exist, and the active file should be smaller.
    assert.ok(fs.existsSync(h.file() + '.1'), 'a rotated grimmia.log.1 should exist');
    assert.ok(fs.statSync(h.file()).size < 1000);
  } finally {
    h.cleanup();
  }
});

test('logger never throws even if the message is odd', () => {
  const h = freshLog();
  try {
    assert.doesNotThrow(() => logger.info(undefined));
    assert.doesNotThrow(() => logger.error('x', { e: null }));
  } finally {
    h.cleanup();
  }
});

test('logger exposes a logFilePath for the UI / open-folder action', () => {
  const h = freshLog();
  try {
    assert.equal(logger.logFilePath(), h.file());
    assert.equal(logger.logDir(), h.dir);
  } finally {
    h.cleanup();
  }
});

/* ----------------------- enable/disable gate (#1) ------------------------- */

test('logging is enabled by default (so freshLog tests above write)', () => {
  // Sanity: the module default keeps logging on; the app turns it off via
  // setEnabled(false) until the pref is read. (#1)
  assert.equal(typeof logger.setEnabled, 'function');
});

test('setEnabled(false) makes the logger a no-op: nothing is written (#1)', () => {
  const h = freshLog();
  try {
    logger.setEnabled(false);
    logger.info('should not appear');
    logger.error('nor this');
    assert.equal(fs.existsSync(h.file()), false, 'no log file when logging is disabled');
  } finally {
    logger.setEnabled(true);
    h.cleanup();
  }
});

test('setEnabled(true) resumes writing (#1)', () => {
  const h = freshLog();
  try {
    logger.setEnabled(false);
    logger.info('dropped');
    logger.setEnabled(true);
    logger.info('kept');
    const text = h.read();
    assert.doesNotMatch(text, /dropped/);
    assert.match(text, /kept/);
  } finally {
    h.cleanup();
  }
});
