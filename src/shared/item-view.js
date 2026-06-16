'use strict';

/**
 * item-view.js (shared, pure)
 *
 * Presentation helpers for the rich item modal (#12): a file-type summary,
 * a curated/ordered field list, and "more from…" related links — all derived
 * from metadata already fetched.
 *
 * CommonJS (tests) and plain <script> (window.itemView).
 */

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.itemView = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const HOST = 'archive.org';

  /** Minimal "is this a real, user-facing file" check (mirrors download-prefs). */
  function isRealFile(f) {
    if (!f || !f.name) return false;
    if (f.source === 'metadata') return false;
    const n = String(f.name).toLowerCase();
    if (n === '__ia_thumb.jpg' || n.endsWith('_meta.xml') || n.endsWith('_files.xml')) return false;
    if (n.endsWith('_meta.sqlite') || n.endsWith('_reviews.xml') || n === 'history') return false;
    const fmt = String(f.format || '').toLowerCase();
    if (fmt === 'metadata' || fmt === 'thumbnail' || fmt === 'item tile' || fmt === 'json') return false;
    return true;
  }

  /** Whether this item is itself a collection (its "files" are just its logo). */
  function isCollection(metadata) {
    const mt = metadata && metadata.mediatype;
    const v = Array.isArray(mt) ? mt[0] : mt;
    return String(v || '').toLowerCase() === 'collection';
  }

  function extOf(name) {
    const m = /\.([a-z0-9]+)$/i.exec(String(name));
    return m ? m[1].toLowerCase() : '(none)';
  }

  /**
   * Group real files by extension with a count and total bytes, sorted by count
   * desc then extension asc.
   * @returns {Array<{ext:string, count:number, bytes:number}>}
   */
  function fileTypeSummary(files) {
    const groups = new Map();
    for (const f of (files || []).filter(isRealFile)) {
      const ext = extOf(f.name);
      const g = groups.get(ext) || { ext, count: 0, bytes: 0 };
      g.count += 1;
      g.bytes += Number(f.size) || 0;
      groups.set(ext, g);
    }
    return [...groups.values()].sort((a, b) => b.count - a.count || a.ext.localeCompare(b.ext));
  }

  // High-value fields to surface, in display order.
  const CURATED_ORDER = [
    'creator',
    'date',
    'publisher',
    'language',
    'subject',
    'collection',
    'licenseurl',
    'identifier',
  ];
  const LABELS = {
    creator: 'Creator',
    date: 'Date',
    publisher: 'Publisher',
    language: 'Language',
    subject: 'Subjects',
    collection: 'Collection',
    licenseurl: 'License',
    identifier: 'Identifier',
  };

  function isBlank(v) {
    if (v == null) return true;
    if (Array.isArray(v)) return v.length === 0;
    return String(v).trim() === '';
  }

  /**
   * Pick the curated fields present in `metadata`, in display order.
   * @returns {Array<{key:string, label:string, value:string}>}
   */
  function curatedFields(metadata) {
    const md = metadata || {};
    const out = [];
    for (const key of CURATED_ORDER) {
      const raw = md[key];
      if (isBlank(raw)) continue;
      out.push({
        key,
        label: LABELS[key] || key,
        value: Array.isArray(raw) ? raw.join(', ') : String(raw),
      });
    }
    return out;
  }

  /**
   * "More from…" links for the creator and each collection.
   * @returns {Array<{kind:string, label:string, url:string}>}
   */
  function relatedLinks(metadata) {
    const md = metadata || {};
    const links = [];
    const creator = Array.isArray(md.creator) ? md.creator[0] : md.creator;
    if (creator && String(creator).trim()) {
      const q = `creator:("${String(creator).replace(/"/g, '')}")`;
      links.push({
        kind: 'creator',
        label: `More by ${creator}`,
        url: `https://${HOST}/search?query=${encodeURIComponent(q)}`,
      });
    }
    const collections = md.collection == null ? [] : Array.isArray(md.collection) ? md.collection : [md.collection];
    for (const c of collections) {
      if (!c || !String(c).trim()) continue;
      links.push({
        kind: 'collection',
        label: `Collection: ${c}`,
        url: `https://${HOST}/details/${encodeURIComponent(c)}`,
      });
    }
    return links;
  }

  /**
   * In-app "more from…" SEARCHES (#13) — same intent as relatedLinks but they
   * run an advanced search INSIDE the app rather than opening archive.org. The
   * renderer turns each `search` descriptor into an in-app query.
   * @returns {Array<{kind:string, label:string, search:object}>}
   */
  function relatedSearches(metadata) {
    const md = metadata || {};
    const out = [];
    const creator = Array.isArray(md.creator) ? md.creator[0] : md.creator;
    if (creator && String(creator).trim()) {
      out.push({
        kind: 'creator',
        label: `More by ${creator}`,
        search: { type: 'advanced', fields: { creator: String(creator).trim() } },
      });
    }
    const collections = md.collection == null ? [] : Array.isArray(md.collection) ? md.collection : [md.collection];
    for (const c of collections) {
      if (!c || !String(c).trim()) continue;
      out.push({
        kind: 'collection',
        label: `Collection: ${c}`,
        search: { type: 'advanced', fields: { collection: String(c).trim() } },
      });
    }
    return out;
  }

  /**
   * Whether the logged-in account may edit this item (#12). True only when the
   * item's `uploader` matches the account's screenname or email (case-
   * insensitive, trimmed). Gates the Edit-metadata and Tasks actions so they're
   * only offered on items the user actually owns.
   *
   * @param {object} metadata item metadata (with an `uploader` field)
   * @param {{screenname?:string, email?:string}|null} account the logged-in account
   */
  function canEditItem(metadata, account) {
    if (!metadata || !account) return false;
    const rawUploader = Array.isArray(metadata.uploader) ? metadata.uploader[0] : metadata.uploader;
    const uploader = String(rawUploader || '').trim().toLowerCase();
    if (!uploader) return false;
    const ids = [account.screenname, account.email]
      .map((v) => String(v || '').trim().toLowerCase())
      .filter(Boolean);
    return ids.includes(uploader);
  }

  return { isRealFile, isCollection, fileTypeSummary, curatedFields, relatedLinks, relatedSearches, canEditItem };
});
