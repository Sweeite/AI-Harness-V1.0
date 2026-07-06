// ISSUE-016 — the SupportAuthz PORT: the seam onto the ISSUE-018 authorization core (@harness/rbac can()).
// This slice CONSUMES the two PERM-support.* nodes as default-deny stubs (issue §5 "Out"): it does NOT define
// them, the can() gate, or the role→node matrix — those are homed in ISSUE-018/C1. Keeping this a thin port
// (rather than a hard cross-package import) lets the offline suite run without the rbac package linked, while
// the LIVE adapter (SupabaseSupportAuthz) delegates to @harness/rbac's can(store, userId, node) — the SAME
// single harness gate every other gated action routes through (NFR-SEC.013 no back-door).
//
// DEFAULT-DENY (FR-1.PERM.002, ADR-007): an actor with neither node resolves to `false`. The queue read
// (PERM-support.view) and the status transitions (PERM-support.resolve) are BOTH default-deny — a user who
// holds neither is denied EXACTLY as the RLS SELECT/UPDATE policy denies at the DB (AC-0.REC.003.1).

/** The two permission nodes this slice consumes (defined in ISSUE-018/C1; here as string constants only). */
export const PERM_SUPPORT_VIEW = 'PERM-support.view';
export const PERM_SUPPORT_RESOLVE = 'PERM-support.resolve';

/** The single authorization question this slice asks. Returns true iff the actor holds `node`. Default-deny:
 *  an unknown actor / ungranted node MUST return false — never throw-as-allow, never a silent true (#2). */
export interface SupportAuthz {
  can(actorId: string, node: string): Promise<boolean>;
}

/** In-memory fake authz — the offline reference for @harness/rbac can(). Grants are explicit; everything
 *  absent is denied (default-deny holds structurally, mirroring the rbac fake's empty-set → deny-all). */
export class InMemorySupportAuthz implements SupportAuthz {
  // actorId → set of granted nodes.
  private grants = new Map<string, Set<string>>();

  async can(actorId: string, node: string): Promise<boolean> {
    return this.grants.get(actorId)?.has(node) ?? false; // default-deny
  }

  /** Test/seed seam: grant a node to an actor (models an ISSUE-018 role→node assignment resolving true). */
  grant(actorId: string, ...nodes: string[]): this {
    const set = this.grants.get(actorId) ?? new Set<string>();
    for (const n of nodes) set.add(n);
    this.grants.set(actorId, set);
    return this;
  }
}
