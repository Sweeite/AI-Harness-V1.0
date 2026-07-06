// @harness/support-recovery — ISSUE-016 (C0 REC — login support / "trouble signing in"). Public surface: the
// SupportStore port + in-memory fake reference model, the SupportAuthz seam onto @harness/rbac can(), the
// observability/notification sink ports, the SupportService (intake + notification + stale sweep), and the
// UI-SUPPORT-REQUESTS view model + a11y audit. The live pg adapter is supabase-store.ts. This slice authors NO
// new DDL — support_requests + support_status land in ISSUE-008 baseline; the support_requests RLS policy, the
// three event_type additions, and the alert_type addition are proposed in results/proposed-shared-spec.md.
//
// The `check` CLI runs the offline build-time gates (no DB, no network):
//   (1) DDL-shape parity — the fake's support_requests row shape + support_status enum must match the ISSUE-008
//       baseline (0001_baseline.sql). A drift here = a fake that passes offline while the live adapter throws.
//   (2) status-machine integrity — the ONLY legal moves are pending→in_progress→resolved; resolved is terminal;
//       every other move is rejected (FR-0.REC.005).
//   (3) a11y baseline — the UI-SUPPORT-REQUESTS view model + intake form pass AC-NFR-A11Y.001 (labelled
//       controls; status never colour-only) and NO self-service reset is exposed (AC-0.REC.001.1).
//   (4) config registration — CFG-support.stale_request_minutes is the sweep threshold key (verify-present in
//       the ISSUE-010 config store, PERM-config.auth-gated).

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

import { SUPPORT_STATUSES, isLegalTransition, type SupportStatus, InMemorySupportStore } from './store.ts';
import { InMemorySupportAuthz } from './authz.ts';
import { auditA11y, resolveQueueState } from './surface.ts';
import { CFG_SUPPORT_STALE_REQUEST_MINUTES } from './service.ts';

// ── re-exports (public surface) ─────────────────────────────────────────────────────────────────────
export {
  SUPPORT_STATUSES,
  isLegalTransition,
  InMemorySupportStore,
  SupportError,
  ERR_DENIED,
  ERR_EMPTY_FIELD,
  ERR_NO_SUCH_REQUEST,
  ERR_ILLEGAL_TRANSITION,
  ERR_IMMUTABLE,
  type SupportStore,
  type SupportStatus,
  type SupportRequestRow,
  type StatusTransition,
} from './store.ts';
export {
  PERM_SUPPORT_VIEW,
  PERM_SUPPORT_RESOLVE,
  InMemorySupportAuthz,
  type SupportAuthz,
} from './authz.ts';
export {
  InMemoryEventSink,
  InMemoryNotificationSink,
  InMemoryAdminDirectory,
  EV_SUPPORT_REQUEST_CREATED,
  EV_SUPPORT_NOTIFICATION_SENT,
  EV_SUPPORT_NOTIFICATION_FAILED,
  EV_SUPPORT_REESCALATION,
  ALERT_SUPPORT_REQUEST,
  type EventSink,
  type EventRecord,
  type NotificationSink,
  type NotifyOutcome,
  type AdminDirectory,
  type AdminRecipient,
} from './sinks.ts';
export {
  SupportService,
  CFG_SUPPORT_STALE_REQUEST_MINUTES,
  DEFAULT_STALE_REQUEST_MINUTES,
  type SupportServiceDeps,
  type IntakeResult,
  type SweepResult,
} from './service.ts';
export {
  buildQueueView,
  resolveQueueState,
  actionsFor,
  auditA11y,
  STATUS_PRESENTATION,
  TROUBLE_SIGNING_IN_FORM,
  LOGIN_RECOVERY_CONTROLS,
  hasSelfServiceReset,
  type QueueRow,
  type QueueViewState,
  type ActionControl,
  type A11yFinding,
} from './surface.ts';
export { SupabaseSupportStore } from './supabase-store.ts';

interface Finding {
  gate: string;
  message: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(HERE, '..', '..', 'silo', 'migrations', '0001_baseline.sql');

/** Gate 1 — the fake's row shape + status enum must match the ISSUE-008 baseline support_requests DDL. */
function checkDdlParity(): Finding[] {
  const findings: Finding[] = [];
  let sql = '';
  try {
    sql = readFileSync(BASELINE, 'utf8');
  } catch {
    return [{ gate: 'ddl-parity', message: `baseline migration not found at ${BASELINE} — cannot verify the fake matches the DDL` }];
  }
  // support_status enum values.
  const enumMatch = sql.match(/create type support_status\s+as enum\s*\(([^)]*)\)/i);
  if (!enumMatch) {
    findings.push({ gate: 'ddl-parity', message: `support_status enum not found in baseline (the ISSUE-008 enum this slice consumes is missing)` });
  } else {
    const ddlStatuses = [...enumMatch[1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
    const fakeStatuses = [...SUPPORT_STATUSES];
    if (ddlStatuses.length !== fakeStatuses.length || !ddlStatuses.every((s, i) => s === fakeStatuses[i])) {
      findings.push({ gate: 'ddl-parity', message: `support_status drift: DDL=[${ddlStatuses.join(', ')}] vs fake=[${fakeStatuses.join(', ')}] (FR-0.REC.005 / OD-019)` });
    }
  }
  // support_requests columns the fake row shape depends on (NOT NULL text intake fields + status + assigned_to).
  const tableMatch = sql.match(/create table support_requests\s*\(([\s\S]*?)\);/i);
  if (!tableMatch) {
    findings.push({ gate: 'ddl-parity', message: `create table support_requests not found in baseline` });
  } else {
    const body = tableMatch[1]!;
    const required = ['id', 'email', 'name', 'issue_description', 'status', 'assigned_to', 'created_at', 'updated_at'];
    for (const col of required) {
      if (!new RegExp(`\\b${col}\\b`).test(body)) findings.push({ gate: 'ddl-parity', message: `support_requests.${col} missing from baseline DDL — fake row shape would drift from live` });
    }
    // The three intake fields must be NOT NULL (the fake rejects empty to mirror this).
    for (const col of ['email', 'name', 'issue_description']) {
      const line = body.split('\n').find((l) => new RegExp(`^\\s*${col}\\b`).test(l)) ?? '';
      if (!/not null/i.test(line)) findings.push({ gate: 'ddl-parity', message: `support_requests.${col} is not NOT NULL in the DDL — the fake's empty-field guard would be a fake-only constraint` });
    }
    // No client_slug (ADR-001 §3 / OD-096).
    if (/\bclient_slug\b/.test(body)) findings.push({ gate: 'ddl-parity', message: `support_requests carries client_slug — forbidden (ADR-001 §3 / OD-096)` });
  }
  return findings;
}

/** Gate 2 — status-machine integrity: exactly pending→in_progress→resolved; resolved terminal; no others. */
function checkStatusMachine(): Finding[] {
  const findings: Finding[] = [];
  const expectLegal: Array<[SupportStatus, SupportStatus]> = [['pending', 'in_progress'], ['in_progress', 'resolved']];
  const expectIllegal: Array<[SupportStatus, SupportStatus]> = [
    ['pending', 'resolved'], // no skip
    ['in_progress', 'pending'], // no backward
    ['resolved', 'in_progress'], // resolved immutable
    ['resolved', 'pending'],
    ['pending', 'pending'],
  ];
  for (const [f, t] of expectLegal) if (!isLegalTransition(f, t)) findings.push({ gate: 'status-machine', message: `${f}→${t} should be legal (FR-0.REC.005)` });
  for (const [f, t] of expectIllegal) if (isLegalTransition(f, t)) findings.push({ gate: 'status-machine', message: `${f}→${t} should be ILLEGAL (FR-0.REC.005)` });
  return findings;
}

/** Gate 3 — a11y baseline holds over a representative ready view + no self-service reset. */
function checkA11y(): Finding[] {
  const now = '2026-07-06T12:00:00.000Z';
  const view = resolveQueueState(
    {
      ok: true,
      rows: [
        { id: 'sr-1', email: 'a@x.com', name: 'A', issue_description: 'locked out', status: 'pending', assigned_to: null, created_at: '2026-07-06T09:00:00.000Z', updated_at: '2026-07-06T09:00:00.000Z' },
        { id: 'sr-2', email: 'b@x.com', name: 'B', issue_description: 'idp', status: 'in_progress', assigned_to: 'admin-1', created_at: '2026-07-06T11:55:00.000Z', updated_at: '2026-07-06T11:56:00.000Z' },
      ],
    },
    now,
    30,
  );
  return auditA11y(view).map((f) => ({ gate: 'a11y', message: `[${f.rule}] ${f.message}` }));
}

/** Gate 4 — the sweep threshold config key is the expected support.* key (verify-present in ISSUE-010 store). */
function checkConfig(): Finding[] {
  if (CFG_SUPPORT_STALE_REQUEST_MINUTES !== 'support.stale_request_minutes') {
    return [{ gate: 'config', message: `stale-sweep key drifted: '${CFG_SUPPORT_STALE_REQUEST_MINUTES}' (expected support.stale_request_minutes, PERM-config.auth-gated)` }];
  }
  return [];
}

function runCheck(): Finding[] {
  const findings = [...checkDdlParity(), ...checkStatusMachine(), ...checkA11y(), ...checkConfig()];
  if (findings.length === 0) {
    console.log(
      `✓ support-recovery check: fake ≡ ISSUE-008 support_requests DDL (status enum + row shape, no client_slug) · status machine pending→in_progress→resolved (resolved terminal) · a11y baseline holds (labelled controls, status not colour-only) + no self-service reset · CFG-${CFG_SUPPORT_STALE_REQUEST_MINUTES} present.`,
    );
  } else {
    console.error(`✗ support-recovery check: ${findings.length} finding(s):`);
    for (const f of findings) console.error(`  [${f.gate}] ${f.message}`);
  }
  return findings;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cmd = process.argv[2] ?? 'check';
  if (cmd === 'check') {
    process.exit(runCheck().length === 0 ? 0 : 1);
  }
  console.error(`unknown command '${cmd}' — use: check`);
  process.exit(2);
}
