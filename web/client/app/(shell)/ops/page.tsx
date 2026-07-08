// ISSUE-087 §4 — the Operations surface stub (surface-05 render layer lands with ISSUE-078). Its job HERE
// is to make the never-false-healthy discipline VISIBLE: the same MetricTile fed ok / stale / error /
// can't-confirm / loading reads. A failed or unconfirmable read renders "—" + an honest banner — never a
// fabricated "0"/"✓"/all-green (NFR-OBS.011 / OD-198 ③). Every surface inherits this by using these tiles.

import { Panel, MetricTile, StatusBanner, type ReadResult } from '@harness/web-shared';

export default function OpsPage(): React.JSX.Element {
  const now = '12:00:00';
  const okRead: ReadResult<number> = { kind: 'ok', data: 0, asOf: now }; // a GENUINE zero — shows "0"
  const staleRead: ReadResult<number> = { kind: 'stale', data: 3, asOf: '11:55:00' };
  const errorRead: ReadResult<number> = { kind: 'error', message: "Couldn't reach the task queue — retry." };
  const unknownRead: ReadResult<number> = { kind: 'unknown', message: 'Not permitted to view this queue.' };
  const loadingRead: ReadResult<number> = { kind: 'loading' };

  return (
    <div className="ah-stack">
      <div>
        <h1 className="ah-page-title">Operations</h1>
        <p className="ah-page-lead">
          Surface-05 renders here once ISSUE-078 lands. Shown below: the honest-state primitives every tile uses, so a
          failed or unconfirmable read can never masquerade as healthy.
        </p>
      </div>

      <Panel title="Honest-state tiles — the same component, five read outcomes">
        <div className="ah-tile-grid">
          <MetricTile label="Dead-letter queue (genuine 0)" result={okRead} format={(n) => String(n)} />
          <MetricTile label="Escalations (stale)" result={staleRead} format={(n) => String(n)} />
          <MetricTile label="Failed jobs (read errored)" result={errorRead} format={(n) => String(n)} />
          <MetricTile label="Restricted queue (not permitted)" result={unknownRead} format={(n) => String(n)} />
          <MetricTile label="Connectors (loading)" result={loadingRead} format={(n) => String(n)} />
        </div>
        <div style={{ marginTop: 'var(--space-5)' }} className="ah-stack">
          <StatusBanner tone="error" message="A confirmed-bad read shows this, not an empty panel that reads as 'all clear'." />
          <StatusBanner tone="unknown" message="A can't-confirm read is visibly distinct from a genuine zero — OD-198 ③." />
        </div>
      </Panel>
    </div>
  );
}
