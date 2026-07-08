// ISSUE-065 — FR-8.HLTH.002: specialisation-drift (flag, never auto-correct). AC-8.HLTH.002.1 / .2 (AF-123 EVAL).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryAgentHealthStore, DEFAULT_DRIFT_THRESHOLD } from './store.ts';
import { computeDrift, runHealthCycle, viewMetric } from './health.ts';

const NOW = Date.parse('2026-07-08T12:00:00.000Z');

// EVAL (AF-123): on-scope vs off-scope behaviour must SEPARATE — the score is low for on-scope, high for
// off-scope, and the flag fires only above threshold. (Accuracy on real traffic is the AF-123 fast-follow.)
test('AF-123 EVAL — the drift score separates on-scope from off-scope behaviour', () => {
  const scope = { agentId: 'a', allowedScopeTokens: ['leads', 'contacts'] };

  const onScope = computeDrift(
    { agentId: 'a', observedScopeTokens: ['leads', 'leads', 'contacts', 'leads'] },
    scope,
    DEFAULT_DRIFT_THRESHOLD,
  );
  assert.equal(onScope.driftScore, 0);
  assert.equal(onScope.flagged, false);

  const offScope = computeDrift(
    { agentId: 'a', observedScopeTokens: ['invoices', 'contracts', 'leads', 'payroll'] },
    scope,
    DEFAULT_DRIFT_THRESHOLD,
  );
  assert.equal(offScope.driftScore, 0.75); // 3 of 4 outside scope
  assert.ok(offScope.driftScore! > onScope.driftScore!); // separation
  assert.equal(offScope.flagged, true);
});

// AC-8.HLTH.002.1 — an agent drifting from its scope raises a flag for human review, nothing auto-changed.
test('AC-8.HLTH.002.1 — drift above threshold flags for review; nothing is auto-changed; agent stays enabled', async () => {
  const store = new InMemoryAgentHealthStore();
  store.setAgent('drifter', { enabled: true, scope: ['leads'] });
  store.setBehaviour('drifter', ['invoices', 'payroll', 'contracts', 'leads']); // 0.75 drift > 0.3
  store.setOutcomes('drifter', [{ agentId: 'drifter', outcome: 'success', at: '2026-07-08T10:00:00.000Z' }]);

  const report = await runHealthCycle(store, NOW);
  const res = report.results.find((r) => r.agentId === 'drifter')!;
  assert.equal(res.driftFlagged, true);

  const row = await store.loadHealthMetrics('drifter');
  assert.equal(row!.driftScore, 0.75); // flag = a written score, not an action
  assert.equal(await store.isAgentEnabled('drifter'), true); // never auto-corrected
});

// AC-8.HLTH.002.2 — a failed drift check surfaces its own absence (not silently green). The producer step fails
// for that agent → its heartbeat is NOT advanced → the freshness reader flips it to stale/unknown, and the
// failure is surfaced loudly in the cycle report (never swallowed).
test('AC-8.HLTH.002.2 — a drift check that throws surfaces its absence (report + stale), never silently green', async () => {
  const store = new InMemoryAgentHealthStore();
  store.setAgent('boom', { scope: ['leads'] });
  store.setOutcomes('boom', [{ agentId: 'boom', outcome: 'success', at: '2026-07-08T10:00:00.000Z' }]);
  // Make the drift read throw — the producer step for this agent fails.
  store.loadBehaviourSample = async () => {
    throw new Error('drift detector unavailable');
  };

  const report = await runHealthCycle(store, NOW);
  const res = report.results.find((r) => r.agentId === 'boom')!;
  assert.equal(res.ok, false); // surfaced loudly in the report
  assert.match(res.error!, /drift detector unavailable/);
  assert.equal(report.failed, 1);

  // No heartbeat was stamped for this agent → its metric reads stale/unknown, never a carried-forward green.
  const row = await store.loadHealthMetrics('boom');
  assert.equal(row, null); // nothing written this cycle
  const view = viewMetric(row, NOW);
  assert.equal(view, null); // absent, not a green
});
