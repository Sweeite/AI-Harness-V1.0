# @harness/task-graphs — ISSUE-049 (C5 GRP)

Versioned, dependency-ordered **task graphs** the harness executes deterministically, with
per-task/per-step **idempotency keys** and **resume-from-first-incomplete-step**. Implements
FR-5.GRP.001–004 + NFR-PERF.007 (chain-depth ceiling). Offline build (Stage-4 fan-out): port +
in-memory fake reference model + live pg adapters authored to the baseline DDL (NOT run live).

## What's here

| file | role |
|---|---|
| `src/store.ts` | the ports + **in-memory fake reference models** + the pure engine: `resolveDependencyOrder` (Kahn topological), `stepIdempotencyKey`/`taskIdempotencyKey` (FNV-1a over canonical JSON), the append-only `InMemoryGraphStore`, `InMemoryHistoryStore`, `InMemoryIdempotencyLedger` (ADR-004 §4), and `GraphExecutor` (resume + key-before-side-effect). |
| `src/supabase-store.ts` | the **live pg adapters** authored to `0001_baseline.sql` (`task_graph_versions`, `task_history`) + the proposed `idempotency_ledger` / `event_log`. **NOT run live.** |
| `src/index.ts` | public surface. Re-exports `TaskType` from `@harness/task-queue` (ISSUE-048) as the dequeue→graph resolution key. |
| `src/task-graphs.test.ts` | offline proof of **every §4 AC** (10 tests). |
| `results/proposed-shared-spec.md` | the additive DB/config deltas the orchestrator applies serially. |
| `results/proposed-migration-task-graphs.sql` | the append-only trigger/REVOKE + `idempotency_ledger` DDL. |

## AC coverage (all offline-green)

- **AC-5.GRP.001.1** — steps run in dependency (topological) order, not array order.
- **AC-5.GRP.001.2** — a graph-less task type fails **loudly + recorded** at dequeue (never silent pending, #3).
- **AC-5.GRP.002.1** — an edit creates a **new version** (prior retained) with mandatory non-empty `change_reason`.
- **AC-5.GRP.003.1** — stable per-task/per-step keys; a retried completed step **dedups** (no re-fire).
- **AC-5.GRP.003.2** — **crash-window**: key committed before the side effect → a crash between them → no double-fire.
- **AC-5.GRP.003.3** — collision-resistance: distinct→distinct, identical→same (500-key property sweep).
- **AC-5.GRP.004.1** — **resume** from the first incomplete step; 1..k-1 reused, not re-executed.
- **AC-NFR-PERF.007.1** — over-limit graph is a **visible reject** (or logged trim), never a silent truncation.

## Residual AFs (owed to live)

- **AF-112** (LOAD/EVAL) — crash-window ordering + catch-up dedup *at scale*. Offline crash-window unit + collision property proven; scale posture owed.
- **AF-115** (DOCS/SPIKE) — durable-originals retention outlives the longest chain + audit window. Resume-reads-originals proven; retention TTL owed. (Fail-safe already reads the durable `task_history`, not an engine cache.)
- **AF-063** (DOCS/SPIKE) — Inngest per-key concurrency (backs ADR-004 §2). Owed to ISSUE-052.

## Run

```
npm install         # links @harness/task-queue via file:../task-queue
npm run typecheck   # tsc --noEmit — clean
npm test            # tsx --test — 10/10 pass
```
