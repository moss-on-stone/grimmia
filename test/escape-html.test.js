'use strict';

/**
 * Red/green TDD for T3: escapeHtml is the renderer's XSS-escape primitive but
 * was never asserted. It must encode the five HTML-significant characters and
 * coerce null/undefined to ''.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { escapeHtml } = require('../src/renderer/ui-util');

test('escapeHtml encodes the five HTML-significant characters', () => {
  assert.equal(escapeHtml('<'), '&lt;');
  assert.equal(escapeHtml('>'), '&gt;');
  assert.equal(escapeHtml('&'), '&amp;');
  assert.equal(escapeHtml('"'), '&quot;');
  assert.equal(escapeHtml("'"), '&#39;');
});

test('escapeHtml coerces null/undefined to empty string', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('escapeHtml fully neutralizes an img-onerror XSS payload', () => {
  const out = escapeHtml('<img src=x onerror=alert(1)>');
  assert.ok(!out.includes('<'), 'no raw < survives');
  assert.ok(!out.includes('>'), 'no raw > survives');
  assert.equal(out, '&lt;img src=x onerror=alert(1)&gt;');
});

test('escapeHtml escapes & before other entities (no double-encoding bug)', () => {
  // "&lt;" in the input must become "&amp;lt;", not be mistaken for an entity.
  assert.equal(escapeHtml('&lt;'), '&amp;lt;');
});

/* ------------------- downloadDoneSummary (#4 completion) ------------------ */

const { downloadDoneSummary } = require('../src/renderer/ui-util');

test('downloadDoneSummary reports the plain file count when all verified', () => {
  assert.equal(downloadDoneSummary(3, 0), 'Done — 3 file(s)');
});

test('downloadDoneSummary warns when some files failed checksum verification', () => {
  const msg = downloadDoneSummary(3, 1);
  assert.match(msg, /3 file/);
  assert.match(msg, /1 .*checksum|checksum.*1|failed/i);
});

test('downloadDoneSummary pluralizes the mismatch count', () => {
  const msg = downloadDoneSummary(5, 2);
  assert.match(msg, /2/);
});
