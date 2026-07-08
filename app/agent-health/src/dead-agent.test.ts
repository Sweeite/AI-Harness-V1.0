// ISSUE-065 — FR-8.HLTH.003: dead-agent / low-quality (flag, never auto-disable). AC-8.HLTH.003.1 / .2 (AF-124).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryAgentHealthStore, DEFAULT_DEAD_AGENT_THRESHOLD } from './store.ts';
import { computeQuality, isDeadAgent, runHealthCycle } from './health.ts';

const NOW = Date.parse('2026-07-08T12:00:00.000Z');

test('computeQuality — outcomes-only ⇒ score == success rate (so "0.5 success-rate" reads as documented)', () => {
  const q = computeQuality([
    { agentId: 'a', outcome: 'failure', at: '2026-07-08T10:00:00.000Z' },
    { agentId: 'a', outcome: 'failure', at: '2026-07-08T10:01:00.000Z' },
    { agentId: 'a', outcome: 'failure', at: '2026-07-08T10:02:00.000Z' },
    { agentId: 'a', outcome: 'success', at: '2026-07-08T10:03:00.000Z' },
  ]);
  assert.equal(q.successRate, 0.25);
  assert.equal(q.answerQuality, null); // no pills observed
  assert.equal(q.approvalRate, null); // no human decisions observed
  assert.equal(q.score, 0.25); // == success rate
  assert.equal(isDeadAgent(q, DEFAULT_DEAD_AGENT_THRESHOLD), true); // 0.25 < 0.5
});

test('computeQuality — the OD-078 signals (answer-mode pill + approval/rejection) sharpen the score', () => {
  // Decent success rate (0.75) but poor pills (mostly unknown) + rejected outputs → composite drops below 0.5.
  const q = computeQuality([
    { agentId: 'a', outcome: 'success', at: 't1', answerMode: 'unknown', humanDecision: 'rejected' },
    { agentId: 'a', outcome: 'success', at: 't2', answerMode: 'unknown', humanDecision: 'rejected' },
    { agentId: 'a', outcome: 'success', at: 't3', answerMode: 'unknown', humanDecision: 'rejected' },
    { agentId: 'a', outcome: 'failure', at: 't4', answerMode: 'cited', humanDecision: 'approved' },
  ]);
  assert.equal(q.successRate, 0.75);
  assert.equal(q.answerQuality, 0.25); // 1 of 4 pills is cited/inferred
  assert.equal(q.approvalRate, 0.25); // 1 of 4 approved
  assert.ok(q.score! < DEFAULT_DEAD_AGENT_THRESHOLD); // mean(0.75,0.25,0.25) ≈ 0.417
  assert.equal(isDeadAgent(q, DEFAULT_DEAD_AGENT_THRESHOLD), true);
});

test('isDeadAgent — no evidence (null score) is NEVER dead (absence of evidence ≠ evidence of death) (#3)', () => {
  const q = computeQuality([]);
  assert.equal(q.score, null);
  assert.equal(isDeadAgent(q, DEFAULT_DEAD_AGENT_THRESHOLD), false);
});

// AC-8.HLTH.003.1 — consistently failing/low-quality agent is flagged automatically above threshold.
// AC-8.HLTH.003.2 — a flagged agent remains ENABLED until a human decides (no auto-disable).
test('AC-8.HLTH.003.1/.2 — a consistently-failing agent is flagged AND stays enabled (no auto-disable)', async () => {
  const store = new InMemoryAgentHealthStore();
  store.setAgent('dead', { enabled: true, scope: ['leads'] });
  store.setOutcomes('dead', [
    { agentId: 'dead', outcome: 'failure', at: '2026-07-08T10:00:00.000Z' },
    { agentId: 'dead', outcome: 'failure', at: '2026-07-08T10:01:00.000Z' },
    { agentId: 'dead', outcome: 'failure', at: '2026-07-08T10:02:00.000Z' },
    { agentId: 'dead', outcome: 'success', at: '2026-07-08T10:03:00.000Z' },
  ]);

  const report = await runHealthCycle(store, NOW);
  const res = report.results.find((r) => r.agentId === 'dead')!;
  assert.equal(res.deadAgentFlagged, true); // AC-8.HLTH.003.1 — flagged automatically

  const row = await store.loadHealthMetrics('dead');
  assert.equal(row!.deadAgentFlag, true);
  // AC-8.HLTH.003.2 — still enabled; the flag is not a disable.
  assert.equal(await store.isAgentEnabled('dead'), true);
});

test('a healthy agent is NOT flagged dead', async () => {
  const store = new InMemoryAgentHealthStore();
  store.setAgent('healthy', { scope: ['leads'] });
  store.setOutcomes('healthy', [
    { agentId: 'healthy', outcome: 'success', at: '2026-07-08T10:00:00.000Z' },
    { agentId: 'healthy', outcome: 'success', at: '2026-07-08T10:01:00.000Z' },
    { agentId: 'healthy', outcome: 'success', at: '2026-07-08T10:02:00.000Z' },
    { agentId: 'healthy', outcome: 'failure', at: '2026-07-08T10:03:00.000Z' },
  ]);
  await runHealthCycle(store, NOW);
  const row = await store.loadHealthMetrics('healthy');
  assert.equal(row!.deadAgentFlag, false); // 0.75 ≥ 0.5
});
