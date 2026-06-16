'use strict';

/**
 * json-patch.js
 *
 * Build an RFC 6902 JSON Patch from a metadata edit, and normalize archive.org
 * task status (idea #16). Pure: no network. The real metadata write goes through
 * ia-client.modifyMetadata (auth fixed in M1); the user tests live edits.
 */

/** Escape a field name for a JSON Pointer path segment (~→~0, /→~1). */
function escapePointer(token) {
  return String(token).replace(/~/g, '~0').replace(/\//g, '~1');
}

/** Stable comparison of two metadata values (handles arrays/objects). */
function sameValue(a, b) {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

function isEmpty(v) {
  return v == null || v === '' || (Array.isArray(v) && v.length === 0);
}

/**
 * Diff `original` → `edited` into a JSON-Patch array.
 *  - present→changed  : replace
 *  - absent/empty→set : add
 *  - present→empty    : remove
 */
function buildMetadataPatch(original, edited) {
  const orig = original || {};
  const next = edited || {};
  const patch = [];
  const keys = new Set([...Object.keys(orig), ...Object.keys(next)]);

  for (const key of keys) {
    const before = orig[key];
    const after = next[key];
    const path = `/${escapePointer(key)}`;

    if (sameValue(before, after)) continue;
    if (isEmpty(after) && !isEmpty(before)) {
      patch.push({ op: 'remove', path });
    } else if (isEmpty(before) && !isEmpty(after)) {
      patch.push({ op: 'add', path, value: after });
    } else if (!isEmpty(after)) {
      patch.push({ op: 'replace', path, value: after });
    }
  }
  return patch;
}

/**
 * Normalize archive.org's catalog/tasks response into a flat task list.
 * Accepts the `{ value: { catalog: [...], history: [...] } }` shape.
 */
function parseTasks(json) {
  const value = (json && json.value) || {};
  const rows = [...(value.catalog || []), ...(value.history || [])];
  return rows.map((r) => ({
    taskId: r.task_id != null ? r.task_id : r.id,
    status: r.status || '',
    op: r.cmd || r.op || '',
    server: r.server || '',
    args: r.args || {},
  }));
}

module.exports = { escapePointer, buildMetadataPatch, parseTasks };
