// ISSUE-025 (C2 RET) — FR-2.RET.005: rank the CLEARED candidates by the LIVE compound weighted score, apply the
// procedural boost, and trim to the top-N injection cap. The normalisation SHAPES are fixed by OD-169 (the weights +
// half-life are AF-002-tuned defaults); this module realises exactly those shapes:
//   • recency          = 0.5 ^ (age_days / CFG-rank_recency_half_life_days[90])   over created_at         → [0,1]
//   • confidence       = used directly (already 0–1). system_pointer is UNSCORED → EXCLUDED from this term (its weight
//                        is redistributed across the other three so its score stays comparable in [0,1]).
//   • entity-match     = Jaccard( task's resolved entities , candidate.entity_ids )                        → [0,1]
//   • vector-similarity= (cosine + 1) / 2                                                                  → [0,1]
// Then score = Σ w_i·s_i (over the terms that apply), a procedural memory is multiplied by CFG-procedural_boost (1.2),
// sort desc, take the top CFG-memories_injected_per_task (7). The boost is applied to the composite (it can push a
// procedural memory above the injection line — the design intent: "how we did it" is worth surfacing, L1727-1738).

import type { RankingWeights, RetrievalConfig } from './config.ts';
import type { RetrievalCandidate } from './store.ts';
import { isSystemPointer } from './candidate-filters.ts';

/** The per-candidate sub-signals (all [0,1]) + the composite. Exposed for the observability sample + the AF-002 EVAL. */
export interface RankedMemory {
  candidate: RetrievalCandidate;
  recency: number;
  /** confidence sub-signal, or null for an unscored system_pointer (excluded from the weighted sum). */
  confidence: number | null;
  entityMatch: number;
  vectorSimilarity: number;
  /** the composite weighted score AFTER the procedural boost (the sort key). */
  score: number;
}

/** age in whole+fractional days between created_at and now (both ISO). Negative (future-dated clock skew) clamps to 0. */
function ageDays(createdAtIso: string, nowIso: string): number {
  const ms = Date.parse(nowIso) - Date.parse(createdAtIso);
  return Math.max(0, ms) / 86_400_000;
}

/** recency = 0.5 ^ (age_days / half_life) — 1.0 for a brand-new memory, 0.5 at one half-life, → 0 as it ages. */
export function recencyScore(createdAtIso: string, nowIso: string, halfLifeDays: number): number {
  if (halfLifeDays <= 0) return 0; // a non-positive half-life is a mis-config; treat as maximally-decayed, not ∞ (#3-safe)
  return Math.pow(0.5, ageDays(createdAtIso, nowIso) / halfLifeDays);
}

/** entity-match = Jaccard overlap |A∩B| / |A∪B| of the task's resolved entities against the candidate's entity_ids.
 *  Empty-on-either-side → 0 (no measurable overlap). */
export function entityMatchScore(taskEntityIds: ReadonlySet<string>, candidateEntityIds: readonly string[]): number {
  if (taskEntityIds.size === 0 || candidateEntityIds.length === 0) return 0;
  const cand = new Set(candidateEntityIds);
  let inter = 0;
  for (const id of taskEntityIds) if (cand.has(id)) inter++;
  const union = taskEntityIds.size + cand.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** vector-similarity signal = (cosine + 1)/2, clamped to [0,1] (a cosine is in [-1,1]; guard float drift). A `null`
 *  cosine means the store produced NO vector score → 0 on this term (OD-169: "or 0 on this term, symmetric to
 *  entity-match"), distinct from a genuine cosine 0 (orthogonal) which maps to 0.5. */
export function vectorSimilarityScore(cosine: number | null): number {
  if (cosine === null) return 0;
  return Math.min(1, Math.max(0, (cosine + 1) / 2));
}

/** The weighted sum over the terms that apply. For a system_pointer the confidence term is dropped and its weight is
 *  redistributed proportionally across the remaining three (so the score is comparable in [0,1], never artificially
 *  depressed by a missing term). */
function composite(m: Omit<RankedMemory, 'candidate' | 'score'>, w: RankingWeights, unscored: boolean): number {
  if (unscored) {
    const denom = w.recency + w.entityMatch + w.vectorSimilarity;
    if (denom === 0) return 0;
    return (w.recency * m.recency + w.entityMatch * m.entityMatch + w.vectorSimilarity * m.vectorSimilarity) / denom;
  }
  return (
    w.recency * m.recency +
    w.confidence * (m.confidence ?? 0) +
    w.entityMatch * m.entityMatch +
    w.vectorSimilarity * m.vectorSimilarity
  );
}

export interface RankCtx {
  taskEntityIds: ReadonlySet<string>;
  nowIso: string;
  config: RetrievalConfig;
}

/** Score every cleared candidate (no trim). Deterministic. */
export function scoreCandidates(candidates: readonly RetrievalCandidate[], ctx: RankCtx): RankedMemory[] {
  const { config } = ctx;
  return candidates.map((c) => {
    const unscored = isSystemPointer(c.memory);
    const recency = recencyScore(c.memory.created_at, ctx.nowIso, config.rankRecencyHalfLifeDays);
    const confidence = unscored ? null : (c.memory.confidence ?? 0);
    const entityMatch = entityMatchScore(ctx.taskEntityIds, c.memory.entity_ids);
    const vectorSimilarity = vectorSimilarityScore(c.similarity);
    const base = composite({ recency, confidence, entityMatch, vectorSimilarity }, config.rankingWeights, unscored);
    const boosted = c.memory.type === 'procedural' ? base * config.proceduralBoost : base;
    return { candidate: c, recency, confidence, entityMatch, vectorSimilarity, score: boosted };
  });
}

/** Rank + trim per FR-2.RET.005: score, sort desc (id-tiebreak for determinism), take the top
 *  CFG-memories_injected_per_task. */
export function rankAndTrim(candidates: readonly RetrievalCandidate[], ctx: RankCtx): RankedMemory[] {
  const cap = Math.max(0, Math.trunc(ctx.config.memoriesInjectedPerTask));
  return scoreCandidates(candidates, ctx)
    .sort((a, b) => b.score - a.score || a.candidate.memory.id.localeCompare(b.candidate.memory.id))
    .slice(0, cap);
}
