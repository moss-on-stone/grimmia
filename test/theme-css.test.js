'use strict';

/**
 * Red/green TDD for idea #17: the stylesheet must provide a light theme keyed
 * off `:root[data-theme="light"]`, overriding the core color variables. Guards
 * the shipped CSS so the light variant can't silently disappear.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');

test('stylesheet defines a light theme via :root[data-theme="light"]', () => {
  assert.match(css, /:root\[data-theme=['"]light['"]\]\s*\{/, 'expected a light-theme block');
});

test('the light theme overrides the core color variables', () => {
  const block = css.match(/:root\[data-theme=['"]light['"]\]\s*\{([^}]*)\}/);
  assert.ok(block, 'light-theme block should exist');
  const body = block[1];
  for (const v of ['--bg', '--text', '--accent', '--border']) {
    assert.match(body, new RegExp(`${v.replace(/[-]/g, '\\-')}\\s*:`), `light theme should set ${v}`);
  }
});
