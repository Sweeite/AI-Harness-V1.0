// ISSUE-050 (C5 ENV) — the ContextEnvelope PORT + in-memory fake reference model (the house port+fake pattern,
// cf. app/task-queue/src/store.ts). Every durable side effect of the envelope lifecycle goes through the
// TaskHistoryStore port so the logic is unit-testable with NO live DB. InMemoryTaskHistoryStore is BOTH the
// test double AND the reference model the live pg adapter (supabase-store.ts) must match against the baseline
// DDL (app/silo/migrations/0001_baseline.sql, `task_history`).
//
// The three non-negotiables, mapped:
//   FR-5.ENV.001 (#1) the envelope carries the FULL task state (all §FR-5.ENV.001 fields) through the whole
//                     chain — no field is dropped as the task advances.
//   FR-5.ENV.002 (#1) every step reads the full envelope and APPENDS its output to previous_outputs — no step
//                     starts cold; prior outputs are never overwritten, only appended.
//   FR-5.ENV.003 (#1) above compression_threshold_tokens the working envelope's older outputs are SUMMARISED
//                     for the next step's prompt, but the full uncompressed original is written to the durable
//                     task_history store FIRST — economy, never knowledge loss (OD-055). A summary is NEVER
//                     produced without the original having been durably retained (fail-closed, #1/#3).
//
// task_history baseline DDL shapes the fake exactly (so an offline pass implies the live DDL would accept it):
//   task_history(id uuid pk, task_id uuid not null →task_queue(id) on delete cascade, step_index int not null,
//                full_output jsonb not null, created_at timestamptz default now(), UNIQUE(task_id, step_index))

// ── §FR-5.ENV.001 — the context-envelope structure. Every listed field is present; the envelope travels with
// the task through its entire chain (cites component-05-harness FR-5.ENV.001, L2593–2603). ──────────────────
export interface ContextEnvelope {
  /** the owning task_queue.id — the envelope is per-task. */
  task_id: string;
  /** the user's original request text, verbatim — never mutated once set. */
  original_request: string;
  /** extracted entities the task operates over. */
  entities: unknown[];
  /** memory the read flow retrieved for this task (populated by ISSUE-053; carried here). */
  memory_retrieved: unknown[];
  /** the ordered execution plan (populated by ISSUE-054; carried here). */
  execution_plan: unknown[];
  /** the 0-based index of the step currently executing. Reflects the task's live position (AC-5.ENV.001.1). */
  current_step: number;
  /** every completed step's output, in order. Appended to per step (FR-5.ENV.002); never overwritten. When a
   * long chain is compressed, OLDER entries here are replaced by a summary marker for the WORKING envelope,
   * but the full originals are retained in task_history (FR-5.ENV.003 / #1). */
  previous_outputs: StepOutput[];
  /** free-form context shared across steps (accumulated key/value working state). */
  shared_context: Record<string, unknown>;
}

/** One step's recorded output as carried in the working envelope's previous_outputs. */
export interface StepOutput {
  step_index: number;
  /** the step's output payload. For a compressed (summarised) older step this is the SUMMARY; the full
   * original lives in task_history. `compressed` marks which is which so no consumer mistakes a summary for
   * the original (#3 — never silently present lossy data as complete). */
  output: unknown;
  /** true ⇒ `output` is a lossy summary; the uncompressed original is retrievable from task_history by
   * (task_id, step_index). false/absent ⇒ `output` is the full original. */
  compressed?: boolean;
}

/** The fields required to open a fresh envelope. Server owns previous_outputs/current_step (start empty/0). */
export interface NewEnvelope {
  task_id: string;
  original_request: string;
  entities?: unknown[];
  memory_retrieved?: unknown[];
  execution_plan?: unknown[];
  shared_context?: Record<string, unknown>;
}

/** The exact ordered field set FR-5.ENV.001 mandates — a single source the completeness check asserts against
 * (so the fake cannot drift from the FR silently). */
export const ENVELOPE_FIELDS = [
  'task_id',
  'original_request',
  'entities',
  'memory_retrieved',
  'execution_plan',
  'current_step',
  'previous_outputs',
  'shared_context',
] as const;

// ── config knob this slice CONSUMES (registry §H owns the key; we do not define it). ────────────────────────
export interface EnvelopeConfig {
  /** compression_threshold_tokens — a task chain is compressed once its working previous_outputs exceed this
   * estimated token count (LIVE, int ≥ 1000, default 8000). NFR-PERF.008. */
  compressionThresholdTokens: number;
}
export const CONFIG_MIN_THRESHOLD = 1000; // registry constraint: int ≥ 1000
export const DEFAULT_ENVELOPE_CONFIG: EnvelopeConfig = {
  compressionThresholdTokens: 8000, // registry default
};

export const ERR_BAD_THRESHOLD =
  `context-envelope: compression_threshold_tokens must be an integer ≥ ${CONFIG_MIN_THRESHOLD} (NFR-PERF.008 / registry §H)`;
export const ERR_NO_TASK_ID =
  'context-envelope: an envelope requires a non-empty task_id (FR-5.ENV.001)';
export const ERR_SUMMARISE_WITHOUT_RETAIN =
  'context-envelope: refusing to summarise a step whose original was not durably retained first (OD-055 / #1)';

// ── a rough token estimator. Deterministic (no model call) — ~4 chars/token over the JSON encoding. The
// threshold is an economy knob; the exact estimate is not load-bearing, only that it grows with chain size. ─
export function estimateTokens(outputs: StepOutput[]): number {
  let chars = 0;
  for (const o of outputs) chars += JSON.stringify(o.output ?? null).length;
  return Math.ceil(chars / 4);
}

/** Produce the lossy summary an older step contributes to the WORKING envelope. Deterministic + offline (the
 * real summariser is a model call gated by AF-114; here it is a stable stand-in so the discipline — original
 * retained, marker set, threshold honoured — is provable without a live model). */
export function summariseOutput(original: unknown): unknown {
  const s = JSON.stringify(original ?? null);
  const head = s.length > 120 ? s.slice(0, 120) + '…' : s;
  return { __summary__: true, chars: s.length, preview: head };
}

// ── the durable originals store PORT (task_history). Async-shaped for the DB adapter; the fake is sync-backed.
// AF-115: this C5-owned store is the AUTHORITATIVE originals tail (engine step-state is a cache only) — it must
// outlive the longest chain + audit window. There is deliberately NO delete method: originals are never
// dropped (#1). ─────────────────────────────────────────────────────────────────────────────────────────────
export interface TaskHistoryStore {
  /** Retain one step's FULL uncompressed output. Idempotent on (task_id, step_index) — the UNIQUE constraint
   * in the DDL makes a re-retain a no-op, never an overwrite with different data (#1). */
  retain(taskId: string, stepIndex: number, fullOutput: unknown): Promise<void>;
  /** Read back one retained original (resume + audit). null if never retained. NOTE: `null` is ALSO a valid
   * retained value (a no-op/delete/empty step) — a null return is therefore ambiguous. Use `has()` to test
   * existence; never treat a null value as proof of absence (logic-sweep fix, store.ts:252 / #1). */
  getOriginal(taskId: string, stepIndex: number): Promise<unknown | null>;
  /** True iff a row exists for (task_id, step_index) — the DDL row-exists check, independent of its value.
   * Distinguishes "retained null" from "never retained" so compression never misreads a valid null original
   * as absence (logic-sweep fix). */
  has(taskId: string, stepIndex: number): Promise<boolean>;
  /** Read back ALL retained originals for a task, ordered by step_index (resume reconstructs the full chain
   * from these, NOT from the compressed working envelope — FR-5.GRP.004 read path). */
  listOriginals(taskId: string): Promise<Array<{ step_index: number; full_output: unknown }>>;
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// In-memory fake — the reference model. Mirrors the task_history DDL EXACTLY: a UNIQUE(task_id, step_index)
// keyed map, jsonb round-trip via structuredClone, first-write-wins on conflict (the DDL's `do nothing`). A
// test against this fake proves the contract the live silo must uphold.
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export class InMemoryTaskHistoryStore implements TaskHistoryStore {
  /** key = `${task_id}::${step_index}` — the UNIQUE(task_id, step_index) constraint made structural. */
  readonly rows = new Map<string, { task_id: string; step_index: number; full_output: unknown }>();

  private key(taskId: string, stepIndex: number): string {
    return `${taskId}::${stepIndex}`;
  }

  async retain(taskId: string, stepIndex: number, fullOutput: unknown): Promise<void> {
    if (typeof taskId !== 'string' || taskId.length === 0) throw new Error(ERR_NO_TASK_ID);
    if (!Number.isInteger(stepIndex) || stepIndex < 0) {
      throw new Error('context-envelope: step_index must be a non-negative integer (task_history DDL)');
    }
    const k = this.key(taskId, stepIndex);
    // UNIQUE(task_id, step_index): `on conflict do nothing` — first write wins, never a silent overwrite (#1).
    if (this.rows.has(k)) return;
    // jsonb column: deep-copy so a later mutation of the caller's object cannot retro-alter the retained
    // original (the DB stores a value, not a reference).
    this.rows.set(k, { task_id: taskId, step_index: stepIndex, full_output: structuredClone(fullOutput) });
  }

  async getOriginal(taskId: string, stepIndex: number): Promise<unknown | null> {
    const r = this.rows.get(this.key(taskId, stepIndex));
    return r ? structuredClone(r.full_output) : null;
  }

  async has(taskId: string, stepIndex: number): Promise<boolean> {
    // Row-exists check — independent of the stored value, so a retained `null` reads as present (not absent).
    return this.rows.has(this.key(taskId, stepIndex));
  }

  async listOriginals(taskId: string): Promise<Array<{ step_index: number; full_output: unknown }>> {
    return [...this.rows.values()]
      .filter((r) => r.task_id === taskId)
      .sort((a, b) => a.step_index - b.step_index)
      .map((r) => ({ step_index: r.step_index, full_output: structuredClone(r.full_output) }));
  }
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// The context-envelope manager — the per-task stateful container carried through the chain (runtime home is
// Inngest step-state; the durable originals tail is the injected TaskHistoryStore). Pure logic, deterministic,
// no Date.now()/random (house discipline).
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export class ContextEnvelopeManager {
  constructor(
    private readonly history: TaskHistoryStore,
    private readonly config: EnvelopeConfig = DEFAULT_ENVELOPE_CONFIG,
  ) {
    // Fail-closed on a bad config: an out-of-range threshold is rejected, never silently clamped (#3).
    if (!Number.isInteger(config.compressionThresholdTokens) || config.compressionThresholdTokens < CONFIG_MIN_THRESHOLD) {
      throw new Error(ERR_BAD_THRESHOLD);
    }
  }

  /** FR-5.ENV.001: open a fresh, field-complete envelope for a task. */
  open(seed: NewEnvelope): ContextEnvelope {
    if (typeof seed.task_id !== 'string' || seed.task_id.length === 0) throw new Error(ERR_NO_TASK_ID);
    return {
      task_id: seed.task_id,
      original_request: seed.original_request,
      entities: seed.entities ? [...seed.entities] : [],
      memory_retrieved: seed.memory_retrieved ? [...seed.memory_retrieved] : [],
      execution_plan: seed.execution_plan ? [...seed.execution_plan] : [],
      current_step: 0,
      previous_outputs: [],
      shared_context: seed.shared_context ? { ...seed.shared_context } : {},
    };
  }

  /** FR-5.ENV.001 AC-5.ENV.001.1: assert every mandated field is present. Returns the missing field names (an
   * empty array ⇒ complete). Never throws — the caller decides; used by the completeness gate + tests. */
  missingFields(env: ContextEnvelope): string[] {
    const missing: string[] = [];
    for (const f of ENVELOPE_FIELDS) {
      if (!(f in (env as unknown as Record<string, unknown>))) missing.push(f);
    }
    return missing;
  }

  /**
   * FR-5.ENV.002 (no cold start) + FR-5.ENV.003 (compression, lossless source).
   * Advance one step: the step read the FULL envelope (guaranteed by handing it the whole object), produced
   * `output`; we (1) DURABLY RETAIN the full uncompressed output in task_history FIRST, then (2) append it to
   * the working envelope's previous_outputs, then (3) if the working chain now exceeds the token threshold,
   * summarise the OLDER outputs in the working envelope (retaining each original first) — never the just-added
   * newest one. current_step advances. Returns the updated envelope to pass forward.
   *
   * Ordering is load-bearing (#1): retain-before-summarise means a summary can never exist for a step whose
   * original was not durably kept. If retain() throws, we fail closed — no append, no summary, no advance.
   */
  async appendStepOutput(env: ContextEnvelope, output: unknown): Promise<ContextEnvelope> {
    const stepIndex = env.previous_outputs.length; // 0-based; the step that just ran
    // (1) retain the full original FIRST — economy is only allowed once the original is safe (OD-055 / #1).
    await this.history.retain(env.task_id, stepIndex, output);
    // (2) append the full output to the working envelope (no cold start: prior outputs remain).
    const next: ContextEnvelope = {
      ...env,
      previous_outputs: [...env.previous_outputs, { step_index: stepIndex, output, compressed: false }],
      current_step: stepIndex + 1,
    };
    // (3) compress older outputs if the working chain is over threshold (never the newest, just-added one).
    await this.compressIfOverThreshold(next);
    return next;
  }

  /**
   * FR-5.ENV.003 / NFR-PERF.008 / AC-NFR-PERF.008.1. If the working previous_outputs exceed
   * compression_threshold_tokens, replace the OLDER (all but the most recent) full outputs with summaries for
   * the next step's prompt — after retaining each original durably. Mutates `env.previous_outputs` in place.
   * Idempotent: an already-`compressed` entry is skipped. The newest entry is always kept full (the next step
   * most likely needs it verbatim). Returns true if any compression happened.
   */
  async compressIfOverThreshold(env: ContextEnvelope): Promise<boolean> {
    if (estimateTokens(env.previous_outputs) <= this.config.compressionThresholdTokens) return false;
    let changed = false;
    // Compress all but the last entry (keep the most recent full). Walk oldest→second-newest.
    for (let i = 0; i < env.previous_outputs.length - 1; i++) {
      const entry = env.previous_outputs[i]!;
      if (entry.compressed) continue; // already summarised — its original is already retained.
      // #1 guard: the original MUST be durably retained before we drop it to a summary. It was retained in
      // appendStepOutput, but we re-assert here (defence in depth — compression is never lossy at source).
      // logic-sweep fix (store.ts:252): gate on ROW EXISTENCE, not on getOriginal(...) === null. `null` is a
      // valid retained output (a no-op/delete/empty step), so a null VALUE is not proof of absence — using it
      // as one crashed the whole chain on a legitimately-retained null older step (#1 recoverable, misread as
      // lost). has() mirrors the DDL row-exists check and distinguishes "retained null" from "never retained".
      if (!(await this.history.has(env.task_id, entry.step_index))) {
        // fail closed: never summarise an un-retained original (#1/#3). Retain it now, THEN summarise.
        await this.history.retain(env.task_id, entry.step_index, entry.output);
        if (!(await this.history.has(env.task_id, entry.step_index))) throw new Error(ERR_SUMMARISE_WITHOUT_RETAIN);
      }
      env.previous_outputs[i] = {
        step_index: entry.step_index,
        output: summariseOutput(entry.output),
        compressed: true,
      };
      changed = true;
    }
    return changed;
  }

  /**
   * FR-5.ENV.003 durability + FR-5.GRP.004 read path (AC-5.ENV.003.1/.2). Reconstruct the FULL uncompressed
   * chain for a task from the durable originals store — NOT from the (possibly compressed) working envelope.
   * This is what resume + audit read. Every step's full_output is returned, compressed-in-working or not.
   */
  async reconstructOriginals(taskId: string): Promise<Array<{ step_index: number; full_output: unknown }>> {
    return this.history.listOriginals(taskId);
  }
}
