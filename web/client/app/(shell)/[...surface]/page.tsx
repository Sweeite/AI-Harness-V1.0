// ISSUE-087 — honest placeholder for surfaces whose render layer hasn't landed yet (per OD-197 each
// surface's render is gated on its own backend signal `done`). A nav entry the caller is permitted to see
// but whose screen isn't built yet resolves HERE — an honest "render pending", never a 404 that would read
// as a broken app. Specific routes (/, /ops, /config) take precedence over this catch-all.

import { Panel } from '@harness/web-shared';

export default async function SurfacePlaceholder({
  params,
}: {
  params: Promise<{ surface: string[] }>;
}): Promise<React.JSX.Element> {
  const { surface } = await params;
  const path = '/' + (surface ?? []).join('/');
  return (
    <div className="ah-stack">
      <h1 className="ah-page-title">Render pending</h1>
      <Panel title={path}>
        <p className="ah-page-lead">
          You can reach this surface — your role holds its permission node. Its screen is built as a separate render
          deliverable, gated on its own backend signal (OD-197). The substrate shell, RBAC gating, honest-state
          primitives and data-access seam it will mount into are already in place.
        </p>
      </Panel>
    </div>
  );
}
