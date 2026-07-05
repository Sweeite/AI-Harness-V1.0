// ISSUE-018 — the single harness authorization gate: can(user, node, context) (FR-1.PERM.001/.002/.003;
// NFR-SEC.013). DEFAULT-DENY: a node absent from the user's role is denied; a brand-new unassigned node is
// denied for everyone until granted (FR-1.PERM.002). Two-level enforcement (FR-1.PERM.001, ADR-007): this
// harness check is the PRIMARY, code-enforced gate — a deny here holds regardless of any prompt content;
// the prompt scope is advisory and never sufficient alone. NO BACK-DOOR (NFR-SEC.013): every invocation
// path — desktop / mobile / `/`-command / quick-tap — resolves through THIS one function; there is no
// surface-specific shortcut, and a destructive action's node-gate is evaluated before any confirm dialog.
//
// AF-080 non-drift: effectiveNodes() resolves a user's granted nodes from the SAME live tables the
// ISSUE-009 RLS helper user_perms(uid) reads — user_roles ⋈ role_permissions — so the harness gate and the
// DB backstop can never diverge on the grant set. rlsHelperPerms() below reimplements the SQL join
// semantics independently; the build-time differential test asserts the two readers always agree.

import type { RbacStore } from './store.ts';

/** The context a scoped node is evaluated against (entity-type scope + ownership, FR-1.PERM.003). */
export interface CanContext {
  ownerId?: string; // the target resource's owner (own-records scoping)
  entityType?: string; // the target's entity type (entity-type-scoped clearance)
  targetEntityId?: string; // for Restricted per-individual scoping
  /** The surface the action was invoked from — recorded, never branched on (NFR-SEC.013 no-bypass). */
  surface?: 'desktop' | 'mobile' | 'command' | 'quick-tap' | 'api';
}

/** A scope predicate a call site attaches to a context-scoped node: true ⇒ in-scope. */
export type ScopeCheck = (ctx: CanContext) => boolean;

export interface Decision {
  allow: boolean;
  reason: string; // machine reason — surfaced, never swallowed (#3 / FR-1.PERM.006)
}

const ALLOW: Decision = { allow: true, reason: 'granted' };
const deny = (reason: string): Decision => ({ allow: false, reason });

/**
 * Resolve the effective permission-node set for a user, EXACTLY as the RLS helper user_perms(uid) does:
 * the user's one active role (user_roles) → that role's grants (role_permissions). Reads the live tables;
 * never a cached or hardcoded set (AF-080). A user with no active role resolves to the empty set (deny-all).
 */
export async function effectiveNodes(store: RbacStore, userId: string): Promise<Set<string>> {
  const roleId = await store.userRoleId(userId);
  if (roleId === null) return new Set();
  return store.roleNodes(roleId);
}

/**
 * The single authorization gate. Default-deny; a scope predicate, when supplied, must also pass or the
 * node is denied as out-of-scope. Surface is irrelevant to the decision (no back-door). Pure w.r.t. the
 * store — no side effects; callers log the denial (FR-1.PERM.006 / see auditDeniedAccess).
 */
export async function can(
  store: RbacStore,
  userId: string,
  node: string,
  ctx: CanContext = {},
  scope?: ScopeCheck,
): Promise<Decision> {
  const nodes = await effectiveNodes(store, userId);
  if (!nodes.has(node)) return deny('node-not-granted'); // default-deny (PERM.002)
  if (scope && !scope(ctx)) return deny('out-of-scope-context'); // context scope (PERM.003)
  return ALLOW;
}

/** Boolean convenience for call sites that only branch on allow/deny. */
export async function allowed(
  store: RbacStore,
  userId: string,
  node: string,
  ctx: CanContext = {},
  scope?: ScopeCheck,
): Promise<boolean> {
  return (await can(store, userId, node, ctx, scope)).allow;
}

/**
 * The harness gate is authoritative over the prompt (FR-1.PERM.001 / ADR-007, containment-first). A prompt
 * that instructs the AI to proceed cannot upgrade a deny — enforcement lives in code, here, not in text.
 * `promptSaysProceed` is accepted only to prove it is IGNORED on a harness deny.
 */
export async function canWithPrompt(
  store: RbacStore,
  userId: string,
  node: string,
  promptSaysProceed: boolean,
  ctx: CanContext = {},
): Promise<Decision> {
  const d = await can(store, userId, node, ctx);
  // The prompt is advisory only: it can never turn a harness deny into an allow.
  void promptSaysProceed;
  return d;
}

/**
 * Gate a destructive action. The node-gate is evaluated FIRST; the confirm dialog is only ever reached on
 * an allow (AC-NFR-SEC.013.2 — an unauthorized caller is denied BEFORE any confirm is shown). Returns the
 * decision; the caller shows `confirm()` only when allow is true.
 */
export async function authorizeDestructive(
  store: RbacStore,
  userId: string,
  node: string,
  confirm: () => Promise<boolean>,
  ctx: CanContext = {},
): Promise<{ decision: Decision; confirmShown: boolean; proceeded: boolean }> {
  const decision = await can(store, userId, node, ctx);
  if (!decision.allow) return { decision, confirmShown: false, proceeded: false };
  const proceeded = await confirm();
  return { decision, confirmShown: true, proceeded };
}

/**
 * The RLS helper's INDEPENDENT recomputation of a user's grant set — a distinct implementation, not a
 * delegate. It re-joins the raw tables itself, mirroring the 0002 user_perms(uid) SQL literally:
 *   `array_agg(rp.permission_node) FROM user_roles ur JOIN role_permissions rp ON ur.role_id = rp.role_id
 *    WHERE ur.user_id = uid AND ur.active`
 * Because effectiveNodes() resolves via userRoleId()+roleNodes() and this resolves via rawUserRoles()+
 * rawRolePermissions(), the AF-080 differential compares two genuinely separate readers: if either path
 * mishandled `active` or the join, they would diverge and the test would fail (not a tautology).
 */
export async function rlsHelperPerms(store: RbacStore, userId: string): Promise<Set<string>> {
  const userRoles = await store.rawUserRoles();
  const rolePerms = await store.rawRolePermissions();
  const active = userRoles.find((ur) => ur.user_id === userId && ur.active); // WHERE ur.user_id = uid AND ur.active
  if (!active) return new Set();
  return new Set(rolePerms.filter((rp) => rp.role_id === active.role_id).map((rp) => rp.permission_node));
}
