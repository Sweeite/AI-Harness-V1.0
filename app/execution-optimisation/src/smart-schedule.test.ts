// ISSUE-054 (C5 OPT) — FR-5.OPT.002 Smart scheduling. Proves AC-5.OPT.002.1: enabled + busy ⇒ eligible non-urgent
// tasks defer to a quiet window; disabled ⇒ plain cadence. Plus the invariant that urgent tasks are NEVER deferred.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideSchedule, type ScheduledTask, type QueueState } from './smart-schedule.ts';

const task = (over: Partial<ScheduledTask> = {}): ScheduledTask => ({
  task_id: 't1',
  urgent: false,
  cadence_run_at: 1000,
  ...over,
});
const busy: QueueState = { busy: true, next_quiet_window_at: 5000 };
const quiet: QueueState = { busy: false, next_quiet_window_at: 5000 };

test('AC-5.OPT.002.1 — enabled + busy queue ⇒ eligible non-urgent task defers to the quiet window', () => {
  const d = decideSchedule(task(), busy, { smartSchedulingEnabled: true });
  assert.equal(d.action, 'defer');
  assert.equal(d.run_at, 5000);
});

test('AC-5.OPT.002.1 — disabled ⇒ plain cadence even when the queue is busy (FLAG-OFF regression)', () => {
  const d = decideSchedule(task(), busy, { smartSchedulingEnabled: false });
  assert.equal(d.action, 'run_now');
  assert.equal(d.run_at, 1000); // its plain cadence tick
});

test('enabled + quiet queue ⇒ run now (no congestion to avoid)', () => {
  const d = decideSchedule(task(), quiet, { smartSchedulingEnabled: true });
  assert.equal(d.action, 'run_now');
  assert.equal(d.run_at, 1000);
});

test('an URGENT task is NEVER deferred, even enabled + busy (#2/#3)', () => {
  const d = decideSchedule(task({ urgent: true }), busy, { smartSchedulingEnabled: true });
  assert.equal(d.action, 'run_now');
  assert.equal(d.run_at, 1000);
});

test('default config (flag off) runs on cadence', () => {
  const d = decideSchedule(task(), busy);
  assert.equal(d.action, 'run_now');
});

test('schedulable-later — a non-urgent task is NOT deferred past its latest-safe-run deadline (no starvation, #3)', () => {
  // Regression: "Eligible = non-urgent AND schedulable-later". A deferral that would push the task PAST its deadline
  // is not schedulable-later, so it must run on cadence rather than be starved in a far-future quiet window.
  const deadlineBeforeWindow = task({ latest_safe_run_at: 4000 }); // window is at 5000 (busy) — deferral overshoots
  const d = decideSchedule(deadlineBeforeWindow, busy, { smartSchedulingEnabled: true });
  assert.equal(d.action, 'run_now');
  assert.equal(d.run_at, 1000); // its plain cadence tick, not the past-deadline window
});

test('schedulable-later — a non-urgent task WHOSE deadline still fits the quiet window is deferred as normal', () => {
  const deadlineAfterWindow = task({ latest_safe_run_at: 9000 }); // window at 5000 fits before the 9000 deadline
  const d = decideSchedule(deadlineAfterWindow, busy, { smartSchedulingEnabled: true });
  assert.equal(d.action, 'defer');
  assert.equal(d.run_at, 5000);
});
