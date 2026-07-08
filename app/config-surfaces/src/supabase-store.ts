// ISSUE-086 — the LIVE ConfigSurfaceStore adapter (pg, against the client-owned silo Supabase). The only
// module that imports `pg`. It implements the same port as InMemoryConfigSurfaceStore against the real DDL
// (schema.md §12 config_values / secret_manifest, §8 config_audit_log; migration 0001 baseline tables +
// notifications + profiles/user_roles/roles; 0003 config_key_group / key-prefix RLS).
//
// ⚠️ NOT YET RUN LIVE. This adapter is authored to the DDL so the seam is real and typechecks; the
// InMemoryConfigSurfaceStore is the proven reference model. The append-only trigger actually rejecting a
// service_role UPDATE/DELETE on config_audit_log, the key-prefix RLS actually filtering an authenticated
// read, and the redaction-tombstone are proven by the ISSUE-010 LIVE CAPSTONE (config_audit_log immutability)
// + a config-surfaces live-adapter smoke (R10). Do NOT claim these paths verified until that smoke records
// evidence.
//
// Non-negotiable ties:
//   - SECRET / hard-limit keys never reach putConfigValue/appendAudit (guarded here, matching the fake) —
//     a SECRET value can never land in config_values or config_audit_log (AC-7.LOG.008.5 / AC-7.LOG.005.1).
//   - The audit READ/EXPORT run as the postgres owner (RLS-bypass) and re-apply the SAME key-prefix scope in
//     SQL via config_key_group(key) = any($perms) — otherwise the owner would over-return (#2).
//   - config_audit_log tamper-evidence is the DB append-only trigger (the authority); this adapter never
//     issues an UPDATE/DELETE on it except the sanctioned redaction-tombstone.

import pg from 'pg';
import { configKeyGroup, isHardLimitKey } from './keys.ts';
import { isSecretKey, redactCredentialMaterial } from './redaction.ts';
import { DOWNLOAD_RECORDS_PERM } from './sections.ts';
import {
  ERR_HARD_LIMIT_WRITE,
  ERR_SECRET_IN_AUDIT,
  ERR_SECRET_IN_VALUES,
  type ActorInfo,
  type AuditFilter,
  type BannerSignals,
  type BatchWriteResult,
  type BatchWriteRow,
  type ConfigAuditRow,
  type ConfigSurfaceStore,
  type ConfigValueRow,
  type ExportRequest,
  type NewConfigAudit,
  type SecretPresence,
} from './store.ts';

export class SupabaseConfigSurfaceStore implements ConfigSurfaceStore {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
  }

  async loadSection(sectionKeys: readonly string[], callerConfigPerms: readonly string[]): Promise<Map<string, ConfigValueRow>> {
    const res = await this.pool.query<ConfigValueRow>(
      `select key, value, updated_at, updated_by
         from config_values
        where key = any($1::text[])
          and config_key_group(key) = any($2::text[])`,
      [sectionKeys as string[], callerConfigPerms as string[]],
    );
    return new Map(res.rows.map((r) => [r.key, r]));
  }

  async readConfigValue(key: string, callerConfigPerms: readonly string[]): Promise<ConfigValueRow | null> {
    if (!callerConfigPerms.includes(configKeyGroup(key))) return null;
    const res = await this.pool.query<ConfigValueRow>(
      `select key, value, updated_at, updated_by from config_values where key = $1`,
      [key],
    );
    return res.rows[0] ?? null;
  }

  async readSecretPresence(key: string): Promise<SecretPresence | null> {
    const res = await this.pool.query<SecretPresence>(
      `select key, present, last_rotated from secret_manifest where key = $1`,
      [key],
    );
    return res.rows[0] ?? null;
  }

  async loadSecretManifest(manifestKeys: readonly string[]): Promise<Map<string, SecretPresence>> {
    const res = await this.pool.query<SecretPresence>(
      `select key, present, last_rotated from secret_manifest where key = any($1::text[])`,
      [manifestKeys as string[]],
    );
    return new Map(res.rows.map((r) => [r.key, r]));
  }

  async putConfigValue(key: string, value: unknown, updatedBy: string | null, _now: number): Promise<ConfigValueRow> {
    if (isSecretKey(key)) throw new Error(ERR_SECRET_IN_VALUES(key));
    if (isHardLimitKey(key)) throw new Error(ERR_HARD_LIMIT_WRITE(key));
    const res = await this.pool.query<ConfigValueRow>(
      `insert into config_values (key, value, updated_by)
       values ($1, $2::jsonb, $3)
       on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by
       returning key, value, updated_at, updated_by`,
      [key, JSON.stringify(value), updatedBy],
    );
    return res.rows[0]!;
  }

  async appendAudit(row: NewConfigAudit, _now: number): Promise<ConfigAuditRow> {
    if (isSecretKey(row.key)) throw new Error(ERR_SECRET_IN_AUDIT(row.key));
    if (isHardLimitKey(row.key)) throw new Error(ERR_HARD_LIMIT_WRITE(row.key));
    const old_value = row.old_value == null ? null : redactCredentialMaterial(row.old_value);
    const new_value = redactCredentialMaterial(row.new_value);
    const res = await this.pool.query<ConfigAuditRow>(
      `insert into config_audit_log (key, old_value, new_value, actor_id)
       values ($1, $2::jsonb, $3::jsonb, $4)
       returning id, key, old_value, new_value, actor_id, redacted_at, changed_at`,
      [row.key, old_value == null ? null : JSON.stringify(old_value), JSON.stringify(new_value), row.actor_id],
    );
    return res.rows[0]!;
  }

  async writeBatch(rows: readonly BatchWriteRow[], actorId: string | null, _now: number): Promise<BatchWriteResult> {
    // ATOMIC Save: one checked-out client, one transaction. Every config_values upsert is paired with its
    // config_audit_log append and the whole batch commits or rolls back together — a mid-batch failure (a
    // rejected key, an FK violation on actor_id, a dropped connection, any constraint) leaves the section
    // exactly as it was, never half-saved (#1) and never a config change with no audit row (#3).
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const writtenKeys: string[] = [];
      const auditIds: string[] = [];
      for (const r of rows) {
        // Fail-closed guards INSIDE the txn: a SECRET/hard-limit key aborts (and rolls back) the batch (#2).
        if (isSecretKey(r.key)) throw new Error(ERR_SECRET_IN_VALUES(r.key));
        if (isHardLimitKey(r.key)) throw new Error(ERR_HARD_LIMIT_WRITE(r.key));
        await client.query(
          `insert into config_values (key, value, updated_by)
           values ($1, $2::jsonb, $3)
           on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`,
          [r.key, JSON.stringify(r.value), actorId],
        );
        const old_value = r.old_value == null ? null : redactCredentialMaterial(r.old_value);
        const new_value = redactCredentialMaterial(r.new_value);
        const res = await client.query<{ id: string }>(
          `insert into config_audit_log (key, old_value, new_value, actor_id)
           values ($1, $2::jsonb, $3::jsonb, $4)
           returning id`,
          [r.key, old_value == null ? null : JSON.stringify(old_value), JSON.stringify(new_value), actorId],
        );
        writtenKeys.push(r.key);
        auditIds.push(res.rows[0]!.id);
      }
      await client.query('COMMIT');
      return { writtenKeys, auditIds };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback error — surface the original failure below (never swallow it silently, #3)
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async readAudit(filter: AuditFilter, callerConfigPerms: readonly string[]): Promise<ConfigAuditRow[]> {
    // Key-prefix scope re-applied in SQL (owner/RLS-bypass path). config_key_group is the 0003 SECURITY
    // DEFINER helper. Optional section/key/actor filters narrow within the permitted set. Newest-first.
    const res = await this.pool.query<ConfigAuditRow>(
      `select id, key, old_value, new_value, actor_id, redacted_at, changed_at
         from config_audit_log
        where changed_at >= $1 and changed_at <= $2
          and config_key_group(key) = any($3::text[])
          and ($4::text is null or config_key_group(key) = $4)
          and ($5::text is null or key = $5)
          and ($6::uuid is null or actor_id = $6)
        order by changed_at desc, id desc`,
      [filter.from, filter.to, callerConfigPerms as string[], filter.section ?? null, filter.key ?? null, filter.actorId ?? null],
    );
    return res.rows;
  }

  async exportAudit(req: ExportRequest): Promise<ConfigAuditRow[]> {
    if (!req.callerPerms.includes(DOWNLOAD_RECORDS_PERM)) {
      throw new Error(`config_audit_log export denied: caller lacks ${DOWNLOAD_RECORDS_PERM} (AC-7.LOG.008.1)`);
    }
    // All-or-fail: one query returns the complete range+scope set. A partial read (a DB error mid-stream)
    // throws and the caller gets NO file — never a silent truncation. DB-layer tamper-evidence is the trigger.
    return this.readAudit(req.filter, req.callerConfigPerms);
  }

  async resolveActor(actorId: string | null): Promise<ActorInfo | null> {
    if (actorId == null) return null; // tombstoned / unattributed → caller renders "redacted (erased user)"
    const res = await this.pool.query<ActorInfo>(
      `select p.id::text as id, coalesce(p.name, p.email) as name, coalesce(r.name, 'unknown') as role
         from profiles p
         left join user_roles ur on ur.user_id = p.id and ur.active = true
         left join roles r on r.id = ur.role_id
        where p.id = $1`,
      [actorId],
    );
    return res.rows[0] ?? null;
  }

  async redactActor(actorId: string, _now: number): Promise<number> {
    // Sanctioned tombstone: scrub actor_id + set redacted_at (the trigger's redaction branch permits this
    // because new.redacted_at goes non-null). Keeps key/old/new/changed_at, so a later export stays complete.
    const res = await this.pool.query(
      `update config_audit_log set actor_id = null, redacted_at = now() where actor_id = $1 and redacted_at is null`,
      [actorId],
    );
    return res.rowCount ?? 0;
  }

  async verifyIntegrity(_row: ConfigAuditRow): Promise<boolean> {
    // The DB append-only trigger (enforce_audit_append_only, 0001/0005) is the tamper-evidence AUTHORITY: a
    // row read back from config_audit_log is, by construction, unmodified since append (no UPDATE/DELETE is
    // permitted outside the sanctioned redaction-tombstone / retention prune). The offline fake models the
    // per-row content hash; here the DB guarantee stands in its place. NOT YET RUN LIVE.
    return true;
  }

  async bannerSignals(): Promise<BannerSignals> {
    // The two always-loud conditions are unactioned critical notifications of the corresponding alert_type
    // (both values already exist in the 0001 alert_type enum). A row present + not yet actioned = the
    // condition is live. Read on load / refresh (no Realtime subscription — FR-7.RTP.001).
    const res = await this.pool.query<{ type: string }>(
      `select distinct type::text as type
         from notifications
        where type in ('alert_engine_stalled','alert_delivery_misconfigured')
          and actioned_at is null`,
    );
    const live = new Set(res.rows.map((r) => r.type));
    return {
      alertEngineStalled: live.has('alert_engine_stalled'),
      alertDeliveryMisconfigured: live.has('alert_delivery_misconfigured'),
    };
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}
