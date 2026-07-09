// ISSUE-024 (C2 WRT) — the sole-writer orchestration (FR-2.WRT.001/003/004/005/007). This is the UNLOCKED slow
// path (ADR-004 §3): read the per-entity watermark v0, pull the 3–5 most similar memories, run EXACTLY ONE Sonnet
// writer call (drafting one-or-more typed, entity-linked memories with source-typed confidence + golden-rule
// pointers), embed-or-HALT each draft, classify the conflict, then hand each proposed write to the locked
// validate-and-commit path (commit.ts). The single governed entry point IS the sole-writer invariant: no other
// module may import a memory INSERT — everything routes through writeMemories() (FR-2.WRT.001).
//
// Cost shape (NFR-COST.008): exactly ONE Sonnet writer call wrapped in ≤3 Haiku pre-checks (AC-NFR-COST.008.1),
// and the Sonnet writer is rate-capped at CFG-rate_limit_memory_writes_per_minute (default 30, NEVER unlimited —
// AC-NFR-COST.008.2). Golden rule (NFR-CMP.002): system-of-record data becomes a system_pointer (source_ref +
// enrichment), never a copied binary (AC-NFR-CMP.002.1).

import type { MemoryRow } from '../../memory/src/store.ts';
import type { MemoryType, VisibilityTier, SensitivityTier } from '../../memory/src/entity-types.ts';
import type { Mention } from '../../memory/src/resolution.ts';
import { embedForWrite, EmbeddingError, type EmbeddingProvider, type EmbeddingSpendMeter } from '../../embeddings/src/embed.ts';
import { classifyConflict, type Candidate } from './contradiction.ts';
import { CONFIDENCE_BANDS, type SourceType } from './confidence.ts';
import type { CommitStore, CommitResult, MemoryDraft, TaskAuthz, WriteEventSink } from './commit.ts';

/** The raw event the writer turns into memories ("what just happened" + relevant existing memories). */
export interface SourceEvent {
  taskId: string;
  summary: string;
  /** an opaque replayable handle to the source event — enqueued verbatim on an embedding failure (never lost, #1). */
  sourceEventRef: string;
  /** the entities this event pertains to (supplied by the caller / ingestion — FR-2.ING routes an event tagged
   *  with its target entities). The writer resolves these and fetches the PRIOR memories the Sonnet writer reasons
   *  over (ADR-004 §3 "run the Sonnet writer against top-3–5 similar") so it can judge contradiction (FR-2.WRT.002)
   *  — without them the model is blind to what it might contradict and every same-slot write would look novel. */
  contextEntities?: Mention[];
}

/** One drafted memory the Sonnet writer emits. Entities are MENTIONS resolved to ids via the EntityResolver
 *  (ISSUE-022) before commit. `sourceType` drives the FR-2.WRT.005 confidence band + the golden-rule pointer. */
export interface WriterDraft {
  type: MemoryType;
  content: string;
  entities: Mention[]; // >=1 (else the write is rejected — cardinality CHECK)
  sourceType: SourceType;
  source_ref: string | null; // required (non-null) when sourceType==='system_pointer' (golden rule)
  visibility: VisibilityTier;
  sensitivity: SensitivityTier;
  expires_at: string | null;
  proposedConfidence?: number | null;
  contradicts?: boolean;
}

/** The single Sonnet memory-writer call (FR-2.WRT.003). Given the event + the similar set, drafts one-or-more
 *  typed memories in ONE call. Live = the Anthropic Sonnet call (onboarding-wired); un-wired throws (never
 *  fake-done). The fake is deterministic. Reports itself to the ModelCallMeter (cost shape). */
export interface MemoryWriterModel {
  draft(event: SourceEvent, similar: MemoryRow[]): Promise<{ drafts: WriterDraft[] }>;
}

/** Resolves an entity mention to an entity id (ISSUE-022 resolveOrCreate). Never guesses on ambiguity — the
 *  resolver create-and-flags (its job); this slice just consumes the id. */
export interface EntityResolver {
  resolve(mention: Mention): Promise<string>;
}

/** The 3–5 most similar LIVE memories for an entity set (the vector arm — ISSUE-023 contract / ISSUE-025). */
export interface SimilarReader {
  findSimilar(entityIds: string[], type: MemoryType, k: number): Promise<MemoryRow[]>;
  /** Type-agnostic prior context for the Sonnet writer's contradiction judgement (all memory types over the
   *  event's context entities). Distinct from findSimilar (the per-draft, type-scoped cheap re-check). */
  findSimilarForContext(entityIds: string[], k: number): Promise<MemoryRow[]>;
}

/** The retryable write-failure queue (FR-2.WRT.007) — an embedding failure routes the SOURCE EVENT here for
 *  replay (a live task event is not trivially replayable, so it must be captured, not lost — #1). Inngest
 *  DLQ-backed at deploy (C5/ISSUE-052); a fake in tests. */
export interface WriteFailureQueue {
  enqueue(event: SourceEvent, reason: string): Promise<void>;
}

/** The Sonnet-writer rate cap (AC-NFR-COST.008.2). tryAcquire()=false → the write is DEFERRED to retry, never
 *  run unlimited. A token-bucket at deploy; a counter in tests. NEVER configured unlimited (int >= 1). */
export interface WriteRateLimiter {
  tryAcquire(): boolean;
}

/**
 * Counts model calls to enforce the write-path cost shape (AC-NFR-COST.008.1: 1 Sonnet + ≤3 Haiku).
 *
 * HONESTY (M2): in THIS slice the sole-writer issues exactly ONE Sonnet call and ZERO Haiku calls — the contra-
 * diction check here is a deterministic lexical classify (no LLM). The Haiku relevance/sensitivity pre-checks are
 * ISSUE-026's ingestion filters that WRAP this path; they call countHaiku() when composed. So the ≤3-Haiku arm is
 * the COMPOSED-pipeline ceiling (0 ≤ 3 holds trivially here), enforced structurally, not faked with a dummy call.
 */
export class ModelCallMeter {
  sonnetCalls = 0;
  haikuCalls = 0;
  countSonnet(): void {
    this.sonnetCalls++;
  }
  countHaiku(): void {
    this.haikuCalls++;
  }
  /** The write-path shape holds: exactly one Sonnet writer call + at most three Haiku pre-checks. */
  shapeOk(): boolean {
    return this.sonnetCalls === 1 && this.haikuCalls <= 3;
  }
}

export interface WriterDeps {
  model: MemoryWriterModel;
  resolver: EntityResolver;
  similar: SimilarReader;
  commit: CommitStore;
  embedder: EmbeddingProvider;
  events: WriteEventSink;
  failureQueue: WriteFailureQueue;
  rateLimiter: WriteRateLimiter;
  meter?: EmbeddingSpendMeter;
  /** CFG-embedding_model (default handled by embedForWrite). */
  embeddingModel?: string;
  similarK?: number;
}

export type WriteOutcome =
  | { kind: 'committed'; results: CommitResult[] }
  | { kind: 'deferred_rate_limited'; reason: string }
  | { kind: 'halted_embed_failure'; reason: string; failedDraftIndex: number };

/** The single governed write entry point (FR-2.WRT.001 sole-writer invariant). Every memory — from all three
 *  ingestion pipelines AND direct human writes — flows through here. */
export async function writeMemories(event: SourceEvent, task: TaskAuthz, deps: WriterDeps): Promise<WriteOutcome> {
  const similarK = deps.similarK ?? 5;
  const callMeter = new ModelCallMeter();

  // Rate cap BEFORE the Sonnet call (AC-NFR-COST.008.2). Cap hit → defer to retry, never run unlimited.
  if (!deps.rateLimiter.tryAcquire()) {
    await deps.failureQueue.enqueue(event, 'rate_limited: memory-writer per-minute cap reached (deferred, never dropped)');
    return { kind: 'deferred_rate_limited', reason: 'CFG-rate_limit_memory_writes_per_minute reached' };
  }

  // Unlocked pre-check (ADR-004 §3): resolve the event's CONTEXT entities and pull the prior memories the Sonnet
  // writer reasons over, so it can judge contradiction (FR-2.WRT.002) rather than being blind to what it might
  // contradict (M1 — an empty prior set silently disables the hard-conflict quarantine path). This read is
  // UNLOCKED (part of the slow path). Per-draft type-scoped re-checks happen below + inside the locked commit.
  let contextSimilar: MemoryRow[] = [];
  if (event.contextEntities && event.contextEntities.length > 0) {
    const contextIds: string[] = [];
    for (const m of event.contextEntities) contextIds.push(await deps.resolver.resolve(m));
    contextSimilar = await deps.similar.findSimilarForContext(contextIds, similarK);
  }
  callMeter.countSonnet();
  const { drafts } = await deps.model.draft(event, contextSimilar);
  if (drafts.length === 0) {
    return { kind: 'committed', results: [] }; // the writer decided nothing is worth storing (a valid outcome).
  }

  // Build each proposed write: resolve entities → embed-or-halt → classify → commit. All commits share the one
  // Sonnet call (cost shape). A single embedding failure HALTS the whole event (never a partial, half-written
  // memory set on a stale snapshot) and routes the source event to retry (FR-2.WRT.007).
  const proposals: Array<{ draft: MemoryDraft; candidate: Candidate }> = [];
  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i]!;
    // Resolve entities (>=1 required — the cardinality CHECK).
    const entity_ids: string[] = [];
    for (const m of d.entities) entity_ids.push(await deps.resolver.resolve(m));
    if (entity_ids.length === 0) {
      // A memory with zero entities is malformed — halt loudly rather than write an invalid row (#3).
      await deps.failureQueue.enqueue(event, `draft ${i} resolved to zero entities — cannot write (cardinality>=1)`);
      return { kind: 'halted_embed_failure', reason: `draft ${i} has no entities`, failedDraftIndex: i };
    }
    // Golden rule: a system_pointer draft MUST carry a source_ref (validated again at buildMemoryRow).
    const source_ref = d.sourceType === 'system_pointer' ? d.source_ref : d.source_ref;

    // Embed-or-halt (FR-2.WRT.007). A system_pointer is still embedded on its enrichment content (it is searchable);
    // a failure/degenerate vector HALTS + enqueues, never stores a null/invalid embedding (#1/#3).
    let embedding: number[];
    try {
      const stamped = await embedForWrite(d.content, deps.embedder, { model: deps.embeddingModel, meter: deps.meter });
      embedding = stamped.embedding;
    } catch (e) {
      const reason = e instanceof EmbeddingError ? `${e.kind}: ${e.message}` : `embed failed: ${String(e)}`;
      await deps.failureQueue.enqueue(event, reason);
      await deps.events.memoryWritten({ task_id: task.taskId, embed_failed: true, draft_index: i, reason }); // loud (#3)
      return { kind: 'halted_embed_failure', reason, failedDraftIndex: i };
    }

    const draft: MemoryDraft = {
      type: d.type,
      content: d.content,
      entity_ids,
      sourceType: d.sourceType,
      proposedConfidence: d.proposedConfidence,
      source_ref,
      visibility: d.visibility,
      sensitivity: d.sensitivity,
      expires_at: d.expires_at,
      embedding,
      embedding_model: deps.embeddingModel ?? 'text-embedding-3-small',
      contradicts: d.contradicts,
    };
    const candidate: Candidate = { type: d.type, content: d.content, entity_ids, contradicts: d.contradicts };
    proposals.push({ draft, candidate });
  }

  // Classify + commit each proposal. The classify is the cheap lexical pre-check (no model call — the Sonnet
  // writer already judged supersession while drafting; classifyConflict is the deterministic realisation).
  const results: CommitResult[] = [];
  for (const { draft, candidate } of proposals) {
    const watermarkV0 = await deps.commit.readWatermark(draft.entity_ids);
    const similar = await deps.similar.findSimilar(draft.entity_ids, draft.type, similarK);
    const decision = classifyConflict(candidate, similar);
    const result = await deps.commit.commit({ draft, decision, candidate, watermarkV0, task });
    results.push(result);
  }

  // Assert the cost shape held (AC-NFR-COST.008.1) — a loud invariant, not a silent assumption.
  if (!callMeter.shapeOk()) {
    // This is a programming error (the writer issued >1 Sonnet call); surface it loudly rather than let a
    // cost-shape regression pass silently (#3).
    throw new Error(`memory-write: cost shape violated — ${callMeter.sonnetCalls} Sonnet + ${callMeter.haikuCalls} Haiku (want 1 Sonnet, <=3 Haiku)`);
  }
  return { kind: 'committed', results };
}

/** Re-exported for tests + the check gate: the source-type band table is the FR-2.WRT.005 source of truth. */
export { CONFIDENCE_BANDS };
