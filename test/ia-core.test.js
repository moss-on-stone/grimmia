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

/* --------------------------------- IAError -------------------------------- */
// IAError carries the HTTP status and (for 429/503 throttling) the server's
// Retry-After so the retry layer can honor it. Older callers pass only message.

test('IAError carries status, body, and Retry-After when given', () => {
  const e = new core.IAError('Slow down', { status: 429, body: 'x', retryAfter: '30' });
  assert.equal(e.name, 'IAError');
  assert.equal(e.message, 'Slow down');
  assert.equal(e.status, 429);
  assert.equal(e.body, 'x');
  assert.equal(e.retryAfter, '30');
});

test('IAError is fine with no options (retryAfter undefined)', () => {
  const e = new core.IAError('boom');
  assert.equal(e.status, undefined);
  assert.equal(e.retryAfter, undefined);
});

/* --------------------------- uploadError (parity) ------------------------- */
// uploadFile must build its non-2xx error like the download path: carrying the
// status AND the server's Retry-After header, so a 503/429 during a big upload is
// retried and honors archive.org's throttling instead of aborting the batch.

test('uploadError captures status and Retry-After from the response headers', () => {
  const e = core.uploadError(503, { 'retry-after': '45' }, 'cover.jpg', 'SlowDown');
  assert.equal(e.name, 'IAError');
  assert.equal(e.status, 503);
  assert.equal(e.retryAfter, '45');
  assert.equal(e.body, 'SlowDown');
  assert.match(e.message, /cover\.jpg/);
  assert.match(e.message, /503/);
});

test('uploadError tolerates missing headers / Retry-After', () => {
  const e = core.uploadError(400, undefined, 'f.txt');
  assert.equal(e.status, 400);
  assert.equal(e.retryAfter, undefined);
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

test('parseLoginResponse extracts s3 keys, cookies, screenname and the login email', () => {
  const r = core.parseLoginResponse(
    {
      success: true,
      values: {
        s3: { access: 'AKEY', secret: 'SKEY' },
        cookies: { 'logged-in-user': 'archivist', 'logged-in-sig': 'sig123' },
        screenname: 'Archivist',
      },
    },
    'me@example.com'
  );
  assert.equal(r.access, 'AKEY');
  assert.equal(r.secret, 'SKEY');
  assert.equal(r.cookies['logged-in-user'], 'archivist');
  assert.equal(r.screenname, 'Archivist');
  assert.equal(r.email, 'me@example.com', 'email is the login email, not the cookie');
});

test('parseLoginResponse derives the profile slug (itemname) from the logged-in-user cookie', () => {
  // xauthn has no dedicated slug field; the display screenname can be CJK and is
  // NOT the slug. The logged-in-user cookie carries the slug-form id (g_y_library).
  const r = core.parseLoginResponse(
    {
      success: true,
      values: {
        s3: { access: 'AKEY', secret: 'SKEY' },
        cookies: { 'logged-in-user': 'g_y_library', 'logged-in-sig': 'sig' },
        screenname: '石上苔', // display name (CJK) — would 400 as a profile URL
      },
    },
    'kl@example.com'
  );
  assert.equal(r.screenname, '石上苔');
  assert.equal(r.itemname, 'g_y_library', 'slug comes from the logged-in-user cookie');
});

test('parseLoginResponse prefers an explicit itemname field if one is ever present', () => {
  const r = core.parseLoginResponse({
    success: true,
    values: {
      s3: { access: 'A', secret: 'S' },
      cookies: { 'logged-in-user': 'cookie_slug' },
      screenname: 'X',
      itemname: 'explicit_slug',
    },
  });
  assert.equal(r.itemname, 'explicit_slug');
});

test('parseLoginResponse leaves itemname empty when there is no cookie or itemname', () => {
  const r = core.parseLoginResponse({
    success: true,
    values: { s3: { access: 'A', secret: 'S' }, cookies: {}, screenname: 'X' },
  });
  assert.equal(r.itemname, '');
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
