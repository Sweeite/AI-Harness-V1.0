// ISSUE-043 — the CorePromptStore PORT + the in-memory fake (the house port+fake pattern, cf.
// app/prompt-store/src/store.ts, app/webhook-auth/src/store.ts). This slice writes/validates `core`
// (Layer-1) records INTO the prompt_layers store ISSUE-042 built. It does NOT re-build the version
// discipline of that store; it re-declares the minimal slice of the port it consumes (read the current
// core for an agent; append a new core version) so the identity/principles validators are unit-testable
// with NO live DB and NO cross-package build dependency (fan-out isolation — each package builds alone).
//
// Faithful to schema.md §5 `prompt_layers` (id, layer, name, content, agent_id, enabled, version,
// previous_version_id, change_reason NOT NULL, created_at, created_by; the `layer='core' ⇒ agent_id`
// check; NO client_slug — OD-096 / FR-10.ISO.001) and the §"Global rules" append-only-by-version rule.
//
// Invariants the fake enforces exactly as the DB check + the 0004 version-discipline trigger would (the
// same invariants ISSUE-042's InMemoryPromptStore enforces — this slice depends on, does not weaken them):
//   1. A prior version row is NEVER mutated (append-only-by-version). An edit ALWAYS inserts a NEW row.
//   2. `change_reason` is NOT NULL and non-empty — an empty reason is REJECTED (FR-4.STO.003 / DB CHECK).
//   3. `layer='core' ⇒ agent_id not null` (schema §5 check / FR-4.LYR.002).
//   4. A new version links `previous_version_id` and increments `version`.
//   5. NO client_slug column exists on the row (AC-4.STO.001.1 / OD-096).

/** The four fixed prompt layer kinds — schema.md §5 `prompt_layer_kind` enum, exactly. */
export type LayerKind = 'core' | 'business' | 'memory' | 'task_template';

/** A `prompt_layers` row — schema.md §5, exactly (NO client_slug). */
export interface PromptLayer {
  id: string;
  layer: LayerKind;
  name: string;
  content: string;
  agent_id: string | null; // non-null when layer='core' — schema §5 check / FR-4.LYR.002
  enabled: boolean;
  version: number;
  previous_version_id: string | null;
  change_reason: string; // NOT NULL + non-empty — FR-4.STO.003
  created_at: string;
  created_by: string | null;
}

/** Fields to create version 1 of a NEW `core` asset. */
export interface NewCoreInput {
  name: string;
  content: string;
  agent_id: string; // core is per-agent: a non-null agent_id is REQUIRED here (FR-4.LYR.002)
  change_reason: string;
  created_by: string | null;
  enabled?: boolean;
}

/** Fields to append a NEW `core` version (never an in-place update). */
export interface CoreEditInput {
  content: string;
  change_reason: string;
  enabled?: boolean;
  created_by?: string | null;
}

/**
 * The slice of the ISSUE-042 prompt_layers port this content slice consumes. Sync in the fake; modelled
 * async so the live pg adapter (supabase-store.ts) implements the same shape.
 */
export interface CorePromptStore {
  /** Insert version 1 of a NEW `core` asset. Rejects empty change_reason. FR-4.STO.001/003 / FR-4.LYR.002. */
  createCore(input: NewCoreInput, now: number): Promise<PromptLayer>;

  /** Append a NEW version of the `core` asset headed by `currentVersionId` (never overwrite). FR-4.STO.003. */
  appendCoreVersion(currentVersionId: string, edit: CoreEditInput, now: number): Promise<PromptLayer>;

  /** A single version row by id (any version, current or historical). */
  getVersion(id: string): Promise<PromptLayer | null>;

  /** The current (head) `core` version for an agent — the ONLY Layer-1 read path (FR-4.STO.002). */
  currentCoreForAgent(agent_id: string): Promise<PromptLayer | null>;

  /** Every agent that has a `core` record — the set the principles edit must propagate across. */
  agentsWithCore(): Promise<string[]>;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// In-memory fake — the test double AND the reference model. Deterministic: a logical `now` (epoch
// seconds) is supplied by the caller; no Date.now()/random (house discipline). Rows are append-only.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
export class InMemoryCorePromptStore implements CorePromptStore {
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
    if (change_reason == null || change_reason.trim() === '') {
      throw new Error('change_reason is mandatory and must be non-empty (FR-4.STO.003)');
    }
  }

  private headCore(agent_id: string): PromptLayer | null {
    const chain = this.rows.filter((r) => r.layer === 'core' && r.agent_id === agent_id);
    if (chain.length === 0) return null;
    return chain.reduce((max, r) => (r.version > max.version ? r : max));
  }

  async createCore(input: NewCoreInput, now: number): Promise<PromptLayer> {
    this.assertReason(input.change_reason);
    if (input.agent_id == null) {
      throw new Error("layer='core' requires a non-null agent_id (schema §5 check / FR-4.LYR.002)");
    }
    if (this.headCore(input.agent_id)) {
      throw new Error(`agent ${input.agent_id} already has a core record — use appendCoreVersion to edit it`);
    }
    const row: PromptLayer = {
      id: this.nextId(),
      layer: 'core',
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

  async appendCoreVersion(currentVersionId: string, edit: CoreEditInput, now: number): Promise<PromptLayer> {
    this.assertReason(edit.change_reason);
    const cur = this.rows.find((r) => r.id === currentVersionId);
    if (!cur) throw new Error(`no prompt_layers row with id ${currentVersionId}`);
    if (cur.layer !== 'core' || cur.agent_id == null) {
      throw new Error(`row ${currentVersionId} is not a core record — this slice only edits Layer-1 core records`);
    }
    const head = this.headCore(cur.agent_id)!;
    if (head.id !== cur.id) {
      throw new Error(`stale edit: ${currentVersionId} is v${cur.version} but the head is ${head.id} (v${head.version}) — re-read the head first (append-only-by-version)`);
    }
    const next: PromptLayer = {
      id: this.nextId(),
      layer: 'core',
      name: cur.name,
      content: edit.content,
      agent_id: cur.agent_id,
      enabled: edit.enabled ?? cur.enabled,
      version: cur.version + 1,
      previous_version_id: cur.id,
      change_reason: edit.change_reason,
      created_at: this.stamp(now),
      created_by: edit.created_by ?? null,
    };
    this.rows.push(next); // prior row untouched — append-only
    return { ...next };
  }

  async getVersion(id: string): Promise<PromptLayer | null> {
    const r = this.rows.find((x) => x.id === id);
    return r ? { ...r } : null;
  }

  async currentCoreForAgent(agent_id: string): Promise<PromptLayer | null> {
    const head = this.headCore(agent_id);
    return head ? { ...head } : null;
  }

  async agentsWithCore(): Promise<string[]> {
    const set = new Set<string>();
    for (const r of this.rows) if (r.layer === 'core' && r.agent_id != null) set.add(r.agent_id);
    return [...set];
  }
}
