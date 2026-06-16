'use strict';

/**
 * Red/green TDD for idea #10: client-side sorting of search result docs for the
 * compact list view (title, date, downloads, item_size, mediatype), asc/desc.
 *
 * sortDocs(docs, key, dir) returns a NEW sorted array (stable, non-mutating).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { sortDocs, SORT_KEYS } = require('../src/shared/sort-docs');

const DOCS = [
  { identifier: 'b', title: 'Banana', date: '2001-01-01', downloads: 50, item_size: 300, mediatype: 'texts' },
  { identifier: 'a', title: 'apple', date: '1999-05-05', downloads: 200, item_size: 100, mediatype: 'audio' },
  { identifier: 'c', title: 'Cherry', date: '2010-12-31', downloads: 10, item_size: 200, mediatype: 'movies' },
];

test('SORT_KEYS lists the supported columns', () => {
  for (const k of ['title', 'date', 'downloads', 'item_size', 'mediatype']) {
    assert.ok(SORT_KEYS.includes(k), `missing sort key ${k}`);
  }
});

test('sortDocs by title is case-insensitive ascending', () => {
  const out = sortDocs(DOCS, 'title', 'asc').map((d) => d.identifier);
  assert.deepEqual(out, ['a', 'b', 'c']); // apple, Banana, Cherry
});

test('sortDocs by title descending reverses the order', () => {
  const out = sortDocs(DOCS, 'title', 'desc').map((d) => d.identifier);
  assert.deepEqual(out, ['c', 'b', 'a']);
});

test('sortDocs by downloads sorts numerically (not lexically)', () => {
  const out = sortDocs(DOCS, 'downloads', 'desc').map((d) => d.downloads);
  assert.deepEqual(out, [200, 50, 10]);
});

test('sortDocs by item_size numeric ascending', () => {
  const out = sortDocs(DOCS, 'item_size', 'asc').map((d) => d.item_size);
  assert.deepEqual(out, [100, 200, 300]);
});

test('sortDocs by date ascending', () => {
  const out = sortDocs(DOCS, 'date', 'asc').map((d) => d.identifier);
  assert.deepEqual(out, ['a', 'b', 'c']); // 1999, 2001, 2010
});

test('sortDocs does not mutate the input array', () => {
  const copy = DOCS.slice();
  sortDocs(DOCS, 'title', 'asc');
  assert.deepEqual(DOCS, copy, 'original order preserved');
});

test('sortDocs tolerates array-valued fields (IA returns arrays) and missing values', () => {
  const docs = [
    { identifier: 'x', title: ['Zed'], downloads: undefined },
    { identifier: 'y', title: ['alpha'], downloads: 5 },
  ];
  const out = sortDocs(docs, 'title', 'asc').map((d) => d.identifier);
  assert.deepEqual(out, ['y', 'x']); // alpha < Zed
  // missing numeric sorts as 0/last without throwing
  assert.doesNotThrow(() => sortDocs(docs, 'downloads', 'desc'));
});

test('sortDocs with an unknown key returns the docs unchanged (new array)', () => {
  const out = sortDocs(DOCS, 'bogus', 'asc');
  assert.deepEqual(out.map((d) => d.identifier), ['b', 'a', 'c']);
  assert.notEqual(out, DOCS);
});
