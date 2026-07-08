// ISSUE-087 §4 — the shell landing. Renders "one live signal END-TO-END through the typed seam" (DoD §4):
// the caller's effective RBAC nodes, read from the REAL @harness/rbac package via the DataSeam and rendered
// through the honest-state primitives. This is the reusable pattern every surface will copy.

import { Panel, HonestState, MetricTile, AnswerModePill } from '@harness/web-shared';

import { getSession } from '../../lib/auth.ts';
import { readRbacSignal } from '../../lib/rbac-seam.ts';

export default async function HomePage(): Promise<React.JSX.Element> {
  const session = await getSession();
  const role = session?.role ?? 'Standard User';
  const signal = await readRbacSignal({ userId: session?.userId ?? 'anon', surface: 'desktop' }, role);

  return (
    <div className="ah-stack">
      <div>
        <h1 className="ah-page-title">Welcome{session ? `, ${session.role}` : ''}</h1>
        <p className="ah-page-lead">
          This is the ISSUE-087 substrate shell. Your navigation on the left shows only the surfaces your role can
          reach — gated by the same <code>can()</code> nodes the harness enforces. Nothing you lack access to renders.
        </p>
      </div>

      <Panel title="Your access (live signal, read through the data-access seam)">
        <HonestState result={signal}>
          {(data) => (
            <div className="ah-stack">
              <div className="ah-tile-grid">
                <MetricTile label="Role" result={signal} format={() => data.role} />
                <MetricTile label="Permission nodes granted" result={signal} format={() => String(data.nodeCount)} />
              </div>
              <div>
                <div className="ah-muted" style={{ marginBottom: 'var(--space-2)' }}>
                  Sample of your granted nodes (from app/rbac — not a UI copy):
                </div>
                <ul className="ah-muted">
                  {data.sampleNodes.map((n) => (
                    <li key={n}>
                      <code>{n}</code>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </HonestState>
      </Panel>

      <Panel title="Answer-mode pill (NFR-OBS.012 seam)">
        <div className="ah-row">
          <AnswerModePill mode="grounded" />
          <AnswerModePill mode="assumed" />
          <AnswerModePill mode="uncertain" />
          <AnswerModePill mode={null} />
        </div>
        <p className="ah-muted" style={{ marginTop: 'var(--space-3)' }}>
          An unstated mode falls back to “Mode unavailable”, never silently to “Grounded”.
        </p>
      </Panel>
    </div>
  );
}
