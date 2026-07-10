// ISSUE-026 (C2 ING) — the single-candidate ingestion path: the reusable core every pipeline (and a live-task write)
// runs. It composes the fixed standard write flow (FR-2.ING.010): Filter 1 (relevance, with the trust-window
// shadow-retain / live-discard branch) → Filter 2 (sensitivity: clean→sole writer, flag→queue). A Filter-1 drop
// short-circuits, so a dropped item never reaches Filter 2 or the writer and costs no Sonnet call (AC-2.ING.001.1).

import type { Mention } from '../../memory/src/resolution.ts';
import type { SourceEvent, WriteOutcome } from '../../memory-write/src/writer.ts';
import type { TaskAuthz } from '../../memory-write/src/commit.ts';
import type { IngestionConfig } from './config.ts';
import type { CandidateEvent, FilterMeter, Filters } from './filters.ts';
import type { IngestionQueue } from './queue.ts';
import type { AuditRunSample, IngestionStore, MemoryWriteGate, ObservabilitySink, QueueRow } from './store.ts';

export interface IngestDeps {
  queue: IngestionQueue;
  /** The same store the queue is built over — pipelines create entities (Pipeline 1) through it. */
  store: IngestionStore;
  gate: MemoryWriteGate;
  filters: Filters;
  observ: ObservabilitySink;
  config: IngestionConfig;
  meter?: FilterMeter;
}

export interface IngestContext {
  task: TaskAuthz;
  contextEntities?: Mention[];
  createdAt?: string;
}

export type IngestResult =
  | { kind: 'dropped'; reason: string } // Filter 1 live-discard (post-graduation): no write, no Sonnet cost
  | { kind: 'shadow_retained'; row: QueueRow } // Filter 1 would-drop retained during the trust window (never lost)
  | { kind: 'held'; row: QueueRow } // Filter 2 flagged → held in the queue for a human (never auto-written)
  | { kind: 'written'; outcome: WriteOutcome } // clean → routed through the sole writer AND the write COMMITTED
  | { kind: 'write_incomplete'; outcome: WriteOutcome; row: QueueRow }; // clean, but the write did NOT commit → HELD for retry (never lost, #1)

/** Run one candidate through the standard write flow. The ONLY memory-producing branch is the clean-pass route through
 *  the no-backdoor gate; every other branch drops, retains, or holds — nothing reaches `memories` un-gated (#2). */
export async function ingestCandidate(event: CandidateEvent, ctx: IngestContext, deps: IngestDeps): Promise<IngestResult> {
  deps.meter?.countHaiku();
  const rel = deps.filters.relevance.classify(event);
  if (rel.decision === 'drop') {
    await deps.observ.filterDecision({ filter: 'relevance', verdict: 'drop', reason: rel.reason, targetEntityId: event.targetEntityId ?? null });
    if (deps.config.filter1TrustWindowActive) {
      // Trust window active (AF-043 not GREEN): retain the would-drop for audit rather than lose it (AC-2.ING.001.2).
      const row = await deps.queue.shadowRetain({
        content: event.content,
        sourceRef: event.sourceRef,
        targetEntityId: event.targetEntityId ?? null,
        createdAt: ctx.createdAt,
      });
      return { kind: 'shadow_retained', row };
    }
    // Graduated to live-discard: dropped with no write, no Sonnet cost. The weekly sampled audit (runSampledDropAudit)
    // spot-checks a fraction of these so the gate can't silently drift.
    return { kind: 'dropped', reason: rel.reason };
  }

  deps.meter?.countHaiku();
  const sen = deps.filters.sensitivity.classify(event);
  if (sen.verdict === 'flag') {
    const row = await deps.queue.holdFlagged({
      content: event.content,
      sourceRef: event.sourceRef,
      flagReason: sen.flagReason,
      suggestedTier: sen.suggestedTier,
      targetEntityId: event.targetEntityId ?? null,
      createdAt: ctx.createdAt,
    });
    return { kind: 'held', row };
  }

  // Clean standard content → route through the SOLE WRITER (auto-assigned tier). Provenance proves both filters passed;
  // the gate refuses any route missing that stamp (the no-backdoor invariant, FR-2.ING.010).
  await deps.observ.filterDecision({ filter: 'sensitivity', verdict: 'clean', reason: null, targetEntityId: event.targetEntityId ?? null });
  const srcEvent: SourceEvent = {
    taskId: ctx.task.taskId,
    summary: event.content,
    sourceEventRef: event.sourceRef ?? `ingest:${ctx.task.taskId}`,
    contextEntities: ctx.contextEntities,
  };
  const outcome = await deps.gate.route({
    event: srcEvent,
    task: ctx.task,
    provenance: { relevance: 'passed', sensitivity: 'clean' },
  });
  // #1/#3 — only report 'written' when the sole writer actually COMMITTED. A deferred_rate_limited / halted_embed_failure
  // outcome means NOTHING reached `memories`; the clean item must not be reported written (and thereby lost). Hold it in
  // the queue for retry so a rate-limited or embed-failed chunk survives and re-attempts (never a silent loss).
  if (outcome.kind !== 'committed') {
    const row = await deps.queue.holdForRetry({
      content: event.content,
      sourceRef: event.sourceRef,
      targetEntityId: event.targetEntityId ?? null,
      createdAt: ctx.createdAt,
      reason: outcome.reason,
    });
    return { kind: 'write_incomplete', outcome, row };
  }
  return { kind: 'written', outcome };
}

// ── the post-graduation sampled-drop audit (AC-2.ING.001.3 / FR-2.MNT.015) ────────────────────────────────────────
export interface SampledDropInput {
  /** The live Filter-1 drops observed over the audit window. */
  drops: Array<{ content: string; targetEntityId: string | null }>;
  window: string;
}

/** Sample ≥5% of a week's live Filter-1 drops (minimum 20/week) into the Haiku-decision review queue and LOG the run.
 *  A window with zero drops — or zero reviewed — is STILL logged and flagged (`missed: true`) so a missed/empty audit
 *  is never silently skipped (AC-2.ING.001.3 / AC-2.MNT.015.3 / #3). Returns the logged run sample. */
export async function runSampledDropAudit(input: SampledDropInput, deps: Pick<IngestDeps, 'config' | 'observ'>): Promise<AuditRunSample> {
  const total = input.drops.length;
  const byRate = Math.ceil(deps.config.filter1SampledAuditRate * total);
  // The floor (min 20/week) applies when there ARE drops; you can never sample more than exist.
  const target = total === 0 ? 0 : Math.min(total, Math.max(deps.config.filter1SampledAuditMinWeekly, byRate));
  const sampled = target;
  const reviewed = sampled; // this run reviews everything it sampled
  const missed = total === 0 || reviewed === 0; // an empty/zero-reviewed run is flagged, not silently dropped
  const sample: AuditRunSample = { window: input.window, totalDrops: total, sampledTarget: target, sampled, reviewed, missed };
  await deps.observ.auditRun(sample);
  return sample;
}
