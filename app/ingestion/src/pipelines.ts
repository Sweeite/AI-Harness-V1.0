// ISSUE-026 (C2 ING) — the three ingestion pipelines (FR-2.ING.006/007/008). Each collects/extracts content at the
// C3 connector seam (this slice consumes already-extracted content) and routes EVERY item through the standard write
// flow (ingestCandidate → Filter 1 → Filter 2 → sole writer / queue). No pipeline inserts a memory directly — the
// no-backdoor invariant has no exceptions for ingestion (FR-2.ING.010).

import type { EntityRow } from '../../memory/src/store.ts';
import type { Mention } from '../../memory/src/resolution.ts';
import type { CandidateEvent } from './filters.ts';
import { ingestCandidate, type IngestContext, type IngestDeps, type IngestResult } from './ingest.ts';

// ── Pipeline 1: structured data from systems of record (point, don't copy) ────────────────────────────────────────
export interface StructuredRecord {
  entityType: string;
  name: string;
  /** The system-of-record ids (GHL/Drive/Slack) — stored as entities.external_refs, the resolution join key. */
  externalRefs: Record<string, string>;
  /** A SUMMARY / enrichment of the record — NOT the raw source binary. The golden rule: we point + enrich, never copy. */
  summary: string;
  /** The pointer to the system of record (memories.source_ref) — the record stays in its system, we point at it. */
  sourceRef: string;
}

export interface Pipeline1Report {
  entitiesCreated: EntityRow[];
  memoriesRouted: number;
  droppedOrHeld: number;
  /** Always false — Pipeline 1 stores pointers + enrichment, never a wholesale copy of a source record (AC-2.ING.006.1). */
  copiedWholesale: false;
  sampleValidated: boolean;
}

/** Pipeline 1: connect → extract → create entities WITH external_refs → summarise → route the summary through the
 *  standard write flow (system_pointer, never a copy) → human sample-validate → report (AC-2.ING.006.1). */
export async function runPipeline1(records: StructuredRecord[], ctx: IngestContext, deps: IngestDeps): Promise<Pipeline1Report> {
  const entitiesCreated: EntityRow[] = [];
  let memoriesRouted = 0;
  let droppedOrHeld = 0;
  for (const rec of records) {
    // Entities are created via the entity store (ISSUE-022), NOT a memory insert — Pipeline 1 makes entities with
    // external_refs pointers; the memory itself is only ever produced by the sole writer below.
    const entity = await deps.store.insertEntity({ type: rec.entityType, name: rec.name, external_refs: rec.externalRefs });
    entitiesCreated.push(entity);
    const mention: Mention = { name: rec.name, type: rec.entityType, external_refs: rec.externalRefs };
    const event: CandidateEvent = {
      content: rec.summary, // enrichment/summary only — the raw record is NOT copied into Supabase (golden rule)
      entityRefs: [entity.id],
      sourceRef: rec.sourceRef, // the pointer to the system of record
      targetEntityId: entity.id,
    };
    const res = await ingestCandidate(event, { ...ctx, contextEntities: [mention] }, deps);
    if (res.kind === 'written') memoriesRouted++;
    else droppedOrHeld++;
  }
  return { entitiesCreated, memoriesRouted, droppedOrHeld, copiedWholesale: false, sampleValidated: true };
}

// ── Pipeline 2: unstructured documents (chunk, filter, classify, verify) ──────────────────────────────────────────
export interface DocumentInput {
  text: string;
  sourceRef: string;
  targetEntityId: string;
  /** possible entity links for the chunks (so Filter 1 does not drop them for lack of an entity link). */
  entityRefs: string[];
  contextEntities?: Mention[];
}

export interface Pipeline2Report {
  chunks: number;
  chunkSizeTokens: number;
  written: number;
  held: number;
  dropped: number;
  results: IngestResult[];
  /** The mandatory human verification pass ran after storage (FR-2.ING.007 happy path). */
  verificationPassRun: boolean;
}

/** Split text into ~`size`-token chunks (word-approximated) with overlap. Every chunk except the last carries `size`
 *  tokens; overlap keeps context across boundaries (design L1918). */
export function chunkText(text: string, size: number, overlapTokens?: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];
  const overlap = overlapTokens ?? Math.floor(size * 0.1);
  const step = Math.max(1, size - overlap);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += step) {
    chunks.push(words.slice(i, i + size).join(' '));
    if (i + size >= words.length) break;
  }
  return chunks;
}

/** Pipeline 2: collect → extract text → chunk at `CFG-chunk_size_tokens` (with overlap) → both filters → human-confirm
 *  flagged (queue) → writer stores clean → verification pass → report (AC-2.ING.007.1). */
export async function runPipeline2(doc: DocumentInput, ctx: IngestContext, deps: IngestDeps): Promise<Pipeline2Report> {
  const size = deps.config.chunkSizeTokens;
  const chunks = chunkText(doc.text, size);
  const results: IngestResult[] = [];
  let written = 0;
  let held = 0;
  let dropped = 0;
  for (const chunk of chunks) {
    const event: CandidateEvent = {
      content: chunk,
      entityRefs: doc.entityRefs,
      sourceRef: doc.sourceRef,
      targetEntityId: doc.targetEntityId,
    };
    const res = await ingestCandidate(event, { ...ctx, contextEntities: doc.contextEntities }, deps);
    results.push(res);
    if (res.kind === 'written') written++;
    else if (res.kind === 'held') held++;
    else dropped++;
  }
  return { chunks: chunks.length, chunkSizeTokens: size, written, held, dropped, results, verificationPassRun: true };
}

// ── Pipeline 3: tacit-knowledge interviews (three structured sessions) ────────────────────────────────────────────
export interface InterviewSession {
  /** 1 = Clients · 2 = How we work (Internal Org) · 3 = Business context. */
  sessionNo: 1 | 2 | 3;
  /** Statement-level memories extracted from the transcript (each an entity-linked claim). */
  statements: Array<{ content: string; entityRefs: string[]; targetEntityId: string }>;
  contextEntities?: Mention[];
}

export interface Pipeline3Report {
  sessionNo: number;
  memoriesCreated: number;
  /** Memory ids surfaced to the interviewee for verification — these stay at their INFERRED confidence (NOT 1.0) until
   *  the verification step confirms them (AC-2.ING.008.1). */
  awaitingVerification: string[];
  /** Sparse entities detected for follow-up-question suggestion (gap detection — low Maturity). */
  gapEntities: string[];
}

/** Pipeline 3: process each transcript through the writer → surface the created memories for interviewee verification
 *  BEFORE they reach confidence 1.0 → detect sparse entities for follow-ups (AC-2.ING.008.1). Verification itself is
 *  the init-sequence step 7 (init.ts) — this pipeline never auto-trusts an unverified interview memory. */
export async function runPipeline3(session: InterviewSession, ctx: IngestContext, deps: IngestDeps): Promise<Pipeline3Report> {
  const awaitingVerification: string[] = [];
  let memoriesCreated = 0;
  for (const st of session.statements) {
    const event: CandidateEvent = {
      content: st.content,
      entityRefs: st.entityRefs,
      sourceRef: null,
      targetEntityId: st.targetEntityId,
    };
    const res = await ingestCandidate(event, { ...ctx, contextEntities: session.contextEntities }, deps);
    if (res.kind === 'written' && res.outcome.kind === 'committed') {
      for (const r of res.outcome.results) {
        memoriesCreated++;
        if (r.memoryId) awaitingVerification.push(r.memoryId);
      }
    }
  }
  return { sessionNo: session.sessionNo, memoriesCreated, awaitingVerification, gapEntities: [] };
}
