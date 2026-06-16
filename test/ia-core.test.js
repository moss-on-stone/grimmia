'use strict';

/**
 * Red/green TDD tests for the pure IA logic (no network, no Electron).
 * These define the contract BEFORE the implementation exists.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const core = require('../src/main/ia-core');

/* -------------------------- metadata value encoding ----------------------- */

test('encodeMetaValue leaves plain ASCII untouched', () => {
  assert.equal(core.encodeMetaValue('Hello World'), 'Hello World');
});

test('encodeMetaValue URI-wraps non-ASCII (UTF-8)', () => {
  // ☃ snowman must be uri()-wrapped and percent-encoded.
  assert.equal(core.encodeMetaValue('snowman ☃'), 'uri(snowman%20%E2%98%83)');
});

test('encodeMetaValue coerces numbers to strings', () => {
  assert.equal(core.encodeMetaValue(2024), '2024');
});

/* ----------------------------- meta headers ------------------------------- */

test('buildMetaHeaders emits x-archive-meta-<name> for scalars', () => {
  const h = core.buildMetaHeaders({ title: 'My Item' });
  assert.equal(h['x-archive-meta-title'], 'My Item');
});

test('buildMetaHeaders converts underscores in names to double hyphens', () => {
  const h = core.buildMetaHeaders({ external_identifier: 'urn:foo' });
  assert.equal(h['x-archive-meta-external--identifier'], 'urn:foo');
});

test('buildMetaHeaders numbers array values (meta01, meta02)', () => {
  const h = core.buildMetaHeaders({ subject: ['cats', 'dogs'] });
  assert.equal(h['x-archive-meta01-subject'], 'cats');
  assert.equal(h['x-archive-meta02-subject'], 'dogs');
});

test('buildMetaHeaders skips null and empty values', () => {
  const h = core.buildMetaHeaders({ title: 'Keep', note: '', other: null });
  assert.equal(h['x-archive-meta-title'], 'Keep');
  assert.ok(!('x-archive-meta-note' in h));
  assert.ok(!('x-archive-meta-other' in h));
});

/* --------------------------- search URL builder --------------------------- */

test('buildSearchUrl sets query, json output and paging', () => {
  const url = new URL(core.buildSearchUrl('cats', { page: 2, rows: 25 }));
  assert.equal(url.pathname, '/advancedsearch.php');
  assert.equal(url.searchParams.get('q'), 'cats');
  assert.equal(url.searchParams.get('output'), 'json');
  assert.equal(url.searchParams.get('rows'), '25');
  assert.equal(url.searchParams.get('page'), '2');
});

test('buildSearchUrl requests default fields including identifier and title', () => {
  const url = new URL(core.buildSearchUrl('cats'));
  const fields = url.searchParams.getAll('fl[]');
  assert.ok(fields.includes('identifier'));
  assert.ok(fields.includes('title'));
});

test('buildSearchUrl adds sort when provided', () => {
  const url = new URL(core.buildSearchUrl('cats', { sort: 'downloads desc' }));
  assert.equal(url.searchParams.get('sort[]'), 'downloads desc');
});

test('buildSearchUrl encodes CJK queries as UTF-8 and round-trips', () => {
  const q = '夏目漱石 こころ 한국 老舍';
  const url = new URL(core.buildSearchUrl(q));
  // Stored encoded (percent-encoded UTF-8), decoded back to the original.
  assert.equal(url.searchParams.get('q'), q);
  assert.ok(url.href.includes('%E5%A4%8F'), 'expected percent-encoded UTF-8 in the URL');
});

/* --------------------------- login response parse ------------------------- */

test('parseLoginResponse extracts s3 keys, cookies and screenname', () => {
  const r = core.parseLoginResponse({
    success: true,
    values: {
      s3: { access: 'AKEY', secret: 'SKEY' },
      cookies: { 'logged-in-user': 'u@example.com', 'logged-in-sig': 'sig123' },
      screenname: 'Archivist',
    },
  });
  assert.equal(r.access, 'AKEY');
  assert.equal(r.secret, 'SKEY');
  assert.equal(r.cookies['logged-in-user'], 'u@example.com');
  assert.equal(r.screenname, 'Archivist');
});

test('parseLoginResponse throws a friendly error on failure', () => {
  assert.throws(
    () =>
      core.parseLoginResponse({
        success: false,
        values: { reason: 'Invalid password.' },
      }),
    /Invalid password\./
  );
});

test('parseLoginResponse throws when success but no s3 keys', () => {
  assert.throws(() => core.parseLoginResponse({ success: true, values: {} }), /S3 keys/);
});

/* ----------------------------- download paths ----------------------------- */

test('downloadUrl builds the canonical /download path', () => {
  assert.equal(
    core.downloadUrl('my-item', 'file name.pdf'),
    'https://archive.org/download/my-item/file%20name.pdf'
  );
});

test('safeLocalName strips path separators to prevent traversal', () => {
  assert.equal(core.safeLocalName('../../etc/passwd'), 'passwd');
  assert.equal(core.safeLocalName('sub/dir/file.txt'), 'file.txt');
});
