// ISSUE-037 §9 — offline proof of every §4 AC against the InMemoryTriggerStore reference model.
// Deterministic: a logical `now` (epoch seconds) is threaded everywhere; no wall clock, no scheduler,
// no live vendor call. Liveness is driven by an INJECTED clock + INJECTED effects (fault injection).
//
// AC coverage map (issue §4):
//   TRIG.001.1/.2  — inbound normalize + malformed reject-and-log
//   TRIG.002.1/.2  — rule match launches / no-match does not
//   TRIG.003.1/.2  — default set present+toggleable / disabled fires nothing
//   TRIG.004.1-.4  — per-vendor scheme identity (Ed25519/HMAC+dedup/OIDC) + watch re-arm before lapse
//   TRIG.005.1-.3  — re-arm before expiry+persist / missed re-arm→degraded (not silent) / health surface
//   TRIG.006.1-.3  — Slack gap sweep re-ingest / delivery-threshold degraded / Gmail 404 full-sync

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryTriggerStore, type WatchState, type DeliverySample } from './store.js';
import type { VerifiedEvent } from './seam.js';
import { handleInbound, type LaunchTask } from './pipeline.js';
import { schemeFor, SCHEME_TABLE } from './scheme.js';
import { parserFor } from './parser.js';
import {
  validateRule,
  ruleMatches,
  matchesCondition,
  DEFAULT_TRIGGER_SET,
  CFG_WATCH_REARM_LEAD_MINUTES,
} from './config.js';
import { runWatchRearm, runReconciliationSweep, SLACK_SUCCESS_RATE_DEGRADED_FLOOR } from './liveness.js';

const NOW = 1_800_000_000; // fixed logical clock (epoch seconds)

// A store seeded with the GHL default set + a permissive arm (generic-pipeline proof, arms stay held in
// the shipped table — see the dedicated arm-held test).
function ghlStore(): InMemoryTriggerStore {
  const store = new InMemoryTriggerStore();
  store.seedDefaults(
    'ghl',
    DEFAULT_TRIGGER_SET.ghl.map((d) => ({ eventName: d.eventName, availableFields: d.availableFields, enabled: true })),
  );
  return store;
}

function ev(partial: Partial<VerifiedEvent> & Pick<VerifiedEvent, 'verifiedPayload'>): VerifiedEvent {
  return { connector: 'ghl', verified: true, rawEventId: 'del-1', ...partial };
}

const armAlwaysReady = () => true;

// A launch collector.
function collector(): { launch: LaunchTask; launched: Array<{ task: string; eventName: string }> } {
  const launched: Array<{ task: string; eventName: string }> = [];
  const launch: LaunchTask = async (taskName, e) => {
    launched.push({ task: taskName, eventName: e.eventName });
  };
  return { launch, launched };
}

// ── FR-3.TRIG.001 ────────────────────────────────────────────────────────────────────────────────────
test('AC-3.TRIG.001.1 — authenticated inbound event is parsed + normalized + evaluated', async () => {
  const store = ghlStore();
  const { launch } = collector();
  const res = await handleInbound(
    ev({ verifiedPayload: { type: 'ContactCreate', locationId: 'loc1', tag: 'vip' }, rawEventId: 'd1' }),
    { store, launch, armReady: armAlwaysReady },
    NOW,
  );
  assert.equal(res.outcome, 'processed');
  // The parser normalized it and it reached trigger evaluation (an inbound event_log row was written).
  assert.ok(store.events.some((r) => r.event_type === 'trigger_inbound' && r.summary.includes('ContactCreate')));
});

test('AC-3.TRIG.001.2 — a malformed payload is rejected AND logged, never silently dropped', async () => {
  const store = ghlStore();
  const { launch, launched } = collector();
  const res = await handleInbound(
    ev({ verifiedPayload: 'not-an-object', rawEventId: 'bad1' }),
    { store, launch, armReady: armAlwaysReady },
    NOW,
  );
  assert.equal(res.outcome, 'parse_failed');
  assert.equal(launched.length, 0);
  // The #3 guarantee: a durable parse-failure row exists (not a silent drop).
  const row = store.events.find((r) => r.event_type === 'trigger_parse_failed');
  assert.ok(row, 'a trigger_parse_failed event_log row must exist');
  assert.match(row!.summary, /malformed/);
});

test('AC-3.TRIG.001.2 — a missing event-type field is a parse failure (not a throw)', async () => {
  const store = ghlStore();
  const { launch } = collector();
  const res = await handleInbound(
    ev({ verifiedPayload: { locationId: 'loc1' }, rawEventId: 'noevt' }),
    { store, launch, armReady: armAlwaysReady },
    NOW,
  );
  assert.equal(res.outcome, 'parse_failed');
});

// ── FR-3.TRIG.002 ────────────────────────────────────────────────────────────────────────────────────
test('AC-3.TRIG.002.1 — a configured event+condition→task rule launches on a matching event', async () => {
  const store = ghlStore();
  const { launch, launched } = collector();
  await store.saveRule(
    { connector: 'ghl', eventName: 'ContactCreate', conditions: [{ field: 'tag', op: 'eq', value: 'vip' }], taskName: 'welcome_vip', enabled: true },
    'admin@client',
    NOW,
  );
  const res = await handleInbound(
    ev({ verifiedPayload: { type: 'ContactCreate', tag: 'vip', locationId: 'loc1' }, rawEventId: 'm1' }),
    { store, launch, armReady: armAlwaysReady },
    NOW,
  );
  assert.equal(res.outcome, 'processed');
  assert.deepEqual(launched, [{ task: 'welcome_vip', eventName: 'ContactCreate' }]);
  assert.ok(store.events.some((r) => r.event_type === 'trigger_fired' && r.summary.includes('welcome_vip')));
});

test('AC-3.TRIG.002.2 — a non-matching event launches no task', async () => {
  const store = ghlStore();
  const { launch, launched } = collector();
  await store.saveRule(
    { connector: 'ghl', eventName: 'ContactCreate', conditions: [{ field: 'tag', op: 'eq', value: 'vip' }], taskName: 'welcome_vip', enabled: true },
    'admin@client',
    NOW,
  );
  const res = await handleInbound(
    ev({ verifiedPayload: { type: 'ContactCreate', tag: 'other', locationId: 'loc1' }, rawEventId: 'n1' }),
    { store, launch, armReady: armAlwaysReady },
    NOW,
  );
  assert.equal(res.outcome, 'processed');
  assert.equal(launched.length, 0);
  assert.ok(!store.events.some((r) => r.event_type === 'trigger_fired'));
});

test('FR-3.TRIG.002 edge — a rule referencing a field the event cannot carry is rejected at save', () => {
  const v = validateRule('ghl', 'ContactCreate', [{ field: 'nonexistent', op: 'eq', value: 'x' }], 'task');
  assert.equal(v.ok, false);
  assert.ok(!v.ok && v.errors.some((e) => e.includes('nonexistent')));
  // A valid rule passes.
  assert.equal(validateRule('ghl', 'ContactCreate', [{ field: 'tag', op: 'eq', value: 'vip' }], 'task').ok, true);
});

test('FR-3.TRIG.002 — condition ops incl. missing-field safety (no throw, no false-fire)', () => {
  const base = { connector: 'ghl' as const, eventName: 'ContactCreate', rawEventId: 'x', boundary_tagged: true as const };
  const withTag = { ...base, fields: { tag: 'vip' } };
  const noTag = { ...base, fields: {} };
  assert.equal(matchesCondition({ field: 'tag', op: 'eq', value: 'vip' }, withTag), true);
  assert.equal(matchesCondition({ field: 'tag', op: 'eq', value: 'vip' }, noTag), false); // absent ≠ match
  assert.equal(matchesCondition({ field: 'tag', op: 'neq', value: 'vip' }, noTag), false); // absent is NOT a neq-match
  assert.equal(matchesCondition({ field: 'tag', op: 'exists' }, withTag), true);
  assert.equal(matchesCondition({ field: 'tag', op: 'exists' }, noTag), false);
  assert.equal(matchesCondition({ field: 'tag', op: 'in', value: 'a,vip,b' }, withTag), true);
  // logic-sweep regression: a stray comma in the 'in' set (',vip') passes save-time validateRule
  // (which filters empty segments) but must NOT let an empty-string field spuriously match at runtime.
  const emptyTag = { ...base, fields: { tag: '' } };
  assert.equal(validateRule('ghl', 'ContactCreate', [{ field: 'tag', op: 'in', value: ',vip' }], 'task').ok, true);
  assert.equal(matchesCondition({ field: 'tag', op: 'in', value: ',vip' }, emptyTag), false); // empty segment must not match ''
});

// ── FR-3.TRIG.003 ────────────────────────────────────────────────────────────────────────────────────
test('AC-3.TRIG.003.1 — a connector ships its default triggers, individually toggleable', async () => {
  const store = ghlStore();
  const defs = await store.getDefaultTriggers('ghl');
  assert.deepEqual(
    defs.map((d) => d.eventName).sort(),
    ['ContactCreate', 'ContactTagUpdate', 'OpportunityStageUpdate', 'TaskOverdue'],
  );
  assert.ok(defs.every((d) => d.enabled));
  await store.setDefaultTriggerEnabled('ghl', 'ContactCreate', false, 'admin@client', NOW);
  const after = await store.getDefaultTriggers('ghl');
  assert.equal(after.find((d) => d.eventName === 'ContactCreate')!.enabled, false);
  // The toggle is audited to the real access_audit shape (issue §5 PERM — enable/disable audited).
  assert.ok(
    store.audits.some(
      (a) => a.audit_type === 'trigger_config_change' && a.target_type === 'trigger_default' && a.action === 'disable' && a.actor_type === 'user',
    ),
  );
});

test('AC-3.TRIG.003.2 — a disabled default trigger fires nothing', async () => {
  const store = ghlStore();
  const { launch, launched } = collector();
  await store.saveRule(
    { connector: 'ghl', eventName: 'ContactCreate', conditions: [], taskName: 'anything', enabled: true },
    'admin@client',
    NOW,
  );
  await store.setDefaultTriggerEnabled('ghl', 'ContactCreate', false, 'admin@client', NOW);
  const res = await handleInbound(
    ev({ verifiedPayload: { type: 'ContactCreate', locationId: 'loc1' }, rawEventId: 'dis1' }),
    { store, launch, armReady: armAlwaysReady },
    NOW,
  );
  assert.equal(res.outcome, 'default_disabled');
  assert.equal(launched.length, 0);
});

// ── FR-3.TRIG.004 ────────────────────────────────────────────────────────────────────────────────────
test('AC-3.TRIG.004.1 — GHL scheme is Ed25519 on X-GHL-Signature, deduped on deliveryId', () => {
  const s = schemeFor('ghl');
  assert.equal(s.algorithm, 'ed25519');
  assert.equal(s.signatureHeader, 'X-GHL-Signature');
  assert.equal(s.dedupKey, 'deliveryId');
});

test('AC-3.TRIG.004.2 — Slack scheme is HMAC-SHA256, deduped on event_id + a re-delivery fires once', async () => {
  const s = schemeFor('slack');
  assert.equal(s.algorithm, 'hmac_sha256');
  assert.equal(s.dedupKey, 'event_id');
  // Dedup behaviour: the same rawEventId (event_id) is suppressed on second delivery.
  const store = new InMemoryTriggerStore();
  store.seedDefaults('slack', DEFAULT_TRIGGER_SET.slack.map((d) => ({ ...d, enabled: true })));
  const { launch, launched } = collector();
  await store.saveRule(
    { connector: 'slack', eventName: 'message', conditions: [], taskName: 'on_msg', enabled: true },
    'admin@client',
    NOW,
  );
  const payload = { event: { type: 'message', channel: 'C1', user: 'U1' } };
  const first = await handleInbound({ connector: 'slack', verified: true, rawEventId: 'evt-1', verifiedPayload: payload }, { store, launch, armReady: armAlwaysReady }, NOW);
  const second = await handleInbound({ connector: 'slack', verified: true, rawEventId: 'evt-1', verifiedPayload: payload }, { store, launch, armReady: armAlwaysReady }, NOW);
  assert.equal(first.outcome, 'processed');
  assert.equal(second.outcome, 'duplicate');
  assert.equal(launched.length, 1); // fired exactly once despite two deliveries
});

test('AC-3.TRIG.002.1 — a PARTIAL launch failure does not mark the event seen; redelivery re-fires the un-launched rule (at-least-once → exactly-once, #1/#3)', async () => {
  // logic-sweep regression (pipeline.ts handleInbound): recordEvent must NOT persist before every matched
  // task has launched. Two matching rules; the FIRST launch succeeds, the SECOND throws. Pre-fix the event
  // was marked seen after R1 fired, so the redelivery deduped and R2 was silently lost forever.
  const store = ghlStore();
  await store.saveRule(
    { connector: 'ghl', eventName: 'ContactCreate', conditions: [], taskName: 'task_a', enabled: true },
    'admin@client',
    NOW,
  );
  await store.saveRule(
    { connector: 'ghl', eventName: 'ContactCreate', conditions: [], taskName: 'task_b', enabled: true },
    'admin@client',
    NOW,
  );

  const launched: string[] = [];
  let failNext = true; // fail exactly the first task_b launch (transient task-queue outage), then heal
  const flakyLaunch: LaunchTask = async (taskName) => {
    if (taskName === 'task_b' && failNext) {
      failNext = false;
      throw new Error('task queue transiently down');
    }
    launched.push(taskName);
  };

  const inbound = ev({ verifiedPayload: { type: 'ContactCreate', tag: 'vip', locationId: 'loc1' }, rawEventId: 'partial-1' });

  // First delivery: task_a launches, task_b rejects → handleInbound surfaces the failure (never silent).
  await assert.rejects(() => handleInbound(inbound, { store, launch: flakyLaunch, armReady: armAlwaysReady }, NOW));
  assert.deepEqual(launched, ['task_a']);

  // The event MUST NOT be marked seen after a partial launch — otherwise the redelivery is deduped and
  // task_b is lost forever. On redelivery (ADR-004 at-least-once) the pipeline must run the loop again.
  assert.equal(await store.seenEvent('ghl', 'partial-1'), false, 'a partial launch must not mark the event seen (#1/#3)');

  const second = await handleInbound(inbound, { store, launch: flakyLaunch, armReady: armAlwaysReady }, NOW);
  assert.equal(second.outcome, 'processed');
  // task_b (the previously-lost rule) fires on redelivery. task_a re-fires too — accepted per the finding's
  // fix (launch must be idempotent per taskName); the invariant that matters is no rule is silently dropped.
  assert.ok(launched.includes('task_b'), 'the un-launched rule must fire on redelivery, not be silently lost');
  assert.equal(await store.seenEvent('ghl', 'partial-1'), true); // now fully processed → recorded seen
});

test('AC-3.TRIG.004.3 — Gmail scheme is OIDC-JWT; the Google parser normalizes a Pub/Sub push', () => {
  const s = schemeFor('google');
  assert.equal(s.algorithm, 'oidc_jwt');
  const parsed = parserFor('google')({ historyId: '12345', emailAddress: 'a@b.com' }, 'msg-1');
  assert.ok(parsed.ok);
  assert.equal(parsed.ok && parsed.event.eventName, 'new_email');
  assert.equal(parsed.ok && parsed.event.fields.historyId, '12345');
  assert.equal(parsed.ok && parsed.event.boundary_tagged, true); // ADR-007 boundary tag
});

test('AC-3.TRIG.004.4 — a watch nearing expiry is re-armed before it lapses (see TRIG.005.1)', async () => {
  // Covered concretely in the TRIG.005.1 test (re-arm before lapse + persist). Assert here that the arm
  // gate holds every vendor arm until its AF is GREEN (the shipped table).
  for (const c of ['ghl', 'slack', 'google'] as const) {
    assert.equal(SCHEME_TABLE[c].armReady, false, `${c} arm must be HELD until its AF is GREEN`);
    assert.ok(SCHEME_TABLE[c].gatingAFs.length > 0);
  }
});

test('FR-3.TRIG.004 — a held arm is fail-closed: the pipeline refuses to process it (not silent)', async () => {
  const store = ghlStore();
  const { launch, launched } = collector();
  // Use the DEFAULT arm gate (all held). The event is verified + parseable, yet must NOT process.
  const res = await handleInbound(
    ev({ verifiedPayload: { type: 'ContactCreate', locationId: 'loc1' }, rawEventId: 'held1' }),
    { store, launch }, // no armReady override → uses SCHEME_TABLE (held)
    NOW,
  );
  assert.equal(res.outcome, 'arm_held');
  assert.ok(res.outcome === 'arm_held' && res.gatingAFs.includes('AF-090'));
  assert.equal(launched.length, 0);
});

test('FR-3.TRIG.001 defence-in-depth — an unverified event is refused', async () => {
  const store = ghlStore();
  const { launch } = collector();
  const res = await handleInbound(
    ev({ verified: false, verifiedPayload: { type: 'ContactCreate' }, rawEventId: 'u1' }),
    { store, launch, armReady: armAlwaysReady },
    NOW,
  );
  assert.equal(res.outcome, 'refused_unverified');
});

// ── FR-3.TRIG.005 (watch re-arm) — injected clock + injected effect ─────────────────────────────────
function gmailWatch(expiresAt: number, degraded = false): WatchState {
  return { connector: 'google', kind: 'gmail', channelId: 'ch-1', resourceId: 'res-1', expiresAt, degraded };
}

test('AC-3.TRIG.005.1 — a watch expiring within the lead window is re-armed + the new expiry persisted', async () => {
  const store = new InMemoryTriggerStore();
  const lead = CFG_WATCH_REARM_LEAD_MINUTES.google * 60;
  // Expires in less than the lead window → due for re-arm.
  await store.upsertWatch(gmailWatch(NOW + lead - 60));
  const newExpiry = NOW + 7 * 24 * 3600;
  const report = await runWatchRearm(store, { google: async () => ({ channelId: 'ch-2', resourceId: 'res-2', expiresAt: newExpiry }) }, NOW);
  assert.equal(report.rearmed, 1);
  assert.equal(report.failed, 0);
  const [w] = await store.getWatches();
  assert.equal(w!.channelId, 'ch-2'); // re-armed channel persisted
  assert.equal(w!.expiresAt, newExpiry); // new expiry persisted (before it lapsed)
  assert.equal(w!.degraded, false);
  assert.ok(store.events.some((r) => r.event_type === 'watch_rearmed'));
});

test('AC-3.TRIG.005.1 — a watch NOT yet in the lead window is left alone', async () => {
  const store = new InMemoryTriggerStore();
  const lead = CFG_WATCH_REARM_LEAD_MINUTES.google * 60;
  await store.upsertWatch(gmailWatch(NOW + lead + 3600)); // outside the window
  const report = await runWatchRearm(store, { google: async () => ({ channelId: 'x', resourceId: 'x', expiresAt: NOW + 999999 }) }, NOW);
  assert.equal(report.rearmed, 0);
  assert.equal(report.scanned, 1);
});

test('AC-3.TRIG.005.2 — a FAILED re-arm moves the connector to degraded + is surfaced (never silent)', async () => {
  const store = new InMemoryTriggerStore();
  const lead = CFG_WATCH_REARM_LEAD_MINUTES.google * 60;
  await store.upsertWatch(gmailWatch(NOW + lead - 60));
  const report = await runWatchRearm(store, { google: async () => { throw new Error('vendor 500'); } }, NOW);
  assert.equal(report.failed, 1);
  assert.deepEqual(report.degraded, ['google/ch-1']);
  const [w] = await store.getWatches();
  assert.equal(w!.degraded, true); // degraded flag set (FR-3.DSC.001 condition raised)
  const row = store.events.find((r) => r.event_type === 'watch_rearm_failed');
  assert.ok(row, 'a watch_rearm_failed row must exist (loud, not silent)');
  assert.match(row!.summary, /DEGRADED/);
});

test('AC-3.TRIG.005.2 — a MISSED re-arm (already lapsed, no effect wired) is degraded, not silent', async () => {
  const store = new InMemoryTriggerStore();
  await store.upsertWatch(gmailWatch(NOW - 3600)); // already lapsed
  const report = await runWatchRearm(store, {}, NOW); // no effect wired (held arm)
  assert.equal(report.failed, 1);
  const row = store.events.find((r) => r.event_type === 'watch_rearm_failed');
  assert.ok(row && /LAPSED/.test(row.summary), 'a lapsed watch with no effect must surface as degraded/LAPSED');
});

test('AC-3.TRIG.005.3 — watch expiry is queryable for the health panel (surfaced alongside token expiry)', async () => {
  // The slice raises + surfaces watch state; the panel is ISSUE-038. Assert the state IS surfaced: a
  // degraded watch + its expiry are readable via getWatches (what FR-3.DSC.005 reads).
  const store = new InMemoryTriggerStore();
  await store.upsertWatch(gmailWatch(NOW + 100, true));
  const [w] = await store.getWatches();
  assert.equal(w!.degraded, true);
  assert.equal(typeof w!.expiresAt, 'number'); // expiry surfaced for the panel
});

test('FR-3.TRIG.005 branch — non-expiring transports (Slack/GHL) are skipped by the re-arm job', async () => {
  const store = new InMemoryTriggerStore();
  // A slack "watch" (should never exist, but prove the lead=0 skip): lead is 0 → skipped.
  await store.upsertWatch({ connector: 'slack', kind: 'events', channelId: 'sc', resourceId: 'sr', expiresAt: NOW - 1, degraded: false });
  const report = await runWatchRearm(store, {}, NOW);
  assert.equal(report.failed, 0); // NOT flagged — Slack has no watch lifecycle
  assert.equal(report.rearmed, 0);
});

// ── FR-3.TRIG.006 (gap detection + reconciliation) ──────────────────────────────────────────────────
test('AC-3.TRIG.006.1 — a Slack delivery gap is re-read via history from the watermark + re-ingested', async () => {
  const store = new InMemoryTriggerStore();
  await store.setWatermark('slack', 'C1', 'ts-100', NOW);
  const reingested: unknown[] = [];
  const report = await runReconciliationSweep(store, {
    connector: 'slack',
    channel: 'C1',
    read: async ({ sincePosition }) => {
      assert.equal(sincePosition, 'ts-100'); // read FROM the persisted watermark
      return { events: [{ ts: 'ts-101' }, { ts: 'ts-102' }], newPosition: 'ts-102' };
    },
    onReingest: async (events) => { reingested.push(...events); return events.length; },
    fullSync: false,
    now: NOW,
  });
  assert.equal(report.gapDetected, true);
  assert.equal(report.reconciled, 2);
  assert.equal(reingested.length, 2);
  assert.ok(store.events.some((r) => r.event_type === 'event_gap_detected'));
  assert.ok(store.events.some((r) => r.event_type === 'event_gap_reconciled'));
  assert.equal((await store.getWatermark('slack', 'C1'))!.position, 'ts-102'); // advanced
});

test('AC-3.TRIG.006.1 edge — a PARTIAL re-ingest does NOT advance the watermark and fails LOUD (never skip un-ingested events, #1/#3)', async () => {
  // logic-sweep regression (liveness.ts runReconciliationSweep): onReingest returns a COUNT that can be less
  // than events.length. Pre-fix the watermark advanced unconditionally to newPosition, permanently skipping
  // the un-ingested events on every later sweep — a silent knowledge loss on the liveness spine.
  const store = new InMemoryTriggerStore();
  await store.setWatermark('slack', 'C1', 'ts-100', NOW);
  const report = await runReconciliationSweep(store, {
    connector: 'slack',
    channel: 'C1',
    read: async () => ({ events: [{ ts: 'ts-101' }, { ts: 'ts-102' }, { ts: 'ts-103' }], newPosition: 'ts-103' }),
    onReingest: async () => 1, // only 1 of 3 re-ingested (partial) — 2 events would be lost by advancing
    fullSync: false,
    now: NOW,
  });
  assert.equal(report.gapDetected, true);
  assert.equal(report.reconciled, 1);
  assert.equal(report.sweepFailed, true, 'a re-ingest shortfall must surface as a failed sweep (fail-loud, #3)');
  // The watermark MUST stay at ts-100 so the next sweep re-reads the full gap and the 2 un-ingested events
  // are not permanently skipped (#1). Pre-fix it jumped to ts-103.
  assert.equal((await store.getWatermark('slack', 'C1'))!.position, 'ts-100', 'a partial re-ingest must NOT advance the watermark');
  // And the shortfall is loudly logged, not silent.
  const row = store.events.find((r) => r.event_type === 'reconcile_sweep_failed');
  assert.ok(row && /shortfall|1 of 3|partial/i.test(row.summary), 'the re-ingest shortfall must be logged loudly');
});

test('AC-3.TRIG.006.2 — approaching the 95%/60min threshold flags degraded (not silent)', async () => {
  const store = new InMemoryTriggerStore();
  const sample: DeliverySample = { connector: 'slack', successRate: SLACK_SUCCESS_RATE_DEGRADED_FLOOR - 0.01, updatedAt: NOW };
  store.seedDeliverySample(sample);
  await store.setWatermark('slack', 'C1', 'ts-0', NOW);
  const report = await runReconciliationSweep(store, {
    connector: 'slack',
    channel: 'C1',
    read: async () => ({ events: [], newPosition: 'ts-0' }),
    onReingest: async () => 0,
    fullSync: false,
    now: NOW,
  });
  assert.equal(report.deliveryDegraded, true);
  assert.ok(store.events.some((r) => r.event_type === 'delivery_degraded'));
});

test('AC-3.TRIG.006.3 — a Gmail history.list 404 triggers a full-sync from the last good watermark', async () => {
  const store = new InMemoryTriggerStore();
  await store.setWatermark('google', 'default', 'hist-500', NOW);
  let sawFullSync = false;
  const report = await runReconciliationSweep(store, {
    connector: 'google',
    channel: 'default',
    read: async ({ fullSync, sincePosition }) => {
      sawFullSync = fullSync;
      assert.equal(sincePosition, null); // full-sync reads from scratch, not the (stale) watermark
      return { events: [{ id: 'm1' }], newPosition: 'hist-999' };
    },
    onReingest: async (e) => e.length,
    fullSync: true, // the caller sets this on the 404/410 path
    now: NOW,
  });
  assert.equal(sawFullSync, true);
  assert.equal(report.reconciled, 1);
  assert.equal((await store.getWatermark('google', 'default'))!.position, 'hist-999');
});

test('AC-3.TRIG.006 edge — a sweep that itself cannot run is alerted, the gap NOT assumed empty', async () => {
  const store = new InMemoryTriggerStore();
  await store.setWatermark('slack', 'C1', 'ts-0', NOW);
  const report = await runReconciliationSweep(store, {
    connector: 'slack',
    channel: 'C1',
    read: async () => { throw new Error('history API unreachable'); },
    onReingest: async () => 0,
    fullSync: false,
    now: NOW,
  });
  assert.equal(report.sweepFailed, true);
  const row = store.events.find((r) => r.event_type === 'reconcile_sweep_failed');
  assert.ok(row && /NOT assumed empty/.test(row.summary));
});

// ── cross-cutting reference-model / anti-drift assertions ──────────────────────────────────────────
test('event_log rejects an empty summary (mirrors the DDL NOT-NULL/never-empty CHECK)', async () => {
  const store = new InMemoryTriggerStore();
  await assert.rejects(
    () => store.logEvent({ task_id: null, event_type: 'trigger_inbound', entity_ids: [], summary: '  ', payload: null }, NOW),
    /summary must be non-empty/,
  );
});

test('event_log rejects a non-trigger event_type (mirrors the live ::event_type cast raising)', async () => {
  const store = new InMemoryTriggerStore();
  await assert.rejects(
    // @ts-expect-error — a value outside the trigger set is a compile error AND a runtime reject.
    () => store.logEvent({ task_id: null, event_type: 'not_a_real_type', entity_ids: [], summary: 'x', payload: null }, NOW),
    /not a trigger-slice value/,
  );
});

test('ruleMatches — zero-condition rule is an unconditional trigger (fires on the event name alone)', () => {
  const eNorm = { connector: 'ghl' as const, eventName: 'ContactCreate', rawEventId: 'x', fields: {}, boundary_tagged: true as const };
  assert.equal(ruleMatches({ id: 'r', connector: 'ghl', eventName: 'ContactCreate', conditions: [], taskName: 't', enabled: true }, eNorm), true);
});
