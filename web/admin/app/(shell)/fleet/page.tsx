// ISSUE-078 — surface-06 Super-Admin fleet console render (the management-plane half). Entry gated on
// PERM-fleet.view (absent-not-empty in the nav; direct-URL 404 here). The Fleet Health Grid renders one
// card per deployment from the push-fed management store — NEVER a client pull (FR-7.MGM.003) — with
// frozen-≠-dead and stale/unreachable rendered honestly (a card the plane hasn't heard from is "stale"/
// "unreachable", never a false-healthy green — #2/#3). Sections B–H are each individually RBAC-gated.

import { notFound } from 'next/navigation';

import { PageHeader, Panel, HonestState, StatusBadge, StatusBanner, MetricRow, EmptyState, SkeletonRows, readSeeded, simFrom } from '@harness/web-shared';

import { callerNodes } from '../../../lib/authz.ts';
import { FLEET_GRID, FLEET_SECTIONS, type DeploymentCard, type FleetSection } from '../../../lib/demo-fleet.ts';

const HEALTH_TONE: Record<DeploymentCard['health'], 'ok' | 'stale' | 'error' | 'unknown'> = {
  healthy: 'ok', degraded: 'stale', stale: 'stale', frozen: 'unknown', unreachable: 'error',
};
const SECTION_GLYPH = { ok: '●', stale: '◐', error: '▲', unknown: '◌' } as const;

export default async function FleetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const sp = await searchParams;
  const sim = simFrom(sp);
  const { session, nodes } = await callerNodes();
  if (!session || !nodes.has('PERM-fleet.view')) notFound();

  const gridRead = await readSeeded<DeploymentCard[]>({
    id: 'fleet.grid', caller: { userId: session.userId, surface: 'desktop' }, data: FLEET_GRID, empty: [], sim,
  });
  const sections = FLEET_SECTIONS.filter((s) => nodes.has(s.node));

  return (
    <div className="ah-stack">
      <PageHeader title="Fleet Console" lead="Cross-deployment health, rendered from the push-fed management store — never a client pull. A deployment the plane can’t confirm reads “stale”/“unreachable”, never green." />

      <Panel title="Fleet Health Grid">
        <HonestState result={gridRead}>
          {(cards) => cards.length === 0 ? <EmptyState message="No deployments registered yet." /> : (
            <div className="ah-dash-grid">
              {cards.map((c) => (
                <div key={c.slug} className="ah-tile">
                  <div className="ah-panel-head">
                    <strong>{c.name}</strong>
                    <StatusBadge tone={HEALTH_TONE[c.health]} label={c.health} />
                  </div>
                  <MetricRow label="client_slug" value={<span className="ah-mono">{c.slug}</span>} />
                  <MetricRow label="core version" value={c.coreVersion} />
                  <MetricRow label="as of" value={<span className="ah-mono">{c.asOf}</span>} />
                  {c.note ? <p className="ah-field-hint" style={{ marginTop: 'var(--space-2)' }}>{c.note}</p> : null}
                </div>
              ))}
            </div>
          )}
        </HonestState>
        {gridRead.kind === 'loading' ? <SkeletonRows /> : null}
      </Panel>

      <StatusBanner tone="unknown" message="frozen ≠ dead: a frozen deployment (offboarding) is intact and shown distinctly; an unreachable one is shown unreachable — the plane never renders an unconfirmed deployment as healthy (#3)." />

      <div className="ah-dash-grid">
        {sections.map((s) => <SectionCard key={s.id} section={s} />)}
      </div>
    </div>
  );
}

function SectionCard({ section }: { section: FleetSection }): React.JSX.Element {
  return (
    <Panel title={section.title}>
      <ul className="ah-stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 'var(--space-2)' }}>
        {section.rows.map((r, i) => (
          <li key={i} className="ah-row" style={{ justifyContent: 'space-between' }}>
            <span className={r.tone ? `ah-tone-${r.tone}` : undefined}>
              {r.tone ? <span aria-hidden="true">{SECTION_GLYPH[r.tone]} </span> : null}{r.text}
            </span>
            {r.meta ? <span className="ah-muted ah-mono">{r.meta}</span> : null}
          </li>
        ))}
      </ul>
      {section.note ? <p className="ah-field-hint" style={{ marginTop: 'var(--space-3)' }}>{section.note}</p> : null}
    </Panel>
  );
}
