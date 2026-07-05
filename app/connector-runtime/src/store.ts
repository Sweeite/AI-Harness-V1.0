// ISSUE-032 §8 — the ConnectorRuntimeStore PORT + the in-memory fake reference model.
//
// Every live side effect of the C3 spine — reading/registering/versioning `tools`, reading the
// `connector_credentials` shell, reading the `rate_limit_tracker` shell, and the `idempotency_ledger`
// pre-call-intent + retry-suppression — goes through this port, so the runtime (runtime.ts) stays
// unit-testable with NO live DB (the house port+fake pattern — cf. app/webhook-auth/src/store.ts,
// app/config-store/src/store.ts). The in-memory fake below is the test double AND the reference model:
// it enforces every invariant the DB (migration 0007) enforces, exactly as the CHECK/trigger would.
//
// Faithful to the DDL in results/proposed-migration-0007_connector_runtime.sql (schema.md §4 + §Types).
// Invariants enforced in the fake exactly as the DB trigger would (see the 0007 triggers):
//   1. tools is APPEND-ONLY-BY-VERSION: an edit inserts a NEW row (version+1, previous_version_id set,
//      non-empty change_reason); the identity/contract columns of a prior version are never mutated;
//      DELETE is forbidden (retire via enabled=false). — FR-3.REG.003 / schema §"Global rules".
//   2. Registry completeness (FR-3.REG.001): a row missing any required contract field — incl. an
//      empty description — is NOT registrable. There is no "partially defined" tool (FR-3.CONN.001).
//   3. idempotency_ledger: the pre-call intent record is committed BEFORE the external call, keyed on
//      the deterministic idempotency_key; a retry with the same key is suppressed (returns the prior
//      result / intent) and never re-fires. `result` is write-once. — FR-3.CONN.004 / AC-3.CONN.004.4.
//   4. NO client_slug on any C3 table (REG.004 / schema §"Global rules"): the fake stores no such field
//      and exposes a reconciliation check the CI lint mirrors.

// ── Enums (schema.md §Types L109-110) ────────────────────────────────────────────────
export type ToolCategory = 'read' | 'write';
export type CredentialState = 'active' | 'degraded' | 'revoked' | 'expired';

export const TOOL_CATEGORIES: readonly ToolCategory[] = ['read', 'write'] as const;
export const CREDENTIAL_STATES: readonly CredentialState[] = ['active', 'degraded', 'revoked', 'expired'] as const;

// ── tools (schema.md §4 L390-406) ────────────────────────────────────────────────────
export interface ToolRow {
  id: string;
  name: string;
  description: string; // non-empty — drives AI selection (FR-3.REG.002)
  category: ToolCategory;
  risk_level: string | null;
  requires_approval: boolean;
  connector: string;
  scopes: string[] | null;
  config: Record<string, unknown>;
  enabled: boolean;
  version: number;
  previous_version_id: string | null;
  change_reason: string; // non-empty (FR-3.REG.003)
  created_at: string;
  updated_at: string;
}

/** The full contract shape a caller must supply to register a tool (FR-3.CONN.001 required fields).
 *  Everything here is mandatory except the nullable domain columns (risk_level, scopes). A missing /
 *  empty required field makes the tool unregistrable (FR-3.REG.001). */
export interface ToolContract {
  name: string;
  description: string;
  category: ToolCategory;
  risk_level: string | null;
  requires_approval: boolean;
  connector: string;
  scopes: string[] | null;
  config: Record<string, unknown>;
  change_reason: string;
}

/** A tool edit — supplies the new contract fields + the mandatory reason. `enabled` is a separate
 *  in-place flip (retireTool/enableTool), never carried on a version edit. */
export type ToolEdit = Omit<ToolContract, never>;

// ── connector_credentials (schema.md §4 L408-418) — SHELL the runtime reads ────────────
export interface CredentialRow {
  id: string;
  connector: string;
  access_token: string; // Vault-encrypted at rest; never logged (#2)
  refresh_token: string | null;
  expires_at: string | null;
  scopes: string[] | null;
  state: CredentialState;
  created_at: string;
  updated_at: string;
}

// ── rate_limit_tracker (schema.md §4 L420-431) — SHELL the runtime composes over ────────
export interface RateWindowRow {
  id: string;
  connector: string;
  window_label: string;
  window_start: string;
  window_duration: string; // interval as text
  call_limit: number;
  calls_made: number;
  reset_at: string;
  updated_at: string;
}

// ── idempotency_ledger (schema.md §4 L433-438) — net-new (FR-3.CONN.004) ────────────────
export interface LedgerRow {
  idempotency_key: string;
  connector: string;
  result: unknown | null; // NULL = intent recorded, outcome not yet known
  created_at: string;
}

/** The outcome of committing a pre-call intent (FR-3.CONN.004 / AC-3.CONN.004.4). */
export type IntentOutcome =
  | { kind: 'fresh' } // no prior key — the external call MAY proceed
  | { kind: 'suppressed'; result: unknown | null }; // key already seen — DO NOT re-fire; return prior

// ── The port. Sync in the fake but modelled async for the DB adapter. ──────────────────
export interface ConnectorRuntimeStore {
  // Registry (FR-3.REG.001/003, FR-3.CONN.001)
  registerTool(contract: ToolContract, now: number): Promise<ToolRow>;
  editTool(toolId: string, edit: ToolEdit, now: number): Promise<ToolRow>;
  /** Flip enabled in place (retire/re-enable) — NOT a new version (no knowledge loss). */
  setEnabled(toolId: string, enabled: boolean, now: number): Promise<ToolRow>;
  getTool(toolId: string): Promise<ToolRow | undefined>;
  /** The version chain for a logical tool, oldest→newest (walks previous_version_id). */
  versionChain(toolId: string): Promise<ToolRow[]>;
  /** Tools offered to AI selection: only the current, enabled versions (FR-3.REG.001/002). */
  selectableTools(): Promise<ToolRow[]>;

  // idempotency ledger (FR-3.CONN.004)
  /** Commit the durable pre-call intent BEFORE the external call. Returns whether to proceed or
   *  suppress. Idempotent on idempotency_key (PK). */
  commitIntent(idempotencyKey: string, connector: string, now: number): Promise<IntentOutcome>;
  /** Record the external call's result against an existing intent (write-once). */
  recordResult(idempotencyKey: string, result: unknown): Promise<void>;
  getLedger(idempotencyKey: string): Promise<LedgerRow | undefined>;

  // credentials + rate-limit shells (read-only here; behaviour in 033/034)
  getCredential(connector: string): Promise<CredentialRow | undefined>;

  /** REG.004 reconciliation (AC-3.REG.004.1): the set of client-identity columns present on any C3
   *  table. MUST be empty — isolation is physical (ADR-001/006). */
  clientIdentityColumns(): Promise<string[]>;
}

// ───────────────────────────────────────────────────────────────────────────────────
// In-memory fake — the test double AND the reference model. Deterministic: a logical `now`
// (epoch seconds) is supplied by the caller; no Date.now()/random (house discipline).
// ───────────────────────────────────────────────────────────────────────────────────
export class InMemoryConnectorRuntimeStore implements ConnectorRuntimeStore {
  private seq = 0;
  readonly tools: ToolRow[] = [];
  readonly ledger = new Map<string, LedgerRow>();
  readonly credentials: CredentialRow[] = [];
  readonly rateWindows: RateWindowRow[] = [];

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(4, '0')}`;
  }
  private stamp(now: number): string {
    return new Date(now * 1000).toISOString();
  }

  // ── contract-completeness validation (FR-3.REG.001 / AC-3.REG.001.1 / AC-3.CONN.001.1) ──
  // Mirrors the DB trigger + the tool_category enum + NOT NULL constraints. Rejects a partial tool.
  private validateContract(c: ToolContract): void {
    const missing: string[] = [];
    if (!c.name || c.name.trim() === '') missing.push('name');
    if (!c.description || c.description.trim() === '') missing.push('description');
    if (!c.connector || c.connector.trim() === '') missing.push('connector');
    if (!c.change_reason || c.change_reason.trim() === '') missing.push('change_reason');
    if (missing.length > 0) {
      throw new Error(
        `tools: partially-defined tool rejected — missing/empty required field(s): ${missing.join(', ')} (FR-3.REG.001/003; no partially-defined tool)`,
      );
    }
    if (!TOOL_CATEGORIES.includes(c.category)) {
      throw new Error(`tools: category '${String(c.category)}' out of domain {read,write} (tool_category enum)`);
    }
    if (typeof c.requires_approval !== 'boolean') {
      throw new Error('tools: requires_approval must be a boolean (NOT NULL default false)');
    }
    if (c.config === null || typeof c.config !== 'object' || Array.isArray(c.config)) {
      throw new Error('tools: config must be a jsonb object (NOT NULL default {})');
    }
  }

  async registerTool(contract: ToolContract, now: number): Promise<ToolRow> {
    this.validateContract(contract);
    const ts = this.stamp(now);
    const row: ToolRow = {
      id: this.nextId('tool'),
      name: contract.name,
      description: contract.description,
      category: contract.category,
      risk_level: contract.risk_level,
      requires_approval: contract.requires_approval,
      connector: contract.connector,
      scopes: contract.scopes,
      config: contract.config,
      enabled: true,
      version: 1,
      previous_version_id: null,
      change_reason: contract.change_reason,
      created_at: ts,
      updated_at: ts,
    };
    this.tools.push(row);
    return row;
  }

  async editTool(toolId: string, edit: ToolEdit, now: number): Promise<ToolRow> {
    const current = await this.currentVersionOf(toolId);
    if (!current) throw new Error(`tools: cannot edit ${toolId}: no such tool`);
    this.validateContract(edit);
    // Append-only-by-version: a NEW row, higher version, linking the predecessor. The prior row is
    // NEVER mutated (its enabled flips off so only the newest version is selectable).
    const ts = this.stamp(now);
    const newRow: ToolRow = {
      id: this.nextId('tool'),
      name: edit.name,
      description: edit.description,
      category: edit.category,
      risk_level: edit.risk_level,
      requires_approval: edit.requires_approval,
      connector: edit.connector,
      scopes: edit.scopes,
      config: edit.config,
      enabled: current.enabled, // inherit the current enabled state
      version: current.version + 1,
      previous_version_id: current.id,
      change_reason: edit.change_reason,
      created_at: ts,
      updated_at: ts,
    };
    current.enabled = false; // supersede: the old version is no longer the selectable head
    current.updated_at = ts;
    this.tools.push(newRow);
    return newRow;
  }

  async setEnabled(toolId: string, enabled: boolean, now: number): Promise<ToolRow> {
    const row = this.tools.find((t) => t.id === toolId);
    if (!row) throw new Error(`tools: cannot set enabled on ${toolId}: no such tool`);
    // In-place flip only — NOT a new version (retire/re-enable is not a knowledge-losing edit).
    row.enabled = enabled;
    row.updated_at = this.stamp(now);
    return row;
  }

  async getTool(toolId: string): Promise<ToolRow | undefined> {
    return this.tools.find((t) => t.id === toolId);
  }

  /** The head (newest) version reachable from any row in a tool's chain. */
  private async currentVersionOf(toolId: string): Promise<ToolRow | undefined> {
    const start = this.tools.find((t) => t.id === toolId);
    if (!start) return undefined;
    // Walk forward: find the row whose previous_version_id === current.id, repeat.
    let head = start;
    for (;;) {
      const next = this.tools.find((t) => t.previous_version_id === head.id);
      if (!next) return head;
      head = next;
    }
  }

  async versionChain(toolId: string): Promise<ToolRow[]> {
    const start = this.tools.find((t) => t.id === toolId);
    if (!start) return [];
    // Walk back to the root (version 1), then forward collecting the whole chain.
    let root = start;
    while (root.previous_version_id) {
      const prev = this.tools.find((t) => t.id === root.previous_version_id);
      if (!prev) break;
      root = prev;
    }
    const chain: ToolRow[] = [root];
    for (;;) {
      const last = chain[chain.length - 1]!;
      const next = this.tools.find((t) => t.previous_version_id === last.id);
      if (!next) break;
      chain.push(next);
    }
    return chain;
  }

  async selectableTools(): Promise<ToolRow[]> {
    // Only current, enabled versions — a superseded version (enabled=false) or a retired one is not
    // offered to the AI (FR-3.REG.001 AC.2 / FR-3.REG.002).
    return this.tools.filter((t) => t.enabled);
  }

  // ── idempotency ledger (FR-3.CONN.004) ──
  async commitIntent(idempotencyKey: string, connector: string, now: number): Promise<IntentOutcome> {
    if (!idempotencyKey || idempotencyKey.trim() === '') {
      throw new Error('idempotency_ledger: idempotency_key must be non-empty (deterministic per write)');
    }
    const existing = this.ledger.get(idempotencyKey);
    if (existing) {
      // The key was already committed (intent or completed). Suppress the second external effect and
      // return the prior result — even if result is still NULL (crash-after-call: intent alone
      // suppresses — AC-3.CONN.004.4). PK collision = the retry-suppression signal.
      return { kind: 'suppressed', result: existing.result };
    }
    // Durable pre-call intent: committed BEFORE the external call, result NULL until it completes.
    this.ledger.set(idempotencyKey, {
      idempotency_key: idempotencyKey,
      connector,
      result: null,
      created_at: this.stamp(now),
    });
    return { kind: 'fresh' };
  }

  async recordResult(idempotencyKey: string, result: unknown): Promise<void> {
    const row = this.ledger.get(idempotencyKey);
    if (!row) throw new Error(`idempotency_ledger: no intent for key ${idempotencyKey} (intent must be committed first)`);
    if (row.result !== null) {
      throw new Error('idempotency_ledger: result is write-once — a completed outcome cannot be rewritten');
    }
    row.result = result;
  }

  async getLedger(idempotencyKey: string): Promise<LedgerRow | undefined> {
    return this.ledger.get(idempotencyKey);
  }

  // ── credential shell (read-only here) ──
  seedCredential(row: Omit<CredentialRow, 'id' | 'created_at' | 'updated_at'>, now: number): CredentialRow {
    const ts = this.stamp(now);
    const full: CredentialRow = { id: this.nextId('cred'), created_at: ts, updated_at: ts, ...row };
    this.credentials.push(full);
    return full;
  }
  async getCredential(connector: string): Promise<CredentialRow | undefined> {
    return this.credentials.find((c) => c.connector === connector);
  }

  async clientIdentityColumns(): Promise<string[]> {
    // The fake models the four C3 tables. NONE carries client_slug (or any client-identity column) —
    // isolation is physical (ADR-001/006). This is the reconciliation the CI lint mirrors (AC-3.REG.004.1).
    return [];
  }
}
