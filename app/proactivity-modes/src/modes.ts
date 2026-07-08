// ISSUE-068 (C9 MODE) — the PURE proactive-autonomy policy layer. No DB, no timers, no I/O: a pure function
// of (item + C6 tier + resolved sub-type + matrix), so the #2 invariants (floor holds regardless of config;
// no floored action ever reaches Act; ambiguous → floored; Act is not a reachable matrix value) are proven in
// a unit test with no live infra. store.ts / supabase-store.ts merely ENACT (persist + audit) these decisions.
//
// Rule of the slice (🔴 #2 / #3 HIGH-CARE — the load-bearing invariants OD-161 restored):
//   - MODE IS MAPPED FROM THE C6 TIER, never from a second classifier (FR-9.MODE.002 / OD-083):
//       auto → Act · soft → Prepare · hard → Suggest (or Prepare-to-hard-queue). Tier unavailable → Suggest.
//   - THE FLOOR IS NON-DOWNGRADABLE IN CODE (FR-9.MODE.004 / OD-161): a floored sub-type is capped at Prepare
//       (hard-approval) — never Act — regardless of the autonomy matrix or the indeterminate default. The floor
//       always wins (AC-9.MODE.004.5). Act is NOT a reachable matrix value for ANY sub-type (AC-9.MODE.004.1).
//   - DEFAULT-CONSERVATIVE: an indeterminate mode / unavailable tier defaults to Suggest, never Act
//       (AC-9.MODE.001.2). A sub-type that cannot be proven non-client/low-risk is treated as floored
//       (AC-9.MODE.004.3) — the fail-safe the AF-131 classifier must uphold before the floor is trusted.

// ── The three proactivity modes (FR-9.MODE.001; design-doc-v4.md L3658–3666). This constant MUST equal the
// `proactive_mode` enum in the silo baseline (0001_baseline.sql L79) — index.ts `check` guards the drift. ────
export const PROACTIVITY_MODES = ['suggest', 'prepare', 'act'] as const;
export type ProactivityMode = (typeof PROACTIVITY_MODES)[number];

export function isProactivityMode(v: unknown): v is ProactivityMode {
  return typeof v === 'string' && (PROACTIVITY_MODES as readonly string[]).includes(v);
}

// Autonomy rank — how much the mode lets the AI do on its own. Higher = more autonomous.
//   suggest (human decides) < prepare (draft-ready, human approves/sends) < act (autonomous within limits).
const MODE_RANK: Record<ProactivityMode, number> = { suggest: 0, prepare: 1, act: 2 };

/** The less-autonomous of two modes (used to CAP a base mode at a ceiling — the ceiling can only lower). */
export function capMode(base: ProactivityMode, ceiling: ProactivityMode): ProactivityMode {
  return MODE_RANK[base] <= MODE_RANK[ceiling] ? base : ceiling;
}

// ── The C6 approval tier this slice MAPS FROM (FR-6.APR.001). Mirrors @harness/approval-tiers' ApprovalTier;
// like every sibling package (none imports another @harness package at source — they expose no entry point) we
// redeclare the closed union structurally rather than import it. The tier is the INPUT; C6 owns its policy. ──
export const APPROVAL_TIERS = ['auto', 'soft', 'hard'] as const;
export type ApprovalTier = (typeof APPROVAL_TIERS)[number];

export function isApprovalTier(v: unknown): v is ApprovalTier {
  return typeof v === 'string' && (APPROVAL_TIERS as readonly string[]).includes(v);
}

// ── The autonomy-matrix risk sub-types (config-registry §I item 9 / OD-161). `low_risk_external_nonclient` is
// the ONLY operator-editable sub-type (ceiling ∈ {suggest, prepare}); the other four are the FLOORED set —
// code-fixed at hard-approval, never lowered by config. NO sub-type is ever configurable to Act (OD-161). ────
export const RISK_SUBTYPES = [
  'low_risk_external_nonclient', //     cold-lead / templated nurture to a NON-client contact — configurable Suggest↔Prepare
  'existing_client_external', //        outbound comms to an existing client — FLOORED (hard-approval)
  'system_of_record_comms', //          system-of-record external comms — FLOORED
  'financial_operation', //             any financial operation — FLOORED
  'confidential_restricted_action', //  a Confidential/Restricted memory/data action (C1 CLR/RST) — FLOORED
] as const;
export type RiskSubType = (typeof RISK_SUBTYPES)[number];

export function isRiskSubType(v: unknown): v is RiskSubType {
  return typeof v === 'string' && (RISK_SUBTYPES as readonly string[]).includes(v);
}

// The four FLOORED sub-types (FR-6.APR.002 as restored by OD-161). Non-downgradable in code, not config.
export const FLOORED_SUBTYPES = [
  'existing_client_external',
  'system_of_record_comms',
  'financial_operation',
  'confidential_restricted_action',
] as const;
export type FlooredSubType = (typeof FLOORED_SUBTYPES)[number];

export function isFlooredSubType(v: unknown): v is FlooredSubType {
  return typeof v === 'string' && (FLOORED_SUBTYPES as readonly string[]).includes(v);
}

// The permitted MAXIMUM proactivity mode per sub-type. Every sub-type tops out at Prepare — Act is unreachable
// for ANY of them (OD-161). This is the code default; the operator may only LOWER `low_risk_external_nonclient`
// (to Suggest) via the matrix, never RAISE any sub-type above Prepare (validateMatrixEdit enforces the write).
export const SUBTYPE_CEILING: Record<RiskSubType, ProactivityMode> = {
  low_risk_external_nonclient: 'prepare',
  existing_client_external: 'prepare',
  system_of_record_comms: 'prepare',
  financial_operation: 'prepare',
  confidential_restricted_action: 'prepare',
};

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// TIER → MODE (FR-9.MODE.002). Pure. auto→Act, soft→Prepare, hard→Suggest (Prepare when a draft is prepared,
// i.e. Prepare-to-hard-queue). Tier UNAVAILABLE → Suggest (conservative default, AC-9.MODE.001.2 / MODE.002
// edge). This mapping is BEFORE the floor/matrix cap — those only lower it.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
export function tierToMode(tier: ApprovalTier | undefined, preparedDraft = false): ProactivityMode {
  if (tier === undefined) return 'suggest'; // C6 tier unavailable → conservative default, never Act.
  switch (tier) {
    case 'auto':
      return 'act';
    case 'soft':
      return 'prepare';
    case 'hard':
      return preparedDraft ? 'prepare' : 'suggest'; // Suggest OR Prepare-to-hard-queue — never Act.
    default:
      // Unreachable given the union, but fail conservative on an unexpected value (#2).
      return 'suggest';
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// SUB-TYPE RESOLUTION (FR-9.MODE.004 preconditions / AC-9.MODE.004.3). Resolve an action's risk sub-type from
// its C6/C1 signal tags. CONSERVATIVE: an external comm whose recipient cannot be PROVEN a non-client is
// treated as floored (existing-client) — ambiguity → floored, never lowered (the AF-131 fail-safe). An action
// that is none of the five sub-types (a purely-internal low-risk action) has NO sub-type → no matrix cap →
// its base tier governs (an internal auto-tier action may be Act; MODE.003 still routes it through C6).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
export interface SubTypeSignal {
  /** the action is an outbound communication to a party outside the deployment. */
  isExternalComm?: boolean;
  /** recipient IS an existing client — `true` client, `false` proven non-client, `undefined` = cannot prove. */
  recipientIsClient?: boolean;
  /** the comm is a system-of-record external communication. */
  isSystemOfRecordComm?: boolean;
  /** the action touches financial records / money. */
  isFinancial?: boolean;
  /** the action reads/writes Confidential- or Restricted-tagged data (C1 FR-1.CLR / FR-1.RST). */
  isConfidentialOrRestricted?: boolean;
}

export interface SubTypeResolution {
  /** the resolved sub-type, or undefined when the action is none of the five (internal / no matrix entry). */
  subType?: RiskSubType;
  /** true when the resolved sub-type is floored OR the resolution was forced-floored by ambiguity. */
  floored: boolean;
  /** true when the sub-type could not be PROVEN non-client/low-risk and was floored as the fail-safe. */
  ambiguous: boolean;
  /** operator-facing one-liner (why this sub-type / why floored) — never empty (#3). */
  reason: string;
}

export function resolveSubType(signal: SubTypeSignal): SubTypeResolution {
  // Financial / Confidential-Restricted / system-of-record dominate — always floored, order does not matter.
  if (signal.isFinancial) {
    return { subType: 'financial_operation', floored: true, ambiguous: false, reason: 'financial operation → floored (hard-approval)' };
  }
  if (signal.isConfidentialOrRestricted) {
    return { subType: 'confidential_restricted_action', floored: true, ambiguous: false, reason: 'Confidential/Restricted data action → floored (hard-approval)' };
  }
  if (signal.isSystemOfRecordComm) {
    return { subType: 'system_of_record_comms', floored: true, ambiguous: false, reason: 'system-of-record comms → floored (hard-approval)' };
  }
  if (signal.isExternalComm) {
    if (signal.recipientIsClient === true) {
      return { subType: 'existing_client_external', floored: true, ambiguous: false, reason: 'external comm to an existing client → floored (hard-approval)' };
    }
    if (signal.recipientIsClient === false) {
      return { subType: 'low_risk_external_nonclient', floored: false, ambiguous: false, reason: 'external comm to a PROVEN non-client → low-risk-external (ceiling Prepare)' };
    }
    // recipientIsClient === undefined: cannot prove non-client → FLOORED (AC-9.MODE.004.3 fail-safe).
    return {
      subType: 'existing_client_external',
      floored: true,
      ambiguous: true,
      reason: 'external comm whose recipient could NOT be proven a non-client → treated as floored (AC-9.MODE.004.3, never lowered)',
    };
  }
  // None of the five sub-types → an internal action with no matrix entry.
  return { subType: undefined, floored: false, ambiguous: false, reason: 'not one of the five sub-types (internal action) → base C6 tier governs, no matrix cap' };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// THE AUTONOMY MATRIX (FR-9.MODE.004). A read-only ceiling lookup for mode assignment; the write path lives in
// store.ts behind PERM-guardrail.edit_autonomy. `ceilingFor` returns the operator-configured ceiling for a
// sub-type, or undefined to fall through to SUBTYPE_CEILING. A floored sub-type IGNORES the matrix entirely
// (its cap is code-fixed at Prepare) — the matrix can only ever lower `low_risk_external_nonclient`.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
export interface AutonomyMatrix {
  ceilingFor(subType: RiskSubType): ProactivityMode | undefined;
}
/** An empty matrix — every sub-type falls through to its code-default SUBTYPE_CEILING (Prepare). */
export const EMPTY_AUTONOMY_MATRIX: AutonomyMatrix = { ceilingFor: () => undefined };

// ── Matrix write-time validation (AC-9.MODE.004.1 / .2). Pure: (subType, ceiling) → accept/reject. Mirrors the
// C6 AC-6.APR.002.1 write-time floor: the floor/ceiling is enforced BEFORE the config commits. ───────────────
export const ERR_ACT_NOT_REACHABLE =
  'action-autonomy-matrix: Act is not a reachable value for ANY sub-type (OD-161 — no autonomy-matrix config may reach autonomous Act; the ceiling is Prepare). Rejected at write (AC-9.MODE.004.1).';
export const ERR_FLOORED_NOT_EDITABLE =
  'action-autonomy-matrix: a floored sub-type (existing-client/SoR comms, financial, Confidential/Restricted) is fixed at hard-approval in code and cannot be lowered via config (FR-6.APR.002 / OD-161). Rejected at write (AC-9.MODE.004.2).';
export const ERR_UNKNOWN_SUBTYPE =
  'action-autonomy-matrix: unknown risk sub-type — rejected at write (conservative; an unrecognised sub-type is never silently accepted, #2/#3).';
export const ERR_INVALID_MODE =
  'action-autonomy-matrix: ceiling is not a valid proactivity mode (suggest|prepare|act) — rejected at write.';

export interface MatrixEditResult {
  ok: boolean;
  /** the rejection reason when !ok — never empty on failure (#3). */
  error?: string;
}

/**
 * Validate a proposed matrix edit BEFORE it commits. Rejects (a) any ceiling above Prepare, i.e. Act, for ANY
 * sub-type (AC-9.MODE.004.1); (b) any edit to a floored sub-type — it is code-fixed, config cannot lower it
 * below hard-approval (AC-9.MODE.004.2); (c) an unknown sub-type or invalid mode (conservative). The ONLY
 * accepted edit is `low_risk_external_nonclient` set to Suggest or Prepare.
 */
export function validateMatrixEdit(subType: string, ceiling: string): MatrixEditResult {
  if (!isProactivityMode(ceiling)) return { ok: false, error: `${ERR_INVALID_MODE} [got '${String(ceiling)}']` };
  // (a) Act is unreachable for EVERY sub-type — checked first so it applies floored + non-floored alike.
  if (ceiling === 'act') return { ok: false, error: `${ERR_ACT_NOT_REACHABLE} [sub-type '${String(subType)}']` };
  if (!isRiskSubType(subType)) return { ok: false, error: `${ERR_UNKNOWN_SUBTYPE} [got '${String(subType)}']` };
  // (b) floored sub-types are non-editable via config — the floor holds.
  if (isFlooredSubType(subType)) return { ok: false, error: `${ERR_FLOORED_NOT_EDITABLE} [sub-type '${subType}', attempted '${ceiling}']` };
  // low_risk_external_nonclient with ceiling ∈ {suggest, prepare} — both ≤ Prepare → accept.
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// MODE ASSIGNMENT (FR-9.MODE.001 / .002 / AC-9.MODE.004.5). The single decision point: (item + tier + sub-type
// + matrix) → exactly one mode. Precedence (most-binding first): pure-insight → Suggest; then base = tier→mode;
// then CAP at the ceiling (floored → Prepare code-fixed; low-risk-external → matrix ceiling; internal → no cap).
// The floor/matrix can only LOWER the base — never raise it. A floored action is therefore NEVER Act
// (AC-9.MODE.002.2 — the load-bearing #2), and an ambiguous sub-type is floored (AC-9.MODE.004.3).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
export interface ModeAssignmentInput {
  /** false = a pure-insight item with no target action → Suggest (FR-9.MODE.001 branch). */
  hasAction: boolean;
  /** the action's C6 tier (FR-6.APR.001). undefined = tier unavailable → Suggest (conservative). */
  tier?: ApprovalTier;
  /** a Prepare-eligible draft is ready (hard-tier → Prepare-to-hard-queue rather than Suggest). */
  preparedDraft?: boolean;
  /** the resolved risk sub-type (from resolveSubType). undefined = internal action, no matrix cap. */
  subType?: RiskSubType;
  /** true when the sub-type was forced-floored by ambiguity (resolveSubType.ambiguous) — floor applies. */
  ambiguous?: boolean;
  /** the operator autonomy matrix (ceilings). Ignored for floored sub-types (their cap is code-fixed). */
  matrix?: AutonomyMatrix;
}

export interface ModeDecision {
  /** the exactly-one assigned mode (AC-9.MODE.001.1). */
  mode: ProactivityMode;
  /** true when the mode was capped by the non-downgradable floor (floored sub-type or ambiguity). */
  floored: boolean;
  /** what capped the base mode, if anything. */
  cappedBy: 'none' | 'floor' | 'matrix';
  /** operator-facing one-liner explaining the mode — never empty (#3). */
  reason: string;
}

export function assignMode(input: ModeAssignmentInput): ModeDecision {
  // 1. Pure-insight item (no action) → Suggest (FR-9.MODE.001; human decides).
  if (!input.hasAction) {
    return { mode: 'suggest', floored: false, cappedBy: 'none', reason: 'pure-insight item, no target action → Suggest (FR-9.MODE.001)' };
  }

  // 2. Base mode mapped from the C6 tier (FR-9.MODE.002). Never anything but this mapping — no 2nd classifier.
  const base = tierToMode(input.tier, input.preparedDraft ?? false);

  // 3. Is this action under the non-downgradable floor? A floored sub-type OR an ambiguity-forced floor.
  const floored = input.ambiguous === true || (input.subType !== undefined && isFlooredSubType(input.subType));

  // 4. Determine the ceiling.
  let ceiling: ProactivityMode;
  let cappedBy: 'none' | 'floor' | 'matrix';
  if (floored) {
    // Code-fixed hard-approval floor → capped at Prepare, NEVER Act, regardless of matrix or default
    // (AC-9.MODE.004.5 precedence / AC-9.MODE.002.2). The floor always wins.
    ceiling = 'prepare';
    cappedBy = 'floor';
  } else if (input.subType !== undefined) {
    // A non-floored known sub-type (only low_risk_external_nonclient today): operator matrix ceiling, else the
    // code default (Prepare). Even here Act is unreachable — SUBTYPE_CEILING tops out at Prepare.
    ceiling = input.matrix?.ceilingFor(input.subType) ?? SUBTYPE_CEILING[input.subType];
    cappedBy = 'matrix';
  } else {
    // Internal action, no sub-type → no matrix cap; the base tier mapping stands (an auto-tier item may Act).
    ceiling = 'act';
    cappedBy = 'none';
  }

  const mode = capMode(base, ceiling);
  const wasCapped = mode !== base;

  return {
    mode,
    floored,
    cappedBy: wasCapped ? cappedBy : 'none',
    reason: floored
      ? `tier '${input.tier ?? 'unavailable'}' → base '${base}', capped to '${mode}' by the non-downgradable floor (never Act) [sub-type '${input.subType ?? 'ambiguous'}'${input.ambiguous ? ', ambiguity-forced' : ''}]`
      : wasCapped
        ? `tier '${input.tier ?? 'unavailable'}' → base '${base}', capped to '${mode}' by the autonomy matrix ceiling '${ceiling}' [sub-type '${input.subType}']`
        : `tier '${input.tier ?? 'unavailable'}' → '${mode}' [sub-type '${input.subType ?? 'internal'}']`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// NO-BYPASS EXECUTION (FR-9.MODE.003 / NFR-SEC.013 / FR-6.FMM.001). Every proactive Act/Prepare tool call goes
// through the IDENTICAL C6 guardrail pipeline a reactive call does — this funnel is the ONLY execution path, so
// there is structurally no proactive shortcut (AC-9.MODE.003.1 / AC-NFR-SEC.013.1). A hard-limit hit / failed
// guardrail check → blocked + surfaced, never auto-executed on the basis of being "proactive"
// (AC-9.MODE.003.2). A guardrail-check that itself ERRORS → fail CLOSED (never execute) (FR-6.FMM.001).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
export interface ProactiveActionCall {
  actionType: string;
  /** the assigned proactivity mode this call is executing under (Act or Prepare produce a tool call). */
  mode: ProactivityMode;
  /** the originating user whose identity/authz the proactive task carries (C6/C1 gate input). */
  originatingUserId?: string | null;
  /** the action payload the C6 pipeline inspects (tool args, recipient, content). */
  payload?: Record<string, unknown>;
}

export interface C6Decision {
  /** true only when the FULL C6 pipeline (tier + hard limits + anomaly + injection) permits the action. */
  allowed: boolean;
  /** true when a hard limit was hit (blocked + logged + surfaced — never auto-executed). */
  hardLimitHit?: boolean;
  /** operator-facing one-liner — never empty (#3). */
  reason: string;
}

/** The C6 guardrail pipeline seam (ISSUE-055/056/057/059). The SAME seam a reactive action uses — proactivity
 *  binds no separate one. `evaluate` THROWS on an internal guardrail-check error; runProactiveAction fails
 *  closed on that throw (FR-6.FMM.001). */
export interface C6PipelineSeam {
  evaluate(action: ProactiveActionCall): Promise<C6Decision>;
}

export interface ProactiveExecOutcome {
  /** true only when the action passed the C6 pipeline AND the executor ran. */
  executed: boolean;
  /** true when the action was blocked (guardrail denial, hard-limit hit, or fail-closed error). */
  blocked: boolean;
  /** true when the block was a fail-closed guardrail-check error (vs a normal deny). */
  failedClosed: boolean;
  /** operator-facing one-liner — never empty (#3). */
  reason: string;
}

export const REASON_FAILED_CLOSED =
  'proactive action: the C6 guardrail check itself errored → FAILING CLOSED (not executed) — a proactive action is never run on an unverified guardrail (FR-6.FMM.001 / #2 / #3).';

/**
 * The single proactive-action funnel. There is NO other exported execution path — every proactive Act/Prepare
 * tool call is routed here → the identical C6 pipeline (AC-9.MODE.003.1 / AC-NFR-SEC.013.1). The executor is
 * invoked ONLY after the pipeline explicitly allows the action; a denial / hard-limit hit blocks + surfaces it
 * (AC-9.MODE.003.2); a guardrail-check throw fails closed (REASON_FAILED_CLOSED / FR-6.FMM.001).
 */
export async function runProactiveAction(
  action: ProactiveActionCall,
  pipeline: C6PipelineSeam,
  executor: (a: ProactiveActionCall) => Promise<void>,
): Promise<ProactiveExecOutcome> {
  let decision: C6Decision;
  try {
    decision = await pipeline.evaluate(action);
  } catch (err) {
    // Fail closed: the guardrail check errored, so we cannot prove the action is permitted → never execute.
    const detail = err instanceof Error ? err.message : String(err);
    return { executed: false, blocked: true, failedClosed: true, reason: `${REASON_FAILED_CLOSED} [${action.actionType}: ${detail}]` };
  }

  if (!decision.allowed) {
    return {
      executed: false,
      blocked: true,
      failedClosed: false,
      reason: decision.hardLimitHit
        ? `proactive action '${action.actionType}' hit a hard limit → blocked + logged + surfaced, never auto-executed (AC-9.MODE.003.2): ${decision.reason}`
        : `proactive action '${action.actionType}' blocked by the C6 pipeline (identical to reactive) — not executed: ${decision.reason}`,
    };
  }

  await executor(action);
  return { executed: true, blocked: false, failedClosed: false, reason: `proactive action '${action.actionType}' passed the identical C6 pipeline → executed (${decision.reason})` };
}
