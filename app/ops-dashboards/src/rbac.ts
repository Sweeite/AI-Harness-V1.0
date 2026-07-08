// ISSUE-078 — the render-time RBAC gate (FR-7.VIEW.002 / AC-7.VIEW.002.1). The cardinal rule: an unpermitted
// panel/section is ABSENT, not empty (FR-1.PERM.006) — a caller must not learn a panel exists by seeing a
// disabled/empty shell. All nodes default-deny (FR-1.PERM.002 / OD-030): the gate opens ONLY on a held node
// AND a role the item is scoped to.

import { type CatalogItem, type CatalogAction, type Role, type PermNode } from "./catalog.ts";

/** The authenticated caller as far as this surface is concerned: their held C1 nodes + their role. */
export interface Caller {
  role: Role;
  heldNodes: ReadonlySet<string>;
}

/** Convenience constructor so tests/callers pass a node array. */
export function caller(role: Role, heldNodes: string[]): Caller {
  return { role, heldNodes: new Set(heldNodes) };
}

/** Does the caller's role + held-node set permit this item to RENDER? (view-gate only, not its actions). */
export function canView(c: Caller, item: CatalogItem): boolean {
  // default-deny: both conditions required. An entry node not held → absent. A role the item is not scoped
  // to → absent (e.g. Finance on a non-Cost panel, even while holding PERM-dashboard.ops).
  return item.roles.includes(c.role) && c.heldNodes.has(item.requiresNode);
}

/** The items that RENDER for this caller — the rest are absent (not returned), never returned-but-empty. */
export function visibleItems(c: Caller, catalog: readonly CatalogItem[]): CatalogItem[] {
  return catalog.filter((item) => canView(c, item));
}

/** Can the caller invoke this action? Requires the item to be viewable AND the action's own node held
 *  (least-privilege: viewing the DLQ does not grant requeue). */
export function canAct(c: Caller, item: CatalogItem, action: CatalogAction): boolean {
  if (!canView(c, item)) return false;
  return c.heldNodes.has(action.requiresNode);
}

/** The actions the caller may invoke on a (viewable) item — the rest render disabled/absent, never as
 *  clickable-but-silently-noop (a hidden authz failure would be a #3). */
export function permittedActions(c: Caller, item: CatalogItem): CatalogAction[] {
  if (!canView(c, item)) return [];
  return item.actions.filter((a) => c.heldNodes.has(a.requiresNode));
}
