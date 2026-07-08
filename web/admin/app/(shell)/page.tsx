// ISSUE-087 §4 — the super-admin management-plane landing. Renders the caller's fleet-node signal through
// the SAME typed seam (calling the real @harness/rbac). Only a Super Admin holds the Management Plane
// nodes, so a non-SA who somehow reaches here sees an empty rail and no fleet capabilities (absent-not-empty).

import { Panel, HonestState, MetricTile } from '@harness/web-shared';

import { getSession } from '../../lib/auth.ts';
import { readRbacSignal } from '../../lib/rbac-seam.ts';

export default async function AdminHomePage(): Promise<React.JSX.Element> {
  const session = await getSession();
  const role = session?.role ?? 'Standard User';
  const signal = await readRbacSignal({ userId: session?.userId ?? 'anon', surface: 'desktop' }, role);

  return (
    <div className="ah-stack">
      <div>
        <h1 className="ah-page-title">Management plane</h1>
        <p className="ah-page-lead">
          This is the separate super-admin app (ADR-001 §7) — its own deployment, its own Supabase. The fleet console,
          provisioning, releases, offboarding and token rotation mount here, each gated on a Management-Plane
          <code> PERM-fleet.*</code> node. This is the only app where cross-deployment views are valid.
        </p>
      </div>

      <Panel title="Your management-plane access (live signal, read through the data-access seam)">
        <HonestState result={signal}>
          {(data) => (
            <div className="ah-tile-grid">
              <MetricTile label="Role" result={signal} format={() => data.role} />
              <MetricTile label="Permission nodes granted" result={signal} format={() => String(data.nodeCount)} />
            </div>
          )}
        </HonestState>
      </Panel>
    </div>
  );
}
