'use strict';

/**
 * Red/green TDD: the login form markup must NOT invite Chromium's autofill /
 * "save password" overlay bar (which renders as a stray full-width bar with an
 * × over the form). We assert the form opts out of autofill UI.
 *
 * This reads the actual index.html so the test guards the shipped markup.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');

/** Extract the <form id="login-form" ...> ... </form> block. */
function loginFormBlock() {
  const m = html.match(/<form id="login-form"[\s\S]*?<\/form>/);
  assert.ok(m, 'login-form block should exist');
  return m[0];
}

test('login form disables Chromium autofill via autocomplete="off"', () => {
  const form = loginFormBlock();
  assert.match(form, /<form id="login-form"[^>]*autocomplete="off"/, 'form should set autocomplete="off"');
});

test('email and password inputs opt out of autofill', () => {
  const form = loginFormBlock();
  // Each credential input must carry autocomplete="off" (or a one-off token).
  const emailInput = form.match(/<input id="login-email"[^>]*>/)[0];
  const pwInput = form.match(/<input id="login-password"[^>]*>/)[0];
  assert.match(emailInput, /autocomplete="off"/, 'email input opts out');
  assert.match(pwInput, /autocomplete="off"/, 'password input opts out');
});
