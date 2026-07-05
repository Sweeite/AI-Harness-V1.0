// @harness/alerting — ISSUE-075 (C7 alerting layer on the ISSUE-011 observability skeleton). Public surface:
// the ports + in-memory fake reference model (notifications / event_log / config), the seven-rule engine, the
// routing + escalation + fails-loud delivery engine, the config write-time validation, and the live pg
// adapter authored to the DDL. Seams this slice stops at: ISSUE-011 owns event_log + the alert-engine
// watchdog (consumed here via the health-bit channel); ISSUE-086 owns the config-admin WRITE UI (calls
// validateConfigOrReject on Save); ISSUE-073/078/079 render the notification centre; ISSUE-012 carries the
// mgmt-plane push. This slice delivers the rules + routing + escalation + durability + fails-loud contract.
//
// The `check` CLI runs the offline build-time gates (no DB, no network):
//   (1) severity classification is internally consistent — every CRITICAL type is non-suppressible + never
//       quiet-silenced (a divergence would let a hard-limit alert be silenced — a #2/#3 gap).
//   (2) the always-on rule is genuinely non-configurable — hard_limit_hit is absent from the suppressible set.
//   (3) fail-closed validation — a config stranding a critical type is rejected (the write-time guarantee).

import {
  ALERT_TYPES,
  CRITICAL_ALERT_TYPES,
  SEVEN_RULE_TYPES,
  isCriticalType,
  type AlertConfig,
} from "./types.ts";
import { isSuppressible } from "./rules.ts";
import { quietHoursSuppresses, validateConfigOrReject, ConfigRejected } from "./config-validation.ts";
import type { RoleResolver } from "./types.ts";

export * from "./types.ts";
export * from "./store.ts";
export * from "./rules.ts";
export * from "./config-validation.ts";
export * from "./engine.ts";
export {
  SupabaseNotificationStore,
  SupabaseAlertEventLogStore,
  SupabaseAlertConfigStore,
  makeSupabaseAlertStores,
} from "./supabase-store.ts";

interface Finding {
  gate: string;
  ok: boolean;
  detail: string;
}

function runChecks(): Finding[] {
  const findings: Finding[] = [];

  // Gate 1 — every CRITICAL type is non-suppressible + never quiet-silenced.
  const alwaysDeliveredConfig: AlertConfig = {
    alert_routing_rules: {},
    escalation_contacts: {},
    quiet_hours: { enabled: true, start_min: 0, end_min: 1440 }, // window covers ALL day
    alert_email_enabled: false,
    slack_webhook_present: false,
  };
  const criticalNeverSilenced = [...CRITICAL_ALERT_TYPES].every(
    (t) => isCriticalType(t) && quietHoursSuppresses(t, alwaysDeliveredConfig, 720) === false,
  );
  findings.push({
    gate: "critical-never-quiet-silenced",
    ok: criticalNeverSilenced,
    detail: criticalNeverSilenced
      ? "every critical type is delivered even under a 24h quiet window"
      : "a critical type would be quiet-silenced — #2/#3 gap",
  });

  // Gate 2 — hard_limit_hit is genuinely non-suppressible (absent from the suppressible seven-rule set).
  const hardLimitNonSuppressible = !isSuppressible("hard_limit_hit");
  findings.push({
    gate: "hard-limit-non-suppressible",
    ok: hardLimitNonSuppressible,
    detail: hardLimitNonSuppressible
      ? "hard_limit_hit cannot be suppressed by configuration"
      : "hard_limit_hit is suppressible — AC-7.ALR.002.2 violated",
  });

  // Gate 3 — fail-closed validation rejects a config that strands a critical type.
  const noRoles: RoleResolver = {
    usersForRole: () => [],
    reviewerForApprovalItem: () => null,
    isKnownRecipient: () => false, // no known recipients → any destination is unresolvable (fail-closed)
  };
  const strandedConfig: AlertConfig = {
    alert_routing_rules: {}, // no destination for ANY critical type
    escalation_contacts: {},
    quiet_hours: { enabled: false, start_min: 0, end_min: 0 },
    alert_email_enabled: false,
    slack_webhook_present: false,
  };
  let rejected = false;
  try {
    validateConfigOrReject(strandedConfig, noRoles);
  } catch (e) {
    rejected = e instanceof ConfigRejected;
  }
  findings.push({
    gate: "fail-closed-config-validation",
    ok: rejected,
    detail: rejected
      ? "a config stranding a critical type is rejected at write time"
      : "a stranding config was accepted — AC-7.ALR.009.3 violated",
  });

  // Gate 3b — fail-closed against a DEAD-STRING destination: a critical routed to a role nobody holds whose
  // only escalation contact is a role-shaped string nobody holds must be rejected (not accepted as if any
  // non-empty string were deliverable). This is the AC-7.ALR.009.3 / AC-NFR-OBS.008.1 #2/#3 gap.
  const rolesKnowSuperOnly: RoleResolver = {
    usersForRole: (role) => (role === "super_admin" ? ["u-super"] : []),
    reviewerForApprovalItem: () => null,
    isKnownRecipient: (id) => id === "u-super", // ONLY u-super is a real recipient; typo'd roles are not
  };
  const deadStringConfig: AlertConfig = {
    alert_routing_rules: {
      hard_limit_hit: { role: "ghost", channels: [] }, // role nobody holds
      alert_delivery_misconfigured: { role: "super_admin", channels: [] },
      alert_engine_stalled: { role: "super_admin", channels: [] },
    },
    escalation_contacts: { ghost: ["supr_admin"] }, // typo of super_admin — resolves to NO ONE
    quiet_hours: { enabled: false, start_min: 0, end_min: 0 },
    alert_email_enabled: false,
    slack_webhook_present: false,
  };
  let deadStringRejected = false;
  try {
    validateConfigOrReject(deadStringConfig, rolesKnowSuperOnly);
  } catch (e) {
    deadStringRejected = e instanceof ConfigRejected;
  }
  findings.push({
    gate: "fail-closed-dead-string-destination",
    ok: deadStringRejected,
    detail: deadStringRejected
      ? "a critical routed only to a role-shaped dead string is rejected (never treated as deliverable)"
      : "a dead-string destination was accepted — a critical would reach no one (#2/#3, AC-NFR-OBS.008.1)",
  });

  // sanity: the seven rules + the alert_type enum are the expected shapes.
  findings.push({
    gate: "enum-shape",
    ok: SEVEN_RULE_TYPES.length === 7 && ALERT_TYPES.length === 10,
    detail: `seven rules=${SEVEN_RULE_TYPES.length}, alert_type enum=${ALERT_TYPES.length}`,
  });

  return findings;
}

function main(argv: readonly string[]): void {
  const cmd = argv[2];
  if (cmd !== "check") {
    console.log("usage: tsx src/index.ts check");
    process.exit(2);
  }
  const findings = runChecks();
  for (const f of findings) {
    console.log(`${f.ok ? "PASS" : "FAIL"}  ${f.gate} — ${f.detail}`);
  }
  const failed = findings.filter((f) => !f.ok);
  if (failed.length > 0) {
    console.error(`\n${failed.length} gate(s) failed`);
    process.exit(1);
  }
  console.log(`\nall ${findings.length} offline gates passed`);
}

// run only as a CLI (not on import).
import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv);
}
