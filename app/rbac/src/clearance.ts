// ISSUE-019 — the ADR-006 sensitivity-clearance + Restricted-grant MODEL and its grant/revoke/review flows,
// on the ISSUE-018 can() gate + ISSUE-008 tables. This slice owns the *model + mutation flows*; the DB RLS
// row-access predicates that READ it are ISSUE-020, the retrieval-path enforcement is ISSUE-025, memory
// tagging is ISSUE-022. FRs: FR-1.CLR.001–006 (CLR.006 rule-only) + FR-1.RST.001–003.
//
// The four tiers (schema.md §Types clearance_tier holds only {confidential, personal}; Standard is IMPLICIT
// — no row; Restricted is per-individual via restricted_grants — never a clearance_tier). Handling per
// FR-1.CLR.001: Standard auto-injectable anywhere · Confidential injected only where relevant · Personal
// injected with extra care · Restricted NEVER auto-injected (FR-1.RST.003), explicit audited access only.
//
// Every grant/revoke routes through can() (default-deny; a non-Super-Admin is denied + audited) and writes
// access_audit — the who/when/why the audit-completeness slice (ISSUE-021) later proves complete.

import { can } from './can.ts';
import { PROTECTED_ROLE, type Role } from './catalog.ts';
import { RbacError, ERR_DENIED, type RbacStore, type ClearanceRow, type RestrictedGrantRow } from './store.ts';

// ── PERM nodes this slice gates on (already catalogued in ISSUE-018; referenced, not minted) ─────────
export const GRANT_CLEARANCE_NODE = 'PERM-user.grant_clearance';
export const GRANT_RESTRICTED_NODE = 'PERM-user.grant_restricted';
export const ADD_SENSITIVITY_NODE = 'PERM-system.add_sensitivity';

export const ERR_REASON_REQUIRED = 'reason_required';
export const ERR_BAD_TIER = 'bad_tier';
export const ERR_UNKNOWN_ENTITY_TYPE = 'unknown_entity_type';
export const ERR_SCOPE_TOKEN_ABSENT = 'scope_token_absent';

// ── FR-1.CLR.001 — the four sensitivity tiers + their handling semantics ────────────────────────────
// The model must NOT hardcode exactly four (custom tiers may be added later behind PERM-system.add_sensitivity,
// design L563) — so the tier set is a base list the extension point widens, not a closed enum in code.
export const BASE_SENSITIVITY_TIERS = ['standard', 'confidential', 'personal', 'restricted'] as const;
export type SensitivityTier = (typeof BASE_SENSITIVITY_TIERS)[number] | (string & {});

/** Handling semantics per tier (FR-1.CLR.001). `autoInjectable=false` for Restricted is FR-1.RST.003 — it is
 *  the single most load-bearing bit: Restricted is excluded from ANY automatic retrieval even for a holder. */
export interface TierHandling {
  autoInjectable: boolean; // may automatic retrieval fold this tier into a task/agent context?
  relevanceGated: boolean; // Confidential: injected only where directly relevant
  auditEveryAccess: boolean; // Personal + Restricted: every read/write/injection audited (FR-1.AUD.001)
}
export const TIER_HANDLING: Record<'standard' | 'confidential' | 'personal' | 'restricted', TierHandling> = {
  standard: { autoInjectable: true, relevanceGated: false, auditEveryAccess: false },
  confidential: { autoInjectable: true, relevanceGated: true, auditEveryAccess: false },
  personal: { autoInjectable: true, relevanceGated: true, auditEveryAccess: true },
  restricted: { autoInjectable: false, relevanceGated: true, auditEveryAccess: true }, // FR-1.RST.003
};

/** The tier set for a deployment — the base four widened by any custom tiers added via PERM-system.add_sensitivity
 *  (the model is open-ended by design; v1 ships the base four). Proves the model does not hardcode exactly four. */
export function sensitivityTiers(customTiers: string[] = []): SensitivityTier[] {
  return [...BASE_SENSITIVITY_TIERS, ...customTiers.filter((t) => !(BASE_SENSITIVITY_TIERS as readonly string[]).includes(t))];
}

/** FR-1.CLR.001 / FR-1.RST.003 — Restricted is never auto-injectable; a custom tier defaults to NON-injectable
 *  (most-restrictive-sane, never silently Standard — CLR.001 edge rule). Base tiers use TIER_HANDLING. */
export function isAutoInjectable(tier: SensitivityTier): boolean {
  if (tier === 'restricted') return false;
  const known = (TIER_HANDLING as Record<string, TierHandling>)[tier as string];
  return known ? known.autoInjectable : false; // unknown/custom → fail closed (not auto-injected)
}

// ── FR-1.CLR.002 + OD-186 — per-role default clearances + entity-type scope ─────────────────────────
// Restricted is NEVER a role default (OD-027 / FR-1.RST.001) — the clearance_tier enum cannot hold it, so
// it is structurally impossible to seed here. Standard is implicit (no row). Above-Standard defaults:
//   Super Admin / Admin — Confidential + Personal, Global (entity_type_scope null)
//   HR                  — Personal, scoped to `Team Member` entities
//   Finance             — Confidential, scoped to the four finance-domain entity types (OD-186)
//   Account Manager     — Confidential, scoped to `Client` entities (the "assigned" narrowing is a
//                         visibility/ownership concern owned by ISSUE-020/022, not a clearance scope token)
//   Standard User       — Standard only (no row)
/** The finance-domain entity-type set the Finance role's Confidential default is scoped to (OD-186). */
export const FINANCE_ENTITY_TYPES = ['Invoice', 'Contract/Retainer', 'Financial Period', 'Deal'] as const;

export interface DefaultClearance {
  tier: 'confidential' | 'personal';
  entity_type_scope: string | null; // null = Global
}
export const DEFAULT_CLEARANCES: Record<Role, DefaultClearance[]> = {
  'Super Admin': [
    { tier: 'confidential', entity_type_scope: null },
    { tier: 'personal', entity_type_scope: null },
  ],
  Admin: [
    { tier: 'confidential', entity_type_scope: null },
    { tier: 'personal', entity_type_scope: null },
  ],
  HR: [{ tier: 'personal', entity_type_scope: 'Team Member' }],
  Finance: FINANCE_ENTITY_TYPES.map((t) => ({ tier: 'confidential' as const, entity_type_scope: t })),
  'Account Manager': [{ tier: 'confidential', entity_type_scope: 'Client' }],
  'Standard User': [], // Standard is implicit — no clearance row
};

/** The shipped default `entity_types` (config-registry §A `entity_types`, "Internal Org" locked-present). The
 *  seed's scope tokens must all be members (OD-186 fail-loud). A deployment overrides this at boot. */
export const SHIPPED_ENTITY_TYPES: readonly string[] = [
  'Client', 'Contact', 'Team Member', 'Vendor/Partner', 'Campaign', 'Task', 'Deliverable', 'Template',
  'Deal', 'Contract/Retainer', 'Invoice', 'Brand Guide', 'Audience', 'Channel', 'Team/Department', 'Meeting',
  'SOP/Playbook', 'Tool/Platform', 'Goal/OKR', 'Financial Period', 'Lesson Learned', 'Internal Org',
];

/** OD-186 portability guard: every non-null default scope token MUST exist in the deployment's entity_types at
 *  boot, else provisioning FAILS LOUD (#3 — a silently-skipped scope is invisible over-restriction). */
export function assertScopeTokensPresent(entityTypes: readonly string[] = SHIPPED_ENTITY_TYPES): void {
  const present = new Set(entityTypes);
  const missing = new Set<string>();
  for (const rows of Object.values(DEFAULT_CLEARANCES)) {
    for (const r of rows) if (r.entity_type_scope !== null && !present.has(r.entity_type_scope)) missing.add(r.entity_type_scope);
  }
  if (missing.size > 0) {
    throw new RbacError(
      ERR_SCOPE_TOKEN_ABSENT,
      `default clearance scope token(s) absent from entity_types at boot: ${[...missing].sort().join(', ')} — refusing to silently skip a scope (OD-186)`,
    );
  }
}

/** AC-1.RST.001.1 (structural) — no role default is Restricted. The clearance_tier type forbids it at compile
 *  time; this asserts it at runtime too, so a future data edit can never smuggle Restricted into a role default. */
export function assertNoRestrictedRoleDefault(): void {
  for (const [role, rows] of Object.entries(DEFAULT_CLEARANCES)) {
    for (const r of rows) {
      if ((r.tier as string) === 'restricted') {
        throw new RbacError('restricted_role_default', `role '${role}' has a Restricted default — Restricted is per-individual only (FR-1.RST.001)`);
      }
    }
  }
}

/** Seed each role's default clearances (FR-1.CLR.002). Called by seedRoles (ISSUE-018) after the roles exist.
 *  Fails loud if a scope token is absent from the deployment's entity_types (OD-186). `provisionedAt` stamps the
 *  seeded rows' granted_at (models the live DDL `now()` at provisioning; it is the cadence baseline for a role
 *  default that is never explicitly re-confirmed). */
export async function seedDefaultClearances(
  store: RbacStore,
  roleIdByName: (name: Role) => string,
  entityTypes: readonly string[] = SHIPPED_ENTITY_TYPES,
  provisionedAt?: string,
): Promise<void> {
  assertScopeTokensPresent(entityTypes);
  assertNoRestrictedRoleDefault();
  for (const role of Object.keys(DEFAULT_CLEARANCES) as Role[]) {
    for (const cl of DEFAULT_CLEARANCES[role]) {
      await store.seedClearance({ role_id: roleIdByName(role), user_id: null, tier: cl.tier, entity_type_scope: cl.entity_type_scope, granted_at: provisionedAt });
    }
  }
}

// ── The single gate wrapper (deny → audit the refusal → throw; never silent, #3) ────────────────────
async function requireNode(store: RbacStore, actorId: string, node: string, action: string, targetType: string, targetId: string | null): Promise<void> {
  const decision = await can(store, actorId, node);
  if (!decision.allow) {
    await store.appendAudit({ audit_type: 'rbac', actor_identity: actorId, action: `denied:${action}`, target_type: targetType, target_entity_id: targetId, reason: decision.reason });
    throw new RbacError(ERR_DENIED, `authorization denied: ${node} required to ${action}`);
  }
}

// ── FR-1.CLR.003 / FR-1.CLR.004 — clearance grant/revoke (explicit, entity-type-scoped, audited) ─────
export interface ClearanceTarget {
  userId?: string;
  roleId?: string;
}
/** Grant an above-Standard clearance (Confidential/Personal) to a user or role, entity-type-scoped (null=Global).
 *  Super-Admin-only. Explicit — the ONLY code path that confers a tier; nothing grants a clearance implicitly
 *  (FR-1.CLR.003). Restricted is rejected here (use grantRestricted). Audited to access_audit. */
export async function grantClearance(
  store: RbacStore,
  actorId: string,
  target: ClearanceTarget,
  tier: 'confidential' | 'personal',
  entityTypeScope: string | null,
  opts: { grantedAt: string; entityTypes?: readonly string[] },
): Promise<ClearanceRow> {
  if (tier !== 'confidential' && tier !== 'personal') {
    // Standard needs no grant (implicit); Restricted is per-individual via grantRestricted — never a clearance.
    throw new RbacError(ERR_BAD_TIER, `clearance tier must be 'confidential' or 'personal' (Standard is implicit; Restricted is grantRestricted) — got '${tier}'`);
  }
  if (!target.userId === !target.roleId) {
    throw new RbacError('bad_target', 'a clearance grant targets exactly one of userId | roleId');
  }
  await requireNode(store, actorId, GRANT_CLEARANCE_NODE, 'grant-clearance', target.userId ? 'user' : 'role', target.userId ?? target.roleId ?? null);
  if (entityTypeScope !== null) {
    const types = opts.entityTypes ?? SHIPPED_ENTITY_TYPES;
    if (!types.includes(entityTypeScope)) {
      throw new RbacError(ERR_UNKNOWN_ENTITY_TYPE, `entity_type_scope '${entityTypeScope}' is not a known entity type — cannot scope a clearance to it`);
    }
  }
  const row = await store.insertClearance({
    role_id: target.roleId ?? null,
    user_id: target.userId ?? null,
    tier,
    entity_type_scope: entityTypeScope,
    granted_by: actorId,
    granted_at: opts.grantedAt,
    last_reviewed_at: null, // cadence measured from granted_at until the first confirm
  });
  await store.appendAudit({ audit_type: 'rbac', actor_identity: actorId, action: 'grant-clearance', target_type: target.userId ? 'user' : 'role', target_entity_id: target.userId ?? target.roleId ?? null, reason: `${tier}:${entityTypeScope ?? 'Global'}` });
  return row;
}

/** Revoke a clearance (hard delete — sensitivity_clearances has no revoked_at column; effective instantly on the
 *  next query, FR-1.RLS.006). Super-Admin-only. Audited. */
export async function revokeClearance(store: RbacStore, actorId: string, clearanceId: string): Promise<void> {
  await requireNode(store, actorId, GRANT_CLEARANCE_NODE, 'revoke-clearance', 'clearance', clearanceId);
  const removed = await store.deleteClearance(clearanceId);
  await store.appendAudit({ audit_type: 'rbac', actor_identity: actorId, action: removed ? 'revoke-clearance' : 'revoke-clearance:noop', target_type: 'clearance', target_entity_id: clearanceId, reason: removed ? 'revoked' : 'absent' });
}

/** Resolve a user's EFFECTIVE clearances = their own user-scoped rows ∪ their active role's default rows.
 *  No implicit escalation beyond the role's own explicit defaults (FR-1.CLR.003). */
export async function effectiveClearances(store: RbacStore, userId: string): Promise<ClearanceRow[]> {
  const own = (await store.listClearances()).filter((c) => c.user_id === userId);
  const roleId = await store.userRoleId(userId);
  const roleRows = roleId ? await store.roleClearances(roleId) : [];
  return [...own, ...roleRows];
}

/** FR-1.CLR.004 — does the user hold `tier` for a row of entity type `entityType`? Standard is always held;
 *  Restricted is NEVER held via a clearance (it is a per-individual grant + explicit audited access only). A
 *  Global (null-scope) clearance covers every entity type; a scoped clearance covers only its own type. */
export async function hasClearanceFor(store: RbacStore, userId: string, tier: SensitivityTier, entityType: string | null): Promise<boolean> {
  if (tier === 'standard') return true; // implicit for everyone
  if (tier === 'restricted') return false; // never conferred by a clearance (FR-1.RST.001/003)
  const rows = await effectiveClearances(store, userId);
  return rows.some((c) => c.tier === tier && (c.entity_type_scope === null || c.entity_type_scope === entityType));
}

// ── FR-1.CLR.005 — configurable review cadence (both branches non-silent) ───────────────────────────
export interface ClearanceAlert {
  kind: 'clearance_review_overdue' | 'clearance_auto_revoked';
  clearanceId: string;
  message: string;
}
export interface ClearanceAlertSink {
  escalate(alert: ClearanceAlert): Promise<void>;
}
export class InMemoryAlertSink implements ClearanceAlertSink {
  public alerts: ClearanceAlert[] = [];
  async escalate(alert: ClearanceAlert): Promise<void> {
    this.alerts.push(alert);
  }
}

const DAY_MS = 86_400_000;

/** Confirm a review is still appropriate — sets last_reviewed_at, resetting the cadence clock (FR-1.CLR.005). */
export async function confirmClearanceReview(store: RbacStore, actorId: string, clearanceId: string, reviewedAt: string): Promise<void> {
  await requireNode(store, actorId, GRANT_CLEARANCE_NODE, 'confirm-clearance-review', 'clearance', clearanceId);
  const ok = await store.touchClearanceReview(clearanceId, reviewedAt);
  if (!ok) throw new RbacError('no_such_clearance', `no clearance ${clearanceId} to confirm`);
  await store.appendAudit({ audit_type: 'rbac', actor_identity: actorId, action: 'confirm-clearance-review', target_type: 'clearance', target_entity_id: clearanceId, reason: null });
}

/**
 * Process overdue, un-actioned above-Standard clearance reviews (FR-1.CLR.005, OD-028).
 *
 * SCOPE (OD-187): the cadence targets USER-SCOPED clearances only — the explicit per-individual grants a Super
 * Admin made and might forget. A ROLE-DEFAULT clearance (role_id set) is part of the role's definition and is
 * governed by role management (ISSUE-021), NEVER auto-revoked by this periodic job — else a nightly fail-closed
 * sweep would silently hard-delete a role's baseline access (e.g. strip Finance's Confidential-finance defaults)
 * fleet-wide, a #1 access-loss on the security substrate. Standard is implicit (no row) so is never surfaced.
 *
 * For each in-scope clearance whose cadence has elapsed since its last review (last_reviewed_at ?? granted_at):
 *   • fail_closed=false (default) → FLAG + ESCALATE (alert), NEITHER auto-revoked NOR marked reviewed (AC-1.CLR.005.1)
 *   • fail_closed=true            → AUTO-REVOKE (hard delete), audited, STILL ESCALATED (never silent, AC-1.CLR.005.2)
 */
export async function reviewOverdueClearances(
  store: RbacStore,
  opts: { now: string; cadenceDays: number; failClosed: boolean },
  alert: ClearanceAlertSink,
): Promise<{ flagged: string[]; revoked: string[] }> {
  const cutoff = Date.parse(opts.now) - opts.cadenceDays * DAY_MS;
  const flagged: string[] = [];
  const revoked: string[] = [];
  for (const c of await store.listClearances()) {
    if (c.user_id === null) continue; // OD-187 — role defaults are out of the auto-revoke cadence
    const lastReview = Date.parse(c.last_reviewed_at ?? c.granted_at ?? '1970-01-01T00:00:00.000Z');
    if (lastReview >= cutoff) continue; // not yet due
    const id = c.id!;
    if (opts.failClosed) {
      await store.deleteClearance(id);
      await store.appendAudit({ audit_type: 'rbac', actor_identity: 'system', actor_type: 'system', action: 'clearance-auto-revoked', target_type: 'clearance', target_entity_id: id, reason: 'review-overdue-fail-closed' });
      await alert.escalate({ kind: 'clearance_auto_revoked', clearanceId: id, message: `overdue clearance ${id} auto-revoked (fail_closed)` });
      revoked.push(id);
    } else {
      // Do NOT touch last_reviewed_at and do NOT revoke — flag + escalate only (AC-1.CLR.005.1).
      await store.appendAudit({ audit_type: 'rbac', actor_identity: 'system', actor_type: 'system', action: 'clearance-review-overdue', target_type: 'clearance', target_entity_id: id, reason: 'flagged-escalated' });
      await alert.escalate({ kind: 'clearance_review_overdue', clearanceId: id, message: `overdue clearance ${id} flagged for Super Admin review` });
      flagged.push(id);
    }
  }
  return { flagged, revoked };
}

// ── FR-1.RST.001 / FR-1.RST.002 — Restricted grant/revoke (per individual, mandatory reason, instant) ─
/** Grant Restricted to a NAMED INDIVIDUAL (never a role — structurally impossible: no role column). Super-Admin
 *  only (AC-1.RST.001.2 — a non-SA is denied + audited). Mandatory non-empty reason (AC-1.RST.002.1). Writes an
 *  immutable access_audit record capturing granter/grantee/time/reason (AC-1.RST.002.2). */
export async function grantRestricted(
  store: RbacStore,
  actorId: string,
  granteeUserId: string,
  reason: string,
  opts: { grantedAt: string; entityId?: string | null; entityType?: string | null },
): Promise<RestrictedGrantRow> {
  await requireNode(store, actorId, GRANT_RESTRICTED_NODE, 'grant-restricted', 'user', granteeUserId);
  if (!reason || reason.trim() === '') {
    // The "why" is mandatory (L452). Reject AFTER the gate so a non-SA sees denial, not a reason hint.
    await store.appendAudit({ audit_type: 'rbac', actor_identity: actorId, action: 'denied:grant-restricted', target_type: 'user', target_entity_id: granteeUserId, reason: ERR_REASON_REQUIRED });
    throw new RbacError(ERR_REASON_REQUIRED, 'a Restricted grant requires a non-empty reason (who/when/why is mandatory, FR-1.RST.002)');
  }
  const row = await store.insertRestricted({
    grantee_user_id: granteeUserId,
    granter_user_id: actorId,
    reason: reason.trim(),
    entity_id: opts.entityId ?? null,
    entity_type: opts.entityType ?? null,
    granted_at: opts.grantedAt,
    revoked_at: null,
  });
  await store.appendAudit({ audit_type: 'rbac', actor_identity: actorId, action: 'grant-restricted', target_type: 'user', target_entity_id: granteeUserId, reason: reason.trim() });
  return row;
}

/** Revoke a Restricted grant — instant soft-delete (revoked_at), effective on the user's next query
 *  (AC-1.RST.002.3). Super-Admin only. Audited. */
export async function revokeRestricted(store: RbacStore, actorId: string, grantId: string, revokedAt: string): Promise<void> {
  await requireNode(store, actorId, GRANT_RESTRICTED_NODE, 'revoke-restricted', 'restricted_grant', grantId);
  const ok = await store.revokeRestrictedById(grantId, actorId, revokedAt);
  await store.appendAudit({ audit_type: 'rbac', actor_identity: actorId, action: ok ? 'revoke-restricted' : 'revoke-restricted:noop', target_type: 'restricted_grant', target_entity_id: grantId, reason: ok ? 'revoked' : 'absent-or-already-revoked' });
}

// ── FR-1.RST.003 / FR-1.CLR.006 — never-auto-inject + control-before-gate (model contract) ───────────
/** FR-1.RST.003 — filter an automatic-retrieval candidate set to the auto-injectable tiers, DROPPING every
 *  Restricted row REGARDLESS of any grant the requester holds (Restricted surfaces only via explicit audited
 *  access, never automatic injection). ISSUE-025 realises this on the retrieval hot path; the rule is owned here. */
export function filterAutoInjectable<T extends { sensitivity: SensitivityTier }>(candidates: T[]): T[] {
  return candidates.filter((c) => isAutoInjectable(c.sensitivity));
}

/**
 * FR-1.CLR.006 (rule-only) — the control-before-gate contract: given a candidate set, EXCLUDE every row outside
 * the requester's clearance BEFORE anything ranks it (never ranked-then-hidden, a #2 leak). Returns the subset a
 * ranker may see. Restricted is dropped as non-auto-injectable (FR-1.RST.003) even for a holder. The AF-067
 * hot-path composition with pgvector ranking is ISSUE-025's mechanism; this is the definitional filter it applies.
 */
export async function applyClearanceControl<T extends { sensitivity: SensitivityTier; entityType: string | null }>(
  store: RbacStore,
  userId: string,
  candidates: T[],
): Promise<T[]> {
  const out: T[] = [];
  for (const cand of candidates) {
    if (!isAutoInjectable(cand.sensitivity)) continue; // Restricted never auto-injected (FR-1.RST.003)
    if (cand.sensitivity === 'standard') {
      out.push(cand);
      continue;
    }
    if (await hasClearanceFor(store, userId, cand.sensitivity, cand.entityType)) out.push(cand);
  }
  return out;
}
