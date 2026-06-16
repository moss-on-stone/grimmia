'use strict';

/**
 * Red/green TDD for idea #3: glob / regex include+exclude filters per download,
 * layered on top of the format presets.
 *
 *  - globToRegExp('*.pdf')  → matches 'book.pdf', not 'book.txt'
 *  - matchesFilters(name, {include, exclude}) → include must pass AND exclude
 *    must not match.
 *  - planDownload honors include/exclude (the integration point).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { globToRegExp, matchesFilters, planDownload, parsePatterns } = require('../src/main/download-prefs');

/* ------------------------------ parsePatterns ----------------------------- */

test('parsePatterns splits on commas and newlines, trims, drops empties', () => {
  assert.deepEqual(parsePatterns(' *.pdf , *.epub \n *_bw.pdf '), ['*.pdf', '*.epub', '*_bw.pdf']);
});

test('parsePatterns returns [] for blank/absent input', () => {
  assert.deepEqual(parsePatterns(''), []);
  assert.deepEqual(parsePatterns(null), []);
  assert.deepEqual(parsePatterns(undefined), []);
});

/* ------------------------------ globToRegExp ------------------------------ */

test('globToRegExp matches a simple extension glob', () => {
  const re = globToRegExp('*.pdf');
  assert.ok(re.test('book.pdf'));
  assert.ok(!re.test('book.txt'));
});

test('globToRegExp is case-insensitive and anchored', () => {
  const re = globToRegExp('*.PDF');
  assert.ok(re.test('Book.pdf'));
  assert.ok(!re.test('book.pdf.bak'), 'must be anchored to the whole name');
});

test('globToRegExp supports ? single-char and bracket classes', () => {
  assert.ok(globToRegExp('chapter_?.txt').test('chapter_1.txt'));
  assert.ok(!globToRegExp('chapter_?.txt').test('chapter_12.txt'));
  assert.ok(globToRegExp('img_[0-9].png').test('img_3.png'));
});

test('globToRegExp escapes regex metacharacters in the literal parts', () => {
  // dots are literal, not "any char"
  const re = globToRegExp('a.b');
  assert.ok(re.test('a.b'));
  assert.ok(!re.test('axb'));
});

/* ------------------------------ matchesFilters ---------------------------- */

test('matchesFilters: include allows only matching names', () => {
  assert.equal(matchesFilters('a.pdf', { include: ['*.pdf'] }), true);
  assert.equal(matchesFilters('a.txt', { include: ['*.pdf'] }), false);
});

test('matchesFilters: exclude blocks matching names even if included', () => {
  assert.equal(matchesFilters('a_bw.pdf', { include: ['*.pdf'], exclude: ['*_bw.pdf'] }), false);
  assert.equal(matchesFilters('a.pdf', { include: ['*.pdf'], exclude: ['*_bw.pdf'] }), true);
});

test('matchesFilters: no filters means everything passes', () => {
  assert.equal(matchesFilters('anything.xyz', {}), true);
  assert.equal(matchesFilters('anything.xyz', { include: [], exclude: [] }), true);
});

test('matchesFilters: multiple include patterns are ORed', () => {
  const f = { include: ['*.pdf', '*.epub'] };
  assert.equal(matchesFilters('a.pdf', f), true);
  assert.equal(matchesFilters('a.epub', f), true);
  assert.equal(matchesFilters('a.txt', f), false);
});

/* ----------------------- planDownload integration ------------------------- */

// Two image PDFs (both no-text "PDF only" matches) so these tests exercise the
// glob include/exclude logic rather than the format filter's text-PDF exclusion.
const FILES = [
  { name: 'book_color.pdf', format: 'Image Container PDF', size: 100 },
  { name: 'book_bw.pdf', format: 'Image Container PDF', size: 200 },
  { name: 'book.epub', format: 'EPUB', size: 50 },
];

test('planDownload applies an include glob within the chosen format', () => {
  const plan = planDownload(FILES, { format: 'pdf', include: ['*_color.pdf'] });
  assert.deepEqual(plan.map((p) => p.name), ['book_color.pdf']);
});

test('planDownload applies an exclude glob', () => {
  const plan = planDownload(FILES, { format: 'pdf', exclude: ['*_bw.pdf'] });
  assert.deepEqual(plan.map((p) => p.name), ['book_color.pdf']);
});

test('planDownload with no glob filters keeps the format-filtered set', () => {
  const plan = planDownload(FILES, { format: 'pdf' });
  assert.deepEqual(plan.map((p) => p.name).sort(), ['book_bw.pdf', 'book_color.pdf']);
});
