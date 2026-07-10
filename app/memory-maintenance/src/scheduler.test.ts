// ISSUE-027 — FR-2.MNT.015 the maintenance schedule never fails silently. AC-2.MNT.015.1 (every run logs
// time/outcome/records), .015.2 (a failure is surfaced/alerted, not silent), .015.3 (the zero-drop Haiku-gate audit
// still logs a flagged run record).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryMaintenanceStore } from './store.ts';
import { DEFAULT_MAINTENANCE_CONFIG } from './config.ts';
import { MaintenanceScheduler, runHaikuGateAudit } from './scheduler.ts';

const CFG = DEFAULT_MAINTENANCE_CONFIG;
const NOW = Date.parse('2026-07-10');

test('AC-2.MNT.015.1 — every job run logs a record with time, outcome, and records-affected', async () => {
  const store = new InMemoryMaintenanceStore();
  const sched = new MaintenanceScheduler(store, CFG);
  const rec = await sched.run('soft_decay', 'daily', async () => ({ recordsAffected: 3, detail: 'decayed 3' }), NOW);

  assert.equal(rec.outcome, 'ok');
  assert.equal(rec.recordsAffected, 3);
  assert.ok(rec.startedAt && rec.finishedAt, 'time captured');
  assert.equal(store.jobRuns.length, 1, 'the run is logged to the sink');
  assert.equal(store.jobRuns[0]!.job, 'soft_decay');
});

test('AC-2.MNT.015.2 — a job failure is surfaced and alerted, never silently swallowed', async () => {
  const store = new InMemoryMaintenanceStore();
  const sched = new MaintenanceScheduler(store, CFG);
  const rec = await sched.run('merge', 'weekly', async () => {
    throw new Error('vector index unavailable');
  }, NOW);

  assert.equal(rec.outcome, 'failed');
  assert.match(rec.error ?? '', /vector index unavailable/, 'the error is captured LOUD (not swallowed)');
  assert.equal(store.jobRuns.length, 1, 'a failed run is STILL logged (#3)');
  assert.equal(store.jobRuns[0]!.outcome, 'failed');
  assert.ok(store.alerts.some((a) => a.kind === 'job_failure'), 'and alerted');
});

test('AC-2.MNT.015.3 — the weekly Haiku-gate audit with zero drops still logs a flagged run record', async () => {
  const store = new InMemoryMaintenanceStore();
  const sched = new MaintenanceScheduler(store, CFG);
  const rec = await sched.run('haiku_gate_audit', 'weekly', async () => runHaikuGateAudit(0), NOW);

  assert.equal(rec.outcome, 'ok');
  assert.equal(rec.recordsAffected, 0);
  assert.equal(rec.flaggedEmpty, true, 'an empty audit week is FLAGGED, not silently skipped');
  assert.equal(store.jobRuns.length, 1, 'still logged');
  assert.equal(store.jobRuns[0]!.flaggedEmpty, true);
});

test('the completion-rate metric reads unknown (null) with no runs, never a false 100%', () => {
  const store = new InMemoryMaintenanceStore();
  const sched = new MaintenanceScheduler(store, CFG);
  assert.equal(sched.completionRate(), null, 'no data ≠ all-clear (#3)');
});
