'use strict';

/**
 * Red/green TDD for idea #15: reusable upload metadata templates.
 *
 *  - addTemplate / removeTemplate (named, unique).
 *  - applyTemplate(template, currentForm): fill blanks from the template without
 *    clobbering fields the user already typed.
 *  - extractFilesFromDrop(dataTransferFiles): normalize a drop into {path,name,size}.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  addTemplate,
  removeTemplate,
  applyTemplate,
  extractDroppedFiles,
  deriveTitleFromFilename,
  deriveIdentifierFromFilename,
  nextUploadForm,
} = require('../src/shared/upload-templates');

/* ----------------------------- add / remove ------------------------------ */

test('addTemplate adds a named template', () => {
  const out = addTemplate([], { name: 'Books', fields: { mediatype: 'texts' } });
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'Books');
});

test('addTemplate replaces a template with the same name', () => {
  let list = addTemplate([], { name: 'Books', fields: { creator: 'A' } });
  list = addTemplate(list, { name: 'Books', fields: { creator: 'B' } });
  assert.equal(list.length, 1);
  assert.equal(list[0].fields.creator, 'B');
});

test('removeTemplate drops by name', () => {
  const list = [{ name: 'A', fields: {} }, { name: 'B', fields: {} }];
  assert.deepEqual(removeTemplate(list, 'A').map((t) => t.name), ['B']);
});

/* ------------------------------ applyTemplate ----------------------------- */

test('applyTemplate fills only the blank fields of the current form', () => {
  const tmpl = { fields: { creator: 'Soseki', mediatype: 'texts', subjects: 'lit' } };
  const form = { creator: '', mediatype: 'audio', subjects: '' };
  const out = applyTemplate(tmpl, form);
  assert.equal(out.creator, 'Soseki', 'blank creator filled');
  assert.equal(out.mediatype, 'audio', 'user value NOT overwritten');
  assert.equal(out.subjects, 'lit', 'blank subjects filled');
});

test('applyTemplate does not mutate the form', () => {
  const form = { creator: '' };
  const copy = { ...form };
  applyTemplate({ fields: { creator: 'X' } }, form);
  assert.deepEqual(form, copy);
});

/* --------------------------- extractDroppedFiles -------------------------- */

test('extractDroppedFiles maps file objects to {path,name,size}', () => {
  const dropped = [
    { path: '/a/x.pdf', name: 'x.pdf', size: 10 },
    { path: '/a/y.txt', name: 'y.txt', size: 20 },
  ];
  assert.deepEqual(extractDroppedFiles(dropped), [
    { path: '/a/x.pdf', name: 'x.pdf', size: 10 },
    { path: '/a/y.txt', name: 'y.txt', size: 20 },
  ]);
});

test('extractDroppedFiles skips entries without a path', () => {
  const dropped = [{ name: 'no-path.pdf', size: 5 }, { path: '/a/ok.pdf', name: 'ok.pdf', size: 1 }];
  const out = extractDroppedFiles(dropped);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'ok.pdf');
});

test('extractDroppedFiles derives name from the path when name is missing', () => {
  const out = extractDroppedFiles([{ path: '/a/b/c.epub', size: 3 }]);
  assert.equal(out[0].name, 'c.epub');
});

/* ---------------------- title / identifier from filename ------------------ */

test('deriveTitleFromFilename uses the filename without its extension', () => {
  assert.equal(deriveTitleFromFilename('My Great Book.pdf'), 'My Great Book');
  assert.equal(deriveTitleFromFilename('/some/dir/My Great Book.pdf'), 'My Great Book');
});

test('deriveTitleFromFilename keeps a name that has no extension', () => {
  assert.equal(deriveTitleFromFilename('README'), 'README');
});

test('deriveTitleFromFilename only strips the final extension', () => {
  assert.equal(deriveTitleFromFilename('archive.tar.gz'), 'archive.tar');
});

test('deriveIdentifierFromFilename lowercases and uses - for spaces, no extension', () => {
  assert.equal(deriveIdentifierFromFilename('My Great Book.pdf'), 'my-great-book');
});

test('deriveIdentifierFromFilename collapses runs of separators and trims them', () => {
  assert.equal(deriveIdentifierFromFilename('  Hello   World!! .txt'), 'hello-world');
  assert.equal(deriveIdentifierFromFilename('a__b--c.pdf'), 'a_b-c');
});

test('deriveIdentifierFromFilename keeps allowed . _ - characters', () => {
  assert.equal(deriveIdentifierFromFilename('report_v2.final.pdf'), 'report_v2.final');
});

test('deriveIdentifierFromFilename encodes non-Roman chars as u<hex codepoint>', () => {
  // 日 = U+65E5, 記 = U+8A18
  assert.equal(deriveIdentifierFromFilename('日記.pdf'), 'u65e5u8a18');
  // mixed: "東京 notes" → tokyo chars encoded, space → -
  assert.equal(deriveIdentifierFromFilename('東京 notes.pdf'), 'u6771u4eac-notes');
});

test('deriveIdentifierFromFilename handles an emoji (astral codepoint)', () => {
  // 😀 = U+1F600
  assert.equal(deriveIdentifierFromFilename('hi😀.png'), 'hiu1f600');
});

test('deriveIdentifierFromFilename falls back to "item" when nothing is left', () => {
  assert.equal(deriveIdentifierFromFilename('   .pdf'), 'item');
  assert.equal(deriveIdentifierFromFilename(''), 'item');
});

test('deriveIdentifierFromFilename produces a valid IA identifier', () => {
  const IA_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;
  for (const name of ['My Book.pdf', '日記.pdf', 'a__b--c.pdf', 'report_v2.final.pdf', '東京 notes.pdf']) {
    assert.ok(IA_RE.test(deriveIdentifierFromFilename(name)), `invalid id for ${name}: ${deriveIdentifierFromFilename(name)}`);
  }
});

/* ------------------------- nextUploadForm (reset rule) -------------------- */

const PREV = {
  identifier: 'old-id',
  title: 'Old Title',
  creator: 'Jane',
  date: '2020-01-01',
  mediatype: 'audio',
  language: 'jpn',
  description: 'desc',
  subjects: 'a, b',
};

test('nextUploadForm clears file/identifier/title regardless of the toggle', () => {
  const kept = nextUploadForm(PREV, true);
  assert.equal(kept.identifier, '');
  assert.equal(kept.title, '');
  const cleared = nextUploadForm(PREV, false);
  assert.equal(cleared.identifier, '');
  assert.equal(cleared.title, '');
});

test('nextUploadForm preserves metadata when preserve=true', () => {
  const out = nextUploadForm(PREV, true);
  assert.equal(out.creator, 'Jane');
  assert.equal(out.date, '2020-01-01');
  assert.equal(out.mediatype, 'audio');
  assert.equal(out.language, 'jpn');
  assert.equal(out.description, 'desc');
  assert.equal(out.subjects, 'a, b');
});

test('nextUploadForm wipes everything when preserve=false', () => {
  const out = nextUploadForm(PREV, false);
  assert.equal(out.creator, '');
  assert.equal(out.date, '');
  assert.equal(out.language, '');
  assert.equal(out.description, '');
  assert.equal(out.subjects, '');
  // mediatype resets to the default 'texts' rather than blank (it's a select).
  assert.equal(out.mediatype, 'texts');
});
