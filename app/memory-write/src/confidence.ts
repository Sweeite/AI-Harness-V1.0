// ISSUE-024 (C2 WRT) — FR-2.WRT.005: source-typed confidence assignment (pure, no I/O).
//
// The writer classifies each drafted memory into a richer WRITE-TIME source type than the coarse stored
// `memory_source` enum (only three DB values: ai_inferred / human_verified / system_pointer). The confidence
// BAND is keyed on the write-time source type; the STORED source enum is derived from it. This keeps the
// FR-2.WRT.005 band contract faithful while writing a legal `memories.source` value + honouring the golden rule
// (system_pointer is unscored — confidence null, source_ref required, NFR-CMP.002).
//
// Bands (FR-2.WRT.005, component-02 L617):
//   human_verified     0.95–1.0   → stored 'human_verified'
//   system_of_record   0.85–0.95  → stored 'ai_inferred'   (a fact extracted/confirmed FROM a system of record,
//                                                            source_ref points at the SoR; NOT the verbatim record)
//   ai_inferred_strong 0.75–0.85  → stored 'ai_inferred'
//   ai_inferred_weak   0.60–0.75  → stored 'ai_inferred'
//   system_pointer     unscored   → stored 'system_pointer' (the pointer to the SoR record itself — golden rule)

import type { MemorySource } from '../../memory/src/entity-types.ts';

/** The write-time source classification the writer assigns per drafted memory (richer than the stored enum). */
export type SourceType =
  | 'human_verified'
  | 'system_of_record'
  | 'ai_inferred_strong'
  | 'ai_inferred_weak'
  | 'system_pointer';

export const SOURCE_TYPES: readonly SourceType[] = [
  'human_verified',
  'system_of_record',
  'ai_inferred_strong',
  'ai_inferred_weak',
  'system_pointer',
] as const;

export interface ConfidenceBand {
  /** null band = unscored (system_pointer). */
  min: number | null;
  max: number | null;
  storedSource: MemorySource;
  scored: boolean;
}

/** The FR-2.WRT.005 band table. Frozen so a caller cannot mutate the source of truth. */
export const CONFIDENCE_BANDS: Readonly<Record<SourceType, ConfidenceBand>> = Object.freeze({
  human_verified: { min: 0.95, max: 1.0, storedSource: 'human_verified', scored: true },
  system_of_record: { min: 0.85, max: 0.95, storedSource: 'ai_inferred', scored: true },
  ai_inferred_strong: { min: 0.75, max: 0.85, storedSource: 'ai_inferred', scored: true },
  ai_inferred_weak: { min: 0.6, max: 0.75, storedSource: 'ai_inferred', scored: true },
  system_pointer: { min: null, max: null, storedSource: 'system_pointer', scored: false },
});

export interface AssignedConfidence {
  /** null iff the source type is unscored (system_pointer). */
  confidence: number | null;
  storedSource: MemorySource;
}

/**
 * Assign the initial confidence for a drafted memory by its write-time source type (FR-2.WRT.005). If the writer
 * proposed a confidence, it is CLAMPED into the source type's band (a model that over/under-claims is corrected,
 * never trusted to self-report outside the band); with no proposal, the band midpoint is used. system_pointer is
 * always unscored (confidence null) regardless of any proposal — the golden rule's convention.
 *
 * Pure + deterministic. Returns the confidence AND the legal stored `memories.source` enum value.
 */
export function assignConfidence(sourceType: SourceType, proposed?: number | null): AssignedConfidence {
  const band = CONFIDENCE_BANDS[sourceType];
  if (!band.scored || band.min === null || band.max === null) {
    return { confidence: null, storedSource: band.storedSource };
  }
  const mid = (band.min + band.max) / 2;
  const raw = proposed == null || !Number.isFinite(proposed) ? mid : proposed;
  const clamped = Math.min(band.max, Math.max(band.min, raw));
  // Round to numeric(4,3) precision (the memories.confidence column) so offline == live.
  const confidence = Math.round(clamped * 1000) / 1000;
  return { confidence, storedSource: band.storedSource };
}

/** True iff `confidence` falls inside the band for `sourceType` (the AC-2.WRT.005.1 assertion helper). */
export function inBand(sourceType: SourceType, confidence: number | null): boolean {
  const band = CONFIDENCE_BANDS[sourceType];
  if (!band.scored) return confidence === null;
  if (confidence === null || band.min === null || band.max === null) return false;
  return confidence >= band.min && confidence <= band.max;
}
