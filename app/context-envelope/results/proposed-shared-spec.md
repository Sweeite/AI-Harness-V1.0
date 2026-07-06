# ISSUE-050 (C5 ENV) — Proposed shared-spec deltas

> **These are PROPOSALS / verify-present assertions, not edits.** Per the fan-out isolation rule this slice
> does NOT edit any `schema.md`, `config-registry.md`, migration, or other shared file. The orchestrator
> reconciles these at integration time.

## Summary: effectively NONE new — everything this slice needs already exists in the baseline.

Both durable surfaces ISSUE-050 depends on are already present in the shared spec. This slice authored its
adapters to them and ships **no** `0050_*` migration and **no** new config key.

## 1. `task_history` table — VERIFY-PRESENT (already in baseline)

- **Where:** `app/silo/migrations/0001_baseline.sql` lines 431–439 (cites `schema.md` §6 / OD-P4-04).
- **Shape confirmed and relied upon:**
  ```sql
  create table task_history (
    id          uuid primary key default gen_random_uuid(),
    task_id     uuid not null references task_queue(id) on delete cascade,
    step_index  int not null,
    full_output jsonb not null,
    created_at  timestamptz not null default now(),
    unique (task_id, step_index)
  );
  ```
- **What this slice needs from it (all present — no delta):**
  - `unique (task_id, step_index)` — the live adapter's `insert … on conflict (task_id, step_index) do
    nothing` (first-write-wins, never a silent overwrite of a retained original / #1) depends on this exact
    constraint. **Verify-present.**
  - `full_output jsonb not null` — the uncompressed original tail. **Verify-present.**
  - `task_id … references task_queue(id) on delete cascade` — FK target owned by ISSUE-048. **Verify-present.**
- **No migration owed by this slice.**

## 2. `compression_threshold_tokens` config key — VERIFY-PRESENT (already registered)

- **Where:** `spec/02-config/config-registry.md` line 183 (group H) — `default 8000 · LIVE · int tokens ≥ 1000`;
  also bound in `spec/03-surfaces/surface-01-config-admin.md` line 270 (`#loops` section).
- **What this slice needs:** the key exists with the exact class/default/constraint the code consumes
  (`EnvelopeConfig.compressionThresholdTokens`, default 8000, rejected if not an integer ≥ 1000). **Verify-present.**
- **No new config key owed by this slice.**

## 3. Residual live gates (owed to a 💻 full/live Stage-4 checkpoint — NOT resolvable offline)

- **AF-114 (EVAL — compression fidelity):** offline this slice proves the *lossless-source floor* — the
  uncompressed original is always retained and byte-exactly recoverable, so no task-critical state is ever
  *lost at source*. The remaining EVAL half — that the **model-produced summary** carried in the working
  envelope preserves enough for a later step to behave equivalently *without* reading the original — needs a
  live model + representative long chains. **Owed.**
- **AF-115 (DOCS/SPIKE — originals-store retention lifetime):** this slice makes the C5-owned `task_history`
  the authoritative originals store (engine step-state treated as cache), which is exactly the AF-115 SPIKE
  fallback. Confirming managed-Inngest step-state TTL vs the longest-chain + audit window (DOCS) and that the
  live silo `task_history` retention outlives it needs live infra. **Owed.**
- **Live-DDL behaviours** (UNIQUE `on conflict do nothing` first-write-wins, FK on-delete-cascade) are authored
  in `supabase-store.ts` to the baseline DDL but **NOT run live** — proven by the operator at the Stage-4
  checkpoint. The `InMemoryTaskHistoryStore` reference model mirrors these constraints so the offline pass
  implies the live DDL would accept the same writes.

## 4. No other shared-spec surface

No `schema.md`, `PERMISSION_NODES.md`, or `glossary.md` delta is proposed. **PERM: none. UI: none. Connectors:
none.** (per ISSUE-050 §5).
