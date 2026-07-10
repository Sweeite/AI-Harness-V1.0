# ISSUE-025 (C2 RET) — R10 live-adapter smoke evidence — 2026-07-10

**Package:** `app/retrieval/` (`@harness/retrieval`) · adapter `src/supabase-store.ts` (`SupabaseRetrievalStore`).
**Harness:** `results/live-smoke.ts` — drives the REAL adapter code (not hand-copied SQL) against the live silo
(`$SILO_DB_URL`, connect as `postgres`) inside ONE transaction, **`ROLLBACK`** at the end. Nothing persists.
**Run:** `source ~/.ai-harness-secrets.env && npx tsx results/live-smoke.ts`.

## Why R10 applies
This slice is read-path only (no migration), but it ships a `supabase-store.ts` with LIVE side effects — the two
search-arm queries, the retrieval-session GUCs, `similarityOf`, the entity reads, and the `event_log` / `access_audit`
writes. Offline-green (54/54) proves the pipeline logic against the in-memory fake; it CANNOT prove the adapter's SQL
agrees with the real schema + enums (the fake-passes-offline / live-throws class). This smoke closes that gap.

## Result — ALL 13 assertions PASSED (2026-07-10), silo verified clean afterward

```
PASS  [1] resolutionSnapshot reads entities — 3 entities
PASS  [2] keywordArm RAW overlap returns rows (incl. superseded — pipeline filters) — 4 rows
PASS  [2] keywordArm maps numeric confidence + pgvector
PASS  [3] vectorArm applies retrieval-session GUCs + returns top-k with similarity
PASS  [3] vectorArm ranks the on-axis match at cosine≈1 — top sim=1.0000
PASS  [4] similarityOf returns cosines by id
PASS  [5] entityTypes maps id→type
PASS  [5] entityMaturity reads the stored value — maturity=0.42
PASS  [6] appendReadEvent inserts memory_read (no 22P02)
PASS  [7] appendSensitiveAudit inserts sensitive_view + actor_type user (no 22P02, FK ok)
PASS  [8] the live 0031 memories_clearance_read policy EXISTS (clearance.ts realises it in code)
PASS  [E2E] retrieve() over the live adapter injects the cleared match, drops the superseded — injected=3
PASS  [E2E] the personal candidate was audited (sensitive access)
✓ ALL R10 assertions PASSED — rolled back, nothing persisted.
```

Post-run silo state (proves the ROLLBACK held): `memories=0 · entities=1 (Internal Org, untouched) · r10_events=0 ·
r10_audits=0 · r10_profiles=0`.

## What each assertion proves (the adapter ↔ live-schema agreement)
- **[1]–[5]** every read path (`resolutionSnapshot`, `keywordArm` RAW overlap, `vectorArm` under the ISSUE-023
  retrieval-session index-usage contract, `similarityOf` `1-(embedding<=>probe)`, `entityTypes`, `entityMaturity`)
  executes against the real `entities`/`memories` columns + the `vector` operator/cast, and maps rows correctly
  (numeric `confidence`, pgvector `embedding`).
- **[6]/[7]** the two observability writes cast to the real enums — `event_type 'memory_read'` and
  `actor_type 'user'` — with **no `22P02`**, and the `access_audit → profiles` FK is satisfied. This is the exact
  fake-accepts-any-string / live-throws hazard R10 exists to catch.
- **[8]** the live `0031 memories_clearance_read` RLS policy — the predicate `clearance.ts` realises in code for the
  service_role agent path (which bypasses RLS) — is present, so the in-code #2 filter and the live backstop are the
  same rule (Rule 0 lockstep).
- **[E2E]** the whole `retrieve()` pipeline runs over the LIVE adapter: clearance-before-ranking injects the cleared
  on-axis match, drops the superseded row (candidate filter), and audits the personal-sensitivity candidate access.

## Honest residual carried (not an R10 gap)
Nearest-neighbour **ranking recall / relevance QUALITY** at scale on a real-embedding corpus is **AF-002** (the
load-bearing fast-follow EVAL, shared with ISSUE-023's NN-ranking residual). The `memories` table is empty live, so
this smoke proves the adapter's SQL correctness on a seeded fixture, not production recall — exactly as scoped in the
ISSUE-025 DoD (AF-067 🟢 + AF-019 🟢 are the ship gates; AF-002 is fast-follow).
