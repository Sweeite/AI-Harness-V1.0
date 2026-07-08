// ISSUE-083 (C10 OFF) — the offboarding-workflow store: the OffboardingStore port, the in-memory reference model, and
// the step orchestration that enforces the fail-closed gates. Persists to the management-plane `offboarding_records`
// (0004) and drives `client_registry.status` + `internal_token` revoke through an injected RegistrySeam (the
// ISSUE-012 ManagementStore subset). The LIVE external operations — the client-silo export/reconcile (AF-133), the
// cross-project freeze write (AF-135), and the Supabase/Railway/connector deprovision (AF-132) — are INJECTED SEAMS:
// they run against real infra at onboarding (Stage-3/4 precedent, OD-172-class); this slice owns the POLICY + the
// fail-closed state machine + the persistence, all offline-provable. supabase-store.ts is the live mgmt adapter.

import {
  DEFAULT_RETENTION_DAYS,
  canInitiateOffboarding,
  canProceedToDestruction,
  exportLinkState,
  foldDeprovision,
  metaRecordMissingFields,
  requiredSystemsMissing,
  verifyExport,
  verifyTwoPersonAuth,
  type DeprovisionSystem,
  type MetaRecord,
  type SubStepResult,
  type TableReconciliation,
  type WorkflowState,
} from './offboarding.ts';

// ── the persisted record (mirrors offboarding_records / 0004). ──────────────────────────────────────────
export interface OffboardingRecord {
  clientSlug: string;
  workflowState: WorkflowState;
  offboardingInitiatedAtMs: number | null;
  exportVerifiedAtMs: number | null;
  exportDeliveredAtMs: number | null;
  exportAcknowledgedAtMs: number | null;
  retentionWindowEndMs: number | null;
  deletionAuthorizedBy: string | null;
  deletionSecondAuthoriser: string | null;
  deletionExecutedBy: string | null;
  deletionExecutedAtMs: number | null;
  systemsDeprovisioned: DeprovisionSystem[];
  tokensRevoked: string[];
  backupPurgeFlaggedAtMs: number | null;
  freezePendingSinceMs: number | null;
  createdAtMs: number;
  updatedAtMs: number;
}

// ── injected seams. ─────────────────────────────────────────────────────────────────────────────────────
/** The ISSUE-012 ManagementStore subset this slice drives (client_registry status + internal_token revoke). */
export interface RegistrySeam {
  transitionStatus(slug: string, to: 'offboarding' | 'frozen' | 'active', nowMs: number): Promise<void>;
  revokeToken(slug: string, nowMs: number): Promise<void>;
}
/** The live cross-project freeze write (deployment_settings.frozen_at into the client silo via the custodied
 * service_role key — AF-135/onboarding). Returns whether the write was CONFIRMED; an unconfirmed write → freeze_pending. */
export type FreezeWriter = (clientSlug: string, frozen: boolean, nowMs: number) => Promise<{ confirmed: boolean; detail?: string }>;

/** #3 never-silent: every gate block / freeze_pending / deletion_failed / unwritten-meta escalation is surfaced here. */
export interface EscalationSink {
  escalate(row: { clientSlug: string; kind: string; detail: string }, nowMs: number): Promise<void>;
}
export class InMemoryEscalations implements EscalationSink {
  readonly rows: { atMs: number; clientSlug: string; kind: string; detail: string }[] = [];
  async escalate(row: { clientSlug: string; kind: string; detail: string }, nowMs: number): Promise<void> {
    this.rows.push({ atMs: nowMs, ...row });
  }
}

export const ERR_NOT_SUPER_ADMIN = 'offboarding: only a Super Admin may initiate offboarding (AC-10.OFF.001.2)';
export const ERR_NO_RECORD = (slug: string) => `offboarding: no offboarding record for client '${slug}'`;
export const ERR_EXPORT_UNVERIFIED = 'offboarding: export not verified-complete — cannot advance (AC-NFR-CMP.008.1)';
export const ERR_NOT_ACKNOWLEDGED = 'offboarding: client has not acknowledged export receipt — cannot advance (OD-090)';
export const ERR_RETENTION_ACTIVE = 'offboarding: retention window has not elapsed — deletion blocked';
export const ERR_TWO_PERSON = (why: string) => `offboarding: two-person authorization failed — ${why} (NFR-SEC.015)`;
export const ERR_EXPORT_FAILED = (why: string) => `offboarding: export verification FAILED — ${why} (destruction blocked, #1)`;
export const ERR_NOT_FROZEN = 'offboarding: deletion requires a CONFIRMED freeze — the deployment is not frozen (a freeze_pending / unconfirmed cross-project write means the client may still be writing post-export; #1). Resolve the freeze first (AC-10.OFF.004.5)';
export const ERR_DELETION_INCOMPLETE = (missing: string[]) => `offboarding: deprovision is INCOMPLETE — ${missing.join(', ')} not yet done; cannot mark complete (AC-NFR-INF.013.1 / AC-10.OFF.005.6)`;
/** The workflow states from which the Step-4 deletion may run — i.e. a CONFIRMED freeze was reached (never freeze_pending). */
const DELETION_READY_STATES: readonly WorkflowState[] = ['frozen', 'deleting', 'deletion_failed'];

// ── the port. ───────────────────────────────────────────────────────────────────────────────────────────
export interface OffboardingStore {
  /** Step 1 (FR-10.OFF.001): Super-Admin-only trigger; client_registry.status → offboarding; records offboarding_at. */
  initiate(clientSlug: string, initiatorRole: string, nowMs: number): Promise<OffboardingRecord>;
  /** Step 2 (FR-10.OFF.002 + NFR-CMP.009): verify the export fail-closed; only an affirmative PASS advances. */
  verifyExportComplete(clientSlug: string, reconciliations: readonly TableReconciliation[], nowMs: number): Promise<OffboardingRecord>;
  /** Step 2 (FR-10.OFF.003): record encrypted-link delivery. */
  recordDelivery(clientSlug: string, nowMs: number): Promise<OffboardingRecord>;
  /** Step 2 (FR-10.OFF.003): client sign-off; gates the retention clock. Distinguishes an ack-write FAILURE (surfaced
   * as a defect) from "not yet acknowledged" (AC-10.OFF.003.4). */
  acknowledgeReceipt(clientSlug: string, nowMs: number, ackWriteOk?: boolean): Promise<OffboardingRecord>;
  /** Step 3 (FR-10.OFF.004): freeze — status→frozen + the cross-project frozen_at write; freeze_pending if unconfirmed. */
  freeze(clientSlug: string, retentionDays: number, nowMs: number): Promise<OffboardingRecord>;
  /** Step 3 (FR-10.OFF.004): in-window reactivation — unfreeze in reverse. */
  reactivate(clientSlug: string, nowMs: number): Promise<OffboardingRecord>;
  /** Step 4 (NFR-SEC.015): record the two-person authorization for the sensitive deletion (three distinct identities). */
  authorizeDeletion(clientSlug: string, authorizedBy: string, secondAuthoriser: string, nowMs: number): Promise<OffboardingRecord>;
  /** Step 4 (FR-10.OFF.005): run the deprovision sequence — gated on verified+ack+retention-elapsed+two-person auth;
   * internal_token revoked FIRST; atomic-or-escalate; partial → deletion_failed (no auto-rollback); idempotent re-run. */
  runDeprovision(clientSlug: string, executor: string, results: readonly SubStepResult[], nowMs: number): Promise<OffboardingRecord>;
  /** Step 5 (FR-10.OFF.006): finalize — write the nine-field meta-record; escalate-if-incomplete (never a silent done). */
  finalize(clientSlug: string, nowMs: number): Promise<OffboardingRecord>;
  get(clientSlug: string): Promise<OffboardingRecord | null>;
}

// ── the in-memory reference model. ──────────────────────────────────────────────────────────────────────
export class InMemoryOffboardingStore implements OffboardingStore {
  private readonly records = new Map<string, OffboardingRecord>();
  constructor(
    private readonly deps: { registry: RegistrySeam; freezeWriter: FreezeWriter; escalations: EscalationSink; exportLinkExpiryHours?: number },
  ) {}

  private require(slug: string): OffboardingRecord {
    const r = this.records.get(slug);
    if (!r) throw new Error(ERR_NO_RECORD(slug));
    return r;
  }
  private touch(r: OffboardingRecord, nowMs: number): OffboardingRecord {
    r.updatedAtMs = nowMs;
    return { ...r, systemsDeprovisioned: [...r.systemsDeprovisioned], tokensRevoked: [...r.tokensRevoked] };
  }

  async initiate(clientSlug: string, initiatorRole: string, nowMs: number): Promise<OffboardingRecord> {
    if (!canInitiateOffboarding(initiatorRole)) throw new Error(ERR_NOT_SUPER_ADMIN);
    if (this.records.has(clientSlug)) return this.touch(this.require(clientSlug), nowMs); // idempotent trigger
    await this.deps.registry.transitionStatus(clientSlug, 'offboarding', nowMs);
    const rec: OffboardingRecord = {
      clientSlug,
      workflowState: 'initiated',
      offboardingInitiatedAtMs: nowMs,
      exportVerifiedAtMs: null,
      exportDeliveredAtMs: null,
      exportAcknowledgedAtMs: null,
      retentionWindowEndMs: null,
      deletionAuthorizedBy: null,
      deletionSecondAuthoriser: null,
      deletionExecutedBy: null,
      deletionExecutedAtMs: null,
      systemsDeprovisioned: [],
      tokensRevoked: [],
      backupPurgeFlaggedAtMs: null,
      freezePendingSinceMs: null,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    };
    this.records.set(clientSlug, rec);
    return this.touch(rec, nowMs);
  }

  async verifyExportComplete(clientSlug: string, reconciliations: readonly TableReconciliation[], nowMs: number): Promise<OffboardingRecord> {
    const r = this.require(clientSlug);
    const verdict = verifyExport(reconciliations);
    if (!verdict.pass) {
      // fail-closed: do NOT advance; surface the block loudly (#1 — destruction never proceeds on an unverified export).
      await this.deps.escalations.escalate({ clientSlug, kind: 'export_unverified', detail: verdict.reason }, nowMs);
      throw new Error(ERR_EXPORT_FAILED(verdict.reason));
    }
    r.exportVerifiedAtMs = nowMs;
    r.workflowState = 'export_verified';
    return this.touch(r, nowMs);
  }

  async recordDelivery(clientSlug: string, nowMs: number): Promise<OffboardingRecord> {
    const r = this.require(clientSlug);
    if (r.exportVerifiedAtMs === null) throw new Error(ERR_EXPORT_UNVERIFIED);
    r.exportDeliveredAtMs = nowMs;
    r.workflowState = 'delivered';
    return this.touch(r, nowMs);
  }

  async acknowledgeReceipt(clientSlug: string, nowMs: number, ackWriteOk = true): Promise<OffboardingRecord> {
    const r = this.require(clientSlug);
    if (r.exportDeliveredAtMs === null) throw new Error('offboarding: cannot acknowledge before delivery');
    if (!ackWriteOk) {
      // AC-10.OFF.003.4 — a FAILED ack write is a surfaced defect, NOT silently treated as "not yet acknowledged".
      await this.deps.escalations.escalate({ clientSlug, kind: 'ack_write_failed', detail: 'the acknowledgement write failed — surfaced as a defect, not client latency' }, nowMs);
      throw new Error('offboarding: acknowledgement write failed (surfaced defect, AC-10.OFF.003.4)');
    }
    r.exportAcknowledgedAtMs = nowMs;
    r.workflowState = 'acknowledged';
    return this.touch(r, nowMs);
  }

  async freeze(clientSlug: string, retentionDays: number, nowMs: number): Promise<OffboardingRecord> {
    const r = this.require(clientSlug);
    if (r.exportAcknowledgedAtMs === null) throw new Error(ERR_NOT_ACKNOWLEDGED); // sign-off gates the retention clock
    // AC-10.OFF.004.5 — attempt the cross-project frozen_at write FIRST; the mgmt client_registry.status is promoted
    // to 'frozen' ONLY once that write is confirmed. The management plane's status must never outrun what the client
    // deployment can actually enforce (#1/#3) — so an unconfirmed write leaves status at 'offboarding' + freeze_pending.
    const write = await this.deps.freezeWriter(clientSlug, true, nowMs);
    r.retentionWindowEndMs = nowMs + (retentionDays || DEFAULT_RETENTION_DAYS) * 24 * 60 * 60 * 1000;
    if (!write.confirmed) {
      r.workflowState = 'freeze_pending';
      r.freezePendingSinceMs = nowMs;
      await this.deps.escalations.escalate({ clientSlug, kind: 'freeze_pending', detail: write.detail ?? 'cross-project frozen_at write unconfirmed' }, nowMs);
      return this.touch(r, nowMs); // client_registry.status NOT transitioned to frozen — it stays offboarding
    }
    await this.deps.registry.transitionStatus(clientSlug, 'frozen', nowMs);
    r.workflowState = 'frozen';
    r.freezePendingSinceMs = null;
    return this.touch(r, nowMs);
  }

  async reactivate(clientSlug: string, nowMs: number): Promise<OffboardingRecord> {
    const r = this.require(clientSlug);
    if (r.retentionWindowEndMs !== null && nowMs >= r.retentionWindowEndMs) throw new Error('offboarding: retention window elapsed — cannot reactivate');
    await this.deps.freezeWriter(clientSlug, false, nowMs); // clear frozen_at in reverse
    await this.deps.registry.transitionStatus(clientSlug, 'active', nowMs);
    r.workflowState = 'acknowledged'; // back to pre-freeze; data intact
    r.freezePendingSinceMs = null;
    return this.touch(r, nowMs);
  }

  async authorizeDeletion(clientSlug: string, authorizedBy: string, secondAuthoriser: string, nowMs: number): Promise<OffboardingRecord> {
    const r = this.require(clientSlug);
    // reject a same-person pair HERE (matching the 0004 DB CHECK) so the fake fails at the same step the live adapter
    // does — not only later at runDeprovision (fake-vs-live parity). Executor distinctness is checked at runDeprovision.
    if (authorizedBy === secondAuthoriser) throw new Error(ERR_TWO_PERSON('the authoriser and second authoriser must be distinct people'));
    r.deletionAuthorizedBy = authorizedBy;
    r.deletionSecondAuthoriser = secondAuthoriser;
    return this.touch(r, nowMs);
  }

  async runDeprovision(clientSlug: string, executor: string, results: readonly SubStepResult[], nowMs: number): Promise<OffboardingRecord> {
    const r = this.require(clientSlug);
    // AC-10.OFF.004.5 gate: deletion may run ONLY from a CONFIRMED freeze (never freeze_pending / pre-freeze). An
    // unconfirmed freeze means the client silo may still be writing knowledge AFTER the verified export — deleting
    // then would silently lose it (#1). freeze_pending must be resolved to a real frozen state first.
    if (!DELETION_READY_STATES.includes(r.workflowState)) throw new Error(ERR_NOT_FROZEN);
    // hard gate (#1): verified + acknowledged.
    const gate = canProceedToDestruction(r);
    if (!gate.ok) throw new Error(gate.reason.includes('verified') ? ERR_EXPORT_UNVERIFIED : ERR_NOT_ACKNOWLEDGED);
    // retention window must have elapsed.
    if (r.retentionWindowEndMs === null || nowMs < r.retentionWindowEndMs) throw new Error(ERR_RETENTION_ACTIVE);
    // two-person auth (NFR-SEC.015): three distinct identities.
    const auth = verifyTwoPersonAuth({ authorizedBy: r.deletionAuthorizedBy, secondAuthoriser: r.deletionSecondAuthoriser, executor });
    if (!auth.ok) throw new Error(ERR_TWO_PERSON(auth.reason));

    r.workflowState = 'deleting';
    // AC-10.OFF.005.5 — internal_token revoked FIRST / independently, so even a partial failure never leaves a live
    // mgmt credential on a torn-down deployment.
    await this.deps.registry.revokeToken(clientSlug, nowMs);
    if (!r.tokensRevoked.includes('internal_token')) r.tokensRevoked.push('internal_token');

    const outcome = foldDeprovision(results);
    // record each completed system (idempotent set-union — a re-run does not double-add; AC-10.OFF.005.3).
    for (const s of outcome.completed) if (!r.systemsDeprovisioned.includes(s)) r.systemsDeprovisioned.push(s);
    if (r.systemsDeprovisioned.includes('connector_oauth') && !r.tokensRevoked.includes('connector_oauth')) r.tokensRevoked.push('connector_oauth');
    if (r.systemsDeprovisioned.includes('backup_purge')) r.backupPurgeFlaggedAtMs = nowMs;

    if (outcome.state === 'deletion_failed') {
      r.workflowState = 'deletion_failed';
      await this.deps.escalations.escalate({ clientSlug, kind: 'deletion_failed', detail: outcome.reason }, nowMs);
      return this.touch(r, nowMs); // NOT marked complete, no auto-rollback (AC-10.OFF.005.2)
    }
    // this run had no failure — but is the ACCUMULATED set complete? A partial-but-all-ok set (caller omitted systems)
    // must NOT report done: every DEPROVISION_SEQUENCE system (incl. backup_purge) must be recorded (AC-NFR-INF.013.1).
    const missing = requiredSystemsMissing(r.systemsDeprovisioned);
    if (missing.length > 0) {
      r.workflowState = 'deleting'; // still in progress; NOT stamped executed, cannot finalize
      await this.deps.escalations.escalate({ clientSlug, kind: 'deprovision_incomplete', detail: `systems not yet deprovisioned: ${missing.join(', ')}` }, nowMs);
      return this.touch(r, nowMs);
    }
    r.deletionExecutedBy = executor;
    r.deletionExecutedAtMs = nowMs;
    return this.touch(r, nowMs);
  }

  async finalize(clientSlug: string, nowMs: number): Promise<OffboardingRecord> {
    const r = this.require(clientSlug);
    const meta: MetaRecord = {
      clientSlug: r.clientSlug,
      offboardingInitiatedAtMs: r.offboardingInitiatedAtMs,
      exportDeliveredAtMs: r.exportDeliveredAtMs,
      exportAcknowledgedAtMs: r.exportAcknowledgedAtMs,
      retentionWindowEndMs: r.retentionWindowEndMs,
      deletionExecutedAtMs: r.deletionExecutedAtMs,
      deletionExecutedBy: r.deletionExecutedBy,
      systemsDeprovisioned: r.systemsDeprovisioned,
      tokensRevoked: r.tokensRevoked,
    };
    // belt-and-braces: every required system must be deprovisioned before completion (AC-NFR-INF.013.1) — a partial
    // deprovision can never be finalized as airtight-complete, even if the meta fields happen to be filled.
    const missingSystems = requiredSystemsMissing(r.systemsDeprovisioned);
    if (missingSystems.length > 0) {
      await this.deps.escalations.escalate({ clientSlug, kind: 'deprovision_incomplete', detail: `systems not yet deprovisioned: ${missingSystems.join(', ')}` }, nowMs);
      throw new Error(ERR_DELETION_INCOMPLETE(missingSystems));
    }
    const missing = metaRecordMissingFields(meta);
    if (missing.length > 0) {
      // AC-10.OFF.006.3 — a completed deletion whose meta-record is incomplete does NOT report complete; it escalates.
      await this.deps.escalations.escalate({ clientSlug, kind: 'meta_record_incomplete', detail: `missing fields: ${missing.join(', ')}` }, nowMs);
      throw new Error(`offboarding: meta-record incomplete (${missing.join(', ')}) — not reported complete, escalated (AC-10.OFF.006.3)`);
    }
    r.workflowState = 'completed';
    return this.touch(r, nowMs);
  }

  async get(clientSlug: string): Promise<OffboardingRecord | null> {
    const r = this.records.get(clientSlug);
    return r ? this.touch({ ...r }, r.updatedAtMs) : null;
  }
}

/** Re-export the link-state helper for callers rendering reissue prompts (AC-10.OFF.003.2). */
export { exportLinkState };
