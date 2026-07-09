// ISSUE-030 (C2 MAT) — FR-2.MAT.002: the recompute orchestration over the MaturityStore port.
//
// Two clocks (ADR-002 §2): (a) recomputeAll = the DAILY slow-loop over every entity; (b) recomputeOnWrite = the
// on-memory-write recompute for the TOUCHED entity only (so onboarding progress feels live). BOTH stamp
// maturity_updated_at, re-roll the avg() aggregate, advance the cold-start ONE-WAY LATCH, and emit the loud
// maturity_recomputed event. Pure orchestration over the port — identical behaviour offline (fake) and live (pg).
//
// The scheduler that FIRES the daily loop is C5/C6 (FR-2.MNT.015), and the write path that CALLS recomputeOnWrite is
// ISSUE-024's sole-writer — neither is built here; this slice supplies the recompute functions they invoke.

import { computeMaturity, aggregateMaturity, type SlotClassifier, keywordSlotClassifier } from './maturity.ts';
import { expectedSlotsForType } from './slots.ts';
import { advanceColdStart, type ColdStartState } from './coldstart.ts';
import type { MaturityStore, MaturityConfig, MaturityRecomputed } from './store.ts';

export interface RecomputeOutcome {
  entityId: string;
  maturity: number | null;
  filledCount: number;
  expectedCount: number;
  /** Onboarding gap-question seed (FR-2.MAT.001 → FR-2.ING.008): the still-empty expected slots for this entity. */
  emptySlots: string[];
  aggregate: number | null;
  coldStart: ColdStartState;
}

/** Recompute ONE entity's Maturity, persist it (+ stamp), re-roll the aggregate, advance the cold-start latch, and
 *  emit the loud event. Shared inner step for both clocks. `trigger` tags the event's provenance. */
async function recomputeOne(
  store: MaturityStore,
  cfg: MaturityConfig,
  entityId: string,
  classify: SlotClassifier,
  nowMs: number,
  trigger: MaturityRecomputed['trigger'],
): Promise<RecomputeOutcome> {
  const entity = await store.getEntity(entityId);
  if (!entity) throw new Error(`recompute: entity '${entityId}' not found`); // loud (#3)

  const expected = expectedSlotsForType(cfg.expectedSlots, entity.type);
  const live = await store.liveMemoriesForEntity(entityId, nowMs);
  const result = computeMaturity(live, expected, classify, nowMs);

  const at = new Date(nowMs).toISOString();
  await store.setMaturity(entityId, result.maturity, at);

  // Re-roll the aggregate over the freshly-updated entity set + advance the ONE-WAY latch.
  const entities = await store.listEntities();
  const aggregate = aggregateMaturity(entities);
  const prevColdStart = await store.readColdStartState();
  const coldStart = advanceColdStart(prevColdStart, aggregate, cfg);
  if (coldStart.deactivated !== prevColdStart.deactivated || coldStart.phase !== prevColdStart.phase) {
    await store.writeColdStartState(coldStart);
  }

  await store.emitRecomputed({
    entityId,
    maturity: result.maturity,
    filledCount: result.filledCount,
    expectedCount: result.expectedCount,
    trigger,
    aggregate,
    coldStartDeactivated: coldStart.deactivated,
    at,
  });

  return {
    entityId,
    maturity: result.maturity,
    filledCount: result.filledCount,
    expectedCount: result.expectedCount,
    emptySlots: result.empty,
    aggregate,
    coldStart,
  };
}

/** The on-memory-write recompute for the touched entity (FR-2.MAT.002 §2 fast path). */
export async function recomputeOnWrite(
  store: MaturityStore,
  entityId: string,
  opts: { classify?: SlotClassifier; nowMs?: number } = {},
): Promise<RecomputeOutcome> {
  const cfg = await store.loadConfig();
  return recomputeOne(store, cfg, entityId, opts.classify ?? keywordSlotClassifier, opts.nowMs ?? Date.now(), 'on_write');
}

/** The daily slow-loop recompute over EVERY entity (FR-2.MAT.002 §2 slow path). Returns each entity's outcome; the
 *  final aggregate/coldStart reflect the whole pass. */
export async function recomputeAll(
  store: MaturityStore,
  opts: { classify?: SlotClassifier; nowMs?: number } = {},
): Promise<RecomputeOutcome[]> {
  const cfg = await store.loadConfig();
  const classify = opts.classify ?? keywordSlotClassifier;
  const nowMs = opts.nowMs ?? Date.now();
  const entities = await store.listEntities();
  const outcomes: RecomputeOutcome[] = [];
  for (const e of entities) {
    outcomes.push(await recomputeOne(store, cfg, e.id, classify, nowMs, 'daily'));
  }
  return outcomes;
}
