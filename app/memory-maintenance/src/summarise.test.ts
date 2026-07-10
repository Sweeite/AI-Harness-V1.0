// ISSUE-027 — FR-2.MNT.007 weekly summarise. AC-2.MNT.007.1 (an entity with 10 new episodics → one semantic memory
// referencing the cluster, and the episodics are retained as the evidence layer).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryMaintenanceStore } from './store.ts';
import { DEFAULT_MAINTENANCE_CONFIG } from './config.ts';
import { runSummarise } from './summarise.ts';

const CFG = DEFAULT_MAINTENANCE_CONFIG;
const NOW = Date.parse('2026-07-10');
const T = (daysAgo: number) => new Date(NOW - daysAgo * 24 * 60 * 60 * 1000).toISOString();

test('AC-2.MNT.007.1 — an entity with 10 new episodics gets one semantic summary referencing the cluster; the episodics are retained', async () => {
  const store = new InMemoryMaintenanceStore();
  const entity = InMemoryMaintenanceStore.entity({ id: 'e1', type: 'Contact', name: 'Acme' });
  const episodics = Array.from({ length: 10 }, (_, i) => InMemoryMaintenanceStore.memory({ type: 'episodic', content: `call ${i}`, entity_ids: ['e1'], sensitivity: 'standard', created_at: T(20 - i) }));
  store.seedEntities([entity]);
  store.seedMemories(episodics);

  const res = await runSummarise(store, CFG, NOW);
  assert.equal(res.summaries.length, 1);
  const { summaryId, clusterIds } = res.summaries[0]!;

  const all = await store.listMemories();
  const summary = all.find((m) => m.id === summaryId)!;
  assert.equal(summary.type, 'semantic', 'a semantic memory is created');
  assert.equal(clusterIds.length, 10, 'it references the 10-episode cluster');
  assert.deepEqual(store.derivedFrom.get(summaryId)!.sort(), episodics.map((m) => m.id).sort());

  for (const e of episodics) {
    const after = all.find((m) => m.id === e.id)!;
    assert.equal(after.superseded_by, null, 'each episodic is RETAINED (evidence layer never deleted/superseded, #1)');
  }
  assert.equal(all.length, 11, '10 episodics + 1 new semantic summary');
});

test('below the trigger, no summary is created; Personal episodics are never folded', async () => {
  const store = new InMemoryMaintenanceStore();
  store.seedEntities([InMemoryMaintenanceStore.entity({ id: 'e1', type: 'Contact', name: 'Acme' })]);
  // 9 standard episodics — under the trigger of 10.
  store.seedMemories(Array.from({ length: 9 }, (_, i) => InMemoryMaintenanceStore.memory({ type: 'episodic', content: `c${i}`, entity_ids: ['e1'], created_at: T(i) })));
  const res = await runSummarise(store, CFG, NOW);
  assert.equal(res.summaries.length, 0);

  // 10 PERSONAL episodics — never auto-summarised; queued instead.
  const store2 = new InMemoryMaintenanceStore();
  store2.seedEntities([InMemoryMaintenanceStore.entity({ id: 'e1', type: 'Contact', name: 'Acme' })]);
  store2.seedMemories(Array.from({ length: 10 }, (_, i) => InMemoryMaintenanceStore.memory({ type: 'episodic', content: `p${i}`, entity_ids: ['e1'], sensitivity: 'personal', created_at: T(i) })));
  const res2 = await runSummarise(store2, CFG, NOW);
  assert.equal(res2.summaries.length, 0, 'Personal episodics are excluded from the cluster (FR-2.MNT.014)');
  assert.equal(res2.personalSkipped.length, 10);
  assert.ok(store2.tasks.some((t) => t.kind === 'personal_consolidation'));
});
