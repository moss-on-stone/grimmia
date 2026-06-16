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
