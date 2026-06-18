'use strict';

/**
 * queue-store.js
 *
 * Pure transfer-queue descriptor logic (Phase 2 — persist the queue so unfinished
 * downloads/uploads survive an app crash/restart). No fs, no Electron — store.js
 * does the I/O; this only builds serializable descriptors and merges them into a
 * `{ jobs: [...] }` queue.
 *
 * A descriptor mirrors EXACTLY the args its IPC handler is invoked with, so
 * resuming is just "re-call the same bridge method with the same args (and the
 * same jobId)". Non-serializable fields (AbortSignal, callbacks) are never copied.
 */

/** Build a download descriptor (mirrors download:start args). */
function describeDownloadJob({ jobId, items, prefs, destRoot, label }) {
  return { kind: 'download', status: 'pending', jobId, items, prefs, destRoot, label };
}

/** Build a collection-download descriptor (mirrors collection:download args). */
function describeCollectionJob({ jobId, collection, prefs, destRoot, maxItems, label }) {
  return { kind: 'collection', status: 'pending', jobId, collection, prefs, destRoot, maxItems, label };
}

/** Build a single-item upload descriptor (mirrors upload:start args). */
function describeUploadJob({ jobId, identifier, files, metadata, derive }) {
  return { kind: 'upload', status: 'pending', jobId, identifier, files, metadata, derive };
}

/** Build a bulk-upload descriptor (mirrors bulk:upload args). */
function describeBulkJob({ jobId, plan, derive }) {
  return { kind: 'bulk', status: 'pending', jobId, plan, derive };
}

/** Add or replace a job (by jobId). Pure — returns a NEW queue object. */
function upsertJob(queue, descriptor) {
  const jobs = ((queue && queue.jobs) || []).filter((j) => j.jobId !== descriptor.jobId);
  return { jobs: [...jobs, descriptor] };
}

/** Drop a job by jobId. Pure — returns a NEW queue object. */
function removeJob(queue, jobId) {
  return { jobs: ((queue && queue.jobs) || []).filter((j) => j.jobId !== jobId) };
}

/** The persisted (not-done) jobs. Tolerates a missing/junk queue. */
function pendingJobs(queue) {
  return ((queue && queue.jobs) || []).filter((j) => j && j.status !== 'done');
}

/** Banner-only summary of a descriptor (no payload), with a per-kind count. */
function jobSummary(descriptor) {
  const d = descriptor || {};
  let count = 0;
  if (d.kind === 'download') count = (d.items || []).length;
  else if (d.kind === 'upload') count = (d.files || []).length;
  else if (d.kind === 'bulk') count = (d.plan || []).length;
  else if (d.kind === 'collection') count = d.maxItems || 0;
  return { jobId: d.jobId, kind: d.kind, label: d.label || d.identifier || d.collection || '', count };
}

module.exports = {
  describeDownloadJob,
  describeCollectionJob,
  describeUploadJob,
  describeBulkJob,
  upsertJob,
  removeJob,
  pendingJobs,
  jobSummary,
};
