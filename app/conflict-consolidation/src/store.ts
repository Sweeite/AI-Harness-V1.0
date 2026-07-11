// ISSUE-028 — the ConflictConsolidationStore PORT + in-memory reference fake, and the SoleWriter PORT + its fake.
//
// Two ports, one invariant. The *store* owns the two human-gated queues (`memory_conflicts`, `consolidation_approvals`)
// — reads, the server-owned escalation sweep, record-close, and the loud observability sinks. It deliberately exposes
// NO `insert into memories`: every memory mutation a resolution implies is handed to the *SoleWriter* (ADR-004 — the
// Memory Agent is the only writer; a resolution NEVER does a direct insert). The fakes mirror the live SQL 1:1 at the
// method boundary so a green offline suite predicts live behaviour (R10).

import type { MemoryFacts, SuggestedResolution, ResolutionKind } from './priority.ts';

// ── Shared vocabulary (matches the live enums: mem_review_state, consolidation_op — 0001 baseline). ─────────────
export type ReviewState = 'pending' | 'escalated' | 'resolved';
export type ConsolidationOp = 'merge' | 'summarise';
/** the live `sensitivity_tier` enum. */
export type SensitivityTier = 'standard' | 'confidential' | 'personal' | 'restricted';

/** The write-time source type ISSUE-024 stamps on a draft (the FR-2.WRT.005 band vocabulary — finer than the stored
 *  `memories.source` enum). system_of_record + ai_inferred_strong/weak all STORE as `ai_inferred`. */
export type WriteSourceType = 'human_verified' | 'system_of_record' | 'ai_inferred_strong' | 'ai_inferred_weak' | 'system_pointer';

/** Map a write-time source type to the stored `memories.source` value (the coarse enum). system_of_record +
 *  ai_inferred_strong/weak all STORE as `ai_inferred`; used when we need the value a WRITTEN row would carry. */
export function storedSourceOf(t: WriteSourceType): 'ai_inferred' | 'human_verified' | 'system_pointer' {
  if (t === 'human_verified') return 'human_verified';
  if (t === 'system_pointer') return 'system_pointer';
  return 'ai_inferred';
}

/** Map a write-time source type to the value the RESOLVER reasons over for a still-held (unwritten) candidate. This
 *  PRESERVES `system_of_record` (unlike storedSourceOf) — a held candidate has not yet collapsed to ai_inferred, so
 *  rule 2 (FR-2.MNT.008) can genuinely fire for it. ai_inferred_strong/weak still map to plain ai_inferred. */
export function resolverSourceOf(t: WriteSourceType): 'ai_inferred' | 'human_verified' | 'system_pointer' | 'system_of_record' {
  if (t === 'human_verified') return 'human_verified';
  if (t === 'system_pointer') return 'system_pointer';
  if (t === 'system_of_record') return 'system_of_record';
  return 'ai_inferred';
}

/** Sensitivity ordering (least → most sensitive), for reducing a candidate set to its highest tier for display + the
 *  clearance-before-view gate. */
export const SENSITIVITY_ORDER: readonly SensitivityTier[] = ['standard', 'confidential', 'personal', 'restricted'];
export function highestTier(tiers: readonly SensitivityTier[]): SensitivityTier {
  return tiers.reduce<SensitivityTier>((hi, t) => (SENSITIVITY_ORDER.indexOf(t) > SENSITIVITY_ORDER.indexOf(hi) ? t : hi), 'standard');
}

/** The held candidate as stored in `memory_conflicts.new_memory` (jsonb) — the draft ISSUE-024 quarantined, WITHOUT
 *  the raw embedding (dropped by 024's draftToJson; re-produced on human-approve). `sourceType` is the fine write-time
 *  type 024 stored (WriteSourceType), which the live SoleWriter feeds back into ISSUE-024's buildMemoryRow verbatim. */
export interface HeldCandidate {
  type: string;
  content: string;
  entity_ids: string[];
  sourceType: WriteSourceType;
  proposedConfidence?: number | null;
  source_ref: string | null;
  visibility: string;
  sensitivity: SensitivityTier;
  expires_at: string | null;
  embedding_model: string;
  contradicts?: boolean;
}

/** A row of the hard-conflict quarantine queue (`memory_conflicts`). */
export interface ConflictRecord {
  id: string;
  new_memory: HeldCandidate;
  conflicting_memory_ids: string[];
  suggested_resolution: SuggestedResolution | null;
  state: ReviewState;
  escalated_at: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

/** A row of the Personal-tier consolidation-approval queue (`consolidation_approvals`). */
export interface ConsolidationRecord {
  id: string;
  candidate_memory_ids: string[];
  op: ConsolidationOp;
  tier: SensitivityTier;
  state: ReviewState;
  escalated_at: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

/** An immutable access_audit entry (schema §2, append-only). */
export interface AuditEntry {
  auditType: string;
  actorIdentity: string;
  actorType: 'user' | 'agent' | 'system';
  action: string;
  targetType: string | null;
  reason: string | null;
  pathContext: string;
  originatingUserId: string | null;
}

/** The loud observability sink (#3 — a resolution, a queued Personal candidate, an escalation must never be silent). */
export interface ConflictConsolidationEventSink {
  conflictResolved(payload: Record<string, unknown>): Promise<void>;
  consolidationQueued(payload: Record<string, unknown>): Promise<void>;
  consolidationResolved(payload: Record<string, unknown>): Promise<void>;
  /** reuses the baseline `approval_queue_stale` event (both queues are approval queues). */
  escalated(payload: Record<string, unknown>): Promise<void>;
  /** Personal/Restricted view + Personal-consolidation resolution → access_audit (FR-1.AUD.001). */
  audit(entry: AuditEntry): Promise<void>;
}

/** The two-queue store port. */
export interface ConflictConsolidationStore extends ConflictConsolidationEventSink {
  // ── Conflicts queue (memory_conflicts) ──
  listPendingConflicts(): Promise<ConflictRecord[]>;
  /** the LIVE (superseded_by IS NULL) conflicting memories, for the resolver + the side-by-side detail. A row that
   *  has since been superseded is NOT returned (it can no longer be contradicted). */
  getLiveConflictingMemories(conflictingIds: string[]): Promise<MemoryFacts[]>;
  attachSuggestedResolution(conflictId: string, resolution: SuggestedResolution): Promise<void>;
  closeConflict(conflictId: string, resolvedBy: string, resolution: SuggestedResolution): Promise<void>;

  // ── Consolidation queue (consolidation_approvals) ──
  enqueueConsolidation(candidateIds: string[], op: ConsolidationOp, tier: SensitivityTier): Promise<string>;
  listPendingConsolidations(): Promise<ConsolidationRecord[]>;
  /** the candidate source memories, for the proposed-vs-sources preview + partial-load detection. */
  getConsolidationSources(candidateIds: string[]): Promise<MemoryFacts[]>;
  closeConsolidation(id: string, resolvedBy: string, decision: 'approved' | 'rejected'): Promise<void>;

  // ── Escalation (server-owned — the surface never decides it) ──
  /** stamp escalated_at + state='escalated' on any pending conflict older than reviewEscalationDays. Returns ids. */
  escalateOverdueConflicts(reviewEscalationDays: number, now?: number): Promise<string[]>;
  /** stamp escalated_at + state='escalated' on any pending consolidation older than reviewEscalationDays. */
  escalateOverdueConsolidations(reviewEscalationDays: number, now?: number): Promise<string[]>;
}

// ── The governed write boundary (ADR-004). A resolution hands its memory mutations here — never a direct insert. ──
export interface WriteContext {
  reviewerId: string;
  reviewerIdentity: string;
  reason?: string | null;
}
export interface KeepNewResult {
  /** false when the governed write did NOT commit (idempotent no-op / halted / deferred). The caller must then NOT
   *  close the record — it stays actionable + surfaces loudly (#3, mirrors the ISSUE-026 non-commit fix). */
  committed: boolean;
  memoryId: string | null;
  superseded: string[];
  note?: string;
}
export interface KeepBothResult {
  committed: boolean;
  memoryId: string | null;
  note?: string;
}
export interface ApplyConsolidationInput {
  candidateIds: string[];
  op: ConsolidationOp;
}
export interface ApplyConsolidationResult {
  committed: boolean;
  derivedId: string | null;
  superseded: string[];
  note?: string;
}

export interface SoleWriter {
  /** Keep-new: govern-insert the held candidate as a live memory + CAS-supersede each conflicting id (chain intact,
   *  WHERE superseded_by IS NULL — a lost race supersedes 0 rows). Re-embeds the held content on the way in. */
  keepNew(held: HeldCandidate, supersedeIds: string[], ctx: WriteContext): Promise<KeepNewResult>;
  /** Keep-both: govern-insert the held candidate live WITHOUT superseding anything (both stay live), linked by note. */
  keepBoth(held: HeldCandidate, keepLiveIds: string[], note: string, ctx: WriteContext): Promise<KeepBothResult>;
  /** Approve consolidation: perform the governed merge/summarise (derive one row + supersede the sources). */
  applyConsolidation(input: ApplyConsolidationInput, ctx: WriteContext): Promise<ApplyConsolidationResult>;
}

// ── Errors ──────────────────────────────────────────────────────────────────────────────────────────────────
export class ConflictConsolidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ConflictConsolidationError';
  }
}

// ── In-memory reference fake (the store). ───────────────────────────────────────────────────────────────────
let __seq = 0;
const nextId = (p: string): string => `${p}-${++__seq}`;

export class InMemoryConflictConsolidationStore implements ConflictConsolidationStore {
  // public record arrays tests assert on
  readonly resolvedEvents: Record<string, unknown>[] = [];
  readonly queuedEvents: Record<string, unknown>[] = [];
  readonly consolidationResolvedEvents: Record<string, unknown>[] = [];
  readonly escalatedEvents: Record<string, unknown>[] = [];
  readonly audits: AuditEntry[] = [];

  private conflicts: ConflictRecord[] = [];
  private consolidations: ConsolidationRecord[] = [];
  private liveMemories = new Map<string, MemoryFacts>();
  private clock = 0;

  constructor(private readonly nowIso: () => string = () => new Date(Date.parse('2026-07-11T00:00:00Z') + this.clock++).toISOString()) {}

  // seeds
  seedConflicts(rows: ConflictRecord[]): this {
    this.conflicts = rows.map((r) => ({ ...r }));
    return this;
  }
  seedConsolidations(rows: ConsolidationRecord[]): this {
    this.consolidations = rows.map((r) => ({ ...r }));
    return this;
  }
  seedLiveMemories(rows: MemoryFacts[]): this {
    for (const m of rows) this.liveMemories.set(m.id, { ...m });
    return this;
  }
  /** mark a live memory superseded (leaves the Map but flags it non-live via a private set). */
  private superseded = new Set<string>();
  markSuperseded(id: string): void {
    this.superseded.add(id);
  }
  snapshotConflict(id: string): ConflictRecord | undefined {
    const r = this.conflicts.find((c) => c.id === id);
    return r ? { ...r } : undefined;
  }
  snapshotConsolidation(id: string): ConsolidationRecord | undefined {
    const r = this.consolidations.find((c) => c.id === id);
    return r ? { ...r } : undefined;
  }

  async listPendingConflicts(): Promise<ConflictRecord[]> {
    return this.conflicts.filter((c) => c.state === 'pending' || c.state === 'escalated').map((c) => ({ ...c }));
  }
  async getLiveConflictingMemories(conflictingIds: string[]): Promise<MemoryFacts[]> {
    return conflictingIds
      .filter((id) => this.liveMemories.has(id) && !this.superseded.has(id))
      .map((id) => ({ ...this.liveMemories.get(id)! }));
  }
  async attachSuggestedResolution(conflictId: string, resolution: SuggestedResolution): Promise<void> {
    const c = this.conflicts.find((x) => x.id === conflictId);
    if (!c) throw new ConflictConsolidationError('conflict_not_found', `attachSuggestedResolution: '${conflictId}' not found`);
    c.suggested_resolution = { ...resolution };
  }
  async closeConflict(conflictId: string, resolvedBy: string, resolution: SuggestedResolution): Promise<void> {
    const c = this.conflicts.find((x) => x.id === conflictId);
    if (!c) throw new ConflictConsolidationError('conflict_not_found', `closeConflict: '${conflictId}' not found`);
    if (c.state === 'resolved') throw new ConflictConsolidationError('already_resolved', `closeConflict: '${conflictId}' already resolved`);
    c.state = 'resolved';
    c.resolved_by = resolvedBy;
    c.resolved_at = this.nowIso();
    c.suggested_resolution = { ...resolution };
  }

  async enqueueConsolidation(candidateIds: string[], op: ConsolidationOp, tier: SensitivityTier): Promise<string> {
    const id = nextId('cons');
    this.consolidations.push({
      id,
      candidate_memory_ids: [...candidateIds],
      op,
      tier,
      state: 'pending',
      escalated_at: null,
      resolved_by: null,
      resolved_at: null,
      created_at: this.nowIso(),
    });
    return id;
  }
  async listPendingConsolidations(): Promise<ConsolidationRecord[]> {
    return this.consolidations.filter((c) => c.state === 'pending' || c.state === 'escalated').map((c) => ({ ...c }));
  }
  async getConsolidationSources(candidateIds: string[]): Promise<MemoryFacts[]> {
    // mirror the live SQL: only still-LIVE (superseded_by is null) sources — a since-superseded source must not
    // appear in the preview (R10 fake-vs-live parity; #2 never approve a fold over a stale source).
    return candidateIds.filter((id) => this.liveMemories.has(id) && !this.superseded.has(id)).map((id) => ({ ...this.liveMemories.get(id)! }));
  }
  async closeConsolidation(id: string, resolvedBy: string, decision: 'approved' | 'rejected'): Promise<void> {
    const c = this.consolidations.find((x) => x.id === id);
    if (!c) throw new ConflictConsolidationError('consolidation_not_found', `closeConsolidation: '${id}' not found`);
    if (c.state === 'resolved') throw new ConflictConsolidationError('already_resolved', `closeConsolidation: '${id}' already resolved`);
    void decision;
    c.state = 'resolved';
    c.resolved_by = resolvedBy;
    c.resolved_at = this.nowIso();
  }

  async escalateOverdueConflicts(reviewEscalationDays: number, now: number = Date.parse(this.nowIso())): Promise<string[]> {
    const out: string[] = [];
    const deadline = reviewEscalationDays * 24 * 60 * 60 * 1000;
    for (const c of this.conflicts) {
      if (c.state !== 'pending') continue;
      if (now - Date.parse(c.created_at) >= deadline) {
        c.state = 'escalated';
        c.escalated_at = new Date(now).toISOString();
        out.push(c.id);
      }
    }
    return out;
  }
  async escalateOverdueConsolidations(reviewEscalationDays: number, now: number = Date.parse(this.nowIso())): Promise<string[]> {
    const out: string[] = [];
    const deadline = reviewEscalationDays * 24 * 60 * 60 * 1000;
    for (const c of this.consolidations) {
      if (c.state !== 'pending') continue;
      if (now - Date.parse(c.created_at) >= deadline) {
        c.state = 'escalated';
        c.escalated_at = new Date(now).toISOString();
        out.push(c.id);
      }
    }
    return out;
  }

  async conflictResolved(payload: Record<string, unknown>): Promise<void> {
    this.resolvedEvents.push(payload);
  }
  async consolidationQueued(payload: Record<string, unknown>): Promise<void> {
    this.queuedEvents.push(payload);
  }
  async consolidationResolved(payload: Record<string, unknown>): Promise<void> {
    this.consolidationResolvedEvents.push(payload);
  }
  async escalated(payload: Record<string, unknown>): Promise<void> {
    this.escalatedEvents.push(payload);
  }
  async audit(entry: AuditEntry): Promise<void> {
    this.audits.push({ ...entry });
  }

  // test-seam builders
  static conflict(partial: Partial<ConflictRecord> & { id: string; new_memory: HeldCandidate; conflicting_memory_ids: string[] }): ConflictRecord {
    return {
      suggested_resolution: null,
      state: 'pending',
      escalated_at: null,
      resolved_by: null,
      resolved_at: null,
      created_at: '2026-07-01T00:00:00Z',
      ...partial,
    };
  }
  static held(partial: Partial<HeldCandidate> = {}): HeldCandidate {
    return {
      type: 'semantic',
      content: 'held candidate content',
      entity_ids: ['ent-1'],
      sourceType: 'ai_inferred_weak',
      proposedConfidence: 0.7,
      source_ref: null,
      visibility: 'team',
      sensitivity: 'standard',
      expires_at: null,
      embedding_model: 'text-embedding-3-small',
      ...partial,
    };
  }
  static consolidation(partial: Partial<ConsolidationRecord> & { id: string; candidate_memory_ids: string[]; op: ConsolidationOp }): ConsolidationRecord {
    return {
      tier: 'personal',
      state: 'pending',
      escalated_at: null,
      resolved_by: null,
      resolved_at: null,
      created_at: '2026-07-01T00:00:00Z',
      ...partial,
    };
  }
}

// ── In-memory reference fake (the SoleWriter). ──────────────────────────────────────────────────────────────
export class InMemorySoleWriter implements SoleWriter {
  readonly writes: { kind: string; memoryId: string; supersede: string[] }[] = [];
  private live = new Set<string>();
  /** when set, the next write returns committed:false (to test the non-commit-does-not-close path, #3). */
  failNext = false;

  seedLive(ids: string[]): this {
    for (const id of ids) this.live.add(id);
    return this;
  }
  isLive(id: string): boolean {
    return this.live.has(id);
  }

  async keepNew(held: HeldCandidate, supersedeIds: string[], _ctx: WriteContext): Promise<KeepNewResult> {
    if (this.failNext) {
      this.failNext = false;
      return { committed: false, memoryId: null, superseded: [], note: 'governed write did not commit (simulated)' };
    }
    const memoryId = nextId('mem');
    this.live.add(memoryId);
    // CAS-supersede: only supersede still-live targets (a lost race supersedes 0 rows — ADR-004 §5).
    const superseded = supersedeIds.filter((id) => this.live.delete(id));
    this.writes.push({ kind: `keep_new:${held.type}`, memoryId, supersede: superseded });
    return { committed: true, memoryId, superseded };
  }
  async keepBoth(held: HeldCandidate, keepLiveIds: string[], note: string, _ctx: WriteContext): Promise<KeepBothResult> {
    if (this.failNext) {
      this.failNext = false;
      return { committed: false, memoryId: null, note: 'governed write did not commit (simulated)' };
    }
    const memoryId = nextId('mem');
    this.live.add(memoryId);
    void keepLiveIds;
    this.writes.push({ kind: `keep_both:${held.type}`, memoryId, supersede: [] });
    return { committed: true, memoryId, note };
  }
  async applyConsolidation(input: ApplyConsolidationInput, _ctx: WriteContext): Promise<ApplyConsolidationResult> {
    if (this.failNext) {
      this.failNext = false;
      return { committed: false, derivedId: null, superseded: [], note: 'governed consolidation did not commit (simulated)' };
    }
    const derivedId = nextId('mem');
    this.live.add(derivedId);
    const superseded = input.candidateIds.filter((id) => this.live.delete(id));
    this.writes.push({ kind: `consolidate:${input.op}`, memoryId: derivedId, supersede: superseded });
    return { committed: true, derivedId, superseded };
  }
}

// ── Free helpers ────────────────────────────────────────────────────────────────────────────────────────────
export function isPersonalTier(t: SensitivityTier): boolean {
  return t === 'personal';
}
export function isSensitiveTier(t: SensitivityTier): boolean {
  return t === 'personal' || t === 'restricted';
}
export type { MemoryFacts, SuggestedResolution, ResolutionKind };
