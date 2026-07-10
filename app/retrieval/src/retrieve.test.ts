// ISSUE-025 — retrieve.ts INTEGRATION tests: the whole read path, covering the §4 Definition-of-done ACs that are
// properties of the COMPOSITION (dual search, clearance-BEFORE-ranking, rank/trim, inject, sufficiency, observability).
// The load-bearing one is AC-2.RET.004.1: a memory the requester cannot see leaves NO trace in the output — it is
// never ranked, scored, ordered, or surfaced (the #2 invariant this gate exists for).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retrieve, type RetrievalRequest } from './retrieve.ts';
import { InMemoryRetrievalStore } from './store.ts';
import { DEFAULT_RETRIEVAL_CONFIG } from './config.ts';
import { axisVector, fullClearanceHuman, mkEntity, mkMemory } from './testkit.ts';
import type { Requester } from './clearance.ts';

const NOW = '2026-07-10T00:00:00.000Z';
const acme = mkEntity({ id: 'e1', type: 'client', name: 'Acme Corp', maturity: 0.9 });
const globex = mkEntity({ id: 'e2', type: 'client', name: 'Globex', maturity: 0.9 });

function baseReq(over: Partial<RetrievalRequest> = {}): RetrievalRequest {
  return {
    mentions: [{ name: 'Acme Corp', type: 'client' }],
    queryEmbedding: axisVector(0),
    requester: fullClearanceHuman(),
    nowIso: NOW,
    actorIdentity: 'agent:memory',
    originatingUserId: 'user-1',
    config: DEFAULT_RETRIEVAL_CONFIG,
    ...over,
  };
}

test('AC-2.RET.002.1 — dual search produces BOTH a keyword (entity-scoped) and a vector candidate set', async () => {
  const store = new InMemoryRetrievalStore();
  store.seedEntities([acme, globex]);
  store.seedMemories([
    mkMemory({ id: 'kw', entity_ids: ['e1'], embedding: axisVector(5), confidence: 0.9 }), // keyword hit, low cosine
    mkMemory({ id: 'vec', entity_ids: ['e2'], embedding: axisVector(0), confidence: 0.9 }), // vector hit (cosine 1), other entity
  ]);
  const res = await retrieve(store, baseReq());
  assert.ok(res.counts.keyword >= 1, 'keyword arm produced candidates');
  assert.ok(res.counts.vector >= 1, 'vector arm produced candidates');
  const ids = res.ranked.map((r) => r.candidate.memory.id).sort();
  assert.deepEqual(ids, ['kw', 'vec'], 'the union of both arms is ranked');
});

test('AC-2.RET.004.1 — an out-of-clearance candidate (even the BEST match) is excluded BEFORE ranking', async () => {
  const store = new InMemoryRetrievalStore();
  store.seedEntities([acme]);
  store.seedMemories([
    // the out-of-clearance memory is the STRONGEST match (cosine 1, fresh, confident) — if clearance ran AFTER ranking
    // it would rank #1. It is 'confidential' and the requester holds no clearance → it must never appear.
    mkMemory({ id: 'secret', entity_ids: ['e1'], embedding: axisVector(0), sensitivity: 'confidential', confidence: 0.99, created_at: NOW }),
    mkMemory({ id: 'ok', entity_ids: ['e1'], embedding: axisVector(3), sensitivity: 'standard', confidence: 0.8 }),
  ]);
  const requester: Requester = { path: 'human', aal2: true, visibility: ['global', 'team', 'private'], clearances: [], restricted: [] };
  const res = await retrieve(store, baseReq({ requester }));
  const ids = res.ranked.map((r) => r.candidate.memory.id);
  assert.ok(!ids.includes('secret'), 'the confidential memory is NOT ranked');
  assert.ok(!res.context.provenanceIds.includes('secret'), 'and NOT injected (no trace in output)');
  assert.equal(res.counts.droppedByClearance, 1, 'the #2 gate dropped exactly it');
  assert.deepEqual(ids, ['ok'], 'only the cleared memory survives to ranking');
});

test('AC-2.RET.004.2 — an out-of-agent-scope candidate is dropped before ranking (OD-081), never widening clearance', async () => {
  const store = new InMemoryRetrievalStore();
  store.seedEntities([acme, globex]);
  store.seedMemories([
    mkMemory({ id: 'in', entity_ids: ['e1'], embedding: axisVector(0), confidence: 0.9 }),
    mkMemory({ id: 'out', entity_ids: ['e2'], embedding: axisVector(0), confidence: 0.9 }),
  ]);
  const agent: Requester = { path: 'agent', aal2: true, visibility: ['global', 'team', 'private'], clearances: [], restricted: [], agentScope: { entityIds: ['e1'] } };
  const res = await retrieve(store, baseReq({ requester: agent, mentions: [{ name: 'Acme Corp', type: 'client' }, { name: 'Globex', type: 'client' }] }));
  const ids = res.ranked.map((r) => r.candidate.memory.id);
  assert.deepEqual(ids, ['in'], 'only the in-scope memory is ranked; the out-of-scope one dropped before ranking');
});

test('AC-2.RET.005.1 + AC-NFR-PERF.006.1 — top-N by weighted score (procedural boost), capped at memories_injected_per_task', async () => {
  const store = new InMemoryRetrievalStore();
  store.seedEntities([acme]);
  const many = Array.from({ length: 12 }, (_, i) =>
    mkMemory({ id: `m${i}`, entity_ids: ['e1'], embedding: axisVector(0), confidence: 0.8, created_at: NOW }),
  );
  // one procedural memory with otherwise-identical signals should out-rank its semantic peers (×1.2).
  many.push(mkMemory({ id: 'proc', type: 'procedural', entity_ids: ['e1'], embedding: axisVector(0), confidence: 0.8, created_at: NOW }));
  store.seedMemories(many);
  const res = await retrieve(store, baseReq({ config: { ...DEFAULT_RETRIEVAL_CONFIG, memoriesInjectedPerTask: 7 } }));
  assert.equal(res.context.memories.length, 7, 'capped at N=7 (NFR-PERF.006)');
  assert.equal(res.ranked[0]!.candidate.memory.id, 'proc', 'the procedural memory ranks first (×1.2 boost)');
});

test('AC-2.RET.006.1 — Restricted is audited but NEVER auto-injected, even for a cleared holder', async () => {
  const store = new InMemoryRetrievalStore();
  store.seedEntities([acme]);
  store.seedMemories([
    mkMemory({ id: 'r', entity_ids: ['e1'], embedding: axisVector(0), sensitivity: 'restricted', confidence: 0.99, created_at: NOW }),
    mkMemory({ id: 'ok', entity_ids: ['e1'], embedding: axisVector(1), sensitivity: 'standard', confidence: 0.8 }),
  ]);
  // requester HOLDS the restricted grant (cleared to view) — still must not be auto-injected.
  const requester = fullClearanceHuman({ restricted: [{ entityId: 'e1', entityType: null }] });
  const res = await retrieve(store, baseReq({ requester }));
  assert.ok(!res.context.provenanceIds.includes('r'), 'restricted not injected even though cleared');
  assert.deepEqual(res.context.memories.map((m) => m.tag), ['[Semantic]'], 'only the standard memory, type-tagged');
  assert.equal(res.counts.sensitiveAudited, 1, 'the restricted candidate access WAS audited (FR-1.AUD.001)');
  assert.equal(store.sensitiveAudits.length, 1);
  assert.equal(store.sensitiveAudits[0]!.memoryId, 'r');
});

test('AC-2.RET.007.1 — thin retrieval on a low-Maturity entity raises [Building]', async () => {
  const store = new InMemoryRetrievalStore();
  store.seedEntities([mkEntity({ id: 'e1', type: 'client', name: 'Acme Corp', maturity: 0.1 })]); // immature < 50%
  // no memory matches the query well → thin retrieval (empty injected set → score 0 < 0.6).
  store.seedMemories([mkMemory({ id: 'far', entity_ids: ['e1'], embedding: axisVector(900), confidence: 0.8 })]);
  const res = await retrieve(store, baseReq({ queryEmbedding: axisVector(0) }));
  assert.equal(res.sufficiency.building, true, 'thin + immature → [Building]');
  assert.equal(res.sufficiency.verdict, 'building');
});

test('AC-2.RET.007.1 — thin retrieval on a MATURE entity is plain [Unknown], not [Building]', async () => {
  const store = new InMemoryRetrievalStore();
  store.seedEntities([mkEntity({ id: 'e1', type: 'client', name: 'Acme Corp', maturity: 0.95 })]);
  store.seedMemories([mkMemory({ id: 'far', entity_ids: ['e1'], embedding: axisVector(900), confidence: 0.8 })]);
  const res = await retrieve(store, baseReq({ queryEmbedding: axisVector(0) }));
  assert.equal(res.sufficiency.building, false, 'mature entity → no [Building]');
  assert.equal(res.sufficiency.verdict, 'unknown');
});

test('AC-2.RET.007.2 — when memory is the source, provenance is available for the Cited pill', async () => {
  const store = new InMemoryRetrievalStore();
  store.seedEntities([acme]);
  store.seedMemories([mkMemory({ id: 'cited', entity_ids: ['e1'], embedding: axisVector(0), confidence: 0.95, created_at: NOW })]);
  const res = await retrieve(store, baseReq());
  assert.deepEqual(res.context.provenanceIds, ['cited'], 'injected memory ids exposed as provenance');
});

test('observability — a memory_read sample is emitted with the counts + verdict', async () => {
  const store = new InMemoryRetrievalStore();
  store.seedEntities([acme]);
  store.seedMemories([mkMemory({ id: 'a', entity_ids: ['e1'], embedding: axisVector(0), confidence: 0.9 })]);
  const res = await retrieve(store, baseReq());
  assert.equal(store.readEvents.length, 1);
  assert.equal(store.readEvents[0]!.payload.verdict, res.sufficiency.verdict);
  assert.deepEqual(store.readEvents[0]!.payload.provenanceIds, res.context.provenanceIds);
});

test('a task naming no known entity still runs the vector arm (keyword empty)', async () => {
  const store = new InMemoryRetrievalStore();
  store.seedEntities([acme]);
  store.seedMemories([mkMemory({ id: 'v', entity_ids: ['e1'], embedding: axisVector(0), confidence: 0.9 })]);
  const res = await retrieve(store, baseReq({ mentions: [{ name: 'Unknown Co', type: 'client' }] }));
  assert.equal(res.entityIds.length, 0, 'no keyword seed');
  assert.equal(res.counts.keyword, 0);
  assert.ok(res.counts.vector >= 1, 'vector arm still surfaced the memory');
});
