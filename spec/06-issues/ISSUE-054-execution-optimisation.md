---
id: ISSUE-054
title: Execution optimisation — parallel DAG, smart scheduling, decomposition, pre-warm
epic: F — harness
status: ready
github: "#54"
---

# ISSUE-054 — Execution optimisation (parallel DAG, scheduling, decomposition, pre-warm)

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Add the four throughput/latency optimisations on top of the already-built task-graph + Inngest
engine — parallel step execution over the dependency DAG, smart scheduling of non-urgent work,
an upfront decomposition/planning step, and chained-task memory pre-warm — each per-deployment
config-gated and none allowed to weaken approval or write-safety invariants.

## 2. Scope — in / out
**In:** The C5 `OPT` area only — the *optimisation* layer that runs when its config flag is on and
degrades to plain sequential behaviour when off. Specifically:
- **Parallel step execution** (FR-5.OPT.001): schedule independent task-graph steps to run
  simultaneously while honouring the step-dependency DAG, with **step-level** approval semantics per
  OD-056 — an approval-gated step blocks itself + its dependents, independent reversible siblings
  proceed, and no irreversible side effect may fire ahead of a pending approval it should follow.
- **Smart scheduling** (FR-5.OPT.002): defer eligible non-urgent scheduled tasks to a quiet queue
  window; when the flag is off they run on plain cadence.
- **Task decomposition** (FR-5.OPT.003): for tasks flagged complex, run an upfront planning step
  that produces the ordered, dependency-aware step chain into the envelope's `execution_plan`
  *before* any side-effecting step runs.
- **Chained-task pre-warm** (FR-5.OPT.004): allow Task B's memory retrieval to begin while Task A is
  still running, as a read-only, discardable optimisation that respects OD-059's fresh-scope rule.

**Out:**
- The task-graph model, idempotency keys, and resume-from-incomplete-step — built in **ISSUE-049**
  (this slice *consumes* the DAG + idempotency; it does not define them).
- The Inngest engine, step-level retry, fan-out, and DLQ — built in **ISSUE-052** (parallel steps
  ride Inngest fan-out + per-key concurrency; this slice does not build the engine).
- The chain-depth limit at plan-build time — that is **NFR-PERF.007 / FR-8.PLAN.003 in ISSUE-064**
  (C8). Decomposition here produces the plan; C8 enforces the depth ceiling on it.
- The approval-tier *policy* and routing (C6 `APR`/`ESC`, **ISSUE-056**) and the run-pipeline gate
  sequencing (**ISSUE-053**) — this slice only *respects* their gates while parallelising.
- Inter-step compression + originals retention (FR-5.ENV.003) — **ISSUE-050**.
- Loop cadence / catch-up (C5 `LOP`) — **ISSUE-051**. Smart scheduling here is queue-window
  deferral of scheduled tasks, not loop registration.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-5.OPT.001, FR-5.OPT.002, FR-5.OPT.003, FR-5.OPT.004 (all component-05 harness, C5).
- **NFRs:** none directly owned. (Adjacent: NFR-PERF.007 chain-depth is enforced in ISSUE-064/C8;
  the decomposition plan built here is its input.)
- **Rests on:** ADR-004 (concurrency model — parallel steps = parallel writes; per-key concurrency
  keeps disjoint-entity writes safe) · AF-113 (parallel-DAG correctness + no `shared_context`/
  `previous_outputs` race + no side effect outruns a pending approval) · OD-056 (step-level
  parallel × approval semantics) · OD-059 (chained-task fresh-scope rule, governs pre-warm).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-5.OPT.001.1
- AC-5.OPT.001.2
- AC-5.OPT.002.1
- AC-5.OPT.003.1
- AC-5.OPT.004.1
- **Gating spikes / build-time AFs:** **AF-113** must be GREEN before this issue ships — it proves
  parallel-step execution honours the DAG with no `shared_context`/`previous_outputs` race and that
  no irreversible side effect outruns a pending approval (SPIKE/LOAD, gates FR-5.OPT.001 / OD-056).
  AF-113 is a build-time AF (not one of the OD-157 launch-gating spikes ISSUE-001..006); it is
  attached here as the DoD gate for the parallel-execution FR.

## 5. Touches (complete blast radius, by ID)
- **DATA:** `DATA-task_queue` (scheduling reads `priority`/`status`; smart-scheduling defers dispatch
  — label-only edits, no schema change) · `DATA-task_graph_versions.steps` (reads the per-step
  dependency data that defines the DAG) · `DATA-execution_plans` / the envelope's `execution_plan`
  (decomposition writes the ordered plan into the live envelope, copied from `execution_plans` at
  run) · `DATA-context_envelope` (`shared_context` / `previous_outputs` — the race surface AF-113
  guards; pre-warm stages B's `memory_retrieved` read-only).
- **PERM:** none (execution optimisation is config-gated, adds no permission node).
- **CFG:** `parallel_execution` (on/off per deployment — ADR-004) · smart-scheduling enable flag
  (on/off) · chained-task pre-warm enable flag (on/off). (Config keys live in the config cluster,
  schema.md §Config cluster; values are per-deployment.)
- **UI:** none new (this slice adds no surface; parallel/queue behaviour is observed via the
  existing task-queue + envelope/step-output viewers built in earlier F issues).
- **Connectors:** none.

## 6. Context manifest (the EXACT files to open — nothing more)
- `spec/01-requirements/component-05-harness.md` §OPT — FR-5.OPT.001–004 text + the five ACs, plus
  the local OD table (OD-056 parallel×approval, OD-059 chained scope) and the block-P feasibility
  table (AF-113).
- `spec/04-data-model/schema.md` §6 Execution / Harness — `task_queue`, `task_graph_versions`
  (`steps` jsonb = per-step deps), `task_history`; and §9 Agent Design for `execution_plans`
  (versioned plan store copied into the envelope at run); §12 Config cluster for the CFG keys.
- `spec/05-non-functional/performance.md` §NFR-PERF.007 — the chain-depth ceiling the decomposition
  plan is bounded by (enforced downstream in C8, read for the boundary).
- `spec/00-foundations/adr/ADR-004-concurrency-model.md` — the intra-deployment concurrency model +
  per-key concurrency that makes parallel steps write-safe.
- `spec/00-foundations/feasibility-register.md` — AF-113 entry (verification method + GREEN
  criteria) and its carry-ins AF-063 (Inngest per-key concurrency) / AF-018.

## 7. Dependencies
- **Blocked-by:** ISSUE-049 (task graphs + idempotency keys + resume-from-incomplete-step — the DAG
  this slice parallelises over) · ISSUE-052 (Inngest execution engine + step retry + fan-out + DLQ —
  the engine parallel steps ride). Neither blocker is a spike; the gating AF for this slice is the
  build-time **AF-113** (see DoD), which must be GREEN before ship.
- **Blocks:** none (leaf).

## 8. Build order within the slice
1. **Decomposition planning step (FR-5.OPT.003)** — build first; it produces the ordered,
   dependency-aware `execution_plan` the parallel scheduler then reads. Gate: complex-task flag →
   planning step runs before any side-effecting step; plan written to the envelope's
   `execution_plan`. Bound the plan to `chain_depth_limit` at build (the NFR-PERF.007 boundary owned
   by C8 — reject/trim, never silently truncate).
2. **Parallel step execution over the DAG (FR-5.OPT.001)** — the core. Read the per-step deps from
   `task_graph_versions.steps`; schedule independent steps concurrently via Inngest fan-out (rides
   ADR-004 per-key concurrency so disjoint-entity writes stay safe). Enforce OD-056 step-level
   approval semantics: an approval-gated step blocks itself + dependents; independent reversible
   siblings proceed; **an irreversible step waits for any pending approval it should logically
   follow** (planner/DAG marks that ordering). Guard `shared_context`/`previous_outputs` against
   concurrent-write races. This step is not shippable until **AF-113 is GREEN**.
3. **Smart scheduling (FR-5.OPT.002)** — gate eligible non-urgent scheduled tasks on a quiet-queue
   window when the flag is on; plain cadence when off.
4. **Chained-task pre-warm (FR-5.OPT.004)** — allow B's memory retrieval to begin while A runs,
   read-only, respecting OD-059's fresh-scope rule for B; discard the pre-warmed result if B never
   runs; no side effect.
5. Wire the three CFG flags (`parallel_execution`, smart-scheduling enable, pre-warm enable) as
   per-deployment toggles; confirm each optimisation degrades to plain sequential/on-cadence
   behaviour when its flag is off.
6. Tests to the ACs (see Verification).

## 9. Verification (how DoD is proven)
- **AF-113 (SPIKE/LOAD)** is the load-bearing verification for FR-5.OPT.001: prove the parallel
  scheduler honours the dependency DAG, that concurrent steps never race on `shared_context` /
  `previous_outputs`, and that no irreversible side effect fires ahead of a pending approval
  (OD-056). Per `spec/05-non-functional/test-strategy.md`, this AF must reach GREEN before the slice
  ships — it is the gate on AC-5.OPT.001.1 / AC-5.OPT.001.2.
- **Integration / behaviour tests** for the remaining ACs: decomposition produces the
  `execution_plan` before any side-effecting step (AC-5.OPT.003.1); smart scheduling defers under a
  busy queue and runs on cadence when disabled (AC-5.OPT.002.1); pre-warm begins B's retrieval early,
  performs no side effect, and is discarded if B never runs (AC-5.OPT.004.1).
- **Flag-off regression:** with each CFG flag off, verify plain sequential execution / plain cadence
  / no pre-warm — proving the optimisation layer is additive and never changes correctness.
