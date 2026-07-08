// ISSUE-083 (C10 OFF) — the LIVE MANAGEMENT-plane pg adapter. Implements the SAME OffboardingStore port as the
// in-memory reference model, against the mgmt DB `offboarding_records` (0004) + driving `client_registry` +
// `internal_token` through the injected RegistrySeam (ISSUE-012). Reuses the EXACT same pure gate kernels
// (offboarding.ts) as the fake — the only difference is persistence — so a test cannot pass offline while the live
// adapter would skip a gate. The live external ops (export/reconcile, cross-project freeze, deprovision) remain
// injected seams (AF-132/133/135, onboarding).
//
// ⚠️ NOT YET RUN LIVE (R10). Authored to the 0004 DDL so the seam is real + typechecks; the in-memory reference model
// is the proven contract. Do NOT claim verified until the live mgmt-adapter smoke records evidence. Requires the mgmt
// DB (separate from the client silo) with 0004 applied.

import pg from 'pg';
import {
  DEFAULT_RETENTION_DAYS,
  canInitiateOffboarding,
  canProceedToDestruction,
  foldDeprovision,
  metaRecordMissingFields,
  requiredSystemsMissing,
  verifyExport,
  verifyTwoPersonAuth,
  type MetaRecord,
  type SubStepResult,
  type TableReconciliation,
} from './offboarding.ts';
import {
  ERR_DELETION_INCOMPLETE,
  ERR_EXPORT_FAILED,
  ERR_EXPORT_UNVERIFIED,
  ERR_NOT_ACKNOWLEDGED,
  ERR_NOT_FROZEN,
  ERR_NOT_SUPER_ADMIN,
  ERR_NO_RECORD,
  ERR_RETENTION_ACTIVE,
  ERR_TWO_PERSON,
  type EscalationSink,
  type FreezeWriter,
  type OffboardingRecord,
  type OffboardingStore,
  type RegistrySeam,
} from './store.ts';
import type { DeprovisionSystem, WorkflowState } from './offboarding.ts';

const DELETION_READY_STATES: readonly WorkflowState[] = ['frozen', 'deleting', 'deletion_failed'];

export type QueryExec = <R extends pg.QueryResultRow>(text: string, params?: unknown[]) => Promise<{ rows: R[]; rowCount?: number | null }>;

interface RawRow {
  client_slug: string;
  workflow_state: WorkflowState;
  offboarding_initiated_secs: string | null;
  export_verified_secs: string | null;
  export_delivered_secs: string | null;
  export_acknowledged_secs: string | null;
  retention_window_end_secs: string | null;
  deletion_authorized_by: string | null;
  deletion_second_authoriser: string | null;
  deletion_executed_by: string | null;
  deletion_executed_secs: string | null;
  systems_deprovisioned: DeprovisionSystem[];
  tokens_revoked: string[];
  backup_purge_flagged_secs: string | null;
  freeze_pending_since_secs: string | null;
  created_secs: string;
  updated_secs: string;
}
const ms = (s: string | null): number | null => (s == null ? null : Math.round(Number(s) * 1000));
function toRec(r: RawRow): OffboardingRecord {
  return {
    clientSlug: r.client_slug,
    workflowState: r.workflow_state,
    offboardingInitiatedAtMs: ms(r.offboarding_initiated_secs),
    exportVerifiedAtMs: ms(r.export_verified_secs),
    exportDeliveredAtMs: ms(r.export_delivered_secs),
    exportAcknowledgedAtMs: ms(r.export_acknowledged_secs),
    retentionWindowEndMs: ms(r.retention_window_end_secs),
    deletionAuthorizedBy: r.deletion_authorized_by,
    deletionSecondAuthoriser: r.deletion_second_authoriser,
    deletionExecutedBy: r.deletion_executed_by,
    deletionExecutedAtMs: ms(r.deletion_executed_secs),
    systemsDeprovisioned: r.systems_deprovisioned ?? [],
    tokensRevoked: r.tokens_revoked ?? [],
    backupPurgeFlaggedAtMs: ms(r.backup_purge_flagged_secs),
    freezePendingSinceMs: ms(r.freeze_pending_since_secs),
    createdAtMs: ms(r.created_secs)!,
    updatedAtMs: ms(r.updated_secs)!,
  };
}
const COLS = `client_slug, workflow_state::text as workflow_state,
  extract(epoch from offboarding_initiated_at) as offboarding_initiated_secs,
  extract(epoch from export_verified_at) as export_verified_secs,
  extract(epoch from export_delivered_at) as export_delivered_secs,
  extract(epoch from export_acknowledged_at) as export_acknowledged_secs,
  extract(epoch from retention_window_end) as retention_window_end_secs,
  deletion_authorized_by::text as deletion_authorized_by,
  deletion_second_authoriser::text as deletion_second_authoriser,
  deletion_executed_by::text as deletion_executed_by,
  extract(epoch from deletion_executed_at) as deletion_executed_secs,
  systems_deprovisioned, tokens_revoked,
  extract(epoch from backup_purge_flagged_at) as backup_purge_flagged_secs,
  extract(epoch from freeze_pending_since) as freeze_pending_since_secs,
  extract(epoch from created_at) as created_secs, extract(epoch from updated_at) as updated_secs`;

export class SupabaseOffboardingStore implements OffboardingStore {
  private pool: pg.Pool | null = null;
  private readonly exec: QueryExec;
  constructor(
    connectionString: string,
    private readonly deps: { registry: RegistrySeam; freezeWriter: FreezeWriter; escalations: EscalationSink; queryExec?: QueryExec },
  ) {
    if (deps.queryExec) {
      this.exec = deps.queryExec;
    } else {
      const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
      const pool = new pg.Pool({ connectionString, ssl });
      this.pool = pool;
      this.exec = (text, params) => pool.query(text, params);
    }
  }

  private iso(nowMs: number): string {
    return new Date(nowMs).toISOString();
  }
  private async load(slug: string): Promise<OffboardingRecord | null> {
    const res = await this.exec<RawRow>(`select ${COLS} from offboarding_records where client_slug = $1`, [slug]);
    return res.rows[0] ? toRec(res.rows[0]) : null;
  }
  private async requireLive(slug: string): Promise<OffboardingRecord> {
    const r = await this.load(slug);
    if (!r) throw new Error(ERR_NO_RECORD(slug));
    return r;
  }

  async initiate(clientSlug: string, initiatorRole: string, nowMs: number): Promise<OffboardingRecord> {
    if (!canInitiateOffboarding(initiatorRole)) throw new Error(ERR_NOT_SUPER_ADMIN);
    const existing = await this.load(clientSlug);
    if (existing) return existing; // idempotent
    await this.deps.registry.transitionStatus(clientSlug, 'offboarding', nowMs);
    const res = await this.exec<RawRow>(
      `insert into offboarding_records (client_slug, workflow_state, offboarding_initiated_at, created_at, updated_at)
       values ($1, 'initiated', $2::timestamptz, $2::timestamptz, $2::timestamptz) returning ${COLS}`,
      [clientSlug, this.iso(nowMs)],
    );
    return toRec(res.rows[0]!);
  }

  async verifyExportComplete(clientSlug: string, reconciliations: readonly TableReconciliation[], nowMs: number): Promise<OffboardingRecord> {
    await this.requireLive(clientSlug);
    const verdict = verifyExport(reconciliations);
    if (!verdict.pass) {
      await this.deps.escalations.escalate({ clientSlug, kind: 'export_unverified', detail: verdict.reason }, nowMs);
      throw new Error(ERR_EXPORT_FAILED(verdict.reason));
    }
    const res = await this.exec<RawRow>(
      `update offboarding_records set workflow_state = 'export_verified', export_verified_at = $2::timestamptz,
         export_row_counts = $3::jsonb, updated_at = $2::timestamptz where client_slug = $1 returning ${COLS}`,
      [clientSlug, this.iso(nowMs), JSON.stringify(reconciliations.map((r) => ({ table: r.table, live: r.liveCount, exported: r.exportedCount })))],
    );
    return toRec(res.rows[0]!);
  }

  async recordDelivery(clientSlug: string, nowMs: number): Promise<OffboardingRecord> {
    const r = await this.requireLive(clientSlug);
    if (r.exportVerifiedAtMs === null) throw new Error(ERR_EXPORT_UNVERIFIED);
    const res = await this.exec<RawRow>(
      `update offboarding_records set workflow_state = 'delivered', export_delivered_at = $2::timestamptz, updated_at = $2::timestamptz where client_slug = $1 returning ${COLS}`,
      [clientSlug, this.iso(nowMs)],
    );
    return toRec(res.rows[0]!);
  }

  async acknowledgeReceipt(clientSlug: string, nowMs: number, ackWriteOk = true): Promise<OffboardingRecord> {
    const r = await this.requireLive(clientSlug);
    if (r.exportDeliveredAtMs === null) throw new Error('offboarding: cannot acknowledge before delivery');
    if (!ackWriteOk) {
      await this.deps.escalations.escalate({ clientSlug, kind: 'ack_write_failed', detail: 'the acknowledgement write failed — surfaced as a defect, not client latency' }, nowMs);
      throw new Error('offboarding: acknowledgement write failed (surfaced defect, AC-10.OFF.003.4)');
    }
    const res = await this.exec<RawRow>(
      `update offboarding_records set workflow_state = 'acknowledged', export_acknowledged_at = $2::timestamptz, updated_at = $2::timestamptz where client_slug = $1 returning ${COLS}`,
      [clientSlug, this.iso(nowMs)],
    );
    return toRec(res.rows[0]!);
  }

  async freeze(clientSlug: string, retentionDays: number, nowMs: number): Promise<OffboardingRecord> {
    const r = await this.requireLive(clientSlug);
    if (r.exportAcknowledgedAtMs === null) throw new Error(ERR_NOT_ACKNOWLEDGED);
    // AC-10.OFF.004.5 — the cross-project frozen_at write goes FIRST; client_registry.status is promoted to 'frozen'
    // ONLY on a confirmed write (the mgmt status must never outrun what the client deployment can enforce, #1/#3).
    const write = await this.deps.freezeWriter(clientSlug, true, nowMs);
    const end = nowMs + (retentionDays || DEFAULT_RETENTION_DAYS) * 24 * 60 * 60 * 1000;
    if (!write.confirmed) {
      await this.deps.escalations.escalate({ clientSlug, kind: 'freeze_pending', detail: write.detail ?? 'cross-project frozen_at write unconfirmed' }, nowMs);
      const res = await this.exec<RawRow>(
        `update offboarding_records set workflow_state = 'freeze_pending', retention_window_end = $3::timestamptz,
           freeze_pending_since = $2::timestamptz, updated_at = $2::timestamptz where client_slug = $1 returning ${COLS}`,
        [clientSlug, this.iso(nowMs), this.iso(end)],
      );
      return toRec(res.rows[0]!); // client_registry.status NOT transitioned — stays offboarding
    }
    await this.deps.registry.transitionStatus(clientSlug, 'frozen', nowMs);
    const res = await this.exec<RawRow>(
      `update offboarding_records set workflow_state = 'frozen', retention_window_end = $3::timestamptz,
         freeze_pending_since = null, updated_at = $2::timestamptz where client_slug = $1 returning ${COLS}`,
      [clientSlug, this.iso(nowMs), this.iso(end)],
    );
    return toRec(res.rows[0]!);
  }

  async reactivate(clientSlug: string, nowMs: number): Promise<OffboardingRecord> {
    const r = await this.requireLive(clientSlug);
    if (r.retentionWindowEndMs !== null && nowMs >= r.retentionWindowEndMs) throw new Error('offboarding: retention window elapsed — cannot reactivate');
    await this.deps.freezeWriter(clientSlug, false, nowMs);
    await this.deps.registry.transitionStatus(clientSlug, 'active', nowMs);
    const res = await this.exec<RawRow>(
      `update offboarding_records set workflow_state = 'acknowledged', freeze_pending_since = null, updated_at = $2::timestamptz where client_slug = $1 returning ${COLS}`,
      [clientSlug, this.iso(nowMs)],
    );
    return toRec(res.rows[0]!);
  }

  async authorizeDeletion(clientSlug: string, authorizedBy: string, secondAuthoriser: string, nowMs: number): Promise<OffboardingRecord> {
    await this.requireLive(clientSlug);
    // reject a same-person pair BEFORE the write (parity with the fake + the 0004 DB CHECK, which would also reject it).
    if (authorizedBy === secondAuthoriser) throw new Error(ERR_TWO_PERSON('the authoriser and second authoriser must be distinct people'));
    // the DB CHECK (0004) also rejects authorized_by == second_authoriser NULL-safely; this write surfaces it loud.
    const res = await this.exec<RawRow>(
      `update offboarding_records set deletion_authorized_by = $2::uuid, deletion_second_authoriser = $3::uuid, updated_at = $4::timestamptz where client_slug = $1 returning ${COLS}`,
      [clientSlug, authorizedBy, secondAuthoriser, this.iso(nowMs)],
    );
    return toRec(res.rows[0]!);
  }

  async runDeprovision(clientSlug: string, executor: string, results: readonly SubStepResult[], nowMs: number): Promise<OffboardingRecord> {
    const r = await this.requireLive(clientSlug);
    // AC-10.OFF.004.5 — deletion only from a CONFIRMED freeze (never freeze_pending / pre-freeze) — see the fake.
    if (!DELETION_READY_STATES.includes(r.workflowState)) throw new Error(ERR_NOT_FROZEN);
    const gate = canProceedToDestruction(r);
    if (!gate.ok) throw new Error(gate.reason.includes('verified') ? ERR_EXPORT_UNVERIFIED : ERR_NOT_ACKNOWLEDGED);
    if (r.retentionWindowEndMs === null || nowMs < r.retentionWindowEndMs) throw new Error(ERR_RETENTION_ACTIVE);
    const auth = verifyTwoPersonAuth({ authorizedBy: r.deletionAuthorizedBy, secondAuthoriser: r.deletionSecondAuthoriser, executor });
    if (!auth.ok) throw new Error(ERR_TWO_PERSON(auth.reason));

    // internal_token FIRST (AC-10.OFF.005.5), then record deleting state.
    await this.deps.registry.revokeToken(clientSlug, nowMs);
    const tokens = new Set(r.tokensRevoked);
    tokens.add('internal_token');
    await this.exec(`update offboarding_records set workflow_state = 'deleting', tokens_revoked = $2::text[], updated_at = $3::timestamptz where client_slug = $1`, [clientSlug, [...tokens], this.iso(nowMs)]);

    const outcome = foldDeprovision(results);
    const systems = new Set(r.systemsDeprovisioned);
    for (const s of outcome.completed) systems.add(s);
    if (systems.has('connector_oauth')) tokens.add('connector_oauth');
    const backupFlagged = systems.has('backup_purge') ? this.iso(nowMs) : null;

    if (outcome.state === 'deletion_failed') {
      await this.deps.escalations.escalate({ clientSlug, kind: 'deletion_failed', detail: outcome.reason }, nowMs);
      const res = await this.exec<RawRow>(
        `update offboarding_records set workflow_state = 'deletion_failed', systems_deprovisioned = $2::text[],
           tokens_revoked = $3::text[], backup_purge_flagged_at = coalesce($4::timestamptz, backup_purge_flagged_at),
           updated_at = $5::timestamptz where client_slug = $1 returning ${COLS}`,
        [clientSlug, [...systems], [...tokens], backupFlagged, this.iso(nowMs)],
      );
      return toRec(res.rows[0]!);
    }
    // partial-but-all-ok: the accumulated set must cover every DEPROVISION_SEQUENCE system before "done" (#1).
    const missing = requiredSystemsMissing([...systems]);
    if (missing.length > 0) {
      await this.deps.escalations.escalate({ clientSlug, kind: 'deprovision_incomplete', detail: `systems not yet deprovisioned: ${missing.join(', ')}` }, nowMs);
      const res = await this.exec<RawRow>(
        `update offboarding_records set workflow_state = 'deleting', systems_deprovisioned = $2::text[],
           tokens_revoked = $3::text[], backup_purge_flagged_at = coalesce($4::timestamptz, backup_purge_flagged_at),
           updated_at = $5::timestamptz where client_slug = $1 returning ${COLS}`,
        [clientSlug, [...systems], [...tokens], backupFlagged, this.iso(nowMs)],
      );
      return toRec(res.rows[0]!); // NOT stamped executed; finalize will refuse
    }
    const res = await this.exec<RawRow>(
      `update offboarding_records set systems_deprovisioned = $2::text[], tokens_revoked = $3::text[],
         backup_purge_flagged_at = coalesce($4::timestamptz, backup_purge_flagged_at),
         deletion_executed_by = $5::uuid, deletion_executed_at = $6::timestamptz, updated_at = $6::timestamptz
       where client_slug = $1 returning ${COLS}`,
      [clientSlug, [...systems], [...tokens], backupFlagged, executor, this.iso(nowMs)],
    );
    return toRec(res.rows[0]!);
  }

  async finalize(clientSlug: string, nowMs: number): Promise<OffboardingRecord> {
    const r = await this.requireLive(clientSlug);
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
    const missingSystems = requiredSystemsMissing(r.systemsDeprovisioned);
    if (missingSystems.length > 0) {
      await this.deps.escalations.escalate({ clientSlug, kind: 'deprovision_incomplete', detail: `systems not yet deprovisioned: ${missingSystems.join(', ')}` }, nowMs);
      throw new Error(ERR_DELETION_INCOMPLETE(missingSystems));
    }
    const missing = metaRecordMissingFields(meta);
    if (missing.length > 0) {
      await this.deps.escalations.escalate({ clientSlug, kind: 'meta_record_incomplete', detail: `missing fields: ${missing.join(', ')}` }, nowMs);
      throw new Error(`offboarding: meta-record incomplete (${missing.join(', ')}) — not reported complete, escalated (AC-10.OFF.006.3)`);
    }
    const res = await this.exec<RawRow>(
      `update offboarding_records set workflow_state = 'completed', updated_at = $2::timestamptz where client_slug = $1 returning ${COLS}`,
      [clientSlug, this.iso(nowMs)],
    );
    return toRec(res.rows[0]!);
  }

  async get(clientSlug: string): Promise<OffboardingRecord | null> {
    return this.load(clientSlug);
  }

  async close(): Promise<void> {
    await this.pool?.end();
  }
}

export { SupabaseOffboardingStore as default };
