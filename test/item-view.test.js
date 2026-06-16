'use strict';

/**
 * Red/green TDD for idea #12: rich item view helpers (pure).
 *
 *  - fileTypeSummary(files): count real files grouped by extension → sorted list
 *  - curatedFields(metadata): pick & order the high-value fields for display
 *  - relatedLinks(metadata): archive.org search/browse URLs for creator &
 *    collection(s) so the modal can offer "more from…" links.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { fileTypeSummary, curatedFields, relatedLinks, relatedSearches, canEditItem, isCollection } = require('../src/shared/item-view');

/* ------------------------------- isCollection ----------------------------- */

test('isCollection detects mediatype "collection"', () => {
  assert.equal(isCollection({ mediatype: 'collection' }), true);
  assert.equal(isCollection({ mediatype: ['collection'] }), true);
  assert.equal(isCollection({ mediatype: 'texts' }), false);
  assert.equal(isCollection({}), false);
  assert.equal(isCollection(null), false);
});

/* ----------------------------- fileTypeSummary ---------------------------- */

const FILES = [
  { name: 'book.pdf', format: 'Text PDF', size: 100 },
  { name: 'book_bw.pdf', format: 'Image Container PDF', size: 200 },
  { name: 'book.epub', format: 'EPUB', size: 50 },
  { name: 'book_djvu.txt', format: 'DjVuTXT', size: 10 },
  { name: '__ia_thumb.jpg', source: 'metadata' }, // noise, excluded
  { name: 'book_meta.xml', format: 'Metadata' }, // noise, excluded
];

test('fileTypeSummary counts real files by extension, sorted by count', () => {
  const summary = fileTypeSummary(FILES);
  const map = Object.fromEntries(summary.map((s) => [s.ext, s.count]));
  assert.equal(map.pdf, 2);
  assert.equal(map.epub, 1);
  assert.equal(map.txt, 1);
  assert.ok(!('xml' in map), 'metadata noise excluded');
  // sorted by count desc → pdf first
  assert.equal(summary[0].ext, 'pdf');
});

test('fileTypeSummary sums sizes per type', () => {
  const summary = fileTypeSummary(FILES);
  const pdf = summary.find((s) => s.ext === 'pdf');
  assert.equal(pdf.bytes, 300);
});

test('fileTypeSummary returns [] for no files', () => {
  assert.deepEqual(fileTypeSummary([]), []);
  assert.deepEqual(fileTypeSummary(null), []);
});

/* ------------------------------ curatedFields ----------------------------- */

const META = {
  title: 'Kokoro',
  creator: 'Natsume Soseki',
  date: '1914',
  publisher: 'Iwanami',
  language: 'Japanese',
  subject: ['fiction', 'literature'],
  description: 'A novel.',
  identifier: 'kokoro',
  scanner: 'internal-noise', // not curated
};

test('curatedFields returns the high-value fields in a stable display order', () => {
  const fields = curatedFields(META);
  const keys = fields.map((f) => f.key);
  // creator before date before publisher before language before subject
  assert.deepEqual(
    keys.filter((k) => ['creator', 'date', 'publisher', 'language', 'subject'].includes(k)),
    ['creator', 'date', 'publisher', 'language', 'subject']
  );
});

test('curatedFields omits empty/absent fields', () => {
  const fields = curatedFields({ title: 'X', creator: '' });
  assert.ok(!fields.some((f) => f.key === 'creator'));
});

test('curatedFields joins array values for display', () => {
  const fields = curatedFields(META);
  const subj = fields.find((f) => f.key === 'subject');
  assert.equal(subj.value, 'fiction, literature');
});

/* ------------------------------- relatedLinks ----------------------------- */

test('relatedLinks builds a creator search URL', () => {
  const links = relatedLinks(META);
  const creator = links.find((l) => l.kind === 'creator');
  assert.ok(creator.url.includes('archive.org'));
  assert.ok(/creator/.test(decodeURIComponent(creator.url)));
  assert.ok(/Natsume Soseki/.test(decodeURIComponent(creator.url)));
});

test('relatedLinks builds one link per collection', () => {
  const links = relatedLinks({ ...META, collection: ['jp-texts', 'soseki'] });
  const cols = links.filter((l) => l.kind === 'collection');
  assert.equal(cols.length, 2);
  assert.ok(cols[0].url.includes('/details/jp-texts'));
});

test('relatedLinks returns [] when there is no creator or collection', () => {
  assert.deepEqual(relatedLinks({ title: 'X' }), []);
});

/* ------------------------------ relatedSearches (#13) --------------------- */
// In-app searches (not website links) for the creator and each collection.

test('relatedSearches gives an in-app creator search descriptor (#13)', () => {
  const searches = relatedSearches(META);
  const creator = searches.find((s) => s.kind === 'creator');
  assert.equal(creator.label, 'More by Natsume Soseki');
  // Runs an advanced (field) search inside the app, not a URL.
  assert.equal(creator.search.type, 'advanced');
  assert.equal(creator.search.fields.creator, 'Natsume Soseki');
  assert.ok(!('url' in creator), 'must not be a website link');
});

test('relatedSearches gives one in-app collection search per collection (#13)', () => {
  const searches = relatedSearches({ ...META, collection: ['jp-texts', 'soseki'] });
  const cols = searches.filter((s) => s.kind === 'collection');
  assert.equal(cols.length, 2);
  assert.equal(cols[0].label, 'Collection: jp-texts');
  assert.equal(cols[0].search.type, 'advanced');
  assert.equal(cols[0].search.fields.collection, 'jp-texts');
});

test('relatedSearches returns [] when there is no creator or collection (#13)', () => {
  assert.deepEqual(relatedSearches({ title: 'X' }), []);
});

/* ------------------------------ canEditItem (#12) ------------------------- */
// Edit-metadata / Tasks are only offered when the logged-in account owns the
// item — i.e. the item's uploader matches the account's screenname or email.

test('canEditItem is true when uploader matches the account email (#12)', () => {
  const md = { uploader: 'jane@example.com' };
  assert.equal(canEditItem(md, { email: 'jane@example.com', screenname: 'jane' }), true);
});

test('canEditItem matches case-insensitively and trims (#12)', () => {
  const md = { uploader: '  Jane@Example.com ' };
  assert.equal(canEditItem(md, { email: 'jane@example.com' }), true);
});

test('canEditItem matches the screenname too (some items record the username) (#12)', () => {
  assert.equal(canEditItem({ uploader: 'jane' }, { screenname: 'jane', email: 'x@y.z' }), true);
});

test('canEditItem handles uploader given as an array (#12)', () => {
  assert.equal(canEditItem({ uploader: ['jane@example.com'] }, { email: 'jane@example.com' }), true);
});

test('canEditItem is false for a different account (#12)', () => {
  assert.equal(canEditItem({ uploader: 'bob@example.com' }, { email: 'jane@example.com', screenname: 'jane' }), false);
});

test('canEditItem is false when not logged in or uploader is unknown (#12)', () => {
  assert.equal(canEditItem({ uploader: 'jane@example.com' }, null), false);
  assert.equal(canEditItem({ uploader: 'jane@example.com' }, {}), false);
  assert.equal(canEditItem({}, { email: 'jane@example.com' }), false);
  assert.equal(canEditItem(null, { email: 'jane@example.com' }), false);
});
