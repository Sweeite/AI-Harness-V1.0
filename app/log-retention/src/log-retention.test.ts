// ISSUE-077 — the offline proof of the C7 observability backbone. One test per AC in the issue's §4 Definition
// of done (LOG.006/007, MGM.001–005, VIEW.001–003, OPT.001/002, NFR-CMP.007/009, NFR-OBS.010). The in-memory
// fakes mirror the real DDL's append-only / tombstone / retention semantics so a test cannot pass offline while
// the live adapter would throw. AF-118/AF-120 (staleness liveness + server-authoritative clock) are GREEN and
// modelled faithfully; AF-133 (export at scale) + AF-137 (transitive-erasure completeness across the C10→C2→C7
// boundary) are owed-to-live and listed in results/proposed-shared-spec.md — the offline halves are proven here.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_RETENTION_CONFIG,
  DEFAULT_STALENESS_CONFIG,
  validateRetentionConfig,
  validateStalenessConfig,
  type RetentionConfig,
} from "./config.ts";
import {
  InMemoryEventLogStore,
  InMemoryGuardrailLogStore,
  InMemoryConfigAuditLogStore,
  InMemoryPushSubscriptionStore,
  InMemoryEventWriteSink,
  guardrailIntegrityDigest,
  SinkSubstrateFailure,
  AppendOnlyViolation,
} from "./store.ts";
import { runEventLogRetention, runGuardrailLogRetention } from "./retention.ts";
import { eraseEventLogSubject, eraseGuardrailLogSubject, verifyGuardrailIntegrity } from "./redaction.ts";
import { exportGuardrailLog, ExportPermissionDenied, ExportReconciliationShortfall, PERM_DOWNLOAD_RECORDS } from "./export.ts";
import {
  offendingFields,
  pickOperational,
  assertOperationalOnly,
  BusinessDataAtBoundaryError,
  pushHealthSnapshot,
  InMemoryLocalPushLog,
  StubSupabaseBackupApi,
  readBackupHealth,
  evaluateLiveness,
  StalenessEvaluator,
  healthGridCard,
  crossDeploymentAlerts,
  ciCdRow,
  backupHealthCard,
  costOverviewRow,
  costOverview,
  type RegistryCard,
  type HealthCard,
  type IngestTransport,
} from "./mgm.ts";
import {
  OPS_DASHBOARD_PANELS,
  panelsWithoutProducer,
  panelsForViewer,
  canViewPanel,
  silentFailureIndicators,
  renderActivityFeed,
  MissingAnswerModePill,
  routeMobilePush,
  type ViewerContext,
} from "./views.ts";
import {
  REVIEW_SIGNAL_CLASSES,
  InMemoryReviewSignalStore,
  missingSignalClasses,
  buildBenchmarkSubstrate,
  assertNoCrossDeploymentClaim,
  type BenchmarkSubstrateRow,
} from "./flywheel.ts";

// ── fixtures ──────────────────────────────────────────────────────────────────────
const T0 = Date.parse("2026-01-01T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();
const NOW = () => new Date(Date.parse("2026-12-31T00:00:00.000Z")); // ~365d after T0

function eventRow(id: string, createdMs: number, over: Partial<import("./types.ts").EventLogRow> = {}): import("./types.ts").EventLogRow {
  return {
    id,
    task_id: "task-" + id,
    event_type: "task_completed",
    entity_ids: ["entity-alice"],
    summary: "Alice's task completed",
    payload: { note: "ok" },
    duration_ms: 10,
    cost_tokens: 5,
    cost_unknown: false,
    answer_mode: "cited",
    redacted_at: null,
    created_at: iso(createdMs),
    ...over,
  };
}
function guardrailRow(id: string, createdMs: number, over: Partial<import("./types.ts").GuardrailLogRow> = {}): import("./types.ts").GuardrailLogRow {
  return {
    id,
    task_id: "task-" + id,
    guardrail_type: "approval_gate",
    description: "Alice requested an over-limit spend",
    action_blocked: true,
    status: "pending",
    reviewed_by: null,
    reviewed_at: null,
    escalated_at: null,
    redacted_at: null,
    created_at: iso(createdMs),
    ...over,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// FR-7.LOG.006 — event_log retention + compliance erasure
// ════════════════════════════════════════════════════════════════════════════════

test("AC-7.LOG.006.1 — retention window is configurable; a pruning run skips a still-referenced row and records why", async () => {
  const oldReferenced = eventRow("old-ref", T0 - 100 * DAY); // well outside the window, but referenced
  const oldFree = eventRow("old-free", T0 - 100 * DAY);
  const recent = eventRow("recent", NOW().getTime() - 1 * DAY);
  const store = new InMemoryEventLogStore([oldReferenced, oldFree, recent]);
  const writer = new InMemoryEventWriteSink();
  const referenced = new Set(["old-ref"]);

  const res = await runEventLogRetention({
    store,
    config: DEFAULT_RETENTION_CONFIG,
    now: NOW,
    isReferenced: (r) => referenced.has(r.id),
    writer,
  });

  assert.deepEqual(res.pruned, ["old-free"]);
  assert.deepEqual(res.skipped_referenced, ["old-ref"]); // never pruned a referenced row
  const remaining = (await store.all()).map((r) => r.id).sort();
  assert.deepEqual(remaining, ["old-ref", "recent"]);
});

test("AC-7.LOG.006.2 — every pruning run records a summary event (count pruned + window) — never silent", async () => {
  const store = new InMemoryEventLogStore([eventRow("g", T0 - 400 * DAY)]);
  const writer = new InMemoryEventWriteSink();
  await runEventLogRetention({ store, config: DEFAULT_RETENTION_CONFIG, now: NOW, isReferenced: () => false, writer });
  assert.equal(writer.written.length, 1);
  const rec = writer.written[0]!;
  assert.equal(rec.payload.op, "retention_prune");
  assert.equal(rec.payload.pruned_count, 1);
  assert.equal(rec.payload.window_days, DEFAULT_RETENTION_CONFIG.event_log_retention_days);
});

test("AC-7.LOG.006.3 — compliance erasure scrubs PII in event_log but retains the row + audit metadata; the erasure is logged and re-embeds no PII", async () => {
  const store = new InMemoryEventLogStore([eventRow("e1", T0, { summary: "Alice PII narrative", entity_ids: ["entity-alice"] })]);
  const writer = new InMemoryEventWriteSink();
  const res = await eraseEventLogSubject({ store, now: NOW, writer }, (r) => (r.entity_ids ?? []).includes("entity-alice"));
  assert.deepEqual(res.redacted, ["e1"]);
  const row = (await store.all())[0]!;
  assert.equal(row.summary, "[redacted]"); // PII scrubbed
  assert.equal(row.entity_ids, null);
  assert.notEqual(row.redacted_at, null);
  assert.equal(row.event_type, "task_completed"); // audit metadata RETAINED
  assert.equal(row.created_at, iso(T0));
  // the erasure log must not re-embed the PII
  const log = JSON.stringify(writer.written);
  assert.ok(!log.includes("Alice"), "erasure log re-embedded PII");
});

// ════════════════════════════════════════════════════════════════════════════════
// FR-7.LOG.007 — guardrail_log view / retention / tamper-evidence / export
// ════════════════════════════════════════════════════════════════════════════════

const SUPER_ADMIN: ViewerContext & { permissions: Set<string> } = {
  role: "super_admin",
  permissions: new Set([PERM_DOWNLOAD_RECORDS, "PERM-observability.view", "PERM-memory.view"]),
};

test("AC-7.LOG.007.1 — export over a date range returns every row (no silent truncation) in a presentable format, PERM-gated", async () => {
  const rows = [guardrailRow("a", T0 + 1 * DAY), guardrailRow("b", T0 + 2 * DAY), guardrailRow("c", T0 + 50 * DAY)];
  const store = new InMemoryGuardrailLogStore(rows);
  const exp = await exportGuardrailLog(store, { permissions: SUPER_ADMIN.permissions }, iso(T0), iso(T0 + 10 * DAY), NOW);
  assert.equal(exp.complete, true);
  assert.equal(exp.row_count, 2); // a + b in-window; c excluded — a faithful window, no invention
  assert.deepEqual(exp.records.map((r) => r.id), ["a", "b"]);
  assert.ok("guardrail_type" in exp.records[0]! && "created_at" in exp.records[0]!); // presentable projection
});

test("AC-7.LOG.007.1 — an unpermitted caller cannot export (Super Admin, unseeded)", async () => {
  const store = new InMemoryGuardrailLogStore([guardrailRow("a", T0 + 1 * DAY)]);
  await assert.rejects(
    () => exportGuardrailLog(store, { permissions: new Set(["PERM-observability.view"]) }, iso(T0), iso(T0 + 10 * DAY), NOW),
    ExportPermissionDenied,
  );
});

test("AC-7.LOG.007.2 — guardrail_log retention honours the security/audit floor; never removes a row inside the floor window", async () => {
  // The floor is a hard PROTECTION floor: the pass clamps the prune boundary UP to the floor, so even a
  // MISCONFIGURED window (shorter than the floor) can never reach a row inside the floor window. window=90d,
  // floor=120d → effective 120d; a row aged 100d is window-expired (100>90) but floor-protected (100<120) → it
  // is RETAINED. (validateRetentionConfig would reject window<floor at config time; the pass clamps anyway so a
  // mis-set window can only retain MORE, never delete floor-window audit evidence — #1/#3.)
  const cfg: RetentionConfig = {
    ...DEFAULT_RETENTION_CONFIG,
    guardrail_log_retention_days: 90,
    guardrail_log_retention_floor_days: 120,
  };
  const insideFloor = guardrailRow("floor", NOW().getTime() - 100 * DAY); // window-expired, floor-protected
  const wayOld = guardrailRow("old", NOW().getTime() - 400 * DAY); // past both window and floor → prunable
  const store = new InMemoryGuardrailLogStore([insideFloor, wayOld]);
  const writer = new InMemoryEventWriteSink();
  const res = await runGuardrailLogRetention({ store, config: cfg, now: NOW, isReferenced: () => false, writer });
  assert.ok(res.skipped_referenced.includes("floor"), "a row inside the floor window was not protected");
  assert.deepEqual(res.pruned, ["old"]);
});

test("AC-7.LOG.007.3 — tamper-evidence: a covert post-hoc content rewrite is detectable (append-only + integrity check)", async () => {
  const row = guardrailRow("g", T0);
  const store = new InMemoryGuardrailLogStore([row]);
  // (a) the append-only trigger rejects an in-place content rewrite outright
  await assert.rejects(() => store.rewriteContent("g", "tampered text"), AppendOnlyViolation);
  // (b) the integrity check flags a covert change (description mutated, redacted_at still null)
  const baselineDigest = guardrailIntegrityDigest(row);
  const tampered = { ...row, description: "secretly changed" };
  const v = verifyGuardrailIntegrity(tampered, row, baselineDigest);
  assert.equal(v.ok, false);
  assert.equal(v.classification, "tampered");
});

test("AC-7.LOG.007.4 / NFR-CMP.007 — compliance erasure tombstones guardrail_log (PII scrubbed, event retained) AND the integrity check still passes (authorized redaction ≠ tampering)", async () => {
  const row = guardrailRow("g", T0, { description: "Alice over-limit spend" });
  const baselineDigest = guardrailIntegrityDigest(row);
  const store = new InMemoryGuardrailLogStore([row]);
  const writer = new InMemoryEventWriteSink();

  const res = await eraseGuardrailLogSubject({ store, now: NOW, writer }, (r) => r.description.includes("Alice"));
  assert.deepEqual(res.redacted, ["g"]);
  const after = (await store.all())[0]!;
  assert.equal(after.description, "[redacted]"); // PII scrubbed
  assert.equal(after.guardrail_type, "approval_gate"); // security event retained
  assert.notEqual(after.redacted_at, null);
  // the tamper-evidence check DISTINGUISHES the authorized redaction from tampering (AC-7.LOG.007.3 still holds)
  const v = verifyGuardrailIntegrity(after, row, baselineDigest);
  assert.equal(v.ok, true);
  assert.equal(v.classification, "authorized_redaction");
});

// ════════════════════════════════════════════════════════════════════════════════
// NFR-CMP.009 — export all-or-nothing (fails loud on shortfall)
// ════════════════════════════════════════════════════════════════════════════════

test("AC-NFR-CMP.009.1 — a reconciliation shortfall FAILS LOUD with no partial 'complete' file (all-or-nothing, AF-133 shape)", async () => {
  const rows = [guardrailRow("a", T0 + 1 * DAY), guardrailRow("b", T0 + 2 * DAY)];
  const store = new InMemoryGuardrailLogStore(rows);
  store.induceCountSkew(1); // the independent count says 3, but only 2 rows are fetched — a shortfall
  await assert.rejects(
    () => exportGuardrailLog(store, { permissions: SUPER_ADMIN.permissions }, iso(T0), iso(T0 + 10 * DAY), NOW),
    (e: unknown) => e instanceof ExportReconciliationShortfall && e.expected === 3 && e.got === 2,
  );
});

// ════════════════════════════════════════════════════════════════════════════════
// NFR-OBS.010 — append-only + retention-pruning-logged
// ════════════════════════════════════════════════════════════════════════════════

test("AC-NFR-OBS.010.1 — retention pruning is logged (the pruning run itself is an event) — never silent", async () => {
  const store = new InMemoryGuardrailLogStore([guardrailRow("old", NOW().getTime() - 400 * DAY)]);
  const writer = new InMemoryEventWriteSink();
  await runGuardrailLogRetention({ store, config: DEFAULT_RETENTION_CONFIG, now: NOW, isReferenced: () => false, writer });
  assert.equal(writer.written.length, 1);
  assert.equal(writer.written[0]!.payload.op, "retention_prune");
});

test("AC-NFR-OBS.010.2 — an under-floor retention window is refused loudly by config validation; the pass itself clamps UP to the floor (never prunes below it)", async () => {
  const bad: RetentionConfig = { ...DEFAULT_RETENTION_CONFIG, event_log_retention_days: 30, event_log_retention_floor_days: 90 };
  // (a) config validation refuses an under-floor window loudly (#3 — the operator learns before it ships).
  assert.throws(() => validateRetentionConfig(bad), /below its audit floor/);
  // (b) even if such a config reached the pass unvalidated, the pass clamps UP to the floor — a row aged 60d
  //     (past the 30d window but inside the 90d floor) is RETAINED, never pruned below the floor (#1/#3).
  const insideFloor = eventRow("f", NOW().getTime() - 60 * DAY);
  const store = new InMemoryEventLogStore([insideFloor]);
  const res = await runEventLogRetention({ store, config: bad, now: NOW, isReferenced: () => false, writer: new InMemoryEventWriteSink() });
  assert.deepEqual(res.pruned, []); // nothing pruned below the floor
  assert.equal(res.window_days, 90); // the EFFECTIVE (floor-clamped) window was applied
  assert.equal((await store.all()).length, 1);
});

test("append-only substrate failure on read fails loud, never silently (fail-closed #3)", async () => {
  const store = new InMemoryEventLogStore([eventRow("x", T0)]);
  store.induceReadFailure("DB unreachable");
  await assert.rejects(() => runEventLogRetention({ store, config: DEFAULT_RETENTION_CONFIG, now: NOW, isReferenced: () => false, writer: new InMemoryEventWriteSink() }), SinkSubstrateFailure);
});

// ════════════════════════════════════════════════════════════════════════════════
// FR-7.MGM.001 — outbound health-reporter push (allow-list, push-not-pull, local log)
// ════════════════════════════════════════════════════════════════════════════════

class FakeTransport implements IngestTransport {
  posts: Array<{ payload: Record<string, unknown> }> = [];
  constructor(private mode: "accept" | "reject" | "throw" = "accept") {}
  async post(body: { bearer: string; payload: import("./mgm.ts").OperationalSnapshot; delivery_id: string }) {
    this.posts.push({ payload: body.payload as Record<string, unknown> });
    if (this.mode === "throw") throw new Error("connection refused");
    if (this.mode === "reject") return { accepted: false, detail: "token rotated away" };
    return { accepted: true, detail: "ok" };
  }
}

test("AC-7.MGM.001.1 — a snapshot carrying a business-data field has it rejected/dropped before send (allow-list at the reporter)", async () => {
  const raw = { health_score: 0.9, queue_depth: 3, customer_email: "alice@corp.com", memory_text: "confidential" };
  // reporter-side ASSEMBLY drops business fields
  const picked = pickOperational(raw) as Record<string, unknown>;
  assert.ok(!("customer_email" in picked) && !("memory_text" in picked));
  // ingest-side REJECTS (does not silently drop) — deny-by-default
  assert.throws(() => assertOperationalOnly(raw), BusinessDataAtBoundaryError);
  assert.deepEqual(offendingFields(raw), ["customer_email", "memory_text"]);
  // the actual push sends only operational fields
  const transport = new FakeTransport("accept");
  const localLog = new InMemoryLocalPushLog();
  const out = await pushHealthSnapshot(raw, "bearer", transport, localLog, "interval", 1000);
  assert.ok(!("customer_email" in transport.posts[0]!.payload));
  assert.deepEqual(out.dropped_business_fields, ["customer_email", "memory_text"]);
});

test("AC-7.MGM.001.2 — the model is push, not pull (the reporter only ever POSTs; no read-back path exists)", async () => {
  // Structural: IngestTransport has a single method `post` and no `get`/`pull`. A push occurs; nothing reads back.
  const transport = new FakeTransport("accept");
  const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(transport)).filter((k) => k !== "constructor");
  assert.deepEqual(methods, ["post"]); // push-only surface — no get/pull/read-back method exists
});

test("AC-7.MGM.001.3 — the reporter logs each push attempt AND failure to the LOCAL event_log", async () => {
  const localLog = new InMemoryLocalPushLog();
  // (a) unreachable plane → attempt + failure both logged locally
  await pushHealthSnapshot({ health_score: 1 }, "bearer", new FakeTransport("throw"), localLog, "interval", 1000);
  const kinds = localLog.entries.map((e) => e.event_type);
  assert.ok(kinds.includes("health_push.attempt"));
  assert.ok(kinds.includes("health_push.failure"));
  assert.equal(localLog.entries.find((e) => e.event_type === "health_push.failure")!.level, "error");
});

// ════════════════════════════════════════════════════════════════════════════════
// FR-7.MGM.002 — push staleness (stale-not-green; independent heartbeat; server-authoritative clock)
// ════════════════════════════════════════════════════════════════════════════════

const reg = (slug: string, over: Partial<RegistryCard> = {}): RegistryCard => ({
  client_slug: slug,
  client_name: slug.toUpperCase(),
  status: "active",
  railway_url: `https://${slug}.example`,
  core_version: "1.2.3",
  ...over,
});
const health = (slug: string, lastPushMs: number, over: Partial<HealthCard> = {}): HealthCard => ({
  client_slug: slug,
  health_score: 0.95,
  queue_depth: 2,
  approval_queue_depth: 1,
  alert_counts: {},
  core_version: "1.2.3",
  last_migrated_at: iso(T0),
  plugin_version: "p1",
  cost_to_date: 12.5,
  backup_health: { latest_status: "COMPLETED" },
  log_write_failing: false,
  last_push_at: iso(lastPushMs),
  ...over,
});

test("AC-7.MGM.002.1 — a deployment that stops pushing flips to stale/unreachable within the window", async () => {
  const serverNow = Math.floor((T0 + 100 * DAY) / 1000);
  const window = DEFAULT_STALENESS_CONFIG.deployment_staleness_window_s; // 900s
  const stalePushMs = (serverNow - (window + 60)) * 1000; // older than the window
  const c = evaluateLiveness(reg("acme"), health("acme", stalePushMs), serverNow, window);
  assert.equal(c.liveness, "stale");
});

test("AC-7.MGM.002.2 — a stale deployment raises a cross-deployment alert (not rendered healthy)", async () => {
  const serverNow = Math.floor((T0 + 100 * DAY) / 1000);
  const window = DEFAULT_STALENESS_CONFIG.deployment_staleness_window_s;
  const c = evaluateLiveness(reg("acme"), health("acme", (serverNow - window - 60) * 1000), serverNow, window);
  assert.equal(c.alert, true);
  const alerts = crossDeploymentAlerts([{ health: null, liveness: c }]);
  assert.ok(alerts.some((a) => a.kind === "stale"));
});

test("AC-7.MGM.002.3 — the staleness evaluator runs on an independent heartbeat; a stalled evaluator is itself surfaced (AF-118)", async () => {
  const ev = new StalenessEvaluator();
  const serverNow = Math.floor((T0 + 100 * DAY) / 1000);
  const window = DEFAULT_STALENESS_CONFIG.deployment_staleness_window_s;
  const hb = DEFAULT_STALENESS_CONFIG.evaluator_heartbeat_window_s;
  // never-run evaluator is itself an alert (meta-#3)
  assert.equal(ev.evaluatorLiveness(serverNow, hb).alert, true);
  ev.sweep([{ registry: reg("acme"), health: health("acme", serverNow * 1000) }], serverNow, window);
  assert.equal(ev.evaluatorLiveness(serverNow, hb).alert, false); // fresh sweep → alive
  // a sweep that then goes silent past the heartbeat window is surfaced
  assert.equal(ev.evaluatorLiveness(serverNow + hb + 10, hb).alert, true);
});

test("AC-7.MGM.002.4 — staleness is computed on a single server-authoritative timestamp; a lying reporter clock cannot look fresh (AF-120)", async () => {
  const serverNow = Math.floor((T0 + 100 * DAY) / 1000);
  const window = DEFAULT_STALENESS_CONFIG.deployment_staleness_window_s;
  // The deployment is genuinely dead (last STORE-stamped push is ancient). There is no reporter-time parameter
  // to evaluateLiveness, so a fast reporter clock structurally cannot enter the computation — it still reads
  // stale/unreachable. (last_push_at is server-stamped at ingest, never reporter-asserted.)
  const deadPushMs = (serverNow - 10 * window) * 1000;
  const c = evaluateLiveness(reg("acme"), health("acme", deadPushMs), serverNow, window);
  assert.equal(c.liveness, "unreachable");
  assert.equal(c.alert, true);
});

test("FR-7.MGM.002 — a frozen silo reads intentionally quiet, not a dead-deployment alert (frozen ≠ dead)", async () => {
  const serverNow = Math.floor((T0 + 100 * DAY) / 1000);
  const window = DEFAULT_STALENESS_CONFIG.deployment_staleness_window_s;
  const c = evaluateLiveness(reg("acme", { status: "frozen" }), health("acme", (serverNow - 10 * window) * 1000), serverNow, window);
  assert.equal(c.liveness, "frozen-quiet");
  assert.equal(c.alert, false);
});

// ════════════════════════════════════════════════════════════════════════════════
// FR-7.MGM.003/004/005 — cross-deployment view contracts
// ════════════════════════════════════════════════════════════════════════════════

test("AC-7.MGM.003.1 — the grid renders one card per active deployment from pushed snapshots (no business-data pull)", async () => {
  const serverNow = Math.floor((T0 + 1 * DAY) / 1000);
  const window = DEFAULT_STALENESS_CONFIG.deployment_staleness_window_s;
  const h = health("acme", serverNow * 1000, { alert_counts: { queue_backup: 2 } });
  const c = evaluateLiveness(reg("acme"), h, serverNow, window);
  const card = healthGridCard(reg("acme"), h, c);
  assert.equal(card.client_slug, "acme");
  assert.equal(card.open_alerts, 2);
  // the card carries ONLY operational metadata — assert no business-data field leaked in
  assert.deepEqual(Object.keys(card).sort(), [
    "approval_queue_depth", "click_through_url", "client_name", "client_slug", "core_version",
    "health_score", "last_active", "liveness", "open_alerts",
  ]);
});

test("AC-7.MGM.003.2 — card click-through navigates INTO the client deployment (not a mgmt-plane data copy)", async () => {
  const serverNow = Math.floor((T0 + 1 * DAY) / 1000);
  const c = evaluateLiveness(reg("acme"), health("acme", serverNow * 1000), serverNow, 900);
  const card = healthGridCard(reg("acme"), health("acme", serverNow * 1000), c);
  assert.equal(card.click_through_url, "https://acme.example"); // = client_registry.railway_url — route into the deployment
});

test("AC-7.MGM.004.1 — a critical alert in any deployment appears in the cross-deployment alert surface", async () => {
  const serverNow = Math.floor((T0 + 1 * DAY) / 1000);
  const h = health("acme", serverNow * 1000, { alert_counts: { cost_threshold_breach: 1 } });
  const c = evaluateLiveness(reg("acme"), h, serverNow, 900);
  const alerts = crossDeploymentAlerts([{ health: h, liveness: c }]);
  assert.ok(alerts.some((a) => a.kind === "cost_threshold_breach"));
});

test("AC-7.MGM.004.2 — the CI/CD panel shows per-deployment core version + last-push status", async () => {
  const serverNow = Math.floor((T0 + 1 * DAY) / 1000);
  const window = 900;
  const h = health("acme", (serverNow - 5 * window) * 1000); // stale → push_failing
  const c = evaluateLiveness(reg("acme"), h, serverNow, window);
  const row = ciCdRow(reg("acme"), h, c);
  assert.equal(row.core_version, "1.2.3");
  assert.equal(row.push_failing, true);
});

test("AC-7.MGM.005.1 — backup-health is visible sourced from the Supabase Management API (no business data crosses)", async () => {
  const api = new StubSupabaseBackupApi({ "acme-ref": [{ status: "COMPLETED", inserted_at: iso(T0) }] });
  const bh = await readBackupHealth(api, "acme-ref");
  assert.equal(bh.source, "supabase-management-api");
  assert.equal(bh.latest_status, "COMPLETED");
  const card = backupHealthCard(reg("acme"), health("acme", T0, { backup_health: bh }));
  assert.equal(card.source, "supabase-management-api");
  // structural: the backup rollup carries only status/freshness metadata, no business keys
  assert.deepEqual(Object.keys(bh).sort(), ["backup_count", "latest_at", "latest_status", "project_ref", "source"]);
});

test("AC-7.MGM.005.2 — the cost overview aggregates per-deployment estimated cost with trend, labelled estimate-grade", async () => {
  const rows = [
    costOverviewRow(reg("acme"), health("acme", T0, { cost_to_date: 10 })),
    costOverviewRow(reg("globex"), health("globex", T0, { cost_to_date: 15 })),
  ];
  assert.ok(rows.every((r) => r.grade === "estimate"));
  const ov = costOverview(rows, 20);
  assert.equal(ov.total_estimate, 25);
  assert.equal(ov.grade, "estimate");
  assert.equal(ov.trend, "up");
});

// ════════════════════════════════════════════════════════════════════════════════
// FR-7.VIEW.001/002/003 — dashboard data contracts
// ════════════════════════════════════════════════════════════════════════════════

test("AC-7.VIEW.001.1 — every named panel maps to a producing-component FR (no C7-invented signal)", () => {
  assert.deepEqual(panelsWithoutProducer(), []);
  assert.ok(OPS_DASHBOARD_PANELS.every((p) => p.producing_component && p.source_fr));
});

test("AC-7.VIEW.001.2 — silent-failure indicators are driven by the LOG.003 completeness gap (terminal task, no terminal event)", () => {
  const terminal = [
    { task_id: "t1", status: "completed" as const },
    { task_id: "t2", status: "failed" as const }, // no terminal event → silent failure
  ];
  const haveEvent = new Set(["t1"]);
  const ind = silentFailureIndicators(terminal, haveEvent);
  assert.deepEqual(ind.map((i) => i.task_id), ["t2"]);
});

test("AC-7.VIEW.001.3 — the self-improvement panel sources C9 Insight suggestions (C7 does not generate them)", () => {
  const panel = OPS_DASHBOARD_PANELS.find((p) => p.panel === "self_improvement")!;
  assert.equal(panel.producing_component, "C9");
  assert.ok(panel.source_fr.startsWith("FR-9."));
});

test("AC-7.VIEW.002.1 — a role sees only the panels its C1 permissions allow; an unpermitted signal is not rendered", () => {
  const viewer: ViewerContext = { role: "standard_user", permissions: new Set(["PERM-observability.view"]) };
  const visible = panelsForViewer(viewer).map((p) => p.panel);
  assert.ok(visible.includes("event_log")); // permitted
  assert.ok(!canViewPanel(viewer, "erosion_risk")); // memory panel needs PERM-memory.view — NOT rendered
});

test("AC-7.VIEW.002.2 — every AI-output item carries its answer-mode pill; an unlabelled AI output fails loud", () => {
  const rendered = renderActivityFeed([
    { id: "1", is_ai_output: true, answer_mode: "cited", text: "..." },
    { id: "2", is_ai_output: false, answer_mode: null, text: "human msg" },
  ]);
  assert.equal(rendered[0]!.pill, "cited");
  assert.equal(rendered[1]!.pill, null); // non-AI item: no pill
  // an AI output missing its pill is a #3 trust hole → fail loud
  assert.throws(() => renderActivityFeed([{ id: "3", is_ai_output: true, answer_mode: null, text: "..." }]), MissingAnswerModePill);
});

test("AC-7.VIEW.003.1 — a hard-limit push is immediate and NOT suppressible", async () => {
  const subs = new InMemoryPushSubscriptionStore([{ id: "s1", user_id: "u1", endpoint: "e", keys: {}, platform: "ios", last_seen: iso(T0) }]);
  const d = await routeMobilePush("hard_limit", "u1", subs, { suppressUserRequested: true }); // user tried to mute
  assert.equal(d.deliver, true); // still delivered
  assert.equal(d.immediate, true);
  assert.equal(d.targets.length, 1);
});

test("AC-7.VIEW.003.2 — pending/stale-approval push frequencies are configurable per user (suppressible + frequency-gated)", async () => {
  const subs = new InMemoryPushSubscriptionStore([{ id: "s1", user_id: "u1", endpoint: "e", keys: {}, platform: "ios", last_seen: iso(T0) }]);
  const suppressed = await routeMobilePush("pending_approval", "u1", subs, { suppressUserRequested: true });
  assert.equal(suppressed.deliver, false);
  const notDue = await routeMobilePush("pending_approval", "u1", subs, { dueByFrequency: false });
  assert.equal(notDue.deliver, false);
  const due = await routeMobilePush("pending_approval", "u1", subs, { dueByFrequency: true });
  assert.equal(due.deliver, true);
});

// ════════════════════════════════════════════════════════════════════════════════
// FR-7.OPT.001/002 — feedback flywheel + benchmarking substrate
// ════════════════════════════════════════════════════════════════════════════════

test("AC-7.OPT.001.1 — each of the four signal classes is durably recorded and retrievable for review", async () => {
  const store = new InMemoryReviewSignalStore();
  let n = 0;
  for (const cls of REVIEW_SIGNAL_CLASSES) {
    await store.capture({ class: cls, source_ref: `event-${cls}`, task_id: "t1", detail: `${cls} signal` }, `sig-${++n}`, iso(T0));
  }
  assert.deepEqual(await missingSignalClasses(store), []); // all four present
  assert.equal((await store.byClass("rejection")).length, 1); // retrievable by class
  // a signal without a source row is refused (never orphaned — #1)
  await assert.rejects(() => store.capture({ class: "approval", source_ref: "", task_id: null, detail: "x" }, "bad", iso(T0)), /never orphaned/);
});

test("AC-7.OPT.002.1 — the v1 per-deployment benchmarkable substrate (cost-per-task-type + outcome/health) is captured, estimate-grade", () => {
  const rows: BenchmarkSubstrateRow[] = [
    { task_type: "scheduled", cost_per_task_estimate: 0.02, cost_grade: "estimate", success_rate: 0.98, health_score: 0.95, sample_size: 100, captured_at: iso(T0) },
  ];
  const sub = buildBenchmarkSubstrate(rows);
  assert.equal(sub.scope, "per_deployment");
  assert.equal(sub.rows[0]!.cost_grade, "estimate");
});

test("AC-7.OPT.002.2 — no v1 surface claims cross-deployment benchmarking is live (OOS-029 held)", () => {
  const sub = buildBenchmarkSubstrate([]);
  assert.equal(sub.cross_deployment_comparison, "deferred_oos_029");
  assert.doesNotThrow(() => assertNoCrossDeploymentClaim(sub));
  // a substrate that tried to imply cross-deployment comparison would fail the guard
  assert.throws(() => assertNoCrossDeploymentClaim({ ...sub, cross_deployment_comparison: "live" as unknown as "deferred_oos_029" }), /cross-deployment/);
});

// ════════════════════════════════════════════════════════════════════════════════
// third-sink floor parity + staleness CFG validity (supporting gates)
// ════════════════════════════════════════════════════════════════════════════════

test("third-sink retention floor parity — config_audit_log carries a floor read alongside the other two sinks (OD-072)", async () => {
  // config_audit_log governance is ISSUE-010; here we only assert the retention config exposes its floor so the
  // parity check ('all three sinks ≥ floor') is possible without inventing a numeric legal minimum.
  const c = validateRetentionConfig(DEFAULT_RETENTION_CONFIG);
  assert.ok(c.config_audit_log_retention_days >= c.config_audit_log_retention_floor_days);
  new InMemoryConfigAuditLogStore([]); // the read port exists for the parity read (ISSUE-010 governs writes)
});

test("staleness CFG: the window must exceed the push interval (a healthy deployment is never falsely stale)", () => {
  assert.doesNotThrow(() => validateStalenessConfig(DEFAULT_STALENESS_CONFIG));
  assert.throws(() => validateStalenessConfig({ ...DEFAULT_STALENESS_CONFIG, deployment_staleness_window_s: 10, push_interval_s: 30 }), /must exceed/);
});
