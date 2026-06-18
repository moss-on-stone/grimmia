'use strict';

/**
 * Red/green TDD: elements with the `hidden` attribute MUST stay hidden even
 * when a class sets an explicit `display` (e.g. `.modal { display: grid }`).
 *
 * Bug this guards: the item-detail modal (#item-modal.modal) has `hidden` in
 * markup, but `.modal { display: grid }` overrode it, so an EMPTY modal-card
 * rendered as a stray bar over the login screen. The fix is a high-specificity
 * `[hidden] { display: none !important }` rule.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');

test('stylesheet forces [hidden] to display:none with !important', () => {
  // Match a rule like:  [hidden] { display: none !important; }
  const re = /\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/;
  assert.match(css, re, 'expected a [hidden]{display:none !important} rule');
});

test('.transfer-alert display is not !important, so [hidden] can override it', () => {
  // The overload alert ships with `hidden`; if its own display were !important it
  // would render even when hidden (the same class-vs-hidden bug as the modal).
  const m = /\.transfer-alert\s*\{([^}]*)\}/.exec(css);
  assert.ok(m, 'expected a .transfer-alert rule');
  assert.doesNotMatch(m[1], /display\s*:[^;]*!important/, '.transfer-alert display must not be !important');
});

test('#resume-banner has no !important display rule (relies on [hidden] guard)', () => {
  // The resume banner (Phase 2) ships with `hidden` and reuses .transfer-alert.
  // Any future #resume-banner-specific display:...!important would defeat [hidden].
  const m = /#resume-banner\s*\{([^}]*)\}/.exec(css);
  if (m) assert.doesNotMatch(m[1], /display\s*:[^;]*!important/, '#resume-banner display must not be !important');
  // (No dedicated rule is fine — it inherits .transfer-alert, already guarded above.)
});
