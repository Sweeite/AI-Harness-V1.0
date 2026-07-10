// ISSUE-026 (C2 ING) — the IngestionStore PORT + in-memory reference fake, PLUS the no-backdoor sole-writer gate
// (the #2 safety core) and the observability/audit/verification sinks (house port+fake pattern, cf. app/retrieval,
// app/memory-write). The in-memory fake is BOTH the test double AND the reference the live pg adapter (supabase-
// store.ts) must match 1:1 (R10 smoke).
//
// THE NO-BACKDOOR INVARIANT (FR-2.ING.010 / AC-2.ING.004.1 / #2). "Ingestion is not a backdoor": the ONLY way any
// candidate knowledge reaches the `memories` table is the injected sole-writer gate (the ISSUE-024 writeMemories
// entry point), and that gate STRUCTURALLY REFUSES any route that has not passed relevance + sensitivity, or a
// FLAGGED item that lacks an explicit human Include. The IngestionStore deliberately exposes NO memory-insert method
// at all — there is no un-gated path to construct. The invariant is code, not convention.

import type { EntityInput, EntityRow } from '../../memory/src/store.ts';
import type { SensitivityTier } from '../../memory/src/entity-types.ts';
import type { SourceEvent, WriteOutcome } from '../../memory-write/src/writer.ts';
import type { TaskAuthz } from '../../memory-write/src/commit.ts';

// ── ingestion_queue row shape (schema.md §3 / 0001 baseline) ────────────────────────────────────────────────────
export type IngestionState = 'pending' | 'deferred' | 'included' | 'excluded' | 'shadow_dropped';

export interface QueueRow {
  id: string;
  content: string;
  source_ref: string | null;
  flag_reason: string | null;
  suggested_tier: SensitivityTier | null;
  target_entity_id: string | null;
  state: IngestionState;
  deferred_until: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  decision_reason: string | null;
  created_at: string;
}

export interface NewQueueRow {
  content: string;
  source_ref: string | null;
  flag_reason: string | null;
  suggested_tier: SensitivityTier | null;
  target_entity_id: string | null;
  state: IngestionState; // 'pending' (a Filter-2 flag) or 'shadow_dropped' (a trust-window Filter-1 would-drop)
  deferred_until?: string | null;
  created_at?: string;
}

/** The ONLY state-change to a queue row — a terminal human decision (Include/Exclude) or a Defer, always carrying
 *  who/when/why. There is no other mutation method: a queue item can leave `pending` ONLY through here (AC-2.ING.003.2). */
export interface DecisionPatch {
  state: 'included' | 'excluded' | 'deferred';
  reviewedBy: string;
  reviewedAt: string;
  decisionReason: string | null;
  deferredUntil?: string | null;
}

// ── audit + observability sinks ─────────────────────────────────────────────────────────────────────────────────
/** A human queue decision / sensitive view → access_audit (append-only; FR-2.ING.003 / FR-1.AUD.001). */
export interface IngestionAudit {
  auditType: 'ingestion_decision' | 'sensitive_view';
  action: 'include' | 'exclude' | 'defer' | 'view';
  actorType: 'user' | 'agent' | 'system';
  actorIdentity: string;
  reviewerUserId: string | null;
  queueId: string;
  targetEntityId: string | null;
  reason: string | null;
  tier?: SensitivityTier | null;
}

/** One Filter-1/Filter-2 decision → the Haiku decision log (ADR-003 §8). */
export interface FilterDecisionSample {
  filter: 'relevance' | 'sensitivity';
  verdict: string;
  reason: string | null;
  targetEntityId: string | null;
}

/** One sampled-drop audit run (post-graduation) OR a missed run → FR-2.MNT.015 job-run log. `missed: true` records a
 *  week whose sampled audit did not run / reviewed zero drops — it is LOGGED, never silently skipped (AC-2.ING.001.3). */
export interface AuditRunSample {
  window: string;
  totalDrops: number;
  sampledTarget: number;
  sampled: number;
  reviewed: number;
  missed: boolean;
}

/** An escalation of an un-actioned queue item (AC-2.ING.003.3) — a LOUD signal so it is never silently held. The
 *  persistent server-owned `escalated_at` + C7 delivery are ISSUE-027/075's job (seam); this slice raises the signal. */
export interface EscalationSample {
  queueId: string;
  ageDays: number;
  createdAt: string;
}

export interface ObservabilitySink {
  filterDecision(s: FilterDecisionSample): Promise<void>;
  auditRun(s: AuditRunSample): Promise<void>;
  escalation(s: EscalationSample): Promise<void>;
}

/** The verification-pass sink (init-sequence step 7). A human verifying an already-written memory is the ONE allowed
 *  non-writer memory mutation (component-02 reconciliation #3, audited C1). It bumps the memory to confidence 1.0 /
 *  source human_verified (AC-2.ING.009.2). NOT a create — the memory already exists (written via the sole writer). */
export interface MemoryVerificationSink {
  markVerified(memoryId: string, reviewer: string): Promise<{ memoryId: string; confidence: number; source: string }>;
}

// ── the no-backdoor sole-writer gate ────────────────────────────────────────────────────────────────────────────
/** Proof, carried on every write route, that the item passed the standard write flow (FR-2.ING.010). A route missing
 *  either stamp — or a flagged item written without an explicit human Include — is REFUSED by the gate. */
export interface FilterProvenance {
  /** Filter 1 verdict — must be 'save'. A 'drop' never produces a route at all. */
  relevance: 'passed';
  /** Filter 2 outcome: 'clean' (auto-passed to the writer) or 'included' (a flagged item a human explicitly Included). */
  sensitivity: 'clean' | 'included';
  /** REQUIRED when sensitivity === 'included': the reviewer who made the Include decision. */
  includedBy?: string;
}

export interface WriteRoute {
  event: SourceEvent;
  task: TaskAuthz;
  provenance: FilterProvenance;
}

export class BackdoorError extends Error {
  constructor(
    public reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'BackdoorError';
  }
}

/** Structural enforcement of "ingestion is not a backdoor" (#2). Throws BackdoorError on any un-gated route. Shared by
 *  BOTH the live gate and the fake so offline and live refuse identically (R10). */
export function assertRoutable(p: FilterProvenance): void {
  if (p.relevance !== 'passed') {
    throw new BackdoorError('relevance_not_passed', 'route did not pass Filter 1 (relevance) — cannot reach the writer');
  }
  if (p.sensitivity !== 'clean' && p.sensitivity !== 'included') {
    throw new BackdoorError('sensitivity_not_passed', 'route did not pass Filter 2 (sensitivity) — cannot reach the writer');
  }
  if (p.sensitivity === 'included' && !p.includedBy) {
    throw new BackdoorError('flagged_without_include', 'flagged content may be written ONLY via an explicit human Include (FR-2.ING.004)');
  }
}

/** The delegate the gate hands a validated route to — LIVE this is `(e, t) => writeMemories(e, t, deps)` (ISSUE-024),
 *  the sole write entry point. The gate never inserts a memory itself; it validates provenance and delegates. */
export type WriterDelegate = (event: SourceEvent, task: TaskAuthz) => Promise<WriteOutcome>;

export interface MemoryWriteGate {
  route(r: WriteRoute): Promise<WriteOutcome>;
}

/** The production gate: validate the no-backdoor provenance, then hand the route to the ISSUE-024 sole writer. */
export class SoleWriterGate implements MemoryWriteGate {
  constructor(private readonly delegate: WriterDelegate) {}
  async route(r: WriteRoute): Promise<WriteOutcome> {
    assertRoutable(r.provenance);
    return this.delegate(r.event, r.task);
  }
}

/** The in-memory reference gate for tests: enforces the SAME no-backdoor guard, records every route, and returns a
 *  synthetic outcome. A configured `reject` simulates a writer-side hold (e.g. a fresh hard conflict) that must
 *  SURFACE to the caller, never vanish (#3). */
export class RecordingWriteGate implements MemoryWriteGate {
  readonly routes: WriteRoute[] = [];
  constructor(private readonly outcome: (r: WriteRoute) => WriteOutcome = () => ({ kind: 'committed', results: [] })) {}
  async route(r: WriteRoute): Promise<WriteOutcome> {
    assertRoutable(r.provenance); // the fake refuses an un-gated route exactly as the live gate does
    this.routes.push(r);
    return this.outcome(r);
  }
}

// ── the IngestionStore port ─────────────────────────────────────────────────────────────────────────────────────
export interface IngestionStore {
  /** Insert a queue row (a Filter-2 flag → 'pending', or a trust-window Filter-1 would-drop → 'shadow_dropped'). */
  enqueue(row: NewQueueRow): Promise<QueueRow>;
  getQueueRow(id: string): Promise<QueueRow | null>;
  /** The reviewer's working set: pending + resurfaced-deferred rows, oldest-first (nearest-to-escalation surfaces). */
  listActionable(): Promise<QueueRow[]>;
  listAll(): Promise<QueueRow[]>;
  /** The ONLY state-transition method (queue exit only via a logged decision — AC-2.ING.003.2). Throws if the row is
   *  not currently pending/deferred (a terminal row can't be re-decided; a #1/#3 guard against silent overwrite). */
  transition(id: string, patch: DecisionPatch): Promise<QueueRow>;
  /** Auto-resurface: any deferred row whose deferred_until <= now returns to 'pending' (never an indefinite hold, #3).
   *  This is a re-entry to the working set, not an exit — no reviewer decision is implied. Returns the resurfaced ids. */
  resurfaceDeferred(nowIso: string): Promise<string[]>;
  /** Pipeline 1: create an entity with external_refs (points, never copies). Delegates to the ISSUE-022 entity store. */
  insertEntity(input: EntityInput): Promise<EntityRow>;
  /** A human queue decision / sensitive view → access_audit (append-only). */
  appendAudit(a: IngestionAudit): Promise<void>;
}

// ── in-memory reference fake ────────────────────────────────────────────────────────────────────────────────────
let __seq = 0;
const nextId = () => `iq-${++__seq}`;
let __ent = 0;
const nextEntId = () => `ent-${++__ent}`;

export class InMemoryIngestionStore implements IngestionStore {
  private rows = new Map<string, QueueRow>();
  private entities: EntityRow[] = [];
  readonly audits: IngestionAudit[] = [];

  private clone(r: QueueRow): QueueRow {
    return { ...r };
  }

  async enqueue(row: NewQueueRow): Promise<QueueRow> {
    const id = nextId();
    const stored: QueueRow = {
      id,
      content: row.content,
      source_ref: row.source_ref,
      flag_reason: row.flag_reason,
      suggested_tier: row.suggested_tier,
      target_entity_id: row.target_entity_id,
      state: row.state,
      deferred_until: row.deferred_until ?? null,
      reviewed_by: null,
      reviewed_at: null,
      decision_reason: null,
      created_at: row.created_at ?? new Date(0).toISOString(),
    };
    this.rows.set(id, stored);
    return this.clone(stored);
  }

  async getQueueRow(id: string): Promise<QueueRow | null> {
    const r = this.rows.get(id);
    return r ? this.clone(r) : null;
  }

  async listActionable(): Promise<QueueRow[]> {
    return [...this.rows.values()]
      .filter((r) => r.state === 'pending' || r.state === 'deferred')
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
      .map((r) => this.clone(r));
  }

  async listAll(): Promise<QueueRow[]> {
    return [...this.rows.values()].map((r) => this.clone(r));
  }

  async transition(id: string, patch: DecisionPatch): Promise<QueueRow> {
    const r = this.rows.get(id);
    if (!r) throw new Error(`ingestion_queue row ${id} not found`);
    // A queue item leaves 'pending'/'deferred' ONLY via a logged decision; a terminal row is never silently re-decided.
    if (r.state !== 'pending' && r.state !== 'deferred') {
      throw new Error(`ingestion_queue row ${id} is terminal (${r.state}) — cannot re-decide (queue-exit invariant, AC-2.ING.003.2)`);
    }
    r.state = patch.state;
    r.reviewed_by = patch.reviewedBy;
    r.reviewed_at = patch.reviewedAt;
    r.decision_reason = patch.decisionReason;
    r.deferred_until = patch.state === 'deferred' ? (patch.deferredUntil ?? null) : null;
    return this.clone(r);
  }

  async resurfaceDeferred(nowIso: string): Promise<string[]> {
    const resurfaced: string[] = [];
    for (const r of this.rows.values()) {
      if (r.state === 'deferred' && r.deferred_until !== null && r.deferred_until <= nowIso) {
        r.state = 'pending';
        r.deferred_until = null;
        resurfaced.push(r.id);
      }
    }
    return resurfaced;
  }

  async insertEntity(input: EntityInput): Promise<EntityRow> {
    const row: EntityRow = {
      id: nextEntId(),
      type: input.type,
      name: input.name,
      external_refs: { ...(input.external_refs ?? {}) },
      is_internal_org: input.is_internal_org ?? false,
      maturity: null,
      maturity_updated_at: null,
      created_at: new Date(0).toISOString(),
    };
    this.entities.push(row);
    return { ...row, external_refs: { ...row.external_refs } };
  }

  _entities(): EntityRow[] {
    return this.entities.map((e) => ({ ...e, external_refs: { ...e.external_refs } }));
  }

  async appendAudit(a: IngestionAudit): Promise<void> {
    this.audits.push({ ...a });
  }
}

/** In-memory observability sink (records the Haiku decision log + audit runs + escalations). */
export class InMemoryObservabilitySink implements ObservabilitySink {
  readonly filterDecisions: FilterDecisionSample[] = [];
  readonly auditRuns: AuditRunSample[] = [];
  readonly escalations: EscalationSample[] = [];
  async filterDecision(s: FilterDecisionSample): Promise<void> {
    this.filterDecisions.push({ ...s });
  }
  async auditRun(s: AuditRunSample): Promise<void> {
    this.auditRuns.push({ ...s });
  }
  async escalation(s: EscalationSample): Promise<void> {
    this.escalations.push({ ...s });
  }
}

/** In-memory verification sink — the human-verify bump to confidence 1.0 / human_verified (AC-2.ING.009.2). */
export class InMemoryVerificationSink implements MemoryVerificationSink {
  readonly verified: Array<{ memoryId: string; reviewer: string }> = [];
  async markVerified(memoryId: string, reviewer: string): Promise<{ memoryId: string; confidence: number; source: string }> {
    this.verified.push({ memoryId, reviewer });
    return { memoryId, confidence: 1.0, source: 'human_verified' };
  }
}
