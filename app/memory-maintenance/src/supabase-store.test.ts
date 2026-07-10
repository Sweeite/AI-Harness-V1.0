// ISSUE-027 — supabase-store.ts OFFLINE tests: drive the live adapter against a fake pg exec seam to assert the SQL
// shape + row mapping + the CAS/idempotency/event_log contracts. The REAL proof the adapter agrees with the live
// schema is the R10 live-adapter smoke, not this test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseMaintenanceStore, EVT_MAINTENANCE_RUN, EVT_CONFIDENCE_CHANGED, EVT_MAINTENANCE_TASK, EVT_MAINTENANCE_MUTATION } from './supabase-store.ts';
import { InMemoryMaintenanceStore } from './store.ts';

interface Call {
  text: string;
  params: unknown[];
}
function fakeExec(rowsFor: (text: string) => any[] = () => []) {
  const calls: Call[] = [];
  const exec = async (text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    return { rows: rowsFor(text) as any[], rowCount: rowsFor(text).length };
  };
  return { exec: exec as any, calls };
}

test('setConfidence issues a targeted UPDATE and fails loud on a 0-row update (no silent no-op)', async () => {
  const { exec, calls } = fakeExec(() => []); // rowCount 0
  const store = new SupabaseMaintenanceStore(exec);
  await assert.rejects(() => store.setConfidence('m1', 0.66), /not found/);
  assert.match(calls[0]!.text, /update memories set confidence/);
  assert.match(calls[0]!.text, /where id = \$1/);
});

test('casSupersede is a compare-and-swap on superseded_by IS NULL and emits a mutation event when it wins', async () => {
  const { exec, calls } = fakeExec((t) => (/update memories set superseded_by/.test(t) ? [{ id: 'm1' }] : []));
  const store = new SupabaseMaintenanceStore(exec);
  const won = await store.casSupersede('old1', 'new1');
  assert.equal(won, true);
  const upd = calls.find((c) => /update memories set superseded_by/.test(c.text))!;
  assert.match(upd.text, /superseded_by is null/, 'CAS guard — a lost race affects 0 rows (ADR-004)');
  assert.ok(calls.some((c) => /insert into event_log/.test(c.text) && c.params[0] === EVT_MAINTENANCE_MUTATION));
});

test('insertDerivedMemory casts the vector + entity_ids and is idempotency-keyed (ON CONFLICT DO NOTHING)', async () => {
  const { exec, calls } = fakeExec((t) => (/insert into memories/.test(t) ? [{ id: 'gen-1' }] : []));
  const store = new SupabaseMaintenanceStore(exec);
  const row = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'merged', entity_ids: ['e1'], embedding: new Array(1536).fill(0.03) });
  const res = await store.insertDerivedMemory(row, ['a', 'b']);
  assert.equal(res.inserted, true);
  const ins = calls.find((c) => /insert into memories/.test(c.text))!;
  assert.match(ins.text, /on conflict \(idempotency_key\) do nothing/);
  assert.match(ins.text, /\$3::vector/);
  assert.match(ins.text, /\$5::uuid\[\]/);
});

test('the observability sinks write event_log with the correct additive event_type casts', async () => {
  const { exec, calls } = fakeExec(() => []);
  const store = new SupabaseMaintenanceStore(exec);
  await store.jobRun({ job: 'soft_decay', cadence: 'daily', startedAt: 'a', finishedAt: 'b', outcome: 'ok', recordsAffected: 2, detail: 'd' });
  await store.confidenceChanged({ memoryId: 'm1', oldConfidence: 0.9, newConfidence: 0.7, cause: 'sor_contradiction', actor: 'svc', reason: 'r', at: 't' });
  await store.task({ kind: 'orphan', targetId: 'm2', action: 're-link', detail: 'd', at: 't' });

  for (const c of calls) assert.match(c.text, /\$1::event_type/, 'every emit casts to the event_type enum');
  assert.equal(calls[0]!.params[0], EVT_MAINTENANCE_RUN);
  assert.equal(calls[1]!.params[0], EVT_CONFIDENCE_CHANGED);
  assert.equal(calls[2]!.params[0], EVT_MAINTENANCE_TASK);
});

test('listMemories maps the pg row shape (vector string → number[], numeric string → number)', async () => {
  const { exec } = fakeExec((t) =>
    /from memories/.test(t)
      ? [{ id: 'm1', type: 'semantic', content: 'c', embedding: '[1,0,0]', embedding_model: 'x', entity_ids: ['e1'], source: 'ai_inferred', source_ref: null, confidence: '0.665', visibility: 'global', sensitivity: 'standard', superseded_by: null, content_hash: 'h', idempotency_key: 'k', expires_at: null, created_at: new Date(0), updated_at: new Date(0) }]
      : [],
  );
  const store = new SupabaseMaintenanceStore(exec);
  const [m] = await store.listMemories();
  assert.deepEqual(m!.embedding, [1, 0, 0]);
  assert.equal(m!.confidence, 0.665);
});
