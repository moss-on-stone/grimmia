'use strict';

/**
 * Red/green TDD for the selection / filtering / paging pure helpers:
 *  - rangeIndices(from, to)        → inclusive index list in either direction (#3)
 *  - titleMatches(doc, query)      → live title-filter predicate (#10)
 *  - clampJumpPage(input, total)   → validate a typed page number (#7)
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  rangeIndices,
  titleMatches,
  clampJumpPage,
  sanitizeYearInput,
  selectionSummary,
  queueDropTarget,
} = require('../src/shared/selection');

/* ------------------------------ rangeIndices ------------------------------ */

test('rangeIndices returns an inclusive ascending range', () => {
  assert.deepEqual(rangeIndices(2, 5), [2, 3, 4, 5]);
});

test('rangeIndices handles a descending click (anchor below target)', () => {
  assert.deepEqual(rangeIndices(5, 2), [2, 3, 4, 5]);
});

test('rangeIndices of a single index is just that index', () => {
  assert.deepEqual(rangeIndices(3, 3), [3]);
});

/* ------------------------------ titleMatches ------------------------------ */

test('titleMatches is case-insensitive substring on the title', () => {
  assert.equal(titleMatches({ title: 'Grateful Dead 1977' }, 'dead'), true);
  assert.equal(titleMatches({ title: 'Grateful Dead 1977' }, 'DEAD'), true);
  assert.equal(titleMatches({ title: 'Grateful Dead 1977' }, 'phish'), false);
});

test('titleMatches handles array titles (IA returns arrays)', () => {
  assert.equal(titleMatches({ title: ['The Pyongyang Times'] }, 'pyongyang'), true);
});

test('titleMatches with a blank query matches everything', () => {
  assert.equal(titleMatches({ title: 'anything' }, ''), true);
  assert.equal(titleMatches({ title: 'anything' }, '   '), true);
});

test('titleMatches falls back to identifier when there is no title', () => {
  assert.equal(titleMatches({ identifier: 'cia-rdp80' }, 'rdp80'), true);
});

/* ------------------------------ clampJumpPage ----------------------------- */

test('clampJumpPage parses and clamps a typed page into [1, total]', () => {
  assert.equal(clampJumpPage('5', 10), 5);
  assert.equal(clampJumpPage('0', 10), 1, 'below 1 clamps to 1');
  assert.equal(clampJumpPage('99', 10), 10, 'above total clamps to total');
  assert.equal(clampJumpPage('3.7', 10), 3, 'truncates to an integer');
});

test('clampJumpPage returns null for non-numeric input', () => {
  assert.equal(clampJumpPage('abc', 10), null);
  assert.equal(clampJumpPage('', 10), null);
});

/* ----------------------------- sanitizeYearInput -------------------------- */

test('sanitizeYearInput strips letters and punctuation other than a month hyphen', () => {
  assert.equal(sanitizeYearInput('19a4b5'), '1945');
  assert.equal(sanitizeYearInput('-5'), '5', 'a leading minus before the year is dropped');
  assert.equal(sanitizeYearInput('19.4'), '194');
});

test('sanitizeYearInput caps the YEAR portion at 4 digits', () => {
  assert.equal(sanitizeYearInput('19400622'), '1940');
  assert.equal(sanitizeYearInput('99999'), '9999');
});

test('sanitizeYearInput passes a clean 4-digit year through', () => {
  assert.equal(sanitizeYearInput('1977'), '1977');
});

test('sanitizeYearInput allows an optional YYYY-MM month suffix (#11)', () => {
  assert.equal(sanitizeYearInput('1940-09'), '1940-09');
  assert.equal(sanitizeYearInput('1940-9'), '1940-9', 'single-digit month kept');
  assert.equal(sanitizeYearInput('1940-'), '1940-', 'a trailing hyphen is allowed while typing');
});

test('sanitizeYearInput caps the MONTH portion at 2 digits and ignores extra hyphens (#11)', () => {
  assert.equal(sanitizeYearInput('1940-099'), '1940-09');
  assert.equal(sanitizeYearInput('1940-9-3'), '1940-9', 'only the first month group is kept');
});

test('sanitizeYearInput handles empty / nullish input', () => {
  assert.equal(sanitizeYearInput(''), '');
  assert.equal(sanitizeYearInput(null), '');
  assert.equal(sanitizeYearInput(undefined), '');
});

/* ----------------------------- selectionSummary --------------------------- */

test('selectionSummary with nothing selected: no deselect, select-all off', () => {
  const s = selectionSummary(0, 50);
  assert.equal(s.label, '0 selected');
  assert.equal(s.canDeselect, false);
  assert.equal(s.allOnPageSelected, false);
});

test('selectionSummary with some selected enables deselect', () => {
  const s = selectionSummary(3, 50);
  assert.equal(s.label, '3 selected');
  assert.equal(s.canDeselect, true);
  assert.equal(s.allOnPageSelected, false);
});

test('selectionSummary marks all-on-page when count >= page size', () => {
  // Selection persists across pages (#9), so the page checkbox reflects the
  // current page, not the global count — but the summary still knows when the
  // whole visible page is covered.
  const s = selectionSummary(50, 50);
  assert.equal(s.allOnPageSelected, true);
  assert.equal(s.canDeselect, true);
});

test('selectionSummary treats an empty page as not-all-selected', () => {
  const s = selectionSummary(0, 0);
  assert.equal(s.allOnPageSelected, false);
  assert.equal(s.canDeselect, false);
});

/* ----------------------------- queueDropTarget ---------------------------- */
// Translate a drag-drop within a transfer section into a move target index in
// the WAITING list. The waiting list is the ordered queued (not-active) jobs.
// `beforeId` is the job the dragged card was dropped *before* (null = end).

test('queueDropTarget drops before another waiting job', () => {
  // waiting: [b, c, d]; drag d before b → index 0
  assert.equal(queueDropTarget('d', 'b', ['b', 'c', 'd']), 0);
  // drag b before d → index of d after removing b = 1
  assert.equal(queueDropTarget('b', 'd', ['b', 'c', 'd']), 1);
});

test('queueDropTarget with no anchor drops at the end', () => {
  assert.equal(queueDropTarget('b', null, ['b', 'c', 'd']), 2);
});

test('queueDropTarget returns null when the move is a no-op (same slot)', () => {
  // drag b before c, but b is already right before c → no change
  assert.equal(queueDropTarget('b', 'c', ['b', 'c', 'd']), null);
  // drag onto itself
  assert.equal(queueDropTarget('b', 'b', ['b', 'c', 'd']), null);
});

test('queueDropTarget returns null for an unknown dragged id', () => {
  assert.equal(queueDropTarget('zzz', 'b', ['b', 'c', 'd']), null);
});
