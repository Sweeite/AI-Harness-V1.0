# app/silo — per-client silo schema + migration harness

The **client silo** is each client's own Supabase. This package holds its schema — **migration 0001,
the greenfield baseline** — and the **migrate runner** that applies migrations per-deployment. Built by
**ISSUE-008** (Stage-1 gate). The whole product schema rides on this.

## What's here

```
migrations/
  _journal.json        ordered manifest (tag, file, transactional flag) the runner reads
  0001_baseline.sql    txn:  extensions + 29 enums + 44 tables + the append-only trigger
  0001b_indexes.sql    NON-txn: 43 indexes, all CONCURRENTLY (incl. the HNSW index on memories.embedding)
  0001c_rls.sql        txn:  enable RLS + default-deny (REVOKE ALL) on every table + coverage assertion
  0001d_seed.sql       txn:  idempotent first-boot seed (roles, role×node matrix, agent roster, singletons)
src/
  journal.ts           load + checksum the journal and migration files
  plan.ts              PURE planning — pending set + contiguity/drift guard (fail-loud, #3)
  discipline.ts        PURE static guardrails — the expand-contract rules (AC-NFR-INF.002.1)
  migrate.ts           the runner orchestration (DB behind the MigrationDriver port — testable offline)
  pg-driver.ts         the live Postgres MigrationDriver (the only module importing `pg`)
  index.ts             CLI: check | migrate | status
  *.test.ts            32 tests — planning, idempotency/fail-loud, discipline, static schema assertions
```

`0001a–d together ARE "migration 0001"` per `spec/04-data-model/migrations.md` — split only to honour
the `CREATE INDEX CONCURRENTLY` non-transactional rule (0001b) and the
extensions→types→tables→indexes→RLS→seed ordering.

## Toolchain (OD-176)

Migrations are **raw SQL authored to the spec contracts** (`spec/04-data-model/schema.md` +
`indexes.md` + `rls-policies.md` + `PERMISSION_NODES.md`) — `schema.md` stays the **sole** Rule-0 source
of truth (no Drizzle `schema.ts` to fork it). A small **custom TypeScript runner** plays the
`drizzle-kit migrate` role: journal-tracked in a `_migrations` table, idempotent, fail-loud, honouring
the txn / `--no-transaction` split. See **OD-176** for why `drizzle-kit generate` is not adopted.

## Usage

```bash
npm run check          # run the expand-contract discipline guardrails (no DB) — CI gate, AC-NFR-INF.002.1
npm test               # 32 tests (no DB)
npm run typecheck
DATABASE_URL=postgres://…  npm run migrate   # apply pending migrations to a silo (runs `check` first — fail-closed)
DATABASE_URL=postgres://…  npm run migrate:status
```

`migrate` refuses to run if `check` finds any discipline violation (#3). The runner records each applied
migration and skips it on re-run (idempotent); a failure halts and records no partial progress.

## Scope boundaries (Rule 0 — what this issue does NOT own)

- **RLS policies + helpers + 100% coverage gate** → **ISSUE-009** (its title). 0001c only *enables* RLS +
  default-deny on every table (locking in the #2 no-silent-bypass property); the policy logic is proven there.
- **agents.memory_scope real shape** → **ISSUE-063**. Seeded **fail-closed** (`'{}'::jsonb` = retrieves
  nothing) here — see **OD-177**.
- **config_values defaults** (entity_types, ef_search, ~117 tunables) → **ISSUE-010** (config store) —
  see **OD-178**.
- **Per-deployment migrate-on-release + failure isolation** → **ISSUE-081**; **release/canary/rollback** →
  **ISSUE-080**; **embedding-model change run** → **ISSUE-023**. This package ships only the baseline +
  the harness + the VEC.002 expand slot.

## Status

Offline build complete (32/32 tests, typecheck clean, discipline clean). The **live apply + AF-065
mixed-fleet spike** (AC-NFR-INF.002.2) is the you-present capstone against the canary silo — until then
**ISSUE-008 stays `in-progress`** and Checkpoint 1 is open.
