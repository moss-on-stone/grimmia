'use strict';

/**
 * transfer-queue.js
 *
 * A serial transfer queue (ONE job at a time) whose WAITING jobs form an
 * explicit, user-reorderable list. archive.org throttles parallel transfers, so
 * only one download/upload runs at a time; the rest queue. Unlike a plain mutex,
 * the waiting order is data the user can rearrange (drag-to-reorder in the UI)
 * before each job starts.
 *
 *   acquire(jobId)      → Promise<release>. Resolves immediately if nothing is
 *                         active; otherwise the job joins the BACK of the waiting
 *                         list and resolves when it reaches the front and the
 *                         active job releases.
 *   move(jobId, index)  → reorder a WAITING job to `index` (clamped). The active
 *                         job and unknown ids are ignored.
 *   remove(jobId)       → drop a waiting job (e.g. cancelled before it started).
 *   snapshot()          → { active, waiting: [jobId, …] } for the UI.
 *
 * Pure (no Electron, no I/O) and unit tested.
 */

function createTransferQueue() {
  let active = null; // jobId currently holding the lock, or null
  const waiting = []; // [{ jobId, resolve }] in queue order

  function grantNext() {
    if (active != null) return; // someone still holds it
    const next = waiting.shift();
    if (!next) return;
    active = next.jobId;
    next.resolve(makeRelease(next.jobId));
  }

  function makeRelease(jobId) {
    let released = false;
    return function release() {
      // Only the active holder's release advances the queue; double-release and
      // a stale release from a previous holder are no-ops.
      if (released || active !== jobId) return;
      released = true;
      active = null;
      grantNext();
    };
  }

  function acquire(jobId) {
    if (active == null && waiting.length === 0) {
      active = jobId;
      return Promise.resolve(makeRelease(jobId));
    }
    return new Promise((resolve) => {
      waiting.push({ jobId, resolve });
    });
  }

  /** Move a waiting job to `toIndex` (clamped to [0, len-1]). No-op for the
   * active job or an unknown id. */
  function move(jobId, toIndex) {
    if (jobId === active) return;
    const from = waiting.findIndex((w) => w.jobId === jobId);
    if (from < 0) return;
    const [item] = waiting.splice(from, 1);
    const to = Math.max(0, Math.min(waiting.length, Number(toIndex) || 0));
    waiting.splice(to, 0, item);
  }

  /** Remove a waiting job from the queue (does not affect the active job). */
  function remove(jobId) {
    const i = waiting.findIndex((w) => w.jobId === jobId);
    if (i >= 0) waiting.splice(i, 1);
  }

  function snapshot() {
    return { active, waiting: waiting.map((w) => w.jobId) };
  }

  return { acquire, move, remove, snapshot };
}

module.exports = { createTransferQueue };
