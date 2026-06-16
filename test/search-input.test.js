'use strict';

/**
 * Red/green TDD for idea #13: parse `field:` meta keywords typed in the basic
 * search box into structured advanced fields, leaving the rest as free text.
 *
 * parseSearchInput("title:kokoro soseki subject:fiction")
 *   → { fields: { title: 'kokoro', subject: 'fiction', text: 'soseki' } }
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parseSearchInput } = require('../src/main/ia-query');

test('plain text with no keywords becomes the free-text field', () => {
  const r = parseSearchInput('grateful dead 1977');
  assert.deepEqual(r.fields, { text: 'grateful dead 1977' });
});

test('a single field: keyword is extracted', () => {
  const r = parseSearchInput('title:kokoro');
  assert.equal(r.fields.title, 'kokoro');
  assert.ok(!r.fields.text);
});

test('quoted values keep their spaces', () => {
  const r = parseSearchInput('title:"market street" subject:history');
  assert.equal(r.fields.title, 'market street');
  assert.equal(r.fields.subject, 'history');
});

test('field keywords mix with leftover free text', () => {
  const r = parseSearchInput('title:kokoro soseki subject:fiction');
  assert.equal(r.fields.title, 'kokoro');
  assert.equal(r.fields.subject, 'fiction');
  assert.equal(r.fields.text, 'soseki');
});

test('recognizes the supported field aliases', () => {
  const r = parseSearchInput('creator:soseki language:jpn mediatype:texts date:1914');
  assert.equal(r.fields.creator, 'soseki');
  assert.equal(r.fields.language, 'jpn');
  assert.equal(r.fields.mediatype, 'texts');
  assert.equal(r.fields.date, '1914');
});

test('unknown field-like tokens are treated as free text (not eaten)', () => {
  const r = parseSearchInput('http://x foo:bar baz');
  // foo: is not a known field, so the whole thing is free text.
  assert.match(r.fields.text, /foo:bar/);
  assert.match(r.fields.text, /baz/);
});

test('is case-insensitive on the field name', () => {
  const r = parseSearchInput('Title:Kokoro');
  assert.equal(r.fields.title, 'Kokoro');
});

test('empty input yields empty fields', () => {
  assert.deepEqual(parseSearchInput('').fields, {});
  assert.deepEqual(parseSearchInput('   ').fields, {});
});
