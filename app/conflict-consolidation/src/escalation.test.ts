import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runEscalationSweep } from './escalation.ts';
import { InMemoryConflictConsolidationStore as Store } from './store.ts';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-07-11T00:00:00Z');
const daysAgo = (n: number) => new Date(now - n * DAY).toISOString();

// ── AC-2.WRT.002.3 — an un-actioned hard conflict past review_escalation_days is escalated (alert + badge) ──
test('AC-2.WRT.002.3 — a pending conflict older than review_escalation_days is escalated (state + escalated_at + alert), NOT auto-resolved', async () => {
  const store = new Store();
  store.seedConflicts([
    Store.conflict({ id: 'old', new_memory: Store.held(), conflicting_memory_ids: ['x'], created_at: daysAgo(9) }),
    Store.conflict({ id: 'fresh', new_memory: Store.held(), conflicting_memory_ids: ['y'], created_at: daysAgo(2) }),
  ]);
  const out = await runEscalationSweep(store, 7, now);
  assert.deepEqual(out.escalatedConflicts, ['old']);
  const snap = store.snapshotConflict('old')!;
  assert.equal(snap.state, 'escalated'); // escalated, NOT resolved
  assert.ok(snap.escalated_at);
  assert.equal(store.snapshotConflict('fresh')!.state, 'pending');
  assert.equal(store.escalatedEvents.length, 1); // one alert (approval_queue_stale, C7 seam)
  assert.equal(store.escalatedEvents[0]!.queue, 'conflicts');
});

// ── AC-2.MNT.014.2 — an un-actioned Personal consolidation approval past review_escalation_days is escalated ──
test('AC-2.MNT.014.2 — a pending consolidation approval older than review_escalation_days is escalated, never silently held', async () => {
  const store = new Store();
  store.seedConsolidations([
    Store.consolidation({ id: 'old', candidate_memory_ids: ['a', 'b'], op: 'merge', created_at: daysAgo(10) }),
    Store.consolidation({ id: 'fresh', candidate_memory_ids: ['c', 'd'], op: 'summarise', created_at: daysAgo(1) }),
  ]);
  const out = await runEscalationSweep(store, 7, now);
  assert.deepEqual(out.escalatedConsolidations, ['old']);
  assert.equal(store.snapshotConsolidation('old')!.state, 'escalated');
  assert.ok(store.snapshotConsolidation('old')!.escalated_at);
  assert.equal(store.snapshotConsolidation('fresh')!.state, 'pending');
  assert.equal(store.escalatedEvents.filter((e) => e.queue === 'consolidation').length, 1);
});

test('escalation is idempotent — a second sweep does not re-escalate an already-escalated item', async () => {
  const store = new Store();
  store.seedConflicts([Store.conflict({ id: 'old', new_memory: Store.held(), conflicting_memory_ids: ['x'], created_at: daysAgo(9) })]);
  await runEscalationSweep(store, 7, now);
  const out2 = await runEscalationSweep(store, 7, now);
  assert.deepEqual(out2.escalatedConflicts, []); // already escalated → no double alert
  assert.equal(store.escalatedEvents.length, 1);
});

test('nothing overdue → no escalation, no alerts', async () => {
  const store = new Store();
  store.seedConflicts([Store.conflict({ id: 'fresh', new_memory: Store.held(), conflicting_memory_ids: ['x'], created_at: daysAgo(1) })]);
  store.seedConsolidations([Store.consolidation({ id: 'freshc', candidate_memory_ids: ['a'], op: 'merge', created_at: daysAgo(1) })]);
  const out = await runEscalationSweep(store, 7, now);
  assert.deepEqual(out.escalatedConflicts, []);
  assert.deepEqual(out.escalatedConsolidations, []);
  assert.equal(store.escalatedEvents.length, 0);
});
