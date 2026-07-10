// ISSUE-066 (C8 COST.001/002/003 + NFR-COST.010) — cost-routing by complexity, over the ISSUE-061 classification model.
// One test per AC in the issue §4 Definition of done this file owns:
//   AC-8.COST.001.1    — a simple task takes the single-agent tier, not a full chain.
//   AC-8.COST.002.1    — raising the confidence threshold sends more under-specified tasks to clarification.
//   AC-8.COST.003.1    — a routing decision records its expected call profile (ADR-003 shape) for C7 — C8 never meters.
//   AC-NFR-COST.010.1  — cost is aggregated per task type from the FIRST task (the shape carries task_type_name).
//   AC-NFR-COST.010.2  — default config: re-ranking + HyDE are OFF.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Classification } from '../../orchestrator/src/routing.ts';
import { InMemoryEventSink, EVT_COST_TIER, EVT_COST_SHAPE } from './store.ts';
import {
  selectCostTier,
  routeByCost,
  emitCostTier,
  computeCallProfile,
  profileHonoursAdr003,
  emitCostShape,
  MAX_HAIKU_PER_WRITE,
} from './cost.ts';
import { DEFAULT_COST_ROUTING_CONFIG } from './config.ts';

function classification(over: Partial<Classification> = {}): Classification {
  return {
    domain: 'research',
    complexity: 'single',
    context: { entity_ids: ['e1'] },
    output: 'summary',
    ambiguous: false,
    ...over,
  };
}

test('AC-8.COST.001.1: a simple task takes the single-agent tier, not a full chain', async () => {
  const { tier, needed } = selectCostTier(classification({ complexity: 'single' }), DEFAULT_COST_ROUTING_CONFIG);
  assert.equal(tier, 'single');
  assert.equal(needed, 1);

  // A complex task escalates the tier only as needed — cheapest satisfying.
  assert.equal(selectCostTier(classification({ complexity: 'multi' }), DEFAULT_COST_ROUTING_CONFIG, 2).tier, 'two_agent');
  assert.equal(selectCostTier(classification({ complexity: 'multi' }), DEFAULT_COST_ROUTING_CONFIG, 5).tier, 'full_chain');
});

test('AC-8.COST.001.1 (cap): the chosen tier never needs more than chain_depth_limit specialists', () => {
  const cfg = { ...DEFAULT_COST_ROUTING_CONFIG, chainDepthLimit: 3 };
  const { needed } = selectCostTier(classification({ complexity: 'multi' }), cfg, 99);
  assert.equal(needed, 3); // capped at chain_depth_limit (PLAN.003)
});

test('AC-8.COST.002.1: raising the confidence threshold routes more under-specified tasks to clarification, fewer chains', () => {
  // An under-specified (ambiguous) task with confidence 0.7.
  const c = classification({ complexity: 'multi', ambiguous: true });
  const conf = 0.7;

  const low = routeByCost(c, conf, { ...DEFAULT_COST_ROUTING_CONFIG, confidenceThreshold: 0.6 }, 3);
  assert.equal(low.decision, 'route'); // 0.7 ≥ 0.6 → an expensive chain runs
  assert.equal(low.decision === 'route' ? low.tier : null, 'full_chain');

  const high = routeByCost(c, conf, { ...DEFAULT_COST_ROUTING_CONFIG, confidenceThreshold: 0.75 }, 3);
  assert.equal(high.decision, 'clarification'); // raise the dial → 0.7 < 0.75 → clarify, no expensive chain
});

test('AC-8.COST.002.1 (aggregate): raising the threshold strictly increases the clarification count over a task mix', () => {
  const c = classification({ complexity: 'multi' });
  const confidences = [0.55, 0.65, 0.72, 0.78, 0.9];
  const clarifiedAt = (threshold: number) =>
    confidences.filter((conf) => routeByCost(c, conf, { ...DEFAULT_COST_ROUTING_CONFIG, confidenceThreshold: threshold }, 3).decision === 'clarification').length;
  assert.equal(clarifiedAt(0.6), 1); // only 0.55
  assert.equal(clarifiedAt(0.75), 3); // 0.55, 0.65, 0.72 — strictly more clarification, fewer chains
  assert.ok(clarifiedAt(0.75) > clarifiedAt(0.6));
});

test('AC-8.COST.003.1: a routing decision records its expected call profile (ADR-003 shape) for C7 — C8 does not meter/enforce', async () => {
  const sink = new InMemoryEventSink();
  // A two-specialist route producing one memory write → ADR-003 §4: 1 orchestrator + 2 specialist + 1 Sonnet + ≤3 Haiku.
  const profile = computeCallProfile(2, 1);
  assert.ok(profileHonoursAdr003(profile, 1));
  assert.equal(profile.orchestrator_decision_calls, 1);
  assert.equal(profile.sonnet_write_calls, 1); // exactly one Sonnet per written memory
  assert.equal(profile.haiku_write_calls, MAX_HAIKU_PER_WRITE); // ≤3 Haiku pre-checks
  assert.equal(profile.total_calls, 1 + 2 + 1 + 3);

  await emitCostShape(sink, sink, 'client_brief', profile, DEFAULT_COST_ROUTING_CONFIG, ['e1']);
  const evts = sink.ofType(EVT_COST_SHAPE);
  assert.equal(evts.length, 1);
  assert.equal(evts[0]!.payload.meters, false); // OD-068 — C8 feeds, never meters
  assert.equal(evts[0]!.payload.enforces, false); // OD-068 — C8 never enforces the ladder
});

test('AC-8.COST.003.1 (ADR-003 write shape): sonnet == writes, haiku ≤ 3×writes, fail-safe round-up by default', () => {
  for (const writes of [0, 1, 2, 3]) {
    const p = computeCallProfile(writes, writes); // specialist count == writes for the check
    assert.ok(profileHonoursAdr003(p, writes));
    assert.equal(p.sonnet_write_calls, writes);
    assert.ok(p.haiku_write_calls <= MAX_HAIKU_PER_WRITE * writes);
  }
  // A caller cannot exceed the ≤3 Haiku ceiling even if it asks for more (clamped — never over-counts the shape).
  const clamped = computeCallProfile(1, 1, 99);
  assert.equal(clamped.haiku_write_calls, MAX_HAIKU_PER_WRITE);
});

test('AC-NFR-COST.010.1: cost is aggregated per task type from the FIRST task (the shape carries task_type_name)', async () => {
  const sink = new InMemoryEventSink();
  // The very first task on a fresh deployment.
  await emitCostShape(sink, sink, 'lead_triage', computeCallProfile(1, 0), DEFAULT_COST_ROUTING_CONFIG);
  const first = sink.ofType(EVT_COST_SHAPE)[0]!;
  assert.equal(first.payload.task_type_name, 'lead_triage'); // groupable per task type from task #1, not retrofitted
});

test('AC-NFR-COST.010.2: the default config boots with re-ranking and HyDE OFF', () => {
  assert.equal(DEFAULT_COST_ROUTING_CONFIG.rerankEnabled, false);
  assert.equal(DEFAULT_COST_ROUTING_CONFIG.hydeEnabled, false);
});

test('COST.001 tier is emitted; clarification is emitted (never a silent skip, #3)', async () => {
  const sink = new InMemoryEventSink();
  const routed = routeByCost(classification({ complexity: 'single' }), 0.9, DEFAULT_COST_ROUTING_CONFIG);
  await emitCostTier(sink, sink, 'summary_task', routed, ['e1']);
  const clarified = routeByCost(classification({ complexity: 'multi', ambiguous: true }), 0.5, DEFAULT_COST_ROUTING_CONFIG, 4);
  await emitCostTier(sink, sink, 'vague_task', clarified, ['e1']);
  assert.equal(sink.ofType(EVT_COST_TIER).length, 2); // both the route AND the clarification are recorded
});
