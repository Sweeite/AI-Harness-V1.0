# Phase 4 — Migrations

**Status:** Draft (Phase 4). Companion to `schema.md`. Governed by **`standards/migration-discipline.md`**
(expand → backfill → contract) + **ADR-005** (canary/release-train, rollback = code-redeploy) + C10
FR-10.MIG.* (per-deployment propagation + failure isolation).

## The shape of migrations in this fleet

- **One codebase, N deployments migrating independently** (ADR-001 §6). Migrations are authored once and
  applied **per-deployment** on release. **Build note (OD-176, ISSUE-008):** the build implements this as
  **raw-SQL migrations authored to this doc + `schema.md`/`indexes.md`/`rls-policies.md`** (kept as the sole
  source of truth — no Drizzle `schema.ts`) applied by a small **custom migrate runner** (`app/silo/`) that
  plays the `drizzle-kit migrate` role. `drizzle-kit generate` is not adopted (it can't emit RLS/helpers/
  `CONCURRENTLY`/seed, and a `schema.ts` would fork Rule 0). The SQL remains reusable under drizzle if desired.
- **Version skew is normal** (ADR-005 §3): during a rollout a `vN` and a `vN-1` deployment run against
  their own schemas. **Every schema change must be backwards-compatible with the immediately prior code.**
- **Rollback is code-redeploy, not down-migration** (ADR-005 §4). The prior build must keep working
  against the newer schema. **Never ship a destructive down-migration to production** — roll *forward* a
  corrective migration instead.

## Migration 0001 — initial schema (the whole of `schema.md`)

The first migration creates every type + table + index + RLS policy in `schema.md` / `indexes.md` /
`rls-policies.md`. Because it is a greenfield create, it is additive by definition. Ordering within it:

1. **Extensions:** `create extension if not exists vector;` `pgcrypto` (for `gen_random_uuid`).
2. **Types** (§Types) — all enums first (tables reference them).
3. **Tables in dependency order:** `profiles` → `roles` → `role_permissions`/`user_roles`/
   `sensitivity_clearances` → `entities` → `restricted_grants`/`access_audit` (now ordered after
   `entities`, satisfying `restricted_grants.entity_id`'s FK) → `memories` (FKs to entities) →
   `agents` (before `prompt_layers`, `commands`, `tools` refs) → `prompt_layers` →
   `tools`/`connector_credentials`/`rate_limit_tracker` → `task_queue` →
   `task_graph_versions`/`task_history`/`execution_plans` → `guardrail_log`/`injection_quarantine` →
   `event_log`/`notifications`/`config_audit_log`/`push_subscriptions` → `agent_health_metrics`/
   `agent_result_cache` → `proactive_suggestions`/`commands`/`signal_weights` → `conversations`/
   `messages` → `config_values`/`secret_manifest` → `deletion_requests`/`connector_deletion_flags` →
   `deployment_settings` (no FKs; a standalone single-row table, ordered last for convenience only).
   *(`restricted_grants.entity_id` is a real, one-directional FK to `entities(id)` — not a circular ref —
   so it is simply ordered after `entities` here; no later `alter table` step is needed. `agents ⇄
   prompt_layers` and `agents`/`tools` are likewise **not** circular: `prompt_layers.agent_id` is the only
   FK between that pair (agents already precedes it above), and `agents.tools_allowed` is a plain `uuid[]`
   with no enforced FK to `tools` at all — neither pair needs a deferred `alter table` step.)*
4. **Indexes** — vector + heavy indexes `CONCURRENTLY` (outside the txn block; see note).
5. **RLS** — `alter table … enable row level security;` + policies + the SECURITY DEFINER helpers
   (search_path pinned).
6. **Seed** (idempotent, first-boot only — checks for existing data before writing): the six roles, the
   permission-matrix defaults from `PERMISSION_NODES.md`, the orchestrator + 8 specialist `agents`, the
   default `entity_types`/`expected_slots`/config defaults, the Internal-Org singleton entity.

> **`CONCURRENTLY` caveat:** `create index concurrently` cannot run inside a transaction. In drizzle this
> means the vector/heavy indexes go in a **separate, non-transactional migration step** (0001b) applied
> right after 0001, or via a `--no-transaction` migration. The seed runs after indexes exist.

## The management deployment gets its own migration set

`client_registry`, `deployment_health`, `offboarding_records` live **only** on the management deployment
(ADR-001 §7) and are created by a **separate** migration lineage — they are never part of a client silo's
schema. `client_slug` exists only here.

## Expand-contract worked examples (the changes we already know are coming)

These are the schema changes the spec has already flagged; each is written as ≥2 releases:

| Change | Expand (release A) | Backfill | Contract (release B) |
|---|---|---|---|
| **Drop `agents.system_prompt`** (OD-075; legacy rows only) | Layer-1 already lives in `prompt_layers`; add nothing | one-time job: copy any residual `system_prompt` → `prompt_layers(layer='core')` | drop the `system_prompt` column once no build reads it (FR-8.REG.002) |
| **Embedding-model change** (REBUILD-class) | add `memories.embedding_v2` (nullable) + its HNSW index `CONCURRENTLY` | re-embed rows into `embedding_v2` (online job) | swap reads to `embedding_v2`, drop `embedding` + old index (FR-2.VEC.003) |
| **New enum value** (e.g. a new `event_type`) | `alter type … add value` is additive + safe; old code ignores unknown values it never emits | — | n/a (enums only grow) |
| **New NOT NULL column on a populated table** | add as **nullable or with a default** (never bare NOT NULL) | backfill | tighten to NOT NULL only once populated |

## Hard constraints (enforced in review + CI — from the standard)

- **No column/table DROP or RENAME in the same migration that introduces its replacement.** Drops are a
  separate, later (contract) migration.
- **New columns are nullable or defaulted** — never bare `NOT NULL` on a populated table in the expand step.
- **Vector / heavy index builds run `CONCURRENTLY`.**
- **The seed script is idempotent** and first-boot-only (checks before writing).
- **Migration failure halts only that deployment** — the prior version stays live, a **version-skew /
  migration-failure alert fires** (C10 FR-10.MIG.002 / FR-10.DEP version-skew alert), and migrations are
  **safe to re-run** (a halted-then-retried deploy re-applies cleanly).

## Rollback playbook

- **Bad code, good schema** → redeploy the prior Railway build. Safe by construction (prior code runs
  against the additive newer schema).
- **Bad schema change** → **roll forward** a corrective migration. Never a destructive down-migration.

## Feasibility

⚠️ **AF-065 (SPIKE):** that expand-contract actually keeps a mixed-version fleet safe (a `vN` and `vN-1`
deployment each correct against their own schema, and prior code correct against the newer schema) is
**paper until tested** — the whole skew-is-safe + rollback story rests on it. Owed to the build phase, not
a blocker for the spec.
