// CLI for the silo migration harness. Commands:
//   check    — run the expand-contract discipline guardrails over migrations/ (no DB). AC-NFR-INF.002.1.
//   migrate  — apply pending migrations against $DATABASE_URL (runs `check` first — fail-closed).
//   status   — show applied vs pending against $DATABASE_URL.
//
// The live target at the capstone is the client silo's own Supabase (a direct Postgres connection
// string). `check` needs no DB and runs in CI on every change.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadJournal, loadMigrationFiles } from "./journal.ts";
import { checkAll, type Finding } from "./discipline.ts";
import { runMigrations } from "./migrate.ts";
import { PgDriver } from "./pg-driver.ts";
import { planPending } from "./plan.ts";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

function runCheck(): Finding[] {
  const journal = loadJournal(MIGRATIONS_DIR);
  const files = loadMigrationFiles(MIGRATIONS_DIR, journal);
  const findings = checkAll([...files.values()].map((f) => ({ tag: f.tag, sql: f.sql })));
  if (findings.length === 0) {
    console.log(`✓ discipline: ${files.size} migration(s) clean (no destructive change, indexes concurrent, seed idempotent).`);
  } else {
    console.error(`✗ discipline: ${findings.length} finding(s):`);
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

  console.error(`unknown command '${cmd}' — use: check | migrate | status`);
  process.exit(2);
}

await main();
