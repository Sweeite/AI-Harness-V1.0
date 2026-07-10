// ISSUE-027 — NFR-OBS.005 (metric-producer liveness: stale, never green). AC-NFR-OBS.005.1: a maintenance producer
// whose heartbeat goes overdue reads 'stale'/'unknown', never a green/healthy value — "no signal" is not "all clear".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryMaintenanceStore } from './store.ts';
import { DEFAULT_MAINTENANCE_CONFIG } from './config.ts';
import { MaintenanceScheduler, STALE_WINDOW_MS } from './scheduler.ts';

const CFG = DEFAULT_MAINTENANCE_CONFIG;
const NOW = Date.parse('2026-07-10');

test('AC-NFR-OBS.005.1 — a maintenance producer that has never run, or is overdue, reads stale — never green', async () => {
  const store = new InMemoryMaintenanceStore();
  const sched = new MaintenanceScheduler(store, CFG);

  // never run → stale (not a false green from absence of data).
  assert.equal(sched.producerHealth('soft_decay', 'daily', NOW), 'stale');

  // ran just now → green.
  await sched.run('soft_decay', 'daily', async () => ({ recordsAffected: 0, detail: 'ok' }), NOW);
  assert.equal(sched.producerHealth('soft_decay', 'daily', NOW), 'green');

  // heartbeat now overdue past the daily stale-window → flips back to stale, never carries a green forward.
  const overdue = NOW + STALE_WINDOW_MS.daily + 1;
  assert.equal(sched.producerHealth('soft_decay', 'daily', overdue), 'stale', 'a stopped producer never masquerades as healthy (#3)');
});
