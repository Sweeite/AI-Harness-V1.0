// ISSUE-036 §8 — the OPT port + shared types + the in-memory fake reference model.
//
// This slice adds NO table of its own (issue §5 DATA): the run cache is ephemeral (a per-run object,
// no persistence), the confidence-gate reads `tools` (via the ISSUE-032 selector) + a CFG knob, and
// the graceful-degradation gap is a STRUCTURED FIELD on the task result (result schema owned by C5/C7).
// The only durable side effect OPT owns is the OBSERVABILITY emission (issue §8 step 5): below-threshold
// ask events + missing-tool events go to `event_log`. That crosses a table this slice may NOT author,
// so — like the task-queue EventSink (app/task-queue/src/store.ts) — we model an OptEventSink PORT and
// prove the emission offline against a fake; the live pg adapter (supabase-store.ts) writes real
// event_log rows, authored to the 0001 baseline DDL, NOT run live.
//
// FAKE-vs-LIVE discipline (session-69 catch): the fake models the SAME shapes/constraints the live DDL
// and the ISSUE-032 runtime enforce, so it cannot pass offline while the live adapter would throw:
//   • the read/write category branch is the connector-runtime `ToolCategory` — a `write` is
//     STRUCTURALLY ineligible for the run cache (never keyed, never served) exactly as FR-3.OPT.002
//     mandates, not by a soft check the live path could skip.
//   • the event_log emission carries an `event_type` the baseline enum must admit — the fake asserts
//     the value is one the DDL accepts (see EVENT_TYPES below), so a value the enum would reject cannot
//     pass here either. The two NEW OPT event_type values are NOT yet in the 0001 enum → owed as a
//     shared-spec delta (results/proposed-shared-spec.md); the fake pins the exact strings.

// The connector-runtime is the runtime these four behaviours plug into (issue §7 blocked-by ISSUE-032;
// "May import: @harness/connector-runtime"). We consume its read/write CATEGORY branch + tool row by a
// type-only relative import of its store module (reading a sibling is allowed; we author nothing there).
// We import from store.ts — NOT index.ts — so the sibling's `pg`-bearing live adapter is never pulled
// into this package's type graph (a type-only import of the pure port; no runtime coupling).
import type { ToolRow, ToolCategory } from '../../connector-runtime/src/store.ts';

export type { ToolRow, ToolCategory };

// ── The CFG knob this slice CONSUMES (Phase-2 registry §config-registry L159 owns the key; we do not
//    define it). CFG-tool_selection_confidence_threshold: float 0–1, LIVE, default 0.7. ──────────────
export interface OptConfig {
  /** CFG-tool_selection_confidence_threshold — how sure the AI must be before calling vs asking. */
  tool_selection_confidence_threshold: number;
}

export const DEFAULT_OPT_CONFIG: OptConfig = {
  // config-registry.md L159 default (0.7). Tuning is an EVAL concern (issue §2 Out), not this build.
  tool_selection_confidence_threshold: 0.7,
};

// ── Observability emission (issue §8 step 5). Two OPT event_type values → event_log. NEITHER is in the
//    0001 baseline `event_type` enum yet (grep confirms: task_started, tool_called, …, no ask/missing-
//    tool value) → owed as an additive enum delta in results/proposed-shared-spec.md. The fake pins the
//    exact strings so the live adapter and the offline proof agree. ────────────────────────────────
export type OptEventType =
  | 'tool_selection_ask' // FR-3.OPT.001 — a below-threshold ask (a wrong call was AVOIDED, logged not silent)
  | 'tool_unavailable'; // FR-3.OPT.004 — a required tool was missing; the gap was flagged (never silent — #3)

export const OPT_EVENT_TYPES: readonly OptEventType[] = ['tool_selection_ask', 'tool_unavailable'] as const;

export interface OptEvent {
  event_type: OptEventType;
  /** Plain-English, never empty (event_log.summary is NOT NULL — AC-7.LOG.002.2). */
  summary: string;
  /** Redacted payload — no tokens/secrets (FR-7.LOG.005). Structured detail for the surfaced event. */
  payload: Record<string, unknown>;
  /** Nullable task attribution (event_log.task_id references task_queue). */
  task_id: string | null;
}

/** The event_log seam OPT writes its two observability events to (C7 / ISSUE-011). Mirrors the
 *  task-queue EventSink: an append-only sink, never a delete/update path (#1 event_log is append-only). */
export interface OptEventSink {
  append(ev: OptEvent): Promise<void>;
}

// ── FR-3.OPT.004 — the STRUCTURED, MANDATORY-TO-READ gap field (AC-3.OPT.004.2). This is NOT advisory
//    free-text: it is a typed object a downstream consumer MUST read to know the result is partial. The
//    `acknowledged` flag models "mandatory-to-read": a consumer that presents the result as complete
//    without acknowledging the gap is a bug the type makes visible (a consumer reads `gap` then flips
//    `acknowledged`). C3 GUARANTEES the field is present + structured; it cannot force a consumer to
//    read it (issue §5 UI / FR-3.OPT.004 Notes seam — a C2/C5/C6/C8 obligation). ────────────────────
export interface ResultGap {
  /** The tool that was unavailable (name), so the consumer knows exactly what is missing. */
  missing_tool: string;
  /** Why it was unavailable (disconnected / disabled / unscoped) — machine-readable, not prose. */
  reason: GapReason;
  /** The concrete sub-task(s) that could NOT be done because of the missing tool. */
  skipped: string[];
  /** True once a downstream consumer has read + acknowledged this gap (mandatory-to-read handshake). */
  acknowledged: boolean;
}

export type GapReason = 'disconnected' | 'disabled' | 'unscoped';
export const GAP_REASONS: readonly GapReason[] = ['disconnected', 'disabled', 'unscoped'] as const;

/** A task result carrying the mandatory gap channel. `complete` is DERIVED, never set directly: a result
 *  with any un-acknowledged gap is NOT complete (the #3 guarantee — a partial can never masquerade as
 *  whole). C5/C7 own the full result schema; this is the minimal shape OPT guarantees onto it. */
export interface DegradableResult<T> {
  /** The doable part that WAS produced (FR-3.OPT.004 — complete what you can). */
  output: T;
  /** Zero or more structured gaps. Empty ⇒ nothing was skipped. */
  gaps: ResultGap[];
  /** True only if a fully-blocking dependency raised a recoverable pause (handed to DSC / ISSUE-038). */
  paused: boolean;
}
