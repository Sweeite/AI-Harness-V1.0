// ISSUE-027 — FR-2.MNT.009 daily coverage erosion. AC-2.MNT.009.1 (an entity with no new memory in 31 days is
// flagged stale).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryMaintenanceStore } from './store.ts';
import { DEFAULT_MAINTENANCE_CONFIG } from './config.ts';
import { runCoverageErosion } from './coverage.ts';

const CFG = DEFAULT_MAINTENANCE_CONFIG;
const NOW = Date.parse('2026-07-10');
const T = (daysAgo: number) => new Date(NOW - daysAgo * 24 * 60 * 60 * 1000).toISOString();

test('AC-2.MNT.009.1 — an entity with no new memory in 31 days is flagged stale', async () => {
  const store = new InMemoryMaintenanceStore();
  const stale = InMemoryMaintenanceStore.entity({ id: 'e1', type: 'Contact', name: 'DormantCo' });
  const fresh = InMemoryMaintenanceStore.entity({ id: 'e2', type: 'Contact', name: 'ActiveCo' });
  store.seedEntities([stale, fresh]);
  store.seedMemories([
    InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'old fact', entity_ids: ['e1'], created_at: T(31) }),
    InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'recent fact', entity_ids: ['e2'], created_at: T(2) }),
  ]);

  const res = await runCoverageErosion(store, CFG, NOW);
  assert.deepEqual(res.staleEntityIds, ['e1'], 'only the 31-days-stale entity (window 30) is flagged');
  const task = store.tasks.find((t) => t.kind === 'coverage_stale' && t.targetId === 'e1');
  assert.ok(task, 'a coverage_stale maintenance task is surfaced (#3 — not silently tolerated)');
});
