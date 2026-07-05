// ISSUE-075 §8 step 8 — the alert-routing config layer's WRITE-TIME validation + quiet-hours window math
// (FR-7.ALR.009 → OD-097, NFR-OBS.008). Two guarantees live here:
//   (a) AC-7.ALR.009.3 — a config write that would leave a CRITICAL-alert type with no resolvable
//       destination is REJECTED at config time (fail-closed; you cannot configure a hard-limit alert into
//       having nowhere to go). This is the write-time mirror of the runtime unroutable-fails-loud path.
//   (b) AC-7.ALR.009.2 / AC-NFR-OBS.008.2 — quiet-hours suppresses ONLY non-critical alerts; a critical /
//       hard-limit alert inside the window is delivered regardless. quietHoursSuppresses() encodes that.
// All window math uses a server-authoritative minute-of-day (AF-120) — never a client clock.

import type { AlertConfig, AlertType, RoleResolver } from "./types.ts";
import { CRITICAL_ALERT_TYPES, isCriticalType, resolveContact } from "./types.ts";

export class ConfigRejected extends Error {
  constructor(
    message: string,
    readonly strandedCriticalTypes: readonly AlertType[],
  ) {
    super(message);
    this.name = "ConfigRejected";
  }
}

/**
 * Does `type` have a RESOLVABLE destination under this config + the live role model? A destination is
 * resolvable iff (1) a routing rule exists for the type, AND (2) that rule's role currently resolves to ≥1
 * holder OR (3) the escalation-contact chain contains a contact that resolves to an ACTUAL recipient. The
 * dashboard is always durable, but the fails-loud contract (FR-7.ALR.009) is about DELIVERY to a recipient —
 * a type routed to a role nobody holds, whose only escalation contacts are role-shaped dead strings nobody
 * holds (a typo'd role, a removed user id), is UNROUTABLE and must be rejected. Resolvability is decided by the
 * SAME `resolveContact` rule the runtime routes through (types.ts), so write-time and runtime cannot disagree
 * — closing the drift where any bare non-empty string was accepted as "deliverable" even when it reached no one.
 */
export function hasResolvableDestination(
  type: AlertType,
  config: AlertConfig,
  roles: RoleResolver,
): boolean {
  const rule = config.alert_routing_rules[type];
  if (!rule) return false; // no routing rule at all → no configured destination
  const holders = roles.usersForRole(rule.role);
  if (holders.length > 0) return true;
  const chain = config.escalation_contacts[rule.role] ?? [];
  // an escalation contact only counts if IT resolves to a REAL recipient (a role with holders, or a KNOWN
  // user id) — a role-shaped string nobody holds is NOT a deliverable destination (fail-closed).
  return chain.some((contact) => resolveContact(contact, roles) !== null);
}

/**
 * Write-time validation (AC-7.ALR.009.3). REJECTS the config if ANY critical-alert type would be left with
 * no resolvable destination. Returns void on success; throws ConfigRejected (fail-closed) otherwise.
 * Validation is done against the SAME role model the runtime routes through, so the check is real.
 */
export function validateConfigOrReject(config: AlertConfig, roles: RoleResolver): void {
  const stranded: AlertType[] = [];
  for (const type of CRITICAL_ALERT_TYPES) {
    if (!hasResolvableDestination(type, config, roles)) stranded.push(type);
  }
  if (stranded.length > 0) {
    throw new ConfigRejected(
      `alert-routing config REJECTED (AC-7.ALR.009.3): critical alert type(s) [${stranded.join(", ")}] ` +
        `would have no resolvable destination — a hard-limit/critical alert can never be configured into having nowhere to go.`,
      stranded,
    );
  }
}

/**
 * Is `nowMin` (server minute-of-day, 0..1439) inside the quiet window? Handles a window that wraps midnight
 * (start > end). Deterministic, server-clock only (AF-120).
 */
export function inQuietWindow(quiet: AlertConfig["quiet_hours"], nowMin: number): boolean {
  if (!quiet.enabled) return false;
  const { start_min, end_min } = quiet;
  if (start_min === end_min) return false; // zero-width window suppresses nothing
  if (start_min < end_min) return nowMin >= start_min && nowMin < end_min; // same-day window
  return nowMin >= start_min || nowMin < end_min; // wraps past midnight
}

/**
 * Should THIS alert be suppressed by quiet-hours right now? The load-bearing rule (AC-7.ALR.009.2 /
 * AC-NFR-OBS.008.2): a critical / hard-limit alert is NEVER suppressed, whatever the window. Only a
 * non-critical alert inside an active window is suppressed. Fail-safe: on ANY doubt about class, treat as
 * critical (deliver) — quiet-hours may throttle noise, never silence #2/#3-class alerts.
 */
export function quietHoursSuppresses(type: AlertType, config: AlertConfig, nowMin: number): boolean {
  if (isCriticalType(type)) return false; // critical/hard-limit: ALWAYS delivered (never silenced)
  return inQuietWindow(config.quiet_hours, nowMin);
}
