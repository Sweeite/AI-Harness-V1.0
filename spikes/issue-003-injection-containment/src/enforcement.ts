// ISSUE-003 §8.2 (the enforcement matrix under test) — the CODE-LAYER GATE.
// FR-6.HRD.001 (seven hard limits) · FR-6.APR.002 (hard-approval floor) · NFR-SEC.004 · ADR-007 part 1.
//
// THE LOAD-BEARING RULE (ADR-007 part 1): this gate decides SOLELY on the structural facts of the
// Action + Actor (kind of action, actor authority, deployment identity, presence of a genuine human
// hard-approval token). It NEVER reads, parses, or is influenced by the natural-language content that
// motivated the action. Prompt content — however cleverly injected — cannot reach any branch here.
// There is deliberately NO parameter on this function through which prompt text flows.

import {
  HARD_LIMITS,
  type Action,
  type Actor,
  type ApprovalClass,
  type HardLimitId,
  type HumanApprovalToken,
} from './config.js';
import type { AppendOnlyStore } from './store.js';

export interface Decision {
  allowed: boolean;
  // Which control stood in the path. For a block, the hard limit / floor that fired.
  control: 'hard_limit' | 'approval_floor' | 'rls_isolation' | 'allowed_autonomous' | 'allowed_human_approved';
  hardLimit?: HardLimitId;
  approvalClass?: ApprovalClass;
  // NFR-SEC.004.1 — is there ANY affordance a human could use to approve this? For an absolute
  // hard limit (HL4–HL7) the answer is false: no approve button exists anywhere in the product.
  approvable: boolean;
  reason: string;
  guardrailRowId?: string;
}

// Is a token a genuine human hard-approval for THIS action? An agent can never forge one:
// `approverKind` must be 'human' and it must reference this action. (Self-approval = HL6.)
function hasValidHumanApproval(action: Action, actor: Actor, actionRef: string): boolean {
  const t: HumanApprovalToken | undefined = actor.hardApprovalToken;
  return !!t && t.approverKind === 'human' && t.tier === 'hard' && t.actionRef === actionRef;
}

/**
 * enforce — the single choke point every consequential side effect must pass through, BEFORE it
 * executes. Returns a Decision and (on a block) writes the guardrail_log row loudly (ADR-007 pt5).
 *
 * Note the signature: (action, actor, store, actionRef). No prompt/content parameter exists — the
 * gate is structurally incapable of being swayed by injected text (ADR-007 part 1 / AC-6.HRD.001.1).
 */
export function enforce(action: Action, actor: Actor, store: AppendOnlyStore, taskId: string, actionRef: string): Decision {
  const humanApproved = hasValidHumanApproval(action, actor, actionRef);

  // Helper: emit a hard_limit block row (action_blocked=true, status pending, never approvable→approved).
  const blockHard = (hl: HardLimitId, approvable: boolean, reason: string): Decision => {
    const gl = store.logGuardrail({
      task_id: taskId,
      guardrail_type: 'hard_limit',
      description: `HARD LIMIT ${hl} (${HARD_LIMITS[hl].label}) blocked — actor=${actor.id}/${actor.kind}, action=${action.kind}. ${reason}`,
      action_blocked: true,
      status: 'pending',
    });
    return { allowed: false, control: 'hard_limit', hardLimit: hl, approvable, reason, guardrailRowId: gl.id };
  };

  // Helper: emit an approval-floor hold (the action is legitimate WITH a human hard-approval).
  const holdForApproval = (cls: ApprovalClass, reason: string): Decision => {
    const gl = store.logGuardrail({
      task_id: taskId,
      guardrail_type: 'approval',
      description: `HARD-APPROVAL FLOOR (${cls}) — autonomous attempt held for explicit human approval. actor=${actor.id}. ${reason}`,
      action_blocked: true,
      status: 'pending',
    });
    return { allowed: false, control: 'approval_floor', approvalClass: cls, approvable: true, reason, guardrailRowId: gl.id };
  };

  switch (action.kind) {
    // -------------------------------------------------------------------------------------
    // HL4 / RLS + physical isolation (ADR-001/006). Cross-client is ABSOLUTE — no approval path.
    // Checked first: it is the widest-blast-radius breach (#1 knowledge, #2 authorization).
    // -------------------------------------------------------------------------------------
    case 'cross_client_read':
    case 'cross_client_share': {
      if (action.targetDeployment && action.targetDeployment.clientId !== actor.deployment.clientId) {
        return blockHard('HL4', /* approvable */ false, `cross-silo: actor in ${actor.deployment.clientId} targeting ${action.targetDeployment.clientId}; RLS default-deny + physical isolation, no approval can cross silos.`);
      }
      // same-silo read/share of the actor's own client is ordinary — allowed.
      return { allowed: true, control: 'allowed_autonomous', approvable: false, reason: 'same-deployment access' };
    }

    // -------------------------------------------------------------------------------------
    // HL5 impersonation — absolute, no approval affordance.
    // -------------------------------------------------------------------------------------
    case 'impersonate':
      return blockHard('HL5', false, `attempt to impersonate ${action.impersonatedHuman ?? 'a named human'} — absolute, no approve affordance.`);

    // -------------------------------------------------------------------------------------
    // HL6 self-approval — absolute. An agent approving a queued action (esp. one it queued) can
    // never happen; approval is a human-only act. This also forecloses "injection forges approval".
    // -------------------------------------------------------------------------------------
    case 'approve_queued_action': {
      if (actor.kind === 'agent') {
        return blockHard('HL6', false, `agent tried to approve queued action ${action.approvalTarget?.actionRef ?? '?'} — self-approval is structurally impossible; approval is human-only.`);
      }
      // A human approving someone else's queued action is legitimate; a human approving their OWN
      // queued action is still self-approval (HL6).
      if (action.approvalTarget && action.approvalTarget.queuedBy === actor.id) {
        return blockHard('HL6', false, `human ${actor.id} tried to approve their own queued action — self-approval barred.`);
      }
      return { allowed: true, control: 'allowed_human_approved', approvable: true, reason: 'human approving another principal\'s queued action' };
    }

    // -------------------------------------------------------------------------------------
    // HL1 external email / outbound comms — hard limit AUTONOMOUSLY; permitted via hard-approval
    // floor (external_comms, OD-161: no sub-type exempt).
    // -------------------------------------------------------------------------------------
    case 'external_email': {
      if (humanApproved) {
        return { allowed: true, control: 'allowed_human_approved', approvable: true, reason: 'external send carried a valid human hard-approval token' };
      }
      // No token ⇒ autonomous. HL1 blocks the autonomous path; the floor is how a human sends.
      return holdForApproval('external_comms', 'external communication requires explicit human hard approval (no config lowers it; no sub-type exempt).');
    }

    // -------------------------------------------------------------------------------------
    // HL2 financial transaction — same shape as HL1 (floor class: financial).
    // -------------------------------------------------------------------------------------
    case 'financial_transaction': {
      if (humanApproved) {
        return { allowed: true, control: 'allowed_human_approved', approvable: true, reason: 'financial action carried a valid human hard-approval token' };
      }
      return holdForApproval('financial', 'financial operation requires explicit human hard approval.');
    }

    // -------------------------------------------------------------------------------------
    // HL3 delete a record of record — hard limit autonomously; a human may authorize.
    // -------------------------------------------------------------------------------------
    case 'record_delete': {
      if (humanApproved) {
        return { allowed: true, control: 'allowed_human_approved', approvable: true, reason: 'record delete carried a valid human hard-approval token' };
      }
      return blockHard('HL3', /* approvable via human */ true, 'autonomous deletion of a system-of-record row barred; requires explicit human authorization.');
    }

    // -------------------------------------------------------------------------------------
    // Memory write — Confidential/Restricted memory ops are floored to hard approval
    // (FR-6.APR.002). Normal/personal memory writes are ordinary (the sole-writer path is
    // ISSUE-024's concern; here we only assert the approval floor for sensitive tags).
    // -------------------------------------------------------------------------------------
    case 'memory_write': {
      const sens = action.memorySensitivity ?? 'normal';
      if (sens === 'confidential' || sens === 'restricted') {
        if (humanApproved) {
          return { allowed: true, control: 'allowed_human_approved', approvable: true, reason: `${sens} memory op carried a valid human hard-approval token` };
        }
        return holdForApproval('confidential_restricted_memory', `${sens}-tagged memory operation requires explicit human hard approval.`);
      }
      return { allowed: true, control: 'allowed_autonomous', approvable: false, reason: 'normal/personal memory write' };
    }

    // -------------------------------------------------------------------------------------
    // Benign, non-consequential action — the negative-control surface. Always allowed; proves the
    // gate is not a brick that blocks everything.
    // -------------------------------------------------------------------------------------
    case 'internal_note':
      return { allowed: true, control: 'allowed_autonomous', approvable: false, reason: 'non-consequential internal note' };
  }
}
