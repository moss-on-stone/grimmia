'use strict';

/**
 * checksum.js
 *
 * Verify a downloaded file against the checksum archive.org publishes in item
 * metadata (idea #4). IA file records carry `md5`, `sha1`, and `crc32`. We
 * verify with Node's crypto (md5 / sha1); crc32 is not a crypto hash, so a file
 * that only advertises crc32 is reported as 'unknown' rather than mis-verified.
 *
 * Pure selection logic (`pickChecksum`) is unit-tested directly; `hashFile` /
 * `verifyFile` are tested against temp files.
 */

const fs = require('node:fs');
const crypto = require('node:crypto');

// Strongest first. Only md5/sha1 are crypto-verifiable here.
const VERIFIABLE = ['sha1', 'md5'];
const RANKED = ['sha1', 'md5', 'crc32'];

/**
 * Choose the strongest published checksum on a file record.
 * @returns {{algo:string, value:string}|null}
 */
function pickChecksum(file) {
  if (!file || typeof file !== 'object') return null;
  for (const algo of RANKED) {
    const value = file[algo];
    if (typeof value === 'string' && value.trim()) return { algo, value: value.trim() };
  }
  return null;
}

/** Stream-hash a local file with the given crypto algorithm → hex digest. */
function hashFile(filePath, algo) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algo);
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Verify a downloaded file against its IA metadata.
 * @returns {Promise<'ok'|'mismatch'|'unknown'>}
 *   - 'ok'       the file's strongest crypto-verifiable hash matches
 *   - 'mismatch' the published hash does not match the file on disk
 *   - 'unknown'  no crypto-verifiable checksum was published (e.g. crc32 only)
 */
async function verifyFile(filePath, file) {
  const picked = pickChecksum(file);
  if (!picked || !VERIFIABLE.includes(picked.algo)) return 'unknown';
  const actual = await hashFile(filePath, picked.algo);
  return actual.toLowerCase() === picked.value.toLowerCase() ? 'ok' : 'mismatch';
}

module.exports = { pickChecksum, hashFile, verifyFile, VERIFIABLE };
