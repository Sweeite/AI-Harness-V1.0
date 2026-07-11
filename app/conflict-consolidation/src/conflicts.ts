// ISSUE-028 — the hard-conflict quarantine review path (FR-2.WRT.002 hard branch + FR-2.MNT.008 suggested resolution).
//
// ISSUE-024's write path already HOLDS a hard conflict: it inserts the pending `memory_conflicts` row (new memory NOT
// in the live set, old untouched — AC-2.WRT.002.2) and owns the escalation-sweep mechanism. This slice adds the human
// side: attach the priority-rule *suggested* resolution to each pending row (the resolver, FR-2.MNT.008), and apply a
// reviewer's decision — Keep-new / Keep-existing / Keep-both — routing every memory mutation through the sole writer
// (ADR-004, never a direct insert), and surfacing a writer-side non-commit loudly instead of falsely closing (#3).

import { suggestResolution, type SuggestedResolution } from './priority.ts';
import type { ConflictConsolidationStore, ConflictRecord, SoleWriter, WriteContext, MemoryFacts } from './store.ts';
import { ConflictConsolidationError, isSensitiveTier, resolverSourceOf, type SensitivityTier } from './store.ts';

/** A pending conflict decorated with its computed suggested resolution + the live side-by-side memories the surface
 *  renders. `previewComplete` is false when a conflicting id could not be resolved to a live memory (partial load —
 *  the surface must then disable the resolve actions, #2). */
export interface DecoratedConflict {
  record: ConflictRecord;
  existing: MemoryFacts[];
  suggested: SuggestedResolution;
  previewComplete: boolean;
}

/** List the pending/escalated conflicts, computing (and persisting) the suggested resolution for any row that lacks
 *  one. Persisting is idempotent: a row already carrying a suggestion is not recomputed unless its live set changed. */
export async function listConflictsForReview(store: ConflictConsolidationStore): Promise<DecoratedConflict[]> {
  const rows = await store.listPendingConflicts();
  const out: DecoratedConflict[] = [];
  for (const record of rows) {
    const existing = await store.getLiveConflictingMemories(record.conflicting_memory_ids);
    const previewComplete = existing.length === record.conflicting_memory_ids.length;
    const newFacts = heldToFacts(record);
    const suggested = suggestResolution(newFacts, existing);
    // Persist the suggestion if absent or stale (kind changed) — the surface + audit read it from the row.
    if (!record.suggested_resolution || record.suggested_resolution.kind !== suggested.kind) {
      await store.attachSuggestedResolution(record.id, suggested);
      record.suggested_resolution = suggested;
    }
    out.push({ record, existing, suggested, previewComplete });
  }
  return out;
}

/** The three reviewer actions on a quarantined hard conflict. */
export type ConflictAction = 'keep_new' | 'keep_existing' | 'keep_both';

export interface ResolveConflictInput {
  conflictId: string;
  action: ConflictAction;
  /** the reviewer + their identity (PERM-memory.review_conflict already gated upstream). */
  ctx: WriteContext;
  /** for keep_both: the note that will accompany both memories at retrieval (OD-032). */
  note?: string;
}

export interface ResolveConflictOutcome {
  status: 'resolved' | 'write_incomplete' | 'no_op';
  conflictId: string;
  memoryId?: string | null;
  superseded?: string[];
  detail: string;
}

/** Apply a reviewer's decision. Every memory mutation goes through the sole writer; the quarantine record is closed
 *  (state=resolved) ONLY when the governed write actually committed — a writer-side non-commit returns
 *  `write_incomplete`, leaves the record actionable, and surfaces loudly (#3). */
export async function resolveConflict(
  store: ConflictConsolidationStore,
  writer: SoleWriter,
  input: ResolveConflictInput,
): Promise<ResolveConflictOutcome> {
  const pending = await store.listPendingConflicts();
  const record = pending.find((c) => c.id === input.conflictId);
  if (!record) throw new ConflictConsolidationError('conflict_not_actionable', `resolveConflict: '${input.conflictId}' is not a pending/escalated conflict`);

  // Only supersede targets that are STILL live (a target may have been superseded since quarantine).
  const liveExisting = await store.getLiveConflictingMemories(record.conflicting_memory_ids);
  const liveIds = liveExisting.map((m) => m.id);
  const suggested = suggestResolution(heldToFacts(record), liveExisting);

  // Audit any view/resolution touching a Personal/Restricted held candidate (FR-1.AUD.001).
  await auditIfSensitive(store, record, input, 'conflict_resolution');

  if (input.action === 'keep_existing') {
    // Discard the held write; existing untouched. No memory mutation → close directly, reason logged. Persist an
    // OUTCOME-shaped resolution (keep_existing) — not the algorithm's suggestion — so the audited row reflects the
    // human's actual decision (Finding-6 fix).
    const outcome: SuggestedResolution = { kind: 'keep_existing', winnerId: liveIds[0] ?? null, humanFlagged: false, ruleApplied: suggested.ruleApplied, note: 'reviewer kept existing; held write discarded' };
    await store.closeConflict(record.id, input.ctx.reviewerId, outcome);
    await store.conflictResolved({ conflict_id: record.id, action: 'keep_existing', reviewer: input.ctx.reviewerIdentity, reason: input.ctx.reason ?? null });
    return { status: 'resolved', conflictId: record.id, detail: 'held write discarded; existing memory untouched' };
  }

  if (input.action === 'keep_new') {
    const r = await writer.keepNew(record.new_memory, liveIds, input.ctx);
    if (!r.committed) {
      // #3 — the governed write did not commit; do NOT close. Stays actionable + loud.
      await store.conflictResolved({ conflict_id: record.id, action: 'keep_new', committed: false, note: r.note ?? 'writer non-commit' });
      return { status: 'write_incomplete', conflictId: record.id, detail: `keep_new: governed write did not commit (${r.note ?? 'unknown'}) — record left actionable` };
    }
    await store.closeConflict(record.id, input.ctx.reviewerId, suggested);
    await store.conflictResolved({ conflict_id: record.id, action: 'keep_new', memory_id: r.memoryId, superseded: r.superseded, reviewer: input.ctx.reviewerIdentity });
    return { status: 'resolved', conflictId: record.id, memoryId: r.memoryId, superseded: r.superseded, detail: 'new memory written; existing CAS-superseded (chain intact)' };
  }

  // keep_both — retain both live (supersede nothing), link with a note; close the record (never left dangling).
  const note = input.note ?? suggested.note;
  const r = await writer.keepBoth(record.new_memory, liveIds, note, input.ctx);
  if (!r.committed) {
    await store.conflictResolved({ conflict_id: record.id, action: 'keep_both', committed: false, note: r.note ?? 'writer non-commit' });
    return { status: 'write_incomplete', conflictId: record.id, detail: `keep_both: governed write did not commit (${r.note ?? 'unknown'}) — record left actionable` };
  }
  const kept: SuggestedResolution = { kind: 'keep_both_with_note', winnerId: null, humanFlagged: true, ruleApplied: 5, note };
  await store.closeConflict(record.id, input.ctx.reviewerId, kept);
  await store.conflictResolved({ conflict_id: record.id, action: 'keep_both', memory_id: r.memoryId, kept_live: liveIds, note, reviewer: input.ctx.reviewerIdentity });
  return { status: 'resolved', conflictId: record.id, memoryId: r.memoryId, detail: 'both retained live + linked with a note; retrieval injects both (OD-032)' };
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────────
function heldToFacts(record: ConflictRecord): MemoryFacts {
  // The held candidate is not yet a live row (id is the conflict id proxy); confidence is the proposed value.
  return {
    id: `held:${record.id}`,
    source: resolverSourceOf(record.new_memory.sourceType),
    createdAt: record.created_at,
    confidence: record.new_memory.proposedConfidence ?? null,
  };
}

async function auditIfSensitive(store: ConflictConsolidationStore, record: ConflictRecord, input: ResolveConflictInput, action: string): Promise<void> {
  const tier = record.new_memory.sensitivity as SensitivityTier;
  if (!isSensitiveTier(tier)) return;
  await store.audit({
    auditType: 'memory_conflict_review',
    actorIdentity: input.ctx.reviewerIdentity,
    actorType: 'user',
    action: `${action}:${input.action}`,
    targetType: 'memory_conflict',
    reason: input.ctx.reason ?? null,
    pathContext: `surface-03/conflicts/${record.id}`,
    originatingUserId: input.ctx.reviewerId,
  });
}
