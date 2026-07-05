// ISSUE-044 §8 steps 2,4,6,7 — the PORTs + in-memory fakes (the house port+fake pattern, cf.
// app/prompt-store/src/store.ts, app/config-store/src/store.ts). Two live side effects live here:
//   1. DynamicFieldStore — the operator-editable dynamic_field_values key→value store (schema §5). This
//      slice OWNS its declaration + value semantics (the TABLE itself is ISSUE-042's). Reads/writes rows.
//   2. TaskTemplateStore — the version-disciplined content store for layer='business' + layer='task_template'
//      prompt_layers rows. This slice writes CONTENT into the ISSUE-042 store and reuses its
//      version-never-overwrite + mandatory-change_reason + non-destructive-rollback machinery (FR-4.TSK.003
//      inherits FR-4.STO.001/003/004 verbatim). The fake below is the reference model for that discipline
//      as it applies to task_template/business rows; the live pg adapter (supabase-store.ts) is the thin
//      translation to the shared prompt_layers DDL, NOT re-declaring it.
//
// Invariants the TaskTemplate fake enforces exactly as the DB CHECK + the ISSUE-042 0004 version-discipline
// trigger would (belt-and-braces with the live layer):
//   1. A prior version row is NEVER mutated/overwritten — every edit INSERTs a NEW version (FR-4.STO.003).
//   2. `change_reason` is NOT NULL + non-empty — an empty reason is REJECTED (FR-4.STO.003).
//   3. A new version links `previous_version_id` to the row it supersedes and increments `version`.
//   4. rollback is NON-DESTRUCTIVE — it appends a NEW version whose content equals a prior version's; it
//      NEVER deletes/rewrites history (FR-4.STO.004 / change-control.md).
//   5. Only the two content kinds this slice authors are accepted here: 'business' | 'task_template'
//      (a 'core'/'memory' write is out of this slice's remit — ISSUE-043/045).

import type { DynamicFieldValue } from './context.ts';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// 1. DynamicFieldStore — the operator-editable dynamic_field_values store (schema §5)
// ══════════════════════════════════════════════════════════════════════════════════════════════════

export interface DynamicFieldStore {
  /** Read one declared dynamic field's live value + last_updated, or null if the operator never set it. */
  read(field_name: string): Promise<DynamicFieldValue | null>;
  /** Upsert a value the operator edited; stamps last_updated=now (epoch seconds). */
  set(field_name: string, field_value: string | null, now: number): Promise<DynamicFieldValue>;
  /** All rows (for the operator's value-editor view). */
  all(): Promise<DynamicFieldValue[]>;
}

/** In-memory fake — reference model for the operator-editable value store. Deterministic (`now` supplied). */
export class InMemoryDynamicFieldStore implements DynamicFieldStore {
  private readonly rows = new Map<string, DynamicFieldValue>();

  async read(field_name: string): Promise<DynamicFieldValue | null> {
    const r = this.rows.get(field_name);
    return r ? { ...r } : null;
  }

  async set(field_name: string, field_value: string | null, now: number): Promise<DynamicFieldValue> {
    if (field_name == null || field_name.trim() === '') {
      throw new Error('dynamic_field_values.field_name must be non-empty (it is the primary key)');
    }
    // An edit ALWAYS re-stamps last_updated — this is what makes freshness surfacing meaningful. There is
    // no "silent" write that leaves last_updated stale (that would defeat AC-4.BIZ.003.3).
    const row: DynamicFieldValue = { field_name, field_value, last_updated: now };
    this.rows.set(field_name, row);
    return { ...row };
  }

  async all(): Promise<DynamicFieldValue[]> {
    return [...this.rows.values()].map((r) => ({ ...r })).sort((a, b) => a.field_name.localeCompare(b.field_name));
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// 2. TaskTemplateStore — version-disciplined content (business + task_template prompt_layers rows)
// ══════════════════════════════════════════════════════════════════════════════════════════════════

/** The content-layer kinds THIS slice authors on the ISSUE-042 store. */
export type ContentLayer = 'business' | 'task_template';

export function isContentLayer(v: string): v is ContentLayer {
  return v === 'business' || v === 'task_template';
}

/** A prompt_layers row as this slice writes/reads it (schema §5 — the business/task_template subset). */
export interface ContentLayerRow {
  id: string;
  layer: ContentLayer;
  name: string;
  content: string;
  agent_id: null; // business + task_template are deployment-shared, never per-agent (only 'core' is per-agent)
  enabled: boolean;
  version: number;
  previous_version_id: string | null;
  change_reason: string;
  created_at: string;
  created_by: string | null;
}

export interface NewContentInput {
  layer: ContentLayer;
  name: string;
  content: string;
  change_reason: string;
  created_by: string | null;
  enabled?: boolean;
}

export interface ContentEditInput {
  content?: string;
  enabled?: boolean;
  change_reason: string;
  created_by?: string | null;
}

export interface ContentAssetKey {
  layer: ContentLayer;
  name: string;
}

export interface ContentStore {
  createContent(input: NewContentInput, now: number): Promise<ContentLayerRow>;
  /** Append a NEW version (never overwrite). FR-4.STO.003 / FR-4.TSK.003. */
  appendVersion(currentVersionId: string, edit: ContentEditInput, now: number): Promise<ContentLayerRow>;
  /** Non-destructive rollback: append a new version whose content = the target prior version. FR-4.STO.004. */
  rollbackTo(priorVersionId: string, change_reason: string, created_by: string | null, now: number): Promise<ContentLayerRow>;
  currentVersion(key: ContentAssetKey): Promise<ContentLayerRow | null>;
  getVersion(id: string): Promise<ContentLayerRow | null>;
  history(key: ContentAssetKey): Promise<ContentLayerRow[]>;
}

/**
 * In-memory fake — the reference model for task-template/business content version discipline. Rows are
 * append-only: `rows` only ever grows; a prior row is NEVER mutated after insert (mirrors the ISSUE-042
 * 0004 trigger). This proves FR-4.TSK.003 holds for task_template rows offline; the live trigger firing is
 * the Stage-3 checkpoint capstone.
 */
export class InMemoryContentStore implements ContentStore {
  private seq = 0;
  readonly rows: ContentLayerRow[] = [];

  private nextId(): string {
    this.seq += 1;
    return `cl-${String(this.seq).padStart(4, '0')}`;
  }
  private stamp(now: number): string {
    return new Date(now * 1000).toISOString();
  }
  private assertReason(change_reason: string): void {
    if (change_reason == null || change_reason.trim() === '') {
      throw new Error('change_reason is mandatory and must be non-empty (FR-4.STO.003 / FR-4.TSK.003)');
    }
  }
  private assertLayer(layer: string): void {
    if (!isContentLayer(layer)) {
      throw new Error(`this slice authors only 'business' | 'task_template' content — got '${layer}' (core/memory are ISSUE-043/045)`);
    }
  }
  private same(r: ContentLayerRow, key: ContentAssetKey): boolean {
    return r.layer === key.layer && r.name === key.name;
  }
  private headRow(key: ContentAssetKey): ContentLayerRow | null {
    const chain = this.rows.filter((r) => this.same(r, key));
    return chain.length === 0 ? null : chain.reduce((max, r) => (r.version > max.version ? r : max));
  }

  async createContent(input: NewContentInput, now: number): Promise<ContentLayerRow> {
    this.assertReason(input.change_reason);
    this.assertLayer(input.layer);
    const key: ContentAssetKey = { layer: input.layer, name: input.name };
    if (this.rows.some((r) => this.same(r, key))) {
      throw new Error(`content asset (layer=${input.layer}, name=${input.name}) already exists — use appendVersion (never a second v1)`);
    }
    const row: ContentLayerRow = {
      id: this.nextId(),
      layer: input.layer,
      name: input.name,
      content: input.content,
      agent_id: null,
      enabled: input.enabled ?? true,
      version: 1,
      previous_version_id: null,
      change_reason: input.change_reason,
      created_at: this.stamp(now),
      created_by: input.created_by,
    };
    this.rows.push(row);
    return { ...row };
  }

  async appendVersion(currentVersionId: string, edit: ContentEditInput, now: number): Promise<ContentLayerRow> {
    this.assertReason(edit.change_reason);
    const cur = this.rows.find((r) => r.id === currentVersionId);
    if (!cur) throw new Error(`no content row with id ${currentVersionId}`);
    const key: ContentAssetKey = { layer: cur.layer, name: cur.name };
    const head = this.headRow(key)!;
    if (head.id !== cur.id) {
      throw new Error(`stale edit: ${currentVersionId} is v${cur.version} but the head is v${head.version} (${head.id}) — re-read the head before editing (append-only-by-version)`);
    }
    const next: ContentLayerRow = {
      id: this.nextId(),
      layer: cur.layer,
      name: cur.name,
      content: edit.content ?? cur.content,
      agent_id: null,
      enabled: edit.enabled ?? cur.enabled,
      version: cur.version + 1,
      previous_version_id: cur.id,
      change_reason: edit.change_reason,
      created_at: this.stamp(now),
      created_by: edit.created_by ?? null,
    };
    this.rows.push(next); // prior row untouched (append-only)
    return { ...next };
  }

  async rollbackTo(priorVersionId: string, change_reason: string, created_by: string | null, now: number): Promise<ContentLayerRow> {
    this.assertReason(change_reason);
    const prior = this.rows.find((r) => r.id === priorVersionId);
    if (!prior) throw new Error(`no content row with id ${priorVersionId} to roll back to`);
    const key: ContentAssetKey = { layer: prior.layer, name: prior.name };
    const head = this.headRow(key)!;
    // Non-destructive: rollback is a FORWARD append whose content = the prior version. History is retained
    // in full — the row we roll back FROM is never deleted (FR-4.STO.004 / change-control.md).
    const next: ContentLayerRow = {
      id: this.nextId(),
      layer: prior.layer,
      name: prior.name,
      content: prior.content,
      agent_id: null,
      enabled: prior.enabled,
      version: head.version + 1,
      previous_version_id: head.id,
      change_reason,
      created_at: this.stamp(now),
      created_by,
    };
    this.rows.push(next);
    return { ...next };
  }

  async currentVersion(key: ContentAssetKey): Promise<ContentLayerRow | null> {
    const head = this.headRow(key);
    return head ? { ...head } : null;
  }

  async getVersion(id: string): Promise<ContentLayerRow | null> {
    const r = this.rows.find((x) => x.id === id);
    return r ? { ...r } : null;
  }

  async history(key: ContentAssetKey): Promise<ContentLayerRow[]> {
    return this.rows.filter((r) => this.same(r, key)).sort((a, b) => a.version - b.version).map((r) => ({ ...r }));
  }
}
