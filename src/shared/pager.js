'use strict';

/**
 * pager.js (shared, pure)
 *
 * Deep-paging math for archive.org's advancedsearch.php (M6). That endpoint
 * caps deep paging: `page * rows` must stay under ~10,000, so requesting beyond
 * that window returns an error or empty docs. The UI must therefore cap the
 * pager rather than offering (and failing on) tens of thousands of pages.
 *
 * Loaded both as a CommonJS module (tests/main) and as a plain <script> in the
 * renderer (attaches to window.pager).
 */

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.pager = api;
})(typeof window !== 'undefined' ? window : null, function () {
  /** advancedsearch.php's deep-paging ceiling: page*rows must stay below this. */
  const MAX_DEEP_PAGING = 10000;

  /**
   * @param {number} numFound total hits reported by the search
   * @param {number} rows results per page
   * @param {number} page the current 1-based page
   * @returns {{totalPages:number, capped:boolean, hasPrev:boolean, hasNext:boolean}}
   */
  function pagerInfo(numFound, rows, page) {
    const n = Math.max(0, Number(numFound) || 0);
    const r = Math.max(1, Number(rows) || 1);
    const p = Math.max(1, Number(page) || 1);

    const naturalPages = Math.ceil(n / r);
    const maxPages = Math.floor(MAX_DEEP_PAGING / r);
    const totalPages = Math.min(naturalPages, maxPages);
    const capped = naturalPages > maxPages;

    return {
      totalPages,
      capped,
      hasPrev: p > 1,
      hasNext: p < totalPages,
    };
  }

  return { MAX_DEEP_PAGING, pagerInfo };
});
