# ISSUE-033 token-lifecycle — proposed shared-spec deltas

**Verdict: NONE required.** This slice reads/writes the existing `connector_credentials` table and reads
existing config keys. It authors no create-table/create-type migration and requests no new shared delta.
Everything it depends on is already present in `main` (baseline 0001 + config seed 0003 + the config
registry). All items below are **verify-present** (assert the orchestrator that these already exist — this
slice did not add them).

## verify-present — DB (baseline migration 0001, no change)
- **`connector_credentials`** (app/silo/migrations/0001_baseline.sql L323-333): columns
  `id, connector, access_token, refresh_token, expires_at, scopes, state, created_at, updated_at`.
  This slice READS (`getCredential`, `dueForProactiveRefresh`) and WRITES (`rotatePersist`, `setState`)
  these existing columns only. No new column.
- **`credential_state` enum** (baseline L45): `('active','degraded','revoked','expired')`. The Layer-3
  degrade uses the existing `'degraded'` value. **No new enum value is required** — `degraded` covers the
  operational state ISSUE-038 renders.
- The row shape + `CredentialState` type are OWNED by ISSUE-032 (`@harness/connector-runtime`); this slice
  imports them (single source of truth) rather than re-declaring, so there is no drift risk to reconcile.

## verify-present — config keys (config-registry.md + seed migration 0003, no change)
All four keys the TOK FRs name already exist in `spec/02-config/config-registry.md` (L152-158),
`app/config-store/src/keygroup.ts` (L85-91), and the seed in `app/silo/migrations/0003_config_values_rls.sql`
(L114-120). This slice consumes their *values* as injected parameters (it does not own config plumbing):
- `token_refresh_interval_minutes` (default 15) — Layer-1 cadence (FR-3.TOK.002). Scheduler-driven; the
  cadence is external to this package (the package exposes `proactivePass(leadSeconds, …)`).
- `token_refresh_lead_minutes` (default 30) — Layer-1 lead window → passed as `leadSeconds` to
  `dueForProactiveRefresh` / `proactivePass`.
- `slack_token_rotation_enabled` (default false, OD-040) — selects `slackTokenParams(rotationEnabled)`
  (FR-3.TOK.009 / AC-3.TOK.009.1/.2).
- `token_expiry_alert_days` (default 7) — the <7d expiry alert is FR-3.DSC.006 (ISSUE-038's surface), not
  owned here; listed for completeness.

## No RLS / trigger / CHECK / index delta
- The atomic rotate-persist relies only on a single guarded `UPDATE` (optimistic-concurrency predicate
  `where refresh_token is not distinct from $expected`) — no new DB trigger or constraint. `pg`'s
  statement atomicity + row-level locking under `READ COMMITTED` is sufficient; the AF-089 live SPIKE/LOAD
  (below) proves that empirically.
- `connector_credentials` already has the `connector` index (0001b_indexes.sql L46) and is inside the C3
  RLS/deny-select set (0001c_rls.sql L43 / 0002 L132) — reads are `service_role`-only, consistent with
  NFR-SEC.003 (never a human-readable surface). No index/RLS change requested.

## Residual owed-to-live (NOT a shared-spec delta — flagged for the operator's live capstone)
- **AF-089 (🔴, SPIKE/LOAD):** the GHL rotating-refresh persist race under REAL pg concurrency (the 30s
  same-token grace window). The OFFLINE portion is proven in `src/token-lifecycle.test.ts` — single-flight
  collapses N concurrent refreshes to one vendor call + one rotation; the optimistic-concurrency guard
  makes a lost race a safe no-op (never clobbers the winner); the grace-window persist-retry recovers a
  post-rotation persist crash and degrades LOUDLY past the window. The LIVE proof (apply the pg adapter to
  a silo, drive concurrent refreshes against a real GHL sub-account, confirm no double-rotation / no lost
  token) is a 💻 live-infra step owed before the GHL rotate-persist arm (FR-3.TOK.005 / FR-3.TOK.008) ships.
  Keep AF-089 🔴 until that live run records evidence.
- **FR-3.TOK.006 99% figure:** an EVAL target measured under real connector behaviour, not a launch gate.
  The metric hook (`RefreshMetric`) is built + proven; the *value* is measured live.
- The `supabase-store.ts` pg adapter is authored to the DDL and typechecks but is **NOT run live** — same
  posture as every sibling's live adapter (Checkpoint-gated).
