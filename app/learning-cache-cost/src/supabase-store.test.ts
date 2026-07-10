// ISSUE-066 (C8 LRN/COST) — live pg adapter SEAM tests. These do NOT hit a live DB (the R10 smoke does); they inject a
// recording QueryExec to assert the adapters issue the RIGHT SQL shape + params + map rows back to the port contract
// 1:1 with the in-memory reference model. Catches the #1 live-adapter defect class (a wrong column / a param-order slip
// / a mis-cast) offline, before the smoke.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SupabaseCacheStore,
  SupabaseLearningStore,
  SupabaseEventSink,
  SupabaseSecondarySink,
} from './supabase-store.ts';
import { EVT_CACHE_HIT, type LrnCostEvent } from './store.ts';

type Call = { text: string; params: unknown[] };
function recorder(responses: Array<{ rows: any[]; rowCount?: number }> = []) {
  const calls: Call[] = [];
  let i = 0;
  const exec = async (text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    return responses[i++] ?? { rows: [], rowCount: 0 };
  };
  return { calls, exec: exec as any };
}

test('SupabaseCacheStore.find: exact scope-aware key (set-equality via @>/<@ + version), null version short-circuits', async () => {
  const { calls, exec } = recorder([
    { rows: [{ id: 'c1', agent_id: 'a', scope_entity_ids: ['e1'], memory_version: 'v1', output: { x: 1 }, expires_at: new Date(0), created_at: new Date(0) }] },
  ]);
  const store = new SupabaseCacheStore('postgres://x?sslmode=disable', exec);

  // A null version never queries — an unconfirmed version can't match a key (#2).
  assert.equal(await store.find({ agentId: 'a', scopeEntityIds: ['e1'], memoryVersion: null }), null);
  assert.equal(calls.length, 0);

  const hit = await store.find({ agentId: 'a', scopeEntityIds: ['e1'], memoryVersion: 'v1' });
  assert.equal(hit?.id, 'c1');
  assert.match(calls[0]!.text, /scope_entity_ids @> \$3::uuid\[\]/);
  assert.match(calls[0]!.text, /scope_entity_ids <@ \$3::uuid\[\]/); // set equality both ways
  assert.deepEqual(calls[0]!.params, ['a', 'v1', ['e1']]);
});

test('SupabaseCacheStore.invalidateIntersecting: array-overlap DELETE ... RETURNING id (loud, scope-aware)', async () => {
  const { calls, exec } = recorder([{ rows: [{ id: 'c1' }, { id: 'c2' }] }]);
  const store = new SupabaseCacheStore('postgres://x?sslmode=disable', exec);
  const dropped = await store.invalidateIntersecting(['e1', 'e2']);
  assert.deepEqual(dropped, ['c1', 'c2']);
  assert.match(calls[0]!.text, /scope_entity_ids && \$1::uuid\[\]/);
  assert.match(calls[0]!.text, /returning id/);
  // Empty written set is a no-op (never a blanket purge).
  assert.deepEqual(await store.invalidateIntersecting([]), []);
});

test('SupabaseLearningStore.bumpRoutingMismatch: upsert-increment returns the new count', async () => {
  const { calls, exec } = recorder([{ rows: [{ routing_mismatch_count: 4 }] }]);
  const store = new SupabaseLearningStore('postgres://x?sslmode=disable', exec);
  assert.equal(await store.bumpRoutingMismatch('agent_client'), 4);
  assert.match(calls[0]!.text, /insert into agent_health_metrics/);
  assert.match(calls[0]!.text, /on conflict \(agent_id\) do update/);
  assert.match(calls[0]!.text, /routing_mismatch_count = agent_health_metrics\.routing_mismatch_count \+ 1/);
});

test('SupabaseLearningStore.planOutcomes: reads execution_plans + a TEXT-cast routing_outcome join (no 22P02 on a missing enum value)', async () => {
  const { calls, exec } = recorder([
    { rows: [{ task_type_name: 'client_brief', plan_version_id: 'p1', routed_agent_id: 'agent_client', status: 'success', rerouted_to_agent_id: null }] },
  ]);
  const store = new SupabaseLearningStore('postgres://x?sslmode=disable', exec);
  const rows = await store.planOutcomes('client_brief');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.routed_agent_id, 'agent_client');
  assert.match(calls[0]!.text, /ev\.event_type::text = \$2/); // TEXT cast — never casts a possibly-absent enum literal
  assert.equal(calls[0]!.params[1], 'routing_outcome');
});

test('SupabaseLearningStore.planOutcomes: drops rows with no routed agent or an unknown status (never fabricates an outcome)', async () => {
  const { exec } = recorder([
    { rows: [
      { task_type_name: 't', plan_version_id: 'p1', routed_agent_id: null, status: null, rerouted_to_agent_id: null },
      { task_type_name: 't', plan_version_id: 'p2', routed_agent_id: 'a', status: 'weird', rerouted_to_agent_id: null },
    ] },
  ]);
  const store = new SupabaseLearningStore('postgres://x?sslmode=disable', exec);
  assert.deepEqual(await store.planOutcomes(), []);
});

test('SupabaseEventSink.append: inserts into event_log with the ::event_type cast + rejects an empty summary', async () => {
  const { calls, exec } = recorder([{ rows: [] }]);
  const sink = new SupabaseEventSink('postgres://x?sslmode=disable', exec);
  const ev: LrnCostEvent = { event_type: EVT_CACHE_HIT, entity_ids: ['e1'], summary: 'hit', payload: { a: 1 } };
  await sink.append(ev);
  assert.match(calls[0]!.text, /insert into event_log/);
  assert.match(calls[0]!.text, /\$1::event_type/);
  await assert.rejects(() => sink.append({ ...ev, summary: '   ' }), /summary must never be empty/);
});

test('SupabaseSecondarySink.reportPrimaryFailure: writes a notifications row (NOT event_log) — the reporter is not the thing that failed', async () => {
  const { calls, exec } = recorder([{ rows: [] }]);
  const sink = new SupabaseSecondarySink('postgres://x?sslmode=disable', exec);
  await sink.reportPrimaryFailure({ event_type: EVT_CACHE_HIT, entity_ids: [], summary: 's', payload: {} }, new Error('boom'));
  assert.match(calls[0]!.text, /insert into notifications/);
  assert.doesNotMatch(calls[0]!.text, /event_log/);
  assert.match(calls[0]!.text, /'cost_threshold_breach'/); // an existing alert_type enum value (no new enum needed)
});
