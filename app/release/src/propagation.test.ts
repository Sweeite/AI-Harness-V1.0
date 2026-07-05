// ISSUE-081 §4 Definition of done — one test per AC (text read in the FR, Rule 0). The fleet
// orchestration is fully offline-provable here with the house port+fake pattern; the per-deployment
// migrate mechanism itself is ISSUE-008's `@harness/silo` (already proven LIVE, session 62), and the
// live Pre-Deploy-Command wiring (a green release migrates+cuts over; a failing migration blocks cutover
// with the prior version live) is the two-party capstone (§9). The expand-contract AUTHORING gate
// (AC-NFR-INF.002.1) is proven by app/silo/src/discipline.test.ts (ISSUE-008) — cited, not re-tested.
//
//   AC-10.MIG.001.1  — each deployment migrates its OWN Supabase, independently.
//   AC-10.MIG.001.2  — identical migration files across the fleet (no per-client fork).
//   AC-10.MIG.002.1  — a failure halts that deployment (prior version live), alert fires, others OK; re-runnable.
//   AC-10.MIG.002.2  — never silent: the stuck deployment surfaces (alert + skew view).
//   AC-NFR-INF.002.2 — a vN and a vN-1 deployment are both correct against their own schema (AF-065 🟢).
//   AC-NFR-INF.005.1 — a forced migration failure in one silo halts+logs+alerts that silo only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  propagateRelease,
  type DeploymentMigrator,
  type MigrationCorpus,
  type FleetDeployment,
} from "./propagation.ts";
import { loadFleetCorpus } from "./corpus.ts";
import { evaluateSkew } from "./skew.ts";
import { InMemoryAlertSink, type DeploymentHealthRow } from "./store.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SILO_MIGRATIONS = join(HERE, "..", "..", "silo", "migrations");

const NOW = 1_800_000_000_000; // fixed epoch ms — deterministic (no Date.now in tests)

// The fleet corpus for a release (fingerprint filled by the test; a fixed default keeps the fakes simple).
function corpus(release: string, fingerprint = "fp-shared", tags: string[] = ["0001", "0002"]): MigrationCorpus {
  return { release, fingerprint, tags };
}

// A per-deployment migrator fake (the port). Records that IT was asked to migrate (own Supabase), applies
// the corpus's fingerprint on success, or throws (fail-loud) when `fail` is set. Idempotency is modelled:
// once migrated, a re-run reports `applied: []` (mirrors @harness/silo runMigrations on a migrated DB).
class FakeMigrator implements DeploymentMigrator {
  calls = 0;
  migratedFingerprint: string | null = null;
  constructor(
    private readonly opts: { fail?: boolean; appliedFingerprint?: string } = {},
  ) {}
  async migrate(c: MigrationCorpus) {
    this.calls++;
    if (this.opts.fail) throw new Error("relation \"config_values\" already exists (forced)");
    const fp = this.opts.appliedFingerprint ?? c.fingerprint;
    const alreadyMigrated = this.migratedFingerprint === fp;
    this.migratedFingerprint = fp;
    return { appliedFingerprint: fp, applied: alreadyMigrated ? [] : [...c.tags] };
  }
}

function deployment(slug: string, migrator: DeploymentMigrator, priorVersion: string | null = "v1"): FleetDeployment {
  return { client_slug: slug, migrator, priorVersion };
}

// ── AC-10.MIG.001.1 — each deployment migrates its OWN Supabase, independently ──────────────────────
test("AC-10.MIG.001.1 — each deployment runs its migrate against its own Supabase, independently", async () => {
  const a = new FakeMigrator();
  const b = new FakeMigrator();
  const c = new FakeMigrator();
  const sink = new InMemoryAlertSink();
  const report = await propagateRelease({
    corpus: corpus("v2"),
    deployments: [deployment("acme", a), deployment("globex", b), deployment("initech", c)],
    sink,
    now: NOW,
  });
  // Every deployment migrated exactly once, through its OWN migrator (no shared driver/connection).
  assert.equal(a.calls, 1);
  assert.equal(b.calls, 1);
  assert.equal(c.calls, 1);
  assert.deepEqual(report.migrated, ["acme", "globex", "initech"]);
  assert.ok(report.fleetClean);
  for (const r of report.results) assert.equal(r.liveVersion, "v2");
});

// ── AC-10.MIG.001.2 — identical migration files across the fleet, no per-client fork ────────────────
test("AC-10.MIG.001.2 — one shared corpus is fanned identically; every deployment applies the same fingerprint", async () => {
  const migrators = [new FakeMigrator(), new FakeMigrator(), new FakeMigrator()];
  const sink = new InMemoryAlertSink();
  const shared = corpus("v2", "fp-abc123");
  const report = await propagateRelease({
    corpus: shared,
    deployments: migrators.map((m, i) => deployment(`c${i}`, m)),
    sink,
    now: NOW,
  });
  // No per-client corpus parameter exists — the SAME fingerprint reached every deployment.
  assert.equal(report.fingerprint, "fp-abc123");
  assert.equal(report.forked.length, 0);
  assert.ok(report.results.every((r) => r.status === "migrated"));
});

test("AC-10.MIG.001.2 — a deployment that applied a DIVERGENT (forked) corpus is surfaced, never silently accepted (#2)", async () => {
  const good = new FakeMigrator();
  const forked = new FakeMigrator({ appliedFingerprint: "fp-CLIENT-FORK" }); // applied a different schema
  const sink = new InMemoryAlertSink();
  const report = await propagateRelease({
    corpus: corpus("v2", "fp-shared"),
    deployments: [deployment("acme", good), deployment("rogue", forked)],
    sink,
    now: NOW,
  });
  assert.deepEqual(report.migrated, ["acme"]);
  assert.deepEqual(report.forked, ["rogue"]);
  assert.ok(!report.fleetClean);
  // The fork raised a fail-loud alert and did NOT advance the rogue deployment's live version.
  const rogue = report.results.find((r) => r.client_slug === "rogue")!;
  assert.equal(rogue.liveVersion, "v1"); // prior version, not v2
  assert.equal(sink.emitted.filter((a) => a.client_slug === "rogue" && a.kind === "migration_failure").length, 1);
});

test("AC-10.MIG.001.2 — the fleet fingerprint is derived from the ONE repo migrations dir (real corpus)", () => {
  const c1 = loadFleetCorpus(SILO_MIGRATIONS, "v2");
  const c2 = loadFleetCorpus(SILO_MIGRATIONS, "v2");
  // Deterministic + non-empty: two builds of the same dir agree (identical files ⇒ identical fingerprint).
  assert.equal(c1.fingerprint, c2.fingerprint);
  assert.equal(c1.fingerprint.length, 64); // sha256 hex
  assert.ok(c1.tags.includes("0001_baseline"));
  assert.ok(c1.tags.length >= 5); // 0001..0005 at least (session 66 head)
});

// ── AC-10.MIG.002.1 / NFR-INF.005.1 — failure halts THAT silo only; prior version live; alert; no cascade ─
test("AC-10.MIG.002.1 / AC-NFR-INF.005.1 — a migration failure halts only that deployment; prior version live; others unaffected", async () => {
  const a = new FakeMigrator();
  const bad = new FakeMigrator({ fail: true });
  const c = new FakeMigrator();
  const sink = new InMemoryAlertSink();
  const report = await propagateRelease({
    corpus: corpus("v2"),
    deployments: [deployment("acme", a, "v1"), deployment("globex", bad, "v1"), deployment("initech", c, "v1")],
    sink,
    now: NOW,
  });
  // Only globex halted; it stays on v1 (prior version live); acme + initech migrated to v2 (no cascade).
  assert.deepEqual(report.halted, ["globex"]);
  assert.deepEqual(report.migrated, ["acme", "initech"]);
  const globex = report.results.find((r) => r.client_slug === "globex")!;
  assert.equal(globex.status, "halted");
  assert.equal(globex.liveVersion, "v1"); // prior version left live — never a half-applied unknown state
  assert.deepEqual(globex.applied, []);
  // The other two ran to completion despite the failure in the middle (loop never aborted).
  assert.equal(a.calls, 1);
  assert.equal(c.calls, 1);
  // A fail-loud alert fired for the halted silo (#3 — never silent).
  const alerts = sink.emitted.filter((x) => x.client_slug === "globex");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]!.kind, "migration_failure");
  assert.match(alerts[0]!.detail, /halted/);
});

test("AC-10.MIG.002.1 — a halted deployment is safe to re-run: a retry migrates it cleanly; migrated peers are idempotent no-ops", async () => {
  const acme = new FakeMigrator();
  // globex fails round 1, is healthy round 2 (models a fixed migration / transient outage cleared).
  let globexShouldFail = true;
  const globex: DeploymentMigrator = {
    calls: 0 as number,
    async migrate(c: MigrationCorpus) {
      (this as { calls: number }).calls++;
      if (globexShouldFail) throw new Error("forced round-1 failure");
      return { appliedFingerprint: c.fingerprint, applied: [...c.tags] };
    },
  } as DeploymentMigrator & { calls: number };
  const sink = new InMemoryAlertSink();
  const c = corpus("v2");

  const round1 = await propagateRelease({
    corpus: c,
    deployments: [deployment("acme", acme, "v1"), deployment("globex", globex, "v1")],
    sink,
    now: NOW,
  });
  assert.deepEqual(round1.halted, ["globex"]);
  assert.deepEqual(round1.migrated, ["acme"]);

  // Retry (the re-runnable deploy). acme is already migrated ⇒ idempotent no-op ([]) ; globex now succeeds.
  globexShouldFail = false;
  const round2 = await propagateRelease({
    corpus: c,
    deployments: [deployment("acme", acme, "v2"), deployment("globex", globex, "v1")],
    sink,
    now: NOW,
  });
  assert.deepEqual(round2.migrated, ["acme", "globex"]);
  assert.ok(round2.fleetClean);
  const acmeR2 = round2.results.find((r) => r.client_slug === "acme")!;
  assert.deepEqual(acmeR2.applied, []); // idempotent — nothing re-applied on the already-migrated silo
});

// ── AC-10.MIG.002.2 — never silent: the stuck silo surfaces via alert AND the skew view ─────────────
test("AC-10.MIG.002.2 — a stuck silo surfaces both as a direct alert and as a laggard in the skew view", async () => {
  const acme = new FakeMigrator();
  const stuck = new FakeMigrator({ fail: true });
  const sink = new InMemoryAlertSink();
  const report = await propagateRelease({
    corpus: corpus("v3"),
    deployments: [deployment("acme", acme, "v2"), deployment("stuck", stuck, "v2")],
    sink,
    now: NOW,
  });
  // (1) Direct fail-loud alert at propagation time.
  assert.equal(sink.emitted.filter((a) => a.client_slug === "stuck" && a.kind === "migration_failure").length, 1);

  // (2) The stuck silo stayed on v2 while the fleet head moved to v3 ⇒ it surfaces as a laggard in the
  // ISSUE-080 skew view (its version never advanced because the deploy halted). No skew is silently hidden.
  const rows: DeploymentHealthRow[] = report.results.map((r) => ({
    client_slug: r.client_slug,
    core_version: r.liveVersion,
    last_migrated_at: null,
    plugin_version: null,
    last_push_at: new Date(NOW).toISOString(),
  }));
  const skew = evaluateSkew({
    rows,
    releaseOrder: ["v1", "v2", "v3"],
    config: { deploy_max_version_skew: 0, deploy_max_skew_days: 14 },
    now: NOW,
  });
  assert.equal(skew.fleetHeadVersion, "v3");
  assert.ok(skew.alerts.some((a) => a.client_slug === "stuck" && a.kind === "version_skew"));
});

// ── AC-NFR-INF.002.2 — a vN and a vN-1 deployment are both correct against their OWN schema (AF-065 🟢) ─
test("AC-NFR-INF.002.2 — a partial rollout leaves a mixed vN/vN-1 fleet, each deployment consistent on its own version", async () => {
  // Rollout in progress: acme's deploy triggered (→ v2); globex's has NOT yet (stays v1). Both are valid
  // states — expand-contract (discipline-gated, AC-NFR-INF.002.1) makes the v2 schema backwards-compatible
  // with v1 code, and AF-065 🟢 (live, session 62) proves the prior code is correct against the newer
  // schema. Here we assert the fleet TOPOLOGY: the two versions coexist with no shared/cross state.
  const acme = new FakeMigrator();
  const sink = new InMemoryAlertSink();
  const report = await propagateRelease({
    corpus: corpus("v2"),
    deployments: [deployment("acme", acme, "v1")], // globex simply isn't in this rollout batch yet
    sink,
    now: NOW,
  });
  const acmeVersion = report.results.find((r) => r.client_slug === "acme")!.liveVersion; // v2
  const globexVersion = "v1"; // un-triggered deployment, still serving prior version against its own DB
  assert.equal(acmeVersion, "v2");
  assert.notEqual(acmeVersion, globexVersion); // a mixed-version fleet is a NORMAL, safe rollout state
  assert.equal(sink.emitted.length, 0); // a partial rollout is not a failure — no alert
});

// ── Isolation is structural: an empty fleet and a single-deployment fleet both behave ───────────────
test("propagation over an empty fleet is a clean no-op (no deployments, no alerts)", async () => {
  const sink = new InMemoryAlertSink();
  const report = await propagateRelease({ corpus: corpus("v2"), deployments: [], sink, now: NOW });
  assert.ok(report.fleetClean);
  assert.deepEqual(report.results, []);
  assert.equal(sink.emitted.length, 0);
});
