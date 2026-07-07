// ISSUE-034 (C3 RL) — offline tests against InMemoryRateLimiter (the reference model). Every AC in the
// issue's §4 Definition of Done is proven here. The fake mirrors the baseline DDL's shapes/constraints so a
// green offline test is the contract the live pg adapter must uphold (no fake-vs-live drift).
//
// AC coverage map (issue §4):
//   AC-3.RL.001.1 — burst+daily → both windows have tracker rows                → "two windows"
//   AC-3.RL.002.1 — tracker checked before + incremented after                 → "source of truth"
//   AC-3.RL.002.2 — vendor header < tracker → conservative wins + logged        → "conservative reconciliation"
//   AC-3.RL.003.1 — 80% background deferred while urgent proceeds               → "80% tier"
//   AC-3.RL.004.1 — 95% non-critical queued + pause surfaced                    → "95% queues"
//   AC-3.RL.004.2 — window reset drains (none dropped), survives restart,       → "persisted queue drains"
//                   write re-consults idempotency guard                            + "restart" + "idempotent drain"
//   AC-3.RL.005.1 — Slack 429 Retry-After: N → wait exactly N seconds           → "Retry-After exact"
//   AC-3.RL.005.2 — GHL 429 no Retry-After → exponential backoff+jitter ≤ max   → "exponential backoff"
//   AC-3.RL.006.1 — high-risk rate-limited → halt+escalate, not auto-retried    → "high-risk halts"
//   AC-3.RL.006.2 — risk=high OR irreversible → excluded from auto-retry,       → "irreversible excluded"
//                   regardless of urgency                                          + "urgency never overrides"
//   AC-3.RL.007.1 — two deployments → physically separate, no shared row        → "physical isolation"
//   AC-3.RL.008.1 — config limit change governs next call, no redeploy          → "config no redeploy"

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  InMemoryRateLimiter,
  newRateLimiterState,
  isHighRisk,
  ERR_LIMIT_ABOVE_CAP,
  ERR_NO_TRACKER,
  type CallContext,
  type DossierCap,
  type EventSink,
  type IdempotencyGuard,
  type IntentOutcome,
  type RateLimitEvent,
} from './index.ts';

// ── test doubles ──────────────────────────────────────────────────────────────────────────────────────
class RecordingSink implements EventSink {
  readonly events: RateLimitEvent[] = [];
  async append(ev: RateLimitEvent): Promise<void> {
    this.events.push(ev);
  }
  ofType(t: string): RateLimitEvent[] {
    return this.events.filter((e) => e.event_type === t);
  }
}

/** A stub idempotency guard whose verdicts are controlled per key. Mirrors ISSUE-032's ledger:
 *  first commit of a key → 'fresh'; a key pre-seeded as already-done → 'suppressed'. */
class StubGuard implements IdempotencyGuard {
  private seen = new Map<string, unknown>();
  /** pre-mark a key as already written (crash-after-write) so drain must SUPPRESS it. */
  markDone(key: string, result: unknown): void {
    this.seen.set(key, result);
  }
  async commitIntent(idempotencyKey: string, _connector: string, _now: number): Promise<IntentOutcome> {
    if (this.seen.has(idempotencyKey)) return { kind: 'suppressed', result: this.seen.get(idempotencyKey) ?? null };
    this.seen.set(idempotencyKey, null); // record the intent (fresh)
    return { kind: 'fresh' };
  }
  wasSeen(key: string): boolean {
    return this.seen.has(key);
  }
}

const T0 = 1_700_000_000; // fixed logical epoch seconds

function mk(caps: readonly DossierCap[] = [], state = newRateLimiterState(), sink = new RecordingSink(), guard = new StubGuard()) {
  const rl = new InMemoryRateLimiter(state, sink, guard, undefined, caps);
  return { rl, state, sink, guard };
}

function ctx(over: Partial<CallContext> = {}): CallContext {
  return {
    connector: 'ghl',
    windowLabel: 'ghl_burst_10s',
    riskLevel: 'low',
    irreversible: false,
    urgency: 'background',
    ...over,
  };
}

// ── AC-3.RL.001.1 — a connector with burst + daily limits gets a tracker row PER window ─────────────────
test('AC-3.RL.001.1 two windows: burst + daily each get their own tracker row', async () => {
  const { rl } = mk();
  const burst = await rl.ensureWindow('ghl', 'ghl_burst_10s', 100, 10, T0); // GHL 100/10s (dossier §3)
  const daily = await rl.ensureWindow('ghl', 'ghl_daily', 200_000, 86_400, T0); // GHL 200k/day (dossier §3)
  assert.equal(burst.window_label, 'ghl_burst_10s');
  assert.equal(daily.window_label, 'ghl_daily');
  assert.notEqual(burst.id, daily.id);
  assert.equal(burst.call_limit, 100);
  assert.equal(daily.call_limit, 200_000);
  // both windows independently tracked
  assert.ok(await rl.getTracker('ghl', 'ghl_burst_10s'));
  assert.ok(await rl.getTracker('ghl', 'ghl_daily'));
});

// ── AC-3.RL.002.1 — the tracker is the source of truth: checked before, incremented after ───────────────
test('AC-3.RL.002.1 source of truth: check before + increment after each call', async () => {
  const { rl } = mk();
  await rl.ensureWindow('ghl', 'ghl_burst_10s', 100, 10, T0);
  assert.equal((await rl.getTracker('ghl', 'ghl_burst_10s'))!.calls_made, 0);
  const d1 = await rl.decide(ctx({ urgency: 'urgent' }), T0);
  assert.equal(d1.tier, 'proceed');
  assert.equal((await rl.getTracker('ghl', 'ghl_burst_10s'))!.calls_made, 1);
  await rl.decide(ctx({ urgency: 'urgent' }), T0);
  assert.equal((await rl.getTracker('ghl', 'ghl_burst_10s'))!.calls_made, 2);
});

test('AC-3.RL.002.1 edge: a call against a connector with no tracker is a defect (throws)', async () => {
  const { rl } = mk();
  await assert.rejects(() => rl.decide(ctx(), T0), new RegExp(ERR_NO_TRACKER('ghl', 'ghl_burst_10s').slice(0, 40)));
});

// ── AC-3.RL.002.2 — vendor header reports LESS headroom → conservative value wins + divergence logged ────
test('AC-3.RL.002.2 conservative reconciliation: vendor header with less headroom wins and is logged', async () => {
  const { rl, sink } = mk();
  await rl.ensureWindow('ghl', 'ghl_burst_10s', 100, 10, T0);
  // tracker thinks 10 made → 90 remaining; vendor says only 5 remaining (95 consumed elsewhere/racing).
  for (let i = 0; i < 10; i++) await rl.decide(ctx({ urgency: 'urgent' }), T0);
  assert.equal((await rl.getTracker('ghl', 'ghl_burst_10s'))!.calls_made, 10);
  const row = await rl.reconcileHeader('ghl', 'ghl_burst_10s', 5, T0);
  assert.equal(row.calls_made, 95, 'calls_made bumped so remaining == vendor 5 (conservative)');
  const div = sink.events.find((e) => e.payload.reason === 'header_divergence');
  assert.ok(div, 'divergence is logged (never silently over-call)');
  assert.equal(div!.payload.vendor_remaining, 5);
});

test('AC-3.RL.002.2 vendor header with MORE headroom does not over-trust (tracker keeps its conservative view)', async () => {
  const { rl } = mk();
  await rl.ensureWindow('ghl', 'ghl_burst_10s', 100, 10, T0);
  for (let i = 0; i < 10; i++) await rl.decide(ctx({ urgency: 'urgent' }), T0);
  const row = await rl.reconcileHeader('ghl', 'ghl_burst_10s', 99, T0); // vendor says 99 remaining
  assert.equal(row.calls_made, 10, 'tracker keeps its own (conservative) 10 — does not jump to 1');
});

// ── AC-3.RL.003.1 — at 80%: background deferred, urgent proceeds ─────────────────────────────────────────
test('AC-3.RL.003.1 80% tier: background call throttled/deferred while urgent proceeds', async () => {
  const { rl, sink } = mk();
  await rl.ensureWindow('ghl', 'ghl_burst_10s', 10, 10, T0); // limit 10; 80% = 8
  for (let i = 0; i < 7; i++) await rl.decide(ctx({ urgency: 'urgent' }), T0); // 7 made → next lands at 80%
  // 8th call would be usage 0.8 → threshold. Background → deferred, not run.
  const bg = await rl.decide(ctx({ urgency: 'background' }), T0);
  assert.equal(bg.tier, 'throttled');
  assert.equal((bg as { deferred: boolean }).deferred, true);
  assert.equal((await rl.getTracker('ghl', 'ghl_burst_10s'))!.calls_made, 7, 'deferred background did NOT consume headroom');
  // an urgent call at the same threshold proceeds (and counts).
  const urgent = await rl.decide(ctx({ urgency: 'urgent' }), T0);
  assert.equal(urgent.tier, 'throttled');
  assert.equal((urgent as { deferred: boolean }).deferred, false, 'urgent proceeds even at 80%');
  assert.equal((await rl.getTracker('ghl', 'ghl_burst_10s'))!.calls_made, 8);
  assert.ok(sink.ofType('rate_limit_throttled').length >= 1, 'throttle-engaged emitted (#3)');
});

// ── AC-3.RL.004.1 — at 95%: non-critical queued for post-reset, pause surfaced ──────────────────────────
test('AC-3.RL.004.1 95% queues: non-critical call queued for post-reset, pause emitted', async () => {
  const { rl, sink } = mk();
  await rl.ensureWindow('ghl', 'ghl_burst_10s', 100, 10, T0); // 95% = 95
  for (let i = 0; i < 94; i++) await rl.decide(ctx({ urgency: 'urgent' }), T0); // next call lands at 95%
  const d = await rl.decide(ctx({ urgency: 'background' }), T0);
  assert.equal(d.tier, 'queued');
  const runAfter = (d as { runAfter: string }).runAfter;
  assert.equal(runAfter, (await rl.getTracker('ghl', 'ghl_burst_10s'))!.reset_at, 'queued to run after window reset');
  const pending = await rl.pendingDeferred('ghl');
  assert.equal(pending.length, 1);
  const paused = sink.ofType('rate_limit_paused');
  assert.equal(paused.length, 1);
  assert.equal(paused[0]!.payload.queued_count, 1, 'pause + queued-count surfaced (#3)');
});

// ── AC-3.RL.004.2 — window reset → queue drains, none dropped, survives restart, write re-consults guard ──
test('AC-3.RL.004.2 persisted queue drains after reset: none dropped, read fires', async () => {
  const { rl } = mk();
  await rl.ensureWindow('ghl', 'ghl_daily', 100, 3600, T0); // 1h window; reset_at = T0+3600
  for (let i = 0; i < 94; i++) await rl.decide(ctx({ windowLabel: 'ghl_daily', urgency: 'urgent' }), T0);
  await rl.decide(ctx({ windowLabel: 'ghl_daily', urgency: 'background' }), T0); // queued (a read — no key)
  assert.equal((await rl.pendingDeferred()).length, 1);
  // before reset: nothing due
  assert.equal((await rl.drainDue(T0 + 10)).length, 0, 'nothing drains before reset');
  // after reset: the queued call drains and fires (none dropped)
  const drained = await rl.drainDue(T0 + 3601);
  assert.equal(drained.length, 1);
  assert.equal(drained[0]!.kind, 'fired');
  assert.equal((await rl.pendingDeferred()).length, 0, 'queue is empty after drain');
});

test('AC-3.RL.004.2 restart: the persisted queue survives a runtime restart (new limiter, same state)', async () => {
  const state = newRateLimiterState();
  const guard = new StubGuard();
  // instance A enqueues.
  const a = mk([], state, new RecordingSink(), guard);
  await a.rl.ensureWindow('ghl', 'ghl_daily', 100, 3600, T0);
  for (let i = 0; i < 94; i++) await a.rl.decide(ctx({ windowLabel: 'ghl_daily', urgency: 'urgent' }), T0);
  await a.rl.decide(ctx({ windowLabel: 'ghl_daily', urgency: 'background' }), T0);
  assert.equal((await a.rl.pendingDeferred()).length, 1);
  // "restart": a BRAND NEW limiter instance over the SAME durable state (models a persisted table).
  const b = new InMemoryRateLimiter(state, new RecordingSink(), guard);
  assert.equal((await b.pendingDeferred()).length, 1, 'the deferred call survived the restart (persisted, not best-effort)');
  const drained = await b.drainDue(T0 + 3601);
  assert.equal(drained.length, 1, 'the survivor drains post-restart — no silent drop (#3)');
  assert.equal(drained[0]!.kind, 'fired');
});

test('AC-3.RL.004.2 idempotent drain: a deferred (low-risk, keyed) WRITE already applied is SUPPRESSED — never double-fires', async () => {
  // A non-irreversible/retryable write (e.g. a GHL contact UPSERT — idempotent, NOT halt-routed) that hits
  // the 95% ceiling is queued WITH its idempotency key. On drain it re-consults the guard so a write that
  // already landed (crash-after-write) is not applied twice (FR-3.RL.004.2 → FR-3.CONN.004 / #1).
  const state = newRateLimiterState();
  const guard = new StubGuard();
  const { rl } = mk([], state, new RecordingSink(), guard);
  await rl.ensureWindow('ghl', 'ghl_daily', 100, 3600, T0);
  for (let i = 0; i < 94; i++) await rl.decide(ctx({ windowLabel: 'ghl_daily', urgency: 'urgent' }), T0);
  const key = 'ghl-upsert-contact-abc';
  const d = await rl.decide(
    ctx({ windowLabel: 'ghl_daily', urgency: 'background', riskLevel: 'low', irreversible: false, idempotencyKey: key }),
    T0,
  );
  assert.equal(d.tier, 'queued');
  // crash-after-write: the upsert actually landed before the pause bookkeeping; the ledger already has the key.
  guard.markDone(key, { contactId: 'c-1' });
  const drained = await rl.drainDue(T0 + 3601);
  assert.equal(drained.length, 1);
  assert.equal(drained[0]!.kind, 'suppressed', 'guard said already-done → NOT re-fired (no double-write, #1)');
  assert.deepEqual((drained[0] as { priorResult: unknown }).priorResult, { contactId: 'c-1' });
});

test('AC-3.RL.004.2 a queued (low-risk, keyed) write that has NOT yet fired drains and fires exactly once', async () => {
  const state = newRateLimiterState();
  const guard = new StubGuard();
  const { rl } = mk([], state, new RecordingSink(), guard);
  await rl.ensureWindow('ghl', 'ghl_daily', 100, 3600, T0);
  for (let i = 0; i < 94; i++) await rl.decide(ctx({ windowLabel: 'ghl_daily', urgency: 'urgent' }), T0);
  const key = 'ghl-upsert-contact-xyz';
  await rl.decide(
    ctx({ windowLabel: 'ghl_daily', urgency: 'background', riskLevel: 'low', irreversible: false, idempotencyKey: key }),
    T0,
  );
  const drained = await rl.drainDue(T0 + 3601);
  assert.equal(drained.length, 1);
  assert.equal(drained[0]!.kind, 'fired', 'fresh key → fires');
  assert.ok(guard.wasSeen(key), 'the guard recorded the intent before firing (dedups a future retry)');
});

test('FR-3.RL.006 precedence over FR-3.RL.004: an irreversible/billed write at the 95% ceiling HALTS, never queues', async () => {
  // The queue (FR-3.RL.004) is for NON-CRITICAL calls. An irreversible/billed write that hits the ceiling
  // escalates rather than silently queueing (FR-3.RL.004 Branches → FR-3.RL.006). It must NOT land on the queue.
  const { rl } = mk();
  await rl.ensureWindow('ghl', 'ghl_daily', 100, 3600, T0);
  for (let i = 0; i < 94; i++) await rl.decide(ctx({ windowLabel: 'ghl_daily', urgency: 'urgent' }), T0);
  const d = await rl.decide(
    ctx({ windowLabel: 'ghl_daily', urgency: 'background', irreversible: true, idempotencyKey: 'ghl-send-msg-1' }),
    T0,
  );
  assert.equal(d.tier, 'halt-escalate', 'an irreversible write at the ceiling halts, not queues');
  assert.equal((await rl.pendingDeferred()).length, 0, 'nothing was silently queued');
});

// ── AC-3.RL.005.1 — Slack 429 Retry-After: N → wait exactly N seconds ───────────────────────────────────
test('AC-3.RL.005.1 Retry-After exact: Slack 429 with Retry-After N waits exactly N seconds', async () => {
  const { rl, sink } = mk();
  await rl.ensureWindow('slack', 'slack_conversations_history', 50, 60, T0);
  const d = await rl.decide(
    ctx({ connector: 'slack', windowLabel: 'slack_conversations_history', urgency: 'background', riskLevel: 'low' }),
    T0,
    { is429: true, retryAfterSeconds: 30 },
  );
  assert.equal(d.tier, 'backoff');
  assert.equal((d as { delayMs: number }).delayMs, 30_000, 'exactly 30s — Retry-After honoured exactly');
  assert.equal((d as { source: string }).source, 'retry-after');
  assert.equal(sink.ofType('rate_limit_backoff').length, 1);
});

// ── AC-3.RL.005.2 — GHL 429 with no Retry-After → exponential backoff + jitter capped at max ─────────────
test('AC-3.RL.005.2 exponential backoff: GHL 429 no Retry-After grows exponentially, jitter, capped at max', async () => {
  const { rl } = mk();
  await rl.ensureWindow('ghl', 'ghl_burst_10s', 100, 10, T0);
  const gctx = ctx({ urgency: 'background', riskLevel: 'low' });
  // attempt 0: 1000ms base; jitter 0 → exactly initial
  const a0 = await rl.decide(gctx, T0, { is429: true, backoffAttempt: 0, jitter: 0 });
  assert.equal((a0 as { delayMs: number }).delayMs, 1000);
  assert.equal((a0 as { source: string }).source, 'exponential');
  // attempt 2: 1000 * 2^2 = 4000; jitter 0.5 → 6000
  const a2 = await rl.decide(gctx, T0, { is429: true, backoffAttempt: 2, jitter: 0.5 });
  assert.equal((a2 as { delayMs: number }).delayMs, 6000);
  // a huge attempt must CAP at backoffMaxMs (60000) — never unbounded (FR-3.RL.005 edge)
  const aBig = await rl.decide(gctx, T0, { is429: true, backoffAttempt: 20, jitter: 0.9 });
  assert.equal((aBig as { delayMs: number }).delayMs, 60_000, 'capped at CFG-backoff_max_ms — no unbounded retry');
});

// ── AC-3.RL.006.1 — high-risk rate-limited → halt + escalate, NOT auto-retried ──────────────────────────
test('AC-3.RL.006.1 high-risk halts: a rate-limited high-risk action halts + escalates, not auto-retried', async () => {
  const { rl, sink } = mk();
  await rl.ensureWindow('ghl', 'ghl_burst_10s', 100, 10, T0);
  for (let i = 0; i < 94; i++) await rl.decide(ctx({ urgency: 'urgent' }), T0); // push to ceiling
  const d = await rl.decide(ctx({ riskLevel: 'high', urgency: 'urgent' }), T0);
  assert.equal(d.tier, 'halt-escalate');
  assert.equal((d as { escalationEmitted: boolean }).escalationEmitted, true);
  assert.equal(sink.ofType('rate_limit_halt_escalated').length, 1, 'escalation raised (loud, #3)');
  assert.equal(sink.ofType('rate_limit_backoff').length, 0, 'never entered the auto-retry/backoff path');
});

test('AC-3.RL.006.1 a high-risk 429 halts (never backs off/auto-retries)', async () => {
  const { rl, sink } = mk();
  await rl.ensureWindow('ghl', 'ghl_burst_10s', 100, 10, T0); // plenty of headroom — the 429 itself routes it
  const d = await rl.decide(ctx({ riskLevel: 'high', urgency: 'background' }), T0, { is429: true, retryAfterSeconds: 5 });
  assert.equal(d.tier, 'halt-escalate', 'even with a Retry-After present, a high-risk 429 halts');
  assert.equal(sink.ofType('rate_limit_backoff').length, 0);
});

// ── AC-3.RL.006.2 — risk=high OR irreversible/billed → excluded from auto-retry, regardless of urgency ──
test('AC-3.RL.006.2 irreversible excluded: an irreversible/billed write (not tagged high) still halts on 429', async () => {
  const { rl, sink } = mk();
  await rl.ensureWindow('ghl', 'ghl_burst_10s', 100, 10, T0);
  // risk_level is 'low' but the call is irreversible (a GHL message send) → still halt-escalate (AC-3.RL.006.2).
  const d = await rl.decide(ctx({ riskLevel: 'low', irreversible: true, urgency: 'background' }), T0, { is429: true });
  assert.equal(d.tier, 'halt-escalate');
  assert.equal(sink.ofType('rate_limit_backoff').length, 0, 'excluded from the FR-3.RL.005 auto-retry path');
});

test('AC-3.RL.006.2 urgency never overrides: an URGENT high-risk write at the ceiling still halts', async () => {
  const { rl } = mk();
  await rl.ensureWindow('ghl', 'ghl_burst_10s', 100, 10, T0);
  for (let i = 0; i < 94; i++) await rl.decide(ctx({ urgency: 'urgent' }), T0);
  // urgent + high-risk at the ceiling: urgency does NOT buy it a proceed — it halts.
  const d = await rl.decide(ctx({ riskLevel: 'high', urgency: 'urgent' }), T0);
  assert.equal(d.tier, 'halt-escalate', 'urgency never overrides the high-risk halt');
});

test('AC-3.RL.006.2 classifier: isHighRisk is true for risk=high OR irreversible, else false', () => {
  assert.equal(isHighRisk({ riskLevel: 'high', irreversible: false }), true);
  assert.equal(isHighRisk({ riskLevel: 'low', irreversible: true }), true);
  assert.equal(isHighRisk({ riskLevel: 'low', irreversible: false }), false);
  assert.equal(isHighRisk({ riskLevel: null, irreversible: false }), false);
});

// ── AC-3.RL.007.1 — two deployments → physically separate trackers, no shared row ───────────────────────
test('AC-3.RL.007.1 physical isolation: two deployments have separate state with no shared row', async () => {
  // Each deployment is its own silo → its own RateLimiterState. There is NO shared/global ledger and NO
  // client_slug column on the tracker (FR-3.RL.007 / ADR-001). Two states never see each other's rows.
  const depA = mk([], newRateLimiterState());
  const depB = mk([], newRateLimiterState());
  await depA.rl.ensureWindow('ghl', 'ghl_burst_10s', 100, 10, T0);
  for (let i = 0; i < 50; i++) await depA.rl.decide(ctx({ urgency: 'urgent' }), T0);
  await depB.rl.ensureWindow('ghl', 'ghl_burst_10s', 100, 10, T0);
  // deployment B's tracker is untouched by A's 50 calls — no cross-client quota bleed.
  assert.equal((await depB.rl.getTracker('ghl', 'ghl_burst_10s'))!.calls_made, 0);
  assert.equal((await depA.rl.getTracker('ghl', 'ghl_burst_10s'))!.calls_made, 50);
  // structural: no client-identity field anywhere on the tracker row.
  const rowKeys = Object.keys((await depA.rl.getTracker('ghl', 'ghl_burst_10s'))!);
  assert.ok(!rowKeys.some((k) => /client|slug|tenant/i.test(k)), 'no client_slug / tenant column on the tracker (ADR-001)');
});

// ── AC-3.RL.008.1 — config limit change governs the next call, no redeploy ──────────────────────────────
test('AC-3.RL.008.1 config no redeploy: changing a connector limit governs the next call', async () => {
  const { rl } = mk();
  await rl.ensureWindow('ghl', 'ghl_burst_10s', 10, 10, T0);
  for (let i = 0; i < 10; i++) await rl.decide(ctx({ urgency: 'urgent' }), T0);
  // at limit 10 with 10 made, the next background call is at the ceiling → queued.
  const before = await rl.decide(ctx({ urgency: 'background' }), T0);
  assert.equal(before.tier, 'queued');
  // raise the limit live (no redeploy). The SAME (connector, window) row is updated in place.
  const updated = await rl.ensureWindow('ghl', 'ghl_burst_10s', 1000, 10, T0);
  assert.equal(updated.call_limit, 1000);
  assert.equal(updated.calls_made, 10, 'existing usage is preserved across the limit change');
  // now there is ample headroom → the next call proceeds (the new limit governs immediately).
  const after = await rl.decide(ctx({ urgency: 'urgent' }), T0);
  assert.equal(after.tier, 'proceed');
});

test('AC-3.RL.008.1 validation: a configured limit above the dossier-pinned cap is rejected (warns)', async () => {
  const caps: DossierCap[] = [{ connector: 'ghl', windowLabel: 'ghl_burst_10s', cap: 100 }]; // GHL real cap
  const { rl } = mk(caps);
  await assert.rejects(
    () => rl.ensureWindow('ghl', 'ghl_burst_10s', 500, 10, T0),
    new RegExp(ERR_LIMIT_ABOVE_CAP('ghl', 'ghl_burst_10s', 500, 100).slice(0, 40)),
  );
  // at/below the cap is fine.
  const ok = await rl.ensureWindow('ghl', 'ghl_burst_10s', 100, 10, T0);
  assert.equal(ok.call_limit, 100);
});

// ── extra: window roll resets calls_made after reset_at (FR-3.RL.001 window semantics) ──────────────────
test('window roll: after reset_at the window resets calls_made to 0', async () => {
  const { rl } = mk();
  await rl.ensureWindow('ghl', 'ghl_burst_10s', 100, 10, T0); // reset_at = T0+10
  for (let i = 0; i < 50; i++) await rl.decide(ctx({ urgency: 'urgent' }), T0);
  assert.equal((await rl.getTracker('ghl', 'ghl_burst_10s'))!.calls_made, 50);
  // a call after the window resets → calls_made rolls to 0 then counts this one.
  const d = await rl.decide(ctx({ urgency: 'urgent' }), T0 + 11);
  assert.equal(d.tier, 'proceed');
  assert.equal((await rl.getTracker('ghl', 'ghl_burst_10s'))!.calls_made, 1, 'window rolled: fresh count');
});

// ── logic-sweep regression: a vendorRemaining header from the PRIOR window must NOT corrupt a freshly-rolled
// window (store.ts:372 — fake-vs-adapter ordering drift). A stale pre-reset header applied to a post-roll
// window fabricates usage that never happened; the fresh window must stay empty (parity with the live pg
// adapter, whose in-txn roll wipes any prior-window reconciliation). ──────────────────────────────────────
test('vendorRemaining from the prior window is ignored across a roll boundary (fresh window stays empty)', async () => {
  const { rl } = mk();
  await rl.ensureWindow('ghl', 'ghl_burst_10s', 100, 10, T0); // reset_at = T0+10
  for (let i = 0; i < 50; i++) await rl.decide(ctx({ urgency: 'urgent' }), T0); // 50 made in the OLD window
  assert.equal((await rl.getTracker('ghl', 'ghl_burst_10s'))!.calls_made, 50);
  // A call AFTER reset with a stale prior-window header (vendor said 30 remaining in the OLD window). The
  // window rolls to 0; the stale header must NOT be re-applied to the fresh count. Only THIS call counts.
  const d = await rl.decide(ctx({ urgency: 'urgent' }), T0 + 11, { vendorRemaining: 30 });
  assert.equal(d.tier, 'proceed', 'fresh empty window → proceed (not throttled by a fabricated 70)');
  assert.equal(
    (await rl.getTracker('ghl', 'ghl_burst_10s'))!.calls_made,
    1,
    'fresh window: only this call counted — the stale prior-window header did not fabricate usage',
  );
});
