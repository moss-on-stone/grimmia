'use strict';

/**
 * Red/green TDD for the pause gate that holds all transfers during a server
 * overload. The runner awaits `wait()` before each item; `pause()` holds it for a
 * manual `resume()`, `delay(ms, onResume)` arms an auto-resume timer. Timers are
 * injected so tests are deterministic; `wait(signal)` rejects on abort so a
 * cancel during a long pause unblocks immediately.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createPauseGate } = require('../src/main/pause-gate');

/** A controllable fake timer. setTimeout/clearTimeout are plain functions (the
 *  gate calls them bare, like Electron's globals), and `lastId` tracks the most
 *  recently armed timer so a test can fire exactly it. */
function fakeTimers() {
  let seq = 0;
  const armed = new Map();
  const api = {
    lastId: null,
    setTimeout: (fn, ms) => {
      const id = ++seq;
      armed.set(id, { fn, ms });
      api.lastId = id;
      return id;
    },
    clearTimeout: (id) => armed.delete(id),
    fire: (id) => {
      const t = armed.get(id);
      if (t) {
        armed.delete(id);
        t.fn();
      }
    },
    pending: () => armed.size,
  };
  return api;
}

test('wait() resolves immediately while the gate is open', async () => {
  const gate = createPauseGate();
  assert.equal(gate.isOpen(), true);
  await gate.wait(); // must not hang
});

test('pause() holds wait() until resume()', async () => {
  const gate = createPauseGate();
  gate.pause();
  assert.equal(gate.isOpen(), false);
  let resolved = false;
  const p = gate.wait().then(() => {
    resolved = true;
  });
  await Promise.resolve(); // let microtasks run
  assert.equal(resolved, false, 'still waiting while paused');
  gate.resume();
  await p;
  assert.equal(resolved, true);
  assert.equal(gate.isOpen(), true);
});

test('delay() auto-opens after the timer fires and calls onResume', async () => {
  const timers = fakeTimers();
  const gate = createPauseGate(timers);
  let resumed = false;
  gate.delay(60000, () => (resumed = true));
  const id = timers.lastId;
  assert.equal(gate.isOpen(), false);
  const p = gate.wait();
  let done = false;
  p.then(() => (done = true));
  await Promise.resolve();
  assert.equal(done, false, 'waiting until the delay elapses');
  timers.fire(id);
  await p;
  assert.equal(done, true);
  assert.equal(resumed, true, 'onResume called');
  assert.equal(gate.isOpen(), true);
});

test('resume() during a delay cancels the timer (no double-open)', async () => {
  const timers = fakeTimers();
  const gate = createPauseGate(timers);
  let resumeCalls = 0;
  gate.delay(60000, () => resumeCalls++);
  gate.resume();
  assert.equal(gate.isOpen(), true);
  assert.equal(timers.pending(), 0, 'the delay timer was cleared');
  await gate.wait(); // open again
});

test('wait(signal) rejects promptly when the signal aborts during a pause', async () => {
  const gate = createPauseGate();
  gate.pause();
  const ac = new AbortController();
  const p = gate.wait(ac.signal);
  ac.abort();
  await assert.rejects(p, /cancel/i);
});

test('state() reports the current mode and resumeAt', () => {
  const timers = fakeTimers();
  const gate = createPauseGate(timers);
  assert.equal(gate.state().mode, null);
  gate.pause();
  assert.equal(gate.state().mode, 'pause');
  gate.resume();
  gate.delay(1000, () => {});
  assert.equal(gate.state().mode, 'delay');
});

test('wait() on an already-aborted signal rejects immediately', async () => {
  const gate = createPauseGate();
  gate.pause();
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(gate.wait(ac.signal), /cancel/i);
});

test('resume() releases ALL pending waiters (multi-waiter)', async () => {
  const gate = createPauseGate();
  gate.pause();
  let a = false;
  let b = false;
  const pa = gate.wait().then(() => (a = true));
  const pb = gate.wait().then(() => (b = true));
  await Promise.resolve();
  assert.equal(a || b, false, 'both waiting while paused');
  gate.resume();
  await Promise.all([pa, pb]);
  assert.ok(a && b, 'both waiters resolved by one resume');
});

test("aborting one waiter rejects only it; siblings still resolve on resume", async () => {
  const gate = createPauseGate();
  gate.pause();
  const ac = new AbortController();
  const aborted = gate.wait(ac.signal);
  let sibResolved = false;
  const sibling = gate.wait().then(() => (sibResolved = true));
  ac.abort();
  await assert.rejects(aborted, /cancel/i);
  assert.equal(sibResolved, false, 'sibling still waiting after the other aborts');
  gate.resume();
  await sibling;
  assert.ok(sibResolved, 'sibling resolves on resume');
});
