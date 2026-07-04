### AF-067 evidence — RLS hot-path latency spike (ISSUE-002)

**(a) Verdict:** PASS → status 🟢
**(b) Date / method:** 2026-07-04 · SPIKE+LOAD (property-holds-at-scale, ≤~20-user/silo envelope)
**(b′) Environment:** Postgres 17.6 · pgvector 0.8.2 · ef_search=40 · HNSW (vector_cosine_ops)

**(c) Declared corpus profile (the load basis — contestable by design):**
- 50,000 memories · 20 users · 6 roles · 200 entities
- ADR-001 envelope: tiny, fully-indexed permission tables (why the live-RLS lookup is plausible); the memory batch is the contestable number.
- Distribution: visibility 60/30/10 global/team/private · sensitivity 70/20/10 normal/personal/restricted.
- Measured under the HEAVIEST predicate (a restricted-clearance subject exercising all four helpers).

**(d) initPlan overhead + once-per-statement (AC-NFR-PERF.001.1):**
- Wrapped `(select …)` policy: initPlan overhead **1.056 ms/statement** vs < 50 ms target → PASS
- initPlan Actual Loops = [1,1,0,1] → once-per-statement: **confirmed** (each helper's initPlan runs exactly once, not per row)
- Index-path retrieval execution (server-side): 9.418 ms

**(d′) The wrapped-vs-bare cliff — why the `(select …)` rule is binding:** isolated with `select count(*) from memories` over 50,000 rows (no vector distance to mask the signal — the query's cost IS the per-row predicate evaluation):
- Wrapped (each helper's initPlan runs once per statement): 758.828 ms
- Bare (helpers re-evaluated once per row, ~4×50,000 calls): 1866.283 ms → **2.459× slower** than wrapped
- Helpers read tiny fully-indexed tables, so the ratio is smaller than Supabase's headline expensive-helper benchmark (178,000→12 ms); the direction and mechanism are identical — the wrapper is what keeps it once-per-statement.

**(e) auth_rls_initplan lint — splinter 0003 replica (AC-NFR-PERF.001.2):** PASS
- policy `memories_clearance`; violations: none (every auth/helper call wrapped in (select …))

**(f) End-to-end retrieval p95 — production-intended index path (AC-NFR-PERF.003.2):**
- n=200 · min 0.655 · p50 0.765 · **p95 0.899 ms** · p99 58.802 · max 64.379 · mean 1.682 (all ms)
- vs < 2000 ms target → PASS
- restricted-user (fattest predicate) p95: 0.818 ms

**(f′) ⚠️ SURFACED FINDING → AF-019 / ISSUE-023 (NOT an AF-067 failure, but a hard build requirement):**
The RLS clearance predicate does not slow the initPlan — but it changes the pgvector planner's
choice. **By default the planner mis-costs the filtered vector search and falls back to a full Seq
Scan: 19415.492 ms** (uses seqscan: true). Forced onto
the HNSW index it is **62.998 ms** (uses seqscan: false)
— a **308.192× cliff**. The HNSW index composes correctly with RLS; the planner just
won't pick it under a filter without help. **ISSUE-023 MUST guarantee the vector index is used under
the clearance predicate** (partial indexes / cost tuning / `hnsw.iterative_scan`), or every retrieval
is seconds and the product is non-viable. This is exactly the AF-019 "pgvector applies RLS after the
ANN scan" risk — now demonstrated real on 50,000 rows.

**(g) Scope note:** LATENCY only. Relevance/ranking quality = AF-002/ISSUE-025; HNSW recall-under-RLS starvation + production ef_search = AF-019/ISSUE-023 (see f′); aal2/RLS-coverage completeness = AF-076/AF-079. Random embeddings (correct for a latency measurement).

**(h) On ⛔ FAIL — documented fallback:** the D2 JWT-claim cache (rejected primary; retained as fallback → OOS-012), accepting a staleness window. A FAIL is a design fork (OD), not a bug to code around (ISSUE-002 §9 / R2).
