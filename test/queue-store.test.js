'use strict';

/**
 * Red/green TDD for the pure transfer-queue descriptor module (Phase 2 — persist
 * the queue so unfinished transfers survive an app crash/restart).
 *
 * queue-store.js is pure: it builds serializable job descriptors (mirroring the
 * IPC handler args so resume = re-call the same bridge method) and merges them
 * into a { jobs: [...] } queue. No fs, no Electron — store.js does the I/O.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const qs = require('../src/main/queue-store');

/* ------------------------------ describe* --------------------------------- */

test('describeDownloadJob keeps the start args and tags kind/status', () => {
  const d = qs.describeDownloadJob({
    jobId: 'job-1',
    items: [{ identifier: 'x' }],
    prefs: { formatText: 'pdf' },
    destRoot: '/dl',
    label: 'My item',
    signal: new AbortController().signal, // must be stripped (non-serializable)
  });
  assert.equal(d.kind, 'download');
  assert.equal(d.status, 'pending');
  assert.equal(d.jobId, 'job-1');
  assert.deepEqual(d.items, [{ identifier: 'x' }]);
  assert.deepEqual(d.prefs, { formatText: 'pdf' });
  assert.equal(d.destRoot, '/dl');
  assert.equal(d.label, 'My item');
  assert.ok(!('signal' in d), 'non-serializable signal stripped');
  // The whole descriptor must survive a JSON round-trip (no functions/sockets).
  assert.deepEqual(JSON.parse(JSON.stringify(d)), d);
});

test('describeCollectionJob captures the collection + maxItems', () => {
  const d = qs.describeCollectionJob({ jobId: 'j', collection: 'prelinger', prefs: {}, destRoot: '/d', maxItems: 50, label: 'Collection: prelinger' });
  assert.equal(d.kind, 'collection');
  assert.equal(d.collection, 'prelinger');
  assert.equal(d.maxItems, 50);
});

test('describeUploadJob captures identifier/files/metadata/derive', () => {
  const d = qs.describeUploadJob({ jobId: 'u', identifier: 'item', files: [{ path: '/a', name: 'a' }], metadata: { title: 'T' }, derive: true });
  assert.equal(d.kind, 'upload');
  assert.equal(d.identifier, 'item');
  assert.deepEqual(d.files, [{ path: '/a', name: 'a' }]);
  assert.deepEqual(d.metadata, { title: 'T' });
  assert.equal(d.derive, true);
  assert.deepEqual(JSON.parse(JSON.stringify(d)), d);
});

test('describeBulkJob captures the plan + derive', () => {
  const plan = [{ identifier: 'i1', files: [{ rel: 'f', path: '/f', exists: true }] }];
  const d = qs.describeBulkJob({ jobId: 'b', plan, derive: false });
  assert.equal(d.kind, 'bulk');
  assert.deepEqual(d.plan, plan);
  assert.equal(d.derive, false);
});

/* ----------------------------- upsert / remove ---------------------------- */

test('upsertJob adds a new job and is pure (returns a new queue)', () => {
  const q0 = { jobs: [] };
  const q1 = qs.upsertJob(q0, qs.describeDownloadJob({ jobId: 'a', items: [], prefs: {}, destRoot: '/d' }));
  assert.equal(q1.jobs.length, 1);
  assert.equal(q0.jobs.length, 0, 'original queue untouched (pure)');
});

test('upsertJob REPLACES an existing job by jobId (no duplicate)', () => {
  let q = { jobs: [] };
  q = qs.upsertJob(q, qs.describeDownloadJob({ jobId: 'a', items: [{ identifier: 'old' }], prefs: {}, destRoot: '/d' }));
  q = qs.upsertJob(q, qs.describeDownloadJob({ jobId: 'a', items: [{ identifier: 'new' }], prefs: {}, destRoot: '/d' }));
  assert.equal(q.jobs.length, 1, 'same jobId replaces, not duplicates');
  assert.deepEqual(q.jobs[0].items, [{ identifier: 'new' }]);
});

test('removeJob drops a job by jobId and is pure', () => {
  let q = { jobs: [] };
  q = qs.upsertJob(q, qs.describeDownloadJob({ jobId: 'a', items: [], prefs: {}, destRoot: '/d' }));
  q = qs.upsertJob(q, qs.describeUploadJob({ jobId: 'b', identifier: 'i', files: [], metadata: {} }));
  const after = qs.removeJob(q, 'a');
  assert.deepEqual(after.jobs.map((j) => j.jobId), ['b']);
  assert.equal(q.jobs.length, 2, 'original untouched');
});

test('removeJob on an unknown jobId is a no-op', () => {
  const q = qs.upsertJob({ jobs: [] }, qs.describeDownloadJob({ jobId: 'a', items: [], prefs: {}, destRoot: '/d' }));
  assert.equal(qs.removeJob(q, 'nope').jobs.length, 1);
});

/* ---------------------------- pendingJobs / summary ----------------------- */

test('pendingJobs returns the persisted (non-done) jobs; tolerates a junk queue', () => {
  const q = { jobs: [{ jobId: 'a', kind: 'download', status: 'pending' }, { jobId: 'b', kind: 'upload', status: 'done' }] };
  assert.deepEqual(qs.pendingJobs(q).map((j) => j.jobId), ['a']);
  assert.deepEqual(qs.pendingJobs(null), []);
  assert.deepEqual(qs.pendingJobs({}), []);
});

test('jobSummary returns banner fields only (no payload), with a sensible count', () => {
  const dl = qs.describeDownloadJob({ jobId: 'a', items: [{ identifier: 'x' }, { identifier: 'y' }], prefs: {}, destRoot: '/d', label: 'Two items' });
  const s = qs.jobSummary(dl);
  assert.deepEqual(Object.keys(s).sort(), ['count', 'jobId', 'kind', 'label'].sort());
  assert.equal(s.jobId, 'a');
  assert.equal(s.kind, 'download');
  assert.equal(s.label, 'Two items');
  assert.equal(s.count, 2, 'download count = number of items');
  // Upload count = number of files; bulk = number of plan items.
  assert.equal(qs.jobSummary(qs.describeUploadJob({ jobId: 'u', identifier: 'i', files: [{ path: '/a' }], metadata: {} })).count, 1);
  assert.equal(qs.jobSummary(qs.describeBulkJob({ jobId: 'b', plan: [{}, {}, {}], derive: false })).count, 3);
  // Collection count is the maxItems cap (members aren't known until listed); a
  // collection with no cap reports 0.
  const cs = qs.jobSummary(qs.describeCollectionJob({ jobId: 'c', collection: 'col', prefs: {}, destRoot: '/d', maxItems: 25, label: 'Collection: col' }));
  assert.equal(cs.count, 25, 'collection count = maxItems cap');
  assert.equal(cs.label, 'Collection: col');
  assert.equal(qs.jobSummary(qs.describeCollectionJob({ jobId: 'c2', collection: 'col', prefs: {}, destRoot: '/d', label: 'x' })).count, 0, 'no cap → 0');
});
