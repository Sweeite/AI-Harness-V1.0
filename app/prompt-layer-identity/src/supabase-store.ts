// ISSUE-043 — the LIVE CorePromptStore adapter (pg, against the client-owned silo Supabase). It is the
// only module that imports `pg`. It implements the same port as InMemoryCorePromptStore against the
// EXISTING `prompt_layers` DDL (schema.md §5). NO migration is authored by this slice — prompt_layers is
// ISSUE-042's table; this adapter only reads/writes `core` rows.
//
// ⚠️ NOT YET RUN LIVE. Per the ISSUE-043 offline-build boundary, the live silo proof (a real core insert
// firing the 0004 version-discipline trigger, the prompt_layers RLS policy gating PERM-prompt.edit /
// edit_principles) is the Stage-3 checkpoint capstone, run by the operator. This adapter is authored to
// the DDL so the seam is real and typechecks; InMemoryCorePromptStore is the proven reference model. Do
// NOT claim these code paths verified until the capstone records evidence.
//
// Design notes tied to the three non-negotiables:
//   - An edit NEVER issues `update prompt_layers set content=…`; it INSERTs a new version with
//     previous_version_id = the head + version+1 (append-only — #1). The ISSUE-042 0004 trigger rejects any
//     UPDATE mutating an existing row, so even a bug here fails LOUD (#3).
//   - `change_reason` is `text not null`; the trigger also rejects an empty/whitespace reason.
//   - The current core is `max(version)` over the (layer='core', agent_id) chain — computed in SQL so
//     there is no read-modify-write race on the version number under concurrency.

import pg from 'pg';
import type { CoreEditInput, CorePromptStore, NewCoreInput, PromptLayer } from './store.ts';
import type { LayerKind } from './store.ts';

const SELECT_COLS =
  'id, layer, name, content, agent_id, enabled, version, previous_version_id, change_reason, created_at, created_by';

const LAYER_KINDS: readonly LayerKind[] = ['core', 'business', 'memory', 'task_template'];

function toRow(r: Record<string, unknown>): PromptLayer {
  const layer = String(r.layer);
  if (!(LAYER_KINDS as readonly string[]).includes(layer)) {
    throw new Error(`DB returned an unknown layer kind '${layer}' (schema drift?)`);
  }
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

export class SupabaseCorePromptStore implements CorePromptStore {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
  }

  async createCore(input: NewCoreInput, _now: number): Promise<PromptLayer> {
    if (input.change_reason == null || input.change_reason.trim() === '') {
      throw new Error('change_reason is mandatory and must be non-empty (FR-4.STO.003)');
    }
    if (input.agent_id == null) {
      throw new Error("layer='core' requires a non-null agent_id (schema §5 check / FR-4.LYR.002)");
    }
    const res = await this.pool.query(
      `insert into prompt_layers (layer, name, content, agent_id, enabled, version, previous_version_id, change_reason, created_by)
       values ('core', $1, $2, $3, $4, 1, null, $5, $6)
       returning ${SELECT_COLS}`,
      [input.name, input.content, input.agent_id, input.enabled ?? true, input.change_reason, input.created_by],
    );
    return toRow(res.rows[0]!);
  }

  async appendCoreVersion(currentVersionId: string, edit: CoreEditInput, _now: number): Promise<PromptLayer> {
    if (edit.change_reason == null || edit.change_reason.trim() === '') {
      throw new Error('change_reason is mandatory and must be non-empty (FR-4.STO.003)');
    }
    // Single INSERT…SELECT: read the current core row, assert it is the head, INSERT the next version.
    // Atomic version increment (no read-modify-write race). The ISSUE-042 trigger forbids in-place UPDATE.
    const res = await this.pool.query(
      `with cur as (
         select * from prompt_layers where id = $1 and layer = 'core'
       ),
       head as (
         select max(pl.version) as v
         from prompt_layers pl
         join cur on pl.layer = 'core' and pl.agent_id is not distinct from cur.agent_id
       )
       insert into prompt_layers (layer, name, content, agent_id, enabled, version, previous_version_id, change_reason, created_by)
       select 'core', cur.name, $2, cur.agent_id, coalesce($3, cur.enabled), head.v + 1, cur.id, $4, $5
       from cur, head
       where cur.version = head.v
       returning ${SELECT_COLS}`,
      [currentVersionId, edit.content, edit.enabled ?? null, edit.change_reason, edit.created_by ?? null],
    );
    if (res.rowCount === 0) {
      throw new Error(`stale or unknown core edit target ${currentVersionId} — re-read the head first (append-only-by-version)`);
    }
    return toRow(res.rows[0]!);
  }

  async getVersion(id: string): Promise<PromptLayer | null> {
    const res = await this.pool.query(`select ${SELECT_COLS} from prompt_layers where id = $1`, [id]);
    return res.rowCount === 0 ? null : toRow(res.rows[0]!);
  }

  async currentCoreForAgent(agent_id: string): Promise<PromptLayer | null> {
    const res = await this.pool.query(
      `select ${SELECT_COLS} from prompt_layers
       where layer = 'core' and agent_id = $1
       order by version desc limit 1`,
      [agent_id],
    );
    return res.rowCount === 0 ? null : toRow(res.rows[0]!);
  }

  async agentsWithCore(): Promise<string[]> {
    // The current-head core per agent; propagation targets each distinct agent that has one.
    const res = await this.pool.query(
      `select distinct agent_id from prompt_layers where layer = 'core' and agent_id is not null`,
    );
    return res.rows.map((r) => String(r.agent_id));
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}
