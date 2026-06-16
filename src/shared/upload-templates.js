'use strict';

/**
 * upload-templates.js (shared, pure)
 *
 * Reusable upload metadata templates + drop-file normalization (#15).
 * Templates store default metadata (creator, mediatype, subjects, …) so repeat
 * uploaders don't retype them; applying a template fills only the BLANK form
 * fields. CommonJS (tests/main) and plain <script> (window.uploadTemplates).
 */

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.uploadTemplates = api;
})(typeof window !== 'undefined' ? window : null, function () {
  /** Add or replace a named template (unique by name). Non-mutating. */
  function addTemplate(list, template) {
    const without = (list || []).filter((t) => t.name !== template.name);
    return [...without, template];
  }

  function removeTemplate(list, name) {
    return (list || []).filter((t) => t.name !== name);
  }

  function isBlank(v) {
    return v == null || String(v).trim() === '';
  }

  /**
   * Apply a template to a form object, filling only the fields the user left
   * blank. Returns a NEW form object (does not mutate the input).
   */
  function applyTemplate(template, form) {
    const fields = (template && template.fields) || {};
    const out = { ...(form || {}) };
    for (const [k, v] of Object.entries(fields)) {
      if (isBlank(out[k]) && !isBlank(v)) out[k] = v;
    }
    return out;
  }

  /** Basename of a path (handles both separators). */
  function basename(p) {
    return String(p).split(/[\\/]/).filter(Boolean).pop() || String(p);
  }

  /**
   * Normalize dropped File-like objects into {path, name, size}. Entries without
   * a filesystem path (e.g. a dragged URL) are skipped; the name falls back to
   * the path's basename.
   */
  function extractDroppedFiles(files) {
    const out = [];
    for (const f of files || []) {
      if (!f || !f.path) continue;
      out.push({ path: f.path, name: f.name || basename(f.path), size: Number(f.size) || 0 });
    }
    return out;
  }

  /** Strip the final extension from a filename (keeps earlier dots). */
  function stripExt(name) {
    const base = basename(name);
    const dot = base.lastIndexOf('.');
    // No extension, or a dotfile like ".bashrc" → keep as-is.
    return dot > 0 ? base.slice(0, dot) : base;
  }

  /** Default upload title: the filename without its extension. */
  function deriveTitleFromFilename(name) {
    return stripExt(name).trim();
  }

  /**
   * Default upload identifier from a filename (req #2). Lowercased, extension
   * removed, spaces → '-'. Allowed IA identifier chars (a-z 0-9 . _ -) are kept;
   * non-Roman characters become 'u<hex codepoint>' (e.g. 日 → u65e5); other
   * ASCII punctuation is dropped. Runs of identical separators collapse and
   * leading/trailing separators are trimmed. Falls back to 'item' if empty.
   */
  function deriveIdentifierFromFilename(name) {
    const stem = stripExt(name);
    let out = '';
    // Iterate by code point so astral chars (emoji) are handled as one unit.
    for (const ch of stem) {
      const cp = ch.codePointAt(0);
      if (/\s/.test(ch)) out += '-';
      else if (/[a-zA-Z0-9._-]/.test(ch)) out += ch.toLowerCase();
      else if (cp > 127) out += 'u' + cp.toString(16); // non-Roman → u<hex>
      // else: ASCII punctuation → dropped
    }
    // Collapse runs of the SAME separator (-- → -, __ → _), and trim separators.
    out = out
      .replace(/-{2,}/g, '-')
      .replace(/_{2,}/g, '_')
      .replace(/\.{2,}/g, '.')
      .replace(/^[-_.]+|[-_.]+$/g, '');
    return out || 'item';
  }

  /**
   * Compute the upload form state for the NEXT upload after one starts (req #5).
   * The file, identifier, and title ALWAYS reset (each item is distinct). The
   * remaining metadata (creator/date/mediatype/description/subjects) is kept when
   * `preserve` is true, else reset — mediatype falls back to 'texts' (its select
   * default) rather than blank. Pure; the renderer applies the result to inputs.
   */
  function nextUploadForm(prev, preserve) {
    const p = prev || {};
    const base = { identifier: '', title: '' };
    if (preserve) {
      return {
        ...base,
        creator: p.creator || '',
        date: p.date || '',
        mediatype: p.mediatype || 'texts',
        language: p.language || '',
        description: p.description || '',
        subjects: p.subjects || '',
      };
    }
    return { ...base, creator: '', date: '', mediatype: 'texts', language: '', description: '', subjects: '' };
  }

  return {
    addTemplate,
    removeTemplate,
    applyTemplate,
    extractDroppedFiles,
    deriveTitleFromFilename,
    deriveIdentifierFromFilename,
    nextUploadForm,
  };
});
