'use strict';

/**
 * sort-docs.js (shared, pure)
 *
 * Client-side sorting of search result docs for the compact list view (#10).
 * Sorts an already-fetched page in the renderer — no extra network request.
 *
 * Loaded as a CommonJS module (tests) and as a plain <script> (window.sortDocs).
 */

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.sortDocsApi = api;
})(typeof window !== 'undefined' ? window : null, function () {
  // Which keys sort numerically vs. as text.
  const NUMERIC = new Set(['downloads', 'item_size']);
  const SORT_KEYS = ['title', 'date', 'downloads', 'item_size', 'mediatype'];

  /** First element of an array field, or the value itself, or ''. */
  function first(v) {
    if (Array.isArray(v)) return v.length ? v[0] : '';
    return v == null ? '' : v;
  }

  /**
   * Return a NEW array of `docs` sorted by `key` in `dir` ('asc'|'desc').
   * Unknown keys return a shallow copy unchanged. Stable and non-mutating.
   */
  function sortDocs(docs, key, dir = 'asc') {
    const arr = (docs || []).slice();
    if (!SORT_KEYS.includes(key)) return arr;
    const sign = dir === 'desc' ? -1 : 1;
    const numeric = NUMERIC.has(key);

    // Decorate-sort-undecorate keeps it stable and avoids recomputing `first`.
    return arr
      .map((doc, i) => ({ doc, i, v: first(doc[key]) }))
      .sort((a, b) => {
        let cmp;
        if (numeric) {
          cmp = (Number(a.v) || 0) - (Number(b.v) || 0);
        } else {
          cmp = String(a.v).toLowerCase().localeCompare(String(b.v).toLowerCase());
        }
        // Apply direction to the primary comparison only; the index tiebreak
        // stays ascending so equal elements keep their original order (stable).
        if (cmp !== 0) return cmp * sign;
        return a.i - b.i;
      })
      .map((x) => x.doc);
  }

  return { sortDocs, SORT_KEYS };
});
