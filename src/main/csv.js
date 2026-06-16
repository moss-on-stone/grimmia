'use strict';

/**
 * csv.js
 *
 * A minimal RFC-4180-ish CSV parser + an upload-plan builder for bulk uploads
 * (idea #14). Pure: it only parses text and shapes a plan — it NEVER contacts
 * archive.org. The real uploads run through the existing upload pipeline, which
 * the user tests against the live server themselves.
 */

const { validateIdentifier } = require('./ipc-validate');

/**
 * Parse CSV text into an array of row objects keyed by the (trimmed) header.
 * Handles quoted fields, embedded commas/newlines, doubled-quote escapes, and
 * CRLF line endings.
 */
function parseCsv(text) {
  const rows = [];
  let field = '';
  let record = [];
  let inQuotes = false;
  const s = String(text == null ? '' : text);

  const pushField = () => {
    record.push(field);
    field = '';
  };
  const pushRecord = () => {
    pushField();
    rows.push(record);
    record = [];
  };

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      pushField();
    } else if (c === '\n') {
      pushRecord();
    } else if (c === '\r') {
      // swallow; the \n (if any) finalizes the record
    } else {
      field += c;
    }
  }
  // Final field/record if the text didn't end with a newline.
  if (field !== '' || record.length) pushRecord();

  // Drop fully-empty records (e.g. blank trailing lines).
  const nonEmpty = rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
  if (!nonEmpty.length) return [];

  const header = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((cols) => {
    const obj = {};
    header.forEach((key, idx) => {
      obj[key] = (cols[idx] == null ? '' : cols[idx]).trim();
    });
    return obj;
  });
}

// Columns that are NOT metadata (they steer the upload itself).
const CONTROL_COLUMNS = new Set(['identifier', 'file']);

/**
 * Build a per-identifier upload plan from parsed rows. Files for the same
 * identifier are grouped; metadata comes from the first row for that id.
 *
 * @param {Array<object>} rows
 * @param {{withErrors?: boolean}} [opts]
 * @returns {Array|{plan:Array, errors:string[]}} plan (or {plan, errors})
 */
function buildUploadPlan(rows, { withErrors = false } = {}) {
  const byId = new Map();
  const errors = [];

  (rows || []).forEach((row, i) => {
    const identifier = (row.identifier || '').trim();
    const file = (row.file || '').trim();
    const lineNo = i + 2; // +1 for header, +1 for 1-based

    if (!identifier || !file) {
      errors.push(`Row ${lineNo}: missing ${!identifier ? 'identifier' : 'file'}.`);
      return;
    }
    try {
      validateIdentifier(identifier);
    } catch {
      errors.push(`Row ${lineNo}: invalid identifier "${identifier}".`);
      return;
    }

    if (!byId.has(identifier)) {
      const metadata = {};
      for (const [k, v] of Object.entries(row)) {
        if (!CONTROL_COLUMNS.has(k) && String(v).trim() !== '') metadata[k] = v;
      }
      byId.set(identifier, { identifier, files: [], metadata });
    }
    byId.get(identifier).files.push(file);
  });

  const plan = [...byId.values()];
  return withErrors ? { plan, errors } : plan;
}

module.exports = { parseCsv, buildUploadPlan };
