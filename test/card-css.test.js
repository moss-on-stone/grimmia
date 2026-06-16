'use strict';

/**
 * Red/green TDD (CSS-assertion style) for the result-card polish fixes:
 *  - #1 grid thumbnails are darkened by default and brighten on hover
 *  - #4 in compact/list view the favorite star is NOT pinned to the right edge
 *    (where it overlapped the Download button) — it moves to the left
 *  - #5 the compact row gives space between the checkbox and the mediatype/title
 *
 * Guards the shipped stylesheet so these can't silently regress.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');

test('#1/#2 grid thumbnail is strongly dimmed by default (<= 0.6 brightness)', () => {
  const m = css.match(/\.card\s+\.thumb-img\s*\{[^}]*brightness\(([\d.]+)\)/);
  assert.ok(m, 'expected .thumb-img brightness()');
  assert.ok(Number(m[1]) <= 0.6, `brightness should be <= 0.6 for readability, got ${m[1]}`);
});

test('#1 select controls have extra right padding so the caret isn\'t crowded', () => {
  assert.match(
    css,
    /select\s*\{[^}]*padding-right\s*:/,
    'expected select to set padding-right for the dropdown caret'
  );
});

test('#1 grid thumbnail returns to full brightness on card hover', () => {
  assert.match(
    css,
    /\.card:hover\s+\.thumb-img\s*\{[^}]*(brightness\(1\)|filter\s*:\s*none|opacity\s*:\s*1)/,
    'expected .card:hover .thumb-img to brighten'
  );
});

test('#6 the favorite star is an INLINE button, never absolutely positioned (no overlap)', () => {
  const m = css.match(/(?:^|\n)\.fav-star\s*\{([^}]*)\}/);
  assert.ok(m, 'expected a .fav-star rule');
  assert.ok(!/position\s*:\s*absolute/.test(m[1]), 'the star must NOT be absolutely positioned');
  assert.ok(!/top\s*:/.test(m[1]) && !/right\s*:/.test(m[1]), 'the star must not be pinned to an edge');
});

test('#6 the renderer puts the star inside the .actions row (before Details/Download)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'renderer.js'), 'utf8');
  // The actions array should contain favStar(...) alongside the Details/Download buttons.
  assert.match(
    src,
    /class:\s*'actions'\s*\},\s*\[\s*\n\s*favStar\(/,
    'favStar(...) should be the first child of the .actions row'
  );
});

test('el() sets boolean attrs (checked/hidden/disabled) as PROPERTIES, not attributes', () => {
  // Guards the bug where checked:false still checked the box because
  // setAttribute("checked", false) makes the attribute present.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'renderer.js'), 'utf8');
  assert.match(src, /BOOL_PROPS\s*=\s*new Set\(\[[^\]]*'checked'/, 'checked must be in BOOL_PROPS');
  assert.match(src, /BOOL_PROPS\.has\(k\)\)\s*node\[k\]\s*=\s*Boolean\(v\)/, 'bool props set via node[k]=Boolean(v)');
});

test('#5 compact row spaces the mediatype label from the title', () => {
  // The compact body gap is widened OR the mt label has right margin.
  assert.match(
    css,
    /\.results\.compact\s+\.mt\s*\{[^}]*margin/,
    'expected the compact mediatype label to have margin for spacing'
  );
});

/* ----- this batch: year input, subjects-below, no blue ring, smaller bar ----- */

test('year inputs hide the native number spinner', () => {
  assert.match(
    css,
    /\.year-input::-webkit-(?:inner|outer)-spin-button\s*\{[^}]*appearance\s*:\s*none/,
    'expected the year input spin buttons to be hidden'
  );
});

test('year inputs use a smaller font inside the field', () => {
  const m = css.match(/\.search-bar\s+\.year-input\s*\{([^}]*)\}/);
  assert.ok(m, 'expected a .search-bar .year-input rule');
  assert.match(m[1], /font-size\s*:/, 'year input should set a (smaller) font-size');
});

test('compact subject tags drop onto their own line below the title (full body width)', () => {
  const m = css.match(/\.results\.compact\s+\.subjects\s*\{([^}]*)\}/);
  assert.ok(m, 'expected a .results.compact .subjects rule');
  assert.match(
    m[1],
    /flex\s*:\s*0\s+0\s+100%|flex-basis\s*:\s*100%/,
    'compact subjects must take the full body width so they sit below the title'
  );
});

test('#4 a selected card does NOT get a full blue ring/border', () => {
  const m = css.match(/(?:^|\n)\.card\.selected\s*\{([^}]*)\}/);
  assert.ok(m, 'expected a .card.selected rule');
  assert.ok(
    !/box-shadow\s*:\s*0\s+0\s+0\s+1px\s+var\(--accent\)/.test(m[1]),
    'selected card must not have a 0 0 0 1px accent ring'
  );
  assert.ok(
    !/border-color\s*:\s*var\(--accent\)/.test(m[1]),
    'selected card must not set an accent border-color'
  );
});

test('#6 the select-all label is rendered in a smaller font', () => {
  assert.match(
    css,
    /\.select-bar\s+\.select-all-lbl\s*\{[^}]*font-size\s*:/,
    'expected the select-all label to have a (smaller) font-size'
  );
});

test('a Deselect-all button exists in the selection bar and is wired up', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  assert.match(html, /id="deselect-all"/, 'expected a #deselect-all button in the markup');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'renderer.js'), 'utf8');
  assert.match(src, /#deselect-all'\)\.addEventListener/, 'deselect-all must be wired up');
});

/* ---------------- this batch: star centering, facet panel, hits ----------- */

test('#8 the favorite star is centered via flex (not just line-height)', () => {
  const m = css.match(/(?:^|\n)\.fav-star\s*\{([^}]*)\}/);
  assert.ok(m, 'expected a .fav-star rule');
  assert.match(m[1], /display\s*:\s*(inline-)?flex/, 'star button should be a flex box');
  assert.match(m[1], /align-items\s*:\s*center/, 'star should be vertically centered');
  assert.match(m[1], /justify-content\s*:\s*center/, 'star should be horizontally centered');
});

test('#20 the facet panel can grow to the full available height on large windows', () => {
  // The panel should stretch with its flex row (align-self: stretch) and cap its
  // height to the viewport rather than a fixed small max — so on a tall window
  // the SUBJECT/COLLECTION lists fill the space instead of leaving a big gap.
  const rules = css.match(/\.facets\s*\{[^}]*\}/g) || [];
  const joined = rules.join(' ');
  assert.match(joined, /align-self\s*:\s*stretch/, 'facets should stretch to the row height');
  // max-height must be driven by the viewport (a calc or vh), not a tiny fixed px.
  assert.match(joined, /max-height\s*:\s*[^;]*(vh|calc)/, 'facets max-height should track the viewport');
});

test('#21 the facet section headings use a tighter top margin (more compact)', () => {
  const m = css.match(/\.facets\s+\.facet-h\s*\{([^}]*)\}/);
  assert.ok(m, 'expected a .facets .facet-h rule');
  const mt = /margin\s*:\s*(\d+)px/.exec(m[1]);
  assert.ok(mt, 'expected a px top margin on .facet-h');
  assert.ok(Number(mt[1]) <= 8, `facet heading top margin should be tightened to <= 8px, got ${mt[1]}`);
});

test('#9 the result card title carries a full-title tooltip', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'renderer.js'), 'utf8');
  // The .title element should be created WITH a title: attribute = the full title.
  assert.match(
    src,
    /class:\s*'title',\s*text:\s*title,\s*title:\s*title/,
    'the card title should set title: title for a hover tooltip'
  );
});

test('#17/#18 subject tags and creators in hits are rendered as clickable buttons', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'renderer.js'), 'utf8');
  // Subject tags become buttons that run a subject facet search.
  assert.match(src, /searchHitSubject|class:\s*'tag tag-link'/, 'subject tags should be clickable');
  assert.match(src, /searchHitCreator|class:\s*'sub-creator'/, 'creator should be a clickable element');
});

test('#19 search hits have a right-click (contextmenu) Copy menu', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'renderer.js'), 'utf8');
  assert.match(src, /oncontextmenu:|addEventListener\('contextmenu'/, 'a contextmenu handler must be wired on cards');
  assert.match(src, /Copy Title/, 'context menu should offer Copy Title');
  assert.match(src, /Copy Creator/, 'context menu should offer Copy Creator');
});

test('#14 the detail view no longer renders file-type bubble chips', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'renderer.js'), 'utf8');
  assert.ok(
    !/class:\s*'type-summary'/.test(src),
    'the file-type summary chips (type-summary) should be removed from the detail view (#14)'
  );
});

test('#15 there is no standalone "download a whole collection" input box', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  assert.ok(!/id="collection-id"/.test(html), 'the collection-id input box should be removed (#15)');
});

test('#7 the Transfers tab has a "Clear" button for finished transfers', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  assert.match(html, /id="clear-transfers"/, 'expected a #clear-transfers button');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'renderer.js'), 'utf8');
  assert.match(src, /#clear-transfers'\)\.addEventListener/, 'clear-transfers must be wired up');
});

test('#1 Preferences has a diagnostics/logging toggle (off by default)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  assert.match(html, /id="pref-logging"/, 'expected a #pref-logging toggle in Preferences');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'renderer.js'), 'utf8');
  assert.match(src, /#pref-logging'\)\.addEventListener/, 'logging toggle must be wired up');
});

test('#5 Preferences has a per-download subfolder toggle', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  assert.match(html, /id="pref-subfolders"/, 'expected a #pref-subfolders toggle');
});

test('#16 Preferences has an inter-download delay number input', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  assert.match(html, /id="pref-download-delay"/, 'expected a #pref-download-delay input');
});

test('#4 Preferences has Clear-search-cache and Clear-saved buttons', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  assert.match(html, /id="clear-recent-searches"/, 'expected a #clear-recent-searches button');
  assert.match(html, /id="clear-saved-searches"/, 'expected a #clear-saved-searches button');
});

test('#10 Preferences has card-level creator and type toggles', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  assert.match(html, /id="pref-creator"/, 'expected a #pref-creator toggle');
  assert.match(html, /id="pref-type"/, 'expected a #pref-type toggle');
});

test('a Help tab exists with field-keyword documentation', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  assert.match(html, /data-tab="help"/, 'expected a Help tab button');
  assert.match(html, /id="tab-help"/, 'expected a #tab-help panel');
  // The help text should document the search field keywords.
  assert.match(html, /title:/, 'help should mention the title: keyword');
  assert.match(html, /subject:/, 'help should mention the subject: keyword');
});

test('#12 Edit-metadata / Tasks buttons are gated by item ownership (canEditItem)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'renderer.js'), 'utf8');
  assert.match(src, /canEditItem/, 'the detail view must gate edit/tasks via canEditItem (#12)');
});

test('#13 the detail view uses relatedSearches (in-app), not website relatedLinks', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'renderer.js'), 'utf8');
  assert.match(src, /itemView\.relatedSearches/, 'detail view should call relatedSearches (#13)');
  assert.ok(
    !/relatedLinks\(md\)/.test(src),
    'the old website-link relatedLinks(md) usage should be gone (#13)'
  );
});

test('#3 Help documents the spreadsheet (CSV) upload', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const help = (html.match(/id="tab-help"[\s\S]*?<\/section>/) || [''])[0];
  assert.match(help, /spreadsheet|CSV/i, 'Help should explain spreadsheet/CSV upload (#3)');
  assert.match(help, /identifier/i, 'Help should mention the identifier column (#3)');
});

test('#11/#3 Help documents the month-precision year search', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const help = (html.match(/id="tab-help"[\s\S]*?<\/section>/) || [''])[0];
  assert.match(help, /1940-09|YYYY-MM/, 'Help should document YYYY-MM month search (#11)');
});
