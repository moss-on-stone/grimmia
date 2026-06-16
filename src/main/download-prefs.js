'use strict';

/**
 * download-prefs.js
 *
 * Pure logic for download preferences:
 *   - filter an item's file list by a format preset (PDF, text PDF, EPUB, …)
 *   - sanitize filenames (strip illegal chars on Windows/macOS)
 *   - rename/append the item title to downloaded filenames
 *   - plan a download (filter + compute local save-as names)
 *
 * No filesystem, no network — fully unit-testable.
 */

const path = require('node:path');

/**
 * Selectable download format presets. `formats` lists the archive.org file
 * `format` values that match; `exts` lists filename extensions as a fallback
 * when a file has no/odd format string.
 */
// Each preset's `fallback` is an ordered chain of preset keys to try when the
// preset itself matches nothing — so a strict choice (e.g. "PDF only") still
// downloads SOMETHING (the next-best readable file) instead of failing. The
// chain always ends at 'all'.
const FORMAT_PRESETS = [
  { key: 'all', label: 'All files', formats: null, exts: null, fallback: [] },
  {
    key: 'pdf',
    label: 'PDF only (image scan, no text layer)',
    // Just the plain image PDF — NOT the much larger searchable "_text.pdf".
    formats: ['Image Container PDF', 'PDF'],
    exts: ['.pdf'],
    // Never grab the OCR text-layer PDFs, even via the .pdf extension fallback.
    excludeFormats: ['Text PDF', 'Additional Text PDF'],
    // Missing the image PDF? Take the text PDF, then EPUB, then DjVu/plain text.
    fallback: ['text_pdf', 'epub', 'text', 'all'],
  },
  {
    key: 'text_pdf',
    label: 'Searchable text PDF (OCR text layer)',
    formats: ['Text PDF', 'Additional Text PDF'],
    exts: null, // match by format only, so it never picks up the image PDF
    fallback: ['pdf', 'epub', 'text', 'all'],
  },
  { key: 'epub', label: 'EPUB only', formats: ['EPUB'], exts: ['.epub'], fallback: ['pdf', 'text_pdf', 'text', 'all'] },
  {
    key: 'text',
    label: 'Plain text (OCR)',
    formats: ['DjVuTXT', 'Text', 'Plain Text'],
    exts: ['.txt'],
    fallback: ['text_pdf', 'pdf', 'epub', 'all'],
  },
];

const PRESET_BY_KEY = Object.fromEntries(FORMAT_PRESETS.map((p) => [p.key, p]));

/** Files that are derivative/metadata noise we never want to surface. */
function isRealFile(f) {
  if (!f || !f.name) return false;
  if (f.source === 'metadata') return false;
  const n = f.name.toLowerCase();
  if (n === '__ia_thumb.jpg' || n.endsWith('_meta.xml') || n.endsWith('_files.xml')) return false;
  if (n.endsWith('_meta.sqlite') || n.endsWith('_reviews.xml') || n === 'history') return false;
  const fmt = (f.format || '').toLowerCase();
  if (fmt === 'metadata' || fmt === 'thumbnail' || fmt === 'item tile' || fmt === 'json') return false;
  return true;
}

/** Filter an item's files by a format preset key. */
function filterFilesByFormat(files, presetKey) {
  const real = (files || []).filter(isRealFile);
  const preset = PRESET_BY_KEY[presetKey];
  if (!preset || preset.key === 'all' || (!preset.formats && !preset.exts)) return real;

  const formats = new Set((preset.formats || []).map((s) => s.toLowerCase()));
  const exts = preset.exts || [];
  // Formats this preset must never include, even via the extension fallback —
  // e.g. "PDF only" must not pick up the OCR "Additional Text PDF" by its .pdf
  // extension.
  const excluded = new Set((preset.excludeFormats || []).map((s) => s.toLowerCase()));
  return real.filter((f) => {
    const fmt = (f.format || '').toLowerCase();
    if (excluded.has(fmt)) return false;
    if (formats.has(fmt)) return true;
    const ext = path.extname(f.name).toLowerCase();
    return exts.includes(ext);
  });
}

/**
 * Compile a shell-style glob to an anchored, case-insensitive RegExp (#3).
 * Supports `*` (any run), `?` (one char), and `[...]` character classes. All
 * other characters are treated literally (regex metacharacters are escaped).
 */
function globToRegExp(glob) {
  const g = String(glob);
  let re = '^';
  for (let i = 0; i < g.length; i++) {
    const ch = g[i];
    if (ch === '*') re += '.*';
    else if (ch === '?') re += '.';
    else if (ch === '[') {
      // Copy the bracket class verbatim until the matching ']'.
      let j = i + 1;
      let cls = '[';
      if (g[j] === '!' || g[j] === '^') {
        cls += '^';
        j++;
      }
      while (j < g.length && g[j] !== ']') {
        cls += g[j];
        j++;
      }
      cls += ']';
      re += cls;
      i = j; // skip to ']'
    } else {
      re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  re += '$';
  return new RegExp(re, 'i');
}

/** Split a user-entered pattern string (commas/newlines) into a clean list. */
function parsePatterns(input) {
  if (!input) return [];
  return String(input)
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Whether a filename passes the include/exclude glob filters (#3). An empty/
 * absent include list means "include everything"; any exclude match rejects.
 */
function matchesFilters(name, { include = [], exclude = [] } = {}) {
  const inc = (include || []).filter(Boolean);
  const exc = (exclude || []).filter(Boolean);
  if (inc.length && !inc.some((g) => globToRegExp(g).test(name))) return false;
  if (exc.some((g) => globToRegExp(g).test(name))) return false;
  return true;
}

/** Strip characters illegal in filenames on Windows/macOS and tidy up. */
function sanitizeFilename(name) {
  let s = String(name == null ? '' : name);
  // Illegal on Windows: \ / : * ? " < > |  (plus control chars). Replace each.
  s = s.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');
  // Collapse whitespace, trim trailing/leading spaces and dots.
  s = s.replace(/\s+/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '');
  if (!s) s = 'file';
  // Truncate to a safe length, preserving the extension.
  const MAX = 200;
  if (s.length > MAX) {
    const ext = path.extname(s);
    const stem = s.slice(0, MAX - ext.length).replace(/[\s.]+$/g, '');
    s = stem + ext;
  }
  return s;
}

/**
 * Compute the local filename for a downloaded file given a rename mode.
 *  - 'off'      keep the original remote filename
 *  - 'replace'  use the (sanitized) title + the original extension
 *  - 'append'   "<original-stem> - <title><ext>"
 */
function applyTitleToFilename(originalName, title, mode = 'off') {
  const base = path.basename(String(originalName || 'file'));
  if (mode === 'off' || !title) return sanitizeFilename(base);

  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  const safeTitle = sanitizeFilename(title).replace(/\.+$/g, '');

  if (mode === 'replace') return sanitizeFilename(safeTitle + ext);
  if (mode === 'append') return sanitizeFilename(`${stem} - ${safeTitle}${ext}`);
  return sanitizeFilename(base);
}

/**
 * Plan a download: filter by format, then compute each file's local save name.
 * @returns {Array<{name:string, size:number, saveAs:string, format:string}>}
 */
function planDownload(files, { format = 'all', rename = 'off', title = '', include = [], exclude = [] } = {}) {
  const seen = new Map(); // lowercased saveAs -> count
  return filterFilesByFormat(files, format)
    .filter((f) => matchesFilters(f.name, { include, exclude }))
    .map((f) => {
      let saveAs = applyTitleToFilename(f.name, title, rename);
      const key = saveAs.toLowerCase();
      if (seen.has(key)) {
        const n = seen.get(key) + 1;
        seen.set(key, n);
        saveAs = disambiguate(saveAs, n);
      } else {
        seen.set(key, 1);
      }
      // Carry the published checksums through so the download can be verified (#4).
      return { name: f.name, size: f.size, format: f.format, saveAs, md5: f.md5, sha1: f.sha1, crc32: f.crc32 };
    });
}

/**
 * Plan a download with graceful format fallback. Tries the requested format;
 * if it yields no files, walks the preset's fallback chain (then 'all') and
 * uses the first non-empty result, so SOMETHING downloads instead of failing
 * with "no matching files". Reports which format was actually used.
 *
 * @returns {{plan: Array, usedFormat: string, fellBack: boolean}}
 *   `plan` is empty only when the item has no real files at all.
 */
function resolveDownloadPlan(files, opts = {}) {
  const requested = opts.format || 'all';
  const preset = PRESET_BY_KEY[requested];
  const chain = [requested, ...((preset && preset.fallback) || []), 'all'];
  const tried = new Set();
  for (const fmt of chain) {
    if (tried.has(fmt)) continue;
    tried.add(fmt);
    const plan = planDownload(files, { ...opts, format: fmt });
    if (plan.length) {
      return { plan, usedFormat: fmt, fellBack: fmt !== requested };
    }
  }
  // Nothing matched anywhere (the item has no real files) — empty plan.
  return { plan: [], usedFormat: requested, fellBack: false };
}

/** Insert " (n)" before the extension to make a colliding filename unique. */
function disambiguate(name, n) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  return `${stem} (${n})${ext}`;
}

module.exports = {
  FORMAT_PRESETS,
  isRealFile,
  filterFilesByFormat,
  globToRegExp,
  matchesFilters,
  parsePatterns,
  sanitizeFilename,
  applyTitleToFilename,
  planDownload,
  resolveDownloadPlan,
};
