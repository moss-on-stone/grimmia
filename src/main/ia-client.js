'use strict';

/**
 * ia-client.js
 *
 * Networked Internet Archive client. Composes the pure helpers in ia-core.js
 * with Node's built-in fetch/https — no third-party deps, so the packaged app
 * stays tiny. Covers the operations the app exposes:
 *
 *   - login          POST https://archive.org/services/xauthn/?op=login
 *   - search         GET  https://archive.org/advancedsearch.php
 *   - getMetadata    GET  https://archive.org/metadata/{identifier}
 *   - downloadFile   GET  https://archive.org/download/{identifier}/{file}
 *   - uploadFile     PUT  https://s3.us.archive.org/{identifier}/{file}
 *   - modifyMetadata POST https://archive.org/metadata/{identifier}
 */

const https = require('node:https');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const core = require('./ia-core');
const { IAError } = core;
const { HOST, S3_HOST, USER_AGENT } = require('../shared/constants');

/* --------------------------------------------------------------------------
 * Low-level request helper
 * ------------------------------------------------------------------------ */

async function request(method, url, { headers = {}, body, signal } = {}) {
  const res = await fetch(url, {
    method,
    headers: { 'User-Agent': USER_AGENT, ...headers },
    body,
    signal,
    redirect: 'follow',
  });
  const text = await res.text();
  let json;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json') || (text && (text[0] === '{' || text[0] === '['))) {
    try {
      json = JSON.parse(text);
    } catch {
      /* leave json undefined */
    }
  }
  return { ok: res.ok, status: res.status, headers: res.headers, text, json };
}

/* --------------------------------------------------------------------------
 * Authentication
 * ------------------------------------------------------------------------ */

async function login(email, password) {
  const url = `https://${HOST}/services/xauthn/?op=login`;
  const form = new URLSearchParams({ email, password });
  const { json, status, text } = await request('POST', url, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!json) {
    throw new IAError('Unexpected response from archive.org during login.', { status, body: text });
  }
  return core.parseLoginResponse(json, email);
}

/* --------------------------------------------------------------------------
 * Search
 * ------------------------------------------------------------------------ */

async function search(query, opts = {}) {
  const url = core.buildSearchUrl(query, opts);
  const { ok, json, status, text } = await request('GET', url);
  if (!ok || !json || !json.response) {
    // L6: surface archive.org's real error (e.g. a malformed-query message)
    // instead of a generic "Search failed." so the user can fix the query.
    const reason = (json && json.error) || 'Search request failed.';
    throw new IAError(reason, { status, body: text });
  }
  return {
    numFound: json.response.numFound,
    start: json.response.start,
    docs: json.response.docs || [],
  };
}

/* --------------------------------------------------------------------------
 * Scraping API (cursor-paged bulk listing) — #2
 * ------------------------------------------------------------------------ */

/** Fetch one scrape page for a query (optionally continuing from a cursor). */
async function scrapeCollectionPage(query, cursor) {
  const url = core.buildScrapeUrl(query, cursor ? { cursor } : {});
  const { ok, json, status, text } = await request('GET', url);
  if (!ok || !json || !Array.isArray(json.items)) {
    throw new IAError('Could not list the collection.', { status, body: text });
  }
  return { items: json.items, cursor: json.cursor };
}

/**
 * Page through a scrape query, collecting identifiers until the cursor is
 * exhausted (or `maxItems` is reached). `fetchPage(cursor)` is injectable for
 * tests; in production it defaults to the networked page fetch.
 *
 * @returns {Promise<string[]>} identifiers
 */
async function scrapeAll(query, { fetchPage = (c) => scrapeCollectionPage(query, c), maxItems = Infinity, onProgress } = {}) {
  const ids = [];
  let cursor;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const page = await fetchPage(cursor);
    const items = (page && page.items) || [];
    if (!items.length) break; // empty page → done (guards a stuck cursor)
    for (const it of items) {
      if (it && it.identifier) ids.push(it.identifier);
      if (ids.length >= maxItems) return ids.slice(0, maxItems);
    }
    if (onProgress) onProgress({ count: ids.length });
    if (!page.cursor) break;
    cursor = page.cursor;
  }
  return ids;
}

/* --------------------------------------------------------------------------
 * Item metadata
 * ------------------------------------------------------------------------ */

async function getMetadata(identifier) {
  if (!identifier) throw new IAError('No identifier provided.');
  const url = `https://${HOST}/metadata/${encodeURIComponent(identifier)}`;
  const { ok, json, status, text } = await request('GET', url);
  if (!ok || !json) {
    throw new IAError(`Could not load metadata for "${identifier}".`, { status, body: text });
  }
  if (json.metadata == null && (!json.files || json.files.length === 0)) {
    throw new IAError(`Item "${identifier}" was not found.`, { status: 404 });
  }
  return json;
}

/* --------------------------------------------------------------------------
 * Item tasks (derive / catalog status) — #16, read-only
 * ------------------------------------------------------------------------ */

async function getTasks(identifier) {
  if (!identifier) throw new IAError('No identifier provided.');
  const url = `https://${HOST}/services/tasks.php?identifier=${encodeURIComponent(identifier)}`;
  const { ok, json, status, text } = await request('GET', url);
  if (!ok || !json) {
    throw new IAError(`Could not load tasks for "${identifier}".`, { status, body: text });
  }
  return json;
}

/* --------------------------------------------------------------------------
 * Download with progress + resume
 * ------------------------------------------------------------------------ */

/**
 * Parse a `Content-Range: bytes <start>-<end>/<total>` header.
 * @returns {{start:number,end:number,total:number|null}|null}
 */
function parseContentRange(value) {
  if (!value) return null;
  const m = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(String(value));
  if (!m) return null;
  return {
    start: Number(m[1]),
    end: Number(m[2]),
    total: m[3] === '*' ? null : Number(m[3]),
  };
}

function downloadFile({ url, destPath, expectedSize, onProgress, signal }) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    const knownSize = expectedSize != null ? Number(expectedSize) : null;

    let startByte = 0;
    // Only consider resume/skip when we actually know the expected size. Files
    // with no recorded size are downloaded fresh — never appended (H1.1): an
    // already-complete no-size file used to be re-Range'd and grown forever.
    if (knownSize != null && fs.existsSync(destPath)) {
      const stat = fs.statSync(destPath);
      if (stat.size === knownSize) {
        resolve({ path: destPath, bytes: stat.size, skipped: true });
        return;
      }
      if (stat.size > 0 && stat.size < knownSize) {
        startByte = stat.size;
      }
    }

    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const headers = { 'User-Agent': USER_AGENT };
    if (startByte > 0) headers.Range = `bytes=${startByte}-`;

    const req = lib.get(u, { headers }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, u).toString();
        downloadFile({ url: next, destPath, expectedSize, onProgress, signal }).then(resolve, reject);
        return;
      }

      if (res.statusCode !== 200 && res.statusCode !== 206) {
        res.resume();
        reject(new IAError(`Download failed (HTTP ${res.statusCode}) for ${path.basename(destPath)}.`, { status: res.statusCode }));
        return;
      }

      // H1.2: validate a 206's Content-Range actually starts at the byte we
      // asked for. A server that ignores Range (returns from 0, or a different
      // offset) must NOT be appended to — restart the file fresh from 0.
      let resuming = res.statusCode === 206 && startByte > 0;
      if (resuming) {
        const cr = parseContentRange(res.headers['content-range']);
        if (!cr || cr.start !== startByte) {
          resuming = false;
          startByte = 0;
        }
      } else {
        // A 206 we didn't ask to resume, or a 200 — write from the beginning.
        resuming = false;
        startByte = 0;
      }

      const total =
        (knownSize != null ? knownSize : 0) ||
        (Number(res.headers['content-length']) || 0) + startByte;

      const out = fs.createWriteStream(destPath, { flags: resuming ? 'a' : 'w' });
      let received = startByte;
      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        out.destroy();
        reject(err);
      };

      const onAbort = () => {
        req.destroy();
        fail(new IAError('Download cancelled.'));
      };
      if (signal) {
        if (signal.aborted) return onAbort();
        signal.addEventListener('abort', onAbort, { once: true });
      }

      res.on('data', (chunk) => {
        received += chunk.length;
        if (onProgress) onProgress({ received, total });
      });
      res.on('error', (err) => fail(err));
      // A connection that drops mid-body (or a Content-Length the server never
      // fulfils) fires 'aborted' / a premature 'close' without 'end'. Treat the
      // download as failed rather than hanging forever waiting on 'finish'.
      res.on('aborted', () =>
        fail(new IAError(`Connection dropped during download of ${path.basename(destPath)}.`))
      );
      res.on('close', () => {
        if (!settled && !res.complete) {
          fail(new IAError(`Connection closed before download of ${path.basename(destPath)} finished.`));
        }
      });
      out.on('error', (err) => fail(err));
      out.on('finish', () => {
        if (signal) signal.removeEventListener('abort', onAbort);
        if (settled) return;
        // H1.3: when the total size is known, a finished stream that delivered
        // fewer bytes (dropped connection) must be treated as a failure, not a
        // silent success with a truncated file.
        if (knownSize != null && received !== knownSize) {
          settled = true;
          reject(
            new IAError(
              `Incomplete download for ${path.basename(destPath)}: got ${received} of ${knownSize} bytes.`,
              { status: res.statusCode }
            )
          );
          return;
        }
        settled = true;
        resolve({ path: destPath, bytes: received, skipped: false });
      });
      res.pipe(out);
    });

    req.on('error', (err) => reject(err));
  });
}

/* --------------------------------------------------------------------------
 * Metadata write (JSON patch)
 * ------------------------------------------------------------------------ */

/**
 * Modify an item's metadata. `patches` must be an RFC 6902 JSON Patch ARRAY,
 * e.g. [{ op: 'replace', path: '/title', value: '…' }] — that is what
 * archive.org's metadata-write API expects for `-patch`.
 *
 * Auth travels in the `Authorization: LOW access:secret` HEADER (consistent with
 * uploadFile), NOT as access/secret form fields (M1).
 */
async function modifyMetadata(identifier, patches, creds, { target = 'metadata' } = {}) {
  const auth = core.authHeader(creds);
  if (!auth) throw new IAError('You must be logged in to modify metadata.');
  const body = new URLSearchParams();
  body.set('-target', target);
  body.set('-patch', JSON.stringify(patches));

  const url = `https://${HOST}/metadata/${encodeURIComponent(identifier)}`;
  const { ok, json, status, text } = await request('POST', url, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: auth },
    body: body.toString(),
  });
  if (!ok || (json && json.success === false)) {
    const reason = (json && (json.error || json.log)) || 'Metadata update failed.';
    throw new IAError(reason, { status, body: text });
  }
  return json || { success: true };
}

/* --------------------------------------------------------------------------
 * Upload (S3-like PUT)
 * ------------------------------------------------------------------------ */

function uploadFile({
  identifier,
  filePath,
  remoteName,
  metadata = {},
  creds,
  makeBucket = true,
  derive = true,
  onProgress,
  signal,
}) {
  return new Promise((resolve, reject) => {
    const auth = core.authHeader(creds);
    if (!auth) return reject(new IAError('You must be logged in to upload.'));
    if (!fs.existsSync(filePath)) return reject(new IAError(`File not found: ${filePath}`));

    const remote = remoteName || path.basename(filePath);
    const size = fs.statSync(filePath).size;
    const u = new URL(`https://${S3_HOST}/${encodeURIComponent(identifier)}/${encodeURIComponent(remote)}`);

    const headers = {
      'User-Agent': USER_AGENT,
      Authorization: auth,
      'Content-Length': String(size),
      'x-archive-size-hint': String(size),
    };
    if (makeBucket) {
      headers['x-archive-auto-make-bucket'] = '1';
      Object.assign(headers, core.buildMetaHeaders(metadata));
    }
    if (!derive) headers['x-archive-queue-derive'] = '0';

    const req = https.request(u, { method: 'PUT', headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ identifier, remote, bytes: size });
        } else {
          reject(new IAError(`Upload failed (HTTP ${res.statusCode}) for ${remote}.`, { status: res.statusCode, body }));
        }
      });
    });
    req.on('error', (err) => reject(err));

    const stream = fs.createReadStream(filePath);
    let sent = 0;
    stream.on('data', (chunk) => {
      sent += chunk.length;
      if (onProgress) onProgress({ sent, total: size });
    });
    stream.on('error', (err) => {
      req.destroy();
      reject(err);
    });

    if (signal) {
      const onAbort = () => {
        stream.destroy();
        req.destroy();
        reject(new IAError('Upload cancelled.'));
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }

    stream.pipe(req);
  });
}

module.exports = {
  IAError,
  login,
  search,
  getMetadata,
  getTasks,
  scrapeCollectionPage,
  scrapeAll,
  downloadUrl: core.downloadUrl,
  downloadFile,
  modifyMetadata,
  uploadFile,
};
