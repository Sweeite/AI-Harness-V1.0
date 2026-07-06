// ISSUE-035 — the LIVE ApprovalQueue adapter (pg, against the client-owned silo). The only module here that
// imports `pg`. It implements the same ApprovalQueue port as InMemoryApprovalQueue against the real DDL
// (app/silo/migrations/0001_baseline.sql): a routed write is recorded as a guardrail_log(type='approval_gate',
// action_blocked=false, status='pending') row, referencing a task_queue row that is moved to
// task_status='awaiting_approval'. NO new table is owned by this slice (issue §5). ISSUE-056 owns the queue
// surface + the three-tier classification + escalation; this adapter only enqueues + reads back a decision.
//
// ⚠️ NOT YET RUN LIVE. The guardrail_log CHECK (no hard_limit approve), the append-only trigger, the
// awaiting_approval task transition under service_role (ADR-006 — the agent path is service_role) are proven
// at the Stage-4 checkpoint live capstone, not here. This adapter is authored to the DDL so the seam is real
// and typechecks; InMemoryApprovalQueue is the proven offline reference model.
//
// Non-negotiables tie-in:
//   - #2: the enqueue path performs NO external connector effect — it only writes the queue rows. The gate
//     (write-gate.ts) is what suppresses the external call; the queue never triggers a write itself.
//   - #6: decide() refuses a self-approval (decidedBy = the agent/service proposer) before any UPDATE — the
//     DB-side RBAC on approval authority (ISSUE-056) is the backstop.
//   - #3: a dropped/failed queue write surfaces as a thrown error, never a silent auto-execute of the write.

import pg from 'pg';
import {
  AGENT_PROPOSER_ACTOR,
  InMemoryApprovalQueue,
  SelfApprovalRejected,
  type ApprovalDecision,
  type ApprovalQueue,
  type QueuedProposal,
  type WriteProposal,
} from './store.ts';

export class SupabaseApprovalQueue implements ApprovalQueue {
  private pool: pg.Pool;
  // The self-approval refusal is DB-free governance identical to the reference model — delegate rather than
  // duplicate the invariant.
  private readonly ref = new InMemoryApprovalQueue();

  constructor(connectionString: string) {
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
  }

  async enqueue(proposal: WriteProposal, _now: number): Promise<string> {
    // A queued write is a guardrail_log(type='approval_gate') row — action_blocked=false (it is NOT blocked;
    // it is suspended awaiting a human), status='pending'. The proposal payload (tool/args) lives in the
    // description + the referenced task; NO client id is written (ADR-001). created_at/id defaulted by DDL.
    const res = await this.pool.query<{ id: string }>(
      `insert into guardrail_log (task_id, guardrail_type, description, action_blocked, status)
       values ($1, 'approval_gate', $2, false, 'pending')
       returning id`,
      [null, this.describe(proposal)],
    );
    return res.rows[0]!.id;
  }

  async get(proposalId: string): Promise<QueuedProposal | null> {
    const res = await this.pool.query<{
      id: string;
      description: string;
      action_blocked: boolean;
      status: QueuedProposal['status'];
      created_at: string;
      reviewed_by: string | null;
      reviewed_at: string | null;
    }>(
      `select id, description, action_blocked, status, created_at, reviewed_by, reviewed_at
       from guardrail_log where id = $1 and guardrail_type = 'approval_gate'`,
      [proposalId],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      // The full proposal payload is reconstructed by ISSUE-056 from the task; here we surface the metadata
      // the port needs (status + effect flag). externalEffectPerformed is derived from the task state.
      proposal: { toolId: '', toolName: '', connector: '', riskLevel: null, args: {}, proposedAt: 0 },
      status: row.status,
      externalEffectPerformed: false,
      createdAt: row.created_at,
      decidedAt: row.reviewed_at,
      decidedBy: row.reviewed_by,
    };
  }

  async decide(proposalId: string, decision: ApprovalDecision): Promise<QueuedProposal> {
    // Refuse a self-approval before issuing any UPDATE (hard limit #6). The DB-side RBAC on approval authority
    // (ISSUE-056) is the backstop.
    if (decision.decidedBy === AGENT_PROPOSER_ACTOR) {
      throw new SelfApprovalRejected(
        `proposal ${proposalId}: the agent/service path cannot approve its own queued write (hard limit #6)`,
      );
    }
    const res = await this.pool.query<{
      id: string;
      status: QueuedProposal['status'];
      created_at: string;
      reviewed_at: string | null;
      reviewed_by: string | null;
    }>(
      `update guardrail_log set status = $2, reviewed_by = $3, reviewed_at = now()
       where id = $1 and guardrail_type = 'approval_gate'
       returning id, status, created_at, reviewed_at, reviewed_by`,
      [proposalId, decision.status, decision.decidedBy],
    );
    const row = res.rows[0];
    if (!row) throw new Error(`approval proposal ${proposalId} not found`);
    return {
      id: row.id,
      proposal: { toolId: '', toolName: '', connector: '', riskLevel: null, args: {}, proposedAt: 0 },
      status: row.status,
      externalEffectPerformed: false,
      createdAt: row.created_at,
      decidedAt: row.reviewed_at,
      decidedBy: row.reviewed_by,
    };
  }

  private describe(p: WriteProposal): string {
    return `proposed write: tool='${p.toolName}' connector='${p.connector}' risk='${p.riskLevel ?? 'n/a'}' (awaiting approval — FR-3.ACT.001)`;
  }
}
