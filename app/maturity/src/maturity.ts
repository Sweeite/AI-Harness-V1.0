// ISSUE-030 (C2 MAT) — FR-2.MAT.002: Maturity(entity) = filled slots / expected slots.
//
// Binary slot-fill at v1 (ADR-002 §1, anti-bloat guardrail #3): a slot is FILLED iff ≥1 LIVE memory fills it —
// LIVE = non-superseded (superseded_by is null) AND non-expired (expires_at null or in the future). Confidence-
// weighted slot-fill is deferred to v2 (OOS, ADR-002); the denominator (slots) does not change, so v2 layers on.
//
// The memory→slot mapping seam: the schema carries NO slot column on memories (schema.md §3), so "which slot a
// memory fills" is a pure, injected SlotClassifier the ENGINE applies over an entity's live memories. Both the fake
// and the live adapter apply the SAME classifier over the SAME live-memory set, so a green offline suite predicts
// live. The classifier's real-world quality (does slot-fill Maturity predict "the system is useful") is AF-034 —
// an EVAL flag validated in the AF-002 retrieval spike, NOT proven here.

import type { EntityRow, MemoryRow } from '../../memory/src/store.ts';
import { normaliseSlot } from './slots.ts';

/**
 * Which expected slots a single memory FILLS (0..n), by normalised slot name. Injected so the classifier can grow
 * (v2: confidence-weighted) without touching the gating math. `expected` is the entity type's slot list, passed so
 * a classifier can scope its matching to real slots. Returns a subset of `expected` (normalised); anything outside
 * `expected` is ignored by computeFilledSlots (a memory can only fill a declared slot).
 */
export type SlotClassifier = (memory: MemoryRow, expected: readonly string[]) => readonly string[];

/**
 * The v1 reference classifier: a memory fills expected slot S iff S's name (normalised, token-wise) appears in the
 * memory's content. Deliberately thin (ADR-002 guardrail #1 — no bespoke model). This is the DEFAULT; ingestion may
 * inject a richer classifier. Its precision/recall is the AF-034 EVAL question, not a spec claim.
 */
export const keywordSlotClassifier: SlotClassifier = (memory, expected) => {
  const haystack = memory.content.toLowerCase();
  return expected.filter((s) => haystack.includes(normaliseSlot(s)));
};

/** LIVE = counts toward slot-fill: not superseded AND not expired at `nowMs`. Shared by the fake + the adapter's
 *  post-fetch filter so offline and live agree on exactly which memories are countable (ADR-002 §1). */
export function isLiveMemory(m: MemoryRow, nowMs: number): boolean {
  if (m.superseded_by !== null) return false;
  if (m.expires_at !== null && Date.parse(m.expires_at) <= nowMs) return false;
  return true;
}

export interface FilledResult {
  /** Normalised names of the expected slots that are filled by ≥1 live memory. */
  filled: Set<string>;
  /** The original-cased expected slot names still empty (onboarding gap-question seed order-preserved). */
  empty: string[];
}

/** The distinct expected slots filled by an entity's LIVE memories, under the given classifier + clock. */
export function computeFilledSlots(
  liveMemories: readonly MemoryRow[],
  expected: readonly string[],
  classify: SlotClassifier,
): FilledResult {
  const expectedNorm = new Set(expected.map(normaliseSlot));
  const filled = new Set<string>();
  for (const m of liveMemories) {
    for (const s of classify(m, expected)) {
      const n = normaliseSlot(s);
      if (expectedNorm.has(n)) filled.add(n); // a memory can only fill a DECLARED slot
    }
  }
  const empty = expected.filter((s) => !filled.has(normaliseSlot(s)));
  return { filled, empty };
}

export interface MaturityResult {
  /** filled / expected, rounded to numeric(4,3) precision (3 decimals) so the fake matches the DB column exactly;
   *  null when the type declares NO expected slots (an undefined denominator, not 0/0 — mirrors the nullable column). */
  maturity: number | null;
  filledCount: number;
  expectedCount: number;
  filled: Set<string>;
  empty: string[];
}

/**
 * Maturity(entity) = filled / expected (FR-2.MAT.002). `memories` is the entity's memories (any liveness); this
 * filters to live via isLiveMemory before counting, so callers may pass the raw set. Rounds to 3 decimals to match
 * entities.maturity numeric(4,3) — the fake and the DB then store the identical value (R10: fake is the DB's model).
 */
export function computeMaturity(
  memories: readonly MemoryRow[],
  expected: readonly string[],
  classify: SlotClassifier,
  nowMs: number,
): MaturityResult {
  const live = memories.filter((m) => isLiveMemory(m, nowMs));
  const { filled, empty } = computeFilledSlots(live, expected, classify);
  const expectedCount = expected.length;
  const filledCount = filled.size;
  const maturity = expectedCount === 0 ? null : roundMaturity(filledCount / expectedCount);
  return { maturity, filledCount, expectedCount, filled, empty };
}

/** Round to numeric(4,3): 3 decimal places. Keeps the fake's stored value bit-identical to the live column. */
export function roundMaturity(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/**
 * Aggregate Maturity = avg(entities.maturity) over entities with a non-null Maturity (FR-2.MAT.002 §3, the cheap
 * rollup — NO separate table). Returns null when NO entity has a computed Maturity (a fresh deployment) — the caller
 * treats a null aggregate as 0% for gating (nothing learned yet), never as "mature". Entities whose type declares no
 * slots (maturity null) are excluded from the average, not counted as 0 — an undefined denominator is not a gap.
 */
export function aggregateMaturity(entities: readonly EntityRow[]): number | null {
  const vals = entities.map((e) => e.maturity).filter((m): m is number => m !== null);
  if (vals.length === 0) return null;
  const sum = vals.reduce((a, b) => a + b, 0);
  return roundMaturity(sum / vals.length);
}
