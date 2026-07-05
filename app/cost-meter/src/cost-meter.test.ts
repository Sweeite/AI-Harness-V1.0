// ISSUE-074 — one test per AC in §4 Definition of done. Proved against the InMemoryCostMeterStore reference
// model + the pure estimator/ladder helpers (offline; the live event_log/config_values/notifications proof is
// owed to results/issue-074-live-proof.md — see notes). Every assertion has TEETH: it distinguishes the
// correct value from a plausible-but-wrong one (a floor-instead-of-ceil, a silent-0 sentinel, a skipped rung,
// a C7 that over-reaches into enforcement).
//
// AC map:
//   AC-7.COST.001.1   — price_table is operator-editable; a price change RE-BASES subsequent estimates (no deploy)
//   AC-7.COST.001.2   — cost figures are labelled/treated as estimates, never the vendor invoice
//   AC-7.COST.002.1   — cost aggregates are queryable/GROUPABLE by task type
//   AC-7.COST.002.2   — the aggregation is populated from the FIRST task (not retrofitted)
//   AC-7.COST.003.1   — the three ladder thresholds are per-deployment configurable
//   AC-7.COST.003.2   — soft → cost_threshold alert; throttle/kill → C6 breach signal (C7 does not throttle/kill)
//   AC-7.COST.003.3   — the decide/execute seam is bilateral: C7 emits; enforcement is a C6/C5 concern
//   AC-7.COST.004.1   — exceeding the daily OR weekly threshold raises a dashboard notification
//   AC-NFR-COST.005.1 — estimate = cost_tokens × price_table over ALL vendors, ROUNDED UP, never the invoice
//   AC-NFR-COST.005.2 — a price change re-bases without a deploy
//   AC-NFR-COST.010.1 — per-task-type aggregation from the FIRST task, groupable
//   AC-NFR-COST.001.1 — four rungs at defaults 50/200/75/100, every threshold per-deployment editable
//   AC-NFR-COST.001.2 — no rung skipped or silent (a jump past a rung still reports it, each with an action)
//   AC-NFR-COST.004.1 — C7 emits the signal; C7 does NOT throttle or kill the run itself
//   AC-NFR-COST.004.2 — a lit rung renders state; it never claims the surface enforced the throttle/kill

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemoryCostMeterStore,
  LADDER_DEFAULTS,
  RUNGS,
  UNATTRIBUTED_TASK_TYPE,
  COST_THRESHOLD_BREACH,
  estimate,
  estimateEventCents,
  evaluateLadder,
  assertLadderOrdered,
  type EventLogCostRow,
  type PriceTable,
  type CostLadderConfig,
} from './index.ts';

// ── fixtures ────────────────────────────────────────────────────────────────────
const T0 = 1_751_673_600; // 2025-07-05T00:00:00Z-ish fixed "now" (epoch seconds)
const iso = (sec: number) => new Date(sec * 1000).toISOString();

// A realistic all-vendor price table (config-registry §App.A #10 rates, $/1k tokens).
const PRICE_TABLE: PriceTable = {
  sonnet: { input: 0.003, output: 0.015 },
  haiku: { input: 0.0008, output: 0.004 },
  'text-embedding-3-small': { input: 0.00002 }, // single-rate (embedding), $/1k input
};

function ev(partial: Partial<EventLogCostRow> & Pick<EventLogCostRow, 'id'>): EventLogCostRow {
  return {
    task_id: null,
    event_type: 'tool_called',
    cost_tokens: 0,
    cost_unknown: false,
    model: null,
    created_at: iso(T0),
    ...partial,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// AC-7.COST.001.1 / AC-NFR-COST.005.2 — a price_table edit RE-BASES subsequent estimates, no deploy
// ─────────────────────────────────────────────────────────────────────────────────
test('AC-7.COST.001.1 / AC-NFR-COST.005.2 — editing price_table re-bases the next estimate (no deploy)', async () => {
  const store = new InMemoryCostMeterStore(PRICE_TABLE, LADDER_DEFAULTS);
  const rows = [ev({ id: 'a', cost_tokens: 1_000_000, model: 'sonnet' })]; // 1M tokens @ 0.015/1k = $15.00

  const before = await store.estimateSpend(rows);
  assert.equal(before.cents, 1500, '1M sonnet tokens @ 0.015/1k (higher rate) = $15.00');

  // Operator DOUBLES the sonnet output price live — no redeploy, just a config edit.
  store.setPriceTable({ ...PRICE_TABLE, sonnet: { input: 0.003, output: 0.03 } });
  const after = await store.estimateSpend(rows);
  assert.equal(after.cents, 3000, 'the SAME rows must re-base to $30.00 after the live price edit');
  // Teeth: it genuinely changed (not a stale cached figure).
  assert.notEqual(before.cents, after.cents, 'a live price edit must change the estimate, not return a cached value');
});

// ─────────────────────────────────────────────────────────────────────────────────
// AC-7.COST.001.2 — cost figures are estimates, never the vendor invoice
// ─────────────────────────────────────────────────────────────────────────────────
test('AC-7.COST.001.2 — the meter never claims to be the invoice; the alert body says estimate-grade', async () => {
  const store = new InMemoryCostMeterStore(PRICE_TABLE, LADDER_DEFAULTS);
  // Push the daily meter over the $50 soft rung so a notification is written.
  store.addEvent(ev({ id: 'big', cost_tokens: 4_000_000, model: 'sonnet', created_at: iso(T0 - 60) })); // $60
  const res = await store.meterAndEvaluate(T0);
  const note = res.notificationsWritten[0];
  assert.ok(note, 'a soft-rung breach must write a notification');
  // Teeth: the surfaced figure is explicitly labelled an estimate and disclaims the invoice.
  assert.match(note!.body, /estimate-grade/i, 'the cost figure must be labelled an estimate');
  assert.match(note!.body, /never the vendor invoice/i, 'the meter must disclaim being the vendor invoice');
});

// ─────────────────────────────────────────────────────────────────────────────────
// AC-7.COST.002.1 / AC-NFR-COST.010.1 — cost is queryable/GROUPABLE by task type
// ─────────────────────────────────────────────────────────────────────────────────
test('AC-7.COST.002.1 / AC-NFR-COST.010.1 — cost aggregates group by task type, distinctly', async () => {
  const store = new InMemoryCostMeterStore(PRICE_TABLE, LADDER_DEFAULTS);
  store.addTaskType({ task_id: 't-sched', task_type: 'scheduled' });
  store.addTaskType({ task_id: 't-human', task_type: 'human' });
  const rows = [
    ev({ id: 'e1', task_id: 't-sched', cost_tokens: 1_000_000, model: 'sonnet' }), // $15 → scheduled
    ev({ id: 'e2', task_id: 't-sched', cost_tokens: 1_000_000, model: 'haiku' }), //  $4 → scheduled
    ev({ id: 'e3', task_id: 't-human', cost_tokens: 1_000_000, model: 'sonnet' }), // $15 → human
  ];
  const agg = await store.aggregateByTaskType(rows);
  const byType = new Map(agg.map((a) => [a.task_type, a]));
  assert.equal(byType.get('scheduled')!.cents, 1500 + 400, 'scheduled = $15 sonnet + $4 haiku = $19.00');
  assert.equal(byType.get('human')!.cents, 1500, 'human = $15.00');
  // Teeth: the two task types are DISTINCT buckets, not a merged total.
  assert.notEqual(byType.get('scheduled')!.cents, byType.get('human')!.cents, 'buckets must be per-type, not merged');
  assert.equal(agg.length, 2, 'exactly two task-type buckets');
});

// ─────────────────────────────────────────────────────────────────────────────────
// AC-7.COST.002.2 — the aggregation is populated from the FIRST task (not retrofitted)
// ─────────────────────────────────────────────────────────────────────────────────
test('AC-7.COST.002.2 — the very first task on a fresh deployment is aggregated (not retrofitted)', async () => {
  const store = new InMemoryCostMeterStore(PRICE_TABLE, LADDER_DEFAULTS); // fresh: no prior events
  store.addTaskType({ task_id: 't-first', task_type: 'event' });
  const firstTaskRows = [ev({ id: 'first', task_id: 't-first', cost_tokens: 500_000, model: 'sonnet' })]; // $7.50
  const agg = await store.aggregateByTaskType(firstTaskRows);
  assert.equal(agg.length, 1, 'the first task must appear immediately in the aggregation');
  assert.equal(agg[0]!.task_type, 'event');
  assert.equal(agg[0]!.cents, 750, 'the first task cost is captured from the start ($7.50), not zero/retrofitted');
  // Teeth: an event whose task_type cannot be resolved is BUCKETED, never dropped (no lost cost).
  const orphan = await store.aggregateByTaskType([ev({ id: 'orphan', task_id: 't-unknown', cost_tokens: 1_000_000, model: 'sonnet' })]);
  assert.equal(orphan[0]!.task_type, UNATTRIBUTED_TASK_TYPE, 'an unresolved task_type buckets under __unattributed__, never dropped');
  assert.equal(orphan[0]!.cents, 1500, 'the unattributed cost is still counted (#1 — never lose a cost figure)');
});

// ─────────────────────────────────────────────────────────────────────────────────
// AC-7.COST.003.1 / AC-NFR-COST.001.1 — three thresholds per-deployment configurable; four rungs at defaults
// ─────────────────────────────────────────────────────────────────────────────────
test('AC-7.COST.003.1 / AC-NFR-COST.001.1 — four rungs at 50/200/75/100, per-deployment editable', async () => {
  // Defaults exist and match ADR-003 §2.
  assert.equal(RUNGS.length, 4, 'exactly four rungs');
  assert.deepEqual(
    [
      LADDER_DEFAULTS.cost_ladder_soft_threshold_daily_usd,
      LADDER_DEFAULTS.cost_ladder_soft_threshold_weekly_usd,
      LADDER_DEFAULTS.cost_ladder_throttle_threshold,
      LADDER_DEFAULTS.cost_ladder_hard_kill_threshold,
    ],
    [50, 200, 75, 100],
    'defaults must be 50/200/75/100',
  );
  // Per-deployment editable: a store with a tighter ladder fires the throttle signal at a lower $.
  const tight: CostLadderConfig = { cost_ladder_soft_threshold_daily_usd: 5, cost_ladder_soft_threshold_weekly_usd: 20, cost_ladder_throttle_threshold: 8, cost_ladder_hard_kill_threshold: 10 };
  const store = new InMemoryCostMeterStore(PRICE_TABLE, tight);
  store.addEvent(ev({ id: 'x', cost_tokens: 600_000, model: 'sonnet', created_at: iso(T0 - 60) })); // $9/day
  const res = await store.meterAndEvaluate(T0);
  const rungs = res.ladder.breaches.map((b) => b.rung);
  assert.ok(rungs.includes('throttle'), 'the tightened $8 throttle rung must fire at $9/day');
  assert.ok(!rungs.includes('hard_kill'), '$9/day is under the tightened $10 kill — kill must NOT fire');
  // Teeth: the DEFAULT ladder would NOT have fired throttle at $9 (proves the config drove the outcome).
  const defStore = new InMemoryCostMeterStore(PRICE_TABLE, LADDER_DEFAULTS);
  defStore.addEvent(ev({ id: 'y', cost_tokens: 600_000, model: 'sonnet', created_at: iso(T0 - 60) }));
  const defRes = await defStore.meterAndEvaluate(T0);
  assert.ok(!defRes.ladder.breaches.some((b) => b.rung === 'throttle'), 'at defaults, $9/day is far under the $75 throttle — no throttle');
});

// ─────────────────────────────────────────────────────────────────────────────────
// AC-7.COST.003.2 / AC-NFR-COST.004.1 — soft → alert; throttle/kill → C6 signal; C7 never throttles/kills
// ─────────────────────────────────────────────────────────────────────────────────
test('AC-7.COST.003.2 / AC-NFR-COST.004.1 — soft writes an alert; throttle/kill emit a C6 signal, no self-kill', async () => {
  const store = new InMemoryCostMeterStore(PRICE_TABLE, LADDER_DEFAULTS);
  // $80/day: over soft ($50) and throttle ($75), under kill ($100).
  store.addEvent(ev({ id: 'spend', cost_tokens: 5_333_400, model: 'sonnet', created_at: iso(T0 - 60) })); // ceil → $80.001 ≈ $80.01
  const res = await store.meterAndEvaluate(T0);
  const rungs = res.ladder.breaches.map((b) => b.rung);
  assert.ok(rungs.includes('soft_daily'), 'soft_daily must fire at $80');
  assert.ok(rungs.includes('throttle'), 'throttle must fire at $80 (> $75)');
  assert.ok(!rungs.includes('hard_kill'), 'hard_kill must NOT fire at $80 (< $100)');
  // Soft rung → a notification WAS written; throttle rung → a signal was EMITTED (not an enforcement).
  assert.equal(res.notificationsWritten.length, 1, 'exactly one soft-rung notification');
  assert.equal(res.ladder.signals.length, 1, 'exactly one C6 breach signal (throttle)');
  assert.equal(res.ladder.signals[0]!.rung, 'throttle');
  // Teeth: C7 does NOT enforce — the signal explicitly disclaims it, and there is no kill artifact.
  assert.equal(res.ladder.signals[0]!.enforced_by_c7, false, 'C7 emits the signal but must NEVER enforce (AC-NFR-COST.004.1)');
});

// ─────────────────────────────────────────────────────────────────────────────────
// AC-7.COST.003.3 — the decide/execute seam is bilateral: C7 emits; enforcement is C6/C5's, not here
// ─────────────────────────────────────────────────────────────────────────────────
test('AC-7.COST.003.3 — C7 emits the throttle/kill signal; no throttle/kill mechanism exists in this module', async () => {
  const store = new InMemoryCostMeterStore(PRICE_TABLE, LADDER_DEFAULTS);
  store.addEvent(ev({ id: 'huge', cost_tokens: 8_000_000, model: 'sonnet', created_at: iso(T0 - 60) })); // $120/day → past kill
  const res = await store.meterAndEvaluate(T0);
  // Both throttle and kill signals emitted (bilateral seam: C7's whole job is the signal).
  const signalRungs = res.ladder.signals.map((s) => s.rung).sort();
  assert.deepEqual(signalRungs, ['hard_kill', 'throttle'], 'both throttle and kill signals must be emitted at $120/day');
  // Teeth: the store surface exposes NO enforce/throttle/kill method — C7 cannot enforce even if asked.
  const surface = store as unknown as Record<string, unknown>;
  for (const forbidden of ['throttle', 'kill', 'enforce', 'pauseAdmission', 'hardKill']) {
    assert.equal(typeof surface[forbidden], 'undefined', `C7 must expose no '${forbidden}' method (enforcement is C6/C5 — OD-068)`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
// AC-7.COST.004.1 — exceeding the daily OR weekly threshold raises a dashboard notification
// ─────────────────────────────────────────────────────────────────────────────────
test('AC-7.COST.004.1 — a daily OR weekly over-threshold raises a cost_threshold_breach notification', async () => {
  // DAILY breach path.
  const dstore = new InMemoryCostMeterStore(PRICE_TABLE, LADDER_DEFAULTS);
  dstore.addEvent(ev({ id: 'd', cost_tokens: 4_000_000, model: 'sonnet', created_at: iso(T0 - 60) })); // $60/day > $50
  const dres = await dstore.meterAndEvaluate(T0);
  assert.equal(dres.notificationsWritten.length, 1, 'a daily breach raises one notification');
  assert.equal(dres.notificationsWritten[0]!.type, COST_THRESHOLD_BREACH);

  // WEEKLY breach path WITHOUT a daily breach: spread $210 across 6 days so no single day tops $50 but the
  // week tops $200. Each day carries $35 (< $50 daily), total $210 (> $200 weekly).
  const wstore = new InMemoryCostMeterStore(PRICE_TABLE, LADDER_DEFAULTS);
  for (let day = 1; day <= 6; day++) {
    // $35/day = 2,333,340 tokens @ 0.015/1k → ceil to $35.01; placed >1 day ago so it's NOT in the daily window.
    wstore.addEvent(ev({ id: `w${day}`, cost_tokens: 2_333_334, model: 'sonnet', created_at: iso(T0 - day * 24 * 3600 - 60) }));
  }
  const wres = await wstore.meterAndEvaluate(T0);
  const rungs = wres.ladder.breaches.map((b) => b.rung);
  assert.ok(rungs.includes('soft_weekly'), 'the weekly soft rung must fire when the week tops $200');
  assert.ok(!rungs.includes('soft_daily'), 'no single day topped $50 → the DAILY rung must NOT fire (teeth: weekly is independent)');
  assert.ok(wres.notificationsWritten.some((n) => /weekly/i.test(n.title)), 'a weekly breach raises a weekly notification');
});

// ─────────────────────────────────────────────────────────────────────────────────
// AC-NFR-COST.005.1 — estimate = cost_tokens × price_table over ALL vendors, ROUNDED UP, never the invoice
// ─────────────────────────────────────────────────────────────────────────────────
test('AC-NFR-COST.005.1 — all-vendor round-up: Sonnet + Haiku + OpenAI embeddings, ceil never floor', async () => {
  const store = new InMemoryCostMeterStore(PRICE_TABLE, LADDER_DEFAULTS);
  const rows = [
    ev({ id: 's', cost_tokens: 1_000_000, model: 'sonnet' }), // $15.00 (higher rate 0.015)
    ev({ id: 'h', cost_tokens: 1_000_000, model: 'haiku' }), //  $4.00 (higher rate 0.004)
    ev({ id: 'o', cost_tokens: 1_000_000, model: 'text-embedding-3-small' }), // $0.02
  ];
  const res = await store.estimateSpend(rows);
  assert.equal(res.cents, 1500 + 400 + 2, 'all three vendors counted: $15 + $4 + $0.02 = $19.02');
  // Teeth 1 — ROUND UP, not down: 1 haiku token @ 0.004/1k = $0.000004 → must ceil to 1¢, never floor to 0.
  const oneToken = estimateEventCents(ev({ id: 't', cost_tokens: 1, model: 'haiku' }), PRICE_TABLE);
  assert.equal(oneToken, 1, 'a sub-cent cost must round UP to 1¢ (fail-safe), never floor to 0');
  // Teeth 2 — the HIGHER of input/output is used (never the optimistic cheaper input rate).
  const sonnetCents = estimateEventCents(ev({ id: 'u', cost_tokens: 1_000_000, model: 'sonnet' }), PRICE_TABLE);
  assert.equal(sonnetCents, 1500, 'sonnet priced at the higher 0.015 output rate ($15), not the 0.003 input rate ($3)');
  assert.notEqual(sonnetCents, 300, 'must NOT optimistically use the cheaper input rate');
});

// ─────────────────────────────────────────────────────────────────────────────────
// AC-NFR-COST.001.2 — no rung is skipped or silent (a jump past a rung still reports it, with an action)
// ─────────────────────────────────────────────────────────────────────────────────
test('AC-NFR-COST.001.2 — a spend spike past several rungs reports EVERY crossed rung, none silent', async () => {
  const store = new InMemoryCostMeterStore(PRICE_TABLE, LADDER_DEFAULTS);
  // Single event that jumps STRAIGHT to $150/day — past soft($50), throttle($75) AND kill($100) at once.
  store.addEvent(ev({ id: 'spike', cost_tokens: 10_000_000, model: 'sonnet', created_at: iso(T0 - 60) })); // $150
  const res = await store.meterAndEvaluate(T0);
  const rungs = res.ladder.breaches.map((b) => b.rung);
  // A higher rung must NOT mask the lower ones — all three daily rungs are reported.
  assert.ok(rungs.includes('soft_daily'), 'soft_daily must not be skipped by the jump');
  assert.ok(rungs.includes('throttle'), 'throttle must not be skipped by the jump');
  assert.ok(rungs.includes('hard_kill'), 'hard_kill must fire');
  // No rung is silent: every breach carries an explicit action.
  for (const b of res.ladder.breaches) {
    assert.ok(b.action === 'alert' || b.action === 'signal', `rung ${b.rung} must carry an explicit action, never be silent`);
  }
  // A mis-ordered ladder is REJECTED loudly (an unreachable rung would be a silent skip).
  assert.throws(
    () => assertLadderOrdered({ cost_ladder_soft_threshold_daily_usd: 50, cost_ladder_soft_threshold_weekly_usd: 200, cost_ladder_throttle_threshold: 100, cost_ladder_hard_kill_threshold: 75 }),
    /ascending/,
    'a throttle-above-kill ladder must be rejected (an unreachable rung = a silent skip, #3)',
  );
});

// ─────────────────────────────────────────────────────────────────────────────────
// AC-NFR-COST.004.2 — a lit rung renders state; it never claims the SURFACE enforced the throttle/kill
// ─────────────────────────────────────────────────────────────────────────────────
test('AC-NFR-COST.004.2 — the ladder outcome carries state to render, and never claims C7 enforced', async () => {
  const store = new InMemoryCostMeterStore(PRICE_TABLE, LADDER_DEFAULTS);
  store.addEvent(ev({ id: 'k', cost_tokens: 8_000_000, model: 'sonnet', created_at: iso(T0 - 60) })); // $120 → kill
  const res = await store.meterAndEvaluate(T0);
  // The surface has the data to LIGHT the rung (rung + estimated + threshold), i.e. renderable state.
  const kill = res.ladder.breaches.find((b) => b.rung === 'hard_kill')!;
  assert.ok(kill.estimated_usd > kill.threshold_usd, 'the lit rung exposes estimated vs threshold to render');
  // Teeth: every emitted signal disclaims C7 enforcement — the surface can NEVER read "C7 enforced".
  assert.ok(res.ladder.signals.length > 0);
  for (const s of res.ladder.signals) {
    assert.equal(s.enforced_by_c7, false, 'a lit rung must never claim the C7 surface enforced it (C6 decides, C5 executes)');
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
// Cross-cutting teeth — the cost_unknown sentinel is NEVER a silent 0 in the meter path
// (AC-7.LOG.004.1 rests under FR-7.COST.001; the meter must surface a blind reading, not swallow it)
// ─────────────────────────────────────────────────────────────────────────────────
test('sentinel — a cost_unknown event is surfaced as unknown, never a silent $0 (blind-meter detectable)', async () => {
  const store = new InMemoryCostMeterStore(PRICE_TABLE, LADDER_DEFAULTS);
  const rows = [
    ev({ id: 'ok', cost_tokens: 1_000_000, model: 'sonnet' }), // $15 known
    ev({ id: 'blind', cost_tokens: null, cost_unknown: true, model: 'sonnet' }), // the DDL sentinel
    ev({ id: 'nomodel', cost_tokens: 1_000_000, model: null }), // positive cost, no model → un-priceable
  ];
  const res = estimate(rows, PRICE_TABLE);
  assert.equal(res.cents, 1500, 'only the KNOWN cost is summed ($15) — the sentinel adds no phantom cost');
  assert.equal(res.unknownCount, 2, 'BOTH the sentinel AND the un-priceable event surface as unknown (never a silent 0)');
  // Teeth: a genuine, KNOWN zero (cost_tokens=0) is distinct from the unknown sentinel.
  const knownZero = estimate([ev({ id: 'free', cost_tokens: 0, cost_unknown: false })], PRICE_TABLE);
  assert.equal(knownZero.unknownCount, 0, 'a genuine free event is a KNOWN zero, not unknown');
});
