# ISSUE-008 live capstone — evidence (2026-07-04, session 62)

Two-party (operator-present) live run of the migration harness + 0001 baseline against the client-owned
canary silo **`Transpera-AIOS-V1`** (ref `nwufvzaamomajdyzemhx`, `ap-southeast-2`, **PostgreSQL 17.6**).
Applied via the real deliverable — `app/silo` `npm run migrate` (the `pg` runner) over a **direct
session connection** (`db.<ref>.supabase.co:5432`). Secrets held session-only; no values in the repo.

## Result: ✅ PASS — ISSUE-008 DoD met live; AF-065 🔴→🟢; Checkpoint-1 (008 portion) green.

### Reset (ISSUE-008 §7)
Dropped the throwaway canary target schema (`entities`/`messages`/`memories`, 15 synthetic rows from the
session-61 seed) — the real 0001 baseline owns those names. Public schema empty (0 base tables) before apply.

### Apply (the runner — idempotent, fail-loud, resumable)
- **First run:** applied `0001_baseline` + `0001b_indexes` (committed + tracked), then **failed LOUD on
  `0001c_rls` and rolled it back** — the coverage assertion correctly flagged the runner's own
  `_migrations` table as RLS-disabled (a real bug the live run surfaced; a #3 fail-loud demonstration —
  no partial progress recorded past the failure).
- **Fix:** `ensureTracking` now enables RLS + default-deny on `_migrations` (so it is neither
  PostgREST-exposed nor a hole in the fleet-wide coverage assertion — #2).
- **Resume:** re-run **skipped the two already-applied migrations and resumed at `0001c`**, applying
  `0001c_rls` + `0001d_seed`. `✓ applied 2 migration(s): 0001c_rls, 0001d_seed`.
- **Idempotency:** a third run = `✓ up to date — 4 migration(s) already applied, nothing to do.`
- `_migrations` tracks all four tags: `0001_baseline, 0001b_indexes, 0001c_rls, 0001d_seed`.

### Live verification
| Check | Result |
|---|---|
| Silo base tables (excl. `_migrations`) | **44** |
| Public tables with RLS **disabled** | **0** (all 44 + `_migrations` enabled) |
| Indexes present (incl. inline PK/unique) | 98 |
| HNSW index | `USING hnsw (embedding vector_cosine_ops) WITH (m='16', ef_construction='64')` — exact |
| Seed: roles / role_permissions / agents | **6 / 73 / 9** |
| Seed: Internal-Org singleton / deployment_settings | **1 / 1** |
| Agents `memory_scope` | all **`{}`** (fail-closed — OD-177) |

### AC-2.VEC.002.1 (live)
Inserted a memory with a 1536-d embedding → `dims=1536 model=text-embedding-3-small v2_null=true`; HNSW
ANN search returned it. Probe row deleted (silo left at the seeded baseline).

### AC-NFR-INF.002.2 — AF-065 mixed-fleet spike (`results/af-065-mixed-fleet-spike.sql`)
Self-verifying run against the live schema:
- v1 reader correct **before and after** the EXPAND (added a nullable column) — the rollback premise.
- v1 WRITER still inserts against the v2 schema (vN-1 mid-rollout); v2 writer/reader use the new column.
- **0 data loss** — 3 rows, all embeddings 1536-d, v1 read of M1 unchanged (fail-loud assert → `AF-065 PASS`).
- CONTRACT step dropped the throwaway column + rows → baseline restored (`memories_rows=0`,
  `af065_flag_exists=false`).

### DoD roll-up
- **AC-2.VEC.002.1** ✅ live · **AC-NFR-INF.002.1** ✅ (discipline CI gate, `npm run check`) ·
  **AC-NFR-INF.002.2 / AF-065** ✅ live → **AF-065 🔴→🟢**.
- Re-runnability + fail-loud + resume all demonstrated live.

### Residuals (tracked, non-blocking for ISSUE-008)
- RLS policies + helpers + 100%-coverage gate → **ISSUE-009** (0001c laid only the enable+default-deny
  substrate).
- Agent `memory_scope` real shape → **ISSUE-063** (seeded fail-closed).
- `config_values` defaults → **ISSUE-010**.
- Operator: **reset the silo DB password** — its connection string transited the session chat.
- Checkpoint 1 stays OPEN until the Stage-1 batch (`017`, `080`) is done + the stage integration test.
