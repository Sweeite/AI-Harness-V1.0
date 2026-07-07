// ISSUE-077 §8 step 1 — per-sink retention with an audit floor + referenced-row protection + logged runs
// (FR-7.LOG.006.1/.2, FR-7.LOG.007.2, NFR-OBS.010).
//   - honour the per-sink configurable window with a compliance/audit FLOOR (never prune below the floor)
//   - NEVER prune a row still referenced by an open task/approval/cleanup (skip it + record why)
//   - LOG every pruning run (count pruned, count skipped, window applied) — pruning is never silent
//   - the retention floor must be ≥ the compliance/audit minimum (parity across all three sinks, OD-072)

import type { EventLogRow, GuardrailLogRow } from "./types.ts";
import type { EventLogStore, GuardrailLogStore, EventWriteSink } from "./store.ts";
import type { RetentionConfig } from "./config.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionResult {
  sink: "event_log" | "guardrail_log";
  window_days: number;
  floor_days: number;
  cutoff: string; // ISO-8601 — rows created before this are prune-eligible
  pruned: string[]; // ids removed
  skipped_referenced: string[]; // window-expired ids retained because still referenced
}

interface RetentionCommonDeps {
  config: RetentionConfig;
  /** Server-authoritative "now" — the window is measured receiver-side, never a row-asserted clock (AF-120). */
  now: () => Date;
  /** Records the pruning summary (pruning is never silent — AC-7.LOG.006.2). */
  writer: EventWriteSink;
}

/**
 * The EFFECTIVE prune boundary is the MORE protective of the window and the floor. The floor is a hard
 * PROTECTION floor: a row inside the floor window is never pruned, even if the configured window would say
 * otherwise (FR-7.LOG.007.2). Clamping UP to the floor is protective (it retains MORE, never less), so a
 * mis-set (under-floor) window can only ever RETAIN extra audit evidence — it can never silently prune below
 * the floor (#1/#3). The loud REJECTION of an under-floor window lives in config.validateRetentionConfig (the
 * config layer); the retention *pass* additionally clamps so it is impossible to under-retain even if an
 * unvalidated config reaches it. effective_days = max(window, floor).
 */
function effectiveRetentionDays(windowDays: number, floorDays: number): number {
  return Math.max(windowDays, floorDays);
}

/** Run one event_log retention pass. */
export async function runEventLogRetention(
  deps: RetentionCommonDeps & {
    store: EventLogStore;
    /** Predicate: is this row still referenced by an open task/approval/cleanup item? (never-prune-referenced). */
    isReferenced: (row: EventLogRow) => boolean;
  },
): Promise<RetentionResult> {
  const { store, config, now, isReferenced, writer } = deps;
  const window = config.event_log_retention_days;
  const floor = config.event_log_retention_floor_days;
  const effective = effectiveRetentionDays(window, floor);

  const cutoffMs = now().getTime() - effective * DAY_MS; // clamp UP to the floor — never prune inside it
  const cutoffIso = new Date(cutoffMs).toISOString();
  const pruned: string[] = [];
  const skipped: string[] = [];

  for (const row of await store.all()) {
    const createdMs = Date.parse(row.created_at);
    if (Number.isNaN(createdMs) || createdMs >= cutoffMs) {
      // logic-sweep fix (retention.ts:73 runEventLogRetention): surface floor-protected rows in `skipped` so
      // the run summary/result records WHY they were retained — mirrors runGuardrailLogRetention (below). A row
      // window-expired but floor-protected lands here (the cutoff was clamped up to the floor); without this it
      // was silently kept and omitted from skipped_referenced + the logged skipped_count, diverging from the
      // guardrail sink's skipped semantics for the identical situation.
      const windowCutoffMs = now().getTime() - window * DAY_MS;
      if (!Number.isNaN(createdMs) && createdMs < windowCutoffMs) skipped.push(row.id); // retained by the floor
      continue;
    }
    if (isReferenced(row)) {
      skipped.push(row.id); // never prune a referenced row (AC-7.LOG.006.1)
      continue;
    }
    await store.prune(row.id);
    pruned.push(row.id);
  }

  await logRun(writer, "event_log", window, floor, effective, cutoffIso, pruned, skipped);
  return { sink: "event_log", window_days: effective, floor_days: floor, cutoff: cutoffIso, pruned, skipped_referenced: skipped };
}

/** Run one guardrail_log retention pass (FR-7.LOG.007.2 — never prune inside the security/audit floor window). */
export async function runGuardrailLogRetention(
  deps: RetentionCommonDeps & {
    store: GuardrailLogStore;
    isReferenced: (row: GuardrailLogRow) => boolean;
  },
): Promise<RetentionResult> {
  const { store, config, now, isReferenced, writer } = deps;
  const window = config.guardrail_log_retention_days;
  const floor = config.guardrail_log_retention_floor_days;
  const effective = effectiveRetentionDays(window, floor); // clamp UP to the floor — never prune inside it

  const cutoffMs = now().getTime() - effective * DAY_MS;
  const cutoffIso = new Date(cutoffMs).toISOString();
  const pruned: string[] = [];
  const skipped: string[] = [];

  for (const row of await store.all()) {
    const createdMs = Date.parse(row.created_at);
    // A row created after cutoffMs is inside the effective (≥floor) window — retained (AC-7.LOG.007.2). A row
    // window-expired but floor-protected lands here too, because the cutoff was clamped up to the floor.
    if (Number.isNaN(createdMs) || createdMs >= cutoffMs) {
      // Distinguish a floor-protected row (window-expired but retained by the floor) so the run records why.
      const windowCutoffMs = now().getTime() - window * DAY_MS;
      if (!Number.isNaN(createdMs) && createdMs < windowCutoffMs) skipped.push(row.id); // retained by the floor
      continue;
    }
    if (isReferenced(row)) {
      skipped.push(row.id);
      continue;
    }
    await store.prune(row.id);
    pruned.push(row.id);
  }

  await logRun(writer, "guardrail_log", window, floor, effective, cutoffIso, pruned, skipped);
  return { sink: "guardrail_log", window_days: effective, floor_days: floor, cutoff: cutoffIso, pruned, skipped_referenced: skipped };
}

async function logRun(
  writer: EventWriteSink,
  sink: string,
  window: number,
  floor: number,
  effective: number,
  cutoffIso: string,
  pruned: string[],
  skipped: string[],
): Promise<void> {
  await writer.writeSummary({
    event_type: "reporter_push", // an operational/administrative event carrying the prune summary
    summary:
      `${sink} retention run: pruned ${pruned.length} row(s), skipped ${skipped.length} still-referenced/in-floor, ` +
      `effective window ${effective}d (configured ${window}d, floor ${floor}d)`,
    payload: {
      op: "retention_prune",
      sink,
      window_days: effective, // the EFFECTIVE (floor-clamped) window actually applied
      configured_window_days: window,
      floor_days: floor,
      pruned_count: pruned.length,
      skipped_count: skipped.length,
      cutoff: cutoffIso,
    },
  });
}
