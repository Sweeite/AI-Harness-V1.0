// The migrate runner — the `drizzle-kit migrate` role, implemented directly over the repo's proven
// Postgres access path (OD-176). It applies pending migrations in journal order, tracks them in a
// `_migrations` table, honours the transactional/non-transactional split, and is idempotent +
// fail-loud: a re-run applies nothing already applied; a failure halts and never records a partial
// migration as done (#3). The DB is behind the `MigrationDriver` port so the orchestration is unit-
// testable with zero live infra (the established app/provisioning Infra-port pattern).

import type { Journal, MigrationFile } from "./journal.ts";
import { assertContiguous, MigrationError, planPending } from "./plan.ts";

export interface MigrationDriver {
  ensureTracking(): Promise<void>;
  appliedTags(): Promise<Set<string>>;
  /** Apply inside a single transaction: run the SQL and record the tracking row atomically. */
  applyTransactional(file: MigrationFile): Promise<void>;
  /** Apply with autocommit (no BEGIN/COMMIT) — for CREATE INDEX CONCURRENTLY. Idempotent per statement. */
  applyNonTransactional(file: MigrationFile): Promise<void>;
}

export interface MigrateResult {
  applied: string[]; // tags applied this run (empty on a fully-migrated re-run)
  alreadyApplied: string[];
}

export async function runMigrations(
  driver: MigrationDriver,
  journal: Journal,
  files: Map<string, MigrationFile>,
): Promise<MigrateResult> {
  await driver.ensureTracking();
  const applied = await driver.appliedTags();
  assertContiguous(journal.entries, applied); // fail loud on diverged history

  const pending = planPending(journal.entries, applied);
  const appliedNow: string[] = [];
  for (const entry of pending) {
    const file = files.get(entry.tag);
    if (!file) {
      throw new MigrationError(`journal entry '${entry.tag}' has no loaded file (${entry.file}).`);
    }
    if (entry.transactional) {
      await driver.applyTransactional(file);
    } else {
      await driver.applyNonTransactional(file);
    }
    appliedNow.push(entry.tag);
  }
  return { applied: appliedNow, alreadyApplied: [...applied] };
}

// The live Postgres driver lives in ./pg-driver.ts so this orchestration module (and the tests that
// exercise it) need no `pg` dependency and no live DB.
