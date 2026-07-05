// ISSUE-044 — the LIVE adapters (pg, against the client-owned silo Supabase). The only module that imports
// `pg`. Implements the same ports as the in-memory fakes against the EXISTING DDL (schema.md §5:
// dynamic_field_values, prompt_layers). This slice ships NO migration — dynamic_field_values + prompt_layers
// are created by ISSUE-042; this adapter writes rows only.
//
// ⚠️ NOT YET RUN LIVE. Per the ISSUE-044 offline-build boundary, the live silo proof (rows landing under
// the prompt_layers RLS policy, the ISSUE-042 0004 version-discipline trigger rejecting an in-place UPDATE
// of a task_template row, dynamic_field_values reads/writes under RLS) is owed to the Stage-3 checkpoint
// capstone, run by the operator. These adapters are authored to the DDL so the seam is real and typechecks;
// the in-memory fakes are the proven reference models. Do NOT claim these paths verified until the capstone
// records evidence.
//
// Design notes tied to the three non-negotiables:
//   - A task_template/business edit NEVER issues `update prompt_layers set content=…`; it INSERTs a new row
//     with previous_version_id = the head + version+1 (append-only — #1). The ISSUE-042 0004 trigger
//     rejects any content-mutating UPDATE, so even a bug here fails LOUD (#3).
//   - `change_reason` is `text not null`; the trigger also rejects an empty/whitespace reason (FR-4.STO.003).
//   - dynamic_field_values.set stamps last_updated=now() so freshness surfacing is never defeated by a
//     silent write that leaves an old timestamp (AC-4.BIZ.003.3 / #3).

import pg from 'pg';
import type { DynamicFieldValue } from './context.ts';
import type { DynamicFieldStore } from './store.ts';
import {
  isContentLayer,
  type ContentAssetKey,
  type ContentEditInput,
  type ContentLayer,
  type ContentLayerRow,
  type ContentStore,
  type NewContentInput,
} from './store.ts';

// ── epoch-seconds ⇄ timestamptz helpers (the fakes speak epoch seconds; the DB speaks timestamptz) ──
function toEpoch(v: unknown): number {
  const d = v instanceof Date ? v : new Date(String(v));
  return Math.floor(d.getTime() / 1000);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// 1. dynamic_field_values (schema §5) — the operator-editable key→value store
// ══════════════════════════════════════════════════════════════════════════════════════════════════

function toDynRow(r: Record<string, unknown>): DynamicFieldValue {
  return {
    field_name: String(r.field_name),
    field_value: r.field_value == null ? null : String(r.field_value),
    last_updated: toEpoch(r.last_updated),
  };
}

export class SupabaseDynamicFieldStore implements DynamicFieldStore {
  private pool: pg.Pool;
  constructor(connectionString: string) {
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
  }

  async read(field_name: string): Promise<DynamicFieldValue | null> {
    const res = await this.pool.query(
      `select field_name, field_value, last_updated from dynamic_field_values where field_name = $1`,
      [field_name],
    );
    return res.rowCount === 0 ? null : toDynRow(res.rows[0]!);
  }

  async set(field_name: string, field_value: string | null, now: number): Promise<DynamicFieldValue> {
    if (field_name == null || field_name.trim() === '') {
      throw new Error('dynamic_field_values.field_name must be non-empty (primary key)');
    }
    // Upsert on the primary key; ALWAYS re-stamp last_updated so freshness surfacing stays truthful (#3).
    const res = await this.pool.query(
      `insert into dynamic_field_values (field_name, field_value, last_updated)
       values ($1, $2, to_timestamp($3))
       on conflict (field_name) do update
         set field_value = excluded.field_value, last_updated = excluded.last_updated
       returning field_name, field_value, last_updated`,
      [field_name, field_value, now],
    );
    return toDynRow(res.rows[0]!);
  }

  async all(): Promise<DynamicFieldValue[]> {
    const res = await this.pool.query(
      `select field_name, field_value, last_updated from dynamic_field_values order by field_name asc`,
    );
    return res.rows.map(toDynRow);
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// 2. prompt_layers (schema §5) — business + task_template CONTENT with version discipline
// ══════════════════════════════════════════════════════════════════════════════════════════════════

const SELECT_COLS =
  'id, layer, name, content, agent_id, enabled, version, previous_version_id, change_reason, created_at, created_by';

function toContentRow(r: Record<string, unknown>): ContentLayerRow {
  const layer = String(r.layer);
  if (!isContentLayer(layer)) {
    throw new Error(`prompt_layers row is layer='${layer}', not a content layer this slice owns (business|task_template)`);
  }
  return {
    id: String(r.id),
    layer: layer as ContentLayer,
    name: String(r.name),
    content: String(r.content),
    agent_id: null, // business/task_template are deployment-shared (agent_id is null for these kinds)
    enabled: Boolean(r.enabled),
    version: Number(r.version),
    previous_version_id: r.previous_version_id == null ? null : String(r.previous_version_id),
    change_reason: String(r.change_reason),
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    created_by: r.created_by == null ? null : String(r.created_by),
  };
}

export class SupabaseContentStore implements ContentStore {
  private pool: pg.Pool;
  constructor(connectionString: string) {
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
  }

  async createContent(input: NewContentInput, _now: number): Promise<ContentLayerRow> {
    if (!isContentLayer(input.layer)) {
      throw new Error(`this slice authors only business|task_template content — got '${input.layer}'`);
    }
    if (input.change_reason == null || input.change_reason.trim() === '') {
      throw new Error('change_reason is mandatory and must be non-empty (FR-4.STO.003 / FR-4.TSK.003)');
    }
    // agent_id is null for business/task_template (only 'core' is per-agent; the DB CHECK allows null here).
    const res = await this.pool.query(
      `insert into prompt_layers (layer, name, content, agent_id, enabled, version, previous_version_id, change_reason, created_by)
       values ($1, $2, $3, null, $4, 1, null, $5, $6)
       returning ${SELECT_COLS}`,
      [input.layer, input.name, input.content, input.enabled ?? true, input.change_reason, input.created_by],
    );
    return toContentRow(res.rows[0]!);
  }

  async appendVersion(currentVersionId: string, edit: ContentEditInput, _now: number): Promise<ContentLayerRow> {
    if (edit.change_reason == null || edit.change_reason.trim() === '') {
      throw new Error('change_reason is mandatory and must be non-empty (FR-4.STO.003 / FR-4.TSK.003)');
    }
    // One INSERT…SELECT: read cur, compute the head version in SQL, INSERT the next version atomically
    // (no read-modify-write race). The ISSUE-042 0004 trigger forbids any in-place content UPDATE.
    const res = await this.pool.query(
      `with cur as (select * from prompt_layers where id = $1),
       head as (
         select max(pl.version) as v from prompt_layers pl
         join cur on pl.layer = cur.layer and pl.name = cur.name
           and pl.agent_id is not distinct from cur.agent_id
       )
       insert into prompt_layers (layer, name, content, agent_id, enabled, version, previous_version_id, change_reason, created_by)
       select cur.layer, cur.name, coalesce($2, cur.content), cur.agent_id,
              coalesce($3, cur.enabled), head.v + 1, cur.id, $4, $5
       from cur, head
       where cur.version = head.v
       returning ${SELECT_COLS}`,
      [currentVersionId, edit.content ?? null, edit.enabled ?? null, edit.change_reason, edit.created_by ?? null],
    );
    if (res.rowCount === 0) {
      throw new Error(`stale or unknown edit target ${currentVersionId} — re-read the head before editing (append-only-by-version)`);
    }
    return toContentRow(res.rows[0]!);
  }

  async rollbackTo(priorVersionId: string, change_reason: string, created_by: string | null, _now: number): Promise<ContentLayerRow> {
    if (change_reason == null || change_reason.trim() === '') {
      throw new Error('change_reason is mandatory and must be non-empty (FR-4.STO.004 / FR-4.TSK.003)');
    }
    // Non-destructive: a forward INSERT whose content = the prior version's; history is retained in full.
    const res = await this.pool.query(
      `with prior as (select * from prompt_layers where id = $1),
       head as (
         select max(pl.version) as v, max(pl.id::text) as _ from prompt_layers pl
         join prior on pl.layer = prior.layer and pl.name = prior.name
           and pl.agent_id is not distinct from prior.agent_id
       ),
       headrow as (
         select pl.id from prompt_layers pl
         join prior on pl.layer = prior.layer and pl.name = prior.name
           and pl.agent_id is not distinct from prior.agent_id
         join head on pl.version = head.v
       )
       insert into prompt_layers (layer, name, content, agent_id, enabled, version, previous_version_id, change_reason, created_by)
       select prior.layer, prior.name, prior.content, prior.agent_id, prior.enabled,
              head.v + 1, headrow.id, $2, $3
       from prior, head, headrow
       returning ${SELECT_COLS}`,
      [priorVersionId, change_reason, created_by],
    );
    if (res.rowCount === 0) {
      throw new Error(`no prompt_layers row with id ${priorVersionId} to roll back to`);
    }
    return toContentRow(res.rows[0]!);
  }

  async currentVersion(key: ContentAssetKey): Promise<ContentLayerRow | null> {
    const res = await this.pool.query(
      `select ${SELECT_COLS} from prompt_layers
       where layer = $1 and name = $2 and agent_id is null
       order by version desc limit 1`,
      [key.layer, key.name],
    );
    return res.rowCount === 0 ? null : toContentRow(res.rows[0]!);
  }

  async getVersion(id: string): Promise<ContentLayerRow | null> {
    const res = await this.pool.query(`select ${SELECT_COLS} from prompt_layers where id = $1`, [id]);
    return res.rowCount === 0 ? null : toContentRow(res.rows[0]!);
  }

  async history(key: ContentAssetKey): Promise<ContentLayerRow[]> {
    const res = await this.pool.query(
      `select ${SELECT_COLS} from prompt_layers
       where layer = $1 and name = $2 and agent_id is null
       order by version asc`,
      [key.layer, key.name],
    );
    return res.rows.map(toContentRow);
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}
