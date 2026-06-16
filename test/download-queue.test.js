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

const { backoffDelay, jitteredBackoff, isTransient, runQueue } = require('../src/main/download-queue');

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
