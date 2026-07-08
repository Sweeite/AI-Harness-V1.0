// ISSUE-087 §4 — the auth boundary landing. NB: this is the SUBSTRATE's minimal dev sign-in, not the
// surface-00 login SCREEN (that render layer is ISSUE-013). It proves the anonymous→authenticated split:
// an unauthenticated visitor is routed here by middleware; signing in establishes the server session and
// lands on the RBAC-scoped shell. In dev it offers the demo roster so the operator can watch the RBAC nav
// change per role — a live demonstration of the absent-not-empty gate.

import { signInAs } from '../actions.ts';
import { ALL_ROLES } from '../../lib/rbac-seam.ts';
import { isSupabaseConfigured } from '../../lib/supabase-server.ts';

export default function LoginPage(): React.JSX.Element {
  const live = isSupabaseConfigured();
  return (
    <div className="ah-login-wrap">
      <main className="ah-login-card">
        <div className="ah-brand" style={{ marginBottom: 'var(--space-2)' }}>
          <span className="ah-brand-dot" aria-hidden="true" />
          <span>Harness</span>
        </div>
        <h1 className="ah-page-title">Sign in</h1>
        <p className="ah-page-lead">
          {live
            ? 'This deployment is configured for live Supabase auth (OAuth — surface-00 / ISSUE-013).'
            : 'Substrate dev sign-in. Pick a role to preview its RBAC-scoped shell — the nav renders only what that role can reach.'}
        </p>

        {!live ? (
          <div className="ah-role-grid">
            {ALL_ROLES.map((role) => (
              <form key={role} action={signInAs.bind(null, role, true)}>
                <button type="submit" className="ah-btn ah-btn-accent" style={{ width: '100%', justifyContent: 'space-between' }}>
                  <span>Continue as {role}</span>
                  <span aria-hidden="true">→</span>
                </button>
              </form>
            ))}
            <form action={signInAs.bind(null, 'Super Admin', false)}>
              <button type="submit" className="ah-btn" style={{ width: '100%' }}>
                Super Admin — sign in <em>without</em> 2FA (to see the aal2 step-up gate)
              </button>
            </form>
          </div>
        ) : (
          <p className="ah-muted">Live OAuth screens are ISSUE-013's render layer, mounted into this substrate.</p>
        )}
      </main>
    </div>
  );
}
