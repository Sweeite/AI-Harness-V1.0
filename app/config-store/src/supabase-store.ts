// ISSUE-010 — the LIVE ConfigStore adapter (pg, against the client-owned silo Supabase). The only module
// that imports `pg`. It implements the same port as InMemoryConfigStore against the real DDL (schema.md
// §12 config_values / secret_manifest, §8 config_audit_log, §"Immutability enforcement" trigger, migration
// 0003 config_values RLS).
//
// ⚠️ NOT YET RUN LIVE. The append-only trigger actually rejecting a service_role DELETE/UPDATE, the RLS
// key-prefix scope actually filtering an authenticated read, and the redaction-tombstone passing the
// integrity check are proven by the ISSUE-010 LIVE CAPSTONE (results/issue-010-capstone.sql), run by the
// operator at the Stage-2 checkpoint. This adapter is authored to the DDL so the seam is real and
// typechecks; the InMemoryConfigStore is the proven reference model. Do NOT claim these paths verified
// until the capstone records evidence.
//
// Design notes tied to the three non-negotiables:
//   - config_audit_log is append-only + tamper-evident at the DB layer (the enforce_audit_append_only()
//     BEFORE UPDATE OR DELETE trigger, bound in 0001; revoke delete in 0001c). This adapter NEVER issues
//     an UPDATE/DELETE on it except the sanctioned redaction-tombstone (set redacted_at + null actor_id),
//     which the trigger's redaction branch permits. Retention prune runs as a privileged job outside the
//     app/service DELETE grant (schema.md L69-70) — modelled here but gated to the operator context.
//   - config_values reads run as `authenticated` under the 0003 key-prefix RLS. The audit READ/EXPORT run
//     as service_role (RLS-exempt) and therefore re-apply the SAME key-prefix scope in SQL via
//     config_key_group(key) = any($perms) — otherwise service_role would over-return (#2).
//   - SECRET keys never reach this table (guarded in appendAudit, matching the fake) and credential
//     material is redacted BEFORE the insert (redactCredentialMaterial) — no secret ever lands in a row.

import pg from 'pg';
import { configKeyGroup } from './keygroup.ts';
import { isSecretKey, redactCredentialMaterial } from './redaction.ts';
import type {
  ConfigAuditRow,
  ConfigStore,
  ConfigValueRow,
  ExportRequest,
  NewConfigAudit,
  RetentionResult,
  SecretManifestRow,
  SecretPresence,
} from './store.ts';
import { DOWNLOAD_RECORDS_PERM } from './store.ts';

export class SupabaseConfigStore implements ConfigStore {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
  }

  async readConfigValue(key: string, callerConfigPerms: readonly string[]): Promise<ConfigValueRow | null> {
    // Under the 0003 RLS, an authenticated session already sees only its group's rows; this adapter path
    // is service_role, so re-apply the key-prefix scope explicitly (config_key_group is the SQL mirror).
    if (!callerConfigPerms.includes(configKeyGroup(key))) return null;
    const res = await this.pool.query<ConfigValueRow>(
      `select key, value, updated_at, updated_by from config_values where key = $1`,
      [key],
    );
    return res.rows[0] ?? null;
  }

  async putConfigValue(key: string, value: unknown, updatedBy: string | null, _now: number): Promise<ConfigValueRow> {
    if (isSecretKey(key)) {
      throw new Error(`config_values: SECRET-class key '${key}' cannot be stored here (secret_manifest presence only)`);
    }
    const res = await this.pool.query<ConfigValueRow>(
      `insert into config_values (key, value, updated_by)
       values ($1, $2::jsonb, $3)
       on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by
       returning key, value, updated_at, updated_by`,
      [key, JSON.stringify(value), updatedBy],
    );
    return res.rows[0]!;
  }

  async requiredMissingSecrets(required: readonly string[]): Promise<string[]> {
    // A required env var is "missing" if it has no presence row OR present=false. Left-join so an absent
    // row counts as missing (the boot gate must block on it — #3, never a silent false "present").
    const res = await this.pool.query<{ key: string }>(
      `select r.key
       from unnest($1::text[]) as r(key)
       left join secret_manifest sm on sm.key = r.key
       where sm.key is null or sm.present = false
       order by r.key`,
      [required as string[]],
    );
    return res.rows.map((r) => r.key);
  }

  async readSecretPresence(key: string): Promise<SecretPresence | null> {
    // Only presence + last_rotated are SELECTed — the table has no value column, so a value can never
    // cross the boundary (NFR-SEC.003.1 holds by construction).
    const res = await this.pool.query<SecretPresence>(
      `select key, present, last_rotated from secret_manifest where key = $1`,
      [key],
    );
    return res.rows[0] ?? null;
  }

  async putSecretPresence(row: SecretManifestRow): Promise<SecretManifestRow> {
    const res = await this.pool.query<SecretManifestRow>(
      `insert into secret_manifest (key, present, last_rotated)
       values ($1, $2, $3)
       on conflict (key) do update set present = excluded.present, last_rotated = excluded.last_rotated
       returning key, present, last_rotated`,
      [row.key, row.present, row.last_rotated],
    );
    return res.rows[0]!;
  }

  async appendAudit(row: NewConfigAudit, _now: number): Promise<ConfigAuditRow> {
    if (isSecretKey(row.key)) {
      throw new Error(
        `config_audit_log: SECRET-class key '${row.key}' can never produce an audit row (config-edit-taxonomy rule 2 / AC-7.LOG.008.5)`,
      );
    }
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

  async readAudit(from: string, to: string, callerConfigPerms: readonly string[]): Promise<ConfigAuditRow[]> {
    // Key-prefix scope re-applied in SQL: config_key_group(key) must be one of the caller's PERM-config.*
    // nodes. config_key_group is the SECURITY DEFINER helper from migration 0003.
    const res = await this.pool.query<ConfigAuditRow>(
      `select id, key, old_value, new_value, actor_id, redacted_at, changed_at
       from config_audit_log
       where changed_at >= $1 and changed_at <= $2
         and config_key_group(key) = any($3::text[])
       order by changed_at asc, id asc`,
      [from, to, callerConfigPerms as string[]],
    );
    return res.rows;
  }

  async exportAudit(req: ExportRequest): Promise<ConfigAuditRow[]> {
    if (!req.callerPerms.includes(DOWNLOAD_RECORDS_PERM)) {
      throw new Error(`config_audit_log export denied: caller lacks ${DOWNLOAD_RECORDS_PERM} (AC-7.LOG.008.1)`);
    }
    // All-or-fail: a single query returns the complete range+scope set in one shot. A partial read (a DB
    // error mid-stream) throws and the caller gets NO file — never a silent truncation. Tamper-evidence at
    // the DB layer is the trigger; a compromised row would have to have bypassed it (out of scope here).
    return this.readAudit(req.from, req.to, req.callerConfigPerms);
  }

  async runRetention(floorYears: number, _now: number): Promise<RetentionResult> {
    // Privileged prune (operator/job context — NOT the app/service DELETE grant, which 0001c revoked on
    // this sink). Deletes ONLY rows strictly older than the floor; rows inside the floor are never touched.
    // Runs in one statement with a RETURNING count so the run is logged (never silent, AC-7.LOG.008.2).
    //
    // OD-180 (chosen 2026-07-05, Option A): the 0005 enforce_audit_append_only() immutability trigger now
    // rejects EVERY DELETE on an audit sink UNLESS the executing transaction has set
    // `app.retention_prune = 'on'`. Without this GUC the DELETE below throws (a #3 regression: retention
    // silently fails). We therefore open an EXPLICIT transaction, issue `set local app.retention_prune =
    // 'on'` INSIDE it (so the whitelist auto-resets at COMMIT/ROLLBACK and never leaks past this one job
    // transaction — the transaction-local scope is the point), run the floor count + the DELETE + the
    // run-log insert, then COMMIT. The floor is enforced HERE by the app (the trigger only gates THAT a
    // delete happens inside a retention transaction, never the floor — 0005 note / #1).
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      // OD-180: transaction-local whitelist opt-in — the ONLY sanctioned config_audit_log delete path.
      await client.query(`set local app.retention_prune = 'on'`);
      const floorRes = await client.query<{ n: string }>(
        `select count(*)::text as n from config_audit_log
         where changed_at >= now() - ($1 || ' years')::interval`,
        [String(floorYears)],
      );
      const prunedRes = await client.query<{ n: string }>(
        `with del as (
           delete from config_audit_log
           where changed_at < now() - ($1 || ' years')::interval
           returning 1
         ) select count(*)::text as n from del`,
        [String(floorYears)],
      );
      const result: RetentionResult = {
        pruned: Number(prunedRes.rows[0]!.n),
        floorProtected: Number(floorRes.rows[0]!.n),
        window_applied_years: floorYears,
        ran_at: new Date().toISOString(),
      };
      // Log the run to event_log so pruning is never silent (mirrors AC-7.LOG.006.2 for this sink).
      await client.query(
        `insert into event_log (task_id, event_type, entity_ids, summary, payload)
         values (null, 'task_completed', '{}', $1, $2::jsonb)`,
        [
          `config_audit_log retention prune: ${result.pruned} pruned, ${result.floorProtected} inside the ${floorYears}y floor`,
          JSON.stringify(result),
        ],
      );
      await client.query('commit'); // `set local` auto-resets app.retention_prune here (OD-180)
      return result;
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  async redactActor(actorId: string, _now: number): Promise<number> {
    // The sanctioned tombstone (NFR-CMP.007): scrub actor_id + set redacted_at. The trigger's redaction
    // branch permits this because new.redacted_at goes non-null (schema.md §Immutability L51-52); it keeps
    // key/old_value/new_value/changed_at, so a subsequent export stays complete.
    const res = await this.pool.query(
      `update config_audit_log
       set actor_id = null, redacted_at = now()
       where actor_id = $1 and redacted_at is null`,
      [actorId],
    );
    return res.rowCount ?? 0;
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}
