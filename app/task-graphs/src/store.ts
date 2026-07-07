// ISSUE-049 (C5 GRP) — the TaskGraph store PORT + in-memory fake reference model + the graph executor /
// idempotency-key derivation / resume engine (the house port+fake pattern, cf. app/task-queue/src/store.ts).
// Every live side effect goes through a port so the logic is unit-testable with NO live DB. The in-memory
// fakes are BOTH the test double AND the reference model the live pg adapter (supabase-store.ts) must match
// against the baseline DDL (app/silo/migrations/0001_baseline.sql: task_graph_versions, task_history).
//
// Invariants enforced in the fakes EXACTLY as the DB DDL + harness gate would (so a test against a fake proves
// the contract the live silo upholds) — mapped to the three non-negotiables and the §4 ACs:
//   FR-5.GRP.001 (#3) each task type has a DEFINED graph; the executor runs steps in dependency order and
//                     never ad-hoc improvises (AC-5.GRP.001.1). A type with NO registered graph FAILS LOUDLY
//                     with a recorded error at creation/dequeue — never left silently pending (AC-5.GRP.001.2).
//   FR-5.GRP.002 (#1) task_graph_versions is APPEND-ONLY by version: an edit inserts a NEW version row with a
//                     non-empty change_reason; the prior version is retained; a save without a reason is
//                     rejected (AC-5.GRP.002.1). Mirrors the C4 prompt-version discipline / change-control.
//   FR-5.GRP.003 (#2) stable, collision-resistant idempotency key per task AND per step, derived from
//                     task_id + step_id + payload-content hash (ADR-004 §4 ledger pattern). The key is
//                     committed NO LATER THAN the side effect so a crash between side-effect and completion
//                     cannot double-fire (AC-5.GRP.003.1/.2/.3). ⚠️ AF-112 (crash-window ordering + catch-up
//                     dedup at scale) is LOAD/EVAL — the offline crash-window unit + collision property are
//                     proven here; the at-scale posture is owed to a live spike.
//   FR-5.GRP.004 (#1) resume-from-first-incomplete-step: a retry restarts at the first incomplete step and
//                     REUSES the preserved outputs of completed steps rather than re-executing them
//                     (AC-5.GRP.004.1). Reads the durable originals (task_history — ISSUE-050 owns the store).
//                     ⚠️ AF-115 (originals retention outlives longest chain + audit window) is DOCS/SPIKE —
//                     the resume-reads-originals contract is proven offline; the retention posture is owed.
//   NFR-PERF.007 (#3) the chain_depth_limit ceiling on a graph is a VISIBLE reject (or trim-with-logged-
//                     outcome), NEVER a silent truncation (AC-NFR-PERF.007.1). Enforcement point shared with
//                     ISSUE-064 (plan-build, FR-8.PLAN.003) — this slice honours it as a graph property.

// ── The step of a task graph. `steps` is an ordered jsonb array; each step names its dependencies (by step
// id) and a failure mode. Dependency order is derived from `depends_on` (a topological order over the DAG),
// NOT merely array position — array position is the deterministic tiebreak (schema.md §6 "ordered; per-step
// deps + failure mode"). ────────────────────────────────────────────────────────────────────────────────
export const STEP_KINDS = [
  'tool_call',
  'memory_read',
  'ai_call',
  'tool_write',
  'memory_write',
] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export const FAILURE_MODES = ['retry', 'halt', 'skip'] as const;
export type FailureMode = (typeof FAILURE_MODES)[number];

export interface GraphStep {
  /** stable within a graph version; used in the idempotency-key derivation and dependency edges. */
  step_id: string;
  kind: StepKind;
  /** step_ids this step depends on. Must all appear earlier in the resolved dependency order. */
  depends_on: string[];
  failure_mode: FailureMode;
  /** the step-local payload that (with task_id + step_id) content-hashes into the idempotency key. */
  payload?: unknown;
}

// ── §6 task_graph_versions row — the exact baseline column set (0001_baseline.sql L419-429). ──────────────
export interface TaskGraphVersionRow {
  id: string;
  task_type_name: string;
  version: number; // int, default 1; unique(task_type_name, version)
  steps: GraphStep[]; // jsonb; ordered, per-step deps + failure mode
  change_reason: string; // NOT NULL, and enforced non-empty here (AC-5.GRP.002.1)
  previous_version_id: string | null; // self-reference to the retained prior version
  created_at: string;
  created_by: string | null; // → profiles(id)
}

/** The fields a caller supplies when registering the FIRST graph version for a type, or editing an existing
 * one. Server-owned fields (id/version/previous_version_id/created_at) are derived, never caller-set. */
export interface NewGraphVersion {
  task_type_name: string;
  steps: GraphStep[];
  change_reason: string;
  created_by?: string | null;
}

// ── §6 task_history row (0001_baseline.sql L432-439) — read-only here (ISSUE-050 owns the store). This slice
// READS the durable originals on resume; it never owns/writes them in production (the fake's put() exists only
// to seed the reference model for a resume test). ────────────────────────────────────────────────────────
export interface TaskHistoryRow {
  task_id: string;
  step_index: number; // int; unique(task_id, step_index)
  full_output: unknown; // jsonb; uncompressed original (resume + audit)
}

// ── config the slice CONSUMES (Phase-2 registry §12 owns the key; we do not define it — proposed as a delta
// only if absent). chain_depth_limit default 6, int ≥ 1, LIVE (schema.md / NFR-PERF.007). ─────────────────
export interface GraphConfig {
  chainDepthLimit: number; // default 6; a graph with more resolved steps is rejected/trimmed (never silent).
  /** reject (fail-closed) vs trim-with-logged-outcome when a graph exceeds the ceiling. Both are VISIBLE
   * outcomes (#3); the default is reject — a graph-build over-limit is a config error, not a silent cut. */
  overLimitPolicy: 'reject' | 'trim';
}
export const DEFAULT_GRAPH_CONFIG: GraphConfig = {
  chainDepthLimit: 6, // NFR-PERF.007 default
  overLimitPolicy: 'reject',
};

// ── exact rejection / outcome messages, so a test asserts the same failure the live gate produces. ────────
export const ERR_NO_GRAPH = (taskType: string) =>
  `task_graph: no registered graph for task type '${taskType}' — configuration error, refusing to run ad-hoc (AC-5.GRP.001.2 / #3)`;
export const ERR_EMPTY_CHANGE_REASON =
  'task_graph: change_reason is mandatory and must be non-empty — a graph edit without a reason is rejected (AC-5.GRP.002.1)';
export const ERR_DUP_STEP_ID = (stepId: string) =>
  `task_graph: duplicate step_id '${stepId}' — step ids must be unique within a graph version (FR-5.GRP.003 key stability)`;
export const ERR_UNKNOWN_DEP = (stepId: string, dep: string) =>
  `task_graph: step '${stepId}' depends on unknown step '${dep}' (FR-5.GRP.001 dependency order)`;
export const ERR_CYCLE = (cycle: string[]) =>
  `task_graph: dependency cycle detected (${cycle.join(' → ')}) — a task graph must be a DAG (FR-5.GRP.001)`;
export const ERR_OVER_LIMIT = (depth: number, limit: number) =>
  `task_graph: graph resolves to ${depth} steps > chain_depth_limit ${limit} — rejected at build, never silently truncated (AC-NFR-PERF.007.1 / #3)`;
export const ERR_BAD_STEP = (msg: string) => `task_graph: invalid step definition — ${msg} (FR-5.GRP.001)`;

// One recorded outcome of a chain-depth over-limit event (a VISIBLE reject or trim, never a silent cut).
export interface ChainDepthOutcome {
  task_type_name: string;
  resolved_depth: number;
  limit: number;
  outcome: 'rejected' | 'trimmed';
  detail: string;
}

// ── the config-error sink (a graph-less type / an over-limit graph is RECORDED, never silently swallowed).
// Mirrors an event_log-style append (ISSUE-011); a no-op/collecting mock in offline tests. ────────────────
export interface ConfigErrorEvent {
  task_id: string | null;
  task_type_name: string;
  kind: 'no_graph' | 'chain_depth_over_limit';
  summary: string; // plain-English, never empty
  payload: Record<string, unknown>;
}
export interface ConfigErrorSink {
  record(ev: ConfigErrorEvent): Promise<void>;
}

// ── event_type mapping + admitted-set guard (fix for the missing-enum-value defect) ───────────────────────
// The live SupabaseConfigErrorSink INSERTs onto event_log with an `event_type` that MUST be a member of the
// `event_type` enum (0001_baseline.sql L60 + the 0007 additive expansion). The two values this slice writes —
// `task_graph_missing` and `task_graph_chain_depth_over_limit` — are NOT in the baseline enum yet; they are
// documented in results/proposed-shared-spec.md §5 as additive members for the orchestrator's migration 0011
// (`alter type event_type add value if not exists ...`). Until that migration lands, a live INSERT of either
// value throws `invalid input value for enum event_type` and the loud config-error audit write (required by
// AC-5.GRP.001.2 / AC-NFR-PERF.007.1 — a #3 signal) is LOST.
//
// This map is the SINGLE source of truth for kind→event_type, shared by the live adapter and the fakes. The
// ADMITTED set below is the offline mirror of the live enum FOR THE VALUES THIS SLICE WRITES: a fake that
// asserts membership here fails offline if a non-admitted event_type is ever written, so the drift that hid
// behind the never-instantiated live adapter cannot pass a green test suite again.
export const CONFIG_ERROR_EVENT_TYPE: Record<ConfigErrorEvent['kind'], string> = {
  no_graph: 'task_graph_missing',
  chain_depth_over_limit: 'task_graph_chain_depth_over_limit',
};

/** The event_type values this slice is permitted to write — the offline mirror of the live enum (post-0011).
 * A fake/adapter that maps a `kind` to a value NOT in this set is a drift that MUST fail loudly (#3). */
export const ADMITTED_EVENT_TYPES: ReadonlySet<string> = new Set(Object.values(CONFIG_ERROR_EVENT_TYPE));

/** Resolve a config-error `kind` to its event_type, asserting the value is admitted. The live adapter and the
 * enum-checking fake both call this, so an unmapped/unadmitted kind can never silently reach a live INSERT. */
export function eventTypeForKind(kind: ConfigErrorEvent['kind']): string {
  const eventType = CONFIG_ERROR_EVENT_TYPE[kind];
  if (!eventType || !ADMITTED_EVENT_TYPES.has(eventType)) {
    throw new Error(
      `config-error sink: event_type '${String(eventType)}' for kind '${kind}' is not an admitted event_type ` +
        `— it must be an enum member (0001_baseline L60 + migration 0011 additive); refusing to write an ` +
        `event_type the live enum would reject (AC-5.GRP.001.2 / #3)`,
    );
  }
  return eventType;
}

/** An enum-checking ConfigErrorSink fake — mirrors the live enum constraint OFFLINE. It collects recorded
 * events like a plain mock, but RESOLVES + VALIDATES the event_type through eventTypeForKind() exactly as the
 * live adapter does, so a `kind` whose event_type is not an admitted enum member throws HERE (offline), rather
 * than only on a live INSERT against the never-instantiated adapter. This is the durable regression guard for
 * the missing-enum-value defect. */
export class EnumCheckingConfigErrorSink implements ConfigErrorSink {
  readonly events: ConfigErrorEvent[] = [];
  /** the event_type each recorded event resolved to (for assertions). */
  readonly eventTypes: string[] = [];
  async record(ev: ConfigErrorEvent): Promise<void> {
    this.eventTypes.push(eventTypeForKind(ev.kind)); // throws if the event_type is not an admitted enum member
    this.events.push(ev);
  }
}

// ── FR-5.GRP.003 — idempotency-key derivation. Stable + collision-resistant: a deterministic hash over
// (task_id, step_id, canonical(payload)). Same inputs → same key (dedup holds, #2); genuinely-distinct side
// effects → distinct keys (no false-duplicate suppression, #1) (AC-5.GRP.003.3). No Date.now()/random — the
// key is a pure function of its inputs so it is identical across the crash-window retry (AC-5.GRP.003.2). ──

/** Canonical JSON: object keys sorted recursively so {a,b} and {b,a} hash identically (a payload's key order
 * is not a semantic difference). Arrays keep order (order IS semantic). undefined is normalised out. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}
function sortValue(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v === undefined ? null : v;
  if (Array.isArray(v)) return v.map(sortValue);
  const obj = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) out[k] = sortValue(obj[k]);
  return out;
}

/** FNV-1a 64-bit over the UTF-8 bytes of the domain-separated input, hex-encoded. Deterministic, dependency-
 * free, and collision-resistant enough for idempotency-key derivation (the field's authority is stability +
 * distinctness, not cryptographic strength). Domain separators (\x1f unit separators) prevent boundary
 * collisions between distinct (task_id,step_id) pairs whose concatenation would otherwise coincide. */
export function fnv1a64Hex(input: string): string {
  // 64-bit FNV-1a via BigInt (deterministic across platforms; no Math.random / Date).
  const FNV_OFFSET = 0xcbf29ce484222325n;
  const FNV_PRIME = 0x100000001b3n;
  const MASK = 0xffffffffffffffffn;
  let hash = FNV_OFFSET;
  const bytes = new TextEncoder().encode(input);
  for (const b of bytes) {
    hash ^= BigInt(b);
    hash = (hash * FNV_PRIME) & MASK;
  }
  return hash.toString(16).padStart(16, '0');
}

/** The step idempotency key (AC-5.GRP.003.1/.3). Domain-separated with \x1f so ('a','bc') and ('ab','c') never
 * collide. `task-step:` prefix disambiguates it from the task-level key namespace. */
export function stepIdempotencyKey(taskId: string, stepId: string, payload: unknown): string {
  const material = `task-step:\x1f${taskId}\x1f${stepId}\x1f${canonicalJson(payload)}`;
  return `tsk_${fnv1a64Hex(material)}`;
}

/** The task-level idempotency key (AC-5.GRP.003.1) — stable over the task id + its ordered step-id set. */
export function taskIdempotencyKey(taskId: string, stepIds: readonly string[]): string {
  const material = `task:\x1f${taskId}\x1f${stepIds.join('\x1e')}`;
  return `tsk_${fnv1a64Hex(material)}`;
}

// ── dependency-order resolution (AC-5.GRP.001.1). Kahn's algorithm → a stable topological order (ties broken
// by the step's array position, so the order is deterministic). Rejects unknown deps, dup ids, and cycles. ──
export function resolveDependencyOrder(steps: readonly GraphStep[]): GraphStep[] {
  const byId = new Map<string, GraphStep>();
  const position = new Map<string, number>();
  steps.forEach((s, i) => {
    if (byId.has(s.step_id)) throw new Error(ERR_DUP_STEP_ID(s.step_id));
    byId.set(s.step_id, s);
    position.set(s.step_id, i);
  });
  // validate deps exist
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const s of steps) {
    indegree.set(s.step_id, s.depends_on.length);
    for (const dep of s.depends_on) {
      if (!byId.has(dep)) throw new Error(ERR_UNKNOWN_DEP(s.step_id, dep));
      (dependents.get(dep) ?? dependents.set(dep, []).get(dep)!).push(s.step_id);
    }
  }
  // Kahn, popping the lowest array-position ready node for determinism.
  const ready = steps.filter((s) => (indegree.get(s.step_id) ?? 0) === 0).map((s) => s.step_id);
  ready.sort((a, b) => (position.get(a)! - position.get(b)!));
  const order: GraphStep[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(byId.get(id)!);
    for (const dep of dependents.get(id) ?? []) {
      const d = (indegree.get(dep) ?? 0) - 1;
      indegree.set(dep, d);
      if (d === 0) {
        // insert keeping the ready list ordered by array position (deterministic tiebreak)
        const pos = position.get(dep)!;
        let i = 0;
        while (i < ready.length && position.get(ready[i]!)! < pos) i++;
        ready.splice(i, 0, dep);
      }
    }
  }
  if (order.length !== steps.length) {
    // the residual (indegree > 0) nodes form the cycle
    const stuck = steps.filter((s) => !order.includes(s)).map((s) => s.step_id);
    throw new Error(ERR_CYCLE(stuck));
  }
  return order;
}

// ── validate a step array before it is ever versioned (FR-5.GRP.001). Structural gate: kinds, failure modes,
// non-empty ids. Dependency validity + acyclicity is proven by resolveDependencyOrder. ────────────────────
export function validateSteps(steps: readonly GraphStep[]): void {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error(ERR_BAD_STEP('a graph must have at least one step'));
  }
  for (const s of steps) {
    if (typeof s.step_id !== 'string' || s.step_id.length === 0) {
      throw new Error(ERR_BAD_STEP('every step needs a non-empty step_id'));
    }
    if (!(STEP_KINDS as readonly string[]).includes(s.kind)) {
      throw new Error(ERR_BAD_STEP(`unknown step kind '${String(s.kind)}' on '${s.step_id}'`));
    }
    if (!(FAILURE_MODES as readonly string[]).includes(s.failure_mode)) {
      throw new Error(ERR_BAD_STEP(`unknown failure_mode '${String(s.failure_mode)}' on '${s.step_id}'`));
    }
    if (!Array.isArray(s.depends_on)) {
      throw new Error(ERR_BAD_STEP(`depends_on must be an array on '${s.step_id}'`));
    }
  }
  resolveDependencyOrder(steps); // throws on unknown dep / dup id / cycle
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────
// The graph-versions store PORT (append-only, versioned). ────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────────────────────────────────────────────
export interface GraphStore {
  /** Register a new graph version for a type. If a graph already exists, this is an EDIT: a NEW version row is
   * inserted (version = prior + 1, previous_version_id = prior.id), the prior row retained. change_reason
   * must be non-empty (AC-5.GRP.002.1). Returns the newly-created current version. */
  putVersion(v: NewGraphVersion, now: number): Promise<TaskGraphVersionRow>;
  /** The current (highest-version) graph for a type, or null if none is registered. */
  getCurrent(taskTypeName: string): Promise<TaskGraphVersionRow | null>;
  /** Every retained version for a type, oldest first (proves prior versions are never overwritten). */
  listVersions(taskTypeName: string): Promise<TaskGraphVersionRow[]>;
}

// ── the durable originals store this slice READS on resume (ISSUE-050 owns it in production). ─────────────
export interface HistoryStore {
  /** Read the preserved output of a completed step (by task + step index), or null if not yet recorded. */
  getOutput(taskId: string, stepIndex: number): Promise<TaskHistoryRow | null>;
  /** All recorded step outputs for a task, ordered by step_index. */
  listOutputs(taskId: string): Promise<TaskHistoryRow[]>;
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────
// In-memory GraphStore fake — the reference model. Append-only by version; deterministic (caller supplies a
// logical `now`; ids are sequential — no Date.now()/random). Mirrors the baseline unique(task_type_name,
// version) and previous_version_id self-reference so a test against it proves the live DDL contract. ──────
// ───────────────────────────────────────────────────────────────────────────────────────────────────────
export class InMemoryGraphStore implements GraphStore {
  private seq = 0;
  readonly rows: TaskGraphVersionRow[] = [];

  private nextId(): string {
    this.seq += 1;
    return `graph-${String(this.seq).padStart(4, '0')}`;
  }
  private iso(now: number): string {
    return new Date(now * 1000).toISOString();
  }

  async putVersion(v: NewGraphVersion, now: number): Promise<TaskGraphVersionRow> {
    // AC-5.GRP.002.1 (#1): change_reason is mandatory and non-empty — reject a save without one BEFORE any
    // row is created, so a bad edit cannot even partially land.
    if (typeof v.change_reason !== 'string' || v.change_reason.trim().length === 0) {
      throw new Error(ERR_EMPTY_CHANGE_REASON);
    }
    validateSteps(v.steps); // FR-5.GRP.001 — a graph is only ever versioned if it is a valid DAG.
    // logic-sweep fix (task-graphs store.ts:354): read the prior version SYNCHRONOUSLY over this.rows with
    // NO await between the read and the this.rows.push below. The old `await this.getCurrent(...)` yielded to
    // the microtask queue (getCurrent is async but has no internal await), so two concurrent putVersion() calls
    // for the same type both observed the same prior and each appended version = prior+1 → a DUPLICATE version,
    // violating the unique(task_type_name, version) invariant this fake claims to mirror. The live DB path
    // (supabase-store.ts) holds a `for update` row lock, so this was a fake-only fidelity gap.
    const prior = this.currentSync(v.task_type_name);
    const row: TaskGraphVersionRow = {
      id: this.nextId(),
      task_type_name: v.task_type_name,
      version: prior ? prior.version + 1 : 1, // unique(task_type_name, version) — monotone
      steps: v.steps.map((s) => ({ ...s, depends_on: [...s.depends_on] })), // deep-ish copy (append-only)
      change_reason: v.change_reason,
      previous_version_id: prior ? prior.id : null, // retain the prior version, link to it
      created_at: this.iso(now),
      created_by: v.created_by ?? null,
    };
    this.rows.push(row); // APPEND — the prior row is NEVER mutated or removed (#1)
    return this.clone(row);
  }

  // Synchronous highest-version scan — the read half of putVersion, kept sync so no microtask boundary can
  // interleave two concurrent edits between read and append (see logic-sweep fix above).
  private currentSync(taskTypeName: string): TaskGraphVersionRow | null {
    let best: TaskGraphVersionRow | null = null;
    for (const r of this.rows) {
      if (r.task_type_name !== taskTypeName) continue;
      if (!best || r.version > best.version) best = r;
    }
    return best;
  }

  async getCurrent(taskTypeName: string): Promise<TaskGraphVersionRow | null> {
    const best = this.currentSync(taskTypeName);
    return best ? this.clone(best) : null;
  }

  async listVersions(taskTypeName: string): Promise<TaskGraphVersionRow[]> {
    return this.rows
      .filter((r) => r.task_type_name === taskTypeName)
      .sort((a, b) => a.version - b.version)
      .map((r) => this.clone(r));
  }

  private clone(r: TaskGraphVersionRow): TaskGraphVersionRow {
    return { ...r, steps: r.steps.map((s) => ({ ...s, depends_on: [...s.depends_on] })) };
  }
}

// ── In-memory HistoryStore fake — seeds the durable originals for a resume test (ISSUE-050 owns production).
export class InMemoryHistoryStore implements HistoryStore {
  private readonly rows = new Map<string, TaskHistoryRow>();
  private key(taskId: string, stepIndex: number): string {
    return `${taskId}\x1f${stepIndex}`;
  }
  /** Seed a preserved step output (the completed steps a resume reuses). unique(task_id, step_index). */
  put(row: TaskHistoryRow): void {
    this.rows.set(this.key(row.task_id, row.step_index), { ...row });
  }
  async getOutput(taskId: string, stepIndex: number): Promise<TaskHistoryRow | null> {
    const r = this.rows.get(this.key(taskId, stepIndex));
    return r ? { ...r } : null;
  }
  async listOutputs(taskId: string): Promise<TaskHistoryRow[]> {
    return [...this.rows.values()]
      .filter((r) => r.task_id === taskId)
      .sort((a, b) => a.step_index - b.step_index)
      .map((r) => ({ ...r }));
  }
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────
// The graph executor + resume engine. Deterministic and side-effect-free at this layer: the ACTUAL side
// effect of a step is injected as a `runStep` callback (ISSUE-052 realises it via Inngest). The engine's job
// is to (a) resolve + run steps in dependency order, (b) key-before-side-effect, (c) dedup a completed step's
// key, (d) resume from the first incomplete step reusing preserved outputs. ──────────────────────────────
// ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** The record of one executed step: its resolved index, id, idempotency key, and output. Persisted to the
 * durable originals (task_history) so resume can reuse it (AC-5.GRP.004.1). */
export interface StepResult {
  step_index: number;
  step_id: string;
  idempotency_key: string;
  output: unknown;
}

/** The side-effect callback for a single step. Returns the step's output. The engine commits the idempotency
 * key BEFORE invoking this (key-before-side-effect ordering, AC-5.GRP.003.2). */
export type RunStep = (step: GraphStep, key: string, taskId: string) => Promise<unknown>;

/** A ledger of committed idempotency keys — the ADR-004 §4 pattern surfaced at the harness layer. A key is
 * committed (reserved) BEFORE the side effect fires; a retried step whose key is already committed WITH a
 * recorded output is a no-op that returns the prior output (dedup). A key committed WITHOUT an output means a
 * crash landed between the side effect and the completion record — the retry must reconcile/reuse, never
 * blindly re-fire (AC-5.GRP.003.2).
 *
 * ── BASELINE-LEDGER REUSE (fix for the schema-collision defect) ────────────────────────────────────────
 * This slice does NOT create a new ledger table. It reuses the EXISTING baseline `idempotency_ledger`
 * (app/silo/migrations/0001_baseline.sql L350-355, net-new for FR-3.CONN.004) whose columns are
 * `idempotency_key text primary key, connector text not null, result jsonb, created_at timestamptz`, guarded
 * write-once by 0008_connector_runtime_triggers.sql (`result` fills NULL→value exactly once; key/connector/
 * created_at immutable; no DELETE). Task-graph idempotency maps onto that shape via a stable sentinel
 * `connector` value (LEDGER_CONNECTOR):
 *   • reserve(key)  = insert (idempotency_key, connector, result=NULL) on conflict do nothing
 *                     → a reserved-but-null row = in-flight (the crash window; #3-safe durable reservation).
 *   • complete(key) = update ... set result = $output where idempotency_key=$key and result is null
 *                     → fills result once (the 0008 write-once trigger permits NULL→value, blocks re-write).
 *   • get(key)      = select; `result is not null` ⇒ completed, and result holds the output.
 * The two-phase crash-window semantics (reserve-before-side-effect; a reserved-but-null row = in-flight) are
 * preserved WITHOUT dedicated reserved_at/completed_at columns — `created_at` is the reservation instant, and
 * a persisted completion timestamp is not required by any §4 AC (the resume path keys on completed vs not,
 * never on the *when*). See app/task-graphs/results/proposed-shared-spec.md §2 (verify-present). */
export interface IdempotencyLedger {
  /** Reserve a key before the side effect. Returns the existing entry if the key was already committed. */
  reserve(key: string, now: number): Promise<LedgerEntry>;
  /** Record the side effect's output against a reserved key (completes the entry). */
  complete(key: string, output: unknown, now: number): Promise<void>;
  get(key: string): Promise<LedgerEntry | null>;
}

/** The sentinel `connector` value under which task-graph idempotency keys live on the shared baseline
 * `idempotency_ledger` (which requires `connector NOT NULL`). Stable + distinct from any real connector so a
 * task-graph key never collides with a connector's own FR-3.CONN.004 intent record. */
export const LEDGER_CONNECTOR = 'harness:task-graph';

/** A ledger entry as this slice reads it. `completed`/`output` are DERIVED from the baseline `result` column
 * (`result is not null` ⇒ completed, and result is the output) — they are not distinct persisted columns.
 * `created_at` mirrors the baseline reservation instant. No completed_at is persisted (not required by §4). */
export interface LedgerEntry {
  key: string;
  /** true once the side effect's output has been recorded (baseline `result is not null`); false while only
   * reserved (result NULL — the crash window). */
  completed: boolean;
  /** the recorded side-effect output (baseline `result`), or null while merely reserved. */
  output: unknown | null;
  /** the reservation instant (baseline `created_at`). */
  created_at: string;
}

/** In-memory idempotency ledger fake — mirrors the BASELINE `idempotency_ledger` shape (idempotency_key /
 * connector / result / created_at) + its 0008 write-once trigger, NOT a bespoke table. reserve() is a
 * no-op-if-present insert (ON CONFLICT DO NOTHING semantics); complete() fills `result` once (a second
 * complete of an already-completed key is a no-op, matching the write-once trigger). Every reserved row
 * carries LEDGER_CONNECTOR so the fake proves the exact rows the live adapter writes. */
export class InMemoryIdempotencyLedger implements IdempotencyLedger {
  /** Rows keyed by idempotency_key, in the baseline column shape (so the fake mirrors the live table). The
   * baseline `result` column is `jsonb`: SQL-NULL means reserved-not-yet-complete; a JSON value (including the
   * JSON `null` token) means completed. The fake mirrors that with `result: string | null` — null = SQL-NULL
   * (reserved), and a `JSON.stringify`-encoded string = a recorded (possibly-JSON-null) output — exactly the
   * SUPABASE adapter's `result = $::jsonb` write, so completed-with-null-output stays distinguishable from
   * merely-reserved (#1 no lost/ambiguous completion). */
  readonly rows = new Map<
    string,
    { idempotency_key: string; connector: string; result: string | null; created_at: string }
  >();
  private iso(now: number): string {
    return new Date(now * 1000).toISOString();
  }
  private toEntry(row: { idempotency_key: string; result: string | null; created_at: string }): LedgerEntry {
    // result IS NOT NULL ⇒ completed (result holds the output, decoded from the jsonb token).
    const completed = row.result !== null;
    return {
      key: row.idempotency_key,
      completed,
      output: completed ? (JSON.parse(row.result!) as unknown) : null,
      created_at: row.created_at,
    };
  }
  async reserve(key: string, now: number): Promise<LedgerEntry> {
    const existing = this.rows.get(key);
    if (existing) return this.toEntry(existing); // ON CONFLICT DO NOTHING — the surviving row is returned.
    const row = { idempotency_key: key, connector: LEDGER_CONNECTOR, result: null as string | null, created_at: this.iso(now) };
    this.rows.set(key, row);
    return this.toEntry(row);
  }
  async complete(key: string, output: unknown, _now: number): Promise<void> {
    const row = this.rows.get(key);
    if (!row) throw new Error(`idempotency: cannot complete an unreserved key '${key}'`);
    // Write-once (mirrors the 0008 trigger): SQL-NULL → value is allowed exactly once; an already-completed
    // key is a no-op (never a re-write), so a re-complete cannot corrupt a recorded outcome (#1).
    if (row.result === null) row.result = JSON.stringify(output ?? null);
  }
  async get(key: string): Promise<LedgerEntry | null> {
    const row = this.rows.get(key);
    return row ? this.toEntry(row) : null;
  }
}

export interface ExecuteResult {
  results: StepResult[];
  /** the resolved dependency order actually executed (for assertions). */
  order: GraphStep[];
  /** step indices whose side effect was SKIPPED because a preserved output was reused (resume/dedup). */
  reused: number[];
}

/** The graph executor. Resolves the current graph for a task type, enforces chain_depth_limit, then runs each
 * step in dependency order with key-before-side-effect + resume-from-first-incomplete-step + idempotent dedup.
 *
 * Crash-window contract (AC-5.GRP.003.2): for each step the engine (1) derives the stable key, (2) RESERVES
 * it in the ledger, (3) fires the side effect, (4) records the output + persists to originals. If a crash
 * lands between (3) and (4), the ledger already holds the reserved key — on retry, reserve() returns the
 * existing entry; if it is `completed` the output is reused (no second side effect, #2); if it is reserved-
 * but-not-completed AND a durable original exists (task_history), that original is reused (no double-fire,
 * no lost output, #1). Only a step with NO reserved key and NO preserved output actually fires. */
export class GraphExecutor {
  constructor(
    private readonly graphs: GraphStore,
    private readonly history: HistoryStore,
    private readonly ledger: IdempotencyLedger,
    private readonly configSink: ConfigErrorSink,
    private readonly config: GraphConfig = DEFAULT_GRAPH_CONFIG,
  ) {}

  /** Resolve the graph for a task's type, honouring the chain-depth ceiling. Loud-fails (records + throws) for
   * a graph-less type (AC-5.GRP.001.2) and for an over-limit graph (AC-NFR-PERF.007.1). Returns the resolved
   * dependency-ordered steps (possibly trimmed, with a recorded outcome, when policy=trim). */
  async resolveGraph(
    taskTypeName: string,
    taskId: string | null,
  ): Promise<{ version: TaskGraphVersionRow; order: GraphStep[]; depthOutcome: ChainDepthOutcome | null }> {
    const version = await this.graphs.getCurrent(taskTypeName);
    if (!version) {
      // AC-5.GRP.001.2 (#3): a type with no registered graph FAILS LOUDLY with a recorded error at
      // creation/dequeue — NEVER left silently pending, never failing obscurely deep in execution.
      await this.configSink.record({
        task_id: taskId,
        task_type_name: taskTypeName,
        kind: 'no_graph',
        summary: `Task type '${taskTypeName}' has no registered task graph — refusing to run ad-hoc; task fails at dequeue.`,
        payload: { task_id: taskId, task_type_name: taskTypeName },
      });
      throw new Error(ERR_NO_GRAPH(taskTypeName));
    }
    const order = resolveDependencyOrder(version.steps);
    const limit = this.config.chainDepthLimit;
    let depthOutcome: ChainDepthOutcome | null = null;
    let finalOrder = order;
    if (order.length > limit) {
      // AC-NFR-PERF.007.1 (#3): over-limit is a VISIBLE reject/trim with a logged outcome — never silent.
      if (this.config.overLimitPolicy === 'trim') {
        finalOrder = order.slice(0, limit);
        depthOutcome = {
          task_type_name: taskTypeName,
          resolved_depth: order.length,
          limit,
          outcome: 'trimmed',
          detail: `graph trimmed from ${order.length} to ${limit} steps (chain_depth_limit) — outcome recorded, not silent`,
        };
        await this.configSink.record({
          task_id: taskId,
          task_type_name: taskTypeName,
          kind: 'chain_depth_over_limit',
          summary: depthOutcome.detail,
          payload: { resolved_depth: order.length, limit, outcome: 'trimmed' },
        });
      } else {
        depthOutcome = {
          task_type_name: taskTypeName,
          resolved_depth: order.length,
          limit,
          outcome: 'rejected',
          detail: `graph rejected: ${order.length} steps > chain_depth_limit ${limit}`,
        };
        await this.configSink.record({
          task_id: taskId,
          task_type_name: taskTypeName,
          kind: 'chain_depth_over_limit',
          summary: depthOutcome.detail,
          payload: { resolved_depth: order.length, limit, outcome: 'rejected' },
        });
        throw new Error(ERR_OVER_LIMIT(order.length, limit));
      }
    }
    return { version, order: finalOrder, depthOutcome };
  }

  /** Execute (or resume) a task. On a fresh run, every step fires once. On a retry, the engine resumes from
   * the FIRST incomplete step and reuses the preserved outputs of the completed ones (AC-5.GRP.004.1). The
   * `crashAfter` hook (test-only) simulates an orchestrator crash AFTER a step's side effect but BEFORE its
   * completion is recorded, to prove the crash-window ordering (AC-5.GRP.003.2). */
  async execute(
    taskTypeName: string,
    taskId: string,
    runStep: RunStep,
    now: number,
    crashAfter?: (stepIndex: number) => boolean,
  ): Promise<ExecuteResult> {
    const { order } = await this.resolveGraph(taskTypeName, taskId);
    const results: StepResult[] = [];
    const reused: number[] = [];

    for (let idx = 0; idx < order.length; idx++) {
      const step = order[idx]!;
      const key = stepIdempotencyKey(taskId, step.step_id, step.payload);

      // ── CROSS-ISSUE ORDERING CONTRACT (step_index seam — ISSUE-050 / ISSUE-052) ─────────────────────────
      // `idx` here is the RESOLVED TOPOLOGICAL-order index (from resolveDependencyOrder), NOT the graph's
      // array order. Resume reads task_history.getOutput(taskId, idx) against THIS index. The durable
      // originals are written by ISSUE-050 (C5 ENV) and the run is driven by ISSUE-052 (C5 JOB). THE PINNED
      // CONTRACT: the `step_index` those issues persist to task_history MUST be this same resolved
      // topological-order index — i.e. they must order steps via resolveDependencyOrder and index by that
      // order, not by the steps[] array position. For a strict linear chain the two coincide (which is why
      // the offline tests pass); for a genuine DAG whose array order != topo order they DIVERGE, and a
      // mismatch would make resume reuse the WRONG step's output (a #1 corruption). This is a documented
      // cross-issue seam — see results/proposed-shared-spec.md §3. The property is guarded offline by the
      // "resume with non-linear DAG" test in task-graphs.test.ts.

      // ── RESUME / DEDUP GATE (before any side effect) ──────────────────────────────────────────────────
      // 1. A preserved output in the durable originals (task_history) means this step COMPLETED on a prior
      //    run — reuse it, do NOT re-execute (AC-5.GRP.004.1 resume; #1 no lost output). `idx` is the
      //    resolved topo-order index (see the ordering contract above), the same index ISSUE-050/052 write.
      const preserved = await this.history.getOutput(taskId, idx);
      if (preserved) {
        results.push({ step_index: idx, step_id: step.step_id, idempotency_key: key, output: preserved.full_output });
        reused.push(idx);
        continue;
      }
      // 2. A committed+completed ledger entry means the side effect already fired and its output is recorded
      //    (a retry of a fully-completed step) — reuse it, do NOT re-fire (AC-5.GRP.003.1 dedup; #2).
      const existing = await this.ledger.get(key);
      if (existing?.completed) {
        results.push({ step_index: idx, step_id: step.step_id, idempotency_key: key, output: existing.output });
        reused.push(idx);
        continue;
      }
      // 3. A reserved-but-NOT-completed entry means a crash landed in the window between side effect and
      //    completion record (AC-5.GRP.003.2). Without a durable original we cannot prove the side effect
      //    landed, so the safe, fail-closed reconciliation is: the key is already reserved, so re-firing is
      //    suppressed at the ledger; we reconstruct from whatever the runStep is able to return idempotently
      //    (the step's side effect is itself keyed downstream — ISSUE-052/ADR-004 §4). We DO re-invoke runStep
      //    with the SAME key so the downstream keyed write is a no-op, and record the reconciled output.

      // ── KEY-BEFORE-SIDE-EFFECT (AC-5.GRP.003.2) ──────────────────────────────────────────────────────
      // Reserve the idempotency key FIRST, so that if the process dies immediately after runStep fires but
      // before we record completion, the key already survives — a retry sees it reserved and reconciles
      // rather than double-firing an unkeyed side effect.
      await this.ledger.reserve(key, now);
      const output = await runStep(step, key, taskId);

      // Simulated crash AFTER the side effect, BEFORE recording completion (test-only). The reserved key is
      // already durable; `output` is dropped, exactly as a real crash would drop the in-flight completion.
      if (crashAfter?.(idx)) {
        throw new CrashWindowError(idx, key);
      }

      await this.ledger.complete(key, output, now);
      results.push({ step_index: idx, step_id: step.step_id, idempotency_key: key, output });
    }
    return { results, order, reused };
  }
}

/** Thrown by execute() when the (test-only) crashAfter hook fires — models an orchestrator crash in the
 * window between a step's side effect and its completion record (AC-5.GRP.003.2). Carries the step index +
 * the key that is already committed to the ledger, so a test can assert the reserved-not-completed state. */
export class CrashWindowError extends Error {
  constructor(
    readonly stepIndex: number,
    readonly key: string,
  ) {
    super(`crash-window: process died after step ${stepIndex} side effect, before completion record (key ${key})`);
    this.name = 'CrashWindowError';
  }
}
