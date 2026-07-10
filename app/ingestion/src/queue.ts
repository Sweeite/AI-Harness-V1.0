// ISSUE-026 (C2 ING) — the human ingestion review queue logic (FR-2.ING.003/004/005). Include / Exclude / Defer,
// every decision logged (who/when/why); the queue-exit-only-via-a-logged-decision invariant; the HR default-Exclude
// gate; the un-actioned-escalation signal; the Deferred auto-resurface. Include is the ONLY path a FLAGGED item
// reaches the sole writer — it routes through the no-backdoor gate with an explicit-human-Include provenance stamp.

import type { SensitivityTier } from '../../memory/src/entity-types.ts';
import type { Mention } from '../../memory/src/resolution.ts';
import type { SourceEvent, WriteOutcome } from '../../memory-write/src/writer.ts';
import type { TaskAuthz } from '../../memory-write/src/commit.ts';
import type { IngestionConfig } from './config.ts';
import type { FlagReason } from './filters.ts';
import type {
  EscalationSample,
  IngestionStore,
  MemoryWriteGate,
  ObservabilitySink,
  QueueRow,
} from './store.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface QueueDeps {
  store: IngestionStore;
  gate: MemoryWriteGate;
  observ: ObservabilitySink;
  config: IngestionConfig;
}

/** Raised when a reviewer action is refused by a guard (a bad-state / missing-context / HR-off refusal). Machine
 *  `reason` so the surface disables the right action and never silently no-ops (#3). */
export class QueueDecisionError extends Error {
  constructor(
    public reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'QueueDecisionError';
  }
}

export interface HoldFlaggedInput {
  content: string;
  sourceRef: string | null;
  flagReason: FlagReason;
  suggestedTier: SensitivityTier;
  targetEntityId: string | null;
  createdAt?: string;
}

export interface ShadowRetainInput {
  content: string;
  sourceRef: string | null;
  targetEntityId: string | null;
  createdAt?: string;
}

export interface IncludeInput {
  queueId: string;
  /** The confirmed/overridden sensitivity tier (pre-filled with suggested_tier, overridable — OD-116). MUST be known:
   *  an Include of an item whose sensitivity context did not load is refused (#2). */
  tier: SensitivityTier;
  /** The reviewer (Admin/Super Admin, PERM-ingestion.review) making the explicit Include decision. */
  reviewer: string;
  /** The authz context for the sole writer's FR-1.RLS.007 commit-boundary re-check (supplied by the surface). */
  task: TaskAuthz;
  /** The entity mentions the writer reasons over (optional; the surface supplies the target-entity mention). */
  contextEntities?: Mention[];
  reason?: string;
  nowIso?: string;
}

export interface ExcludeInput {
  queueId: string;
  reviewer: string;
  /** REQUIRED — an Exclude captures who/when/WHY (AC-2.ING.003.1). An empty reason is refused. */
  reason: string;
  nowIso?: string;
}

export interface DeferInput {
  queueId: string;
  reviewer: string;
  reason?: string;
  nowIso?: string;
}

export class IngestionQueue {
  constructor(private readonly deps: QueueDeps) {}

  // ── enqueue paths ─────────────────────────────────────────────────────────────────────────────────────────────
  /** Filter 2 flagged the item → HOLD in the queue (state=pending), never auto-written (FR-2.ING.002/004). */
  async holdFlagged(input: HoldFlaggedInput): Promise<QueueRow> {
    const row = await this.deps.store.enqueue({
      content: input.content,
      source_ref: input.sourceRef,
      flag_reason: input.flagReason,
      suggested_tier: input.suggestedTier,
      target_entity_id: input.targetEntityId,
      state: 'pending',
      created_at: input.createdAt,
    });
    await this.deps.observ.filterDecision({ filter: 'sensitivity', verdict: 'flag', reason: input.flagReason, targetEntityId: input.targetEntityId });
    return row;
  }

  /** Filter 1 (trust window active) would-drop → SHADOW RETAIN (state=shadow_dropped), never lost (AC-2.ING.001.2). */
  async shadowRetain(input: ShadowRetainInput): Promise<QueueRow> {
    const row = await this.deps.store.enqueue({
      content: input.content,
      source_ref: input.sourceRef,
      flag_reason: 'shadow_dropped',
      suggested_tier: null,
      target_entity_id: input.targetEntityId,
      state: 'shadow_dropped',
      created_at: input.createdAt,
    });
    await this.deps.observ.filterDecision({ filter: 'relevance', verdict: 'shadow_drop', reason: 'trust-window would-drop retained', targetEntityId: input.targetEntityId });
    return row;
  }

  // ── the HR default-Exclude gate (FR-2.ING.005 / NFR-CMP.010) ────────────────────────────────────────────────────
  /** The default reviewer decision the surface pre-selects. HR-flagged content with hr_content_enabled OFF defaults to
   *  Exclude (AC-2.ING.005.1) — HR content is out of memory by default. Everything else is a human 'review'. */
  defaultReviewerDecision(row: QueueRow): 'exclude' | 'review' {
    if (row.flag_reason === 'hr' && !this.deps.config.hrContentEnabled) return 'exclude';
    return 'review';
  }

  // ── reviewer decisions ──────────────────────────────────────────────────────────────────────────────────────────
  /** Include: confirm/override the tier → hand the item to the SOLE WRITER through the no-backdoor gate (FR-2.ING.010),
   *  then mark included + audit (who/when/tier). The writer's outcome is RETURNED — a writer-side hold (rate-limit /
   *  fresh hard conflict) surfaces to the caller, it does not vanish (#3). */
  async include(input: IncludeInput): Promise<{ row: QueueRow; outcome: WriteOutcome }> {
    const row = await this.requireActionable(input.queueId);
    // #2 guard: never Include an item whose sensitivity context didn't load (no tier). The surface disables Include.
    if (!input.tier) throw new QueueDecisionError('tier_unknown', 'cannot Include without a confirmed sensitivity tier (context did not load)');
    // #2 guard: HR content is Exclude-by-default — it may not be Included while hr_content_enabled is OFF (NFR-CMP.010).
    if (row.flag_reason === 'hr' && !this.deps.config.hrContentEnabled) {
      throw new QueueDecisionError('hr_disabled', 'HR content is disabled by default (hr_content_enabled=false) — Exclude is the only decision until legally enabled');
    }

    const event: SourceEvent = {
      taskId: input.task.taskId,
      summary: row.content,
      sourceEventRef: row.source_ref ?? `ingestion_queue:${row.id}`,
      contextEntities: input.contextEntities,
    };
    // Route through the sole writer WITH an explicit-human-Include provenance stamp. The gate refuses any un-gated
    // route (no relevance/sensitivity, or a flagged item without includedBy) — the no-backdoor invariant in code.
    const outcome = await this.deps.gate.route({
      event,
      task: input.task,
      provenance: { relevance: 'passed', sensitivity: 'included', includedBy: input.reviewer },
    });

    // #1/#3 — the row becomes terminal 'included' ONLY when the sole writer actually COMMITTED. A non-commit
    // (deferred_rate_limited / halted_embed_failure) must NEVER mark the item done: the candidate would be silently
    // lost + unrecoverable. On a non-commit the row stays ACTIONABLE (unchanged) so a re-Include (or auto-retry)
    // re-attempts the write, and the deferral is surfaced LOUDLY (never a silent no-op). The reviewer's Include intent
    // is preserved, not consumed.
    if (outcome.kind !== 'committed') {
      await this.deps.observ.filterDecision({
        filter: 'sensitivity',
        verdict: 'include_write_deferred',
        reason: outcome.reason,
        targetEntityId: row.target_entity_id,
      });
      return { row, outcome };
    }

    const at = input.nowIso ?? new Date().toISOString();
    const updated = await this.deps.store.transition(row.id, {
      state: 'included',
      reviewedBy: input.reviewer,
      reviewedAt: at,
      decisionReason: input.reason ?? `included at tier ${input.tier}`,
    });
    await this.deps.store.appendAudit({
      auditType: 'ingestion_decision',
      action: 'include',
      actorType: 'user',
      actorIdentity: input.reviewer,
      reviewerUserId: input.reviewer,
      queueId: row.id,
      targetEntityId: row.target_entity_id,
      reason: input.reason ?? null,
      tier: input.tier,
    });
    return { row: updated, outcome };
  }

  /** A clean item whose sole-writer write did NOT commit (rate-limited / embed halt) — HELD in the queue (state=pending)
   *  for retry, never lost (#1). Used by ingestCandidate so a deferred clean write is not falsely reported 'written'. */
  async holdForRetry(input: ShadowRetainInput & { reason: string }): Promise<QueueRow> {
    const row = await this.deps.store.enqueue({
      content: input.content,
      source_ref: input.sourceRef,
      flag_reason: 'write_deferred',
      suggested_tier: null,
      target_entity_id: input.targetEntityId,
      state: 'pending',
      created_at: input.createdAt,
    });
    await this.deps.observ.filterDecision({ filter: 'sensitivity', verdict: 'write_deferred', reason: input.reason, targetEntityId: input.targetEntityId });
    return row;
  }

  /** Exclude: discard permanently, reason logged (who/when/why) — the memory is never written (AC-2.ING.003.1). */
  async exclude(input: ExcludeInput): Promise<QueueRow> {
    const row = await this.requireActionable(input.queueId);
    if (!input.reason || input.reason.trim().length === 0) {
      throw new QueueDecisionError('reason_required', 'an Exclude must capture WHY (who/when/why — AC-2.ING.003.1)');
    }
    const at = input.nowIso ?? new Date().toISOString();
    const updated = await this.deps.store.transition(row.id, {
      state: 'excluded',
      reviewedBy: input.reviewer,
      reviewedAt: at,
      decisionReason: input.reason,
    });
    await this.deps.store.appendAudit({
      auditType: 'ingestion_decision',
      action: 'exclude',
      actorType: 'user',
      actorIdentity: input.reviewer,
      reviewerUserId: input.reviewer,
      queueId: row.id,
      targetEntityId: row.target_entity_id,
      reason: input.reason,
    });
    return updated;
  }

  /** Defer: hold the item; it auto-resurfaces after ingest_defer_resurface_days — never an indefinite silent hold (#3).
   *  Refused when the resurface cadence is unknown (a Defer that can't guarantee its resurface would be a silent hold). */
  async defer(input: DeferInput): Promise<QueueRow> {
    const row = await this.requireActionable(input.queueId);
    const days = this.deps.config.ingestDeferResurfaceDays;
    if (!Number.isFinite(days) || days <= 0) {
      throw new QueueDecisionError('cadence_unknown', 'cannot Defer: the resurface cadence (ingest_defer_resurface_days) is unknown');
    }
    const now = input.nowIso ?? new Date().toISOString();
    const deferredUntil = new Date(Date.parse(now) + days * DAY_MS).toISOString();
    const updated = await this.deps.store.transition(row.id, {
      state: 'deferred',
      reviewedBy: input.reviewer,
      reviewedAt: now,
      decisionReason: input.reason ?? `deferred until ${deferredUntil}`,
      deferredUntil,
    });
    await this.deps.store.appendAudit({
      auditType: 'ingestion_decision',
      action: 'defer',
      actorType: 'user',
      actorIdentity: input.reviewer,
      reviewerUserId: input.reviewer,
      queueId: row.id,
      targetEntityId: row.target_entity_id,
      reason: input.reason ?? null,
    });
    return updated;
  }

  // ── resurface + escalation ──────────────────────────────────────────────────────────────────────────────────────
  /** Auto-resurface deferred items whose cadence has elapsed (back to pending). Returns the resurfaced ids. */
  async resurface(nowIso: string): Promise<string[]> {
    return this.deps.store.resurfaceDeferred(nowIso);
  }

  /** Is a queue item un-actioned past review_escalation_days? Derived from created_at vs the LIVE cadence (the persisted
   *  escalated_at is server-owned by the C2 maintenance loop / ISSUE-027 — this slice raises the derived signal). */
  isOverdue(row: QueueRow, nowIso: string): boolean {
    if (row.state !== 'pending' && row.state !== 'deferred') return false;
    const ageDays = (Date.parse(nowIso) - Date.parse(row.created_at)) / DAY_MS;
    return ageDays >= this.deps.config.reviewEscalationDays;
  }

  /** Escalate every un-actioned-past-cadence item: emit a LOUD escalation signal for each so a stuck flagged item is
   *  NEVER silently held (AC-2.ING.003.3 / #3). Returns the escalated samples (alert + badge fuel for C7/the surface). */
  async escalateOverdue(nowIso: string): Promise<EscalationSample[]> {
    const actionable = await this.deps.store.listActionable();
    const escalated: EscalationSample[] = [];
    for (const row of actionable) {
      if (!this.isOverdue(row, nowIso)) continue;
      const sample: EscalationSample = {
        queueId: row.id,
        ageDays: Math.floor((Date.parse(nowIso) - Date.parse(row.created_at)) / DAY_MS),
        createdAt: row.created_at,
      };
      await this.deps.observ.escalation(sample);
      escalated.push(sample);
    }
    return escalated;
  }

  private async requireActionable(queueId: string): Promise<QueueRow> {
    const row = await this.deps.store.getQueueRow(queueId);
    if (!row) throw new QueueDecisionError('not_found', `ingestion_queue row ${queueId} not found`);
    if (row.state !== 'pending' && row.state !== 'deferred') {
      throw new QueueDecisionError('not_actionable', `row ${queueId} is ${row.state} — only pending/deferred items can be decided`);
    }
    return row;
  }
}
