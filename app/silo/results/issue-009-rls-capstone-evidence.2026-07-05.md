# ISSUE-009 RLS scaffold — LIVE capstone evidence (2026-07-05, session 65)

**Silo:** `nwufvzaamomajdyzemhx` (client-owned Supabase, `Transpera-AIOS-V1`, ap-southeast-2, PG 17.6).
**Environment:** 💻 FULL (operator's Mac). `source ~/.ai-harness-secrets.env`; direct session connection.
**Migration applied:** `0002_rls_scaffold` (helpers + default-deny baseline policy on all 44 tables +
tail coverage assertion). Applied via `npm run migrate` after the offline `check` gate passed.

## What was proven live

| AC | Proof | Result |
|---|---|---|
| AC-1.RLS.001.1 | `npm run lint:rls` — catalog query: every public base table (44 app + `_migrations`) has RLS enabled + ≥1 policy | ✅ `✓ rls coverage (live): every public table has RLS enabled and >=1 policy.` |
| AC-NFR-SEC.010.1 | same live gate + the offline `checkCoverage` lint (fails the build on an uncovered table) | ✅ live + offline |
| AC-1.RLS.004.1 | capstone: `set role service_role` → sees all 3 demo rows (RLS bypassed) | ✅ PASS |
| AC-1.RLS.004.2 | capstone: authenticated **with** perm sees 3 rows; authenticated **without** perm sees 0 (default-deny) | ✅ PASS (positive + negative) |
| AC-1.RLS.006.1 | capstone: `delete` the grant → same-session next query sees 0 rows (instant, no re-login) | ✅ PASS |
| AC-1.RLS.002.1 | capstone: re-`insert` the grant → next query sees 3 rows again via the SAME static policy (no migration) | ✅ PASS |
| AC-NFR-PERF.001.2 | capstone: `explain (format json)` of the RLS-guarded select contains an `InitPlan` node (helper evaluated once per statement) | ✅ PASS |
| AC-NFR-PERF.001.1 | AF-067 LOAD spike (ISSUE-002, 2026-07-04): initPlan overhead 1.06 ms/stmt, loops=[1,1,0,1] | ✅ 🟢 (pre-proven) |
| AC-1.RLS.002.2 | offline `auth_rls_initplan` wrap lint (`checkInitPlanWrapping`) — clean on shipped corpus; unit-proven to flag a bare helper call | ✅ offline lint |

The capstone (`results/issue-009-rls-capstone.sql`) runs inside ONE transaction that **ROLLS BACK** —
no fixture, demo table, or grant survives; the silo is byte-identical afterward (only `0002` persists).
`session_replication_role=replica` was used ONLY to insert the synthetic FK-referencing fixtures, then
reset to `origin` so RLS was genuinely enforced during every assertion.

Capstone stdout (all fail-loud assertions passed):

```
PASS AC-1.RLS.004.1 — service_role bypasses RLS (saw all 3 rows)
PASS AC-1.RLS.004.2 — authenticated user WITH perm is RLS-permitted (saw 3 rows)
PASS AC-1.RLS.004.2 — user with NO perm is denied (default-deny holds, 0 rows)
PASS AC-NFR-PERF.001.2 — helper evaluated in an InitPlan (once per statement)
PASS AC-1.RLS.006.1 — revoke is instant on the next query (same session, 0 rows)
PASS AC-1.RLS.002.1 — grant edit re-evaluates the same policy, no migration (3 rows)
════════ ALL ISSUE-009 LIVE CAPSTONE ASSERTIONS PASSED ════════
ROLLBACK
```

## A real find the gate surfaced (fail-loud, #2/#3 working as designed)

The **first** `npm run migrate` attempt **failed loud and rolled back**: the 0002 tail coverage
assertion caught **`_migrations`** (the migrate runner's own bookkeeping table) as RLS-enabled but with
**no policy** — a coverage gap the stricter 009 gate exposed (0001c only asserted RLS *enabled*; 009
also demands a *policy*). `_migrations` was default-deny by `REVOKE ALL`, but the gate is absolute:
every public table needs a policy. Fixed at the source (`pg-driver.ts` `TRACKING_DDL` now creates the
same `default_deny` policy on `_migrations` on `ensureTracking`) rather than exempting it — a carve-out
would be a future hole. Re-ran → clean apply. This is the same class of live find as session 62's
`_migrations` RLS-disabled catch: the migration gate doing exactly its #2/#3 job.

## Feasibility

- **AF-067** (initPlan hot-path perf) — 🟢 (ISSUE-002, pre-proven; re-confirmed InitPlan present live).
- **AF-079** (RLS coverage completeness CI gate) — 🔴→🟢: the coverage lint (offline `checkCoverage` +
  live `assertRlsCoverageLive` + the 0002 tail assertion) is built and **proven to fail the build on an
  uncovered table**; live gate green on the real silo.
