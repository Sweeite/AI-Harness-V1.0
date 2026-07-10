// ISSUE-027 (C2 MNT) — FR-2.MNT.011: relevance erosion (on-use + monthly). When a memory is retrieved and USED, a
// live-tool-data cross-check confirms or contradicts it:
//   • CONTRADICTED → an IMMEDIATE soft-conflict flag (the WRT.002 path) — AC-2.MNT.011.1.
//   • CONFIRMED    → relevance affirmed: +confidence via corroboration_sor (FR-2.MNT.001 happy path).
// A monthly sweep flags memories neither retrieved nor confirmed within `relevance_review_window_days` (30) for
// relevance review (a decay/retire candidate), surfaced — never silently dropped.
//
// The live-data fetch itself is a C3 seam (GHL/Google/Slack via the ISSUE-039/040/041 connectors). This slice
// consumes the fetched verdict through the LiveDataCrossCheck port; it does not own the connection.

import type { MemoryRow } from '../../memory/src/store.ts';
import type { MaintenanceConfig } from './config.ts';
import { applyConfidenceChange } from './apply.ts';
import { isLiveMemory, type MaintenanceStore } from './store.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The C3 live-data cross-check seam: fetch the authoritative record and judge the memory against it. */
export interface LiveDataCrossCheck {
  check(memory: MemoryRow): Promise<'confirms' | 'contradicts' | 'unknown'>;
}

export interface OnUseResult {
  verdict: 'confirms' | 'contradicts' | 'unknown';
  /** true iff an immediate soft-conflict flag was raised (a contradiction). */
  softConflictRaised: boolean;
  /** true iff the confidence was affirmed (+corroboration). */
  affirmed: boolean;
}

/**
 * The on-use relevance cross-check (real-time). Given a used memory + the C3 checker, raise an immediate
 * soft-conflict flag on contradiction, or affirm confidence on confirmation. `actor` is the run/agent identity.
 */
export async function crossCheckOnUse(store: MaintenanceStore, memory: MemoryRow, checker: LiveDataCrossCheck, cfg: MaintenanceConfig, actor: string, nowMs: number): Promise<OnUseResult> {
  const nowIso = new Date(nowMs).toISOString();
  const verdict = await checker.check(memory);
  if (verdict === 'contradicts') {
    await store.task({ kind: 'soft_conflict', targetId: memory.id, action: 'review', detail: `live tool data contradicts memory ${memory.id} — immediate soft-conflict flag (WRT.002 path)`, at: nowIso });
    return { verdict, softConflictRaised: true, affirmed: false };
  }
  if (verdict === 'confirms') {
    const res = await applyConfidenceChange(store, memory, 'corroboration_sor', actor, `live tool data confirms memory ${memory.id} (relevance affirmed)`, cfg, { nowIso });
    return { verdict, softConflictRaised: false, affirmed: res.moved };
  }
  return { verdict, softConflictRaised: false, affirmed: false };
}

export interface RelevanceSweepResult {
  recordsAffected: number;
  flaggedIds: string[];
}

/**
 * The monthly relevance sweep. `lastUsedAtMs` maps a memory id to its last retrieved-or-confirmed epoch-ms; a
 * memory absent from the map falls back to its `updated_at`. Any live memory untouched for longer than the window
 * is flagged for relevance review.
 */
export async function runRelevanceSweep(store: MaintenanceStore, cfg: MaintenanceConfig, nowMs: number, lastUsedAtMs: ReadonlyMap<string, number> = new Map()): Promise<RelevanceSweepResult> {
  const memories = await store.listMemories();
  const nowIso = new Date(nowMs).toISOString();
  const windowMs = cfg.relevanceReviewWindowDays * DAY_MS;
  const live = memories.filter((m) => isLiveMemory(m, nowMs));

  const flaggedIds: string[] = [];
  for (const m of live) {
    const lastUsed = lastUsedAtMs.get(m.id) ?? Date.parse(m.updated_at);
    if (nowMs - lastUsed > windowMs) {
      flaggedIds.push(m.id);
      await store.task({ kind: 'relevance_review', targetId: m.id, action: 'relevance_review', detail: `memory ${m.id} not retrieved or confirmed in > ${cfg.relevanceReviewWindowDays} days — candidate for decay/retire`, at: nowIso });
    }
  }
  return { recordsAffected: flaggedIds.length, flaggedIds };
}
