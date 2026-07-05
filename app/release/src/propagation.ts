// ISSUE-081 — Schema-migration propagation across the fleet + per-deployment failure isolation.
//
// The single-silo migrate runner (idempotent, fail-loud, transactional/non-transactional split) is
// ISSUE-008's `@harness/silo` `runMigrations` — already proven LIVE (session 62). ISSUE-080 owns the
// per-project auto-deploy TRIGGER + the version-skew view. THIS slice sits on top and models the
// FLEET-level behaviour ISSUE-008/080 do not:
//
//   FR-10.MIG.001 — on release, EACH deployment runs the ONE shared, identical migration set against
//                   its OWN Supabase, independently; no per-client schema fork (per-client variation is
//                   env config + /plugins only, ADR-001 §2). N independent runs of identical files.
//   FR-10.MIG.002 — a migration failure HALTS ONLY that deployment (prior version left live), is safe to
//                   re-run, fires a fail-loud alert, surfaces the stuck silo in the skew view, and cannot
//                   cascade (structural: a separate Supabase per silo, ADR-001 §3). Never silent (#3).
//   NFR-INF.002   — expand-contract keeps a `vN`/`vN-1` mixed fleet safe (the discipline gate that
//                   ENFORCES this authoring rule is ISSUE-008's `@harness/silo` discipline.ts, wired into
//                   silo `check` in CI; the behavioural safety is AF-065 🟢, live-proven session 62).
//   NFR-INF.005   — per-deployment migration-failure isolation (no fleet-wide abort).
//
// House pattern: each deployment migrates through an injected `DeploymentMigrator` PORT (its own Supabase
// = its own migrator). The live adapter runs `@harness/silo` migrate against that deployment's
// DATABASE_URL (the Railway Pre-Deploy Command, `cd app/silo && npm run migrate` — AF-020 F11: Pre-Deploy
// blocks cutover on failure = the halt). The in-memory fake injects success/failure so the fleet
// orchestration is unit-testable with zero live infra. The migration-failure signal is emitted through
// ISSUE-080's `AlertSink` (the C7 seam) — one shared seam, not a second alert path.

import type { AlertSink } from "./store.ts";

/**
 * The ONE shared migration corpus, authored once (ISSUE-008) and fanned IDENTICALLY to every deployment.
 * `fingerprint` is a content hash over the ordered (tag, checksum) pairs of the journal — two deployments
 * that migrated the identical files share a fingerprint; a per-client FORK would differ, and a fork is a
 * #2 violation (a client silently running a different schema), never silently accepted (AC-10.MIG.001.2).
 */
export interface MigrationCorpus {
  /** The release version this corpus brings a deployment to (the fleet target). */
  release: string;
  /** Content fingerprint of the ordered migration set — identical across the fleet by construction. */
  fingerprint: string;
  /** Ordered migration tags (oldest→newest) — for surfacing, not identity (the fingerprint is identity). */
  tags: readonly string[];
}

/** What a single deployment's migrate reports on success. A failure is signalled by a THROW (fail-loud). */
export interface DeploymentMigrateOutcome {
  /** The fingerprint the deployment actually applied — asserted === the fleet corpus (no-fork guard). */
  appliedFingerprint: string;
  /** Tags applied this run (empty on an already-migrated re-run — idempotent, ISSUE-008). */
  applied: readonly string[];
}

/**
 * One deployment's migrate against its OWN Supabase (the port). The live adapter wraps `@harness/silo`
 * `runMigrations` against this deployment's DATABASE_URL; the fake injects outcomes. It MUST throw on a
 * migration failure (never return a partial-success — the runner records nothing partial, ISSUE-008 #3).
 */
export interface DeploymentMigrator {
  migrate(corpus: MigrationCorpus): Promise<DeploymentMigrateOutcome>;
}

/** A fleet member: its client identity, its own migrator (own Supabase), and the version it is live on now. */
export interface FleetDeployment {
  client_slug: string;
  migrator: DeploymentMigrator;
  /** The version currently live and serving — left untouched if this deployment's migrate halts. */
  priorVersion: string | null;
}

export type PropagationStatus =
  | "migrated" // clean: advanced to corpus.release against its own Supabase
  | "halted" // migrate failed → prior version stays live; alerted; safe to re-run
  | "forked"; // applied a corpus whose fingerprint ≠ the fleet's → a #2 fork, surfaced not accepted

export interface DeploymentResult {
  client_slug: string;
  status: PropagationStatus;
  /** The version now live for this deployment after propagation (release on success, priorVersion on halt). */
  liveVersion: string | null;
  applied: readonly string[];
  /** Present only when status !== "migrated" — the halt/fork reason (never swallowed). */
  reason?: string;
}

export interface PropagationReport {
  release: string;
  fingerprint: string;
  results: DeploymentResult[];
  migrated: string[]; // client_slugs that advanced cleanly
  halted: string[]; // client_slugs that failed → prior version live + alerted
  forked: string[]; // client_slugs that applied a divergent corpus → surfaced
  /** True iff every deployment migrated cleanly. A halt/fork makes this false — the fleet is mixed-version. */
  fleetClean: boolean;
}

/**
 * Propagate a release across the fleet (FR-10.MIG.001 / FR-10.MIG.002). Each deployment migrates its OWN
 * Supabase INDEPENDENTLY through its own migrator; a failure is caught PER-DEPLOYMENT so it halts only
 * that silo (prior version live) and NEVER aborts the loop or touches another deployment (NFR-INF.005).
 * Every halt/fork raises a fail-loud `migration_failure` alert through the C7 sink — never silent (#3).
 *
 * The identical-files/no-fork invariant (AC-10.MIG.001.2) is structural: ONE `corpus` is fanned to every
 * deployment (there is no per-client corpus parameter), and each deployment's applied fingerprint is
 * asserted === the fleet fingerprint — a divergent one is surfaced as `forked`, not accepted.
 *
 * Pure orchestration: it does not read the clock or mutate global state; `now` is injected for the alert
 * detail only. Re-runnability (AC-10.MIG.002.1) is the underlying runner's idempotency (ISSUE-008): a
 * second `propagateRelease` with a previously-halted deployment now healthy migrates it cleanly while the
 * already-migrated deployments are no-ops (`applied: []`).
 */
export async function propagateRelease(input: {
  corpus: MigrationCorpus;
  deployments: readonly FleetDeployment[];
  sink: AlertSink;
  now: number;
}): Promise<PropagationReport> {
  const { corpus, deployments, sink, now } = input;
  const results: DeploymentResult[] = [];

  for (const d of deployments) {
    // Each iteration is fully isolated: a throw here can only affect THIS deployment. There is no shared
    // migrator/connection across deployments — the structural no-cascade guarantee (ADR-001 §3 silo model).
    try {
      const outcome = await d.migrator.migrate(corpus);

      if (outcome.appliedFingerprint !== corpus.fingerprint) {
        // The deployment applied a DIFFERENT corpus than the fleet's — a per-client schema fork. Never
        // silently accept it (#2): surface it, leave it flagged, alert. Prior version is NOT advanced.
        const reason =
          `deployment applied migration fingerprint '${outcome.appliedFingerprint}' ≠ fleet fingerprint ` +
          `'${corpus.fingerprint}' — a per-client schema fork is forbidden (ADR-001 §2; AC-10.MIG.001.2)`;
        results.push({
          client_slug: d.client_slug,
          status: "forked",
          liveVersion: d.priorVersion,
          applied: outcome.applied,
          reason,
        });
        await sink.emit({
          client_slug: d.client_slug,
          kind: "migration_failure",
          detail: `schema fork detected at ${new Date(now).toISOString()}: ${reason}`,
          observed: 0,
          bound: 0,
        });
        continue;
      }

      results.push({
        client_slug: d.client_slug,
        status: "migrated",
        liveVersion: corpus.release,
        applied: outcome.applied,
      });
    } catch (err) {
      // FR-10.MIG.002 — this deployment HALTS: prior version stays live (we do NOT advance liveVersion),
      // a migration-failure alert fires, and the loop continues so every OTHER deployment is unaffected.
      const reason = err instanceof Error ? err.message : String(err);
      results.push({
        client_slug: d.client_slug,
        status: "halted",
        liveVersion: d.priorVersion, // prior version left live — never a half-applied unknown state
        applied: [],
        reason,
      });
      await sink.emit({
        client_slug: d.client_slug,
        kind: "migration_failure",
        detail:
          `migration to ${corpus.release} failed at ${new Date(now).toISOString()} — deployment halted, ` +
          `prior version ${d.priorVersion ?? "(none)"} left live, safe to re-run: ${reason}`,
        observed: 0,
        bound: 0,
      });
    }
  }

  const migrated = results.filter((r) => r.status === "migrated").map((r) => r.client_slug);
  const halted = results.filter((r) => r.status === "halted").map((r) => r.client_slug);
  const forked = results.filter((r) => r.status === "forked").map((r) => r.client_slug);

  return {
    release: corpus.release,
    fingerprint: corpus.fingerprint,
    results,
    migrated,
    halted,
    forked,
    fleetClean: halted.length === 0 && forked.length === 0,
  };
}
