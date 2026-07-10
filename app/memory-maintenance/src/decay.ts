// ISSUE-027 (C2 MNT) — FR-2.MNT.002: the daily soft-decay job. For each LIVE memory older than
// `soft_decay_age_months` (6) with confidence < 0.8 and no newer confirming memory, it multiplies confidence by
// `soft_decay_multiplier` (0.95) toward `confidence_floor` (0.5) — NEVER deleting (the port has no delete), NEVER
// decaying a human_verified memory, and NEVER decaying a memory in active review (freeze). Each qualifying drop is
// fed to the amber/bulk detectors (FR-2.MNT.003) and the whole run is counted for the FR-2.MNT.015 run record.
//
// The decay-never-deletes guarantee (L1815 / NFR-DR.008) is structural here: decay only ever calls setConfidence.

import type { MemoryRow } from '../../memory/src/store.ts';
import type { MaintenanceConfig } from './config.ts';
import { applyConfidenceChange } from './apply.ts';
import { BulkDropAccumulator } from './alerts.ts';
import { isLiveMemory, type MaintenanceStore } from './store.ts';

const AVG_MONTH_MS = (365.25 / 12) * 24 * 60 * 60 * 1000;

/** Age of a memory in months at `nowMs` (average-month approximation; monotone, deterministic). */
export function ageMonths(memory: MemoryRow, nowMs: number): number {
  return (nowMs - Date.parse(memory.created_at)) / AVG_MONTH_MS;
}

/**
 * The decay-eligibility predicate (pure). A memory decays only when it is: live, scored, below the 0.8 "settled"
 * bar, old enough, NOT human_verified, NOT under review, and has no newer confirming memory (a memory confirmed
 * since the last run is not stale). `hasNewerConfirming` is computed against the full live set by the job.
 */
export function decayEligible(memory: MemoryRow, cfg: MaintenanceConfig, nowMs: number, underReview: boolean, hasNewerConfirming: boolean): boolean {
  if (!isLiveMemory(memory, nowMs)) return false;
  if (memory.confidence === null) return false; // system_pointer — unscored, never decays
  if (memory.source === 'human_verified') return false; // never decay human-written (L1695)
  if (underReview) return false; // frozen in active review
  if (memory.confidence >= 0.8) return false;
  if (ageMonths(memory, nowMs) < cfg.softDecayAgeMonths) return false;
  if (hasNewerConfirming) return false;
  return true;
}

export interface DecayRunResult {
  recordsAffected: number;
  decayedIds: string[];
  amberFlags: number;
  bulkAlert: boolean;
}

/**
 * Run the daily soft-decay pass. Applies the multiplicative fade to every eligible memory through the governed
 * confidence path, raises an amber flag on each amber crossing, and one bulk-drop alert if the run's drops burst
 * past the threshold within the window. Returns the counts for the run record.
 */
export async function runSoftDecay(store: MaintenanceStore, cfg: MaintenanceConfig, nowMs: number): Promise<DecayRunResult> {
  const memories = await store.listMemories();
  const underReview = await store.underReviewMemoryIds();
  const nowIso = new Date(nowMs).toISOString();
  const live = memories.filter((m) => isLiveMemory(m, nowMs));

  const bulk = new BulkDropAccumulator();
  const decayedIds: string[] = [];
  let amberFlags = 0;

  for (const m of memories) {
    // "confirmed since last run" ≈ a newer live memory sharing ≥1 entity (a fresher signal about the same subject).
    const entitySet = new Set(m.entity_ids);
    const hasNewerConfirming = live.some((o) => o.id !== m.id && o.entity_ids.some((e) => entitySet.has(e)) && Date.parse(o.created_at) > Date.parse(m.created_at));
    if (!decayEligible(m, cfg, nowMs, underReview.has(m.id), hasNewerConfirming)) continue;

    const res = await applyConfidenceChange(store, m, 'soft_decay', 'service_role:soft_decay', `daily soft-decay ×${cfg.softDecayMultiplier} (stale ${ageMonths(m, nowMs).toFixed(1)}mo, unconfirmed)`, cfg, { nowIso });
    if (!res.moved) continue; // already at the floor — a logged no-op, not a decay
    decayedIds.push(m.id);
    bulk.record(nowMs);
    if (res.crossedAmber) {
      amberFlags++;
      await store.alert({ kind: 'amber_zone', memoryIds: [m.id], detail: `confidence crossed below amber ${cfg.amberZoneThreshold} (now ${res.newConfidence}) — review before it drops below the ${cfg.retrievalConfidenceThreshold} retrieval floor`, at: nowIso });
    }
  }

  const bulkAlert = bulk.fired(cfg);
  if (bulkAlert) {
    await store.alert({ kind: 'bulk_drop', memoryIds: decayedIds, detail: `${bulk.count} confidence drops within ${cfg.bulkDropAlertWindowMinutes}min (> ${cfg.bulkDropAlertCount}) — systemic erosion, something changed wholesale`, at: nowIso });
  }
  return { recordsAffected: decayedIds.length, decayedIds, amberFlags, bulkAlert };
}
