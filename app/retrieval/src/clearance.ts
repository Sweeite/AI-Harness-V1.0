// ISSUE-025 (C2 RET) — FR-2.RET.004: the CLEARANCE + visibility decision, run BEFORE ranking. THE #2-leak
// invariant of this slice. This module is the code realisation of the live `memories_clearance_read` RLS policy
// (silo migration 0031_rls_enforcement.sql) — the SAME predicate, evaluated in-process, because:
//   • the agent `service_role` path BYPASSES RLS (ADR-006 part 6), so retrieval is the ONLY thing that filters it —
//     if this code is wrong, a client-facing agent leaks Internal-Org / Personal / Restricted memory (#2);
//   • the human/session path IS behind RLS, but retrieval still applies clearance-before-ranking as the mechanism
//     (defence in depth) — RLS is the backstop, never the sole guard.
// Rule 0: 0031 is the source of truth for this predicate. Any change to the policy MUST change this in lockstep;
// the check gate (index.ts) asserts the tier vocabularies still match, and the R10 smoke proves the code and the
// live policy agree row-for-row.
//
// The 0031 predicate — a human/agent MAY read a memory row iff ALL hold:
//   1. aal2 (universal baseline, FR-1.RLS.005).
//   2. the caller HOLDS the row's visibility tier (user_visibility @> [visibility]).
//   3. sensitivity: 'standard' is implicit-cleared; 'confidential'/'personal' require a user_clearances tier of the
//      SAME name whose entity_type_scope is Global (null) OR matches one of the row's entities' types (FR-1.CLR.004);
//      'restricted' is NOT a clearance tier — it passes this clause and is gated by clause 4 instead.
//   4. Restricted: a 'restricted' row additionally requires a LIVE per-individual grant (revoked_at is null) on one of
//      the row's entities — by entity id, or by entity_type.

import type { MemoryRow } from '../../memory/src/store.ts';
import type { VisibilityTier, SensitivityTier } from '../../memory/src/entity-types.ts';
import type { ClearanceHold, RestrictedHold } from '../../rls-enforcement/src/store.ts';

/** The caller's LIVE authorization state, resolved at retrieval time (no snapshot — FR-1.RLS.006). On the human path
 *  this mirrors the RLS helpers (user_visibility / user_clearances / user_restricted / user_aal); on the agent
 *  `service_role` path the harness resolves the same shape for the originating user + running agent (ADR-006). */
export interface Requester {
  /** Which path this read runs on — governs the aal / agent-scope semantics. 'agent' = service_role (bypasses RLS,
   *  so this filter is authoritative); 'human' = session (RLS backstops this filter). */
  path: 'human' | 'agent';
  /** aal2 verified (FR-1.RLS.005 universal baseline). Fail-closed: absence of proof → not cleared (#2). On the agent
   *  service_role path the harness sets this true when the originating session was aal2; a false here denies. */
  aal2: boolean;
  /** The visibility tiers the caller holds (mirrors user_visibility). A row is visibility-cleared iff its tier ∈ this
   *  set. An EMPTY set clears nothing (fail-closed) — never treat "no visibility resolved" as "sees everything" (#2). */
  visibility: readonly VisibilityTier[];
  /** The caller's live sensitivity clearances (confidential/personal), each with its entity-type scope (null=Global). */
  clearances: readonly ClearanceHold[];
  /** The caller's live Restricted per-individual grants (revoked_at is null). */
  restricted: readonly RestrictedHold[];
  /** OD-081 (change-control 2026-06-26): the running agent's memory_scope — an OPTIONAL narrowing within clearance,
   *  never a widening. Only consulted on the agent path. Absent = no extra narrowing. */
  agentScope?: AgentScope;
}

/** OD-081 agent memory_scope: a least-privilege retrieval predicate the agent path narrows *within* clearance with.
 *  Modelled as an allow-list of entity ids and/or entity types; a candidate passes iff it touches at least one
 *  allowed entity (by id or type). An ABSENT scope (undefined) means "no narrowing" (full clearance applies); an
 *  EXPLICIT empty scope ({entityIds:[],entityTypes:[]}) narrows to NOTHING (fail-closed) — an agent with a defined
 *  but empty scope sees no memory, never all of it. The real memory_scope definition is ISSUE-063 (C8 SCO). */
export interface AgentScope {
  entityIds?: readonly string[];
  entityTypes?: readonly string[];
}

/** The verdict for one candidate against one requester. `visible` = the requester is cleared to SEE the row (the full
 *  0031 predicate). `sensitiveTouch` = the row is personal/restricted (drives the FR-1.AUD.001 access audit when it is
 *  visible). `restricted` = the row is Restricted-tier (never auto-injectable regardless of visibility — FR-2.RET.006). */
export interface ClearanceVerdict {
  visible: boolean;
  sensitiveTouch: boolean;
  restricted: boolean;
}

/** The entity-type lookup the sensitivity + restricted clauses need: a row's entity ids → their types. Built once per
 *  retrieval from the candidate entities (the live adapter reads `entities.type`; the fake reads its snapshot). */
export type EntityTypeLookup = (entityId: string) => string | undefined;

function rowEntityTypes(memory: Pick<MemoryRow, 'entity_ids'>, typeOf: EntityTypeLookup): Set<string> {
  const types = new Set<string>();
  for (const id of memory.entity_ids) {
    const t = typeOf(id);
    if (t !== undefined) types.add(t);
  }
  return types;
}

/** Clause 3 — sensitivity clearance. 'standard' implicit-cleared; 'confidential'/'personal' need a same-name clearance
 *  whose scope is Global (null) OR matches a row entity's type; 'restricted' passes here (gated by clause 4). */
function sensitivityCleared(sensitivity: SensitivityTier, rowTypes: Set<string>, clearances: readonly ClearanceHold[]): boolean {
  if (sensitivity !== 'confidential' && sensitivity !== 'personal') return true; // standard + restricted pass clause 3
  return clearances.some((c) => c.tier === sensitivity && (c.entityTypeScope === null || rowTypes.has(c.entityTypeScope)));
}

/** Clause 4 — Restricted per-individual grant. A 'restricted' row needs a live grant on one of the row's entities, by
 *  id OR by entity_type. Non-restricted rows are unaffected. */
function restrictedGranted(memory: Pick<MemoryRow, 'entity_ids' | 'sensitivity'>, rowTypes: Set<string>, grants: readonly RestrictedHold[]): boolean {
  if (memory.sensitivity !== 'restricted') return true;
  const entityIds = new Set(memory.entity_ids);
  return grants.some(
    (g) => (g.entityId !== null && entityIds.has(g.entityId)) || (g.entityType !== null && rowTypes.has(g.entityType)),
  );
}

/** OD-081 agent-scope narrowing: a candidate passes iff it touches an allowed entity (by id or type). Undefined scope
 *  = no narrowing (pass). Human path ignores agent scope. */
function withinAgentScope(memory: Pick<MemoryRow, 'entity_ids'>, rowTypes: Set<string>, requester: Requester): boolean {
  if (requester.path !== 'agent' || requester.agentScope === undefined) return true;
  const { entityIds = [], entityTypes = [] } = requester.agentScope;
  const allowIds = new Set(entityIds);
  const allowTypes = new Set(entityTypes);
  return memory.entity_ids.some((id) => allowIds.has(id)) || [...rowTypes].some((t) => allowTypes.has(t));
}

/**
 * The full FR-2.RET.004 decision for one candidate — realises the 0031 memories_clearance_read predicate + the
 * OD-081 agent-scope narrowing. Pure + deterministic; offline and live decide identically (proven by the R10 smoke).
 * Fail-closed throughout: a missing aal2, an empty visibility set, an unmatched clearance, or an out-of-scope agent
 * read all yield `visible:false` — retrieval NEVER surfaces a row it cannot prove the caller may see (#2).
 */
export function clearanceVerdict(memory: MemoryRow, typeOf: EntityTypeLookup, requester: Requester): ClearanceVerdict {
  const restricted = memory.sensitivity === 'restricted';
  const sensitiveTouch = memory.sensitivity === 'personal' || memory.sensitivity === 'restricted';
  const rowTypes = rowEntityTypes(memory, typeOf);

  const visible =
    requester.aal2 && // clause 1
    requester.visibility.includes(memory.visibility) && // clause 2
    sensitivityCleared(memory.sensitivity, rowTypes, requester.clearances) && // clause 3
    restrictedGranted(memory, rowTypes, requester.restricted) && // clause 4
    withinAgentScope(memory, rowTypes, requester); // OD-081 narrowing (agent path only)

  return { visible, sensitiveTouch, restricted };
}
