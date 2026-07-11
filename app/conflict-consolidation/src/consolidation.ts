// ISSUE-028 — the Personal-tier consolidation approval gate (FR-2.MNT.014 / OD-037).
//
// ISSUE-027's weekly merge (FR-2.MNT.005) + episodic→semantic summarise (FR-2.MNT.007) jobs CALL this gate before
// folding a candidate. Skip-by-default: a Personal-tier candidate is NEVER auto-consolidated (AC-2.MNT.014.1 —
// auto-folding Personal data into a broader, more-injected memory would broaden its exposure beyond its tier, a #2
// failure). It is skipped and queued into `consolidation_approvals`; a Personal-cleared human then Approves (route
// through the sole writer, evidence retained) or Rejects (keep separate). Standard/confidential/restricted-tier
// consolidation is decided by 027 and never reaches this queue.

import type { ConflictConsolidationStore, ConsolidationOp, SensitivityTier, SoleWriter, WriteContext } from './store.ts';
import { ConflictConsolidationError, highestTier } from './store.ts';

export interface ConsolidationCandidate {
  candidateMemoryIds: string[];
  op: ConsolidationOp;
  /** the sensitivity tier of EACH candidate row — the FULL set, NOT a pre-reduced scalar. The gate must see every
   *  tier: reducing a mixed set to its max (e.g. {personal, restricted} → restricted) and testing `=== personal`
   *  would let a set CONTAINING Personal data slip past into auto-consolidation — the #2 hole FR-2.MNT.014 forbids. */
  tiers: SensitivityTier[];
}

export interface GateOutcome {
  /** true → 027 must NOT auto-consolidate this candidate (it has been queued for human approval instead). */
  skipped: boolean;
  /** the consolidation_approvals row id when queued; null when 027 may proceed. */
  approvalId: string | null;
  detail: string;
}

/** The gate ISSUE-027's merge/summarise jobs call. A candidate set containing ANY Personal- OR Restricted-tier row →
 *  skip + queue for human approval; otherwise 027 owns the decision. FR-2.MNT.014 names Personal explicitly;
 *  Restricted is the strictly-MORE-sensitive tier, so auto-folding it into a broader/more-injected memory is at least
 *  as severe a #2 exposure-broadening — and the #2 invariant wins over the FR's literal scope (CLAUDE.md), so it is
 *  gated too (fail-safe, never silently broaden the most sensitive tiers). The queued row records the set's HIGHEST
 *  tier so the clearance-before-view gate reflects the true sensitivity (a personal+restricted set needs restricted
 *  clearance to review). */
export async function gateConsolidation(store: ConflictConsolidationStore, candidate: ConsolidationCandidate): Promise<GateOutcome> {
  const mustGate = candidate.tiers.some((t) => t === 'personal' || t === 'restricted');
  if (!mustGate) {
    // No Personal/Restricted member: 027 owns the decision.
    return { skipped: false, approvalId: null, detail: 'no Personal/Restricted-tier member — 027 may auto-consolidate' };
  }
  const tier = highestTier(candidate.tiers);
  const approvalId = await store.enqueueConsolidation(candidate.candidateMemoryIds, candidate.op, tier);
  await store.consolidationQueued({
    approval_id: approvalId,
    op: candidate.op,
    candidate_memory_ids: candidate.candidateMemoryIds,
    tier,
    reason: 'Personal-tier candidate withheld from auto-consolidation (FR-2.MNT.014)',
  });
  return { skipped: true, approvalId, detail: 'Personal-tier candidate skipped + queued for human approval' };
}

export type ConsolidationDecision = 'approve' | 'reject';

export interface ResolveConsolidationInput {
  approvalId: string;
  decision: ConsolidationDecision;
  ctx: WriteContext;
}

export interface ResolveConsolidationOutcome {
  status: 'approved' | 'rejected' | 'write_incomplete';
  approvalId: string;
  derivedId?: string | null;
  superseded?: string[];
  detail: string;
}

/** Apply a Personal-cleared reviewer's Approve/Reject. Approve routes the merge/summarise through the sole writer;
 *  the queue row is closed only when the governed consolidation committed (a non-commit surfaces loudly, #3). Reject
 *  leaves the source memories separate. Both decisions are audited (Personal data → access_audit, FR-1.AUD.001). */
export async function resolveConsolidation(
  store: ConflictConsolidationStore,
  writer: SoleWriter,
  input: ResolveConsolidationInput,
): Promise<ResolveConsolidationOutcome> {
  const pending = await store.listPendingConsolidations();
  const record = pending.find((c) => c.id === input.approvalId);
  if (!record) throw new ConflictConsolidationError('consolidation_not_actionable', `resolveConsolidation: '${input.approvalId}' is not a pending/escalated approval`);

  // Personal consolidation resolution → access_audit (both approve and reject).
  await store.audit({
    auditType: 'personal_consolidation_review',
    actorIdentity: input.ctx.reviewerIdentity,
    actorType: 'user',
    action: `consolidation_${input.decision}:${record.op}`,
    targetType: 'consolidation_approval',
    reason: input.ctx.reason ?? null,
    pathContext: `surface-03/consolidation/${record.id}`,
    originatingUserId: input.ctx.reviewerId,
  });

  if (input.decision === 'reject') {
    await store.closeConsolidation(record.id, input.ctx.reviewerId, 'rejected');
    await store.consolidationResolved({ approval_id: record.id, decision: 'rejected', op: record.op, reviewer: input.ctx.reviewerIdentity, reason: input.ctx.reason ?? null });
    return { status: 'rejected', approvalId: record.id, detail: 'sources kept separate; reason logged' };
  }

  // approve — never fold a set we cannot FULLY resolve to live sources (a since-superseded / unreadable source means
  // the preview is partial → block + surface, keep actionable; #2 "never approve a fold you can't fully preview").
  const sources = await store.getConsolidationSources(record.candidate_memory_ids);
  if (sources.length !== record.candidate_memory_ids.length) {
    await store.consolidationResolved({ approval_id: record.id, decision: 'approve', committed: false, note: 'candidate sources incomplete — approval blocked' });
    return { status: 'write_incomplete', approvalId: record.id, detail: `approve blocked: ${sources.length}/${record.candidate_memory_ids.length} candidate sources still live/resolvable (#2 partial guard) — record left actionable` };
  }

  // route through the sole writer.
  const r = await writer.applyConsolidation({ candidateIds: record.candidate_memory_ids, op: record.op }, input.ctx);
  if (!r.committed) {
    await store.consolidationResolved({ approval_id: record.id, decision: 'approve', committed: false, note: r.note ?? 'writer non-commit' });
    return { status: 'write_incomplete', approvalId: record.id, detail: `approve: governed consolidation did not commit (${r.note ?? 'unknown'}) — record left actionable` };
  }
  await store.closeConsolidation(record.id, input.ctx.reviewerId, 'approved');
  await store.consolidationResolved({ approval_id: record.id, decision: 'approved', op: record.op, derived_id: r.derivedId, superseded: r.superseded, reviewer: input.ctx.reviewerIdentity });
  return { status: 'approved', approvalId: record.id, derivedId: r.derivedId, superseded: r.superseded, detail: 'consolidation applied through the sole writer; sources superseded, evidence retained' };
}
