// ISSUE-067 — surface-09 "Agent Builder" render (the sectioned agent-management console, OD-138). Entry gated on
// PERM-agents.view (absent-not-empty in the nav; direct-URL hit here → 404, not empty — FR-1.PERM.006). The OD-080
// authority split (view + edit_description = SA+Admin; edit_capability = SA-only) is resolved server-side from the
// caller's REAL app/rbac effective-node set and passed down, so the Builder's locked-capability fields can never
// diverge from the harness gate. Every read runs through the honest seam: a failed/stale/can't-confirm read renders
// "—"/"unavailable"/"stale as-of …", NEVER a fabricated green/0/✓ or a false-empty fleet (#3 / NFR-OBS.011).
//
// Data is SEEDED demo (dev-auth path — no live DB, so R10 live-adapter sweep is N/A here). The load-bearing
// invariants (reject-at-write hard limits, OD-080 authority, memory_scope shape) are the REAL agent-bridge kernels.

import { notFound } from 'next/navigation';

import { PageHeader, readSeeded, simFrom } from '@harness/web-shared';

import { callerNodes } from '../../../lib/authz.ts';
import { builderAuthority, PERM_AGENTS_VIEW } from '../../../lib/agents-seam.ts';
import {
  DEMO_AGENTS, demoHealthMap, DEMO_PLANS, DEMO_ROUTING,
  type DemoAgent, type DemoHealth, type DemoPlan, type DemoRouting,
} from '../../../lib/demo-agents.ts';
import { AgentBuilder } from './AgentBuilder.tsx';

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const sp = await searchParams;
  const sim = simFrom(sp);
  const { session, nodes } = await callerNodes();
  if (!session || !nodes.has(PERM_AGENTS_VIEW)) notFound(); // entry gate → 404, not empty

  const caller = { userId: session.userId, surface: 'desktop' as const };
  const authority = builderAuthority(nodes);

  // Each table is a distinct read through the honest seam (agent_health_metrics has its own freshness, so a health
  // read can fail while the fleet still lists agents). ?sim= forces every honest-state branch in the browser.
  const agentsRead = await readSeeded<DemoAgent[]>({ id: 'agents.registry', caller, data: [...DEMO_AGENTS], empty: [], sim });
  const healthRead = await readSeeded<Record<string, DemoHealth>>({ id: 'agents.health', caller, data: demoHealthMap(), empty: {}, sim });
  const plansRead = await readSeeded<DemoPlan[]>({ id: 'agents.plans', caller, data: [...DEMO_PLANS], empty: [], sim });
  const routingRead = await readSeeded<DemoRouting>({ id: 'agents.routing', caller, data: DEMO_ROUTING, empty: {} as DemoRouting, sim });

  return (
    <div className="ah-stack">
      <PageHeader
        title="Agent Builder"
        lead="The agent fleet, definitions, version history, orchestration and execution plans. Capability edits are Super-Admin-only (OD-080); every save is versioned and needs a reason (REG.004). A failed health read shows “—”, never a fabricated green."
      />
      <AgentBuilder
        authority={authority}
        agentsRead={agentsRead}
        healthRead={healthRead}
        plansRead={plansRead}
        routingRead={routingRead}
      />
    </div>
  );
}
