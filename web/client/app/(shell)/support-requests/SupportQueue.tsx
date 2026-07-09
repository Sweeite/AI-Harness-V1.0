'use client';

// ISSUE-088 — surface-00 UI-SUPPORT-REQUESTS render. Overdue-`pending` pinned top (OD-106), status filter
// chips, per-row transitions gated on PERM-support.resolve (absent ⇒ actions not rendered). Honest-state is
// enforced by the parent's HonestState wrapper — a fetch failure renders an error, NEVER an empty list that
// would falsely read "no one needs help" (#3). This component only renders a CONFIRMED list.

import * as React from 'react';
import { DataTable, EmptyState, StatusBadge, type Column } from '@harness/web-shared';

import type { DemoSupportRequest } from '../../../lib/demo-users.ts';

const STATUS_TONE = { pending: 'unknown', 'in-progress': 'stale', resolved: 'ok' } as const;

export function SupportQueue(props: {
  rows: DemoSupportRequest[];
  canResolve: boolean;
  pickUp: (id: string) => Promise<void>;
  resolve: (id: string) => Promise<void>;
}): React.JSX.Element {
  const [filter, setFilter] = React.useState<'all' | DemoSupportRequest['status']>('all');
  const rows = props.rows.filter((r) => filter === 'all' || r.status === filter);

  const columns: Column<DemoSupportRequest>[] = [
    { key: 'who', header: 'Requester', cell: (r) => (<div><div>{r.name}</div><div className="ah-muted ah-mono">{r.email}</div></div>) },
    { key: 'issue', header: 'Issue', cell: (r) => r.issue },
    { key: 'status', header: 'Status', cell: (r) => (
      <span className="ah-row">
        <StatusBadge tone={STATUS_TONE[r.status]} label={r.status} />
        {r.status === 'pending' && r.overdue ? <StatusBadge tone="error" label="overdue" /> : null}
      </span>
    ) },
    { key: 'assignee', header: 'Assignee', cell: (r) => r.assignedTo ?? <span className="ah-muted">—</span> },
    { key: 'created', header: 'Received', cell: (r) => <span className="ah-mono">{r.createdAt}</span> },
    { key: 'actions', header: 'Actions', cell: (r) => {
      if (!props.canResolve) return <span className="ah-muted">view only</span>;
      return (
        <span className="ah-row">
          {r.status === 'pending' ? <form action={() => props.pickUp(r.id)}><button className="ah-btn ah-btn-sm">Pick up</button></form> : null}
          {r.status === 'in-progress' ? <form action={() => props.resolve(r.id)}><button className="ah-btn ah-btn-sm ah-btn-accent">Resolve</button></form> : null}
          {r.status === 'resolved' ? <span className="ah-muted">closed</span> : null}
        </span>
      );
    } },
  ];

  return (
    <div>
      <div className="ah-toolbar" role="group" aria-label="Filter by status">
        {(['all', 'pending', 'in-progress', 'resolved'] as const).map((f) => (
          <button key={f} type="button" className="ah-chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState glyph="✓" message="No open support requests." />
      ) : (
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />
      )}
    </div>
  );
}
