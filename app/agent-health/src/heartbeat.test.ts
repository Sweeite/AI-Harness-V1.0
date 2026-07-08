// ISSUE-065 — FR-8.HLTH.004 / NFR-OBS.005: producer liveness heartbeat, stale-never-green.
// AC-8.HLTH.004.2 · AC-NFR-OBS.005.1 (AF-118 blocking SPIKE — absence-of-signal liveness).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryAgentHealthStore, DEFAULT_HEARTBEAT_STALENESS_WINDOW_S } from './store.ts';
import { evaluateFreshness, viewMetric, runHealthCycle } from './health.ts';

const T0 = Date.parse('2026-07-08T12:00:00.000Z');
const W = DEFAULT_HEARTBEAT_STALENESS_WINDOW_S; // 90s

test('evaluateFreshness — fresh within window, stale past it, unknown when never stamped', () => {
  const beat = '2026-07-08T12:00:00.000Z';
  assert.equal(evaluateFreshness(beat, T0 + 10_000, W), 'fresh'); // 10s old
  assert.equal(evaluateFreshness(beat, T0 + (W + 1) * 1000, W), 'stale'); // just past the window
  assert.equal(evaluateFreshness(null, T0, W), 'unknown'); // never stamped ≠ green
  assert.equal(evaluateFreshness('not-a-date', T0, W), 'unknown'); // unparseable ≠ green
});

// Regression: a FUTURE-dated heartbeat (beat ahead of the reader's clock ⇒ negative age) must not read 'fresh'.
// Before the fix, negative age skipped the "> window" branch and fell through to 'fresh' — a fail-open that shows
// an anomalous producer as green (#3). It must read 'unknown' (can't confirm liveness), never fresh.
test('evaluateFreshness — a future-dated heartbeat is UNKNOWN, never fabricated fresh', () => {
  const futureBeat = new Date(T0 + 60_000).toISOString(); // 60s ahead of the reader's now
  assert.equal(evaluateFreshness(futureBeat, T0, W), 'unknown');
  // even a beat only barely in the future is not proof of life
  assert.equal(evaluateFreshness(new Date(T0 + 1).toISOString(), T0, W), 'unknown');
  // and a metric row carrying a future heartbeat must withhold its green values via viewMetric
  const view = viewMetric(
    {
      agentId: 'a', successRate: 1, failureRate: 0, lastRun: null, driftScore: null,
      deadAgentFlag: false, routingMismatchCount: 0, producerHeartbeat: futureBeat, updatedAt: futureBeat,
    },
    T0,
    W,
  )!;
  assert.equal(view.freshness, 'unknown');
  assert.equal(view.successRate, null); // green value withheld — a future beat never paints green
});

// AF-118 SPIKE — stall a producer → its metric reads stale, never a carried-forward green.
// AC-8.HLTH.004.2 / AC-NFR-OBS.005.1.
test('AF-118 / AC-8.HLTH.004.2 — a stalled producer reads STALE and its green values are withheld', async () => {
  const store = new InMemoryAgentHealthStore();
  store.setAgent('a', { scope: ['leads'] });
  store.setOutcomes('a', [
    { agentId: 'a', outcome: 'success', at: '2026-07-08T11:00:00.000Z' },
    { agentId: 'a', outcome: 'success', at: '2026-07-08T11:30:00.000Z' },
  ]);

  // A healthy cycle stamps the heartbeat; immediately after, the metric is fresh with a green success_rate.
  await runHealthCycle(store, T0);
  const rowFresh = await store.loadHealthMetrics('a');
  const fresh = viewMetric(rowFresh, T0 + 5_000, W)!;
  assert.equal(fresh.freshness, 'fresh');
  assert.equal(fresh.successRate, 1); // green, and legitimately so — the producer just ran

  // Now the producer STALLS (no further cycles). Long after the window, the SAME last-known-good row must NOT
  // read green — the reader flips it to stale and withholds the numeric health (#3 "no news ≠ good news").
  const later = T0 + (W + 60) * 1000;
  const stale = viewMetric(rowFresh, later, W)!;
  assert.equal(stale.freshness, 'stale');
  assert.equal(stale.successRate, null); // green value withheld — never carried forward
  assert.equal(stale.deadAgentFlag, null); // an old flag is not presented as a live judgement either
});

test('AC-NFR-OBS.005.1 — a never-produced metric reads unknown, never a green healthy value', async () => {
  const store = new InMemoryAgentHealthStore();
  store.setAgent('never', { scope: ['leads'] });
  // No cycle has run for this agent → the row has never been written.
  const row = await store.loadHealthMetrics('never');
  assert.equal(row, null);
  assert.equal(viewMetric(row, T0, W), null); // absent → not a green
});
