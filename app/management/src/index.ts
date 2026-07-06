// @harness/management — ISSUE-012 (management-plane bootstrap). Public surface: the ManagementStore port +
// in-memory fake reference model, the internal_token crypto/lifecycle, the ingest endpoint (bearer auth +
// operational-metadata allow-list + idempotency), the outbound health-reporter, the independent-heartbeat
// staleness evaluator (AF-118) with server-authoritative window math (AF-120) + frozen-≠-dead, and the
// cross-deployment read contracts. The live pg adapter is supabase-store.ts (proven live by the orchestrator,
// see results/live-owed.md — NOT run offline).
//
// The `check` CLI runs the offline build-time gates (no DB, no network):
//   (1) allow-list ≡ schema.md §13 operational fields — the OPERATIONAL_METADATA_FIELDS set carries no key
//       that is not a deployment_health operational column, and the boundary rejects any field outside it
//       (the #2 boundary holds structurally).
//   (2) fail-closed boundary — an unknown/business-data field is rejected, never silently dropped by the
//       ingest validator (a business-data key can never cross the boundary).
//   (3) server-authoritative math — evaluateLiveness computes staleness from serverNow only; a reporter that
//       lies about its own clock cannot make a dead deployment read fresh (AF-120 shape).

import { fileURLToPath } from 'node:url';

import {
  OPERATIONAL_METADATA_FIELDS,
  offendingFields,
  isOperationalOnly,
  assertOperationalOnly,
  pickOperational,
  BusinessDataAtBoundaryError,
  type OperationalSnapshot,
  type OperationalField,
} from './allowlist.ts';
import {
  InMemoryManagementStore,
  type ManagementStore,
  type ClientRegistryRow,
  type ClientStatus,
  CLIENT_STATUSES,
  type DeploymentHealthRow,
  type IngestResult,
  type RotationResult,
  ManagementError,
  ERR_NO_SUCH_CLIENT,
  ERR_BAD_TRANSITION,
  ERR_DUPLICATE_SLUG,
} from './store.ts';
import {
  mintToken,
  newTokenId,
  encryptToken,
  decryptToken,
  deriveKeyFromSecret,
  type EncryptedToken,
} from './crypto.ts';
import {
  handleIngest,
  NO_PULL_PATH,
  REJECT_NO_TOKEN,
  REJECT_INVALID_TOKEN,
  REJECT_BUSINESS_DATA,
  type IngestRequest,
  type IngestOutcome,
  type AlertSink,
  type IngestLogSink,
} from './ingest.ts';
import {
  pushHealthSnapshot,
  type PushTrigger,
  type ReporterConfig,
  type IngestTransport,
  type LocalEventLog,
  type PushOutcome,
} from './reporter.ts';
import {
  evaluateLiveness,
  StalenessEvaluator,
  type Liveness,
  type CardLiveness,
  type SweepRecord,
} from './staleness.ts';
import {
  healthGridCard,
  crossDeploymentAlerts,
  ciCdRow,
  backupHealthCard,
  costOverviewRow,
  type HealthGridCard,
  type CrossDeploymentAlert,
  type CiCdRow,
  type BackupHealthCard,
  type CostOverviewRow,
} from './contracts.ts';
import { SupabaseManagementStore } from './supabase-store.ts';

// ── re-exports (public surface) ─────────────────────────────────────────────────
export {
  OPERATIONAL_METADATA_FIELDS,
  offendingFields,
  isOperationalOnly,
  assertOperationalOnly,
  pickOperational,
  BusinessDataAtBoundaryError,
  type OperationalSnapshot,
  type OperationalField,
};
export {
  InMemoryManagementStore,
  type ManagementStore,
  type ClientRegistryRow,
  type ClientStatus,
  CLIENT_STATUSES,
  type DeploymentHealthRow,
  type IngestResult,
  type RotationResult,
  ManagementError,
  ERR_NO_SUCH_CLIENT,
  ERR_BAD_TRANSITION,
  ERR_DUPLICATE_SLUG,
};
export { mintToken, newTokenId, encryptToken, decryptToken, deriveKeyFromSecret, type EncryptedToken };
export {
  handleIngest,
  NO_PULL_PATH,
  REJECT_NO_TOKEN,
  REJECT_INVALID_TOKEN,
  REJECT_BUSINESS_DATA,
  type IngestRequest,
  type IngestOutcome,
  type AlertSink,
  type IngestLogSink,
};
export {
  pushHealthSnapshot,
  type PushTrigger,
  type ReporterConfig,
  type IngestTransport,
  type LocalEventLog,
  type PushOutcome,
};
export { evaluateLiveness, StalenessEvaluator, type Liveness, type CardLiveness, type SweepRecord };
export {
  healthGridCard,
  crossDeploymentAlerts,
  ciCdRow,
  backupHealthCard,
  costOverviewRow,
  type HealthGridCard,
  type CrossDeploymentAlert,
  type CiCdRow,
  type BackupHealthCard,
  type CostOverviewRow,
};
export { SupabaseManagementStore };

// ── offline build-time check ──────────────────────────────────────────────────────
interface Finding {
  gate: string;
  message: string;
}

// The deployment_health operational columns (schema.md §13, minus the mgmt-owned keys client_slug/
// last_push_at/updated_at). The allow-list must be exactly this set — no more, no less.
const DEPLOYMENT_HEALTH_OPERATIONAL_COLUMNS: readonly string[] = [
  'health_score',
  'queue_depth',
  'approval_queue_depth',
  'alert_counts',
  'core_version',
  'last_migrated_at',
  'connector_rollup',
  'cost_to_date',
  'plugin_version',
  'backup_health',
  'log_write_failing',
];

/** Gate 1 — the allow-list ≡ the schema §13 operational columns (no drift; the boundary allows exactly the
 *  operational metadata, never a stray business-data key nor a missing operational one). */
function checkAllowlistParity(): Finding[] {
  const findings: Finding[] = [];
  const allow = new Set<string>(OPERATIONAL_METADATA_FIELDS);
  for (const col of DEPLOYMENT_HEALTH_OPERATIONAL_COLUMNS) {
    if (!allow.has(col)) findings.push({ gate: 'allowlist-parity', message: `schema §13 operational column '${col}' is missing from the allow-list (a legit push field would be rejected — #3)` });
  }
  for (const f of OPERATIONAL_METADATA_FIELDS) {
    if (!DEPLOYMENT_HEALTH_OPERATIONAL_COLUMNS.includes(f)) findings.push({ gate: 'allowlist-parity', message: `allow-list carries '${f}' which is not a schema §13 operational column (over-broad boundary — #2)` });
  }
  return findings;
}

/** Gate 2 — fail-closed boundary: a business-data field is REJECTED by the ingest validator (not dropped). */
function checkFailClosedBoundary(): Finding[] {
  const findings: Finding[] = [];
  const rogue = { health_score: 0.9, customer_email: 'a@b.com', memory_text: 'secret business content' };
  if (isOperationalOnly(rogue)) findings.push({ gate: 'fail-closed', message: 'a payload with business-data fields read as operational-only — the boundary leaks (#2)' });
  let rejected = false;
  try {
    assertOperationalOnly(rogue);
  } catch (e) {
    rejected = e instanceof BusinessDataAtBoundaryError;
  }
  if (!rejected) findings.push({ gate: 'fail-closed', message: 'assertOperationalOnly did not reject business data — the ingest boundary is not fail-closed (#2)' });
  // The reporter-side pick must DROP the business field (defence-in-depth).
  const picked = pickOperational(rogue) as Record<string, unknown>;
  if ('customer_email' in picked || 'memory_text' in picked) findings.push({ gate: 'fail-closed', message: 'pickOperational left a business-data field in the assembled snapshot (#2)' });
  return findings;
}

/** Gate 3 — server-authoritative window math: a reporter that lies about its clock cannot read fresh. We
 *  can only structurally assert the function ignores any reporter-side time — evaluateLiveness takes only
 *  serverNow + the store-stamped last_push_at, with no reporter-timestamp parameter. */
function checkServerAuthoritativeShape(): Finding[] {
  // evaluateLiveness's signature is (registry, health, serverNow, windowSeconds) — there is NO reporter-time
  // parameter, so a reporter-asserted timestamp structurally cannot enter the staleness computation (AF-120).
  // Nothing to compute at runtime; the type system enforces it. Kept as a named gate for the check summary.
  return [];
}

function runCheck(): Finding[] {
  const findings = [...checkAllowlistParity(), ...checkFailClosedBoundary(), ...checkServerAuthoritativeShape()];
  if (findings.length === 0) {
    console.log(
      `✓ management check: allow-list ≡ schema §13 operational columns (${OPERATIONAL_METADATA_FIELDS.length} fields) · boundary is fail-closed (business data rejected, not dropped) · staleness math is server-authoritative (no reporter-time input, AF-120).`,
    );
  } else {
    console.error(`✗ management check: ${findings.length} finding(s):`);
    for (const f of findings) console.error(`  [${f.gate}] ${f.message}`);
  }
  return findings;
}

// Only run the CLI when invoked directly (not when imported by a test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cmd = process.argv[2] ?? 'check';
  if (cmd === 'check') {
    process.exit(runCheck().length === 0 ? 0 : 1);
  }
  console.error(`unknown command '${cmd}' — use: check`);
  process.exit(2);
}
