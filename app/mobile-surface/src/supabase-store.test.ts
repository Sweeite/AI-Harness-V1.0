// ISSUE-079 — regression tests for the LIVE pg adapter's #2 defense-in-depth + identity guard.
//
// These reproduce the two MAJORs the offline suite could not see (the fake filters per-seed; the live adapter
// ran unscoped `select ... from <table>` with `void userId`):
//   • #2 no-identity read: an identity-less call must fail closed, never run an unscoped query.
//   • #2 no defense-in-depth predicate: on a service_role/RLS-bypass connection the reads returned EVERY user's
//     rows because there was no recipient/originating_user_id predicate and no bound userId param.
// A capturing fake Pool records the SQL + params each read issues so we can assert the scope is applied.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { SupabaseMobileSurfaceStore } from "./supabase-store.ts";
import { MobileError } from "./store.ts";

interface Captured {
  text: string;
  params: unknown[] | undefined;
}

function fakePool(rowsFor: (text: string) => unknown[]): { pool: Pool; calls: Captured[] } {
  const calls: Captured[] = [];
  const pool = {
    async query(text: string, params?: unknown[]) {
      calls.push({ text, params });
      const rows = rowsFor(text);
      return { rows, rowCount: rows.length };
    },
  } as unknown as Pool;
  return { pool, calls };
}

const UID = "11111111-1111-1111-1111-111111111111";

// ── #2 identity guard: an identity-less read must fail closed and NEVER hit the DB ──────────────────
for (const empty of ["", "   "]) {
  test(`#2 — a read with no viewer id ('${empty}') fails closed and issues no query`, async () => {
    const { pool, calls } = fakePool(() => []);
    const store = new SupabaseMobileSurfaceStore(pool);
    await assert.rejects(store.homePendingApprovalCount(empty), (e) => e instanceof MobileError && e.code === "no_identity");
    await assert.rejects(store.homeActiveAlertCount(empty), MobileError);
    await assert.rejects(store.listNotifications(empty), MobileError);
    await assert.rejects(store.listActivity(empty), MobileError);
    assert.equal(calls.length, 0, "no unscoped query may be sent when the identity is missing");
  });
}

// ── #2 defense-in-depth: notifications reads are scoped to the viewer (recipient) + bound to a param ──
test("#2 — homeActiveAlertCount scopes notifications to recipient=viewer OR broadcast, bound to the viewer id", async () => {
  const { pool, calls } = fakePool(() => [{ n: "0" }]);
  const store = new SupabaseMobileSurfaceStore(pool);
  await store.homeActiveAlertCount(UID);
  const q = calls[0]!;
  assert.match(q.text, /recipient\s*=\s*\$1/i, "must filter by recipient (not select every user's notifications)");
  assert.match(q.text, /recipient is null/i, "role-broadcasts (recipient null) still included so none are lost (#1)");
  assert.deepEqual(q.params, [UID], "the viewer id must be BOUND, not ignored (was `void userId`)");
});

test("#2 — listNotifications scopes to recipient=viewer OR broadcast, bound to the viewer id", async () => {
  const { pool, calls } = fakePool(() => []);
  const store = new SupabaseMobileSurfaceStore(pool);
  await store.listNotifications(UID);
  const q = calls[0]!;
  assert.match(q.text, /recipient\s*=\s*\$1/i);
  assert.match(q.text, /recipient is null/i);
  assert.deepEqual(q.params, [UID]);
});

// ── #2 / open-question #4: the pending-approval count never includes the viewer's OWN originated tasks ──
test("#2 — homePendingApprovalCount excludes the viewer's own originated tasks (no-self-approval), bound to the viewer id", async () => {
  const { pool, calls } = fakePool(() => [{ n: "0" }]);
  const store = new SupabaseMobileSurfaceStore(pool);
  await store.homePendingApprovalCount(UID);
  const q = calls[0]!;
  assert.match(q.text, /awaiting_approval/i);
  assert.match(q.text, /originating_user_id is distinct from \$1/i, "own originated tasks must not count toward approvable-N (#2)");
  assert.deepEqual(q.params, [UID]);
});

// ── listActivity: identity is required even though clearance scoping is producer/RLS-owned ──
test("#2 — listActivity requires a viewer id (clearance filter is RLS/producer-owned)", async () => {
  const { pool, calls } = fakePool(() => []);
  const store = new SupabaseMobileSurfaceStore(pool);
  await store.listActivity(UID);
  assert.equal(calls.length, 1, "with a valid identity the read runs");
});
