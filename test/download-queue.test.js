'use strict';

/**
 * Red/green TDD for idea #1: a download queue with concurrency control and
 * automatic retry/backoff. The scheduler is pure (takes async task runners),
 * so we test it with stubs — no real downloads.
 *
 *  - backoffDelay(attempt, base): exponential backoff (capped).
 *  - isTransient(err): 503 / SlowDown / network resets are retryable.
 *  - runQueue(items, runner, {concurrency, maxRetries, backoffDelay, onEvent}):
 *    runs items with bounded parallelism, retrying transient failures.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  backoffDelay,
  jitteredBackoff,
  isTransient,
  runQueue,
  parseRetryAfter,
  retryDelay,
  withRetry,
} = require('../src/main/download-queue');

/* ------------------------------ backoffDelay ------------------------------ */

test('backoffDelay grows exponentially from a base', () => {
  assert.equal(backoffDelay(0, 100), 100);
  assert.equal(backoffDelay(1, 100), 200);
  assert.equal(backoffDelay(2, 100), 400);
});

test('backoffDelay caps at a maximum', () => {
  assert.ok(backoffDelay(20, 100) <= 30000);
});

/* ------------------------- jitteredBackoff (M5) --------------------------- */
// Deterministic exponential backoff causes synchronized retry storms against an
// already-throttling server. Jitter spreads them. rand is injectable for tests.

test('jitteredBackoff scales the exponential delay by [0.5, 1.0) using rand', () => {
  // rand=0 → half the base delay; rand→1 → full delay.
  assert.equal(jitteredBackoff(0, 100, () => 0), 50, 'rand 0 → 50% of 100');
  assert.equal(jitteredBackoff(0, 100, () => 1), 100, 'rand 1 → 100% of 100');
  assert.equal(jitteredBackoff(1, 100, () => 0), 100, 'attempt 1 base 200 → 50% = 100');
});

test('jitteredBackoff never exceeds the cap', () => {
  assert.ok(jitteredBackoff(20, 100, () => 1) <= 30000);
});

test('jitteredBackoff stays within [0.5x, 1.0x] of the exponential schedule', () => {
  for (let a = 0; a < 6; a++) {
    const base = backoffDelay(a, 500);
    const lo = jitteredBackoff(a, 500, () => 0);
    const hi = jitteredBackoff(a, 500, () => 0.999);
    assert.ok(lo >= base * 0.5 - 1 && lo <= base, `attempt ${a} low bound`);
    assert.ok(hi <= base && hi >= base * 0.5, `attempt ${a} high bound`);
  }
});

/* ------------------------------- isTransient ------------------------------ */

test('isTransient recognizes 503 / SlowDown / connection resets', () => {
  assert.equal(isTransient({ status: 503 }), true);
  assert.equal(isTransient({ message: 'SlowDown' }), true);
  assert.equal(isTransient({ code: 'ECONNRESET' }), true);
  assert.equal(isTransient({ message: 'socket hang up' }), true);
});

test('isTransient returns false for a 404 / generic error', () => {
  assert.equal(isTransient({ status: 404 }), false);
  assert.equal(isTransient({ message: 'No matching files' }), false);
});

/* ----------------------------- parseRetryAfter ---------------------------- */
// archive.org's guidelines: honor a `Retry-After` header on 429/503. It is
// either a number of SECONDS or an HTTP-date. parseRetryAfter returns the wait
// in MILLISECONDS, or null when absent/unparseable. `nowMs` is injectable so the
// HTTP-date branch is deterministic in tests (no real clock).

test('parseRetryAfter reads a delay given in seconds', () => {
  assert.equal(parseRetryAfter('120'), 120000);
  assert.equal(parseRetryAfter('0'), 0);
  assert.equal(parseRetryAfter(' 5 '), 5000);
});

test('parseRetryAfter reads an HTTP-date relative to now', () => {
  const now = Date.UTC(2026, 0, 1, 0, 0, 0); // fixed "now"
  // A date 30s in the future → 30000 ms.
  const future = 'Thu, 01 Jan 2026 00:00:30 GMT';
  assert.equal(parseRetryAfter(future, now), 30000);
});

test('parseRetryAfter never returns a negative wait (past date → 0)', () => {
  const now = Date.UTC(2026, 0, 1, 0, 1, 0);
  const past = 'Thu, 01 Jan 2026 00:00:30 GMT';
  assert.equal(parseRetryAfter(past, now), 0);
});

test('parseRetryAfter returns null for missing or junk values', () => {
  assert.equal(parseRetryAfter(null), null);
  assert.equal(parseRetryAfter(undefined), null);
  assert.equal(parseRetryAfter(''), null);
  assert.equal(parseRetryAfter('not-a-date'), null);
});

/* ------------------------------- retryDelay ------------------------------- */
// retryDelay prefers the server's Retry-After (carried on err.retryAfter) over
// our own backoff — we never wait LESS than the server asked. Falls back to the
// jittered backoff schedule when there's no Retry-After.

test('retryDelay honors a Retry-After (seconds) on the error', () => {
  // rand=0 would give a tiny jittered backoff; Retry-After must win.
  assert.equal(retryDelay({ status: 429, retryAfter: '10' }, 0, { rand: () => 0 }), 10000);
});

test('retryDelay falls back to jittered backoff when no Retry-After', () => {
  // attempt 0, base 500, rand 1 → full 500ms (matches jitteredBackoff).
  assert.equal(retryDelay({ status: 503 }, 0, { rand: () => 1 }), jitteredBackoff(0, 500, () => 1));
});

test('retryDelay uses the LARGER of Retry-After and backoff (never undercuts the server)', () => {
  // A 1s Retry-After but a high attempt whose backoff exceeds it → use backoff.
  const d = retryDelay({ status: 503, retryAfter: '1' }, 10, { rand: () => 1 });
  assert.ok(d >= 1000, 'at least the Retry-After');
  assert.ok(d >= jitteredBackoff(10, 500, () => 1), 'at least the backoff');
});

/* -------------------------------- withRetry ------------------------------- */
// withRetry wraps a single async attempt that resolves to a result object. It
// retries when shouldRetry(result) is true (e.g. a transient 429/503 status),
// honoring a Retry-After read by getRetryAfter(result). `sleep` is injected so
// tests don't actually wait. Used to give search/metadata/scrape GETs the same
// 429/503 + Retry-After handling the download queue has.

test('withRetry returns the first non-retryable result immediately', async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls++;
      return { status: 200, ok: true };
    },
    { shouldRetry: (r) => r.status >= 500, maxRetries: 3, sleep: async () => {} }
  );
  assert.equal(calls, 1);
  assert.equal(result.status, 200);
});

test('withRetry retries a transient result then returns the success', async () => {
  let calls = 0;
  const slept = [];
  const result = await withRetry(
    async () => {
      calls++;
      return calls < 3 ? { status: 503, ok: false } : { status: 200, ok: true };
    },
    {
      shouldRetry: (r) => r.status === 503 || r.status === 429,
      getRetryAfter: () => null,
      maxRetries: 5,
      rand: () => 1,
      sleep: async (ms) => slept.push(ms),
    }
  );
  assert.equal(calls, 3);
  assert.equal(result.status, 200);
  assert.equal(slept.length, 2, 'slept before each of the 2 retries');
});

test('withRetry honors a Retry-After pulled from the result', async () => {
  let calls = 0;
  const slept = [];
  await withRetry(
    async () => {
      calls++;
      return calls < 2 ? { status: 429 } : { status: 200 };
    },
    {
      shouldRetry: (r) => r.status === 429,
      getRetryAfter: (r) => (r.status === 429 ? '15' : null), // 15 seconds
      maxRetries: 3,
      rand: () => 0, // tiny backoff, so Retry-After must dominate
      sleep: async (ms) => slept.push(ms),
    }
  );
  assert.equal(slept[0], 15000, 'waited the server-instructed 15s');
});

test('withRetry stops retrying once shouldRetry sees an aborted signal (GET cancel)', async () => {
  // The GET retry path's abort-awareness lives in the shouldRetry predicate
  // (request() returns false once opts.signal.aborted). Model that here: a 503
  // that would loop forever stops as soon as the signal aborts.
  const ac = new AbortController();
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls++;
      if (calls === 1) ac.abort(); // aborted after the first attempt
      return { status: 503 };
    },
    {
      shouldRetry: (r) => !ac.signal.aborted && r.status === 503,
      maxRetries: 50,
      sleep: async () => {},
    }
  );
  assert.equal(calls, 1, 'no further attempts after abort');
  assert.equal(result.status, 503, 'returns the last result');
});

test('withRetry gives up after maxRetries, returning the last result', async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls++;
      return { status: 503 };
    },
    { shouldRetry: () => true, maxRetries: 2, sleep: async () => {} }
  );
  assert.equal(calls, 3, '1 initial + 2 retries');
  assert.equal(result.status, 503, 'returns the last (still-failing) result');
});

/* -------------------------------- runQueue -------------------------------- */

test('runQueue runs all items and returns per-item results', async () => {
  const items = [1, 2, 3, 4];
  const out = await runQueue(items, async (n) => n * 10, { concurrency: 2, backoffDelay: () => 0 });
  assert.deepEqual(out.map((r) => r.value).sort((a, b) => a - b), [10, 20, 30, 40]);
  assert.ok(out.every((r) => r.ok));
});

test('runQueue never exceeds the concurrency limit', async () => {
  let active = 0;
  let peak = 0;
  const items = Array.from({ length: 10 }, (_, i) => i);
  await runQueue(
    items,
    async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setImmediate(r));
      active--;
    },
    { concurrency: 3, backoffDelay: () => 0 }
  );
  assert.ok(peak <= 3, `peak concurrency ${peak} exceeded limit 3`);
});

test('runQueue retries a transient failure and then succeeds', async () => {
  let attempts = 0;
  const runner = async () => {
    attempts++;
    if (attempts < 3) throw { status: 503 };
    return 'done';
  };
  const out = await runQueue([1], runner, { concurrency: 1, maxRetries: 5, backoffDelay: () => 0 });
  assert.equal(attempts, 3);
  assert.equal(out[0].ok, true);
  assert.equal(out[0].value, 'done');
});

test('runQueue gives up after maxRetries on a persistent transient failure', async () => {
  let attempts = 0;
  const runner = async () => {
    attempts++;
    throw { status: 503 };
  };
  const out = await runQueue([1], runner, { concurrency: 1, maxRetries: 2, backoffDelay: () => 0 });
  assert.equal(attempts, 3, '1 initial + 2 retries');
  assert.equal(out[0].ok, false);
});

test('runQueue does NOT retry a non-transient failure', async () => {
  let attempts = 0;
  const runner = async () => {
    attempts++;
    throw { status: 404 };
  };
  const out = await runQueue([1], runner, { concurrency: 1, maxRetries: 5, backoffDelay: () => 0 });
  assert.equal(attempts, 1, 'no retry on a permanent error');
  assert.equal(out[0].ok, false);
});

test('runQueue passes the error to the delay fn so Retry-After is honored', async () => {
  // The delay callback must receive (attempt, error); capture what it sees so we
  // can assert the 429's Retry-After reached it.
  const seen = [];
  let attempts = 0;
  const runner = async () => {
    attempts++;
    if (attempts < 2) throw { status: 429, retryAfter: '7' };
    return 'ok';
  };
  await runQueue([1], runner, {
    concurrency: 1,
    maxRetries: 3,
    backoffDelay: (attempt, error) => {
      seen.push({ attempt, retryAfter: error && error.retryAfter });
      return 0; // don't actually wait in the test
    },
  });
  assert.equal(seen.length, 1, 'one retry');
  assert.equal(seen[0].retryAfter, '7', 'the delay fn saw the error carrying Retry-After');
});

test('runQueue emits retry events via onEvent', async () => {
  const events = [];
  let attempts = 0;
  const runner = async () => {
    attempts++;
    if (attempts < 2) throw { status: 503 };
    return 'ok';
  };
  await runQueue([1], runner, {
    concurrency: 1,
    maxRetries: 3,
    backoffDelay: () => 0,
    onEvent: (e) => events.push(e.type),
  });
  assert.ok(events.includes('retry'), 'a retry event should be emitted');
});

test('runQueue aborts PROMPTLY during a retry backoff (does not wait out the delay)', async () => {
  // A transient failure schedules a long backoff; we abort during it. The queue
  // must settle ~immediately as Cancelled, not hold the slot for the full delay.
  const ac = new AbortController();
  let attempts = 0;
  const runner = async () => {
    attempts++;
    if (attempts === 1) {
      // Abort while the (long) backoff that follows this throw is pending.
      setImmediate(() => ac.abort());
      throw { status: 503 };
    }
    return 'should-not-reach';
  };
  const start = Date.now();
  const out = await runQueue([1], runner, {
    concurrency: 1,
    maxRetries: 5,
    backoffDelay: () => 60000, // 60s — the test must NOT wait this out
    signal: ac.signal,
  });
  const elapsed = Date.now() - start;
  assert.equal(attempts, 1, 'no second attempt after abort');
  assert.equal(out[0].ok, false);
  assert.ok(elapsed < 5000, `settled promptly on abort, took ${elapsed}ms`);
});
