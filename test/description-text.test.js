'use strict';

/**
 * Red/green TDD for H2 + L3.
 *
 * H2: item descriptions are attacker-controlled HTML. We render them as PLAIN
 * TEXT (no innerHTML sink, no hand-rolled blacklist sanitizer). `descriptionText`
 * is the pure helper that turns a metadata `description` (string or array) into a
 * single plain string; the renderer inserts it via textContent.
 *
 * L3: the CSP `img-src` is tightened from `https:` (any host) to archive.org
 * only, closing the data-exfil beacon channel behind H2.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const u = require('../src/renderer/ui-util');

/* ----------------------------- descriptionText ---------------------------- */

test('descriptionText returns a single string for a string description', () => {
  assert.equal(u.descriptionText('Hello world'), 'Hello world');
});

test('descriptionText joins an array description into paragraphs', () => {
  assert.equal(u.descriptionText(['One', 'Two']), 'One\n\nTwo');
});

test('descriptionText returns "" for null/undefined/empty', () => {
  assert.equal(u.descriptionText(null), '');
  assert.equal(u.descriptionText(undefined), '');
  assert.equal(u.descriptionText([]), '');
});

test('descriptionText does NOT interpret HTML — it returns the raw text verbatim', () => {
  // The point: this string later goes into textContent, so the tags are inert.
  const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  assert.equal(u.descriptionText(evil), evil);
});

/* -------------------- renderer no longer uses an HTML sink ----------------- */

test('renderer.js renders descriptions as text, not via innerHTML/sanitizeBasic', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'renderer.js'), 'utf8');
  assert.ok(!/sanitizeBasic/.test(src), 'sanitizeBasic (hand-rolled blacklist) must be gone');
  // The description element must be built with a text:/textContent payload, not html:.
  assert.ok(
    /class: 'desc',\s*text:/.test(src) || /descriptionText/.test(src),
    'description should be rendered as plain text'
  );
});

/* ----------------------------- CSP img-src (L3) --------------------------- */

test('index.html CSP restricts img-src to archive.org hosts only', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const m = html.match(/Content-Security-Policy"[\s\S]*?content="([^"]+)"/);
  assert.ok(m, 'a CSP meta tag should exist');
  const csp = m[1];
  const imgSrc = csp.match(/img-src ([^;]+);/);
  assert.ok(imgSrc, 'img-src directive should exist');
  const value = imgSrc[1];
  assert.ok(!/\bhttps:(\s|$)/.test(value), 'img-src must not allow blanket https:');
  assert.match(value, /archive\.org/, 'img-src should allow archive.org');
});
