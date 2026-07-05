// ISSUE-042 §8 step 8 — the store-level PERM gate + denial log (FR-4.STO.005 / AC-4.STO.005.2). The
// prompt store consumes the PERM nodes homed in C1's node model (ISSUE-018); it does NOT implement the
// harness `can()` gate itself. This is the seam: a `PermChecker` (the caller's harness gate) answers
// "does this actor hold this node?", default-DENY — absence of a grant is a deny (rbac.md rule 1). Every
// denial is LOGGED to an audit sink (never a silent deny — #3). A permitted action proceeds.
//
// Rule 0 sources: standards/rbac.md rule 1 (default-deny everywhere), FR-4.STO.005 (edit gated by
// PERM-prompt.edit, default-deny for all others, logged), FR-4.STO.004 (history/rollback gates).

import type { PromptPerm } from './layers.js';

/** The harness authorization gate (ISSUE-018). Returns the set of PERM nodes the actor holds. */
export interface PermChecker {
  /** True iff `actorId` holds `node`. Default-deny: an unknown actor / ungranted node → false. */
  holds(actorId: string, node: PromptPerm): boolean;
}

/** A denial record — written whenever a gated action is refused (FR-4.STO.005 / #3 never silent). */
export interface DenialLogRow {
  id: string;
  actor_id: string;
  perm_node: PromptPerm;
  action: string; // e.g. 'prompt.edit' | 'prompt.view_history' | 'prompt.rollback'
  detail: string;
  created_at: string;
}

/** The audit sink denials are written to (a seam to C7's access_audit; append-only). */
export interface DenialAuditSink {
  logDenial(row: Omit<DenialLogRow, 'id' | 'created_at'>, now: number): DenialLogRow;
}

/** Raised when a gated prompt action is denied. The caller surfaces it; the denial is already logged. */
export class PromptPermissionDenied extends Error {
  constructor(
    readonly actorId: string,
    readonly node: PromptPerm,
    readonly action: string,
  ) {
    super(`denied: actor ${actorId} lacks ${node} for ${action} (default-deny; logged) — FR-4.STO.005`);
    this.name = 'PromptPermissionDenied';
  }
}

// ── In-memory denial audit sink — the test double + reference model (append-only). ───────────────
export class InMemoryDenialAuditSink implements DenialAuditSink {
  private seq = 0;
  readonly denials: DenialLogRow[] = [];

  logDenial(row: Omit<DenialLogRow, 'id' | 'created_at'>, now: number): DenialLogRow {
    this.seq += 1;
    const full: DenialLogRow = {
      id: `deny-${String(this.seq).padStart(4, '0')}`,
      created_at: new Date(now * 1000).toISOString(),
      ...row,
    };
    this.denials.push(full);
    return full;
  }
}

/**
 * Enforce a PERM gate: if the actor holds the node, return; otherwise LOG the denial and throw
 * PromptPermissionDenied. Default-deny by construction (holds() returns false for an ungranted node).
 */
export function enforcePerm(
  perms: PermChecker,
  audit: DenialAuditSink,
  actorId: string,
  node: PromptPerm,
  action: string,
  detail: string,
  now: number,
): void {
  if (perms.holds(actorId, node)) return;
  audit.logDenial({ actor_id: actorId, perm_node: node, action, detail }, now);
  throw new PromptPermissionDenied(actorId, node, action);
}
