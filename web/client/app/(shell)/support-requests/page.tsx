// ISSUE-088 — surface-00 UI-SUPPORT-REQUESTS route (/support-requests). Entry gated on PERM-support.view:
// absent-not-empty in the nav, AND a direct-URL hit 404s for a caller without it (FR-1.PERM.006). The queue
// is read through the honest seam: a fetch failure (?sim=error) renders an ERROR, never a false-empty list
// (#3). Actions gate on PERM-support.resolve. Overdue-pending is pinned top by the store (OD-106).

import { notFound } from 'next/navigation';

import { PageHeader, Panel, HonestState, SkeletonRows, StatusBanner } from '@harness/web-shared';

import { callerNodes } from '../../../lib/authz.ts';
import { readSeeded, simFrom } from '../../../lib/domain-seam.ts';
import { listSupportRequests } from '../../../lib/support-store.ts';
import type { DemoSupportRequest } from '../../../lib/demo-users.ts';
import { SupportQueue } from './SupportQueue.tsx';
import { pickUp, resolve } from './actions.ts';

export default async function SupportRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const sp = await searchParams;
  const sim = simFrom(sp);
  const { session, nodes } = await callerNodes();
  if (!session || !nodes.has('PERM-support.view')) notFound(); // direct-URL 404 (absent-not-empty)

  const canResolve = nodes.has('PERM-support.resolve');
  const read = await readSeeded<DemoSupportRequest[]>({
    id: 'support.queue',
    caller: { userId: session.userId, surface: 'desktop' },
    data: listSupportRequests('all'),
    empty: [],
    sim,
  });

  return (
    <div className="ah-stack">
      <PageHeader title="Support Requests" lead="Login-support requests from the sign-in page. A failed load shows an error — never an empty queue that reads as “no one needs help”." />
      <Panel>
        <HonestState result={read}>
          {(rows) => <SupportQueue rows={rows} canResolve={canResolve} pickUp={pickUp} resolve={resolve} />}
        </HonestState>
        {read.kind === 'loading' ? <SkeletonRows /> : null}
        {!canResolve ? <StatusBanner tone="unknown" message="You can view this queue but not resolve requests (needs PERM-support.resolve)." /> : null}
      </Panel>
    </div>
  );
}
