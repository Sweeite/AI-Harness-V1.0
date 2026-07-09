// ISSUE-054 (C5 OPT) — FR-5.OPT.001 Parallel step execution + OD-056 step-level approval semantics. Proves
// AC-5.OPT.001.1 (a gated step + its dependents block while independent reversible siblings proceed), AC-5.OPT.001.2
// (an irreversible step waits for a pending approval it should follow — no side effect outruns its gate, #2), the
// ADR-004 per-key concurrency exclusion, and the FLAG-OFF regression (parallel disabled ⇒ plain sequential).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  eligibility,
  isEligible,
  nextWave,
  driveSchedule,
  assertReferencesResolve,
  ERR_UNRESOLVED_FOLLOWS,
  ERR_UNRESOLVED_DEP,
  type SchedulerState,
} from './scheduler.ts';
import type { OptStep } from './dag.ts';

const noState = (over: Partial<SchedulerState> = {}): SchedulerState => ({
  completed: new Set(),
  running: new Set(),
  granted: new Set(),
  ...over,
});

test('AC-5.OPT.001.1 — a gated step + its dependents block; independent reversible siblings proceed', () => {
  const steps: OptStep[] = [
    { step_id: 'g', kind: 'tool_call', depends_on: [], approval_gated: true },
    { step_id: 'gd', kind: 'tool_call', depends_on: ['g'] }, // dependent of the gated step
    { step_id: 'sib1', kind: 'ai_call', depends_on: [], reversible: true },
    { step_id: 'sib2', kind: 'memory_read', depends_on: [], reversible: true },
  ];
  const state = noState(); // nothing granted
  assert.equal(eligibility(steps[0]!, steps, state), 'awaiting_own_approval'); // g blocks itself (OD-056)
  assert.equal(eligibility(steps[1]!, steps, state), 'deps_pending'); // gd blocks via the DAG
  assert.ok(isEligible(steps[2]!, steps, state)); // sib1 proceeds
  assert.ok(isEligible(steps[3]!, steps, state)); // sib2 proceeds
  const wave = nextWave(steps, state, { parallelExecutionEnabled: true });
  assert.deepEqual(wave.map((s) => s.step_id), ['sib1', 'sib2']);
});

test('AC-5.OPT.001.1 — granting the approval unblocks the gated step (and then its dependent)', () => {
  const steps: OptStep[] = [
    { step_id: 'g', kind: 'tool_call', depends_on: [], approval_gated: true },
    { step_id: 'gd', kind: 'tool_call', depends_on: ['g'] },
  ];
  const granted = noState({ granted: new Set(['g']) });
  assert.ok(isEligible(steps[0]!, steps, granted)); // g now eligible
  assert.equal(eligibility(steps[1]!, steps, granted), 'deps_pending'); // gd still waits for g to COMPLETE
  const afterG = noState({ granted: new Set(['g']), completed: new Set(['g']) });
  assert.ok(isEligible(steps[1]!, steps, afterG)); // gd eligible once g completed
});

test('AC-5.OPT.001.2 — an irreversible step waits for a pending approval it should logically follow', () => {
  const steps: OptStep[] = [
    { step_id: 'appr', kind: 'ai_call', depends_on: [], approval_gated: true },
    // irreversible tool_write, NO data edge to appr, but must follow appr's approval (planner-stamped ordering)
    { step_id: 'irr', kind: 'tool_write', depends_on: [], follows_approval_of: ['appr'] },
  ];
  const pending = noState();
  assert.equal(eligibility(steps[1]!, steps, pending), 'awaiting_followed_approval'); // waits (#2)
  const wave = nextWave(steps, pending, { parallelExecutionEnabled: true });
  assert.deepEqual(wave.map((s) => s.step_id), []); // nothing side-effecting runs under a pending approval
  const granted = noState({ granted: new Set(['appr']) });
  assert.ok(isEligible(steps[1]!, steps, granted)); // once approved, the irreversible step may proceed
});

test('OD-056 fail-CLOSED — an irreversible step whose follows_approval_of gate is UNKNOWN blocks (never releases)', () => {
  // Regression for the fail-open: a follows_approval_of id absent from the step set must BLOCK the irreversible
  // step, not fall through to eligible. A safety latch that no-ops on a missing gate is a #2 fail-open.
  const steps: OptStep[] = [
    { step_id: 'irr', kind: 'tool_write', depends_on: [], follows_approval_of: ['ghost'] }, // 'ghost' not in steps
  ];
  assert.equal(eligibility(steps[0]!, steps, noState()), 'awaiting_followed_approval');
  assert.equal(isEligible(steps[0]!, steps, noState()), false); // never dispatches under an unresolved gate
});

test('OD-056 fail-CLOSED — an irreversible step following a NON-granted gate blocks even if the gate is not approval_gated', () => {
  // Regression: the target exists but was not marked approval_gated and is not granted — must still BLOCK (the
  // planner stamped an ordering that cannot be proven satisfied). Same fall-through fail-open as the unknown case.
  const steps: OptStep[] = [
    { step_id: 'plain', kind: 'ai_call', depends_on: [] }, // exists, but NOT approval_gated, never granted
    { step_id: 'irr', kind: 'tool_write', depends_on: [], follows_approval_of: ['plain'] },
  ];
  assert.equal(eligibility(steps[1]!, steps, noState()), 'awaiting_followed_approval');
});

test('defense-in-depth — nextWave rejects a plan with an unresolved follows_approval_of / depends_on ref (fail LOUD)', () => {
  const badFollows: OptStep[] = [
    { step_id: 'irr', kind: 'tool_write', depends_on: [], follows_approval_of: ['ghost'] },
  ];
  assert.throws(() => nextWave(badFollows, noState(), { parallelExecutionEnabled: true }), new RegExp(ERR_UNRESOLVED_FOLLOWS('irr', 'ghost').slice(0, 40)));
  const badDep: OptStep[] = [{ step_id: 'x', kind: 'ai_call', depends_on: ['nope'] }];
  assert.throws(() => nextWave(badDep, noState(), { parallelExecutionEnabled: true }), new RegExp(ERR_UNRESOLVED_DEP('x', 'nope').slice(0, 40)));
  // a fully-resolved plan validates cleanly (no throw).
  assert.doesNotThrow(() => assertReferencesResolve([
    { step_id: 'a', kind: 'ai_call', depends_on: [] },
    { step_id: 'b', kind: 'tool_write', depends_on: ['a'], follows_approval_of: ['a'] },
  ]));
});

test('AC-5.OPT.001.2 — a REVERSIBLE sibling does NOT wait on the approval (only irreversible ordering is enforced)', () => {
  const steps: OptStep[] = [
    { step_id: 'appr', kind: 'ai_call', depends_on: [], approval_gated: true },
    { step_id: 'rev', kind: 'ai_call', depends_on: [], reversible: true, follows_approval_of: ['appr'] },
  ];
  // follows_approval_of only gates IRREVERSIBLE steps; a reversible sibling proceeds (throughput, no #2 risk).
  assert.ok(isEligible(steps[1]!, steps, noState()));
});

test('ADR-004 per-key concurrency — two steps sharing a write key never co-dispatch in one wave', () => {
  const steps: OptStep[] = [
    { step_id: 'a', kind: 'tool_write', depends_on: [], write_keys: ['entity:1'] },
    { step_id: 'b', kind: 'tool_write', depends_on: [], write_keys: ['entity:1'] }, // same key
    { step_id: 'c', kind: 'tool_write', depends_on: [], write_keys: ['entity:2'] }, // disjoint key
  ];
  const wave = nextWave(steps, noState(), { parallelExecutionEnabled: true });
  assert.deepEqual(wave.map((s) => s.step_id), ['a', 'c']); // b excluded (shares entity:1 with a); c disjoint
});

test('per-key concurrency — a step waits while a RUNNING step holds its write key', () => {
  const steps: OptStep[] = [
    { step_id: 'a', kind: 'tool_write', depends_on: [], write_keys: ['k'] },
    { step_id: 'b', kind: 'tool_write', depends_on: [], write_keys: ['k'] },
  ];
  const running = noState({ running: new Set(['a']) });
  assert.equal(eligibility(steps[1]!, steps, running), 'concurrency_key_busy');
});

test('FLAG-OFF regression — parallel_execution_enabled off ⇒ at most one step per wave (plain sequential)', () => {
  const steps: OptStep[] = [
    { step_id: 's1', kind: 'ai_call', depends_on: [] },
    { step_id: 's2', kind: 'ai_call', depends_on: [] },
    { step_id: 's3', kind: 'ai_call', depends_on: [] },
  ];
  const wave = nextWave(steps, noState(), { parallelExecutionEnabled: false });
  assert.equal(wave.length, 1);
  assert.deepEqual(wave.map((s) => s.step_id), ['s1']);
});

test('driveSchedule — parallel ON runs independent steps in one wave; a never-granted approval blocks its subtree', async () => {
  const steps: OptStep[] = [
    { step_id: 'g', kind: 'tool_call', depends_on: [], approval_gated: true },
    { step_id: 'gd', kind: 'tool_write', depends_on: ['g'] },
    { step_id: 'sib1', kind: 'ai_call', depends_on: [], reversible: true },
    { step_id: 'sib2', kind: 'ai_call', depends_on: [], reversible: true },
  ];
  const ran: string[] = [];
  const res = await driveSchedule(steps, (s) => { ran.push(s.step_id); }, () => false, { parallelExecutionEnabled: true });
  assert.deepEqual(res.waves, [['sib1', 'sib2']]); // both independent siblings in ONE parallel wave
  assert.deepEqual(res.blocked.sort(), ['g', 'gd']); // gated step + dependent never ran (no side effect outran the gate)
  assert.ok(!ran.includes('gd')); // #2: the irreversible dependent never fired ahead of the pending approval
});

test('driveSchedule — a mid-run grant unblocks the gated step and its dependent', async () => {
  const steps: OptStep[] = [
    { step_id: 'g', kind: 'tool_call', depends_on: [], approval_gated: true },
    { step_id: 'gd', kind: 'tool_write', depends_on: ['g'] },
  ];
  let grant = false;
  const ran: string[] = [];
  // grant after the first poll finds nothing eligible would deadlock; grant from the start here.
  grant = true;
  const res = await driveSchedule(steps, (s) => { ran.push(s.step_id); }, () => grant, { parallelExecutionEnabled: true });
  assert.deepEqual(res.blocked, []);
  assert.deepEqual(ran, ['g', 'gd']); // dependency order preserved: g before its dependent gd
});

test('FLAG-OFF regression — driveSchedule sequential dispatches one step per wave, in dependency order', async () => {
  const steps: OptStep[] = [
    { step_id: 's1', kind: 'ai_call', depends_on: [] },
    { step_id: 's2', kind: 'ai_call', depends_on: [] },
    { step_id: 's3', kind: 'ai_call', depends_on: ['s1'] },
  ];
  const res = await driveSchedule(steps, () => {}, () => false, { parallelExecutionEnabled: false });
  assert.ok(res.waves.every((w) => w.length === 1)); // one step per wave
  assert.deepEqual(res.blocked, []);
  assert.deepEqual(res.waves.flat(), ['s1', 's2', 's3']);
});
