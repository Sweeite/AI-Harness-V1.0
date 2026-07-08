// ISSUE-087 §4 — proves the aal2 gate: "an aal2-required area is gated (renders the step-up, does not
// leak)". Config Admin (surface-01) is sensitive → it requires an aal2 (2FA-verified) session. An aal1
// caller sees the step-up prompt and NONE of the config content. (Node-level access to this route is
// already gated in the nav via PERM-config.auth; this is the ADDITIONAL aal2 posture from ISSUE-020.)

import { Panel } from '@harness/web-shared';

import { getSession } from '../../../lib/auth.ts';
import { completeStepUp } from '../../actions.ts';

export default async function ConfigPage(): Promise<React.JSX.Element> {
  const session = await getSession();

  if (!session || session.aal !== 'aal2') {
    return (
      <div className="ah-stack">
        <h1 className="ah-page-title">Two-factor verification required</h1>
        <Panel title="Step up to continue">
          <p className="ah-page-lead">
            Config Admin handles sensitive deployment settings, so it requires a 2FA-verified session (aal2). Your
            current session is <strong>aal1</strong>. The configuration is not shown until you verify — it does not leak.
          </p>
          <form action={completeStepUp.bind(null, '/config')}>
            <button type="submit" className="ah-btn ah-btn-accent">
              Complete 2FA step-up (demo)
            </button>
          </form>
        </Panel>
      </div>
    );
  }

  return (
    <div className="ah-stack">
      <h1 className="ah-page-title">Config Admin</h1>
      <p className="ah-page-lead">
        Surface-01 renders here once ISSUE-086 lands. You reached it because you hold <code>PERM-config.auth</code> AND
        an aal2 session.
      </p>
      <Panel title="Deployment configuration">
        <p className="ah-muted">Config sections A–N mount here (read-only preview in the substrate).</p>
      </Panel>
    </div>
  );
}
