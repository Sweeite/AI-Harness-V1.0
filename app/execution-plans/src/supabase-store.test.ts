// ISSUE-064 (C8 PLAN) — the LIVE adapter's SQL-shaping + fail-safe, against a fake QueryExec (no DB). Proves plan_body
// stores CANONICAL modes, the version bump uses coalesce(max)+1, attribution round-trips through event_log, and
// rollback is authority-gated + audited BEFORE any insert. The real DB round-trip is the R10 live smoke.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseExecutionPlanAdmin, EVT_PLAN_OUTCOME, EVT_PLAN_ROLLBACK, type QueryExec } from './supabase-store.ts';
import { assignFailureModes } from './plan.ts';
import { ERR_ROLLBACK_UNAUTHORIZED } from './store.ts';

const T0 = 1_780_000_000_000;
const secs = (ms: number) => String(ms / 1000);

function recordingExec(handler: (text: string, params?: unknown[]) => { rows: Record<string, unknown>[]; rowCount?: number }): { exec: QueryExec; calls: { text: string; params?: unknown[] }[] } {
  const calls: { text: string; params?: unknown[] }[] = [];
  const exec: QueryExec = async (text, params) => {
    calls.push({ text, params });
    const r = handler(text, params);
    return { rows: r.rows as never[], rowCount: r.rowCount ?? r.rows.length };
  };
  return { exec, calls };
}

const rawVersion = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'plan-1', task_type_name: 't', version: 1, plan_body: assignFailureModes('t', [{ index: 0, agent_id: 'a', failure_mode: 'retry' }]),
  previous_version_id: null, created_by: 'sa', created_secs: secs(T0), ...over,
});

test('saveVersion persists plan_body as jsonb with the version derived by coalesce(max)+1', async () => {
  const { exec, calls } = recordingExec((text) => {
    if (/insert into execution_plans/.test(text)) return { rows: [rawVersion({ version: 3 })] };
    return { rows: [] };
  });
  const admin = new SupabaseExecutionPlanAdmin('postgres://x', { queryExec: exec });
  const plan = assignFailureModes('t', [{ index: 0, agent_id: 'a', failure_mode: 'halt_escalate' }]);
  const v = await admin.saveVersion('t', plan, null, 'sa', T0);
  assert.equal(v.version, 3);
  // the insert derives the version in-SQL (race backstopped by unique(task_type_name,version)).
  assert.ok(calls.some((c) => /coalesce\(max\(version\),0\)\+1/.test(c.text)));
  // the plan_body param stores the CANONICAL mode (the orchestrator shorthand was canonicalized before persistence).
  const insertCall = calls.find((c) => /insert into execution_plans/.test(c.text))!;
  assert.match(String(insertCall.params![1]), /halt_and_escalate/);
  assert.doesNotMatch(String(insertCall.params![1]), /halt_escalate"/); // not the raw shorthand
});

test('attributeOutcome writes a plan_outcome event keyed by plan_version_id; outcomesByVersion tallies it', async () => {
  const VID = '11111111-1111-1111-1111-111111111111';
  const events: { status: string; vid: string }[] = [];
  const exec: QueryExec = async (text, params) => {
    if (/from execution_plans where id =/.test(text)) return { rows: [rawVersion({ id: VID })] as never[] };
    if (/insert into event_log/.test(text)) {
      const payload = JSON.parse(String(params![2]));
      events.push({ status: payload.status, vid: payload.plan_version_id });
      return { rows: [] as never[], rowCount: 1 };
    }
    if (/select id::text as id from execution_plans/.test(text)) return { rows: [{ id: VID }] as never[] };
    if (/payload->>'plan_version_id'/.test(text)) return { rows: events.map((e) => ({ plan_version_id: e.vid, status: e.status })) as never[] };
    return { rows: [] as never[] };
  };
  const admin = new SupabaseExecutionPlanAdmin('postgres://x', { queryExec: exec });
  await admin.attributeOutcome(VID, 'success', T0);
  await admin.attributeOutcome(VID, 'failure', T0 + 10);
  assert.equal(events[0]!.status, 'success');
  const tally = await admin.outcomesByVersion('t');
  assert.deepEqual(tally.get(VID), { success: 1, failure: 1, partial: 0 });
});

test('saveVersion CANONICALIZES plan_body at the write boundary — orchestrator shorthand never reaches the column', async () => {
  let stored = '';
  const exec: QueryExec = async (text, params) => {
    if (/insert into execution_plans/.test(text)) { stored = String(params![1]); return { rows: [rawVersion()] as never[] }; }
    return { rows: [] as never[] };
  };
  const admin = new SupabaseExecutionPlanAdmin('postgres://x', { queryExec: exec });
  // hand it a plan whose step carries the raw orchestrator shorthand 'halt_escalate'.
  const dirty = { task_type_name: 't', parallel: false, steps: [{ index: 0, agent_id: 'a', agent_name: null, depends_on: [], parallel_eligible: false, failure_mode: 'halt_escalate' as never, defaulted: false }] };
  await admin.saveVersion('t', dirty, null, 'sa', T0);
  assert.match(stored, /halt_and_escalate/, 'shorthand canonicalized to the DB value before persistence');
  assert.doesNotMatch(stored, /"halt_escalate"/);
});

test('BLOCKER-fix: rollback is ATOMIC — the version-append + audit are wrapped in a transaction, rolled back on audit failure', async () => {
  const order: string[] = [];
  const exec: QueryExec = async (text) => {
    if (/^begin/i.test(text)) { order.push('begin'); return { rows: [] as never[] }; }
    if (/^commit/i.test(text)) { order.push('commit'); return { rows: [] as never[] }; }
    if (/^rollback/i.test(text)) { order.push('rollback'); return { rows: [] as never[] }; }
    if (/from execution_plans where id = \$1::uuid and task_type_name/.test(text)) return { rows: [rawVersion({ id: '11111111-1111-1111-1111-111111111111' })] as never[] };
    if (/order by version desc limit 1/.test(text)) return { rows: [rawVersion({ id: '22222222-2222-2222-2222-222222222222', version: 2 })] as never[] };
    if (/insert into execution_plans/.test(text)) { order.push('insert-version'); return { rows: [rawVersion({ id: '33333333-3333-3333-3333-333333333333', version: 3 })] as never[] }; }
    if (/insert into event_log/.test(text)) { order.push('insert-audit'); throw new Error('audit write failed'); }
    return { rows: [] as never[] };
  };
  const admin = new SupabaseExecutionPlanAdmin('postgres://x', { authority: () => true, queryExec: exec });
  await assert.rejects(admin.rollback('t', '11111111-1111-1111-1111-111111111111', 'sa', 'revert', T0), /audit write failed/);
  // the transaction wrapped both writes and ROLLED BACK when the audit failed (no committed un-audited version).
  assert.deepEqual(order, ['begin', 'insert-version', 'insert-audit', 'rollback']);
  assert.ok(!order.includes('commit'), 'never committed a version without its audit');
});

test('getVersion returns null (not a raw 22P02) for a non-uuid id — matches the in-memory model', async () => {
  const exec: QueryExec = async () => ({ rows: [] as never[] });
  const admin = new SupabaseExecutionPlanAdmin('postgres://x', { queryExec: exec });
  assert.equal(await admin.getVersion('not-a-uuid'), null);
});

test('rollback denies an unauthorized actor BEFORE any insert (fail-closed #2)', async () => {
  let inserts = 0;
  const exec: QueryExec = async (text) => {
    if (/insert/.test(text)) inserts += 1;
    return { rows: [] as never[], rowCount: 0 };
  };
  const admin = new SupabaseExecutionPlanAdmin('postgres://x', { authority: () => false, queryExec: exec });
  await assert.rejects(admin.rollback('t', 'plan-1', 'nobody', 'x', T0), new RegExp(ERR_ROLLBACK_UNAUTHORIZED('nobody').slice(0, 25)));
  assert.equal(inserts, 0, 'no insert ran for a denied rollback');
});

test('rollback (authorized) appends a reinstating version + writes a plan_rollback audit event', async () => {
  const V1 = '11111111-1111-1111-1111-111111111111';
  const inserted: string[] = [];
  const eventTypes: string[] = [];
  const exec: QueryExec = async (text, params) => {
    if (/from execution_plans where id = \$1::uuid and task_type_name/.test(text)) return { rows: [rawVersion({ id: V1, version: 1 })] as never[] };
    if (/order by version desc limit 1/.test(text)) return { rows: [rawVersion({ id: '22222222-2222-2222-2222-222222222222', version: 2 })] as never[] };
    if (/insert into execution_plans/.test(text)) { inserted.push('version'); return { rows: [rawVersion({ id: '33333333-3333-3333-3333-333333333333', version: 3 })] as never[] }; }
    if (/insert into event_log/.test(text)) { eventTypes.push(String(params![0])); return { rows: [] as never[], rowCount: 1 }; }
    return { rows: [] as never[] };
  };
  const admin = new SupabaseExecutionPlanAdmin('postgres://x', { authority: () => true, queryExec: exec });
  const v = await admin.rollback('t', V1, 'sa', 'v2 regressed', T0);
  assert.equal(v.version, 3, 'a new appended version, not a delete');
  assert.ok(inserted.includes('version'));
  assert.ok(eventTypes.includes(EVT_PLAN_ROLLBACK), 'rollback audited to event_log');
  assert.ok(!eventTypes.includes(EVT_PLAN_OUTCOME));
});
