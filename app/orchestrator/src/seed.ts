// ISSUE-061 (C8 REG.006 / ORC.008 / OD-079) — the idempotent canonical-roster seed. Scripted provisioning
// (ADR-005, mirrors C1 OD-030 seed-then-authoritative) inserts the orchestrator + 8 specialists with their
// descriptions, memory_scope (the SCO matrix), tools_allowed, and enabled defaults. A partial seed re-runs
// without duplicates (idempotent by `name`). The POSITIVE seed-time check (REG.006.3, the seed side of
// SPC.003/004's negative invariants) asserts the Comms row holds no autonomous-send tool and the Finance row
// no transaction tool BEFORE the row is written — a fail-closed guard, never a warning (#2).
//
// This slice SEEDS the roster rows + the positive Comms/Finance check. It does NOT own the specialist behaviour
// FRs (SPC.*, ISSUE-062) nor the memory_scope enforcement filter (SCO.*, ISSUE-063 — the scope stored here is
// inert until 063 wires it). Layer-1 content is authored in prompt_layers by C4 (ISSUE-042/043); this seeder
// asserts a `core` layer is present for each seeded agent (REG.002 / ORC.008.1) via the injected layer probe.

import {
  AGENT_DOMAINS,
  CAP_AUTONOMOUS_SEND,
  CAP_TRANSACTION,
  InMemoryAgentRegistry,
  ORCHESTRATOR_NAME,
  type AgentDomain,
  type AgentRow,
  type MemoryScope,
  type NewAgent,
  type ToolCapability,
} from './registry.ts';

export const ERR_COMMS_HAS_SEND = (toolId: string) =>
  `seed: REFUSING to seed the Comms Agent with autonomous-send tool '${toolId}' — Comms never sends (AC-8.REG.006.3 / SPC.003, #2)`;
export const ERR_FINANCE_HAS_TXN = (toolId: string) =>
  `seed: REFUSING to seed the Finance Agent with transaction tool '${toolId}' — Finance never transacts (AC-8.REG.006.3 / SPC.004, #2)`;

/** One canonical roster entry. `role` is the bare slug used as `name` (OD-096 — no client_slug). */
export interface RosterEntry {
  role: string; // = name (bare slug)
  domain: AgentDomain;
  description: string;
  memory_scope: MemoryScope;
  tools_allowed: string[]; // tool ids (uuids live; slugs in the fake)
  enabled: boolean;
}

/** The orchestrator's own restricted scope (ORC.008 / L3476): semantic only + entity model + tool registry.
 * NO episodic/procedural, NO broad business-entity content — containment rests on the SCO.001 filter (063). */
const ORCHESTRATOR_SCOPE: MemoryScope = {
  tiers: ['semantic'],
  entity_model: true,
  tool_registry: true,
  note: 'orchestrator: semantic + entity model + tool registry only (ORC.008 / L3476); SCO.001 enforces (063)',
};

/** The canonical roster (OD-079). The orchestrator is a scoped registry row like any other (ORC.008). The
 * memory_scope values are the SCO matrix seeds (inert until ISSUE-063). Comms/Finance carry NO
 * send/transaction tool by construction (the positive REG.006.3 check enforces it at write). */
export function canonicalRoster(): { orchestrator: RosterEntry; specialists: RosterEntry[] } {
  const specialists: RosterEntry[] = [
    {
      role: 'research',
      domain: 'research',
      description:
        'Read-only information gathering: searches connected sources and memory to assemble context and facts for other agents. Never writes, sends, or transacts.',
      memory_scope: { tiers: ['semantic', 'episodic'], entity_model: true, tool_registry: false },
      tools_allowed: [],
      enabled: true,
    },
    {
      role: 'client',
      domain: 'client',
      description:
        'Owns client-relationship tasks: account context, client-facing summaries, relationship history and preferences.',
      memory_scope: { tiers: ['semantic', 'episodic', 'entity'], entity_model: true, tool_registry: false },
      tools_allowed: [],
      enabled: true,
    },
    {
      role: 'campaign',
      domain: 'campaign',
      description:
        'Owns campaign planning and execution tasks: briefs, timelines, deliverable tracking across a campaign.',
      memory_scope: { tiers: ['semantic', 'episodic', 'entity'], entity_model: true, tool_registry: false },
      tools_allowed: [],
      enabled: true,
    },
    {
      role: 'comms',
      domain: 'comms',
      description:
        'Drafts outbound communications for human review. Prepares messages and replies but NEVER sends autonomously — every send is a human-approved action.',
      memory_scope: { tiers: ['semantic'], entity_model: true, tool_registry: false, note: 'brand guides / comms context only' },
      tools_allowed: [], // NO autonomous-send tool — REG.006.3
      enabled: true,
    },
    {
      role: 'ops',
      domain: 'ops',
      description:
        'Owns operational task coordination: scheduling, status roll-ups, internal workflow orchestration for the client.',
      memory_scope: { tiers: ['semantic', 'procedural', 'entity'], entity_model: true, tool_registry: false },
      tools_allowed: [],
      enabled: true,
    },
    {
      role: 'memory',
      domain: 'memory',
      description:
        'The SOLE writer of memory (ADR-004): consolidates, deduplicates and persists knowledge. No other agent writes memory directly.',
      memory_scope: { tiers: ['semantic', 'episodic', 'procedural', 'entity'], entity_model: true, tool_registry: false },
      tools_allowed: [],
      enabled: true,
    },
    {
      role: 'finance',
      domain: 'finance',
      description:
        'Analyses and reports on financial data: budgets, spend, forecasts. Read-and-report only — NEVER initiates a transaction or payment.',
      memory_scope: { tiers: ['semantic', 'entity'], entity_model: true, tool_registry: false, note: 'financial records read-only' },
      tools_allowed: [], // NO transaction tool — REG.006.3
      enabled: true,
    },
    {
      role: 'insight',
      domain: 'insight',
      description:
        'Produces cross-domain analysis and recommendations: synthesises trends and patterns into decision-ready insight.',
      memory_scope: { tiers: ['semantic', 'episodic', 'entity'], entity_model: true, tool_registry: false },
      tools_allowed: [],
      enabled: true,
    },
  ];
  const orchestrator: RosterEntry = {
    role: ORCHESTRATOR_NAME,
    // the orchestrator serves no client domain; parked under ops for the scope/Layer-1 index. It is NEVER a routing
    // candidate for itself — that promise is now enforced in code by registry.candidates() (name===ORCHESTRATOR_NAME
    // is filtered out), not just this comment (logic-sweep fix, seed.ts:129 / ORC.001.1).
    domain: 'ops',
    description:
      'The single routing brain: classifies each task and builds an execution plan delegating to specialists. Plans and delegates only — performs no domain work itself.',
    memory_scope: ORCHESTRATOR_SCOPE,
    tools_allowed: [], // read-only: registry + entity model + semantic memory (ORC.001.1 — empty action-tool set)
    enabled: true,
  };
  return { orchestrator, specialists };
}

/** A probe the seeder calls to assert a `core` prompt_layer exists for a seeded agent (REG.002 / ORC.008.1).
 * Offline this is a fake; live it is @harness/prompt-store resolving prompt_layers by agent_id/layer='core'. */
export interface CoreLayerProbe {
  hasCore(agentRootId: string): boolean;
}

/** The result of a seed run (idempotent). `inserted` = new rows this run; `existing` = already-present roster
 * entries left untouched; `missingCoreLayer` = seeded agents with no core prompt_layer (a #3 surface — the run
 * pipeline halts on these, FR-4.LYR.004, executed in 053). */
export interface SeedResult {
  inserted: AgentRow[];
  existing: AgentRow[];
  missingCoreLayer: string[]; // agent names lacking a core layer (owed to C4 seed, ISSUE-042/043)
}

/**
 * Idempotently seed the roster into an InMemoryAgentRegistry. Re-running converges (no duplicates) by matching
 * on `name`. The REG.006.3 positive check runs BEFORE each Comms/Finance insert and THROWS (fail-closed) if a
 * forbidden tool is present. `toolCaps` maps tool id → capability (the fake's stand-in for a `tools` join).
 */
export async function seedRoster(
  reg: InMemoryAgentRegistry,
  now: number,
  opts: {
    toolCaps?: Map<string, ToolCapability>;
    probe?: CoreLayerProbe;
    actorId?: string; // provisioning actor; the seed path runs ungated (no perms gate) by default
  } = {},
): Promise<SeedResult> {
  const toolCaps = opts.toolCaps ?? new Map<string, ToolCapability>();
  // make the caps visible to the registry (for any later REG.006.3-style assertion on the live join)
  for (const [k, v] of toolCaps) reg.toolCaps.set(k, v);

  const { orchestrator, specialists } = canonicalRoster();
  const all = [orchestrator, ...specialists];

  const inserted: AgentRow[] = [];
  const existing: AgentRow[] = [];

  // Build a name → current-row index from what's already present (idempotency key = name).
  const present = new Map<string, AgentRow>();
  for (const d of AGENT_DOMAINS) {
    for (const r of await reg.candidates(d)) present.set(r.name, r);
  }
  // Also include disabled roster rows (candidates() excludes them) so a re-seed doesn't duplicate a disabled row.
  for (const row of reg.rows.values()) {
    const rootId = reg.rootFor(row.id);
    if (rootId === undefined) continue;
    // only the current version of each chain
    const cur = await reg.get(rootId);
    if (cur && cur.id === row.id) present.set(cur.name, cur);
  }

  for (const entry of all) {
    if (present.has(entry.role)) {
      existing.push(present.get(entry.role)!);
      continue;
    }
    assertForbiddenToolsAbsent(entry, toolCaps);
    const na: NewAgent = {
      name: entry.role,
      description: entry.description,
      memory_scope: entry.memory_scope,
      domain: entry.domain,
      tools_allowed: entry.tools_allowed,
      enabled: entry.enabled,
      change_reason: 'provisioning seed (ADR-005 / OD-079 canonical roster)',
    };
    const row = await reg.insert(na, opts.actorId ?? 'system:provisioning', now);
    inserted.push(row);
  }

  // ORC.008.1 / REG.002 — every seeded agent must have a `core` prompt_layer (the Layer-1 single source).
  const missingCoreLayer: string[] = [];
  if (opts.probe) {
    for (const entry of all) {
      const cur = [...inserted, ...existing].find((r) => r.name === entry.role);
      if (cur && !opts.probe.hasCore(reg.rootFor(cur.id) ?? cur.id)) missingCoreLayer.push(entry.role);
    }
  }
  return { inserted, existing, missingCoreLayer };
}

/** The REG.006.3 positive check: fail-closed if a Comms row carries an autonomous-send tool or a Finance row a
 * transaction tool. A tool with no capability entry is treated as NON-forbidden here (the live adapter joins the
 * authoritative `tools` capabilities); the seed roster carries NO such tools by construction. */
export function assertForbiddenToolsAbsent(entry: RosterEntry, toolCaps: Map<string, ToolCapability>): void {
  if (entry.role === 'comms') {
    for (const t of entry.tools_allowed) {
      if (toolCaps.get(t) === CAP_AUTONOMOUS_SEND) throw new Error(ERR_COMMS_HAS_SEND(t));
    }
  }
  if (entry.role === 'finance') {
    for (const t of entry.tools_allowed) {
      if (toolCaps.get(t) === CAP_TRANSACTION) throw new Error(ERR_FINANCE_HAS_TXN(t));
    }
  }
}
