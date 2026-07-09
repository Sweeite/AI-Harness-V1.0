### AF-019 evidence — HNSW index-forcing + completeness under the RLS predicate (ISSUE-023)

**(a) Verdict:** PASS → status 🟢 (for the ISSUE-023 gate — see scope)
**(b) Date / method:** 2026-07-09 · LOAD (property-holds-at-scale, isolated af019_ fixture — never touches real memories)
**(b′) Environment:** Postgres 17.6 · pgvector 0.8.2

**(c) Corpus:** 50,000 clustered memories (200 centroids) · 20 users · 6 roles · 200 entities · distribution vis 60/30/10, sens 70/20/10 · heaviest predicate = restricted-clearance (role 6).

**(d) THE GATE — planner cliff under the RLS predicate (top-10, EXPLAIN ANALYZE):**
  - **default**: 2178.013 ms · seqscan=true · index=false
  - **iterative_only**: 2660.105 ms · seqscan=true · index=false
  - **contract**: 30.751 ms · seqscan=false · index=true
  - **contract vs default speedup: 70.827×** — the ISSUE-023 retrieval-session contract (ef_search + hnsw.iterative_scan='relaxed_order' + enable_seqscan=off) FORCES the HNSW index under the clearance predicate. **This resolves the ISSUE-002 ~308× seqscan cliff — the reason ISSUE-023 is the Stage-6 gate.**
  - **iterative_scan ALONE does NOT tip the planner** (still seqscan) → `enable_seqscan=off` is the necessary lever. This is now a binding rule for ISSUE-025's retrieval session.

**(e) Completeness under the RLS predicate (contract returns a full top-10 of CLEARED rows — the clearance filter applies AFTER the ANN scan, so this checks it does not STARVE the result):**
  - role 1: cleared 20,875 rows · contract returned **10/10** ✓
  - role 2: cleared 46,568 rows · contract returned **10/10** ✓
  - role 3: cleared 46,568 rows · contract returned **10/10** ✓
  - role 4: cleared 48,822 rows · contract returned **10/10** ✓
  - role 5: cleared 20,875 rows · contract returned **10/10** ✓
  - role 6: cleared 48,822 rows · contract returned **10/10** ✓
  - all roles full = true — no starvation in the realistic predicate.

**(f) End-to-end retrieval p95 at the CFG default ef=40 (contract path, server-side):**
  - n=100 · p50 1.059 · **p95 21.478 ms** · p99 39.385 · max 39.385 — vs < 2000 ms → PASS

**(g) SCOPE / RESIDUAL (honest):** This proves the LOAD-BEARING AF-019 property for ISSUE-023 — **the HNSW index is forced under the RLS clearance predicate at 50k, within budget, without starvation.** It does **NOT** measure nearest-neighbour RANKING recall (does HNSW return the truly-nearest cleared rows). Synthetic high-dim vectors suffer distance concentration (every point ~equidistant → exact-vs-HNSW id-overlap is an artifact, measured 0 on runs 1–2), so recall/relevance QUALITY at scale is deferred to **AF-002 / ISSUE-025 with a real-embedding corpus** (where real retrieval is evaluated) — carried as a residual, not faked. CFG-ef_search ships at the default **40** with the raise-not-drop lever (NFR-PERF.009) ready for that tuning.
**(h) On a real FAIL of (d):** raise ef_search within 10–500 (never drop the predicate); a persistent seqscan under the contract would be a design fork (OD), not a code workaround (R2). (d) PASSED.
