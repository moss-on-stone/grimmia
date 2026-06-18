'use strict';

/**
 * Red/green TDD tests for pure renderer helpers (no DOM, no Electron).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const u = require('../src/renderer/ui-util');

/* ------------------------------ formatBytes ------------------------------- */

test('formatBytes handles zero and small values', () => {
  assert.equal(u.formatBytes(0), '0 B');
  assert.equal(u.formatBytes(512), '512 B');
});

test('formatBytes scales to KB/MB/GB', () => {
  assert.equal(u.formatBytes(1024), '1.0 KB');
  assert.equal(u.formatBytes(1024 * 1024), '1.0 MB');
  assert.equal(u.formatBytes(1536 * 1024 * 1024), '1.5 GB');
});

test('formatBytes is tolerant of bad input', () => {
  assert.equal(u.formatBytes(null), '0 B');
  assert.equal(u.formatBytes('not a number'), '0 B');
});

/* ----------------------------- percent helper ----------------------------- */

test('percent clamps to 0..100 and rounds', () => {
  assert.equal(u.percent(0, 0), 0);
  assert.equal(u.percent(50, 200), 25);
  assert.equal(u.percent(300, 200), 100);
});

/* -------------------------- parseSubjects --------------------------------- */

test('parseSubjects splits, trims and drops empties', () => {
  assert.deepEqual(u.parseSubjects(' history , music ,, 1977 '), ['history', 'music', '1977']);
});

test('parseSubjects returns empty array for blank input', () => {
  assert.deepEqual(u.parseSubjects(''), []);
  assert.deepEqual(u.parseSubjects('   '), []);
});

/* ------------------------- buildUploadMetadata ---------------------------- */

test('buildUploadMetadata assembles a clean metadata object', () => {
  const md = u.buildUploadMetadata({
    title: 'My Title',
    creator: 'Me',
    date: '2024-01-01',
    mediatype: 'texts',
    description: 'Hello',
    subjects: 'a, b',
  });
  assert.equal(md.title, 'My Title');
  assert.equal(md.creator, 'Me');
  assert.equal(md.mediatype, 'texts');
  assert.deepEqual(md.subject, ['a', 'b']);
});

test('buildUploadMetadata omits empty optional fields', () => {
  const md = u.buildUploadMetadata({ title: 'T', mediatype: 'texts', subjects: '' });
  assert.equal(md.title, 'T');
  assert.ok(!('creator' in md));
  assert.ok(!('subject' in md));
  assert.ok(!('description' in md));
  // No language / bookreader fields unless explicitly provided.
  assert.ok(!('language' in md));
  assert.ok(!('page-progression' in md));
  assert.ok(!('bookreader-defaults' in md));
});

test('buildUploadMetadata includes the language code when set', () => {
  const md = u.buildUploadMetadata({ title: 'T', language: 'jpn' });
  assert.equal(md.language, 'jpn');
});

test('buildUploadMetadata omits a blank language', () => {
  const md = u.buildUploadMetadata({ title: 'T', language: '' });
  assert.ok(!('language' in md));
});

test('buildUploadMetadata emits page-progression=rl only when the flag is on', () => {
  assert.equal(u.buildUploadMetadata({ title: 'T', pageProgressionRl: true })['page-progression'], 'rl');
  assert.ok(!('page-progression' in u.buildUploadMetadata({ title: 'T', pageProgressionRl: false })));
  assert.ok(!('page-progression' in u.buildUploadMetadata({ title: 'T' })));
});

test('buildUploadMetadata emits bookreader-defaults=mode/1up only when the flag is on', () => {
  assert.equal(u.buildUploadMetadata({ title: 'T', oneUp: true })['bookreader-defaults'], 'mode/1up');
  assert.ok(!('bookreader-defaults' in u.buildUploadMetadata({ title: 'T', oneUp: false })));
});

/* ----------------------------- UPLOAD_LANGUAGES --------------------------- */

test('UPLOAD_LANGUAGES lists 15 languages incl. Japanese/Chinese/Korean (IA MARC codes)', () => {
  assert.ok(Array.isArray(u.UPLOAD_LANGUAGES));
  assert.equal(u.UPLOAD_LANGUAGES.length, 15);
  const byCode = Object.fromEntries(u.UPLOAD_LANGUAGES.map((l) => [l.code, l.label]));
  // IA uses MARC/bibliographic codes (verified against live archive.org counts).
  assert.equal(byCode.jpn, 'Japanese');
  assert.equal(byCode.chi, 'Chinese'); // chi, NOT zho
  assert.equal(byCode.kor, 'Korean');
  assert.equal(byCode.eng, 'English');
  assert.equal(byCode.fre, 'French'); // fre, NOT fra
  assert.equal(byCode.ger, 'German'); // ger, NOT deu
  // Every entry has a non-empty code + label.
  for (const l of u.UPLOAD_LANGUAGES) {
    assert.ok(l.code && /^[a-z]{3}$/.test(l.code), `bad code: ${l.code}`);
    assert.ok(l.label && l.label.length > 0);
  }
});

/* ---------------------------- validIdentifier ----------------------------- */

test('validIdentifier accepts ids with hyphens/dots/underscores', () => {
  assert.equal(u.validIdentifier('my-item_01.v2'), true);
});

test('validIdentifier accepts real uppercase IA identifiers (NPTCM…)', () => {
  // archive.org identifiers contain uppercase — these are valid.
  assert.equal(u.validIdentifier('NPTCM19400622'), true);
  assert.equal(u.validIdentifier('GratefulDead-1977'), true);
});

test('validIdentifier rejects spaces and bad chars', () => {
  assert.equal(u.validIdentifier('Has Space'), false);
  assert.equal(u.validIdentifier('bad/slash'), false);
  assert.equal(u.validIdentifier(''), false);
});

/* ------------------------------ queueBadge -------------------------------- */

test('queueBadge hides when there are no active/queued downloads', () => {
  const b = u.queueBadge(0);
  assert.equal(b.visible, false);
  assert.equal(b.text, '');
});

test('queueBadge shows the count when downloads are active/queued', () => {
  assert.deepEqual(u.queueBadge(1), { visible: true, text: '1' });
  assert.deepEqual(u.queueBadge(3), { visible: true, text: '3' });
});

test('queueBadge caps the displayed number at 99+', () => {
  assert.deepEqual(u.queueBadge(150), { visible: true, text: '99+' });
});

test('queueBadge treats bad input as zero', () => {
  assert.equal(u.queueBadge(-2).visible, false);
  assert.equal(u.queueBadge(null).visible, false);
  assert.equal(u.queueBadge('x').visible, false);
});

/* ------------------------------ itemPageUrl ------------------------------- */

test('itemPageUrl builds the archive.org details URL', () => {
  assert.equal(u.itemPageUrl('NPTCM19400622'), 'https://archive.org/details/NPTCM19400622');
});

test('itemPageUrl encodes the identifier', () => {
  assert.equal(u.itemPageUrl('a b'), 'https://archive.org/details/a%20b');
});

test('itemPageUrl returns empty for a missing identifier', () => {
  assert.equal(u.itemPageUrl(''), '');
  assert.equal(u.itemPageUrl(null), '');
});

/* -------------------------- largeCollectionWarning ------------------------ */
// A confirm message shown before downloading a collection with more than the
// threshold (default 50) items; null when no confirm is needed.

test('largeCollectionWarning warns above the threshold with count + name', () => {
  const msg = u.largeCollectionWarning(359, 'north-china-daily-news');
  assert.match(msg, /359/);
  assert.match(msg, /north-china-daily-news/);
  assert.match(msg, /download all/i);
});

test('largeCollectionWarning returns null at or below the threshold (no confirm)', () => {
  assert.equal(u.largeCollectionWarning(50, 'x'), null);
  assert.equal(u.largeCollectionWarning(10, 'x'), null);
  assert.equal(u.largeCollectionWarning(51, 'x') === null, false, '51 needs a confirm');
});

test('largeCollectionWarning formats large counts with separators', () => {
  const msg = u.largeCollectionWarning(123456, 'big');
  assert.match(msg, /123,456/);
});

test('largeCollectionWarning honors a custom threshold', () => {
  assert.equal(u.largeCollectionWarning(5, 'x', 10), null);
  assert.ok(u.largeCollectionWarning(11, 'x', 10));
});

/* ----------------------------- userProfileUrl ----------------------------- */
// Clicking the logged-in username opens that account's archive.org profile,
// which lives at https://archive.org/details/@<screenname>.

test('userProfileUrl builds the @screenname profile URL', () => {
  assert.equal(u.userProfileUrl('konrad'), 'https://archive.org/details/@konrad');
});

test('userProfileUrl tolerates a leading @ and trims whitespace', () => {
  assert.equal(u.userProfileUrl('@konrad'), 'https://archive.org/details/@konrad');
  assert.equal(u.userProfileUrl('  konrad  '), 'https://archive.org/details/@konrad');
});

test('userProfileUrl encodes the screenname', () => {
  assert.equal(u.userProfileUrl('a b'), 'https://archive.org/details/@a%20b');
});

test('userProfileUrl returns empty for a missing screenname (e.g. only an email)', () => {
  assert.equal(u.userProfileUrl(''), '');
  assert.equal(u.userProfileUrl(null), '');
  assert.equal(u.userProfileUrl('@'), '');
});

/* ----------------------------- transferBadge ------------------------------ */

test('transferBadge hides when nothing is transferring', () => {
  const b = u.transferBadge(0, 0);
  assert.equal(b.visible, false);
  assert.equal(b.text, '');
});

test('transferBadge shows the combined total of downloads + uploads', () => {
  assert.equal(u.transferBadge(2, 1).text, '3');
  assert.equal(u.transferBadge(2, 1).visible, true);
});

test('transferBadge is colored "download" when only downloads are active', () => {
  assert.equal(u.transferBadge(2, 0).kind, 'download');
});

test('transferBadge is colored "upload" when any upload is active', () => {
  // Upload color takes priority so an ongoing upload is visible.
  assert.equal(u.transferBadge(0, 1).kind, 'upload');
  assert.equal(u.transferBadge(3, 1).kind, 'upload');
});

test('transferBadge caps the total at 99+', () => {
  assert.equal(u.transferBadge(80, 40).text, '99+');
});

test('transferBadge treats bad input as zero', () => {
  assert.equal(u.transferBadge(null, undefined).visible, false);
  assert.equal(u.transferBadge('x', 'y').visible, false);
});

/* ------------------------------- firstOf ---------------------------------- */

test('firstOf returns first element of array or the value itself', () => {
  assert.equal(u.firstOf(['a', 'b']), 'a');
  assert.equal(u.firstOf('solo'), 'solo');
  assert.equal(u.firstOf(undefined), '');
});

/* ---------------------------- facetScopeNote ------------------------------ */
// The facet counts are tallied client-side from only the docs loaded on the
// current page (lastDocs), NOT the full result set. So "1940 — 15" means "15
// of the loaded items", while clicking it re-queries archive.org and can show
// 452. facetScopeNote() produces the disclosure caption + tooltip that makes
// this scope explicit, given (loaded count, true total numFound).

test('facetScopeNote discloses the loaded subset when total exceeds loaded', () => {
  const note = u.facetScopeNote(200, 16359);
  assert.ok(note, 'a note should be returned when the loaded subset is partial');
  assert.equal(note.caption, 'from the 200 items shown');
  // The tooltip must mention BOTH the loaded count and the full total, and that
  // clicking searches the whole set — so the count change on click isn't a shock.
  assert.match(note.tooltip, /200/);
  assert.match(note.tooltip, /16,359/); // full total, thousands-separated
  assert.match(note.tooltip, /clic/i); // explains that clicking re-queries
});

test('facetScopeNote returns null when the whole result set is loaded', () => {
  // Counts ARE the totals here, so no disclosure is needed.
  assert.equal(u.facetScopeNote(40, 40), null);
  assert.equal(u.facetScopeNote(200, 120), null); // loaded >= total (e.g. last page)
});

test('facetScopeNote is tolerant of bad/zero input', () => {
  assert.equal(u.facetScopeNote(0, 0), null);
  assert.equal(u.facetScopeNote(null, null), null);
  assert.equal(u.facetScopeNote('x', 'y'), null);
});

/* ---------------------------- scopeFromInput ------------------------------ */
// The search-box scope dropdown auto-blanks when the user types a recognized
// `field:` token (the inline filter now governs), and reverts to 'Everything'
// when no such token is present. scopeFromInput decides which it should show,
// given the current text and the list of recognized field names.

const FIELDS = ['title', 'subject', 'creator', 'description', 'language', 'mediatype', 'date', 'collection', 'identifier'];

test('scopeFromInput returns Everything for plain text (no field token)', () => {
  assert.equal(u.scopeFromInput('black cats', FIELDS), 'Everything');
  assert.equal(u.scopeFromInput('', FIELDS), 'Everything');
  assert.equal(u.scopeFromInput('   ', FIELDS), 'Everything');
});

test('scopeFromInput blanks when a recognized field token is present', () => {
  assert.equal(u.scopeFromInput('title:kokoro', FIELDS), '');
  assert.equal(u.scopeFromInput('soseki creator:twain', FIELDS), '');
  // mid-typing: as soon as "subject:" appears, blank it.
  assert.equal(u.scopeFromInput('subject:', FIELDS), '');
});

test('scopeFromInput is case-insensitive on the field name', () => {
  assert.equal(u.scopeFromInput('Title:Kokoro', FIELDS), '');
});

test('scopeFromInput ignores unknown field-like tokens', () => {
  // foo: is not a recognized field, so the dropdown stays on Everything.
  assert.equal(u.scopeFromInput('foo:bar baz', FIELDS), 'Everything');
  assert.equal(u.scopeFromInput('http://example.com', FIELDS), 'Everything');
});
