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
