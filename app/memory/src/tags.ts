// ISSUE-022 — the two orthogonal write-time classification axes (FR-2.TAG.001/002/003). This slice OWNS the
// tag-assignment rules + the admit predicate's SHAPE; the RLS predicates that ENFORCE it on `memories` are
// ISSUE-020 (C1 RLS.003) and the retrieval pipeline that CALLS admit() is ISSUE-025. Kept pure so both the
// writer (ISSUE-024) and retrieval consume identical logic.
//
// Two axes, evaluated SEPARATELY (FR-2.TAG.003): visibility (who, by structure: global/team/private) and
// sensitivity (what handling class: standard/confidential/personal/restricted). A candidate is admitted iff it
// passes BOTH; failing EITHER excludes it entirely (not ranked, not returned). They must never be conflated.

import {
  MOST_RESTRICTIVE_VISIBILITY,
  NEVER_AUTO_SENSITIVITY,
  type VisibilityTier,
  type SensitivityTier,
} from './entity-types.ts';

export class TagError extends Error {
  constructor(
    public reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'TagError';
  }
}
export const ERR_NEVER_AUTO_RESTRICTED = 'never_auto_restricted';

// ── FR-2.TAG.001 — visibility axis, with defaults ─────────────────────────────────────────────────
/** The kind of knowledge a memory carries, which sets the default visibility (design L1400-1404, L1862-1866). */
export type KnowledgeKind = 'business' | 'personal';

/**
 * The write-time visibility default: an explicit choice wins; else business → global, personal → private; an
 * UNSET/unknown axis falls to the most-restrictive sane scope (private), never silently global (#2, TAG.001 edge).
 */
export function defaultVisibility(kind: KnowledgeKind | undefined, explicit?: VisibilityTier): VisibilityTier {
  if (explicit) return explicit;
  if (kind === 'business') return 'global';
  if (kind === 'personal') return 'private';
  return MOST_RESTRICTIVE_VISIBILITY; // unset → private
}

// ── FR-2.TAG.002 — sensitivity at write time; NEVER autonomously Restricted ───────────────────────
/** Internal-Org business knowledge defaults to Confidential (FR-2.ENT.003) — a safe clearance-gated tier the
 *  writer MAY auto-assign (Restricted still needs a human, below). */
export const INTERNAL_ORG_DEFAULT_SENSITIVITY: SensitivityTier = 'confidential';
/** An item the writer cannot confidently classify defaults to Confidential pending review — never silently
 *  Standard (#1/#2). Confidential is the most-restrictive tier the writer may assign without a human. */
export const UNCLASSIFIABLE_DEFAULT_SENSITIVITY: SensitivityTier = 'confidential';

/**
 * Assign a sensitivity tier at write time. The hard invariant (AC-2.TAG.002.2, design L1418): the writer NEVER
 * autonomously assigns Restricted — any path that would set Restricted requires a prior human confirmation, so
 * this throws unless `humanConfirmed` is true. Standard/Confidential/Personal are assignable autonomously.
 */
export function assignSensitivity(proposed: SensitivityTier, opts: { humanConfirmed?: boolean } = {}): SensitivityTier {
  if (proposed === NEVER_AUTO_SENSITIVITY && !opts.humanConfirmed) {
    throw new TagError(ERR_NEVER_AUTO_RESTRICTED, 'the writer never autonomously assigns Restricted — human confirmation is required first (FR-2.TAG.002 / AC-2.TAG.002.2)');
  }
  return proposed;
}

// ── FR-2.TAG.003 — the orthogonal admit contract (the shape ISSUE-025 retrieval consumes) ─────────
/** What a requester is cleared for, supplied by C1 (FR-1.CLR.*). visibilityScopes = the structural scopes they
 *  may see; clearedTiers = the sensitivity tiers their (entity-type-scoped) clearance covers. Standard is implicit
 *  for everyone; Restricted is a per-individual grant (C1 FR-1.RST.*) surfaced here as membership in clearedTiers. */
export interface RequesterContext {
  visibilityScopes: ReadonlySet<VisibilityTier>;
  clearedTiers: ReadonlySet<SensitivityTier>;
}

/** Axis 1 (visibility): does the requester's structural scope include this memory's visibility? Evaluated ALONE. */
export function visibilityAdmits(visibility: VisibilityTier, ctx: RequesterContext): boolean {
  return ctx.visibilityScopes.has(visibility);
}

/** Axis 2 (sensitivity): does the requester's clearance cover this memory's tier? Standard is implicit; every
 *  other tier requires explicit membership in clearedTiers. Evaluated ALONE. */
export function sensitivityAdmits(sensitivity: SensitivityTier, ctx: RequesterContext): boolean {
  if (sensitivity === 'standard') return true; // implicit for everyone
  return ctx.clearedTiers.has(sensitivity);
}

export interface AdmitResult {
  admitted: boolean;
  failedAxis: 'visibility' | 'sensitivity' | null;
}

/**
 * The orthogonal admit decision (FR-2.TAG.003): evaluate BOTH axes SEPARATELY; admit iff both pass; failing
 * either excludes. `failedAxis` names the first axis that failed (visibility checked first) so callers can audit
 * WHY a memory was excluded without conflating the two. A global-but-Confidential memory still needs clearance;
 * a Standard-but-private memory still needs scope — the two are never collapsed into one check.
 */
export function admits(memory: { visibility: VisibilityTier; sensitivity: SensitivityTier }, ctx: RequesterContext): AdmitResult {
  const visOk = visibilityAdmits(memory.visibility, ctx);
  const senOk = sensitivityAdmits(memory.sensitivity, ctx);
  if (visOk && senOk) return { admitted: true, failedAxis: null };
  return { admitted: false, failedAxis: !visOk ? 'visibility' : 'sensitivity' };
}
