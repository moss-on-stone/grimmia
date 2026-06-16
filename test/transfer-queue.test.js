'use strict';

/**
 * Red/green TDD for the reorderable transfer queue.
 *
 * Like the serial gate it runs ONE job at a time, but the WAITING jobs form an
 * explicit, user-reorderable queue: the active job is pinned (not in the waiting
 * list), new jobs enqueue to the BOTTOM, the next job is taken from the FRONT,
 * and move(jobId, toIndex) lets the user reorder a waiting job (never the active
 * one). snapshot() exposes { active, waiting } for the UI.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createTransferQueue } = require('../src/main/transfer-queue');

test('first acquire is granted immediately and becomes the active job', async () => {
  const q = createTransferQueue();
  const release = await q.acquire('a');
  assert.deepEqual(q.snapshot(), { active: 'a', waiting: [] });
  release();
  assert.deepEqual(q.snapshot(), { active: null, waiting: [] });
});

test('later acquires wait in arrival order (FIFO) behind the active job', async () => {
  const q = createTransferQueue();
  const ra = await q.acquire('a');
  let bGranted = false;
  let cGranted = false;
  const pb = q.acquire('b').then((r) => { bGranted = true; return r; });
  const pc = q.acquire('c').then((r) => { cGranted = true; return r; });

  await Promise.resolve();
  assert.equal(bGranted, false, 'b must wait while a is active');
  assert.equal(cGranted, false);
  assert.deepEqual(q.snapshot(), { active: 'a', waiting: ['b', 'c'] });

  ra();
  const rb = await pb;
  assert.equal(bGranted, true);
  assert.deepEqual(q.snapshot(), { active: 'b', waiting: ['c'] });
  rb();
  await pc;
  assert.deepEqual(q.snapshot(), { active: 'c', waiting: [] });
});

test('new jobs enqueue to the BOTTOM', async () => {
  const q = createTransferQueue();
  const ra = await q.acquire('a');
  q.acquire('b');
  q.acquire('c');
  q.acquire('d');
  assert.deepEqual(q.snapshot().waiting, ['b', 'c', 'd']);
  ra();
});

test('move() reorders a waiting job; the granted order follows the new order', async () => {
  const q = createTransferQueue();
  const ra = await q.acquire('a');
  const grantedOrder = [];
  const release = {};
  for (const id of ['b', 'c', 'd']) {
    q.acquire(id).then((r) => { grantedOrder.push(id); release[id] = r; });
  }
  await Promise.resolve();
  assert.deepEqual(q.snapshot().waiting, ['b', 'c', 'd']);

  // Move 'd' to the front of the waiting list.
  q.move('d', 0);
  assert.deepEqual(q.snapshot().waiting, ['d', 'b', 'c']);

  // Drain and confirm d is granted first.
  ra();
  await Promise.resolve(); await Promise.resolve();
  release['d'] && release['d']();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(grantedOrder[0], 'd', 'the moved job is granted first');
});

test('move() clamps the target index into range', async () => {
  const q = createTransferQueue();
  const ra = await q.acquire('a');
  q.acquire('b'); q.acquire('c'); q.acquire('d');
  await Promise.resolve();
  q.move('b', 99); // past the end → goes last
  assert.deepEqual(q.snapshot().waiting, ['c', 'd', 'b']);
  q.move('b', -5); // before the start → goes first
  assert.deepEqual(q.snapshot().waiting, ['b', 'c', 'd']);
  ra();
});

test('move() on the active job (or an unknown job) is a no-op', async () => {
  const q = createTransferQueue();
  const ra = await q.acquire('a');
  q.acquire('b'); q.acquire('c');
  await Promise.resolve();
  q.move('a', 1); // active can't be reordered
  q.move('zzz', 0); // unknown
  assert.deepEqual(q.snapshot(), { active: 'a', waiting: ['b', 'c'] });
  ra();
});

test('remove() drops a waiting job (e.g. cancelled before it starts)', async () => {
  const q = createTransferQueue();
  const ra = await q.acquire('a');
  q.acquire('b'); q.acquire('c');
  await Promise.resolve();
  q.remove('b');
  assert.deepEqual(q.snapshot().waiting, ['c']);
  ra();
});

test('releasing twice does not over-advance the queue', async () => {
  const q = createTransferQueue();
  const ra = await q.acquire('a');
  const pb = q.acquire('b');
  ra();
  ra(); // double release — must be a no-op
  const rb = await pb;
  assert.equal(q.snapshot().active, 'b');
  rb();
});
