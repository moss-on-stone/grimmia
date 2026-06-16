'use strict';

/**
 * download-queue.js
 *
 * A small async work queue with bounded concurrency and automatic retry/backoff
 * for transient failures (idea #1). The scheduler takes an async `runner`, so it
 * is fully unit-testable with stub tasks — no real downloads. Real wiring lives
 * in main.js, which passes the IA download as the runner.
 */

const MAX_BACKOFF_MS = 30000;

/** Exponential backoff: base * 2^attempt, capped. */
function backoffDelay(attempt, base = 500) {
  return Math.min(MAX_BACKOFF_MS, base * 2 ** attempt);
}

/**
 * Exponential backoff WITH jitter (M5): the capped delay scaled to a random
 * [0.5, 1.0) of itself, so many files retrying after the same 503 don't re-hit
 * archive.org in lockstep. `rand` is injectable (defaults to Math.random) so the
 * jitter is testable. Result is floored to an integer ms.
 */
function jitteredBackoff(attempt, base = 500, rand = Math.random) {
  const capped = backoffDelay(attempt, base);
  return Math.floor(capped * (0.5 + 0.5 * rand()));
}

/** Whether an error is a transient failure worth retrying. */
function isTransient(err) {
  if (!err) return false;
  if (err.status === 503 || err.status === 429 || err.status === 500) return true;
  const code = err.code || '';
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN') return true;
  const msg = String(err.message || '').toLowerCase();
  return /slowdown|socket hang up|timeout|reset|temporarily/.test(msg);
}

function sleep(ms) {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

/**
 * Run `items` through `runner(item, index)` with bounded concurrency, retrying
 * transient failures up to `maxRetries` with backoff.
 *
 * @param {Array} items
 * @param {(item:any, index:number)=>Promise<any>} runner
 * @param {object} [opts]
 * @param {number} [opts.concurrency=3]
 * @param {number} [opts.maxRetries=3]
 * @param {(attempt:number)=>number} [opts.backoffDelay]
 * @param {(e:{type:string, index:number, attempt?:number, error?:any})=>void} [opts.onEvent]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<Array<{ok:boolean, value?:any, error?:any, index:number}>>}
 *   results in the original item order.
 */
async function runQueue(items, runner, opts = {}) {
  const {
    concurrency = 3,
    maxRetries = 3,
    backoffDelay: backoff = jitteredBackoff,
    onEvent = () => {},
    signal,
  } = opts;

  const list = items || [];
  const results = new Array(list.length);
  let next = 0;

  async function runOne(index) {
    const item = list[index];
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (signal && signal.aborted) {
        results[index] = { ok: false, error: new Error('Cancelled.'), index };
        return;
      }
      try {
        onEvent({ type: 'start', index, attempt });
        const value = await runner(item, index);
        results[index] = { ok: true, value, index };
        onEvent({ type: 'done', index });
        return;
      } catch (error) {
        if (attempt < maxRetries && isTransient(error)) {
          attempt++;
          onEvent({ type: 'retry', index, attempt, error });
          await sleep(backoff(attempt - 1));
          continue;
        }
        results[index] = { ok: false, error, index };
        onEvent({ type: 'fail', index, error });
        return;
      }
    }
  }

  async function worker() {
    while (next < list.length) {
      const index = next++;
      await runOne(index);
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, list.length)) }, () => worker());
  await Promise.all(workers);
  return results;
}

module.exports = { backoffDelay, jitteredBackoff, isTransient, runQueue, MAX_BACKOFF_MS };
