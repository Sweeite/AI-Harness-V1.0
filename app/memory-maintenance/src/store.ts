// ISSUE-027 (C2 MNT) — the MaintenanceStore PORT + in-memory reference fake (house port+fake pattern, cf.
// app/memory, app/memory-write, app/retrieval, app/maturity). Every live read/mutation/observability side-effect of
// the maintenance lifecycle goes through this port so all fourteen jobs are unit-testable with NO live DB, and the
// in-memory fake is BOTH the test double AND the reference model the live pg adapter (supabase-store.ts) must match
// 1:1 (proven by the R10 smoke).
//
// THE #1 DURABILITY GUARANTEE IS STRUCTURAL: this port exposes NO delete. Its only memory mutations are
// non-destructive — setConfidence (drift a number), casSupersede (mark superseded_by, chain preserved), and
// insertDerivedMemory (a governed NEW row for merge/summarise). "Decay never deletes" (FR-2.MNT.002 L1815 /
// NFR-DR.008) is therefore not a rule a job must remember to honour — it is a shape the port makes impossible to
// violate. Erasure (FR-2.MNT.017, ISSUE-029) is the single sanctioned destructive path and is OUT OF SCOPE here.
//
// THE SOLE-WRITER INVARIANT (ADR-004 / FR-2.WRT.001): every confidence movement and supersession routes through
// this single governed port as the maintenance `service_role` writer; casSupersede is CAS (`WHERE superseded_by IS
// NULL`) so a lost race affects 0 rows and never a lost/duplicated supersede.
//
// OBSERVABILITY IS NOT OPTIONAL (#3): the port folds in the MaintenanceEventSink — a job cannot run without a place
// to log its run/outcome/records-affected (FR-2.MNT.015), a confidence change with cause/who/when (FR-2.MNT.016), an
// amber/bulk alert (FR-2.MNT.003), or a dashboard maintenance task (FR-2.MNT.009/010/011). The fake records every
// emission in an array for test assertions; the live adapter writes them to event_log.

import { validateMemoryRow, type MemoryRow, type EntityRow } from '../../memory/src/store.ts';
import type { SensitivityTier } from '../../memory/src/entity-types.ts';
import type { ConfidenceCause } from './confidence-lifecycle.ts';

// ── ingestion_queue row (schema.md §3 L317; created by ISSUE-026; the structural scan READS stuck items) ──────
export type IngestionState = 'pending' | 'deferred' | 'included' | 'excluded' | 'shadow_dropped';

export interface IngestionQueueRow {
  id: string;
  content: string;
  source_ref: string | null;
  state: IngestionState;
  target_entity_id: string | null;
  deferred_until: string | null;
  created_at: string;
}

// ── observability record shapes (all land in event_log via the live adapter) ─────────────────────────────────
export type MaintenanceJob =
  | 'confidence_lifecycle'
  | 'soft_decay'
  | 'amber_bulk_alerts'
  | 'supersede_safety_net'
  | 'merge'
  | 'summarise'
  | 'coverage_erosion'
  | 'structural_erosion'
  | 'relevance_erosion'
  | 'embedding_cache'
  | 'feedback'
  | 'haiku_gate_audit';

export type JobCadence = 'real_time' | 'daily' | 'weekly' | 'monthly';

/** FR-2.MNT.015 — the per-run log record: time, outcome, records-affected. Emitted for EVERY run, ok or failed. */
export interface JobRunRecord {
  job: MaintenanceJob;
  cadence: JobCadence;
  startedAt: string;
  finishedAt: string;
  outcome: 'ok' | 'failed';
  recordsAffected: number;
  detail: string;
  /** present only on outcome==='failed' — the loud error string (never swallowed, #3). */
  error?: string;
  /** MNT.015.3 — a zero-work run that must still be logged + flagged (e.g. the empty Haiku-gate audit week). */
  flaggedEmpty?: boolean;
}

/** FR-2.MNT.016 — a cause-tagged confidence movement, logged with who/when/why (the feedback log). */
export interface ConfidenceChange {
  memoryId: string;
  oldConfidence: number | null;
  newConfidence: number | null;
  cause: ConfidenceCause;
  /** the acting identity: a human user id, or a `service_role` job name — NEVER a blank 'system' that erases who. */
  actor: string;
  reason: string;
  at: string;
}

/** FR-2.MNT.003 amber/bulk confidence alerts + FR-2.MNT.015.2 the loud job-failure alert (a failed run is surfaced,
 *  never swallowed — #3). memoryIds is empty for a job_failure. */
export interface MaintenanceAlert {
  kind: 'amber_zone' | 'bulk_drop' | 'job_failure';
  memoryIds: string[];
  detail: string;
  at: string;
}

/** FR-2.MNT.009/010/011 — a dashboard maintenance task/flag (surface-11 / ISSUE-031 renders these). */
export type MaintenanceTaskKind =
  | 'coverage_stale' // MNT.009 — an entity with no new memory in the window
  | 'orphan' // MNT.010 — a memory referencing no live entity
  | 'null_embedding' // MNT.010 — a null/invalid-embedding row (→ re-embed)
  | 'stuck_queue' // MNT.010 — an ingestion-queue item stuck past the escalation threshold (→ escalate)
  | 'long_chain' // MNT.010 — an over-long supersession chain (a churn signal)
  | 'duplicate_cluster' // MNT.010 — a duplicate cluster the merge job missed (→ merge path)
  | 'relevance_review' // MNT.011 — a memory not retrieved/confirmed within the window
  | 'soft_conflict' // MNT.011 / MNT.001 — an on-use live-data or system-of-record contradiction (→ WRT.002 path)
  | 'hard_conflict_quarantine' // MNT.006 — a hard conflict the safety-net found (→ ISSUE-028 quarantine, never auto-resolved)
  | 'personal_consolidation'; // MNT.005/007/014 — a Personal-tier candidate routed to the ISSUE-028 approval queue

export interface MaintenanceTask {
  kind: MaintenanceTaskKind;
  /** the primary subject id (a memory id, an entity id, or an ingestion_queue id — kind disambiguates). */
  targetId: string;
  /** the suggested action for the dashboard (e.g. 're-embed', 'escalate', 'merge', 'review'). */
  action: string;
  detail: string;
  at: string;
}

/** The observability sink — a job cannot run without one (#3). Folded into MaintenanceStore. */
export interface MaintenanceEventSink {
  jobRun(rec: JobRunRecord): Promise<void>;
  confidenceChanged(rec: ConfidenceChange): Promise<void>;
  alert(rec: MaintenanceAlert): Promise<void>;
  task(rec: MaintenanceTask): Promise<void>;
}

// ── the port ─────────────────────────────────────────────────────────────────────────────────────────────────
export interface MaintenanceStore extends MaintenanceEventSink {
  /** All memories (live + superseded) — the scans read the whole graph (a superseded row is still evidence). */
  listMemories(): Promise<MemoryRow[]>;
  /** All entities — coverage/structural scans read staleness + orphan targets. */
  listEntities(): Promise<EntityRow[]>;
  /** The ingestion queue — the structural scan reads STUCK items (MNT.010.3). */
  listIngestionQueue(): Promise<IngestionQueueRow[]>;
  /** The set of memory ids currently in active human review (pending memory_conflicts) — the freeze input for the
   *  confidence lifecycle (a memory under review is frozen against automated drift, FR-2.MNT.001). */
  underReviewMemoryIds(): Promise<Set<string>>;

  // ── non-destructive mutations (the sole-writer maintenance primitives) ──
  /** Drift a memory's confidence to a new value (never null→delete). The governed confidence write. */
  setConfidence(id: string, newConfidence: number): Promise<void>;
  /** CAS-supersede: set memories.superseded_by = newId WHERE id=oldId AND superseded_by IS NULL. Returns whether
   *  this writer won the race (a lost CAS affects 0 rows — no lost-supersede, ADR-004). The chain is preserved:
   *  the old row is NEVER deleted, only marked. */
  casSupersede(oldId: string, newId: string): Promise<boolean>;
  /** Governed insert of a NEW derived memory (merge/summarise output). Validates the row shape + is idempotency-
   *  keyed (a re-run is a no-op, never a duplicate). `derivedFrom` is the evidence cluster it references. */
  insertDerivedMemory(row: MemoryRow, derivedFrom: string[]): Promise<{ inserted: boolean; id: string }>;
}

// ── in-memory reference fake ──────────────────────────────────────────────────────────────────────────────────
let __seq = 0;
const nextId = (p: string) => `${p}-${++__seq}`;

/** Loud failure for a maintenance mutation against a row that vanished — a #3 silent no-op is forbidden. */
export class MaintenanceError extends Error {
  constructor(
    public reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'MaintenanceError';
  }
}

export class InMemoryMaintenanceStore implements MaintenanceStore {
  readonly jobRuns: JobRunRecord[] = [];
  readonly confidenceChanges: ConfidenceChange[] = [];
  readonly alerts: MaintenanceAlert[] = [];
  readonly tasks: MaintenanceTask[] = [];
  /** derived-memory id → the evidence-cluster ids it references (summarise/merge provenance, read by tests). */
  readonly derivedFrom = new Map<string, string[]>();

  constructor(
    private memories: MemoryRow[] = [],
    private entities: EntityRow[] = [],
    private queue: IngestionQueueRow[] = [],
    private underReview: Set<string> = new Set(),
  ) {}

  seedMemories(rows: MemoryRow[]): void {
    this.memories = rows.map((m) => this.clone(m));
  }
  seedEntities(rows: EntityRow[]): void {
    this.entities = rows.map((e) => ({ ...e, external_refs: { ...e.external_refs } }));
  }
  seedQueue(rows: IngestionQueueRow[]): void {
    this.queue = rows.map((q) => ({ ...q }));
  }
  seedUnderReview(ids: Iterable<string>): void {
    this.underReview = new Set(ids);
  }

  private clone(m: MemoryRow): MemoryRow {
    return { ...m, entity_ids: [...m.entity_ids], embedding: [...m.embedding] };
  }

  async listMemories(): Promise<MemoryRow[]> {
    return this.memories.map((m) => this.clone(m));
  }
  async listEntities(): Promise<EntityRow[]> {
    return this.entities.map((e) => ({ ...e, external_refs: { ...e.external_refs } }));
  }
  async listIngestionQueue(): Promise<IngestionQueueRow[]> {
    return this.queue.map((q) => ({ ...q }));
  }
  async underReviewMemoryIds(): Promise<Set<string>> {
    return new Set(this.underReview);
  }

  async setConfidence(id: string, newConfidence: number): Promise<void> {
    const m = this.memories.find((x) => x.id === id);
    if (!m) throw new MaintenanceError('memory_not_found', `setConfidence: memory '${id}' not found — refusing a silent no-op (#3)`);
    if (newConfidence < 0 || newConfidence > 1) throw new MaintenanceError('confidence_range', `setConfidence: ${newConfidence} out of [0,1]`);
    m.confidence = newConfidence;
    m.updated_at = new Date().toISOString();
  }

  async casSupersede(oldId: string, newId: string): Promise<boolean> {
    const m = this.memories.find((x) => x.id === oldId);
    if (!m) throw new MaintenanceError('memory_not_found', `casSupersede: memory '${oldId}' not found`);
    if (m.superseded_by !== null) return false; // lost the CAS race — 0 rows, no lost-supersede (ADR-004)
    m.superseded_by = newId;
    m.updated_at = new Date().toISOString();
    return true;
  }

  async insertDerivedMemory(row: MemoryRow, derivedFrom: string[]): Promise<{ inserted: boolean; id: string }> {
    validateMemoryRow(row); // enum domains + the two DB CHECKs + golden-rule pointer-needs-ref (same as the live insert)
    const existing = this.memories.find((m) => m.idempotency_key === row.idempotency_key);
    if (existing) return { inserted: false, id: existing.id };
    const stored = this.clone(row);
    this.memories.push(stored);
    this.derivedFrom.set(stored.id, [...derivedFrom]);
    return { inserted: true, id: stored.id };
  }

  async jobRun(rec: JobRunRecord): Promise<void> {
    this.jobRuns.push({ ...rec });
  }
  async confidenceChanged(rec: ConfidenceChange): Promise<void> {
    this.confidenceChanges.push({ ...rec });
  }
  async alert(rec: MaintenanceAlert): Promise<void> {
    this.alerts.push({ ...rec, memoryIds: [...rec.memoryIds] });
  }
  async task(rec: MaintenanceTask): Promise<void> {
    this.tasks.push({ ...rec });
  }

  // ── test-seam builders ──────────────────────────────────────────────────────────────────────────────────────
  /** A well-formed MemoryRow for seeding a maintenance scenario (mirrors app/memory's _memoryRow contract). */
  static memory(partial: Partial<MemoryRow> & Pick<MemoryRow, 'type' | 'content' | 'entity_ids'>): MemoryRow {
    const source = partial.source ?? 'ai_inferred';
    const content_hash = partial.content_hash ?? `h:${partial.content}`;
    const source_ref = partial.source_ref ?? (source === 'system_pointer' ? 'sor://ref' : null);
    return {
      id: partial.id ?? nextId('mem'),
      type: partial.type,
      content: partial.content,
      embedding: partial.embedding ?? new Array(1536).fill(0.01),
      embedding_model: partial.embedding_model ?? 'text-embedding-3-small',
      entity_ids: partial.entity_ids,
      source,
      source_ref,
      confidence: partial.confidence ?? (source === 'system_pointer' ? null : 0.8),
      visibility: partial.visibility ?? 'global',
      sensitivity: partial.sensitivity ?? 'standard',
      superseded_by: partial.superseded_by ?? null,
      content_hash,
      idempotency_key: partial.idempotency_key ?? nextId('idem'),
      expires_at: partial.expires_at ?? null,
      created_at: partial.created_at ?? new Date(0).toISOString(),
      updated_at: partial.updated_at ?? partial.created_at ?? new Date(0).toISOString(),
    };
  }

  static entity(partial: Pick<EntityRow, 'id' | 'type' | 'name'> & Partial<EntityRow>): EntityRow {
    return {
      external_refs: {},
      is_internal_org: false,
      maturity: null,
      maturity_updated_at: null,
      created_at: new Date(0).toISOString(),
      ...partial,
    };
  }

  static queueItem(partial: Pick<IngestionQueueRow, 'id'> & Partial<IngestionQueueRow>): IngestionQueueRow {
    return {
      content: 'queued content',
      source_ref: null,
      state: 'pending',
      target_entity_id: null,
      deferred_until: null,
      created_at: new Date(0).toISOString(),
      ...partial,
    };
  }
}

// ── shared helpers used by several jobs ───────────────────────────────────────────────────────────────────────
/** A memory is LIVE iff it is not superseded and not expired at `nowMs` (the retrieval-admission liveness). Mirrors
 *  the live SQL `superseded_by is null and (expires_at is null or expires_at > now())`. */
export function isLiveMemory(m: MemoryRow, nowMs: number): boolean {
  if (m.superseded_by !== null) return false;
  if (m.expires_at !== null && Date.parse(m.expires_at) <= nowMs) return false;
  return true;
}

/** Order-independent same-entity-set test (the resolution axis two memories must share to be the "same slot"). */
export function sameEntitySet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((x, i) => x === sb[i]);
}

/** Personal-tier is never auto-consolidated (FR-2.MNT.014) — the merge/summarise skip predicate. */
export function isPersonal(sensitivity: SensitivityTier): boolean {
  return sensitivity === 'personal';
}
