'use strict';

/**
 * Red/green TDD: the renderer keeps its own copy of the recognized search-field
 * names (it can't require() the main-process ia-query.js), used to auto-blank the
 * search-box scope dropdown. This test guards the two lists against drift — if
 * ia-query.js SEARCH_FIELDS changes, the renderer constant must change too.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { SEARCH_FIELDS } = require('../src/main/ia-query');

/** Pull `const SEARCH_FIELDS = [ ... ];` out of a source file as a string array. */
function extractSearchFields(src) {
  const m = /const SEARCH_FIELDS\s*=\s*\[([^\]]*)\]/.exec(src);
  if (!m) return null;
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

test('renderer SEARCH_FIELDS matches the canonical ia-query SEARCH_FIELDS', () => {
  const rendererSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'renderer.js'), 'utf8');
  const rendererFields = extractSearchFields(rendererSrc);
  assert.ok(rendererFields, 'renderer.js should declare a SEARCH_FIELDS array');
  assert.deepEqual(rendererFields, SEARCH_FIELDS, 'renderer SEARCH_FIELDS drifted from ia-query SEARCH_FIELDS');
});
