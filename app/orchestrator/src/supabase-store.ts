// ISSUE-061 (C8 ORC/REG) — the LIVE pg adapters (against the client-owned silo Supabase). The only module that
// imports `pg`. They implement the same ports as the in-memory fakes against the REAL baseline DDL
// (app/silo/migrations/0001_baseline.sql — `agents`, `execution_plans`, `event_log`, `prompt_layers`).
//
// ⚠️ NOT YET RUN LIVE. The append-only version chain landing under concurrent writers, the description-driven
// candidate read, the REG.006.3 seed join against the live `tools` capability set, and the execution_plans
// version INSERT are proven by the operator at the Stage-4/5 checkpoint (a 💻 full/live env). Authored to the
// DDL so the seam is real + typechecks; the in-memory reference models are the proven contract. Do NOT claim
// these paths verified until the live run records evidence.
//
// Design notes tied to the three non-negotiables:
//   #1 the version chain is append-only: an edit INSERTs a new row linking previous_version_id — the prior row
//      is never UPDATEd/DELETEd. (The append-only-by-version trigger + REVOKE are owed to the shared migration —
//      see results/proposed-shared-spec.md; the adapter never issues an UPDATE/DELETE on `agents`.)
//   #2 the OD-080 authority split is enforced at the store via the injected PermChecker (Super Admin only for
//      capability edits; SA+Admin for description). RLS `service_role` is bypass — the app gate is the control.
//   #3 the routing outcome write's failure is surfaced via the SECONDARY sink; the routing events INSERT onto
//      event_log; nothing silently drops.

import pg from 'pg';
import {
  AgentsPermissionDenied,
  ERR_EMPTY_CHANGE_REASON,
  ERR_EMPTY_DESCRIPTION,
  ERR_EMPTY_MEMORY_SCOPE,
  ERR_NO_SUCH_AGENT,
  PERM_AGENTS_EDIT_CAPABILITY,
  PERM_AGENTS_EDIT_DESCRIPTION,
  type AgentDomain,
  type AgentRegistry,
  type AgentRow,
  type AgentsPerm,
  type CapabilityEdit,
  type DenialAuditSink,
  type DescriptionEdit,
  type MemoryScope,
  type NewAgent,
  type PermChecker,
  type SoleAgentDisableWarning,
} from './registry.ts';

const AGENT_COLS = `id, name, description, memory_scope, tools_allowed, max_tokens, enabled, version,
  previous_version_id, change_reason, created_at, updated_at, created_by`;

interface RawAgent {
  id: string;
  name: string;
  description: string;
  memory_scope: MemoryScope;
  tools_allowed: string[];
  max_tokens: number | null;
  enabled: boolean;
  version: number;
  previous_version_id: string | null;
  change_reason: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

function toRow(r: RawAgent): AgentRow {
  return {
    ...r,
    tools_allowed: r.tools_allowed ?? [],
  };
}

/** The domain an agent serves is stored live inside the `memory_scope` jsonb as a `__domain` key (see insert()).
 * candidates(domain)/disable() resolve routing candidacy off it. The reference model (registry.ts) keeps domain
 * in a SEPARATE root-keyed map, so it is immune to a scope replacement dropping the tag; the live adapter is not.
 * These two helpers are the single choke point that keeps the tag alive across a memory_scope-replacing edit. */
export function domainOf(scope: MemoryScope): AgentDomain | undefined {
  return (scope as unknown as { __domain?: AgentDomain }).__domain;
}
/** Re-inject `__domain` into a (possibly domain-less) replacement memory_scope. A no-op when domain is undefined.
 * A `__domain` already on `scope` wins over `domain` (an explicit tag on the incoming scope is authoritative). */
export function withDomain(scope: MemoryScope, domain: AgentDomain | undefined): MemoryScope {
  if (domain === undefined) return scope;
  const existing = domainOf(scope);
  return { ...scope, __domain: existing ?? domain } as MemoryScope;
}

export class SupabaseAgentRegistry implements AgentRegistry {
  private pool: pg.Pool;
  constructor(
    connectionString: string,
    private readonly deps: { perms?: PermChecker; audit?: DenialAuditSink } = {},
  ) {
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
  }

  private gate(actorId: string, node: AgentsPerm, action: string, detail: string, now: number): void {
    if (!this.deps.perms) return;
    if (this.deps.perms.holds(actorId, node)) return;
    this.deps.audit?.logDenial({ actor_id: actorId, perm_node: node, action, detail }, now);
    throw new AgentsPermissionDenied(actorId, node, action);
  }

  async insert(a: NewAgent, actorId: string, now: number): Promise<AgentRow> {
    this.gate(actorId, PERM_AGENTS_EDIT_CAPABILITY, 'agents.insert', a.name, now);
    if (!a.change_reason?.trim()) throw new Error(ERR_EMPTY_CHANGE_REASON);
    if (!a.description?.trim()) throw new Error(ERR_EMPTY_DESCRIPTION);
    if (a.memory_scope == null) throw new Error(ERR_EMPTY_MEMORY_SCOPE);
    // domain is carried in an app-side index table in the fake; live it lives inside memory_scope (a `domain`
    // key) OR a companion table owned by the shared migration — see proposed-shared-spec.md. Stored in
    // memory_scope.note-adjacent here to avoid a schema delta this slice may not author.
    const res = await this.pool.query<RawAgent>(
      `insert into agents (name, description, memory_scope, tools_allowed, max_tokens, enabled, change_reason, created_by)
       values ($1, $2, $3::jsonb, $4::uuid[], $5, coalesce($6, true), $7, $8)
       returning ${AGENT_COLS}`,
      [a.name, a.description, JSON.stringify({ ...a.memory_scope, __domain: a.domain }), a.tools_allowed ?? [], a.max_tokens ?? null, a.enabled ?? true, a.change_reason, a.created_by ?? null],
    );
    return toRow(res.rows[0]!);
  }

  async get(id: string): Promise<AgentRow | null> {
    // The CURRENT version = the row in this chain with no successor pointing at it. We resolve by walking to the
    // max version sharing the chain root. Simpler live model: the latest version row whose chain includes `id`.
    const res = await this.pool.query<RawAgent>(
      `with recursive chain as (
         select ${AGENT_COLS} from agents where id = $1
         union all
         select a.id, a.name, a.description, a.memory_scope, a.tools_allowed, a.max_tokens, a.enabled, a.version,
                a.previous_version_id, a.change_reason, a.created_at, a.updated_at, a.created_by
           from agents a join chain c on a.previous_version_id = c.id
       )
       select ${AGENT_COLS} from chain order by version desc limit 1`,
      [id],
    );
    return res.rows[0] ? toRow(res.rows[0]) : null;
  }

  async candidates(domain?: AgentDomain): Promise<AgentRow[]> {
    // Enabled current-version rows. "Current version" = a row that is not itself a previous_version of another.
    const res = await this.pool.query<RawAgent>(
      `select ${AGENT_COLS} from agents a
        where a.enabled = true
          and not exists (select 1 from agents b where b.previous_version_id = a.id)
          ${domain ? "and a.memory_scope->>'__domain' = $1" : ''}
        order by a.name`,
      domain ? [domain] : [],
    );
    return res.rows.map(toRow);
  }

  async history(rootId: string): Promise<AgentRow[]> {
    const res = await this.pool.query<RawAgent>(
      `with recursive chain as (
         select ${AGENT_COLS} from agents where id = $1
         union all
         select a.id, a.name, a.description, a.memory_scope, a.tools_allowed, a.max_tokens, a.enabled, a.version,
                a.previous_version_id, a.change_reason, a.created_at, a.updated_at, a.created_by
           from agents a join chain c on a.previous_version_id = c.id or a.id = c.previous_version_id
       )
       select distinct ${AGENT_COLS} from chain order by version`,
      [rootId],
    );
    return res.rows.map(toRow);
  }

  private async currentRaw(id: string): Promise<AgentRow> {
    const cur = await this.get(id);
    if (!cur) throw new Error(ERR_NO_SUCH_AGENT(id));
    return cur;
  }

  /** The version-chain ROOT id (the row with previous_version_id IS NULL) for any version id in the chain.
   * Walk UP the previous_version_id links to the origin — the stable per-agent identity across every version.
   * Used by disable() to exclude the agent's OWN chain when deciding sole-agent-ness, so two same-named agents
   * in a domain can't mask each other (names are NOT unique-constrained — cf. registry.ts rootOf, ~L405). */
  private async rootId(id: string): Promise<string> {
    const res = await this.pool.query<{ root: string }>(
      `with recursive up as (
         select id, previous_version_id from agents where id = $1
         union all
         select a.id, a.previous_version_id from agents a join up u on a.id = u.previous_version_id
       )
       select id as root from up where previous_version_id is null limit 1`,
      [id],
    );
    return res.rows[0]?.root ?? id;
  }

  /** Append a new version (INSERT, never UPDATE) linking previous_version_id — #1 append-only. */
  private async appendVersion(cur: AgentRow, patch: Partial<AgentRow>, change_reason: string): Promise<AgentRow> {
    const next = { ...cur, ...patch };
    // Preserve the version-chain's `__domain` routing tag. A capability edit that REPLACES memory_scope carries no
    // `__domain` (the caller passes a plain MemoryScope) — writing it verbatim would silently drop the tag, so the
    // new current version would vanish from candidates(domain)/disable() lookups (#1 knowledge loss / #3 silent
    // routing gap). Re-inject the domain read off the current head before the write.
    next.memory_scope = withDomain(next.memory_scope, domainOf(cur.memory_scope));
    const res = await this.pool.query<RawAgent>(
      `insert into agents (name, description, memory_scope, tools_allowed, max_tokens, enabled, version,
         previous_version_id, change_reason, created_by)
       values ($1, $2, $3::jsonb, $4::uuid[], $5, $6, $7, $8, $9, $10)
       returning ${AGENT_COLS}`,
      [next.name, next.description, JSON.stringify(next.memory_scope), next.tools_allowed, next.max_tokens, next.enabled, cur.version + 1, cur.id, change_reason, next.created_by],
    );
    return toRow(res.rows[0]!);
  }

  async editCapability(id: string, edit: CapabilityEdit, actorId: string, now: number): Promise<AgentRow> {
    this.gate(actorId, PERM_AGENTS_EDIT_CAPABILITY, 'agents.edit_capability', id, now);
    if (!edit.change_reason?.trim()) throw new Error(ERR_EMPTY_CHANGE_REASON);
    if (edit.memory_scope === null) throw new Error(ERR_EMPTY_MEMORY_SCOPE);
    const cur = await this.currentRaw(id);
    const patch: Partial<AgentRow> = {};
    if (edit.memory_scope !== undefined) patch.memory_scope = edit.memory_scope;
    if (edit.tools_allowed !== undefined) patch.tools_allowed = edit.tools_allowed;
    if (edit.enabled !== undefined) patch.enabled = edit.enabled;
    return this.appendVersion(cur, patch, edit.change_reason);
  }

  async editDescription(id: string, edit: DescriptionEdit, actorId: string, now: number): Promise<AgentRow> {
    this.gate(actorId, PERM_AGENTS_EDIT_DESCRIPTION, 'agents.edit_description', id, now);
    if (!edit.change_reason?.trim()) throw new Error(ERR_EMPTY_CHANGE_REASON);
    if (edit.description !== undefined && !edit.description.trim()) throw new Error(ERR_EMPTY_DESCRIPTION);
    const cur = await this.currentRaw(id);
    const patch: Partial<AgentRow> = {};
    if (edit.description !== undefined) patch.description = edit.description;
    if (edit.max_tokens !== undefined) patch.max_tokens = edit.max_tokens;
    return this.appendVersion(cur, patch, edit.change_reason);
  }

  async disable(
    id: string,
    change_reason: string,
    actorId: string,
    now: number,
  ): Promise<{ row: AgentRow; warning: SoleAgentDisableWarning | null }> {
    this.gate(actorId, PERM_AGENTS_EDIT_CAPABILITY, 'agents.disable', id, now);
    if (!change_reason?.trim()) throw new Error(ERR_EMPTY_CHANGE_REASON);
    const cur = await this.currentRaw(id);
    const domain = domainOf(cur.memory_scope);
    // Sole-agent check excludes the agent's OWN chain by version-chain ROOT identity (not name — names aren't
    // unique, so two same-named agents in a domain must not mask each other), mirroring the reference model.
    let others: AgentRow[] = [];
    if (domain !== undefined) {
      const curRoot = await this.rootId(cur.id);
      const cands = await this.candidates(domain);
      const roots = await Promise.all(cands.map((r) => this.rootId(r.id)));
      others = cands.filter((r, i) => roots[i] !== curRoot && r.enabled);
    }
    const isSole = cur.enabled && domain !== undefined && others.length === 0;
    const row = await this.appendVersion(cur, { enabled: false }, change_reason);
    const warning: SoleAgentDisableWarning | null =
      isSole && domain
        ? {
            kind: 'sole_agent_disabled',
            domain,
            agent_id: cur.id,
            agent_name: cur.name,
            message: `agents: sole enabled agent for domain '${domain}' disabled — warning surfaced (FR-8.REG.005.3)`,
          }
        : null;
    return { row, warning };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// The live routing-plan store + event/secondary sinks are authored the same way; kept minimal here since the
// in-memory reference models are the proven contract and execution_plans is co-owned with ISSUE-064.
export { SupabaseAgentRegistry as default };
