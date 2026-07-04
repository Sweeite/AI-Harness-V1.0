import { test } from "node:test";
import assert from "node:assert/strict";
import { runMigrations, type MigrationDriver } from "./migrate.ts";
import { MigrationError } from "./plan.ts";
import type { Journal, MigrationFile } from "./journal.ts";

const journal: Journal = {
  version: "1",
  dialect: "postgresql",
  entries: [
    { tag: "0001_baseline", file: "0001_baseline.sql", transactional: true },
    { tag: "0001b_indexes", file: "0001b_indexes.sql", transactional: false },
    { tag: "0001c_rls", file: "0001c_rls.sql", transactional: true },
    { tag: "0001d_seed", file: "0001d_seed.sql", transactional: true },
  ],
};

function fakeFiles(): Map<string, MigrationFile> {
  const m = new Map<string, MigrationFile>();
  for (const e of journal.entries) {
    m.set(e.tag, { tag: e.tag, file: e.file, transactional: e.transactional, sql: `-- ${e.tag}`, checksum: e.tag });
  }
  return m;
}

class FakeDriver implements MigrationDriver {
  applied = new Set<string>();
  log: string[] = [];
  failOn?: string;
  constructor(seed: string[] = []) {
    for (const t of seed) this.applied.add(t);
  }
  async ensureTracking() {
    this.log.push("ensure");
  }
  async appliedTags() {
    return new Set(this.applied);
  }
  async applyTransactional(f: MigrationFile) {
    if (this.failOn === f.tag) throw new Error("boom");
    this.applied.add(f.tag);
    this.log.push(`txn:${f.tag}`);
  }
  async applyNonTransactional(f: MigrationFile) {
    if (this.failOn === f.tag) throw new Error("boom");
    this.applied.add(f.tag);
    this.log.push(`notxn:${f.tag}`);
  }
}

test("fresh apply: all four applied in order, 0001b via the non-transactional path", async () => {
  const d = new FakeDriver();
  const r = await runMigrations(d, journal, fakeFiles());
  assert.deepEqual(r.applied, ["0001_baseline", "0001b_indexes", "0001c_rls", "0001d_seed"]);
  assert.deepEqual(d.log, ["ensure", "txn:0001_baseline", "notxn:0001b_indexes", "txn:0001c_rls", "txn:0001d_seed"]);
});

test("re-run on a fully-migrated DB is a no-op (idempotent)", async () => {
  const d = new FakeDriver(journal.entries.map((e) => e.tag));
  const r = await runMigrations(d, journal, fakeFiles());
  assert.deepEqual(r.applied, []);
  assert.deepEqual(d.log, ["ensure"]); // ensureTracking only; nothing applied
});

test("resume after partial apply: only the tail runs", async () => {
  const d = new FakeDriver(["0001_baseline", "0001b_indexes"]);
  const r = await runMigrations(d, journal, fakeFiles());
  assert.deepEqual(r.applied, ["0001c_rls", "0001d_seed"]);
});

test("a failing migration halts loudly and records no further progress (#3)", async () => {
  const d = new FakeDriver();
  d.failOn = "0001c_rls";
  await assert.rejects(runMigrations(d, journal, fakeFiles()), /boom/);
  // baseline + indexes committed; rls + seed NOT applied — no silent skip past the failure.
  assert.deepEqual([...d.applied].sort(), ["0001_baseline", "0001b_indexes"]);
});

test("diverged history (applied tag not in journal) halts before applying anything", async () => {
  const d = new FakeDriver(["9999_rogue"]);
  await assert.rejects(
    runMigrations(d, journal, fakeFiles()),
    (e: unknown) => e instanceof MigrationError && /not in the journal/.test((e as Error).message),
  );
});

test("a journal entry with no loaded file halts loudly", async () => {
  const d = new FakeDriver();
  const files = fakeFiles();
  files.delete("0001c_rls");
  await assert.rejects(
    runMigrations(d, journal, files),
    (e: unknown) => e instanceof MigrationError && /no loaded file/.test((e as Error).message),
  );
});
