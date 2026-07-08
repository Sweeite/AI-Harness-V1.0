// ISSUE-058 — offline AC suite for the C6 rate-limit + cost-ladder ENFORCEMENT slice. One test per §4 AC
// where practical. Uses the in-memory GuardrailLogSink fake as the #3 seam.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CAP_IDS,
  CAP_POLICIES,
  validateCapConfig,
} from './caps.ts';
import {
  classifyCostRung,
  decideCostRung,
  decideForWork,
  decideRateBreach,
  validateCostThresholds,
  weeklySoftAlert,
  routeNewDangerousCapability,
  DEFAULT_COST_THRESHOLDS,
  COST_LEVER_ORDER,
  COST_MODEL_GATES,
  NON_CRITICAL_WORK,
  CRITICAL_WORK,
  type WorkClass,
} from './ladder.ts';
import {
  InMemoryGuardrailLogSink,
  RateCostLadder,
  GUARDRAIL_TYPE_RATE_LIMIT,
} from './store.ts';
import { runChecks } from './index.ts';

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// AC-6.RTL.001.1 — the five caps reject unlimited/zero-guard AND an absurd-but-finite ceiling.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-6.RTL.001.1 — every cap rejects unlimited / zero-guard sentinels', () => {
  assert.equal(CAP_IDS.length, 5, 'there must be exactly five caps');
  const unlimitedForms: unknown[] = [null, undefined, Infinity, -Infinity, NaN, 'unlimited', 'none', 'off', '', '-1', 1.5, 'abc', {}];
  for (const cap of CAP_IDS) {
    for (const form of unlimitedForms) {
      const r = validateCapConfig(cap, form);
      assert.equal(r.ok, false, `${cap} must reject ${String(form)}`);
    }
    // Zero-guard: 0 is rejected for the min-1 caps; for retries (min 0) 0 is a valid strong guard.
    const zero = validateCapConfig(cap, 0);
    if (CAP_POLICIES[cap].min >= 1) assert.equal(zero.ok, false, `${cap} must reject 0 (zero-guard)`);
    else assert.equal(zero.ok, true, `${cap} (min 0) accepts 0 = immediate DLQ, a strong guard`);
  }
});

test('AC-6.RTL.001.1 (L2) — every cap rejects an absurd-but-finite value above its ceiling', () => {
  for (const cap of CAP_IDS) {
    const p = CAP_POLICIES[cap];
    const overCeiling = validateCapConfig(cap, p.ceiling + 1);
    assert.equal(overCeiling.ok, false, `${cap} must reject ${p.ceiling + 1} (> ceiling ${p.ceiling}) — functionally unguarded`);
    assert.match((overCeiling as { reason: string }).reason, /unguarded|ceiling/);
    // An absurd value like 1e9 is "not unlimited" yet rejected.
    assert.equal(validateCapConfig(cap, 1_000_000_000).ok, false, `${cap} must reject 1e9`);
    // A sane value in range is accepted.
    const ok = validateCapConfig(cap, p.default);
    assert.equal(ok.ok, true, `${cap} accepts its default ${p.default}`);
    assert.equal((ok as { value: number }).value, p.default);
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// AC-6.RTL.002.1 — one consistent breach response regardless of which owner's counter detected it.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-6.RTL.002.1 — the breach response does not diverge per owner (C2/C3/C5 all get the same shape)', async () => {
  const sink = new InMemoryGuardrailLogSink();
  const ladder = new RateCostLadder(sink);
  const results = [];
  for (const cap of CAP_IDS) {
    // Same severity/context across every owner's cap → the outcome must be identical.
    const rec = await ladder.recordCapBreach({ cap, severity: 'hard' });
    results.push(rec.decision.outcome);
    assert.equal(rec.decision.actionBlocked, true);
    assert.notEqual(rec.logRowId, null, `${cap} breach wrote a guardrail_log row`);
  }
  assert.equal(new Set(results).size, 1, 'all five owners share ONE breach outcome (no per-owner divergence)');
  // Every breach wrote a rate_limit-class row (AC-6.RTL.001.2).
  assert.equal(sink.rateLimitRows().length, 5);
  for (const row of sink.rows) assert.equal(row.guardrailType, GUARDRAIL_TYPE_RATE_LIMIT);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// AC-6.RTL.001.2 / AC-6.RTL.003.1 — breach writes a rate_limit row; soft continues, hard stops.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-6.RTL.003.1 — soft breach alerts + continues; hard breach stops + flags; both logged', async () => {
  const sink = new InMemoryGuardrailLogSink();
  const ladder = new RateCostLadder(sink);

  const soft = await ladder.recordCapBreach({ cap: 'rate_limit_memory_writes_per_minute', severity: 'soft' });
  assert.equal(soft.decision.outcome, 'alert_continue');
  assert.equal(soft.decision.actionBlocked, false);
  assert.notEqual(soft.logRowId, null, 'even a soft breach writes a guardrail_log row (#3)');

  const hard = await ladder.recordCapBreach({ cap: 'rate_limit_memory_writes_per_minute', severity: 'hard' });
  assert.equal(hard.decision.outcome, 'hard_stop');
  assert.equal(hard.decision.actionBlocked, true);
  assert.equal(sink.rateLimitRows().length, 2, 'both breaches logged');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// AC-6.RTL.003.2 — irreversible/billed action at cap halts-and-escalates, excluded from auto-retry.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-6.RTL.003.2 — irreversible/billed action at cap halts-and-escalates and is NOT auto-retried', async () => {
  const sink = new InMemoryGuardrailLogSink();
  const ladder = new RateCostLadder(sink);
  const rec = await ladder.recordCapBreach({ cap: 'rate_limit_external_comms_per_hour', severity: 'hard', irreversibleOrBilled: true });
  assert.equal(rec.decision.outcome, 'halt_escalate');
  assert.equal(rec.decision.autoRetryEligible, false, 'an irreversible/billed action must be excluded from auto-retry');
  assert.equal(rec.decision.actionBlocked, true);
  assert.match(sink.rows[0]!.description, /excluded from auto-retry/);
  // The pure decision is deterministic regardless of the ladder severity too.
  assert.equal(decideRateBreach({ cap: 'rate_limit_tool_writes_per_task', severity: 'soft', irreversibleOrBilled: true }).outcome, 'halt_escalate');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// AC-6.RTL.004.1 / AC-NFR-COST.001.1/.2 — the four-rung ladder; a synthetic spend series crosses each
// rung and fires EXACTLY that rung, no rung skipped or silent.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-NFR-COST.001.1 — the four rungs exist with defaults 50/200/75/100 and are per-deployment editable', () => {
  assert.equal(DEFAULT_COST_THRESHOLDS.softDailyUsd, 50);
  assert.equal(DEFAULT_COST_THRESHOLDS.softWeeklyUsd, 200);
  assert.equal(DEFAULT_COST_THRESHOLDS.throttleDailyUsd, 75);
  assert.equal(DEFAULT_COST_THRESHOLDS.hardKillDailyUsd, 100);
  // Editable: a custom (validly-ordered) threshold set is accepted; a mis-ordered one is rejected.
  assert.equal(validateCostThresholds({ softDailyUsd: 10, softWeeklyUsd: 40, throttleDailyUsd: 20, hardKillDailyUsd: 30 }).ok, true);
  assert.equal(validateCostThresholds({ softDailyUsd: 80, softWeeklyUsd: 200, throttleDailyUsd: 75, hardKillDailyUsd: 100 }).ok, false);
});

test('AC-NFR-COST.001.2 — a synthetic spend series crosses each rung firing exactly that rung, none skipped/silent', async () => {
  const series = [0, 10, 49, 50, 60, 74, 75, 90, 99, 100, 150];
  const expected = ['ok', 'ok', 'ok', 'soft', 'soft', 'soft', 'throttle', 'throttle', 'throttle', 'hard_kill', 'hard_kill'];
  const observed = series.map((s) => classifyCostRung(s));
  assert.deepEqual(observed, expected);

  // Walking the series upward, every rung transition writes a guardrail_log row (never silent).
  const sink = new InMemoryGuardrailLogSink();
  const ladder = new RateCostLadder(sink);
  const seenRungs = new Set<string>();
  let last = 'ok';
  for (const spend of series) {
    const rung = classifyCostRung(spend);
    if (rung !== 'ok' && rung !== last) {
      const rec = await ladder.recordCostRung({ rung, estimatedDailyUsd: spend, source: 'C7' });
      assert.equal(rec.disposition.rung, rung);
      assert.notEqual(rec.logRowId, null, `rung ${rung} transition must write a guardrail_log row`);
      seenRungs.add(rung);
    }
    last = rung;
  }
  assert.deepEqual([...seenRungs].sort(), ['hard_kill', 'soft', 'throttle']);
  assert.equal(sink.rateLimitRows().length, 3, 'exactly one row per rung transition, none skipped');
});

test('AC-6.RTL.004.1 — soft rung raises an alert and work continues (no throttle yet)', () => {
  const d = decideCostRung({ rung: 'soft', source: 'C7' });
  assert.equal(d.action, 'alert');
  assert.equal(d.reduceLoopCadence, false);
  assert.equal(d.stopNewConsequentialSpend, false);
  assert.equal(d.affectedWorkClasses.length, 0, 'soft touches no work');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// AC-6.RTL.004.2 / AC-NFR-COST.002.1/.2 — throttle defers non-critical; user-facing/urgent untouched;
// critical in-flight escalates rather than being dropped.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-NFR-COST.002.1 — throttle defers non-critical + reduces loop cadence + writes a row', async () => {
  const sink = new InMemoryGuardrailLogSink();
  const ladder = new RateCostLadder(sink);
  const rec = await ladder.recordCostRung({ rung: 'throttle', source: 'C7' });
  assert.equal(rec.disposition.action, 'throttle');
  assert.equal(rec.disposition.reduceLoopCadence, true);
  assert.deepEqual([...rec.disposition.affectedWorkClasses].sort(), [...NON_CRITICAL_WORK].sort());
  assert.notEqual(rec.logRowId, null);
  // Every non-critical class defers at throttle.
  for (const w of NON_CRITICAL_WORK) assert.equal(decideForWork('throttle', { workClass: w }), 'defer', `${w} defers`);
});

test('AC-NFR-COST.002.2 — user-facing/urgent not throttled; critical in-flight escalates, never dropped', () => {
  for (const w of CRITICAL_WORK) {
    assert.equal(decideForWork('throttle', { workClass: w }), 'run', `${w} is not throttled`);
  }
  // A critical in-flight task that cannot proceed escalates (never silently dropped).
  assert.equal(decideForWork('throttle', { workClass: 'urgent_fast_loop', inFlightBlocked: true }), 'escalate');
  assert.equal(decideForWork('hard_kill', { workClass: 'human_initiated', inFlightBlocked: true }), 'escalate');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// AC-6.RTL.004.3 / AC-NFR-COST.003.1/.2 — hard-kill stops non-critical spend; only urgent/human/guardrail
// run; a row is written; never overrides a hard limit; irreversible/billed halts-and-escalates.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-NFR-COST.003.1 — at hard-kill only urgent/human-initiated/human-approved/guardrail run; non-critical killed', () => {
  for (const w of NON_CRITICAL_WORK) assert.equal(decideForWork('hard_kill', { workClass: w }), 'kill', `${w} killed`);
  for (const w of CRITICAL_WORK) assert.equal(decideForWork('hard_kill', { workClass: w }), 'run', `${w} still runs`);
});

test('AC-NFR-COST.003.2 — hard-kill writes a rate_limit row + stops new consequential spend; irreversible halts-escalates', async () => {
  const sink = new InMemoryGuardrailLogSink();
  const ladder = new RateCostLadder(sink);
  const rec = await ladder.recordCostRung({ rung: 'hard_kill', estimatedDailyUsd: 120, source: 'C7' });
  assert.equal(rec.disposition.action, 'hard_kill');
  assert.equal(rec.disposition.stopNewConsequentialSpend, true);
  assert.equal(sink.rateLimitRows().length, 1);
  assert.equal(sink.rows[0]!.guardrailType, GUARDRAIL_TYPE_RATE_LIMIT);
  assert.equal(sink.rows[0]!.actionBlocked, true);
  // An irreversible/billed action at the hard rung halts-and-escalates (never proceeds).
  assert.equal(decideForWork('hard_kill', { workClass: 'human_approved', irreversibleOrBilled: true }), 'halt_escalate');
});

// AC-6.RTL.004.3 / AC-NFR-COST.003.2 (#2) — a cost rung NEVER overrides or relaxes a hard limit.
test('AC-6.RTL.004.3 (#2) — no cost rung relaxes a hard limit', () => {
  for (const rung of ['ok', 'soft', 'throttle', 'hard_kill'] as const) {
    // A hard-limit-blocked action stays halted at EVERY rung, even soft (the cost layer can never permit it).
    assert.equal(
      decideForWork(rung, { workClass: 'human_approved', hardLimitBlocked: true }),
      'halt_escalate',
      `rung ${rung} must not relax a hard limit`,
    );
  }
  // The disposition carries the invariant marker.
  for (const rung of ['soft', 'throttle', 'hard_kill'] as const) {
    assert.equal(decideCostRung({ rung }).relaxesHardLimit, false);
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// AC-NFR-COST.004.1/.2 — decide/execute split: C6 emits a disposition (data); it never itself throttles/kills.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-NFR-COST.004.1 — C6 emits a disposition C5 executes; the coordinator never mutates a run/queue', async () => {
  const sink = new InMemoryGuardrailLogSink();
  const ladder = new RateCostLadder(sink);
  const rec = await ladder.recordCostRung({ rung: 'throttle', source: 'C7' });
  // The disposition is plain data (a decision), not an executed action — it lists what C5 should do.
  assert.equal(typeof rec.disposition, 'object');
  assert.ok(Array.isArray(rec.disposition.affectedWorkClasses));
  // The ONLY side effect the coordinator produced is the loud log row — no run/queue handle exists on it.
  assert.equal(sink.rateLimitRows().length, 1);
  assert.equal('execute' in (ladder as unknown as Record<string, unknown>), false, 'C6 has no execute/kill method');
});

test('AC-NFR-COST.004.2 — the rung disposition never claims it enforced the throttle/kill (decide ≠ execute)', () => {
  const d = decideCostRung({ rung: 'hard_kill' });
  // It records intent (stopNewConsequentialSpend/flag) but exposes no "enforced/executed" assertion.
  assert.equal('enforced' in d, false);
  assert.equal('executed' in d, false);
  assert.equal(d.stopNewConsequentialSpend, true);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// AC-NFR-COST.007.1/.2 — controls-before-gates lever order; exactly one cost model-gate.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-NFR-COST.007.1 — the cost-lever order is the ADR-003 §7 order, ceiling raised last', () => {
  assert.deepEqual([...COST_LEVER_ORDER], [
    'model_routing',
    'selective_writing_gate',
    'loop_idle_gating',
    'memory_injection_limit',
    'orchestrator_confidence_threshold',
  ]);
});

test('AC-NFR-COST.007.2 — exactly ONE cost model-gate exists (the Haiku selective-writing gate)', () => {
  assert.equal(COST_MODEL_GATES.length, 1);
  assert.equal(COST_MODEL_GATES[0], 'haiku_selective_writing');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// AC-NFR-SEC.005.1 — a new dangerous capability is gated (hard-approval + rate cap), never auto-allowed.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('AC-NFR-SEC.005.1 — a new dangerous capability routes to hard-approval + a rate cap, never auto-allowed', () => {
  const r = routeNewDangerousCapability('bulk_export_v2');
  assert.equal(r.gate, 'hard_approval');
  assert.equal(r.rateCapped, true);
  assert.equal(r.autoAllowed, false, 'never silently auto-allowed (#2)');
  assert.equal(r.reachableOnlyViaHumanStep, true);
  assert.throws(() => routeNewDangerousCapability(''), /required/, 'a nameless capability cannot be gated');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// #3 — a log-write failure is SURFACED, never swallowed (the safety decision still holds).
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('#3 — a guardrail_log write failure is surfaced as logWriteFailed, not silently swallowed', async () => {
  const sink = new InMemoryGuardrailLogSink();
  const ladder = new RateCostLadder(sink);
  sink.failNextWrite = true;
  const rec = await ladder.recordCapBreach({ cap: 'rate_limit_tool_writes_per_task', severity: 'hard' });
  assert.equal(rec.logWriteFailed, true, 'the failure is surfaced');
  assert.equal(rec.logRowId, null);
  assert.equal(rec.decision.outcome, 'hard_stop', 'the safety decision still stands despite the log failure');
});

test('#3 — a contentless (empty-description) log row is rejected loudly', async () => {
  const sink = new InMemoryGuardrailLogSink();
  await assert.rejects(
    () => sink.writeRateLimitRow({ taskId: null, guardrailType: GUARDRAIL_TYPE_RATE_LIMIT, description: '  ', actionBlocked: true }),
    /non-empty description/,
  );
});

// Regression (fake↔adapter drift): guardrail_log.task_id is `uuid references task_queue(id)`. The fake used to
// accept ANY string, so a malformed task_id passed offline while the live adapter would throw at the DB and —
// under the log-failure posture — silently lose the row (#1). The fake now rejects a non-UUID task_id LOUDLY,
// matching live 1:1. A well-formed UUID (and null) is still accepted.
test('#1/#3 — a malformed (non-UUID) task_id is rejected loudly, not silently accepted then lost live', async () => {
  const sink = new InMemoryGuardrailLogSink();
  await assert.rejects(
    () => sink.writeRateLimitRow({ taskId: 'not-a-uuid', guardrailType: GUARDRAIL_TYPE_RATE_LIMIT, description: 'x', actionBlocked: false }),
    /task_id must be null or a canonical UUID/,
  );
  assert.equal(sink.rows.length, 0, 'a malformed task_id writes NO row');
});

test('#1 — a well-formed UUID task_id (and null) is accepted', async () => {
  const sink = new InMemoryGuardrailLogSink();
  const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
  const id = await sink.writeRateLimitRow({ taskId: uuid, guardrailType: GUARDRAIL_TYPE_RATE_LIMIT, description: 'x', actionBlocked: false });
  assert.ok(id);
  assert.equal(sink.rows[0]!.taskId, uuid);
  // null (no task association) remains valid.
  const rec = await new RateCostLadder(sink).recordCapBreach({ cap: 'rate_limit_tool_writes_per_task', severity: 'soft' }, null);
  assert.notEqual(rec.logRowId, null);
});

test('recordCapBreach with a malformed task_id surfaces the loud reject as logWriteFailed (row not silently lost)', async () => {
  const sink = new InMemoryGuardrailLogSink();
  const ladder = new RateCostLadder(sink);
  const rec = await ladder.recordCapBreach({ cap: 'rate_limit_tool_writes_per_task', severity: 'hard' }, 'bogus-task-id');
  assert.equal(rec.logWriteFailed, true, 'the malformed-task_id write fails LOUDLY (surfaced), matching live');
  assert.equal(rec.logRowId, null);
  assert.equal(rec.decision.outcome, 'hard_stop', 'the safety decision still stands');
  assert.equal(sink.rows.length, 0);
});

test('weekly soft alert is human-attention only (no weekly auto-throttle at v1)', () => {
  assert.equal(weeklySoftAlert(199), false);
  assert.equal(weeklySoftAlert(200), true);
  assert.equal(weeklySoftAlert(500), true);
});

test('classifyCostRung refuses a blind/negative meter reading (never read as $0 — NFR-COST.005)', () => {
  assert.throws(() => classifyCostRung(-1), /finite, non-negative/);
  assert.throws(() => classifyCostRung(Number.NaN), /finite, non-negative/);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// The index.ts `check` non-drift guard passes (constants ↔ config-registry.md ↔ baseline enum).
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('check gate — every non-drift gate passes', () => {
  const findings = runChecks();
  const failed = findings.filter((f) => !f.ok);
  assert.equal(failed.length, 0, `check gate failures: ${JSON.stringify(failed)}`);
  assert.ok(findings.length >= 10, 'the check gate covers enum + cost defaults + all five caps + gate/lever counts');
});

// Regression (drift-guard gap): the non-drift gate must ALSO cross-check each bounded cap's code ceiling
// against the registry's declared range max — a ceiling that drifts from the registry (e.g. → 999) previously
// passed the ceiling>default/finite check silently. The four rate caps carry a bounded range (1–200/100/300/50);
// max_retries' registry range is unbounded above (`int ≥ 0`) so it has no ceiling-range gate (tracked in spec).
test('check gate — each bounded cap ceiling is cross-checked against the registry range max', () => {
  const findings = runChecks();
  const ceilingGates = findings.filter((f) => f.gate.startsWith('cap-ceiling-matches-registry-range:'));
  assert.equal(ceilingGates.length, 4, 'the four bounded rate caps each get a ceiling↔registry-range gate');
  assert.ok(
    ceilingGates.every((f) => f.ok),
    `ceiling↔range drift: ${JSON.stringify(ceilingGates.filter((f) => !f.ok))}`,
  );
  // The unbounded cap is deliberately NOT ceiling-range-gated (its registry max would need tightening first).
  assert.ok(
    !findings.some((f) => f.gate === 'cap-ceiling-matches-registry-range:max_retries_before_dead_letter'),
    'max_retries has no registry upper bound to compare against',
  );
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// #3 — the decision switches fail LOUD on an out-of-band value, never fall through to `undefined`.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
test('#3 — decideCostRung throws on an unknown rung rather than returning undefined', () => {
  // A runtime C7 signal carrying a rung outside soft/throttle/hard_kill (e.g. 'ok' or garbage) must reject
  // loudly, not fall through to undefined (which would then crash the coordinator AFTER skipping the log write).
  assert.throws(
    () => decideCostRung({ rung: 'ok' as unknown as 'soft' }),
    /unknown cost rung/,
  );
  assert.throws(
    () => decideCostRung({ rung: 'garbage' as unknown as 'soft' }),
    /unknown cost rung/,
  );
});

test('#3 — recordCostRung on an unknown rung rejects loudly (no phantom guardrail_log row written)', async () => {
  const sink = new InMemoryGuardrailLogSink();
  const ladder = new RateCostLadder(sink);
  await assert.rejects(
    () => ladder.recordCostRung({ rung: 'ok' as unknown as 'soft', source: 'C7' }),
    /unknown cost rung/,
  );
  assert.equal(sink.rateLimitRows().length, 0, 'a rejected rung writes NO guardrail_log row');
});

test('#3 — decideRateBreach throws on an unknown severity rather than returning undefined', () => {
  assert.throws(
    () => decideRateBreach({ cap: 'rate_limit_tool_writes_per_task', severity: 'boom' as unknown as 'soft' }),
    /unknown severity/,
  );
});

// Type-only helper so unused WorkClass import is meaningful in strict mode.
const _sampleWorkClass: WorkClass = 'proactive_suggestion';
void _sampleWorkClass;
