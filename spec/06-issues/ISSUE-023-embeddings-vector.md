---
id: ISSUE-023
title: Embeddings + HNSW vector search
epic: C — memory
status: done
github: "#23"
---

# ISSUE-023 — Embeddings + HNSW vector search

> **✅ BUILT + LIVE-VERIFIED — Session 82 (2026-07-09).** Package `app/embeddings/` (port + InMemory fake + `supabase-store.ts`
> + `check` + **44/44** tests, tsc clean). Adversarial-verified (1 BLOCKER + 3 MAJOR + 3 MINOR, all fixed regression-test-first).
> Migration `0038_embedding_event_types.sql` **applied LIVE** to the silo (head `0037→0038`). **R10 live-adapter smoke PASSED**
> (`results/live-smoke.sql`, 6 assertions vs the real silo, rolled back). **AF-019 GATE spike PASSED** (`spikes/issue-023-hnsw-forcing/`,
> 50k clustered on the live silo, isolated `af019_` fixture, torn down): the retrieval-session contract FORCES the HNSW index
> under the RLS clearance predicate — **contract 30.8 ms vs default 2178 ms seqscan (70.8×)** — the ISSUE-002 ~308× cliff RESOLVED;
> `iterative_scan` alone insufficient → `enable_seqscan=off` is the necessary lever; completeness 10/10 all roles (no starvation);
> p95 21.5 ms < 2 s. **AF-019 flipped 🟢** for index-forcing + latency + completeness. **Residual (→ AF-002 / ISSUE-025):** nearest-
> neighbour RANKING recall is NOT measurable on synthetic vectors (distance concentration) — recall/relevance QUALITY at scale
> awaits a real-embedding corpus; `ef_search` ships at the default 40 with the raise-not-drop lever ready. AF-067 was 🟢 (gate met).

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Make every memory searchable by vector: embed content on write with the single configured model, index it with pgvector HNSW from day one, and provide the zero-downtime expand-contract path for changing the embedding model — the searchable-brain substrate that retrieval (ISSUE-025) ranks over.

> **⚠️ MEASURED BUILD BLOCKER (from ISSUE-002 / AF-067 spike, 2026-07-04 — no longer paper, AF-019):** with the
> clearance RLS predicate present, the pgvector planner **defaults to a full Seq Scan (~19 s on 50k rows)** instead of
> the HNSW index (**~63 ms forced**) — a **~300× cliff**. The index composes correctly with RLS; the planner just won't
> pick it under the filter without help. **This slice MUST guarantee the HNSW index is used under the clearance
> predicate** (e.g. `hnsw.iterative_scan='relaxed_order'` + `enable_seqscan` handling / partial indexes / cost tuning),
> and the `ef_search` dial must be validated **with the RLS predicate applied**, not on bare ANN. Evidence:
> `spikes/issue-002-rls-latency/results/af-067-evidence.2026-07-04.md` (finding f′). Without this, retrieval is
> non-viable regardless of correct embeddings.

## 2. Scope — in / out
**In:** The C2 **VEC** area group — the HNSW index DDL with its tuned parameters (`m=16`, `ef_construction=64`, query-time `ef_search`); the embed-on-write behaviour (single model, default `text-embedding-3-small` / 1536 dims, model name recorded per row); the embedding-model change as an expand-contract migration (`embedding_v2` column → background re-embed → 100%-reconcile gate → read-switch → contract/rebuild). This slice **owns** the `embedding`, `embedding_model`, `embedding_v2` columns' meaning and the `memories_embedding_hnsw` index, and the `ef_search` recall/latency dial as it applies to the index. The embedding-failure-halts-commit guard (FR-2.WRT.007) is **referenced** here as a hard boundary condition on the write but is **built and owned by ISSUE-024** (the write path); this slice provides the index and embed step it plugs into.
**Out:** The write/sole-writer path, contradiction check, validate-and-commit, and the embedding-failure retry queue itself — ISSUE-024 (C2 WRT). Entity/memory row schema authoring and tagging — ISSUE-022 (C2 MEM/ENT/TAG). The retrieval pipeline, dual-search, clearance-before-ranking, ranking formula, and answer modes that *consume* this index — ISSUE-025 (C2 RET). The migration harness / expand-contract tooling this migration runs on — ISSUE-008. The RLS predicate that composes with the ANN scan — ISSUE-009/020 (C1 RLS).

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-2.VEC.001, FR-2.VEC.002, FR-2.VEC.003 (component-02 Memory).
- **NFRs:** NFR-PERF.001 (RLS hot-path budget the index must live within), NFR-PERF.002 (vector recall under the RLS predicate), NFR-PERF.009 (`ef_search` recall/latency dial).
- **Rests on:** ADR-002 (Maturity/Retrieval substrate the searchable brain feeds); `standards/migration-discipline.md` (expand-contract); AF-019 (HNSW recall/latency under RLS — LOAD; 🟢 index-forcing + latency + completeness PROVEN S82, NN-ranking recall QUALITY → AF-002/ISSUE-025 real corpus), AF-067 (live clearance predicate composes with pgvector on the hot path — the ISSUE-002 launch-gating spike), AF-002 (retrieval relevance corpus AF-019 shares).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-2.VEC.001.1
- AC-2.VEC.002.1
- AC-2.VEC.003.1
- AC-2.VEC.003.2
- AC-NFR-PERF.002.1, AC-NFR-PERF.002.2 (recall under the RLS predicate at the `ef_search` posture)
- AC-NFR-PERF.009.1 (the dial is raised, not the predicate dropped, when recall is thin)
- **Gating spikes:** AF-067 must be **GREEN** before this issue ships (ISSUE-002, the RLS-hot-path latency spike per OD-157/RP-1 — the index's clearance-filtered ANN scan is only viable if the initPlan predicate holds within budget). AF-019 (recall under the RLS predicate) is a fast-follow LOAD gate that sets the production `ef_search` value; ship behind the safe default dial (40) with the raise-not-drop posture.

## 5. Touches (complete blast radius, by ID)
- **DATA:** DATA-memories.embedding, DATA-memories.embedding_model, DATA-memories.embedding_v2; index `memories_embedding_hnsw` (and the `embedding_v2` HNSW built CONCURRENTLY during a model change).
- **PERM:** none directly (writes flow through the `service_role` sole writer, ISSUE-024; a model change is operator + change-control, no per-tool PERM node).
- **CFG:** CFG-embedding_model (change-controlled / REBUILD-class), ef_search (LIVE, int 10–500, default 40).
- **UI:** none (re-embedding-job progress + reconciliation-% are observability, not a dedicated surface in this slice).
- **Connectors:** none (embeddings are produced via the OpenAI embedding model through the AI SDK — an internal model call, not a C3 connector).

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-02-memory.md §VEC (FR-2.VEC.001–003 + their ACs; also FR-2.MEM.002 for the row schema domains and FR-2.WRT.007 for the embed-failure boundary this index plugs into).
- spec/04-data-model/schema.md §3 Memory (the `memories` table — `embedding`, `embedding_model`, `embedding_v2` columns, sole-writer/idempotency notes).
- spec/04-data-model/indexes.md §Vector (the `memories_embedding_hnsw` DDL, CONCURRENTLY build, `ef_search` query-time set, AF-019 note) + §Notes (REBUILD-class expand-contract rebuild path).
- spec/05-non-functional/performance.md — NFR-PERF.001, NFR-PERF.002, NFR-PERF.009 (hot-path budget, recall-under-predicate, `ef_search` dial).
- spec/00-foundations/adr/ADR-002-coverage-metric.md (the metrics/searchable-substrate this index serves).
- spec/00-foundations/standards/migration-discipline.md (expand-contract discipline for FR-2.VEC.003).

## 7. Dependencies
- **Blocked-by:** ISSUE-022 (memory + entity row model / `memories` table must exist before its embedding column can be indexed); ISSUE-002 (SPIKE — AF-067 must be GREEN: the RLS initPlan predicate composing with pgvector on the hot path is the precondition for a clearance-filtered ANN scan being viable).
- **Blocks:** ISSUE-025 (retrieval + ranking consumes this HNSW index and the `ef_search` dial).

## 8. Build order within the slice
1. **Index migration (expand step, on ISSUE-008's harness):** add `memories_embedding_hnsw` on `memories.embedding` — `USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64)`, built `CONCURRENTLY` (never inside a txn block; migration-discipline). Confirms pgvector ≥0.8 on the client Supabase. → AC-2.VEC.001.1.
2. **Embed-on-write hook (embed step only):** wire the writer's embed step to call the single configured model (`CFG-embedding_model`, default `text-embedding-3-small`) and stamp `embedding` (1536-dim) + `embedding_model` on the row. The commit/halt-on-failure logic that wraps this step is ISSUE-024's (FR-2.WRT.007); this slice supplies the embed call + dimension/model stamping only. → AC-2.VEC.002.1.
3. **Query-time dial:** set `hnsw.ef_search` from the `ef_search` config (default 40) on the retrieval session; expose it as the LIVE recall/latency knob (NFR-PERF.009). Ship behind the safe default with the raise-not-drop posture. → AC-NFR-PERF.009.1.
4. **Expand-contract migration path (FR-2.VEC.003):** implement the model-change sequence — add `embedding_v2` column → build its HNSW index CONCURRENTLY → background re-embed job → **reconcile gate (100% of live rows carry a valid `embedding_v2`)** → switch reads → contract (rename/drop old column + index/rebuild). The reconcile gate **blocks the contract/drop-old step** on any shortfall and halts with an alert (no orphaned/unsearchable rows). → AC-2.VEC.003.1, AC-2.VEC.003.2.
5. **Observability hook:** re-embedding-job progress + reconciliation-completeness % to `event_log`; embedding spend counted (ADR-003 cost).
6. **Tests to the ACs** (below).

## 9. Verification (how DoD is proven)
- **Build-time / migration tests:** the HNSW index exists with the documented parameters (AC-2.VEC.001.1); a written memory carries a 1536-dim embedding + model name (AC-2.VEC.002.1); the model change runs expand-contract with no downtime and the contract/drop-old step is **blocked** until 100% reconcile, halting with an alert on a partial backfill (AC-2.VEC.003.1, AC-2.VEC.003.2) — per `spec/05-non-functional/test-strategy.md`.
- **LOAD (fast-follow):** AF-019 measures recall@10 under the RLS predicate at the default `ef_search` and sets the production dial value (AC-NFR-PERF.002.1/.002.2, AC-NFR-PERF.009.1); shares the AF-002 corpus. Fallback if recall is thin: raise `ef_search` within 10–500, never drop the clearance predicate.
- **Blocking gate:** AF-067 (ISSUE-002) must read **GREEN** in `spec/00-foundations/feasibility-register.md` before ship — the AC→Verified path for the clearance-filtered ANN scan runs through NFR-PERF.001's initPlan-latency confirmation.
