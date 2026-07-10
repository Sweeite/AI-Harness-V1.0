// ISSUE-027 (C2 MNT) — FR-2.MNT.009: daily coverage-erosion scan. Flags an entity as going stale when no new
// memory about it has appeared within `coverage_stale_window_days` (30) — a prompt to re-engage / re-ingest,
// surfaced not silently tolerated (#3). Ties into Maturity (a stale low-Maturity entity is a coverage gap) but does
// NOT compute Maturity (ISSUE-030 owns that — this scan only READS the newest-memory staleness).

import type { MaintenanceConfig } from './config.ts';
import { isLiveMemory, type MaintenanceStore } from './store.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CoverageRunResult {
  recordsAffected: number;
  staleEntityIds: string[];
}

/**
 * Run the daily coverage-erosion scan. An entity is stale iff its newest LIVE memory is older than the window (or it
 * has no live memory at all — a total coverage gap). Emits a coverage_stale maintenance task per stale entity.
 */
export async function runCoverageErosion(store: MaintenanceStore, cfg: MaintenanceConfig, nowMs: number): Promise<CoverageRunResult> {
  const memories = await store.listMemories();
  const entities = await store.listEntities();
  const nowIso = new Date(nowMs).toISOString();
  const windowMs = cfg.coverageStaleWindowDays * DAY_MS;
  const live = memories.filter((m) => isLiveMemory(m, nowMs));

  const staleEntityIds: string[] = [];
  for (const entity of entities) {
    const onEntity = live.filter((m) => m.entity_ids.includes(entity.id));
    const newestMs = onEntity.length === 0 ? -Infinity : Math.max(...onEntity.map((m) => Date.parse(m.created_at)));
    const ageMs = nowMs - newestMs;
    if (ageMs > windowMs) {
      staleEntityIds.push(entity.id);
      const detail = onEntity.length === 0 ? `no memory at all about ${entity.name} — a total coverage gap` : `no new memory about ${entity.name} in ${Math.floor(ageMs / DAY_MS)} days (> ${cfg.coverageStaleWindowDays})`;
      await store.task({ kind: 'coverage_stale', targetId: entity.id, action: 're-engage', detail, at: nowIso });
    }
  }
  return { recordsAffected: staleEntityIds.length, staleEntityIds };
}
