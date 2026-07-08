import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  checkInitPlanWrapping,
  checkCoverage,
  checkAal2Coverage,
  checkAllRls,
  stripSelectSubqueries,
  parseCreatedTables,
  parseCoveredTables,
  assertRlsCoverageLive,
  type QueryableClient,
} from "./rls-lint.ts";
import { loadJournal, loadMigrationFiles } from "./journal.ts";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

// ── LINT 1: auth_rls_initplan wrapping (AC-1.RLS.002.2 / AC-NFR-PERF.001.2) ──

test("a bare helper call in a policy qual is flagged as unwrapped", () => {
  const f = checkInitPlanWrapping(
    "0020_x",
    `create policy p on public.memories for select to authenticated using (user_perms(auth.uid()) @> array['PERM-memory.view']);`,
  );
  assert.equal(f.length, 1);
  assert.equal(f[0]!.rule, "initplan-unwrapped");
});

test("a `(select …)`-wrapped helper call passes", () => {
  const f = checkInitPlanWrapping(
    "0020_x",
    `create policy p on public.memories for select to authenticated using ((select user_perms(auth.uid())) @> array['PERM-memory.view']);`,
  );
  assert.deepEqual(f, []);
});

test("a top-level auth.uid() outside any subquery is flagged", () => {
  const f = checkInitPlanWrapping(
    "0020_x",
    `create policy p on public.conversations for select to authenticated using (owner_user_id = auth.uid());`,
  );
  assert.equal(f.length, 1);
});

test("a `(select auth.uid())`-wrapped comparison passes", () => {
  const f = checkInitPlanWrapping(
    "0020_x",
    `create policy p on public.conversations for select to authenticated using (owner_user_id = (select auth.uid()));`,
  );
  assert.deepEqual(f, []);
});

test("nested (select user_perms(auth.uid())) treats BOTH calls as wrapped", () => {
  const f = checkInitPlanWrapping(
    "0020_x",
    `create policy p on public.entities for select to authenticated using ((select user_perms(auth.uid())) @> array['PERM-x'] and (select user_aal()) = 'aal2');`,
  );
  assert.deepEqual(f, []);
});

test("the default-deny baseline policy (using(false), no helper) is clean", () => {
  const f = checkInitPlanWrapping(
    "0002_rls_scaffold",
    `create policy default_deny on public.memories as permissive for all to authenticated using (false) with check (false);`,
  );
  assert.deepEqual(f, []);
});

test("stripSelectSubqueries removes nested (select …) groups to a fixpoint", () => {
  const residual = stripSelectSubqueries("((select user_perms(auth.uid())) @> array['x'])");
  assert.ok(!/user_perms|auth\.uid/i.test(residual));
});

// ── LINT 2: coverage (AC-1.RLS.001.1 / AC-NFR-SEC.010.1 / AF-079) ──

test("a table created but absent from every policy is flagged uncovered", () => {
  const f = checkCoverage([
    { tag: "0005_add", sql: `create table public.new_widget (id uuid primary key);` },
  ]);
  assert.equal(f.length, 1);
  assert.equal(f[0]!.rule, "table-uncovered");
  assert.match(f[0]!.message, /new_widget/);
});

test("a table covered by the default-deny baseline loop passes", () => {
  const f = checkCoverage([
    { tag: "0005_add", sql: `create table public.new_widget (id uuid primary key);` },
    { tag: "0006_rls", sql: `do $$ declare t text; silo_tables text[] := array['new_widget']; begin end $$;` },
  ]);
  assert.deepEqual(f, []);
});

test("a table covered by an explicit create policy passes", () => {
  const f = checkCoverage([
    { tag: "0005_add", sql: `create table public.new_widget (id uuid primary key);` },
    { tag: "0006_pol", sql: `create policy w on public.new_widget for select to authenticated using (true);` },
  ]);
  assert.deepEqual(f, []);
});

test("parseCreatedTables / parseCoveredTables handle public.-qualified + bare forms", () => {
  assert.deepEqual(parseCreatedTables(`create table public.a (id int); create table b (id int);`), ["a", "b"]);
  assert.deepEqual(
    parseCoveredTables(`create policy p on public.a for all using (false); silo_tables text[] := array['b','c'];`).sort(),
    ["a", "b", "c"],
  );
});

// ── The REAL migration corpus must pass BOTH lints (the shipped artifact is clean) ──

test("the shipped migration corpus passes discipline's RLS lints (coverage + initplan)", () => {
  const journal = loadJournal(MIGRATIONS_DIR);
  const files = loadMigrationFiles(MIGRATIONS_DIR, journal);
  const findings = checkAllRls([...files.values()].map((f) => ({ tag: f.tag, sql: f.sql })));
  assert.deepEqual(
    findings,
    [],
    `RLS lints flagged the shipped corpus:\n${findings.map((f) => `[${f.rule}] ${f.tag}:${f.line} ${f.message}`).join("\n")}`,
  );
});

test("every table CREATEd in the baseline is covered by the 0002 default-deny loop", () => {
  const journal = loadJournal(MIGRATIONS_DIR);
  const files = loadMigrationFiles(MIGRATIONS_DIR, journal);
  const corpus = [...files.values()].map((f) => ({ tag: f.tag, sql: f.sql }));
  const created = new Set(corpus.flatMap((f) => parseCreatedTables(f.sql)));
  const covered = new Set(corpus.flatMap((f) => parseCoveredTables(f.sql)));
  const uncovered = [...created].filter((t) => !covered.has(t));
  assert.deepEqual(uncovered, [], `uncovered tables: ${uncovered.join(", ")}`);
  assert.ok(created.size >= 44, `expected >=44 application tables, saw ${created.size}`);
});

// ── Helper-body regression guards (MINOR-1 from independent verification) ──
// A regression that dropped `set search_path`, or flipped a fail-closed default, would pass the lints
// (they only look at policies, not function bodies) and only surface at the live capstone. These cheap
// text assertions on the shipped 0002 SQL catch that class of regression offline.

const scaffold = (() => {
  const journal = loadJournal(MIGRATIONS_DIR);
  const files = loadMigrationFiles(MIGRATIONS_DIR, journal);
  return [...files.values()].find((f) => f.tag === "0002_rls_scaffold")!.sql;
})();

for (const fn of ["user_perms", "user_clearances", "user_restricted", "user_aal"]) {
  test(`helper ${fn} is SECURITY DEFINER + STABLE + pinned search_path (no mutable-search_path hole)`, () => {
    const body = scaffold.slice(scaffold.indexOf(`function public.${fn}`));
    const decl = body.slice(0, body.indexOf("$$"));
    assert.match(decl, /\bstable\b/i, `${fn} must be STABLE (initPlan requires it)`);
    assert.match(decl, /security\s+definer/i, `${fn} must be SECURITY DEFINER`);
    assert.match(decl, /set\s+search_path\s*=\s*''/i, `${fn} must pin search_path to '' (Supabase advisor)`);
  });
}

test("user_aal fail-closes to aal1 when the JWT claim is absent (never fail-open to aal2)", () => {
  const body = scaffold.slice(scaffold.indexOf("function public.user_aal"));
  assert.match(body.slice(0, body.indexOf("$$", body.indexOf("$$") + 2)), /coalesce\([\s\S]*'aal1'/i);
});

test("user_restricted excludes soft-deleted grants (revoked_at is null → instant revoke)", () => {
  const body = scaffold.slice(scaffold.indexOf("function public.user_restricted"));
  assert.match(body, /revoked_at\s+is\s+null/i);
});

test("user_perms fail-closes to an empty array (absence of a grant = denied)", () => {
  const body = scaffold.slice(scaffold.indexOf("function public.user_perms"));
  assert.match(body.slice(0, body.indexOf("$$", body.indexOf("$$") + 2)), /coalesce\([\s\S]*array\[\]::text\[\]/i);
});

test("the default-deny baseline is PERMISSIVE using(false) TO authenticated (ORs with ISSUE-020, never a forever-block)", () => {
  assert.match(scaffold, /create policy default_deny[\s\S]*?as permissive for all to authenticated using \(false\) with check \(false\)/i);
});

// ── LINT 3 (live shape): coverage assertion parses catalog rows correctly ──

test("assertRlsCoverageLive surfaces RLS-disabled and no-policy tables", async () => {
  const fake: QueryableClient = {
    async query(sql: string) {
      if (/relrowsecurity = false/.test(sql)) return { rows: [{ relname: "leaky" }] };
      if (/not exists/.test(sql)) return { rows: [{ relname: "unguarded" }] };
      return { rows: [] };
    },
  };
  const res = await assertRlsCoverageLive(fake);
  assert.deepEqual(res.rlsDisabled, ["leaky"]);
  assert.deepEqual(res.noPolicy, ["unguarded"]);
});

test("assertRlsCoverageLive returns clean when the catalog is fully covered", async () => {
  const fake: QueryableClient = { async query() { return { rows: [] }; } };
  const res = await assertRlsCoverageLive(fake);
  assert.deepEqual(res, { rlsDisabled: [], noPolicy: [] });
});

// ── LINT 4 — aal2 coverage (FR-1.RLS.005 / AC-1.RLS.005.1 / AF-076): ISSUE-020's CI teeth ──

test("checkAal2Coverage flags an authenticated GRANT policy that omits the aal2 clause", () => {
  const files = [{ tag: "x", sql: `create policy memories_read on public.memories as permissive for select to authenticated using ((select public.user_visibility(auth.uid())) is not null);` }];
  const f = checkAal2Coverage(files);
  assert.equal(f.length, 1);
  assert.equal(f[0]!.rule, "aal2-missing");
  assert.match(f[0]!.message, /memories_read/);
});

test("checkAal2Coverage passes a policy that gates on user_aal", () => {
  const files = [{ tag: "x", sql: `create policy memories_read on public.memories as permissive for select to authenticated using ((select public.user_aal()) = 'aal2' and visibility = 'global');` }];
  assert.deepEqual(checkAal2Coverage(files), []);
});

test("checkAal2Coverage is create+alter aware — a later ALTER that adds aal2 clears a create that lacked it (the 0031 retrofit shape)", () => {
  const files = [
    { tag: "0006", sql: `create policy profiles_owner_read on public.profiles as permissive for select to authenticated using ((select auth.uid()) = id);` },
    { tag: "0031", sql: `alter policy profiles_owner_read on public.profiles using ((select auth.uid()) = id and (select public.user_aal()) = 'aal2');` },
  ];
  assert.deepEqual(checkAal2Coverage(files), []);
});

test("checkAal2Coverage exempts the pure default-deny floor and the support_requests pre-auth intake", () => {
  const files = [
    { tag: "0002", sql: `create policy default_deny on public.memories as permissive for all to authenticated using (false) with check (false);` },
    { tag: "0014", sql: `create policy support_requests_public_insert on public.support_requests as permissive for insert to authenticated with check (status = 'pending' and assigned_to is null);` },
  ];
  assert.deepEqual(checkAal2Coverage(files), []);
});

test("checkAal2Coverage flags a policy that only mentions aal2 in a stripped comment (executable text must carry it)", () => {
  // The lint strips `-- …` comments, so a comment cannot satisfy the clause — prevents a false-clean.
  const files = [{ tag: "x", sql: `create policy roles_read on public.roles as permissive for select to authenticated using (true); -- user_aal enforced elsewhere` }];
  const f = checkAal2Coverage(files);
  assert.equal(f.length, 1);
});
