'use strict';

/**
 * Red/green TDD for idea #14: bulk / spreadsheet upload.
 *
 * IMPORTANT: this only PARSES the CSV and builds an upload PLAN — it never
 * contacts archive.org. The user tests real uploads themselves.
 *
 *  - parseCsv(text) → array of row objects keyed by header.
 *  - buildUploadPlan(rows) → per-identifier upload jobs with files + metadata.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parseCsv, buildUploadPlan } = require('../src/main/csv');

/* -------------------------------- parseCsv -------------------------------- */

test('parseCsv parses a simple header + rows into objects', () => {
  const rows = parseCsv('identifier,file,title\nid1,a.pdf,Book A\nid2,b.pdf,Book B');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { identifier: 'id1', file: 'a.pdf', title: 'Book A' });
  assert.equal(rows[1].title, 'Book B');
});

test('parseCsv handles quoted fields containing commas', () => {
  const rows = parseCsv('identifier,title\nid1,"Hello, World"');
  assert.equal(rows[0].title, 'Hello, World');
});

test('parseCsv handles escaped double-quotes ("") inside quoted fields', () => {
  const rows = parseCsv('identifier,title\nid1,"She said ""hi"""');
  assert.equal(rows[0].title, 'She said "hi"');
});

test('parseCsv handles quoted fields with embedded newlines', () => {
  const rows = parseCsv('identifier,description\nid1,"line one\nline two"');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].description, 'line one\nline two');
});

test('parseCsv skips blank trailing lines and trims the header', () => {
  const rows = parseCsv(' identifier , file \nid1,a.pdf\n\n');
  assert.deepEqual(Object.keys(rows[0]), ['identifier', 'file']);
  assert.equal(rows.length, 1);
});

test('parseCsv tolerates CRLF line endings', () => {
  const rows = parseCsv('identifier,file\r\nid1,a.pdf\r\nid2,b.pdf');
  assert.equal(rows.length, 2);
  assert.equal(rows[1].identifier, 'id2');
});

/* ----------------------------- buildUploadPlan ---------------------------- */

test('buildUploadPlan groups multiple files under the same identifier', () => {
  const rows = [
    { identifier: 'book1', file: 'ch1.pdf', title: 'Book One' },
    { identifier: 'book1', file: 'ch2.pdf' },
    { identifier: 'book2', file: 'x.pdf', title: 'Book Two' },
  ];
  const plan = buildUploadPlan(rows);
  assert.equal(plan.length, 2);
  const book1 = plan.find((p) => p.identifier === 'book1');
  assert.deepEqual(book1.files, ['ch1.pdf', 'ch2.pdf']);
  assert.equal(book1.metadata.title, 'Book One', 'metadata taken from the first row');
});

test('buildUploadPlan separates metadata columns from identifier/file', () => {
  const rows = [{ identifier: 'id', file: 'a.pdf', title: 'T', creator: 'C', mediatype: 'texts' }];
  const plan = buildUploadPlan(rows);
  assert.deepEqual(plan[0].metadata, { title: 'T', creator: 'C', mediatype: 'texts' });
  assert.ok(!('file' in plan[0].metadata));
  assert.ok(!('identifier' in plan[0].metadata));
});

test('buildUploadPlan reports rows with a missing identifier or file as errors', () => {
  const { plan, errors } = buildUploadPlan(
    [
      { identifier: '', file: 'a.pdf' },
      { identifier: 'ok', file: '' },
      { identifier: 'good', file: 'g.pdf' },
    ],
    { withErrors: true }
  );
  assert.equal(plan.length, 1, 'only the valid row is planned');
  assert.equal(errors.length, 2);
});

test('buildUploadPlan rejects an invalid identifier', () => {
  const { plan, errors } = buildUploadPlan([{ identifier: 'Bad ID', file: 'a.pdf' }], { withErrors: true });
  assert.equal(plan.length, 0);
  assert.match(errors[0], /identifier/i);
});
