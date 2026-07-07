---
id: ISSUE-051
title: Three loops + config-extensible + catch-up dedup + failure heartbeat
epic: F — harness
status: done
github: "#51"
---

# ISSUE-051 — Three loops + config-extensible + catch-up dedup + failure heartbeat

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Stand up the harness loop architecture — three default cadence loops (fast/medium/slow), config-extensible at boot, running independently with same-loop overlap prevention, single-catch-up-not-backfill dedup, and a three-consecutive-failure heartbeat alert with per-run logging.

## 2. Scope — in / out
**In:** The C5 LOP area only — the loop layer that *drives recurring work*, not the work itself. Register the three default loops as Inngest cron functions with configurable cadences and named task lists (FR-5.LOP.001); discover + register any additional config-defined loop at boot with no code change (FR-5.LOP.002); run all loops independently / in parallel (FR-5.LOP.003); enforce no-concurrent-same-loop (skip or queue exactly one) and single catch-up on missed runs — leaning on the existing idempotency keys from ISSUE-048's queue + the graph keys to guarantee no duplicate work (FR-5.LOP.004); emit a loop-failure alert event on the third consecutive failure and log every run with timestamp + outcome (FR-5.LOP.005). Wire the loop idle short-circuit (code DB-condition pre-check before waking the orchestrator) so an idle loop tick makes no LLM call (AC-NFR-PERF.010.1/.2). Emit the `loop_missed` and loop-failure signals into `event_log`; C7 owns the sinks/alert delivery (seam).

**Out:** The task-graph / idempotency-key *machinery itself* (FR-5.GRP.003/004) is ISSUE-049 — this slice *consumes* those keys, does not build them. Inngest engine, step retry, fan-out, DLQ (FR-5.JOB.*) is ISSUE-052. The `task_queue` record + status machine + priority (FR-5.QUE.*) is ISSUE-048 (blocked-by). Task decomposition / smart scheduling / parallel-step DAG (FR-5.OPT.*) is ISSUE-054. Alert *delivery* + dashboard rendering of the heartbeat is ISSUE-075 (C7). The cost-throttle that *reduces* loop cadence is C6/C7 (ISSUE-058/074), not this slice. The AF-112 LOAD/EVAL proof is a DoD gate, not built here.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-5.LOP.001, FR-5.LOP.002, FR-5.LOP.003, FR-5.LOP.004, FR-5.LOP.005 (all component-05 harness)
- **NFRs:** NFR-INF.014 (single catch-up / no backfill stampede), NFR-PERF.010 (loop cadence + idle short-circuit floor ≈ free)
- **Rests on:** ADR-005 (Inngest cron functions registered at boot; config-driven loop/trigger registration), ADR-003 (§5 loop idle-gating as a structural cost control), OD-057 (no concurrent same-loop; single catch-up not backfill), AF-112 (catch-up idempotency at scale)

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-5.LOP.001.1 (three default loops, configurable cadences within ranges, documented task lists)
- AC-5.LOP.002.1 (config-defined loop registered at boot, no code change)
- AC-5.LOP.003.1 (fast + slow both due → neither blocks the other)
- AC-5.LOP.004.1 (overrunning run → no second concurrent run; skip or queue exactly one)
- AC-5.LOP.004.2 (missed runs → single catch-up, idempotency prevents duplicate side effect)
- AC-5.LOP.005.1 (three consecutive failures → alert event emitted; every run logged with timestamp + outcome)
- AC-NFR-INF.014.3 (missed loop windows → single catch-up, not a backfill stampede)
- AC-NFR-PERF.010.1 (idle loop tick, DB pre-check → orchestrator not woken, no Sonnet call)
- AC-NFR-PERF.010.2 (verified event needing fast-path → dispatched within seconds-not-minutes)
- **Gating spikes (if any):** none launch-gating. Build-time **AF-112** (LOAD/EVAL — force missed runs + overruns on a live loop against a populated queue; assert no duplicate side effects) must be GREEN before this issue ships — it validates FR-5.LOP.004 / OD-057. Pairs with AF-018 (Inngest idempotency, already verified) + AF-063 (per-key concurrency).

## 5. Touches (complete blast radius, by ID)
- **DATA:** `task_queue` (§6 — reads/enqueues loop-driven task rows; label-only `client_slug`); `task_graph_versions` (§6 — loop task lists dispatch defined graphs); `event_log` (§8 — loop run log + `loop_missed` / loop-failure alert events, `event_type` enum already carries `loop_missed`)
- **PERM:** none net-new (loop config edit is under the `PERM-config.*` group at ISSUE-010; no new node)
- **CFG:** `loop_cadence_fast`, `loop_cadence_medium`, `loop_cadence_slow` (cron strings, BOOT class); loop task-list definitions + any additional config-defined loop (config-extensible per FR-5.LOP.002) — all in `config_values` (§12)
- **UI:** none in this slice (loop run history + failure-alert view is rendered by C7 ops dashboards, ISSUE-078; this slice only *emits* the events)
- **Connectors:** none directly (loops dispatch tasks that may call connectors downstream; connector runtime is C3)

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-05-harness.md — the LOP FR text + ACs (§LOP), the seam notes (loop events → C7), and the Context manifest's ADR-003/005 lines
- spec/04-data-model/schema.md §6 (Execution / Harness — `task_queue`, `task_graph_versions`), §8 (Observability — `event_log`, `event_type` enum incl. `loop_missed`), §12 (Config cluster — `config_values`)
- spec/05-non-functional/infrastructure.md §NFR-INF.014 (single catch-up / no backfill stampede)
- spec/05-non-functional/performance.md §NFR-PERF.010 (loop cadence + idle short-circuit)
- spec/00-foundations/adr/ADR-005-deploy-provisioning.md — Inngest cron registered at boot; config-driven registration
- spec/00-foundations/adr/ADR-003-*.md — §5 loop idle-gating as structural cost control
- spec/00-foundations/feasibility-register.md — AF-112 (method + resolution dep OD-057)

## 7. Dependencies
- **Blocked-by:** ISSUE-048 (task_queue permanent record + status machine + priority — loops enqueue/read task rows through it). AF-112 (build-time LOAD/EVAL) must be GREEN before ship, per DoD.
- **Blocks:** ISSUE-069 (seven proactive generators — each is a thresholded loop-driven producer that rides these loops)

## 8. Build order within the slice
1. **Config keys** — add `loop_cadence_fast/medium/slow` + loop task-list definitions to `config_values` (§12) with documented default cadences (`*/10 * * * *`, `0 */2 * * *`, `0 8 * * *`) and the documented per-loop task lists (FR-5.LOP.001).
2. **Boot registration** — at deployment boot, read the loop config and register each loop (the three defaults + any additional config-defined loop) as an Inngest cron function per ADR-005 — no code change to add a loop (FR-5.LOP.002); loops registered independently so they may fire in parallel (FR-5.LOP.003).
3. **Idle short-circuit** — before each loop tick wakes the orchestrator, run a code DB-condition pre-check; if no qualifying work, return without an LLM call (NFR-PERF.010 / ADR-003 §5) — the idle floor lever.
4. **Overlap + catch-up dedup** — enforce no-concurrent-same-loop (skip the tick or queue exactly one pending run on overrun); on missed runs, fire a single catch-up (never one-per-missed-window), relying on the FR-5.GRP.003/004 idempotency keys (built in ISSUE-049) so a catch-up cannot duplicate done work (FR-5.LOP.004 / OD-057).
5. **Run logging + heartbeat** — log every loop run to `event_log` with timestamp + outcome; track consecutive failures per loop and emit a loop-failure alert event on the third in a row (FR-5.LOP.005); emit `loop_missed` on a detected miss. C7 owns delivery — this slice only emits.
6. **Tests to the AC** — see Verification.

## 9. Verification (how DoD is proven)
- Per spec/05-non-functional/test-strategy.md: build-time integration tests for each AC — three default loops present with in-range cadences + task lists (AC-5.LOP.001.1); a config-only new loop registers at boot with no code change (AC-5.LOP.002.1); fast + slow both due → non-blocking (AC-5.LOP.003.1); overrun → no second concurrent run (AC-5.LOP.004.1); downtime → single catch-up, no duplicate effect (AC-5.LOP.004.2 / AC-NFR-INF.014.3); three consecutive failures → alert event + every run logged (AC-5.LOP.005.1); idle tick → orchestrator not woken (AC-NFR-PERF.010.1); fast-path event dispatched within seconds (AC-NFR-PERF.010.2).
- **AF-112** (LOAD/EVAL) must reach GREEN — force missed runs + overruns against a populated queue and assert zero duplicate side effects; posture check = idempotency keys present on every loop-dispatched task/step. Until AF-112 is GREEN, FR-5.LOP.004's `Verified` path is blocked and the issue cannot ship.
