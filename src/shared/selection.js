'use strict';

/**
 * selection.js (shared, pure)
 *
 * Small helpers for result selection, live title filtering, and page jumping.
 * No DOM. CommonJS (tests) + plain <script> (window.selectionUtil).
 */

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.selectionUtil = api;
})(typeof window !== 'undefined' ? window : null, function () {
  /** Inclusive index range between two indices, ascending regardless of order (#3). */
  function rangeIndices(from, to) {
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const out = [];
    for (let i = lo; i <= hi; i++) out.push(i);
    return out;
  }

  function firstStr(v) {
    if (Array.isArray(v)) return v.length ? String(v[0]) : '';
    return v == null ? '' : String(v);
  }

  /** Live title-filter predicate (#10): case-insensitive substring on title/id. */
  function titleMatches(doc, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    const hay = (firstStr(doc && doc.title) || firstStr(doc && doc.identifier)).toLowerCase();
    return hay.includes(q);
  }

  /**
   * Validate a typed page number against the available page count (#7).
   * @returns {number|null} a page in [1, total], or null if not a number.
   */
  function clampJumpPage(input, total) {
    const n = parseInt(String(input).trim(), 10);
    if (!Number.isFinite(n)) return null;
    return Math.max(1, Math.min(Number(total) || 1, n));
  }

  /**
   * Sanitize a typed year field. Keeps a 4-digit YYYY year and an OPTIONAL
   * `-MM` / `-M` month suffix (#11), so the user can type `1940`, `1940-9`, or
   * `1940-09` — but not letters, stray punctuation, or anything longer. The
   * visual YYYY input is unchanged; this just tolerates a month. The month is
   * expanded to a full date later (see ia-query.normalizeDateBound).
   */
  function sanitizeYearInput(raw) {
    const s = String(raw == null ? '' : raw);
    // Split into the digits before the first hyphen (year) and after (month).
    const hyphen = s.indexOf('-');
    if (hyphen < 0) {
      return s.replace(/\D+/g, '').slice(0, 4);
    }
    const year = s.slice(0, hyphen).replace(/\D+/g, '').slice(0, 4);
    // Month is the leading digits right after the hyphen (stop at the next
    // non-digit so "9-3" doesn't become "93"), capped at two digits.
    const month = (/^\d{0,2}/.exec(s.slice(hyphen + 1).replace(/^\D+/, '')) || [''])[0];
    // A leading hyphen (no year before it) is meaningless — drop it.
    if (!year) return month;
    return `${year}-${month}`;
  }

  /**
   * Decide the selection-bar affordances from the current selection count and
   * the number of items on the visible page. Pure so the renderer's button
   * states stay testable.
   *  - label:            the "N selected" text
   *  - canDeselect:      whether the "Deselect all" control should be enabled
   *  - allOnPageSelected: whether every item on this page is selected (drives the
   *                       "Select all on page" checkbox)
   */
  function selectionSummary(selectedCount, pageCount) {
    const n = Number(selectedCount) || 0;
    const page = Number(pageCount) || 0;
    return {
      label: `${n} selected`,
      canDeselect: n > 0,
      allOnPageSelected: page > 0 && n >= page,
    };
  }

  /**
   * Translate a drag-drop within a transfer section into a target index in the
   * WAITING queue. `draggedId` is the job being moved; `beforeId` is the job it
   * was dropped immediately before (null/undefined = dropped at the end);
   * `waiting` is the current ordered list of waiting job ids (the active job is
   * NOT in this list). Returns the new index for move(), or null when the drop
   * is a no-op (unknown id, dropped onto itself, or already in that slot).
   */
  function queueDropTarget(draggedId, beforeId, waiting) {
    const list = Array.isArray(waiting) ? waiting : [];
    const from = list.indexOf(draggedId);
    if (from < 0) return null; // unknown dragged id
    if (draggedId === beforeId) return null; // dropped onto itself
    const without = list.slice(0, from).concat(list.slice(from + 1));
    let to;
    if (beforeId == null) {
      to = without.length; // dropped at the end
    } else {
      const idx = without.indexOf(beforeId);
      if (idx < 0) return null; // anchor not found
      to = idx;
    }
    if (to === from) return null; // no movement
    return to;
  }

  return {
    rangeIndices,
    titleMatches,
    clampJumpPage,
    sanitizeYearInput,
    selectionSummary,
    queueDropTarget,
  };
});
