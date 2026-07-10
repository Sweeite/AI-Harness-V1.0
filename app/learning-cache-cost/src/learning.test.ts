// ISSUE-066 (C8 LRN.001/LRN.002) — the orchestrator learning loop, over the in-memory reference model.
// One test per AC in the issue §4 Definition of done this file owns:
//   AC-8.LRN.001.1 — outcome history adjusts routing of similar future tasks, and the adjustment is logged.
//   AC-8.LRN.002.1 — a consistently-rerouted task type surfaces a description-update suggestion.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryLearningStore, InMemoryEventSink, type PlanOutcomeRecord, EVT_LEARNING_ADJUSTED, EVT_MISMATCH_DETECTED } from './store.ts';
import {
  refineRoutingFromOutcomes,
  detectRoutingMismatches,
  biasKey,
  type RoutingBiasModel,
  MIN_LEARNING_SAMPLE,
  REROUTE_MISMATCH_THRESHOLD,
} from './learning.ts';

function outcome(over: Partial<PlanOutcomeRecord> = {}): PlanOutcomeRecord {
  return { task_type_name: 'client_brief', plan_version_id: 'p1', routed_agent_id: 'agent_client', status: 'success', ...over };
}

test('AC-8.LRN.001.1: outcome history refines routing for similar future tasks, and the adjustment is logged', async () => {
  // A task type that consistently FAILS on agent_client → learning should nudge its bias DOWN.
  const store = new InMemoryLearningStore({
    outcomes: [
      outcome({ status: 'failure' }),
      outcome({ status: 'failure' }),
      outcome({ status: 'failure' }),
      outcome({ status: 'success' }),
    ],
  });
  const sink = new InMemoryEventSink();
  const model: RoutingBiasModel = new Map();

  const applied = await refineRoutingFromOutcomes(store, sink, sink, model);
  assert.equal(applied.length, 1);
  const adj = applied[0]!;
  assert.equal(adj.task_type_name, 'client_brief');
  assert.equal(adj.agent_id, 'agent_client');
  assert.ok(adj.after < adj.before); // routing of similar future tasks now DE-prefers this agent
  assert.equal(model.get(biasKey('client_brief', 'agent_client')), adj.after); // the model reflects the feedback

  // The adjustment is LOGGED (observable, #3).
  assert.equal(sink.ofType(EVT_LEARNING_ADJUSTED).length, 1);
});

test('AC-8.LRN.001.1 (reversible): a learned adjustment can be reverted — never an opaque drift (#1)', async () => {
  const store = new InMemoryLearningStore({
    outcomes: [outcome({ status: 'success' }), outcome({ status: 'success' }), outcome({ status: 'success' })],
  });
  const sink = new InMemoryEventSink();
  const model: RoutingBiasModel = new Map();

  const [adj] = await refineRoutingFromOutcomes(store, sink, sink, model);
  assert.ok(adj);
  assert.ok(adj!.after > adj!.before); // reliable agent → biased UP
  adj!.revert(model);
  assert.equal(model.has(biasKey('client_brief', 'agent_client')), false); // restored to the pre-learning state
});

test('AC-8.LRN.001.1 (guard): fewer than the min sample → NO adjustment (no over-fitting on one run)', async () => {
  const store = new InMemoryLearningStore({ outcomes: Array.from({ length: MIN_LEARNING_SAMPLE - 1 }, () => outcome({ status: 'failure' })) });
  const sink = new InMemoryEventSink();
  const applied = await refineRoutingFromOutcomes(store, sink, sink, new Map());
  assert.equal(applied.length, 0);
  assert.equal(sink.ofType(EVT_LEARNING_ADJUSTED).length, 0);
});

test('AC-8.LRN.002.1: a task type consistently rerouted surfaces a description-update suggestion + bumps the mismatch metric', async () => {
  // Three reroutes of client_brief away from agent_client → over the threshold.
  const store = new InMemoryLearningStore({
    outcomes: Array.from({ length: REROUTE_MISMATCH_THRESHOLD }, (_, i) => outcome({ plan_version_id: `p${i}`, rerouted_to_agent_id: 'agent_ops' })),
  });
  const sink = new InMemoryEventSink();

  const suggestions = await detectRoutingMismatches(store, sink, sink);
  assert.equal(suggestions.length, 1);
  const s = suggestions[0]!;
  assert.equal(s.task_type_name, 'client_brief');
  assert.equal(s.agent_id, 'agent_client'); // the agent whose DESCRIPTION keeps mis-attracting this task type
  assert.equal(s.reroute_count, REROUTE_MISMATCH_THRESHOLD);
  assert.match(s.message, /description may need updating|DESCRIPTION may need updating/i); // fix is data, never code
  assert.equal(await store.routingMismatchCount('agent_client'), 1); // the flag-only metric was bumped (OD-078)
  assert.equal(sink.ofType(EVT_MISMATCH_DETECTED).length, 1);
});

test('AC-8.LRN.002.1 (guard): below-threshold reroutes do NOT trip a suggestion (needs a consistent pattern)', async () => {
  const store = new InMemoryLearningStore({
    outcomes: Array.from({ length: REROUTE_MISMATCH_THRESHOLD - 1 }, (_, i) => outcome({ plan_version_id: `p${i}`, rerouted_to_agent_id: 'agent_ops' })),
  });
  const sink = new InMemoryEventSink();
  const suggestions = await detectRoutingMismatches(store, sink, sink);
  assert.equal(suggestions.length, 0);
  assert.equal(await store.routingMismatchCount('agent_client'), 0);
});
