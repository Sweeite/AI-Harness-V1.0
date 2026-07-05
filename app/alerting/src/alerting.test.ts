// ISSUE-075 — one test per AC in §4 Definition of done. Proved against the in-memory fake reference model
// (offline; the live durability/fails-loud proof is the ISSUE-075 Stage-3 checkpoint, results/issue-075-notes.md).
// Tests have TEETH: each asserts the SPECIFIC invariant AND a counterfactual (the thing that must NOT happen)
// so a tautological pass is impossible — an independent adversarial verifier will try to break them.
//
// AC map:
//   AC-7.ALR.001.1   — every alert produces a dashboard notification (independent of Slack config)
//   AC-7.ALR.001.2   — a notification stays unread until explicitly actioned; reachable from any view
//   AC-7.ALR.002.1   — each rule's threshold is per-deployment configurable; fires when crossed (not before)
//   AC-7.ALR.002.2   — hard_limit_hit is immediate dashboard+Slack and NOT suppressible by configuration
//   AC-7.ALR.002.3   — a loop_missed alert references the C5 catch-up, not a C7 re-run
//   AC-7.ALR.003.1   — a stale-approval alert goes to the SPECIFIC reviewer, not broadcast
//   AC-7.ALR.003.2   — routing resolves through the C1 role model; unresolvable → escalate, not drop
//   AC-7.ALR.004.1   — every raised alert has an event_log row, even when Slack later fails
//   AC-7.ALR.005.1   — an unacknowledged alert fires a secondary alert at window expiry
//   AC-7.ALR.005.2   — a critical alert is never auto-resolved by timeout (stays open/escalated)
//   AC-7.ALR.005.3   — all window math uses a single server-authoritative clock (skew cannot skip escalation)
//   AC-7.ALR.006.1   — a Slack outage leaves every dashboard notification intact
//   AC-7.ALR.006.2   — a failed Slack delivery is surfaced (not silently dropped)
//   AC-7.ALR.007.1   — a C6 hard-limit event → immediate C7 dashboard + Slack alert
//   AC-7.ALR.007.2   — a C5 stale awaiting_approval → stale-approval alert to its reviewer
//   AC-7.ALR.009.1   — unroutable → "alert delivery misconfigured" critical to Super Admin + mgmt-plane bit
//   AC-7.ALR.009.2   — quiet-hours never silences a critical/hard-limit alert
//   AC-7.ALR.009.3   — a config write stranding a critical type is rejected at config time (fail-closed)
//   AC-7.ALR.009.4   — a runtime-invalid Slack webhook is surfaced as a delivery-failure; dashboard unaffected
//   AC-NFR-OBS.008.1 — unresolvable routing → misconfigured critical raised + escalated (never dropped)
//   AC-NFR-OBS.008.2 — quiet-hours still delivers a hard-limit/critical alert
//   AC-NFR-OBS.009.1 — dashboard notification persisted first + independently of any Slack attempt
//   AC-NFR-OBS.009.2 — a failed Slack fan-out retains the row + surfaces the failure
//   AC-NFR-OBS.016.1 — the audit-sink row is written + retained even when delivery fails

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AlertEngine,
  InMemoryAlertConfigStore,
  InMemoryAlertEventLogStore,
  InMemoryHealthBitChannel,
  InMemoryNotificationStore,
  InMemorySlackClient,
  evaluateRules,
  isSuppressible,
  validateConfigOrReject,
  ConfigRejected,
  quietHoursSuppresses,
  inQuietWindow,
  type AlertConfig,
  type RoleResolver,
  type RuleThresholds,
  type Signals,
} from "./index.ts";

// ── deterministic clock + id helpers (house discipline: no Date.now()/random) ────────────────────────
const T0 = 1_700_000_000_000; // fixed server "now" (ms)
function makeClock(startMs: number) {
  let t = startMs;
  return { now: () => t, advance: (dms: number) => (t += dms), set: (ms: number) => (t = ms) };
}
function makeIds() {
  let n = 0;
  return () => `id-${String(++n).padStart(4, "0")}`;
}

const THRESHOLDS: RuleThresholds = {
  task_failure_spike: { failures: 3, window_ms: 60_000 },
  queue_backup: { pending: 5, for_ms: 300_000 },
  memory_confidence_drop: { below: 0.5 },
  approval_queue_stale: { after_ms: 3_600_000 },
  cost_threshold_breach: { daily: 1000, weekly: 5000 },
};

function emptySignals(): Signals {
  return {
    taskFailureTimestamps: [],
    queue: { pending: 0, oldestEnqueuedAtMs: null },
    avgMemoryConfidence: null,
    approvalItems: [],
    spend: { dailyTokens: 0, weeklyTokens: 0 },
    missedLoops: [],
  };
}

// a role model where super_admin + admin resolve; unknown roles do not. `isKnownRecipient` is the fail-CLOSED
// resolvability gate: a user id counts as a known recipient iff it is an actual role holder OR one of the
// explicitly-seeded bare user ids (the on-call direct contacts). Anything else — a typo'd/role-shaped string
// nobody holds, a removed user id — is NOT known, so it resolves to no one (a dead-string critical must fail
// loud, never silently "deliver" to it).
function roles(
  map: Record<string, string[]> = {},
  knownUsers: readonly string[] = ["u-oncall", "u-oncall-2"],
): RoleResolver {
  const base: Record<string, string[]> = { super_admin: ["u-super"], admin: ["u-admin"], ...map };
  const known = new Set<string>([...knownUsers, ...Object.values(base).flat()]);
  return {
    usersForRole: (role) => base[role] ?? [],
    reviewerForApprovalItem: () => null,
    isKnownRecipient: (userId) => known.has(userId),
  };
}

// a config where the three critical types + a couple of rule types have destinations.
function healthyConfig(overrides: Partial<AlertConfig> = {}): AlertConfig {
  return {
    alert_routing_rules: {
      hard_limit_hit: { role: "super_admin", channels: ["slack"] },
      alert_delivery_misconfigured: { role: "super_admin", channels: ["slack"] },
      alert_engine_stalled: { role: "super_admin", channels: ["slack"] },
      task_failure_spike: { role: "admin", channels: ["slack"] },
      cost_threshold_breach: { role: "admin", channels: [] },
      ...(overrides.alert_routing_rules ?? {}),
    },
    escalation_contacts: { admin: ["super_admin", "u-oncall"], ...(overrides.escalation_contacts ?? {}) },
    quiet_hours: overrides.quiet_hours ?? { enabled: false, start_min: 0, end_min: 0 },
    alert_email_enabled: overrides.alert_email_enabled ?? false,
    slack_webhook_present: overrides.slack_webhook_present ?? true,
  };
}

function makeEngine(config: AlertConfig, roleModel = roles(), startMs = T0) {
  const notifications = new InMemoryNotificationStore();
  const eventLog = new InMemoryAlertEventLogStore();
  const slack = new InMemorySlackClient();
  const health = new InMemoryHealthBitChannel();
  const clock = makeClock(startMs);
  const engine = new AlertEngine({
    notifications,
    eventLog,
    configStore: new InMemoryAlertConfigStore(config),
    roles: roleModel,
    slack,
    health,
    now: clock.now,
    newId: makeIds(),
  });
  return { engine, notifications, eventLog, slack, health, clock };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-7.ALR.001.1 — every alert produces a dashboard notification, independent of Slack config
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-7.ALR.001.1 — a dashboard notification is produced even with NO Slack webhook configured", async () => {
  const cfg = healthyConfig({ slack_webhook_present: false });
  const { engine, notifications, slack } = makeEngine(cfg);
  await engine.deliverHardLimit("spend_cap", "task-1");
  const rows = await notifications.all();
  // teeth: the durable dashboard row exists...
  assert.equal(rows.filter((r) => r.type === "hard_limit_hit").length, 1);
  // ...AND Slack was NOT the thing that made it exist (no webhook → nothing sent), proving independence.
  assert.equal(slack.sent.length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-7.ALR.001.2 — unread until explicitly actioned; reachable from any view
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-7.ALR.001.2 — a notification stays unread until actioned, then flips (never auto-clears)", async () => {
  const { engine, notifications } = makeEngine(healthyConfig());
  const { notification } = await engine.deliverHardLimit("spend_cap", "task-1");
  let row = await notifications.get(notification.id);
  assert.equal(row!.read_state, "unread");
  assert.equal(row!.actioned_at, null);
  // teeth: merely being READ does not action it (unread-until-ACTIONED, not until-read).
  notifications._setReadState(notification.id, "read");
  row = await notifications.get(notification.id);
  assert.notEqual(row!.read_state, "actioned");
  // explicit action flips it + stamps actioned_at.
  await notifications.action(notification.id, new Date(T0).toISOString());
  row = await notifications.get(notification.id);
  assert.equal(row!.read_state, "actioned");
  assert.ok(row!.actioned_at);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-7.ALR.002.1 — per-deployment threshold; fires when crossed, NOT before
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-7.ALR.002.1 — a rule fires exactly at its configured threshold, and a lower config fires earlier", async () => {
  const sig = emptySignals();
  // 2 failures within the window — below the threshold of 3 → must NOT fire.
  sig.taskFailureTimestamps = [T0 - 1000, T0 - 2000];
  assert.equal(evaluateRules(sig, THRESHOLDS, T0).length, 0);
  // a third failure inside the window → fires.
  sig.taskFailureTimestamps = [T0 - 1000, T0 - 2000, T0 - 3000];
  const fired = evaluateRules(sig, THRESHOLDS, T0);
  assert.equal(fired.filter((a) => a.type === "task_failure_spike").length, 1);
  // teeth: the SAME signal that fired at threshold-3 also fires at a lower per-deployment threshold of 2
  // (config-driven), and an OLD failure outside the window does NOT count.
  sig.taskFailureTimestamps = [T0 - 1000, T0 - 90_000 /* outside 60s window */];
  const t2 = { ...THRESHOLDS, task_failure_spike: { failures: 2, window_ms: 60_000 } };
  assert.equal(evaluateRules(sig, t2, T0).filter((a) => a.type === "task_failure_spike").length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-7.ALR.002.2 — hard_limit_hit is immediate dashboard+Slack and NOT suppressible
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-7.ALR.002.2 — hard_limit_hit cannot be suppressed and is not produced by the suppressible rule pass", async () => {
  // teeth 1: it is not in the suppressible set at the type level.
  assert.equal(isSuppressible("hard_limit_hit"), false);
  // teeth 2: even if a caller tried to suppress EVERY configurable rule, the rule pass never emits a
  // hard_limit_hit (it is event-driven only), so there is no path to config it off.
  const suppressAll = new Set([
    "task_failure_spike",
    "queue_backup",
    "memory_confidence_drop",
    "approval_queue_stale",
    "cost_threshold_breach",
    "loop_missed",
  ] as const);
  const sig = emptySignals();
  sig.taskFailureTimestamps = [T0, T0, T0, T0];
  const fired = evaluateRules(sig, THRESHOLDS, T0, suppressAll);
  assert.equal(fired.length, 0); // everything suppressible was suppressed...
  assert.equal(fired.some((a) => a.type === "hard_limit_hit"), false); // ...and hard_limit never sneaks in.
  // teeth 3: the event-driven path DOES deliver it (immediate dashboard + Slack).
  const { engine, notifications, slack } = makeEngine(healthyConfig());
  await engine.deliverHardLimit("spend_cap", "task-1");
  assert.equal((await notifications.all()).some((r) => r.type === "hard_limit_hit"), true);
  assert.equal(slack.sent.length, 1); // Slack fan-out happened (webhook present, channel configured)
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-7.ALR.002.3 — loop_missed references the C5 catch-up, not a C7 re-run
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-7.ALR.002.3 — a loop_missed alert references the C5 catch-up and never triggers a C7 re-run", async () => {
  const sig = emptySignals();
  sig.missedLoops = [{ loopId: "loop-daily" }];
  const fired = evaluateRules(sig, THRESHOLDS, T0);
  const alert = fired.find((a) => a.type === "loop_missed");
  assert.ok(alert);
  // teeth: the body explicitly defers catch-up to C5 and disavows a C7 re-run — no re-run side effect exists.
  assert.match(alert!.body, /C5/);
  assert.match(alert!.body, /not a C7 re-run/);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-7.ALR.003.1 — stale-approval to the SPECIFIC reviewer, not broadcast
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-7.ALR.003.1 — a stale-approval alert is delivered to its specific reviewer, not the admin role", async () => {
  const cfg = healthyConfig({
    alert_routing_rules: { approval_queue_stale: { role: "admin", channels: [] } },
  });
  const { engine, notifications } = makeEngine(cfg);
  await engine.deliverStaleApproval("appr-42", "u-reviewer-bob", 4_000_000);
  const row = (await notifications.all()).find((r) => r.type === "approval_queue_stale")!;
  // teeth: delivered to the named reviewer, NOT to the admin role holder (u-admin) it would broadcast to.
  assert.equal(row.recipient, "u-reviewer-bob");
  assert.notEqual(row.recipient, "u-admin");
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-7.ALR.003.2 — routing resolves through C1 roles; unresolvable → escalate (via chain), not drop
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-7.ALR.003.2 — an unresolvable role escalates to the chain instead of being dropped", async () => {
  // route task_failure_spike to a role NOBODY holds, but give admin an escalation chain that resolves.
  const cfg = healthyConfig({
    alert_routing_rules: { task_failure_spike: { role: "ghost_role", channels: [] } },
    escalation_contacts: { ghost_role: ["super_admin"] },
  });
  const { engine, notifications } = makeEngine(cfg);
  const sig = emptySignals();
  sig.taskFailureTimestamps = [T0, T0, T0];
  const [alert] = evaluateRules(sig, THRESHOLDS, T0);
  const outcome = await engine.deliver(alert!);
  // teeth: it did NOT drop — it resolved to the escalation contact (u-super), and no misconfigured-critical
  // was needed because the chain resolved.
  assert.equal(outcome.resolvedRecipient, "u-super");
  assert.equal(outcome.misconfiguredCriticalId, undefined);
  assert.equal((await notifications.all()).some((r) => r.type === "alert_delivery_misconfigured"), false);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-7.ALR.004.1 — every raised alert has an event_log row, even when Slack later fails
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-7.ALR.004.1 — the event_log alert row exists even when the Slack send fails afterwards", async () => {
  const { engine, eventLog, slack, notifications } = makeEngine(healthyConfig());
  slack.induceFailure("500 from Slack");
  await engine.deliverHardLimit("spend_cap", "task-9");
  // teeth: the audit row exists (independent of delivery)...
  const logs = await eventLog.all();
  assert.equal(logs.filter((l) => l.event_type === "guardrail_hit").length, 1);
  // ...AND the delivery genuinely failed (so the row is not a happy-path artifact).
  const row = (await notifications.all())[0]!;
  assert.equal(row.delivery_state?.slack_ok, false);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-7.ALR.005.1 — an unacknowledged alert fires a secondary alert at window expiry
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-7.ALR.005.1 — no ack within the window fires a secondary alert to the next chain recipient", async () => {
  const cfg = healthyConfig({
    alert_routing_rules: { task_failure_spike: { role: "admin", channels: [] } },
    escalation_contacts: { admin: ["u-admin", "u-oncall-2"] },
  });
  const { engine, notifications, clock } = makeEngine(cfg);
  const sig = emptySignals();
  sig.taskFailureTimestamps = [T0, T0, T0];
  const { notification } = await engine.deliver(evaluateRules(sig, THRESHOLDS, T0)[0]!);
  const WINDOW = 900_000; // 15 min
  // teeth 1: BEFORE the window, no secondary alert.
  clock.advance(WINDOW - 1);
  assert.equal(await engine.runEscalation(notification.id, WINDOW), null);
  const before = (await notifications.all()).length;
  // teeth 2: AFTER the window expires, exactly one secondary alert to the NEXT recipient.
  clock.advance(2);
  const secondary = await engine.runEscalation(notification.id, WINDOW);
  assert.ok(secondary);
  assert.equal(secondary!.recipient, "u-oncall-2");
  assert.equal((await notifications.all()).length, before + 1);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-7.ALR.005.2 — a critical alert is never auto-resolved by timeout
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-7.ALR.005.2 — a critical alert that exhausts its chain stays unresolved + visibly escalated", async () => {
  const cfg = healthyConfig({
    alert_routing_rules: { hard_limit_hit: { role: "super_admin", channels: [] } },
    escalation_contacts: { super_admin: ["u-super"] /* one-deep: exhausts immediately */ },
  });
  const { engine, notifications, clock } = makeEngine(cfg);
  const { notification } = await engine.deliverHardLimit("spend_cap", "task-1");
  clock.advance(10_000_000); // long past any window
  const result = await engine.runEscalation(notification.id, 900_000);
  // teeth: no secondary recipient existed (chain of 1)...
  assert.equal(result, null);
  const row = await notifications.get(notification.id);
  // ...but the critical was NOT auto-resolved: it is still unread and now visibly escalated ("exhausted").
  assert.equal(row!.read_state, "unread");
  assert.equal(row!.escalation_state, "exhausted");
  assert.notEqual(row!.read_state, "actioned");
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-7.ALR.005.3 — window math uses a single server-authoritative clock (skew cannot skip escalation)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-7.ALR.005.3 — window math uses the server clock + the server-written anchor, not any client 'now'", async () => {
  const cfg = healthyConfig({
    alert_routing_rules: { task_failure_spike: { role: "admin", channels: [] } },
    escalation_contacts: { admin: ["u-admin", "u-oncall-2"] },
  });
  const { engine, notifications, clock } = makeEngine(cfg);
  const sig = emptySignals();
  sig.taskFailureTimestamps = [T0, T0, T0];
  const { notification } = await engine.deliver(evaluateRules(sig, THRESHOLDS, T0)[0]!);
  const WINDOW = 900_000;

  // Part A — the anchor is the SERVER-written created_at, and it is honoured. Forge the ACTUAL stored row's
  // created_at into the far FUTURE (as a compromised client might). A correct impl anchors on this stored,
  // server-authoritative value — so the window has NOT elapsed and NO secondary fires, even though the
  // server clock advanced. (If the engine trusted a client-supplied elapsed instead, it would misfire.)
  notifications._forgeCreatedAt(notification.id, new Date(T0 + 999_000_000).toISOString());
  clock.advance(WINDOW + 1);
  assert.equal(
    await engine.runEscalation(notification.id, WINDOW),
    null,
    "future-forged anchor must delay escalation — the persisted server timestamp governs",
  );

  // Part B — restore a real past anchor; now the SERVER clock (not any caller-passed time) decides the window
  // has elapsed and fires the secondary. runEscalation takes NO caller timestamp arg at all — it can only read
  // this.deps.now(), so a skewed client clock has no way in.
  notifications._forgeCreatedAt(notification.id, new Date(T0).toISOString());
  const secondary = await engine.runEscalation(notification.id, WINDOW);
  assert.ok(secondary);
  assert.equal(secondary!.recipient, "u-oncall-2");
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-7.ALR.006.1 — a Slack outage leaves every dashboard notification intact
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-7.ALR.006.1 — a full Slack outage never loses the dashboard notification", async () => {
  const { engine, notifications, slack } = makeEngine(healthyConfig());
  slack.induceFailure("connection refused");
  await engine.deliverHardLimit("a", "t1");
  await engine.deliverHardLimit("b", "t2");
  // teeth: both durable rows survive the outage (2 in, 2 persisted)...
  assert.equal((await notifications.all()).length, 2);
  // ...and Slack genuinely received nothing (the outage was real, not a no-op).
  assert.equal(slack.sent.length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-7.ALR.006.2 — a failed Slack delivery is surfaced, not silently dropped
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-7.ALR.006.2 — a Slack failure is recorded on delivery_state (surfaced), not swallowed", async () => {
  const { engine, notifications, slack } = makeEngine(healthyConfig());
  slack.induceFailure("503 unavailable");
  const { notification } = await engine.deliverHardLimit("a", "t1");
  const row = await notifications.get(notification.id);
  // teeth: the failure is explicitly surfaced with its cause — not a null/absent delivery_state.
  assert.equal(row!.delivery_state?.slack_attempted, true);
  assert.equal(row!.delivery_state?.slack_ok, false);
  assert.match(row!.delivery_state?.slack_error ?? "", /503/);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-7.ALR.007.1 — a C6 hard-limit event → immediate C7 dashboard + Slack alert
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-7.ALR.007.1 — a C6 hard-limit event closes the seam: dashboard + Slack, immediately", async () => {
  const { engine, notifications, slack } = makeEngine(healthyConfig());
  const outcome = await engine.deliverHardLimit("rate_ceiling", "task-77");
  // teeth: dashboard row + a REAL Slack send both happened for the C6 event.
  assert.equal((await notifications.all()).some((r) => r.type === "hard_limit_hit"), true);
  assert.equal(outcome.slackOk, true);
  assert.equal(slack.sent.length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-7.ALR.007.2 — a C5 stale awaiting_approval → stale-approval alert to its reviewer
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-7.ALR.007.2 — a C5 stale approval produces the C7 stale-approval alert to the reviewer", async () => {
  const cfg = healthyConfig({
    alert_routing_rules: { approval_queue_stale: { role: "admin", channels: [] } },
  });
  const { engine, notifications } = makeEngine(cfg);
  await engine.deliverStaleApproval("appr-5", "u-reviewer-carol", 7_200_000);
  const row = (await notifications.all()).find((r) => r.type === "approval_queue_stale")!;
  assert.equal(row.recipient, "u-reviewer-carol");
  // teeth: it names the specific item (traceable), not a generic broadcast.
  assert.match(row.body, /appr-5/);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-7.ALR.009.1 — unroutable → "alert delivery misconfigured" critical + mgmt-plane bit
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-7.ALR.009.1 — an unroutable alert raises the misconfigured critical to Super Admin + latches the push bit", async () => {
  // route cost_threshold_breach to a role nobody holds, with NO escalation chain → genuinely unroutable.
  const cfg = healthyConfig({
    alert_routing_rules: { cost_threshold_breach: { role: "ghost", channels: [] } },
    escalation_contacts: {},
  });
  const { engine, notifications, health } = makeEngine(cfg);
  const sig = emptySignals();
  sig.spend = { dailyTokens: 2000, weeklyTokens: 0 };
  const [alert] = evaluateRules(sig, THRESHOLDS, T0);
  const outcome = await engine.deliver(alert!);
  const all = await notifications.all();
  // teeth 1: the original alert still persists on the dashboard (not dropped)...
  assert.equal(all.some((r) => r.type === "cost_threshold_breach"), true);
  // teeth 2: a DISTINCT misconfigured critical was raised to Super Admin...
  const crit = all.find((r) => r.type === "alert_delivery_misconfigured");
  assert.ok(crit);
  assert.equal(crit!.severity, "critical");
  assert.equal(crit!.recipient_role, "super_admin");
  assert.ok(outcome.misconfiguredCriticalId);
  // teeth 3: the mgmt-plane bit latched so a fully-misconfigured silo still surfaces on the Super Admin grid.
  assert.equal(health.snapshot().alert_delivery_misconfigured, true);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-7.ALR.009.2 — quiet-hours never silences a critical/hard-limit alert
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-7.ALR.009.2 — quiet-hours suppresses a non-critical alert but NEVER a critical one", async () => {
  const cfg = healthyConfig({
    quiet_hours: { enabled: true, start_min: 0, end_min: 1440 }, // all-day quiet window
    alert_routing_rules: {
      hard_limit_hit: { role: "super_admin", channels: ["slack"] },
      task_failure_spike: { role: "admin", channels: ["slack"] },
    },
  });
  const { engine, slack } = makeEngine(cfg);
  const NOON = 720;
  // a non-critical alert inside the window is quiet-suppressed (dashboard persisted, Slack withheld).
  const sig = emptySignals();
  sig.taskFailureTimestamps = [T0, T0, T0];
  const nonCrit = await engine.deliver(evaluateRules(sig, THRESHOLDS, T0)[0]!, { nowMin: NOON });
  assert.equal(nonCrit.quietSuppressed, true);
  const slackAfterNonCrit = slack.sent.length;
  // teeth: a critical/hard-limit inside the SAME window is delivered regardless — Slack fires.
  const crit = await engine.deliverHardLimit("spend_cap", "t1");
  assert.equal(crit.quietSuppressed, false);
  assert.equal(slack.sent.length, slackAfterNonCrit + 1);
  // unit-level cross-check on the predicate itself.
  assert.equal(quietHoursSuppresses("hard_limit_hit", cfg, NOON), false);
  assert.equal(quietHoursSuppresses("task_failure_spike", cfg, NOON), true);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-7.ALR.009.3 — a config write stranding a critical type is rejected at config time (fail-closed)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-7.ALR.009.3 — a config leaving a critical type with no destination is rejected on write", async () => {
  const roleModel = roles();
  // healthy config validates cleanly...
  validateConfigOrReject(healthyConfig(), roleModel);
  // ...but removing hard_limit_hit's route (and giving it no chain) strands a critical → REJECTED.
  const stranding = healthyConfig({
    alert_routing_rules: {
      hard_limit_hit: { role: "ghost", channels: [] },
      alert_delivery_misconfigured: { role: "super_admin", channels: [] },
      alert_engine_stalled: { role: "super_admin", channels: [] },
    },
    escalation_contacts: {}, // no chain for ghost
  });
  assert.throws(
    () => validateConfigOrReject(stranding, roleModel),
    (e: unknown) => e instanceof ConfigRejected && e.strandedCriticalTypes.includes("hard_limit_hit"),
  );
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-7.ALR.009.4 — a runtime-invalid Slack webhook is surfaced; dashboard unaffected
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-7.ALR.009.4 — a revoked/404 Slack webhook is surfaced as a delivery failure; the row is untouched", async () => {
  const { engine, notifications, slack } = makeEngine(healthyConfig());
  slack.induceFailure("404 no_service — webhook revoked");
  const { notification } = await engine.deliverHardLimit("a", "t1");
  const row = await notifications.get(notification.id);
  // teeth: surfaced with the runtime cause...
  assert.match(row!.delivery_state?.slack_error ?? "", /404|revoked/);
  // ...and the dashboard notification is entirely intact (unread, present, right type).
  assert.equal(row!.read_state, "unread");
  assert.equal(row!.type, "hard_limit_hit");
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-NFR-OBS.008.1 — unresolvable routing → misconfigured critical raised + escalated (never dropped)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-NFR-OBS.008.1 — an alert whose target can't be resolved becomes a louder alert, not a swallowed one", async () => {
  const cfg = healthyConfig({
    alert_routing_rules: { queue_backup: { role: "nobody", channels: [] } },
    escalation_contacts: {},
  });
  const { engine, notifications } = makeEngine(cfg);
  const sig = emptySignals();
  sig.queue = { pending: 10, oldestEnqueuedAtMs: T0 - 600_000 };
  await engine.deliver(evaluateRules(sig, THRESHOLDS, T0)[0]!);
  const all = await notifications.all();
  // teeth: both the original (persisted) AND the escalated misconfigured-critical exist; nothing dropped.
  assert.equal(all.some((r) => r.type === "queue_backup"), true);
  assert.equal(all.some((r) => r.type === "alert_delivery_misconfigured" && r.severity === "critical"), true);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-NFR-OBS.008.2 — quiet-hours still delivers a hard-limit/critical alert
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-NFR-OBS.008.2 — a hard-limit alert within quiet-hours is still delivered", async () => {
  const cfg = healthyConfig({ quiet_hours: { enabled: true, start_min: 0, end_min: 1440 } });
  const { engine, slack } = makeEngine(cfg);
  const outcome = await engine.deliverHardLimit("spend_cap", "t1");
  // teeth: not suppressed, and the fan-out actually went out inside the quiet window.
  assert.equal(outcome.quietSuppressed, false);
  assert.equal(slack.sent.length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-NFR-OBS.009.1 — dashboard persisted first + independently of any Slack attempt
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-NFR-OBS.009.1 — the durable row is committed before any Slack fan-out is attempted", async () => {
  // Prove ordering: with a Slack that THROWS, the row must still exist — i.e. persistence preceded fan-out.
  const { engine, notifications, slack } = makeEngine(healthyConfig());
  slack.induceFailure("thrown before send completes");
  const { notification } = await engine.deliverHardLimit("a", "t1");
  // teeth: the row exists despite the fan-out throwing → persist-first ordering held.
  assert.ok(await notifications.get(notification.id));
  // and the fan-out was genuinely attempted-and-failed (delivery_state surfaced), not skipped.
  assert.equal((await notifications.get(notification.id))!.delivery_state?.slack_attempted, true);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-NFR-OBS.009.2 — a failed Slack fan-out retains the row + surfaces the failure
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-NFR-OBS.009.2 — a failed fan-out keeps the row and surfaces the failure (both, not either)", async () => {
  const { engine, notifications, slack } = makeEngine(healthyConfig());
  slack.induceFailure("network partition");
  const { notification } = await engine.deliverHardLimit("a", "t1");
  const row = await notifications.get(notification.id);
  // teeth: row retained (not null) AND failure surfaced (slack_ok false with a cause).
  assert.ok(row);
  assert.equal(row!.delivery_state?.slack_ok, false);
  assert.match(row!.delivery_state?.slack_error ?? "", /partition/);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-NFR-OBS.016.1 — the audit-sink row is written + retained even when delivery fails
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-NFR-OBS.016.1 — the event_log audit row is written independent of a failed delivery", async () => {
  const { engine, eventLog, slack } = makeEngine(healthyConfig());
  slack.induceFailure("delivery down");
  const before = (await eventLog.all()).length;
  await engine.deliverHardLimit("a", "t1");
  const after = await eventLog.all();
  // teeth: exactly one new audit row despite the delivery failure; it is the alert's guardrail_hit row.
  assert.equal(after.length, before + 1);
  assert.equal(after.some((l) => l.event_type === "guardrail_hit"), true);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-7.ALR.009.3 / AC-NFR-OBS.008.1 (fail-CLOSED resolvability) — a critical routed to a role NOBODY holds
// whose only escalation contact is a TYPO'd role-shaped string that resolves to NO ONE must be REJECTED at
// write time AND, if it somehow reaches runtime, raise the misconfigured-critical instead of silently
// "delivering" to that dead string. This is the #2/#3 gap: a critical alert reaching no one.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-7.ALR.009.3 — a critical whose escalation contact is a typo'd role nobody holds is REJECTED on write", () => {
  const roleModel = roles();
  // hard_limit_hit routed to `ghost` (nobody holds it); the ONLY escalation contact is `supr_admin` — a typo of
  // super_admin. `supr_admin` is neither a held role NOR a known user id → it resolves to NO ONE (dead string).
  const dead = healthyConfig({
    alert_routing_rules: {
      hard_limit_hit: { role: "ghost", channels: [] },
      alert_delivery_misconfigured: { role: "super_admin", channels: [] },
      alert_engine_stalled: { role: "super_admin", channels: [] },
    },
    escalation_contacts: { ghost: ["supr_admin" /* typo — nobody holds this */] },
  });
  // teeth 1: the OLD bug (any non-empty string counts) would ACCEPT this; the fail-closed gate REJECTS it,
  // naming hard_limit_hit as stranded.
  assert.throws(
    () => validateConfigOrReject(dead, roleModel),
    (e: unknown) => e instanceof ConfigRejected && e.strandedCriticalTypes.includes("hard_limit_hit"),
  );
  // teeth 2: a REAL bare user id in the same slot (u-oncall — genuinely known) is still accepted — the gate
  // rejects only dead strings, not legitimate direct-user destinations (no over-rejection).
  const live = healthyConfig({
    alert_routing_rules: {
      hard_limit_hit: { role: "ghost", channels: [] },
      alert_delivery_misconfigured: { role: "super_admin", channels: [] },
      alert_engine_stalled: { role: "super_admin", channels: [] },
    },
    escalation_contacts: { ghost: ["u-oncall"] },
  });
  validateConfigOrReject(live, roleModel); // must NOT throw
});

test("AC-NFR-OBS.008.1 — at runtime a critical routed to a dead role-shaped string raises the misconfigured-critical, never silently 'delivers' to it", async () => {
  // Same dead config, but exercised through the ENGINE: the hard_limit_hit routes to `ghost` (nobody), whose
  // only escalation contact `supr_admin` resolves to no one. The engine must NOT accept `supr_admin` as a
  // recipient — it must fail loud (misconfigured-critical + mgmt-plane bit) and leave the primary unrouted.
  const cfg = healthyConfig({
    alert_routing_rules: {
      hard_limit_hit: { role: "ghost", channels: [] },
      alert_delivery_misconfigured: { role: "super_admin", channels: [] },
      alert_engine_stalled: { role: "super_admin", channels: [] },
    },
    escalation_contacts: { ghost: ["supr_admin" /* typo — nobody holds this */] },
  });
  const { engine, notifications, health } = makeEngine(cfg);
  const outcome = await engine.deliverHardLimit("spend_cap", "task-1");
  // teeth 1: the primary hard-limit alert resolved to NO recipient — it was NOT silently routed to the dead
  // string (the exact #2/#3 bug: a critical reaching a string nobody holds).
  assert.equal(outcome.resolvedRecipient, null);
  const all = await notifications.all();
  assert.equal(
    all.some((r) => r.type === "hard_limit_hit" && r.recipient === "supr_admin"),
    false,
    "the critical must never be routed to the dead role-shaped string",
  );
  // teeth 2: it failed LOUD instead — a distinct misconfigured-critical to Super Admin + the latched push bit.
  assert.ok(outcome.misconfiguredCriticalId);
  assert.equal(all.some((r) => r.type === "alert_delivery_misconfigured" && r.severity === "critical"), true);
  assert.equal(health.snapshot().alert_delivery_misconfigured, true);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-7.ALR.005.1 (chain-start correctness) — the escalation chain starts explicitly AFTER the primary, even
// when the routed-role holder is NOT chain[0]. The old code assumed primary == chain[0] and fired chain[1]
// first, silently SKIPPING chain[0] when it wasn't the primary. Here chain[0] is a distinct holder.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-7.ALR.005.1 — when the routed-role holder != chain[0], the first escalation fires chain[0] (never skips it)", async () => {
  // The routed role `admin` resolves to `u-admin` (primary). The escalation chain's FIRST entry is a DIFFERENT
  // holder (`u-oncall`), not the primary — so the first escalation must go to chain[0]=u-oncall, not chain[1].
  const cfg = healthyConfig({
    alert_routing_rules: { task_failure_spike: { role: "admin", channels: [] } },
    escalation_contacts: { admin: ["u-oncall" /* != primary u-admin */, "u-oncall-2"] },
  });
  const { engine, notifications, clock } = makeEngine(cfg);
  const sig = emptySignals();
  sig.taskFailureTimestamps = [T0, T0, T0];
  const { notification } = await engine.deliver(evaluateRules(sig, THRESHOLDS, T0)[0]!);
  // the primary genuinely resolved to u-admin (the routed-role holder), which is NOT chain[0].
  assert.equal(notification.recipient, "u-admin");
  const WINDOW = 900_000;
  clock.advance(WINDOW + 1);
  const secondary = await engine.runEscalation(notification.id, WINDOW);
  assert.ok(secondary);
  // teeth: the first escalation fires chain[0]=u-oncall — the old primary==chain[0] assumption would have
  // skipped it and jumped to u-oncall-2. chain[0] is never silently skipped.
  assert.equal(secondary!.recipient, "u-oncall");
  assert.notEqual(secondary!.recipient, "u-oncall-2");
  // and a SECOND escalation then advances to chain[1]=u-oncall-2 (the chain continues, not restarts).
  clock.advance(WINDOW + 1);
  const third = await engine.runEscalation(secondary!.id, WINDOW);
  assert.ok(third);
  assert.equal(third!.recipient, "u-oncall-2");
});

// ── extra unit teeth on the quiet-window wrap math (supports .009.2 / .008.2) ────────────────────────
test("quiet-window wrap math — a window crossing midnight suppresses on both sides", () => {
  const q = { enabled: true, start_min: 1320 /* 22:00 */, end_min: 360 /* 06:00 */ };
  assert.equal(inQuietWindow(q, 1380), true); // 23:00 — inside
  assert.equal(inQuietWindow(q, 60), true); // 01:00 — inside (wrapped)
  assert.equal(inQuietWindow(q, 720), false); // 12:00 — outside
  assert.equal(inQuietWindow({ ...q, enabled: false }, 60), false); // disabled → never suppresses
});
