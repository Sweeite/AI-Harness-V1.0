// ISSUE-035 — the ApprovalQueue PORT + in-memory fake reference model (house port+fake pattern, cf.
// app/hard-limits/src/store.ts, app/connector-runtime/src/store.ts).
//
// This is the SEAM this slice routes a proposed write INTO — it does NOT build the approval queue itself
// (three-tier classification, soft/hard tiers, escalation, the queue surface are C6 APR/ESC → ISSUE-056).
// The fake mirrors exactly what the live queue must uphold so a test cannot pass offline while the live
// wiring diverges:
//   - a routed write is recorded as a PENDING proposal and NO external effect has occurred (the gate does
//     not call the runtime when it enqueues);
//   - the proposal maps onto the existing schema (schema.md §7): the queued write is a
//     guardrail_log(type='approval_gate', action_blocked=false, status='pending') row + a task in
//     task_status='awaiting_approval' — NO new table (the issue's §5 CFG/UI: none owned);
//   - a decision is set by an AUTHORIZED HUMAN via C6/RBAC (ISSUE-056) — this fake models the decision
//     shape (approved | rejected | modified) the gate reads back before it will execute.
//
// NB: there is deliberately NO 'approved' path that the queue itself can trigger autonomously — a decision
// is supplied from outside (a human approver). That is what makes self-approval (hard limit #6) structurally
// impossible on this path: the gate never approves its own proposal.

/** guardrail_status subset a queued approval-gate proposal moves through (schema.md §7 guardrail_status). */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'modified';

/** The proposed write handed to the C6 queue. Carries only what an approver needs to decide — the tool, the
 *  connector, the risk level, and the (idempotency-keyed) call args. NO client id (ADR-001 — isolation is
 *  physical; a proposal never crosses deployments). */
export interface WriteProposal {
  toolId: string;
  toolName: string;
  connector: string;
  riskLevel: string | null;
  args: Record<string, unknown>;
  proposedAt: number; // epoch seconds
}

/** A queued proposal's record — the reference-model shape of the guardrail_log(approval_gate) row + the
 *  awaiting_approval task the live queue writes. */
export interface QueuedProposal {
  id: string;
  proposal: WriteProposal;
  status: ApprovalStatus;
  /** true iff an external side effect has occurred for this proposal. MUST be false while pending — the
   *  whole point of the gate is that a routed write has NOT touched the outside world yet (AC-3.ACT.001.1). */
  externalEffectPerformed: boolean;
  createdAt: string;
  decidedAt: string | null;
  /** the actor who decided — NEVER the proposer's own agent path (self-approval is impossible here). */
  decidedBy: string | null;
}

/** An approval decision returned from the C6 queue (ISSUE-056), read back by the gate before it will execute
 *  a queued write. Only `approved` executes; anything else is a non-execution. */
export interface ApprovalDecision {
  status: ApprovalStatus;
  decidedBy: string;
  decidedAt: number; // epoch seconds
}

/** The C6 approval-queue seam. Delivery/classification/escalation is ISSUE-056; this slice only enqueues a
 *  proposed write and reads back a decision. Async so a live adapter matches. */
export interface ApprovalQueue {
  /** Route a proposed write into the queue. Returns the proposal id. NO external effect is performed by this
   *  call — the write is suspended awaiting a human decision (AC-3.ACT.001.1). */
  enqueue(proposal: WriteProposal, now: number): Promise<string>;
  /** Read a queued proposal back (for the gate + the no-effect-while-pending assertion). */
  get(proposalId: string): Promise<QueuedProposal | null>;
  /** Record an authorized human's decision on a queued proposal. `decidedBy` must be an actor distinct from
   *  the agent that proposed it — a queue can never approve its own proposal (hard limit #6). */
  decide(proposalId: string, decision: ApprovalDecision): Promise<QueuedProposal>;
}

/** Raised when a decision would be a self-approval — the decider is the AI/agent path that proposed the
 *  write. Mirrors hard limit #6 (self_approve) at the queue seam: the queue refuses to record it. */
export class SelfApprovalRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SelfApprovalRejected';
  }
}

/** The sentinel actor id the agent/service path proposes writes under. A decision recorded under this actor
 *  is a self-approval and is refused (hard limit #6). A real human approver has a profiles.id, never this. */
export const AGENT_PROPOSER_ACTOR = 'service_role:agent';

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// In-memory fake — reference model. Deterministic (caller-supplied `now`; no Date.now()/random).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
export class InMemoryApprovalQueue implements ApprovalQueue {
  private seq = 0;
  readonly proposals = new Map<string, QueuedProposal>();

  private nextId(): string {
    this.seq += 1;
    return `apr-${String(this.seq).padStart(4, '0')}`;
  }
  private iso(now: number): string {
    return new Date(now * 1000).toISOString();
  }

  async enqueue(proposal: WriteProposal, now: number): Promise<string> {
    const row: QueuedProposal = {
      id: this.nextId(),
      proposal,
      status: 'pending',
      externalEffectPerformed: false, // NOTHING has touched the outside world yet (AC-3.ACT.001.1)
      createdAt: this.iso(now),
      decidedAt: null,
      decidedBy: null,
    };
    this.proposals.set(row.id, row);
    return row.id;
  }

  async get(proposalId: string): Promise<QueuedProposal | null> {
    return this.proposals.get(proposalId) ?? null;
  }

  async decide(proposalId: string, decision: ApprovalDecision): Promise<QueuedProposal> {
    const row = this.proposals.get(proposalId);
    if (!row) throw new Error(`approval proposal ${proposalId} not found`);
    // Self-approval is impossible on this path — a decision recorded under the agent/service proposer actor
    // is refused (hard limit #6 self_approve, mirrored at the queue seam). Only a distinct authorized human
    // may decide (C6/RBAC, ISSUE-056).
    if (decision.decidedBy === AGENT_PROPOSER_ACTOR) {
      throw new SelfApprovalRejected(
        `proposal ${proposalId}: the agent/service path cannot approve its own queued write ` +
          `(hard limit #6 self_approve — a decision requires a distinct authorized human, ISSUE-056)`,
      );
    }
    const next: QueuedProposal = {
      ...row,
      status: decision.status,
      decidedAt: this.iso(decision.decidedAt),
      decidedBy: decision.decidedBy,
    };
    this.proposals.set(proposalId, next);
    return next;
  }
}
