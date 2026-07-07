# ISSUE-085 backup-dr — proposed shared-spec deltas

The orchestrator applies these SERIALLY (next free migration tag is 0018). This slice touched ONLY
`app/backup-dr/`. Everything below is a described delta; nothing here was authored into a shared file by
this agent (hard-isolation rule). Anything already present is marked **verify-present**.

---

## 1. `deployment_health.backup_health` (jsonb) — VERIFY-PRESENT (no migration needed)

The five backup-health fields ride the EXISTING `deployment_health.backup_health` jsonb column
(schema.md §13, added by ISSUE-012). **verify-present** — confirmed in `app/silo/migrations/0001_baseline.sql`
(silo mirror) and `spec/04-data-model/schema.md` §13. This slice OWNS the INTERNAL SHAPE of that jsonb (opaque
to `@harness/management`, which carries it as an operational rollup via `backupHealthCard`):

```jsonc
// deployment_health.backup_health — the five fields (NFR-DR.006 / ADR-008 part 5). Operational metadata ONLY.
{
  "recovery_tier":                 "daily_in_project | hourly_off_platform | pitr",  // field 1
  "last_in_project_backup_at":     "<ISO8601> | null",                              // field 2
  "project_status":                "active | paused | billing_at_risk",             // field 3
  "last_off_platform_snapshot_at": "<ISO8601> | null",                              // field 4
  "last_rehearsal_at":             "<ISO8601> | null",                              // field 5a
  "last_rehearsal_result":         "passed | failed | null"                         // field 5b
}
```

No new column is needed; the mgmt-plane allow-list already includes `backup_health` (verified in
`app/management/src/allowlist.ts`). **No schema.md edit required** — the shape is documented here + in
`app/backup-dr/src/backup-health.ts`. (Optional doc-only nicety: annotate the §13 `backup_health` comment with
a pointer to this shape; not required for the build.)

## 2. Additive MANAGEMENT-PLANE operator-side backup tables — NEW migration (proposed 0018, mgmt DB)

These live on the **management-plane** Supabase (operator-owned, NOT a client silo, NOT the silo migration
chain). They are the operator-side backup log the `BackupDrStore` port models. The live adapter
(`app/backup-dr/src/backup-dr-live.ts`) is authored to exactly this DDL. **Note:** the current
`app/management/migrations/` chain (0001 client_registry, 0002 deployment_health) is the mgmt-plane chain; the
orchestrator decides whether these land as `app/management/migrations/0003_*` or a new tag — described here, not
authored (hard-isolation).

```sql
-- recovery_tier enum ≡ config-registry.md §M `recovery_tier`
create type recovery_tier as enum ('daily_in_project', 'hourly_off_platform', 'pitr');
create type dr_project_status as enum ('active', 'paused', 'billing_at_risk');
create type rehearsal_result as enum ('passed', 'failed');
create type rehearsal_trigger as enum ('monthly', 'migration-release', 'manual');

create table silo_backup_posture (
  client_slug     text primary key references client_registry(client_slug),
  recovery_tier   recovery_tier not null default 'hourly_off_platform',   -- NFR-DR.001 default
  destination     jsonb,                                                  -- OffPlatformDestination (NFR-DR.002)
  project_status  dr_project_status not null default 'active',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
  -- CHECK/trigger: a move to 'daily_in_project' (below hourly) MUST insert a backup_downgrade_log row in the
  --   same tx (NFR-DR.001 — never a silent default). Enforced app-side (setRecoveryTier) + trigger-side.
);

create table backup_downgrade_log (                                       -- NFR-DR.001 logged downgrade exceptions
  id          uuid primary key default gen_random_uuid(),
  client_slug text not null references silo_backup_posture(client_slug),
  from_tier   recovery_tier not null,
  to_tier     recovery_tier not null,
  reason      text not null,
  logged_by   text not null,                                              -- Super Admin actor (PERM-config.infra)
  at          timestamptz not null default now()
);

create table off_platform_snapshot_log (                                  -- NFR-DR.002 hourly off-platform copies
  snapshot_id text primary key,
  client_slug text not null references silo_backup_posture(client_slug),
  taken_at    timestamptz not null,
  destination jsonb not null,                                             -- client-owned/different-region/lifecycle-independent
  encrypted   boolean not null,                                           -- always true (NFR-SEC.017)
  size_bytes  bigint
);

create table restore_rehearsal_log (                                      -- NFR-DR.003 tested-restore evidence
  rehearsal_id            text primary key,
  client_slug             text not null references silo_backup_posture(client_slug),
  ran_at                  timestamptz not null,
  result                  rehearsal_result not null,
  restored_into           text not null,                                  -- THROWAWAY project ref (never prod)
  db_queryable            boolean not null,
  pgvector_memory_complete boolean not null,
  auth_rows_complete      boolean not null,
  measured_rto_seconds    numeric,                                        -- MEASURED (NFR-DR.005), null on fail
  trigger                 rehearsal_trigger not null,
  detail                  text not null
);

create table off_platform_purge_flag (                                    -- NFR-DR.009 receive-leg ledger
  flag_id              text primary key,                                  -- UNIQUE ⇒ idempotent receive
  client_slug          text not null references silo_backup_posture(client_slug),
  target_ref           text not null,                                     -- the erased target
  raised_at            timestamptz not null,                              -- when C2 erasure raised the flag
  erasure_effective_at timestamptz not null,
  status               text not null default 'open' check (status in ('open','cleared')),
  received_at          timestamptz not null,
  cleared_at           timestamptz,
  confirmed_by         text
);
```

**Fake-vs-live parity note:** the in-memory fake (`store.ts`) enforces the SAME invariants this DDL does —
recovery_tier is a closed enum; a below-hourly move without a logged downgrade is REFUSED; a same-region /
lifecycle-dependent destination is rejected; purge-flag receive is idempotent on `flag_id`. So the fake cannot
pass a state the live adapter would throw on (the session-69/71 drift class).

## 3. `recovery_tier` config key — VERIFY-PRESENT

`config-registry.md §M` already defines `recovery_tier` (enum `daily_in_project · hourly_off_platform · pitr`,
default `hourly_off_platform`, `PERM-config.infra`, `UI-config-admin#infra`, below-hourly = logged downgrade).
**verify-present** — confirmed at `spec/02-config/config-registry.md` line ~298. No config-registry edit needed;
the module enum (`src/types.ts` `RECOVERY_TIERS`) is asserted ≡ this by the `check` CLI gate 1.

## 4. `PERM-config.infra` — VERIFY-PRESENT

The Super Admin recovery-tier / PITR-upsell toggle + backup-health config gate. **verify-present** — the §M
gate-table row in `config-registry.md` IS its source of truth in-repo (no `PERMISSION_NODES.md` catalog exists
yet; minting the mgmt-plane fleet-action nodes is OD-125 / surface-06, NOT in this slice). No new node minted.

## 5. Operator backup credential SCOPE — NOT DEFINED HERE (owned by ISSUE-007)

ADR-008 §Consequences states the posture (delegated, scoped to backup ops + status reads, not a broad grant;
NFR-SEC.017 / NFR-SEC.003). The buildable grant/scope is owned by ISSUE-007 provisioning. This slice ASSERTS the
posture (`src/posture.ts` `OWNERSHIP_SPLIT.operator_credential`) and does not define the grant.

## 6. Cross-package import — NONE taken

The issue permitted importing `@harness/management`. To keep the offline suite hermetic and avoid touching a
sibling package's install (hard-isolation), this slice defines the `deployment_health.backup_health` payload
SHAPE it depends on locally (`src/backup-health.ts`), matching the sibling's real jsonb column exactly — so
there is no fake-vs-live drift and no cross-package build coupling. The mgmt-plane push seam is the
`BackupHealthPayload` → `deployment_health.backup_health` jsonb (opaque to `@harness/management`, carried by its
`backupHealthCard`). If the orchestrator prefers a hard `file:` dep on `@harness/management`, the seam is the
`OperationalSnapshot.backup_health` field — no code change needed, only wiring.

---

### Residual AFs owed-to-live (NOT faked — implemented-to-AC, offline-proven)
- **AF-069 Path A** (SPIKE) — in-project PITR/daily restore. Path B (off-platform pg_dump→restore) is 🟢
  (ISSUE-004: 5000/5000 memories+embeddings, 25/25 auth rows, RTO 19.4s). Path A NOT proven — confirm the
  in-project/PITR restore on the real production tier before go-live.
- **AF-070** (SPIKE, build-time) — the Supabase Management API's exact payload for the five backup-health fields;
  degrade-loud to what the API exposes + a coarser pause alert if a field is missing (logic built:
  `evaluateBackupHealthAlert` reads null/stale loud).
- **AF-071** (DOCS) — backup / off-platform region vs `ap-southeast-2` residency (vendor confirmation).
- **AF-072** (LOAD) — the hourly off-platform `pg_dump` completes within the hour at volume; fallback (back-off
  cadence / PITR) LOGIC is built + tested (`decideCadence`), the at-volume timing is live.
- **AF-137** (SPIKE) — a planted residue in a pre-erasure off-platform snapshot is cleared by the purge flag
  within the window; the receive→action→confirm→log LOGIC is built + tested (`purge-leg.ts`), the live plant/
  clear is operator-present.
