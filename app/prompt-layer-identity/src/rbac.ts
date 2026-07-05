// ISSUE-043 §8 step 6 — the PERM gate for the principles-edit path + the safety-relevant edit event sink.
//
// The principles block is editable ONLY by a Super Admin, via the dedicated `PERM-prompt.edit_principles`
// node (OD-049), which Admin does NOT hold (Admin keeps the general `PERM-prompt.edit`). This slice
// CONSUMES that node — the node + the `can()` gate are authored/matrixed in ISSUE-018; this store never
// implements the gate itself. Default-DENY: absence of a grant is a deny (rbac.md rule 1). Every denial is
// LOGGED (never a silent deny — #3). Every SUCCESSFUL principles edit emits a distinct SAFETY-RELEVANT
// edit event to the audit/alert sink (AC-4.PRIN.002.2) so a shared-safety-posture change is never silent.
//
// Rule 0 sources: FR-4.PRIN.002 (Super-Admin-only via PERM-prompt.edit_principles; mandatory change_reason;
// safety-relevant event; propagation), OD-049 (the dedicated node, not held by Admin), standards/rbac.md
// rule 1 (default-deny). Cross-ref C7 audit sink (seam) / C1 FR-1.AUD.002 scope.

/** The PERM nodes this slice touches. `edit_principles` is Super-Admin-only (OD-049); `edit` is Admin's. */
export const PERM = {
  /** The general prompt-content edit node — Admin holds it (ISSUE-042's gate). Used to show Admin CAN edit non-principles content. */
  edit: 'PERM-prompt.edit',
  /** The dedicated Super-Admin-only principles-edit node (OD-049 / FR-4.PRIN.002). Admin does NOT hold it. */
  editPrinciples: 'PERM-prompt.edit_principles',
} as const;

export type PromptPerm = (typeof PERM)[keyof typeof PERM];

/** The harness authorization gate (ISSUE-018). Returns whether the actor holds the node. Default-deny. */
export interface PermChecker {
  /** True iff `actorId` holds `node`. Default-deny: an unknown actor / ungranted node → false. */
  holds(actorId: string, node: PromptPerm): boolean;
}

/** A denial record — written whenever a gated action is refused (#3 never silent). */
export interface DenialLogRow {
  id: string;
  actor_id: string;
  perm_node: PromptPerm;
  action: string;
  detail: string;
  created_at: string;
}

/** A distinct SAFETY-RELEVANT edit event — emitted on every SUCCESSFUL principles edit (AC-4.PRIN.002.2). */
export interface SafetyEventRow {
  id: string;
  /** The event kind — a dedicated type so C7 can route/alert on it distinctly (not a generic prompt edit). */
  kind: 'principles_edited';
  actor_id: string;
  /** The version id the edit produced, per agent it propagated to (the immutable version-chain audit anchor). */
  produced_version_ids: string[];
  change_reason: string;
  detail: string;
  created_at: string;
}

/** The audit/alert sink denials AND safety events are written to (a seam to C7; append-only). */
export interface AuditSink {
  logDenial(row: Omit<DenialLogRow, 'id' | 'created_at'>, now: number): DenialLogRow;
  emitSafetyEvent(row: Omit<SafetyEventRow, 'id' | 'created_at'>, now: number): SafetyEventRow;
}

/** Raised when a gated principles action is denied. The caller surfaces it; the denial is already logged. */
export class PrinciplesPermissionDenied extends Error {
  constructor(
    readonly actorId: string,
    readonly node: PromptPerm,
    readonly action: string,
  ) {
    super(`denied: actor ${actorId} lacks ${node} for ${action} (default-deny; logged) — FR-4.PRIN.002 / OD-049`);
    this.name = 'PrinciplesPermissionDenied';
  }
}

// ── In-memory audit sink — the test double + reference model (append-only). ───────────────────────
export class InMemoryAuditSink implements AuditSink {
  private denySeq = 0;
  private evtSeq = 0;
  readonly denials: DenialLogRow[] = [];
  readonly safetyEvents: SafetyEventRow[] = [];

  logDenial(row: Omit<DenialLogRow, 'id' | 'created_at'>, now: number): DenialLogRow {
    this.denySeq += 1;
    const full: DenialLogRow = { id: `deny-${String(this.denySeq).padStart(4, '0')}`, created_at: new Date(now * 1000).toISOString(), ...row };
    this.denials.push(full);
    return full;
  }

  emitSafetyEvent(row: Omit<SafetyEventRow, 'id' | 'created_at'>, now: number): SafetyEventRow {
    this.evtSeq += 1;
    const full: SafetyEventRow = { id: `sev-${String(this.evtSeq).padStart(4, '0')}`, created_at: new Date(now * 1000).toISOString(), ...row };
    this.safetyEvents.push(full);
    return full;
  }
}

/**
 * Enforce a PERM gate: if the actor holds the node, return; otherwise LOG the denial and throw.
 * Default-deny by construction (holds() returns false for an ungranted node).
 */
export function enforcePerm(
  perms: PermChecker,
  audit: AuditSink,
  actorId: string,
  node: PromptPerm,
  action: string,
  detail: string,
  now: number,
): void {
  if (perms.holds(actorId, node)) return;
  audit.logDenial({ actor_id: actorId, perm_node: node, action, detail }, now);
  throw new PrinciplesPermissionDenied(actorId, node, action);
}
