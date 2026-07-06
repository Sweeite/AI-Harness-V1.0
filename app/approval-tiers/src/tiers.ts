// ISSUE-056 (C6 APR) — the PURE tier-policy layer: classify a gated action into exactly one approval tier
// (auto / soft / hard), enforce the non-downgradable mandatory-hard FLOOR, and resolve contextual reviewer
// routing with no-self-approval. No DB, no timers — a pure function of the attempt + config, so the #2
// invariants (floor holds regardless of config; default-hard-if-uncertain; initiator ≠ approver) are proven
// in a unit test with no live infra. The store.ts / supabase-store.ts layers ENACT the decisions this makes.
//
// Rule of the slice (🔴 #2 / #3 HIGH-CARE):
//   - The mandatory-hard floor is NON-DOWNGRADABLE IN CODE. No `action_autonomy_matrix` value, no role, no
//     instruction can lower a floored action below hard (AC-6.APR.002.1). The classifier deliberately reads
//     the matrix ONLY to explain/raise a tier, never to lower a floored one.
//   - DEFAULT-HARD-IF-UNCERTAIN. An action that cannot be proven auto/soft-safe is hard-approval, never
//     auto-allowed (AC-6.APR.001.1 / #2 fail-safe).
//   - Soft tier is REVERSIBLE-ONLY. An irreversible action can never be soft (it is forced hard) — so the
//     soft auto-run path (store.ts) can never auto-run an irreversible effect (AC-6.APR.003.1).
//   - NO SELF-APPROVAL. The routed reviewer identity may never equal the initiator identity — the human-tier
//     expression of hard limit #6 (AC-6.APR.005.3).

// ── The three tiers (design-doc L2777–2782; FR-6.APR.001) ─────────────────────────────────────────────
export const APPROVAL_TIERS = ['auto', 'soft', 'hard'] as const;
export type ApprovalTier = (typeof APPROVAL_TIERS)[number];

export function isApprovalTier(v: unknown): v is ApprovalTier {
  return typeof v === 'string' && (APPROVAL_TIERS as readonly string[]).includes(v);
}

// ── risk_level (C3 FR-3.REG.001) — the coarse risk band that seeds the tier before the floor is applied. ──
export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

// ── The floored action categories (FR-6.APR.002 / OD-161). These are ALWAYS hard, regardless of config. ──
// Each maps to a design-doc mandatory-hard trigger. `external_comm` covers ALL outbound comms to a party
// outside the deployment — no sub-type exemption (OD-161 retired the OD-088 low-risk-external carve-out).
export const FLOORED_CATEGORIES = [
  'external_comm', //           any outbound communication to a party outside the deployment (OD-161: no sub-type exempt)
  'financial_operation', //     a financial-record operation
  'confidential_memory_op', //  a Confidential-tagged memory operation (C1 FR-1.CLR.001)
  'restricted_memory_op', //    a Restricted-tagged memory operation (C1 FR-1.CLR.004 → routes to grantee/Super-Admin)
  'bulk_export', //             FR-6.HRD.004 gated extension
  'mass_delete', //             FR-6.HRD.004 gated extension
  'connector_spend', //         FR-6.HRD.004 gated extension
  'destructive_config', //      FR-6.HRD.004 gated extension
] as const;
export type FlooredCategory = (typeof FLOORED_CATEGORIES)[number];

export function isFlooredCategory(v: unknown): v is FlooredCategory {
  return typeof v === 'string' && (FLOORED_CATEGORIES as readonly string[]).includes(v);
}

// ── The gated action the classifier evaluates. Reversibility/sensitivity + the floored-category set drive
// the floor; risk_level seeds the non-floored tier; the routing context picks the reviewer. ─────────────
export interface GatedAction {
  /** stable id of the action / the task_queue row it belongs to (for the log line + routing). */
  actionType: string;
  /** C3 risk band. `undefined` ⇒ UNKNOWN ⇒ default-hard (AC-6.APR.001.1 fail-safe). */
  riskLevel?: RiskLevel;
  /** true if the action's effect can be compensated/undone. `undefined` ⇒ treat as IRREVERSIBLE (fail closed):
   *  an unproven-reversible action can never be soft (it is forced hard) — never auto-runs (#2). */
  reversible?: boolean;
  /** every floored category this action falls into (may be several). ANY entry ⇒ hard floor. */
  flooredCategories?: readonly FlooredCategory[];
  /** the routing context (e.g. 'crm_update', 'financial_flag') used to pick the reviewer role. */
  routingContext?: string;
  /** the identity that initiated/queued this action — its own approval is forbidden (#6, AC-6.APR.005.3). */
  originatingUserId?: string | null;
}

// ── The `action_autonomy_matrix` (CFG) as consumed here: a per-action-type tier hint the operator sets on
// surface-01. It can RAISE a tier (a cautious operator forces hard) but can NEVER lower a floored action
// below hard — that lowering is refused in code, not config (AC-6.APR.002.1). Absent entry ⇒ no hint. ─────
export interface AutonomyMatrix {
  /** the operator-configured tier for an action type, or undefined if the type has no entry. */
  tierFor(actionType: string): ApprovalTier | undefined;
}
/** An empty matrix — every action falls through to the risk-derived tier + the floor. */
export const EMPTY_AUTONOMY_MATRIX: AutonomyMatrix = { tierFor: () => undefined };

export interface TierDecision {
  tier: ApprovalTier;
  /** true when the tier is a NON-DOWNGRADABLE floor (FR-6.APR.002) — the surface renders a locked badge. */
  floored: boolean;
  /** the floored category that forced hard (if any) — for the guardrail_log description + the surface note. */
  flooredBy?: FlooredCategory;
  /** operator-facing one-liner explaining the tier (goes into the log description / the surface rationale). */
  reason: string;
  /** true when the tier was assigned by the fail-safe default (uncertain classification → hard). */
  defaultedHard: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// THE CLASSIFIER. Pure: (action, matrix) → TierDecision. Assigns EXACTLY ONE tier; the floor wins over any
// config; uncertain ⇒ hard. This is the AC-6.APR.001.1 / AC-6.APR.002.1 decision point.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
export function classifyTier(action: GatedAction, matrix: AutonomyMatrix = EMPTY_AUTONOMY_MATRIX): TierDecision {
  // 1. THE FLOOR FIRST — non-downgradable. If the action falls into ANY floored category it is hard, full
  //    stop, regardless of risk_level, the matrix, or reversibility. (AC-6.APR.002.1 — the load-bearing #2.)
  const floored = (action.flooredCategories ?? []).filter(isFlooredCategory);
  if (floored.length > 0) {
    const by = floored[0]!;
    return {
      tier: 'hard',
      floored: true,
      flooredBy: by,
      reason: `mandatory hard-approval floor: '${by}' is never auto/soft (FR-6.APR.002 / OD-161) [${action.actionType}]`,
      defaultedHard: false,
    };
  }

  // 2. Non-floored: seed from risk_level. UNKNOWN risk ⇒ default hard (fail-safe, AC-6.APR.001.1 / #2).
  if (action.riskLevel === undefined) {
    return {
      tier: 'hard',
      floored: false,
      reason: `risk_level unknown — defaulting to hard-approval (fail-safe, AC-6.APR.001.1) [${action.actionType}]`,
      defaultedHard: true,
    };
  }

  let seeded: ApprovalTier;
  switch (action.riskLevel) {
    case 'low':
      seeded = 'auto';
      break;
    case 'medium':
      seeded = 'soft';
      break;
    case 'high':
      seeded = 'hard';
      break;
    default:
      // Unreachable given the union, but fail closed on an unexpected value (#2).
      return {
        tier: 'hard',
        floored: false,
        reason: `unrecognised risk_level '${String(action.riskLevel)}' — defaulting to hard (fail-safe) [${action.actionType}]`,
        defaultedHard: true,
      };
  }

  // 3. Reversibility gate for the soft tier: soft is REVERSIBLE-ONLY. An irreversible (or unproven-reversible)
  //    action can never be soft — it is raised to hard so the soft auto-run path can never touch it
  //    (AC-6.APR.003.1). reversible === undefined is treated as irreversible (fail closed).
  if (seeded === 'soft' && action.reversible !== true) {
    seeded = 'hard';
    // fall through to the matrix step; the matrix can only raise further, never lower.
  }

  // 4. The autonomy matrix may RAISE the tier (operator caution) but NEVER lower it. We take the more
  //    restrictive of {seeded, matrix hint}. (A floored action never reaches here — step 1 returned.)
  const hint = matrix.tierFor(action.actionType);
  const effective = hint ? mostRestrictiveTier(seeded, hint) : seeded;

  const raised = effective !== seeded;
  return {
    tier: effective,
    floored: false,
    reason: raised
      ? `risk '${action.riskLevel}' seeded ${seeded}; action_autonomy_matrix raised to ${effective} [${action.actionType}]`
      : seeded === 'hard' && action.riskLevel === 'medium'
        ? `risk 'medium' but irreversible/unproven-reversible → raised to hard (soft is reversible-only, FR-6.APR.003) [${action.actionType}]`
        : `risk '${action.riskLevel}' → ${effective}-approval [${action.actionType}]`,
    defaultedHard: false,
  };
}

/** most-restrictive of two tiers: hard > soft > auto. Used by the matrix-raise step + the ESC multi-fire. */
export function mostRestrictiveTier(a: ApprovalTier, b: ApprovalTier): ApprovalTier {
  const rank: Record<ApprovalTier, number> = { auto: 0, soft: 1, hard: 2 };
  return rank[a] >= rank[b] ? a : b;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// CONTEXTUAL ROUTING (FR-6.APR.005) + no-self-approval (AC-6.APR.005.3). Pure: (action, rules, availability)
// → routing outcome. Never leaves an item unrouted (#3) and never routes to the initiator (#6).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** A reviewer candidate — a role plus the concrete identity that currently fills it (for the self-approval
 *  check + availability). Several candidates may fill one role (fallback). */
export interface Reviewer {
  role: string;
  identity: string;
  available: boolean;
}

/** The routing rule set: action-context → reviewer role. Plus a mandatory default role (never-unrouted). */
export interface RoutingRules {
  /** the reviewer role for a routing context, or undefined if no rule matches (→ default). */
  roleForContext(context: string | undefined): string | undefined;
  /** the default reviewer role when no rule matches (AC-6.APR.005.1 — never unrouted). */
  defaultRole: string;
  /** the escalation-terminus role (e.g. Super-Admin) when even the fallback is unavailable/self. */
  escalationRole: string;
}

export interface RoutingOutcome {
  /** the resolved reviewer identity, or null when it had to escalate with no eligible reviewer. */
  reviewerIdentity: string | null;
  /** the role the item was routed to (the matched role, or default, or escalation). */
  routedRole: string;
  /** true when routing had to fall back / escalate (unavailable reviewer or self-approval collision). */
  escalated: boolean;
  /** operator-facing one-liner (why this reviewer / why escalated) — never empty (#3). */
  reason: string;
}

export const ERR_NO_ELIGIBLE_REVIEWER =
  'approval-routing: no eligible non-initiating reviewer available even at the escalation terminus — item stays flagged + escalates, never silently auto-resolved (#3, AC-6.APR.005.2)';

/**
 * Resolve the reviewer for a gated/flagged item. Chooses the context role (or the default), then picks an
 * AVAILABLE candidate in that role who is NOT the initiator. On no eligible candidate it falls to the
 * escalation role (still excluding the initiator). If even that has no eligible reviewer it returns
 * reviewerIdentity=null with escalated=true — the caller keeps the item flagged and escalates (never
 * auto-resolves — #3). NEVER returns the initiator as the reviewer (AC-6.APR.005.3 / #6).
 */
export function routeApproval(
  action: GatedAction,
  candidates: readonly Reviewer[],
  rules: RoutingRules,
): RoutingOutcome {
  const initiator = action.originatingUserId ?? null;
  const matchedRole = rules.roleForContext(action.routingContext);
  const primaryRole = matchedRole ?? rules.defaultRole; // never unrouted (AC-6.APR.005.1 / #3)
  const usedDefault = matchedRole === undefined;

  // Eligible = in the target role, available, and NOT the initiator (self-approval forbidden — #6).
  const pick = (role: string): Reviewer | undefined =>
    candidates.find((c) => c.role === role && c.available && c.identity !== initiator);

  const primary = pick(primaryRole);
  if (primary) {
    return {
      reviewerIdentity: primary.identity,
      routedRole: primaryRole,
      escalated: false,
      reason: usedDefault
        ? `no context rule for '${action.routingContext ?? '∅'}' → default reviewer role '${primaryRole}' (${primary.identity})`
        : `routed '${action.routingContext}' → reviewer role '${primaryRole}' (${primary.identity})`,
    };
  }

  // Primary role had no eligible reviewer (all unavailable, or the only candidate is the initiator). Fall
  // back + escalate to the escalation terminus role (AC-6.APR.005.2 / AC-6.ESC.004.2), still excluding self.
  const escalated = pick(rules.escalationRole);
  if (escalated) {
    return {
      reviewerIdentity: escalated.identity,
      routedRole: rules.escalationRole,
      escalated: true,
      reason: `role '${primaryRole}' had no eligible non-initiating reviewer → escalated to '${rules.escalationRole}' (${escalated.identity})`,
    };
  }

  // No eligible reviewer anywhere — including the possibility that the initiator IS the only Super-Admin.
  // We refuse to auto-resolve; the item stays flagged and the caller escalates further (#3, never silent).
  return {
    reviewerIdentity: null,
    routedRole: rules.escalationRole,
    escalated: true,
    reason: ERR_NO_ELIGIBLE_REVIEWER,
  };
}
