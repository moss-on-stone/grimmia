'use strict';

/**
 * Red/green TDD for T1: the JSON network ops of ia-client (login, search,
 * getMetadata, modifyMetadata) — success AND error/parse branches — driven by a
 * fake fetch. No archive.org traffic.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const ia = require('../src/main/ia-client');
const { installFakeFetch } = require('./helpers/fake-fetch');

/* --------------------------------- login ---------------------------------- */

test('login parses S3 keys from a successful xauthn response', async () => {
  const f = installFakeFetch([
    {
      method: 'POST',
      url: '/services/xauthn/',
      response: {
        json: {
          success: true,
          values: {
            s3: { access: 'ACCESS', secret: 'SECRET' },
            screenname: 'Tester',
            cookies: { 'logged-in-user': 'tester@example.com', 'logged-in-sig': 'sig' },
          },
        },
      },
    },
  ]);
  try {
    const creds = await ia.login('tester@example.com', 'pw');
    assert.equal(creds.access, 'ACCESS');
    assert.equal(creds.secret, 'SECRET');
    assert.equal(creds.screenname, 'Tester');
  } finally {
    f.restore();
  }
});

test('login throws a friendly error when archive.org reports failure', async () => {
  const f = installFakeFetch([
    {
      method: 'POST',
      url: '/services/xauthn/',
      response: { json: { success: false, values: { reason: 'Bad password.' } } },
    },
  ]);
  try {
    await assert.rejects(ia.login('a@b.c', 'wrong'), /Bad password/);
  } finally {
    f.restore();
  }
});

test('login throws when the response is not JSON', async () => {
  const f = installFakeFetch([
    { method: 'POST', url: '/services/xauthn/', response: { text: '<html>maintenance</html>' } },
  ]);
  try {
    await assert.rejects(ia.login('a@b.c', 'pw'), /Unexpected response/);
  } finally {
    f.restore();
  }
});

/* --------------------------------- search --------------------------------- */

test('search returns numFound/start/docs from a good response', async () => {
  const f = installFakeFetch([
    {
      method: 'GET',
      url: '/advancedsearch.php',
      response: { json: { response: { numFound: 2, start: 0, docs: [{ identifier: 'a' }, { identifier: 'b' }] } } },
    },
  ]);
  try {
    const res = await ia.search('grateful dead', { rows: 48, page: 1 });
    assert.equal(res.numFound, 2);
    assert.equal(res.docs.length, 2);
    assert.equal(res.docs[0].identifier, 'a');
  } finally {
    f.restore();
  }
});

test('search throws when the response has no `response` envelope', async () => {
  const f = installFakeFetch([
    // No json.error here, so it falls back to the generic message.
    { method: 'GET', url: '/advancedsearch.php', response: { json: { somethingElse: true } } },
  ]);
  try {
    await assert.rejects(ia.search('???'), /Search request failed/);
  } finally {
    f.restore();
  }
});

test('search throws on a non-2xx status', async () => {
  const f = installFakeFetch([
    { method: 'GET', url: '/advancedsearch.php', response: { status: 503, text: 'unavailable' } },
  ]);
  try {
    await assert.rejects(ia.search('x'), /Search/);
  } finally {
    f.restore();
  }
});

test('search surfaces the real json.error message when present (L6)', async () => {
  const f = installFakeFetch([
    {
      method: 'GET',
      url: '/advancedsearch.php',
      response: { status: 400, json: { error: 'Bad field: foo:(' } },
    },
  ]);
  try {
    await assert.rejects(ia.search('foo:('), /Bad field: foo/);
  } finally {
    f.restore();
  }
});

/* ------------------------------- getMetadata ------------------------------ */

test('getMetadata returns the parsed item JSON', async () => {
  const f = installFakeFetch([
    {
      method: 'GET',
      url: '/metadata/',
      response: { json: { metadata: { title: 'Kokoro' }, files: [{ name: 'k.pdf' }] } },
    },
  ]);
  try {
    const md = await ia.getMetadata('kokoro');
    assert.equal(md.metadata.title, 'Kokoro');
    assert.equal(md.files[0].name, 'k.pdf');
  } finally {
    f.restore();
  }
});

test('getMetadata throws "not found" when metadata and files are empty', async () => {
  const f = installFakeFetch([
    { method: 'GET', url: '/metadata/', response: { json: { metadata: null, files: [] } } },
  ]);
  try {
    await assert.rejects(ia.getMetadata('nope'), /not found/i);
  } finally {
    f.restore();
  }
});

test('getMetadata rejects an empty identifier without a network call', async () => {
  const f = installFakeFetch([]);
  try {
    await assert.rejects(ia.getMetadata(''), /No identifier/);
    assert.equal(f.calls.length, 0, 'must not hit the network for an empty id');
  } finally {
    f.restore();
  }
});

/* ----------------------------- modifyMetadata ----------------------------- */

const CREDS = { access: 'A', secret: 'S' };

test('modifyMetadata succeeds and returns the JSON result', async () => {
  const f = installFakeFetch([
    { method: 'POST', url: '/metadata/', response: { json: { success: true, task_id: 1 } } },
  ]);
  try {
    const r = await ia.modifyMetadata('item', [{ op: 'replace', path: '/title', value: 'X' }], CREDS);
    assert.equal(r.success, true);
  } finally {
    f.restore();
  }
});

test('modifyMetadata throws when archive.org reports success:false', async () => {
  const f = installFakeFetch([
    { method: 'POST', url: '/metadata/', response: { json: { success: false, error: 'no permission' } } },
  ]);
  try {
    await assert.rejects(
      ia.modifyMetadata('item', [{ op: 'replace', path: '/title', value: 'X' }], CREDS),
      /no permission/
    );
  } finally {
    f.restore();
  }
});

/* ----------------------------- scrape page (#2) --------------------------- */

test('scrapeCollectionPage returns items and the next cursor', async () => {
  const f = installFakeFetch([
    {
      method: 'GET',
      url: '/services/search/v1/scrape',
      response: { json: { items: [{ identifier: 'm1' }, { identifier: 'm2' }], cursor: 'NEXT' } },
    },
  ]);
  try {
    const page = await ia.scrapeCollectionPage('collection:x');
    assert.deepEqual(page.items.map((i) => i.identifier), ['m1', 'm2']);
    assert.equal(page.cursor, 'NEXT');
  } finally {
    f.restore();
  }
});

test('scrapeCollectionPage throws when the response lacks items', async () => {
  const f = installFakeFetch([
    { method: 'GET', url: '/services/search/v1/scrape', response: { status: 400, json: { error: 'bad' } } },
  ]);
  try {
    await assert.rejects(ia.scrapeCollectionPage('collection:x'), /collection/i);
  } finally {
    f.restore();
  }
});

test('modifyMetadata refuses without credentials and does not hit the network', async () => {
  const f = installFakeFetch([]);
  try {
    await assert.rejects(ia.modifyMetadata('item', [], null), /logged in/i);
    assert.equal(f.calls.length, 0);
  } finally {
    f.restore();
  }
});

test('modifyMetadata authenticates via the Authorization header, not form fields (M1)', async () => {
  let seen = null;
  const f = installFakeFetch([
    {
      method: 'POST',
      url: '/metadata/',
      response: ({ opts }) => {
        seen = opts;
        return { json: { success: true } };
      },
    },
  ]);
  try {
    await ia.modifyMetadata('item', [{ op: 'replace', path: '/title', value: 'X' }], CREDS);
    // Credentials must travel in the Authorization header (consistent with upload).
    const auth = seen.headers && (seen.headers.Authorization || seen.headers.authorization);
    assert.equal(auth, 'LOW A:S', 'should send Authorization: LOW access:secret');
    // …and NOT be leaked as access/secret form fields in the body.
    assert.ok(!/(^|&)access=/.test(seen.body), 'access must not be a form field');
    assert.ok(!/(^|&)secret=/.test(seen.body), 'secret must not be a form field');
  } finally {
    f.restore();
  }
});

/* ----------------- retry/backoff on transient GET (compliance) ------------ */
// archive.org guidelines: honor 429/503. A GET search that 503s once must be
// retried automatically and then succeed — without the caller seeing the blip.

test('search retries a transient 503 GET and then succeeds', async () => {
  let n = 0;
  const f = installFakeFetch([
    {
      method: 'GET',
      url: '/advancedsearch.php',
      response: () => {
        n++;
        if (n === 1) return { status: 503, text: 'SlowDown' }; // first try throttled
        return { json: { response: { numFound: 1, start: 0, docs: [{ identifier: 'x' }] } } };
      },
    },
  ]);
  try {
    const res = await ia.search('anything');
    assert.equal(n, 2, 'one retry after the 503');
    assert.equal(res.numFound, 1);
    assert.equal(res.docs[0].identifier, 'x');
  } finally {
    f.restore();
  }
});

test('a POST (login) is NOT auto-retried on a 503 (non-idempotent)', async () => {
  let n = 0;
  const f = installFakeFetch([
    {
      method: 'POST',
      url: '/services/xauthn/',
      response: () => {
        n++;
        return { status: 503, text: 'SlowDown' };
      },
    },
  ]);
  try {
    await assert.rejects(ia.login('a@b.c', 'pw'));
    assert.equal(n, 1, 'POST must not be retried');
  } finally {
    f.restore();
  }
});
