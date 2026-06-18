'use strict';

/**
 * overload-policy.js
 *
 * Pure decision logic for server-overload escalation. No Electron, no IO, no
 * timers — fully unit-testable. The orchestrator (main.js) owns the running
 * count and the timer; this module only decides.
 *
 * Two layers of resilience:
 *   1. Per-item retry (runQueue/maxRetries) rides out brief 503/429 blips.
 *   2. Overload escalation (THIS module): when `overloadTries` items IN A ROW
 *      exhaust their retries with a TRANSIENT error, the server is treated as
 *      overloaded/down and the whole queue pauses or delays.
 */

const { isTransient } = require('./download-queue');

const DECISION = Object.freeze({ CONTINUE: 'continue', PAUSE: 'pause', DELAY: 'delay' });

/**
 * Fold a runQueue `onEvent` into the running count of CONSECUTIVE
 * exhausted-transient item failures. Pure — the caller holds the count.
 *
 *  - 'done'                       → 0 (a success breaks the streak)
 *  - 'fail' with a transient error → prev + 1 (server still sick)
 *  - 'fail' with a real error      → 0 (a 404/auth error isn't "overloaded")
 *  - 'retry' / 'start' / other     → unchanged (mid-item, not yet resolved)
 *
 * @param {number} prev current consecutive-failure count
 * @param {{type:string, error?:object}} event
 * @returns {number}
 */
function nextFailureCount(prev, event) {
  const n = Number(prev) || 0;
  if (!event) return n;
  if (event.type === 'done') return 0;
  if (event.type === 'fail') return isTransient(event.error) ? n + 1 : 0;
  return n;
}

/**
 * Decide what to do given the running failure count and prefs.
 *
 * @param {{consecutiveFailures:number}} state
 * @param {{overloadMode:'pause'|'delay', overloadDelayMin:number, overloadTries:number}} prefs
 * @param {{now?:number}} [opts] now = epoch ms (inject for deterministic tests)
 * @returns {{decision:string, resumeAt:number|null, delayMs:number}}
 */
function decideOverload(state, prefs, { now = Date.now() } = {}) {
  const count = Number(state && state.consecutiveFailures) || 0;
  const tries = Number(prefs && prefs.overloadTries) || 0;
  if (count < tries) return { decision: DECISION.CONTINUE, resumeAt: null, delayMs: 0 };
  if (prefs.overloadMode === 'pause') return { decision: DECISION.PAUSE, resumeAt: null, delayMs: 0 };
  // 'delay' mode: wait overloadDelayMin minutes, then auto-resume.
  const delayMs = Math.max(0, Number(prefs.overloadDelayMin) || 0) * 60 * 1000;
  return { decision: DECISION.DELAY, resumeAt: now + delayMs, delayMs };
}

/**
 * Compose the counter + decision + a pause gate into a stateful controller the
 * transfer handlers can share. `observe(event)` is fed every runQueue event;
 * `wait(signal)` is awaited before each item. Glue (the gate, prefs lookup,
 * broadcast, clock) is injected so the decision flow is testable without Electron.
 *
 * @param {object} deps
 * @param {{pause:Function, delay:Function, resume:Function, wait:Function}} deps.gate
 * @param {() => object} deps.getPrefs returns the live prefs ({overloadMode,...})
 * @param {() => void} deps.broadcast re-broadcast the queue/overload state
 * @param {() => number} [deps.now] clock (for the delay resumeAt; default Date.now)
 */
function createOverloadController({ gate, getPrefs, broadcast = () => {}, now = Date.now }) {
  let consecutiveFailures = 0;

  return {
    /** Await the gate before doing an item's work. */
    wait(signal) {
      return gate.wait(signal);
    },

    /** Fold one runQueue event in; escalate to pause/delay at the threshold. */
    observe(event) {
      consecutiveFailures = nextFailureCount(consecutiveFailures, event);
      if (!event || event.type !== 'fail') return; // only a fresh failure can escalate
      const prefs = getPrefs() || {};
      const d = decideOverload({ consecutiveFailures }, prefs, { now: now() });
      if (d.decision === DECISION.CONTINUE) return;
      if (d.decision === DECISION.PAUSE) {
        gate.pause();
      } else {
        gate.delay(d.delayMs, () => broadcast());
      }
      consecutiveFailures = 0; // reset so we don't re-escalate on the very next fail
      broadcast();
    },
  };
}

/**
 * Whether the pause gate should be reopened given a transfer-queue snapshot.
 * True when the queue has fully drained (no active job, nothing waiting) — a
 * lingering pause/delay must not strand FUTURE transfers when there's nothing
 * left to auto-resume it. Pure.
 *
 * @param {{active:?string, waiting:string[]}} snapshot
 */
function shouldReopenGateOnDrain(snapshot) {
  const s = snapshot || {};
  return !s.active && (!Array.isArray(s.waiting) || s.waiting.length === 0);
}

module.exports = { nextFailureCount, decideOverload, createOverloadController, shouldReopenGateOnDrain, DECISION };
