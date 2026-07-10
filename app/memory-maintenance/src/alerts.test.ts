// ISSUE-027 — FR-2.MNT.003 amber + bulk-drop alerts. AC-2.MNT.003.1 (amber crossing → review flag, before the 0.7
// retrieval floor) + AC-2.MNT.003.2 (11 drops in 30 min → systemic alert).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryMaintenanceStore } from './store.ts';
import { DEFAULT_MAINTENANCE_CONFIG } from './config.ts';
import { amberCrossed, bulkDropFired } from './alerts.ts';
import { runSoftDecay } from './decay.ts';

const CFG = DEFAULT_MAINTENANCE_CONFIG;
const NOW = Date.parse('2026-07-10');
const OLD = new Date(NOW - Math.round(8 * (365.25 / 12) * 24 * 60 * 60 * 1000)).toISOString();

test('AC-2.MNT.003.1 — a memory crossing below the 0.75 amber threshold raises a proactive review flag (before it drops below the 0.7 retrieval floor)', async () => {
  // unit: only the DOWNWARD crossing fires; amber (0.75) sits above the retrieval floor (0.7).
  assert.equal(amberCrossed(0.76, 0.722, CFG), true);
  assert.equal(amberCrossed(0.74, 0.7, CFG), false, 'already below amber — not a crossing');
  assert.ok(CFG.amberZoneThreshold > CFG.retrievalConfidenceThreshold, 'amber fires BEFORE invisibility (audit H27)');

  const store = new InMemoryMaintenanceStore();
  const m = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'x', entity_ids: ['e1'], confidence: 0.76, created_at: OLD });
  store.seedMemories([m]);
  await runSoftDecay(store, CFG, NOW); // 0.76 × 0.95 = 0.722 → crosses 0.75, still above 0.7

  const amber = store.alerts.find((a) => a.kind === 'amber_zone' && a.memoryIds.includes(m.id));
  assert.ok(amber, 'an amber_zone review flag is raised on the crossing');
  const [after] = await store.listMemories();
  assert.ok(after!.confidence! > CFG.retrievalConfidenceThreshold, 'still retrievable — the flag fired proactively, before invisibility');
});

test('AC-2.MNT.003.2 — 11 memories dropping within 30 minutes fires a systemic bulk-drop alert', async () => {
  // unit: 11 drops inside the 60-min window (> the count of 10) fires.
  const base = NOW;
  const elevenIn30Min = Array.from({ length: 11 }, (_, i) => base + i * 3 * 60 * 1000); // spread over 30 min
  assert.equal(bulkDropFired(elevenIn30Min, CFG), true);
  assert.equal(bulkDropFired(elevenIn30Min.slice(0, 10), CFG), false, '10 is not MORE THAN 10');

  // integration: 11 independent (distinct-entity, same-age) memories all decay in one run → a bulk alert.
  const store = new InMemoryMaintenanceStore();
  const rows = Array.from({ length: 11 }, (_, i) => InMemoryMaintenanceStore.memory({ type: 'semantic', content: `m${i}`, entity_ids: [`e${i}`], confidence: 0.7, created_at: OLD }));
  store.seedMemories(rows);
  const res = await runSoftDecay(store, CFG, NOW);
  assert.equal(res.decayedIds.length, 11);
  assert.equal(res.bulkAlert, true);
  assert.ok(store.alerts.some((a) => a.kind === 'bulk_drop'), 'a systemic bulk-drop alert fires (something changed wholesale)');
});
