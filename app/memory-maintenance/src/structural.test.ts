// ISSUE-027 — FR-2.MNT.010 weekly structural erosion. AC-2.MNT.010.1 (orphan → maintenance task), .010.2
// (null/invalid embedding → surfaced + routed to re-embed), .010.3 (stuck ingestion-queue item → surfaced/escalated).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryMaintenanceStore } from './store.ts';
import { DEFAULT_MAINTENANCE_CONFIG } from './config.ts';
import { runStructuralErosion, isInvalidEmbedding } from './structural.ts';

const CFG = DEFAULT_MAINTENANCE_CONFIG;
const NOW = Date.parse('2026-07-10');
const T = (daysAgo: number) => new Date(NOW - daysAgo * 24 * 60 * 60 * 1000).toISOString();

test('AC-2.MNT.010.1 — an orphaned memory (no live entity) becomes a maintenance task', async () => {
  const store = new InMemoryMaintenanceStore();
  store.seedEntities([InMemoryMaintenanceStore.entity({ id: 'e1', type: 'Contact', name: 'Acme' })]);
  const orphan = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'dangling', entity_ids: ['ghost'] });
  const ok = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'fine', entity_ids: ['e1'] });
  store.seedMemories([orphan, ok]);

  const res = await runStructuralErosion(store, CFG, NOW);
  assert.deepEqual(res.orphanIds, [orphan.id]);
  assert.ok(store.tasks.some((t) => t.kind === 'orphan' && t.targetId === orphan.id), 'orphan surfaced as a maintenance task');
});

test('AC-2.MNT.010.2 — a memory with a null/invalid embedding is surfaced and routed to re-embed', async () => {
  assert.equal(isInvalidEmbedding([]), true, 'empty vector is invalid');
  assert.equal(isInvalidEmbedding(new Array(1536).fill(0)), true, 'all-zero vector is degenerate/invalid');
  assert.equal(isInvalidEmbedding(new Array(1536).fill(0.01)), false, 'a valid vector is not flagged');

  const store = new InMemoryMaintenanceStore();
  store.seedEntities([InMemoryMaintenanceStore.entity({ id: 'e1', type: 'Contact', name: 'Acme' })]);
  const bad = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'unsearchable', entity_ids: ['e1'], embedding: [] });
  store.seedMemories([bad]);

  const res = await runStructuralErosion(store, CFG, NOW);
  assert.deepEqual(res.nullEmbeddingIds, [bad.id]);
  const task = store.tasks.find((t) => t.kind === 'null_embedding' && t.targetId === bad.id);
  assert.ok(task, 'this is the SOLE detector for a silently-unsearchable row (#1/#3)');
  assert.equal(task!.action, 're-embed', 'routed to re-embed');
});

test('AC-2.MNT.010.3 — an ingestion-queue item stuck past the escalation threshold is surfaced/escalated', async () => {
  const store = new InMemoryMaintenanceStore();
  store.seedEntities([InMemoryMaintenanceStore.entity({ id: 'e1', type: 'Contact', name: 'Acme' })]);
  store.seedQueue([
    InMemoryMaintenanceStore.queueItem({ id: 'q-stuck', state: 'pending', created_at: T(10) }), // > review_escalation_days (7)
    InMemoryMaintenanceStore.queueItem({ id: 'q-fresh', state: 'pending', created_at: T(1) }),
    InMemoryMaintenanceStore.queueItem({ id: 'q-done', state: 'included', created_at: T(30) }),
  ]);

  const res = await runStructuralErosion(store, CFG, NOW);
  assert.deepEqual(res.stuckQueueIds, ['q-stuck'], 'only the pending item past the threshold is stuck');
  const task = store.tasks.find((t) => t.kind === 'stuck_queue' && t.targetId === 'q-stuck');
  assert.ok(task);
  assert.equal(task!.action, 'escalate');
});
