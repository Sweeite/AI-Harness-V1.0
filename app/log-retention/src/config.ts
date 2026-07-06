// ISSUE-077 §5 CFG — the retention/staleness/price tunables, transcribed from config-registry.md (Rule 0). At
// runtime a deployment's config store (ISSUE-010) supplies live values; these are the DEFAULTS + the floor
// CONTRACT this slice enforces. None is a secret.
//
// config-registry.md L219: `event_log_retention_window` = 365 d, BOOT, "duration ≥ legal/audit floor (C10)".
// config-registry.md L228: `deployment_staleness_window` = 15 min, LIVE, "duration ≥ push interval".
// config-registry.md L229: `polling_interval_health_metrics_s` = 30 s, LIVE.
//
// The retention FLOORS are NOT registry keys — OD-072 defers the exact numeric floor to a C10/Phase-5
// compliance input. This slice enforces the CONTRACT ("retention window may NEVER drop below the compliance/
// audit floor"), taking the floor as a *parameter*, and refusing (loudly, #3) any window below it. It does NOT
// invent a numeric legal minimum.

export interface RetentionConfig {
  /** How long the full history is kept before pruning (days). One window is applied per sink; the guardrail
   *  and audit sinks may carry a stricter (larger) floor than the event_log. (FR-7.LOG.006 / FR-7.LOG.007 /
   *  NFR-OBS.010) */
  event_log_retention_days: number;
  guardrail_log_retention_days: number;
  config_audit_log_retention_days: number;
  /** The audit/legal/security floor each sink's window may never go below (OD-072 — the exact numeric floor
   *  is a C10/Phase-5 compliance input; the CONTRACT "never below the floor" is enforced here). Supplied as a
   *  parameter, NOT invented. A window shorter than its floor is rejected loudly, never silently clamped (#3). */
  event_log_retention_floor_days: number;
  guardrail_log_retention_floor_days: number;
  config_audit_log_retention_floor_days: number;
}

/** The mgmt-plane staleness window (FR-7.MGM.002 / NFR-OBS.006). */
export interface StalenessConfig {
  /** deployment_staleness_window — how old a cross-deployment card can be before it reads stale (seconds).
   *  registry L228: 15 min. Invariant: must be ≥ the push interval so a healthy deployment is never falsely
   *  stale between pushes. */
  deployment_staleness_window_s: number;
  /** polling_interval_health_metrics_s — the reporter's push cadence (registry L229: 30 s). */
  push_interval_s: number;
  /** The evaluator's own heartbeat window (AF-118 meta-staleness) — if the evaluator itself has not swept
   *  within this, the stale-detector is declared down (a surfaced meta-#3 condition). */
  evaluator_heartbeat_window_s: number;
}

// Registry defaults.
export const DEFAULT_RETENTION_CONFIG: RetentionConfig = {
  event_log_retention_days: 365, // registry L219
  guardrail_log_retention_days: 365, // OD-072 per-sink; the guardrail floor may raise this at deploy
  config_audit_log_retention_days: 365, // parity read only (FR-7.LOG.008 governs; ISSUE-010)
  // Conservative OPERATIONAL floors; C10/Phase-5 sets the LEGAL minimum (which must be ≥ these). Not invented
  // as legal minima — placeholders whose only asserted property is "window ≥ floor" (OD-072).
  event_log_retention_floor_days: 90,
  guardrail_log_retention_floor_days: 90,
  config_audit_log_retention_floor_days: 90,
};

export const DEFAULT_STALENESS_CONFIG: StalenessConfig = {
  deployment_staleness_window_s: 15 * 60, // 15 min (registry L228)
  push_interval_s: 30, // registry L229
  evaluator_heartbeat_window_s: 2 * 60, // the sweep must run at least this often or it reads stalled (AF-118)
};

/** Validate retention config; throw loudly on any out-of-contract value (#3 — never silently clamp). The
 *  central invariant (OD-072): every sink's retention window is ≥ its compliance/audit floor. */
export function validateRetentionConfig(c: RetentionConfig): RetentionConfig {
  const fail = (m: string): never => {
    throw new Error(`invalid retention config: ${m}`);
  };
  const sinks: Array<[string, number, number]> = [
    ["event_log", c.event_log_retention_days, c.event_log_retention_floor_days],
    ["guardrail_log", c.guardrail_log_retention_days, c.guardrail_log_retention_floor_days],
    ["config_audit_log", c.config_audit_log_retention_days, c.config_audit_log_retention_floor_days],
  ];
  for (const [name, window, floor] of sinks) {
    if (!Number.isInteger(floor) || floor < 1) fail(`${name}_retention_floor_days must be an int ≥ 1 (got ${floor})`);
    if (!Number.isInteger(window) || window < 1) fail(`${name}_retention_days must be an int ≥ 1 (got ${window})`);
    // OD-072: the retention window may NEVER drop below the audit/legal floor.
    if (window < floor)
      fail(
        `${name}_retention_days (${window}) is below its audit floor (${floor}) — under-retention loses the ` +
          `audit trail (#1/#3); refusing (OD-072)`,
      );
  }
  return c;
}

/** Validate staleness config: the staleness window must exceed the push interval, and the evaluator heartbeat
 *  window must be positive. A window ≤ the push interval would flag a healthy deployment stale between pushes. */
export function validateStalenessConfig(c: StalenessConfig): StalenessConfig {
  const fail = (m: string): never => {
    throw new Error(`invalid staleness config: ${m}`);
  };
  if (!Number.isInteger(c.push_interval_s) || c.push_interval_s < 1) fail(`push_interval_s must be an int ≥ 1 (got ${c.push_interval_s})`);
  if (!Number.isInteger(c.deployment_staleness_window_s) || c.deployment_staleness_window_s < 1)
    fail(`deployment_staleness_window_s must be an int ≥ 1 (got ${c.deployment_staleness_window_s})`);
  if (c.deployment_staleness_window_s <= c.push_interval_s)
    fail(
      `deployment_staleness_window_s (${c.deployment_staleness_window_s}) must exceed push_interval_s ` +
        `(${c.push_interval_s}) — else a healthy deployment reads stale between pushes (registry §J invariant)`,
    );
  if (!Number.isInteger(c.evaluator_heartbeat_window_s) || c.evaluator_heartbeat_window_s < 1)
    fail(`evaluator_heartbeat_window_s must be an int ≥ 1 (got ${c.evaluator_heartbeat_window_s})`);
  return c;
}
