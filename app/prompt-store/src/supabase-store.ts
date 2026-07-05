// ISSUE-042 — the LIVE PromptStore adapter (pg, against the client-owned silo Supabase). It is the only
// module that imports `pg`. It implements the same port as InMemoryPromptStore against the real DDL
// (schema.md §5 prompt_layers). The append-only-by-version discipline is enforced BOTH here (every edit
// is an INSERT of a new version, never an UPDATE of content) AND at the DB by the 0004 version-discipline
// trigger — belt-and-braces so a rogue path cannot overwrite history (#1).
//
// ⚠️ NOT YET RUN LIVE. Per the ISSUE-042 offline-build boundary, the live silo proof (the version-
// discipline trigger firing, the prompt_layers RLS policy, the schema-shape assertions) is the Stage-2
// checkpoint capstone (results/issue-042-capstone.sql), run by the operator. This adapter is authored to
// the DDL so the seam is real and typechecks; InMemoryPromptStore is the proven reference model. Do NOT
// claim these code paths verified until the capstone records evidence.
//
// Design notes tied to the three non-negotiables:
//   - An edit NEVER issues `update prompt_layers set content=…`; it INSERTs a new row with
//     previous_version_id = the head + version+1 (append-only — #1). The 0004 trigger rejects any UPDATE
//     that mutates content/layer/agent_id/version of an existing row, so even a bug here fails LOUD (#3).
//   - `change_reason` is `text not null`; the trigger also rejects an empty/whitespace reason (FR-4.STO.003).
//   - The current version of an asset is `max(version)` over the (layer,name,agent_id) chain — computed in
//     SQL so there is no read-modify-write race on the version number under concurrency.

import pg from 'pg';
import { isLayerKind, type LayerKind } from './layers.js';
import type { AssetKey, EditInput, NewLayerInput, PromptLayer, PromptStore } from './store.js';

const SELECT_COLS =
  'id, layer, name, content, agent_id, enabled, version, previous_version_id, change_reason, created_at, created_by';

function toRow(r: Record<string, unknown>): PromptLayer {
  const layer = String(r.layer);
  if (!isLayerKind(layer)) throw new Error(`DB returned an unknown layer kind '${layer}' (schema drift?)`);
  return {
    id: String(r.id),
    layer: layer as LayerKind,
    name: String(r.name),
    content: String(r.content),
    agent_id: r.agent_id == null ? null : String(r.agent_id),
    enabled: Boolean(r.enabled),
    version: Number(r.version),
    previous_version_id: r.previous_version_id == null ? null : String(r.previous_version_id),
    change_reason: String(r.change_reason),
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    created_by: r.created_by == null ? null : String(r.created_by),
  };
}

export class SupabasePromptStore implements PromptStore {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
  }

  async createLayer(input: NewLayerInput, _now: number): Promise<PromptLayer> {
    if (input.change_reason == null || input.change_reason.trim() === '') {
      throw new Error('change_reason is mandatory and must be non-empty (FR-4.STO.003)');
    }
    if (input.layer === 'core' && input.agent_id == null) {
      throw new Error("layer='core' requires a non-null agent_id (schema §5 check / FR-4.LYR.002)");
    }
    // version defaults to 1, previous_version_id null — the DB DEFAULTs match, but we set them explicitly
    // so the intent is legible. The DB CHECK (layer<>'core' or agent_id not null) is the backstop.
    const res = await this.pool.query(
      `insert into prompt_layers (layer, name, content, agent_id, enabled, version, previous_version_id, change_reason, created_by)
       values ($1, $2, $3, $4, $5, 1, null, $6, $7)
       returning ${SELECT_COLS}`,
      [input.layer, input.name, input.content, input.agent_id, input.enabled ?? true, input.change_reason, input.created_by],
    );
    return toRow(res.rows[0]!);
  }

  async appendVersion(currentVersionId: string, edit: EditInput, _now: number): Promise<PromptLayer> {
    if (edit.change_reason == null || edit.change_reason.trim() === '') {
      throw new Error('change_reason is mandatory and must be non-empty (FR-4.STO.003)');
    }
    // Single statement: read the current row, assert it is the head, and INSERT the next version. Done in
    // one INSERT…SELECT so the version increment is atomic (no read-modify-write race). The DB trigger
    // still forbids any in-place UPDATE of an existing version — this path only ever INSERTs.
    const res = await this.pool.query(
      `with cur as (
         select * from prompt_layers where id = $1
       ),
       head as (
         select max(pl.version) as v
         from prompt_layers pl
         join cur on pl.layer = cur.layer
           and pl.name = cur.name
           and pl.agent_id is not distinct from cur.agent_id
       )
       insert into prompt_layers (layer, name, content, agent_id, enabled, version, previous_version_id, change_reason, created_by)
       select cur.layer, cur.name,
              coalesce($2, cur.content),
              cur.agent_id,
              coalesce($3, cur.enabled),
              head.v + 1,
              cur.id,
              $4, $5
       from cur, head
       where cur.version = head.v          -- reject a stale edit (not the head): 0 rows → caught below
       returning ${SELECT_COLS}`,
      [currentVersionId, edit.content ?? null, edit.enabled ?? null, edit.change_reason, edit.created_by ?? null],
    );
    if (res.rowCount === 0) {
      throw new Error(`stale or unknown edit target ${currentVersionId} — re-read the head before editing (append-only-by-version)`);
    }
    return toRow(res.rows[0]!);
  }

  async currentVersion(key: AssetKey): Promise<PromptLayer | null> {
    const res = await this.pool.query(
      `select ${SELECT_COLS} from prompt_layers
       where layer = $1 and name = $2 and agent_id is not distinct from $3
       order by version desc limit 1`,
      [key.layer, key.name, key.agent_id],
    );
    return res.rowCount === 0 ? null : toRow(res.rows[0]!);
  }

  async getVersion(id: string): Promise<PromptLayer | null> {
    const res = await this.pool.query(`select ${SELECT_COLS} from prompt_layers where id = $1`, [id]);
    return res.rowCount === 0 ? null : toRow(res.rows[0]!);
  }

  async history(key: AssetKey): Promise<PromptLayer[]> {
    const res = await this.pool.query(
      `select ${SELECT_COLS} from prompt_layers
       where layer = $1 and name = $2 and agent_id is not distinct from $3
       order by version asc`,
      [key.layer, key.name, key.agent_id],
    );
    return res.rows.map(toRow);
  }

  async currentCoreForAgent(agent_id: string): Promise<PromptLayer | null> {
    // FR-4.STO.002 / AC-4.STO.002.1 — Layer 1 resolves ONLY from prompt_layers layer='core'. No
    // agents.system_prompt read exists anywhere in this adapter (single source of truth, OD-048).
    const res = await this.pool.query(
      `select ${SELECT_COLS} from prompt_layers
       where layer = 'core' and agent_id = $1
       order by version desc limit 1`,
      [agent_id],
    );
    return res.rowCount === 0 ? null : toRow(res.rows[0]!);
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}
