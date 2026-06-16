'use strict';

/**
 * view-prefs.js
 *
 * Pure logic for display/download preferences and result-rendering decisions.
 * No DOM, no Electron — fully unit-testable. Wrapped in an IIFE so that, when
 * loaded as a plain <script>, its internals don't leak into the global scope
 * (only `window.viewPrefs` is exposed); also works as a CommonJS module.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.viewPrefs = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const HOST = 'archive.org';

  /** Default preferences. Download defaults to PDF only (not everything). */
  const DEFAULT_PREFS = Object.freeze({
    format: 'pdf', // download format preset key
    rename: 'replace', // filename rename mode — default to the item title (collision-safe)
    viewMode: 'compact', // 'grid' | 'compact' — default to the compact list (no previews) (#6)
    showSubjects: false, // show subject tags on result cards
    theme: 'system', // 'system' | 'light' | 'dark' (#17)
    density: 'cozy', // 'comfortable' | 'cozy' | 'compact' — result row size (#4)
    preserveUploadMeta: true, // keep metadata fields between uploads
    showCreator: true, // show the creator on result cards (#10)
    showType: true, // show the media type on result cards (#10)
    perPage: 200, // results per page (50/100/200) — default to the largest
    logging: false, // diagnostics/logging OFF by default (#1)
    downloadSubfolders: false, // a folder per downloaded item? off = flat into the download folder (#5)
    downloadDelaySec: 5, // seconds to wait between downloading items, 0..99 (#16)
  });

  const DELAY_MIN = 0;
  const DELAY_MAX = 99;

  /** Coerce a "truthy string"-aware boolean: 'false'/'0' → false, else Boolean(). */
  function coerceBool(v) {
    return Boolean(v === 'false' || v === '0' ? false : v);
  }

  /** Clamp the inter-download delay to an integer in [0, 99]; invalid → default. */
  function clampDelay(v) {
    const n = Math.trunc(Number(v));
    if (!Number.isFinite(n)) return DEFAULT_PREFS.downloadDelaySec;
    return Math.min(DELAY_MAX, Math.max(DELAY_MIN, n));
  }

  const VIEW_MODES = ['grid', 'compact'];
  const THEMES = ['system', 'light', 'dark'];
  const DENSITIES = ['comfortable', 'cozy', 'compact'];
  const PER_PAGE_OPTIONS = [50, 100, 200];

  /** Merge a partial prefs object onto the defaults, validating values. */
  function normalizePrefs(p = {}) {
    const out = { ...DEFAULT_PREFS, ...(p || {}) };
    if (!VIEW_MODES.includes(out.viewMode)) out.viewMode = DEFAULT_PREFS.viewMode;
    if (!THEMES.includes(out.theme)) out.theme = DEFAULT_PREFS.theme;
    if (!DENSITIES.includes(out.density)) out.density = DEFAULT_PREFS.density;
    out.showSubjects = coerceBool(out.showSubjects);
    out.showCreator = coerceBool(out.showCreator); // (#10)
    out.showType = coerceBool(out.showType); // (#10)
    out.preserveUploadMeta = coerceBool(out.preserveUploadMeta);
    out.logging = coerceBool(out.logging); // (#1)
    out.downloadSubfolders = coerceBool(out.downloadSubfolders); // (#5)
    out.downloadDelaySec = clampDelay(out.downloadDelaySec); // (#16)
    out.perPage = PER_PAGE_OPTIONS.includes(Number(out.perPage)) ? Number(out.perPage) : DEFAULT_PREFS.perPage;
    return out;
  }

  /**
   * Resolve a theme setting to a concrete 'light' | 'dark' (#17). 'system'
   * follows the OS preference (systemPrefersDark); explicit values pass through;
   * anything unknown falls back to 'dark'.
   */
  function resolveTheme(setting, systemPrefersDark) {
    if (setting === 'light' || setting === 'dark') return setting;
    if (setting === 'system') return systemPrefersDark ? 'dark' : 'light';
    return 'dark';
  }

  /** archive.org thumbnail service URL for an item. */
  function thumbnailUrl(identifier) {
    return `https://${HOST}/services/img/${encodeURIComponent(identifier)}`;
  }

  /**
   * Normalize a metadata `subject` (string or array) into a trimmed tag list,
   * optionally capped to `max` tags.
   */
  function toSubjectList(subject, max = Infinity) {
    let list = [];
    if (Array.isArray(subject)) {
      list = subject;
    } else if (typeof subject === 'string') {
      list = subject.split(/[;,]/);
    }
    const out = list.map((s) => String(s).trim()).filter(Boolean);
    return Number.isFinite(max) ? out.slice(0, max) : out;
  }

  /** Whether thumbnails should be rendered for a given view mode. */
  function shouldShowThumbs(viewMode) {
    return viewMode === 'grid';
  }

  return {
    DEFAULT_PREFS,
    VIEW_MODES,
    THEMES,
    DENSITIES,
    PER_PAGE_OPTIONS,
    normalizePrefs,
    resolveTheme,
    thumbnailUrl,
    toSubjectList,
    shouldShowThumbs,
  };
});
