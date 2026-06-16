'use strict';

/**
 * Red/green TDD for idea #16: build an RFC 6902 JSON-Patch from a metadata edit,
 * and parse archive.org task status. Pure — no live-server writes (the user
 * tests real metadata edits themselves).
 *
 *  - buildMetadataPatch(original, edited) → [{op, path, value?}]
 *  - parseTasks(catalogJson) → normalized [{taskId, status, op, ...}]
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildMetadataPatch, parseTasks } = require('../src/main/json-patch');

/* --------------------------- buildMetadataPatch --------------------------- */

test('builds a replace op for a changed field', () => {
  const patch = buildMetadataPatch({ title: 'Old' }, { title: 'New' });
  assert.deepEqual(patch, [{ op: 'replace', path: '/title', value: 'New' }]);
});

test('builds an add op for a new field', () => {
  const patch = buildMetadataPatch({ title: 'T' }, { title: 'T', creator: 'C' });
  assert.deepEqual(patch, [{ op: 'add', path: '/creator', value: 'C' }]);
});

test('builds a remove op for a cleared field', () => {
  const patch = buildMetadataPatch({ title: 'T', creator: 'C' }, { title: 'T', creator: '' });
  assert.deepEqual(patch, [{ op: 'remove', path: '/creator' }]);
});

test('produces an empty patch when nothing changed', () => {
  assert.deepEqual(buildMetadataPatch({ title: 'T', a: 'b' }, { title: 'T', a: 'b' }), []);
});

test('escapes JSON-Pointer characters in field names (/ and ~)', () => {
  const patch = buildMetadataPatch({}, { 'a/b~c': 'v' });
  assert.equal(patch[0].path, '/a~1b~0c');
});

test('handles array values by comparing serialized form', () => {
  const same = buildMetadataPatch({ subject: ['a', 'b'] }, { subject: ['a', 'b'] });
  assert.deepEqual(same, []);
  const changed = buildMetadataPatch({ subject: ['a'] }, { subject: ['a', 'b'] });
  assert.deepEqual(changed, [{ op: 'replace', path: '/subject', value: ['a', 'b'] }]);
});

test('multiple changes are all captured', () => {
  const patch = buildMetadataPatch(
    { title: 'Old', creator: 'C', extra: 'x' },
    { title: 'New', creator: 'C', note: 'added' }
  );
  // title replaced, extra removed, note added — creator unchanged
  const ops = patch.map((p) => `${p.op} ${p.path}`).sort();
  assert.deepEqual(ops, ['add /note', 'remove /extra', 'replace /title']);
});

/* -------------------------------- parseTasks ------------------------------ */

test('parseTasks normalizes the catalog response', () => {
  const json = {
    value: {
      catalog: [{ task_id: 1, server: 's', cmd: 'derive.php', args: {}, status: 'running' }],
      history: [{ task_id: 2, cmd: 'book_op.php', status: 'done' }],
    },
  };
  const tasks = parseTasks(json);
  assert.equal(tasks.length, 2);
  const t1 = tasks.find((t) => t.taskId === 1);
  assert.equal(t1.status, 'running');
  assert.equal(t1.op, 'derive.php');
});

test('parseTasks tolerates a missing/empty response', () => {
  assert.deepEqual(parseTasks(null), []);
  assert.deepEqual(parseTasks({}), []);
  assert.deepEqual(parseTasks({ value: {} }), []);
});
