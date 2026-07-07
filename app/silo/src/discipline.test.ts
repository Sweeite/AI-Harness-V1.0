import { test } from "node:test";
import assert from "node:assert/strict";
import { checkMigration } from "./discipline.ts";

test("clean create-table migration has no findings", () => {
  const sql = `create table foo (id uuid primary key, name text not null default '');`;
  assert.deepEqual(checkMigration("0002_add_foo", sql), []);
});

test("DROP COLUMN outside a *_contract migration is flagged (AC-NFR-INF.002.1)", () => {
  const f = checkMigration("0002_change", `alter table foo drop column legacy;`);
  assert.equal(f.length, 1);
  assert.equal(f[0]!.rule, "no-destructive-change");
});

test("DROP COLUMN inside a *_contract migration is allowed (the contract step)", () => {
  assert.deepEqual(checkMigration("0007_drop_legacy_contract", `alter table foo drop column legacy;`), []);
});

test("RENAME is flagged as destructive outside a contract migration", () => {
  const f = checkMigration("0003_x", `alter table foo rename column a to b;`);
  assert.ok(f.some((x) => x.rule === "no-destructive-change"));
});

test("ADD COLUMN NOT NULL without a default is flagged", () => {
  const f = checkMigration("0004_x", `alter table foo add column bar text not null;`);
  assert.ok(f.some((x) => x.rule === "new-column-nullable-or-default"));
});

test("ADD COLUMN NOT NULL WITH a default is fine", () => {
  assert.deepEqual(checkMigration("0004_x", `alter table foo add column bar text not null default '';`), []);
});

test("a non-concurrent standalone index build is flagged", () => {
  const f = checkMigration("0005_idx", `create index foo_name on foo (name);`);
  assert.ok(f.some((x) => x.rule === "heavy-index-concurrently"));
});

test("a CONCURRENTLY index build is fine", () => {
  assert.deepEqual(checkMigration("0005_idx", `create index concurrently foo_name on foo (name);`), []);
});

test("an unguarded INSERT in a seed migration is flagged", () => {
  const f = checkMigration("0009_seed", `insert into roles (name) values ('Admin');`);
  assert.ok(f.some((x) => x.rule === "seed-idempotent"));
});

test("a guarded INSERT (on conflict / where not exists) in a seed migration is fine", () => {
  assert.deepEqual(checkMigration("0009_seed", `insert into roles (name) values ('Admin') on conflict (name) do nothing;`), []);
  assert.deepEqual(
    checkMigration("0009_seed", `insert into t (a) select 1 where not exists (select 1 from t);`),
    [],
  );
});

test("a DROP mentioned only in a comment or a plpgsql string is NOT flagged", () => {
  const sql = `-- we never drop table foo here\ncreate or replace function g() returns trigger language plpgsql as $$\nbegin raise exception 'drop table not allowed'; end $$;`;
  assert.deepEqual(checkMigration("0010_fn", sql), []);
});

test("a real statement AFTER a multi-line $$ body's closing marker is still scanned (logic-sweep)", () => {
  // The closing `$$` shares its physical line with a trailing DROP — the closer must not blank the whole line.
  const sql = `create or replace function h() returns trigger language plpgsql as $$\nbegin return new; end\n$$; alter table conversations drop column legacy_col;`;
  const f = checkMigration("0011_fn", sql);
  assert.ok(f.some((x) => x.rule === "no-destructive-change"), "trailing DROP after end $$; must be flagged");
});

test("a bare NOT-NULL add after a closing $$ on the same line is still flagged (logic-sweep)", () => {
  const sql = `create function f() language plpgsql as $$\nbegin end\n$$; alter table t add column c text not null;`;
  const f = checkMigration("0012_fn", sql);
  assert.ok(f.some((x) => x.rule === "new-column-nullable-or-default"), "trailing NOT-NULL add after end $$; must be flagged");
});

test("a non-concurrent index after a closing $$ on the same line is still flagged (logic-sweep)", () => {
  const sql = `create function f() language plpgsql as $$\nbegin end\n$$; create index foo_idx on foo (name);`;
  const f = checkMigration("0013_fn", sql);
  assert.ok(f.some((x) => x.rule === "heavy-index-concurrently"), "trailing index after end $$; must be flagged");
});
