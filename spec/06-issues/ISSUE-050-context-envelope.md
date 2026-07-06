---
id: ISSUE-050
title: Context envelope + full-envelope-per-step + compression + originals retention
epic: F — harness
status: in-progress
github: "#50"
---

# ISSUE-050 — Context envelope + full-envelope-per-step + compression + originals retention

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Give every multi-step task a stateful context envelope that each step reads in full and appends to, with long chains compressed for the working prompt while the uncompressed originals are retained durably (economy, never knowledge loss).

## 2. Scope — in / out
**In:** The C5 ENV area only — the context-envelope data structure (`task_id`, `original_request`, `entities`, `memory_retrieved`, `execution_plan`, `current_step`, `previous_outputs`, `shared_context`); the per-step discipline of reading the full envelope, appending output to `previous_outputs`, and passing it forward (no cold start); and inter-step compression above the configured token/step threshold that summarises older outputs for the next step's prompt **while retaining the full uncompressed originals** in the durable `task_history` store. Includes the durable `task_history` table and the wiring that reads it back on resume/audit.

**Out:** Task-graph definition, versioning, idempotency keys, and the resume-from-first-incomplete-step algorithm itself — owned by **ISSUE-049** (C5 GRP); this slice only supplies the retained originals that resume reads. Inngest step-function mapping, step-level retry, and DLQ — **ISSUE-052** (C5 JOB). Prompt-stack assembly, memory read flow that populates `memory_retrieved`, and per-step execution order — **ISSUE-053** (C5 ASM). Decomposition/planning that populates `execution_plan` — **ISSUE-054** (C5 OPT.003). The `task_queue` record/status machine — **ISSUE-048** (C5 QUE).

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-5.ENV.001, FR-5.ENV.002, FR-5.ENV.003 (all component-05-harness / C5)
- **NFRs:** NFR-PERF.008
- **Rests on:** ADR-005 (Inngest execution engine / step-state), OD-055 (compression summarises working envelope, retains originals), AF-114, AF-115

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-5.ENV.001.1
- AC-5.ENV.002.1
- AC-5.ENV.003.1
- AC-5.ENV.003.2
- AC-NFR-PERF.008.1
- AC-NFR-PERF.008.2
- **Gating spikes (if any):** none launch-gating (ISSUE-001..006 not in this chain). Build-time feasibility gates that must be GREEN before ship: **AF-114** (compression preserves task-critical state — EVAL; gates FR-5.ENV.003 / AC-5.ENV.003.2 / AC-NFR-PERF.008.2) and **AF-115** (originals store outlives longest chain + audit window; if Inngest step-state retention is shorter, persist to the C5-owned `task_history` durable store — DOCS/SPIKE; gates FR-5.ENV.003 durability, the M4 verification gate).

## 5. Touches (complete blast radius, by ID)
- **DATA:** DATA-context_envelope (runtime, Inngest step-state — fields per FR-5.ENV.001), DATA-task_history (durable originals tail: `task_id`, `step_index`, `full_output`, `created_at`, unique `(task_id, step_index)`), DATA-task_queue (FK target only — `task_history.task_id` references it; not modified here)
- **PERM:** none
- **CFG:** compression_threshold_tokens (LIVE, int ≥ 1000, default 8000)
- **UI:** none in this slice (envelope/step-output viewer is a later observability surface, not owned here)
- **Connectors:** none

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-05-harness.md — the ENV FRs (FR-5.ENV.001/002/003) + their ACs, and the AF-114/AF-115 rows
- spec/04-data-model/schema.md §6 Execution / Harness (C5) — `task_history` table + the `DATA-context_envelope` runtime note
- spec/05-non-functional/performance.md §NFR-PERF.008 — the compression-threshold posture + `compression_threshold_tokens` config
- spec/00-foundations/adr/ADR-005-*.md — Inngest execution engine / step-state (where the live envelope lives at runtime)
- spec/00-foundations/feasibility-register.md — AF-114, AF-115 (verification method + what GREEN means)

## 7. Dependencies
- **Blocked-by:** ISSUE-048 (task_queue permanent record + status machine — `task_history.task_id` FK targets `task_queue.id`; the envelope is per-task)
- **Blocks:** none (leaf)

## 8. Build order within the slice
1. Migration (schema.md §6): add durable `task_history` (`id`, `task_id` FK→`task_queue(id)` on delete cascade, `step_index`, `full_output` jsonb, `created_at`, unique `(task_id, step_index)`) via the expand-contract migration harness.
2. Register `compression_threshold_tokens` (LIVE, int ≥ 1000, default 8000) in the config store.
3. Implement the context-envelope structure (FR-5.ENV.001) as the stateful per-task container carried through the chain, held in Inngest step-state at runtime (`DATA-context_envelope`).
4. Implement full-envelope-per-step read/append/pass-forward with no cold start (FR-5.ENV.002): each step reads the full envelope and appends its output to `previous_outputs`.
5. Implement inter-step compression (FR-5.ENV.003): above `compression_threshold_tokens`, summarise earlier outputs into the working envelope for the next step's prompt, **and** write the full uncompressed output to `task_history` (the originals tail) — economy, never loss (#1, OD-055).
6. Wire the originals read-back path so resume (ISSUE-049's FR-5.GRP.004) and audit reconstruct from retained originals rather than the compressed summary.
7. Tests to the ACs in field 4, incl. the AF-114 fidelity check and the AF-115 retention-lifetime check.

## 9. Verification (how DoD is proven)
- Unit/integration per spec/05-non-functional/test-strategy.md: envelope field-completeness (AC-5.ENV.001.1); step read/append round-trip (AC-5.ENV.002.1); compression-with-durable-originals and resume-from-compressed-chain reconstruction (AC-5.ENV.003.1/.2, AC-NFR-PERF.008.1).
- The AC→`Verified` path is blocked until the build-time feasibility gates are GREEN: **AF-114** (EVAL — compression preserves task-critical state; proves AC-5.ENV.003.2 / AC-NFR-PERF.008.2) and **AF-115** (DOCS/SPIKE — originals store retains uncompressed outputs longer than the longest chain + audit window; if Inngest step-state falls short, the `task_history` durable store carries it). Record both results against the feasibility-register entries before sign-off.
