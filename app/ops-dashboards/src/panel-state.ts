// ISSUE-078 — the false-healthy panel-state machine (NFR-OBS.011 / AC-NFR-OBS.011.1; AC-7.RTP.004.2). This is
// the DEFINING discipline of both surfaces: a panel that failed to load, or is stale, must say so — it must
// NEVER render a reassuring "0" / "$0" / "✓" / "all clear" / "Live". The healthy EMPTY state (a true zero:
// "no failures", "no dead-lettered tasks") is distinct from the ERROR state ("couldn't load — can't confirm")
// and from a STALE state ("stale as-of…"). Conflating them is the cardinal #3 sin this surface exists to
// prevent (a green health strip that is actually a fetch failure hides a down engine).

/** The raw outcome of a panel's poll, before it is turned into an honest render. */
export type PollOutcome =
  | { kind: "loading" }
  | { kind: "ok"; hasData: boolean } // hasData=false ⇒ a genuine empty (the detector ran, found nothing)
  | { kind: "error"; reason: string } // the poll/check failed — we CANNOT confirm health
  | { kind: "partial"; loaded: string[]; failed: string[] } // some sub-signals loaded, others failed
  | { kind: "stale"; ageSeconds: number }; // last good poll too old (see freshness.ts)

/** How a panel renders. `falseHealthyForbidden` panels (every one on these surfaces) must never carry
 *  `healthy:true` unless `state==="ok-data"` or `"empty"` — asserted by `assertNotFalseHealthy`. */
export type RenderState = "loading" | "ok-data" | "empty" | "error" | "partial" | "stale";

export interface PanelRender {
  state: RenderState;
  /** The primary display token. On error/stale it is the honest "—"/"couldn't load"/"stale" copy, NEVER a
   *  numeric 0 or a ✓. */
  display: string;
  /** True ONLY for ok-with-data and the true-empty healthy state. Never true on error/partial/stale. */
  healthy: boolean;
  /** For partial: which sub-signals could not be confirmed (rendered "couldn't load", not "0"). */
  unconfirmed: string[];
}

/**
 * Turn a poll outcome into an honest render. `emptyCopy` is the panel's TRUE-empty message (the healthy "no
 * X in window" state); `errorCopy` is its "couldn't load" message. The two are never interchanged.
 */
export function renderPanel(outcome: PollOutcome, copy: { empty: string; error: string }): PanelRender {
  switch (outcome.kind) {
    case "loading":
      // NEVER a green ✓ before data (surface-05 Panel-1 Loading state).
      return { state: "loading", display: "loading…", healthy: false, unconfirmed: [] };
    case "ok":
      return outcome.hasData
        ? { state: "ok-data", display: "loaded", healthy: true, unconfirmed: [] }
        : { state: "empty", display: copy.empty, healthy: true, unconfirmed: [] };
    case "error":
      // The cardinal case: an errored panel reads "—"/"couldn't load", never "0"/"✓" (AC-NFR-OBS.011.1).
      return { state: "error", display: copy.error, healthy: false, unconfirmed: [] };
    case "partial":
      return {
        state: "partial",
        display: "— (partial: some signals couldn't load)",
        healthy: false,
        unconfirmed: [...outcome.failed],
      };
    case "stale":
      return {
        state: "stale",
        display: `stale as-of last poll (${outcome.ageSeconds}s ago)`,
        healthy: false,
        unconfirmed: [],
      };
  }
}

/** NFR-OBS.011 guard — throws if a render would present a false-healthy view. The forbidden set: an
 *  error/partial/stale render that claims `healthy` or whose display looks like a reassuring 0/✓/all-clear.
 *  Used in tests as the false-healthy sweep, and callable by any render path as a runtime assertion. */
const FALSE_HEALTHY_TOKENS = ["0", "$0", "0.00", "✓", "all clear", "all-clear", "all healthy", "live"];
export function assertNotFalseHealthy(r: PanelRender): void {
  const notHealthyState = r.state === "error" || r.state === "partial" || r.state === "stale" || r.state === "loading";
  if (notHealthyState && r.healthy) {
    throw new Error(`false-healthy: state=${r.state} must not claim healthy:true (NFR-OBS.011)`);
  }
  if (notHealthyState) {
    const d = r.display.trim().toLowerCase();
    for (const tok of FALSE_HEALTHY_TOKENS) {
      if (d === tok) {
        throw new Error(`false-healthy: a ${r.state} panel rendered "${r.display}" — must read "—"/"couldn't load"/"stale" (NFR-OBS.011)`);
      }
    }
  }
}

// ── Cost (ADR-003 / FR-7.COST.001) — estimate-grade only; a blind meter is distinct from a true $0 ──────

export interface CostReading {
  /** null ⇒ the meter is blind (cost_unknown sentinel), which is NOT the same as a genuine 0 (FR-7.LOG.004). */
  estimatedUsd: number | null;
  blindMeterCount: number; // count of cost_unknown events — a blind cost meter is shown explicitly
}

/** Render a cost figure. ALWAYS carries the word "estimate" (ADR-003 — never an invoice); a blind meter reads
 *  "unknown", never "$0"; a true zero reads "$0.00 estimated". */
export function renderCost(reading: CostReading): { display: string; estimateLabelled: boolean } {
  if (reading.estimatedUsd === null || reading.blindMeterCount > 0) {
    const known = reading.estimatedUsd === null ? "unknown" : `$${reading.estimatedUsd.toFixed(2)} (partial)`;
    return {
      display: `${known} estimated — ${reading.blindMeterCount} event(s) with unknown cost (blind meter)`,
      estimateLabelled: true,
    };
  }
  return { display: `$${reading.estimatedUsd.toFixed(2)} estimated`, estimateLabelled: true };
}

// ── DLQ unattended-escalation badge (AC-5.JOB.006.2) ────────────────────────────────────────────────────
//
// The escalation is C5-EMITTED server-side (a recorded heartbeat, correct even with no dashboard open). This
// surface REFLECTS that emitted state — it does not compute the staleness age itself. A latched escalation
// PERSISTS while the panel is stale (a stale DLQ that was overdue is still overdue).

export interface DlqEscalationSignal {
  serverEscalated: boolean; // the C5-emitted state (AC-5.JOB.006.2)
  oldestEntryAgeHours: number | null;
}

export function dlqBadge(
  signal: DlqEscalationSignal,
  panelState: RenderState,
): { show: boolean; text: string } {
  if (signal.serverEscalated) {
    // Persist the loud condition even on a stale/errored panel — the C5 signal is server-owned.
    return { show: true, text: `UNATTENDED DLQ — escalated (oldest ${signal.oldestEntryAgeHours ?? "?"}h)` };
  }
  // On error we do NOT assert "no escalation" — the badge is simply not asserted; the panel-state error copy
  // carries the "couldn't load" (we never render a reassuring "0 escalations" on a failed poll).
  if (panelState === "error" || panelState === "stale" || panelState === "partial") return { show: false, text: "" };
  return { show: false, text: "" };
}
