// ISSUE-056 — one test per AC in §4 Definition of done, proved against the pure tier classifier/router
// (tiers.ts) + the InMemoryApprovalWorkflow reference model (store.ts). Offline: NO live DB. The live
// guardrail_log CHECK/trigger + task_queue seam are authored in supabase-store.ts and proven at a live
// capstone; the AF-068 red-team (no autonomous bypass of the hard-approval floor) is ISSUE-003's LIVE proof
// and is owed-to-live (listed in the results). Every test drives the DENY / non-silent path, not just happy.
//
// IMPORTANT: this test imports from ./store.ts + ./tiers.ts directly (NOT ./index.ts) — index.ts pulls in
// supabase-store.ts → `pg`, which is not installed offline. The reference model + pure functions carry every
// invariant a live silo enforces, so the offline proof is faithful (fake-vs-live discipline).
//
// AC map (22 issue ACs + the 4 NFR postures = 26 assertions):
//   AC-6.APR.001.1 — exactly one tier assigned + recorded; uncertain ⇒ hard (fail-safe)
//   AC-6.APR.001.2 — auto executes with no human step; soft/hard → C5 awaiting_approval
//   AC-6.APR.002.1 — a floored action is hard regardless of any config that would lower it (the #2 test)
//   AC-6.APR.002.2 — a Restricted memory op is hard + routes to grantee/Super-Admin (+ audited seam)
//   AC-6.APR.003.1 — a soft item auto-runs on timeout ONLY IF reversible; irreversible is never soft
//   AC-6.APR.003.2 — a human reject before the delay: does not execute, logged
//   AC-6.APR.003.3 — Hold-for-full-review cancels the timer + promotes soft→explicit (one-directional)
//   AC-6.APR.004.1 — a low-risk action executes immediately; the tier decision is retained (OPT.001)
//   AC-6.APR.005.1 — routes to the configured reviewer role; no rule ⇒ default reviewer (never unrouted)
//   AC-6.APR.005.2 — unavailable reviewer ⇒ fallback + escalate, never silent stall
//   AC-6.APR.005.3 — the initiator can never be its own approver (routing + resolve both refuse)
//   AC-6.APR.006.1 — C6 sets tier; C5 holds in awaiting_approval; no step runs until a human approves
//   AC-6.ESC.001.1 — a guardrail hit sets flagged + paused; no further step runs
//   AC-6.ESC.001.2 — a hard_limit hit is killed + logged; never in the queue, never an Approve affordance
//   AC-6.ESC.001.3 — multi-fire: most-restrictive governs (hard_limit dominates); each hit logs its own row
//   AC-6.ESC.002.1 — the reviewer is notified + the item is queued; a dropped notification is surfaced
//   AC-6.ESC.003.1 — approve resumes / reject cancels+reason / modify requeues
//   AC-6.ESC.003.2 — reversible applied effect: shown + durable compensation task, never auto-rollback
//   AC-6.ESC.003.3 — irreversible applied effect: surfaced non-compensable
//   AC-6.ESC.004.1 — an un-actioned wait past timeout escalates; never auto-resolved / dropped
//   AC-6.ESC.004.2 — repeated timeouts WIDEN the escalation (to Super-Admin)
//   AC-6.ESC.004.3 — the escalate rule covers BOTH flagged AND awaiting_approval wait-points
//   AC-NFR-SEC.013.1 — every path (surface/mobile//-command) runs the identical tier pipeline (no bypass)
//   AC-NFR-SEC.013.2 — an unauthorized caller is denied before any resolve side effect
//   AC-NFR-OBS.007.1 — the wait-point escalates + persists; never auto-cleared
//   AC-NFR-OBS.007.2 — the escalation honours the configured escalation-window threshold

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyTier,
  mostRestrictiveTier,
  routeApproval,
  type AutonomyMatrix,
  type GatedAction,
  type Reviewer,
  type RoutingRules,
} from './tiers.ts';
import {
  DEFAULT_APPROVAL_CONFIG,
  ERR_HARD_LIMIT_NO_AFFORDANCE,
  ERR_HOLD_ONLY_SOFT,
  ERR_SELF_APPROVAL,
  InMemoryApprovalWorkflow,
  InMemoryTaskSeam,
  type ApprovalConfig,
  type ApprovalNotification,
  type CompensationSink,
  type CompensationTask,
  type FaultConfig,
  type GuardrailHit,
  type NotificationSink,
  type TaskRow,
} from './store.ts';

const T0 = 1_700_000_000; // fixed "now" (epoch seconds)

// An empty action_autonomy_matrix (no per-action hint) — the common case in most tests.
const EMPTY: AutonomyMatrix = { tierFor: () => undefined };

// ── test harness helpers ───────────────────────────────────────────────────────────────────────────────
function recordingNotify(): { sink: NotificationSink; emitted: ApprovalNotification[] } {
  const emitted: ApprovalNotification[] = [];
  return { sink: { emit: async (n) => { emitted.push(n); } }, emitted };
}
function recordingComp(): { sink: CompensationSink; queued: CompensationTask[] } {
  const queued: CompensationTask[] = [];
  return { sink: { queue: async (t) => { queued.push(t); } }, queued };
}

function newWorkflow(opts?: { config?: ApprovalConfig; faults?: FaultConfig }) {
  const tasks = new InMemoryTaskSeam();
  const n = recordingNotify();
  const c = recordingComp();
  const wf = new InMemoryApprovalWorkflow(tasks, n.sink, c.sink, opts?.config ?? DEFAULT_APPROVAL_CONFIG, opts?.faults ?? {});
  return { wf, tasks, notify: n, comp: c };
}

function seedTask(tasks: InMemoryTaskSeam, id: string, over: Partial<TaskRow> = {}): void {
  tasks.seed({
    id,
    task_name: id,
    status: 'pending',
    requires_approval: false,
    approved_by: null,
    approved_at: null,
    originating_user_id: null,
    action_payload: null,
    ...over,
  });
}

const RULES: RoutingRules = {
  roleForContext: (ctx) => (ctx === 'crm' ? 'account_manager' : ctx === 'financial_flag' ? 'operations_lead' : undefined),
  defaultRole: 'reviewer',
  escalationRole: 'super_admin',
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// APR — tier policy
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════

test('AC-6.APR.001.1 — exactly one tier is assigned + recorded; an uncertain action defaults to hard', async () => {
  // low → auto, medium+reversible → soft, high → hard, unknown-risk → hard (fail-safe).
  assert.equal(classifyTier({ actionType: 'a', riskLevel: 'low', reversible: true }).tier, 'auto');
  assert.equal(classifyTier({ actionType: 'b', riskLevel: 'medium', reversible: true }).tier, 'soft');
  assert.equal(classifyTier({ actionType: 'c', riskLevel: 'high' }).tier, 'hard');
  const uncertain = classifyTier({ actionType: 'd' }); // no risk_level ⇒ uncertain
  assert.equal(uncertain.tier, 'hard');
  assert.equal(uncertain.defaultedHard, true);

  // "recorded": tierAndGate keeps a classification record for EVERY action (incl. auto).
  const { wf } = newWorkflow();
  const disp = await wf.tierAndGate({ actionType: 'e', riskLevel: 'low', reversible: true }, EMPTY, T0);
  assert.equal(disp.decision.tier, 'auto');
  assert.equal(wf.classifications.length, 1);
  assert.equal(wf.classifications[0]!.tier, 'auto');
});

test('AC-6.APR.001.2 — auto executes with no human step; soft/hard move the C5 task to awaiting_approval', async () => {
  const { wf, tasks } = newWorkflow();
  seedTask(tasks, 'auto_task');
  seedTask(tasks, 'soft_task');

  const autoDisp = await wf.tierAndGate({ actionType: 'auto_task', riskLevel: 'low', reversible: true }, EMPTY, T0);
  assert.equal(autoDisp.autoExecuted, true);
  assert.equal(autoDisp.guardrailLogId, null); // auto is the non-event path — no gate row
  assert.equal((await tasks.get('auto_task'))!.status, 'pending'); // never routed to a human hold

  const softDisp = await wf.tierAndGate({ actionType: 'soft_task', riskLevel: 'medium', reversible: true }, EMPTY, T0);
  assert.equal(softDisp.autoExecuted, false);
  assert.notEqual(softDisp.guardrailLogId, null);
  assert.equal((await tasks.get('soft_task'))!.status, 'awaiting_approval'); // C5 enacts the block
});

test('AC-6.APR.002.1 — a floored action is hard REGARDLESS of any config that would lower it (#2 load-bearing)', async () => {
  // The adversary: an action_autonomy_matrix that lowers EVERYTHING to auto, plus low risk + reversible.
  const lowerEverything: AutonomyMatrix = { tierFor: () => 'auto' };
  for (const cat of ['external_comm', 'financial_operation', 'confidential_memory_op', 'restricted_memory_op', 'bulk_export', 'mass_delete', 'connector_spend', 'destructive_config'] as const) {
    const dec = classifyTier(
      { actionType: `floored_${cat}`, riskLevel: 'low', reversible: true, flooredCategories: [cat] },
      lowerEverything,
    );
    assert.equal(dec.tier, 'hard', `floored '${cat}' must be hard`);
    assert.equal(dec.floored, true);
    assert.equal(dec.flooredBy, cat);
  }
});

test('AC-6.APR.002.2 — a Restricted memory op is hard + routes to a grantee/Super-Admin reviewer', async () => {
  const dec = classifyTier({ actionType: 'read_restricted', flooredCategories: ['restricted_memory_op'] });
  assert.equal(dec.tier, 'hard');
  assert.equal(dec.floored, true);
  // routes to the Restricted reviewer role (grantee/Super-Admin per C1); never unrouted.
  const restrictedRules: RoutingRules = { roleForContext: (c) => (c === 'restricted' ? 'super_admin' : undefined), defaultRole: 'reviewer', escalationRole: 'super_admin' };
  const out = routeApproval(
    { actionType: 'read_restricted', routingContext: 'restricted', originatingUserId: 'agent' },
    [{ role: 'super_admin', identity: 'grantee-1', available: true }],
    restrictedRules,
  );
  assert.equal(out.routedRole, 'super_admin');
  assert.equal(out.reviewerIdentity, 'grantee-1');
});

test('AC-6.APR.003.1 — a soft item auto-runs on timeout ONLY IF reversible; an irreversible action is never soft', async () => {
  // An irreversible medium-risk action cannot be soft (forced hard) — so it can never reach the auto-run path.
  assert.equal(classifyTier({ actionType: 'irrev', riskLevel: 'medium', reversible: false }).tier, 'hard');

  const { wf, tasks } = newWorkflow();
  seedTask(tasks, 'soft_reversible');
  await wf.tierAndGate({ actionType: 'soft_reversible', riskLevel: 'medium', reversible: true }, EMPTY, T0);

  // Before the timeout: nothing auto-runs.
  assert.equal((await wf.autoRunElapsedSoft(T0 + 1)).length, 0);
  // After approval_soft_timeout elapses with no human action: the reversible soft item auto-runs.
  const ran = await wf.autoRunElapsedSoft(T0 + DEFAULT_APPROVAL_CONFIG.softTimeoutSeconds + 1);
  assert.equal(ran.length, 1);
  assert.equal(ran[0]!.status, 'approved');
  assert.equal((await tasks.get('soft_reversible'))!.status, 'running'); // C5 resumed it
});

test('AC-6.APR.003.2 — a human rejects a soft item before the delay: it does not execute and is logged', async () => {
  const { wf, tasks } = newWorkflow();
  seedTask(tasks, 'soft_rej', { originating_user_id: 'initiator' });
  const disp = await wf.tierAndGate({ actionType: 'soft_rej', riskLevel: 'medium', reversible: true }, EMPTY, T0);

  const out = await wf.resolve(disp.guardrailLogId!, 'reject', 'reviewer-x', { reason: 'not now' }, T0 + 10);
  assert.equal(out.row.status, 'rejected');
  assert.equal(out.task.status, 'failed'); // cancelled, never executed
  // And it can no longer auto-run (it is resolved).
  assert.equal((await wf.autoRunElapsedSoft(T0 + DEFAULT_APPROVAL_CONFIG.softTimeoutSeconds + 1)).length, 0);
});

test('AC-6.APR.003.3 — Hold-for-full-review cancels the auto-run timer + promotes soft→explicit (one-directional)', async () => {
  const { wf, tasks } = newWorkflow();
  seedTask(tasks, 'soft_hold');
  const disp = await wf.tierAndGate({ actionType: 'soft_hold', riskLevel: 'medium', reversible: true }, EMPTY, T0);

  const held = await wf.holdForFullReview(disp.guardrailLogId!, 'reviewer-y', T0 + 5);
  assert.match(held.description, /HELD for full review/);
  // The timer is cancelled: it must NOT auto-run even after the soft timeout elapses.
  const ran = await wf.autoRunElapsedSoft(T0 + DEFAULT_APPROVAL_CONFIG.softTimeoutSeconds + 100);
  assert.equal(ran.length, 0);
  // One-directional: a hard/floored item can never be "held down" to soft.
  seedTask(tasks, 'floored_task');
  const floored = await wf.tierAndGate({ actionType: 'floored_task', flooredCategories: ['external_comm'] }, EMPTY, T0);
  await assert.rejects(() => wf.holdForFullReview(floored.guardrailLogId!, 'reviewer-y', T0 + 5), (e: Error) => e.message === ERR_HOLD_ONLY_SOFT);
});

test('AC-6.APR.004.1 — a low-risk action executes immediately; the tier decision is retained for OPT.001', async () => {
  const { wf, tasks } = newWorkflow();
  seedTask(tasks, 'low_task');
  const disp = await wf.tierAndGate({ actionType: 'low_task', riskLevel: 'low', reversible: true }, EMPTY, T0);
  assert.equal(disp.autoExecuted, true);
  assert.equal(disp.guardrailLogId, null); // no guardrail_log row — auto is the non-event path
  assert.equal(disp.classificationRecord.tier, 'auto'); // but the classification IS retained
  assert.equal(wf.classifications.length, 1);
});

test('AC-6.APR.005.1 — routes to the configured reviewer role; no rule ⇒ a default reviewer (never unrouted)', () => {
  const matched = routeApproval(
    { actionType: 'crm_update', routingContext: 'crm', originatingUserId: 'agent' },
    [{ role: 'account_manager', identity: 'am-1', available: true }],
    RULES,
  );
  assert.equal(matched.routedRole, 'account_manager');
  assert.equal(matched.escalated, false);

  const noRule = routeApproval(
    { actionType: 'weird_action', routingContext: 'no_such_ctx', originatingUserId: 'agent' },
    [{ role: 'reviewer', identity: 'r-1', available: true }],
    RULES,
  );
  assert.equal(noRule.routedRole, 'reviewer'); // default — never unrouted (#3)
  assert.equal(noRule.reviewerIdentity, 'r-1');
});

test('AC-6.APR.005.2 — an unavailable reviewer falls back + escalates rather than silently stalling', () => {
  const out = routeApproval(
    { actionType: 'crm_update', routingContext: 'crm', originatingUserId: 'agent' },
    [
      { role: 'account_manager', identity: 'am-1', available: false }, // the routed reviewer is out
      { role: 'super_admin', identity: 'sa-1', available: true },
    ],
    RULES,
  );
  assert.equal(out.escalated, true);
  assert.equal(out.routedRole, 'super_admin');
  assert.equal(out.reviewerIdentity, 'sa-1');
  // And when NObody is eligible, it does not silently stall — it returns null + escalated, caller keeps it flagged.
  const none = routeApproval(
    { actionType: 'crm_update', routingContext: 'crm', originatingUserId: 'agent' },
    [{ role: 'account_manager', identity: 'am-1', available: false }],
    RULES,
  );
  assert.equal(none.reviewerIdentity, null);
  assert.equal(none.escalated, true);
});

test('AC-6.APR.005.3 — the initiator can NEVER be its own approver (routing refuses + resolve refuses)', async () => {
  // Routing: the only account_manager candidate IS the initiator → must not be returned.
  const out = routeApproval(
    { actionType: 'crm_update', routingContext: 'crm', originatingUserId: 'u1' },
    [{ role: 'account_manager', identity: 'u1', available: true }],
    RULES,
  );
  assert.notEqual(out.reviewerIdentity, 'u1');

  // Resolve: even if a self-approval reaches the resolve path, it is refused at the item.
  const { wf, tasks } = newWorkflow();
  seedTask(tasks, 'self_task', { originating_user_id: 'u1' });
  const disp = await wf.tierAndGate({ actionType: 'self_task', riskLevel: 'high' }, EMPTY, T0);
  await assert.rejects(() => wf.resolve(disp.guardrailLogId!, 'approve', 'u1', {}, T0 + 1), (e: Error) => e.message === ERR_SELF_APPROVAL('u1'));
});

test('AC-6.APR.006.1 — C6 sets the tier; C5 holds in awaiting_approval; no step runs until a human approves', async () => {
  const { wf, tasks } = newWorkflow();
  seedTask(tasks, 'hard_task', { originating_user_id: 'agent' });
  const disp = await wf.tierAndGate({ actionType: 'hard_task', riskLevel: 'high' }, EMPTY, T0);
  assert.equal(disp.decision.tier, 'hard');
  // C5 holds — the task is awaiting_approval and NOT running.
  assert.equal((await tasks.get('hard_task'))!.status, 'awaiting_approval');
  // Only a human approve releases it.
  const out = await wf.resolve(disp.guardrailLogId!, 'approve', 'reviewer-z', {}, T0 + 100);
  assert.equal(out.task.status, 'running');
  assert.equal(out.task.approved_by, 'reviewer-z');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// ESC — flagged workflow
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════

test('AC-6.ESC.001.1 — a guardrail hit sets the task flagged + paused; no further step runs', async () => {
  const { wf, tasks } = newWorkflow();
  seedTask(tasks, 'flag_task', { status: 'running', originating_user_id: 'agent' });
  const hit: GuardrailHit = { guardrailType: 'anomaly', action: { actionType: 'flag_task', originatingUserId: 'agent', routingContext: 'crm' }, description: 'scope anomaly' };
  const out = await wf.raiseFlag([hit], [{ role: 'account_manager', identity: 'am-1', available: true }], RULES, T0);
  assert.equal(out.governing, 'flagged');
  assert.equal((await tasks.get('flag_task'))!.status, 'flagged'); // paused; no further step runs
});

test('AC-6.ESC.001.2 — a hard_limit hit is killed + logged; never in the queue, never an Approve affordance', async () => {
  const { wf, tasks } = newWorkflow();
  seedTask(tasks, 'kill_task', { status: 'running', originating_user_id: 'agent' });
  const hit: GuardrailHit = { guardrailType: 'hard_limit', action: { actionType: 'kill_task', originatingUserId: 'agent' }, description: 'external send blocked' };
  const out = await wf.raiseFlag([hit], [{ role: 'account_manager', identity: 'am-1', available: true }], RULES, T0);
  assert.equal(out.governing, 'killed');
  assert.equal(out.hardLimitDominated, true);
  assert.equal(out.rowIds.length, 1); // still logged
  // Never in the queue.
  const view = await wf.buildQueueView('all', 'live', T0 + 1);
  assert.equal(view.items.find((i) => i.guardrailType === 'hard_limit'), undefined);
  // Never an Approve affordance — resolve is refused on a hard_limit row.
  await assert.rejects(() => wf.resolve(out.rowIds[0]!, 'approve', 'reviewer', {}, T0 + 1), (e: Error) => e.message === ERR_HARD_LIMIT_NO_AFFORDANCE);
});

test('AC-6.ESC.001.3 — multi-fire: most-restrictive governs (hard_limit dominates); each hit logs its own row', async () => {
  const { wf, tasks } = newWorkflow();
  seedTask(tasks, 'multi_task', { status: 'running', originating_user_id: 'agent' });
  const hits: GuardrailHit[] = [
    { guardrailType: 'anomaly', action: { actionType: 'multi_task', originatingUserId: 'agent' }, description: 'anomaly co-fire' },
    { guardrailType: 'hard_limit', action: { actionType: 'multi_task', originatingUserId: 'agent' }, description: 'hard-limit co-fire' },
  ];
  const out = await wf.raiseFlag(hits, [{ role: 'account_manager', identity: 'am-1', available: true }], RULES, T0);
  // Most-restrictive governs → hard_limit dominates → killed, not resumable.
  assert.equal(out.governing, 'killed');
  assert.equal(out.hardLimitDominated, true);
  // Each hit still writes its OWN row — no hit masked.
  assert.equal(out.rowIds.length, 2);
  // The co-firing anomaly row can NOT be approved to inadvertently resume the hard-killed step: it is closed
  // out to 'rejected' (the kill governs), so it never surfaces in the queue and can never drive a resume.
  const view = await wf.buildQueueView('all', 'live', T0 + 1);
  assert.equal(view.items.length, 0); // neither the hard_limit row nor the superseded anomaly row is queued
  // And attempting to approve the (now rejected) anomaly row is refused (it is no longer pending).
  const anomalyRowId = out.rowIds[0]!;
  assert.equal((await wf.getRow(anomalyRowId))!.status, 'rejected');
  await assert.rejects(() => wf.resolve(anomalyRowId, 'approve', 'reviewer', {}, T0 + 2));
  // The task was never set flagged-for-resume (it stays running/killed at the C5 boundary).
  assert.notEqual((await tasks.get('multi_task'))!.status, 'flagged');
  // The pure tier helper agrees: hard is the most-restrictive of {soft, hard}.
  assert.equal(mostRestrictiveTier('soft', 'hard'), 'hard');
});

test('AC-6.ESC.002.1 — the reviewer is notified + queued; a dropped notification is surfaced (no silent flag)', async () => {
  // Happy path: notified + in the queue.
  const ok = newWorkflow();
  seedTask(ok.tasks, 'notify_task', { status: 'running', originating_user_id: 'agent' });
  const hit: GuardrailHit = { guardrailType: 'anomaly', action: { actionType: 'notify_task', originatingUserId: 'agent', routingContext: 'crm' }, description: 'flag' };
  const out = await ok.wf.raiseFlag([hit], [{ role: 'account_manager', identity: 'am-1', available: true }], RULES, T0);
  assert.equal(out.notified, true);
  assert.equal(ok.notify.emitted.length, 1);
  const view = await ok.wf.buildQueueView('all', 'live', T0 + 1);
  assert.equal(view.items.length, 1);

  // Dropped path: the notification fails → surfaced (droppedNotifications), never a silent un-notified flag.
  const bad = newWorkflow({ faults: { failNotification: true } });
  seedTask(bad.tasks, 'notify_task2', { status: 'running', originating_user_id: 'agent' });
  const out2 = await bad.wf.raiseFlag([{ ...hit, action: { actionType: 'notify_task2', originatingUserId: 'agent', routingContext: 'crm' } }], [{ role: 'account_manager', identity: 'am-1', available: true }], RULES, T0);
  assert.equal(out2.notified, false);
  assert.equal(out2.notificationDropped, true);
  assert.equal(bad.wf.droppedNotifications.length, 1);
});

test('AC-6.ESC.003.1 — approve resumes / reject cancels+reason / modify requeues', async () => {
  const { wf, tasks } = newWorkflow();
  // approve
  seedTask(tasks, 'appr', { originating_user_id: 'agent' });
  const d1 = await wf.tierAndGate({ actionType: 'appr', riskLevel: 'high' }, EMPTY, T0);
  assert.equal((await wf.resolve(d1.guardrailLogId!, 'approve', 'rev', {}, T0 + 1)).task.status, 'running');
  // reject
  seedTask(tasks, 'rej', { originating_user_id: 'agent' });
  const d2 = await wf.tierAndGate({ actionType: 'rej', riskLevel: 'high' }, EMPTY, T0);
  const r2 = await wf.resolve(d2.guardrailLogId!, 'reject', 'rev', { reason: 'wrong recipient' }, T0 + 1);
  assert.equal(r2.task.status, 'failed');
  assert.equal(r2.row.status, 'rejected');
  // modify
  seedTask(tasks, 'mod', { originating_user_id: 'agent' });
  const d3 = await wf.tierAndGate({ actionType: 'mod', riskLevel: 'high' }, EMPTY, T0);
  const r3 = await wf.resolve(d3.guardrailLogId!, 'modify', 'rev', { editedPayload: { fixed: true } }, T0 + 1);
  assert.equal(r3.task.status, 'pending'); // requeued → re-enters the gate
  assert.deepEqual(r3.task.action_payload, { fixed: true });
});

test('AC-6.ESC.003.2 — a reversible applied effect is shown + gets a durable compensation task (never auto-rollback)', async () => {
  const { wf, tasks, comp } = newWorkflow();
  seedTask(tasks, 'comp_task', { status: 'flagged', originating_user_id: 'agent' });
  const hit: GuardrailHit = { guardrailType: 'anomaly', action: { actionType: 'comp_task', originatingUserId: 'agent' }, description: 'flag after a reversible write' };
  const flag = await wf.raiseFlag([hit], [{ role: 'reviewer', identity: 'rev', available: true }], RULES, T0);
  const out = await wf.resolve(flag.rowIds[0]!, 'reject', 'rev', {
    reason: 'undo it',
    appliedEffects: [{ description: 'created a draft CRM note', reversible: true }],
  }, T0 + 1);
  assert.equal(out.compensationQueued.length, 1);
  assert.equal(comp.queued.length, 1); // durable — queued on the compensation sink, NOT auto-rolled-back
  assert.match(out.compensationQueued[0]!.description, /cleanup/i);
  assert.equal(out.nonCompensable.length, 0);
});

test('AC-6.ESC.003.3 — an irreversible applied effect is surfaced non-compensable (no false undo)', async () => {
  const { wf, tasks, comp } = newWorkflow();
  seedTask(tasks, 'irrev_task', { status: 'flagged', originating_user_id: 'agent' });
  const hit: GuardrailHit = { guardrailType: 'anomaly', action: { actionType: 'irrev_task', originatingUserId: 'agent' }, description: 'flag after an irreversible send' };
  const flag = await wf.raiseFlag([hit], [{ role: 'reviewer', identity: 'rev', available: true }], RULES, T0);
  const out = await wf.resolve(flag.rowIds[0]!, 'reject', 'rev', {
    reason: 'too late',
    appliedEffects: [{ description: 'sent an irreversible external email', reversible: false }],
  }, T0 + 1);
  assert.equal(out.compensationQueued.length, 0);
  assert.equal(comp.queued.length, 0); // no compensation task — it cannot be undone
  assert.equal(out.nonCompensable.length, 1);
  assert.match(out.nonCompensable[0]!, /NON-COMPENSABLE/);
});

test('AC-6.ESC.004.1 — an un-actioned wait past its timeout escalates; never auto-resolved / dropped', async () => {
  const { wf, tasks, notify } = newWorkflow();
  seedTask(tasks, 'stale_task', { originating_user_id: 'agent' });
  const disp = await wf.tierAndGate({ actionType: 'stale_task', riskLevel: 'high' }, EMPTY, T0);

  // Before the escalation timeout: nothing escalates.
  assert.equal((await wf.escalateStaleWaits(T0 + 1)).length, 0);
  // After it: the item escalates, escalated_at is set, and it STAYS pending (never auto-resolved / dropped).
  const esc = await wf.escalateStaleWaits(T0 + DEFAULT_APPROVAL_CONFIG.escalationTimeoutSeconds + 1);
  assert.equal(esc.length, 1);
  assert.notEqual(esc[0]!.escalated_at, null);
  assert.equal((await wf.getRow(disp.guardrailLogId!))!.status, 'pending'); // unchanged — still awaiting a human
  assert.equal(notify.emitted.length, 1);
  assert.equal(notify.emitted[0]!.kind, 'stale_wait_escalation');
});

test('AC-6.ESC.004.2 — repeated timeouts WIDEN the escalation (to Super-Admin)', async () => {
  const cfg: ApprovalConfig = { ...DEFAULT_APPROVAL_CONFIG, widenAfterEscalations: 2 };
  const { wf, tasks, notify } = newWorkflow({ config: cfg });
  seedTask(tasks, 'widen_task', { status: 'running', originating_user_id: 'agent' });
  await wf.raiseFlag([{ guardrailType: 'anomaly', action: { actionType: 'widen_task', originatingUserId: 'agent', routingContext: 'crm' }, description: 'flag' }], [{ role: 'account_manager', identity: 'am-1', available: true }], RULES, T0);

  const base = T0 + cfg.escalationTimeoutSeconds + 1;
  await wf.escalateStaleWaits(base); // escalation #1 — routed reviewer role
  await wf.escalateStaleWaits(base + 1); // escalation #2 — widens to Super-Admin
  const last = notify.emitted[notify.emitted.length - 1]!;
  assert.equal(last.reviewer_role, 'Super-Admin');
  assert.match(last.summary, /WIDENED to Super-Admin/);
});

test('AC-6.ESC.004.3 — the escalate rule covers BOTH flagged AND awaiting_approval wait-points', async () => {
  const { wf, tasks } = newWorkflow();
  // an awaiting_approval wait (a tiered hard gate)
  seedTask(tasks, 'awaiting_wait', { originating_user_id: 'agent' });
  await wf.tierAndGate({ actionType: 'awaiting_wait', riskLevel: 'high' }, EMPTY, T0);
  // a flagged wait (a guardrail hit)
  seedTask(tasks, 'flagged_wait', { status: 'running', originating_user_id: 'agent' });
  await wf.raiseFlag([{ guardrailType: 'anomaly', action: { actionType: 'flagged_wait', originatingUserId: 'agent', routingContext: 'crm' }, description: 'flag' }], [{ role: 'account_manager', identity: 'am-1', available: true }], RULES, T0);

  const esc = await wf.escalateStaleWaits(T0 + DEFAULT_APPROVAL_CONFIG.escalationTimeoutSeconds + 1);
  const kinds = new Set(esc.map((r) => r.guardrail_type));
  // both wait-points escalated — neither falls into a gap.
  assert.equal(esc.length, 2);
  assert.ok(kinds.has('approval_gate')); // the awaiting_approval tiered gate
  assert.ok(kinds.has('anomaly')); // the flagged guardrail hit
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// NFR postures
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════

test('AC-NFR-SEC.013.1 — every path (surface / mobile / /-command) runs the IDENTICAL tier pipeline (no bypass)', async () => {
  // The tier decision is a pure function of (action, matrix) — there is no per-callsite parameter by which one
  // entry path could get a different (or absent) gate. Same action → same tier from every caller.
  const action: GatedAction = { actionType: 'send_email_external', riskLevel: 'low', reversible: true, flooredCategories: ['external_comm'] };
  const fromSurface = classifyTier(action, EMPTY);
  const fromMobile = classifyTier(action, EMPTY);
  const fromSlashCommand = classifyTier(action, { tierFor: () => 'auto' }); // even a relaxing matrix
  assert.equal(fromSurface.tier, 'hard');
  assert.equal(fromMobile.tier, 'hard');
  assert.equal(fromSlashCommand.tier, 'hard'); // no bypass — the floor holds on every path
});

test('AC-NFR-SEC.013.2 — an unauthorized caller is denied BEFORE any resolve side effect', async () => {
  // The self-approval guard (a caller who is the initiator) fires before the task/status is mutated.
  const { wf, tasks } = newWorkflow();
  seedTask(tasks, 'guard_task', { originating_user_id: 'u1' });
  const disp = await wf.tierAndGate({ actionType: 'guard_task', riskLevel: 'high' }, EMPTY, T0);
  await assert.rejects(() => wf.resolve(disp.guardrailLogId!, 'approve', 'u1', {}, T0 + 1));
  // No side effect happened: the task is still held (awaiting_approval), the row still pending.
  assert.equal((await tasks.get('guard_task'))!.status, 'awaiting_approval');
  assert.equal((await wf.getRow(disp.guardrailLogId!))!.status, 'pending');
});

test('AC-NFR-OBS.007.1 — the wait-point escalates + persists; it is never auto-cleared', async () => {
  const { wf, tasks } = newWorkflow();
  seedTask(tasks, 'persist_task', { originating_user_id: 'agent' });
  const disp = await wf.tierAndGate({ actionType: 'persist_task', riskLevel: 'high' }, EMPTY, T0);
  await wf.escalateStaleWaits(T0 + DEFAULT_APPROVAL_CONFIG.escalationTimeoutSeconds + 1);
  const row = await wf.getRow(disp.guardrailLogId!);
  assert.notEqual(row!.escalated_at, null); // persisted
  assert.equal(row!.status, 'pending'); // not auto-cleared / auto-approved
});

test('AC-NFR-OBS.007.2 — the escalation honours the configured escalation-window threshold', async () => {
  // A tighter threshold escalates sooner; a looser one does not fire at the same instant.
  const tight: ApprovalConfig = { ...DEFAULT_APPROVAL_CONFIG, escalationTimeoutSeconds: 100 };
  const a = newWorkflow({ config: tight });
  seedTask(a.tasks, 'thr_task', { originating_user_id: 'agent' });
  await a.wf.tierAndGate({ actionType: 'thr_task', riskLevel: 'high' }, EMPTY, T0);
  assert.equal((await a.wf.escalateStaleWaits(T0 + 50)).length, 0); // within the window
  assert.equal((await a.wf.escalateStaleWaits(T0 + 101)).length, 1); // past the configured window
});
