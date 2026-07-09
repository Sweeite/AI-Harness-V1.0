'use client';

// ISSUE-089 — surface-02 "Users & Access" tabbed cockpit. Only the tabs passed in are rendered (the server
// already filtered them by node — absent-not-empty). Every tab renders its data via <HonestState>, so a
// failed/stale read can never become a false-empty list (#3). Interactive discipline shown: the last-Super-
// Admin guard (a deactivate/role-change that would drop the last SA is blocked with a visible reason), the
// permission matrix's optimistic-with-rollback toggle, and the mandatory reason on a Restricted grant.
//
// Writes here are demo-local (the live role_permissions / user writes are app/user-mgmt's adapter, OD-175).

import * as React from 'react';
import {
  Tabs, Modal, Drawer, DataTable, EmptyState, HonestState, SkeletonRows, Field, StatusBadge,
  StatusBanner, DescriptionList, type ReadResult, type Column, type TabDef,
} from '@harness/web-shared';

import type { DemoUser, DemoClearance, DemoReview, DemoRestricted } from '../../../lib/demo-users.ts';
import type { DemoRole, MatrixCategory } from '../../../lib/demo-rbac.ts';
import type { Role } from '../../../lib/rbac-seam.ts';

export type Tab = 'users' | 'roles' | 'permissions' | 'clearances' | 'reviews' | 'restricted';

const TAB_LABEL: Record<Tab, string> = {
  users: 'Users', roles: 'Roles', permissions: 'Permissions', clearances: 'Clearances', reviews: 'Reviews', restricted: 'Restricted',
};

export function UsersAccess(props: {
  tabs: Tab[];
  roles: Role[];
  superAdminCount: number;
  grants: Record<Role, string[]>;
  usersRead: ReadResult<DemoUser[]>;
  rolesRead: ReadResult<DemoRole[]>;
  matrixRead: ReadResult<MatrixCategory[]>;
  clearRead: ReadResult<DemoClearance[]>;
  reviewRead: ReadResult<DemoReview[]>;
  restrictedRead: ReadResult<DemoRestricted[]>;
}): React.JSX.Element {
  const [active, setActive] = React.useState<Tab>(props.tabs[0] ?? 'users');

  const usersCount = props.usersRead.kind === 'ok' ? props.usersRead.data.length : undefined;
  const overdue = props.reviewRead.kind === 'ok' ? props.reviewRead.data.filter((r) => r.dueState === 'overdue').length : undefined;

  const tabDefs: TabDef[] = props.tabs.map((t) => ({
    id: t,
    label: TAB_LABEL[t],
    count: t === 'users' ? usersCount : t === 'reviews' ? overdue : undefined,
    countTone: t === 'reviews' && overdue ? 'error' : undefined,
  }));

  return (
    <div>
      <Tabs tabs={tabDefs} active={active} onSelect={(id) => setActive(id as Tab)} />
      <div id={`panel-${active}`} role="tabpanel" aria-labelledby={`tab-${active}`}>
        {active === 'users' ? <UsersTab read={props.usersRead} superAdminCount={props.superAdminCount} roles={props.roles} /> : null}
        {active === 'roles' ? <RolesTab read={props.rolesRead} /> : null}
        {active === 'permissions' ? <PermissionsTab read={props.matrixRead} roles={props.roles} grants={props.grants} /> : null}
        {active === 'clearances' ? <ClearancesTab read={props.clearRead} /> : null}
        {active === 'reviews' ? <ReviewsTab read={props.reviewRead} /> : null}
        {active === 'restricted' ? <RestrictedTab read={props.restrictedRead} /> : null}
      </div>
    </div>
  );
}

function Loading({ read }: { read: ReadResult<unknown> }): React.JSX.Element | null {
  return read.kind === 'loading' ? <SkeletonRows /> : null;
}

// ── Users ─────────────────────────────────────────────────────────────────────────────────────────
const MFA_LABEL = { enrolled: 'Enrolled', 'not-enrolled': 'Not enrolled', 'via-idp': 'via identity provider' } as const;

function UsersTab(props: { read: ReadResult<DemoUser[]>; superAdminCount: number; roles: Role[] }): React.JSX.Element {
  const [drawer, setDrawer] = React.useState<DemoUser | null>(null);
  const [invite, setInvite] = React.useState(false);
  const [blocked, setBlocked] = React.useState<string | null>(null);

  const tryDeactivate = (u: DemoUser) => {
    if (u.active && u.role === 'Super Admin' && props.superAdminCount <= 1) {
      setBlocked(`Can’t deactivate ${u.name}: they are the last Super Admin. Assign another Super Admin first (FR-1.ROLE.005).`);
      return;
    }
    setBlocked(null);
    // demo: no persistent write on the seeded path
  };

  const columns: Column<DemoUser>[] = [
    { key: 'user', header: 'User', cell: (u) => (<div><div>{u.name}</div><div className="ah-muted ah-mono">{u.email}</div></div>) },
    { key: 'role', header: 'Role', cell: (u) => u.role },
    { key: 'status', header: 'Status', cell: (u) => <StatusBadge tone={u.active ? 'ok' : 'unknown'} label={u.active ? 'Active' : 'Deactivated'} /> },
    { key: 'mfa', header: '2FA', cell: (u) => MFA_LABEL[u.mfa] },
    { key: 'invite', header: 'Invite', cell: (u) => u.invite ? <StatusBadge tone={u.invite === 'sent' ? 'ok' : u.invite === 'send-failed' || u.invite === 'bounced' ? 'error' : 'stale'} label={u.invite.replace('-', ' ')} /> : <span className="ah-muted">—</span> },
    { key: 'actions', header: '', cell: (u) => (
      <span className="ah-row">
        <button className="ah-btn ah-btn-sm" onClick={(e) => { e.stopPropagation(); setDrawer(u); }}>Details</button>
        <button className="ah-btn ah-btn-sm ah-btn-danger" onClick={(e) => { e.stopPropagation(); tryDeactivate(u); }} disabled={!u.active}>Deactivate</button>
      </span>
    ) },
  ];

  return (
    <div>
      <div className="ah-toolbar">
        <button className="ah-btn ah-btn-accent" onClick={() => setInvite(true)}>Invite user</button>
        <span className="ah-toolbar-spacer" />
      </div>
      {blocked ? <div className="ah-inline-block-msg" role="alert" style={{ marginBottom: 'var(--space-3)' }}><span aria-hidden="true">▲</span>{blocked}</div> : null}
      <Loading read={props.read} />
      <HonestState result={props.read}>
        {(rows) => rows.length === 0
          ? <EmptyState message="You’re the only user so far. Invite your team to get started." action={<button className="ah-btn ah-btn-accent" onClick={() => setInvite(true)}>Invite user</button>} />
          : <DataTable columns={columns} rows={rows} rowKey={(u) => u.id} onRowActivate={setDrawer} />}
      </HonestState>

      {drawer ? (
        <Drawer title={drawer.name} onClose={() => setDrawer(null)}>
          <DescriptionList items={[
            { term: 'Email', detail: <span className="ah-mono">{drawer.email}</span> },
            { term: 'Role', detail: drawer.role },
            { term: 'Status', detail: drawer.active ? 'Active' : 'Deactivated' },
            { term: '2FA', detail: MFA_LABEL[drawer.mfa] },
            { term: 'Created', detail: drawer.createdAt },
            { term: 'Last active', detail: drawer.lastActiveAt ?? '—' },
          ]} />
          <div>
            <h3 className="ah-nav-section-label">Activity log</h3>
            <ul className="ah-stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 'var(--space-1)' }}>
              {drawer.activity.map((a, i) => (
                <li key={i} className="ah-metric-row">
                  <span>{a.sensitive ? <span aria-hidden="true">🔒 </span> : null}{a.summary}</span>
                  <span className="ah-muted ah-mono">{a.at}</span>
                </li>
              ))}
            </ul>
          </div>
        </Drawer>
      ) : null}

      {invite ? (
        <InviteModal onClose={() => setInvite(false)} roles={props.roles} />
      ) : null}
    </div>
  );
}

function InviteModal(props: { onClose: () => void; roles: Role[] }): React.JSX.Element {
  const [result, setResult] = React.useState<'sent' | 'failed' | null>(null);
  const [failMode, setFailMode] = React.useState(false);
  return (
    <Modal title="Invite user" onClose={props.onClose} actions={result === 'sent' ? <button className="ah-btn ah-btn-accent" onClick={props.onClose}>Done</button> : null}>
      {result === 'sent' ? (
        <div className="ah-banner ah-tone-ok"><span aria-hidden="true">●</span><span>Invite sent — a setup link valid for 24 hours is on its way.</span></div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); setResult(failMode ? 'failed' : 'sent'); }}>
          <Field label="Email" htmlFor="inv-email" required><input id="inv-email" type="email" className="ah-input" required /></Field>
          <Field label="Name" htmlFor="inv-name" required><input id="inv-name" className="ah-input" required /></Field>
          <Field label="Role" htmlFor="inv-role" required>
            <select id="inv-role" className="ah-select">{props.roles.map((r) => <option key={r}>{r}</option>)}</select>
          </Field>
          <label className="ah-field-hint" style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <input type="checkbox" checked={failMode} onChange={(e) => setFailMode(e.target.checked)} /> Simulate SMTP send failure (demo)
          </label>
          {result === 'failed' ? <p className="ah-field-error"><span aria-hidden="true">▲</span>Send failed — SMTP not configured / throttled. Retry.</p> : null}
          <div className="ah-modal-actions">
            <button type="button" className="ah-btn" onClick={props.onClose}>Cancel</button>
            <button type="submit" className="ah-btn ah-btn-accent">Send invite</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ── Roles ─────────────────────────────────────────────────────────────────────────────────────────
function RolesTab(props: { read: ReadResult<DemoRole[]> }): React.JSX.Element {
  const columns: Column<DemoRole>[] = [
    { key: 'name', header: 'Role', cell: (r) => <strong>{r.name}</strong> },
    { key: 'protected', header: 'Protected', cell: (r) => r.isProtected ? <StatusBadge tone="ok" label="protected" /> : <span className="ah-muted">—</span> },
    { key: 'users', header: 'Assigned users', cell: (r) => String(r.assignedUsers), numeric: true },
    { key: 'nodes', header: 'Permission nodes', cell: (r) => String(r.nodeCount), numeric: true },
    { key: 'actions', header: '', cell: (r) => (
      <span className="ah-row">
        <button className="ah-btn ah-btn-sm" disabled>Edit</button>
        <button className="ah-btn ah-btn-sm ah-btn-danger" disabled={r.isProtected || r.assignedUsers > 0} title={r.assignedUsers > 0 ? `${r.assignedUsers} users still assigned` : r.isProtected ? 'protected role' : undefined}>Delete</button>
      </span>
    ) },
  ];
  return (
    <div>
      <div className="ah-toolbar"><button className="ah-btn ah-btn-accent" disabled>New role</button></div>
      <Loading read={props.read} />
      <HonestState result={props.read}>
        {(rows) => rows.length === 0
          ? <StatusBanner tone="error" message="Role set incomplete — provisioning may have failed; contact the operator." />
          : <DataTable columns={columns} rows={rows} rowKey={(r) => r.name} />}
      </HonestState>
    </div>
  );
}

// ── Permissions matrix ──────────────────────────────────────────────────────────────────────────
function PermissionsTab(props: { read: ReadResult<MatrixCategory[]>; roles: Role[]; grants: Record<Role, string[]> }): React.JSX.Element {
  // Optimistic grant state: role -> Set(node). Seeded from the REAL default matrix.
  const [grants, setGrants] = React.useState<Record<string, Set<string>>>(() => {
    const g: Record<string, Set<string>> = {};
    for (const r of props.roles) g[r] = new Set(props.grants[r] ?? []);
    return g;
  });
  const [failNext, setFailNext] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState<string | null>(null);

  const toggle = (role: Role, node: string) => {
    const had = grants[role]?.has(node) ?? false;
    // optimistic flip
    setGrants((prev) => {
      const set = new Set(prev[role]);
      if (had) set.delete(node); else set.add(node);
      return { ...prev, [role]: set };
    });
    setSaving(`${role}:${node}`);
    // simulate the async write; on failure, roll the cell back
    setTimeout(() => {
      setSaving(null);
      if (failNext) {
        setGrants((prev) => {
          const set = new Set(prev[role]);
          if (had) set.add(node); else set.delete(node); // revert
          return { ...prev, [role]: set };
        });
        setSaveError('Couldn’t save that change — retry.');
        setFailNext(false);
      } else {
        setSaveError(null);
      }
    }, 350);
  };

  return (
    <div>
      <div className="ah-toolbar">
        <label className="ah-field-hint" style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <input type="checkbox" checked={failNext} onChange={(e) => setFailNext(e.target.checked)} /> Simulate next save failing (demo — proves optimistic rollback)
        </label>
        <span className="ah-toolbar-spacer" />
      </div>
      {saveError ? <div className="ah-inline-block-msg" role="alert" style={{ marginBottom: 'var(--space-3)' }}><span aria-hidden="true">▲</span>{saveError}</div> : null}

      {/* <768px: the ONE section that does not adapt — a wider-display notice + read-only category list. */}
      <div className="ah-narrow-only">
        <StatusBanner tone="unknown" message="This screen needs a wider display. Editing the permission matrix on a phone is out of scope." />
        <HonestState result={props.read}>
          {(cats) => <ul className="ah-muted">{cats.map((c) => <li key={c.section}>{c.section} ({c.nodes.length} nodes)</li>)}</ul>}
        </HonestState>
      </div>

      <div className="ah-wide-only">
        <Loading read={props.read} />
        <HonestState result={props.read}>
          {(cats) => cats.length === 0
            ? <StatusBanner tone="error" message="Permission catalog failed to load." />
            : (
              <div className="ah-matrix-wrap">
                <table className="ah-matrix">
                  <thead>
                    <tr>
                      <th className="ah-matrix-node" scope="col">Permission node</th>
                      {props.roles.map((r) => <th key={r} scope="col">{r}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {cats.map((cat) => (
                      <React.Fragment key={cat.section}>
                        <tr className="ah-matrix-cat"><th colSpan={props.roles.length + 1} scope="colgroup">{cat.section}</th></tr>
                        {cat.nodes.map((n) => (
                          <tr key={n.node}>
                            <th className="ah-matrix-node" scope="row" title={n.description}><span className="ah-mono">{n.node}</span></th>
                            {props.roles.map((role) => {
                              const on = grants[role]?.has(n.node) ?? false;
                              const busy = saving === `${role}:${n.node}`;
                              return (
                                <td key={role}>
                                  <button
                                    type="button"
                                    className={`ah-toggle${busy ? ' ah-saving' : ''}`}
                                    aria-pressed={on}
                                    aria-label={`${on ? 'Granted' : 'Not granted'}: ${n.node} for ${role}`}
                                    onClick={() => toggle(role, n.node)}
                                  >{on ? '✓' : ''}</button>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </HonestState>
      </div>
    </div>
  );
}

// ── Clearances ────────────────────────────────────────────────────────────────────────────────
function ClearancesTab(props: { read: ReadResult<DemoClearance[]> }): React.JSX.Element {
  const [grant, setGrant] = React.useState(false);
  const columns: Column<DemoClearance>[] = [
    { key: 'subject', header: 'Subject', cell: (c) => <span>{c.subject} <span className="ah-muted">({c.subjectKind})</span></span> },
    { key: 'tier', header: 'Tier', cell: (c) => <StatusBadge tone="stale" label={c.tier} /> },
    { key: 'scope', header: 'Entity scope', cell: (c) => c.entityScope ?? <span className="ah-muted">Global</span> },
    { key: 'origin', header: 'Origin', cell: (c) => c.origin === 'default' ? 'role default' : 'explicit grant' },
    { key: 'reviewed', header: 'Last reviewed', cell: (c) => <span className="ah-mono">{c.lastReviewedAt}</span> },
  ];
  return (
    <div>
      <div className="ah-toolbar"><button className="ah-btn ah-btn-accent" onClick={() => setGrant(true)}>Grant clearance</button></div>
      <Loading read={props.read} />
      <HonestState result={props.read}>
        {(rows) => rows.length === 0
          ? <EmptyState message="No above-Standard clearances granted yet. Everyone has Standard by default." />
          : <DataTable columns={columns} rows={rows} rowKey={(c) => c.id} />}
      </HonestState>
      {grant ? (
        <Modal title="Grant clearance" onClose={() => setGrant(false)} actions={<><button className="ah-btn" onClick={() => setGrant(false)}>Cancel</button><button className="ah-btn ah-btn-accent" onClick={() => setGrant(false)}>Grant</button></>}>
          <Field label="Subject (user or role)" htmlFor="clr-subj"><input id="clr-subj" className="ah-input" /></Field>
          <Field label="Tier" htmlFor="clr-tier"><select id="clr-tier" className="ah-select"><option>Confidential</option><option>Personal</option></select></Field>
          <Field label="Entity-type scope" htmlFor="clr-scope" hint="Leave blank for Global."><input id="clr-scope" className="ah-input" /></Field>
          <p className="ah-field-hint">A Restricted-tier grant is done on the Restricted tab, not here.</p>
        </Modal>
      ) : null}
    </div>
  );
}

// ── Reviews ───────────────────────────────────────────────────────────────────────────────────
function ReviewsTab(props: { read: ReadResult<DemoReview[]> }): React.JSX.Element {
  const overdue = props.read.kind === 'ok' ? props.read.data.filter((r) => r.dueState === 'overdue').length : 0;
  const columns: Column<DemoReview>[] = [
    { key: 'subject', header: 'Clearance', cell: (r) => r.subject },
    { key: 'state', header: 'State', cell: (r) => <StatusBadge tone={r.dueState === 'overdue' ? 'error' : 'stale'} label={r.dueState === 'overdue' ? `overdue ${r.daysOver}d` : 'due'} /> },
    { key: 'reviewed', header: 'Last reviewed', cell: (r) => <span className="ah-mono">{r.lastReviewedAt}</span> },
    { key: 'actions', header: '', cell: () => (<span className="ah-row"><button className="ah-btn ah-btn-sm">Confirm</button><button className="ah-btn ah-btn-sm ah-btn-danger">Revoke</button></span>) },
  ];
  return (
    <div>
      {overdue > 0 ? <StatusBanner tone="error" message={`${overdue} clearance review(s) overdue — un-actioned reviews are escalated, never auto-revoked and never silently retained.`} /> : null}
      <Loading read={props.read} />
      <HonestState result={props.read}>
        {(rows) => rows.length === 0
          ? <EmptyState glyph="✓" message="No clearances are due for review." />
          : <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />}
      </HonestState>
    </div>
  );
}

// ── Restricted ───────────────────────────────────────────────────────────────────────────────
function RestrictedTab(props: { read: ReadResult<DemoRestricted[]> }): React.JSX.Element {
  const [grant, setGrant] = React.useState(false);
  const columns: Column<DemoRestricted>[] = [
    { key: 'grantee', header: 'Grantee', cell: (r) => r.grantee },
    { key: 'reason', header: 'Reason', cell: (r) => r.reason },
    { key: 'scope', header: 'Scope', cell: (r) => r.scope ?? <span className="ah-muted">—</span> },
    { key: 'granter', header: 'Granted by', cell: (r) => r.granter },
    { key: 'state', header: 'State', cell: (r) => r.revokedAt ? <StatusBadge tone="unknown" label={`revoked ${r.revokedAt}`} /> : <StatusBadge tone="ok" label="active" /> },
  ];
  return (
    <div>
      <div className="ah-toolbar"><button className="ah-btn ah-btn-accent" onClick={() => setGrant(true)}>Grant Restricted</button></div>
      <Loading read={props.read} />
      <HonestState result={props.read}>
        {(rows) => rows.length === 0
          ? <EmptyState message="No Restricted grants. Restricted access is per-person, granted only with a logged reason." />
          : <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />}
      </HonestState>
      {grant ? <RestrictedGrantModal onClose={() => setGrant(false)} /> : null}
    </div>
  );
}

function RestrictedGrantModal(props: { onClose: () => void }): React.JSX.Element {
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const submit = () => {
    if (!reason.trim()) { setError('A reason is required for Restricted access.'); return; } // AC-1.RST.002.1
    props.onClose();
  };
  return (
    <Modal title="Grant Restricted access" onClose={props.onClose} actions={<><button className="ah-btn" onClick={props.onClose}>Cancel</button><button className="ah-btn ah-btn-accent" onClick={submit}>Grant</button></>}>
      <Field label="Grantee (named individual)" htmlFor="rst-user" required><input id="rst-user" className="ah-input" placeholder="A specific person — never a role" /></Field>
      <Field label="Scope (optional)" htmlFor="rst-scope"><input id="rst-scope" className="ah-input" /></Field>
      <Field label="Reason" htmlFor="rst-reason" required error={error ?? undefined} hint="Mandatory — written to the audit trail (granter, grantee, time, reason).">
        <textarea id="rst-reason" className="ah-textarea" rows={2} value={reason} onChange={(e) => { setReason(e.target.value); if (e.target.value.trim()) setError(null); }} />
      </Field>
    </Modal>
  );
}
