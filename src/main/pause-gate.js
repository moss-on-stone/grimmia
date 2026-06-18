'use strict';

/**
 * pause-gate.js
 *
 * A global gate the transfer runners await before each item. Normally OPEN
 * (wait() resolves immediately). On server overload the orchestrator closes it:
 *   - pause(): closed until a manual resume() (overloadMode 'pause').
 *   - delay(ms, onResume): closed, with a timer that auto-opens after `ms`
 *     and calls onResume (overloadMode 'delay'). A manual resume() opens early
 *     and cancels the timer.
 *
 * wait(signal) rejects if `signal` aborts while gated, so cancelling a job
 * during a long pause unblocks it immediately (mirrors defaultSleep's H6).
 *
 * Timers are injected (setTimeout/clearTimeout) so the delay path is testable
 * without real time. Pure-ish: only the timer + the resolver bookkeeping are
 * stateful; no Electron/IO.
 */

function createPauseGate({ setTimeout: setT = setTimeout, clearTimeout: clearT = clearTimeout } = {}) {
  let open = true;
  let mode = null; // 'pause' | 'delay' | null(open)
  let resumeAt = null; // epoch ms for 'delay'
  let timer = null;
  let waiters = []; // { resolve, reject, onAbort, signal }

  function flushResolve() {
    const pending = waiters;
    waiters = [];
    for (const w of pending) {
      if (w.signal && w.onAbort) w.signal.removeEventListener('abort', w.onAbort);
      w.resolve();
    }
  }

  function clearTimer() {
    if (timer != null) {
      clearT(timer);
      timer = null;
    }
  }

  function openGate() {
    clearTimer();
    open = true;
    mode = null;
    resumeAt = null;
    flushResolve();
  }

  return {
    /** Resolve when the gate is open; await otherwise. Reject if `signal` aborts. */
    wait(signal) {
      if (signal && signal.aborted) return Promise.reject(new Error('Cancelled.'));
      if (open) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const entry = { resolve, reject, signal, onAbort: null };
        if (signal) {
          entry.onAbort = () => {
            waiters = waiters.filter((w) => w !== entry);
            reject(new Error('Cancelled.'));
          };
          signal.addEventListener('abort', entry.onAbort, { once: true });
        }
        waiters.push(entry);
      });
    },

    /** Close the gate for a manual resume (overloadMode 'pause'). */
    pause() {
      clearTimer();
      open = false;
      mode = 'pause';
      resumeAt = null;
    },

    /** Close the gate and auto-open after `delayMs`, calling `onResume` then. */
    delay(delayMs, onResume) {
      clearTimer();
      open = false;
      mode = 'delay';
      resumeAt = Date.now() + delayMs;
      timer = setT(() => {
        timer = null;
        openGate();
        if (typeof onResume === 'function') onResume();
      }, delayMs);
    },

    /** Open the gate now (manual Resume / Resume now); cancels any delay timer. */
    resume() {
      openGate();
    },

    /** Snapshot for the renderer: { mode, resumeAt }. */
    state() {
      return { mode, resumeAt };
    },

    isOpen() {
      return open;
    },
  };
}

module.exports = { createPauseGate };
