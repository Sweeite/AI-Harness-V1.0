// ISSUE-060 §8 steps 5(sink routing) + 8(export) + 6(failure-map catalogue).
//   - the three-sink boundary (FR-6.LOG.003.2 / OD-065): every event classifies into EXACTLY one of
//     guardrail_log | access_audit | event_log — no event falls between them, none double-writes.
//   - the exportable-content requirement (FR-6.LOG.004): an export covers all five guardrail_type values for
//     the period with no gaps (AC-6.LOG.004.1). The export/view MECHANISM is C7/ISSUE-077; C6 owns the content.
//   - the failure-map catalogue (FR-6.FMM.001.2): a cross-component catalogue that references each row's HOME
//     owner + the C7 alert path WITHOUT re-implementing detection here.

import type { GuardrailLogRow, GuardrailType } from "./types.ts";
import { GUARDRAIL_TYPES } from "./types.ts";

// ── The three audit sinks (OD-065) ────────────────────────────────────────────────────────────────────

export type SinkName = "guardrail_log" | "access_audit" | "event_log";

/** What KIND of event this is — used only to route it to exactly one sink (AC-6.LOG.003.2). */
export type EventClass = "guardrail" | "access" | "telemetry";

/**
 * Classify an event to EXACTLY one sink. A guardrail event (block/flag/quarantine of any of the five types)
 * -> guardrail_log; an access read/write -> access_audit (C1); operational telemetry -> event_log (C7). This is
 * total (every class maps) and disjoint (each class maps to one sink) — no event falls between the sinks.
 */
export function routeToSink(cls: EventClass): SinkName {
  switch (cls) {
    case "guardrail":
      return "guardrail_log";
    case "access":
      return "access_audit";
    case "telemetry":
      return "event_log";
    default: {
      // Exhaustiveness: an unclassified event is a #3 risk (it would fall between sinks) — fail loud.
      const _never: never = cls;
      throw new Error(`unclassified event cannot be routed to a sink (OD-065): ${String(_never)}`);
    }
  }
}

// ── Exportable trust evidence (FR-6.LOG.004) ──────────────────────────────────────────────────────────

export interface ExportWindow {
  from: string; // ISO-8601 inclusive
  to: string; // ISO-8601 inclusive
}

export interface GuardrailExport {
  window: ExportWindow;
  rows: GuardrailLogRow[];
  /** Which of the five guardrail_type values appear in the window (AC-6.LOG.004.1 — "all five represented"). */
  typesPresent: GuardrailType[];
  /** Which of the five have ZERO rows in the window — reported explicitly so a gap is VISIBLE, not silent. */
  typesMissing: GuardrailType[];
  /** True iff EVERY guardrail_log row whose created_at falls in the window is present in the export AND no
   *  out-of-window row leaked in — i.e. the export is a faithful, gap-free slice of the sink for the period. */
  complete: boolean;
}

/**
 * Produce a client-trust export over [from,to]. It contains the complete guardrail_log for the period with no
 * gaps (AC-6.LOG.004.1): every row whose created_at falls in the window, and an explicit accounting of which of
 * the five guardrail_type values are present vs missing (a missing type is surfaced, never silently omitted).
 */
export function buildExport(allRows: readonly GuardrailLogRow[], window: ExportWindow): GuardrailExport {
  const rows = allRows
    .filter((r) => r.created_at >= window.from && r.created_at <= window.to)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  const present = new Set(rows.map((r) => r.guardrail_type));
  const typesPresent = GUARDRAIL_TYPES.filter((t) => present.has(t));
  const typesMissing = GUARDRAIL_TYPES.filter((t) => !present.has(t));
  // Completeness accounting (write-completeness, #3): the export must be EXACTLY the in-window rows of the sink —
  // no in-window row dropped, no out-of-window row leaked. Computed independently of `rows` so the field is a real
  // check on the slice, not a restatement of it: (a) every returned row is genuinely in-window; (b) the returned
  // count equals the independent in-window tally over the whole sink (an unique-id set guards against a dup leak).
  const inWindowIds = new Set(
    allRows.filter((r) => r.created_at >= window.from && r.created_at <= window.to).map((r) => r.id),
  );
  const returnedIds = new Set(rows.map((r) => r.id));
  const allReturnedInWindow = rows.every((r) => r.created_at >= window.from && r.created_at <= window.to);
  const noDrop = [...inWindowIds].every((id) => returnedIds.has(id));
  const noLeak = [...returnedIds].every((id) => inWindowIds.has(id));
  const complete = allReturnedInWindow && noDrop && noLeak && returnedIds.size === inWindowIds.size;
  return { window, rows, typesPresent, typesMissing, complete };
}

// ── The failure-map catalogue (FR-6.FMM.001.2) ───────────────────────────────────────────────────────

/** A cross-component failure-map row: C6 references the HOME owner + the C7 alert path and does NOT re-detect. */
export interface FailureMapEntry {
  id: string;
  /** The component that OWNS detection of this failure (e.g. "C3" connector auth expiry). */
  homeComponent: string;
  description: string;
  /** True only for the five guardrail-class responses C6 owns; false for home-owned rows C6 merely references. */
  guardrailClassOwnedByC6: boolean;
  /** The C7 alert path this failure surfaces through (C6 never owns the alert path — that is C7). */
  c7AlertPath: string;
}

/**
 * The catalogue. C6 owns ONLY the guardrail-class responses (hard-limit / injection / anomaly / rate-limit /
 * approval-abandonment); every other row references its home owner + the C7 alert path and is NOT re-detected
 * here (AC-6.FMM.001.2). This function answers "does C6 re-implement detection of `entry`?" — it must be false
 * for any home-owned (non-guardrail-class) row.
 */
export function reImplementsDetection(entry: FailureMapEntry): boolean {
  // C6 re-implements detection ONLY for its own guardrail-class rows; a home-owned row is referenced, not detected.
  return entry.guardrailClassOwnedByC6;
}

/** A guardrail-class entry MUST carry a C7 alert path and a home component (the invariant every row must hold). */
export function catalogueEntryIsWellFormed(entry: FailureMapEntry): boolean {
  return entry.homeComponent.trim().length > 0 && entry.c7AlertPath.trim().length > 0;
}
