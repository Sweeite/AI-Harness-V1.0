// ISSUE-051 (C5 LOP) — the LoopRunner PORT + in-memory fake reference model (the house port+fake pattern,
// cf. app/task-queue/src/store.ts). The loop LAYER that drives recurring work — three default cadence loops
// (fast/medium/slow), config-extensible at boot, running independently, with same-loop overlap prevention,
// single catch-up (not backfill), per-run logging, a detected-miss signal, and a three-consecutive-failure
// heartbeat. This slice READS task_queue / task_graph_versions and WRITES ONLY event_log. No new table.
//
// The InMemoryLoopRunner fake is BOTH the test double AND the reference model the live pg adapter
// (supabase-store.ts) must match against the baseline DDL (app/silo/migrations/0001_baseline.sql):
//   • event_log.event_type is an ENUM — every event this slice emits carries an enum-VALID event_type
//     ('loop_missed', 'task_failure_spike', 'task_completed', 'task_failed'). The fake REJECTS any other
//     value exactly as the DB enum would, so a test cannot pass offline while the live INSERT would throw
//     with `invalid input value for enum event_type` (fake-vs-live discipline).
//   • event_log.summary is `text NOT NULL` — never empty (AC-7.LOG.002.2). The fake enforces non-empty.
//
// Mapped to the three non-negotiables:
//   FR-5.LOP.001 (—) three default loops, cadences in documented ranges, documented named task lists.
//   FR-5.LOP.002 (—) a config-defined loop is registered at boot with NO code change (config-extensible).
//   FR-5.LOP.003 (—) loops run independently — one loop's overrun/failure never blocks another (per-loop state).
//   FR-5.LOP.004 (#1/#3) no concurrent same-loop run (skip or queue EXACTLY ONE); missed runs = a SINGLE
//                        catch-up, never a per-window backfill stampede; idempotency keys (ISSUE-048 queue +
//                        ISSUE-049 graph) guarantee the catch-up cannot duplicate already-done work (AF-112).
//   FR-5.LOP.005 (#3) every run logged with timestamp + outcome; THREE consecutive failures → a loud, recorded
//                     loop-failure heartbeat event. Never silent.
//   NFR-PERF.010 (#—) an idle loop tick runs a code DB-condition pre-check and short-circuits WITHOUT waking
//                     the orchestrator / making an LLM call (the idle floor ≈ free — ADR-003 §5).

import type { TaskQueue, TaskType } from '@harness/task-queue';

// ── Cadence ranges (FR-5.LOP.001, documented). A configured cadence is validated against its loop's range so
// a misconfigured default is caught, not silently run. Ranges are in SECONDS. ────────────────────────────────
export interface CadenceRange {
  minSeconds: number;
  maxSeconds: number;
}
// fast 5–15 min · medium 1–4 h · slow daily–weekly. (schema.md / performance.md NFR-PERF.010.)
export const CADENCE_RANGES: Readonly<Record<'fast' | 'medium' | 'slow', CadenceRange>> = {
  fast: { minSeconds: 5 * 60, maxSeconds: 15 * 60 },
  medium: { minSeconds: 1 * 3600, maxSeconds: 4 * 3600 },
  slow: { minSeconds: 24 * 3600, maxSeconds: 7 * 24 * 3600 },
};

// ── A loop definition, exactly as it arrives from config (config_values §12). name + cadence + named task list.
// `cadenceSeconds` is the resolved interval; the cron string is carried for documentation/boot registration but
// the runner drives off the resolved interval so tests are deterministic (no wall-clock cron parsing offline). ─
export interface LoopDef {
  name: string;
  /** the loop's cadence class — picks the documented range it must fall within (FR-5.LOP.001). A config-defined
   *  extra loop names its own class so its cadence is range-checked too. */
  class: 'fast' | 'medium' | 'slow';
  /** the resolved cadence interval in seconds. Must sit within CADENCE_RANGES[class]. */
  cadenceSeconds: number;
  /** the documented cron string (BOOT-class config; used at Inngest registration — ADR-005). */
  cron: string;
  /** the named task list this loop dispatches — task_graph_versions.task_type_name values (FR-5.LOP.001). */
  taskList: TaskType extends never ? string[] : string[];
}

// The three DEFAULT loops with their documented cadences (performance.md NFR-PERF.010) + documented task lists
// (FR-5.LOP.001). A deployment ships these; config may OVERRIDE a cadence (within range) or ADD loops.
export const DEFAULT_LOOPS: readonly LoopDef[] = [
  {
    name: 'fast',
    class: 'fast',
    cadenceSeconds: 10 * 60, // */10m default (5–15 range)
    cron: '*/10 * * * *',
    taskList: ['urgent_triggers', 'new_leads', 'flagged_messages', 'overdue_tasks'],
  },
  {
    name: 'medium',
    class: 'medium',
    cadenceSeconds: 2 * 3600, // 2h default (1–4h range)
    cron: '0 */2 * * *',
    taskList: ['queued_tasks', 'pending_memory_writes', 'stale_approvals'],
  },
  {
    name: 'slow',
    class: 'slow',
    cadenceSeconds: 24 * 3600, // 08:00 daily default (daily–weekly range)
    cron: '0 8 * * *',
    taskList: ['consolidation', 'summaries', 'memory_health', 'self_improvement', 'insight_runs'],
  },
] as const;

// ── Config the runner CONSUMES (config_values §12 owns the keys; we do not define them). The three cadence
// knobs + any additional config-defined loops (config-extensibility, FR-5.LOP.002). ─────────────────────────
export interface LoopConfig {
  /** override the default cadences (cron strings, BOOT class). */
  loop_cadence_fast?: string;
  loop_cadence_medium?: string;
  loop_cadence_slow?: string;
  /** resolved cadence seconds per default loop (a cron string maps to a seconds interval at boot; supplied here
   *  so offline tests are deterministic). Omitted → the DEFAULT_LOOPS interval is used. */
  cadenceSecondsFast?: number;
  cadenceSecondsMedium?: number;
  cadenceSecondsSlow?: number;
  /** additional loops defined purely in config — registered at boot with NO code change (FR-5.LOP.002). */
  additionalLoops?: LoopDef[];
  /** consecutive-failure threshold for the loop-failure heartbeat (FR-5.LOP.005). Default 3. */
  failureHeartbeatThreshold?: number;
}
export const DEFAULT_FAILURE_HEARTBEAT_THRESHOLD = 3;

// ── The event_log sink (schema.md §8). This slice EMITS onto it; C7 (ISSUE-011) owns it. The row shape mirrors
// event_log so the live adapter INSERTs the identical row. event_type is enum-constrained (see below). ────────
export const LOOP_EVENT_TYPES = [
  'loop_missed', // a detected missed window
  'task_failure_spike', // the three-consecutive-failure loop-failure heartbeat (alert seam → C7)
  'task_completed', // a per-run success log (timestamp + outcome)
  'task_failed', // a per-run failure log (timestamp + outcome)
] as const;
export type LoopEventType = (typeof LOOP_EVENT_TYPES)[number];

export function isLoopEventType(v: unknown): v is LoopEventType {
  return typeof v === 'string' && (LOOP_EVENT_TYPES as readonly string[]).includes(v);
}

export interface LoopEvent {
  event_type: LoopEventType; // MUST be an event_type enum value present in the baseline DDL
  entity_ids: string[];
  summary: string; // plain-English; NEVER empty (event_log.summary text NOT NULL — AC-7.LOG.002.2)
  payload: Record<string, unknown>;
}
export interface EventSink {
  append(ev: LoopEvent): Promise<void>;
}

// The exact rejection messages so a test can assert the same failure the live gate produces (fake-vs-live).
export const ERR_BAD_EVENT_TYPE = (t: unknown) =>
  `event_log: refusing to emit an event_type '${String(t)}' not in the baseline enum (invalid input value for enum event_type — #3)`;
export const ERR_EMPTY_SUMMARY =
  'event_log: summary is text NOT NULL and must be non-empty plain-English (AC-7.LOG.002.2 / #3)';
export const ERR_CADENCE_OUT_OF_RANGE = (name: string, cad: number, r: CadenceRange) =>
  `loop '${name}': cadence ${cad}s outside its documented range [${r.minSeconds}, ${r.maxSeconds}]s (FR-5.LOP.001)`;
export const ERR_DUP_LOOP = (name: string) =>
  `loop '${name}': duplicate loop name at boot registration — each loop name must be unique (FR-5.LOP.002)`;

// ── The outcome of one loop tick — the observable result a test asserts against. ─────────────────────────────
export type TickOutcome =
  | 'ran' // dispatched work (the orchestrator was woken)
  | 'idle_short_circuit' // DB pre-check found no qualifying work → orchestrator NOT woken, no LLM call
  | 'skipped_overlap' // a prior run of THIS loop is still in flight → no second concurrent run
  | 'catch_up' // resumed after missed window(s) → a SINGLE catch-up run (not a backfill)
  | 'failed'; // the run's work threw → logged as a failure (feeds the heartbeat)

export interface TickResult {
  loop: string;
  outcome: TickOutcome;
  at: string; // iso timestamp of the tick
  /** how many missed windows were collapsed into this single catch-up (0 for a normal on-time run). Proves
   *  "single catch-up, not one-per-window" — always ≤ 1 dispatched run regardless of missedWindows. */
  missedWindows: number;
  /** the idempotency keys of the units this tick dispatched (empty on idle/skip/fail). AF-112: the SAME key
   *  across a normal run + its catch-up is what makes the catch-up a no-op the second time. */
  dispatchedKeys: string[];
  /** the run's consecutive-failure count AFTER this tick (0 on any success/idle/skip). */
  consecutiveFailures: number;
  /** true iff this tick tripped the three-consecutive-failure heartbeat. */
  heartbeatFired: boolean;
}

// ── The unit of work a loop dispatches. In real life this is a task_queue enqueue / task_graph dispatch; here
// it is abstracted behind an idempotency key so AF-112's "no duplicate side effect" is provable offline: the
// runner records each dispatched key in a shared ledger and NEVER dispatches the same key twice — mirroring the
// ISSUE-048 queue idempotency + ISSUE-049 graph keys the live path leans on. ─────────────────────────────────
export interface WorkUnit {
  /** the per-task / per-step idempotency key (FR-5.GRP.003/004). Same logical work → same key across runs. */
  idempotencyKey: string;
  /** the task type dispatched (a task_graph_versions.task_type_name). */
  taskType: string;
}

/** A loop's work source: the DB-condition pre-check (NFR-PERF.010) + the actual dispatch. The pre-check returns
 *  the qualifying WorkUnits WITHOUT waking the orchestrator; an EMPTY list ⇒ idle short-circuit (no LLM call).
 *  `dispatch` is where the real side effect happens (enqueue → task_queue). Provided by the caller/boot wiring;
 *  the runner owns the ordering (pre-check FIRST) and the dedup. */
export interface LoopWorkSource {
  /** code DB-condition pre-check — cheap, no LLM. Returns qualifying units (empty ⇒ idle). */
  precheck(loop: string, now: number): Promise<WorkUnit[]>;
  /** dispatch one unit (the orchestrator-waking side effect). MUST be idempotent by key at the sink; the runner
   *  additionally guards against re-dispatch of an already-seen key so a catch-up cannot double-act. May throw
   *  to simulate a failing run (feeds the heartbeat). */
  dispatch(loop: string, unit: WorkUnit, now: number): Promise<void>;
}

// ── The port. Sync-shaped in the fake, async so the DB adapter matches. ──────────────────────────────────────
export interface LoopRunner {
  /** the loops registered at boot (defaults + config-defined). FR-5.LOP.002/003. */
  registeredLoops(): LoopDef[];
  /** run one tick of a named loop at logical time `now` (epoch seconds). Enforces idle short-circuit,
   *  same-loop overlap prevention, single catch-up, per-run logging, and the failure heartbeat. */
  tick(loop: string, now: number): Promise<TickResult>;
  /** mark a loop's in-flight run as finished (releases the overlap lock). Modelled explicitly so an overrun is
   *  testable deterministically without wall-clock timing. */
  finishRun(loop: string, now: number): Promise<void>;
}

// ── Boot registration (FR-5.LOP.002/003): resolve the default loops (with any config cadence overrides) + any
// additional config-defined loops into a validated, de-duplicated registry. Range-checks every cadence and
// rejects duplicate names — a misconfigured loop is caught at boot, not silently run (#3). ───────────────────
export function registerLoops(config: LoopConfig = {}): LoopDef[] {
  const resolved: LoopDef[] = DEFAULT_LOOPS.map((d) => {
    const cadenceSeconds =
      d.name === 'fast'
        ? config.cadenceSecondsFast ?? d.cadenceSeconds
        : d.name === 'medium'
          ? config.cadenceSecondsMedium ?? d.cadenceSeconds
          : config.cadenceSecondsSlow ?? d.cadenceSeconds;
    const cron =
      d.name === 'fast'
        ? config.loop_cadence_fast ?? d.cron
        : d.name === 'medium'
          ? config.loop_cadence_medium ?? d.cron
          : config.loop_cadence_slow ?? d.cron;
    return { ...d, cadenceSeconds, cron };
  });
  // config-extensibility: additional loops registered with NO code change (FR-5.LOP.002).
  for (const extra of config.additionalLoops ?? []) resolved.push({ ...extra });

  const seen = new Set<string>();
  for (const loop of resolved) {
    if (seen.has(loop.name)) throw new Error(ERR_DUP_LOOP(loop.name));
    seen.add(loop.name);
    const range = CADENCE_RANGES[loop.class];
    if (loop.cadenceSeconds < range.minSeconds || loop.cadenceSeconds > range.maxSeconds) {
      throw new Error(ERR_CADENCE_OUT_OF_RANGE(loop.name, loop.cadenceSeconds, range));
    }
  }
  return resolved;
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// In-memory fake — the reference model. Deterministic: a logical `now` (epoch seconds) is supplied by the
// caller; no Date.now()/random (house discipline). It mirrors the baseline DDL constraints (enum event_type,
// non-empty summary) so a green offline test proves the contract the live silo must uphold.
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Per-loop runtime state the runner tracks (independence — FR-5.LOP.003: each loop has its OWN state). */
interface LoopState {
  def: LoopDef;
  inFlight: boolean; // a run is currently executing (overlap lock)
  queuedCatchUp: boolean; // exactly ONE pending run queued because the last tick overran (FR-5.LOP.004)
  lastRunAt: number | null; // epoch seconds of the last completed/attempted tick
  consecutiveFailures: number; // for the heartbeat (FR-5.LOP.005)
}

export class InMemoryLoopRunner implements LoopRunner {
  private readonly loops = new Map<string, LoopState>();
  /** the shared idempotency ledger — every key ever dispatched. AF-112: a re-dispatch of a seen key is a no-op,
   *  so a catch-up (or a self-overlap replay) produces ZERO duplicate side effects. Mirrors the ISSUE-048 queue
   *  idempotency + ISSUE-049 graph keys the live path relies on. */
  readonly dispatchedKeys = new Set<string>();
  /** an observable count of ACTUAL side effects per key — asserts "no duplicate side effect" (must stay ≤ 1). */
  readonly sideEffectCounts = new Map<string, number>();

  constructor(
    private readonly source: LoopWorkSource,
    private readonly sink: EventSink,
    config: LoopConfig = {},
    /** optional injected queue (ISSUE-048) — the live path enqueues through it; the offline reference model
     *  proves the dedup at the key level, so the queue is accepted but not required for the AC proofs. */
    private readonly _queue?: TaskQueue,
    private readonly failureThreshold: number = config.failureHeartbeatThreshold ??
      DEFAULT_FAILURE_HEARTBEAT_THRESHOLD,
  ) {
    for (const def of registerLoops(config)) {
      this.loops.set(def.name, {
        def,
        inFlight: false,
        queuedCatchUp: false,
        lastRunAt: null,
        consecutiveFailures: 0,
      });
    }
  }

  private iso(now: number): string {
    return new Date(now * 1000).toISOString();
  }

  private mustGet(loop: string): LoopState {
    const s = this.loops.get(loop);
    if (!s) throw new Error(`loop '${loop}': not registered`);
    return s;
  }

  registeredLoops(): LoopDef[] {
    return [...this.loops.values()].map((s) => ({ ...s.def }));
  }

  /** Emit onto the event_log sink — validating the enum + non-empty summary EXACTLY as the DDL would (so the
   *  fake cannot pass where the live INSERT would throw). */
  private async emit(ev: LoopEvent): Promise<void> {
    if (!isLoopEventType(ev.event_type)) throw new Error(ERR_BAD_EVENT_TYPE(ev.event_type));
    if (typeof ev.summary !== 'string' || ev.summary.trim().length === 0) {
      throw new Error(ERR_EMPTY_SUMMARY);
    }
    await this.sink.append(ev);
  }

  /** Log one run's outcome (timestamp + outcome) — FR-5.LOP.005 "every loop run is logged". */
  private async logRun(
    loop: string,
    outcome: TickOutcome,
    now: number,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const failed = outcome === 'failed';
    await this.emit({
      event_type: failed ? 'task_failed' : 'task_completed',
      entity_ids: [],
      summary: `loop '${loop}' tick ${outcome} at ${this.iso(now)}`,
      payload: { loop, outcome, at: this.iso(now), ...extra },
    });
  }

  /** Dispatch a unit ONCE — the idempotency guard. A second dispatch of the same key is a proven no-op: no
   *  duplicate side effect (AF-112 offline portion). */
  private async dispatchOnce(loop: string, unit: WorkUnit, now: number): Promise<boolean> {
    if (this.dispatchedKeys.has(unit.idempotencyKey)) {
      return false; // already done — the catch-up/self-overlap replay does NOTHING (no double-act)
    }
    // logic-sweep fix (store.ts:319, AF-112 / #1): RESERVE the key synchronously — before the `await` — so a
    // concurrent tick over the SAME key sees it taken and no-ops, instead of both racers slipping past a
    // check-then-await-then-record gap and double-acting. On dispatch failure we release the reservation so a
    // failed run is not "done" and can be retried (preserving the record-only-on-success intent).
    this.dispatchedKeys.add(unit.idempotencyKey);
    try {
      await this.source.dispatch(loop, unit, now);
    } catch (err) {
      this.dispatchedKeys.delete(unit.idempotencyKey); // failed dispatch is retryable — un-reserve the key
      throw err;
    }
    this.sideEffectCounts.set(unit.idempotencyKey, (this.sideEffectCounts.get(unit.idempotencyKey) ?? 0) + 1);
    return true;
  }

  async tick(loop: string, now: number): Promise<TickResult> {
    const s = this.mustGet(loop);

    // FR-5.LOP.004 / OD-057 — same-loop overlap prevention. If a prior run of THIS loop is still in flight,
    // do NOT start a second concurrent run: queue EXACTLY ONE catch-up (idempotent — a second overrun does not
    // stack a second queued run) and return skipped. (Independence: other loops are untouched — FR-5.LOP.003.)
    if (s.inFlight) {
      s.queuedCatchUp = true; // exactly one; already-true stays true (never a backfill of concurrent runs)
      await this.logRun(loop, 'skipped_overlap', now);
      return this.result(loop, 'skipped_overlap', now, 0, [], s.consecutiveFailures, false);
    }

    // Detect missed windows (e.g. after downtime). A gap > 1 cadence interval since the last run means windows
    // were missed. FR-5.LOP.004 / NFR-INF.014: fire a SINGLE catch-up, not one run per missed window.
    let missedWindows = 0;
    if (s.lastRunAt != null) {
      const elapsed = now - s.lastRunAt;
      const windows = Math.floor(elapsed / s.def.cadenceSeconds);
      if (windows > 1) missedWindows = windows - 1; // >1 window elapsed ⇒ (windows-1) were missed
    }
    const isCatchUp = missedWindows > 0 || s.queuedCatchUp;
    if (missedWindows > 0) {
      // Emit a loud detected-miss signal so a miss is never silent (#3). ONE event regardless of how many
      // windows were missed (we collapse to a single catch-up).
      await this.emit({
        event_type: 'loop_missed',
        entity_ids: [],
        summary: `loop '${loop}' missed ${missedWindows} window(s) — performing a SINGLE catch-up (no backfill stampede)`,
        payload: { loop, missed_windows: missedWindows, at: this.iso(now) },
      });
    }
    s.queuedCatchUp = false; // the queued catch-up (if any) is being serviced now

    // NFR-PERF.010 — idle short-circuit. Run the code DB-condition pre-check BEFORE waking the orchestrator.
    // No qualifying work ⇒ return WITHOUT dispatching (no LLM call). This runs even on a catch-up: a catch-up
    // with nothing to do is still free.
    const units = await this.source.precheck(loop, now);
    if (units.length === 0) {
      s.lastRunAt = now;
      // a successful (idle) tick clears the failure streak — the loop is healthy, just had no work.
      s.consecutiveFailures = 0;
      await this.logRun(loop, 'idle_short_circuit', now, { qualifying_units: 0 });
      return this.result(loop, 'idle_short_circuit', now, missedWindows, [], 0, false);
    }

    // There IS qualifying work — wake the orchestrator and dispatch. The overlap lock is held for the duration
    // of the run so a concurrent tick is skipped (above). AF-112: dispatch is idempotent by key — a catch-up
    // re-dispatching an already-done key is a no-op.
    s.inFlight = true;
    const dispatchedKeys: string[] = [];
    try {
      for (const unit of units) {
        const didWork = await this.dispatchOnce(loop, unit, now);
        if (didWork) dispatchedKeys.push(unit.idempotencyKey);
      }
    } catch (err) {
      // The run's work threw. Release the lock, record a FAILURE, bump the streak, maybe fire the heartbeat.
      s.inFlight = false;
      s.lastRunAt = now;
      s.consecutiveFailures += 1;
      await this.logRun(loop, 'failed', now, {
        error: err instanceof Error ? err.message : String(err),
        consecutive_failures: s.consecutiveFailures,
      });
      const fired = await this.maybeHeartbeat(loop, s, now);
      return this.result(loop, 'failed', now, missedWindows, dispatchedKeys, s.consecutiveFailures, fired);
    }

    // Success. Release the lock, clear the failure streak, log the run.
    s.inFlight = false;
    s.lastRunAt = now;
    s.consecutiveFailures = 0;
    const outcome: TickOutcome = isCatchUp ? 'catch_up' : 'ran';
    await this.logRun(loop, outcome, now, {
      dispatched: dispatchedKeys.length,
      missed_windows: missedWindows,
    });
    return this.result(loop, outcome, now, missedWindows, dispatchedKeys, 0, false);
  }

  /** Fire the three-consecutive-failure loop-failure heartbeat if the streak just reached the threshold. Emits
   *  a loud, recorded alert event (seam → C7). NEVER silent (#3 / FR-5.LOP.005). */
  private async maybeHeartbeat(loop: string, s: LoopState, now: number): Promise<boolean> {
    if (s.consecutiveFailures < this.failureThreshold) return false;
    // Fire exactly on reaching the threshold (and again on each further failure — an unattended failing loop
    // stays loud, like the DLQ heartbeat AC-5.JOB.006.2; never a one-shot that could be missed).
    await this.emit({
      event_type: 'task_failure_spike',
      entity_ids: [],
      summary: `loop '${loop}' failed ${s.consecutiveFailures} runs in a row (≥ ${this.failureThreshold}) — loop-failure heartbeat; operations alert`,
      payload: {
        loop,
        consecutive_failures: s.consecutiveFailures,
        threshold: this.failureThreshold,
        at: this.iso(now),
      },
    });
    return true;
  }

  /** Test/contract seam — acquire the overlap lock WITHOUT releasing it, to model a run that OVERRUNS its
   *  cadence (an Inngest step still executing when the next cron tick fires). A subsequent tick() then hits the
   *  `inFlight` guard and is skipped/queued-once (AC-5.LOP.004.1). Release with finishRun(). Mirrors the live
   *  Inngest per-key concurrency / "no concurrent same-loop run" guard (AF-063 seam). */
  async startLongRun(loop: string, now: number): Promise<void> {
    const s = this.mustGet(loop);
    if (s.inFlight) throw new Error(`loop '${loop}': a run is already in flight`);
    s.inFlight = true;
    s.lastRunAt = now;
  }

  async finishRun(loop: string, now: number): Promise<void> {
    const s = this.mustGet(loop);
    s.inFlight = false;
    s.lastRunAt = now;
  }

  /** true iff a queued single catch-up is pending for this loop (set by an overrun). Observable for tests. */
  hasQueuedCatchUp(loop: string): boolean {
    return this.mustGet(loop).queuedCatchUp;
  }

  private result(
    loop: string,
    outcome: TickOutcome,
    now: number,
    missedWindows: number,
    dispatchedKeys: string[],
    consecutiveFailures: number,
    heartbeatFired: boolean,
  ): TickResult {
    return {
      loop,
      outcome,
      at: this.iso(now),
      missedWindows,
      dispatchedKeys,
      consecutiveFailures,
      heartbeatFired,
    };
  }
}
