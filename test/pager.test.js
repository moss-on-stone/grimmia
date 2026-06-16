'use strict';

/**
 * Red/green TDD for M6: advancedsearch.php caps deep paging (page*rows must stay
 * under ~10,000). The old pager offered ceil(numFound/rows) pages — up to ~20,000
 * for a million-hit query — but requesting past ~page 208 returns an error/empty.
 *
 * `pagerInfo(numFound, rows, page)` computes the CAPPED page count and whether
 * the cap was hit (so the UI can show a "refine to see more" note).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { pagerInfo, MAX_DEEP_PAGING } = require('../src/shared/pager');

test('MAX_DEEP_PAGING reflects advancedsearch.php\'s ~10k window', () => {
  assert.equal(MAX_DEEP_PAGING, 10000);
});

test('pagerInfo returns the natural page count when under the cap', () => {
  const info = pagerInfo(480, 48, 1); // 10 pages, well under cap
  assert.equal(info.totalPages, 10);
  assert.equal(info.capped, false);
});

test('pagerInfo caps the page count at floor(10000/rows) for huge result sets', () => {
  const info = pagerInfo(1_000_000, 48, 1);
  assert.equal(info.totalPages, Math.floor(10000 / 48)); // 208
  assert.equal(info.capped, true);
});

test('pagerInfo exposes hasPrev/hasNext correctly within the capped range', () => {
  const first = pagerInfo(1_000_000, 48, 1);
  assert.equal(first.hasPrev, false);
  assert.equal(first.hasNext, true);

  const last = pagerInfo(1_000_000, 48, 208);
  assert.equal(last.hasPrev, true);
  assert.equal(last.hasNext, false, 'must not offer Next past the deep-paging cap');
});

test('pagerInfo with zero results has a single (empty) page and no nav', () => {
  const info = pagerInfo(0, 48, 1);
  assert.equal(info.totalPages, 0);
  assert.equal(info.hasNext, false);
  assert.equal(info.hasPrev, false);
  assert.equal(info.capped, false);
});

test('pagerInfo never lets the page exceed the capped total (clamps hasNext)', () => {
  // Exactly at the cap boundary: 10000/48 = 208.33 → 208 pages.
  const info = pagerInfo(10000, 48, 208);
  assert.equal(info.totalPages, 208);
  assert.equal(info.hasNext, false);
});
