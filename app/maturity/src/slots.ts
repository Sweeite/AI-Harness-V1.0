// ISSUE-030 (C2 MAT) — FR-2.MAT.001: expected knowledge slots per entity TYPE (the Maturity denominator).
//
// Each entity TYPE (Client, Contact, …) declares a SMALL set of expected knowledge slots — 5–8 at v1, operator-
// editable config (CFG-expected_slots, config-registry Appendix A #2). Deliberately NOT an exhaustive ontology:
// ADR-002 anti-bloat guardrail #2 — an oversized slot set makes the denominator arbitrary and the 20/50/80 gating
// thresholds garbage-in. The empty slots double as the onboarding interview script (FR-2.MAT.001 → FR-2.ING.008),
// so this slice exposes emptySlots() for ingestion to consume (it does NOT build the interview path).
//
// Pure + shared by the fake AND the live adapter so an offline slot check predicts the live one (validate on read).

/** Raised by every maturity/slot/gating validation failure — carries a machine reason so callers surface it and
 *  never swallow a bad slot config (#3). Mirrors app/memory MemoryError. */
export class MaturityError extends Error {
  constructor(
    public reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'MaturityError';
  }
}
export const ERR_SLOT_COUNT = 'slot_count'; // an entity type has <5 or >8 expected slots (ADR-002 §1 / AC-2.MAT.001.1)
export const ERR_SLOT_BLANK = 'slot_blank'; // an empty/whitespace slot name
export const ERR_SLOT_DUP = 'slot_dup'; // a duplicate slot name within a type (would deflate the denominator)

/** Per-ADR-002 §1: 5–8 expected slots per entity type at v1. The bounds the config validator enforces and the
 *  `check` gate asserts against config-registry Appendix A #2 (`5 ≤ len ≤ 8`). */
export const SLOTS_MIN = 5;
export const SLOTS_MAX = 8;

/** CFG-expected_slots: entity TYPE → its ordered list of expected slot names. The Maturity denominator per type. */
export type ExpectedSlots = Record<string, string[]>;

/**
 * Validate an expected-slots config map (the whole object OR one type's array). Enforces the ADR-002 §1 shape for
 * EVERY declared type: 5 ≤ len ≤ 8, non-blank names, no duplicates within a type. Throws MaturityError on the first
 * violation so a bad operator edit is rejected LOUD at write, not silently absorbed into a wrong denominator (#3).
 * Pure — both the fake and the live adapter call it so offline + live reject an ill-formed slot config identically.
 */
export function validateExpectedSlots(map: ExpectedSlots): void {
  for (const [type, slots] of Object.entries(map)) {
    if (!Array.isArray(slots) || slots.length < SLOTS_MIN || slots.length > SLOTS_MAX) {
      throw new MaturityError(
        ERR_SLOT_COUNT,
        `entity type '${type}' must declare ${SLOTS_MIN}–${SLOTS_MAX} expected slots (got ${Array.isArray(slots) ? slots.length : 'non-array'}) — ADR-002 §1 / AC-2.MAT.001.1`,
      );
    }
    const seen = new Set<string>();
    for (const raw of slots) {
      if (typeof raw !== 'string' || raw.trim().length === 0) {
        throw new MaturityError(ERR_SLOT_BLANK, `entity type '${type}' has a blank expected-slot name`);
      }
      const norm = normaliseSlot(raw);
      if (seen.has(norm)) throw new MaturityError(ERR_SLOT_DUP, `entity type '${type}' has a duplicate expected-slot '${raw}'`);
      seen.add(norm);
    }
  }
}

/** Canonical slot key: trimmed + lowercased. Slot identity is case/space-insensitive so 'Renewal Date' and
 *  'renewal date' are one slot (avoids a duplicate silently inflating the denominator). */
export function normaliseSlot(name: string): string {
  return name.trim().toLowerCase();
}

/** The expected slots for a type, or [] if the type declares none (Maturity is then undefined — see computeMaturity). */
export function expectedSlotsForType(map: ExpectedSlots, type: string): string[] {
  return map[type] ?? [];
}

/**
 * The empty (unfilled) expected slots for an entity — expected MINUS filled, order preserved. This is the onboarding
 * gap-question seed (FR-2.MAT.001 → FR-2.ING.008): ingestion asks about exactly these. `filled` is the slot-name set
 * computed by the Maturity engine (normalised comparison). Consumed by ingestion, NOT built here.
 */
export function emptySlots(expected: readonly string[], filled: ReadonlySet<string>): string[] {
  return expected.filter((s) => !filled.has(normaliseSlot(s)));
}
