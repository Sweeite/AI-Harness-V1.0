import { test } from "node:test";
import assert from "node:assert/strict";
import { splitExecutableStatements } from "./sql-split.ts";

test("splits simple statements on top-level semicolons", () => {
  assert.deepEqual(splitExecutableStatements("select 1; select 2;"), ["select 1", "select 2"]);
});

test("trailing statement without a semicolon is emitted", () => {
  assert.deepEqual(splitExecutableStatements("select 1; select 2"), ["select 1", "select 2"]);
});

test("blank/whitespace-only fragments are dropped", () => {
  assert.deepEqual(splitExecutableStatements("select 1;;\n  ; select 2;"), ["select 1", "select 2"]);
});

test("REGRESSION: a `;` inside a -- line comment does NOT fragment the statement (0007/0011 bug)", () => {
  const sql =
    "alter type event_type add value 'x';\n" +
    "-- CONCURRENTLY (cannot run inside a txn block); each stmt is autocommitted\n" +
    "create index concurrently if not exists i on t (c);";
  assert.deepEqual(splitExecutableStatements(sql), [
    "alter type event_type add value 'x'",
    // comment stripped, statement kept whole
    "create index concurrently if not exists i on t (c)",
  ]);
});

test("a `;` inside a string literal does not split", () => {
  assert.deepEqual(splitExecutableStatements("insert into t values ('a;b'); select 1;"), [
    "insert into t values ('a;b')",
    "select 1",
  ]);
});

test("escaped '' inside a string literal is preserved and does not end the string early", () => {
  const sql = "insert into t values ('o''brien; jr'); select 2;";
  assert.deepEqual(splitExecutableStatements(sql), ["insert into t values ('o''brien; jr')", "select 2"]);
});

test("a `;` inside a $$ dollar-quoted body does not split", () => {
  const sql = "create function f() returns void as $$ begin perform 1; perform 2; end $$ language plpgsql; select 3;";
  assert.deepEqual(splitExecutableStatements(sql), [
    "create function f() returns void as $$ begin perform 1; perform 2; end $$ language plpgsql",
    "select 3",
  ]);
});

test("named dollar-quote tags are honoured", () => {
  const sql = "do $mig$ begin raise notice 'a;b'; end $mig$; select 4;";
  assert.deepEqual(splitExecutableStatements(sql), ["do $mig$ begin raise notice 'a;b'; end $mig$", "select 4"]);
});

test("nested /* block /* comment */ */ with a semicolon is stripped without splitting", () => {
  const sql = "select 1 /* outer /* inner ; */ still comment */ ; select 2;";
  assert.deepEqual(splitExecutableStatements(sql), ["select 1", "select 2"]);
});

test("positional parameters ($1) are not treated as dollar-quotes", () => {
  // $1 is not a dollar-quote tag; the ; must still split normally.
  assert.deepEqual(splitExecutableStatements("select $1; select $2"), ["select $1", "select $2"]);
});
