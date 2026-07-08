// ISSUE-038 (C3 DSC) — the LIVE adapter's SQL-shaping + live-specific fail-safe, exercised against a fake QueryExec
// (no DB). This reproduces the class R10 exists to catch WITHOUT the silo: the idempotent-detect race (0035 unique
// violation → re-select, never a duplicate open row), the escalation clock read from the PERSISTED detected_at/window
// (not the wall clock), and the no-token-material read discipline. The real DB round-trip is the R10 live smoke.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseDisconnectionStore, SupabaseDisconnectionSinks, type QueryExec } from './supabase-store.ts';
import { InMemorySinks, DEFAULT_ESCALATION_WINDOW_MS, EVT_CONNECTOR_ESCALATED } from './store.ts';

const T0 = 1_780_000_000_000;
const secs = (ms: number) => String(ms / 1000);

/** A tiny scriptable fake pg: matches on a substring of the SQL and returns canned rows; records every call. */
interface Stub {
  match: RegExp;
  rows?: Record<string, unknown>[];
  rowCount?: number;
  throw?: { code: string };
}
function fakeExec(stubs: Stub[]): { exec: QueryExec; calls: { text: string; params?: unknown[] }[] } {
  const calls: { text: string; params?: unknown[] }[] = [];
  const exec: QueryExec = async (text, params) => {
    calls.push({ text, params });
    const s = stubs.find((s) => s.match.test(text));
    if (!s) return { rows: [], rowCount: 0 };
    if (s.throw) {
      const e = new Error('stub throw') as Error & { code: string };
      e.code = s.throw.code;
      throw e;
    }
    return { rows: (s.rows ?? []) as never[], rowCount: s.rowCount ?? (s.rows?.length ?? 0) };
  };
  return { exec, calls };
}

const openRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'dsc-1', connector: 'ghl', scope: 'system_wide', affected_user_id: null, cause: 'dead_refresh', status: 'open',
  detected_secs: secs(T0), window_secs: String(DEFAULT_ESCALATION_WINDOW_MS / 1000), deferred_secs: null, escalated_secs: null, resolved_secs: null,
  ...over,
});

test('detect marks the connector degraded WITHOUT ever reading/writing token columns', async () => {
  const { exec, calls } = fakeExec([
    { match: /update connector_credentials set state = 'degraded'/, rowCount: 1 },
    { match: /select[\s\S]*from connector_disconnection_state\s+where status = 'open'/, rows: [] },
    { match: /insert into connector_disconnection_state/, rows: [openRow()] },
  ]);
  const store = new SupabaseDisconnectionStore('postgres://x', { audit: new InMemorySinks(), events: new InMemorySinks() }, { queryExec: exec });
  const rec = await store.detect({ connector: 'ghl', cause: 'dead_refresh' }, T0);
  assert.equal(rec.scope, 'system_wide');
  assert.equal(rec.detectedAtMs, T0, 'detected_at reconstructed from the persisted epoch');
  // no SQL touches access_token / refresh_token (the #2 no-leak discipline).
  assert.ok(!calls.some((c) => /access_token|refresh_token/.test(c.text)));
});

test('detect is idempotent under a race — a 0035 unique_violation re-selects the open row (no duplicate)', async () => {
  let selectCount = 0;
  const exec: QueryExec = async (text) => {
    if (/update connector_credentials/.test(text)) return { rows: [], rowCount: 1 };
    if (/select[\s\S]*from connector_disconnection_state\s+where status = 'open'/.test(text)) {
      selectCount += 1;
      // first select finds nothing (we think we must insert); after the racing insert, the re-select finds the row.
      return { rows: selectCount === 1 ? [] : [openRow()] } as never;
    }
    if (/insert into connector_disconnection_state/.test(text)) {
      const e = new Error('dup') as Error & { code: string };
      e.code = '23505'; // unique_violation on the 0035 partial index
      throw e;
    }
    return { rows: [], rowCount: 0 };
  };
  const store = new SupabaseDisconnectionStore('postgres://x', { audit: new InMemorySinks(), events: new InMemorySinks() }, { queryExec: exec });
  const rec = await store.detect({ connector: 'ghl', cause: 'dead_refresh' }, T0);
  assert.equal(rec.id, 'dsc-1', 'the racing-inserted open row is returned, not a duplicate');
  assert.equal(selectCount, 2, 're-selected after the unique_violation');
});

test('escalationSweep decides from the PERSISTED detected_at/window (not the wall clock) via the shared kernel', async () => {
  const events = new InMemorySinks();
  // one open row detected at T0 with the default window.
  const { exec, calls } = fakeExec([
    { match: /select[\s\S]*from connector_disconnection_state where status = 'open'/, rows: [openRow()] },
    { match: /update connector_disconnection_state set status = 'escalated'/, rowCount: 1 },
  ]);
  const store = new SupabaseDisconnectionStore('postgres://x', { audit: new InMemorySinks(), events }, { queryExec: exec });

  // before the window: nothing escalates (the clock is read from detected_secs, not "now").
  const before = new SupabaseDisconnectionStore('postgres://x', { audit: new InMemorySinks(), events: new InMemorySinks() }, {
    queryExec: fakeExec([{ match: /select[\s\S]*from connector_disconnection_state where status = 'open'/, rows: [openRow()] }]).exec,
  });
  assert.equal((await before.escalationSweep(T0 + DEFAULT_ESCALATION_WINDOW_MS - 1)).length, 0);

  // at/after the window: escalates, guarded by `and status='open' and escalated_at is null` (no double-escalate).
  const esc = await store.escalationSweep(T0 + DEFAULT_ESCALATION_WINDOW_MS);
  assert.equal(esc.length, 1);
  assert.ok(calls.some((c) => /escalated_at is null/.test(c.text)), 'escalate update is race-guarded');
  assert.equal(events.events.filter((e) => e.eventType === 'connector_escalated').length, 1);
});

test('pauseTask only audits an ACTUAL pause (on conflict do nothing → rowCount 0 → no phantom audit)', async () => {
  const audit = new InMemorySinks();
  const { exec } = fakeExec([{ match: /insert into connector_disconnection_paused_tasks/, rowCount: 0 }]);
  const store = new SupabaseDisconnectionStore('postgres://x', { audit, events: new InMemorySinks() }, { queryExec: exec });
  await store.pauseTask('dsc-1', 'task-1', T0);
  assert.equal(audit.audits.length, 0, 'an idempotent no-op pause writes no audit');
});

test('resumeOnReconnect halts a task whose re-check says halt_and_quarantine (never resumes it)', async () => {
  const events = new InMemorySinks();
  const updates: string[] = [];
  const exec: QueryExec = async (text, params) => {
    if (/select[\s\S]*from connector_disconnection_state where id =/.test(text)) return { rows: [openRow()] } as never;
    if (/from connector_disconnection_paused_tasks where disconnection_id =/.test(text)) {
      return { rows: [{ task_id: 'task-revoked', paused_secs: secs(T0), resumed_secs: null, resume_halted: false }] } as never;
    }
    if (/update connector_disconnection_paused_tasks set resume_halted = true/.test(text)) { updates.push('halted'); return { rows: [], rowCount: 1 }; }
    if (/update connector_disconnection_paused_tasks set resumed_at/.test(text)) { updates.push('resumed'); return { rows: [], rowCount: 1 }; }
    return { rows: [], rowCount: 1 };
  };
  const store = new SupabaseDisconnectionStore('postgres://x', { audit: new InMemorySinks(), events }, { queryExec: exec });
  const report = await store.resumeOnReconnect('dsc-1', async () => ({ action: 'halt_and_quarantine', detail: 'revoked' }), T0 + 5000);
  assert.deepEqual(report.resumed, []);
  assert.equal(report.halted.length, 1);
  assert.ok(updates.includes('halted') && !updates.includes('resumed'), 'the revoked task was halted, never resumed');
  // halts-and-escalates: a loud escalation event, not a bare log (AC-3.DSC.003.2).
  assert.equal(events.events.filter((e) => e.eventType === EVT_CONNECTOR_ESCALATED && e.payload.kind === 'resume_halt').length, 1);
});

test('detect(individual) does NOT update connector_credentials (no false-degrade of the shared connector)', async () => {
  const { exec, calls } = fakeExec([
    { match: /select[\s\S]*from connector_disconnection_state\s+where status = 'open'/, rows: [] },
    { match: /insert into connector_disconnection_state/, rows: [openRow({ scope: 'individual', affected_user_id: 'user-1' })] },
  ]);
  const store = new SupabaseDisconnectionStore('postgres://x', { audit: new InMemorySinks(), events: new InMemorySinks() }, { queryExec: exec });
  await store.detect({ connector: 'google', cause: 'failed_call', affectedUserId: 'user-1' }, T0);
  assert.ok(!calls.some((c) => /update connector_credentials set state = 'degraded'/.test(c.text)), 'individual lapse never degrades the shared credential');
});

test('SupabaseDisconnectionSinks writes event_log (::event_type cast) + access_audit (system actor); no token columns', async () => {
  const { exec, calls } = fakeExec([]);
  const sinks = new SupabaseDisconnectionSinks('postgres://x', { queryExec: exec });
  await sinks.appendEvent({ eventType: 'connector_disconnected', summary: 's', payload: { a: 1 } }, T0);
  await sinks.appendAudit({ auditType: 'connector_pause', actorIdentity: 'system', action: 'pause_task', reason: 'r', taskId: 't1' }, T0);
  const ev = calls.find((c) => /insert into event_log/.test(c.text))!;
  assert.match(ev.text, /\$1::event_type/, 'event_type is cast so an unknown value fails LOUD, never silently coerced');
  const au = calls.find((c) => /insert into access_audit/.test(c.text))!;
  assert.match(au.text, /'system'::actor_type/);
  assert.ok(!calls.some((c) => /access_token|refresh_token/.test(c.text)));
});

test('healthPanelLive reads only metadata (no token columns) and picks the tightest rate window per connector', async () => {
  const exec: QueryExec = async (text) => {
    if (/from connector_credentials/.test(text)) return { rows: [{ connector: 'ghl', state: 'active', expires_secs: secs(T0 + 5 * 86400_000) }] as never[] };
    if (/from rate_limit_tracker/.test(text)) {
      return { rows: [
        { connector: 'ghl', call_limit: 100, calls_made: 10, reset_secs: secs(T0 + 3600) }, // headroom 90
        { connector: 'ghl', call_limit: 20, calls_made: 18, reset_secs: secs(T0 + 60) }, // headroom 2 — the binding one
      ] as never[] };
    }
    return { rows: [] as never[] };
  };
  const store = new SupabaseDisconnectionStore('postgres://x', { audit: new InMemorySinks(), events: new InMemorySinks() }, { queryExec: exec });
  const panels = await store.healthPanelLive(T0);
  assert.equal(panels[0]!.connector, 'ghl');
  assert.equal(panels[0]!.rateHeadroom, 2, 'the tightest (smallest-headroom) window is shown');
  assert.equal(panels[0]!.status, 'connected');
  // no token material anywhere.
  assert.ok(!JSON.stringify(panels).match(/access_token|refresh_token/));
});
