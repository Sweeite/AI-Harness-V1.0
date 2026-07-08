// ISSUE-052 (C5 JOB) — the JOB engine PORTS + in-memory fake reference models (the house port+fake pattern,
// cf. app/task-queue/src/store.ts, app/loops-heartbeat/src/store.ts). This module owns the *seam types* the
// Inngest engine (engine.ts) drives against; engine.ts owns the execution logic. The two live side effects the
// engine produces both go through a port here so the whole engine is unit-testable with NO live DB:
//
//   • ProjectionSink — the OD-058 SINGLE-AUTHORITY audit projection. Inngest owns retry/DLQ; the harness merely
//     MIRRORS Inngest's reported lifecycle into task_queue.attempts / next_retry_at / status / error. This port
//     is DELIBERATELY write-only-mirror: it exposes NO retry-scheduling method, and the fake carries a forbidden
//     `attemptScheduleRetry` hook that THROWS — structural proof of AC-5.JOB.004.1 / AC-NFR-INF.011.1 (the
//     task_queue path never issues its own retry — "exactly one retry loop", #2). The error array is monotone
//     (a sync may never SHORTEN the recorded history — #1 never lose an attempt).
//   • EventSink — the append-only event_log sink (schema.md §8) the run/DLQ events + the DLQ-liveness heartbeat
//     write to. Every emitted event_type is validated against the baseline enum EXACTLY as the DB would (so an
//     offline-green test cannot pass where the live INSERT would throw `invalid input value for enum
//     event_type`); summary is `text NOT NULL` -> never empty (AC-7.LOG.002.2 / #3).
//   • DlqStore — the model of Inngest's failed-function DLQ (Inngest-side operationally; its durable audit tail
//     is the task_queue row, status='failed' + full error history). Human-only recovery: requeue/discard require
//     an explicit human actor; there is NO method that auto-re-executes (#2). Each entry carries a heartbeat
//     clock so an unattended entry becomes a LOUD, escalating condition (AC-5.JOB.006.2 / #3).
//
// Seams this slice STOPS at (consumes/writes, does not own):
//   • QUE (ISSUE-048, @harness/task-queue) owns the task_queue TABLE + status machine + the attempts/
//     next_retry_at/error COLUMNS. This slice WRITES the OD-058 projection into them; the TaskStatus + ErrorAttempt
//     types are imported from there (single source of truth — the projection matches the real column shapes).
//   • GRP (ISSUE-049, @harness/task-graphs) owns the graph steps + the per-task/per-step idempotency-key
//     GENERATION. This slice CONSUMES those keys (a StepSpec carries a precomputed idempotencyKey; the engine
//     uses it as the step-memo / dedup key — it never generates one).
//   • ENV (ISSUE-050) owns the context-envelope schema + task_history originals store. The live envelope travels
//     as Inngest step-state at runtime (the engine's step memo); this slice does not write task_history.
//   • C7 (ISSUE-011 event_log; ISSUE-075/078 ops-dashboard) owns the sinks + alert delivery + the DLQ view +
//     requeue/discard AFFORDANCES. This slice only EMITS the events + owns the DLQ state + the human-only gate.

import type { TaskStatus, ErrorAttempt } from '@harness/task-queue/src/store.ts';
import { isTaskStatus } from '@harness/task-queue/src/store.ts';

export type { TaskStatus, ErrorAttempt };

// ── AF-018 (VERIFIED): Inngest imposes NO total execution-time limit on a function, but a single step has a
// per-step cap of <= 2h. The engine enforces this as a BUILD-TIME guard on a step's declared max duration — a
// step that would exceed the cap is rejected LOUDLY at registration/run, never silently dispatched to fail on
// the platform (#3). (feasibility-register.md F9.) ──────────────────────────────────────────────────────────
export const INNGEST_STEP_CAP_SECONDS = 2 * 3600;

// ── FR-5.JOB.007 (v1 = Inngest cloud-hosted). Self-hosted Inngest is OOS-028 (post-v1) — the engine REFUSES to
// construct against a self_hosted posture in v1 rather than pretend to provision it (#3). ────────────────────
export const HOSTING_MODES = ['cloud', 'self_hosted'] as const;
export type HostingMode = (typeof HOSTING_MODES)[number];

// ── OD-058 / NFR-INF.011: there is EXACTLY ONE retry/DLQ authority, and it is Inngest. This constant is the
// self-describing marker the provisioning posture reports. ──────────────────────────────────────────────────
export const RETRY_DLQ_AUTHORITY = 'inngest' as const;

// ── event_log event_type values this slice EMITS. ALL must be present in the baseline event_type enum
// (0001_baseline.sql) — index.ts's `check` non-drift guard proves it. A DLQ that is not being drained is a
// queue backing up -> the existing `queue_backup` alert type (no new enum value / no migration — this slice does
// not alter schema, §5). Run/terminal records reuse `task_completed` / `task_failed` (mirrors loops-heartbeat).
export const EVT_JOB_COMPLETED = 'task_completed';
export const EVT_JOB_FAILED = 'task_failed';
export const EVT_DLQ_HEARTBEAT = 'queue_backup';
/** the set of event_type constants this slice emits — the non-drift `check` gate iterates this. */
export const EMITTED_EVENT_TYPES = [EVT_JOB_COMPLETED, EVT_JOB_FAILED, EVT_DLQ_HEARTBEAT] as const;
export type EmittedEventType = (typeof EMITTED_EVENT_TYPES)[number];
export function isEmittedEventType(v: unknown): v is EmittedEventType {
  return typeof v === 'string' && (EMITTED_EVENT_TYPES as readonly string[]).includes(v);
}

// ── Retry / backoff policy (FR-5.JOB.003 — configurable exponential backoff PER JOB TYPE). ───────────────────
export interface RetryPolicy {
  /** total attempts a single STEP gets before the job dead-letters (initial + retries). >= 1. Consumes the C6
   *  `max retries-to-DLQ` ceiling (FR-6.RTL.001, ISSUE-058) — this slice honours it, it does not frame it. */
  maxAttempts: number;
  /** first backoff delay in seconds. */
  baseBackoffSeconds: number;
  /** exponential growth factor per retry (>= 1). */
  backoffFactor: number;
  /** ceiling on any single backoff delay (seconds) — backoff never grows unbounded. */
  maxBackoffSeconds: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 4, // 1 initial + 3 retries, then DLQ
  baseBackoffSeconds: 10,
  backoffFactor: 2,
  maxBackoffSeconds: 3600,
};

/** The backoff delay (seconds) before the `retryNumber`-th retry (1 = the first retry after the first failure).
 *  Exponential: base * factor^(retryNumber-1), capped at maxBackoffSeconds. Pure + deterministic so a test can
 *  assert the exact sequence (AC-5.JOB.003.1). */
export function computeBackoffSeconds(policy: RetryPolicy, retryNumber: number): number {
  if (retryNumber < 1) throw new Error(`inngest-dlq: retryNumber must be >= 1 (got ${retryNumber})`);
  const raw = policy.baseBackoffSeconds * Math.pow(policy.backoffFactor, retryNumber - 1);
  return Math.min(raw, policy.maxBackoffSeconds);
}

// ── Engine config the slice CONSUMES (Phase-2 registry §12 owns the keys; we do not define the registry). ────
export interface EngineConfig {
  /** v1 MUST be 'cloud' (FR-5.JOB.007); 'self_hosted' is OOS-028 and the engine refuses it. */
  hosting: HostingMode;
  /** the default per-step retry policy (used when a job type has no override). */
  defaultRetryPolicy: RetryPolicy;
  /** per-job-type retry/backoff overrides (FR-5.JOB.003 — configurable per job type). */
  perJobTypeRetryPolicy: Record<string, RetryPolicy>;
  /** AC-5.JOB.006.2 — a DLQ entry resident longer than this (seconds) trips the escalating liveness heartbeat. */
  dlqAgeThresholdSeconds: number;
  /** AF-018 — a step declaring a longer max duration than this is rejected loudly (defaults to the 2h cap). */
  stepCapSeconds: number;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  hosting: 'cloud',
  defaultRetryPolicy: DEFAULT_RETRY_POLICY,
  perJobTypeRetryPolicy: {},
  dlqAgeThresholdSeconds: 24 * 3600, // 24h default; config overrides it
  stepCapSeconds: INNGEST_STEP_CAP_SECONDS,
};

/** Resolve the retry policy for a job type: the per-type override, else the default. */
export function resolveRetryPolicy(config: EngineConfig, taskType: string): RetryPolicy {
  return config.perJobTypeRetryPolicy[taskType] ?? config.defaultRetryPolicy;
}

// ── The executed unit (mirrors @harness/task-graphs GraphStep — the step.run the engine drives). The
// idempotencyKey is CONSUMED from GRP's stepIdempotencyKey (ISSUE-049), never generated here. ────────────────
export interface StepSpec {
  step_id: string;
  /** the per-step idempotency key (GRP FR-5.GRP.003), consumed as the step-memo / dedup key. Same logical work
   *  -> same key across retries + re-deliveries, so a committed step is reused, never re-executed (#2). */
  idempotencyKey: string;
  /** the side effect — one Inngest `step.run`. Returns the step output (memoized on success). May throw to
   *  model a transient/hard failure (feeds the step-level retry loop). */
  run: () => Promise<unknown>;
  /** the step's declared max duration (seconds). If it exceeds config.stepCapSeconds the engine rejects it
   *  LOUDLY (AF-018). Omitted -> assumed within cap. */
  maxDurationSeconds?: number;
}

/** One job invocation = one Inngest function run for a task graph. */
export interface JobInvocation {
  /** the task_queue row id this run projects onto (OD-058). */
  taskId: string;
  /** the task type -> selects the Inngest step function + its retry policy. */
  taskType: string;
  /** the unique event id (FR-5.JOB.003) — a re-delivered event with the same id does NOT execute twice. */
  eventId: string;
  /** the ordered graph steps (from GRP), each an Inngest step.run. */
  steps: StepSpec[];
}

export type JobOutcome = 'completed' | 'dead_lettered' | 'deduplicated';

export interface JobRunResult {
  taskId: string;
  outcome: JobOutcome;
  /** total attempts across all steps (the value projected into task_queue.attempts). */
  attempts: number;
  /** per-step run-invocation counts (proves completed steps are NOT re-run on a sibling step's retry —
   *  AC-5.JOB.002.1). Keyed by step_id. */
  stepRunCounts: Record<string, number>;
  /** step_ids whose side effect was SKIPPED because a committed output was reused (dedup / resume). */
  reusedSteps: string[];
  /** the backoff delays (seconds) actually scheduled between retries, in order (proves exponential backoff —
   *  AC-5.JOB.003.1). Empty on a clean run. */
  scheduledBackoffs: number[];
  /** the full accumulated per-attempt error history (mirrors task_queue.error — never collapsed, #1). */
  errorHistory: ErrorAttempt[];
}

// ── OD-058 audit projection — the shape written into task_queue's Inngest-projection columns. ────────────────
export interface JobProjection {
  attempts: number; // task_queue.attempts
  next_retry_at: string | null; // task_queue.next_retry_at
  status: TaskStatus; // task_queue.status
  error: ErrorAttempt[]; // task_queue.error — full per-attempt history
}

/** The SINGLE-AUTHORITY projection port. Write-only MIRROR of Inngest's reported lifecycle — deliberately NO
 *  retry-scheduling method (that would be a second retry loop; OD-058 forbids it). */
export interface ProjectionSink {
  /** Mirror Inngest's reported lifecycle into task_queue. The engine is the ONLY caller. */
  sync(taskId: string, p: JobProjection): Promise<void>;
  read(taskId: string): Promise<JobProjection | null>;
}

// ── The event_log sink (schema.md §8). Row shape mirrors event_log so the live adapter INSERTs the identical
// row. event_type is enum-constrained; summary is non-empty. ────────────────────────────────────────────────
export interface EngineEvent {
  task_id: string | null; // the task_queue row, or null for a parent-level fan-out / DLQ-sweep event
  event_type: EmittedEventType;
  entity_ids: string[];
  summary: string; // plain-English; NEVER empty
  payload: Record<string, unknown>;
}
export interface EventSink {
  append(ev: EngineEvent): Promise<void>;
}

// ── DLQ (Inngest failed-function queue model; durable tail = the task_queue row). ────────────────────────────
export type DlqResolution = 'resident' | 'requeued' | 'discarded';
export interface DlqEntry {
  task_id: string;
  task_type: string;
  error_history: ErrorAttempt[]; // full history (#1) — never collapsed to a last-error
  final_reason: string; // the terminal failure reason recorded on DLQ entry
  entered_at: string; // iso — the heartbeat clock's origin
  resolution: DlqResolution; // 'resident' until a HUMAN requeues/discards
  resolved_by: string | null; // the human actor (never a system identity — #2)
  resolved_at: string | null; // iso
  last_heartbeat_at: string | null; // iso of the last escalation emitted (escalating, not one-shot)
}
export interface DlqStore {
  add(entry: DlqEntry): Promise<void>;
  get(taskId: string): Promise<DlqEntry | null>;
  /** resident (unresolved) entries only. */
  listResident(): Promise<DlqEntry[]>;
  markResolved(taskId: string, resolution: 'requeued' | 'discarded', by: string, now: number): Promise<void>;
  recordHeartbeat(taskId: string, now: number): Promise<void>;
}

// ── Exact rejection / gate messages, so a test asserts the same failure the live gate produces. ──────────────
export const ERR_SELF_HOSTED =
  'inngest-dlq: hosting=self_hosted is OOS-028 (post-v1) — v1 is Inngest cloud-hosted only (FR-5.JOB.007); refusing to provision (#3)';
export const ERR_STEP_CAP_EXCEEDED = (stepId: string, declared: number, cap: number) =>
  `inngest-dlq: step '${stepId}' declares maxDurationSeconds=${declared}s > the Inngest per-step cap ${cap}s (AF-018) — rejected loudly, never dispatched to fail on the platform (#3)`;
export const ERR_NO_FUNCTION = (taskType: string) =>
  `inngest-dlq: no registered Inngest step function for task type '${taskType}' — configuration error, refusing to run (#3)`;
export const ERR_SCHEDULE_RETRY_FORBIDDEN =
  'inngest-dlq: the task_queue path may NOT schedule a retry — Inngest is the single retry/DLQ authority (OD-058 / NFR-INF.011 / AC-5.JOB.004.1); task_queue is a read-only audit projection (#2)';
export const ERR_PROJECTION_HISTORY_SHRINK = (taskId: string, was: number, now: number) =>
  `inngest-dlq: projection sync for '${taskId}' would SHRINK the error history (${was} -> ${now}) — the per-attempt history is append-only, never lost (FR-5.QUE.006 / #1)`;
export const ERR_BAD_STATUS = (s: unknown) =>
  `inngest-dlq: refusing to project an undefined/unknown task_queue status '${String(s)}' (#3)`;
export const ERR_BAD_EVENT_TYPE = (t: unknown) =>
  `event_log: refusing to emit an event_type '${String(t)}' not in the emitted-set / baseline enum (invalid input value for enum event_type — #3)`;
export const ERR_EMPTY_SUMMARY =
  'event_log: summary is text NOT NULL and must be non-empty plain-English (AC-7.LOG.002.2 / #3)';
export const ERR_DLQ_HUMAN_REQUIRED =
  'inngest-dlq: DLQ recovery (requeue/discard) is a human-only action — an explicit human actor is required, never a system identity (FR-5.JOB.006 / #2)';
export const ERR_DLQ_NOT_RESIDENT = (taskId: string) =>
  `inngest-dlq: DLQ entry '${taskId}' is not resident (already requeued/discarded, or never dead-lettered) — nothing to recover`;

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// In-memory fakes — the reference models the live adapters must match 1:1. Deterministic: a logical `now`
// (epoch seconds) is supplied by the caller; no Date.now()/random (house discipline).
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────

function iso(now: number): string {
  return new Date(now * 1000).toISOString();
}

/** The single-authority projection fake. Mirror-only: sync() records the projection; there is NO retry
 *  scheduler. attemptScheduleRetry() is a forbidden test hook that PROVES the task_queue path can never issue a
 *  retry (AC-5.JOB.004.1 / AC-NFR-INF.011.1). */
export class InMemoryProjectionSink implements ProjectionSink {
  readonly rows = new Map<string, JobProjection>();
  /** every sync ever applied, in order — lets a test assert the projection tracked Inngest's lifecycle. */
  readonly history: { taskId: string; projection: JobProjection }[] = [];

  async sync(taskId: string, p: JobProjection): Promise<void> {
    if (!isTaskStatus(p.status)) throw new Error(ERR_BAD_STATUS(p.status)); // #3 — a defined status always persists
    const prev = this.rows.get(taskId);
    // #1: the append-only error history may never shrink across syncs (would lose a recorded attempt).
    if (prev && p.error.length < prev.error.length) {
      throw new Error(ERR_PROJECTION_HISTORY_SHRINK(taskId, prev.error.length, p.error.length));
    }
    const snapshot: JobProjection = { ...p, error: p.error.map((e) => ({ ...e })) };
    this.rows.set(taskId, snapshot);
    this.history.push({ taskId, projection: { ...snapshot, error: snapshot.error.map((e) => ({ ...e })) } });
  }

  async read(taskId: string): Promise<JobProjection | null> {
    const r = this.rows.get(taskId);
    return r ? { ...r, error: r.error.map((e) => ({ ...e })) } : null;
  }

  /** Forbidden path — there is NO retry scheduler on the projection. Calling it throws, proving OD-058. */
  attemptScheduleRetry(_taskId: string): never {
    throw new Error(ERR_SCHEDULE_RETRY_FORBIDDEN);
  }
}

/** The event_log sink fake — validates the enum + non-empty summary EXACTLY as the DDL would. */
export class InMemoryEventSink implements EventSink {
  readonly events: EngineEvent[] = [];
  async append(ev: EngineEvent): Promise<void> {
    if (!isEmittedEventType(ev.event_type)) throw new Error(ERR_BAD_EVENT_TYPE(ev.event_type));
    if (typeof ev.summary !== 'string' || ev.summary.trim().length === 0) throw new Error(ERR_EMPTY_SUMMARY);
    this.events.push({ ...ev, entity_ids: [...ev.entity_ids], payload: { ...ev.payload } });
  }
}

/** The DLQ fake — Inngest's failed-function queue model. No auto-re-execution path exists; requeue/discard
 *  require a human actor. */
export class InMemoryDlqStore implements DlqStore {
  readonly entries = new Map<string, DlqEntry>();

  async add(entry: DlqEntry): Promise<void> {
    // Idempotent add: a re-delivered dead-letter for an already-resident task does not overwrite/duplicate the
    // recorded history (#1). First entry wins.
    if (this.entries.has(entry.task_id)) return;
    this.entries.set(entry.task_id, {
      ...entry,
      error_history: entry.error_history.map((e) => ({ ...e })),
    });
  }

  async get(taskId: string): Promise<DlqEntry | null> {
    const e = this.entries.get(taskId);
    return e ? { ...e, error_history: e.error_history.map((x) => ({ ...x })) } : null;
  }

  async listResident(): Promise<DlqEntry[]> {
    return [...this.entries.values()]
      .filter((e) => e.resolution === 'resident')
      .map((e) => ({ ...e, error_history: e.error_history.map((x) => ({ ...x })) }));
  }

  async markResolved(
    taskId: string,
    resolution: 'requeued' | 'discarded',
    by: string,
    now: number,
  ): Promise<void> {
    const e = this.entries.get(taskId);
    if (!e || e.resolution !== 'resident') throw new Error(ERR_DLQ_NOT_RESIDENT(taskId));
    if (typeof by !== 'string' || by.trim().length === 0) throw new Error(ERR_DLQ_HUMAN_REQUIRED);
    e.resolution = resolution;
    e.resolved_by = by;
    e.resolved_at = iso(now);
  }

  async recordHeartbeat(taskId: string, now: number): Promise<void> {
    const e = this.entries.get(taskId);
    if (!e) throw new Error(ERR_DLQ_NOT_RESIDENT(taskId));
    e.last_heartbeat_at = iso(now);
  }
}

export { iso as isoSeconds };
