'use strict';

/**
 * Red/green TDD for download preferences: filtering an item's files by format,
 * and renaming/appending the sanitized item title to downloaded filenames.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  FORMAT_PRESETS,
  filterFilesByFormat,
  sanitizeFilename,
  applyTitleToFilename,
  planDownload,
  resolveDownloadPlan,
} = require('../src/main/download-prefs');

// A representative IA "texts" item file list. Real scanned items expose TWO
// PDFs: the image-only scan (no text layer) as "<id>.pdf" / Image Container PDF,
// and the searchable OCR'd version as "<id>_text.pdf" / Additional Text PDF.
const FILES = [
  { name: 'book.pdf', format: 'Image Container PDF', size: 100 },
  { name: 'book_text.pdf', format: 'Additional Text PDF', size: 160 },
  { name: 'book_djvu.txt', format: 'DjVuTXT', size: 10 },
  { name: 'book.epub', format: 'EPUB', size: 20 },
  { name: 'book_jp2.zip', format: 'Single Page Processed JP2 ZIP', size: 500 },
  { name: 'book_meta.xml', format: 'Metadata', size: 1, source: 'metadata' },
  { name: '__ia_thumb.jpg', format: 'Thumbnail', size: 5 },
];

/* ----------------------------- format filter ------------------------------ */

test('preset "all" keeps every real (non-metadata) file', () => {
  const out = filterFilesByFormat(FILES, 'all');
  assert.ok(out.find((f) => f.name === 'book.pdf'));
  assert.ok(out.find((f) => f.name === 'book.epub'));
  // metadata/derivative noise excluded
  assert.ok(!out.find((f) => f.name === 'book_meta.xml'));
  assert.ok(!out.find((f) => f.name === '__ia_thumb.jpg'));
});

test('preset "pdf" keeps ONLY the image PDF (no text layer), not the _text.pdf', () => {
  // "PDF only" should give the plain scan without the OCR text layer — i.e. the
  // Image Container PDF, NOT the much larger "Additional Text PDF".
  const out = filterFilesByFormat(FILES, 'pdf').map((f) => f.name);
  assert.deepEqual(out, ['book.pdf']);
});

test('preset "pdf" also matches a bare "PDF" format (born-digital items)', () => {
  const born = [{ name: 'paper.pdf', format: 'PDF', size: 50 }];
  assert.deepEqual(filterFilesByFormat(born, 'pdf').map((f) => f.name), ['paper.pdf']);
});

test('preset "pdf" falls back to .pdf files when no PDF format is labelled', () => {
  // Some items have a .pdf with an empty/odd format string and no text variant.
  const odd = [{ name: 'scan.pdf', format: '', size: 50 }];
  assert.deepEqual(filterFilesByFormat(odd, 'pdf').map((f) => f.name), ['scan.pdf']);
});

test('preset "pdf" does NOT fall back and grab the _text.pdf via its extension', () => {
  // The bug: the .pdf extension fallback used to also pull in the text PDF.
  // When an image PDF is present, only it should be returned.
  const out = filterFilesByFormat(FILES, 'pdf').map((f) => f.name);
  assert.ok(!out.includes('book_text.pdf'), 'the searchable _text.pdf must be excluded by "PDF only"');
});

test('preset "text_pdf" keeps only the searchable text PDF', () => {
  const out = filterFilesByFormat(FILES, 'text_pdf').map((f) => f.name);
  // "Text PDF" / "Additional Text PDF" formats only — here the _text.pdf.
  assert.deepEqual(out, ['book_text.pdf']);
});

test('preset "epub" keeps only epub', () => {
  assert.deepEqual(
    filterFilesByFormat(FILES, 'epub').map((f) => f.name),
    ['book.epub']
  );
});

test('unknown preset falls back to all real files', () => {
  const out = filterFilesByFormat(FILES, 'nonsense');
  assert.ok(out.length >= 4);
  assert.ok(!out.find((f) => f.name === 'book_meta.xml'));
});

test('FORMAT_PRESETS includes the important text presets', () => {
  const keys = FORMAT_PRESETS.map((p) => p.key);
  for (const k of ['all', 'pdf', 'text_pdf', 'epub', 'text']) assert.ok(keys.includes(k), `missing ${k}`);
});

/* --------------------------- filename sanitize ---------------------------- */

test('sanitizeFilename strips characters illegal on Windows/macOS', () => {
  assert.equal(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j'), 'a_b_c_d_e_f_g_h_i_j');
});

test('sanitizeFilename collapses whitespace and trims dots/spaces', () => {
  assert.equal(sanitizeFilename('  My   Title .  '), 'My Title');
});

test('sanitizeFilename truncates very long names but keeps the extension', () => {
  const long = 'x'.repeat(300) + '.pdf';
  const out = sanitizeFilename(long);
  assert.ok(out.length <= 200);
  assert.ok(out.endsWith('.pdf'));
});

/* --------------------------- title -> filename ---------------------------- */

test('applyTitleToFilename in "replace" mode uses the title + original extension', () => {
  const out = applyTitleToFilename('book_text.pdf', 'Kokoro: 心', 'replace');
  assert.equal(out, 'Kokoro_ 心.pdf');
});

test('applyTitleToFilename in "append" mode appends title before the extension', () => {
  const out = applyTitleToFilename('book.pdf', 'Kokoro', 'append');
  assert.equal(out, 'book - Kokoro.pdf');
});

test('applyTitleToFilename in "off" mode returns the original name', () => {
  assert.equal(applyTitleToFilename('book.pdf', 'Kokoro', 'off'), 'book.pdf');
});

test('applyTitleToFilename sanitizes illegal chars from the title', () => {
  const out = applyTitleToFilename('x.pdf', 'a/b:c', 'replace');
  assert.equal(out, 'a_b_c.pdf');
});

/* ------------------------------ planDownload ------------------------------ */

test('planDownload filters then maps to {name (remote), saveAs (local)}', () => {
  const plan = planDownload(FILES, { format: 'text_pdf', rename: 'replace', title: 'My Book' });
  assert.equal(plan.length, 1); // only the searchable text PDF
  for (const p of plan) {
    assert.ok(p.name.endsWith('.pdf')); // remote source name
    assert.ok(p.saveAs.startsWith('My Book')); // renamed local name
    assert.ok(p.saveAs.endsWith('.pdf'));
  }
});

test('planDownload "pdf" keeps only the no-text image PDF', () => {
  const plan = planDownload(FILES, { format: 'pdf', rename: 'off' });
  assert.deepEqual(plan.map((p) => p.saveAs), ['book.pdf']);
});

test('planDownload disambiguates colliding saveAs names (no overwrite)', () => {
  // Two PDFs renamed to the same title would collide; names must be unique.
  const twoPdfs = [
    { name: 'a.pdf', format: 'Image Container PDF', size: 1 },
    { name: 'b.pdf', format: 'PDF', size: 2 },
  ];
  const plan = planDownload(twoPdfs, { format: 'pdf', rename: 'replace', title: 'Same Title' });
  const names = plan.map((p) => p.saveAs);
  assert.equal(names.length, 2);
  assert.equal(new Set(names).size, names.length, 'saveAs names must be unique');
  // All still end with .pdf and start with the title.
  for (const n of names) {
    assert.ok(n.endsWith('.pdf'));
    assert.ok(n.startsWith('Same Title'));
  }
});

/* ------------------------- resolveDownloadPlan (fallback) ----------------- */
// When the chosen format matches nothing, fall back to the next-best readable
// file so SOMETHING downloads, and report which format was actually used.

// A scanned item that has ONLY a text PDF + DjVu (no image-only PDF) — the case
// from the bug report: "PDF only" matches nothing.
const TEXT_ONLY = [
  { name: 'book_text.pdf', format: 'Additional Text PDF', size: 200 },
  { name: 'book_djvu.txt', format: 'DjVuTXT', size: 30 },
  { name: 'book_meta.xml', format: 'Metadata', source: 'metadata' },
];

test('resolveDownloadPlan uses the requested format when it matches', () => {
  const files = [{ name: 'scan.pdf', format: 'Image Container PDF', size: 1 }];
  const r = resolveDownloadPlan(files, { format: 'pdf' });
  assert.equal(r.usedFormat, 'pdf');
  assert.equal(r.fellBack, false);
  assert.deepEqual(r.plan.map((p) => p.name), ['scan.pdf']);
});

test('resolveDownloadPlan falls back to the text PDF when "PDF only" matches nothing', () => {
  const r = resolveDownloadPlan(TEXT_ONLY, { format: 'pdf' });
  assert.equal(r.fellBack, true);
  assert.equal(r.usedFormat, 'text_pdf', 'should prefer the text PDF as the next-best PDF');
  assert.deepEqual(r.plan.map((p) => p.name), ['book_text.pdf']);
});

test('resolveDownloadPlan falls back to DjVu/plain text when no PDF exists at all', () => {
  const noPdf = [
    { name: 'book_djvu.txt', format: 'DjVuTXT', size: 30 },
    { name: 'book_meta.xml', format: 'Metadata', source: 'metadata' },
  ];
  const r = resolveDownloadPlan(noPdf, { format: 'pdf' });
  assert.equal(r.fellBack, true);
  assert.equal(r.usedFormat, 'text');
  assert.deepEqual(r.plan.map((p) => p.name), ['book_djvu.txt']);
});

test('resolveDownloadPlan ultimately falls back to ALL real files', () => {
  const weird = [
    { name: 'thing.bin', format: 'Some Binary', size: 5 },
    { name: 'x_meta.xml', format: 'Metadata', source: 'metadata' }, // excluded as noise
  ];
  const r = resolveDownloadPlan(weird, { format: 'pdf' });
  assert.equal(r.fellBack, true);
  assert.equal(r.usedFormat, 'all');
  assert.deepEqual(r.plan.map((p) => p.name), ['thing.bin']);
});

test('resolveDownloadPlan returns an empty plan only when there are NO real files', () => {
  const onlyNoise = [{ name: 'x_meta.xml', format: 'Metadata', source: 'metadata' }];
  const r = resolveDownloadPlan(onlyNoise, { format: 'pdf' });
  assert.equal(r.plan.length, 0);
});

test('resolveDownloadPlan respects rename + glob filters on the fallback set', () => {
  const r = resolveDownloadPlan(TEXT_ONLY, { format: 'pdf', rename: 'replace', title: 'My Book' });
  assert.equal(r.usedFormat, 'text_pdf');
  assert.ok(r.plan[0].saveAs.startsWith('My Book'));
});

test('resolveDownloadPlan does not fall back when the requested format DID match', () => {
  // text_pdf matches the text PDF directly — no fallback needed.
  const r = resolveDownloadPlan(TEXT_ONLY, { format: 'text_pdf' });
  assert.equal(r.fellBack, false);
  assert.equal(r.usedFormat, 'text_pdf');
});

test('resolveDownloadPlan with "all" never reports a fallback', () => {
  const r = resolveDownloadPlan(TEXT_ONLY, { format: 'all' });
  assert.equal(r.fellBack, false);
  assert.equal(r.usedFormat, 'all');
  assert.equal(r.plan.length, 2); // both real files
});
