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

/* ------------------------ retry a failed upload -------------------------- */

const { uploadRetrySnapshot, identifierCheckNotice } = require('../src/shared/upload-templates');

test('uploadRetrySnapshot keeps every form field and the file list', () => {
  const form = {
    identifier: 'china-year-book-1923',
    title: 'The China Year Book 1923',
    creator: 'Woodhead',
    date: '1923',
    mediatype: 'texts',
    language: 'eng',
    description: 'line one\nline two',
    subjects: 'China, yearbook',
    rtl: false,
    oneUp: true,
  };
  const files = [{ path: '/x/The China Year Book 1923.pdf', name: 'The China Year Book 1923.pdf', size: 123 }];
  const snap = uploadRetrySnapshot(form, files);
  assert.deepEqual(snap.form, form);
  assert.deepEqual(snap.files, files);
});

test('uploadRetrySnapshot is a copy — later form/file edits do not leak into it', () => {
  const form = { identifier: 'a', title: 'A', subjects: 'x' };
  const files = [{ path: '/p/a.pdf', name: 'a.pdf', size: 1 }];
  const snap = uploadRetrySnapshot(form, files);
  form.title = 'changed';
  files[0].name = 'changed.pdf';
  files.push({ path: '/p/b.pdf', name: 'b.pdf', size: 2 });
  assert.equal(snap.form.title, 'A');
  assert.equal(snap.files.length, 1);
  assert.equal(snap.files[0].name, 'a.pdf');
});

test('uploadRetrySnapshot keeps only path/name/size of each file', () => {
  const snap = uploadRetrySnapshot({}, [{ path: '/p/a.pdf', name: 'a.pdf', size: 5, extra: 'drop me' }]);
  assert.deepEqual(snap.files, [{ path: '/p/a.pdf', name: 'a.pdf', size: 5 }]);
});

/* --------------------- identifier availability notice -------------------- */

test('identifierCheckNotice: available → ok', () => {
  const n = identifierCheckNotice({ status: 'available', identifier: 'new-item' });
  assert.equal(n.level, 'ok');
  assert.match(n.text, /available/i);
});

test('identifierCheckNotice: taken by someone else → err, asks for another', () => {
  const n = identifierCheckNotice({ status: 'taken', identifier: 'x', owned: false });
  assert.equal(n.level, 'err');
  assert.match(n.text, /already taken/i);
});

test('identifierCheckNotice: taken but owned by this account → warn, files get added', () => {
  const n = identifierCheckNotice({ status: 'taken', identifier: 'x', owned: true });
  assert.equal(n.level, 'warn');
  assert.match(n.text, /your item/i);
  assert.match(n.text, /add/i);
});

test('identifierCheckNotice: unknown / failed check → no notice', () => {
  assert.equal(identifierCheckNotice({ status: 'unknown', identifier: 'x' }), null);
  assert.equal(identifierCheckNotice(null), null);
});

/* ---------- Electron 32+: File.path is gone — resolve via a getter -------- */

test('extractDroppedFiles resolves paths through getPath (webUtils.getPathForFile)', () => {
  // Electron >= 32 File objects have NO .path; the preload resolves it.
  const f1 = { name: 'x.pdf', size: 10 };
  const f2 = { name: 'y.pdf', size: 20 };
  const paths = new Map([[f1, '/a/x.pdf'], [f2, '/a/y.pdf']]);
  assert.deepEqual(extractDroppedFiles([f1, f2], (f) => paths.get(f)), [
    { path: '/a/x.pdf', name: 'x.pdf', size: 10 },
    { path: '/a/y.pdf', name: 'y.pdf', size: 20 },
  ]);
});

test('extractDroppedFiles skips files the getter cannot resolve (empty string)', () => {
  const out = extractDroppedFiles([{ name: 'url-drag', size: 0 }], () => '');
  assert.deepEqual(out, []);
});

test('extractDroppedFiles survives a throwing getter', () => {
  const out = extractDroppedFiles([{ name: 'x', size: 1 }], () => {
    throw new Error('not a File');
  });
  assert.deepEqual(out, []);
});
