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
  formatForItem,
  sanitizeFilename,
  sanitizeSegment,
  applyTitleToFilename,
  planDownload,
  resolveDownloadPlan,
  decideExisting,
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

/* ------------------------- preset "largest" ------------------------------- */
// "Largest file format": group real files by their `format`, sum bytes per
// format, and keep ALL files of the format with the greatest total size. Meant
// for non-text items (audio/video/images/etc.) where you want the best-quality
// derivative without naming the format.

test('preset "largest" keeps every file of the biggest-by-total-bytes format', () => {
  // In FILES the JP2 ZIP format totals 500 bytes — the largest — so only it.
  const out = filterFilesByFormat(FILES, 'largest').map((f) => f.name);
  assert.deepEqual(out, ['book_jp2.zip']);
});

test('preset "largest" sums bytes ACROSS files of the same format, not per-file', () => {
  // Two MP3s (200+200=400) beat one FLAC (350), so the format MP3 wins.
  const audio = [
    { name: 'a.flac', format: 'FLAC', size: 350 },
    { name: 't1.mp3', format: 'VBR MP3', size: 200 },
    { name: 't2.mp3', format: 'VBR MP3', size: 200 },
  ];
  assert.deepEqual(
    filterFilesByFormat(audio, 'largest').map((f) => f.name),
    ['t1.mp3', 't2.mp3']
  );
});

test('preset "largest" ignores metadata/derivative noise', () => {
  const out = filterFilesByFormat(FILES, 'largest');
  assert.ok(!out.find((f) => f.name === 'book_meta.xml'));
  assert.ok(!out.find((f) => f.name === '__ia_thumb.jpg'));
});

test('preset "largest" returns [] when there are no real files', () => {
  assert.deepEqual(filterFilesByFormat([{ name: 'x_meta.xml', format: 'Metadata', source: 'metadata' }], 'largest'), []);
});

test('FORMAT_PRESETS includes a "largest" preset with a friendly label', () => {
  const p = FORMAT_PRESETS.find((x) => x.key === 'largest');
  assert.ok(p, 'a largest preset should exist');
  assert.match(p.label, /largest/i);
});

/* --------- decideExisting: skip vs resume vs re-download ------------------ */
// Decides what to do when a file with the same name may already exist on disk.
// Pure (filesystem-agnostic): the caller passes whether it exists + its size.
// The filesystem's own case-insensitivity (Windows/macOS) is handled by the
// existsSync the caller does — this just decides the action.

test('decideExisting: re-download preference always overwrites (fresh)', () => {
  assert.equal(decideExisting({ exists: true, existingSize: 100, knownSize: 100, reDownload: true }).action, 'fresh');
  assert.equal(decideExisting({ exists: true, existingSize: 50, knownSize: 100, reDownload: true }).action, 'fresh');
  assert.equal(decideExisting({ exists: false, reDownload: true }).action, 'fresh');
});

test('decideExisting: a non-existent file is always downloaded fresh', () => {
  assert.equal(decideExisting({ exists: false, knownSize: 100, reDownload: false }).action, 'fresh');
});

test('decideExisting: an existing same-name file is SKIPPED by default (the feature)', () => {
  // Same filename present → assume already downloaded, regardless of size match.
  assert.equal(decideExisting({ exists: true, existingSize: 100, knownSize: 100, reDownload: false }).action, 'skip');
  // Even with NO known size, an existing same-name file is treated as done.
  assert.equal(decideExisting({ exists: true, existingSize: 999, knownSize: null, reDownload: false }).action, 'skip');
  // A larger-than-expected existing file is still a same-name file → skip.
  assert.equal(decideExisting({ exists: true, existingSize: 500, knownSize: 100, reDownload: false }).action, 'skip');
});

test('decideExisting: a KNOWN-partial file resumes rather than skipping (strictly better)', () => {
  // size known and the existing file is shorter → resume from its end byte.
  const d = decideExisting({ exists: true, existingSize: 40, knownSize: 100, reDownload: false });
  assert.equal(d.action, 'resume');
  assert.equal(d.startByte, 40);
});

test('decideExisting: a known-partial file is re-downloaded fresh when reDownload is on', () => {
  assert.equal(decideExisting({ exists: true, existingSize: 40, knownSize: 100, reDownload: true }).action, 'fresh');
});

/* ----------------- mediatype-driven format choice ------------------------- */
// A "texts" item follows the Text dropdown (pdf/text_pdf/epub/text); any other
// mediatype follows the Other dropdown (largest/all).

test('formatForItem: a texts item uses the Text dropdown choice', () => {
  assert.equal(formatForItem('texts', 'pdf', 'largest').format, 'pdf');
  assert.equal(formatForItem('texts', 'epub', 'all').format, 'epub');
});

test('formatForItem: a non-texts item uses the Other dropdown choice', () => {
  assert.equal(formatForItem('audio', 'pdf', 'largest').format, 'largest');
  assert.equal(formatForItem('movies', 'pdf', 'all').format, 'all');
  assert.equal(formatForItem('image', 'text_pdf', 'largest').format, 'largest');
});

test('formatForItem: an array/odd mediatype is read as its first value; missing → treated as non-texts', () => {
  assert.equal(formatForItem(['texts'], 'pdf', 'largest').format, 'pdf');
  assert.equal(formatForItem(undefined, 'pdf', 'all').format, 'all', 'no mediatype → Other');
  assert.equal(formatForItem('TEXTS', 'pdf', 'largest').format, 'pdf', 'case-insensitive');
});

test('formatForItem: texts fallback tail follows the Other dropdown (largest vs all)', () => {
  // The texts-item fallback when NO text format exists is governed by Other.
  assert.equal(formatForItem('texts', 'pdf', 'largest').fallbackTail, 'largest');
  assert.equal(formatForItem('texts', 'pdf', 'all').fallbackTail, 'all');
});

/* ------- resolveDownloadPlan: texts item with no PDF falls back ----------- */

test('resolveDownloadPlan for a texts item: no PDF → tries other text formats first', () => {
  // No PDF, but an EPUB exists → text-first fallback picks the EPUB, not JP2.
  const noPdf = [
    { name: 'b.epub', format: 'EPUB', size: 20 },
    { name: 'b_jp2.zip', format: 'Single Page Processed JP2 ZIP', size: 500 },
  ];
  const { plan, usedFormat } = resolveDownloadPlan(noPdf, { format: 'pdf', fallbackTail: 'largest', rename: 'off' });
  assert.equal(usedFormat, 'epub');
  assert.deepEqual(plan.map((f) => f.name), ['b.epub']);
});

test('resolveDownloadPlan for a texts item: NO text format at all → falls back to largest', () => {
  // Item has only image derivatives (no pdf/epub/text) → largest format wins.
  const noText = [
    { name: 'b_jp2.zip', format: 'Single Page Processed JP2 ZIP', size: 500 },
    { name: 'b.jpg', format: 'JPEG', size: 30 },
  ];
  const { plan, usedFormat } = resolveDownloadPlan(noText, { format: 'pdf', fallbackTail: 'largest', rename: 'off' });
  assert.equal(usedFormat, 'largest');
  assert.deepEqual(plan.map((f) => f.name), ['b_jp2.zip']);
});

test('resolveDownloadPlan for a texts item: no text + Other="all" → falls back to all', () => {
  const noText = [
    { name: 'b_jp2.zip', format: 'Single Page Processed JP2 ZIP', size: 500 },
    { name: 'b.jpg', format: 'JPEG', size: 30 },
  ];
  const { plan, usedFormat } = resolveDownloadPlan(noText, { format: 'pdf', fallbackTail: 'all', rename: 'off' });
  assert.equal(usedFormat, 'all');
  assert.deepEqual(plan.map((f) => f.name).sort(), ['b.jpg', 'b_jp2.zip']);
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

/* ----------- Windows-safety: reserved names + trailing dot/space ---------- */
// Windows forbids reserved DEVICE basenames (CON, PRN, AUX, NUL, COM1-9,
// LPT1-9), even with an extension, and silently strips trailing dots/spaces
// from path components. macOS allows all of these, so this only bites Windows.

test('sanitizeSegment leaves an ordinary segment unchanged', () => {
  assert.equal(sanitizeSegment('book_text'), 'book_text');
  assert.equal(sanitizeSegment('My Item 2024'), 'My Item 2024');
});

test('sanitizeSegment strips illegal chars and control chars', () => {
  assert.equal(sanitizeSegment('a/b\\c:d*e?f"g<h>i|j'), 'a_b_c_d_e_f_g_h_i_j');
});

test('sanitizeSegment trims trailing dots and spaces (Windows strips them silently)', () => {
  assert.equal(sanitizeSegment('folder. '), 'folder');
  assert.equal(sanitizeSegment('name...'), 'name');
  assert.equal(sanitizeSegment('  spaced  '), 'spaced');
});

test('sanitizeSegment escapes Windows reserved device names (with or without extension)', () => {
  for (const n of ['CON', 'con', 'PRN', 'AUX', 'NUL', 'COM1', 'COM9', 'LPT1', 'LPT9']) {
    const out = sanitizeSegment(n);
    assert.notEqual(out.toLowerCase(), n.toLowerCase(), `${n} must be escaped`);
  }
  // Reserved + extension is also reserved on Windows.
  assert.doesNotMatch(sanitizeSegment('CON.pdf').toLowerCase(), /^con\.pdf$/);
  assert.doesNotMatch(sanitizeSegment('nul.txt').toLowerCase(), /^nul\.txt$/);
});

test('sanitizeSegment does NOT escape names that merely START with a reserved word', () => {
  assert.equal(sanitizeSegment('console'), 'console');
  assert.equal(sanitizeSegment('CONTENT'), 'CONTENT');
  assert.equal(sanitizeSegment('com10'), 'com10'); // only COM1-9 are reserved
  assert.equal(sanitizeSegment('lpt0'), 'lpt0');
});

test('sanitizeSegment never returns an empty string', () => {
  assert.ok(sanitizeSegment('') .length > 0);
  assert.ok(sanitizeSegment('...').length > 0);
  assert.ok(sanitizeSegment('/\\:').length > 0);
});

test('sanitizeFilename escapes a reserved device basename but keeps the extension', () => {
  const out = sanitizeFilename('CON.pdf');
  assert.match(out, /\.pdf$/);
  assert.doesNotMatch(out.toLowerCase(), /^con\.pdf$/, 'CON.pdf is reserved on Windows');
});

test('sanitizeFilename escapes a bare reserved name with no extension', () => {
  assert.notEqual(sanitizeFilename('NUL').toUpperCase(), 'NUL');
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
