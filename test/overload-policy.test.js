'use strict';

/**
 * Red/green TDD for the pure overload-decision module.
 *
 * Two pure functions:
 *  - nextFailureCount(prev, event): folds a runQueue onEvent into a running count
 *    of CONSECUTIVE exhausted-transient item failures. 'done' resets to 0; a
 *    transient 'fail' increments; a non-transient 'fail' resets to 0 (a real
 *    per-file error is not a server overload); 'retry'/'start' leave it unchanged.
 *  - decideOverload(state, prefs, {now}): once the count reaches overloadTries,
 *    decide pause vs delay (and compute the resume time for delay mode).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { nextFailureCount, decideOverload, DECISION, createOverloadController, shouldReopenGateOnDrain } = require('../src/main/overload-policy');

/* ----------------------------- nextFailureCount --------------------------- */

test("nextFailureCount resets to 0 on a 'done' event", () => {
  assert.equal(nextFailureCount(4, { type: 'done', index: 0 }), 0);
});

test('nextFailureCount increments on a transient failure', () => {
  assert.equal(nextFailureCount(2, { type: 'fail', error: { status: 503 } }), 3);
  assert.equal(nextFailureCount(0, { type: 'fail', error: { message: 'SlowDown' } }), 1);
});

test('nextFailureCount resets on a NON-transient failure (real per-file error)', () => {
  assert.equal(nextFailureCount(3, { type: 'fail', error: { status: 404 } }), 0);
});

test("nextFailureCount leaves the count unchanged on 'retry'/'start'", () => {
  assert.equal(nextFailureCount(2, { type: 'retry', attempt: 1 }), 2);
  assert.equal(nextFailureCount(2, { type: 'start' }), 2);
});

/* ------------------------------ decideOverload ---------------------------- */

const PREFS = { overloadMode: 'delay', overloadDelayMin: 60, overloadTries: 5 };

test('decideOverload continues below the threshold', () => {
  const d = decideOverload({ consecutiveFailures: 4 }, PREFS, { now: 1000 });
  assert.equal(d.decision, DECISION.CONTINUE);
  assert.equal(d.resumeAt, null);
  assert.equal(d.delayMs, 0);
});

test('decideOverload escalates to delay at the threshold (delay mode)', () => {
  const d = decideOverload({ consecutiveFailures: 5 }, PREFS, { now: 1000 });
  assert.equal(d.decision, DECISION.DELAY);
  assert.equal(d.delayMs, 60 * 60 * 1000);
  assert.equal(d.resumeAt, 1000 + 60 * 60 * 1000);
});

test('decideOverload escalates to pause at the threshold (pause mode)', () => {
  const prefs = { ...PREFS, overloadMode: 'pause' };
  const d = decideOverload({ consecutiveFailures: 5 }, prefs, { now: 1000 });
  assert.equal(d.decision, DECISION.PAUSE);
  assert.equal(d.resumeAt, null);
  assert.equal(d.delayMs, 0);
});

test('decideOverload boundary: tries-1 continues, tries escalates', () => {
  assert.equal(decideOverload({ consecutiveFailures: 4 }, PREFS, { now: 0 }).decision, DECISION.CONTINUE);
  assert.equal(decideOverload({ consecutiveFailures: 5 }, PREFS, { now: 0 }).decision, DECISION.DELAY);
  assert.equal(decideOverload({ consecutiveFailures: 6 }, PREFS, { now: 0 }).decision, DECISION.DELAY);
});

test('decideOverload converts overloadDelayMin minutes → ms', () => {
  const d = decideOverload({ consecutiveFailures: 5 }, { ...PREFS, overloadDelayMin: 1 }, { now: 0 });
  assert.equal(d.delayMs, 60 * 1000);
});

/* -------------------------- createOverloadController ---------------------- */
// Composes the counter + decision + a gate. observe(event) tracks consecutive
// transient failures and, at the threshold, pauses or delays the gate and
// broadcasts. wait(signal) delegates to the gate. Gate + getPrefs are injected.

function fakeGate() {
  return {
    paused: 0,
    delayed: null,
    resumed: 0,
    waits: 0,
    pause() {
      this.paused++;
    },
    delay(ms, onResume) {
      this.delayed = ms;
      this._onResume = onResume;
    },
    resume() {
      this.resumed++;
    },
    wait() {
      this.waits++;
      return Promise.resolve();
    },
  };
}

test('controller pauses the gate after overloadTries transient failures (pause mode)', () => {
  const gate = fakeGate();
  let broadcasts = 0;
  const ctl = createOverloadController({
    gate,
    getPrefs: () => ({ overloadMode: 'pause', overloadDelayMin: 60, overloadTries: 3 }),
    broadcast: () => broadcasts++,
  });
  for (let i = 0; i < 3; i++) ctl.observe({ type: 'fail', error: { status: 503 } });
  assert.equal(gate.paused, 1, 'paused once at the threshold');
  assert.ok(broadcasts >= 1, 'broadcast the paused state');
});

test('controller delays the gate (delay mode) and resets its counter after escalating', () => {
  const gate = fakeGate();
  const ctl = createOverloadController({
    gate,
    getPrefs: () => ({ overloadMode: 'delay', overloadDelayMin: 2, overloadTries: 2 }),
    broadcast: () => {},
    now: () => 0,
  });
  ctl.observe({ type: 'fail', error: { status: 503 } });
  ctl.observe({ type: 'fail', error: { status: 503 } }); // hits threshold 2
  assert.equal(gate.delayed, 2 * 60 * 1000, 'armed a 2-minute delay');
  // After escalating, the counter resets so it doesn't re-fire on the very next fail.
  ctl.observe({ type: 'fail', error: { status: 503 } });
  assert.equal(gate.delayed, 2 * 60 * 1000, 'no immediate second escalation');
});

test('controller success resets the streak so the gate is never tripped', () => {
  const gate = fakeGate();
  const ctl = createOverloadController({
    gate,
    getPrefs: () => ({ overloadMode: 'pause', overloadDelayMin: 60, overloadTries: 3 }),
    broadcast: () => {},
  });
  ctl.observe({ type: 'fail', error: { status: 503 } });
  ctl.observe({ type: 'fail', error: { status: 503 } });
  ctl.observe({ type: 'done' }); // reset
  ctl.observe({ type: 'fail', error: { status: 503 } });
  assert.equal(gate.paused, 0, 'never reached the threshold');
});

test('controller.wait delegates to the gate', async () => {
  const gate = fakeGate();
  const ctl = createOverloadController({ gate, getPrefs: () => PREFS, broadcast: () => {} });
  await ctl.wait();
  assert.equal(gate.waits, 1);
});

/* ------------------------- shouldReopenGateOnDrain ------------------------ */
// HIGH #1 fix: a paused gate must reopen when the transfer queue fully drains
// (active job cancelled/finished, nothing waiting) — otherwise a stale pause
// strands all FUTURE transfers (they block forever at gate.wait with nothing
// to reopen the gate in 'pause' mode).

test('shouldReopenGateOnDrain is true only when nothing is active or waiting', () => {
  assert.equal(shouldReopenGateOnDrain({ active: null, waiting: [] }), true);
  assert.equal(shouldReopenGateOnDrain({ active: 'job-1', waiting: [] }), false);
  assert.equal(shouldReopenGateOnDrain({ active: null, waiting: ['job-2'] }), false);
  assert.equal(shouldReopenGateOnDrain({ active: 'job-1', waiting: ['job-2'] }), false);
});

test('shouldReopenGateOnDrain tolerates a missing/partial snapshot', () => {
  assert.equal(shouldReopenGateOnDrain(null), true);
  assert.equal(shouldReopenGateOnDrain({}), true);
  assert.equal(shouldReopenGateOnDrain({ waiting: [] }), true);
});
