// ISSUE-079 — the `check` non-drift guard runs clean against the live migrations (no DB).
import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "./index.ts";
import { REALTIME_SURFACES } from "./connection.ts";
import { ANSWER_MODE_VALUES } from "./pill.ts";

test("check() passes: the two Realtime surfaces ≡ the 0023 publication, pill ≡ answer_mode enum, alerts ⊆ alert_type", () => {
  // check() calls process.exit(1) on drift; if it returns, all guards held.
  assert.doesNotThrow(() => check());
});

test("the declared Realtime tables are exactly task_queue + notifications (the two-socket cap)", () => {
  assert.deepEqual(REALTIME_SURFACES.map((r) => r.table).sort(), ["notifications", "task_queue"]);
});

test("the pill values match the live answer_mode enum set", () => {
  assert.deepEqual([...ANSWER_MODE_VALUES].sort(), ["building", "cited", "inferred", "unknown"]);
});
