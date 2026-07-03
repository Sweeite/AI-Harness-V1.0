---
id: ISSUE-049
title: Task graphs + idempotency keys + resume-from-incomplete-step
epic: F — harness
status: blocked
github: "#49"
---

# ISSUE-049 — Task graphs + idempotency keys + resume-from-incomplete-step

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Give every task type a versioned, dependency-ordered task graph the harness executes deterministically, with per-task/per-step idempotency keys and resume-from-first-incomplete-step so a retry never re-runs completed steps and never double-fires a side effect.

## 2. Scope — in / out
**In:** The `task_graph_versions` store and its change-control discipline (new version + mandatory `change_reason`, prior versions retained); graph-driven execution in dependency order with a loud config-error when a task type has no registered graph (at creation/dequeue, not deep in execution); idempotency-key generation per task and per step (stable, collision-resistant, committed no later than the side effect); and resume logic that restarts a retried task at the first incomplete step, reusing the preserved outputs of completed steps rather than re-executing them. The chain-depth ceiling on a graph (`chain_depth_limit`) is honoured here as a graph property.

**Out:** The Inngest execution engine itself — step-function mapping, step-level retry, backoff, single-retry-authority projection into `task_queue`, fan-out, and DLQ — is **ISSUE-052** (C5 JOB); this slice consumes those as the mechanism that *realises* resume (FR-5.JOB.002) but does not build them. The context envelope (structure, full-envelope-per-step, inter-step compression, `task_history` originals store) is **ISSUE-050** (C5 ENV) — this slice reads the durable originals for resume but does not own them. Plan-build enforcement of `chain_depth_limit` (FR-8.PLAN.003) is **ISSUE-064** (C8 PLAN). The `task_queue` record, status machine, approval-block and priority are **ISSUE-048** (blocker). Parallel-DAG / decomposition optimisation is **ISSUE-054**.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-5.GRP.001, FR-5.GRP.002, FR-5.GRP.003, FR-5.GRP.004 (all component-05 Agent Harness, C5)
- **NFRs:** NFR-PERF.007 (chain-depth ceiling honoured on the graph; plan-build enforcement is FR-8.PLAN.003 / ISSUE-064 — seam)
- **Rests on:** ADR-004 (§4 idempotency ledger pattern, §2 per-key concurrency); `standards/change-control.md` (versioned-asset discipline mirrored from C4); AF-018 (🟢 Inngest idempotency/retry, verified), AF-063 (per-key concurrency serialises same-entity steps), AF-112 (idempotency holds under catch-up at scale), AF-115 (originals-store retention outlives the longest chain + audit window)

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-5.GRP.001.1, AC-5.GRP.001.2
- AC-5.GRP.002.1
- AC-5.GRP.003.1, AC-5.GRP.003.2, AC-5.GRP.003.3
- AC-5.GRP.004.1
- AC-NFR-PERF.007.1 (chain-depth over-limit is a visible reject/trim, never a silent truncation — enforcement point shared with ISSUE-064)
- **Gating spikes (if any):** none of the six launch-gating spikes (ISSUE-001–006) gate this issue. Build-time AFs attach as DoD posture, per `test-strategy.md`: **AF-112** (crash-window key-before-side-effect ordering per AC-5.GRP.003.2 + catch-up dedup at scale) and **AF-115** (durable originals retained long enough for resume) must reach POSTURE before ship. AF-063 (per-key concurrency) backs the same-entity serialisation assumption in ADR-004 §2.

## 5. Touches (complete blast radius, by ID)
- **DATA:** DATA-task_graph_versions (id, task_type_name, version, steps jsonb [ordered; per-step deps + failure mode], change_reason, previous_version_id, created_at, created_by, unique(task_type_name, version)); DATA-task_queue (read: dequeue by type → resolve graph; idempotency-key state per step); DATA-task_history (read-only here: durable originals reused on resume — owned by ISSUE-050)
- **PERM:** none net-new (graph edits are Super-Admin/Admin via config-store change-control, same posture as other versioned assets)
- **CFG:** chain_depth_limit (default 6, int ≥ 1, LIVE)
- **UI:** none in this slice (task-graph version viewer rides the config/queue surfaces owned elsewhere)
- **Connectors:** none

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-05-harness.md — §GRP (FR-5.GRP.001–004 + their ACs); §JOB (FR-5.JOB.002 for the resume seam, read-only) and §ENV (FR-5.ENV.003 for the originals-retention seam, read-only)
- spec/04-data-model/schema.md §6 (Execution / Harness) — `task_graph_versions`, `task_queue`, `task_history`; §Global rules (versioned-tables append-only-by-version); §Types (task_type, task_status)
- spec/05-non-functional/performance.md — NFR-PERF.007 (chain-depth limit)
- spec/00-foundations/adr/ADR-004-*.md — §2 per-key concurrency, §4 idempotency ledger pattern
- spec/00-foundations/standards/change-control.md — versioned-asset discipline (change_reason mandatory, no destructive edit)
- spec/00-foundations/feasibility-register.md — AF-018, AF-063, AF-112, AF-115

## 7. Dependencies
- **Blocked-by:** ISSUE-048 (task_queue permanent record + status machine + approval-block + priority — this slice binds graphs and idempotency state to those rows and dequeues by type)
- **Blocks:** ISSUE-052 (Inngest execution engine + step retry + fan-out + DLQ — maps each graph step to an Inngest step function and realises resume), ISSUE-054 (execution optimisation — parallel DAG / decomposition / pre-warm builds on the defined graph + idempotency)

## 8. Build order within the slice
1. Migration: add `task_graph_versions` (§6) with the `unique(task_type_name, version)` constraint and `previous_version_id` self-reference; register it under the versioned-tables append-only rule (Global rules — no overwrite, `change_reason` non-empty).
2. Graph-resolution path at dequeue: given a `task_queue` row's `type`, resolve its current registered graph version; a type with **no** registered graph fails loud with a recorded error at creation/dequeue (AC-5.GRP.001.2), never left silently `pending` (#3).
3. Graph executor: run the graph's `steps` in dependency order (AC-5.GRP.001.1); enforce the `chain_depth_limit` ceiling on the graph as a reject/trim-with-logged-outcome, never a silent cut (AC-NFR-PERF.007.1) — coordinate the plan-build enforcement point with ISSUE-064.
4. Idempotency-key derivation: generate a stable, collision-resistant key per task and per step (e.g. `task_id` + `step_id` + payload-content hash, modelled on ADR-004 §4 `idempotency_ledger`), committed **no later than** the side effect so a crash between side-effect and completion-record cannot double-fire (AC-5.GRP.003.1/.2/.3).
5. Resume logic: on retry, locate the first incomplete step, reuse the preserved outputs of steps 1..k-1 from the durable step record (read `task_history` — ISSUE-050), and resume at step k without re-executing earlier steps (AC-5.GRP.004.1). This is the harness-side contract that ISSUE-052 realises via Inngest step-level retry (FR-5.JOB.002).
6. Change-control on edit: a graph edit inserts a new version row with a non-empty `change_reason`; a save without a reason is rejected; prior versions are retained and never overwritten (AC-5.GRP.002.1).
7. Tests to each AC listed in §4, including the AF-112 crash-window / collision-resistance verification gates and the AF-115 originals-retention posture.

## 9. Verification (how DoD is proven)
- **Unit/integration** (per `spec/05-non-functional/test-strategy.md`): graph-in-dependency-order execution; missing-graph loud-fail at creation/dequeue; version-on-edit with mandatory `change_reason`; idempotency-key stability + collision-resistance; resume-from-first-incomplete-step reusing preserved outputs.
- **AF posture (build-time gates, not launch spikes):** AF-112 must reach POSTURE — the crash-window ordering claim of AC-5.GRP.003.2 (key committed before side effect) and catch-up dedup at scale are paper until the LOAD/SPIKE proves them; AF-115 must confirm the durable originals store outlives the longest chain + audit window (else the resume path must read a C5-owned durable store, not the engine). AF-063 backs the same-entity serialisation assumption (ADR-004 §2). Each AC reaches `Verified` only once its paired AF posture holds.
