// ISSUE-011 §8 step 7 — event_log retention + compliance redaction-tombstone (FR-7.LOG.006 / NFR-OBS.010).
//   - honour CFG-event_log_retention_window with an audit FLOOR (never prune below the floor)
//   - NEVER prune a row still referenced by an open task/approval/cleanup
//   - LOG every pruning run (count pruned, window applied) — pruning is never silent
//   - compliance erasure → redaction-tombstone: scrub summary/entity_ids in place via redacted_at, retain
//     the row + audit metadata (OD-074; the whitelisted trigger path)

import type { EventLogRow } from "./types.ts";
import type { EventLogStore, EventWriterLike } from "./retention-types.ts";
import type { ObservabilityConfig } from "./config.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionResult {
  window_days: number;
  pruned: string[]; // ids removed
  skipped_referenced: string[]; // ids inside the window-expired set but retained because still referenced
  cutoff: string; // ISO-8601 — rows older than this are prune-eligible
}

export interface RetentionDeps {
  store: EventLogStore;
  config: ObservabilityConfig;
  /** Server-authoritative "now" (AF-120 — the window is measured receiver-side, never a row-asserted clock). */
  now: () => Date;
  /** Predicate: is this row still referenced by an open task/approval/cleanup item? (never-prune-referenced). */
  isReferenced: (row: EventLogRow) => boolean;
  /** The writer used to LOG the pruning run itself (pruning is never silent — AC-7.LOG.006.2). */
  writer: EventWriterLike;
}

/**
 * Run one retention pass. Rows older than (now − retention_days) are prune-eligible, EXCEPT any still
 * referenced by an open item (those are skipped and the reason recorded). The window may never drop below
 * the audit floor — enforced in config.ts.validateObservabilityConfig; re-asserted here defensively.
 */
export async function runRetention(deps: RetentionDeps): Promise<RetentionResult> {
  const { store, config, now, isReferenced, writer } = deps;
  if (config.event_log_retention_days < config.event_log_retention_floor_days) {
    // Defensive #3 — a caller that somehow supplied an under-floor window fails loud, never silently prunes.
    throw new Error(
      `retention window ${config.event_log_retention_days}d is below the audit floor ` +
        `${config.event_log_retention_floor_days}d — refusing to prune (OD-072)`,
    );
  }

  const cutoffMs = now().getTime() - config.event_log_retention_days * DAY_MS;
  const cutoffIso = new Date(cutoffMs).toISOString();

  const all = await store.all();
  const pruned: string[] = [];
  const skipped: string[] = [];

  for (const row of all) {
    const createdMs = Date.parse(row.created_at);
    if (Number.isNaN(createdMs) || createdMs >= cutoffMs) continue; // inside the window — keep
    if (isReferenced(row)) {
      skipped.push(row.id); // never prune a referenced row (AC-7.LOG.006.1)
      continue;
    }
    await store.prune(row.id);
    pruned.push(row.id);
  }

  // AC-7.LOG.006.2 — every run records a summary event (count pruned, window applied). Pruning is never
  // silent. This write goes through the normal event-write API (redacted, cost-resolved).
  await writer.write({
    event_type: "reporter_push", // an operational/administrative event; carries the prune summary in payload
    summary:
      `event_log retention run: pruned ${pruned.length} row(s), skipped ${skipped.length} still-referenced, ` +
      `window ${config.event_log_retention_days}d (floor ${config.event_log_retention_floor_days}d)`,
    payload: {
      op: "retention_prune",
      window_days: config.event_log_retention_days,
      floor_days: config.event_log_retention_floor_days,
      pruned_count: pruned.length,
      skipped_referenced_count: skipped.length,
      cutoff: cutoffIso,
    },
    cost: 0,
  });

  return {
    window_days: config.event_log_retention_days,
    pruned,
    skipped_referenced: skipped,
    cutoff: cutoffIso,
  };
}

// ── Compliance erasure → redaction-tombstone (OD-074 / AC-7.LOG.006.3) ──────────────────────────────

export interface RedactionResult {
  redacted: string[]; // ids tombstoned
}

export interface RedactionDeps {
  store: EventLogStore;
  now: () => Date;
  writer: EventWriterLike;
}

/**
 * Erase a compliance subject from the event_log via redaction-tombstone: for every row matching the
 * predicate, scrub summary/entity_ids/payload IN PLACE (redacted_at set) while retaining the row + audit
 * metadata (created_at, event_type, task_id). The audit trail survives ("an event happened here"); the
 * subject becomes unidentifiable. The erasure is itself LOGGED (AC-7.LOG.006.3).
 */
export async function applyComplianceErasure(
  deps: RedactionDeps,
  matches: (row: EventLogRow) => boolean,
): Promise<RedactionResult> {
  const { store, now, writer } = deps;
  const all = await store.all();
  const redactedAt = now().toISOString();
  const redacted: string[] = [];

  for (const row of all) {
    if (!matches(row)) continue;
    if (row.redacted_at !== null) continue; // already tombstoned (one-way)
    await store.redactTombstone(row.id, redactedAt);
    redacted.push(row.id);
  }

  // The erasure is itself a logged operation (AC-7.LOG.006.3) — but it must NOT re-embed the erased PII.
  await writer.write({
    event_type: "reporter_push",
    summary: `compliance erasure applied: ${redacted.length} event_log row(s) redaction-tombstoned`,
    payload: { op: "compliance_erasure", redacted_count: redacted.length, redacted_at: redactedAt },
    cost: 0,
  });

  return { redacted };
}
