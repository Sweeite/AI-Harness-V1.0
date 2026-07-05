// ISSUE-042 §8 steps 2-4,7 — the PromptStore PORT + the in-memory fake (the house port+fake pattern,
// cf. app/webhook-auth/src/store.ts, app/release/src/store.ts). Every live side effect of the prompt
// store — reading a layer, reading its version history, appending a new version, rolling back — goes
// through this port so the version-discipline logic is unit-testable with NO live DB. The in-memory fake
// is the test double AND the reference model; the live pg adapter (supabase-store.ts) is the thin
// translation authored to the DDL, not run here (the live proof is the Stage-2 capstone).
//
// Faithful to schema.md §5 `prompt_layers` (id, layer, name, content, agent_id, enabled, version,
// previous_version_id, change_reason NOT NULL, created_at, created_by; the `layer='core' ⇒ agent_id`
// check; NO client_slug — OD-096 / FR-10.ISO.001) and the §"Global rules" append-only-by-version rule.
//
// Invariants the fake enforces exactly as the DB check + the 0004 version-discipline trigger would:
//   1. A prior version row is NEVER mutated/overwritten (append-only-by-version — schema §"Global rules"
//      / FR-4.STO.003). An edit ALWAYS inserts a NEW row.
//   2. `change_reason` is NOT NULL and non-empty — an empty reason is REJECTED (FR-4.STO.003 / DB CHECK).
//   3. `layer='core' ⇒ agent_id not null` (schema §5 check / FR-4.LYR.002).
//   4. A new version links `previous_version_id` to the row it supersedes and increments `version`.
//   5. NO client_slug column exists on the row (AC-4.STO.001.1 / OD-096).

import { isLayerKind, type LayerKind } from './layers.js';

// ── prompt_layers row — schema.md §5, exactly (NO client_slug) ───────────────────────────────────
export interface PromptLayer {
  id: string;
  layer: LayerKind;
  name: string;
  content: string;
  agent_id: string | null; // required (non-null) when layer='core' — schema §5 check / FR-4.LYR.002
  enabled: boolean;
  version: number;
  previous_version_id: string | null; // self-FK → the row this version supersedes
  change_reason: string; // NOT NULL + non-empty (mandatory) — FR-4.STO.003
  created_at: string;
  created_by: string | null; // → profiles(id)
}

/** A logical prompt asset is the version chain sharing (layer, name, agent_id). This is its identity. */
export interface AssetKey {
  layer: LayerKind;
  name: string;
  agent_id: string | null;
}

/** Fields a caller supplies to create the FIRST version of a new asset. */
export interface NewLayerInput {
  layer: LayerKind;
  name: string;
  content: string;
  agent_id: string | null;
  change_reason: string;
  created_by: string | null;
  enabled?: boolean;
}

/** Fields a caller supplies to append a NEW version of an existing asset (never an in-place update). */
export interface EditInput {
  content?: string;
  enabled?: boolean;
  change_reason: string;
  /** Who authored this version. Optional here; the PromptService fills it from the acting user. */
  created_by?: string | null;
}

// ── The port. Sync in the fake; modelled async for the DB adapter. ───────────────────────────────
export interface PromptStore {
  /** Insert version 1 of a NEW asset. Rejects empty change_reason + core-without-agent_id. FR-4.STO.001/003. */
  createLayer(input: NewLayerInput, now: number): Promise<PromptLayer>;

  /** Append a NEW version of the asset headed by `currentVersionId` (never overwrite). FR-4.STO.003. */
  appendVersion(currentVersionId: string, edit: EditInput, now: number): Promise<PromptLayer>;

  /** The current (head) version of an asset — the highest `version` in its chain. */
  currentVersion(key: AssetKey): Promise<PromptLayer | null>;

  /** A single version row by id (any version, current or historical). */
  getVersion(id: string): Promise<PromptLayer | null>;

  /** The full version history of an asset, oldest → newest (FR-4.STO.004; gate = PERM.viewHistory). */
  history(key: AssetKey): Promise<PromptLayer[]>;

  /** The current `core` layer for an agent — the ONLY Layer-1 read path (FR-4.STO.002 / AC-4.STO.002.1). */
  currentCoreForAgent(agent_id: string): Promise<PromptLayer | null>;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// In-memory fake — the test double AND the reference model. Deterministic: a logical `now` (epoch
// seconds) is supplied by the caller; no Date.now()/random (house discipline — testable, resumable).
// Rows are append-only: `rows` only ever grows; a prior row is never mutated after insert.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
export class InMemoryPromptStore implements PromptStore {
  private seq = 0;
  readonly rows: PromptLayer[] = [];

  private nextId(): string {
    this.seq += 1;
    return `pl-${String(this.seq).padStart(4, '0')}`;
  }
  private stamp(now: number): string {
    return new Date(now * 1000).toISOString();
  }

  private assertReason(change_reason: string): void {
    // FR-4.STO.003 / AC-4.STO.003.2 — an empty (or whitespace-only) change_reason is rejected. Mirrors
    // the DB `change_reason text not null` + the 0004 trigger's non-empty guard.
    if (change_reason == null || change_reason.trim() === '') {
      throw new Error('change_reason is mandatory and must be non-empty (FR-4.STO.003 / AC-4.STO.003.2)');
    }
  }

  private assertLayer(layer: LayerKind, agent_id: string | null): void {
    if (!isLayerKind(layer)) {
      // AC-4.LYR.001.2 — only the four kinds are accepted.
      throw new Error(`invalid layer kind '${layer}' — must be one of core|business|memory|task_template (AC-4.LYR.001.2)`);
    }
    if (layer === 'core' && agent_id == null) {
      // schema §5 check / FR-4.LYR.002 — a core record is per-agent.
      throw new Error("layer='core' requires a non-null agent_id (schema §5 check / FR-4.LYR.002)");
    }
  }

  private sameAsset(r: PromptLayer, key: AssetKey): boolean {
    return r.layer === key.layer && r.name === key.name && r.agent_id === key.agent_id;
  }

  async createLayer(input: NewLayerInput, now: number): Promise<PromptLayer> {
    this.assertReason(input.change_reason);
    this.assertLayer(input.layer, input.agent_id);
    const key: AssetKey = { layer: input.layer, name: input.name, agent_id: input.agent_id };
    if (this.rows.some((r) => this.sameAsset(r, key))) {
      throw new Error(
        `asset (layer=${input.layer}, name=${input.name}, agent_id=${input.agent_id}) already exists — use appendVersion to edit it (never a second v1)`,
      );
    }
    const row: PromptLayer = {
      id: this.nextId(),
      layer: input.layer,
      name: input.name,
      content: input.content,
      agent_id: input.agent_id,
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

  async appendVersion(currentVersionId: string, edit: EditInput, now: number): Promise<PromptLayer> {
    this.assertReason(edit.change_reason);
    const cur = this.rows.find((r) => r.id === currentVersionId);
    if (!cur) throw new Error(`no prompt_layers row with id ${currentVersionId}`);
    const key: AssetKey = { layer: cur.layer, name: cur.name, agent_id: cur.agent_id };
    const head = this.headRow(key)!;
    // Append-only-by-version: the caller must be editing the CURRENT head — a stale head is a lost update.
    if (head.id !== cur.id) {
      throw new Error(
        `stale edit: ${currentVersionId} is v${cur.version} but the head is v${head.id === cur.id ? cur.version : head.version} (${head.id}) — re-read the head before editing (append-only-by-version)`,
      );
    }
    const next: PromptLayer = {
      id: this.nextId(),
      layer: cur.layer,
      name: cur.name,
      // an edit may change content and/or enabled; unspecified fields carry forward from the prior version.
      content: edit.content ?? cur.content,
      agent_id: cur.agent_id,
      enabled: edit.enabled ?? cur.enabled,
      version: cur.version + 1,
      previous_version_id: cur.id, // link the chain — FR-4.STO.003
      change_reason: edit.change_reason,
      created_at: this.stamp(now),
      created_by: edit.created_by ?? null,
    };
    // The prior row is NOT touched (append-only). We only push a new one.
    this.rows.push(next);
    return { ...next };
  }

  private headRow(key: AssetKey): PromptLayer | null {
    const chain = this.rows.filter((r) => this.sameAsset(r, key));
    if (chain.length === 0) return null;
    return chain.reduce((max, r) => (r.version > max.version ? r : max));
  }

  async currentVersion(key: AssetKey): Promise<PromptLayer | null> {
    const head = this.headRow(key);
    return head ? { ...head } : null;
  }

  async getVersion(id: string): Promise<PromptLayer | null> {
    const r = this.rows.find((x) => x.id === id);
    return r ? { ...r } : null;
  }

  async history(key: AssetKey): Promise<PromptLayer[]> {
    return this.rows
      .filter((r) => this.sameAsset(r, key))
      .sort((a, b) => a.version - b.version)
      .map((r) => ({ ...r }));
  }

  async currentCoreForAgent(agent_id: string): Promise<PromptLayer | null> {
    // FR-4.STO.002 / AC-4.STO.002.1 — Layer 1 reads resolve ONLY from prompt_layers layer='core'. There is
    // no agents.system_prompt read path anywhere in this store (the single-source-of-truth guard).
    const cores = this.rows.filter((r) => r.layer === 'core' && r.agent_id === agent_id);
    if (cores.length === 0) return null;
    const head = cores.reduce((max, r) => (r.version > max.version ? r : max));
    return { ...head };
  }
}
