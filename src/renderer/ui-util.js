'use strict';

/**
 * ui-util.js
 *
 * Pure helper functions for the renderer. No DOM access, so they can be unit
 * tested with `node --test`. Loaded both as a CommonJS module (tests) and as a
 * plain <script> in the browser (attaches to window.uiUtil).
 */

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.uiUtil = api;
})(typeof window !== 'undefined' ? window : null, function () {
  /** Human-readable byte size, e.g. 1536 -> "1.5 KB". */
  function formatBytes(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let i = 0;
    let val = n;
    while (val >= 1024 && i < units.length - 1) {
      val /= 1024;
      i++;
    }
    return i === 0 ? `${Math.round(val)} ${units[i]}` : `${val.toFixed(1)} ${units[i]}`;
  }

  /** Integer percent of received/total, clamped to 0..100. */
  function percent(received, total) {
    const r = Number(received);
    const t = Number(total);
    if (!Number.isFinite(t) || t <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((r / t) * 100)));
  }

  /** Split a comma-separated subjects string into a trimmed, non-empty array. */
  function parseSubjects(input) {
    if (!input) return [];
    return String(input)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /**
   * Top-15 upload languages with the codes archive.org actually uses — MARC /
   * ISO 639-2 *bibliographic* codes (e.g. Chinese=chi not zho, French=fre not
   * fra, German=ger not deu), verified against live archive.org item counts.
   * Ordered roughly by IA item volume; includes Japanese/Chinese/Korean.
   */
  const UPLOAD_LANGUAGES = [
    { code: 'eng', label: 'English' },
    { code: 'spa', label: 'Spanish' },
    { code: 'ger', label: 'German' },
    { code: 'fre', label: 'French' },
    { code: 'chi', label: 'Chinese' },
    { code: 'hin', label: 'Hindi' },
    { code: 'dut', label: 'Dutch' },
    { code: 'ara', label: 'Arabic' },
    { code: 'rus', label: 'Russian' },
    { code: 'por', label: 'Portuguese' },
    { code: 'ita', label: 'Italian' },
    { code: 'jpn', label: 'Japanese' },
    { code: 'kor', label: 'Korean' },
    { code: 'per', label: 'Persian' },
    { code: 'tur', label: 'Turkish' },
  ];

  /** Assemble a clean metadata object for upload from the upload form fields. */
  function buildUploadMetadata(fields = {}) {
    const md = {};
    if (fields.title) md.title = fields.title.trim();
    if (fields.creator) md.creator = fields.creator.trim();
    if (fields.date) md.date = fields.date.trim();
    if (fields.mediatype) md.mediatype = fields.mediatype.trim();
    if (fields.description) md.description = fields.description.trim();
    if (fields.language && String(fields.language).trim()) md.language = String(fields.language).trim();
    const subjects = parseSubjects(fields.subjects);
    if (subjects.length) md.subject = subjects;
    // BookReader hints (texts). Only emitted when the user opts in.
    //  - page-progression=rl → pages turn right-to-left (CJK/RTL books)
    //  - bookreader-defaults=mode/1up → open in single-page view (default is 2up)
    if (fields.pageProgressionRl) md['page-progression'] = 'rl';
    if (fields.oneUp) md['bookreader-defaults'] = 'mode/1up';
    return md;
  }

  /**
   * Whether a string is a valid archive.org identifier. Real identifiers contain
   * uppercase (e.g. "NPTCM19400622"), so the check is case-insensitive.
   */
  function validIdentifier(id) {
    return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(String(id || ''));
  }

  /** Return the first element of an array, or the value itself, or ''. */
  function firstOf(value) {
    if (Array.isArray(value)) return value.length ? value[0] : '';
    return value == null ? '' : value;
  }

  /**
   * Build the array shape that the download pipeline expects from a single
   * item. `startDownload`/`download:start` want an ARRAY of
   * { identifier, title, files? } objects — passing a bare identifier string
   * (as the item-modal buttons once did) makes main.js iterate the string's
   * characters. This is the single normalization point for modal callers.
   *
   * Files are only included when a non-empty list is given; otherwise main
   * resolves them from metadata. Title falls back to the identifier.
   */
  function toDownloadItems(identifier, title, files) {
    const item = { identifier, title: title || identifier };
    if (Array.isArray(files) && files.length) item.files = files;
    return [item];
  }

  // Monotonic counter of factories created in this JS context. Combined with a
  // random component, it guarantees that two factories (e.g. created before and
  // after a renderer reload) never share a prefix even if both count from 1.
  let factoryInstance = 0;

  /**
   * Create a jobId generator with a per-session prefix (H5). Each returned
   * function yields `job-<prefix>-<n>`; the prefix is unique per factory, so a
   * reload that resets the counter to 1 can't collide with an in-flight job's
   * id from a previous factory.
   *
   * @param {string} [prefix] explicit session prefix (mainly for tests)
   */
  function makeJobIdFactory(prefix) {
    const p =
      prefix != null
        ? String(prefix)
        : `${++factoryInstance}${Math.random().toString(36).slice(2, 8)}`;
    let seq = 0;
    return () => `job-${p}-${++seq}`;
  }

  /**
   * Turn a metadata `description` (string or array of strings) into a single
   * plain-text string. Arrays are joined with a blank line between paragraphs.
   * The result is meant for textContent insertion — any HTML in it stays inert
   * (H2: descriptions are attacker-controlled, so we never parse them as HTML).
   */
  function descriptionText(description) {
    if (description == null) return '';
    if (Array.isArray(description)) {
      return description.map((d) => String(d == null ? '' : d)).filter(Boolean).join('\n\n');
    }
    return String(description);
  }

  /**
   * Summary line for a finished download job (#4). When `mismatches` files
   * failed checksum verification, append a warning so the user knows to retry
   * those files.
   */
  function downloadDoneSummary(count, mismatches) {
    const base = `Done — ${count} file(s)`;
    const m = Number(mismatches) || 0;
    if (m <= 0) return base;
    return `${base} — ⚠ ${m} failed checksum`;
  }

  /**
   * Compute the Downloads-tab badge state from the number of active+queued
   * download jobs. Hidden at zero; shows the count, capped at "99+".
   * @returns {{visible: boolean, text: string}}
   */
  function queueBadge(count) {
    const n = Math.floor(Number(count));
    if (!Number.isFinite(n) || n <= 0) return { visible: false, text: '' };
    return { visible: true, text: n > 99 ? '99+' : String(n) };
  }

  /**
   * Transfers-tab badge from the active+queued download and upload counts. One
   * pill showing the combined total, capped at "99+". `kind` selects the color:
   * 'upload' whenever any upload is active (so an ongoing upload stands out),
   * else 'download'. Hidden when nothing is transferring.
   * @returns {{visible: boolean, text: string, kind: 'download'|'upload'}}
   */
  function transferBadge(downloadCount, uploadCount) {
    const d = Math.floor(Number(downloadCount));
    const up = Math.floor(Number(uploadCount));
    const dn = Number.isFinite(d) && d > 0 ? d : 0;
    const un = Number.isFinite(up) && up > 0 ? up : 0;
    const total = dn + un;
    const badge = queueBadge(total);
    return { ...badge, kind: un > 0 ? 'upload' : 'download' };
  }

  /** The archive.org item (details) page URL for an identifier, or '' if none. */
  function itemPageUrl(identifier) {
    const id = String(identifier == null ? '' : identifier).trim();
    if (!id) return '';
    return `https://archive.org/details/${encodeURIComponent(id)}`;
  }

  /** Escape text for safe insertion as HTML text content. */
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  return {
    formatBytes,
    percent,
    parseSubjects,
    buildUploadMetadata,
    validIdentifier,
    firstOf,
    escapeHtml,
    toDownloadItems,
    makeJobIdFactory,
    descriptionText,
    downloadDoneSummary,
    queueBadge,
    transferBadge,
    itemPageUrl,
    UPLOAD_LANGUAGES,
  };
});
