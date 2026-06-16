'use strict';

/**
 * Red/green TDD for view/display preferences logic (pure, no DOM).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const vp = require('../src/shared/view-prefs');

/* ----------------------------- defaults ----------------------------------- */

test('DEFAULT_PREFS downloads PDF only by default (not everything)', () => {
  assert.equal(vp.DEFAULT_PREFS.format, 'pdf');
});

test('DEFAULT_PREFS uses compact (list) view and hides subjects by default (#6)', () => {
  assert.equal(vp.DEFAULT_PREFS.viewMode, 'compact');
  assert.equal(vp.DEFAULT_PREFS.showSubjects, false);
});

/* ------------------- logging / diagnostics (#1) --------------------------- */

test('DEFAULT_PREFS keeps logging OFF by default (#1)', () => {
  assert.equal(vp.DEFAULT_PREFS.logging, false);
});

/* -------------- two-dropdown download format (text vs other) -------------- */

test('DEFAULT_PREFS defaults text downloads to image PDF and other to largest', () => {
  assert.equal(vp.DEFAULT_PREFS.formatText, 'pdf');
  assert.equal(vp.DEFAULT_PREFS.formatOther, 'largest');
});

test('normalizePrefs validates formatText against the text presets', () => {
  assert.equal(vp.normalizePrefs({ formatText: 'epub' }).formatText, 'epub');
  assert.equal(vp.normalizePrefs({ formatText: 'text_pdf' }).formatText, 'text_pdf');
  assert.equal(vp.normalizePrefs({ formatText: 'largest' }).formatText, 'pdf', 'non-text choice rejected');
  assert.equal(vp.normalizePrefs({ formatText: 'bogus' }).formatText, 'pdf');
  assert.equal(vp.normalizePrefs({}).formatText, 'pdf');
});

test('normalizePrefs validates formatOther to largest|all', () => {
  assert.equal(vp.normalizePrefs({ formatOther: 'largest' }).formatOther, 'largest');
  assert.equal(vp.normalizePrefs({ formatOther: 'all' }).formatOther, 'all');
  assert.equal(vp.normalizePrefs({ formatOther: 'pdf' }).formatOther, 'largest', 'text choice rejected');
  assert.equal(vp.normalizePrefs({}).formatOther, 'largest');
});

/* ----------------------- results per page --------------------------------- */

test('DEFAULT_PREFS shows 200 results per page by default', () => {
  assert.equal(vp.DEFAULT_PREFS.perPage, 200);
});

test('PER_PAGE_OPTIONS lists the selectable page sizes', () => {
  assert.deepEqual(vp.PER_PAGE_OPTIONS, [50, 100, 200]);
});

test('normalizePrefs keeps a valid perPage and coerces strings', () => {
  assert.equal(vp.normalizePrefs({ perPage: 50 }).perPage, 50);
  assert.equal(vp.normalizePrefs({ perPage: 100 }).perPage, 100);
  assert.equal(vp.normalizePrefs({ perPage: '200' }).perPage, 200, 'numeric string coerced');
});

test('normalizePrefs falls back to 200 for an invalid/absent perPage', () => {
  assert.equal(vp.normalizePrefs({ perPage: 75 }).perPage, 200, 'off-list value rejected');
  assert.equal(vp.normalizePrefs({ perPage: 'lots' }).perPage, 200);
  assert.equal(vp.normalizePrefs({}).perPage, 200);
});

/* --------------- creator/type card toggles (#10) -------------------------- */

test('DEFAULT_PREFS shows creator and type on cards by default; coerces both (#10)', () => {
  assert.equal(vp.DEFAULT_PREFS.showCreator, true);
  assert.equal(vp.DEFAULT_PREFS.showType, true);
  assert.equal(vp.normalizePrefs({ showCreator: false }).showCreator, false);
  assert.equal(vp.normalizePrefs({ showType: 'false' }).showType, false);
  assert.equal(vp.normalizePrefs({}).showCreator, true);
  assert.equal(vp.normalizePrefs({}).showType, true);
});

test('normalizePrefs coerces logging to a boolean (#1)', () => {
  assert.equal(vp.normalizePrefs({ logging: true }).logging, true);
  assert.equal(vp.normalizePrefs({ logging: 'true' }).logging, true);
  assert.equal(vp.normalizePrefs({ logging: 'false' }).logging, false);
  assert.equal(vp.normalizePrefs({ logging: 0 }).logging, false);
  assert.equal(vp.normalizePrefs({}).logging, false);
});

/* -------- re-download vs skip existing files (same filename) -------------- */

test('DEFAULT_PREFS SKIPS already-downloaded files by default (reDownload off)', () => {
  assert.equal(vp.DEFAULT_PREFS.reDownload, false);
});

test('normalizePrefs coerces reDownload to a boolean', () => {
  assert.equal(vp.normalizePrefs({ reDownload: true }).reDownload, true);
  assert.equal(vp.normalizePrefs({ reDownload: 'true' }).reDownload, true);
  assert.equal(vp.normalizePrefs({ reDownload: 'false' }).reDownload, false);
  assert.equal(vp.normalizePrefs({ reDownload: 0 }).reDownload, false);
  assert.equal(vp.normalizePrefs({}).reDownload, false);
});

/* ------------- per-download subfolder, flat by default (#5) --------------- */

test('DEFAULT_PREFS does NOT put each download in its own subfolder (flat is default) (#5)', () => {
  assert.equal(vp.DEFAULT_PREFS.downloadSubfolders, false);
});

test('normalizePrefs coerces downloadSubfolders to a boolean (#5)', () => {
  assert.equal(vp.normalizePrefs({ downloadSubfolders: true }).downloadSubfolders, true);
  assert.equal(vp.normalizePrefs({ downloadSubfolders: 'true' }).downloadSubfolders, true);
  assert.equal(vp.normalizePrefs({ downloadSubfolders: 'false' }).downloadSubfolders, false);
  assert.equal(vp.normalizePrefs({}).downloadSubfolders, false);
});

/* --------------------- inter-download delay (#16) ------------------------- */

test('DEFAULT_PREFS waits 5 seconds between downloads by default (#16)', () => {
  assert.equal(vp.DEFAULT_PREFS.downloadDelaySec, 5);
});

test('normalizePrefs clamps downloadDelaySec to an integer in 0..99 (#16)', () => {
  assert.equal(vp.normalizePrefs({ downloadDelaySec: 0 }).downloadDelaySec, 0);
  assert.equal(vp.normalizePrefs({ downloadDelaySec: 99 }).downloadDelaySec, 99);
  assert.equal(vp.normalizePrefs({ downloadDelaySec: 7 }).downloadDelaySec, 7);
  assert.equal(vp.normalizePrefs({ downloadDelaySec: '12' }).downloadDelaySec, 12, 'string coerced');
  assert.equal(vp.normalizePrefs({ downloadDelaySec: 3.7 }).downloadDelaySec, 3, 'truncated to int');
  assert.equal(vp.normalizePrefs({ downloadDelaySec: -4 }).downloadDelaySec, 0, 'clamped low');
  assert.equal(vp.normalizePrefs({ downloadDelaySec: 250 }).downloadDelaySec, 99, 'clamped high');
  assert.equal(vp.normalizePrefs({ downloadDelaySec: 'nope' }).downloadDelaySec, 5, 'invalid → default');
  assert.equal(vp.normalizePrefs({}).downloadDelaySec, 5);
});

test('DEFAULT_PREFS renames downloads to the item title by default (collision-safe)', () => {
  assert.equal(vp.DEFAULT_PREFS.rename, 'replace');
});

test('DEFAULT_PREFS density defaults to "cozy" and normalizePrefs validates it (#4)', () => {
  assert.equal(vp.DEFAULT_PREFS.density, 'cozy');
  assert.deepEqual(vp.DENSITIES, ['comfortable', 'cozy', 'compact']);
  assert.equal(vp.normalizePrefs({ density: 'compact' }).density, 'compact');
  assert.equal(vp.normalizePrefs({ density: 'bogus' }).density, 'cozy');
});

test('DEFAULT_PREFS preserves last-upload metadata by default; normalizePrefs coerces it', () => {
  assert.equal(vp.DEFAULT_PREFS.preserveUploadMeta, true);
  assert.equal(vp.normalizePrefs({ preserveUploadMeta: false }).preserveUploadMeta, false);
  assert.equal(vp.normalizePrefs({ preserveUploadMeta: 'false' }).preserveUploadMeta, false);
  assert.equal(vp.normalizePrefs({}).preserveUploadMeta, true);
});

test('normalizePrefs fills missing keys from defaults', () => {
  const p = vp.normalizePrefs({ format: 'text_pdf' });
  assert.equal(p.format, 'text_pdf'); // kept
  assert.equal(p.viewMode, 'compact'); // defaulted (#6)
  assert.equal(p.showSubjects, false); // defaulted
});

test('normalizePrefs rejects invalid viewMode, falling back to the default (compact)', () => {
  assert.equal(vp.normalizePrefs({ viewMode: 'bogus' }).viewMode, 'compact');
  assert.equal(vp.normalizePrefs({ viewMode: 'grid' }).viewMode, 'grid');
});

test('normalizePrefs coerces showSubjects to a boolean', () => {
  assert.equal(vp.normalizePrefs({ showSubjects: 'yes' }).showSubjects, true);
  assert.equal(vp.normalizePrefs({ showSubjects: 0 }).showSubjects, false);
});

/* ------------------------------- theme (#17) ------------------------------ */

test('DEFAULT_PREFS theme is "system"', () => {
  assert.equal(vp.DEFAULT_PREFS.theme, 'system');
});

test('THEMES lists the user-selectable options', () => {
  assert.deepEqual(vp.THEMES, ['system', 'light', 'dark']);
});

test('normalizePrefs keeps a valid theme and rejects an invalid one', () => {
  assert.equal(vp.normalizePrefs({ theme: 'light' }).theme, 'light');
  assert.equal(vp.normalizePrefs({ theme: 'dark' }).theme, 'dark');
  assert.equal(vp.normalizePrefs({ theme: 'neon' }).theme, 'system');
});

test('resolveTheme maps explicit light/dark through unchanged', () => {
  assert.equal(vp.resolveTheme('light', true), 'light');
  assert.equal(vp.resolveTheme('dark', false), 'dark');
});

test('resolveTheme("system") follows the OS preference', () => {
  assert.equal(vp.resolveTheme('system', true), 'dark', 'system + prefers-dark → dark');
  assert.equal(vp.resolveTheme('system', false), 'light', 'system + prefers-light → light');
});

test('resolveTheme defaults to dark for unknown/missing input', () => {
  assert.equal(vp.resolveTheme(undefined, false), 'dark');
  assert.equal(vp.resolveTheme('bogus', false), 'dark');
});

/* --------------------------- thumbnail URL -------------------------------- */

test('thumbnailUrl builds the services/img URL', () => {
  assert.equal(
    vp.thumbnailUrl('my-item'),
    'https://archive.org/services/img/my-item'
  );
});

test('thumbnailUrl encodes the identifier', () => {
  assert.equal(
    vp.thumbnailUrl('a b/c'),
    'https://archive.org/services/img/a%20b%2Fc'
  );
});

/* ----------------------------- subjects ----------------------------------- */

test('toSubjectList splits a string on commas/semicolons', () => {
  assert.deepEqual(vp.toSubjectList('history; war, 1945'), ['history', 'war', '1945']);
});

test('toSubjectList flattens an array and trims', () => {
  assert.deepEqual(vp.toSubjectList([' a ', 'b', '']), ['a', 'b']);
});

test('toSubjectList returns [] for empty/undefined', () => {
  assert.deepEqual(vp.toSubjectList(undefined), []);
  assert.deepEqual(vp.toSubjectList(''), []);
});

test('toSubjectList caps the number of tags returned', () => {
  const many = Array.from({ length: 30 }, (_, i) => `t${i}`);
  const out = vp.toSubjectList(many, 8);
  assert.equal(out.length, 8);
});

/* ------------------------------ showThumbs -------------------------------- */

test('shouldShowThumbs is true only for grid view', () => {
  assert.equal(vp.shouldShowThumbs('grid'), true);
  assert.equal(vp.shouldShowThumbs('compact'), false);
});

/* --------------------- no global-scope leakage (regression) -------------- */
// view-prefs.js is loaded as a plain <script> alongside renderer.js, which
// declares `const { thumbnailUrl, ... } = viewPrefs`. If view-prefs declared
// those names at top level too, classic scripts share global scope and the
// page throws "Identifier 'thumbnailUrl' has already been declared", breaking
// the whole renderer. So the source must be IIFE-wrapped — no bare top-level
// `function thumbnailUrl` / `const DEFAULT_PREFS` etc.
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'view-prefs.js'), 'utf8');

test('view-prefs.js does not declare helpers at top level (must be IIFE-wrapped)', () => {
  for (const name of ['thumbnailUrl', 'toSubjectList', 'shouldShowThumbs', 'normalizePrefs']) {
    assert.ok(
      !new RegExp(`^function ${name}\\b`, 'm').test(src),
      `top-level "function ${name}" leaks into global scope and collides with renderer.js`
    );
  }
  for (const name of ['DEFAULT_PREFS', 'VIEW_MODES']) {
    assert.ok(
      !new RegExp(`^const ${name}\\b`, 'm').test(src),
      `top-level "const ${name}" leaks into global scope`
    );
  }
});
