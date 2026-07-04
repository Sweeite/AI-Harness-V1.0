# ISSUE-002 — RLS hot-path latency spike (AF-067 gate)

Runnable measurement harness for **[ISSUE-002](../../spec/06-issues/ISSUE-002-rls-latency-spike.md)**.
It proves — on a running throwaway Postgres/Supabase — that live data-driven RLS (the
`(select …)` **initPlan** permission/clearance predicate) composes with **pgvector** ranking of a
large memory batch on the retrieval hot path **within the paper latency budget**, so **AF-067** can
flip 🔴→🟢 before its dependents (ISSUE-009 scaffold, ISSUE-023 embeddings) build. One of the six
launch go/no-go SPIKE-GATEs.

Stack: **TypeScript / Node** ([ADR-009](../../spec/00-foundations/adr/ADR-009-implementation-stack.md)) + `pg`.

## What it does (maps 1:1 to ISSUE-002 §8 build order)

| Step | File | What |
|---|---|---|
| 1 declare profile | `src/config.ts` | The corpus/load profile (50k memories, 20 users, 6 roles) + the paper targets. **Contestable by design.** |
| 2 stand up | `src/schema.ts` | Permission tables · the four `SECURITY DEFINER STABLE` helpers · `memories(vector(1536))` · every policy-referenced column indexed · HNSW. |
| — the policy | `src/schema.ts` | The clearance-before-ranking RLS policy in **two modes**: `wrapped` = `(select helper(auth.uid()))` (the AF-067 rule, per-statement initPlan) and `bare` = per-row (the 178,000ms→12ms footgun) — swapped on the same table to measure the cliff. |
| 3 seed | `src/seed.ts` | Roles/users/clearances/Restricted grants across the envelope + the large corpus (embeddings generated **server-side**). |
| 5 hot path | `src/retrieval.ts` | Dual-search (vector arm + keyword arm) → clearance filter (RLS, **before** ranking) → pgvector rank, `ef_search=40`, top-k=7. |
| 6 measure | `src/measure.ts` | (a) initPlan overhead + once-per-statement + cliff · (b) `auth_rls_initplan` lint (splinter 0003 replica) · (c) end-to-end p95. |
| 7 evidence | `src/report.ts` | Emits the AF-067 evidence block (fields a–h) → `results/`. |

## Run

```bash
npm install
cp .env.example .env      # paste the Supabase DIRECT connection string (port 5432)
npm run spike             # stands up → seeds → measures → writes results/
npm run spike:teardown    # drops every spike object from the DB
```

**Prerequisites on the DB:** pgvector enabled (Supabase → Database → Extensions → `vector`), and
the `authenticated` role present (Supabase ships it; the spike also creates an `auth.uid()` shim
only if one isn't already there). Use the **direct** connection (session mode, port 5432) — the
spike sets per-transaction GUCs (`set local role authenticated`, `request.jwt.claims`,
`hnsw.ef_search`) that the transaction pooler can break.

## The three acceptance criteria this proves

- **AC-NFR-PERF.001.1** — initPlan overhead **< ~50 ms/statement**, predicate evaluated **once per
  statement** (initPlan Actual Loops = 1), not per row.
- **AC-NFR-PERF.001.2** — the `auth_rls_initplan` lint passes (every `auth.*`/helper call wrapped in
  `(select …)`; every policy-referenced column indexed).
- **AC-NFR-PERF.003.2** — end-to-end retrieval **p95 < 2 s**.

PASS on all three ⇒ AF-067 → 🟢. Any FAIL is a **design fork** (R2/R9): open an OD, consider the
D2 JWT-claim-cache fallback ([OOS-012](../../spec/00-foundations/out-of-scope.md)) — do **not** code
around it, and do **not** let dependents (ISSUE-009/023) build on an unproven gate.

## Posture (non-negotiables)

- **What's proven vs assumed:** this measures **latency**. Relevance/ranking = AF-002/ISSUE-025;
  HNSW recall-under-RLS + production `ef_search` = AF-019/ISSUE-023; aal2/RLS-coverage completeness
  = AF-076/AF-079. All explicitly **out of scope** here (ISSUE-002 §2).
- **Random embeddings** are correct for a latency measurement (they stress the scan + predicate
  identically); they would be wrong for a relevance measurement (which this is not).
- **Throwaway:** nothing here ships as-is. The permanent RLS scaffold is **ISSUE-009**; this spike
  only confirms the initPlan-wrapping + indexing pattern it will codify.

## Output

`results/af-067-evidence.<date>.{json,md}` — paste the markdown block into
[feasibility-register.md](../../spec/00-foundations/feasibility-register.md) block G (AF-067) and
flip 🔴→🟢 on PASS.
