---
id: ISSUE-008
title: Migration harness (expand-contract) + 0001 baseline
epic: A — foundations
status: ready
github: "#8"
---

# ISSUE-008 — Migration harness (expand-contract) + 0001 baseline

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR/NFR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Stand up the Drizzle migration harness on the expand-contract discipline and ship migration
**0001** — the greenfield baseline that creates the whole of `schema.md` (types → tables → indexes
→ RLS → idempotent seed) for a client silo.

## 2. Scope — in / out
**In:**
- The **migration toolchain**: `drizzle-kit generate` (author once) + `drizzle-kit migrate`
  (apply per-deployment on release), wired so a silo migrates against **its own** Supabase.
- **Migration 0001 — the baseline**: creates every type + table + index + RLS policy + SECURITY
  DEFINER helper in `schema.md`, in the documented dependency order, plus the **idempotent,
  first-boot-only seed** (six roles, permission-matrix defaults, orchestrator + 8 specialist
  `agents`, default `entity_types`/`expected_slots`/config defaults, Internal-Org singleton).
- **The `0001b` / `--no-transaction` split** for the vector + heavy indexes (`CREATE INDEX
  CONCURRENTLY` cannot run in a txn), applied right after 0001; seed runs after indexes exist.
- **Expand-contract discipline as enforced harness rules** (the CI/review guardrails from
  `standards/migration-discipline.md`): no DROP/RENAME in the same migration that introduces a
  replacement; new columns nullable-or-defaulted (never bare NOT NULL on a populated table); heavy
  index builds `CONCURRENTLY`; seed idempotent + first-boot-only; migrations safe to re-run.
- The `memories.embedding_v2` expand slot + the fact that the embedding model name is recorded per
  memory row so a future model change is a clean expand-contract (this issue lands **VEC.002**, the
  per-row model recording; it does **not** run a model change).

**Out:**
- **Per-deployment migrate-on-release orchestration + migration-failure isolation/halt/alert**
  (C10 FR-10.MIG.001/002, NFR-INF.005) — owned by **ISSUE-081** (which builds on this harness).
- **Release/canary/promote branch model + rollback-by-redeploy + version-skew alert** (C10 DEP,
  NFR-INF.001/003/004) — owned by **ISSUE-080**.
- The actual **RLS policy logic + 100%-coverage CI gate** (C1 RLS scaffold) — owned by **ISSUE-009**;
  0001 *creates* the policies/helpers as authored in `rls-policies.md`, but the RLS behaviour, helper
  correctness, and coverage gate are proven there.
- A real **embedding-model-change run** (FR-2.VEC.003 execution) — owned by **ISSUE-023** (embeddings +
  HNSW). This issue only ships the expand slot + per-row model recording (VEC.002).
- The **management-deployment migration lineage** (`client_registry`/`deployment_health`/
  `offboarding_records`, `client_slug`) — a separate lineage, seeded by **ISSUE-012**.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-2.VEC.002 (Component 2 — Memory: one embedding model recorded per row). *(FR-2.VEC.001
  HNSW DDL and FR-2.VEC.003 model-change run are authored/consumed here as the baseline index +
  expand slot, but are owned by ISSUE-023 / ISSUE-081 respectively — not claimed by this issue.)*
- **NFRs:** NFR-INF.002 (expand-contract migrations — mixed fleet stays safe).
- **Rests on:** ADR-005 (deploy fan-out & provisioning — migration discipline, §3 skew / §4 rollback),
  `standards/migration-discipline.md` (the binding expand-contract rules), AF-065 (mixed-fleet
  expand-contract safety — the spike that de-risks the whole discipline).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-2.VEC.002.1
- AC-NFR-INF.002.1
- AC-NFR-INF.002.2
- **Gating spikes (if any):** **AF-065** (expand-contract keeps a mixed-version fleet safe) is a
  build-time SPIKE, currently 🔴 in `feasibility-register.md`; it is **blocking (RP-1)** per
  NFR-INF.002 and must be **GREEN** before the expand-contract discipline this harness enforces is
  trusted for a fleet-wide rollout. (AF-065 is *not* one of the OD-157 launch-gating spike ISSUEs
  001–006; it is attached here as a DoD note per the coverage ledger's NFR-TEST line.)

## 5. Touches (complete blast radius, by ID)
- **DATA:** every table in `schema.md` (0001 creates the full baseline). Load-bearing for this
  slice specifically: `DATA-memories.embedding`, `DATA-memories.embedding_model`,
  `DATA-memories.embedding_v2` (the expand slot).
- **PERM:** none (this is infrastructure; no permission node is defined or gated here).
- **CFG:** `CFG-embedding_model` (change-controlled — recorded per row, drives VEC.002/003; the config
  key is `embedding_model`, component-02 L1258); `CFG-ef_search` (LIVE — HNSW query tuning, index
  authored in 0001; the config key is the **bare `ef_search`** — component-02 L1237 / config-registry.md
  L128 — not literally `CFG-ef_search`; the `CFG-` prefix is the register handle, `ef_search` is the key).
- **UI:** none.
- **Connectors:** none.

## 6. Context manifest (the EXACT files to open — nothing more)
- `spec/04-data-model/migrations.md` — the migration shape, 0001 ordering, the `CONCURRENTLY`/`0001b`
  split, the expand-contract worked examples, the hard constraints, the rollback playbook.
- `spec/04-data-model/schema.md` (§3 Memory for the `memories` embedding columns; the whole file is
  the DDL 0001 must create — read §Types, §Global rules, and each numbered section for the tables +
  the idempotent-seed targets).
- `spec/04-data-model/indexes.md` — **the authoritative full index set for build step 4 (0001b)**.
  schema.md/migrations.md name the index *targets* but source the DDL here: the load-bearing HNSW index
  on `memories.embedding` (`m=16, ef_construction=64`) plus every other heavy / `CONCURRENTLY` index the
  step must build. Without this file the step-4 index list is not recoverable.
- `spec/04-data-model/rls-policies.md` — **the RLS policy + helper *contracts* 0001 attaches in build
  step 5** (schema.md carries only the audit-append-only trigger). Note this file fixes the per-table policy
  *summary* + the four/five helper *contracts*, **not** copy-paste DDL: the exact `SECURITY DEFINER` helper SQL
  bodies (search_path pinning etc.) are explicitly deferred as Phase-4 build artifacts (rls-policies.md
  L107-110). So 0001 authors the policy/helper DDL **to the contract here**, not "verbatim"; the RLS behaviour,
  helper correctness, and 100%-coverage CI gate are proven in **ISSUE-009** (scoped out).
- `PERMISSION_NODES.md` (repo root) — **the source of the permission-matrix defaults seeded in build
  step 6** (the `role_permissions` rows: the six roles × their granted permission nodes; the catalog is the
  build-time source of truth per **FR-1.PERM.005**, and unseeded nodes **default-deny per OD-030**).
  migrations.md L43 names this file as the seed source; without it the six role names + their node grants
  cannot be produced.
- `spec/02-config/config-registry.md` — **the source of the config *keys + defaults* seeded in build step 6**:
  `entity_types`, `ef_search` (default 40), and the rest of the Tier-2 defaults become `config_values` rows
  (schema.md only names the keys). **Note `expected_slots` is specified as a *shape* only** (object; 5–8 slot
  names per entity type — App. A #2, not a concrete per-type list); 0001 seeds the key + the standard
  `entity_types`, but the concrete per-entity-type slot *content* is operator/onboarding-authored per vertical
  (LIVE-editable), consumed by the Maturity computation in **ISSUE-030** — it is **not** invented in 0001.
- `spec/01-requirements/component-08-agent-design.md` §REG/§SPC (FR-8.REG.006 + FR-8.SPC.001 + their ACs)
  — **the definition of the orchestrator + 8 specialist `agents` seeded in build step 6** (the canonical
  roster: Research / Client / Campaign / Comms / Ops / Memory / Finance / Insight). The seed **values** for
  the eight specialists live here; migrations.md only names the count.
- `spec/01-requirements/component-02-memory.md` §VEC (FR-2.VEC.001–003 + their ACs).
- `spec/05-non-functional/infrastructure.md` (NFR-INF.002 + its ACs; NFR-INF.003/005 for the
  boundary this harness sits inside, owned by ISSUE-080/081).
- `spec/00-foundations/standards/migration-discipline.md` — the binding expand-contract rules.
- `spec/00-foundations/adr/ADR-005-deploy-provisioning.md` — the deploy/migration decision this rests on.

## 7. Dependencies
- **Blocked-by:** ISSUE-007 (provisioning + per-client Supabase bootstrap — a silo's Supabase must
  exist before 0001 can migrate against it). ✅ **007 is `done`** (2026-07-04) — this issue is now `ready`.
  ⚠️ **Heads-up:** the ISSUE-007 canary run left a **minimal throwaway target schema** on the canary silo
  `Transpera-AIOS-V1` (ref `nwufvzaamomajdyzemhx`) — `app/canary/migrations/0001_canary_target.sql`
  (`entities`/`messages`/`memories` + `vector`, **no RLS**). It is NOT the real schema and this issue's 0001
  baseline OWNS those tables: **drop/reset that canary schema before applying the real baseline** (don't build
  on top of it). See the DDL header + `app/canary/results/live-seed-evidence.2026-07-04.md`.
- **Blocks:** ISSUE-009, ISSUE-010, ISSUE-011, ISSUE-012, ISSUE-022, ISSUE-032, ISSUE-042,
  ISSUE-081, ISSUE-084 (every issue that assumes a migrated schema or extends the harness).

## 8. Build order within the slice
1. **Toolchain:** wire `drizzle-kit generate` (authoring) + `drizzle-kit migrate` (per-deployment
   apply against the silo's own Supabase, per ADR-005 §5 / migrations.md).
2. **0001 — extensions + types:** `create extension if not exists vector;` + `pgcrypto`; then all
   enums/domains (§Types) first, since tables reference them.
3. **0001 — tables in dependency order** exactly as listed in `migrations.md` §"Migration 0001"
   (`profiles` → `roles` → … → `deployment_settings`). Land the `memories` columns incl.
   `embedding` (NOT NULL), `embedding_model` (default `text-embedding-3-small`), and the
   `embedding_v2` nullable expand slot — this is where **FR-2.VEC.002** lands.
4. **0001b (non-transactional):** vector + heavy indexes `CONCURRENTLY`, **the complete set authored in
   `spec/04-data-model/indexes.md`** (the load-bearing HNSW index for FR-2.VEC.001 on `memories.embedding`
   plus every other heavy index that file lists), outside the txn block. Do **not** enumerate from
   schema.md/migrations.md alone — they name index targets but source the DDL from `indexes.md`.
5. **0001 — RLS:** `enable row level security` + default-deny baseline + policies + SECURITY DEFINER helpers
   (search_path pinned) **authored to the contracts in `spec/04-data-model/rls-policies.md`** — that file
   fixes the per-table policy summary + the helper contracts, but the exact helper SQL bodies are Phase-4
   build artifacts (rls-policies.md L107-110), so this is authored-to-contract, **not copied verbatim**
   (schema.md carries only the audit-append-only trigger). This baseline creates the tables/types/RLS-enable
   + default-deny the predicates attach to; the policy *logic* + 100%-coverage CI gate are owned by ISSUE-009.
6. **0001 — seed:** idempotent, first-boot-only (checks for existing data before writing). Seed **values**
   by source (do not guess them):
   - **six roles + permission-matrix defaults** → the `role_permissions` grants per role in
     `PERMISSION_NODES.md` (repo root; catalog is source of truth per FR-1.PERM.005; unseeded nodes
     default-deny per OD-030);
   - **orchestrator + 8 specialist `agents`** → the canonical roster in
     `spec/01-requirements/component-08-agent-design.md` (FR-8.REG.006 / FR-8.SPC.001: Research / Client /
     Campaign / Comms / Ops / Memory / Finance / Insight);
   - **config keys + defaults** (`entity_types`, `ef_search`, Tier-2 defaults) → the seed values in
     `spec/02-config/config-registry.md` (written into `config_values`). `expected_slots` seeds the key +
     standard entity_types **shape** only; its concrete per-type slot content is onboarding-authored (LIVE),
     consumed by ISSUE-030 — not invented in 0001;
   - **Internal-Org singleton entity** → `schema.md` §Global rules / `deployment_settings` note
     (single row seeded at first boot, app never inserts a second).
7. **Discipline guardrails:** encode the `standards/migration-discipline.md` hard constraints as
   review/CI checks (no same-migration DROP/RENAME of a replacement; nullable-or-defaulted new
   columns; `CONCURRENTLY` for heavy indexes; idempotent first-boot seed; re-runnable migrations).
8. **Tests** to AC-2.VEC.002.1, AC-NFR-INF.002.1, AC-NFR-INF.002.2 (see Verification).

## 9. Verification (how DoD is proven)
- **AC-2.VEC.002.1** — integration test: a written memory carries a 1536-dim `embedding` + the
  `embedding_model` name (per `spec/05-non-functional/test-strategy.md` data-layer tier).
- **AC-NFR-INF.002.1** — static/CI check: any authored migration contains no destructive change
  relied on by the prior build (add-then-later-remove only) — the discipline guardrail from step 7.
- **AC-NFR-INF.002.2** — **SPIKE (AF-065):** run `vN` and `vN-1` concurrently against the migrated
  schema and confirm both operate with no data loss or errored path. This is the blocking RP-1 gate;
  it must be GREEN in `feasibility-register.md` before the discipline is trusted fleet-wide.
- Re-runnability: a halted-then-retried migration re-applies cleanly (migrations.md hard constraint);
  the seed is idempotent (running it twice writes nothing new).
