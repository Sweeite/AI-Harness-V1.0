// ISSUE-034 (C3 RL) — the RateLimiter PORT + in-memory fake reference model (the house port+fake pattern,
// cf. app/task-queue/src/store.ts, app/connector-runtime/src/store.ts). Every live side effect of the
// rate-limit subsystem goes through this port so the tier logic is unit-testable with NO live DB. The
// InMemoryRateLimiter fake is BOTH the test double AND the reference model the live pg adapter
// (supabase-store.ts) must match against the baseline DDL (app/silo/migrations/0001_baseline.sql:
// rate_limit_tracker + idempotency_ledger).
//
// Faithful to the baseline DDL. Invariants the fake enforces EXACTLY as the DB would, mapped to the three
// non-negotiables:
//   FR-3.RL.001 (schema)  one tracker row PER connector PER window (unique(connector, window_label)); a
//                         connector with a burst window + a daily window gets a row per window.
//   FR-3.RL.002 (#3)      before-call check + after-call increment is the SOURCE OF TRUTH; when a vendor
//                         header reports LESS headroom than the tracker, the CONSERVATIVE value wins and the
//                         divergence is LOGGED — never silently over-call.
//   FR-3.RL.003           at 80% (CFG-rate_alert_threshold): a background/non-urgent call is slowed/deferred
//                         while urgent/human/approval-gated proceeds. Urgency is an EXPLICIT call attribute,
//                         never inferred.
//   FR-3.RL.004 (#1/#3)   at 95%: a non-critical call is PAUSED + enqueued for post-reset on a PERSISTED
//                         queue that survives a runtime restart (no silent drop); on drain a queued WRITE
//                         re-consults the idempotency guard before firing (a deferred irreversible send can
//                         never double-fire).
//   FR-3.RL.005           at 429: exponential backoff with jitter capped at CFG-backoff_max_ms; a vendor
//                         Retry-After is honoured EXACTLY when present.
//   FR-3.RL.006 (#2)      a risk_level=high action OR any irreversible/billed external write HALTS and
//                         escalates — EXCLUDED from the 429 auto-retry path, regardless of any urgency flag.
//   FR-3.RL.007 (#2)      the tracker lives ONLY in the client silo — no client_slug / cross-client
//                         predicate, no shared/global ledger (mirrors FR-3.REG.004).
//   FR-3.RL.008           per-connector limit / threshold / backoff are LIVE config (no redeploy); a
//                         configured limit above the dossier-pinned cap warns.

// ── The tracker row (baseline DDL: rate_limit_tracker). NO client_slug (FR-3.RL.007 / ADR-001). ──────────
export interface RateLimitTrackerRow {
  id: string;
  connector: string;
  window_label: string; // e.g. ghl_burst_10s, ghl_daily, slack_conversations_history
  window_start: string; // iso
  window_duration_seconds: number; // the baseline column is an `interval`; the fake carries seconds
  call_limit: number;
  calls_made: number;
  reset_at: string; // iso
  updated_at: string;
}

// ── The call classification the tiers read. Urgency is EXPLICIT (FR-3.RL.003 edge: never inferred). ──────
/** Urgency is an explicit call attribute — a human/approval-gated/user-facing call is `urgent`; background
 *  ingest/batch is `background`. The 80% tier slows `background`, never `urgent` (FR-3.RL.003). */
export type CallUrgency = 'urgent' | 'background';

/** What the runtime knows about a call before it dispatches it. `riskLevel` + `irreversible` decide the
 *  FR-3.RL.006 high-risk halt-escalate route; `urgency` decides the FR-3.RL.003/004 tiering. */
export interface CallContext {
  connector: string;
  /** the window this call counts against (the tracker key, FR-3.RL.001). */
  windowLabel: string;
  /** the tool's risk_level (tools.risk_level, FR-3.REG.001). 'high' → halt-escalate. */
  riskLevel: string | null;
  /** an irreversible/billed external side effect (e.g. a GHL/Slack message send). Routes to halt-escalate
   *  EVEN IF riskLevel is not 'high' (AC-3.RL.006.2). */
  irreversible: boolean;
  /** explicit urgency — never inferred (FR-3.RL.003). */
  urgency: CallUrgency;
  /** stable idempotency key for a WRITE — required to re-consult the guard on queue drain (FR-3.RL.004 →
   *  FR-3.CONN.004). Reads may omit it. */
  idempotencyKey?: string;
}

// ── The tier decision the limiter returns. Every tier is a LOUD, named outcome (#3). ────────────────────
export type TierDecision =
  /** headroom < 80% — proceed immediately, tracker incremented. */
  | { tier: 'proceed'; row: RateLimitTrackerRow }
  /** 80% ≤ usage < 95% — urgent proceeds (tracker incremented); background is throttled/deferred (NOT run). */
  | { tier: 'throttled'; deferred: boolean; row: RateLimitTrackerRow }
  /** usage ≥ 95% — a non-critical call is paused + enqueued for post-reset on the persisted queue. */
  | { tier: 'queued'; queueId: string; runAfter: string; row: RateLimitTrackerRow }
  /** a 429 (or explicit over-limit) on a low-risk call — auto-retry after a backoff/Retry-After delay. */
  | { tier: 'backoff'; delayMs: number; source: 'retry-after' | 'exponential'; row: RateLimitTrackerRow }
  /** a high-risk / irreversible call was rate-limited/429 — HALT + escalate; NEVER auto-retried. */
  | { tier: 'halt-escalate'; escalationEmitted: true; row: RateLimitTrackerRow };

// ── The persisted 95% deferral queue row (FR-3.RL.004). Restart-durable: it is a table row, not memory.
// On drain, a WRITE (has idempotencyKey) re-consults the idempotency guard before firing. ───────────────
export interface DeferredCallRow {
  id: string;
  connector: string;
  window_label: string;
  run_after: string; // = the window's reset_at at enqueue time
  /** the classification carried across the pause so drain can re-route (FR-3.RL.006 still applies on drain). */
  risk_level: string | null;
  irreversible: boolean;
  urgency: CallUrgency;
  idempotency_key: string | null; // present for writes; drain re-consults the guard (FR-3.CONN.004)
  enqueued_at: string;
  drained_at: string | null; // null = still pending; set when the queue drains it
}

/** The outcome of draining ONE deferred call (FR-3.RL.004 / AC-3.RL.004.2). */
export type DrainOutcome =
  | { kind: 'fired'; row: DeferredCallRow } // a read, or a write whose idempotency guard said 'fresh'
  | { kind: 'suppressed'; row: DeferredCallRow; priorResult: unknown | null }; // guard said 'suppressed' — did NOT re-fire

// ── The idempotency guard this slice CONSUMES on write-drain (owned by ISSUE-032 / FR-3.CONN.004). We
// depend only on the outcome shape, so the fake can inject a stub without importing the whole runtime. ──
export type IntentOutcome =
  | { kind: 'fresh' }
  | { kind: 'suppressed'; result: unknown | null };
export interface IdempotencyGuard {
  /** Commit the durable pre-call intent BEFORE the external write. 'fresh' → fire; 'suppressed' → do NOT
   *  re-fire, the write already happened (FR-3.CONN.004 / AC-3.CONN.004.4). */
  commitIntent(idempotencyKey: string, connector: string, now: number): Promise<IntentOutcome>;
}

// ── The event_log sink (C7 / ISSUE-011). This slice only EMITS onto it (FR-3.RL.003/004/005/006
// observability). A no-op/mock in offline tests. The event_type values are NOT yet in the baseline enum —
// see results/proposed-shared-spec.md (rate_limit_* additive enum delta, applied serially by the
// orchestrator). Until then the live adapter's INSERT would reject; the fake proves the emit CONTRACT. ──
export type RateLimitEventType =
  | 'rate_limit_throttled' // 80% tier engaged (throttle-engaged)
  | 'rate_limit_paused' // 95% tier: pause + queued-count
  | 'rate_limit_backoff' // 429 + backoff delay
  | 'rate_limit_halt_escalated'; // high-risk halt + escalation raised

export interface RateLimitEvent {
  event_type: RateLimitEventType;
  connector: string;
  window_label: string;
  summary: string; // plain-English, never empty (mirrors AC-7.LOG.002.2)
  payload: Record<string, unknown>;
}
export interface EventSink {
  append(ev: RateLimitEvent): Promise<void>;
}

// ── The config knobs this slice surfaces per-connector (FR-3.RL.008). Live: a change governs the NEXT call
// (no redeploy). Seeded from the dossiers — never the design doc. ───────────────────────────────────────
export interface RateLimitConfig {
  /** CFG-rate_alert_threshold — the 80% tier boundary (fraction 0..1). */
  alertThreshold: number; // default 0.80
  /** the 95% pause tier boundary (fraction 0..1). Fixed by the design (FR-3.RL.004); not vendor-tunable. */
  pauseThreshold: number; // 0.95
  /** CFG-backoff_initial_ms — first backoff step. */
  backoffInitialMs: number; // default 1000
  /** CFG-backoff_max_ms — the hard cap; backoff NEVER exceeds this (FR-3.RL.005 edge: no unbounded retry). */
  backoffMaxMs: number; // default 60000
  /** CFG-backoff_multiplier — exponential growth factor. */
  backoffMultiplier: number; // default 2
}
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  alertThreshold: 0.8,
  pauseThreshold: 0.95,
  backoffInitialMs: 1000,
  backoffMaxMs: 60000,
  backoffMultiplier: 2,
};

/** The dossier-pinned real cap for a connector window — used by FR-3.RL.008's config-validation warn
 *  (a configured call_limit above the vendor's real cap invites 429s). Seeded from the dossiers:
 *  GHL 100/10s + 200k/day (gohighlevel.md §3); Slack per-method tiers (slack.md §3); Gmail QU model
 *  (google-gmail.md §3). */
export interface DossierCap {
  connector: string;
  windowLabel: string;
  cap: number; // the vendor's documented ceiling for this window
}

// ── Rejection / warning messages — so a test asserts the same failure the live gate produces. ──────────
export const ERR_NO_TRACKER = (connector: string, windowLabel: string) =>
  `rate_limit_tracker: no tracker row for connector '${connector}' window '${windowLabel}' — a call without a tracker is a defect (FR-3.RL.002 source-of-truth)`;
export const ERR_LIMIT_ABOVE_CAP = (connector: string, windowLabel: string, limit: number, cap: number) =>
  `rate_limit_tracker: configured limit ${limit} for '${connector}/${windowLabel}' EXCEEDS the dossier-pinned cap ${cap} — this invites 429s (FR-3.RL.008 validation)`;

// ── URGENCY / RISK helpers ──────────────────────────────────────────────────────────────────────────
/** FR-3.RL.006: a call routes to halt-and-escalate iff risk_level=high OR it is irreversible/billed. Urgency
 *  NEVER overrides this — an "urgent" high-risk write still halts (AC-3.RL.006.2). */
export function isHighRisk(ctx: Pick<CallContext, 'riskLevel' | 'irreversible'>): boolean {
  return ctx.riskLevel === 'high' || ctx.irreversible === true;
}

// ── The port. Sync-shaped in the fake, modelled async for the DB adapter. ──────────────────────────────
export interface RateLimiter {
  /** Seed/create a tracker row for a connector window (FR-3.RL.001). Idempotent on (connector, window_label);
   *  re-seeding an existing window updates its limit/duration (the FR-3.RL.008 no-redeploy config path).
   *  Warns (throws) if `call_limit` exceeds the dossier-pinned cap for the window (FR-3.RL.008 validation). */
  ensureWindow(
    connector: string,
    windowLabel: string,
    callLimit: number,
    windowDurationSeconds: number,
    now: number,
  ): Promise<RateLimitTrackerRow>;

  getTracker(connector: string, windowLabel: string): Promise<RateLimitTrackerRow | null>;

  /** The FR-3.RL.002 SOURCE-OF-TRUTH decision for ONE call. Reads the tracker, applies the graduated tiers
   *  (FR-3.RL.003/004/005) and the high-risk halt-escalate branch (FR-3.RL.006), increments the tracker on a
   *  proceed/throttled-urgent path, and EMITS the tier event (#3). Does NOT itself perform the vendor call —
   *  it returns the DECISION the runtime acts on. `vendorRemaining`, when supplied (a vendor header from the
   *  PRIOR call), reconciles the tracker conservatively (FR-3.RL.002 / AC-3.RL.002.2). `retryAfterSeconds`,
   *  when supplied, is a live 429 → the backoff honours it exactly (FR-3.RL.005 / AC-3.RL.005.1). */
  decide(ctx: CallContext, now: number, opts?: DecideOpts): Promise<TierDecision>;

  /** Record a vendor rate header AFTER a call and reconcile the tracker to the CONSERVATIVE value, logging
   *  any divergence (FR-3.RL.002 / AC-3.RL.002.2). Returns the reconciled row. */
  reconcileHeader(
    connector: string,
    windowLabel: string,
    vendorRemaining: number,
    now: number,
  ): Promise<RateLimitTrackerRow>;

  /** List still-pending deferred calls (FR-3.RL.004). Reads the PERSISTED queue — the same rows survive a
   *  restart because they live in a table, not memory. */
  pendingDeferred(connector?: string): Promise<DeferredCallRow[]>;

  /** Drain the persisted 95% queue for calls whose run_after ≤ now (window reset). Each is marked drained;
   *  a WRITE (has idempotency_key) re-consults the idempotency guard FIRST and is suppressed (NOT re-fired)
   *  if the guard says the write already happened (FR-3.RL.004 / AC-3.RL.004.2). None are dropped. */
  drainDue(now: number): Promise<DrainOutcome[]>;
}

/** Options carried into `decide` for the live-429 / header-reconciliation paths. */
export interface DecideOpts {
  /** a vendor rate-remaining header observed on the PRIOR call — reconciles conservatively before deciding. */
  vendorRemaining?: number;
  /** set when this decision is being made in response to an actual 429 (not just a threshold crossing). A
   *  low-risk 429 → backoff (honouring retryAfterSeconds if present); a high-risk 429 → halt-escalate. */
  is429?: boolean;
  /** a vendor Retry-After header (seconds) on a 429 — honoured EXACTLY (FR-3.RL.005 / AC-3.RL.005.1). */
  retryAfterSeconds?: number;
  /** the current backoff attempt (0-based) for exponential growth when there is no Retry-After. */
  backoffAttempt?: number;
  /** deterministic jitter fraction in [0,1) — injected by the caller (no Math.random in the fake; house
   *  discipline). The live adapter supplies a real RNG value. */
  jitter?: number;
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// In-memory fake — the reference model. Deterministic: a logical `now` (epoch seconds) is supplied by the
// caller; jitter is injected, never Math.random (house discipline). The deferral queue is a Map that stands
// in for the PERSISTED table — a test proves restart-durability by handing the SAME backing store to a fresh
// limiter instance (the rows survive because they are not instance-local memory the way a JS array closure
// would be — see RateLimiterState below).
// ───────────────────────────────────────────────────────────────────────────────────────────────────

/** The durable state a RateLimiter operates over. Held OUTSIDE the limiter instance so a "restart" is
 *  modelled by constructing a NEW InMemoryRateLimiter over the SAME state object — exactly what a persisted
 *  table gives you (FR-3.RL.004: the queue survives a runtime restart). */
export interface RateLimiterState {
  trackers: Map<string, RateLimitTrackerRow>; // key = `${connector}::${window_label}`
  deferred: Map<string, DeferredCallRow>; // the PERSISTED 95% queue
  seq: { n: number };
}
export function newRateLimiterState(): RateLimiterState {
  return { trackers: new Map(), deferred: new Map(), seq: { n: 0 } };
}

const key = (connector: string, windowLabel: string) => `${connector}::${windowLabel}`;

export class InMemoryRateLimiter implements RateLimiter {
  constructor(
    /** the DURABLE state — pass the SAME object to a new instance to model a restart (FR-3.RL.004). */
    private readonly state: RateLimiterState,
    private readonly sink: EventSink,
    private readonly guard: IdempotencyGuard,
    private readonly config: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG,
    /** dossier-pinned caps for the FR-3.RL.008 config-validation warn. Keyed by (connector, window). */
    private readonly dossierCaps: readonly DossierCap[] = [],
  ) {}

  private nextId(prefix: string): string {
    this.state.seq.n += 1;
    return `${prefix}-${String(this.state.seq.n).padStart(4, '0')}`;
  }
  private iso(now: number): string {
    return new Date(now * 1000).toISOString();
  }

  async ensureWindow(
    connector: string,
    windowLabel: string,
    callLimit: number,
    windowDurationSeconds: number,
    now: number,
  ): Promise<RateLimitTrackerRow> {
    if (!Number.isInteger(callLimit) || callLimit <= 0) {
      throw new Error('rate_limit_tracker: call_limit must be a positive integer (FR-3.RL.001)');
    }
    // FR-3.RL.008 validation: a configured limit ABOVE the vendor's real cap invites 429s → warn (throw).
    const cap = this.dossierCaps.find((c) => c.connector === connector && c.windowLabel === windowLabel);
    if (cap && callLimit > cap.cap) {
      throw new Error(ERR_LIMIT_ABOVE_CAP(connector, windowLabel, callLimit, cap.cap));
    }
    const k = key(connector, windowLabel);
    const existing = this.state.trackers.get(k);
    if (existing) {
      // FR-3.RL.008: a live config change governs the NEXT call — update limit/duration in place (no redeploy).
      existing.call_limit = callLimit;
      existing.window_duration_seconds = windowDurationSeconds;
      existing.updated_at = this.iso(now);
      return { ...existing };
    }
    const row: RateLimitTrackerRow = {
      id: this.nextId('rlt'),
      connector,
      window_label: windowLabel,
      window_start: this.iso(now),
      window_duration_seconds: windowDurationSeconds,
      call_limit: callLimit,
      calls_made: 0,
      reset_at: this.iso(now + windowDurationSeconds),
      updated_at: this.iso(now),
    };
    this.state.trackers.set(k, row);
    return { ...row };
  }

  async getTracker(connector: string, windowLabel: string): Promise<RateLimitTrackerRow | null> {
    const r = this.state.trackers.get(key(connector, windowLabel));
    return r ? { ...r } : null;
  }

  private mustGet(connector: string, windowLabel: string): RateLimitTrackerRow {
    const r = this.state.trackers.get(key(connector, windowLabel));
    if (!r) throw new Error(ERR_NO_TRACKER(connector, windowLabel));
    return r;
  }

  /** Roll the window forward if `now` is past reset_at: a new window resets calls_made to 0 (FR-3.RL.001). */
  private rollIfExpired(row: RateLimitTrackerRow, now: number): void {
    if (now * 1000 >= Date.parse(row.reset_at)) {
      row.window_start = this.iso(now);
      row.reset_at = this.iso(now + row.window_duration_seconds);
      row.calls_made = 0;
      row.updated_at = this.iso(now);
    }
  }

  async reconcileHeader(
    connector: string,
    windowLabel: string,
    vendorRemaining: number,
    now: number,
  ): Promise<RateLimitTrackerRow> {
    const row = this.mustGet(connector, windowLabel);
    // Tracker's own view of remaining headroom.
    const trackerRemaining = row.call_limit - row.calls_made;
    if (vendorRemaining < trackerRemaining) {
      // AC-3.RL.002.2: the vendor reports LESS headroom than we think → trust the CONSERVATIVE value.
      // Reconcile calls_made UP so remaining == vendorRemaining, and LOG the divergence (never over-call).
      const before = row.calls_made;
      row.calls_made = row.call_limit - vendorRemaining;
      row.updated_at = this.iso(now);
      await this.sink.append({
        event_type: 'rate_limit_throttled', // divergence is a loud signal on the same rate-limit channel
        connector,
        window_label: windowLabel,
        summary: `Vendor header reports ${vendorRemaining} remaining < tracker's ${trackerRemaining}; reconciled conservatively (calls_made ${before}→${row.calls_made}).`,
        payload: {
          reason: 'header_divergence',
          vendor_remaining: vendorRemaining,
          tracker_remaining_before: trackerRemaining,
          calls_made_before: before,
          calls_made_after: row.calls_made,
        },
      });
    }
    // If the vendor reports MORE headroom, we keep the tracker's (also conservative) view — do not over-trust.
    return { ...row };
  }

  async decide(ctx: CallContext, now: number, opts: DecideOpts = {}): Promise<TierDecision> {
    const row = this.mustGet(ctx.connector, ctx.windowLabel);
    this.rollIfExpired(row, now);

    // Reconcile a supplied vendor header FIRST (conservative wins) so the tier math reads the true headroom.
    if (opts.vendorRemaining !== undefined) {
      await this.reconcileHeader(ctx.connector, ctx.windowLabel, opts.vendorRemaining, now);
    }

    const highRisk = isHighRisk(ctx);

    // ── FR-3.RL.006 — the halt-escalate branch takes precedence on any rate-limit/429 for a high-risk or
    // irreversible/billed call, REGARDLESS of urgency. It is EXCLUDED from the 429 auto-retry path. ──
    const usageAfter = (row.calls_made + 1) / row.call_limit; // usage if THIS call were counted
    const atCeiling = row.calls_made >= row.call_limit || usageAfter >= this.config.pauseThreshold;
    if (highRisk && (opts.is429 === true || atCeiling)) {
      await this.sink.append({
        event_type: 'rate_limit_halt_escalated',
        connector: ctx.connector,
        window_label: ctx.windowLabel,
        summary: `High-risk/irreversible action on '${ctx.connector}' was rate-limited — HALTED and escalated to a human; NOT auto-retried (FR-3.RL.006).`,
        payload: {
          reason: opts.is429 ? '429' : 'ceiling',
          risk_level: ctx.riskLevel,
          irreversible: ctx.irreversible,
          urgency: ctx.urgency, // recorded to PROVE urgency did not override the halt
          calls_made: row.calls_made,
          call_limit: row.call_limit,
        },
      });
      return { tier: 'halt-escalate', escalationEmitted: true, row: { ...row } };
    }

    // ── FR-3.RL.005 — a live 429 on a LOW-risk call → exponential backoff with jitter, honouring Retry-After
    // exactly when present, capped at CFG-backoff_max_ms. (High-risk 429 already halted above.) ──
    if (opts.is429 === true) {
      const delayMs = this.backoffDelayMs(opts);
      await this.sink.append({
        event_type: 'rate_limit_backoff',
        connector: ctx.connector,
        window_label: ctx.windowLabel,
        summary: `429 on '${ctx.connector}' — backing off ${delayMs}ms (${opts.retryAfterSeconds !== undefined ? 'Retry-After' : 'exponential+jitter'}) before retry.`,
        payload: {
          delay_ms: delayMs,
          source: opts.retryAfterSeconds !== undefined ? 'retry-after' : 'exponential',
          retry_after_seconds: opts.retryAfterSeconds ?? null,
          attempt: opts.backoffAttempt ?? 0,
        },
      });
      return {
        tier: 'backoff',
        delayMs,
        source: opts.retryAfterSeconds !== undefined ? 'retry-after' : 'exponential',
        row: { ...row },
      };
    }

    // ── Graduated threshold tiers (low-risk calls only past this point). Read usage AFTER counting this call.
    if (usageAfter >= this.config.pauseThreshold) {
      // FR-3.RL.004 — 95%: PAUSE non-critical + enqueue for post-reset on the persisted queue. Urgent/
      // approval-gated may still proceed within remaining headroom; here `background` is the non-critical set.
      if (ctx.urgency === 'urgent' && row.calls_made < row.call_limit) {
        // critical call proceeds within remaining headroom (still counts).
        row.calls_made += 1;
        row.updated_at = this.iso(now);
        return { tier: 'proceed', row: { ...row } };
      }
      // NB: an irreversible/billed write NEVER reaches here — it routes to halt-escalate above (FR-3.RL.006
      // precedence). Only non-critical calls (reads + idempotent/retryable writes carrying a key) are queued.
      // A queued write is identified by an idempotencyKey; on drain it re-consults the guard (FR-3.RL.004.2).
      const deferred: DeferredCallRow = {
        id: this.nextId('def'),
        connector: ctx.connector,
        window_label: ctx.windowLabel,
        run_after: row.reset_at,
        risk_level: ctx.riskLevel,
        irreversible: ctx.irreversible,
        urgency: ctx.urgency,
        idempotency_key: ctx.idempotencyKey ?? null,
        enqueued_at: this.iso(now),
        drained_at: null,
      };
      this.state.deferred.set(deferred.id, deferred);
      const queuedCount = [...this.state.deferred.values()].filter((d) => d.drained_at === null).length;
      await this.sink.append({
        event_type: 'rate_limit_paused',
        connector: ctx.connector,
        window_label: ctx.windowLabel,
        summary: `Usage ≥95% on '${ctx.connector}' — paused a non-critical call and queued it for post-reset (${queuedCount} pending).`,
        payload: { queue_id: deferred.id, run_after: deferred.run_after, queued_count: queuedCount },
      });
      return { tier: 'queued', queueId: deferred.id, runAfter: deferred.run_after, row: { ...row } };
    }

    if (usageAfter >= this.config.alertThreshold) {
      // FR-3.RL.003 — 80%: slow/deprioritise BACKGROUND; let URGENT/human/approval-gated proceed.
      if (ctx.urgency === 'urgent') {
        row.calls_made += 1;
        row.updated_at = this.iso(now);
        return { tier: 'throttled', deferred: false, row: { ...row } };
      }
      // background is throttled/deferred — NOT run now (does not consume headroom).
      await this.sink.append({
        event_type: 'rate_limit_throttled',
        connector: ctx.connector,
        window_label: ctx.windowLabel,
        summary: `Usage ≥80% on '${ctx.connector}' — throttling a background call; urgent calls still proceed (FR-3.RL.003).`,
        payload: {
          usage_fraction: usageAfter,
          threshold: this.config.alertThreshold,
          urgency: ctx.urgency,
          deferred: true,
        },
      });
      return { tier: 'throttled', deferred: true, row: { ...row } };
    }

    // Below 80% — proceed, count the call.
    row.calls_made += 1;
    row.updated_at = this.iso(now);
    return { tier: 'proceed', row: { ...row } };
  }

  /** Exponential backoff with jitter, capped at CFG-backoff_max_ms; Retry-After honoured EXACTLY when present. */
  private backoffDelayMs(opts: DecideOpts): number {
    if (opts.retryAfterSeconds !== undefined) {
      // AC-3.RL.005.1: honour Retry-After EXACTLY (seconds → ms). Never override with our own backoff.
      return opts.retryAfterSeconds * 1000;
    }
    // AC-3.RL.005.2: exponential from initial × multiplier^attempt, + jitter, capped at max (no unbounded retry).
    const attempt = opts.backoffAttempt ?? 0;
    const base = this.config.backoffInitialMs * Math.pow(this.config.backoffMultiplier, attempt);
    const capped = Math.min(base, this.config.backoffMaxMs);
    const jitter = opts.jitter ?? 0; // [0,1) — injected; adds up to +100% of the capped step, still ≤ max
    const withJitter = capped + jitter * capped;
    return Math.min(Math.round(withJitter), this.config.backoffMaxMs);
  }

  async pendingDeferred(connector?: string): Promise<DeferredCallRow[]> {
    return [...this.state.deferred.values()]
      .filter((d) => d.drained_at === null && (connector === undefined || d.connector === connector))
      .map((d) => ({ ...d }));
  }

  async drainDue(now: number): Promise<DrainOutcome[]> {
    const due = [...this.state.deferred.values()]
      .filter((d) => d.drained_at === null && now * 1000 >= Date.parse(d.run_after))
      .sort((a, b) => (a.enqueued_at < b.enqueued_at ? -1 : a.enqueued_at > b.enqueued_at ? 1 : 0));
    const outcomes: DrainOutcome[] = [];
    for (const d of due) {
      // AC-3.RL.004.2: a queued WRITE re-consults the idempotency guard BEFORE firing so a deferred
      // irreversible send cannot double-fire (FR-3.CONN.004). A read (no key) always fires.
      if (d.idempotency_key) {
        const outcome = await this.guard.commitIntent(d.idempotency_key, d.connector, now);
        d.drained_at = this.iso(now);
        if (outcome.kind === 'suppressed') {
          outcomes.push({ kind: 'suppressed', row: { ...d }, priorResult: outcome.result });
          continue; // did NOT re-fire — the write already happened
        }
      } else {
        d.drained_at = this.iso(now);
      }
      outcomes.push({ kind: 'fired', row: { ...d } });
    }
    return outcomes;
  }
}
