// ISSUE-089 — surface-02 "Users & Access" render (the walking-skeleton User-Management leg). Entry gated on
// ANY of PERM-user.invite/.assign_role/.deactivate (absent-not-empty in the nav; direct-URL 404 here). Each
// tab is individually RBAC-gated — a tab the caller can't access is ABSENT, not empty (FR-1.PERM.006):
//   Users        → entry nodes
//   Roles, Perms → PERM-system.role_manage (Super Admin)
//   Clearances, Reviews → PERM-user.grant_clearance (Super Admin)
//   Restricted   → PERM-user.grant_restricted (Super Admin)
// Every list is read through the honest seam: a fetch failure renders an error, NEVER a false-empty roster /
// matrix / review-queue (#3). The last-Super-Admin guard + mandatory-Restricted-reason are surfaced client-side.
// Data is SEEDED demo (dev-auth path); the RBAC roles/nodes/matrix are the REAL app/rbac catalog.

import { notFound } from 'next/navigation';

import { PageHeader, readSeeded, simFrom } from '@harness/web-shared';

import { callerNodes } from '../../../lib/authz.ts';
import {
  DEMO_USERS_ROSTER, DEMO_CLEARANCES, DEMO_REVIEWS, DEMO_RESTRICTED,
  type DemoUser, type DemoClearance, type DemoReview, type DemoRestricted,
} from '../../../lib/demo-users.ts';
import { matrixByCategory, grantLookup, demoRoles, ROLES, type DemoRole, type MatrixCategory } from '../../../lib/demo-rbac.ts';
import { UsersAccess, type Tab } from './UsersAccess.tsx';

const ENTRY_NODES = ['PERM-user.invite', 'PERM-user.assign_role', 'PERM-user.deactivate'];

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const sp = await searchParams;
  const sim = simFrom(sp);
  const { session, nodes } = await callerNodes();
  if (!session || !ENTRY_NODES.some((n) => nodes.has(n))) notFound();

  const caller = { userId: session.userId, surface: 'desktop' as const };

  // Which tabs are visible (absent-not-empty).
  const canRoleManage = nodes.has('PERM-system.role_manage');
  const canClearance = nodes.has('PERM-user.grant_clearance');
  const canRestricted = nodes.has('PERM-user.grant_restricted');
  const tabs: Tab[] = [
    'users',
    ...(canRoleManage ? (['roles', 'permissions'] as Tab[]) : []),
    ...(canClearance ? (['clearances', 'reviews'] as Tab[]) : []),
    ...(canRestricted ? (['restricted'] as Tab[]) : []),
  ];

  // Roster + role counts (for the Roles tab + last-SA guard).
  const roleCounts: Record<string, number> = {};
  for (const u of DEMO_USERS_ROSTER) if (u.active) roleCounts[u.role] = (roleCounts[u.role] ?? 0) + 1;
  const superAdminCount = DEMO_USERS_ROSTER.filter((u) => u.active && u.role === 'Super Admin').length;

  // Every tab's data read through the honest seam.
  const usersRead = await readSeeded<DemoUser[]>({ id: 'users.roster', caller, data: DEMO_USERS_ROSTER, empty: [], sim });
  const rolesRead = await readSeeded<DemoRole[]>({ id: 'users.roles', caller, data: demoRoles(roleCounts), empty: [], sim });
  const matrixRead = await readSeeded<MatrixCategory[]>({ id: 'users.matrix', caller, data: matrixByCategory(), empty: [], sim });
  const clearRead = await readSeeded<DemoClearance[]>({ id: 'users.clearances', caller, data: DEMO_CLEARANCES, empty: [], sim });
  const reviewRead = await readSeeded<DemoReview[]>({ id: 'users.reviews', caller, data: DEMO_REVIEWS, empty: [], sim });
  const restrictedRead = await readSeeded<DemoRestricted[]>({ id: 'users.restricted', caller, data: DEMO_RESTRICTED, empty: [], sim });

  return (
    <div className="ah-stack">
      <PageHeader title="Users & Access" lead="The access-control cockpit. Every tab is RBAC-gated; every list fails honest (a failed load shows an error, never an empty roster that reads as “no users”)." />
      <UsersAccess
        tabs={tabs}
        roles={[...ROLES]}
        superAdminCount={superAdminCount}
        grants={grantLookup()}
        usersRead={usersRead}
        rolesRead={rolesRead}
        matrixRead={matrixRead}
        clearRead={clearRead}
        reviewRead={reviewRead}
        restrictedRead={restrictedRead}
      />
    </div>
  );
}
