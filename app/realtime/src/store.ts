// ISSUE-076 — the RealtimeContract PORT + in-memory fake (the house port+fake pattern, cf.
// app/config-store/src/store.ts, app/observability). This slice is a CLIENT-SIDE freshness contract: it
// creates NO table (schema.md unchanged). It (a) reads per-surface poll cadences + the degrade headroom
// threshold from config_values, (b) wires exactly TWO Realtime subscriptions and forbids a third, (c)
// accounts a per-silo Realtime connection budget and DEGRADES extra subscriptions to polling BEFORE the
// cap, keeping the two trust-critical surfaces last to degrade and emitting a health signal, and (d)
// runs an honest subscription lifecycle (teardown on unmount, reconnect-or-fall-back, honest indicator).
//
// The in-memory fake IS the reference model: every invariant the running client must uphold is enforced
// here, so a test against the fake proves the contract. The live pg adapter (supabase-store.ts) only
// supplies the two config reads (cadence + threshold) from config_values and the initial subscription
// seed reads (task_queue `awaiting_approval`, `notifications`) — the budget/degrade/lifecycle logic is
// pure client state and lives in the ConnectionManager below (shared by both fake and adapter callers).
//
// Invariants enforced (mapping to §4 ACs):
//   1. Exactly TWO Realtime surfaces (approval_queue + notification_centre); openRealtime rejects any
//      third surface (FR-7.RTP.001 / NFR-OBS.014 → AC-7.RTP.001.3, AC-NFR-OBS.014.1).
//   2. Each polled surface's interval comes from config_values, default applied when unset; a config edit
//      changes it with no code change (FR-7.RTP.002 → AC-7.RTP.002.1/.2).
//   3. Per-silo connection budget: at the headroom threshold (default 80% of cap) a NEW subscription
//      degrades to polling BEFORE the cap; the degraded surface still updates (polls), never a silent
//      freeze; the degrade emits a health signal (FR-7.RTP.003 / NFR-PERF.011 → AC-7.RTP.003.1/.2,
//      AC-NFR-PERF.011.1).
//   4. The two trust-critical surfaces are prioritised — LAST to lose Realtime (AC-NFR-PERF.011.2).
//   5. The Realtime subscription filter carries NO client_slug predicate (ADR-001 §3, reconciliation #1 →
//      AC-7.RTP.003.3).
//   6. Lifecycle: unmount tears down BOTH the subscription and any poller (no leaked budget); a dropped
//      socket reconnects or falls back to polling; the indicator is always the true state (FR-7.RTP.004 →
//      AC-7.RTP.004.1/.2).

import {
  SURFACE_CATALOGUE,
  REALTIME_SURFACES,
  HEADROOM_THRESHOLD_DEFAULT,
  surfaceSpec,
  type SurfaceId,
  type FreshnessMode,
} from './surfaces.ts';

// ── The config the contract reads from config_values (§12). The port supplies these two reads. ──
export interface RealtimeConfigSource {
  /** The poll interval (seconds) for a polled surface, read from its config_values key. `undefined` = the
   *  key is UNSET, so the caller applies the documented default (FR-7.RTP.002 / AC-7.RTP.002.1). */
  pollIntervalSeconds(surface: SurfaceId): number | undefined;
  /** The `realtime_connection_headroom_threshold` config value (int 1–100). `undefined` = unset → default 80. */
  headroomThreshold(): number | undefined;
}

/** A Realtime subscription filter. Deliberately has NO `client_slug` field — inside a single-tenant silo
 *  the filter cannot depend on client identity (ADR-001 §3, reconciliation #1 → AC-7.RTP.003.3). The only
 *  filter a subscription may carry is an intra-silo table predicate (e.g. task_queue status). */
export interface RealtimeFilter {
  table: 'task_queue' | 'notifications';
  /** An optional intra-silo column predicate (e.g. status='awaiting_approval'). NEVER client_slug. */
  predicate?: { column: string; eq: string };
}

/** A health signal the contract emits when the connection budget forces a degrade — surfaced, never hidden
 *  (FR-7.RTP.003 / AC-7.RTP.003.2, AC-NFR-PERF.011.1). Consumed by the health surface / ops dashboard. */
export interface DegradeHealthSignal {
  kind: 'realtime-degraded-to-polling';
  surface: SurfaceId;
  /** live Realtime connection count at the moment of the degrade decision. */
  activeRealtime: number;
  cap: number;
  thresholdPercent: number;
  at: number; // logical epoch seconds
}

export const ERR_THIRD_REALTIME =
  'RealtimeContract: refusing to open a third Realtime subscription — only approval_queue and notification_centre may hold a Realtime (WebSocket) subscription (NFR-OBS.014 / AC-7.RTP.001.3)';

/** Resolve a polled surface's effective interval: config value if set, else the documented default. Throws
 *  for a Realtime-entitled surface (they do not poll by entitlement). (FR-7.RTP.002 → AC-7.RTP.002.1) */
export function effectivePollSeconds(surface: SurfaceId, cfg: RealtimeConfigSource): number {
  const spec = surfaceSpec(surface);
  if (spec.transport !== 'poll' || spec.defaultPollSeconds === undefined) {
    throw new Error(`surface '${surface}' is not a polled surface — it has no poll cadence`);
  }
  const fromConfig = cfg.pollIntervalSeconds(surface);
  return fromConfig ?? spec.defaultPollSeconds;
}

/** Resolve the headroom threshold percent (1–100): config value if set, else default 80. */
export function effectiveThresholdPercent(cfg: RealtimeConfigSource): number {
  const v = cfg.headroomThreshold();
  if (v === undefined) return HEADROOM_THRESHOLD_DEFAULT;
  if (!Number.isInteger(v) || v < 1 || v > 100) {
    throw new Error(`realtime_connection_headroom_threshold must be an int 1–100, got ${v}`);
  }
  return v;
}

// ── The runtime state of one mounted surface subscription in a browser tab. ──
interface SurfaceState {
  surface: SurfaceId;
  mode: FreshnessMode;
  /** true while a Realtime WebSocket subscription is held (counts against the silo budget). */
  hasRealtime: boolean;
  /** true while a poller is running (counts against nothing; the polling fallback). */
  hasPoller: boolean;
  filter?: RealtimeFilter;
  /** the trust-critical entitlement this mount holds — captured at mount so reconnect() applies the SAME
   *  headroom/priority rule (a non-trust-critical mount degrades at the threshold on reconnect too). */
  trustCritical: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// ConnectionManager — the per-silo Realtime connection budget + degrade + lifecycle engine. This is the
// reference model for FR-7.RTP.001/003/004. Deterministic: a logical `now` (epoch seconds) is supplied by
// the caller; no Date.now()/random (house discipline). One instance models one silo's live budget across
// however many tabs/surfaces are mounted against it.
// ─────────────────────────────────────────────────────────────────────────────
export class ConnectionManager {
  private readonly cfg: RealtimeConfigSource;
  /** the per-silo Realtime concurrent-connection ceiling (Supabase Free ~200 / Pro ~500). */
  readonly cap: number;
  /** mount handle → surface state. A handle models one mounted tab-surface (unmount tears it down). */
  private readonly mounted = new Map<number, SurfaceState>();
  private handleSeq = 0;
  /** every degrade decision is emitted here — the health signal is never silent (AC-7.RTP.003.2). */
  readonly healthSignals: DegradeHealthSignal[] = [];

  constructor(cfg: RealtimeConfigSource, cap: number) {
    if (cap <= 0) throw new Error(`silo Realtime cap must be positive, got ${cap}`);
    this.cfg = cfg;
    this.cap = cap;
  }

  /** live Realtime connections currently held against this silo's budget. */
  activeRealtime(): number {
    let n = 0;
    for (const s of this.mounted.values()) if (s.hasRealtime) n += 1;
    return n;
  }

  /** the degrade trigger point: floor(threshold% × cap). This is the OPEN admission ceiling — the top band
   *  `[degradeAt(), cap)` is *reserved headroom*, admitted to trust-critical surfaces ONLY. A NEW Realtime
   *  subscription degrades to polling when the live count has already reached OR PASSED the ceiling it is
   *  entitled to — for a non-trust-critical surface that ceiling is `degradeAt()`, i.e. BEFORE the cap. */
  degradeAt(): number {
    return Math.floor((effectiveThresholdPercent(this.cfg) * this.cap) / 100);
  }

  /** The live-connection ceiling a NEWLY-arriving subscription of this spec is entitled to — the single
   *  place the headroom/priority rule lives, so it can never drift between mount() and reconnect().
   *
   *  The rule (FR-7.RTP.003 / NFR-PERF.011 → AC-7.RTP.003.2, AC-NFR-PERF.011.1/.2):
   *    • The band `[0, degradeAt())` (default 0–80% of cap) is OPEN — any Realtime surface may go live there.
   *    • The band `[degradeAt(), cap)` is RESERVED HEADROOM — a scarce buffer admitted to trust-critical
   *      surfaces ONLY. A non-trust-critical surface arriving once the live count has reached `degradeAt()`
   *      DEGRADES to polling — the degrade fires strictly BELOW the hard cap (this is the posture the FR
   *      demands; the old `trustCritical ? cap : …` shortcut made this branch dead because BOTH catalogued
   *      Realtime surfaces are trust-critical, so `degradeAt()` never governed and the first degrade only
   *      ever happened AT the cap — the silent-until-cap posture NFR-PERF.011 forbids).
   *    • At/above `cap` EVERY surface degrades — even a trust-critical one — but it was the LAST to degrade,
   *      having had priority for the reserved headroom (AC-NFR-PERF.011.2: last to lose Realtime, not never).
   *  Trust-critical surfaces are therefore *prioritised for the reserved headroom* yet still bounded by the
   *  hard cap; non-trust-critical surfaces degrade at the headroom threshold, before the cap. */
  private liveLimitFor(trustCritical: boolean | undefined): number {
    return trustCritical ? this.cap : this.degradeAt();
  }

  /** Mount a surface in a tab. Returns an opaque handle used to unmount. This is the SINGLE entry point;
   *  it enforces the two-Realtime-surface cap AND the budget/degrade decision.
   *
   *  `trustCriticalOverride` lets a caller mount a Realtime subscription under a NON-trust-critical
   *  entitlement WITHOUT adding a catalogue surface (which would breach the exactly-two-Realtime-surface
   *  cap). It exists so the general degrade path — a Realtime surface that is NOT one of the two prioritised
   *  ones — is exercisable and OBSERVABLE (it degrades at the headroom threshold, before the cap). It NEVER
   *  loosens the guards: only the two named surfaces may take a Realtime path, and the override cannot make a
   *  polled surface Realtime. Omit it in production; both catalogued surfaces are trust-critical. */
  mount(surface: SurfaceId, now: number, trustCriticalOverride?: boolean): number {
    const spec = surfaceSpec(surface);
    const handle = ++this.handleSeq;

    if (spec.transport === 'realtime') {
      // Guard: only the two named surfaces may EVER take a Realtime path (defence in depth on top of the
      // catalogue) — a third Realtime surface is impossible (AC-7.RTP.001.3 / AC-NFR-OBS.014.1).
      if (!REALTIME_SURFACES.includes(surface)) throw new Error(ERR_THIRD_REALTIME);

      // Budget decision: can this Realtime subscription go live, or must it degrade to polling? Count TOTAL
      // live Realtime connections and compare against the ceiling this surface is entitled to (liveLimitFor):
      // a non-trust-critical surface degrades at the headroom threshold — BEFORE the cap — while the two
      // trust-critical surfaces have priority for the reserved headroom and degrade only at the hard cap
      // (last to degrade, AC-NFR-PERF.011.2). The degrade can therefore fire below the cap (AC-7.RTP.003.2).
      const trustCritical = trustCriticalOverride ?? spec.trustCritical ?? false;
      const active = this.activeRealtime();
      const limit = this.liveLimitFor(trustCritical);
      if (active >= limit) {
        // Degrade to polling: still updates (polls) — never a silent freeze (AC-7.RTP.003.1) — and the
        // degrade is emitted as a health signal (AC-7.RTP.003.2 / AC-NFR-PERF.011.1).
        this.mounted.set(handle, { surface, mode: 'polling', hasRealtime: false, hasPoller: true, trustCritical });
        this.healthSignals.push({
          kind: 'realtime-degraded-to-polling',
          surface,
          activeRealtime: active,
          cap: this.cap,
          thresholdPercent: effectiveThresholdPercent(this.cfg),
          at: now,
        });
      } else {
        // Grant the Realtime subscription. Its filter carries an intra-silo predicate ONLY — never
        // client_slug (AC-7.RTP.003.3).
        this.mounted.set(handle, {
          surface,
          mode: 'live',
          hasRealtime: true,
          hasPoller: false,
          filter: realtimeFilterFor(surface),
          trustCritical,
        });
      }
    } else {
      // A polled surface never takes budget; it starts polling immediately.
      this.mounted.set(handle, { surface, mode: 'polling', hasRealtime: false, hasPoller: true, trustCritical: false });
    }
    return handle;
  }

  /** Unmount: tear down BOTH the Realtime subscription and any poller (no leaked connections counting
   *  against the budget) (FR-7.RTP.004 → AC-7.RTP.004.1). Idempotent. */
  unmount(handle: number): void {
    this.mounted.delete(handle);
  }

  /** The honest freshness indicator for a mounted surface (FR-7.RTP.004 / AC-7.RTP.004.2). */
  mode(handle: number): FreshnessMode {
    const s = this.mounted.get(handle);
    if (!s) throw new Error(`no mounted surface for handle ${handle} (unmounted or never mounted)`);
    return s.mode;
  }

  /** The subscription filter a mounted Realtime surface holds — or undefined if it is polling. */
  filter(handle: number): RealtimeFilter | undefined {
    return this.mounted.get(handle)?.filter;
  }

  /** True iff this handle currently holds a live Realtime subscription (counts against the budget). */
  isRealtime(handle: number): boolean {
    return this.mounted.get(handle)?.hasRealtime ?? false;
  }

  /** Simulate a dropped WebSocket for a mounted Realtime surface. It first shows an HONEST `reconnecting`
   *  indicator (never a stale "live"), then either reconnects (if budget allows) or falls back to polling
   *  (FR-7.RTP.004 → AC-7.RTP.004.2). Freeing the socket on drop returns its budget slot immediately. */
  dropSocket(handle: number, now: number): FreshnessMode {
    const s = this.mounted.get(handle);
    if (!s) throw new Error(`no mounted surface for handle ${handle}`);
    if (!s.hasRealtime) return s.mode; // already polling — nothing to drop
    // The socket is gone: free the budget slot and honestly show reconnecting (NOT live).
    s.hasRealtime = false;
    s.mode = 'reconnecting';
    return s.mode;
  }

  /** Attempt to re-establish a dropped subscription. Reconnects to `live` if the budget (with the same
   *  priority rule as mount) allows; otherwise falls back to `polling`. Either way the indicator tells the
   *  truth — a client never silently believes it is live (FR-7.RTP.004 → AC-7.RTP.004.2). */
  reconnect(handle: number, now: number): FreshnessMode {
    const s = this.mounted.get(handle);
    if (!s) throw new Error(`no mounted surface for handle ${handle}`);
    if (s.hasRealtime) return s.mode; // already live
    const spec = surfaceSpec(s.surface);
    if (spec.transport !== 'realtime') {
      s.mode = 'polling';
      s.hasPoller = true;
      return s.mode;
    }
    // Reconnect applies the SAME headroom/priority rule as mount, on the entitlement captured at mount
    // (s.trustCritical) — a non-trust-critical surface falls back to polling at the headroom threshold too.
    const active = this.activeRealtime();
    const limit = this.liveLimitFor(s.trustCritical);
    if (active >= limit) {
      // Budget still full → fall back to polling (never a silent freeze).
      s.hasPoller = true;
      s.mode = 'polling';
      this.healthSignals.push({
        kind: 'realtime-degraded-to-polling',
        surface: s.surface,
        activeRealtime: active,
        cap: this.cap,
        thresholdPercent: effectiveThresholdPercent(this.cfg),
        at: now,
      });
    } else {
      s.hasRealtime = true;
      s.hasPoller = false;
      s.mode = 'live';
      s.filter = realtimeFilterFor(s.surface);
    }
    return s.mode;
  }

  /** How often a mounted polled (or degraded-to-polling) surface polls, in seconds — from config, default
   *  applied when unset. For a surface running Realtime this is its fallback cadence should it degrade. */
  pollSeconds(surface: SurfaceId): number {
    return effectivePollSeconds(surface, this.cfg);
  }

  /** Count of mounted handles (test/observability helper — a leaked mount would show up here). */
  mountedCount(): number {
    return this.mounted.size;
  }
}

/** Build the (client_slug-free) Realtime filter for one of the two Realtime surfaces. The approval queue
 *  watches task_queue rows in the `awaiting_approval` state; the notification centre subscribes to the
 *  whole notifications table. NEITHER filter references client_slug (AC-7.RTP.003.3). */
export function realtimeFilterFor(surface: SurfaceId): RealtimeFilter {
  switch (surface) {
    case 'approval_queue':
      return { table: 'task_queue', predicate: { column: 'status', eq: 'awaiting_approval' } };
    case 'notification_centre':
      return { table: 'notifications' };
    default:
      throw new Error(ERR_THIRD_REALTIME);
  }
}

// ── A trivial in-memory config source (the reference double for RealtimeConfigSource). Mirrors reading the
//    per-surface cadence keys + headroom threshold from config_values; an UNSET key returns undefined so the
//    documented default applies (AC-7.RTP.002.1), and setting a key mutates the effective value with no code
//    change (AC-7.RTP.002.2). ──
export class InMemoryRealtimeConfig implements RealtimeConfigSource {
  private readonly pollKeys = new Map<SurfaceId, number>();
  private threshold: number | undefined;

  pollIntervalSeconds(surface: SurfaceId): number | undefined {
    return this.pollKeys.get(surface);
  }
  headroomThreshold(): number | undefined {
    return this.threshold;
  }
  /** simulate a config_values edit of a per-surface cadence key (LIVE — takes effect with no code change). */
  setPollInterval(surface: SurfaceId, seconds: number | undefined): void {
    if (seconds === undefined) this.pollKeys.delete(surface);
    else this.pollKeys.set(surface, seconds);
  }
  /** simulate a config_values edit of realtime_connection_headroom_threshold (LIVE). */
  setHeadroomThreshold(percent: number | undefined): void {
    this.threshold = percent;
  }
}

export { SURFACE_CATALOGUE, REALTIME_SURFACES };
