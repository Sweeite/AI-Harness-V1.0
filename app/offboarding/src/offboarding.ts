// ISSUE-083 (C10 OFF) — the pure, deterministic kernels of the client-offboarding state machine. No I/O, no
// Date.now/random (the caller passes nowMs). Every gate here is FAIL-CLOSED: destruction never advances on anything
// short of an affirmative, verified, acknowledged, two-person-authorised state; a partial deprovision never reports
// complete; a missing meta-record escalates rather than claiming "done". The five steps (FR-10.OFF.001–006):
//   1 trigger → 2 export-verified + delivered + acknowledged → 3 freeze → 4 hard-delete+deprovision → 5 meta-record.

export const WORKFLOW_STATES = [
  'initiated',
  'export_verified',
  'delivered',
  'acknowledged',
  'frozen',
  'freeze_pending',
  'deleting',
  'deletion_failed',
  'completed',
] as const;
export type WorkflowState = (typeof WORKFLOW_STATES)[number];

// ── RBAC (FR-10.OFF.001 — Super-Admin ONLY; NFR-SEC.015 — a distinct second authoriser on the Step-4 deletion). ──
export const ROLE_SUPER_ADMIN = 'Super Admin';
/** Only a Super Admin may initiate offboarding (AC-10.OFF.001.2 — anyone else is RBAC-rejected). Fail-closed. */
export function canInitiateOffboarding(role: string | null | undefined): boolean {
  return role === ROLE_SUPER_ADMIN;
}

// ── Step 2: export verification (FR-10.OFF.002 + NFR-CMP.009 — verified-complete, all-or-nothing, fail-closed). ──
export interface TableReconciliation {
  table: string;
  liveCount: number;
  exportedCount: number;
  /** null ⇒ the checksum could not be computed (indeterminate) — treated as a FAILURE, never a pass. */
  liveChecksum: string | null;
  exportedChecksum: string | null;
  /** true iff BOTH a JSON and a CSV artifact were produced for this table (AC-10.OFF.002.1). */
  bothFormats: boolean;
}

export type ExportVerdict =
  | { pass: true }
  | { pass: false; reason: string; failures: string[] };

/**
 * FR-10.OFF.002 → AC-10.OFF.002.1/.2/.4, NFR-CMP.009 — the verification gate. Returns PASS only on an AFFIRMATIVE,
 * complete reconciliation: every listed table present, both JSON+CSV, exported count == live count, and checksums
 * that both exist and match. ANY error / missing / indeterminate (null checksum) / count-short → BLOCK (fail-closed
 * H2). An empty reconciliation list is a FAILURE (nothing was verified — never a vacuous pass). #1: destruction never
 * proceeds on an unverified export.
 */
export function verifyExport(reconciliations: readonly TableReconciliation[]): ExportVerdict {
  const failures: string[] = [];
  if (reconciliations.length === 0) {
    return { pass: false, reason: 'no tables reconciled — an empty export cannot be certified complete (fail-closed)', failures: ['empty'] };
  }
  for (const r of reconciliations) {
    if (!r.bothFormats) failures.push(`${r.table}: missing a JSON or CSV artifact`);
    if (r.exportedCount !== r.liveCount) failures.push(`${r.table}: exported ${r.exportedCount} of ${r.liveCount} rows (count mismatch)`);
    if (r.liveChecksum === null || r.exportedChecksum === null) failures.push(`${r.table}: checksum indeterminate (could not be computed)`);
    else if (r.liveChecksum !== r.exportedChecksum) failures.push(`${r.table}: checksum mismatch`);
  }
  if (failures.length > 0) {
    return { pass: false, reason: `export verification FAILED for ${failures.length} condition(s) — destruction blocked + escalated (AC-NFR-CMP.009.1)`, failures };
  }
  return { pass: true };
}

// ── the hard gate before ANY destruction (AC-NFR-CMP.008.1 / OD-090). ───────────────────────────────────
export interface OffboardingState {
  workflowState: WorkflowState;
  exportVerifiedAtMs: number | null;
  exportAcknowledgedAtMs: number | null;
  retentionWindowEndMs: number | null;
}

/**
 * AC-NFR-CMP.008.1 — destruction (freeze→delete) may proceed ONLY when the export is verified-complete AND the client
 * has acknowledged receipt. Both are a hard gate: a missing verify OR a missing ack blocks. Fail-closed.
 */
export function canProceedToDestruction(s: Pick<OffboardingState, 'exportVerifiedAtMs' | 'exportAcknowledgedAtMs'>): { ok: boolean; reason: string } {
  if (s.exportVerifiedAtMs === null) return { ok: false, reason: 'export is not verified-complete — destruction blocked (OD-090 hard gate)' };
  if (s.exportAcknowledgedAtMs === null) return { ok: false, reason: 'client has not acknowledged export receipt — destruction blocked (OD-090 hard gate)' };
  return { ok: true, reason: 'export verified + acknowledged' };
}

// ── Step 4: two-person authorization (NFR-SEC.015 — three distinct, non-null identities). ───────────────
export interface DeletionAuthorization {
  authorizedBy: string | null;
  secondAuthoriser: string | null;
  executor: string | null;
}
export type TwoPersonVerdict = { ok: true } | { ok: false; reason: string };

/**
 * NFR-SEC.015 → AC-NFR-SEC.015.1/.2 — the Step-4 sensitive deletion needs THREE DISTINCT, non-null identities
 * (authoriser, second authoriser, executor). A code-level mirror of the DB CHECK (defense in depth): a single person
 * can never both authorise and execute. Fail-closed: any null or any collision rejects.
 */
export function verifyTwoPersonAuth(a: DeletionAuthorization): TwoPersonVerdict {
  if (a.authorizedBy == null || a.secondAuthoriser == null || a.executor == null) {
    return { ok: false, reason: 'two-person auth requires three non-null identities (authoriser, second authoriser, executor)' };
  }
  const set = new Set([a.authorizedBy, a.secondAuthoriser, a.executor]);
  if (set.size !== 3) return { ok: false, reason: 'authoriser, second authoriser, and executor must be three DISTINCT people (no self-execution)' };
  return { ok: true };
}

// ── Step 4: the deprovision sequence (FR-10.OFF.005 — atomic-or-escalate, idempotent, internal_token-first). ─────
// The canonical order. internal_token revoke is FIRST (AC-10.OFF.005.5 — a torn-down deployment must never keep a
// live mgmt credential, even on a partial failure). Each system is idempotent (already-done = safe no-op) and its
// result is recorded to the mgmt plane BEFORE the next destructive step (AC-10.OFF.005.4). A partial → deletion_failed
// (AC-10.OFF.005.2), never auto-rolled-back (OD-010/OD-089), re-runnable to completion (AC-10.OFF.005.3).
export const DEPROVISION_SEQUENCE = [
  'internal_token', // revoked FIRST / independently (MGT.004.3, AC-10.OFF.005.5)
  'supabase',       // truncate/drop + project deprovision
  'railway',        // service deprovision
  'credentials',    // hard-delete connector_credentials + webhook_secrets (belt-and-braces; silo drop already removed them)
  'connector_oauth',// revoke each connector's OAuth tokens via C3
  'backup_purge',   // flag the off-platform backup for purge (tracked until confirmed — AC-10.OFF.005.6)
] as const;
export type DeprovisionSystem = (typeof DEPROVISION_SEQUENCE)[number];

export type SubStepResult = { system: DeprovisionSystem; ok: true } | { system: DeprovisionSystem; ok: false; error: string };

/**
 * AC-NFR-INF.013.1 / AC-10.OFF.005.6 — the required systems NOT yet deprovisioned. A deletion is "airtight complete"
 * ONLY when EVERY system in DEPROVISION_SEQUENCE (incl. `backup_purge`) has been done. This closes the fail-open where
 * a caller supplies a PARTIAL-but-all-ok result set (e.g. only internal_token+supabase) and the run would otherwise
 * report `completed` while Railway / connector OAuth tokens / the off-platform backup are still live (#1/#2/#3).
 */
export function requiredSystemsMissing(done: readonly DeprovisionSystem[], required: readonly DeprovisionSystem[] = DEPROVISION_SEQUENCE): DeprovisionSystem[] {
  const s = new Set(done);
  return required.filter((r) => !s.has(r));
}

export interface DeprovisionOutcome {
  completed: DeprovisionSystem[];
  failedAt: DeprovisionSystem | null;
  state: 'completed' | 'deletion_failed';
  reason: string;
}

/**
 * Fold a run of sub-step results into the offboarding outcome. Stops at the FIRST failure → `deletion_failed` with the
 * failing system named (per-system status + escalation is the caller's job); no auto-rollback. All-success →
 * `completed`. This is the pure decision the store persists step-by-step (it records each result before the next).
 */
export function foldDeprovision(results: readonly SubStepResult[]): DeprovisionOutcome {
  const completed: DeprovisionSystem[] = [];
  for (const r of results) {
    if (r.ok) {
      completed.push(r.system);
      continue;
    }
    return {
      completed,
      failedAt: r.system,
      state: 'deletion_failed',
      reason: `deprovision failed at '${r.system}': ${r.error} — held in deletion_failed, per-system status recorded, escalated, NOT auto-rolled-back (AC-10.OFF.005.2)`,
    };
  }
  return { completed, failedAt: null, state: 'completed', reason: 'all systems deprovisioned + recorded' };
}

// ── Step 5: meta-record completeness (FR-10.OFF.006 — nine fields, no client data, escalate-if-unwritten). ──
export interface MetaRecord {
  clientSlug: string | null;
  offboardingInitiatedAtMs: number | null;
  exportDeliveredAtMs: number | null;
  exportAcknowledgedAtMs: number | null;
  retentionWindowEndMs: number | null;
  deletionExecutedAtMs: number | null;
  deletionExecutedBy: string | null;
  systemsDeprovisioned: string[];
  tokensRevoked: string[];
}

/**
 * FR-10.OFF.006 → AC-10.OFF.006.1/.3 — a completed deletion reports "done" ONLY if the nine-field meta-record is fully
 * written. A missing field → NOT complete → escalate (never a silent "done" without evidence). Returns the list of
 * missing fields (empty ⇒ complete). systems_deprovisioned + tokens_revoked must be non-empty (something was torn down).
 */
export function metaRecordMissingFields(m: MetaRecord): string[] {
  const missing: string[] = [];
  if (!m.clientSlug) missing.push('client_slug');
  if (m.offboardingInitiatedAtMs == null) missing.push('offboarding_initiated_at');
  if (m.exportDeliveredAtMs == null) missing.push('export_delivered_at');
  if (m.exportAcknowledgedAtMs == null) missing.push('export_acknowledged_at');
  if (m.retentionWindowEndMs == null) missing.push('retention_window_end');
  if (m.deletionExecutedAtMs == null) missing.push('deletion_executed_at');
  if (!m.deletionExecutedBy) missing.push('deletion_executed_by');
  if (m.systemsDeprovisioned.length === 0) missing.push('systems_deprovisioned');
  if (m.tokensRevoked.length === 0) missing.push('tokens_revoked');
  return missing;
}

// ── CFG (FR-10.RET.002). ───────────────────────────────────────────────────────────────────────────────
export const CFG_DATA_EXPORT_LINK_EXPIRY_HOURS = 'data_export_link_expiry_hours' as const;
export const CFG_CLIENT_OFFBOARDING_RETENTION_DAYS = 'client_offboarding_retention_days' as const;
export const DEFAULT_EXPORT_LINK_EXPIRY_HOURS = 72;
export const DEFAULT_RETENTION_DAYS = 90;
export const CONFIG_DEFAULTS: readonly (readonly [string, number])[] = [
  [CFG_DATA_EXPORT_LINK_EXPIRY_HOURS, DEFAULT_EXPORT_LINK_EXPIRY_HOURS],
  [CFG_CLIENT_OFFBOARDING_RETENTION_DAYS, DEFAULT_RETENTION_DAYS],
] as const;

/** AC-10.OFF.003.1/.2 — a delivery link is dead once expiry elapses; an expired-unused link is SURFACED for reissue
 * (not silently dead). Returns 'live' | 'expired'. */
export function exportLinkState(deliveredAtMs: number, expiryHours: number, nowMs: number): 'live' | 'expired' {
  return nowMs - deliveredAtMs >= expiryHours * 60 * 60 * 1000 ? 'expired' : 'live';
}
