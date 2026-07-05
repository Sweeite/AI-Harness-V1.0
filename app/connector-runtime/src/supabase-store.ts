// ISSUE-032 — the LIVE ConnectorRuntimeStore adapter (pg, against the client-owned silo Supabase).
// It is the only module that imports `pg`. It implements the same port as InMemoryConnectorRuntimeStore
// against the real DDL (results/proposed-migration-0007_connector_runtime.sql = schema.md §4 + §Types).
//
// ⚠️ NOT YET RUN LIVE. Applying migration 0007 to a silo + a live run of these code paths is a 💻
// live-infra step owed to the operator session / Checkpoint 3. This adapter is authored to the DDL so
// the seam is real and typechecks; the InMemoryConnectorRuntimeStore is the proven reference model.
// Do NOT claim these code paths verified until a live run records evidence.
//
// Design notes tied to the three non-negotiables:
//   - tools is append-only-by-version: an edit is an INSERT of a NEW row (version+1, previous_version_id),
//     the 0007 trigger blocks any in-place mutation of the contract columns + DELETE (#1). This adapter
//     never UPDATEs contract columns; the only UPDATE it issues is the enabled flip (permitted).
//   - idempotency_ledger: commitIntent uses INSERT ... ON CONFLICT (idempotency_key) DO NOTHING → a
//     0-row result IS a prior intent (the PK does the dedup atomically, closing the check-then-act
//     race — #1/#2). recordResult UPDATEs result only where it is still NULL (write-once — #1).
//   - access_token/refresh_token are Vault-encrypted at rest, service_role decrypt only; this adapter
//     MUST NOT log them (#2).

import pg from 'pg';
import type {
  ConnectorRuntimeStore,
  CredentialRow,
  IntentOutcome,
  LedgerRow,
  ToolContract,
  ToolEdit,
  ToolRow,
} from './store.js';

export class SupabaseConnectorRuntimeStore implements ConnectorRuntimeStore {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
  }

  private static readonly TOOL_COLS =
    'id, name, description, category, risk_level, requires_approval, connector, scopes, config, enabled, version, previous_version_id, change_reason, created_at, updated_at';

  async registerTool(contract: ToolContract, _now: number): Promise<ToolRow> {
    // NOT NULL + the enum + the 0007 completeness trigger reject a partial tool at the DB (belt to the
    // fake's braces). version=1, previous_version_id=null for a first registration.
    const res = await this.pool.query<ToolRow>(
      `insert into tools (name, description, category, risk_level, requires_approval, connector, scopes, config, change_reason)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       returning ${SupabaseConnectorRuntimeStore.TOOL_COLS}`,
      [
        contract.name,
        contract.description,
        contract.category,
        contract.risk_level,
        contract.requires_approval,
        contract.connector,
        contract.scopes,
        JSON.stringify(contract.config),
        contract.change_reason,
      ],
    );
    return res.rows[0]!;
  }

  async editTool(toolId: string, edit: ToolEdit, _now: number): Promise<ToolRow> {
    // Append-only-by-version: resolve the CURRENT head of the chain, INSERT a new version linking it,
    // and flip the head's enabled=false so only the newest version is selectable. Done in one txn so a
    // reader never sees two enabled heads.
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const head = await this.currentHead(client, toolId);
      if (!head) throw new Error(`tools: cannot edit ${toolId}: no such tool`);
      const inserted = await client.query<ToolRow>(
        `insert into tools (name, description, category, risk_level, requires_approval, connector, scopes, config, enabled, version, previous_version_id, change_reason)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         returning ${SupabaseConnectorRuntimeStore.TOOL_COLS}`,
        [
          edit.name,
          edit.description,
          edit.category,
          edit.risk_level,
          edit.requires_approval,
          edit.connector,
          edit.scopes,
          JSON.stringify(edit.config),
          head.enabled,
          head.version + 1,
          head.id,
          edit.change_reason,
        ],
      );
      // Only the enabled flip — permitted in-place by the 0007 trigger.
      await client.query(`update tools set enabled = false, updated_at = now() where id = $1`, [head.id]);
      await client.query('commit');
      return inserted.rows[0]!;
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  async setEnabled(toolId: string, enabled: boolean, _now: number): Promise<ToolRow> {
    const res = await this.pool.query<ToolRow>(
      `update tools set enabled = $2, updated_at = now() where id = $1
       returning ${SupabaseConnectorRuntimeStore.TOOL_COLS}`,
      [toolId, enabled],
    );
    if (res.rowCount === 0) throw new Error(`tools: cannot set enabled on ${toolId}: no such tool`);
    return res.rows[0]!;
  }

  async getTool(toolId: string): Promise<ToolRow | undefined> {
    const res = await this.pool.query<ToolRow>(
      `select ${SupabaseConnectorRuntimeStore.TOOL_COLS} from tools where id = $1`,
      [toolId],
    );
    return res.rows[0];
  }

  private async currentHead(client: pg.PoolClient, toolId: string): Promise<ToolRow | undefined> {
    // Walk forward via previous_version_id using a recursive CTE from any node in the chain.
    const res = await client.query<ToolRow>(
      `with recursive chain as (
         select ${SupabaseConnectorRuntimeStore.TOOL_COLS} from tools where id = $1
         union all
         select t.id, t.name, t.description, t.category, t.risk_level, t.requires_approval, t.connector,
                t.scopes, t.config, t.enabled, t.version, t.previous_version_id, t.change_reason,
                t.created_at, t.updated_at
         from tools t join chain c on t.previous_version_id = c.id
       )
       select ${SupabaseConnectorRuntimeStore.TOOL_COLS} from chain order by version desc limit 1`,
      [toolId],
    );
    return res.rows[0];
  }

  async versionChain(toolId: string): Promise<ToolRow[]> {
    // Walk to the root, then forward, ordered by version.
    const res = await this.pool.query<ToolRow>(
      `with recursive up as (
         select ${SupabaseConnectorRuntimeStore.TOOL_COLS} from tools where id = $1
         union all
         select t.id, t.name, t.description, t.category, t.risk_level, t.requires_approval, t.connector,
                t.scopes, t.config, t.enabled, t.version, t.previous_version_id, t.change_reason,
                t.created_at, t.updated_at
         from tools t join up u on u.previous_version_id = t.id
       ),
       root as (select id from up order by version asc limit 1),
       down as (
         select ${SupabaseConnectorRuntimeStore.TOOL_COLS} from tools where id = (select id from root)
         union all
         select t.id, t.name, t.description, t.category, t.risk_level, t.requires_approval, t.connector,
                t.scopes, t.config, t.enabled, t.version, t.previous_version_id, t.change_reason,
                t.created_at, t.updated_at
         from tools t join down d on t.previous_version_id = d.id
       )
       select ${SupabaseConnectorRuntimeStore.TOOL_COLS} from down order by version asc`,
      [toolId],
    );
    return res.rows;
  }

  async selectableTools(): Promise<ToolRow[]> {
    const res = await this.pool.query<ToolRow>(
      `select ${SupabaseConnectorRuntimeStore.TOOL_COLS} from tools where enabled = true`,
    );
    return res.rows;
  }

  async commitIntent(idempotencyKey: string, connector: string, _now: number): Promise<IntentOutcome> {
    // Durable pre-call intent, atomic dedup on the PK. 0 rows inserted → key already present → suppress.
    const ins = await this.pool.query(
      `insert into idempotency_ledger (idempotency_key, connector) values ($1, $2)
       on conflict (idempotency_key) do nothing`,
      [idempotencyKey, connector],
    );
    if (ins.rowCount === 1) return { kind: 'fresh' };
    const prior = await this.pool.query<{ result: unknown }>(
      `select result from idempotency_ledger where idempotency_key = $1`,
      [idempotencyKey],
    );
    return { kind: 'suppressed', result: prior.rows[0]?.result ?? null };
  }

  async recordResult(idempotencyKey: string, result: unknown): Promise<void> {
    // Write-once: only fill result where it is still NULL (the 0007 trigger also blocks a rewrite).
    const res = await this.pool.query(
      `update idempotency_ledger set result = $2 where idempotency_key = $1 and result is null`,
      [idempotencyKey, JSON.stringify(result)],
    );
    if (res.rowCount === 0) {
      throw new Error(`idempotency_ledger: no fillable intent for key ${idempotencyKey} (missing, or result already recorded)`);
    }
  }

  async getLedger(idempotencyKey: string): Promise<LedgerRow | undefined> {
    const res = await this.pool.query<LedgerRow>(
      `select idempotency_key, connector, result, created_at from idempotency_ledger where idempotency_key = $1`,
      [idempotencyKey],
    );
    return res.rows[0];
  }

  async getCredential(connector: string): Promise<CredentialRow | undefined> {
    const res = await this.pool.query<CredentialRow>(
      `select id, connector, access_token, refresh_token, expires_at, scopes, state, created_at, updated_at
       from connector_credentials where connector = $1
       order by updated_at desc limit 1`,
      [connector],
    );
    return res.rows[0];
  }

  async clientIdentityColumns(): Promise<string[]> {
    // REG.004 / AC-3.REG.004.1: assert NO client-identity column exists on any C3 table. If the schema
    // ever grew a client_slug (or similar), this returns it and the CI lint / test fails LOUD (#3).
    const res = await this.pool.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name
       from information_schema.columns
       where table_schema = 'public'
         and table_name in ('tools','connector_credentials','rate_limit_tracker','idempotency_ledger')
         and column_name in ('client_slug','client_id','tenant_id','deployment_slug')`,
    );
    return res.rows.map((r) => `${r.table_name}.${r.column_name}`);
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}
