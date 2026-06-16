'use strict';

/**
 * Red/green TDD for idea #13: favorites / bookmarks (pure list logic).
 * Favorites are { identifier, title, mediatype, savedAt } deduped by identifier,
 * most-recently-added first.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  addFavorite,
  removeFavorite,
  hasFavorite,
  toggleFavorite,
} = require('../src/shared/favorites');

const A = { identifier: 'a', title: 'Item A' };
const B = { identifier: 'b', title: 'Item B' };

test('addFavorite prepends a new favorite', () => {
  const out = addFavorite([A], B);
  assert.deepEqual(out.map((f) => f.identifier), ['b', 'a']);
});

test('addFavorite de-duplicates by identifier (no double-star)', () => {
  const out = addFavorite([A], { identifier: 'a', title: 'Item A again' });
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'Item A again', 'updates the stored entry');
});

test('addFavorite stamps savedAt when provided', () => {
  const out = addFavorite([], A, 1234);
  assert.equal(out[0].savedAt, 1234);
});

test('removeFavorite drops by identifier', () => {
  assert.deepEqual(removeFavorite([A, B], 'a').map((f) => f.identifier), ['b']);
});

test('hasFavorite reports membership', () => {
  assert.equal(hasFavorite([A, B], 'b'), true);
  assert.equal(hasFavorite([A], 'b'), false);
});

test('toggleFavorite adds when absent and removes when present', () => {
  const added = toggleFavorite([A], B);
  assert.equal(hasFavorite(added, 'b'), true);
  const removed = toggleFavorite(added, B);
  assert.equal(hasFavorite(removed, 'b'), false);
});

test('the list operations do not mutate their input', () => {
  const start = [A];
  const copy = start.slice();
  addFavorite(start, B);
  removeFavorite(start, 'a');
  toggleFavorite(start, B);
  assert.deepEqual(start, copy);
});
