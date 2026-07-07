// CLI for the silo migration harness. Commands:
//   check    — run the expand-contract discipline guardrails AND the RLS lints over migrations/ (no DB).
//              AC-NFR-INF.002.1 (discipline) + AC-1.RLS.001.1/.002.2 + AC-NFR-SEC.010.1 (RLS scaffold).
//   migrate  — apply pending migrations against $DATABASE_URL (runs `check` first — fail-closed).
//   status   — show applied vs pending against $DATABASE_URL.
//   lint:rls — live RLS coverage assertion against $DATABASE_URL (every public table: RLS on + >=1 policy).
//
// The live target at the capstone is the client silo's own Supabase (a direct Postgres connection
// string). `check` needs no DB and runs in CI on every change.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadJournal, loadMigrationFiles } from "./journal.ts";
import { checkAll, type Finding } from "./discipline.ts";
import { checkAllRls, assertRlsCoverageLive, type RlsFinding } from "./rls-lint.ts";
import { runMigrations } from "./migrate.ts";
import { PgDriver } from "./pg-driver.ts";
import { planPending } from "./plan.ts";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

function runCheck(): (Finding | RlsFinding)[] {
  const journal = loadJournal(MIGRATIONS_DIR);
  const files = loadMigrationFiles(MIGRATIONS_DIR, journal);
  const corpus = [...files.values()].map((f) => ({ tag: f.tag, sql: f.sql, transactional: f.transactional }));
  const discipline = checkAll(corpus);
  const rls = checkAllRls(corpus);
  const findings: (Finding | RlsFinding)[] = [...discipline, ...rls];
  if (findings.length === 0) {
    console.log(`✓ discipline: ${files.size} migration(s) clean (no destructive change, indexes concurrent, seed idempotent, no semicolon in a non-transactional comment).`);
    console.log(`✓ rls: every table covered by a policy; every policy helper call (select …)-wrapped.`);
  } else {
    console.error(`✗ ${findings.length} finding(s):`);
    for (const f of findings) {
      console.error(`  [${f.rule}] ${f.tag}:${f.line}  ${f.message}\n      ${f.snippet}`);
    }
  }
  return findings;
}

function requireDbUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required (the client silo's Postgres connection string).");
    process.exit(2);
  }
  return url;
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? "check";

  if (cmd === "check") {
    process.exit(runCheck().length === 0 ? 0 : 1);
  }

  if (cmd === "migrate") {
    // Fail-closed: never apply a migration set that violates discipline.
    if (runCheck().length > 0) {
      console.error("Refusing to migrate — discipline findings above must be resolved first (#3).");
      process.exit(1);
    }
    const journal = loadJournal(MIGRATIONS_DIR);
    const files = loadMigrationFiles(MIGRATIONS_DIR, journal);
    const driver = new PgDriver(requireDbUrl());
    try {
      const result = await runMigrations(driver, journal, files);
      if (result.applied.length === 0) {
        console.log(`✓ up to date — ${result.alreadyApplied.length} migration(s) already applied, nothing to do.`);
      } else {
        console.log(`✓ applied ${result.applied.length} migration(s): ${result.applied.join(", ")}`);
      }
    } finally {
      await driver.end();
    }
    return;
  }

  if (cmd === "status") {
    const journal = loadJournal(MIGRATIONS_DIR);
    const files = loadMigrationFiles(MIGRATIONS_DIR, journal);
    const driver = new PgDriver(requireDbUrl());
    try {
      await driver.ensureTracking();
      const applied = await driver.appliedTags();
      const pending = planPending(journal.entries, applied);
      console.log("Applied:", [...applied].join(", ") || "(none)");
      console.log("Pending:", pending.map((e) => e.tag).join(", ") || "(none)");
      void files;
    } finally {
      await driver.end();
    }
    return;
  }

  if (cmd === "lint:rls") {
    // Live ground-truth coverage gate: every public table has RLS enabled + >=1 policy (AC-NFR-SEC.010.1).
    const driver = new PgDriver(requireDbUrl());
    try {
      const { rlsDisabled, noPolicy } = await assertRlsCoverageLive(driver);
      if (rlsDisabled.length === 0 && noPolicy.length === 0) {
        console.log("✓ rls coverage (live): every public table has RLS enabled and >=1 policy.");
        return;
      }
      if (rlsDisabled.length > 0) console.error(`✗ RLS DISABLED (silent bypass, #2): ${rlsDisabled.join(", ")}`);
      if (noPolicy.length > 0) console.error(`✗ RLS enabled but NO policy (unguarded, #2): ${noPolicy.join(", ")}`);
      process.exit(1);
    } finally {
      await driver.end();
    }
  }

  console.error(`unknown command '${cmd}' — use: check | migrate | status | lint:rls`);
  process.exit(2);
}

await main();
