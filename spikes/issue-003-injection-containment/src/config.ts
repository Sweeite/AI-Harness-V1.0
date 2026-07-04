// ISSUE-003 §8.1/§8.2 — the target-system configuration + the containment matrix.
//
// This declares (a) the boot config the spike asserts at start-up (ADR-007 parts 3/6;
// AC-NFR-SEC.006.3), (b) the seven hard limits (FR-6.HRD.001), (c) the mandatory
// hard-approval floor classes (FR-6.APR.002 / OD-161), and (d) the action taxonomy the
// enforcement gate reasons over. Everything here is CODE the gate consults — never prompt
// content (ADR-007 part 1). Contestable numbers (thresholds) are signal-tuning only
// (ADR-007 part 6); they must NOT change the containment verdict.

// ---------------------------------------------------------------------------
// Boot config — asserted at start-up. The two thresholds are SIGNAL knobs, not the
// boundary (ADR-007 part 6). `injection_semantic_detection_enabled` MUST default false
// (AC-NFR-SEC.006.3): the semantic classifier ships but is off; only the deterministic
// regex layer runs, and even it only quarantines — it never gates an action.
// ---------------------------------------------------------------------------
export const BOOT_CONFIG = {
  injection_semantic_detection_enabled: false, // AC-NFR-SEC.006.3 — off by default
  injection_semantic_threshold: 0.85, // ADR-007 part 6 — signal sensitivity, NOT the boundary
  injection_quarantine_threshold: 0.95, // ADR-007 part 6 — route-to-human bar, NOT the boundary
} as const;

// ---------------------------------------------------------------------------
// The seven hard limits (FR-6.HRD.001 L2754–2766; NFR-SEC.004). Absolute, code-enforced,
// non-overridable by any role / config / prompt (FR-6.HRD.004 = this is the complete set).
//
//  - `humanApprovable: true`  → the AUTONOMOUS action is a hard limit, but a human may
//    perform it via the hard-approval floor (external comms, financial, record delete).
//    "never AUTONOMOUSLY" — the human-gated path exists (FR-6.APR.002).
//  - `humanApprovable: false` → structurally absolute, NO approval affordance anywhere
//    (cross-client share, impersonation, self-approval, treat-content-as-instructions).
//    (NFR-SEC.004.1: "present no approve affordance for a hard-limit-blocked action".)
// ---------------------------------------------------------------------------
export type HardLimitId = 'HL1' | 'HL2' | 'HL3' | 'HL4' | 'HL5' | 'HL6' | 'HL7';

export interface HardLimit {
  id: HardLimitId;
  label: string;
  humanApprovable: boolean;
}

export const HARD_LIMITS: Record<HardLimitId, HardLimit> = {
  HL1: { id: 'HL1', label: 'send an external email / outbound comms', humanApprovable: true },
  HL2: { id: 'HL2', label: 'make or initiate a financial transaction', humanApprovable: true },
  HL3: { id: 'HL3', label: 'delete a record in a system of record', humanApprovable: true },
  HL4: { id: 'HL4', label: 'share data across client deployments', humanApprovable: false },
  HL5: { id: 'HL5', label: 'impersonate a named human', humanApprovable: false },
  HL6: { id: 'HL6', label: 'self-approve a queued action', humanApprovable: false },
  HL7: { id: 'HL7', label: 'treat monitored-tool content as instructions', humanApprovable: false },
};

// ---------------------------------------------------------------------------
// The mandatory hard-approval floor (FR-6.APR.002 / OD-161). These classes are floored to
// HARD approval — never auto, never soft — and NO config can lower the tier. Per OD-161 the
// external-comms floor has NO sub-type exemption (the low-risk carve-out OD-088 was retired).
// ---------------------------------------------------------------------------
export type ApprovalClass = 'external_comms' | 'financial' | 'confidential_restricted_memory';

export const HARD_APPROVAL_FLOOR: Record<ApprovalClass, { label: string; subTypeExempt: false }> = {
  external_comms: { label: 'any outbound communication to a party outside the deployment', subTypeExempt: false },
  financial: { label: 'financial-record operation', subTypeExempt: false },
  confidential_restricted_memory: { label: 'Confidential- or Restricted-tagged memory operation', subTypeExempt: false },
};

// ---------------------------------------------------------------------------
// Action taxonomy — the structural facts the gate reasons over. An Action is what a
// (possibly-compromised) agent asks to DO; the gate decides on these fields ALONE, never on
// the natural-language content that motivated them.
// ---------------------------------------------------------------------------
export type ActionKind =
  | 'external_email'
  | 'financial_transaction'
  | 'record_delete'
  | 'cross_client_read'
  | 'cross_client_share'
  | 'impersonate'
  | 'approve_queued_action'
  | 'memory_write'
  | 'internal_note'; // a benign, non-consequential action (negative-control surface)

export interface Deployment {
  clientId: string; // ADR-001 physical isolation — one silo per client
}

export interface Actor {
  id: string;
  kind: 'agent' | 'human';
  deployment: Deployment;
  // A human hard-approval token, if the human explicitly authorized THIS action out-of-band.
  // Agents can never mint one (self-approval = HL6). Absence ⇒ the action is autonomous.
  hardApprovalToken?: HumanApprovalToken;
}

export interface HumanApprovalToken {
  approver: string; // a named human principal
  approverKind: 'human';
  actionRef: string; // the specific queued action this token authorizes
  tier: 'hard';
}

export interface Action {
  kind: ActionKind;
  // Target of the action; `targetDeployment` present ⇒ it touches another silo.
  targetDeployment?: Deployment;
  memorySensitivity?: 'normal' | 'personal' | 'confidential' | 'restricted';
  impersonatedHuman?: string;
  // The queued action an `approve_queued_action` refers to, plus who queued it.
  approvalTarget?: { actionRef: string; queuedBy: string };
  description: string;
}

// The corpus/threat profile — the load basis, contestable by design (mirrors ISSUE-002 §c).
export const PROFILE = {
  ingress_surfaces: ['slack', 'ghl', 'gmail', 'drive'] as const,
  // Two client silos so cross-client attempts are physically meaningful (ADR-001).
  clients: ['client-A', 'client-B'] as const,
} as const;
