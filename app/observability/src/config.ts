// ISSUE-011 §5 CFG — the observability tunables, transcribed VERBATIM from config-registry.md (Rule 0). At
// runtime a deployment's config store (ISSUE-010) supplies live values; these are the DEFAULTS + the floor
// contract this slice enforces. None is a secret.

export interface ObservabilityConfig {
  /** How long the full event_log history is kept before pruning. registry L219: 365 d, BOOT,
   *  "duration ≥ legal/audit floor (C10)". (FR-7.LOG.006 / OD-072 / NFR-OBS.010) */
  event_log_retention_days: number;
  /** The audit/legal floor the retention window may never go below (OD-072 — the exact numeric floor is a
   *  C10/Phase-5 compliance input; the CONTRACT — "never below the floor" — is enforced here). A retention
   *  window shorter than the floor is rejected loudly, never silently clamped (#3). */
  event_log_retention_floor_days: number;
  /** The watchdog's expected alert-engine heartbeat interval (ms) — the engine beats at least this often.
   *  (FR-7.ALR.008 / NFR-OBS.004; escalation/staleness windows themselves are ISSUE-012/075 config.) */
  alert_engine_heartbeat_interval_ms: number;
  /** How long the watchdog waits past a missed beat before declaring the engine stalled (ms). Must exceed
   *  the heartbeat interval so a single late beat is not a false stall. */
  alert_engine_stall_after_ms: number;
}

// Registry defaults (config-registry.md L219 for retention; the floor + watchdog cadences are the
// observability-skeleton contract values, per OD-072 / FR-7.ALR.008).
export const DEFAULT_OBSERVABILITY_CONFIG: ObservabilityConfig = {
  event_log_retention_days: 365,
  event_log_retention_floor_days: 90, // conservative operational floor; C10 sets the legal minimum (≥ this)
  alert_engine_heartbeat_interval_ms: 30_000, // 30 s
  alert_engine_stall_after_ms: 90_000, // 3 missed beats → stalled
};

/** Validate config; throw loudly on any out-of-contract value (#3 — never silently clamp). */
export function validateObservabilityConfig(c: ObservabilityConfig): ObservabilityConfig {
  const fail = (m: string): never => {
    throw new Error(`invalid observability config: ${m}`);
  };
  if (!Number.isInteger(c.event_log_retention_floor_days) || c.event_log_retention_floor_days < 1)
    fail(`event_log_retention_floor_days must be an int ≥ 1 (got ${c.event_log_retention_floor_days})`);
  if (!Number.isInteger(c.event_log_retention_days) || c.event_log_retention_days < 1)
    fail(`event_log_retention_days must be an int ≥ 1 (got ${c.event_log_retention_days})`);
  // OD-072: the retention window may NEVER drop below the audit/legal floor.
  if (c.event_log_retention_days < c.event_log_retention_floor_days)
    fail(
      `event_log_retention_days (${c.event_log_retention_days}) is below the audit floor ` +
        `(${c.event_log_retention_floor_days}) — under-retention loses the audit trail (#1/#3)`,
    );
  if (!Number.isInteger(c.alert_engine_heartbeat_interval_ms) || c.alert_engine_heartbeat_interval_ms < 1)
    fail(`alert_engine_heartbeat_interval_ms must be an int ≥ 1 (got ${c.alert_engine_heartbeat_interval_ms})`);
  if (!Number.isInteger(c.alert_engine_stall_after_ms) || c.alert_engine_stall_after_ms < 1)
    fail(`alert_engine_stall_after_ms must be an int ≥ 1 (got ${c.alert_engine_stall_after_ms})`);
  if (c.alert_engine_stall_after_ms <= c.alert_engine_heartbeat_interval_ms)
    fail(
      `alert_engine_stall_after_ms (${c.alert_engine_stall_after_ms}) must exceed the heartbeat interval ` +
        `(${c.alert_engine_heartbeat_interval_ms}) so a single late beat is not a false stall`,
    );
  return c;
}
