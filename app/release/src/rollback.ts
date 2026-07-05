// ISSUE-080 §8 step 4 — rollback = code-redeploy of the prior Railway build; schema rolls FORWARD only
// (FR-10.DEP.003, NFR-INF.003). Migrations are NEVER auto-un-applied — a bad schema change is corrected
// by a roll-forward migration, never a destructive production down-migration. Expand-contract
// (NFR-INF.002, owned by ISSUE-081) is what keeps the prior build correct against the newer schema; this
// slice consumes that premise and asserts the two structural invariants the rollback path depends on.

import { readdirSync } from "node:fs";

/** A rollback is a redeploy of a prior build id; the schema is explicitly NOT rolled back. */
export interface RollbackPlan {
  action: "redeploy_prior_build";
  /** The prior Railway build to redeploy (per-deployment or fleet). */
  priorBuildId: string;
  /** Always false — un-migrating the schema is ruled out (ADR-005 §4). */
  schemaTouched: false;
  detail: string;
}

/**
 * Plan a rollback (AC-10.DEP.003.1 / AC-NFR-INF.003.1): redeploy the prior Railway build; the schema is
 * left unchanged (the prior code runs against the newer, additive schema by expand-contract). Throws on
 * a missing prior build — there is nothing to redeploy, and guessing a target is a #3 hazard.
 */
export function planRollback(priorBuildId: string | null | undefined): RollbackPlan {
  if (!priorBuildId || priorBuildId.trim() === "") {
    throw new Error("cannot roll back — no prior Railway build id (nothing to redeploy)");
  }
  return {
    action: "redeploy_prior_build",
    priorBuildId,
    schemaTouched: false,
    detail: `redeploy prior build ${priorBuildId}; schema unchanged (forward-only) — the prior code runs against the current additive schema`,
  };
}

// A "down migration" reverse path is a SQL migration artifact that undoes a prior one: a `*.down.sql`
// file, or a `.sql` file whose name declares a rollback/revert/undo/downgrade, or any `.sql` under a
// `down/` directory. The scan is scoped to `.sql` (migration files) so it never false-positives on
// source modules (e.g. this file, `rollback.ts`). Its ABSENCE is AC-NFR-INF.003.2.
// Non-letter boundaries (so `_`, `-`, `.`, digits delimit) — `\b` fails here since `_` is a word char,
// which would miss `0002_rollback.sql`. Won't match embeddings like "undocumented" (trailing letter).
const REVERSE_WORD = /(^|[^a-z])(rollback|revert|undo|downgrade)([^a-z]|$)/i;

/** Pure predicate: is this filename a down-migration reverse-path SQL artifact? (Unit-testable, no fs.) */
export function isDownMigrationName(name: string): boolean {
  if (!/\.sql$/i.test(name)) return false;
  return /\.down\.sql$/i.test(name) || REVERSE_WORD.test(name);
}

/** Scan a migrations directory for any down-migration reverse-path artifact (recursive, one level). */
export function findDownMigrations(migrationsDir: string): string[] {
  const offenders: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(migrationsDir, { withFileTypes: true });
  } catch {
    // No migrations dir => vacuously no down-migration script.
    return offenders;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      // Anything under a `down/` directory is a reverse path; otherwise scan its `.sql` children.
      const underDown = e.name.toLowerCase() === "down";
      for (const child of readdirSync(`${migrationsDir}/${e.name}`)) {
        if ((underDown && /\.sql$/i.test(child)) || isDownMigrationName(child)) offenders.push(`${e.name}/${child}`);
      }
      continue;
    }
    if (isDownMigrationName(e.name)) offenders.push(e.name);
  }
  return offenders;
}

export interface DownMigrationVerdict {
  ok: boolean;
  offenders: string[];
  reason: string;
}

/**
 * Assert no down-migration script exists as a reverse path (AC-NFR-INF.003.2 / AC-10.DEP.003.2).
 * Returns a verdict (never throws) so a caller can surface it as a build-time gate finding.
 */
export function assertNoDownMigration(migrationsDir: string): DownMigrationVerdict {
  const offenders = findDownMigrations(migrationsDir);
  return offenders.length === 0
    ? { ok: true, offenders, reason: "no down-migration script exists — schema is forward-only (AC-NFR-INF.003.2)" }
    : {
        ok: false,
        offenders,
        reason: `down-migration reverse path(s) found (forbidden — schema rolls forward only): ${offenders.join(", ")}`,
      };
}
