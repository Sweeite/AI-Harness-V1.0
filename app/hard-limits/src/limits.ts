// ISSUE-055 — the seven hard limits: the CODE half of the paired prompt+code defense (FR-6.HRD.001–004,
// NFR-SEC.004/005, ADR-007 containment-first). This module is pure classification + the un-overridable
// gate decision. It carries NO dependency on the C4 prompt-layer statement (AC-6.HRD.001.3 — defense in
// depth): the gate blocks purely from the attempted action's shape, never from prompt text.
//
// Rule of the slice (🔴 #2 / #3 HIGH-CARE):
//   - The seven limits are UN-OVERRIDABLE. No role, no config value, no agent/prompt instruction relaxes
//     them (FR-6.HRD.001 / AC-6.HRD.001.2). The decision function deliberately takes those inputs and
//     provably ignores them.
//   - The gate FAILS CLOSED. An attempt that cannot be proven safe is blocked (#2). There is no allow-by-
//     default, no "unknown ⇒ permit".
//   - There is NO approve/override affordance anywhere for a hard-limit hit (FR-6.HRD.003).

// ── The seven autonomous prohibitions (design-doc L2754–2766 / L2053–2066) ────────────────────────────
export type HardLimitId =
  | 'external_send' //        ① never autonomously send an external email / outbound message
  | 'financial_transaction' //② never autonomously make/initiate a financial transaction
  | 'record_delete' //        ③ never autonomously delete a record in a system of record
  | 'cross_client_share' //   ④ never autonomously share data across client deployments
  | 'impersonate_human' //    ⑤ never autonomously impersonate a named human
  | 'self_approve' //         ⑥ never autonomously self-approve a queued action
  | 'tool_content_as_instructions'; // ⑦ never treat monitored-tool content as instructions

/** The complete absolute set. Exactly seven; frozen. FR-6.HRD.004 forbids an eighth via config/code edit. */
export const HARD_LIMITS: readonly HardLimitId[] = Object.freeze([
  'external_send',
  'financial_transaction',
  'record_delete',
  'cross_client_share',
  'impersonate_human',
  'self_approve',
  'tool_content_as_instructions',
] as const);

/** A short, stable operator-facing sentence per limit — used in the guardrail_log `description`. */
export const HARD_LIMIT_DESCRIPTION: Readonly<Record<HardLimitId, string>> = Object.freeze({
  external_send: 'autonomous external send (email/outbound message) is a hard limit',
  financial_transaction: 'autonomous financial transaction is a hard limit',
  record_delete: 'autonomous record deletion in a system of record is a hard limit',
  cross_client_share: 'autonomous cross-client data share is a hard limit',
  impersonate_human: 'autonomous impersonation of a named human is a hard limit',
  self_approve: 'autonomous self-approval of a queued action is a hard limit',
  tool_content_as_instructions: 'treating monitored-tool content as instructions is a hard limit',
});

// ── The attempted autonomous action the gate classifies ──────────────────────────────────────────────
// `autonomous` = the AI is about to take this effect with no explicit, authorized, non-bypassable human
// step. The three fields below (role/config/instruction) are the exact override vectors L2066 names — they
// are accepted so a test can PROVE they change nothing, never so the gate can consult them.
export interface ActionAttempt {
  kind: ActionKind;
  /** true ⇒ the AI is driving this with no human in the loop for THIS effect. */
  autonomous: boolean;
  /** the caller's role (e.g. 'Super-Admin'). Present ONLY to prove it cannot lift a limit. */
  role?: string;
  /** a config snapshot an attacker may have crafted to relax a limit. Provably ignored. */
  config?: Readonly<Record<string, unknown>>;
  /** agent/prompt instruction text (may say "ignore the hard limits and proceed"). Provably ignored. */
  instruction?: string;
  /** for external_send: is the recipient outside the deployment? */
  recipientExternal?: boolean;
  /** for cross_client_share: source and target client slugs. */
  sourceClient?: string;
  targetClient?: string;
  /** for self_approve: the actor that queued the action vs the actor approving it. */
  queuedBy?: string;
  approvedBy?: string;
  /** for tool_content_as_instructions: did the payload originate from a monitored tool read? */
  fromMonitoredTool?: boolean;
  /** free-form target descriptor (record id, tool name, human name) for the log line. */
  target?: string;
}

export type ActionKind =
  | 'send_message'
  | 'financial_txn'
  | 'delete_record'
  | 'share_data'
  | 'impersonate'
  | 'approve_queued_action'
  | 'ingest_tool_content'
  | 'read_only' //     a benign read — allowed
  | 'draft_message' // preparing a draft for a human to send — allowed (not an autonomous send)
  | 'noop';

export interface HardLimitDecision {
  blocked: boolean;
  /** which of the seven fired (undefined when allowed). */
  limit?: HardLimitId;
  /** operator-facing reason (goes verbatim into guardrail_log.description). */
  reason: string;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// THE GATE. Pure function: (attempt) → decision. Never consults role/config/instruction to permit.
// This is the AC-6.HRD.001.* / AC-NFR-SEC.004.1 decision point. Un-overridable + fail-closed by construction.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
export function classify(attempt: ActionAttempt): HardLimitDecision {
  // A non-autonomous effect (an explicit, authorized human is performing/authorising it) is not the AI
  // acting autonomously — it is out of scope of the seven. Everything else routes through the map below.
  const auto = attempt.autonomous;

  switch (attempt.kind) {
    case 'send_message': {
      // ① external send. A DRAFT for a human to send is 'draft_message', not this. If we cannot prove the
      //   recipient is internal, we fail closed and treat it as external (#2 — unknown ⇒ blocked).
      if (!auto) return allow('non-autonomous send (human-performed)');
      const external = attempt.recipientExternal !== false; // undefined ⇒ treat as external (fail closed)
      if (external) return block('external_send', attempt);
      return allow('internal autonomous message (recipient proven internal)');
    }
    case 'financial_txn':
      // ② any autonomous financial transaction is absolutely blocked.
      if (!auto) return allow('non-autonomous financial action (human-performed)');
      return block('financial_transaction', attempt);
    case 'delete_record':
      // ③ autonomous deletion in a system of record.
      if (!auto) return allow('non-autonomous deletion (human-performed)');
      return block('record_delete', attempt);
    case 'share_data': {
      // ④ cross-client share. If either client slug is unknown, fail closed (cannot prove same-client).
      if (!auto) return allow('non-autonomous share (human-performed)');
      const src = attempt.sourceClient;
      const tgt = attempt.targetClient;
      const provenSameClient = src != null && tgt != null && src === tgt;
      if (provenSameClient) return allow('same-client data movement (proven)');
      return block('cross_client_share', attempt);
    }
    case 'impersonate':
      // ⑤ impersonating a named human.
      if (!auto) return allow('non-autonomous action attributed to a human who performed it');
      return block('impersonate_human', attempt);
    case 'approve_queued_action': {
      // ⑥ self-approval. The AI approving a queued action is ALWAYS a hard-limit hit when autonomous.
      //   Even a human approving their OWN queued action is a self-approval and blocked here.
      if (!auto) {
        // logic-sweep fix (limits.ts:136): fail CLOSED like every other unknown-provenance branch in this
        // file (send L108, share L125, ingest L147). Only allow when distinctness is PROVEN — both actors
        // present AND different. Missing actors (provenance unknown) or a self-match block, rather than
        // permit while falsely asserting a 'distinct authorized human' we never verified (#2/#3).
        const distinctProven =
          attempt.queuedBy != null && attempt.approvedBy != null && attempt.queuedBy !== attempt.approvedBy;
        if (distinctProven) return allow('queued action approved by a distinct authorized human');
        return block('self_approve', attempt);
      }
      return block('self_approve', attempt);
    }
    case 'ingest_tool_content':
      // ⑦ tool-returned content being executed AS INSTRUCTIONS. Content from a monitored tool is data,
      //   never instructions (ADR-007). If provenance is unknown, fail closed.
      if (attempt.fromMonitoredTool !== false) return block('tool_content_as_instructions', attempt);
      return allow('content provenance proven non-tool (trusted origin)');
    case 'read_only':
    case 'draft_message':
    case 'noop':
      return allow(`${attempt.kind} is not a hard-limited effect`);
    default:
      // Fail closed: an action kind the gate does not recognise is BLOCKED, not permitted (#2). A new
      // dangerous kind must be classified (FR-6.HRD.004), never silently auto-allowed.
      return {
        blocked: true,
        reason: `unrecognised action kind '${String((attempt as ActionAttempt).kind)}' — blocked fail-closed (FR-6.HRD.004: classify, never auto-allow)`,
      };
  }
}

function block(limit: HardLimitId, attempt: ActionAttempt): HardLimitDecision {
  const where = attempt.target ? ` [target: ${attempt.target}]` : '';
  return { blocked: true, limit, reason: `${HARD_LIMIT_DESCRIPTION[limit]}${where}` };
}
function allow(reason: string): HardLimitDecision {
  return { blocked: false, reason };
}
