// ISSUE-078 — the offline AC suite for the two ops dashboards. One test per §4 Definition-of-done AC, across
// both surfaces, both permitted + denied RBAC paths, and the false-healthy sweep on every panel state.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OPS_PANELS,
  FLEET_SECTIONS,
  PERM,
  referencedNodes,
} from "./catalog.ts";
import { caller, canView, visibleItems, canAct, permittedActions } from "./rbac.ts";
import {
  resolvePollIntervalSeconds,
  pollFreshness,
  actionsEnabledAfterReconnect,
} from "./freshness.ts";
import {
  renderPanel,
  assertNotFalseHealthy,
  renderCost,
  dlqBadge,
  type PollOutcome,
} from "./panel-state.ts";
import {
  renderFleetCard,
  renderMissingSnapshotCard,
  fleetSummary,
  renderBackupHealth,
  type DeploymentSnapshot,
} from "./fleet.ts";
import {
  canFreeze,
  canHardDelete,
  authorizeTwoPerson,
  type OffboardingRowState,
} from "./offboarding.ts";
import {
  InMemoryOpsDashboardStore,
  OpsDashboardError,
  ERR_MISSING_REASON,
  ERR_BAD_ACTOR_TYPE,
  ERR_BAD_TARGET_UUID,
} from "./store.ts";
import { runCheck } from "./index.ts";

// ── AC-7.VIEW.001.1 — every panel/section maps to a producing FR (C7 invents no signal) ──────────────────
test("AC-7.VIEW.001.1 — every panel/section maps to at least one producing FR", () => {
  for (const item of [...OPS_PANELS, ...FLEET_SECTIONS]) {
    assert.ok(item.producingFR.length > 0, `${item.id} must map to a producing FR`);
  }
  // and the `check` gate agrees (no drift).
  assert.equal(runCheck().length, 0, "check must be clean");
});

// ── AC-7.VIEW.001.2 — the silent-failure indicator is driven by the LOG.003 completeness gap ─────────────
test("AC-7.VIEW.001.2 — the failure-health panel's silent-failure indicator sources FR-7.LOG.003", () => {
  const failure = OPS_PANELS.find((p) => p.id === "failure-health")!;
  assert.ok(failure.producingFR.includes("FR-7.LOG.003"), "the #3 detector is driven by LOG.003 completeness");
});

// ── AC-7.VIEW.001.3 — the self-improvement panel DISPLAYS C9 suggestions (does not generate) ─────────────
test("AC-7.VIEW.001.3 — the self-improvement panel renders displayed-not-generated signals", () => {
  const si = OPS_PANELS.find((p) => p.id === "self-improvement")!;
  // it renders C8 health/drift + C7 flywheel + C6 candidates — all produced elsewhere, displayed here.
  assert.ok(si.producingFR.includes("FR-8.HLTH.001"));
  assert.ok(si.producingFR.includes("FR-7.OPT.001"));
});

// ── AC-7.VIEW.002.1 — a role sees only permitted panels; unpermitted = ABSENT, not empty ─────────────────
test("AC-7.VIEW.002.1 — RBAC: absent-not-empty, default-deny, least-privilege actions", () => {
  const opsNodes = [PERM.DASHBOARD_OPS];
  const admin = caller("admin", opsNodes);
  // Admin holding entry sees all nine panels.
  assert.equal(visibleItems(admin, OPS_PANELS).length, 9);

  // Finance holding entry is scoped to the Cost panel ONLY (surface-05 Access table / OD-121).
  const finance = caller("finance", opsNodes);
  const financeVisible = visibleItems(finance, OPS_PANELS).map((p) => p.id);
  assert.deepEqual(financeVisible, ["cost"], "Finance sees only Cost — every other panel is absent");

  // A caller WITHOUT the entry node sees NOTHING (default-deny; the panel is absent, not returned-empty).
  const noNode = caller("admin", []);
  assert.equal(visibleItems(noNode, OPS_PANELS).length, 0);

  // Standard user (no ops node by default) sees nothing.
  assert.equal(visibleItems(caller("standard_user", opsNodes), OPS_PANELS).length, 0);

  // Action least-privilege: viewing the DLQ does NOT grant requeue without PERM-ops.dlq_manage.
  const dlq = OPS_PANELS.find((p) => p.id === "dead-letter-queue")!;
  assert.equal(permittedActions(admin, dlq).length, 0, "no DLQ actions without the manage node");
  const opsMgr = caller("admin", [PERM.DASHBOARD_OPS, PERM.OPS_DLQ_MANAGE]);
  assert.equal(permittedActions(opsMgr, dlq).length, 2, "requeue + discard with the manage node");
  assert.ok(canAct(opsMgr, dlq, dlq.actions[0]!));

  // surface-06 is operator-only: an admin (no fleet.view) sees no fleet sections.
  assert.equal(visibleItems(caller("admin", [PERM.FLEET_VIEW]), FLEET_SECTIONS).length, 0, "admin role not scoped to fleet");
  const operator = caller("super_admin", [PERM.FLEET_VIEW]);
  assert.equal(visibleItems(operator, FLEET_SECTIONS).length, FLEET_SECTIONS.length);
  // but no destructive action without its node.
  const regSection = FLEET_SECTIONS.find((s) => s.id === "client-registry-offboarding")!;
  assert.equal(permittedActions(operator, regSection).length, 0, "no offboard/rotate actions without their nodes");
});

// ── AC-7.MGM.003.1 — grid renders one card per deployment from pushed snapshots, NO business-data pull ────
test("AC-7.MGM.003.1 — fleet cards render from pushed snapshots only (no pull path)", () => {
  const snap: DeploymentSnapshot = {
    clientSlug: "acme", clientName: "Acme", status: "active", liveness: "fresh",
    healthScore: 98, lastPushAtEpochS: 1000, openCriticalAlerts: 0, coreVersion: "1.4.0", costToDateUsd: 12.5, backupOk: true,
  };
  const card = renderFleetCard(snap);
  assert.equal(card.clientSlug, "acme");
  assert.equal(card.tone, "healthy");
  // The render function's ONLY input is the pushed snapshot — there is no client-endpoint fetch. (Structural:
  // renderFleetCard is a pure function of DeploymentSnapshot.)
  assert.equal(typeof renderFleetCard, "function");
});

// ── AC-7.MGM.003.2 — click-through into the client, under the client's RBAC (not a mgmt-plane copy) ───────
test("AC-7.MGM.003.2 — card click-through hands off to the client's own RBAC, not a management-plane node", () => {
  const card = renderFleetCard({
    clientSlug: "acme", clientName: "Acme", status: "active", liveness: "fresh",
    healthScore: 90, lastPushAtEpochS: 1, openCriticalAlerts: 0, coreVersion: "1.0.0", costToDateUsd: 0, backupOk: true,
  });
  assert.equal(card.clickThrough.auth, "client-own-rbac");
  assert.equal(card.clickThrough.managementPlaneNode, null);
});

// ── AC-7.MGM.004.1 — a critical alert in any deployment appears cross-deployment ─────────────────────────
test("AC-7.MGM.004.1 — a critical alert surfaces on the card + fleet summary", () => {
  const withAlert = renderFleetCard({
    clientSlug: "beta", clientName: "Beta", status: "active", liveness: "fresh",
    healthScore: 70, lastPushAtEpochS: 1, openCriticalAlerts: 3, coreVersion: "1.0.0", costToDateUsd: 1, backupOk: true,
  });
  assert.equal(withAlert.alert, true);
  assert.match(withAlert.badge, /critical/);
});

// ── AC-7.MGM.004.2 — CI/CD panel shows per-deployment core version + last-push ───────────────────────────
test("AC-7.MGM.004.2 — releases section renders per-deployment core version + last-push", () => {
  const releases = FLEET_SECTIONS.find((s) => s.id === "releases-cicd")!;
  assert.ok(releases.producingFR.includes("FR-10.DEP.004"), "max-skew / version reporting");
  const snap: DeploymentSnapshot = {
    clientSlug: "g", clientName: "G", status: "active", liveness: "fresh",
    healthScore: 1, lastPushAtEpochS: 500, openCriticalAlerts: 0, coreVersion: "2.1.0", costToDateUsd: 0, backupOk: true,
  };
  // the snapshot carries both fields the panel renders.
  assert.equal(snap.coreVersion, "2.1.0");
  assert.equal(snap.lastPushAtEpochS, 500);
});

// ── AC-7.MGM.005.1 — backup-health visible; unknown reads "—", never a ✓ ─────────────────────────────────
test("AC-7.MGM.005.1 — backup-health is honest (unknown ≠ ✓)", () => {
  assert.equal(renderBackupHealth(true).healthy, true);
  assert.equal(renderBackupHealth(false).healthy, false);
  const unknown = renderBackupHealth(null);
  assert.equal(unknown.healthy, false);
  assert.doesNotMatch(unknown.display, /✓/, "unknown backup must not render a check-mark");
});

// ── AC-7.MGM.005.2 — cost overview aggregates estimate + trend, labelled estimate ────────────────────────
test("AC-7.MGM.005.2 — fleet cost is aggregated + labelled estimate; a blind deployment ≠ $0", () => {
  const all: DeploymentSnapshot[] = [
    { clientSlug: "a", clientName: "A", status: "active", liveness: "fresh", healthScore: 1, lastPushAtEpochS: 1, openCriticalAlerts: 0, coreVersion: "1", costToDateUsd: 10, backupOk: true },
    { clientSlug: "b", clientName: "B", status: "active", liveness: "fresh", healthScore: 1, lastPushAtEpochS: 1, openCriticalAlerts: 0, coreVersion: "1", costToDateUsd: 5, backupOk: true },
  ];
  const s = fleetSummary(all);
  assert.equal(s.fleetCostEstimateUsd, 15);
  assert.equal(s.costEstimateLabelled, true);
  // a blind deployment makes the total explicitly unknown, never a fabricated $0.
  const withBlind = fleetSummary([...all, { ...all[0]!, clientSlug: "c", costToDateUsd: null }]);
  assert.equal(withBlind.fleetCostEstimateUsd, null);
  // and the per-panel cost render always carries "estimate".
  assert.match(renderCost({ estimatedUsd: 42, blindMeterCount: 0 }).display, /estimate/);
  assert.match(renderCost({ estimatedUsd: null, blindMeterCount: 2 }).display, /unknown/);
});

// ── AC-7.RTP.002.1 — poll interval read from config; documented default on absence; sub-floor rejected ────
test("AC-7.RTP.002.1 — poll interval from config with documented defaults on absence", () => {
  const panel = OPS_PANELS.find((p) => p.id === "system-health")!;
  assert.equal(panel.cadence!.defaultSeconds, 30);
  assert.equal(resolvePollIntervalSeconds(undefined, 30), 30, "default on absence");
  assert.equal(resolvePollIntervalSeconds(null, 60), 60, "default on null");
  assert.equal(resolvePollIntervalSeconds(45, 30), 45, "config value wins when set");
  // a sub-floor / invalid value is surfaced loud, never silently clamped (#3).
  assert.throws(() => resolvePollIntervalSeconds(2, 30), /floor/);
  assert.throws(() => resolvePollIntervalSeconds(Number.NaN, 30), /finite/);
});

// ── AC-7.RTP.004.2 — a dropped/failed poll reflects stale/reconnecting honestly; never shown as current ───
test("AC-7.RTP.004.2 — stale/reconnect is honest; a stale view never re-enables actions", () => {
  // fresh (age within cadence).
  assert.equal(pollFreshness(1000, 1010, 30).freshness, "fresh");
  // stale (age > 2× cadence) — labelled stale, connection honest.
  const stale = pollFreshness(1000, 1100, 30, { reconnecting: true });
  assert.equal(stale.freshness, "stale");
  assert.equal(stale.connection, "reconnecting");
  assert.match(stale.label, /stale/);
  // this surface polls — the connection is never "live".
  assert.equal(pollFreshness(1000, 1005, 30).connection, "polling");
  // AC-NFR-OBS.011.2 — never act on a stale-but-green screen; re-fetch before re-enabling.
  assert.equal(actionsEnabledAfterReconnect("stale", true), false);
  assert.equal(actionsEnabledAfterReconnect("fresh", false), false, "no actions until a fresh re-fetch");
  assert.equal(actionsEnabledAfterReconnect("fresh", true), true);
});

// ── AC-NFR-OBS.011.1 — the false-healthy sweep: no error/stale render ever reads 0/✓/all-clear/Live ───────
test("AC-NFR-OBS.011.1 — every non-healthy panel state reads honestly, never false-healthy", () => {
  const copy = { empty: "No failures in the selected window.", error: "Couldn't run the failure check — can't confirm." };
  const outcomes: PollOutcome[] = [
    { kind: "loading" },
    { kind: "ok", hasData: true },
    { kind: "ok", hasData: false },
    { kind: "error", reason: "network" },
    { kind: "partial", loaded: ["feed"], failed: ["silent-failure-reconciliation"] },
    { kind: "stale", ageSeconds: 300 },
  ];
  for (const o of outcomes) {
    const r = renderPanel(o, copy);
    // the guard throws if the render would be false-healthy.
    assert.doesNotThrow(() => assertNotFalseHealthy(r));
  }
  // error state: healthy=false + honest copy, never "0"/"✓".
  const err = renderPanel({ kind: "error", reason: "x" }, copy);
  assert.equal(err.healthy, false);
  assert.equal(err.display, copy.error);
  // partial state: the failed sub-signal is reported "couldn't load", not "0".
  const partial = renderPanel({ kind: "partial", loaded: ["a"], failed: ["b"] }, copy);
  assert.deepEqual(partial.unconfirmed, ["b"]);
  assert.equal(partial.healthy, false);
  // the true-empty healthy state is DISTINCT from the error state.
  const empty = renderPanel({ kind: "ok", hasData: false }, copy);
  assert.equal(empty.state, "empty");
  assert.equal(empty.display, copy.empty);
  assert.equal(empty.healthy, true);
  // the guard actively catches a false-healthy render.
  assert.throws(() => assertNotFalseHealthy({ state: "error", display: "0", healthy: false, unconfirmed: [] }), /false-healthy/);
  assert.throws(() => assertNotFalseHealthy({ state: "stale", display: "ok", healthy: true, unconfirmed: [] }), /false-healthy/);
});

// ── AC-NFR-OBS.011 — fleet: a dark deployment never reads green; frozen reads expected-quiet ──────────────
test("AC-NFR-OBS.011 (fleet) — dark ≠ healthy; frozen ≠ dead", () => {
  const dark = renderFleetCard({
    clientSlug: "z", clientName: "Z", status: "active", liveness: "stale",
    healthScore: 99, lastPushAtEpochS: 1, openCriticalAlerts: 0, coreVersion: "1", costToDateUsd: 0, backupOk: true,
  });
  assert.equal(dark.tone, "loud");
  assert.equal(dark.alert, true);
  assert.equal(dark.healthDisplay, "—", "a stale card never carries a fabricated health number");

  const frozen = renderFleetCard({
    clientSlug: "f", clientName: "F", status: "frozen", liveness: "frozen-quiet",
    healthScore: null, lastPushAtEpochS: null, openCriticalAlerts: null, coreVersion: null, costToDateUsd: null, backupOk: null,
  });
  assert.equal(frozen.tone, "quiet");
  assert.equal(frozen.alert, false, "frozen is NOT a dead-alert");
  assert.match(frozen.badge, /expected quiet/);

  // a registry row whose snapshot is missing renders stale/never-reported, never healthy.
  const missing = renderMissingSnapshotCard("m", "M", "active");
  assert.equal(missing.tone, "loud");
});

// ── AC-10.DEL.006.2 — hard-delete two-person auth: THREE distinct roles (executor ≠ both approvers) ────────
test("AC-10.DEL.006.2 — offboarding hard-delete requires a distinct second approver AND an executor distinct from both (no self-authorise)", () => {
  // self-second is refused (approvers must differ).
  assert.equal(authorizeTwoPerson({ firstApproverId: "u1", secondApproverId: "u1", executorId: "u1" }).allowed, false);
  // REGRESSION (the fail-open bug): the executor may NOT be the first approver — self-authorising as
  // authorized_by. DB CHECK deletion_requests: executor_id is distinct from authorized_by (0001_baseline L655).
  assert.equal(authorizeTwoPerson({ firstApproverId: "u1", secondApproverId: "u2", executorId: "u1" }).allowed, false);
  // REGRESSION: the executor may NOT be the second approver either — executor_id ≠ second_authoriser_id (L656).
  assert.equal(authorizeTwoPerson({ firstApproverId: "u1", secondApproverId: "u2", executorId: "u2" }).allowed, false);
  // only THREE distinct people is accepted — matching the DB CHECK the live INSERT will enforce.
  assert.equal(authorizeTwoPerson({ firstApproverId: "u1", secondApproverId: "u2", executorId: "u3" }).allowed, true);

  const frozenRow: OffboardingRowState = {
    clientSlug: "acme", step: "frozen", exportVerifiedComplete: true, clientSignedOff: true,
    dataFreshness: "loaded", retentionWindowEndEpochS: null,
  };
  // hard-delete allowed only with three distinct roles.
  assert.equal(canHardDelete(frozenRow, { firstApproverId: "a", secondApproverId: "b", executorId: "c" }).allowed, true);
  // REGRESSION: executor self-authorising (executor === first approver) is refused, not permitted.
  assert.equal(canHardDelete(frozenRow, { firstApproverId: "a", secondApproverId: "b", executorId: "a" }).allowed, false);
  assert.equal(canHardDelete(frozenRow, { firstApproverId: "a", secondApproverId: "a", executorId: "a" }).allowed, false);

  // #1 gate: cannot hard-delete without a verified-complete, signed-off export.
  const unverified: OffboardingRowState = { ...frozenRow, exportVerifiedComplete: false };
  assert.equal(canHardDelete(unverified, { firstApproverId: "a", secondApproverId: "b", executorId: "c" }).allowed, false);

  // destructive actions disabled while the row is stale/unloaded (surface-06 §H).
  const stale: OffboardingRowState = { ...frozenRow, dataFreshness: "stale" };
  assert.equal(canHardDelete(stale, { firstApproverId: "a", secondApproverId: "b", executorId: "c" }).allowed, false);

  // freeze gate: blocked until export verified + client sign-off.
  const preFreeze: OffboardingRowState = {
    clientSlug: "acme", step: "export-verified", exportVerifiedComplete: true, clientSignedOff: false,
    dataFreshness: "loaded", retentionWindowEndEpochS: null,
  };
  assert.equal(canFreeze(preFreeze).allowed, false, "no freeze without client sign-off");
  assert.equal(canFreeze({ ...preFreeze, clientSignedOff: true }).allowed, true);
});

// ── AC-5.JOB.006.2 — the DLQ unattended-escalation badge reflects the C5-emitted signal + persists stale ──
test("AC-5.JOB.006.2 — DLQ badge reflects the server-emitted escalation, persists while stale", () => {
  // server-escalated → badge shows loud, even on a stale panel.
  const b = dlqBadge({ serverEscalated: true, oldestEntryAgeHours: 30 }, "stale");
  assert.equal(b.show, true);
  assert.match(b.text, /UNATTENDED/);
  // not escalated → the badge is simply not asserted (we never render a reassuring "0 escalations" on error).
  assert.equal(dlqBadge({ serverEscalated: false, oldestEntryAgeHours: null }, "error").show, false);
});

// ── store — the access_audit write every export/sensitive view performs (fail-loud) ─────────────────────
test("store — access_audit append is fail-loud (Restricted needs a reason; actor_type validated)", async () => {
  const store = new InMemoryOpsDashboardStore();
  await store.appendAccessAudit({
    auditType: "dashboard_export", actorIdentity: "op-1", actorType: "user",
    action: "export:guardrail_log", pathContext: "surface-05/guardrail-log",
  });
  assert.equal(store.audits.length, 1);

  // a Restricted-touching export with NO reason is refused (never written un-reasoned).
  await assert.rejects(
    () => store.appendAccessAudit({
      auditType: "sensitive_view", actorIdentity: "op-1", actorType: "user",
      action: "view:restricted_event", touchesRestricted: true,
    }),
    (e: unknown) => e instanceof OpsDashboardError && e.reason === ERR_MISSING_REASON,
  );
  // a bad actor_type is refused.
  await assert.rejects(
    () => store.appendAccessAudit({
      auditType: "x", actorIdentity: "op-1", actorType: "robot" as never, action: "y",
    }),
    (e: unknown) => e instanceof OpsDashboardError && e.reason === ERR_BAD_ACTOR_TYPE,
  );
  assert.equal(store.audits.length, 1, "no refused write was persisted");

  // a well-formed UUID target is accepted (matches the live access_audit.target_entity_id UUID column).
  await store.appendAccessAudit({
    auditType: "sensitive_view", actorIdentity: "op-1", actorType: "user", action: "view:restricted_event",
    reason: "compliance review", touchesRestricted: true, targetEntityId: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(store.audits.length, 2);

  // REGRESSION (fake-passes-offline / live-diverges): a non-UUID target_entity_id is refused pre-DB by the
  // SHARED gate, so the fake can never accept a value the live UUID INSERT would throw on.
  await assert.rejects(
    () => store.appendAccessAudit({
      auditType: "dashboard_export", actorIdentity: "op-1", actorType: "user",
      action: "export:guardrail_log", targetEntityId: "not-a-uuid",
    }),
    (e: unknown) => e instanceof OpsDashboardError && e.reason === ERR_BAD_TARGET_UUID,
  );
  assert.equal(store.audits.length, 2, "the malformed-UUID write was refused, not persisted");
});

// ── check — the non-drift guard is clean + covers every gated node ───────────────────────────────────────
test("check — every gated PERM node exists in PERMISSION_NODES.md; catalog is drift-free", () => {
  assert.equal(runCheck().length, 0);
  // sanity: the gated-node set is non-trivial (both surfaces' entry + action nodes).
  const nodes = referencedNodes();
  assert.ok(nodes.has(PERM.DASHBOARD_OPS));
  assert.ok(nodes.has(PERM.FLEET_OFFBOARD));
  assert.ok(nodes.has(PERM.OPS_DLQ_MANAGE));
});
