// ISSUE-087 §4 — the authenticated app shell. Resolves the server session (redirecting anonymous callers
// to /login as defense-in-depth behind the middleware gate), resolves the caller's granted permission
// nodes THROUGH the rbac seam (app/rbac's own effectiveNodes — no second source of truth), and mounts the
// shared AppShell with the ADMIN_NAV (Management Plane PERM-fleet.* nodes — Super-Admin-only by default).
// The nav renders absent-not-empty. This is the SEPARATE super-admin deployment (ADR-001 §7) — the only
// app where cross-deployment / client_slug-scoped views are valid.

import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';

import { AppShell, ADMIN_NAV, ThemeToggle, StatusBadge } from '@harness/web-shared';

import { getSession } from '../../lib/auth.ts';
import { grantedNodesFor } from '../../lib/rbac-seam.ts';
import { signOut } from '../actions.ts';

export default async function ShellLayout({ children }: { children: ReactNode }): Promise<React.JSX.Element> {
  const session = await getSession();
  if (!session) redirect('/login');

  const grantedNodes = await grantedNodesFor(session.userId, session.role);

  const topbar = (
    <>
      <div className="ah-row">
        <StatusBadge tone={session.aal === 'aal2' ? 'ok' : 'stale'} label={session.aal === 'aal2' ? '2FA verified (aal2)' : 'aal1 — step-up required for sensitive areas'} />
        {session.dev ? <span className="ah-dev-banner">Dev session — seeded, no live DB</span> : null}
      </div>
      <div className="ah-row">
        <span className="ah-muted">
          {session.email} · <strong>{session.role}</strong>
        </span>
        <ThemeToggle />
        <form action={signOut}>
          <button type="submit" className="ah-btn" aria-label="Sign out">
            Sign out
          </button>
        </form>
      </div>
    </>
  );

  return (
    <AppShell brand="Harness · Admin" entries={ADMIN_NAV} grantedNodes={grantedNodes} topbar={topbar}>
      {children}
    </AppShell>
  );
}
