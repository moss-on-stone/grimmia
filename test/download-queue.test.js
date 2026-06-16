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

const { backoffDelay, isTransient, runQueue } = require('../src/main/download-queue');

/* ------------------------------ backoffDelay ------------------------------ */

test('backoffDelay grows exponentially from a base', () => {
  assert.equal(backoffDelay(0, 100), 100);
  assert.equal(backoffDelay(1, 100), 200);
  assert.equal(backoffDelay(2, 100), 400);
});

test('backoffDelay caps at a maximum', () => {
  assert.ok(backoffDelay(20, 100) <= 30000);
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
