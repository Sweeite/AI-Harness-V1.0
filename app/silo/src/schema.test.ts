// Static assertions over the REAL migration files — the offline proxy for the live ACs. The DB-touching
// AC-2.VEC.002.1 (a written memory carries a 1536-dim embedding + model name) is proven at the live
// capstone; here we assert the DDL that makes it true actually landed, plus the isolation/scope
// invariants that must hold for a client silo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadJournal, loadMigrationFiles } from "./journal.ts";
import { checkAll } from "./discipline.ts";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const journal = loadJournal(MIGRATIONS_DIR);
const files = loadMigrationFiles(MIGRATIONS_DIR, journal);
const sqlOf = (tag: string) => files.get(tag)!.sql;
const allSql = [...files.values()].map((f) => f.sql).join("\n");
// Comment-stripped view: the isolation invariants (no client_slug / PERM-fleet in a silo) are about
// actual DDL/DML — the migrations DO explain the exclusions in `--` comments, which is correct.
const stripComments = (s: string) => s.replace(/--.*$/gm, "");
const allDdl = stripComments(allSql);

test("journal + files load: the four 0001a-d migrations are present and ordered", () => {
  assert.deepEqual(journal.entries.map((e) => e.tag), ["0001_baseline", "0001b_indexes", "0001c_rls", "0001d_seed"]);
  assert.equal(journal.entries.find((e) => e.tag === "0001b_indexes")!.transactional, false);
});

test("every real migration passes the expand-contract discipline guardrails", () => {
  assert.deepEqual(
    checkAll([...files.values()].map((f) => ({ tag: f.tag, sql: f.sql }))),
    [],
  );
});

test("FR-2.VEC.002 landed: memories carries embedding(1536) NOT NULL + embedding_model + embedding_v2 slot", () => {
  const b = sqlOf("0001_baseline");
  assert.match(b, /embedding\s+vector\(1536\)\s+not null/i);
  assert.match(b, /embedding_model\s+text\s+not null\s+default\s+'text-embedding-3-small'/i);
  assert.match(b, /embedding_v2\s+vector\(1536\)/i); // nullable expand slot (no NOT NULL)
});

test("the append-only redaction column is consistent (schema.md L69 reconciliation)", () => {
  const b = sqlOf("0001_baseline");
  // event_log / access_audit / config_audit_log each carry redacted_at (the trigger keys off it).
  const redacted = (b.match(/redacted_at\s+timestamptz/gi) ?? []).length;
  assert.ok(redacted >= 3, `expected >=3 redacted_at columns, found ${redacted}`);
});

test("OD-096: no client_slug appears in any silo migration DDL/DML", () => {
  assert.doesNotMatch(allDdl, /client_slug/i);
});

test("management-plane tables are never created in a client silo", () => {
  for (const t of ["client_registry", "deployment_health", "offboarding_records"]) {
    assert.doesNotMatch(allSql, new RegExp(`create\\s+table[^;]*\\b${t}\\b`, "i"), `${t} must not be created in a silo`);
  }
});

test("0001b: the load-bearing HNSW index has the exact spec params (m=16, ef_construction=64)", () => {
  const idx = sqlOf("0001b_indexes");
  assert.match(idx, /create index concurrently\s+memories_embedding_hnsw\s+on\s+memories\s+using\s+hnsw\s*\(\s*embedding\s+vector_cosine_ops\s*\)\s*with\s*\(\s*m\s*=\s*16\s*,\s*ef_construction\s*=\s*64\s*\)/i);
  // every index in 0001b is CONCURRENTLY
  const creates = idx.match(/create\s+(unique\s+)?index/gi) ?? [];
  const concurrently = idx.match(/create\s+(unique\s+)?index\s+concurrently/gi) ?? [];
  assert.equal(creates.length, concurrently.length, "every 0001b index must be CONCURRENTLY");
});

test("0001c: RLS is enabled fleet-wide with a coverage assertion (no silent bypass, #2)", () => {
  const rls = sqlOf("0001c_rls");
  assert.match(rls, /enable row level security/i);
  assert.match(rls, /revoke all/i);
  assert.match(rls, /relrowsecurity\s*=\s*false/i); // the coverage assertion that fails loud if any table is RLS-off
});

test("0001d seed: agents are fail-closed and PERM-fleet.* is never seeded into a silo", () => {
  const seed = sqlOf("0001d_seed");
  const seedDdl = stripComments(seed);
  assert.match(seed, /'\{\}'::jsonb/); // memory_scope fail-closed
  assert.doesNotMatch(seedDdl, /PERM-fleet\./i); // management-plane nodes excluded from the actual grants
  // the 5 unseeded (default-deny) nodes get no grant row
  for (const n of ["PERM-memory.write", "PERM-prompt.rollback", "PERM-prompt.view_history", "PERM-system.add_sensitivity", "PERM-compliance.download_records"]) {
    assert.doesNotMatch(seedDdl, new RegExp(n.replace(/\./g, "\\."), "i"), `${n} must not be seeded (default-deny)`);
  }
  // all six canonical roles present
  for (const r of ["Super Admin", "Admin", "Finance", "HR", "Account Manager", "Standard User"]) {
    assert.ok(seed.includes(`'${r}'`), `role ${r} must be seeded`);
  }
});
