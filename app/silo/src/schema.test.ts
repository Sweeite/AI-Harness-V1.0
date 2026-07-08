// Static assertions over the REAL migration files — the offline proxy for the live ACs. The DB-touching
// AC-2.VEC.002.1 (a written memory carries a 1536-dim embedding + model name) is proven at the live
// capstone; here we assert the DDL that makes it true actually landed, plus the isolation/scope
// invariants that must hold for a client silo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
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

// ⚠️ MAINTENANCE TRIPWIRE — this list has gone stale 3× (sessions 71/72/73). APPEND every new migration
// tag here in the SAME commit that adds the .sql + journal entry, or this test fails 1/N. The
// journal≡disk assertion below is the self-maintaining backstop; this list additionally documents intent.
test("journal + files load: the 0001a-d baseline + 0002-0005 Stage-2 + 0006-0010 Stage-3 + 0011-0020 Stage-4 + 0021-0023 Checkpoint-3-review + 0024-0026 session-73 backfill + 0027-0028 session-74 + 0029-0030 Stage-5 ISSUE-022 migrations are present and ordered", () => {
  assert.deepEqual(journal.entries.map((e) => e.tag), [
    "0001_baseline",
    "0001b_indexes",
    "0001c_rls",
    "0001d_seed",
    "0002_rls_scaffold", // ISSUE-009 — helpers + default-deny baseline policies
    "0003_config_values_rls", // ISSUE-010 — config_values key-prefix RLS
    "0004_prompt_version_discipline", // ISSUE-042 — prompt_layers version-discipline trigger + RLS
    "0005_retention_prune_whitelist", // OD-180 — retention-prune whitelist on the audit-sink immutability trigger
    "0006_profiles_owner_rls", // ISSUE-013 — profiles owner-reads-own RLS
    "0007_stage3_event_types", // ISSUE-013+047 — 9 additive event_type values (transactional:false)
    "0008_connector_runtime_triggers", // ISSUE-032 — tools version-discipline + idempotency_ledger immutability
    "0009_guardrails_append_only", // ISSUE-060+059 / OD-182 — escalation-stamp widening + injection_quarantine bind
    "0010_guardrail_escalation_nullfix", // OD-182 — NULL-safe task_id in the guardrail_log trigger branches
    "0011_stage4_event_types", // ISSUE-015/016/034/036/049 — +16 event_type + 1 alert_type (transactional:false)
    "0012_rate_limit_deferred", // ISSUE-034 — persisted 95% deferral queue + default-deny RLS
    "0013_task_graph_versions_append_only", // ISSUE-049 — append-only-by-version trigger
    "0014_support_requests_rls", // ISSUE-016 — public-insert / view / resolve policies
    "0015_guardrail_redacted_at", // ISSUE-077 / OD-074 — redacted_at column + redaction-tombstone branch
    "0016_agents_version_discipline", // ISSUE-061 — agents version-lineage trigger
    "0017_stage4_indexes", // ISSUE-034+016 — CONCURRENTLY indexes (transactional:false)
    "0018_trigger_event_types", // ISSUE-037 — 9 trigger event_type values (transactional:false)
    "0019_connector_trigger_state", // ISSUE-037 / OD-190 — 5 trigger runtime-state tables + default-deny RLS
    "0020_connector_trigger_indexes", // ISSUE-037 / OD-190 — CONCURRENTLY indexes (transactional:false)
    "0021_task_queue_append_only", // Checkpoint-3 review (session 72) — revoke DELETE on task_queue
    "0022_dynamic_field_values_rls", // Checkpoint-3 review (session 72) — PERM-config.prompts grant + policy
    "0023_realtime_publication", // Checkpoint-3 review (session 72) — add task_queue/notifications to supabase_realtime
    "0024_webhook_event_types", // session-73 Part-B / OD-179 — 4 webhook event_type values (transactional:false)
    "0025_agents_version_chain_unique", // session-73 Part-B / B4 — agents_prev_unique partial index (transactional:false)
    "0026_version_chain_lost_update_backstops", // session-73 Part-B — prompt_layers + tools chain/genesis unique indexes (transactional:false)
    "0027_profiles_invite_lifecycle", // OD-192 — profiles.revoked_at + bounced_at (invite lifecycle markers)
    "0028_task_queue_awaiting_approval_at", // logic-sweep held fix — task_queue.awaiting_approval_at (staleness clock)
    "0029_entities_internal_org_singleton", // ISSUE-022 — entities Internal-Org partial-unique singleton guard (transactional:false)
    "0030_entity_types_config_seed", // ISSUE-022 — entity_types config_values seed (CFG-entity_types)
  ]);
  // Self-maintaining backstop so this test can't silently drift from the on-disk migrations again: the
  // journal's tag list must exactly equal the sorted .sql files present in the migrations dir.
  const onDiskTags = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.replace(/\.sql$/, ""))
    .sort();
  assert.deepEqual([...journal.entries.map((e) => e.tag)].sort(), onDiskTags);
  assert.equal(journal.entries.find((e) => e.tag === "0001b_indexes")!.transactional, false);
  assert.equal(journal.entries.find((e) => e.tag === "0002_rls_scaffold")!.transactional, true);
  assert.equal(journal.entries.find((e) => e.tag === "0005_retention_prune_whitelist")!.transactional, true);
  // 0007 is transactional:false (ALTER TYPE ADD VALUE under autocommit); the rest of Stage-3 are transactional.
  assert.equal(journal.entries.find((e) => e.tag === "0007_stage3_event_types")!.transactional, false);
  assert.equal(journal.entries.find((e) => e.tag === "0009_guardrails_append_only")!.transactional, true);
  assert.equal(journal.entries.find((e) => e.tag === "0010_guardrail_escalation_nullfix")!.transactional, true);
  // Stage-4: the enum-add + CONCURRENTLY-index migrations are transactional:false (autocommit); the DDL ones true.
  assert.equal(journal.entries.find((e) => e.tag === "0011_stage4_event_types")!.transactional, false);
  assert.equal(journal.entries.find((e) => e.tag === "0017_stage4_indexes")!.transactional, false);
  assert.equal(journal.entries.find((e) => e.tag === "0018_trigger_event_types")!.transactional, false);
  assert.equal(journal.entries.find((e) => e.tag === "0019_connector_trigger_state")!.transactional, true);
  assert.equal(journal.entries.find((e) => e.tag === "0020_connector_trigger_indexes")!.transactional, false);
  assert.equal(journal.entries.find((e) => e.tag === "0021_task_queue_append_only")!.transactional, true);
  assert.equal(journal.entries.find((e) => e.tag === "0022_dynamic_field_values_rls")!.transactional, true);
  assert.equal(journal.entries.find((e) => e.tag === "0023_realtime_publication")!.transactional, true);
  // ISSUE-022: 0029 is transactional:false (CREATE UNIQUE INDEX CONCURRENTLY); 0030 is a transactional seed.
  assert.equal(journal.entries.find((e) => e.tag === "0029_entities_internal_org_singleton")!.transactional, false);
  assert.equal(journal.entries.find((e) => e.tag === "0030_entity_types_config_seed")!.transactional, true);
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
