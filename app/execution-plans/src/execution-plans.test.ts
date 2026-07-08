// ISSUE-064 (C8 PLAN) — one test per §4 AC, against the pure discipline kernels + the in-memory reference store.
// Deterministic: explicit nowMs; no Date.now/random.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STEP_FAILURE_MODES,
  DEFAULT_STEP_FAILURE_MODE,
  toCanonicalFailureMode,
  isStepFailureMode,
} from './taxonomy.ts';
import {
  assignFailureModes,
  assertEveryStepAssigned,
  readPreAssignedMode,
  haltReEscalationDue,
  enforceDepthLimit,
  buildValidatedPlan,
  canonicalizePlanBody,
  DEFAULT_CHAIN_DEPTH_LIMIT,
  ERR_STEP_UNASSIGNED,
  type AssignedPlan,
} from './plan.ts';
import {
  InMemoryExecutionPlanAdmin,
  InMemoryRollbackAudit,
  newPlanBacking,
  denyAllRollback,
  ERR_ROLLBACK_UNAUTHORIZED,
  ERR_ROLLBACK_NO_REASON,
} from './store.ts';

const T0 = 1_780_000_000_000;

// ── AC-8.PLAN.001.1 — every step of a built plan has an assigned (canonical) failure mode. ──────────────
test('AC-8.PLAN.001.1 — assignFailureModes gives every step a canonical mode; assertEveryStepAssigned holds', () => {
  const plan = assignFailureModes('draft_reply', [
    { index: 0, agent_id: 'a', failure_mode: 'retry' },
    { index: 1, agent_id: 'b', failure_mode: 'halt_escalate' }, // orchestrator shorthand → canonicalized
    { index: 2, agent_id: 'c' }, // no mode → safe default
  ]);
  assert.equal(plan.steps.length, 3);
  for (const s of plan.steps) assert.ok(isStepFailureMode(s.failure_mode), `step ${s.index} has a canonical mode`);
  assert.equal(plan.steps[1]!.failure_mode, 'halt_and_escalate', 'orchestrator shorthand canonicalized');
  assert.equal(plan.steps[2]!.failure_mode, DEFAULT_STEP_FAILURE_MODE);
  assert.doesNotThrow(() => assertEveryStepAssigned(plan));
});

test('AC-8.PLAN.001.1 — assertEveryStepAssigned throws LOUD on a step with an invalid/absent mode (#3)', () => {
  const torn: AssignedPlan = {
    task_type_name: 'x',
    parallel: false,
    steps: [{ index: 0, agent_id: 'a', agent_name: null, depends_on: [], parallel_eligible: false, failure_mode: 'bogus' as never, defaulted: false }],
  };
  assert.throws(() => assertEveryStepAssigned(torn), new RegExp(ERR_STEP_UNASSIGNED(0).slice(0, 40)));
});

// ── AC-8.PLAN.001.2 — the pre-assigned mode is what C5 reads; the mode is never re-decided at failure time. ──
test('AC-8.PLAN.001.2 — readPreAssignedMode returns the STORED (canonical) mode, mapping shorthand; never re-decides', () => {
  assert.equal(readPreAssignedMode({ failure_mode: 'skip' }), 'skip_and_continue'); // orchestrator shorthand
  assert.equal(readPreAssignedMode({ failure_mode: 'skip_and_continue' }), 'skip_and_continue');
  assert.equal(readPreAssignedMode({ failure_mode: 'retry' }), 'retry');
  // a torn/unknown stored value fails SAFE to halt-and-escalate (never to 'continue') — the C5 contract stays #3-safe.
  assert.equal(readPreAssignedMode({ failure_mode: 'garbage' }), 'halt_and_escalate');
  assert.equal(readPreAssignedMode({}), 'halt_and_escalate');
  // taxonomy reconciliation (OD-201): both canonical + shorthand resolve; junk → null (caller defaults).
  assert.equal(toCanonicalFailureMode('halt_escalate'), 'halt_and_escalate');
  assert.equal(toCanonicalFailureMode('nope'), null);
});

// ── AC-8.PLAN.002.1 — an unassigned step defaults to halt-and-escalate (never silently continues). ──────
test('AC-8.PLAN.002.1 — a step with no failure mode is halt-and-escalate, and is flagged as defaulted', () => {
  const plan = assignFailureModes('t', [{ index: 0, agent_id: 'a' }]);
  assert.equal(plan.steps[0]!.failure_mode, 'halt_and_escalate');
  assert.equal(plan.steps[0]!.defaulted, true, 'the default is visible, not hidden');
  // the default is NEVER skip/skip_and_continue (which would silently continue a failed step).
  assert.notEqual(plan.steps[0]!.failure_mode, 'skip_and_continue');
});

// ── AC-8.PLAN.002.2 — an unattended halt re-escalates (inherits the AC-5.QUE.005.2 staleness guarantee). ─
test('AC-8.PLAN.002.2 — an unattended halt-and-escalate re-escalates when stale (escalate-don’t-abandon)', () => {
  const stale = 2 * 60 * 60 * 1000; // 2h
  const halt = { taskId: 't1', planVersionId: 'plan-1', haltedAtMs: T0, escalatedAtMs: null, resolvedAtMs: null };
  assert.equal(haltReEscalationDue(halt, stale, T0 + stale - 1), false);
  assert.equal(haltReEscalationDue(halt, stale, T0 + stale), true);
  // resolved or already-escalated halts do not re-escalate.
  assert.equal(haltReEscalationDue({ ...halt, resolvedAtMs: T0 + 5 }, stale, T0 + stale * 3), false);
  assert.equal(haltReEscalationDue({ ...halt, escalatedAtMs: T0 + 5 }, stale, T0 + stale * 3), false);
});

// ── AC-8.PLAN.003.1 — an over-depth plan is rejected/trimmed + surfaced (never executed as-is, never silent). ──
test('AC-8.PLAN.003.1 — a plan exceeding chain_depth_limit is rejected to low-confidence, not executed as-is', () => {
  assert.equal(enforceDepthLimit(DEFAULT_CHAIN_DEPTH_LIMIT).action, 'ok');
  const over = enforceDepthLimit(DEFAULT_CHAIN_DEPTH_LIMIT + 1);
  assert.equal(over.action, 'reject');
  if (over.action === 'reject') {
    assert.equal(over.confidence, 'low');
    assert.match(over.reason, /never silently truncated/);
  }
  // a custom (smaller) limit is honoured.
  assert.equal(enforceDepthLimit(3, 2).action, 'reject');
  assert.equal(enforceDepthLimit(2, 2).action, 'ok');
});

test('AC-8.PLAN.003.1 — buildValidatedPlan wires the depth gate: an over-limit plan is rejected before assembly', () => {
  const steps = Array.from({ length: DEFAULT_CHAIN_DEPTH_LIMIT + 2 }, (_, i) => ({ index: i, agent_id: `a${i}` }));
  const rejected = buildValidatedPlan('big', steps);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.depth.confidence, 'low');

  const ok = buildValidatedPlan('small', [{ index: 0, agent_id: 'a', failure_mode: 'skip' }]);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.plan.steps[0]!.failure_mode, 'skip_and_continue'); // canonicalized
    assert.doesNotThrow(() => assertEveryStepAssigned(ok.plan));
  }
});

test('canonicalizePlanBody re-canonicalizes shorthand + asserts (the write-boundary drift guard, OD-201)', () => {
  const dirty: AssignedPlan = { task_type_name: 't', parallel: false, steps: [{ index: 0, agent_id: 'a', agent_name: null, depends_on: [], parallel_eligible: false, failure_mode: 'halt_escalate' as never, defaulted: false }] };
  const clean = canonicalizePlanBody(dirty);
  assert.equal(clean.steps[0]!.failure_mode, 'halt_and_escalate');
});

// ── AC-8.PLAN.004.1 — outcomes are attributable to plan versions. ───────────────────────────────────────
test('AC-8.PLAN.004.1 — recorded outcomes are attributed to plan versions', async () => {
  const admin = new InMemoryExecutionPlanAdmin(newPlanBacking());
  const p = assignFailureModes('draft_reply', [{ index: 0, agent_id: 'a', failure_mode: 'retry' }]);
  const v1 = await admin.saveVersion('draft_reply', p, null, 'sa-1', T0);
  const v2 = await admin.saveVersion('draft_reply', p, v1.id, 'sa-1', T0 + 1000);
  assert.equal(v2.version, 2, 'append-only version bump');

  await admin.attributeOutcome(v1.id, 'success', T0 + 10);
  await admin.attributeOutcome(v1.id, 'failure', T0 + 20);
  await admin.attributeOutcome(v2.id, 'success', T0 + 30);

  const tally = await admin.outcomesByVersion('draft_reply');
  assert.deepEqual(tally.get(v1.id), { success: 1, failure: 1, partial: 0 });
  assert.deepEqual(tally.get(v2.id), { success: 1, failure: 0, partial: 0 });
});

// ── AC-8.PLAN.004.2 — rollback is human-initiated + audited; never automatic. ───────────────────────────
test('AC-8.PLAN.004.2 — rollback is authority-gated (fail-closed), reason-mandatory, audited, and appends (never deletes)', async () => {
  const backing = newPlanBacking();
  const audit = new InMemoryRollbackAudit();
  const superAdmin = 'sa-1';
  const admin = new InMemoryExecutionPlanAdmin(backing, { authority: (a) => a === superAdmin, audit });

  const pA = assignFailureModes('t', [{ index: 0, agent_id: 'a', failure_mode: 'retry' }]);
  const pB = assignFailureModes('t', [{ index: 0, agent_id: 'b', failure_mode: 'halt_and_escalate' }]);
  const v1 = await admin.saveVersion('t', pA, null, superAdmin, T0);
  const v2 = await admin.saveVersion('t', pB, v1.id, superAdmin, T0 + 1000);

  // an UNAUTHORIZED actor is DENIED (fail-closed), no new version, no audit.
  await assert.rejects(admin.rollback('t', v1.id, 'standard-user', 'revert', T0 + 2000), new RegExp(ERR_ROLLBACK_UNAUTHORIZED('standard-user').slice(0, 30)));
  // a blank reason is rejected (it must be audited).
  await assert.rejects(admin.rollback('t', v1.id, superAdmin, '   ', T0 + 2000), new RegExp(ERR_ROLLBACK_NO_REASON.slice(0, 30)));
  assert.equal(backing.versions.length, 2, 'no version created by the rejected rollbacks');

  // an authorized human rollback to v1: appends a NEW version reinstating v1's plan_body; prior versions preserved.
  const v3 = await admin.rollback('t', v1.id, superAdmin, 'v2 regressed reply quality', T0 + 3000);
  assert.equal(v3.version, 3);
  assert.deepEqual(v3.planBody, pA, 'reinstates the target plan_body');
  assert.equal(backing.versions.length, 3, 'append-only: v1 and v2 still exist');
  assert.ok(backing.versions.some((v) => v.id === v1.id) && backing.versions.some((v) => v.id === v2.id));
  assert.equal(audit.rows.length, 1, 'the rollback is audited');
  assert.equal(audit.rows[0]!.reason, 'v2 regressed reply quality');
});

test('AC-8.PLAN.004.2 — the DEFAULT rollback authority denies everything (an un-wired authority never permits)', async () => {
  const admin = new InMemoryExecutionPlanAdmin(newPlanBacking()); // no authority injected → denyAllRollback
  const p = assignFailureModes('t', [{ index: 0, agent_id: 'a', failure_mode: 'retry' }]);
  await admin.saveVersion('t', p, null, 'sa', T0);
  await assert.rejects(admin.rollback('t', 'plan-0001', 'sa', 'x', T0 + 10), /not authorized/);
  assert.equal(denyAllRollback('anyone'), false);
});

// ── AC-8.ORC.005.2 (consumed) — a chain from the orchestrator has every step carrying a (canonical) mode. ──
test('AC-8.ORC.005.2 (wire-to) — an ISSUE-061-shaped chain canonicalizes so every step carries a valid mode', () => {
  // simulate the orchestrator's PlanStep output (shorthand modes, a sequential chain).
  const orchSteps = [
    { index: 0, agent_id: 'research', agent_name: 'Research', depends_on: [], parallel_eligible: false, failure_mode: 'halt_escalate' },
    { index: 1, agent_id: 'draft', agent_name: 'Comms', depends_on: [0], parallel_eligible: false, failure_mode: 'halt_escalate' },
  ];
  const plan = assignFailureModes('complex_task', orchSteps);
  assert.doesNotThrow(() => assertEveryStepAssigned(plan));
  assert.ok(plan.steps.every((s) => STEP_FAILURE_MODES.includes(s.failure_mode)));
});
