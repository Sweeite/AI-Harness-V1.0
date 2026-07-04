---
id: ISSUE-002
title: "SPIKE: RLS hot-path latency (initPlan predicate + clearance-before-rank)"
epic: "S — spikes"
status: done
github: "#2"
---

# ISSUE-002 — SPIKE: RLS hot-path latency

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR/NFR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and run this spike to its Definition of done **without guessing**.

## 1. Goal (one line)
Prove — on a running throwaway system — that live data-driven RLS (the `(select …)` initPlan permission/clearance predicate) composes with pgvector ranking of a large memory batch on the retrieval hot path within the paper latency budget, so **AF-067** can be marked GREEN before its dependents build.

## 2. Scope — in / out
**In:** A throwaway spike (not production code) that stands up the RLS permission/clearance shape from ADR-006 — the `SECURITY DEFINER STABLE` helper functions (`user_perms`, `user_clearances`, `user_restricted`, `user_aal`) each invoked as `(select helper(auth.uid()))`, a static/generic RLS policy on a `memories`-shaped table carrying the visibility ∩ sensitivity ∩ Restricted clearance predicate applied **before** ranking, indexed policy-referenced columns, and `TO authenticated` scoping — loads a realistic memory corpus at the ADR-001 envelope (≤~20 users/silo, ~6 roles, tiny fully-indexed permission tables), runs the dual-search + clearance-filter + pgvector-rank retrieval under a realistic clearance predicate, and **measures**: (a) per-statement initPlan predicate overhead, (b) end-to-end retrieval p95, and confirms the helper evaluates **once per statement, not per row**. Also runs the `auth_rls_initplan` advisor lint (Supabase lint 0003) against the policies. Produces a dated PASS/FAIL evidence record logged in the feasibility register (AF-067 → 🟢/⛔), and — on PASS — the confirmed initPlan-wrapping + indexing pattern the ISSUE-009 scaffold will codify.
**Out:** The permanent RLS scaffold, helper implementations, per-table policies, and the 100%-coverage CI gate (**ISSUE-009** owns those). HNSW recall-under-RLS starvation and the production `ef_search` value (**AF-019 / NFR-PERF.002 / NFR-PERF.009** — owned by **ISSUE-023**). Retrieval relevance/ranking-weight quality (**AF-002 / NFR-PERF.003 relevance half** — EVAL owned by **ISSUE-025**). aal2 coverage completeness (AF-076) and RLS-coverage-completeness (AF-079) — POSTURE gates, not this spike. This issue is a **throwaway spike**: nothing it builds ships as-is.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs (proven, not built here):** FR-1.RLS.002 · FR-1.CLR.006 (component-01 RBAC) · FR-2.RET.004 (component-02 Memory) — the live-clearance-predicate-composes-with-ranking claim these rest on.
- **NFRs:** NFR-PERF.001 (RLS on the hot retrieval path) · NFR-PERF.003 (retrieval end-to-end p95 — latency half only; relevance half is AF-002/ISSUE-025).
- **Rests on:** ADR-006 (D3 live data-driven RLS; §2 static generic policies; Axis-3 hot-path cost) · AF-067 (the spike this issue *is*).

## 4. Definition of done (the `AC-*` / `AC-NFR-*` IDs that must pass — text read in the FR)
- AC-NFR-PERF.001.1 — initPlan overhead within budget, predicate once-per-statement (not per row).
- AC-NFR-PERF.001.2 — `auth_rls_initplan` advisor lint passes over the spike policies.
- AC-NFR-PERF.003.2 — end-to-end hot-path retrieval latency meets the stated p95 target (the AF-067-gated latency AC of NFR-PERF.003).
- **Gating spike:** this issue **is** the spike that proves **AF-067** → the AF must move to 🟢 GREEN with dated evidence logged in `feasibility-register.md` (block G) per OD-157 / RP-1. It is one of the six launch go/no-go SPIKE-GATEs (`test-strategy.md` §4). On ⛔ FAIL, the documented fallback is the D2 JWT-cache (rejected primary; retained as fallback → OOS-012).

## 5. Touches (complete blast radius, by ID)
- **DATA:** DATA-memories (spike-shaped copy: embedding, visibility, sensitivity, entity linkage for the clearance predicate) · DATA-roles · DATA-role_permissions · DATA-user_roles · DATA-sensitivity_clearances · DATA-restricted_grants (the permission tables the helpers read). *(Spike fixtures, not migrations against the real schema.)*
- **PERM:** none created — the spike consumes the clearance/visibility/Restricted shape; PERM nodes are homed in ISSUE-018.
- **CFG:** CFG-ef_search (default 40) · CFG-memories_injected_per_task (default 7) — set to defaults as the retrieval knobs during measurement (not tuned here; ef_search tuning is ISSUE-023).
- **UI:** none.
- **Connectors:** none.

## 6. Context manifest (the EXACT files to open — nothing more)
- `spec/05-non-functional/performance.md` §NFR-PERF.001, §NFR-PERF.003 — the latency posture + the ACs + the paper targets (<~50 ms/statement, <~2 s p95).
- `spec/05-non-functional/test-strategy.md` §3 (AF de-risking schedule), §4 (the six launch go/no-go gates) — how AF-067 gates and the LOAD+SPIKE layer.
- `spec/00-foundations/feasibility-register.md` block G (AF-067) — the exact claim, the `(select …)` initPlan precision, the Supabase 178,000ms→12ms benchmark, and the OOS-012 fallback.
- `spec/00-foundations/adr/ADR-006-rls-dynamic-roles.md` — D3 (live data-driven RLS), Decision parts 2/3/6, Axis-3 (hot-path cost).
- `spec/04-data-model/rls-policies.md` — the helper-function contracts (`user_perms`/`user_clearances`/`user_restricted`/`user_aal`), the `(select …)` initPlan rule, and the `memories` clearance-before-ranking row of the per-table summary.
- `spec/04-data-model/schema.md` (`memories` row, ~L285–298) — the `DATA-memories` column shape the spike fixture copies: `embedding vector(1536)`, visibility, sensitivity, entity linkage (the dimension is homed in FR-2.MEM.002, §MEM — outside §RET — so it is pinned here to avoid a builder guess).
- `spec/01-requirements/component-01-rbac.md` §RLS, §CLR — FR-1.RLS.002 / FR-1.CLR.006 text + ACs.
- `spec/01-requirements/component-02-memory.md` §RET — FR-2.RET.004 text + ACs. *(The `vector(1536)` embedding dimension is in §MEM's FR-2.MEM.002, not §RET — pinned via `schema.md` above.)*
- `spec/00-foundations/open-decisions.md` OD-157 (RP-1) — the resolved decision naming the six launch-gating spikes and the RP-1 evidence-logging authority the DoD (§4) cites for the AF-067 GREEN record.

## 7. Dependencies
- **Blocked-by:** none (foundational — a Tier-0 spike, runs first / alongside).
- **Blocks:** ISSUE-009 (RLS scaffold — must not codify the initPlan pattern until this proves it), ISSUE-023 (embeddings + HNSW vector search — retrieval under the RLS predicate). *(Per the backlog spike-sequencing line, AF-067 also precedes ISSUE-025; 009 and 023 are the recorded `blocks` edges for this issue.)*

## 8. Build order within the slice
1. Stand up a throwaway Supabase/Postgres project with pgvector (ADR-001 envelope: one silo, ≤~20 users, ~6 roles).
2. Create the permission tables (`roles`, `role_permissions`, `user_roles`, `sensitivity_clearances`, `restricted_grants`) + the four `SECURITY DEFINER STABLE` helper functions, each **wrapped in `(select helper(auth.uid()))`** (ADR-006 §2; rls-policies.md helper contracts) — this wrapping is the load-bearing thing under test (bare `STABLE` re-evaluates per row: 178,000ms→12ms).
3. Create a `memories`-shaped table (embedding `vector(1536)` per FR-2.MEM.002 / `schema.md` `memories` row + visibility + sensitivity + entity linkage), load a **realistic memory corpus** at scale, index every policy-referenced column, HNSW-index the embedding, seed roles/clearances/Restricted grants across the ~20 users.
4. Author the static/generic RLS policy on `memories` carrying the visibility ∩ sensitivity ∩ Restricted predicate, `TO authenticated`, applied **before** ranking (FR-2.RET.004 / rls-policies.md `memories` row).
5. Run the retrieval hot path (dual-search + clearance filter + pgvector rank, `ef_search=40`, top-`k=7`) under a realistic clearance predicate; capture `EXPLAIN`/timing to confirm the initPlan evaluates once per statement (not per row).
6. Measure: per-statement predicate overhead vs <~50 ms; end-to-end p95 vs <~2 s (AC-NFR-PERF.001.1, AC-NFR-PERF.003.2). Run the `auth_rls_initplan` advisor lint (AC-NFR-PERF.001.2).
7. Log a dated PASS/FAIL evidence record → set AF-067 status in `feasibility-register.md` block G; on FAIL, record the OOS-012 D2-JWT-cache fallback trigger.

## 9. Verification (how DoD is proven)
- **Layer:** LOAD + SPIKE per `test-strategy.md` §1 (property-holds-at-scale under the ≤~20-user/silo envelope) — this is the AF-067 LOAD+SPIKE row of §3.
- **Launch posture:** **SPIKE-GATE** — one of the six go/no-go spikes (`test-strategy.md` §4.4). No dependent (ISSUE-009/023, and downstream ISSUE-025) may treat the initPlan latency as proven until AF-067 shows a logged **PASS**; a criterion held only by an unproven AF-067 stays `Ready`, not `Verified` (the `AC → Verified` rule, §1). Evidence (dated measurements + lint result) logged in `feasibility-register.md`; on ⛔ FAIL the design falls back to the D2 JWT-claim cache (OOS-012), accepting a staleness window.
