---
id: ISSUE-064
title: Execution plans + per-step failure-mode assignment
epic: H — agent design
status: done
github: "#64"
---

> **✅ DONE (Session 80, 2026-07-09 — operator-present live close):** silo migration `0037` applied LIVE (silo head → `0037`) + the **R10 live-adapter smoke `app/execution-plans/results/live-smoke.sql` PASSED** vs the real silo (rolled back — proved canonical `plan_body` persist, the `coalesce(max,0)+1` version + the unique(task_type_name, version) backstop, the `plan_outcome`/`plan_rollback` `event_type` values, and the atomic reinstating-version + rollback-audit append). No store migration (verify-present). Whole-repo offline sweep green (1213/0). Closed under Checkpoint 5. GitHub #64 closed.
>
> **Build status (Session 79, offline overnight):** `app/execution-plans/` built + adversarially verified + fixed — **19/19 offline tests + typecheck + `check` green**. **No new migration for the store** (`execution_plans` + `step_failure_mode` already ship in the 0001 baseline — verify-present, like ISSUE-022); the slice is the failure-mode assignment/depth/versioning **discipline layer** on top of ISSUE-061's plan structure. Adversarial verify (independent zero-context agent) caught **2 BLOCKER + 1 MAJOR + minors** — all fixed regression-test-first: ① the live attribution + rollback wrote `event_type` values not in the enum → **migration `0037`** adds `plan_outcome`/`plan_rollback` additively + a `check` gate (the fake-passes-offline/live-throws class); ② rollback was non-atomic → now the version-append + audit are ONE transaction (audit-or-nothing); ③ `saveVersion` now **canonicalizes + asserts `plan_body` at the write boundary** so the orchestrator's shorthand (`halt_escalate`/`skip`) can never reach the column (the [[OD-201]] drift, closed on write); + a wired `buildValidatedPlan` depth-gate entry + a uuid guard. `status: in-progress` (live-close pending: apply `0037` + run the R10 adapter smoke = operator's morning pass). Surfaced **[[OD-201]]** (orchestrator↔DB `step_failure_mode` taxonomy drift — the residual fix is a small change-controlled edit owed to ISSUE-061's `buildPlan`).

# ISSUE-064 — Execution plans + per-step failure-mode assignment

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Give the orchestrator a versioned execution-plan structure in which **every step carries a
pre-assigned failure mode** (retry / skip-and-continue / halt-and-escalate), safe-defaults to
halt-and-escalate, is bounded by the chain-depth limit at build time, and is versioned per task
type with human-only rollback — the plan C5 then executes.

## 2. Scope — in / out
**In:** The C8 **PLAN** area (FR-8.PLAN.001–004): the `execution_plans` store (versioned
routing-plan table + `step_failure_mode` typing inside `plan_body`); the discipline that assigns
one of {retry, skip_and_continue, halt_and_escalate} to *every* step at plan-build time (never at
failure time); the **halt-and-escalate safe default** for any unassigned step, with the
staleness-re-escalation guarantee on an unattended halt; **build-time** enforcement of
`chain_depth_limit` (trim/reject → low-confidence, never silent mid-chain truncation); and
per-task-type **plan versioning + human-decided rollback** with version→outcome attribution.
This is the assignment/structure/version layer only.

**Out:** The **construction** of the plan structure itself (single-vs-chain, dependency ordering,
parallel-step marking, the 7-step routing that *produces* the plan) — that is FR-8.ORC.005/006/007,
owned by **ISSUE-061**; this slice consumes ORC.005's structure and hangs the failure-mode +
versioning discipline on it. The **execution** of an assigned failure mode (retry-with-backoff,
skip+log+flag, halt+escalate+preserve-envelope, DLQ, loop catch-up) is **C5** — owned by
**ISSUE-052** (Inngest engine / step retry / DLQ) and the loop/queue issues; C8 only *assigns*. The
context-envelope machinery that carries the live plan is **C5 FR-5.ENV.*** (ISSUE-050). The
plan-version *history UI* / registry editor is the agent-builder surface, **ISSUE-067**. Cost
metering (C7) and cost-ladder enforcement (C6) are out.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-8.PLAN.001, FR-8.PLAN.002, FR-8.PLAN.003, FR-8.PLAN.004 (component-08 Agent Design).
- **NFRs:** none (this slice claims the C8 PLAN group in the coverage ledger; NFR-PERF.007
  step-level execution is C5/ISSUE-049).
- **Rests on:** ADR-003 (cost estimate-grade — plan versioning feeds the estimate model, not
  metering); OOS-030 (auto-rollback deferred — rollback is human-decided); OD-080 (who may roll
  back = Super Admin/Admin capability split); OD-077 (escalate-don't-abandon, reused by the
  unattended-halt guarantee); AF-126 (EVAL — outcome-to-plan-version attribution measurably
  improves routing).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-8.PLAN.001.1, AC-8.PLAN.001.2
- AC-8.PLAN.002.1, AC-8.PLAN.002.2
- AC-8.PLAN.003.1
- AC-8.PLAN.004.1, AC-8.PLAN.004.2
- **Integration ACs owned elsewhere but exercised by this slice (do not re-implement, wire to):**
  AC-8.ORC.005.2 (ORC.005 produces a chain with every step carrying a failure mode — ISSUE-061)
  and AC-5.QUE.005.2 (the escalate-don't-abandon timer AC-8.PLAN.002.2 inherits — C5/ISSUE-048).
- **Gating spikes (if any):** none. AF-126 is a **build-time EVAL** (not an OD-157 launch spike);
  it attaches to PLAN.004's version→outcome attribution claim and is proven per
  `spec/00-foundations/feasibility-register.md` (block S). It does not block ship of the structure,
  but PLAN.004's "measurably improves" claim must not be asserted as proven until AF-126 is GREEN.

## 5. Touches (complete blast radius, by ID)
- **DATA:** `execution_plans` (net-new versioned store: `task_type_name`, `version`, `plan_body`,
  `previous_version_id`, `created_by`, `unique(task_type_name, version)`); `step_failure_mode`
  enum (`retry` / `skip_and_continue` / `halt_and_escalate`) typed **inside** `plan_body` jsonb
  (documentation enum, not a column; default `halt_and_escalate`); `event_log` (plan built,
  depth-limit hit, default-mode applied, version→outcome attribution, rollback — all logged).
- **PERM:** `PERM-agents.manage` / `PERM-config.agents` (rollback authority per OD-080 — Super
  Admin/Admin split).
- **CFG:** `CFG-chain_depth_limit` (default 6); `CFG-parallel_execution_enabled` (read from
  ORC.005's structure, gates parallel-step marking).
- **UI:** none in this slice (plan-version history renders in ISSUE-067 surface-09; C7 displays).
- **Connectors:** none.

## 6. Context manifest (the EXACT files to open — nothing more)
- `spec/01-requirements/component-08-agent-design.md` — Area PLAN (FR-8.PLAN.001–004) + FR-8.ORC.005
  (the plan structure this slice consumes) + the Context manifest / Consumed sections at the top.
- `spec/04-data-model/schema.md` §9 Agent Design (C8) — the `execution_plans` table and the
  `step_failure_mode` enum note; §Config cluster (§12) for `chain_depth_limit` /
  `parallel_execution_enabled` typing.
- `spec/00-foundations/adr/ADR-003-*.md` — cost estimate-grade posture (plan-version attribution).
- `spec/00-foundations/feasibility-register.md` — AF-126 (EVAL verification method for PLAN.004).
- `spec/00-foundations/out-of-scope.md` — OOS-030 (human-only rollback, no auto-rollback).

## 7. Dependencies
- **Blocked-by:** ISSUE-061 (orchestrator + 7-step routing + ORC.005 produces the plan structure
  this slice types & versions); ISSUE-052 (Inngest execution engine — the C5 consumer that
  *executes* each assigned failure mode; the assignment is meaningless without an executor to wire
  the semantics against). Neither is a spike.
- **Blocks:** ISSUE-067 (agent-builder surface renders plan-version history).

## 8. Build order within the slice
1. **Migration (schema §9):** add the `execution_plans` table (net-new versioned store) and the
   `step_failure_mode` enum; confirm the `unique(task_type_name, version)` constraint and
   `previous_version_id` self-reference. `plan_body` jsonb carries steps + per-step `failure_mode`.
2. **Failure-mode assignment (FR-8.PLAN.001):** hang assignment on ORC.005's built structure —
   every step gets exactly one `step_failure_mode` at build time; persist it in `plan_body`. Wire
   the value set so C5 (ISSUE-052) reads the *pre-assigned* mode and never re-decides at failure
   time (AC-8.PLAN.001.2 is a cross-boundary contract: the mode travels in the envelope, C5 obeys).
3. **Safe default (FR-8.PLAN.002):** any step reaching build/execution without an explicit mode is
   treated as `halt_and_escalate` (non-negotiable #3 — never silently skipped). Wire the unattended
   -halt re-escalation to reuse the C5 staleness timer (AC-5.QUE.005.2 / OD-077) so a defaulted halt
   inherits the same escalate-don't-abandon guarantee (AC-8.PLAN.002.2).
4. **Build-time depth gate (FR-8.PLAN.003):** enforce `CFG-chain_depth_limit` when the plan is
   built — trim/reject an over-limit plan and drop the task to ORC.006 low-confidence clarification;
   log the hit. **Never** truncate a chain mid-execution (the limit is a build-time gate only).
5. **Versioning + rollback (FR-8.PLAN.004):** version plans per `task_type_name` (new version
   supersedes, never deletes prior — `previous_version_id` link); attribute recorded outcomes to
   the plan version (ORC.007 writes outcomes); expose **human-decided** rollback gated by OD-080
   authority, audited to `event_log`. No automatic rollback (OOS-030).
6. **Tests to the ACs:** plan-inspection test (every step has a mode), pre-assignment test (C5 uses
   the stored mode, not a runtime choice), unassigned→halt test, unattended-halt re-escalation test,
   over-depth trim/reject test, version-attribution + human-only-audited-rollback test.

## 9. Verification (how DoD is proven)
- **Unit/integration** per `spec/05-non-functional/test-strategy.md`: PLAN.001/002/003 are
  deterministic build-time invariants → unit + integration tests to the ACs above; the
  cross-boundary AC-8.PLAN.001.2 / AC-8.PLAN.002.2 are integration tests against the C5 executor
  (ISSUE-052) confirming the mode is read pre-assigned and the halt timer re-escalates.
- **AF-126 (EVAL, build-time):** PLAN.004's "outcomes measurably attributable to / improved by plan
  version" claim is proven by the EVAL harness before that claim is treated as verified — until
  GREEN it is decided-on-paper. The version→outcome plumbing (structure + attribution) ships and is
  test-covered independent of the EVAL result.
- **AC→Verified path:** all seven PLAN ACs pass in CI; the two integration ACs pass against the
  ISSUE-052 executor; AF-126 tracked to GREEN in the feasibility register for the PLAN.004 quality
  claim.
