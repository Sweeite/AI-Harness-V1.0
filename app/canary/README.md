# @harness/canary — synthetic-client canary corpus (FR-10.PRV.003 / NFR-INF.008)

The **fixed synthetic client** the canary deployment boots before a release is promoted to the
fleet. C10 owns the **corpus** (curated fake entities + a message/email corpus + seeded memories)
and its **idempotent seed**. The **smoke-battery assertions** that run against it —
retrieval-of-known-answers, contradiction detection, routing — are owned by their home components
(**C2 / C5 / C8**) and wired into the promotion gate by **ISSUE-080**; they are *not* here
(ISSUE-007 §2 "Out").

## What's in it

- **`src/fixture.ts`** — the deterministic corpus (fixed UUIDs, pure idempotency keys, no
  `Date.now()`/random) plus **`KNOWN_ANSWERS`**: the behavioural contract naming exactly which rows
  encode the retrieval target, the contradiction pair, and the routing cases. Shares dimensions
  (Northwind Traders / Dana Ruiz) with the AF-001/AF-002 spike corpus.
- **`src/port.ts`** — the `CanarySeedStore` port + `InMemorySeedStore` fake (deterministic
  embeddings, fault injection).
- **`src/supabase-seed.ts`** — the **live `SupabaseSeed` adapter** (real OpenAI
  `text-embedding-3-small` embeddings + PostgREST upserts with ON CONFLICT DO NOTHING). Run by
  **`src/seed-live.ts`** (`npm run seed:live` under `railway run`, so the OpenAI key is injected from
  the deployment env, never the disk). Target schema: **`migrations/0001_canary_target.sql`** (a
  minimal throwaway landing schema, superseded by ISSUE-008's real baseline).
- **`src/seed.ts`** — `seedCanary()`: idempotent (re-seed converges, re-applies nothing) and
  fail-loud on partial insert (typed `CanarySeedError` — never a silent half-corpus, #3).

## Run

```bash
npm install
npm run seed:dry     # prints the corpus plan + known-answers, seeds an in-memory store twice
npm test             # build-time tests (determinism, schema invariants, idempotency, fail-loud)
npm run typecheck
```

## Status (ISSUE-007 — ✅ done, 2026-07-04)

- ✅ Corpus + idempotent seed built and tested with **no live infra** (6/6, this package).
- ✅ **Live seed done (session 61)** — `SupabaseSeed` seeded the corpus into the real client-owned
  silo (`Transpera-AIOS-V1`, `ap-southeast-2`): 5 entities · 4 messages · 6 memories, real 1536-dim
  OpenAI embeddings, idempotent + fail-loud proven live. Evidence:
  `results/live-seed-evidence.2026-07-04.md`.
- **AF-066** (corpus *representativeness* — does the battery catch real regressions?) is a
  build-time EVAL, **fast-follow**, not a launch gate (NFR-INF.008).
