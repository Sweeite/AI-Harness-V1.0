// ISSUE-054 (C5 OPT) — FR-5.OPT.003 Task decomposition. Proves AC-5.OPT.003.1 (a complex task's planning step
// produces the execution_plan into the envelope BEFORE any side-effecting step runs) and the NFR-PERF.007 chain-depth
// binding (reject/trim, NEVER silent truncation) that decomposition applies at build.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decompose,
  writePlanToEnvelope,
  ERR_NOT_COMPLEX,
  ERR_PLAN_AFTER_SIDE_EFFECT,
  ERR_OVER_LIMIT,
  type PlanEnvelope,
} from './plan.ts';
import type { OptStep } from './dag.ts';

function steps(n: number): OptStep[] {
  return Array.from({ length: n }, (_, i) => ({
    step_id: `s${i}`,
    kind: 'ai_call' as const,
    depends_on: i === 0 ? [] : [`s${i - 1}`], // a linear chain of depth n
  }));
}

function freshEnv(): PlanEnvelope {
  return { task_id: 't1', execution_plan: [], previous_outputs: [] };
}

test('AC-5.OPT.003.1 — a complex task produces the ordered plan into the envelope before any step runs', () => {
  const plan = decompose(true, steps(3));
  assert.equal(plan.depth, 3);
  assert.equal(plan.depth_outcome, 'ok');
  assert.deepEqual(plan.steps.map((s) => s.step_id), ['s0', 's1', 's2']); // dependency order
  const env = writePlanToEnvelope(freshEnv(), plan);
  assert.equal(env.execution_plan.length, 3);
  assert.deepEqual((env.execution_plan as OptStep[]).map((s) => s.step_id), ['s0', 's1', 's2']);
});

test('AC-5.OPT.003.1 — writing the plan AFTER a step already ran is rejected loud (planning precedes execution)', () => {
  const plan = decompose(true, steps(2));
  const env = freshEnv();
  env.previous_outputs.push({ step_index: 0 }); // a step already ran
  assert.throws(() => writePlanToEnvelope(env, plan), new RegExp(ERR_PLAN_AFTER_SIDE_EFFECT.slice(0, 40)));
});

test('decompose refuses a non-complex task (only complex tasks get an upfront plan)', () => {
  assert.throws(() => decompose(false, steps(2)), /not flagged complex needs no upfront plan/);
  assert.equal(ERR_NOT_COMPLEX.includes('complex-task planning path'), true);
});

test('chain_depth_limit over-limit is REJECTED by default — never silently truncated (#3 / AC-NFR-PERF.007.1)', () => {
  // default chain_depth_limit is 6; a chain of 8 exceeds it.
  assert.throws(() => decompose(true, steps(8)), new RegExp('rejected at build, never silently truncated'));
  assert.throws(() => decompose(true, steps(8)), new RegExp(ERR_OVER_LIMIT(8, 6).slice(0, 30)));
});

test('over-limit with trim policy produces a VISIBLE trimmed plan with lowered confidence — not a silent cut', () => {
  const plan = decompose(true, steps(8), { chainDepthLimit: 6 }, 'trim');
  assert.equal(plan.trimmed, true);
  assert.equal(plan.depth_outcome, 'trimmed');
  assert.equal(plan.depth, 6);
  assert.match(plan.depth_detail, /trimmed to a dependency-closed prefix/);
  // the kept prefix is dependency-closed (every kept step's deps are also kept).
  const keptIds = new Set(plan.steps.map((s) => s.step_id));
  for (const s of plan.steps) for (const d of s.depends_on) assert.ok(keptIds.has(d), `dep ${d} of ${s.step_id} must be kept`);
});

test('a custom chain_depth_limit is honoured (LIVE ceiling)', () => {
  assert.throws(() => decompose(true, steps(4), { chainDepthLimit: 3 }), /rejected at build/);
  const ok = decompose(true, steps(3), { chainDepthLimit: 3 });
  assert.equal(ok.depth, 3);
});

test('decompose rejects a malformed plan (cycle) loud', () => {
  const cyclic: OptStep[] = [
    { step_id: 'a', kind: 'ai_call', depends_on: ['b'] },
    { step_id: 'b', kind: 'ai_call', depends_on: ['a'] },
  ];
  assert.throws(() => decompose(true, cyclic), /cycle detected/);
});
