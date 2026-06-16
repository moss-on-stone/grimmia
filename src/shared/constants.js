'use strict';

/**
 * constants.js (shared)
 *
 * Single source of truth for archive.org hosts and the derived User-Agent.
 * Lives under src/shared/ because it is consumed from the main process and is
 * pure (no DOM, no Electron). Deriving USER_AGENT from package.json's version
 * removes the manual "bump the version in two places" ritual (L7).
 */

const { version } = require('../../package.json');

const HOST = 'archive.org';
const S3_HOST = 's3.us.archive.org';
const USER_AGENT = `IA-Desktop/${version} (+https://archive.org)`;

module.exports = { HOST, S3_HOST, USER_AGENT };
