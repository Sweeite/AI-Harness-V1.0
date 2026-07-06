// ISSUE-016 — offline proof of EVERY §4 Definition-of-Done AC (FR-0.REC.001/.002/.003/.005/.006/.007) plus the
// AC-NFR-A11Y.001 baseline, run against the in-memory fakes (which mirror the ISSUE-008 DDL + the RLS boundary
// so a pass here means the live adapter behaves the same). Each test names the AC it proves.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemorySupportStore,
  SupportError,
  ERR_DENIED,
  ERR_EMPTY_FIELD,
  ERR_ILLEGAL_TRANSITION,
  ERR_IMMUTABLE,
  isLegalTransition,
  SUPPORT_STATUSES,
} from './store.ts';
import { InMemorySupportAuthz, PERM_SUPPORT_VIEW, PERM_SUPPORT_RESOLVE } from './authz.ts';
import {
  InMemoryEventSink,
  InMemoryNotificationSink,
  InMemoryAdminDirectory,
  EV_SUPPORT_REQUEST_CREATED,
  EV_SUPPORT_NOTIFICATION_SENT,
  EV_SUPPORT_NOTIFICATION_FAILED,
  EV_SUPPORT_REESCALATION,
} from './sinks.ts';
import { SupportService } from './service.ts';
import {
  buildQueueView,
  resolveQueueState,
  actionsFor,
  auditA11y,
  hasSelfServiceReset,
  LOGIN_RECOVERY_CONTROLS,
  STATUS_PRESENTATION,
  TROUBLE_SIGNING_IN_FORM,
} from './surface.ts';

const NOW = '2026-07-06T12:00:00.000Z';

/** Build a wired service + its fakes. Admins = 1 Super Admin + 1 Admin unless overridden. */
function harness(opts?: { admins?: Array<['Super Admin' | 'Admin', string]> }) {
  const authz = new InMemorySupportAuthz();
  const store = new InMemorySupportStore(authz);
  const events = new InMemoryEventSink();
  const notifications = new InMemoryNotificationSink();
  const admins = new InMemoryAdminDirectory();
  for (const [role, id] of opts?.admins ?? ([['Super Admin', 'sa-1'], ['Admin', 'ad-1']] as const)) admins.add(id, role);
  const service = new SupportService({ store, events, notifications, admins });
  return { authz, store, events, notifications, admins, service };
}

// ── AC-0.REC.001.1 — no self-service reset; only "Trouble signing in?" ──────────────────────────────
test('AC-0.REC.001.1 — the login surface exposes "Trouble signing in?" and NO self-service reset', () => {
  assert.equal(LOGIN_RECOVERY_CONTROLS.troubleSigningIn.label, 'Trouble signing in?');
  assert.equal(hasSelfServiceReset(LOGIN_RECOVERY_CONTROLS), false, 'no forgot-password / reset control may exist');
  // Also proven by the a11y audit's no-self-service-reset rule.
  const view = resolveQueueState({ ok: true, rows: [] }, NOW, 30);
  assert.equal(auditA11y(view).some((f) => f.rule === 'no-self-service-reset'), false);
});

test('AC-0.REC.001.1 — a hypothetical reset control would be flagged (guard is real, not vacuous)', () => {
  assert.equal(hasSelfServiceReset({ forgotPassword: {} }), true);
  assert.equal(hasSelfServiceReset({ resetLink: {} }), true);
  assert.equal(hasSelfServiceReset({ passwordReset: {} }), true);
});

// ── AC-0.REC.002.1 — form → pending request created + admins notified ───────────────────────────────
test('AC-0.REC.002.1 — submitting the 3-field form creates a pending request and notifies admins', async () => {
  const h = harness();
  const { request, notified } = await h.service.submitTroubleSigningIn(
    { email: 'stuck@client.com', name: 'Stuck User', issue_description: 'Google SSO loops' },
    NOW,
  );
  assert.equal(request.status, 'pending');
  assert.equal(request.email, 'stuck@client.com');
  assert.equal(request.assigned_to, null);
  // event_log support_request_created emitted.
  assert.equal(h.events.ofType(EV_SUPPORT_REQUEST_CREATED).length, 1);
  // all admins (SA + Admin) notified.
  assert.equal(notified.length, 2);
  assert.ok(notified.every((o) => o.delivered));
  assert.deepEqual(new Set(h.notifications.sent.map((s) => s.user_id)), new Set(['sa-1', 'ad-1']));
});

test('AC-0.REC.002.1 — a blank required field is rejected (NOT NULL mirror), no silent empty row (#3)', async () => {
  const h = harness();
  for (const bad of [
    { email: '', name: 'A', issue_description: 'x' },
    { email: 'a@x.com', name: '   ', issue_description: 'x' },
    { email: 'a@x.com', name: 'A', issue_description: '' },
  ]) {
    await assert.rejects(
      () => h.service.submitTroubleSigningIn(bad, NOW),
      (e: unknown) => e instanceof SupportError && e.reason === ERR_EMPTY_FIELD,
    );
  }
  assert.equal(h.store._all().length, 0, 'no partial/empty request was filed');
});

test('AC-0.REC.002.1 — public intake needs NO permission (pre-auth) — unauth caller still files', async () => {
  const h = harness();
  // No grants on the authz fake at all; the intake path must not consult it.
  const { request } = await h.service.submitTroubleSigningIn({ email: 'a@x.com', name: 'A', issue_description: 'i' }, NOW);
  assert.equal(request.status, 'pending');
});

// ── AC-0.REC.003.1 — no PERM-support.view → queue access denied (RLS boundary) ──────────────────────
test('AC-0.REC.003.1 — a caller without PERM-support.view is denied the queue', async () => {
  const h = harness();
  await h.service.submitTroubleSigningIn({ email: 'a@x.com', name: 'A', issue_description: 'i' }, NOW);
  // no grant → denied.
  await assert.rejects(
    () => h.store.listRequests('nobody'),
    (e: unknown) => e instanceof SupportError && e.reason === ERR_DENIED,
  );
  await assert.rejects(
    () => h.store.getRequest('nobody', 'sr-1'),
    (e: unknown) => e instanceof SupportError && e.reason === ERR_DENIED,
  );
});

test('AC-0.REC.003.1 — a PERM-support.view holder CAN read; a public caller can insert but not read', async () => {
  const h = harness();
  h.authz.grant('viewer', PERM_SUPPORT_VIEW);
  await h.service.submitTroubleSigningIn({ email: 'a@x.com', name: 'A', issue_description: 'i' }, NOW);
  const rows = await h.store.listRequests('viewer');
  assert.equal(rows.length, 1);
  // the public inserter ('anyone') holds no node → cannot read back (public INSERT-only intake).
  await assert.rejects(() => h.store.listRequests('anyone'), (e: unknown) => e instanceof SupportError && e.reason === ERR_DENIED);
});

// ── AC-0.REC.005.1 — pending→in_progress→resolved with actor + timestamp per transition ─────────────
test('AC-0.REC.005.1 — full transition path records actor + timestamp on each step', async () => {
  const h = harness();
  h.authz.grant('admin-1', PERM_SUPPORT_VIEW, PERM_SUPPORT_RESOLVE);
  const { request } = await h.service.submitTroubleSigningIn({ email: 'a@x.com', name: 'A', issue_description: 'i' }, NOW);

  const t1 = '2026-07-06T12:05:00.000Z';
  const inprog = await h.service.transition('admin-1', request.id, 'in_progress', t1);
  assert.equal(inprog.status, 'in_progress');
  assert.equal(inprog.assigned_to, 'admin-1', 'assignee set on pick-up');
  assert.equal(inprog.updated_at, t1);

  const t2 = '2026-07-06T12:10:00.000Z';
  const resolved = await h.service.transition('admin-1', request.id, 'resolved', t2);
  assert.equal(resolved.status, 'resolved');

  const history = await h.store.transitionsFor('admin-1', request.id);
  assert.equal(history.length, 2);
  assert.deepEqual(history[0], { request_id: request.id, from_status: 'pending', to_status: 'in_progress', actor_id: 'admin-1', at: t1 });
  assert.deepEqual(history[1], { request_id: request.id, from_status: 'in_progress', to_status: 'resolved', actor_id: 'admin-1', at: t2 });
});

test('AC-0.REC.005.1 — resolved is immutable + illegal transitions are blocked', async () => {
  const h = harness();
  h.authz.grant('admin-1', PERM_SUPPORT_VIEW, PERM_SUPPORT_RESOLVE);
  const { request } = await h.service.submitTroubleSigningIn({ email: 'a@x.com', name: 'A', issue_description: 'i' }, NOW);

  // skip pending→resolved is illegal.
  await assert.rejects(
    () => h.service.transition('admin-1', request.id, 'resolved', NOW),
    (e: unknown) => e instanceof SupportError && e.reason === ERR_ILLEGAL_TRANSITION,
  );
  await h.service.transition('admin-1', request.id, 'in_progress', NOW);
  await h.service.transition('admin-1', request.id, 'resolved', NOW);
  // resolved → anything is refused (immutable history).
  for (const to of ['in_progress', 'pending'] as const) {
    await assert.rejects(
      () => h.service.transition('admin-1', request.id, to, NOW),
      (e: unknown) => e instanceof SupportError && e.reason === ERR_IMMUTABLE,
    );
  }
});

test('AC-0.REC.005.1 — a transition without PERM-support.resolve is denied (RLS UPDATE boundary)', async () => {
  const h = harness();
  h.authz.grant('viewer', PERM_SUPPORT_VIEW); // view but NOT resolve
  const { request } = await h.service.submitTroubleSigningIn({ email: 'a@x.com', name: 'A', issue_description: 'i' }, NOW);
  await assert.rejects(
    () => h.service.transition('viewer', request.id, 'in_progress', NOW),
    (e: unknown) => e instanceof SupportError && e.reason === ERR_DENIED,
  );
});

// ── AC-0.REC.006.1 — new request → all Super Admin + Admin notified ─────────────────────────────────
test('AC-0.REC.006.1 — every Super Admin + Admin is notified on submit; delivery logged', async () => {
  const h = harness({ admins: [['Super Admin', 'sa-1'], ['Super Admin', 'sa-2'], ['Admin', 'ad-1']] });
  await h.service.submitTroubleSigningIn({ email: 'a@x.com', name: 'A', issue_description: 'i' }, NOW);
  assert.deepEqual(new Set(h.notifications.sent.map((s) => s.user_id)), new Set(['sa-1', 'sa-2', 'ad-1']));
  assert.equal(h.events.ofType(EV_SUPPORT_NOTIFICATION_SENT).length, 1);
});

test('AC-0.REC.006.1 — a dropped notification is logged (never silently hides a stuck user, #3)', async () => {
  const h = harness();
  h.notifications.failFor.add('ad-1'); // the Admin's channel is down
  const { notified } = await h.service.submitTroubleSigningIn({ email: 'a@x.com', name: 'A', issue_description: 'i' }, NOW);
  // the request still filed; SA delivered, Admin failed-and-logged.
  assert.equal(h.store._all().length, 1);
  assert.equal(notified.find((o) => o.user_id === 'ad-1')?.delivered, false);
  assert.equal(h.events.ofType(EV_SUPPORT_NOTIFICATION_FAILED).length, 1);
  assert.equal(h.events.ofType(EV_SUPPORT_NOTIFICATION_SENT).length, 1); // sa-1 still delivered
});

// ── AC-0.REC.007.1 — pending past stale_request_minutes → re-alert ──────────────────────────────────
test('AC-0.REC.007.1 — the scheduled sweep re-alerts admins for a request pending past the threshold', async () => {
  const h = harness();
  // Filed at T0; sweep runs 40 min later with a 30-min threshold → overdue.
  const filed = '2026-07-06T12:00:00.000Z';
  await h.service.submitTroubleSigningIn({ email: 'a@x.com', name: 'A', issue_description: 'i' }, filed);
  h.notifications.sent = []; // ignore the on-submit notification; isolate the sweep
  h.events.events = [];

  const sweepAt = '2026-07-06T12:40:00.000Z';
  const result = await h.service.runStaleSweep(sweepAt, 30);
  assert.equal(result.reescalated.length, 1);
  assert.equal(h.events.ofType(EV_SUPPORT_REESCALATION).length, 1);
  // re-alerted every admin, flagged as an escalation.
  assert.deepEqual(new Set(h.notifications.sent.map((s) => s.user_id)), new Set(['sa-1', 'ad-1']));
  assert.ok(h.notifications.sent.every((s) => s.escalation));
});

test('AC-0.REC.007.1 — a fresh pending request is NOT re-escalated; resolved/in_progress never sweep', async () => {
  const h = harness();
  h.authz.grant('admin-1', PERM_SUPPORT_VIEW, PERM_SUPPORT_RESOLVE);
  // fresh pending (5 min old) — under threshold.
  await h.service.submitTroubleSigningIn({ email: 'fresh@x.com', name: 'F', issue_description: 'i' }, '2026-07-06T12:35:00.000Z');
  // an old but in_progress request — must not sweep (only `pending` re-escalates).
  const { request } = await h.service.submitTroubleSigningIn({ email: 'old@x.com', name: 'O', issue_description: 'i' }, '2026-07-06T11:00:00.000Z');
  await h.service.transition('admin-1', request.id, 'in_progress', '2026-07-06T11:05:00.000Z');
  h.notifications.sent = [];

  const result = await h.service.runStaleSweep('2026-07-06T12:40:00.000Z', 30);
  assert.equal(result.reescalated.length, 0, 'neither fresh-pending nor in_progress is stale');
  assert.equal(h.notifications.sent.length, 0);
});

test('AC-0.REC.007.1 — an un-picked-up request keeps re-alerting on each sweep (bounded, never vanishes #3)', async () => {
  const h = harness();
  await h.service.submitTroubleSigningIn({ email: 'a@x.com', name: 'A', issue_description: 'i' }, '2026-07-06T12:00:00.000Z');
  h.notifications.sent = [];
  const r1 = await h.service.runStaleSweep('2026-07-06T13:00:00.000Z', 30);
  const r2 = await h.service.runStaleSweep('2026-07-06T14:00:00.000Z', 30);
  assert.equal(r1.reescalated.length, 1);
  assert.equal(r2.reescalated.length, 1, 'still re-alerts on the next sweep — never silently dropped');
});

// ── AC-NFR-A11Y.001 — accessibility baseline for UI-SUPPORT-REQUESTS ────────────────────────────────
test('AC-NFR-A11Y.001 — the queue view + intake form pass the a11y baseline audit', async () => {
  const h = harness();
  h.authz.grant('viewer', PERM_SUPPORT_VIEW);
  await h.service.submitTroubleSigningIn({ email: 'a@x.com', name: 'A', issue_description: 'i' }, '2026-07-06T09:00:00.000Z');
  const rows = await h.store.listRequests('viewer');
  const view = resolveQueueState({ ok: true, rows }, NOW, 30);
  assert.deepEqual(auditA11y(view), [], 'no a11y findings');
  // status is never colour-only: each state carries text + a non-colour shape token.
  for (const p of Object.values(STATUS_PRESENTATION)) {
    assert.ok(p.label.length > 0 && p.shape.length > 0 && p.ariaLabel.length > 0);
  }
  // every form field + action control is labelled.
  assert.ok(TROUBLE_SIGNING_IN_FORM.every((f) => f.label && f.ariaLabel));
  assert.ok(actionsFor('pending').every((a) => a.label && a.ariaLabel));
});

// ── OD-106 ordering + honest states (#3) ────────────────────────────────────────────────────────────
test('OD-106 — overdue pending pinned to top, then newest-first', () => {
  const rows = [
    { id: 'new', email: 'n@x', name: 'N', issue_description: 'i', status: 'pending' as const, assigned_to: null, created_at: '2026-07-06T11:59:00.000Z', updated_at: '2026-07-06T11:59:00.000Z' },
    { id: 'overdue-old', email: 'o@x', name: 'O', issue_description: 'i', status: 'pending' as const, assigned_to: null, created_at: '2026-07-06T09:00:00.000Z', updated_at: '2026-07-06T09:00:00.000Z' },
    { id: 'overdue-newer', email: 'p@x', name: 'P', issue_description: 'i', status: 'pending' as const, assigned_to: null, created_at: '2026-07-06T10:00:00.000Z', updated_at: '2026-07-06T10:00:00.000Z' },
  ];
  const view = buildQueueView(rows, NOW, 30);
  assert.deepEqual(view.map((r) => r.id), ['overdue-newer', 'overdue-old', 'new']);
  assert.equal(view[0]!.overdue, true);
  assert.equal(view[0]!.overdueCue, 'Overdue');
  assert.equal(view[2]!.overdue, false);
});

test('#3 — a fetch ERROR does not render an empty list (never falsely reads "no one needs help")', () => {
  const errView = resolveQueueState({ ok: false, rows: [] }, NOW, 30);
  assert.equal(errView.state, 'error');
  assert.equal(errView.rows.length, 0);
  assert.match(errView.message ?? '', /Couldn't load/);
  assert.equal(errView.actionsEnabled, false);
  // an EMPTY (healthy zero-state) is distinct from an error.
  const emptyView = resolveQueueState({ ok: true, rows: [] }, NOW, 30);
  assert.equal(emptyView.state, 'empty');
  assert.match(emptyView.message ?? '', /No open support requests/);
});

test('#3 — offline disables actions so a resolve is not mistaken as landed', () => {
  const view = resolveQueueState({ ok: true, rows: [], offline: true }, NOW, 30);
  assert.equal(view.state, 'offline');
  assert.equal(view.actionsEnabled, false);
});

// ── invariants ──────────────────────────────────────────────────────────────────────────────────────
test('support_status enum matches OD-019 (no "contacted"): exactly pending/in_progress/resolved', () => {
  assert.deepEqual([...SUPPORT_STATUSES], ['pending', 'in_progress', 'resolved']);
  assert.equal(isLegalTransition('pending', 'in_progress'), true);
  assert.equal(isLegalTransition('in_progress', 'resolved'), true);
  assert.equal(isLegalTransition('pending', 'resolved'), false);
});
