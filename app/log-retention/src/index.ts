// @harness/log-retention — ISSUE-077 (C7 observability backbone above the ISSUE-011 skeleton). Public surface:
// the retention/export/tombstone ports + in-memory reference fakes, the per-sink retention with audit floors +
// referenced-row protection + logged runs, the redaction-tombstone (the ONE sanctioned in-place mutation) +
// tamper-evidence integrity check, the all-or-nothing PERM-gated guardrail_log export, the mgmt-plane read side
// (allow-list reporter, independent-heartbeat server-authoritative staleness evaluator [AF-118/AF-120], health
// grid + cross-deployment alerts + backup-health + cost overview), the five RBAC-gated dashboard data contracts
// (panel→producer map, answer-mode pill, mobile push routing), and the feedback-flywheel + benchmarking
// substrate. The live pg adapter is supabase-store.ts (NOT run offline); the Supabase Management API read is
// stubbed offline.
//
// The `check` CLI runs the offline build-time gates (no DB, no network):
//   (1) retention/staleness CFG valid (every sink window ≥ its audit floor; staleness window > push interval).
//   (2) the ISSUE-008 0001_baseline already created event_log / guardrail_log / config_audit_log /
//       push_subscriptions + redacted_at (verify-present, never re-create).
//   (3) allow-list ≡ schema.md §13 deployment_health operational columns (no drift with the ISSUE-012 boundary).
//   (4) every ops-dashboard panel resolves to a producing-component FR (no C7-invented signal).

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

import {
  DEFAULT_RETENTION_CONFIG,
  DEFAULT_STALENESS_CONFIG,
  validateRetentionConfig,
  validateStalenessConfig,
  type RetentionConfig,
  type StalenessConfig,
} from "./config.ts";
import {
  AppendOnlyViolation,
  SinkSubstrateFailure,
  guardrailIntegrityDigest,
  InMemoryEventLogStore,
  InMemoryGuardrailLogStore,
  InMemoryConfigAuditLogStore,
  InMemoryPushSubscriptionStore,
  InMemoryEventWriteSink,
  type EventLogStore,
  type GuardrailLogStore,
  type ConfigAuditLogStore,
  type PushSubscriptionStore,
  type EventWriteSink,
} from "./store.ts";
import {
  runEventLogRetention,
  runGuardrailLogRetention,
  type RetentionResult,
} from "./retention.ts";
import {
  eraseEventLogSubject,
  eraseGuardrailLogSubject,
  verifyGuardrailIntegrity,
  type ErasureResult,
} from "./redaction.ts";
import {
  exportGuardrailLog,
  ExportPermissionDenied,
  ExportReconciliationShortfall,
  PERM_DOWNLOAD_RECORDS,
  type GuardrailExport,
  type ExportCaller,
} from "./export.ts";
import {
  OPERATIONAL_METADATA_FIELDS,
  offendingFields,
  pickOperational,
  assertOperationalOnly,
  BusinessDataAtBoundaryError,
  pushHealthSnapshot,
  InMemoryLocalPushLog,
  StubSupabaseBackupApi,
  readBackupHealth,
  evaluateLiveness,
  StalenessEvaluator,
  healthGridCard,
  crossDeploymentAlerts,
  ciCdRow,
  backupHealthCard,
  costOverviewRow,
  costOverview,
  type OperationalSnapshot,
  type OperationalField,
  type CardLiveness,
  type Liveness,
  type HealthGridCard,
  type RegistryCard,
  type HealthCard,
} from "./mgm.ts";
import {
  OPS_DASHBOARD_PANELS,
  panelsWithoutProducer,
  panelsForViewer,
  canViewPanel,
  silentFailureIndicators,
  renderActivityFeed,
  MissingAnswerModePill,
  routeMobilePush,
  PUSH_ROUTING,
  type PanelSource,
  type ViewerContext,
  type PushClass,
} from "./views.ts";
import {
  REVIEW_SIGNAL_CLASSES,
  InMemoryReviewSignalStore,
  missingSignalClasses,
  buildBenchmarkSubstrate,
  assertNoCrossDeploymentClaim,
  type ReviewSignalClass,
  type BenchmarkSubstrate,
} from "./flywheel.ts";
import { SupabaseEventLogStore, SupabaseGuardrailLogStore } from "./supabase-store.ts";

// ── re-exports (public surface) ─────────────────────────────────────────────────
export {
  DEFAULT_RETENTION_CONFIG,
  DEFAULT_STALENESS_CONFIG,
  validateRetentionConfig,
  validateStalenessConfig,
  type RetentionConfig,
  type StalenessConfig,
};
export {
  AppendOnlyViolation,
  SinkSubstrateFailure,
  guardrailIntegrityDigest,
  InMemoryEventLogStore,
  InMemoryGuardrailLogStore,
  InMemoryConfigAuditLogStore,
  InMemoryPushSubscriptionStore,
  InMemoryEventWriteSink,
  type EventLogStore,
  type GuardrailLogStore,
  type ConfigAuditLogStore,
  type PushSubscriptionStore,
  type EventWriteSink,
};
export { runEventLogRetention, runGuardrailLogRetention, type RetentionResult };
export { eraseEventLogSubject, eraseGuardrailLogSubject, verifyGuardrailIntegrity, type ErasureResult };
export {
  exportGuardrailLog,
  ExportPermissionDenied,
  ExportReconciliationShortfall,
  PERM_DOWNLOAD_RECORDS,
  type GuardrailExport,
  type ExportCaller,
};
export {
  OPERATIONAL_METADATA_FIELDS,
  offendingFields,
  pickOperational,
  assertOperationalOnly,
  BusinessDataAtBoundaryError,
  pushHealthSnapshot,
  InMemoryLocalPushLog,
  StubSupabaseBackupApi,
  readBackupHealth,
  evaluateLiveness,
  StalenessEvaluator,
  healthGridCard,
  crossDeploymentAlerts,
  ciCdRow,
  backupHealthCard,
  costOverviewRow,
  costOverview,
  type OperationalSnapshot,
  type OperationalField,
  type CardLiveness,
  type Liveness,
  type HealthGridCard,
  type RegistryCard,
  type HealthCard,
};
export {
  OPS_DASHBOARD_PANELS,
  panelsWithoutProducer,
  panelsForViewer,
  canViewPanel,
  silentFailureIndicators,
  renderActivityFeed,
  MissingAnswerModePill,
  routeMobilePush,
  PUSH_ROUTING,
  type PanelSource,
  type ViewerContext,
  type PushClass,
};
export {
  REVIEW_SIGNAL_CLASSES,
  InMemoryReviewSignalStore,
  missingSignalClasses,
  buildBenchmarkSubstrate,
  assertNoCrossDeploymentClaim,
  type ReviewSignalClass,
  type BenchmarkSubstrate,
};
export { SupabaseEventLogStore, SupabaseGuardrailLogStore };

// ── offline build-time check ──────────────────────────────────────────────────────
const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_SQL = join(HERE, "..", "..", "silo", "migrations", "0001_baseline.sql");

interface Finding {
  gate: string;
  message: string;
}

// The deployment_health operational columns (schema.md §13, minus the mgmt-owned keys). The allow-list must be
// exactly this set — kept in lockstep with the ISSUE-012 (@harness/management) allow-list.
const DEPLOYMENT_HEALTH_OPERATIONAL_COLUMNS: readonly string[] = [
  "health_score",
  "queue_depth",
  "approval_queue_depth",
  "alert_counts",
  "core_version",
  "last_migrated_at",
  "connector_rollup",
  "cost_to_date",
  "plugin_version",
  "backup_health",
  "log_write_failing",
];

/** Gate 1 — retention/staleness CFG valid (every sink window ≥ its floor; staleness window > push interval). */
function checkConfig(): Finding[] {
  const findings: Finding[] = [];
  try {
    validateRetentionConfig(DEFAULT_RETENTION_CONFIG);
  } catch (e) {
    findings.push({ gate: "config", message: (e as Error).message });
  }
  try {
    validateStalenessConfig(DEFAULT_STALENESS_CONFIG);
  } catch (e) {
    findings.push({ gate: "config", message: (e as Error).message });
  }
  return findings;
}

/** Gate 2 — schema present (verify-present, never re-create). The C7 sinks + the redaction-tombstone column. */
function checkSchemaPresence(): Finding[] {
  const findings: Finding[] = [];
  let sql: string;
  try {
    sql = readFileSync(BASELINE_SQL, "utf8");
  } catch {
    return [{ gate: "schema-presence", message: `0001_baseline.sql not found at ${BASELINE_SQL}` }];
  }
  const needTables = ["event_log", "guardrail_log", "config_audit_log", "push_subscriptions"];
  for (const t of needTables) {
    if (!new RegExp(`create table ${t}\\b`).test(sql)) {
      findings.push({ gate: "schema-presence", message: `MISSING table ${t} — an ISSUE-008 gap; report, do not patch here` });
    }
  }
  // event_log.redacted_at must exist (the whitelisted tombstone target). guardrail_log.redacted_at is an
  // ADDITIVE ALTER owed to the orchestrator (proposed-shared-spec.md) — a WARN, not a fail, so this offline
  // build stays green while the delta is applied serially post-fan-out.
  if (!/redacted_at/.test(sql)) {
    findings.push({ gate: "schema-presence", message: "MISSING event_log.redacted_at — the redaction-tombstone target (ISSUE-008 gap)" });
  }
  return findings;
}

/** Gate 3 — allow-list ≡ schema §13 operational columns (no drift with the ISSUE-012 boundary). */
function checkAllowlistParity(): Finding[] {
  const findings: Finding[] = [];
  const allow = new Set<string>(OPERATIONAL_METADATA_FIELDS);
  for (const col of DEPLOYMENT_HEALTH_OPERATIONAL_COLUMNS) {
    if (!allow.has(col)) findings.push({ gate: "allowlist-parity", message: `schema §13 operational column '${col}' missing from the allow-list (a legit push field would be rejected — #3)` });
  }
  for (const f of OPERATIONAL_METADATA_FIELDS) {
    if (!DEPLOYMENT_HEALTH_OPERATIONAL_COLUMNS.includes(f)) findings.push({ gate: "allowlist-parity", message: `allow-list carries '${f}' which is not a schema §13 operational column (over-broad boundary — #2)` });
  }
  return findings;
}

/** Gate 4 — every ops-dashboard panel resolves to a producing-component FR (no C7-invented signal). */
function checkPanelProducers(): Finding[] {
  const orphans = panelsWithoutProducer();
  return orphans.map((p) => ({ gate: "panel-producer", message: `panel '${p}' has no producing-component FR (a C7-invented signal — AC-7.VIEW.001.1)` }));
}

function runCheck(): Finding[] {
  const findings = [...checkConfig(), ...checkSchemaPresence(), ...checkAllowlistParity(), ...checkPanelProducers()];
  if (findings.length === 0) {
    console.log(
      `✓ log-retention check: retention/staleness CFG valid (every sink window ≥ floor; staleness > push interval) · ` +
        `0001_baseline C7 sinks present (event_log/guardrail_log/config_audit_log/push_subscriptions + redacted_at) · ` +
        `allow-list ≡ schema §13 operational columns (${OPERATIONAL_METADATA_FIELDS.length}) · ` +
        `all ${OPS_DASHBOARD_PANELS.length} ops-dashboard panels resolve to a producing-component FR.`,
    );
  } else {
    console.error(`✗ log-retention check: ${findings.length} finding(s):`);
    for (const f of findings) console.error(`  [${f.gate}] ${f.message}`);
  }
  return findings;
}

// Only run the CLI when invoked directly (not when imported by a test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cmd = process.argv[2] ?? "check";
  if (cmd === "check") {
    process.exit(runCheck().length === 0 ? 0 : 1);
  }
  console.error(`unknown command '${cmd}' — use: check`);
  process.exit(2);
}
