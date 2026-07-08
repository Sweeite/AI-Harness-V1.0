// ISSUE-065 — FR-8.HLTH.001: per-agent success/failure rate + last-run. AC-8.HLTH.001.1 / .2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryAgentHealthStore } from './store.ts';
import { aggregateOutcomes, runHealthCycle, viewMetric } from './health.ts';

const NOW = Date.parse('2026-07-08T12:00:00.000Z');

test('aggregateOutcomes — success/failure rate + last-run from outcomes', () => {
  const agg = aggregateOutcomes([
    { agentId: 'a', outcome: 'success', at: '2026-07-08T10:00:00.000Z' },
    { agentId: 'a', outcome: 'success', at: '2026-07-08T11:00:00.000Z' },
    { agentId: 'a', outcome: 'failure', at: '2026-07-08T09:00:00.000Z' },
    { agentId: 'a', outcome: 'failure', at: '2026-07-08T08:00:00.000Z' },
  ]);
  assert.equal(agg.successRate, 0.5);
  assert.equal(agg.failureRate, 0.5);
  assert.equal(agg.lastRun, '2026-07-08T11:00:00.000Z'); // max timestamp
  assert.equal(agg.total, 4);
});

test('aggregateOutcomes — zero outcomes ⇒ null rates (unknown, never a fabricated 0/1) (#3)', () => {
  const agg = aggregateOutcomes([]);
  assert.equal(agg.successRate, null);
  assert.equal(agg.failureRate, null);
  assert.equal(agg.lastRun, null);
});

// AC-8.HLTH.001.1 — Given agent task outcomes, When aggregated, Then success/failure rate + last-run are
// available to C7 (readable back off the metric store).
test('AC-8.HLTH.001.1 — the cycle produces success/failure rate + last-run readable by C7', async () => {
  const store = new InMemoryAgentHealthStore();
  store.setAgent('agent-1', { scope: ['leads'] });
  store.setOutcomes('agent-1', [
    { agentId: 'agent-1', outcome: 'success', at: '2026-07-08T10:00:00.000Z' },
    { agentId: 'agent-1', outcome: 'failure', at: '2026-07-08T11:30:00.000Z' },
  ]);

  await runHealthCycle(store, NOW);

  const row = await store.loadHealthMetrics('agent-1');
  assert.ok(row);
  assert.equal(row!.successRate, 0.5);
  assert.equal(row!.failureRate, 0.5);
  assert.equal(row!.lastRun, '2026-07-08T11:30:00.000Z');
  // Fresh heartbeat ⇒ a C7 view exposes the real numbers.
  const view = viewMetric(row, NOW);
  assert.equal(view!.freshness, 'fresh');
  assert.equal(view!.successRate, 0.5);
});

// AC-8.HLTH.001.2 — Given a high failure rate, When detected, Then it is surfaced, not auto-corrected (OD-078).
test('AC-8.HLTH.001.2 — a high failure rate is written as a value only, never an auto-correction; agent stays enabled', async () => {
  const store = new InMemoryAgentHealthStore();
  store.setAgent('agent-hi-fail', { enabled: true, scope: ['leads'] });
  store.setOutcomes('agent-hi-fail', [
    { agentId: 'agent-hi-fail', outcome: 'failure', at: '2026-07-08T10:00:00.000Z' },
    { agentId: 'agent-hi-fail', outcome: 'failure', at: '2026-07-08T10:10:00.000Z' },
    { agentId: 'agent-hi-fail', outcome: 'failure', at: '2026-07-08T10:20:00.000Z' },
    { agentId: 'agent-hi-fail', outcome: 'success', at: '2026-07-08T10:30:00.000Z' },
    { agentId: 'agent-hi-fail', outcome: 'success', at: '2026-07-08T10:40:00.000Z' },
  ]);

  await runHealthCycle(store, NOW);

  const row = await store.loadHealthMetrics('agent-hi-fail');
  assert.equal(row!.failureRate, 0.6); // surfaced as a value
  // The ONLY write was to the metric store — the agent is untouched and still enabled (no auto-correct).
  assert.equal(await store.isAgentEnabled('agent-hi-fail'), true);
  assert.equal(store.writes.length, 1);
});
