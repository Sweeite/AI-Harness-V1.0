// ISSUE-028 — the live pg adapters.
//
//   • SupabaseConflictConsolidationStore — the two-queue store over the real memory_conflicts / consolidation_approvals
//     / memories / event_log / access_audit schema (all baseline 0001). Every method is a single idempotent statement
//     with in-SQL enum casts, mirroring the fake 1:1 (R10). No `insert into memories` lives here (ADR-004).
//   • SupabaseSoleWriter — the governed write boundary a resolution hands off to. It re-embeds the held content
//     (dropped at quarantine) and routes the actual memory mutation through ISSUE-024's row builder + ISSUE-027's
//     governed write primitives (insertDerivedMemory ON CONFLICT DO NOTHING + casSupersede WHERE superseded_by IS
//     NULL). It never issues a direct insert of its own — it composes the already-R10-proven sole-writer primitives.

import pg from 'pg';
import { randomUUID } from 'node:crypto';
import type { MemoryRow } from '../../memory/src/store.ts';
import type { MemoryType, VisibilityTier, SensitivityTier as MemSensitivityTier } from '../../memory/src/entity-types.ts';
import { buildMemoryRow, type MemoryDraft } from '../../memory-write/src/commit.ts';
import type { SourceType } from '../../memory-write/src/confidence.ts';
import type {
  ConflictConsolidationStore,
  ConflictRecord,
  ConsolidationRecord,
  ConsolidationOp,
  SensitivityTier,
  SoleWriter,
  WriteContext,
  HeldCandidate,
  KeepNewResult,
  KeepBothResult,
  ApplyConsolidationInput,
  ApplyConsolidationResult,
  AuditEntry,
  MemoryFacts,
} from './store.ts';
import type { SuggestedResolution } from './priority.ts';

export type QueryExec = <R extends pg.QueryResultRow>(text: string, params?: unknown[]) => Promise<{ rows: R[]; rowCount?: number | null }>;

// ── Additive event_type values this slice emits (migration 0044). The escalation alert REUSES baseline
//    'approval_queue_stale' (both queues are approval queues — no migration for that one). ────────────────────
export const EVT_CONFLICT_RESOLVED = 'memory_conflict_resolved';
export const EVT_CONSOLIDATION_QUEUED = 'memory_consolidation_queued';
export const EVT_CONSOLIDATION_RESOLVED = 'memory_consolidation_resolved';
export const EVT_APPROVAL_STALE = 'approval_queue_stale'; // baseline (reused)
export const CONFLICT_CONSOLIDATION_EVENT_TYPES: readonly string[] = [EVT_CONFLICT_RESOLVED, EVT_CONSOLIDATION_QUEUED, EVT_CONSOLIDATION_RESOLVED];

interface ConflictDbRow {
  id: string;
  new_memory: HeldCandidate;
  conflicting_memory_ids: string[];
  suggested_resolution: SuggestedResolution | null;
  state: 'pending' | 'escalated' | 'resolved';
  escalated_at: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}
interface ConsolidationDbRow {
  id: string;
  candidate_memory_ids: string[];
  op: ConsolidationOp;
  tier: SensitivityTier;
  state: 'pending' | 'escalated' | 'resolved';
  escalated_at: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}
interface MemoryFactsDbRow {
  id: string;
  source: 'ai_inferred' | 'human_verified' | 'system_pointer';
  confidence: string | null;
  created_at: string;
}

export class SupabaseConflictConsolidationStore implements ConflictConsolidationStore {
  constructor(private readonly exec: QueryExec) {}

  async listPendingConflicts(): Promise<ConflictRecord[]> {
    const r = await this.exec<ConflictDbRow>(
      `select id::text as id, new_memory, conflicting_memory_ids::text[] as conflicting_memory_ids, suggested_resolution,
              state::text as state, escalated_at, resolved_by::text as resolved_by, resolved_at, created_at
         from memory_conflicts where state in ('pending','escalated') order by created_at asc`,
    );
    return r.rows.map(toConflictRecord);
  }

  async getLiveConflictingMemories(conflictingIds: string[]): Promise<MemoryFacts[]> {
    if (conflictingIds.length === 0) return [];
    const r = await this.exec<MemoryFactsDbRow>(
      `select id::text as id, source::text as source, confidence::text as confidence, created_at
         from memories where id = any($1::uuid[]) and superseded_by is null`,
      [conflictingIds],
    );
    return r.rows.map(toMemoryFacts);
  }

  async attachSuggestedResolution(conflictId: string, resolution: SuggestedResolution): Promise<void> {
    await this.exec(`update memory_conflicts set suggested_resolution = $2::jsonb where id = $1`, [conflictId, JSON.stringify(resolution)]);
  }

  async closeConflict(conflictId: string, resolvedBy: string, resolution: SuggestedResolution): Promise<void> {
    const { rowCount } = await this.exec(
      `update memory_conflicts set state = 'resolved', resolved_by = $2::uuid, resolved_at = now(), suggested_resolution = $3::jsonb
         where id = $1 and state <> 'resolved'`,
      [conflictId, resolvedBy, JSON.stringify(resolution)],
    );
    if (!rowCount) throw new Error(`closeConflict: '${conflictId}' not found or already resolved`);
  }

  async enqueueConsolidation(candidateIds: string[], op: ConsolidationOp, tier: SensitivityTier): Promise<string> {
    const r = await this.exec<{ id: string }>(
      `insert into consolidation_approvals (candidate_memory_ids, op, tier, state)
         values ($1::uuid[], $2::consolidation_op, $3::sensitivity_tier, 'pending') returning id::text as id`,
      [candidateIds, op, tier],
    );
    return r.rows[0]!.id;
  }

  async listPendingConsolidations(): Promise<ConsolidationRecord[]> {
    const r = await this.exec<ConsolidationDbRow>(
      `select id::text as id, candidate_memory_ids::text[] as candidate_memory_ids, op::text as op, tier::text as tier,
              state::text as state, escalated_at, resolved_by::text as resolved_by, resolved_at, created_at
         from consolidation_approvals where state in ('pending','escalated') order by created_at asc`,
    );
    return r.rows.map(toConsolidationRecord);
  }

  async getConsolidationSources(candidateIds: string[]): Promise<MemoryFacts[]> {
    if (candidateIds.length === 0) return [];
    const r = await this.exec<MemoryFactsDbRow>(
      `select id::text as id, source::text as source, confidence::text as confidence, created_at
         from memories where id = any($1::uuid[]) and superseded_by is null`,
      [candidateIds],
    );
    return r.rows.map(toMemoryFacts);
  }

  async closeConsolidation(id: string, resolvedBy: string, decision: 'approved' | 'rejected'): Promise<void> {
    void decision;
    const { rowCount } = await this.exec(
      `update consolidation_approvals set state = 'resolved', resolved_by = $2::uuid, resolved_at = now()
         where id = $1 and state <> 'resolved'`,
      [id, resolvedBy],
    );
    if (!rowCount) throw new Error(`closeConsolidation: '${id}' not found or already resolved`);
  }

  async escalateOverdueConflicts(reviewEscalationDays: number, _now?: number): Promise<string[]> {
    void _now;
    const r = await this.exec<{ id: string }>(
      `update memory_conflicts set state = 'escalated', escalated_at = now()
         where state = 'pending' and created_at <= now() - ($1 || ' days')::interval returning id::text as id`,
      [String(reviewEscalationDays)],
    );
    return r.rows.map((x) => x.id);
  }

  async escalateOverdueConsolidations(reviewEscalationDays: number, _now?: number): Promise<string[]> {
    void _now;
    const r = await this.exec<{ id: string }>(
      `update consolidation_approvals set state = 'escalated', escalated_at = now()
         where state = 'pending' and created_at <= now() - ($1 || ' days')::interval returning id::text as id`,
      [String(reviewEscalationDays)],
    );
    return r.rows.map((x) => x.id);
  }

  async conflictResolved(payload: Record<string, unknown>): Promise<void> {
    await this.emit(EVT_CONFLICT_RESOLVED, [], 'hard-conflict resolved', payload);
  }
  async consolidationQueued(payload: Record<string, unknown>): Promise<void> {
    await this.emit(EVT_CONSOLIDATION_QUEUED, [], 'Personal-tier consolidation queued for approval', payload);
  }
  async consolidationResolved(payload: Record<string, unknown>): Promise<void> {
    await this.emit(EVT_CONSOLIDATION_RESOLVED, [], 'Personal-tier consolidation resolved', payload);
  }
  async escalated(payload: Record<string, unknown>): Promise<void> {
    await this.emit(EVT_APPROVAL_STALE, [], 'review item escalated (overdue past review_escalation_days)', payload);
  }
  async audit(entry: AuditEntry): Promise<void> {
    await this.exec(
      `insert into access_audit (audit_type, actor_identity, actor_type, action, target_type, reason, path_context, originating_user_id)
         values ($1, $2, $3::actor_type, $4, $5, $6, $7, $8::uuid)`,
      [entry.auditType, entry.actorIdentity, entry.actorType, entry.action, entry.targetType, entry.reason, entry.pathContext, entry.originatingUserId],
    );
  }

  private async emit(eventType: string, entityIds: string[], summary: string, payload: Record<string, unknown>): Promise<void> {
    await this.exec(
      `insert into event_log (event_type, entity_ids, summary, payload, created_at)
         values ($1::event_type, $2::uuid[], $3, $4::jsonb, now())`,
      [eventType, entityIds, summary, JSON.stringify(payload)],
    );
  }
}

// ── The governed write primitives this adapter composes (structurally satisfied by ISSUE-027's SupabaseMaintenanceStore). ──
export interface GovernedMemoryWriter {
  insertDerivedMemory(row: MemoryRow, derivedFrom: string[]): Promise<{ inserted: boolean; id: string }>;
  casSupersede(oldId: string, newId: string): Promise<boolean>;
}
export type Embedder = (content: string) => Promise<number[]>;
/** produce the derived MemoryRow for an approved merge/summarise (ISSUE-027 owns the content computation). */
export type Consolidator = (candidateIds: string[], op: ConsolidationOp) => Promise<MemoryRow>;

export class SupabaseSoleWriter implements SoleWriter {
  constructor(
    private readonly governed: GovernedMemoryWriter,
    private readonly embed: Embedder,
    private readonly consolidate: Consolidator,
    private readonly genId: () => string = () => randomUUID(),
    private readonly nowIso: () => string = () => new Date().toISOString(),
  ) {}

  private async buildRow(held: HeldCandidate): Promise<MemoryRow> {
    const embedding = await this.embed(held.content);
    const draft: MemoryDraft = {
      type: held.type as MemoryType,
      content: held.content,
      entity_ids: held.entity_ids,
      sourceType: held.sourceType as SourceType,
      proposedConfidence: held.proposedConfidence ?? null,
      source_ref: held.source_ref,
      visibility: held.visibility as VisibilityTier,
      sensitivity: held.sensitivity as MemSensitivityTier,
      expires_at: held.expires_at,
      embedding,
      embedding_model: held.embedding_model,
    };
    return buildMemoryRow(draft, this.genId(), this.nowIso());
  }

  async keepNew(held: HeldCandidate, supersedeIds: string[], _ctx: WriteContext): Promise<KeepNewResult> {
    const row = await this.buildRow(held);
    const { inserted, id } = await this.governed.insertDerivedMemory(row, supersedeIds);
    if (!inserted) return { committed: false, memoryId: id, superseded: [], note: 'idempotent no-op — memory already present' };
    const superseded: string[] = [];
    for (const oldId of supersedeIds) {
      if (await this.governed.casSupersede(oldId, id)) superseded.push(oldId);
    }
    return { committed: true, memoryId: id, superseded };
  }

  async keepBoth(held: HeldCandidate, _keepLiveIds: string[], note: string, _ctx: WriteContext): Promise<KeepBothResult> {
    const row = await this.buildRow(held);
    const { inserted, id } = await this.governed.insertDerivedMemory(row, []);
    return { committed: inserted, memoryId: id, note: inserted ? note : 'idempotent no-op — memory already present' };
  }

  async applyConsolidation(input: ApplyConsolidationInput, _ctx: WriteContext): Promise<ApplyConsolidationResult> {
    const derived = await this.consolidate(input.candidateIds, input.op);
    const { inserted, id } = await this.governed.insertDerivedMemory(derived, input.candidateIds);
    if (!inserted) return { committed: false, derivedId: id, superseded: [], note: 'idempotent no-op — derived memory already present' };
    const superseded: string[] = [];
    for (const src of input.candidateIds) {
      if (await this.governed.casSupersede(src, id)) superseded.push(src);
    }
    return { committed: true, derivedId: id, superseded };
  }
}

// ── row mappers ─────────────────────────────────────────────────────────────────────────────────────────────
function toConflictRecord(r: ConflictDbRow): ConflictRecord {
  return {
    id: r.id,
    new_memory: r.new_memory,
    conflicting_memory_ids: r.conflicting_memory_ids ?? [],
    suggested_resolution: r.suggested_resolution,
    state: r.state,
    escalated_at: r.escalated_at,
    resolved_by: r.resolved_by,
    resolved_at: r.resolved_at,
    created_at: typeof r.created_at === 'string' ? r.created_at : new Date(r.created_at as unknown as number).toISOString(),
  };
}
function toConsolidationRecord(r: ConsolidationDbRow): ConsolidationRecord {
  return {
    id: r.id,
    candidate_memory_ids: r.candidate_memory_ids ?? [],
    op: r.op,
    tier: r.tier,
    state: r.state,
    escalated_at: r.escalated_at,
    resolved_by: r.resolved_by,
    resolved_at: r.resolved_at,
    created_at: typeof r.created_at === 'string' ? r.created_at : new Date(r.created_at as unknown as number).toISOString(),
  };
}
function toMemoryFacts(r: MemoryFactsDbRow): MemoryFacts {
  return {
    id: r.id,
    source: r.source,
    createdAt: typeof r.created_at === 'string' ? r.created_at : new Date(r.created_at as unknown as number).toISOString(),
    confidence: r.confidence == null ? null : Number(r.confidence),
  };
}
