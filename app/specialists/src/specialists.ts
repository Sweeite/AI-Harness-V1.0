// ISSUE-062 (C8 SPC) — the eight specialists' BEHAVIOURAL CONTRACTS (the invariant data) + the pure reference
// behaviours the SPC.* ACs assert. This module holds NO description prose and NO memory_scope values — those are
// authored by the ISSUE-061 seed roster (app/orchestrator/src/seed.ts, REG.006 / design-doc L3423–3439) and this
// slice CONSUMES them (Rule 0: one source of truth — re-authoring the prose here would create a second copy that
// rots). What this slice owns is the *contract*: for each role, its single domain (SPC.001), whether it is
// read-only (SPC.002/006), whether it is the sole memory-writer (SPC.005, ADR-004), and its routing constraints
// (Research first-in-chain SPC.002.1; Insight slow-loop-only / not-on-demand SPC.006). The load-bearing
// reject-at-write hard-limit invariants live in ./store.ts.
//
// Mapped to the three non-negotiables: #1 never lose/corrupt knowledge (Memory Agent = single writer, SPC.005 /
// ADR-004); #2 never do what it shouldn't (Comms never sends, Finance never transacts — SPC.003/004 negative
// invariants, enforced in ./store.ts); #3 never fail silently (a payment-implying task becomes a human FLAG, not a
// silent no-op — SPC.004.2).

// ── The eight canonical specialist roles (bare slugs = agents.name; OD-096, no client_slug). ─────────
export const RESEARCH = 'research' as const;
export const CLIENT = 'client' as const;
export const CAMPAIGN = 'campaign' as const;
export const COMMS = 'comms' as const;
export const OPS = 'ops' as const;
export const MEMORY = 'memory' as const;
export const FINANCE = 'finance' as const;
export const INSIGHT = 'insight' as const;

export const SPECIALIST_ROLES = [RESEARCH, CLIENT, CAMPAIGN, COMMS, OPS, MEMORY, FINANCE, INSIGHT] as const;
export type SpecialistRole = (typeof SPECIALIST_ROLES)[number];

/** A finance-entity-scoped Confidential clearance (SPC.004.1 / C1 FR-1.CLR.*). Modelled as data so the AC can
 * assert it; the runtime clearance check is C1's (this slice states the definition). */
export interface Clearance {
  tier: 'confidential';
  scope: 'finance';
}

/** Per-role routing constraints — the routing-side assertions (verified as integration tests against the
 * ISSUE-061 orchestrator; here they are the reference the orchestrator must honour). */
export interface RoutingConstraint {
  /** Research must be the FIRST step when a chain needs gathered context (SPC.002.1). */
  first_in_chain_when_gathering: boolean;
  /** Insight is NOT selectable as an on-demand chain specialist (SPC.006.2). */
  on_demand_selectable: boolean;
  /** Insight runs ONLY on the slow loop (SPC.006 / C5 FR-5.LOP.001). */
  slow_loop_only: boolean;
}

/** The behavioural contract for one specialist — the data-driven invariant set this slice asserts. */
export interface SpecialistContract {
  role: SpecialistRole;
  /** the single domain this specialist owns — the basis of routing (SPC.001). Exactly one per role. */
  domain: SpecialistRole;
  /** read-only = holds no write/action tools (SPC.002 Research, SPC.006 Insight). */
  read_only: boolean;
  /** the SOLE agent identity permitted to invoke the C2 memory-write flow (SPC.005 / ADR-004) — Memory only. */
  memory_writer: boolean;
  /** Comms drafts for human approval; it NEVER holds an autonomous-send tool (SPC.003). Always false. */
  can_send_autonomously: false;
  /** Finance is read-heavy; it NEVER initiates a transaction (SPC.004). Always false. */
  can_transact: false;
  /** the Finance Agent's finance-scoped Confidential clearance (SPC.004.1); null for the rest. */
  clearance: Clearance | null;
  routing: RoutingConstraint;
  /** the FR this row realises (citation — Rule 0). */
  fr: string;
}

const DEFAULT_ROUTING: RoutingConstraint = {
  first_in_chain_when_gathering: false,
  on_demand_selectable: true,
  slow_loop_only: false,
};

/**
 * The eight specialist contracts (SPC.001–006). Each has exactly ONE domain (SPC.001.1). Descriptions/memory_scope
 * are NOT here — they are the ISSUE-061 seed roster's (design-doc L3423–3439). This is the invariant surface.
 */
export const SPECIALIST_CONTRACTS: Readonly<Record<SpecialistRole, SpecialistContract>> = Object.freeze({
  // Read-only information gathering, placed FIRST in any chain that needs context (FR-8.SPC.002, L3425).
  research: {
    role: RESEARCH,
    domain: RESEARCH,
    read_only: true,
    memory_writer: false,
    can_send_autonomously: false,
    can_transact: false,
    clearance: null,
    routing: { first_in_chain_when_gathering: true, on_demand_selectable: true, slow_loop_only: false },
    fr: 'FR-8.SPC.002',
  },
  // Client-relationship domain (FR-8.SPC.001, L3427).
  client: {
    role: CLIENT,
    domain: CLIENT,
    read_only: false,
    memory_writer: false,
    can_send_autonomously: false,
    can_transact: false,
    clearance: null,
    routing: { ...DEFAULT_ROUTING },
    fr: 'FR-8.SPC.001',
  },
  // Campaign planning/execution domain (FR-8.SPC.001, L3429).
  campaign: {
    role: CAMPAIGN,
    domain: CAMPAIGN,
    read_only: false,
    memory_writer: false,
    can_send_autonomously: false,
    can_transact: false,
    clearance: null,
    routing: { ...DEFAULT_ROUTING },
    fr: 'FR-8.SPC.001',
  },
  // Drafts outbound comms for human review; NEVER sends autonomously (FR-8.SPC.003, L3431).
  comms: {
    role: COMMS,
    domain: COMMS,
    read_only: false,
    memory_writer: false,
    can_send_autonomously: false,
    can_transact: false,
    clearance: null,
    routing: { ...DEFAULT_ROUTING },
    fr: 'FR-8.SPC.003',
  },
  // Operational coordination domain (FR-8.SPC.001, L3433).
  ops: {
    role: OPS,
    domain: OPS,
    read_only: false,
    memory_writer: false,
    can_send_autonomously: false,
    can_transact: false,
    clearance: null,
    routing: { ...DEFAULT_ROUTING },
    fr: 'FR-8.SPC.001',
  },
  // The SOLE memory-writer (FR-8.SPC.005 / ADR-004, L3435). Only this role's memory_writer flag is true.
  memory: {
    role: MEMORY,
    domain: MEMORY,
    read_only: false,
    memory_writer: true,
    can_send_autonomously: false,
    can_transact: false,
    clearance: null,
    routing: { ...DEFAULT_ROUTING },
    fr: 'FR-8.SPC.005',
  },
  // Read-heavy finance; NEVER transacts; finance-scoped Confidential clearance (FR-8.SPC.004, L3437/L3474).
  finance: {
    role: FINANCE,
    domain: FINANCE,
    read_only: false,
    memory_writer: false,
    can_send_autonomously: false,
    can_transact: false,
    clearance: { tier: 'confidential', scope: 'finance' },
    routing: { ...DEFAULT_ROUTING },
    fr: 'FR-8.SPC.004',
  },
  // Slow-loop-only, read-all/no-write, NOT on-demand (FR-8.SPC.006, L3439/L3475).
  insight: {
    role: INSIGHT,
    domain: INSIGHT,
    read_only: true,
    memory_writer: false,
    can_send_autonomously: false,
    can_transact: false,
    clearance: null,
    routing: { first_in_chain_when_gathering: false, on_demand_selectable: false, slow_loop_only: true },
    fr: 'FR-8.SPC.006',
  },
});

/** All eight contracts as an ordered list (SPECIALIST_ROLES order). */
export function allContracts(): SpecialistContract[] {
  return SPECIALIST_ROLES.map((r) => SPECIALIST_CONTRACTS[r]);
}

// ── Reference behaviours the SPC ACs exercise (pure; no I/O). ────────────────────────────────────────

/**
 * SPC.003.1 — a Comms output ALWAYS lands as an approval-queue draft, NEVER an outbound send. There is no code
 * path here that yields an outbound send: the Comms specialist's product type is closed to `approval_queue_draft`.
 * The actual send is a downstream, human-approved C3 action (FR-3.ACT.004); this slice guarantees the specialist
 * produces a draft only.
 */
export interface CommsDraft {
  kind: 'approval_queue_draft';
  body: string;
}
export function commsProduce(body: string): CommsDraft {
  return { kind: 'approval_queue_draft', body };
}

/**
 * SPC.004.2 — a payment-implying finance task ALWAYS produces a human FLAG, never a transaction (and never a
 * silent no-op — #3). The Finance specialist's payment-path product type is closed to `human_flag`.
 */
export interface FinanceHumanFlag {
  kind: 'human_flag';
  reason: string;
}
export function financeHandlePayment(reason: string): FinanceHumanFlag {
  return { kind: 'human_flag', reason };
}

/**
 * SPC.002.1 — order a routing chain so Research runs FIRST when the chain needs gathered context. Pure reference
 * of the constraint the ISSUE-061 orchestrator must honour. Roles keep their relative order otherwise. Research is
 * only forced first when `needsGathering` and Research is actually in the chain.
 */
export function orderChain(rolesNeeded: SpecialistRole[], needsGathering: boolean): SpecialistRole[] {
  if (!needsGathering || !rolesNeeded.includes(RESEARCH)) return [...rolesNeeded];
  return [RESEARCH, ...rolesNeeded.filter((r) => r !== RESEARCH)];
}

/**
 * SPC.006.2 — whether a role may be selected as an on-demand chain specialist. Insight is not (slow-loop only).
 */
export function isSelectableOnDemand(role: SpecialistRole): boolean {
  return SPECIALIST_CONTRACTS[role].routing.on_demand_selectable;
}

/**
 * SPC.005.1 — whether a role may invoke the C2 memory-write flow. Only the Memory Agent may (ADR-004 single
 * writer). Any other role handing a raw event to memory does so THROUGH the Memory Agent, never writing directly.
 */
export function mayWriteMemory(role: SpecialistRole): boolean {
  return SPECIALIST_CONTRACTS[role].memory_writer;
}
