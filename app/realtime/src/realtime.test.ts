// ISSUE-076 — one test per AC in §4 Definition of done. Proved against the InMemoryRealtimeConfig +
// ConnectionManager reference model (offline; no DB, no WebSocket). The two seed/config reads the live
// adapter adds are authored in supabase-store.ts and exercised by the operator at integration; every
// invariant BELOW is client-side state the fake enforces exactly as the running client must.
//
// AC map:
//   AC-7.RTP.001.1   — a new awaiting_approval task reaches the approval queue live (via the subscription, no poll)
//   AC-7.RTP.001.2   — a new critical notification reaches the notification centre live (via the subscription)
//   AC-7.RTP.001.3   — no surface outside the two opens a Realtime subscription by default (a third is rejected)
//   AC-7.RTP.002.1   — each polled surface's interval is read from config; the documented default applies when unset
//   AC-7.RTP.002.2   — changing a poll interval in config takes effect with no code change
//   AC-7.RTP.003.1   — beyond the budget a new tab still receives updates via polling (never a silent freeze)
//   AC-7.RTP.003.2   — a configurable headroom threshold degrades BEFORE the cap; the degrade emits a health signal
//   AC-7.RTP.003.3   — the Realtime filter does not depend on client_slug (reconciliation #1)
//   AC-7.RTP.004.1   — on unmount the subscription AND poller are torn down (no leaked budget)
//   AC-7.RTP.004.2   — a dropped subscription reconnects or falls back to polling; the indicator is honest
//   AC-NFR-OBS.014.1 — only the approval queue + notification centre use Realtime; everything else polls
//   AC-NFR-PERF.011.1 — degrade shows an honest Polling/Reconnecting indicator, never a silent freeze reading as Live
//   AC-NFR-PERF.011.2 — under budget pressure the two trust-critical surfaces are the LAST to lose Realtime

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ConnectionManager,
  InMemoryRealtimeConfig,
  effectivePollSeconds,
  effectiveThresholdPercent,
  realtimeFilterFor,
  ERR_THIRD_REALTIME,
  SURFACE_CATALOGUE,
  REALTIME_SURFACES,
  type SurfaceId,
} from './index.ts';

const T0 = 1_700_000_000;

// A tiny delivery model: a Realtime subscription DELIVERS a matching new row immediately (live, no poll),
// whereas a polled surface would only see it on its next tick. We model "did the live path deliver it?" by
// asking the ConnectionManager whether the surface holds a live subscription whose filter matches the row.
function liveDelivers(mgr: ConnectionManager, handle: number, row: { table: string; status?: string }): boolean {
  if (!mgr.isRealtime(handle)) return false; // polling — would NOT be immediate/live
  const f = mgr.filter(handle);
  if (!f || f.table !== row.table) return false;
  if (f.predicate) return row.status === f.predicate.eq;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-7.RTP.001.1 — a new awaiting_approval task appears in the approval queue live (no manual refresh)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-7.RTP.001.1 — approval queue receives a new awaiting_approval task via its live subscription', () => {
  const cfg = new InMemoryRealtimeConfig();
  const mgr = new ConnectionManager(cfg, 200);
  const h = mgr.mount('approval_queue', T0);

  assert.equal(mgr.mode(h), 'live', 'approval queue must be live on mount within budget');
  // a NEW awaiting_approval row is delivered by the live subscription (not awaiting a poll tick)
  assert.equal(liveDelivers(mgr, h, { table: 'task_queue', status: 'awaiting_approval' }), true);
  // TEETH: a row in a DIFFERENT state is NOT matched by the awaiting_approval filter (the filter is real)
  assert.equal(liveDelivers(mgr, h, { table: 'task_queue', status: 'running' }), false);
  // TEETH: a notifications row is not delivered on the approval-queue subscription (wrong table)
  assert.equal(liveDelivers(mgr, h, { table: 'notifications' }), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-7.RTP.001.2 — a new critical notification appears in the notification centre live
// ─────────────────────────────────────────────────────────────────────────────
test('AC-7.RTP.001.2 — notification centre receives a new notification via its live subscription', () => {
  const cfg = new InMemoryRealtimeConfig();
  const mgr = new ConnectionManager(cfg, 200);
  const h = mgr.mount('notification_centre', T0);

  assert.equal(mgr.mode(h), 'live');
  assert.equal(liveDelivers(mgr, h, { table: 'notifications' }), true);
  // TEETH: the notification-centre subscription is NOT a task_queue subscription
  assert.equal(liveDelivers(mgr, h, { table: 'task_queue', status: 'awaiting_approval' }), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-7.RTP.001.3 — no surface outside those two holds an open Realtime subscription by default
// ─────────────────────────────────────────────────────────────────────────────
test('AC-7.RTP.001.3 — a polled surface never opens a Realtime subscription; a third Realtime surface is impossible', () => {
  const cfg = new InMemoryRealtimeConfig();
  const mgr = new ConnectionManager(cfg, 200);

  // Every polled surface mounts to polling and holds NO Realtime subscription (takes no budget).
  const polled = SURFACE_CATALOGUE.filter((s) => s.transport === 'poll').map((s) => s.id);
  assert.ok(polled.length >= 6, 'there must be the six polled surfaces');
  for (const id of polled) {
    const h = mgr.mount(id, T0);
    assert.equal(mgr.isRealtime(h), false, `${id} must NOT hold a Realtime subscription`);
    assert.equal(mgr.mode(h), 'polling', `${id} must be polling`);
  }
  // Budget is untouched by the six polled surfaces (only Realtime subscriptions count).
  assert.equal(mgr.activeRealtime(), 0, 'no polled surface may consume a Realtime slot');

  // TEETH: the catalogue itself enumerates exactly the two Realtime surfaces.
  assert.deepEqual(
    SURFACE_CATALOGUE.filter((s) => s.transport === 'realtime').map((s) => s.id).sort(),
    [...REALTIME_SURFACES].sort(),
  );
  // TEETH: realtimeFilterFor a non-Realtime surface throws (the transport is not openable for a third).
  assert.throws(() => realtimeFilterFor('health_metrics' as SurfaceId), /third Realtime|only approval_queue/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-7.RTP.002.1 — each polled surface's interval is read from config; documented default applies when unset
// ─────────────────────────────────────────────────────────────────────────────
test('AC-7.RTP.002.1 — poll interval comes from config, with the documented default when unset', () => {
  const cfg = new InMemoryRealtimeConfig();

  // Unset → documented defaults (health 30 / event_log 60 / memory 300 / self-imp 600 / cost 300 / agent 60).
  assert.equal(effectivePollSeconds('health_metrics', cfg), 30);
  assert.equal(effectivePollSeconds('event_log', cfg), 60);
  assert.equal(effectivePollSeconds('memory_health', cfg), 300);
  assert.equal(effectivePollSeconds('self_improvement', cfg), 600);
  assert.equal(effectivePollSeconds('cost_tracking', cfg), 300);
  assert.equal(effectivePollSeconds('agent_health', cfg), 60);

  // Set the key → the config value is used, not the default.
  cfg.setPollInterval('health_metrics', 15);
  assert.equal(effectivePollSeconds('health_metrics', cfg), 15);

  // TEETH: a Realtime surface has no poll cadence (asking for one throws — it is not a polled surface).
  assert.throws(() => effectivePollSeconds('approval_queue', cfg), /not a polled surface/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-7.RTP.002.2 — changing a poll interval in config takes effect with no code change
// ─────────────────────────────────────────────────────────────────────────────
test('AC-7.RTP.002.2 — a config edit changes the effective cadence with no code change', () => {
  const cfg = new InMemoryRealtimeConfig();
  const mgr = new ConnectionManager(cfg, 200);

  assert.equal(mgr.pollSeconds('cost_tracking'), 300); // default
  cfg.setPollInterval('cost_tracking', 120); // a LIVE config edit — same code
  assert.equal(mgr.pollSeconds('cost_tracking'), 120, 'the edit must take effect immediately, no rebuild');
  // TEETH: clearing the key falls back to the documented default (never to 0 / never "poll never").
  cfg.setPollInterval('cost_tracking', undefined);
  assert.equal(mgr.pollSeconds('cost_tracking'), 300);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-7.RTP.002.1 (guard) — a non-positive / non-integer config cadence is REJECTED at the resolver, not
// returned verbatim as an effective cadence. A cadence of 0/negative is a busy-loop-or-freeze (#3: never a
// silent freeze) — the resolver range-checks its config input exactly as effectiveThresholdPercent does.
// ─────────────────────────────────────────────────────────────────────────────
test('AC-7.RTP.002.1 (guard) — a non-positive or non-integer poll cadence from config is rejected, never returned verbatim', () => {
  const cfg = new InMemoryRealtimeConfig();

  // A config_values row (or an operator edit) of 0 must NOT become the effective cadence — 0 is a silent
  // freeze / busy loop, exactly the #3 the contract forbids.
  cfg.setPollInterval('cost_tracking', 0);
  assert.throws(() => effectivePollSeconds('cost_tracking', cfg), /positive|cadence/);

  // Negative is likewise rejected.
  cfg.setPollInterval('cost_tracking', -5);
  assert.throws(() => effectivePollSeconds('cost_tracking', cfg), /positive|cadence/);

  // A non-integer (fractional) cadence is rejected too (a cadence is whole seconds, like the threshold guard).
  cfg.setPollInterval('cost_tracking', 30.5);
  assert.throws(() => effectivePollSeconds('cost_tracking', cfg), /integer|positive|cadence/);

  // A valid positive integer still resolves fine (the guard does not reject legitimate edits).
  cfg.setPollInterval('cost_tracking', 45);
  assert.equal(effectivePollSeconds('cost_tracking', cfg), 45);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-7.RTP.003.1 — beyond the budget a new tab still receives updates via polling (never a silent freeze)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-7.RTP.003.1 — past the budget a new subscription degrades to polling (still updating), not a silent freeze', () => {
  const cfg = new InMemoryRealtimeConfig();
  cfg.setHeadroomThreshold(100); // put the degrade point AT the cap so we can fill it exactly with a small cap
  const mgr = new ConnectionManager(cfg, 2); // tiny per-silo cap of 2 for a deterministic test

  // Fill the two live slots with the two trust-critical surfaces.
  const a = mgr.mount('approval_queue', T0);
  const b = mgr.mount('notification_centre', T0);
  assert.equal(mgr.mode(a), 'live');
  assert.equal(mgr.mode(b), 'live');
  assert.equal(mgr.activeRealtime(), 2);

  // A THIRD Realtime-capable mount (another approval-queue tab) has no budget → degrades to polling. It is
  // NOT frozen: it holds a poller and reports 'polling' honestly.
  const c = mgr.mount('approval_queue', T0 + 1);
  assert.equal(mgr.isRealtime(c), false, 'no budget → no Realtime slot');
  assert.equal(mgr.mode(c), 'polling', 'a degraded tab keeps updating via polling — never a silent freeze');
  // TEETH: the degrade produced a health signal (never silent).
  assert.equal(mgr.healthSignals.length, 1);
  assert.equal(mgr.healthSignals[0]?.surface, 'approval_queue');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-7.RTP.003.2 — a configurable headroom threshold degrades BEFORE the cap; surfaced as a health signal
// ─────────────────────────────────────────────────────────────────────────────
test('AC-7.RTP.003.2 — degrade fires at the configurable headroom threshold, BEFORE the cap, and is surfaced', () => {
  const cfg = new InMemoryRealtimeConfig();
  cfg.setHeadroomThreshold(80); // default 80%
  const mgr = new ConnectionManager(cfg, 10); // cap 10 → degrade point floor(0.8*10)=8

  assert.equal(effectiveThresholdPercent(cfg), 80);
  assert.equal(mgr.degradeAt(), 8, 'degrade must trigger at 8, BEFORE the hard cap of 10');
  assert.ok(mgr.degradeAt() < mgr.cap, 'the degrade point must be strictly before the cap');

  // OBSERVE A REAL DEGRADE BELOW THE CAP (not just the arithmetic). Mount live Realtime subscriptions up to
  // the headroom threshold (8 of a cap of 10), then mount one MORE. The reserved-headroom band [8,10) is
  // admitted to trust-critical surfaces ONLY; a general (non-trust-critical) Realtime surface arriving at 8
  // live connections must DEGRADE to polling — strictly BELOW the hard cap of 10. This is the posture the FR
  // demands and the exact branch the old `trustCritical ? cap : …` shortcut left dead (both catalogued
  // surfaces are trust-critical, so degradeAt() never governed and the first degrade only came AT the cap).
  const handles: number[] = [];
  for (let i = 0; i < 8; i++) {
    // fill the OPEN band [0,8) with trust-critical live subscriptions (alternating the two named surfaces)
    const surface = i % 2 === 0 ? 'approval_queue' : 'notification_centre';
    const h = mgr.mount(surface, T0 + i);
    assert.equal(mgr.mode(h), 'live', `subscription ${i} must be live below the headroom threshold`);
    handles.push(h);
  }
  assert.equal(mgr.activeRealtime(), 8, 'eight live Realtime connections — exactly at the headroom threshold');
  assert.ok(mgr.activeRealtime() < mgr.cap, 'still strictly below the hard cap — no cap pressure yet');
  const signalsBefore = mgr.healthSignals.length;
  assert.equal(signalsBefore, 0, 'no degrade has fired yet (all admitted within the open band)');

  // A general (non-trust-critical) Realtime surface arriving now must degrade — BELOW the cap of 10.
  const general = mgr.mount('approval_queue', T0 + 100, /* trustCriticalOverride */ false);
  assert.equal(mgr.isRealtime(general), false, 'a non-trust-critical subscription past the headroom degrades');
  assert.equal(mgr.mode(general), 'polling', 'the degrade is to polling — still updating, never a silent freeze');
  assert.ok(mgr.activeRealtime() < mgr.cap, 'the degrade fired strictly BELOW the hard cap (headroom-governed)');

  // …and it was SURFACED — the health signal names the degrade, its live count (8), the cap, and threshold.
  assert.equal(mgr.healthSignals.length, signalsBefore + 1, 'the degrade emits exactly one health signal');
  const sig = mgr.healthSignals[mgr.healthSignals.length - 1];
  assert.equal(sig?.kind, 'realtime-degraded-to-polling');
  assert.equal(sig?.activeRealtime, 8, 'the signal reports the live count at the degrade — 8, below the cap of 10');
  assert.equal(sig?.cap, 10);
  assert.equal(sig?.thresholdPercent, 80);
  assert.ok((sig?.activeRealtime ?? 0) < (sig?.cap ?? 0), 'the surfaced degrade happened before the cap');

  // TEETH — the threshold is CONFIGURABLE and moves the degrade point (no code change). A fresh manager at
  // 50% degrades a general subscription once 5 (not 8) live connections are held.
  const cfg50 = new InMemoryRealtimeConfig();
  cfg50.setHeadroomThreshold(50);
  const mgr50 = new ConnectionManager(cfg50, 10);
  assert.equal(mgr50.degradeAt(), 5, 'a config change moves the degrade point (configurable threshold)');
  for (let i = 0; i < 5; i++) mgr50.mount(i % 2 === 0 ? 'approval_queue' : 'notification_centre', T0 + i);
  assert.equal(mgr50.activeRealtime(), 5);
  const g50 = mgr50.mount('approval_queue', T0 + 200, false);
  assert.equal(mgr50.mode(g50), 'polling', 'at a 50% threshold the general degrade fires at 5, not 8');
  assert.ok(mgr50.activeRealtime() < mgr50.cap);

  // TEETH: an out-of-range threshold is rejected (never silently clamped to a wrong budget).
  cfg.setHeadroomThreshold(0);
  assert.throws(() => effectiveThresholdPercent(cfg), /1–100/);
  cfg.setHeadroomThreshold(101);
  assert.throws(() => effectiveThresholdPercent(cfg), /1–100/);
  // Unset → default 80.
  cfg.setHeadroomThreshold(undefined);
  assert.equal(effectiveThresholdPercent(cfg), 80);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-7.RTP.003.3 — the Realtime filter does not depend on client_slug (reconciliation #1)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-7.RTP.003.3 — neither Realtime filter references client_slug', () => {
  for (const id of REALTIME_SURFACES) {
    const f = realtimeFilterFor(id);
    // the filter object has no client_slug field at all
    assert.equal(Object.prototype.hasOwnProperty.call(f, 'client_slug'), false);
    if (f.predicate) {
      assert.notEqual(f.predicate.column, 'client_slug', `${id} filter must not predicate on client_slug`);
    }
  }
  // TEETH: the approval-queue predicate is the intra-silo status filter (a real, non-client filter exists).
  assert.deepEqual(realtimeFilterFor('approval_queue').predicate, { column: 'status', eq: 'awaiting_approval' });
  // TEETH: the notification-centre subscription has NO predicate (whole table), and no client_slug.
  assert.equal(realtimeFilterFor('notification_centre').predicate, undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-7.RTP.004.1 — on unmount the subscription AND poller are torn down (no leaked budget)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-7.RTP.004.1 — unmount tears down the subscription and poller; no leaked connection', () => {
  const cfg = new InMemoryRealtimeConfig();
  const mgr = new ConnectionManager(cfg, 200);

  const h = mgr.mount('approval_queue', T0);
  assert.equal(mgr.activeRealtime(), 1);
  assert.equal(mgr.mountedCount(), 1);

  mgr.unmount(h);
  assert.equal(mgr.activeRealtime(), 0, 'the Realtime slot must be returned to the budget on unmount');
  assert.equal(mgr.mountedCount(), 0, 'no leaked mount (subscription + poller both gone)');
  // TEETH: reading the mode of an unmounted handle throws (there is no lingering "live" state).
  assert.throws(() => mgr.mode(h), /no mounted surface/);

  // TEETH: a freed slot is reusable — mount another Realtime surface into the reclaimed budget.
  const h2 = mgr.mount('notification_centre', T0 + 1);
  assert.equal(mgr.mode(h2), 'live');
  assert.equal(mgr.activeRealtime(), 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-7.RTP.004.2 — a dropped subscription reconnects or falls back to polling; the indicator is honest
// ─────────────────────────────────────────────────────────────────────────────
test('AC-7.RTP.004.2 — a dropped socket shows reconnecting, then reconnects (budget free) or polls (budget full)', () => {
  const cfg = new InMemoryRealtimeConfig();

  // Case A — budget is free: reconnect returns to live.
  {
    const mgr = new ConnectionManager(cfg, 200);
    const h = mgr.mount('approval_queue', T0);
    assert.equal(mgr.dropSocket(h, T0 + 1), 'reconnecting', 'a dropped socket must NOT read as live (honest)');
    assert.equal(mgr.activeRealtime(), 0, 'the dropped socket frees its slot');
    assert.equal(mgr.reconnect(h, T0 + 2), 'live', 'with budget free the subscription reconnects to live');
    assert.equal(mgr.activeRealtime(), 1);
  }

  // Case B — budget full after the drop: reconnect falls back to polling (never a silent stale-live).
  {
    cfg.setHeadroomThreshold(100);
    const mgr = new ConnectionManager(cfg, 1); // one live slot
    const keep = mgr.mount('notification_centre', T0); // occupies the only slot
    const h = mgr.mount('approval_queue', T0); // no budget → starts degraded (polling)
    assert.equal(mgr.mode(h), 'polling');
    // simulate the polling surface's socket path failing to upgrade — reconnect must stay honest: polling.
    assert.equal(mgr.reconnect(h, T0 + 1), 'polling', 'no budget → falls back to polling, never false-live');
    // TEETH: the surface still updates (poller) and never claims live while the budget is full.
    assert.notEqual(mgr.mode(h), 'live');
    assert.equal(mgr.isRealtime(keep), true);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-NFR-OBS.014.1 — only the approval queue + notification centre use Realtime; everything else polls
// ─────────────────────────────────────────────────────────────────────────────
test('AC-NFR-OBS.014.1 — exactly the two named surfaces are Realtime; every other surface polls', () => {
  const realtime = SURFACE_CATALOGUE.filter((s) => s.transport === 'realtime').map((s) => s.id);
  assert.equal(realtime.length, 2, 'exactly two Realtime surfaces');
  assert.deepEqual(realtime.sort(), ['approval_queue', 'notification_centre']);

  const cfg = new InMemoryRealtimeConfig();
  const mgr = new ConnectionManager(cfg, 200);
  // Attempting to open a Realtime path for anything other than the two named surfaces is rejected at the
  // engine (defence in depth beyond the catalogue) — realtimeFilterFor throws for a third surface.
  assert.throws(() => realtimeFilterFor('agent_health' as SurfaceId), new RegExp(ERR_THIRD_REALTIME.slice(0, 20)));
  // Every polled surface mounts to polling, holding no Realtime slot.
  for (const s of SURFACE_CATALOGUE.filter((x) => x.transport === 'poll')) {
    const h = mgr.mount(s.id, T0);
    assert.equal(mgr.isRealtime(h), false);
  }
  assert.equal(mgr.activeRealtime(), 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-NFR-PERF.011.1 — degrade shows an honest Polling/Reconnecting indicator, never a silent freeze as Live
// ─────────────────────────────────────────────────────────────────────────────
test('AC-NFR-PERF.011.1 — a degraded surface reports Polling/Reconnecting honestly, never a stale Live', () => {
  const cfg = new InMemoryRealtimeConfig();
  cfg.setHeadroomThreshold(100);
  const mgr = new ConnectionManager(cfg, 1);

  const keep = mgr.mount('notification_centre', T0); // fills the single slot, live
  assert.equal(mgr.mode(keep), 'live');

  const degraded = mgr.mount('approval_queue', T0 + 1); // no budget → degraded
  // The honest indicator is 'polling' — NOT 'live'. A silent freeze reading as Live is the exact failure
  // this AC forbids; assert it can never occur for the degraded surface.
  assert.equal(mgr.mode(degraded), 'polling');
  assert.notEqual(mgr.mode(degraded), 'live');
  assert.equal(mgr.isRealtime(degraded), false);
  // The degrade is surfaced as a health signal — never hidden.
  assert.ok(mgr.healthSignals.some((s) => s.surface === 'approval_queue'));

  // A dropped live socket is honestly 'reconnecting' — also never a stale 'live'.
  assert.equal(mgr.dropSocket(keep, T0 + 2), 'reconnecting');
  assert.notEqual(mgr.mode(keep), 'live');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-NFR-PERF.011.2 — under budget pressure the two trust-critical surfaces are the LAST to lose Realtime
// ─────────────────────────────────────────────────────────────────────────────
test('AC-NFR-PERF.011.2 — the two trust-critical surfaces are prioritised (last to degrade)', () => {
  const cfg = new InMemoryRealtimeConfig();
  // Threshold 50% of a cap of 4 → degradeAt = 2. A non-trust-critical Realtime surface would degrade once
  // 2 slots are live; the trust-critical surfaces may use the FULL cap of 4 — they degrade last.
  cfg.setHeadroomThreshold(50);
  const mgr = new ConnectionManager(cfg, 4);
  assert.equal(mgr.degradeAt(), 2);

  // The two trust-critical surfaces both go live even though 2 ≥ degradeAt — because their limit is the cap
  // (4), not the headroom threshold (2). They are prioritised.
  const a = mgr.mount('approval_queue', T0);
  const b = mgr.mount('notification_centre', T0);
  const a2 = mgr.mount('approval_queue', T0); // a 3rd trust-critical slot — still under the cap of 4 → live
  assert.equal(mgr.mode(a), 'live');
  assert.equal(mgr.mode(b), 'live');
  assert.equal(mgr.mode(a2), 'live', 'trust-critical surfaces use the full cap, not the headroom threshold');
  assert.equal(mgr.activeRealtime(), 3);

  // TEETH — verify the priority is REAL by OBSERVED CONTRAST, not arithmetic. At exactly `degradeAt()` live
  // connections (2, in the reserved-headroom band [2,4)), a NON-trust-critical Realtime surface DEGRADES to
  // polling, while a trust-critical one at the identical live count goes LIVE. Same pressure, opposite
  // outcome — the trust-critical surface is the last to lose Realtime (AC-NFR-PERF.011.2).
  {
    const mgrC = new ConnectionManager(cfg, 4); // same threshold(50%) → degradeAt=2
    mgrC.mount('approval_queue', T0);
    mgrC.mount('notification_centre', T0); // 2 live — at the headroom threshold, in the reserved band
    assert.equal(mgrC.activeRealtime(), 2);
    const general = mgrC.mount('approval_queue', T0, /* trustCriticalOverride */ false);
    assert.equal(mgrC.mode(general), 'polling', 'a non-trust-critical surface degrades in the reserved headroom band');
    const critical = mgrC.mount('approval_queue', T0); // trust-critical, same live count → still admitted
    assert.equal(mgrC.mode(critical), 'live', 'a trust-critical surface keeps its priority for the reserved headroom');
  }

  // Fill to the hard cap; only THEN does even a trust-critical surface fall back (last to degrade, not never).
  const a3 = mgr.mount('notification_centre', T0); // 4th slot → live (cap reached)
  assert.equal(mgr.mode(a3), 'live');
  assert.equal(mgr.activeRealtime(), 4);
  const a4 = mgr.mount('approval_queue', T0); // cap full → even trust-critical must degrade now
  assert.equal(mgr.mode(a4), 'polling', 'at the hard cap even a trust-critical surface degrades — but it was LAST');
});
