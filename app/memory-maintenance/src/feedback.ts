// ISSUE-027 (C2 MNT) — FR-2.MNT.016: the feedback loop. Usage outcomes and human actions feed back into confidence,
// and EVERY feedback signal is logged with timestamp / acting user / reason (silent confidence drift is forbidden,
// #3). Humans may also write memories directly — entering at confidence 1.0 / source human_verified — and that
// write goes through the SOLE WRITER (the governed maintenance port), never a side channel (AC-2.MNT.016.1).

import type { MemoryRow } from '../../memory/src/store.ts';
import type { MemoryType, VisibilityTier, SensitivityTier } from '../../memory/src/entity-types.ts';
import { contentHash, computeIdempotencyKey } from '../../memory/src/memory.ts';
import type { MaintenanceConfig } from './config.ts';
import { applyConfidenceChange, type ApplyResult } from './apply.ts';
import type { ConfidenceCause } from './confidence-lifecycle.ts';
import type { MaintenanceStore } from './store.ts';

/** A human correction to an existing memory (dashboard action). All lower confidence by −0.15 and are logged. */
export type HumanCorrection = 'edit' | 'flag' | 'delete';

/**
 * Record a human correction to a memory. Routes the confidence drop through the sole-writer maintenance port + logs
 * it with user / time / reason (AC-2.MNT.016.1). NOTE: a 'delete' here is a human RETIRE signal (confidence drop +
 * review), NOT the destructive compliance-erasure path (FR-2.MNT.017, ISSUE-029) — this slice never deletes.
 */
export async function recordHumanCorrection(store: MaintenanceStore, memory: MemoryRow, userId: string, reason: string, correction: HumanCorrection, cfg: MaintenanceConfig, nowMs: number = Date.now()): Promise<ApplyResult> {
  const cause: ConfidenceCause = correction === 'flag' ? 'human_flag' : 'human_edit';
  return applyConfidenceChange(store, memory, cause, userId, `human ${correction}: ${reason}`, cfg, { nowIso: new Date(nowMs).toISOString() });
}

/**
 * Record a retrieval-usage outcome: a memory used in a SUCCESSFUL task gains +0.02 (retrieval_use); a poor outcome
 * loses −0.05 (poor_outcome). Logged with the run/agent identity + reason.
 */
export async function recordUsageOutcome(store: MaintenanceStore, memory: MemoryRow, success: boolean, actor: string, cfg: MaintenanceConfig, nowMs: number = Date.now()): Promise<ApplyResult> {
  const cause: ConfidenceCause = success ? 'retrieval_use' : 'poor_outcome';
  const reason = success ? 'useful retrieval (task succeeded)' : 'poor outcome after retrieval';
  return applyConfidenceChange(store, memory, cause, actor, reason, cfg, { nowIso: new Date(nowMs).toISOString() });
}

/** The fields a human supplies to write a memory directly (the rest — confidence/source/hash/idempotency — are
 *  fixed by the direct-write contract: 1.0 / human_verified). */
export interface DirectWriteInput {
  type: MemoryType;
  content: string;
  entity_ids: string[];
  visibility: VisibilityTier;
  sensitivity: SensitivityTier;
  embedding: number[];
  embedding_model?: string;
  expires_at?: string | null;
}

export interface DirectWriteResult {
  inserted: boolean;
  memoryId: string;
}

/**
 * A human direct-write: enters at confidence 1.0 / source human_verified, through the sole-writer maintenance port
 * (insertDerivedMemory — the single governed insert), and is logged as a human_direct_write confidence event with
 * user / time / reason. The row is validated by the port (enum domains + DB CHECKs) exactly like any other write.
 */
export async function humanDirectWrite(store: MaintenanceStore, input: DirectWriteInput, userId: string, reason: string, nowMs: number = Date.now()): Promise<DirectWriteResult> {
  const nowIso = new Date(nowMs).toISOString();
  const hash = contentHash(input.content);
  const row: MemoryRow = {
    id: `human-${userId}-${hash.slice(0, 12)}`,
    type: input.type,
    content: input.content,
    embedding: [...input.embedding],
    embedding_model: input.embedding_model ?? 'text-embedding-3-small',
    entity_ids: [...input.entity_ids],
    source: 'human_verified',
    source_ref: null,
    confidence: 1.0,
    visibility: input.visibility,
    sensitivity: input.sensitivity,
    superseded_by: null,
    content_hash: hash,
    idempotency_key: computeIdempotencyKey(null, input.entity_ids, hash),
    expires_at: input.expires_at ?? null,
    created_at: nowIso,
    updated_at: nowIso,
  };
  const ins = await store.insertDerivedMemory(row, []);
  await store.confidenceChanged({ memoryId: ins.id, oldConfidence: null, newConfidence: 1.0, cause: 'human_direct_write', actor: userId, reason: `human direct-write (human_verified): ${reason}`, at: nowIso });
  return { inserted: ins.inserted, memoryId: ins.id };
}
