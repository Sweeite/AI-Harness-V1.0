// ISSUE-038 (C3 DSC) — one test per §4 AC, against the pure kernels + the in-memory reference store. The live pg
// adapter is exercised in supabase-store.test.ts (SQL-shaping + live-specific fail-safe). Deterministic: every test
// passes an explicit `nowMs` (no Date.now/random).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyScope,
  surfaceFor,
  escalationDue,
  healthPanel,
  expiringSoon,
  alertRecipient,
  MS_PER_DAY,
  type DisconnectionRecord,
} from './classify.ts';
import {
  InMemoryDisconnectionStore,
  InMemorySinks,
  newBacking,
  sendExpiryAlert,
  alwaysProceed,
  DEFAULT_ESCALATION_WINDOW_MS,
  EVT_CONNECTOR_ESCALATED,
  EVT_CONNECTOR_ALERT,
  type ResumeAuthzCheck,
} from './store.ts';

const T0 = 1_780_000_000_000; // fixed epoch ms base
const mk = () => {
  const backing = newBacking();
  const sinks = new InMemorySinks();
  const store = new InMemoryDisconnectionStore(backing, { audit: sinks, events: sinks });
  return { backing, sinks, store };
};

// ── AC-3.DSC.001.1 — a failure is marked degraded + classified system-wide vs individual. ───────────────
test('AC-3.DSC.001.1 — detect marks degraded and classifies system-wide vs individual', async () => {
  const { backing, store } = mk();
  const sys = await store.detect({ connector: 'ghl', cause: 'dead_refresh' }, T0);
  assert.equal(sys.scope, 'system_wide');
  assert.equal(sys.status, 'open');
  assert.ok(backing.degraded.has('ghl'), 'connector marked degraded');

  const ind = await store.detect({ connector: 'google', cause: 'failed_call', affectedUserId: 'user-1' }, T0);
  assert.equal(ind.scope, 'individual');
  assert.equal(ind.affectedUserId, 'user-1');
  // an INDIVIDUAL lapse must NOT flip the shared per-connector credential (only system-wide degrades it).
  assert.ok(!backing.degraded.has('google'), 'individual lapse does not false-degrade the shared connector');

  // fail-safe: an ambiguous signal (no user scope) defaults to the WIDER system-wide, never a silent drop.
  assert.equal(classifyScope({ connector: 'slack', cause: 'failed_call' }), 'system_wide');
  // dead_refresh is always system-wide even with a user hint (the shared refresh credential died for everyone).
  assert.equal(classifyScope({ connector: 'slack', cause: 'dead_refresh', affectedUserId: 'u' }), 'system_wide');
});

test('detect is idempotent — re-detecting an open outage returns the same record, not a duplicate', async () => {
  const { backing, store } = mk();
  const a = await store.detect({ connector: 'ghl', cause: 'dead_refresh' }, T0);
  const b = await store.detect({ connector: 'ghl', cause: 'dead_refresh' }, T0 + 5000);
  assert.equal(a.id, b.id);
  assert.equal(backing.records.filter((r) => r.status === 'open' && r.connector === 'ghl').length, 1);
});

// ── AC-3.DSC.002.1 / .2 — surfacing behaviour + authority. ──────────────────────────────────────────────
test('AC-3.DSC.002.1 — system-wide + admin sees a non-dismissible modal with reconnect', () => {
  const d = surfaceFor('system_wide', 'Admin');
  assert.equal(d.kind, 'modal');
  assert.equal(d.dismissible, false);
  assert.equal(d.canReconnect, true);
  assert.equal(d.reconnectAuthority, 'admin');
  assert.equal(surfaceFor('system_wide', 'Super Admin').kind, 'modal');
});

test('AC-3.DSC.002.2 — system-wide + standard user sees a banner (not a modal); individual+affected sees a modal', () => {
  const std = surfaceFor('system_wide', 'Standard User');
  assert.equal(std.kind, 'banner');
  assert.notEqual(std.kind, 'modal');
  assert.equal(std.canReconnect, false);

  const affected = surfaceFor('individual', 'Standard User', { isAffectedUser: true });
  assert.equal(affected.kind, 'modal');
  assert.equal(affected.reconnectAuthority, 'affected_user');

  // an unrelated standard user on someone else's individual lapse: none (the ONE correct silent case).
  assert.equal(surfaceFor('individual', 'Standard User', { isAffectedUser: false }).kind, 'none');
  // fail-safe: unknown role on a system-wide outage still gets a banner (never a silent 'none').
  assert.equal(surfaceFor('system_wide', undefined).kind, 'banner');

  // identity-derived affected-ness (removes the footgun of a caller forgetting the flag): viewerUserId===affectedUserId.
  assert.equal(surfaceFor('individual', 'Standard User', { viewerUserId: 'u-9', affectedUserId: 'u-9' }).kind, 'modal');
  assert.equal(surfaceFor('individual', 'Standard User', { viewerUserId: 'u-9', affectedUserId: 'u-1' }).kind, 'none');
});

// ── AC-3.DSC.003.1 — reconnect auto-resumes paused tasks + pause/resume audit trail. ────────────────────
test('AC-3.DSC.003.1 — reconnect auto-resumes paused tasks with a pause+resume audit trail', async () => {
  const { store, sinks } = mk();
  const d = await store.detect({ connector: 'ghl', cause: 'dead_refresh' }, T0);
  await store.pauseTask(d.id, 'task-1', T0 + 1000);
  await store.pauseTask(d.id, 'task-2', T0 + 1000);

  const report = await store.resumeOnReconnect(d.id, alwaysProceed, T0 + 10_000);
  assert.deepEqual(report.resumed.sort(), ['task-1', 'task-2']);
  assert.equal(report.halted.length, 0);

  const pauses = sinks.audits.filter((a) => a.auditType === 'connector_pause').length;
  const resumes = sinks.audits.filter((a) => a.auditType === 'connector_resume').length;
  assert.equal(pauses, 2, 'both pauses audited');
  assert.equal(resumes, 2, 'both resumes audited');
  const rec = await store.get(d.id);
  assert.equal(rec?.status, 'resolved');
});

// ── AC-3.DSC.003.2 — resume re-checks authorization; a revoked grant halts-and-escalates, never acts. ────
test('AC-3.DSC.003.2 — a resumed task with revoked authz halts-and-escalates rather than acting', async () => {
  const { store, sinks } = mk();
  const d = await store.detect({ connector: 'ghl', cause: 'dead_refresh' }, T0);
  await store.pauseTask(d.id, 'task-ok', T0 + 1000);
  await store.pauseTask(d.id, 'task-revoked', T0 + 1000);

  // the re-check seam (wired to FR-1.RLS.007 live): task-revoked's originating authz was revoked mid-task.
  const recheck: ResumeAuthzCheck = async (taskId) =>
    taskId === 'task-revoked'
      ? { action: 'halt_and_quarantine', detail: 'originating user deactivated' }
      : { action: 'proceed', detail: 'ok' };

  const report = await store.resumeOnReconnect(d.id, recheck, T0 + 10_000);
  assert.deepEqual(report.resumed, ['task-ok']);
  assert.equal(report.halted.length, 1);
  assert.equal(report.halted[0]!.taskId, 'task-revoked');

  // the halted task was NOT resumed (never acted) and it HALTS-AND-ESCALATES (a loud Super-Admin escalation, not a
  // bare log) — AC-3.DSC.003.2 requires the "escalate" half, not just quarantine.
  const paused = await store.pausedTasks(d.id);
  const revoked = paused.find((p) => p.taskId === 'task-revoked')!;
  assert.equal(revoked.resumedAtMs, null);
  assert.equal(revoked.resumeHalted, true);
  const haltEscalations = sinks.events.filter((e) => e.eventType === EVT_CONNECTOR_ESCALATED && e.payload.kind === 'resume_halt');
  assert.equal(haltEscalations.length, 1, 'the halted task raised an escalation, not just a log');
  assert.equal(haltEscalations[0]!.payload.task_id, 'task-revoked');
});

// ── AC-3.DSC.003.3 — the paused-task set is persisted and recovered across a runtime restart. ───────────
test('AC-3.DSC.003.3 — paused-task set survives a runtime restart (no task silently abandoned)', async () => {
  const backing = newBacking();
  const sinks1 = new InMemorySinks();
  const store1 = new InMemoryDisconnectionStore(backing, { audit: sinks1, events: sinks1 });
  const d = await store1.detect({ connector: 'ghl', cause: 'dead_refresh' }, T0);
  await store1.pauseTask(d.id, 'task-1', T0 + 1000);
  await store1.pauseTask(d.id, 'task-2', T0 + 1000);

  // "restart": a fresh store instance over the SAME durable backing (the persisted rows).
  const sinks2 = new InMemorySinks();
  const store2 = new InMemoryDisconnectionStore(backing, { audit: sinks2, events: sinks2 });
  const recovered = await store2.pausedTasks(d.id);
  assert.equal(recovered.length, 2, 'both paused tasks recovered after restart');

  // and they still auto-resume after the restart — nothing was abandoned.
  const report = await store2.resumeOnReconnect(d.id, alwaysProceed, T0 + 20_000);
  assert.deepEqual(report.resumed.sort(), ['task-1', 'task-2']);
});

// ── AC-3.DSC.004.1 — an unresolved disconnection past the window escalates to Super Admin. ──────────────
test('AC-3.DSC.004.1 — unresolved past the window escalates to Super Admin (loud)', async () => {
  const { store, sinks } = mk();
  const d = await store.detect({ connector: 'ghl', cause: 'dead_refresh' }, T0);

  // before the window: no escalation.
  assert.equal((await store.escalationSweep(T0 + DEFAULT_ESCALATION_WINDOW_MS - 1)).length, 0);
  // at/after the window: escalated.
  const esc = await store.escalationSweep(T0 + DEFAULT_ESCALATION_WINDOW_MS);
  assert.equal(esc.length, 1);
  assert.equal(esc[0]!.disconnectionId, d.id);
  const rec = await store.get(d.id);
  assert.equal(rec?.status, 'escalated');
  assert.ok(rec?.escalatedAtMs != null);
  assert.equal(sinks.events.filter((e) => e.eventType === 'connector_escalated').length, 1);

  // NFR-OBS.007: never auto-cleared and never double-escalated — a second sweep is a no-op.
  assert.equal((await store.escalationSweep(T0 + 2 * DEFAULT_ESCALATION_WINDOW_MS)).length, 0);
  assert.equal((await store.get(d.id))?.status, 'escalated');
});

// ── AC-3.DSC.004.2 — the escalation clock is persisted (not reset) and honoured across a restart; deferral
//    does NOT stop it. ─────────────────────────────────────────────────────────────────────────────────
test('AC-3.DSC.004.2 — escalation clock persists across restart and a deferral does not stop it', async () => {
  const backing = newBacking();
  const s1 = new InMemoryDisconnectionStore(backing, { audit: new InMemorySinks(), events: new InMemorySinks() });
  const d = await s1.detect({ connector: 'ghl', cause: 'dead_refresh' }, T0);
  // admin defers the modal well before the window.
  await s1.defer(d.id, T0 + 1000);

  // "restart" — a fresh store over the same persisted rows. The clock still runs from the PERSISTED detected_at.
  const s2 = new InMemoryDisconnectionStore(backing, { audit: new InMemorySinks(), events: new InMemorySinks() });
  // just before the window (measured from detected_at, not from the restart): no escalation.
  assert.equal((await s2.escalationSweep(T0 + DEFAULT_ESCALATION_WINDOW_MS - 1)).length, 0);
  // at the window: escalates despite the deferral (the deferral never stopped the clock).
  const esc = await s2.escalationSweep(T0 + DEFAULT_ESCALATION_WINDOW_MS);
  assert.equal(esc.length, 1);
});

test('escalationDue kernel: deferral is ignored; only open + un-escalated + past-window escalates', () => {
  const base: DisconnectionRecord = {
    id: 'x', connector: 'ghl', scope: 'system_wide', affectedUserId: null, cause: 'dead_refresh',
    status: 'open', detectedAtMs: T0, escalationWindowMs: DEFAULT_ESCALATION_WINDOW_MS,
    deferredAtMs: T0 + 100, escalatedAtMs: null, resolvedAtMs: null,
  };
  assert.equal(escalationDue(base, T0 + DEFAULT_ESCALATION_WINDOW_MS), true);
  assert.equal(escalationDue({ ...base, status: 'resolved' }, T0 + DEFAULT_ESCALATION_WINDOW_MS * 2), false);
  assert.equal(escalationDue({ ...base, escalatedAtMs: T0 + 5 }, T0 + DEFAULT_ESCALATION_WINDOW_MS * 2), false);
});

// ── AC-3.DSC.005.1 — health panel shows status/last-call/expiry/rate-headroom, NO token material; missing
//    data warns (never a false-healthy blank). ─────────────────────────────────────────────────────────
test('AC-3.DSC.005.1 — health panel emits status/last-call/expiry/headroom with no token material', () => {
  const now = T0;
  const panels = healthPanel(
    [
      { connector: 'ghl', state: 'active', lastSuccessfulCallMs: now - 1000, expiresAtMs: now + 5 * MS_PER_DAY, rate: { callLimit: 100, callsMade: 40, resetAtMs: now + 3600_000 } },
      { connector: 'google', state: 'degraded', lastSuccessfulCallMs: null, expiresAtMs: null, rate: null },
      { connector: 'slack', state: null, lastSuccessfulCallMs: now - 2000, expiresAtMs: now - 10, rate: { callLimit: 10, callsMade: 10, resetAtMs: now } },
    ],
    now,
  );
  // no token material anywhere in the serialized output.
  const json = JSON.stringify(panels);
  assert.ok(!/access_token|refresh_token/.test(json));

  const ghl = panels.find((p) => p.connector === 'ghl')!;
  assert.equal(ghl.status, 'connected');
  assert.equal(ghl.rateHeadroom, 60);
  assert.equal(ghl.warnings.length, 0);

  // missing state → 'unknown' (NOT 'connected'); missing last-call/expiry/rate → warnings, not blanks.
  const google = panels.find((p) => p.connector === 'google')!;
  assert.equal(google.status, 'degraded');
  assert.ok(google.warnings.some((w) => /no successful call/.test(w)));
  assert.ok(google.warnings.some((w) => /token expiry unknown/.test(w)));
  assert.ok(google.warnings.some((w) => /rate-limit headroom unknown/.test(w)));

  const slack = panels.find((p) => p.connector === 'slack')!;
  assert.equal(slack.status, 'unknown', 'unknown state is never reported as connected (never-false-healthy)');
  assert.ok(slack.warnings.some((w) => /token has expired/.test(w)));
  assert.ok(slack.warnings.some((w) => /headroom exhausted/.test(w)));
});

test('AC-3.DSC.005.1 — a stale-but-present last-call is flagged (never a false-healthy fresh reading)', () => {
  const now = T0;
  const stale = 60 * 60 * 1000; // 1h threshold
  const [panel] = healthPanel(
    [{ connector: 'ghl', state: 'active', lastSuccessfulCallMs: now - 2 * stale, expiresAtMs: now + 5 * MS_PER_DAY, rate: { callLimit: 100, callsMade: 0, resetAtMs: now + 1000 } }],
    now,
    stale,
  );
  // active state, but the last call is 2h old with a 1h staleness threshold → warned, not silently "connected & fine".
  assert.equal(panel!.status, 'connected');
  assert.ok(panel!.warnings.some((w) => /stale/.test(w)), 'stale-but-present last call is flagged');
});

// ── AC-3.DSC.006.1 — refresh token expiring within the window emails the owner. ─────────────────────────
test('AC-3.DSC.006.1 — a refresh token expiring within alertDays alerts the resolved owner', async () => {
  const now = T0;
  const alerts = expiringSoon(
    [
      { connector: 'ghl', scope: 'system_wide', affectedUserId: null, expiresAtMs: now + 3 * MS_PER_DAY },
      { connector: 'google', scope: 'individual', affectedUserId: 'user-9', expiresAtMs: now + 2 * MS_PER_DAY },
      { connector: 'slack', scope: 'system_wide', affectedUserId: null, expiresAtMs: now + 30 * MS_PER_DAY }, // outside 7d
    ],
    7,
    'admin-owner',
    now,
  );
  assert.equal(alerts.length, 2);
  assert.equal(alerts.find((a) => a.connector === 'ghl')!.recipientId, 'admin-owner');
  assert.equal(alerts.find((a) => a.connector === 'google')!.recipientId, 'user-9');

  // recipient resolution: individual → affected user; system-wide → admin owner; neither → null (surfaced, not guessed).
  assert.equal(alertRecipient('individual', 'u', 'a'), 'u');
  assert.equal(alertRecipient('system_wide', null, 'a'), 'a');
  assert.equal(alertRecipient('system_wide', null, null), null);

  // delivery success emits a connector_alert with outcome=sent.
  const sinks = new InMemorySinks();
  const ok = await sendExpiryAlert(sinks, alerts[0]!, async () => ({ delivered: true }), now);
  assert.equal(ok, true);
  assert.equal(sinks.events.filter((e) => e.eventType === EVT_CONNECTOR_ALERT && e.payload.outcome === 'sent').length, 1);
});

// ── AC-3.DSC.006.2 — an alert that cannot be delivered is surfaced (not silent). ────────────────────────
test('AC-3.DSC.006.2 — an undeliverable alert (or unresolved recipient) is surfaced, never dropped silently', async () => {
  const now = T0;
  const sinks = new InMemorySinks();

  // delivery failure → alert_delivery_failed (surfaced).
  const alert = expiringSoon([{ connector: 'ghl', scope: 'system_wide', affectedUserId: null, expiresAtMs: now + MS_PER_DAY }], 7, 'admin-owner', now)[0]!;
  const sent = await sendExpiryAlert(sinks, alert, async () => ({ delivered: false, reason: 'smtp timeout' }), now);
  assert.equal(sent, false);
  const fail = sinks.events.filter((e) => e.eventType === EVT_CONNECTOR_ALERT && e.payload.outcome === 'delivery_failed');
  assert.equal(fail.length, 1);
  assert.ok(/smtp timeout/.test(fail[0]!.summary));

  // unresolved recipient (system-wide with no admin owner) → also surfaced, never a silent no-op.
  const orphan = expiringSoon([{ connector: 'x', scope: 'system_wide', affectedUserId: null, expiresAtMs: now + MS_PER_DAY }], 7, null, now)[0]!;
  assert.equal(orphan.unresolvedRecipient, true);
  const sent2 = await sendExpiryAlert(sinks, orphan, async () => ({ delivered: true }), now);
  assert.equal(sent2, false);
  assert.equal(sinks.events.filter((e) => e.eventType === EVT_CONNECTOR_ALERT && e.payload.outcome === 'unresolved_recipient').length, 1);
});

// ── AC-NFR-OBS.007.1 — the disconnection wait-point escalates + persists, never auto-cleared/parked. ─────
test('AC-NFR-OBS.007.1 — the disconnection wait-point escalates + persists (never auto-cleared or parked)', async () => {
  const { store } = mk();
  const d = await store.detect({ connector: 'ghl', cause: 'dead_refresh' }, T0);
  await store.defer(d.id, T0 + 1000); // even deferred, it must not be forgotten.

  const esc = await store.escalationSweep(T0 + DEFAULT_ESCALATION_WINDOW_MS + 1);
  assert.equal(esc.length, 1);
  // it PERSISTS as escalated (not cleared away), and is never auto-approved/auto-resolved.
  const rec = await store.get(d.id);
  assert.equal(rec?.status, 'escalated');
  assert.notEqual(rec?.status, 'resolved');
  assert.ok(rec?.escalatedAtMs != null);
});
