// ISSUE-027 — FR-2.MNT.016 feedback loop. AC-2.MNT.016.1 (a human edit is logged with user/time/reason and goes
// through the sole writer).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryMaintenanceStore } from './store.ts';
import { DEFAULT_MAINTENANCE_CONFIG } from './config.ts';
import { recordHumanCorrection, recordUsageOutcome, humanDirectWrite } from './feedback.ts';

const CFG = DEFAULT_MAINTENANCE_CONFIG;
const NOW = Date.parse('2026-07-10');

test('AC-2.MNT.016.1 — a human edit is logged with user/time/reason and goes through the sole writer', async () => {
  const store = new InMemoryMaintenanceStore();
  const m = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'price is $50', entity_ids: ['e1'], confidence: 0.9 });
  store.seedMemories([m]);
  const [row] = await store.listMemories();

  const res = await recordHumanCorrection(store, row!, 'user-alice', 'price changed to $80', 'edit', CFG, NOW);
  assert.equal(res.moved, true);
  assert.equal(res.newConfidence, 0.75, '0.90 − 0.15 (human edit)');

  const change = store.confidenceChanges.at(-1)!;
  assert.equal(change.actor, 'user-alice', 'logged WHO');
  assert.equal(change.at, new Date(NOW).toISOString(), 'logged WHEN');
  assert.match(change.reason, /price changed to \$80/, 'logged WHY');
  assert.equal(change.cause, 'human_edit');

  // "goes through the sole writer": the confidence is persisted via the governed port (setConfidence), so the store
  // reflects it — there is no side-channel mutation path in this slice.
  const [after] = await store.listMemories();
  assert.equal(after!.confidence, 0.75);
});

test('a useful retrieval raises confidence (+0.02); a human direct-write enters at 1.0 / human_verified via the sole writer', async () => {
  const store = new InMemoryMaintenanceStore();
  const m = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'x', entity_ids: ['e1'], confidence: 0.8 });
  store.seedMemories([m]);
  const [row] = await store.listMemories();
  const used = await recordUsageOutcome(store, row!, true, 'run-7', CFG, NOW);
  assert.equal(used.newConfidence, 0.82);

  const dw = await humanDirectWrite(store, { type: 'semantic', content: 'ceo is Bob', entity_ids: ['e1'], visibility: 'global', sensitivity: 'standard', embedding: new Array(1536).fill(0.02) }, 'user-alice', 'known fact', NOW);
  assert.equal(dw.inserted, true);
  const all = await store.listMemories();
  const written = all.find((x) => x.id === dw.memoryId)!;
  assert.equal(written.source, 'human_verified');
  assert.equal(written.confidence, 1.0, 'direct human write enters at 1.0');
  assert.ok(store.confidenceChanges.some((c) => c.cause === 'human_direct_write' && c.actor === 'user-alice'), 'logged as a feedback signal');
});
