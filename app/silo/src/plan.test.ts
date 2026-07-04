import { test } from "node:test";
import assert from "node:assert/strict";
import { assertContiguous, MigrationError, planPending } from "./plan.ts";
import type { JournalEntry } from "./journal.ts";

const J: JournalEntry[] = [
  { tag: "0001_baseline", file: "0001_baseline.sql", transactional: true },
  { tag: "0001b_indexes", file: "0001b_indexes.sql", transactional: false },
  { tag: "0001c_rls", file: "0001c_rls.sql", transactional: true },
  { tag: "0001d_seed", file: "0001d_seed.sql", transactional: true },
];

test("planPending: fresh DB => all pending, in order", () => {
  assert.deepEqual(planPending(J, new Set()).map((e) => e.tag), [
    "0001_baseline",
    "0001b_indexes",
    "0001c_rls",
    "0001d_seed",
  ]);
});

test("planPending: fully applied => nothing pending (idempotent re-run)", () => {
  const applied = new Set(J.map((e) => e.tag));
  assert.deepEqual(planPending(J, applied), []);
});

test("planPending: partial => only the tail is pending", () => {
  const applied = new Set(["0001_baseline", "0001b_indexes"]);
  assert.deepEqual(planPending(J, applied).map((e) => e.tag), ["0001c_rls", "0001d_seed"]);
});

test("assertContiguous: a contiguous prefix is fine", () => {
  assert.doesNotThrow(() => assertContiguous(J, new Set(["0001_baseline", "0001b_indexes"])));
});

test("assertContiguous: a gap (later applied, earlier not) halts loudly (#3)", () => {
  // 0001c applied but 0001b not — diverged history, do not auto-fill.
  assert.throws(
    () => assertContiguous(J, new Set(["0001_baseline", "0001c_rls"])),
    (e: unknown) => e instanceof MigrationError && /non-contiguous/.test((e as Error).message),
  );
});

test("assertContiguous: an applied tag not in the journal halts loudly (Rule 0 drift)", () => {
  assert.throws(
    () => assertContiguous(J, new Set(["0001_baseline", "9999_rogue"])),
    (e: unknown) => e instanceof MigrationError && /not in the journal/.test((e as Error).message),
  );
});
