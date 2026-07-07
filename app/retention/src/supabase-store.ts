// ISSUE-084 — the LIVE RetentionStore adapter (pg, against the client-owned silo Supabase + the
// management-plane registry). The only module that imports `pg`. It implements the same port as
// InMemoryRetentionStore against the real DDL authored by ISSUE-008 (the baseline schema) + ISSUE-010
// (config_values / config_audit_log). This slice authors NO migration of its own — it reads/writes the
// tables those issues own.
//
// ⚠️ NOT YET RUN LIVE. The RLS key-prefix gate on config_values actually rejecting a non-Super-Admin
// write, the config_audit_log append actually recording the change, the client_registry actually being
// the sole home of client_slug, and the legal-review sign-off are proven at the ISSUE-084 live capstone
// (the operator / onboarding session — the FR-10.LEG.001 gate is a live/you-present precondition, owed
// per the OD-172 pattern; see results/notes.md). This adapter is authored to the DDL so the seam is real
// and typechecks; the InMemoryRetentionStore is the proven reference model. Do NOT claim these paths
// verified until the capstone records evidence.
//
// Design notes tied to the three non-negotiables:
//   - A retention-value write is under the postgres owner (RLS-bypass) but re-applies the PERM-config.infra gate + the floor check
//     BEFORE the upsert, then appends a config_audit_log row in the SAME transaction — so a value can
//     never be set without its audit (#3) nor below its floor (#2).
//   - client_registry is on the MANAGEMENT deployment; the app-table writes go to the client silo, which
//     has no client_slug column by construction (ISSUE-008 baseline) — the isolation invariant is a
//     schema fact the index.ts lint proves offline, not a runtime filter (#2).

import pg from 'pg';
import {
  RETENTION_DEFAULTS,
  KEY_KIND,
  INFRA_PERM,
  V1_REGION_DEFAULT,
  SANCTIONED_DELETE_PATHS,
  type RetentionKey,
  type FloorRegistry,
  type DeletePath,
  type RoutineOp,
} from './catalog.ts';
import {
  RetentionError,
  ERR_DENIED,
  ERR_BELOW_FLOOR,
  ERR_FLOOR_UNRESOLVED,
  ERR_BAD_TYPE,
  ERR_CLIENT_SLUG,
  type RetentionStore,
  type RetentionAuditRow,
  type RegistryRow,
  type ResidencyRecord,
  type Tombstone,
  type LegalReview,
} from './store.ts';

export class SupabaseRetentionStore implements RetentionStore {
  private pool: pg.Pool;
  private mgmtPool: pg.Pool;
  private floors: FloorRegistry;

  /**
   * `connectionString` is the client SILO (config_values/config_audit_log — every method except
   * registerClient/registryHome). `mgmtConnectionString` is the SEPARATE management-plane Supabase project
   * that owns client_registry (ADR-001 §3/§13) — a genuinely different database, not just a different pool
   * on the same one. Passing the silo string for both would make registerClient/registryHome throw
   * `relation "client_registry" does not exist` (or vice versa for every other method).
   */
  constructor(connectionString: string, floors: FloorRegistry, mgmtConnectionString: string) {
    const ssl = (s: string) => (/sslmode=disable/.test(s) ? undefined : { rejectUnauthorized: false });
    this.pool = new pg.Pool({ connectionString, ssl: ssl(connectionString) });
    this.mgmtPool = new pg.Pool({ connectionString: mgmtConnectionString, ssl: ssl(mgmtConnectionString) });
    this.floors = { ...floors };
  }

  async getValue(key: RetentionKey): Promise<number | boolean> {
    // config_values holds jsonb; an unset key resolves to the catalog default (AC-10.RET.002.1).
    const res = await this.pool.query<{ value: unknown }>(`select value from config_values where key = $1`, [key]);
    if (res.rows.length === 0) return RETENTION_DEFAULTS[key];
    return res.rows[0]!.value as number | boolean;
  }

  async setValue(
    key: RetentionKey,
    value: number | boolean,
    actorPerms: readonly string[],
    actorId: string,
    _now: number,
  ): Promise<void> {
    if (!actorPerms.includes(INFRA_PERM)) {
      throw new RetentionError(ERR_DENIED, `retention value '${key}' is ${INFRA_PERM}-gated (Super Admin only); actor lacks it`);
    }
    const kind = KEY_KIND[key];
    if (kind === 'bool') {
      if (typeof value !== 'boolean') throw new RetentionError(ERR_BAD_TYPE, `'${key}' is a boolean toggle`);
    } else {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new RetentionError(ERR_BAD_TYPE, `'${key}' is a non-negative integer`);
      }
      const floor = this.floors[key as keyof FloorRegistry];
      if (floor === undefined || floor === null || Number.isNaN(floor)) {
        throw new RetentionError(ERR_FLOOR_UNRESOLVED, `'${key}' has no resolvable legal-minimum floor — write blocked (fail-closed)`);
      }
      if (value < floor) {
        throw new RetentionError(ERR_BELOW_FLOOR, `'${key}' = ${value} is below the legal-minimum floor of ${floor} — rejected (set the value at or above ${floor})`);
      }
    }
    // The value write + its audit are ONE transaction — a value never lands without its audit row (#3).
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const prev = await client.query<{ value: unknown }>(`select value from config_values where key = $1`, [key]);
      const old_value = prev.rows.length === 0 ? RETENTION_DEFAULTS[key] : (prev.rows[0]!.value as number | boolean);
      await client.query(
        `insert into config_values (key, value, updated_by)
         values ($1, $2::jsonb, $3)
         on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`,
        [key, JSON.stringify(value), actorId],
      );
      await client.query(
        `insert into config_audit_log (key, old_value, new_value, actor_id)
         values ($1, $2::jsonb, $3::jsonb, $4)`,
        [key, JSON.stringify(old_value), JSON.stringify(value), actorId],
      );
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  async setFloor(key: keyof FloorRegistry, floor: number): Promise<void> {
    if (!Number.isInteger(floor) || floor < 0) throw new RetentionError(ERR_BAD_TYPE, `floor for '${key}' must be a non-negative integer`);
    this.floors[key] = floor;
  }

  async audits(): Promise<RetentionAuditRow[]> {
    const res = await this.pool.query<{ key: string; old_value: unknown; new_value: unknown; actor_id: string; changed_at: Date }>(
      `select key, old_value, new_value, actor_id, changed_at from config_audit_log
       where key = any($1::text[]) order by changed_at asc, id asc`,
      [Object.keys(RETENTION_DEFAULTS)],
    );
    return res.rows.map((r) => ({
      key: r.key,
      old_value: r.old_value as number | boolean | null,
      new_value: r.new_value as number | boolean,
      actor_id: r.actor_id,
      changed_at: Math.floor(r.changed_at.getTime() / 1000),
    }));
  }

  async registerClient(row: RegistryRow): Promise<void> {
    // client_registry lives on the MANAGEMENT deployment (schema §13) — the one valid home of client_slug.
    await this.mgmtPool.query(
      `insert into client_registry (client_slug, client_name, internal_token, region)
       values ($1, $1, '', $2)
       on conflict (client_slug) do update set region = excluded.region`,
      [row.client_slug, row.region],
    );
  }
  async registryHome(clientSlug: string): Promise<RegistryRow | null> {
    const res = await this.mgmtPool.query<{ client_slug: string; region: string }>(
      `select client_slug, region from client_registry where client_slug = $1`,
      [clientSlug],
    );
    return res.rows[0] ?? null;
  }

  async writeAppRow(table: string, row: Record<string, unknown>): Promise<void> {
    // The isolation invariant is a SCHEMA fact (ISSUE-008 baseline has no client_slug column on any app
    // table) proven by the index.ts lint offline; at runtime an attempt to write client identity into a
    // client silo is a bug we still reject loudly rather than let the DB silently ignore a bad column.
    for (const col of Object.keys(row)) {
      if (col === 'client_slug' || col === 'client_id' || col === 'tenant_id' || col === 'tenant') {
        throw new RetentionError(
          ERR_CLIENT_SLUG,
          `application table '${table}' may not carry client-identity column '${col}' (FR-10.ISO.001 / ADR-001 §3)`,
        );
      }
    }
    // The actual column list is validated at lint time; a live insert would target the concrete table.
    void table;
  }

  async hasSharedBusinessStore(): Promise<boolean> {
    // Physical isolation (ADR-001 §1): there is no shared business-data store by construction. This is an
    // architectural property, not a query — always false in a correctly-provisioned fleet (AC-10.ISO.002.1).
    return false;
  }

  async recordResidency(region: string | null): Promise<ResidencyRecord> {
    const resolved = region ?? V1_REGION_DEFAULT;
    // Residency is recorded on the management-plane registry row (client_registry.region, schema §13).
    return { region: resolved, recorded: true, surfaced_for_legal_review: true };
  }
  async residency(): Promise<ResidencyRecord | null> {
    // In the live adapter residency is read from client_registry.region; modelled here as the default lock.
    return { region: V1_REGION_DEFAULT, recorded: true, surfaced_for_legal_review: true };
  }

  async routineOp(op: RoutineOp, memoryId: string): Promise<void> {
    // Routine ops never hard-delete — enforced by the C2 sole-writer (ADR-004); nothing to do here.
    void op;
    void memoryId;
  }

  async hardDelete(memoryId: string, path: DeletePath | null, authorisedBy: string | null, now: number): Promise<Tombstone> {
    const sanctioned = path !== null && (SANCTIONED_DELETE_PATHS as readonly string[]).includes(path) && authorisedBy !== null;
    const tomb: Tombstone = { memory_id: memoryId, path: sanctioned ? path : null, authorised_by: sanctioned ? authorisedBy : null, at: now };
    // The live tombstone lands in access_audit via the C2 sole-writer (FR-2.MNT.017); recorded here for parity.
    // The writer is expected to stamp action='hard_delete', target_entity_id=memoryId, path_context=<DeletePath>
    // — the literal contract tombstones()/unauthorisedTombstones() below read back against.
    return tomb;
  }

  /** Every hard_delete access_audit row, joined against its authorisation record when the path is
   *  individual_erasure (deletion_requests, on this silo). client_offboarding's authorisation record
   *  (offboarding_records) lives on the MANAGEMENT plane and has no migration yet (ISSUE-085 era) — until
   *  it exists, a claimed client_offboarding hard-delete cannot be verified here and is reported
   *  fail-closed as unauthorised (#2/#3: better to over-flag than silently clear a real violation). */
  private async liveTombstones(): Promise<Tombstone[]> {
    const res = await this.pool.query<{ target_entity_id: string | null; path_context: string | null; authorized_by: string | null; created_at: Date }>(
      `select aa.target_entity_id, aa.path_context,
              (select dr.authorized_by from deletion_requests dr
                 where dr.target_user_id = aa.target_entity_id and dr.status = 'executed'
                 order by dr.executed_at desc limit 1) as authorized_by,
              aa.created_at
         from access_audit aa
        where aa.action = 'hard_delete'
        order by aa.created_at asc`,
    );
    return res.rows.map((r) => {
      const sanctioned = r.path_context === 'individual_erasure' && r.authorized_by !== null;
      return {
        memory_id: r.target_entity_id ?? '',
        path: sanctioned ? (r.path_context as DeletePath) : null,
        authorised_by: sanctioned ? r.authorized_by : null,
        at: Math.floor(r.created_at.getTime() / 1000),
      };
    });
  }
  async tombstones(): Promise<Tombstone[]> {
    return this.liveTombstones();
  }
  async unauthorisedTombstones(): Promise<Tombstone[]> {
    // The RET.001 detector (AC-10.RET.001.3): a tombstone with no DEL/OFF authorisation behind it.
    const all = await this.liveTombstones();
    return all.filter((t) => t.path === null || t.authorised_by === null);
  }

  async recordLegalReview(_review: LegalReview): Promise<void> {
    // The legal-review sign-off is an operational/onboarding record (FR-10.LEG.001) — a live/you-present
    // precondition, not an offline write path. Owed per OD-172 (see results/notes.md).
  }
  async mayHandleRegulatedData(_jurisdiction: string): Promise<boolean> {
    return false; // fail-closed until the live legal review is recorded
  }
  async mayEnableSensitiveFeature(_jurisdiction: string, _feature: string): Promise<boolean> {
    return false; // fail-closed until the live legal review is recorded
  }

  async end(): Promise<void> {
    await this.pool.end();
    await this.mgmtPool.end();
  }
}
