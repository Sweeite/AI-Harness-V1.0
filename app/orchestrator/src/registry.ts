// ISSUE-061 (C8 REG) — the `agents` registry PORT + in-memory fake reference model (the house port+fake
// pattern, cf. app/task-queue/src/store.ts, app/prompt-store/src/store.ts). Every live side effect of the
// registry lifecycle goes through this port so the logic is unit-testable with NO live DB. InMemoryAgentRegistry
// is BOTH the test double AND the reference model the live pg adapter (supabase-store.ts) must match against the
// baseline DDL (app/silo/migrations/0001_baseline.sql — the `agents` table). Its shapes/constraints MIRROR the
// real DDL so a test cannot pass offline while the live adapter would throw against the real DDL.
//
// Invariants enforced in the fake EXACTLY as the DB DDL + harness gate would — mapped to the three non-negotiables:
//   FR-8.REG.001 (#2) full typed row schema — every §9 column; NO system_prompt (OD-075), NO model, NO client_slug
//                     (ADR-001 §3); a non-empty `description` (routing signal) is required at write (REG.001.2).
//   FR-8.REG.002 (#1) Layer-1 lives ONLY in prompt_layers keyed by agent_id — the row carries no prompt copy.
//   FR-8.REG.003      add-by-insert: a valid enabled row is a routing candidate with no code change (REG.003.1).
//   FR-8.REG.004 (#1) version discipline — every edit inserts a NEW version (increment `version`, link
//                     previous_version_id), requires a non-empty change_reason (reject empty), prior versions stay
//                     retrievable, never overwritten. Capability edits flagged as authority changes.
//   FR-8.REG.005 (#3) `enabled` gates discovery — disabled rows are retained but never candidates; disabling the
//                     SOLE enabled agent for a domain warns at disable-time (REG.005.3).
//   FR-8.REG.006      idempotent seed of orchestrator + 8 specialists; the positive Comms/Finance seed check
//                     (REG.006.3) — Comms holds no autonomous-send tool, Finance no transaction tool.
//   OD-080       (#2) registry-edit authority split enforced at the store: capability edits
//                     (memory_scope/tools_allowed/enabled) = Super Admin only (PERM-agents.edit_capability);
//                     description/routing tuning = Super Admin + Admin (PERM-agents.edit_description). Default-deny + log.

// ── §Domains (ORC.002 classification / SCO matrix). The eight single-domain specialist areas. ────────
export const AGENT_DOMAINS = [
  'client',
  'campaign',
  'comms',
  'ops',
  'finance',
  'insight',
  'research',
  'memory',
] as const;
export type AgentDomain = (typeof AGENT_DOMAINS)[number];

// ── §9 agents row — the full column set, exactly per schema.md §9 / 0001_baseline.sql. ──────────────
// NO system_prompt (→ prompt_layers, OD-075), NO model (complexity-routed), NO client_slug (ADR-001 §3).
export interface AgentRow {
  id: string;
  name: string; // bare role slug e.g. 'orchestrator' / 'research' (OD-177/OD-096 — no client_slug interpolation)
  description: string; // NOT NULL, non-empty — the routing signal (REG.001.2)
  memory_scope: MemoryScope; // jsonb NOT NULL — least-privilege retrieval filter (SCO matrix)
  tools_allowed: string[]; // uuid[] → tools.id, default {}
  max_tokens: number | null;
  enabled: boolean; // default true — gates routing candidacy
  version: number; // default 1
  previous_version_id: string | null; // self-FK — the version chain
  change_reason: string; // NOT NULL — mandatory on every write
  created_at: string;
  updated_at: string;
  created_by: string | null; // → profiles(id)
}

/** The per-agent memory scope (the SCO matrix value stored as jsonb). ISSUE-063 turns this into an executable
 * retrieval filter; this slice STORES it and seeds the matrix (OD-081 enforcement is owed to 063). */
export interface MemoryScope {
  /** which memory tiers this agent may retrieve from. */
  tiers: MemoryTier[];
  /** whether the entity model is in scope (the orchestrator + most specialists need it). */
  entity_model: boolean;
  /** whether the tool registry is in scope (the orchestrator needs it to plan). */
  tool_registry: boolean;
  /** optional free-form narrowing note (e.g. "brand guides only") — descriptive, enforced in 063. */
  note?: string;
}
export const MEMORY_TIERS = ['semantic', 'episodic', 'procedural', 'entity'] as const;
export type MemoryTier = (typeof MEMORY_TIERS)[number];

/** The fields a caller may supply on insert. Server-owned fields (id/version/timestamps) are derived. */
export interface NewAgent {
  name: string;
  description: string;
  memory_scope: MemoryScope;
  domain: AgentDomain; // the domain this agent serves (routing candidacy key); stored in memory_scope-adjacent index
  tools_allowed?: string[];
  max_tokens?: number | null;
  enabled?: boolean;
  change_reason: string;
  created_by?: string | null;
}

/** A capability edit (memory_scope / tools_allowed / enabled) — the AUTHORITY tier (Super Admin only, OD-080). */
export interface CapabilityEdit {
  memory_scope?: MemoryScope;
  tools_allowed?: string[];
  enabled?: boolean;
  change_reason: string;
}
/** A description/tuning edit — the lower tier (Super Admin + Admin, OD-080). */
export interface DescriptionEdit {
  description?: string;
  max_tokens?: number | null;
  change_reason: string;
}

// ── OD-080 authority split — the two PERM nodes (homed in C1 PERMISSION_NODES.md, Asset Management family). ──
export const PERM_AGENTS_VIEW = 'PERM-agents.view' as const;
export const PERM_AGENTS_EDIT_DESCRIPTION = 'PERM-agents.edit_description' as const;
export const PERM_AGENTS_EDIT_CAPABILITY = 'PERM-agents.edit_capability' as const;
export type AgentsPerm =
  | typeof PERM_AGENTS_VIEW
  | typeof PERM_AGENTS_EDIT_DESCRIPTION
  | typeof PERM_AGENTS_EDIT_CAPABILITY;

/** The harness authorization gate (ISSUE-018). Returns whether the actor holds a node. Default-deny. */
export interface PermChecker {
  holds(actorId: string, node: AgentsPerm): boolean;
}
/** A denial record — written whenever a gated registry edit is refused (OD-080 / #3 never silent). */
export interface DenialLogRow {
  id: string;
  actor_id: string;
  perm_node: AgentsPerm;
  action: string;
  detail: string;
  created_at: string;
}
export interface DenialAuditSink {
  logDenial(row: Omit<DenialLogRow, 'id' | 'created_at'>, now: number): DenialLogRow;
}
export class InMemoryDenialAuditSink implements DenialAuditSink {
  private seq = 0;
  readonly denials: DenialLogRow[] = [];
  logDenial(row: Omit<DenialLogRow, 'id' | 'created_at'>, now: number): DenialLogRow {
    this.seq += 1;
    const full: DenialLogRow = {
      id: `deny-${String(this.seq).padStart(4, '0')}`,
      created_at: new Date(now * 1000).toISOString(),
      ...row,
    };
    this.denials.push(full);
    return full;
  }
}
export class AgentsPermissionDenied extends Error {
  constructor(
    readonly actorId: string,
    readonly node: AgentsPerm,
    readonly action: string,
  ) {
    super(`denied: actor ${actorId} lacks ${node} for ${action} (default-deny; logged) — OD-080`);
    this.name = 'AgentsPermissionDenied';
  }
}

// ── Exact rejection messages — a test asserts the same failure the live gate produces. ──────────────
export const ERR_EMPTY_DESCRIPTION =
  'agents: `description` is required and non-empty — a routing signal (FR-8.REG.001 / AC-8.REG.001.2)';
export const ERR_EMPTY_CHANGE_REASON =
  'agents: `change_reason` is required and non-empty — every write is audited (FR-8.REG.004 / AC-8.REG.004.1)';
export const ERR_EMPTY_MEMORY_SCOPE =
  'agents: `memory_scope` is required (jsonb NOT NULL) — the least-privilege retrieval filter (FR-8.REG.001)';
export const ERR_NO_SUCH_AGENT = (id: string) => `agents: no such agent '${id}'`;
export const ERR_SOLE_AGENT_DISABLE = (domain: AgentDomain) =>
  `agents: refusing to SILENTLY disable the sole enabled agent for domain '${domain}' — warn surfaced (FR-8.REG.005.3)`;

/** A warning surfaced (not thrown) when the sole enabled agent for a domain is disabled (REG.005.3, #3). */
export interface SoleAgentDisableWarning {
  kind: 'sole_agent_disabled';
  domain: AgentDomain;
  agent_id: string;
  agent_name: string;
  message: string;
}

// ── A convention for detecting forbidden seed tools (REG.006.3). The real tool ids are uuids in `tools`;
// the seed asserts by tool CAPABILITY tag. A tool id tagged autonomous-send/transaction must never appear on
// the Comms/Finance rows. In the fake we carry a small capability map; the live adapter joins `tools`. ──
export const CAP_AUTONOMOUS_SEND = 'autonomous_send' as const;
export const CAP_TRANSACTION = 'transaction' as const;
export type ToolCapability = typeof CAP_AUTONOMOUS_SEND | typeof CAP_TRANSACTION | 'read' | 'draft' | 'other';

// ── the port. Sync-shaped for the fake; modelled async for the DB adapter. ──────────────────────────
export interface AgentRegistry {
  /** Insert a NEW agent as version 1. Rejects empty description / empty change_reason / missing memory_scope.
   * (REG.001/003/004) A capability write — requires PERM-agents.edit_capability (OD-080) when a `perms` gate is set. */
  insert(a: NewAgent, actorId: string, now: number): Promise<AgentRow>;

  /** Read the CURRENT (latest-version) row for an agent id. */
  get(id: string): Promise<AgentRow | null>;

  /** The enabled routing candidates (REG.003/005). Optionally narrowed to a domain (ORC.003). Disabled rows
   * are NEVER returned — but they persist (get/history still resolve them). */
  candidates(domain?: AgentDomain): Promise<AgentRow[]>;

  /** The full version history for an agent (REG.004.2). Prior versions are always retrievable. */
  history(rootId: string): Promise<AgentRow[]>;

  /** A capability edit (memory_scope/tools_allowed/enabled) — Super Admin only (OD-080). Inserts a new version. */
  editCapability(id: string, edit: CapabilityEdit, actorId: string, now: number): Promise<AgentRow>;

  /** A description/tuning edit — Super Admin + Admin (OD-080). Inserts a new version. */
  editDescription(id: string, edit: DescriptionEdit, actorId: string, now: number): Promise<AgentRow>;

  /** Disable an agent (a capability edit). If it is the SOLE enabled agent for its domain, RETURNS a warning
   * alongside the row (never a silent disable) — REG.005.3 / #3. Super Admin only (OD-080). */
  disable(
    id: string,
    change_reason: string,
    actorId: string,
    now: number,
  ): Promise<{ row: AgentRow; warning: SoleAgentDisableWarning | null }>;
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// In-memory fake — the reference model. Deterministic: a logical `now` (epoch seconds) is caller-supplied;
// no Date.now()/random (house discipline). The version chain is append-only: an edit never mutates the prior
// row in place — it inserts a new row linked by previous_version_id (FR-8.REG.004 / #1). There is deliberately
// NO delete/overwrite method.
// ───────────────────────────────────────────────────────────────────────────────────────────────────
export class InMemoryAgentRegistry implements AgentRegistry {
  private seq = 0;
  /** every version row ever written, keyed by row id (append-only). */
  readonly rows = new Map<string, AgentRow>();
  /** rootId → the current (latest-version) row id. An edit re-points this to the new version. */
  private currentByRoot = new Map<string, string>();
  /** rowId → rootId (the version-chain anchor = the first row's id). */
  private rootOf = new Map<string, string>();
  /** rootId → the domain the agent serves (candidacy key; stable across versions). */
  private domainOf = new Map<string, AgentDomain>();
  /** tool id → capability tag (for the REG.006.3 seed check + injected by the seeder). */
  readonly toolCaps = new Map<string, ToolCapability>();

  constructor(
    private readonly deps: {
      perms?: PermChecker; // when unset, the store does not gate (provisioning/seed path runs ungated)
      audit?: DenialAuditSink;
    } = {},
  ) {}

  private nextId(): string {
    this.seq += 1;
    return `agent-${String(this.seq).padStart(4, '0')}`;
  }
  private iso(now: number): string {
    return new Date(now * 1000).toISOString();
  }

  private gate(actorId: string, node: AgentsPerm, action: string, detail: string, now: number): void {
    // No gate configured (seed/provisioning path, ADR-005 scripted) → proceed ungated.
    if (!this.deps.perms) return;
    if (this.deps.perms.holds(actorId, node)) return;
    this.deps.audit?.logDenial({ actor_id: actorId, perm_node: node, action, detail }, now);
    throw new AgentsPermissionDenied(actorId, node, action);
  }

  private validateWrite(description: string, memory_scope: MemoryScope | undefined, change_reason: string): void {
    if (typeof change_reason !== 'string' || change_reason.trim().length === 0) {
      throw new Error(ERR_EMPTY_CHANGE_REASON);
    }
    if (typeof description !== 'string' || description.trim().length === 0) {
      throw new Error(ERR_EMPTY_DESCRIPTION);
    }
    if (memory_scope === undefined || memory_scope === null) {
      throw new Error(ERR_EMPTY_MEMORY_SCOPE);
    }
  }

  async insert(a: NewAgent, actorId: string, now: number): Promise<AgentRow> {
    // An insert (add-an-agent) is a capability change (OD-080) — Super Admin only. Seed path is ungated.
    this.gate(actorId, PERM_AGENTS_EDIT_CAPABILITY, 'agents.insert', a.name, now);
    this.validateWrite(a.description, a.memory_scope, a.change_reason);
    const id = this.nextId();
    const row: AgentRow = {
      id,
      name: a.name,
      description: a.description,
      memory_scope: cloneScope(a.memory_scope),
      tools_allowed: [...(a.tools_allowed ?? [])],
      max_tokens: a.max_tokens ?? null,
      enabled: a.enabled ?? true, // schema default true
      version: 1,
      previous_version_id: null,
      change_reason: a.change_reason,
      created_at: this.iso(now),
      updated_at: this.iso(now),
      created_by: a.created_by ?? null,
    };
    this.rows.set(id, row);
    this.currentByRoot.set(id, id); // root === first row
    this.rootOf.set(id, id);
    this.domainOf.set(id, a.domain);
    return cloneRow(row);
  }

  async get(id: string): Promise<AgentRow | null> {
    // `id` may be a root id or any version id — resolve to the CURRENT version of that chain.
    const root = this.rootOf.get(id);
    if (root === undefined) return null;
    const currentId = this.currentByRoot.get(root);
    if (currentId === undefined) return null;
    const row = this.rows.get(currentId);
    return row ? cloneRow(row) : null;
  }

  async candidates(domain?: AgentDomain): Promise<AgentRow[]> {
    const out: AgentRow[] = [];
    for (const [root, currentId] of this.currentByRoot) {
      const row = this.rows.get(currentId);
      if (!row) continue;
      if (!row.enabled) continue; // REG.005: disabled rows are NEVER candidates (but persist)
      if (domain !== undefined && this.domainOf.get(root) !== domain) continue;
      out.push(cloneRow(row));
    }
    // deterministic order: by name
    out.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
    return out;
  }

  async history(rootId: string): Promise<AgentRow[]> {
    const root = this.rootOf.get(rootId);
    if (root === undefined) return [];
    const chain: AgentRow[] = [];
    for (const row of this.rows.values()) {
      if (this.rootOf.get(row.id) === root) chain.push(cloneRow(row));
    }
    chain.sort((a, b) => a.version - b.version);
    return chain;
  }

  /** Append a new version linked to the current one (FR-8.REG.004 / #1 — never overwrite the prior). */
  private appendVersion(currentId: string, mutate: (draft: AgentRow) => void, change_reason: string, now: number): AgentRow {
    const cur = this.rows.get(currentId);
    if (!cur) throw new Error(ERR_NO_SUCH_AGENT(currentId));
    const root = this.rootOf.get(currentId)!;
    const newId = this.nextId();
    const next: AgentRow = {
      ...cloneRow(cur),
      id: newId,
      version: cur.version + 1,
      previous_version_id: cur.id,
      change_reason,
      updated_at: this.iso(now),
    };
    mutate(next);
    this.rows.set(newId, next);
    this.rootOf.set(newId, root);
    this.currentByRoot.set(root, newId); // re-point current; the prior row STAYS in `rows` (retrievable)
    return cloneRow(next);
  }

  private mustCurrent(id: string): AgentRow {
    const root = this.rootOf.get(id);
    if (root === undefined) throw new Error(ERR_NO_SUCH_AGENT(id));
    const currentId = this.currentByRoot.get(root);
    const row = currentId ? this.rows.get(currentId) : undefined;
    if (!row) throw new Error(ERR_NO_SUCH_AGENT(id));
    return row;
  }

  async editCapability(id: string, edit: CapabilityEdit, actorId: string, now: number): Promise<AgentRow> {
    this.gate(actorId, PERM_AGENTS_EDIT_CAPABILITY, 'agents.edit_capability', id, now);
    if (typeof edit.change_reason !== 'string' || edit.change_reason.trim().length === 0) {
      throw new Error(ERR_EMPTY_CHANGE_REASON);
    }
    if (edit.memory_scope === null) throw new Error(ERR_EMPTY_MEMORY_SCOPE);
    const cur = this.mustCurrent(id);
    return this.appendVersion(
      cur.id,
      (d) => {
        if (edit.memory_scope !== undefined) d.memory_scope = cloneScope(edit.memory_scope);
        if (edit.tools_allowed !== undefined) d.tools_allowed = [...edit.tools_allowed];
        if (edit.enabled !== undefined) d.enabled = edit.enabled;
      },
      edit.change_reason,
      now,
    );
  }

  async editDescription(id: string, edit: DescriptionEdit, actorId: string, now: number): Promise<AgentRow> {
    this.gate(actorId, PERM_AGENTS_EDIT_DESCRIPTION, 'agents.edit_description', id, now);
    if (typeof edit.change_reason !== 'string' || edit.change_reason.trim().length === 0) {
      throw new Error(ERR_EMPTY_CHANGE_REASON);
    }
    if (edit.description !== undefined && edit.description.trim().length === 0) {
      throw new Error(ERR_EMPTY_DESCRIPTION);
    }
    const cur = this.mustCurrent(id);
    return this.appendVersion(
      cur.id,
      (d) => {
        if (edit.description !== undefined) d.description = edit.description;
        if (edit.max_tokens !== undefined) d.max_tokens = edit.max_tokens;
      },
      edit.change_reason,
      now,
    );
  }

  async disable(
    id: string,
    change_reason: string,
    actorId: string,
    now: number,
  ): Promise<{ row: AgentRow; warning: SoleAgentDisableWarning | null }> {
    this.gate(actorId, PERM_AGENTS_EDIT_CAPABILITY, 'agents.disable', id, now);
    if (typeof change_reason !== 'string' || change_reason.trim().length === 0) {
      throw new Error(ERR_EMPTY_CHANGE_REASON);
    }
    const cur = this.mustCurrent(id);
    const root = this.rootOf.get(cur.id)!;
    const domain = this.domainOf.get(root)!;
    // REG.005.3: is this the SOLE enabled agent for its domain? (compute BEFORE the disable lands.)
    const enabledSameDomain = (await this.candidates(domain)).filter((r) => this.rootOf.get(r.id) !== root && r.enabled);
    const isSole = cur.enabled && enabledSameDomain.length === 0;
    const row = this.appendVersion(cur.id, (d) => (d.enabled = false), change_reason, now);
    const warning: SoleAgentDisableWarning | null = isSole
      ? {
          kind: 'sole_agent_disabled',
          domain,
          agent_id: root,
          agent_name: cur.name,
          message: ERR_SOLE_AGENT_DISABLE(domain),
        }
      : null;
    return { row, warning };
  }

  // ── helpers exposed for the seeder + REG.006.3 check ─────────────────────────────────────────────
  /** The root id for any version id (used by the seeder to de-dupe by name). */
  rootFor(id: string): string | undefined {
    return this.rootOf.get(id);
  }
  domainFor(rootId: string): AgentDomain | undefined {
    return this.domainOf.get(rootId);
  }
}

function cloneScope(s: MemoryScope): MemoryScope {
  return { tiers: [...s.tiers], entity_model: s.entity_model, tool_registry: s.tool_registry, note: s.note };
}
function cloneRow(r: AgentRow): AgentRow {
  return {
    ...r,
    memory_scope: cloneScope(r.memory_scope),
    tools_allowed: [...r.tools_allowed],
  };
}
