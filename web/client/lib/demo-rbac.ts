// ISSUE-089 — the Permissions matrix + Roles data, built from the REAL app/rbac catalog (not seeded).
// AC-1.PERM.005.2: EVERY catalog node renders as a matrix row — we iterate CATALOG, hardcoding/omitting
// nothing, so a catalog change reshapes the matrix with no edit here. Grant cells come from defaultMatrix
// (role → granted nodes) — the same source app/rbac's can() resolves. Grouping key is the node's own
// `section` (the "admin-matrix grouping key" per CatalogNode), so the accordion is catalog-count-agnostic.

import { CATALOG, defaultMatrix, ROLES, PROTECTED_ROLE, type CatalogNode, type Role } from '@harness/rbac-bridge';

export { ROLES, PROTECTED_ROLE, type Role };

export interface MatrixCategory { section: string; nodes: CatalogNode[] }

/** Group the whole catalog by its owning section, first-seen order preserved. */
export function matrixByCategory(): MatrixCategory[] {
  const order: string[] = [];
  const bySection = new Map<string, CatalogNode[]>();
  for (const n of CATALOG) {
    if (!bySection.has(n.section)) { bySection.set(n.section, []); order.push(n.section); }
    bySection.get(n.section)!.push(n);
  }
  return order.map((section) => ({ section, nodes: bySection.get(section)! }));
}

/** The default grant matrix as a plain lookup the client toggle grid seeds from. role → Set(node). */
export function grantLookup(): Record<Role, string[]> {
  const m = defaultMatrix();
  const out = {} as Record<Role, string[]>;
  for (const r of ROLES) out[r] = [...(m.get(r) ?? new Set<string>())];
  return out;
}

export interface DemoRole { name: Role; isProtected: boolean; assignedUsers: number; nodeCount: number }

/** The six default roles for the Roles tab, with assigned-user counts (seeded roster) + node counts. */
export function demoRoles(rosterRoleCounts: Record<string, number>): DemoRole[] {
  const m = defaultMatrix();
  return ROLES.map((name) => ({
    name,
    isProtected: name === PROTECTED_ROLE,
    assignedUsers: rosterRoleCounts[name] ?? 0,
    nodeCount: (m.get(name) ?? new Set()).size,
  }));
}
