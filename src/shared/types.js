'use strict';

/**
 * types.js (shared)
 *
 * JSDoc typedefs for the most error-prone seams — the IPC payloads and the
 * download:progress phase union (L8). These are the untyped cross-file contracts
 * where drift hides (C1 was exactly this: a `string` passed where an
 * `Array<DownloadItem>` was expected). Editors with a TypeScript language
 * service surface mismatches against these typedefs even without a build step.
 *
 * This module exports nothing at runtime; it exists for its typedefs.
 *
 * @typedef {Object} IAFile
 * @property {string} name           remote filename within the item
 * @property {string} [format]       archive.org format string (e.g. "Text PDF")
 * @property {number|string} [size]  byte size if known
 * @property {string} [source]       "original" | "derivative" | "metadata"
 *
 * @typedef {Object} DownloadItem
 * @property {string} identifier     a valid archive.org identifier
 * @property {string} [title]        item title (used for rename + labels)
 * @property {IAFile[]} [files]      pre-resolved files; omitted => fetch metadata
 *
 * @typedef {Object} DownloadStartPayload
 * @property {string} jobId
 * @property {DownloadItem[]} items  MUST be an array (never a bare identifier)
 * @property {Object} prefs          { format, rename }
 * @property {string} destRoot       absolute, existing directory
 *
 * @typedef {Object} UploadStartPayload
 * @property {string} jobId
 * @property {string} identifier
 * @property {{path:string,name:string,size:number}[]} files
 * @property {Object} metadata
 * @property {boolean} derive
 *
 * The download:progress / upload:progress event union (the `phase` field):
 * @typedef {('file-start'|'file-progress'|'file-done'|'complete'|'error')} ProgressPhase
 *
 * @typedef {Object} ProgressEvent
 * @property {string} jobId
 * @property {ProgressPhase} phase
 * @property {number} [index]
 * @property {number} [total]
 * @property {string} [name]
 * @property {number} [received]     download byte progress
 * @property {number} [sent]         upload byte progress
 * @property {number} [totalBytes]
 * @property {string} [dir]          on 'complete' (download): the saved folder
 * @property {number} [count]        on 'complete' (download): files written
 * @property {string} [message]      on 'error'
 */

module.exports = {};
