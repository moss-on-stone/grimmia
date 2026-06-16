'use strict';

/**
 * Red/green TDD for idea #2: download an entire collection via the scraping API.
 *
 *  - buildScrapeUrl(query, {cursor, count, fields}) → /services/search/v1/scrape URL
 *  - scrapeAll(query, {fetchPage}) → pages via cursor, concatenating identifiers
 *    (the page-fetch is injected so it's testable with no network).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const core = require('../src/main/ia-core');
const { scrapeAll } = require('../src/main/ia-client');

/* ----------------------------- buildScrapeUrl ----------------------------- */

test('buildScrapeUrl targets the scrape endpoint with the query', () => {
  const url = core.buildScrapeUrl('collection:prelinger');
  assert.ok(url.includes('/services/search/v1/scrape'));
  assert.ok(decodeURIComponent(url).includes('q=collection:prelinger'));
});

test('buildScrapeUrl includes a cursor when provided', () => {
  const url = core.buildScrapeUrl('collection:x', { cursor: 'ABC123' });
  assert.ok(decodeURIComponent(url).includes('cursor=ABC123'));
});

test('buildScrapeUrl omits the cursor on the first page', () => {
  const url = core.buildScrapeUrl('collection:x');
  assert.ok(!url.includes('cursor='));
});

test('buildScrapeUrl requests the identifier field by default', () => {
  const url = core.buildScrapeUrl('collection:x');
  assert.ok(decodeURIComponent(url).includes('fields=identifier'));
});

/* -------------------------------- scrapeAll ------------------------------- */

test('scrapeAll pages through the cursor until exhausted', async () => {
  // Two pages: first returns a cursor, second has no cursor (end).
  const pages = [
    { items: [{ identifier: 'a' }, { identifier: 'b' }], cursor: 'NEXT' },
    { items: [{ identifier: 'c' }] }, // no cursor → done
  ];
  let calls = 0;
  const fetchPage = async (cursor) => {
    if (calls === 0) assert.equal(cursor, undefined, 'first page has no cursor');
    if (calls === 1) assert.equal(cursor, 'NEXT', 'second page uses the returned cursor');
    return pages[calls++];
  };
  const ids = await scrapeAll('collection:x', { fetchPage });
  assert.deepEqual(ids, ['a', 'b', 'c']);
  assert.equal(calls, 2, 'exactly two pages fetched');
});

test('scrapeAll respects a maxItems cap', async () => {
  const fetchPage = async () => ({ items: [{ identifier: '1' }, { identifier: '2' }, { identifier: '3' }], cursor: 'MORE' });
  const ids = await scrapeAll('collection:x', { fetchPage, maxItems: 2 });
  assert.equal(ids.length, 2, 'stops once the cap is reached');
});

test('scrapeAll stops on an empty page even if a cursor is present', async () => {
  const fetchPage = async () => ({ items: [], cursor: 'LOOP' });
  const ids = await scrapeAll('collection:x', { fetchPage });
  assert.deepEqual(ids, []);
});
