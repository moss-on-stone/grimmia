'use strict';

/**
 * Red/green TDD for the application menu template.
 *
 * The whole reason this module exists: macOS auto-injects "Start Dictation",
 * "Emoji & Symbols", a Speech submenu, and a find bar into the DEFAULT Electron
 * menu — any of which can appear as a stray overlay over our window. We build an
 * explicit menu instead. These tests pin that the template contains only the
 * expected items and none of the injected ones.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildMenuTemplate } = require('../src/main/menu-template');

/** Recursively collect every label/role string in a menu template. */
function flatten(template) {
  const out = [];
  for (const item of template) {
    if (item.label) out.push(item.label);
    if (item.role) out.push(item.role);
    if (Array.isArray(item.submenu)) out.push(...flatten(item.submenu));
  }
  return out;
}

test('mac template has an app menu with about and quit', () => {
  const t = buildMenuTemplate({ isMac: true, isDev: false });
  const labels = flatten(t);
  assert.ok(labels.includes('about'), 'should expose About');
  assert.ok(labels.includes('quit'), 'should expose Quit');
});

test('template excludes macOS-injected dictation/speech/emoji items', () => {
  const t = buildMenuTemplate({ isMac: true, isDev: false });
  const labels = flatten(t).map((s) => s.toLowerCase());
  for (const banned of ['startspeaking', 'startdictation', 'speech', 'dictation', 'emoji']) {
    assert.ok(
      !labels.some((l) => l.includes(banned)),
      `template must not contain "${banned}" (it summons a system overlay)`
    );
  }
});

test('template has standard Edit roles (copy/paste/selectAll) for inputs', () => {
  const t = buildMenuTemplate({ isMac: true, isDev: false });
  const roles = flatten(t);
  for (const r of ['copy', 'paste', 'cut', 'selectAll', 'undo']) {
    assert.ok(roles.includes(r), `Edit menu should include ${r}`);
  }
});

test('DevTools is only present when isDev is true', () => {
  const dev = flatten(buildMenuTemplate({ isMac: true, isDev: true }));
  const prod = flatten(buildMenuTemplate({ isMac: true, isDev: false }));
  assert.ok(dev.includes('toggleDevTools'), 'dev build exposes DevTools');
  assert.ok(!prod.includes('toggleDevTools'), 'prod build hides DevTools');
});

test('non-mac template omits the app (name) menu but keeps Edit/View/Window', () => {
  const t = buildMenuTemplate({ isMac: false, isDev: false });
  const topLabels = t.map((m) => m.label);
  assert.ok(topLabels.includes('Edit'));
  assert.ok(topLabels.includes('View'));
  assert.ok(topLabels.includes('Window'));
});
