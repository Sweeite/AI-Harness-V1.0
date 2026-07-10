// ISSUE-027 (C2 MNT) — FR-2.MNT.005: the weekly merge job. Collapses memories with cosine similarity ≥
// `merge_similarity_threshold` (0.92) that share the SAME entity set AND the SAME sensitivity tier into one richer
// memory (evidence preserved via the supersede chain), while:
//   • SUPERSEDING (not merging) two similar memories more than three months apart (the newer wins, chain kept);
//   • SKIPPING Personal-tier candidates — never auto-consolidated (FR-2.MNT.014); routed to the ISSUE-028 approval
//     queue as a personal_consolidation task, never folded here;
//   • NEVER merging across different entities or tiers (that would blend scopes — a #2 exposure).
// The merged row is a NEW governed insert; the two sources are CAS-superseded into it, so nothing is deleted and
// the fact stays drillable to its inputs (#1).

import type { MemoryRow } from '../../memory/src/store.ts';
import { contentHash, computeIdempotencyKey } from '../../memory/src/memory.ts';
import type { MaintenanceConfig } from './config.ts';
import { cosineSimilarity } from './similarity.ts';
import { isLiveMemory, isPersonal, sameEntitySet, type MaintenanceStore } from './store.ts';

const AVG_MONTH_MS = (365.25 / 12) * 24 * 60 * 60 * 1000;

export interface MergeRunResult {
  recordsAffected: number;
  merged: Array<{ mergedId: string; sourceIds: string[] }>;
  supersededFarApart: Array<{ oldId: string; newId: string }>;
  personalSkipped: string[];
}

/** Build the richer merged memory from two sources (inherits the newer's tags/entities; content is combined so the
 *  fact is not lost; confidence = the max — the merge is at least as trustworthy as its strongest input). */
export function buildMergedMemory(a: MemoryRow, b: MemoryRow, nowIso: string): MemoryRow {
  const [older, newer] = Date.parse(a.created_at) <= Date.parse(b.created_at) ? [a, b] : [b, a];
  const content = `${newer.content}\n\n[merged evidence] ${older.content}`;
  const hash = contentHash(content);
  return {
    id: `merge-${newer.id}-${older.id}`,
    type: newer.type,
    content,
    embedding: [...newer.embedding],
    embedding_model: newer.embedding_model,
    entity_ids: [...newer.entity_ids],
    source: newer.source === 'human_verified' || older.source === 'human_verified' ? 'human_verified' : 'ai_inferred',
    source_ref: newer.source_ref,
    confidence: Math.max(newer.confidence ?? 0, older.confidence ?? 0),
    visibility: newer.visibility,
    sensitivity: newer.sensitivity,
    superseded_by: null,
    content_hash: hash,
    idempotency_key: computeIdempotencyKey(newer.source_ref, newer.entity_ids, hash),
    expires_at: newer.expires_at,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

/** Two live memories are merge-CANDIDATES iff same entity set, same tier, same type, and sim ≥ threshold (the
 *  never-across-entities/tiers guard is here). Cross-entity or cross-tier similarity is a different fact, never a
 *  merge target. */
export function mergeCandidate(a: MemoryRow, b: MemoryRow, cfg: MaintenanceConfig): boolean {
  if (a.id === b.id) return false;
  if (a.type !== b.type) return false;
  if (a.sensitivity !== b.sensitivity) return false; // never merge across tiers (#2)
  if (!sameEntitySet(a.entity_ids, b.entity_ids)) return false; // never merge across entities (#1)
  return cosineSimilarity(a.embedding, b.embedding) >= cfg.mergeSimilarityThreshold;
}

/**
 * Run the weekly merge pass. Greedy over live memories: each still-unconsumed pair of merge-candidates is either
 * merged, superseded-far-apart, or Personal-skipped. A consumed (superseded) source is not re-considered.
 */
export async function runMerge(store: MaintenanceStore, cfg: MaintenanceConfig, nowMs: number): Promise<MergeRunResult> {
  const memories = await store.listMemories();
  // Freeze against active human review: never merge/supersede a memory that is in an unresolved conflict (#2 gate
  // bypass / #1 contested-knowledge drift) — a human is deciding it. Excluded from the live candidate set entirely, so
  // it is not a merge partner either (merging its still-live twin would mutate the contested slot).
  const underReview = await store.underReviewMemoryIds();
  const nowIso = new Date(nowMs).toISOString();
  const live = memories.filter((m) => isLiveMemory(m, nowMs) && !underReview.has(m.id));
  const consumed = new Set<string>();

  const merged: Array<{ mergedId: string; sourceIds: string[] }> = [];
  const supersededFarApart: Array<{ oldId: string; newId: string }> = [];
  const personalSkipped: string[] = [];

  for (let i = 0; i < live.length; i++) {
    const a = live[i]!;
    if (consumed.has(a.id)) continue;
    for (let j = i + 1; j < live.length; j++) {
      const b = live[j]!;
      if (consumed.has(b.id)) continue;
      if (!mergeCandidate(a, b, cfg)) continue;

      // Personal-tier — never auto-consolidated (FR-2.MNT.014). Route to the ISSUE-028 approval queue, do not merge.
      if (isPersonal(a.sensitivity) || isPersonal(b.sensitivity)) {
        for (const id of [a.id, b.id]) if (!personalSkipped.includes(id)) personalSkipped.push(id);
        await store.task({ kind: 'personal_consolidation', targetId: a.id, action: 'human_approval', detail: `Personal-tier near-duplicate of ${b.id} — never auto-merged; queued for explicit human approval (ISSUE-028)`, at: nowIso });
        continue; // leave both live; do not consume
      }

      const [older, newer] = Date.parse(a.created_at) <= Date.parse(b.created_at) ? [a, b] : [b, a];
      // > 3 months apart → supersede (not merge): the newer wins, chain kept.
      if (Date.parse(newer.created_at) - Date.parse(older.created_at) > 3 * AVG_MONTH_MS) {
        const won = await store.casSupersede(older.id, newer.id);
        if (won) {
          consumed.add(older.id);
          supersededFarApart.push({ oldId: older.id, newId: newer.id });
        }
        continue;
      }

      // Merge: create the richer row, CAS-supersede both sources into it (evidence preserved).
      const mergedRow = buildMergedMemory(a, b, nowIso);
      const ins = await store.insertDerivedMemory(mergedRow, [a.id, b.id]);
      const wonA = await store.casSupersede(a.id, ins.id);
      const wonB = await store.casSupersede(b.id, ins.id);
      if (wonA) consumed.add(a.id);
      if (wonB) consumed.add(b.id);
      merged.push({ mergedId: ins.id, sourceIds: [a.id, b.id] });
      break; // a is consumed — move to the next i
    }
  }
  return { recordsAffected: merged.length + supersededFarApart.length, merged, supersededFarApart, personalSkipped };
}
