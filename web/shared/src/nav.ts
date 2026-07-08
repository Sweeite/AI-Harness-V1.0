// ISSUE-087 §2/§4 — the RBAC-driven app-shell navigation model. THE MARQUEE.
//
// The load-bearing AC (issue §4): "the nav renders only the entries whose can() node the caller holds
// — a denied entry is ABSENT, not empty — and the gating reads the SAME PERMISSION_NODES catalog
// app/rbac exposes". The UI must NOT become a second, divergent source of truth for permissions
// (AF-080 spirit). This module is deliberately framework-free pure logic so it is proven with the
// repo's tsx --test harness exactly like every app/* package (see nav.test.ts): the React NavRail
// component is only a thin renderer over visibleNav()'s output.
//
// How non-drift is guaranteed (proven in nav.test.ts, not asserted here):
//   1. Every NavEntry.node is a real string from app/rbac's CATALOG — the test fails if any nav entry
//      references a node that is not in CATALOG_NODES (an invented node = a second source of truth).
//   2. visibleNav(entries, grantedNodes) uses set membership on the SAME node set app/rbac's can()
//      resolves from (effectiveNodes → user_roles ⋈ role_permissions). The test proves, for every seeded
//      role, that an entry is visible IFF can(store, user, entry.node) allows — the UI gate and the
//      harness gate agree pairwise. There is no separate role→visibility table here to drift.

/** One navigable destination in the app shell. */
export interface NavEntry {
  id: string;
  label: string;
  href: string;
  /**
   * The can() permission node that gates this entry. `null` ⇒ ungated (reachable by any authenticated
   * user — used sparingly, e.g. a personal landing). A non-null node MUST exist in app/rbac's CATALOG
   * (enforced by nav.test.ts) — the nav invents no permission of its own.
   */
  node: string | null;
  /** Rail grouping header. Purely presentational. */
  section: string;
  /** A short glyph key the renderer maps to an icon. Status/meaning is never conveyed by colour alone. */
  icon?: string;
}

/**
 * The single gate the shell's nav uses. Given the caller's effective granted-node set (resolved by
 * app/rbac's effectiveNodes() — the same reader can() uses), return only the entries the caller may see.
 *
 * ABSENT-NOT-EMPTY (FR-1.PERM.006 discipline): a denied entry is filtered OUT of the returned list — it
 * is never rendered as a disabled/greyed/"empty" item that leaks the existence of a capability the caller
 * lacks. A caller who holds no gated node simply sees a shorter rail, not a wall of locked rows.
 */
export function visibleNav(entries: readonly NavEntry[], grantedNodes: ReadonlySet<string>): NavEntry[] {
  return entries.filter((e) => e.node === null || grantedNodes.has(e.node));
}

/** Group an already-filtered nav list into its rail sections, preserving first-seen order. */
export function navSections(entries: readonly NavEntry[]): Array<{ section: string; entries: NavEntry[] }> {
  const order: string[] = [];
  const bySection = new Map<string, NavEntry[]>();
  for (const e of entries) {
    if (!bySection.has(e.section)) {
      bySection.set(e.section, []);
      order.push(e.section);
    }
    bySection.get(e.section)!.push(e);
  }
  return order.map((section) => ({ section, entries: bySection.get(section)! }));
}

/**
 * The per-client deployment app's nav (web/client). Every `node` is a real app/rbac CATALOG node
 * (verified in nav.test.ts). Gating one entry per surface the client deployment renders.
 * NB: no `client_slug` concept here — that is valid ONLY in the super-admin management plane (ADR-001 §3).
 */
export const CLIENT_NAV: readonly NavEntry[] = [
  { id: 'ops', label: 'Operations', href: '/ops', node: 'PERM-dashboard.ops', section: 'Dashboards', icon: 'activity' },
  { id: 'overview', label: 'Agency Overview', href: '/overview', node: 'PERM-dashboard.overview', section: 'Dashboards', icon: 'grid' },
  { id: 'workspace', label: 'My Workspace', href: '/workspace', node: 'PERM-dashboard.workspace', section: 'Dashboards', icon: 'home' },
  { id: 'approvals', label: 'Approvals', href: '/approvals', node: 'PERM-action.review', section: 'Work Queues', icon: 'check' },
  { id: 'ingestion', label: 'Ingestion Queue', href: '/ingestion', node: 'PERM-ingestion.review', section: 'Work Queues', icon: 'inbox' },
  { id: 'support', label: 'Support Requests', href: '/support-requests', node: 'PERM-support.view', section: 'Work Queues', icon: 'life-buoy' },
  { id: 'agents', label: 'Agents', href: '/agents', node: 'PERM-agents.view', section: 'Assets', icon: 'cpu' },
  { id: 'tools', label: 'Tools', href: '/tools', node: 'PERM-tool.manage', section: 'Assets', icon: 'wrench' },
  { id: 'prompts', label: 'Prompts', href: '/prompts', node: 'PERM-prompt.edit', section: 'Assets', icon: 'file-text' },
  { id: 'commands', label: 'Commands', href: '/commands', node: 'PERM-commands.manage', section: 'Assets', icon: 'terminal' },
  { id: 'users', label: 'User Management', href: '/users', node: 'PERM-user.invite', section: 'Administration', icon: 'users' },
  { id: 'config', label: 'Config Admin', href: '/config', node: 'PERM-config.auth', section: 'Administration', icon: 'sliders' },
  { id: 'audit', label: 'Audit Log', href: '/audit', node: 'PERM-compliance.view_audit', section: 'Administration', icon: 'shield' },
];

/**
 * The super-admin management-plane app's nav (web/admin) — a SEPARATE Next.js deployment (ADR-001 §7).
 * All entries gate on `Management Plane` PERM-fleet.* nodes (Super-Admin-only by default). This is the
 * only app where cross-deployment / client_slug-scoped views are valid.
 */
export const ADMIN_NAV: readonly NavEntry[] = [
  { id: 'fleet', label: 'Fleet Console', href: '/fleet', node: 'PERM-fleet.view', section: 'Management Plane', icon: 'grid' },
  { id: 'provision', label: 'Provisioning', href: '/provision', node: 'PERM-fleet.provision', section: 'Management Plane', icon: 'plus-square' },
  { id: 'releases', label: 'Releases', href: '/releases', node: 'PERM-fleet.promote_release', section: 'Management Plane', icon: 'upload' },
  { id: 'offboarding', label: 'Offboarding', href: '/offboarding', node: 'PERM-fleet.offboard', section: 'Management Plane', icon: 'user-x' },
  { id: 'tokens', label: 'Token Rotation', href: '/tokens', node: 'PERM-fleet.rotate_token', section: 'Management Plane', icon: 'key' },
];
