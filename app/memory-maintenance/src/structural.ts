// ISSUE-027 (C2 MNT) — FR-2.MNT.010: the weekly structural-erosion scan. Surfaces each structural anomaly as a
// dashboard maintenance task:
//   • ORPHAN — a memory referencing no live entity (→ re-link/retire via review). AC-2.MNT.010.1.
//   • NULL/INVALID EMBEDDING — a row whose vector is empty / wrong-dimensioned / all-zero (→ re-embed). This is the
//     SOLE detector for these rows: decay/erosion key on confidence/age, not embedding validity, so a memory left
//     silently unsearchable for want of a valid vector is caught ONLY here (#1/#3). AC-2.MNT.010.2.
//   • STUCK INGESTION-QUEUE ITEM — a pending/deferred item older than `review_escalation_days` (→ escalate).
//     AC-2.MNT.010.3.
//   • OVER-LONG SUPERSESSION CHAIN — a churn signal worth a human look.
//   • DUPLICATE CLUSTER — near-duplicate live rows the merge job missed (→ merge path).

import type { MemoryRow } from '../../memory/src/store.ts';
import type { MaintenanceConfig } from './config.ts';
import { cosineSimilarity } from './similarity.ts';
import { isLiveMemory, sameEntitySet, type MaintenanceStore } from './store.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const EMBEDDING_DIM = 1536; // vector(1536) — schema.md §3

/** True iff an embedding is null/invalid: empty, wrong-dimensioned, non-finite, or all-zero (degenerate — it would
 *  be permanently invisible to the vector arm). The maintenance backstop's core predicate. */
export function isInvalidEmbedding(embedding: readonly number[]): boolean {
  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIM) return true;
  let allZero = true;
  for (const x of embedding) {
    if (!Number.isFinite(x)) return true;
    if (x !== 0) allZero = false;
  }
  return allZero;
}

/** Chain-length threshold beyond which a supersession chain is a churn signal (Phase-2 key; the design names it a
 *  threshold without a v1 default — a conservative 5 stands in until CFG-structural_chain_length lands). */
export const LONG_CHAIN_THRESHOLD = 5;

export interface StructuralRunResult {
  recordsAffected: number;
  orphanIds: string[];
  nullEmbeddingIds: string[];
  stuckQueueIds: string[];
  longChainHeadIds: string[];
  duplicateClusterPairs: number;
}

/**
 * Run the weekly structural scan. Each finding is emitted as a maintenance task; the counts are returned for the
 * run record. Reads memories + entities + the ingestion queue.
 */
export async function runStructuralErosion(store: MaintenanceStore, cfg: MaintenanceConfig, nowMs: number): Promise<StructuralRunResult> {
  const memories = await store.listMemories();
  const entities = await store.listEntities();
  const queue = await store.listIngestionQueue();
  const nowIso = new Date(nowMs).toISOString();
  const entityIds = new Set(entities.map((e) => e.id));
  const live = memories.filter((m) => isLiveMemory(m, nowMs));

  const orphanIds: string[] = [];
  const nullEmbeddingIds: string[] = [];
  const longChainHeadIds: string[] = [];

  // orphans + null embeddings (scan ALL rows, live or not — a superseded row with a bad vector is still evidence).
  for (const m of memories) {
    if (m.entity_ids.length === 0 || !m.entity_ids.some((id) => entityIds.has(id))) {
      orphanIds.push(m.id);
      await store.task({ kind: 'orphan', targetId: m.id, action: 're-link_or_retire', detail: `memory ${m.id} references no live entity (${m.entity_ids.join(',') || 'none'})`, at: nowIso });
    }
    if (isInvalidEmbedding(m.embedding)) {
      nullEmbeddingIds.push(m.id);
      await store.task({ kind: 'null_embedding', targetId: m.id, action: 're-embed', detail: `memory ${m.id} has a null/invalid embedding (dim ${m.embedding.length}) — silently unsearchable until re-embedded`, at: nowIso });
    }
  }

  // over-long supersession chains (count consecutive superseded_by hops from each live head).
  const byId = new Map(memories.map((m) => [m.id, m]));
  for (const head of live) {
    let depth = 0;
    const seen = new Set<string>();
    // walk BACKWARD: how many rows were superseded INTO this head's lineage.
    let cursor: MemoryRow | undefined = head;
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      const predecessor = memories.find((m) => m.superseded_by === cursor!.id);
      if (!predecessor) break;
      depth++;
      cursor = predecessor;
    }
    if (depth >= LONG_CHAIN_THRESHOLD) {
      longChainHeadIds.push(head.id);
      await store.task({ kind: 'long_chain', targetId: head.id, action: 'review_churn', detail: `supersession chain of depth ${depth} (≥ ${LONG_CHAIN_THRESHOLD}) — churn worth a look`, at: nowIso });
    }
  }
  void byId;

  // stuck ingestion-queue items (pending/deferred past the escalation threshold).
  const stuckQueueIds: string[] = [];
  const escalationMs = cfg.reviewEscalationDays * DAY_MS;
  for (const item of queue) {
    if (item.state !== 'pending' && item.state !== 'deferred') continue;
    if (nowMs - Date.parse(item.created_at) > escalationMs) {
      stuckQueueIds.push(item.id);
      await store.task({ kind: 'stuck_queue', targetId: item.id, action: 'escalate', detail: `ingestion-queue item ${item.id} stuck in '${item.state}' past ${cfg.reviewEscalationDays} days`, at: nowIso });
    }
  }

  // duplicate clusters the merge job missed (near-duplicate live rows, same entity+tier, sim ≥ threshold).
  let duplicateClusterPairs = 0;
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]!;
      const b = live[j]!;
      if (a.type !== b.type || a.sensitivity !== b.sensitivity || !sameEntitySet(a.entity_ids, b.entity_ids)) continue;
      if (cosineSimilarity(a.embedding, b.embedding) >= cfg.mergeSimilarityThreshold) {
        duplicateClusterPairs++;
        await store.task({ kind: 'duplicate_cluster', targetId: a.id, action: 'merge', detail: `near-duplicate of ${b.id} the merge job did not collapse — route to merge`, at: nowIso });
      }
    }
  }

  const recordsAffected = orphanIds.length + nullEmbeddingIds.length + stuckQueueIds.length + longChainHeadIds.length + duplicateClusterPairs;
  return { recordsAffected, orphanIds, nullEmbeddingIds, stuckQueueIds, longChainHeadIds, duplicateClusterPairs };
}
