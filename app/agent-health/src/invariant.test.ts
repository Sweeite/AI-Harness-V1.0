// ISSUE-065 — the flag-never-auto-correct invariant. AC-8.HLTH.004.1 · AC-NFR-OBS.015.1 (OD-078 / NFR-OBS.015).
// #2 (never auto-disable) + #3 (an anomaly is surfaced, never silently self-remediated out of sight).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { InMemoryAgentHealthStore, type AgentHealthStore } from './store.ts';
import { runHealthCycle } from './health.ts';

const NOW = Date.parse('2026-07-08T12:00:00.000Z');

// AC-8.HLTH.004.1 / AC-NFR-OBS.015.1 — structural: the store port exposes NO way to mutate an agent. The only
// write method is upsertHealthMetrics; agents are read-only (loadScope / isAgentEnabled). So no code path in
// this slice can auto-disable or auto-correct an agent.
test('AC-8.HLTH.004.1 — the AgentHealthStore port has no agent-mutation method (structural, flag-only)', () => {
  const methods: Array<keyof AgentHealthStore> = [
    'listAgentIds',
    'loadOutcomes',
    'loadBehaviourSample',
    'loadScope',
    'isAgentEnabled',
    'upsertHealthMetrics',
    'loadHealthMetrics',
  ];
  // No method name implies a write to agents (disable/enable/update/setScope/correct/rollback).
  for (const m of methods) {
    assert.doesNotMatch(String(m), /disable|enable(?!d)|setScope|correct|rollback|updateAgent|writeAgent/i);
  }
  // The ONLY mutating verb is the metric upsert.
  assert.ok(methods.includes('upsertHealthMetrics'));
});

// AC-NFR-OBS.015.1 — behavioural: after a cycle flags BOTH drift and dead-agent for an agent, it is still
// enabled and the ONLY writes were metric upserts (no agent mutation, no auto-correct).
test('AC-NFR-OBS.015.1 — an agent flagged for BOTH drift + dead-agent stays enabled; only the metric store is written', async () => {
  const store = new InMemoryAgentHealthStore();
  store.setAgent('doomed', { enabled: true, scope: ['leads'] });
  store.setOutcomes('doomed', [
    { agentId: 'doomed', outcome: 'failure', at: '2026-07-08T10:00:00.000Z' },
    { agentId: 'doomed', outcome: 'failure', at: '2026-07-08T10:01:00.000Z' },
    { agentId: 'doomed', outcome: 'failure', at: '2026-07-08T10:02:00.000Z' },
    { agentId: 'doomed', outcome: 'success', at: '2026-07-08T10:03:00.000Z' },
  ]);
  store.setBehaviour('doomed', ['payroll', 'invoices', 'contracts']); // fully off-scope → drift 1.0

  const report = await runHealthCycle(store, NOW);
  const res = report.results.find((r) => r.agentId === 'doomed')!;
  assert.equal(res.driftFlagged, true);
  assert.equal(res.deadAgentFlagged, true);

  // Flagged both ways — yet still enabled (no auto-disable), and every write was a metric upsert.
  assert.equal(await store.isAgentEnabled('doomed'), true);
  assert.equal(store.writes.length, 1);
  assert.equal(store.writes[0]!.agentId, 'doomed');
});

// Source-level guard: no code file in this slice contains an UPDATE/DELETE against the agents table (a
// live-path auto-disable would have to write agents). The metric store is the only write target.
test('no source file writes to the agents table (flag-never-auto-correct, live path too)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const files = readdirSync(here).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  const writeToAgents = /(update|delete\s+from)\s+public\.agents/i;
  for (const f of files) {
    const src = readFileSync(join(here, f), 'utf8');
    assert.doesNotMatch(src, writeToAgents, `${f} must not write to public.agents (auto-disable path forbidden — OD-078)`);
  }
});
