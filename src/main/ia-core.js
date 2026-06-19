'use strict';

/**
 * ia-core.js
 *
 * Pure, side-effect-free logic for the Internet Archive client: URL building,
 * metadata header encoding, and response parsing. No network, no filesystem,
 * no Electron — so it is fully unit-testable with `node --test`.
 *
 * The networked client (ia-client.js) composes these helpers.
 */

const { HOST } = require('../shared/constants');

/** Thrown for archive.org-level failures with a human-readable message. */
class IAError extends Error {
  constructor(message, { status, body, retryAfter } = {}) {
    super(message);
    this.name = 'IAError';
    this.status = status;
    this.body = body;
    // The server's Retry-After (raw header value) on a 429/503, when present, so
    // the retry layer can honor archive.org's throttling instruction (#compliance).
    this.retryAfter = retryAfter;
  }
}

/**
 * Build the IAError for a non-2xx upload response. Mirrors the download path:
 * carries `status` AND the server's `Retry-After` (lowercased Node header key) so
 * a 503/429 during an upload is retried and honors throttling instead of aborting
 * the whole batch (#compliance). Pure — no IO — so it's unit-tested directly.
 *
 * @param {number} statusCode the HTTP status
 * @param {object} [headers] the Node response headers (lowercased keys)
 * @param {string} remote the remote filename (for the message)
 * @param {string} [body] the response body, if read
 */
function uploadError(statusCode, headers, remote, body) {
  return new IAError(`Upload failed (HTTP ${statusCode}) for ${remote}.`, {
    status: statusCode,
    body,
    retryAfter: headers ? headers['retry-after'] : undefined,
  });
}

const DEFAULT_SEARCH_FIELDS = [
  'identifier',
  'title',
  'creator',
  'date',
  'mediatype',
  'description',
  'subject',
  'downloads',
  'item_size',
  'collection',
  'publicdate',
];

/* -------------------------- metadata value encoding ----------------------- */

/** Encode a metadata value per IAS3 rules (UTF-8 uri()-wrapped when non-ASCII). */
function encodeMetaValue(value) {
  const s = String(value);
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  return `uri(${encodeURIComponent(s)})`;
}

/** Convert a metadata field name to its header-safe form (underscore -> --). */
function metaHeaderName(name) {
  return name.replace(/_/g, '--');
}

/**
 * Build the x-archive-* headers for an upload from a metadata object.
 * Scalars -> x-archive-meta-<name>; arrays -> x-archive-meta01-<name>, ...
 * Null/empty values are skipped.
 */
function buildMetaHeaders(metadata = {}) {
  const headers = {};
  for (const [key, raw] of Object.entries(metadata)) {
    if (raw == null || raw === '') continue;
    const name = metaHeaderName(key);
    if (Array.isArray(raw)) {
      raw.forEach((val, i) => {
        if (val == null || val === '') return;
        const n = String(i + 1).padStart(2, '0');
        headers[`x-archive-meta${n}-${name}`] = encodeMetaValue(val);
      });
    } else {
      headers[`x-archive-meta-${name}`] = encodeMetaValue(raw);
    }
  }
  return headers;
}

/* --------------------------- search URL builder --------------------------- */

/** Build the advancedsearch.php URL for a paged UI search. */
function buildSearchUrl(query, opts = {}) {
  const { page = 1, rows = 50, sort = '', fields } = opts;
  const params = new URLSearchParams();
  params.set('q', query || '');
  params.set('output', 'json');
  params.set('rows', String(rows));
  params.set('page', String(page));
  for (const f of fields || DEFAULT_SEARCH_FIELDS) params.append('fl[]', f);
  if (sort) params.append('sort[]', sort);
  return `https://${HOST}/advancedsearch.php?${params.toString()}`;
}

/* ---------------------------- scraping API URL ---------------------------- */

/**
 * Build a /services/search/v1/scrape URL for cursor-paged bulk listing (#2).
 * `q` is a search query (e.g. `collection:prelinger`); `cursor` continues a
 * prior page; `fields` selects returned fields; `count` is the page size.
 */
function buildScrapeUrl(query, { cursor, count = 1000, fields = ['identifier'] } = {}) {
  const params = new URLSearchParams();
  params.set('q', query || '');
  params.set('fields', (fields || ['identifier']).join(','));
  params.set('count', String(count));
  if (cursor) params.set('cursor', cursor);
  return `https://${HOST}/services/search/v1/scrape?${params.toString()}`;
}

/* --------------------------- login response parse ------------------------- */

/**
 * Parse the xauthn login response into a credentials object, or throw a
 * friendly IAError. Mirrors internetarchive.config.get_auth_config.
 */
function parseLoginResponse(json, email) {
  if (!json || typeof json !== 'object') {
    throw new IAError('Unexpected response from archive.org during login.');
  }
  if (!json.success) {
    const reason =
      (json.values && json.values.reason) ||
      json.error ||
      'Login failed. Check your email and password.';
    throw new IAError(reason);
  }
  const v = json.values || {};
  if (!v.s3 || !v.s3.access || !v.s3.secret) {
    throw new IAError('Login succeeded but no S3 keys were returned by archive.org.');
  }
  return {
    access: v.s3.access,
    secret: v.s3.secret,
    cookies: {
      'logged-in-user': v.cookies && v.cookies['logged-in-user'],
      'logged-in-sig': v.cookies && v.cookies['logged-in-sig'],
    },
    screenname: v.screenname || email || '',
    // The URL-safe account slug used to build /details/@<slug>. xauthn returns it
    // as `itemname` (confirmed live: the response's `values` includes an
    // `itemname` key, e.g. "@g_y_library"), DISTINCT from the display
    // `screenname` — which can be CJK/spaced and 400s as a profile URL. Fall back
    // to the `logged-in-user` cookie (also the slug form) if itemname is ever
    // absent. userProfileUrl tolerates a leading '@' either way.
    itemname: v.itemname || (v.cookies && v.cookies['logged-in-user']) || '',
    email: email || '',
  };
}

/* ----------------------------- download paths ----------------------------- */

/** Build a direct download URL for a file within an item. */
function downloadUrl(identifier, filename) {
  return `https://${HOST}/download/${encodeURIComponent(identifier)}/${encodeURIComponent(filename)}`;
}

/** Reduce a (possibly path-bearing) remote name to a safe local basename. */
function safeLocalName(name) {
  return String(name).split(/[\\/]/).filter(Boolean).pop() || 'file';
}

/** Build the `Authorization: LOW access:secret` header value, or undefined. */
function authHeader(creds) {
  if (!creds || !creds.access || !creds.secret) return undefined;
  return `LOW ${creds.access}:${creds.secret}`;
}

module.exports = {
  IAError,
  uploadError,
  HOST,
  DEFAULT_SEARCH_FIELDS,
  encodeMetaValue,
  metaHeaderName,
  buildMetaHeaders,
  buildSearchUrl,
  buildScrapeUrl,
  parseLoginResponse,
  downloadUrl,
  safeLocalName,
  authHeader,
};
