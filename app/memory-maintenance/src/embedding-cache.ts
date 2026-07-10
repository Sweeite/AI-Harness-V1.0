// ISSUE-027 (C2 MNT) — FR-2.MNT.013: monthly embedding-cache validation. Re-embeds a memory ONLY when its content
// has changed (its stored `content_hash` no longer matches a fresh hash of its content); unchanged content is
// SKIPPED — re-embedding it would waste embedding spend for nothing (ADR-003 cost). A deliberate model-change
// re-embedding is a SEPARATE migration (FR-2.VEC.003 / ISSUE-023), not this job.

import type { MemoryRow } from '../../memory/src/store.ts';
import { contentHash } from '../../memory/src/memory.ts';
import { isLiveMemory, type MaintenanceStore } from './store.ts';

/** The re-embed seam (ISSUE-023 owns the actual embedding call). This job only DETECTS + ROUTES changed content. */
export interface Reembedder {
  reembed(memory: MemoryRow): Promise<void>;
}

export interface EmbeddingCacheResult {
  recordsAffected: number;
  skippedIds: string[]; // unchanged content — NOT re-embedded (the cost saving)
  reembeddedIds: string[]; // content changed — routed to re-embed
}

/** True iff the memory's stored content_hash still matches its content (cache HIT — skip re-embed). */
export function contentUnchanged(memory: MemoryRow): boolean {
  return memory.content_hash === contentHash(memory.content);
}

/**
 * Run the monthly embedding-cache validation. For each live memory: cache-hit (unchanged) → skip; cache-miss
 * (content changed) → route to the re-embedder (if wired). Returns the skip/re-embed partition.
 */
export async function runEmbeddingCacheValidation(store: MaintenanceStore, nowMs: number, reembedder?: Reembedder): Promise<EmbeddingCacheResult> {
  const memories = await store.listMemories();
  const live = memories.filter((m) => isLiveMemory(m, nowMs));
  const skippedIds: string[] = [];
  const reembeddedIds: string[] = [];

  for (const m of live) {
    if (contentUnchanged(m)) {
      skippedIds.push(m.id); // cache hit — do NOT re-embed (AC-2.MNT.013.1)
      continue;
    }
    if (reembedder) await reembedder.reembed(m);
    reembeddedIds.push(m.id);
  }
  return { recordsAffected: reembeddedIds.length, skippedIds, reembeddedIds };
}
