# Canary live-seed evidence — FR-10.PRV.003 live half (SupabaseSeed)

**Date:** 2026-07-04 · **Session:** 61 · **Result:** 🟢 PASS · **Run by:** operator-present two-party session.

The remaining live half of ISSUE-007: build the `SupabaseSeed` adapter (real OpenAI embeddings +
idempotent upserts into the client-owned Supabase silo) and boot the synthetic canary corpus into it.
Companion to `../../provisioning/results/af-004-evidence.2026-07-04.md` (the AF-004 provisioning run).

## Infrastructure used (real)

| Piece | Identity (non-secret) |
|---|---|
| Client silo (Supabase) | `Transpera-AIOS-V1`, ref `nwufvzaamomajdyzemhx`, region `ap-southeast-2` |
| Embeddings | OpenAI `text-embedding-3-small` (1536-dim), key read from the Railway deployment env |
| Seed executor | `railway run --service AI-Harness-V1.0 npm run seed:live` (env injected transiently) |

## Target schema (minimal, canary-only — the `client_registry` precedent)

`app/canary/migrations/0001_canary_target.sql` applied to the silo via the Supabase Management API
(`/database/query` + operator PAT): `create extension vector`; `entities`, `messages` (comms), and
`memories (embedding vector(1536))`. **Scope:** a throwaway precondition so the live seed has a target,
superseded by ISSUE-008's real 0001 baseline. **No RLS** (a #2 posture gap — tracked as an ISSUE-009
residual; acceptable only because the silo holds solely synthetic corpus data). See the DDL header.

## How the key was handled (secrets hygiene)

`OPENAI_API_KEY` is operator-held and lives only in the Railway deployment env — it never landed on the
operator's disk or in the repo/chat. The seed reads it from `process.env`, injected transiently by
`railway run`. (Root-cause note: the stored key was found malformed — the leading `s` had been dropped
on paste, `k-proj-…`. Reconstructed as `sk-proj-…`, validated live against OpenAI `/v1/models` → 200,
and written back to Railway via `railway variable set --stdin --skip-deploys` — value computed from the
injected env, never printed. Now `sk-proj-…`, 164 chars, 200 OK at source.)

## What was proven (each an FR-10.PRV.003 live-half sub-claim)

1. **Real embeddings** — every memory embedded via OpenAI `text-embedding-3-small`; **0 null embeddings**,
   all **1536-dim**, `embedding_model = text-embedding-3-small` in the silo.
2. **Idempotent live upsert** — existence-check-then-insert (seed.ts) + PostgREST `Prefer:
   resolution=ignore-duplicates` (ON CONFLICT DO NOTHING) on the natural keys (`id` / `idempotency_key`):
   - Run 1 (fresh, before the key fix): inserted 5 entities + 4 messages, then **failed LOUD** at the
     first memory (typed `CanarySeedError`, OpenAI 401) — **no silent half-seed (#3)**.
   - Run 2 (after key fix, resume): inserted the **6 memories**, skipped the 9 rows already present.
   - Run 3 (re-run): **0 inserted, 15 skipped** — fully converged (AC-NFR-INF.006.1 posture, live).
3. **Corpus landed** — silo now holds **5 entities · 4 messages · 6 memories**; the `KNOWN_ANSWERS`
   retrieval target (`20000000-…-0001`, "Dana Ruiz is the account manager for Northwind…") is present
   with a 1536-dim embedding, giving the C2/C5/C8 smoke battery a live target.

## Verdict

**FR-10.PRV.003 live half → 🟢.** Real OpenAI embeddings + idempotent, fail-loud live upsert into the
client-owned silo, verified by row counts + embedding integrity + convergence on re-run. The
smoke-battery *assertions* remain owned by C2/C5/C8 (ISSUE-007 §2 Out); **AF-066** (corpus
representativeness) is an unchanged fast-follow EVAL. Combined with the codified `RailwayInfra`
(`app/provisioning/src/infra.ts`) and AF-004 🟢, this closes the ISSUE-007 §10 remainder.
