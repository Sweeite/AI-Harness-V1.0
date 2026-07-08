// ISSUE-021 — the USR lifecycle actions + the AUD audit spine, each routing through the single access_audit
// writer so no action ships un-audited (#3). FRs: FR-1.USR.001–005, FR-1.AUD.001/002, NFR-SEC.016.
//
// Build order (per issue §8): the audit spine (recordMutation / recordSensitiveAccess) is the prerequisite of
// every action below — an action calls it AFTER the state change succeeds (a denial audits the refusal instead).

import {
  UserMgmtError,
  ERR_DENIED,
  ERR_LAST_SUPER_ADMIN,
  ERR_REASON_REQUIRED,
  ERR_BAD_TIER,
  ERR_RESTRICTED_ROUTE,
  ERR_AUDIT_CONTRACT,
  NODE_ASSIGN_ROLE,
  NODE_DEACTIVATE,
  NODE_RESET_2FA,
  NODE_VIEW_ACTIVITY,
  NODE_GRANT_CLEARANCE,
  isSensitiveTier,
  type UserMgmtStore,
  type SensitivityTier,
  type ActorType,
  type ClearanceRow,
  type RestrictedGrantRow,
  type AuditRow,
  type Reset2faResult,
} from './store.ts';

// ── the single PERM gate wrapper (default-deny → audit the refusal → throw; never silent, #3) ──────────
async function requireNode(
  store: UserMgmtStore,
  actorId: string,
  node: string,
  action: string,
  targetType: string,
  targetId: string | null,
): Promise<void> {
  const nodes = await store.userPermissionNodes(actorId);
  if (!nodes.has(node)) {
    await store.appendAudit({
      audit_type: 'rbac',
      actor_identity: actorId,
      action: `denied:${action}`,
      target_type: targetType,
      target_entity_id: targetId,
      reason: `${ERR_DENIED}:${node}`,
    });
    throw new UserMgmtError(ERR_DENIED, `authorization denied: ${node} required to ${action}`);
  }
}

// ── FR-1.USR.001 — assign / change a user's role (last-SA guard invoked; effective next query) ──────────
/** Change a user's role. Super Admin / Admin (PERM-user.assign_role). The last-Super-Admin guard is homed in
 *  ISSUE-018 and invoked via the atomic store method — a refusal is audited, not silent (AC-1.USR.001.1). An
 *  optional reason is captured to access_audit (NFR-SEC.016). */
export async function changeUserRole(
  store: UserMgmtStore,
  actorId: string,
  targetUserId: string,
  newRoleId: string,
  reason?: string,
): Promise<void> {
  await requireNode(store, actorId, NODE_ASSIGN_ROLE, 'change-user-role', 'user', targetUserId);
  // Capture the OLD role BEFORE the mutation so the immutable trail records who/old/new (FR-1.AUD.002 /
  // AC-1.AUD.002.1) — an after-only record cannot answer "what role did they have before" (#1).
  const oldRoleId = await store.getUserRoleId(targetUserId);
  const ok = await store.atomicChangeRole(targetUserId, newRoleId);
  if (!ok) {
    await store.appendAudit({
      audit_type: 'rbac',
      actor_identity: actorId,
      action: 'denied:change-user-role',
      target_type: 'user',
      target_entity_id: targetUserId,
      reason: ERR_LAST_SUPER_ADMIN,
    });
    throw new UserMgmtError(ERR_LAST_SUPER_ADMIN, 'cannot remove the Super Admin role from the last remaining Super Admin');
  }
  await store.appendAudit({
    audit_type: 'rbac',
    actor_identity: actorId,
    action: 'change-user-role',
    target_type: 'user',
    target_entity_id: targetUserId,
    before_value: { role_id: oldRoleId }, // old role captured (FR-1.AUD.002 who/old/new — #1)
    after_value: { role_id: newRoleId },
    reason: reason ?? null, // optional-but-captured (NFR-SEC.016 / OD-112)
  });
}

// ── FR-1.USR.002 — deactivate / reactivate (revocation, not deletion; no auto-restore on reactivate) ───
/** The result of a deactivation — the above-Standard access that was revoked (so it is evidenced, and so a
 *  later reactivation can prove it did NOT come back). */
export interface DeactivationResult {
  clearancesRevoked: string[];
  restrictedRevoked: string[];
}

/**
 * Deactivate a user (FR-1.USR.002). Super Admin / Admin (PERM-user.deactivate). Last-SA guard invoked. The
 * account row + audit history are RETAINED (revocation, not deletion — #1); the user's next query is denied
 * (AC-1.USR.002.1). "Immediately revoking ALL access" means above-Standard clearances are revoked (hard delete —
 * sensitivity_clearances has no revoked_at) and every active Restricted grant is soft-revoked here, so a
 * subsequent reactivation has nothing above-Standard to silently bring back (the AC-1.USR.002.2 guarantee, #2).
 * Base role membership (user_roles) is left intact so it restores on reactivation. Each revocation is audited.
 */
export async function deactivateUser(
  store: UserMgmtStore,
  actorId: string,
  targetUserId: string,
  reason?: string,
): Promise<DeactivationResult> {
  await requireNode(store, actorId, NODE_DEACTIVATE, 'deactivate-user', 'user', targetUserId);
  const ok = await store.atomicDeactivate(targetUserId);
  if (!ok) {
    await store.appendAudit({
      audit_type: 'rbac',
      actor_identity: actorId,
      action: 'denied:deactivate-user',
      target_type: 'user',
      target_entity_id: targetUserId,
      reason: ERR_LAST_SUPER_ADMIN,
    });
    throw new UserMgmtError(ERR_LAST_SUPER_ADMIN, 'cannot deactivate the last remaining Super Admin');
  }

  // Revoke ALL above-Standard access so it cannot silently return on reactivation (#2). The audit trail (#1)
  // preserves what was held, so an admin can look up what to explicitly re-grant.
  const clearances = await store.listUserClearances(targetUserId);
  const clearancesRevoked: string[] = [];
  for (const c of clearances) {
    if (await store.deleteClearance(c.id)) {
      clearancesRevoked.push(c.id);
      await store.appendAudit({
        audit_type: 'rbac',
        actor_identity: actorId,
        action: 'revoke-clearance:on-deactivate',
        target_type: 'clearance',
        target_entity_id: c.id,
        before_value: { tier: c.tier, entity_type_scope: c.entity_type_scope },
        reason: 'revoked on deactivation — must be explicitly re-granted (FR-1.USR.002.2)',
      });
    }
  }
  const restricted = await store.listActiveRestricted(targetUserId);
  const restrictedRevoked: string[] = [];
  const revokedAt = new Date().toISOString();
  for (const r of restricted) {
    if (await store.revokeRestrictedById(r.id, actorId, revokedAt)) {
      restrictedRevoked.push(r.id);
      await store.appendAudit({
        audit_type: 'rbac',
        actor_identity: actorId,
        action: 'revoke-restricted:on-deactivate',
        target_type: 'restricted_grant',
        target_entity_id: r.id,
        reason: 'revoked on deactivation — must be explicitly re-granted (FR-1.USR.002.2)',
      });
    }
  }

  await store.appendAudit({
    audit_type: 'rbac',
    actor_identity: actorId,
    action: 'deactivate-user',
    target_type: 'user',
    target_entity_id: targetUserId,
    before_value: { active: true, clearances_held: clearancesRevoked, restricted_held: restrictedRevoked },
    after_value: { active: false },
    reason: reason ?? null,
  });
  return { clearancesRevoked, restrictedRevoked };
}

/** The result of a reactivation. The active sets are re-read AFTER reactivation and MUST be empty of any
 *  above-Standard access — proof that nothing was auto-restored (AC-1.USR.002.2). */
export interface ReactivationResult {
  reactivated: boolean;
  clearancesActive: ClearanceRow[]; // must be [] — above-Standard was revoked at deactivation, not restored
  restrictedActive: RestrictedGrantRow[]; // must be [] — Restricted grants were revoked, not restored
}

/**
 * Reactivate a previously-deactivated user (FR-1.USR.002 reactivation branch). This flips ONLY profiles.active
 * back to true; base role membership (user_roles) survived deactivation so it restores automatically. Above-
 * Standard clearances + Restricted grants were revoked at deactivation and are DELIBERATELY NOT restored here —
 * this action re-reads the live grant state to CONFIRM none came back (AC-1.USR.002.2, #2: a stale over-grant
 * must never silently return). If the re-read finds any active above-Standard access, that is a #2 violation and
 * this fails LOUD rather than proceeding. The non-restore is audited so it is evidenced.
 */
export async function reactivateUser(
  store: UserMgmtStore,
  actorId: string,
  targetUserId: string,
  reason?: string,
): Promise<ReactivationResult> {
  await requireNode(store, actorId, NODE_DEACTIVATE, 'reactivate-user', 'user', targetUserId);

  const ok = await store.reactivateUser(targetUserId);
  if (!ok) {
    await store.appendAudit({
      audit_type: 'rbac',
      actor_identity: actorId,
      action: 'reactivate-user:noop',
      target_type: 'user',
      target_entity_id: targetUserId,
      reason: 'already-active',
    });
    throw new UserMgmtError('already_active', `user ${targetUserId} is already active — reactivation is a noop`);
  }

  // Re-read AFTER: above-Standard access must be empty (deactivation revoked it; reactivation restored nothing).
  const clearancesActive = await store.listUserClearances(targetUserId);
  const restrictedActive = await store.listActiveRestricted(targetUserId);
  if (clearancesActive.length > 0 || restrictedActive.length > 0) {
    // A stale above-Standard grant survived into the reactivated account — the exact #2 leak this FR forbids.
    await store.appendAudit({
      audit_type: 'rbac',
      actor_identity: actorId,
      action: 'reactivate-user:stale-grant-detected',
      target_type: 'user',
      target_entity_id: targetUserId,
      after_value: { clearances: clearancesActive.map((c) => c.id), restricted: restrictedActive.map((r) => r.id) },
      reason: 'above-Standard access survived deactivation — refusing to silently reactivate with a stale over-grant (#2)',
    });
    throw new UserMgmtError(
      'stale_grant',
      `reactivation of ${targetUserId} found ${clearancesActive.length} clearance(s) + ${restrictedActive.length} Restricted grant(s) still active — above-Standard access must have been revoked at deactivation (AC-1.USR.002.2)`,
    );
  }

  await store.appendAudit({
    audit_type: 'rbac',
    actor_identity: actorId,
    action: 'reactivate-user',
    target_type: 'user',
    target_entity_id: targetUserId,
    after_value: { active: true, above_standard_auto_restored: false },
    reason: reason ?? 'base role restored; above-Standard clearances + Restricted grants NOT auto-restored (must be explicitly re-granted)',
  });

  return { reactivated: true, clearancesActive, restrictedActive };
}

// ── FR-1.USR.003 — reset a user's 2FA (OAuth branch is an explicit no-op, never a false success) ───────
/** Reset a user's TOTP factor (PERM-user.reset_2fa; Super Admin / Admin). For a password/TOTP account the
 *  enrolled factor is removed and the user must re-enroll before reaching aal2 (AC-1.USR.003.1). For an OAuth
 *  user whose MFA is at the IdP this is a NO-OP at the app layer — surfaced explicitly (oauth:true), never
 *  reported as a successful reset (#3). Audited either way (a security-sensitive action, #2/#3). */
export async function reset2fa(
  store: UserMgmtStore,
  actorId: string,
  targetUserId: string,
  reason?: string,
): Promise<Reset2faResult> {
  await requireNode(store, actorId, NODE_RESET_2FA, 'reset-2fa', 'user', targetUserId);
  const oauth = await store.isOAuthUser(targetUserId);
  if (oauth) {
    await store.appendAudit({
      audit_type: 'rbac',
      actor_identity: actorId,
      action: 'reset-2fa:noop-oauth',
      target_type: 'user',
      target_entity_id: targetUserId,
      reason: reason ?? 'oauth-user: MFA is enforced at the IdP; no app-layer factor to reset',
    });
    return { oauth: true, factorsRemoved: 0 };
  }
  const removed = await store.removeMfaFactors(targetUserId);
  await store.appendAudit({
    audit_type: 'rbac',
    actor_identity: actorId,
    action: 'reset-2fa',
    target_type: 'user',
    target_entity_id: targetUserId,
    after_value: { factors_removed: removed, next_login_aal: 'aal1-until-reenroll' },
    reason: reason ?? null,
  });
  return { oauth: false, factorsRemoved: removed };
}

// ── FR-1.USR.005 — grant / revoke sensitivity clearances (Super-Admin-only; Restricted routes away) ────
/** Grant an above-Standard clearance (Confidential/Personal) to a user, entity-type-scoped (null=Global).
 *  Super-Admin-only via PERM-user.grant_clearance — an Admin (who lacks the node) is denied + audited
 *  (AC-1.USR.005.1). A Restricted-tier attempt is REJECTED here and routed to ISSUE-019's Restricted flow
 *  (grantRestricted) — never granted via this path. Effective on the user's next query (AC-1.USR.005.2). */
export async function grantClearance(
  store: UserMgmtStore,
  actorId: string,
  targetUserId: string,
  tier: SensitivityTier,
  entityTypeScope: string | null,
  opts: { grantedAt: string; reason?: string },
): Promise<ClearanceRow> {
  await requireNode(store, actorId, NODE_GRANT_CLEARANCE, 'grant-clearance', 'user', targetUserId);
  if (tier === 'restricted') {
    await store.appendAudit({
      audit_type: 'rbac',
      actor_identity: actorId,
      action: 'grant-clearance:routed-restricted',
      target_type: 'user',
      target_entity_id: targetUserId,
      reason: 'Restricted is per-individual — use grantRestricted (FR-1.RST.001)',
    });
    throw new UserMgmtError(ERR_RESTRICTED_ROUTE, 'Restricted is granted per-individual via the Restricted flow (FR-1.RST.001), not this clearance grant');
  }
  if (tier !== 'confidential' && tier !== 'personal') {
    // Standard is implicit (no row) — nothing to grant.
    throw new UserMgmtError(ERR_BAD_TIER, `clearance tier must be 'confidential' or 'personal' (Standard is implicit; Restricted is grantRestricted) — got '${tier}'`);
  }
  const row = await store.insertClearance({
    user_id: targetUserId,
    role_id: null,
    tier,
    entity_type_scope: entityTypeScope,
    granted_by: actorId,
    granted_at: opts.grantedAt,
  });
  await store.appendAudit({
    audit_type: 'rbac',
    actor_identity: actorId,
    action: 'grant-clearance',
    target_type: 'user',
    target_entity_id: targetUserId,
    after_value: { tier, entity_type_scope: entityTypeScope },
    reason: opts.reason ?? `${tier}:${entityTypeScope ?? 'Global'}`,
  });
  return row;
}

/** Revoke a clearance (hard delete — sensitivity_clearances has no revoked_at; instant on next query).
 *  Super-Admin-only. Optional reason captured (NFR-SEC.016). A noop (absent id) is surfaced, never silent. */
export async function revokeClearance(
  store: UserMgmtStore,
  actorId: string,
  clearanceId: string,
  reason?: string,
): Promise<void> {
  await requireNode(store, actorId, NODE_GRANT_CLEARANCE, 'revoke-clearance', 'clearance', clearanceId);
  const removed = await store.deleteClearance(clearanceId);
  await store.appendAudit({
    audit_type: 'rbac',
    actor_identity: actorId,
    action: removed ? 'revoke-clearance' : 'revoke-clearance:noop',
    target_type: 'clearance',
    target_entity_id: clearanceId,
    reason: reason ?? (removed ? 'revoked' : 'absent'),
  });
}

// ── NFR-SEC.016 / FR-1.RST.002 — Restricted grant (mandatory reason; asserted as content here) ─────────
/** Grant Restricted to a named individual with a MANDATORY non-empty reason (AC-NFR-SEC.016.1 / AC-1.RST.002.1).
 *  The full Restricted model is owned by ISSUE-019; this path is present so the reason-capture posture is
 *  enforced + audited on this slice's surface (the who/when/why is written to access_audit, never lost). */
export async function grantRestricted(
  store: UserMgmtStore,
  actorId: string,
  granteeUserId: string,
  reason: string,
  opts: { grantedAt: string; entityId?: string | null; entityType?: string | null },
): Promise<RestrictedGrantRow> {
  await requireNode(store, actorId, NODE_GRANT_CLEARANCE, 'grant-restricted', 'user', granteeUserId);
  if (!reason || reason.trim() === '') {
    // Reject AFTER the gate so a denied caller sees denial, not a reason hint. The "why" is mandatory (L452).
    await store.appendAudit({
      audit_type: 'rbac',
      actor_identity: actorId,
      action: 'denied:grant-restricted',
      target_type: 'user',
      target_entity_id: granteeUserId,
      reason: ERR_REASON_REQUIRED,
    });
    throw new UserMgmtError(ERR_REASON_REQUIRED, 'a Restricted grant requires a non-empty reason (who/when/why is mandatory — NFR-SEC.016 / FR-1.RST.002)');
  }
  const row = await store.insertRestricted({
    grantee_user_id: granteeUserId,
    granter_user_id: actorId,
    entity_id: opts.entityId ?? null,
    entity_type: opts.entityType ?? null,
    reason: reason.trim(),
    granted_at: opts.grantedAt,
    revoked_at: null,
  });
  await store.appendAudit({
    audit_type: 'rbac',
    actor_identity: actorId,
    action: 'grant-restricted',
    target_type: 'user',
    target_entity_id: granteeUserId,
    reason: reason.trim(), // the why, written to the immutable trail (AC-1.RST.002.2 / AC-NFR-SEC.016.1)
  });
  return row;
}

// ── FR-1.AUD.001 — the sensitive-access audit choke point (BOTH human + service_role paths; AF-081) ────
export interface SensitiveAccess {
  actorIdentity: string;
  actorType: ActorType; // 'user' (human path) | 'agent' (service_role) | 'system'
  tier: SensitivityTier;
  action: 'read' | 'write' | 'injection';
  entityId: string | null;
  entityType: string | null;
  pathContext: string; // e.g. 'retrieval', 'agent-task:<id>' — never empty (#3)
  originatingUserId?: string | null; // REQUIRED when actorType='agent' (AF-081 attribution)
}

/**
 * The SINGLE choke point every Personal/Restricted access must pass through (FR-1.AUD.001). It appends an
 * immutable access_audit row for the access. This is the AF-081 completeness surface: the service_role/agent
 * path has NO RLS/DB backstop, so coverage rests on this being the only way sensitive content is touched.
 *
 * Fails LOUD, never silent (#3):
 *   • an empty path_context is rejected (an un-attributable access is not audited "well enough").
 *   • an agent-path (actorType='agent') access with NO originating_user_id is rejected (AF-081 — an agent read
 *     that can't be pinned to the human it acts for is an un-attributable Personal/Restricted access, a #1/#2/#3
 *     hole). This makes an un-audited or unattributed agent access structurally impossible.
 *
 * Standard/Confidential accesses need no per-access audit (FR-1.AUD.001 covers Personal + Restricted only) —
 * calling this for a non-sensitive tier is a no-op that returns null, so callers may route ALL accesses through
 * it without over-writing the trail.
 */
export async function recordSensitiveAccess(store: UserMgmtStore, access: SensitiveAccess): Promise<AuditRow | null> {
  if (!isSensitiveTier(access.tier)) return null; // Standard/Confidential — no per-access audit required
  if (!access.pathContext || access.pathContext.trim() === '') {
    throw new UserMgmtError(ERR_AUDIT_CONTRACT, 'a Personal/Restricted access audit requires a non-empty path_context (#3 — no un-attributable access)');
  }
  if (access.actorType === 'agent' && !access.originatingUserId) {
    throw new UserMgmtError(
      ERR_AUDIT_CONTRACT,
      'a service_role/agent Personal/Restricted access MUST carry originating_user_id (AF-081 — the agent path has no DB backstop; an unattributed sensitive access is forbidden)',
    );
  }
  return store.appendAudit({
    audit_type: 'access',
    actor_identity: access.actorIdentity,
    actor_type: access.actorType,
    action: `${access.tier}-${access.action}`,
    target_type: access.entityType,
    target_entity_id: access.entityId,
    reason: null,
    path_context: access.pathContext,
    originating_user_id: access.originatingUserId ?? null,
  });
}

// ── FR-1.USR.004 — the gated, read-only activity view (Personal/Restricted redacted unless cleared) ────
export interface ActivityEntry {
  id: string;
  action: string;
  audit_type: string;
  target_type: string | null;
  target_entity_id: string | null;
  actor_identity: string;
  created_at: string;
  redacted: boolean; // true ⇒ a Personal/Restricted access entry the viewer is not cleared to see
}

/**
 * View a user's activity log (FR-1.USR.004). Gated by PERM-user.view_activity (Super Admin / Admin), read-only.
 * A Personal/Restricted ACCESS entry (audit_type='access', a personal/restricted action) is REDACTED unless the
 * viewer is cleared (AC-1.USR.004.1 branch — the viewer's own clearance gates what they see). The view itself is
 * audited (viewing someone's activity is itself a sensitive read).
 *
 * `viewerCleared` is supplied by the caller from the ISSUE-019/020 clearance resolver (not re-implemented here —
 * this slice owns the gated VIEW, not the clearance model). Default false ⇒ fail-closed redaction.
 */
export async function viewUserActivity(
  store: UserMgmtStore,
  actorId: string,
  targetUserId: string,
  opts: { viewerCleared?: boolean } = {},
): Promise<ActivityEntry[]> {
  await requireNode(store, actorId, NODE_VIEW_ACTIVITY, 'view-activity', 'user', targetUserId);
  const viewerCleared = opts.viewerCleared ?? false;
  const all = await store.listAudits();
  // The user's own recorded actions/accesses: rows where they are the actor OR the originating user of an agent access.
  const theirs = all.filter(
    (a) => a.actor_identity === targetUserId || a.originating_user_id === targetUserId,
  );
  const entries: ActivityEntry[] = theirs.map((a) => {
    const isSensitiveAccess = a.audit_type === 'access' && (a.action.startsWith('personal-') || a.action.startsWith('restricted-'));
    const redacted = isSensitiveAccess && !viewerCleared;
    return {
      id: a.id,
      action: redacted ? '[redacted]' : a.action,
      audit_type: a.audit_type,
      target_type: redacted ? null : a.target_type,
      target_entity_id: redacted ? null : a.target_entity_id,
      actor_identity: a.actor_identity,
      created_at: a.created_at,
      redacted,
    };
  });
  // The view itself is audited (read-only, but a security-relevant read).
  await store.appendAudit({
    audit_type: 'access',
    actor_identity: actorId,
    actor_type: 'user',
    action: 'view-user-activity',
    target_type: 'user',
    target_entity_id: targetUserId,
    reason: null,
    path_context: `activity-view:cleared=${viewerCleared}`,
  });
  return entries;
}
