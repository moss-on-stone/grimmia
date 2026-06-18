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

// Upper bound on how long we'll wait for a server-supplied Retry-After. The
// server's explicit instruction should be honored even past MAX_BACKOFF_MS, but
// a hostile/absurd value (e.g. "wait an hour") shouldn't hang the queue.
const MAX_RETRY_AFTER_MS = 120000;

/**
 * Parse an HTTP `Retry-After` header value into a wait in MILLISECONDS, per
 * archive.org's guidelines (honor Retry-After on 429/503). The value is either a
 * non-negative number of SECONDS or an HTTP-date. Returns null when absent or
 * unparseable so the caller falls back to its own backoff.
 *
 * @param {string|number|null} value the raw header value
 * @param {number} [nowMs] current epoch ms (injectable for deterministic tests)
 */
function parseRetryAfter(value, nowMs = Date.now()) {
  if (value == null) return null;
  const s = String(value).trim();
  if (s === '') return null;
  // Pure digits → seconds.
  if (/^\d+$/.test(s)) return Number(s) * 1000;
  // Otherwise an HTTP-date; clamp a past date to 0 (don't wait negative time).
  const when = Date.parse(s);
  if (Number.isNaN(when)) return null;
  return Math.max(0, when - nowMs);
}

/**
 * How long to wait before the next retry of a transient failure. Prefers the
 * server's Retry-After (carried on `err.retryAfter`) so we never wait LESS than
 * archive.org asked; otherwise uses the jittered exponential backoff. When both
 * apply, takes the larger. Capped at MAX_RETRY_AFTER_MS.
 *
 * @param {{retryAfter?:string|number}} err
 * @param {number} attempt zero-based retry attempt
 * @param {{base?:number, rand?:()=>number, nowMs?:number}} [opts]
 */
function retryDelay(err, attempt, opts = {}) {
  const { base = 500, rand = Math.random, nowMs } = opts;
  const backoff = jitteredBackoff(attempt, base, rand);
  const ra = parseRetryAfter(err && err.retryAfter, nowMs);
  if (ra == null) return backoff;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(ra, backoff));
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

// Abort-aware sleep: resolves after `ms`, or EARLY if `signal` aborts — so a
// Cancel during a (possibly multi-second Retry-After) backoff takes effect at
// once instead of holding the single transfer slot for the full delay.
function sleep(ms, signal) {
  if (!(ms > 0)) return Promise.resolve();
  if (signal && signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true }
      );
    }
  });
}

/**
 * Retry a single async `attempt` that RESOLVES to a result object (it does not
 * throw on HTTP errors — the JSON GET path inspects `result.ok`/`result.status`
 * instead). Retries while `shouldRetry(result)` is true, up to `maxRetries`,
 * waiting retryDelay() between tries and honoring a Retry-After read by
 * `getRetryAfter(result)`. Returns the final result (success or last failure).
 *
 * This gives search/metadata/scrape GETs the same 429/503 + Retry-After courtesy
 * the download queue already applies (#compliance).
 *
 * @param {() => Promise<any>} attempt makes one request, resolving to a result
 * @param {object} [opts]
 * @param {(result:any)=>boolean} opts.shouldRetry retry predicate on the result
 * @param {(result:any)=>(string|number|null)} [opts.getRetryAfter] reads Retry-After
 * @param {number} [opts.maxRetries=3]
 * @param {()=>number} [opts.rand] jitter source (test seam)
 * @param {(ms:number)=>Promise<void>} [opts.sleep] wait fn (test seam)
 */
async function withRetry(attempt, opts = {}) {
  const { shouldRetry, getRetryAfter = () => null, maxRetries = 3, rand = Math.random, sleep: wait = sleep } = opts;
  let tries = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await attempt();
    if (tries >= maxRetries || !shouldRetry(result)) return result;
    const delay = retryDelay({ retryAfter: getRetryAfter(result) }, tries, { rand });
    tries++;
    await wait(delay);
  }
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
    // The delay callback receives (attempt, error) so it can honor the server's
    // Retry-After (carried on the error) — defaults to retryDelay, which prefers
    // Retry-After over the jittered backoff. Tests may pass `() => 0`.
    backoffDelay: backoff = (attempt, error) => retryDelay(error, attempt),
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
          // Pass the error so the delay fn can honor a server Retry-After. The
          // sleep is abort-aware so a Cancel mid-backoff settles at once (the
          // loop-top aborted-check then converts it to a Cancelled result).
          await sleep(backoff(attempt - 1, error), signal);
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

module.exports = {
  backoffDelay,
  jitteredBackoff,
  parseRetryAfter,
  retryDelay,
  withRetry,
  isTransient,
  runQueue,
  MAX_BACKOFF_MS,
  MAX_RETRY_AFTER_MS,
};
