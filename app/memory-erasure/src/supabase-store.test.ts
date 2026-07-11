// ISSUE-029 — supabase-store.ts OFFLINE tests: drive the live adapter against a fake pg exec seam to assert the SQL
// shape + row mapping + the cast contracts. The REAL proof it agrees with the live schema is the R10 smoke.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseErasureStore, SupabaseErasureEventSink, EVT_MEMORY_ERASED, EVT_MEMORY_ERASURE_INCOMPLETE } from './supabase-store.ts';
import type { AuditEntry } from './store.ts';

interface Call {
  text: string;
  params: unknown[];
}
function fakeExec(rowsFor: (text: string) => any[] = () => []) {
  const calls: Call[] = [];
  const exec = async (text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    const rows = rowsFor(text);
    return { rows: rows as any[], rowCount: rows.length };
  };
  return { exec: exec as any, calls };
}

test('resolveTargetMemories filters by entity_ids membership AND Personal tier (the erasure remit)', async () => {
  const { exec, calls } = fakeExec();
  await new SupabaseErasureStore(exec).resolveTargetMemories('T');
  assert.match(calls[0]!.text, /\$1::uuid = any\(entity_ids\)/);
  assert.match(calls[0]!.text, /sensitivity = 'personal'/);
  assert.match(calls[0]!.text, /coalesce\(derived_from, '\{\}'::uuid\[\]\) as derived_from/);
  assert.deepEqual(calls[0]!.params, ['T']);
});

test('walkSupersededChain is a recursive CTE following superseded_by in BOTH directions', async () => {
  const { exec, calls } = fakeExec();
  await new SupabaseErasureStore(exec).walkSupersededChain(['a', 'b']);
  assert.match(calls[0]!.text, /with recursive walk/);
  assert.match(calls[0]!.text, /m\.id = w\.sup or m\.superseded_by = w\.id/, 'both edge directions');
});

test('walkSupersededChain / findDerivedFrom short-circuit on an empty id set (no query)', async () => {
  const { exec, calls } = fakeExec();
  const store = new SupabaseErasureStore(exec);
  assert.deepEqual(await store.walkSupersededChain([]), []);
  assert.deepEqual(await store.findDerivedFrom([]), []);
  assert.equal(calls.length, 0);
});

test('findDerivedFrom uses the GIN-indexed array-overlap on derived_from (the OD-204 edge)', async () => {
  const { exec, calls } = fakeExec();
  await new SupabaseErasureStore(exec).findDerivedFrom(['s1']);
  assert.match(calls[0]!.text, /where derived_from && \$1::uuid\[\]/);
});

test('danglingSupersedeRefs finds rows OUTSIDE the delete set pointing INTO it', async () => {
  const { exec, calls } = fakeExec(() => [{ id: 'x' }]);
  const res = await new SupabaseErasureStore(exec).danglingSupersedeRefs(['a']);
  assert.match(calls[0]!.text, /superseded_by = any\(\$1::uuid\[\]\)/);
  assert.match(calls[0]!.text, /id <> all\(\$1::uuid\[\]\)/);
  assert.deepEqual(res, ['x']);
});

test('clearSupersededByRefs restores-live rows OUTSIDE the delete set that point INTO it (update superseded_by = null)', async () => {
  const { exec, calls } = fakeExec(() => [{ id: 'sbob' }]);
  const res = await new SupabaseErasureStore(exec).clearSupersededByRefs(['D']);
  assert.match(calls[0]!.text, /update memories set superseded_by = null/);
  assert.match(calls[0]!.text, /where superseded_by = any\(\$1::uuid\[\]\) and id <> all\(\$1::uuid\[\]\)/);
  assert.deepEqual(res, ['sbob']);
});

test('clearSupersededByRefs short-circuits on an empty delete set (no query)', async () => {
  const { exec, calls } = fakeExec();
  assert.deepEqual(await new SupabaseErasureStore(exec).clearSupersededByRefs([]), []);
  assert.equal(calls.length, 0);
});

test('hardDeleteMemories is the ONE destructive statement — delete from memories … returning id', async () => {
  const { exec, calls } = fakeExec(() => [{ id: 'd1' }, { id: 'd2' }]);
  const res = await new SupabaseErasureStore(exec).hardDeleteMemories(['d1', 'd2']);
  assert.match(calls[0]!.text, /^delete from memories where id = any\(\$1::uuid\[\]\) returning id/);
  assert.deepEqual(res.deleted, ['d1', 'd2']);
});

test('countResidual counts remaining rows (completeness re-read)', async () => {
  const { exec, calls } = fakeExec(() => [{ n: '2' }]);
  const n = await new SupabaseErasureStore(exec).countResidual(['a', 'b', 'c']);
  assert.match(calls[0]!.text, /select count\(\*\)::text as n from memories where id = any/);
  assert.equal(n, 2);
});

test('writeTombstone inserts the immutable access_audit row with actor_type + uuid + jsonb casts + target_entity_id + after_value', async () => {
  const { exec, calls } = fakeExec();
  const entry: AuditEntry = {
    auditType: 'compliance_erasure',
    actorIdentity: 'sa@client',
    actorType: 'user',
    action: 'memory_erasure_complete',
    targetType: 'entity',
    targetEntityId: 'T',
    reason: 'lawful request',
    pathContext: 'deletion_request:req-1',
    originatingUserId: 'U',
    afterValue: { done: true },
  };
  await new SupabaseErasureStore(exec).writeTombstone(entry);
  const t = calls[0]!.text;
  assert.match(t, /insert into access_audit/);
  assert.match(t, /\$3::actor_type/);
  assert.match(t, /target_entity_id/);
  assert.match(t, /\$6::uuid/); // target_entity_id cast
  assert.match(t, /after_value/);
  assert.match(t, /\$10::jsonb/); // after_value jsonb
  assert.equal(calls[0]!.params[2], 'user');
  assert.equal(calls[0]!.params[9], JSON.stringify({ done: true }));
});

test('the event sink emits both erasure values with the $1::event_type cast (no 22P02 at run time)', async () => {
  const { exec, calls } = fakeExec();
  const sink = new SupabaseErasureEventSink(exec);
  await sink.erasureCompleted({ target: 'T', request_id: 'req-1' });
  await sink.erasureIncomplete({ target: 'T', request_id: 'req-1' });
  for (const c of calls) {
    assert.match(c.text, /insert into event_log/);
    assert.match(c.text, /\$1::event_type/);
    assert.match(c.text, /\$2::uuid\[\]/);
  }
  assert.equal(calls[0]!.params[0], EVT_MEMORY_ERASED);
  assert.equal(calls[1]!.params[0], EVT_MEMORY_ERASURE_INCOMPLETE);
});
