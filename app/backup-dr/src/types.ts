// ISSUE-085 — Backup & DR domain types (ADR-008 / NFR-DR.001-009).
//
// This module owns:
//   • the recovery_tier enum (config-registry.md §M `recovery_tier`) — the per-silo backup plan,
//   • the SHAPE OF THE FIVE backup-health fields carried inside deployment_health.backup_health (jsonb)
//     on the mgmt-plane push (schema.md §13; the jsonb is opaque to @harness/management — ISSUE-085 defines
//     its internal shape, NFR-DR.006 / ADR-008 part 5),
//   • the restore-rehearsal result record, and
//   • the off-platform snapshot descriptor + the compliance-erasure purge flag (NFR-DR.009).
//
// ⚠️ FEASIBILITY (owed-to-live, do NOT fake a pass here):
//   AF-069 Path B is 🟢 (ISSUE-004, off-platform pg_dump→pg_restore proven: 5000/5000 memories + embeddings,
//   25/25 auth rows, RTO 19.4s). Path A (in-project PITR/daily restore) NOT proven → residual.
//   AF-070 (Management-API payload) build-time; AF-071 (residency DOCS); AF-072 (LOAD hourly-at-volume) — residual.
//   AF-137 (SPIKE — the off-platform purge leg clears a planted residue) — residual live spike.

/** config-registry.md §M `recovery_tier` — the per-silo backup plan. Enum EXACTLY as the config key defines it.
 *  Default is `hourly_off_platform` (NFR-DR.001); `daily_in_project` is BELOW hourly and may only be set via a
 *  LOGGED downgrade exception (never a silent default); `pitr` is the paid opt-in upsell (~$100+/mo, client card). */
export type RecoveryTier = 'daily_in_project' | 'hourly_off_platform' | 'pitr';
export const RECOVERY_TIERS: readonly RecoveryTier[] = ['daily_in_project', 'hourly_off_platform', 'pitr'];
export const DEFAULT_RECOVERY_TIER: RecoveryTier = 'hourly_off_platform';

/** The tiers that are AT-OR-ABOVE the hourly RPO floor. Moving below this (daily_in_project) is a downgrade
 *  that MUST be logged (NFR-DR.001 / AC-NFR-DR.001.1). `pitr` is above hourly; `hourly_off_platform` is the floor. */
export const AT_OR_ABOVE_HOURLY: readonly RecoveryTier[] = ['hourly_off_platform', 'pitr'];

/** The Supabase project status framing the mgmt-plane surfaces (NFR-DR.006 field 3). Sourced from the
 *  Management API project status. `billing_at_risk` / `paused` are the approaching pause → 90-day deletion path
 *  the loud alert exists to catch early (ADR-008 Context finding 1). */
export type ProjectStatus = 'active' | 'paused' | 'billing_at_risk';
export const PROJECT_STATUSES: readonly ProjectStatus[] = ['active', 'paused', 'billing_at_risk'];

/** A restore-rehearsal outcome (NFR-DR.003). A pass = DB + pgvector memory + auth user rows complete & queryable
 *  within acceptable downtime. `failed` and a never-run rehearsal both drive a LOUD alert (never assumed-green). */
export type RehearsalResult = 'passed' | 'failed';

/** One recorded restore rehearsal (NFR-DR.003 / AC-NFR-DR.003.1/.2). Logged with a timestamp; the standing
 *  cadence is monthly + on every schema-migration release (RP-2). Records the MEASURED RTO (NFR-DR.005 — the RTO
 *  is a measured number, never assumed). `restored_into` is the THROWAWAY project, never production. */
export interface RehearsalRecord {
  rehearsal_id: string;
  client_slug: string;
  ran_at: string; // ISO — server-authoritative
  result: RehearsalResult;
  restored_into: string; // the throwaway project ref (NOT production)
  // The three completeness assertions that make a pass a pass (AC-NFR-DR.003.1):
  db_queryable: boolean;
  pgvector_memory_complete: boolean; // memories + embeddings came back (dimension-correct, queryable)
  auth_rows_complete: boolean; // auth.users rows came back + resolvable
  measured_rto_seconds: number | null; // MEASURED (NFR-DR.005), null only on a failed/aborted restore
  // what triggered this run — the cadence provenance (monthly tick vs a schema-migration release, RP-2).
  trigger: RehearsalTrigger;
  detail: string;
}

/** Why a rehearsal ran (NFR-DR.003 cadence: monthly + on every schema-migration release, RP-2). */
export type RehearsalTrigger = 'monthly' | 'migration-release' | 'manual';

/** The off-platform snapshot descriptor (NFR-DR.002). An hourly encrypted logical `pg_dump` written to a
 *  client-owned, different-region destination INDEPENDENT of the primary project's billing lifecycle — the ONLY
 *  copy that survives the pause → 90-day-deletion path. The operator ORCHESTRATES but NEVER HOLDS it. */
export interface OffPlatformSnapshot {
  snapshot_id: string;
  client_slug: string;
  taken_at: string; // ISO
  destination: OffPlatformDestination;
  encrypted: boolean;
  size_bytes: number | null;
}

/** The client-owned off-platform destination (NFR-DR.002 / AC-NFR-DR.002.1). MUST be client-owned, encrypted,
 *  different-region, and lifecycle-independent of the primary project. An operator-held destination is a LOGGED
 *  per-client exception only (never the default — ADR-008 Axis 2 / B3). */
export interface OffPlatformDestination {
  owner: 'client' | 'operator'; // 'operator' ⇒ a logged exception (never the default)
  region: string; // operator-chosen for the off-platform copy (controllable, unlike in-project backups)
  primary_region: string; // the primary project's region — destination MUST differ (different-region)
  lifecycle_independent: boolean; // survives a paused/deleted primary project (the deletion-path defense)
}

/** The compliance-erasure purge flag RAISED by C2 FR-2.MNT.017 (AC-2.MNT.017.2) and RECEIVED here (NFR-DR.009).
 *  C2 seams the mechanics to Phase 5 — NFR-DR.009 IS the receive-leg contract. The concrete transport is
 *  coordinated with the ISSUE-082 raise-leg; this shape is the interface. */
export interface PurgeFlag {
  flag_id: string;
  client_slug: string;
  // the erased target whose Personal data must not persist in pre-erasure off-platform snapshots.
  target_ref: string;
  raised_at: string; // ISO — when the C2 erasure completed and raised the flag
  // erasure completing BEFORE a snapshot means that snapshot is clean; snapshots taken AT/BEFORE this are suspect.
  erasure_effective_at: string; // ISO
}
