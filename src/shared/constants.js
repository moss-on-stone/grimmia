'use strict';

/**
 * constants.js (shared)
 *
 * Single source of truth for archive.org hosts and the derived User-Agent.
 * Lives under src/shared/ because it is consumed from the main process and is
 * pure (no DOM, no Electron). Deriving USER_AGENT from package.json's version
 * removes the manual "bump the version in two places" ritual (L7).
 *
 * The User-Agent follows archive.org's automated-access guidelines
 * (https://archive.org/developers/bots.html): it identifies the tool name and
 * version, plus a (+URL) pointing at the public project so archive.org can
 * identify and reach the operator. EVERY outbound request to archive.org MUST
 * send this header — see src/main/ia-client.js. (No personal contact info goes
 * in the UA by policy; the repo's issue tracker is the contact path.)
 */

const { version } = require('../../package.json');

const HOST = 'archive.org';
const S3_HOST = 's3.us.archive.org';
const USER_AGENT = `IA-Desktop/${version} (+https://github.com/moss-on-stone/ia-desktop)`;

module.exports = { HOST, S3_HOST, USER_AGENT };
