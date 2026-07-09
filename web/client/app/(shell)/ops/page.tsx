// ISSUE-078 — surface-05 Operations dashboard render (the walking-skeleton "Ops on real data" leg). Entry
// gated on PERM-dashboard.ops (absent-not-empty in the nav; direct-URL 404 here). Each of the nine panels
// is individually RBAC-gated (a panel the caller can't see is ABSENT, not empty — AC-7.VIEW.002.1) and read
// through the honest seam: a failed poll renders "couldn't load"/"—", a stale poll renders "stale as-of …",
// a genuine zero renders "0" — NEVER a fabricated healthy value (NFR-OBS.011 / #3). No client_slug (ADR-001).
//
// ⚠️ OD-198 ③ residual: on REAL authenticated data, the event_log/task_queue-derived panels return
// false-healthy 0-rows until the producer issues add human-path RLS. On this dev/seeded build the data is
// present, so honest-state shows it correctly — but 078 is NOT "live-verified on real data" (tracked residual).

import { notFound } from 'next/navigation';

import {
  PageHeader, Panel, HonestState, SkeletonRows, EmptyState, MetricRow, StatusBadge, StatusBanner,
} from '@harness/web-shared';

import { callerNodes } from '../../../lib/authz.ts';
import { readSeeded, simFrom, type Sim } from '../../../lib/domain-seam.ts';
import { OPS_PANELS, type PanelDef, type PanelPayload } from '../../../lib/demo-ops.ts';
import { OpsControls } from './OpsControls.tsx';

const TONE_GLYPH = { ok: '●', stale: '◐', error: '▲', unknown: '◌' } as const;

export default async function OpsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const sp = await searchParams;
  const globalSim = simFrom(sp);
  const { session, nodes } = await callerNodes();
  if (!session || !nodes.has('PERM-dashboard.ops')) notFound(); // entry gate → 404, not empty

  // Absent-not-empty: only panels whose node the caller holds (AC-7.VIEW.002.1).
  const visible = OPS_PANELS.filter((p) => nodes.has(p.node));

  const panels = await Promise.all(
    visible.map(async (p) => {
      const sim: Sim = globalSim !== 'ok' ? globalSim : (p.defaultSim ?? 'ok');
      const read = await readSeeded<PanelPayload>({
        id: `ops.${p.id}`,
        caller: { userId: session.userId, surface: 'desktop' },
        data: p.data,
        empty: {},
        sim,
      });
      return { def: p, read };
    }),
  );

  return (
    <div className="ah-stack">
      <PageHeader
        title="Operations"
        lead="Nine polled panels. Each shows its own freshness; a failed poll shows “—”/“couldn’t load”, never a fabricated “0”/“✓”/green."
        actions={<OpsControls />}
      />

      {/* Sticky summary strip */}
      <div className="ah-summary-strip" aria-label="Health summary">
        {panels.map(({ def, read }) => (
          <StatusBadge
            key={def.id}
            tone={read.kind === 'ok' ? 'ok' : read.kind === 'stale' ? 'stale' : read.kind === 'error' ? 'error' : 'unknown'}
            label={def.title}
          />
        ))}
      </div>

      <StatusBanner tone="unknown" message="OD-198 ③ residual: on real authenticated data the event-log / queue panels read false-healthy 0-rows until producer-RLS lands. On this dev/seeded build honest-state shows it correctly — not yet live-verified on real data." />

      <div className="ah-dash-grid">
        {panels.map(({ def, read }) => (
          <DashboardPanel key={def.id} def={def} read={read} />
        ))}
      </div>
    </div>
  );
}

function DashboardPanel({ def, read }: { def: PanelDef; read: Awaited<ReturnType<typeof readSeeded<PanelPayload>>> }): React.JSX.Element {
  const tone = read.kind === 'ok' ? 'ok' : read.kind === 'stale' ? 'stale' : read.kind === 'error' ? 'error' : read.kind === 'unknown' ? 'unknown' : 'loading';
  const asOf = 'asOf' in read ? read.asOf : undefined;
  return (
    <Panel>
      <div className="ah-panel-head">
        <h2 className="ah-panel-title" style={{ margin: 0 }}>
          {def.title}{def.od198 ? <span className="ah-muted" title="Carries the OD-198 ③ producer-RLS residual"> ⚠︎</span> : null}
        </h2>
        <span className="ah-panel-freshness">
          <span aria-hidden="true">{tone !== 'loading' ? TONE_GLYPH[tone] : '…'}</span>{' '}
          {asOf ? `as of ${asOf}` : tone === 'loading' ? 'loading…' : ''} · {def.poll}
        </span>
      </div>

      {read.kind === 'loading' ? <SkeletonRows count={3} /> : null}

      <HonestState result={read}>
        {(payload) => (isEmpty(payload) ? <EmptyState message={def.emptyMsg} /> : <PanelBody payload={payload} />)}
      </HonestState>
    </Panel>
  );
}

function isEmpty(p: PanelPayload): boolean {
  return (!p.metrics || p.metrics.length === 0) && (!p.rows || p.rows.length === 0);
}

function PanelBody({ payload }: { payload: PanelPayload }): React.JSX.Element {
  return (
    <div>
      {payload.metrics?.map((m) => (
        <MetricRow key={m.label} label={m.label} value={<span className={m.tone ? `ah-tone-${m.tone}` : undefined}>{m.value}</span>} />
      ))}
      {payload.rows && payload.rows.length > 0 ? (
        <ul className="ah-stack" style={{ listStyle: 'none', margin: 'var(--space-3) 0 0', padding: 0, gap: 'var(--space-2)' }}>
          {payload.rows.map((r, i) => (
            <li key={i} className="ah-row" style={{ justifyContent: 'space-between' }}>
              <span className={r.tone ? `ah-tone-${r.tone}` : undefined}>
                {r.tone ? <span aria-hidden="true">{TONE_GLYPH[r.tone]} </span> : null}{r.text}
              </span>
              {r.meta ? <span className="ah-muted ah-mono">{r.meta}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {payload.note ? <p className="ah-field-hint" style={{ marginTop: 'var(--space-3)' }}>{payload.note}</p> : null}
    </div>
  );
}
