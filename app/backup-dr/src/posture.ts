// ISSUE-085 — the stated backup/DR POSTURE assertions (NFR-DR.004/005/007/008 — the DOCS-verified postures).
//
// These are governance/scoping postures that must be RECORDED so no one silently assumes something that does
// not exist (a hot failover, a Storage backup, a single-layer durability guarantee). They are asserted as
// machine-checkable constants so a test proves the posture is stated (not merely prose), and the `check` CLI
// surfaces them. Each cites its ADR-008 part / NFR-DR row.

import { type RecoveryTier } from './types.ts';

/** NFR-DR.004 — the ownership split (client owns+pays / operator operates+verifies). Neither side may assume the
 *  other is doing it. Recorded in the provisioning runbook (ADR-005) + retainer scope. The operator holds only a
 *  DELEGATED credential scoped to backup ops + status reads — NOT a broad grant (ADR-008 §Consequences /
 *  NFR-SEC.017 / NFR-SEC.003). NOTE: the concrete credential SCOPE/grant is owned by ISSUE-007 provisioning —
 *  this slice ASSERTS the posture, it does not define the grant. */
export const OWNERSHIP_SPLIT = {
  client: ['owns the Supabase project', 'pays (their card)', 'owns the off-platform destination', 'owns the optional PITR add-on'],
  operator: ['schedules the snapshot job', 'runs restore rehearsals', 'watches backup-health'],
  // the operator's backup credential is delegated + scoped (posture only; the grant is ISSUE-007's to define):
  operator_credential: 'delegated, scoped to backup operations + status reads only — NOT a broad grant (ADR-008 §Consequences; scope owned by ISSUE-007 provisioning)',
  recorded_in: ['provisioning runbook (ADR-005)', 'retainer scope'],
  neither_may_assume_the_other: true,
} as const;

/** NFR-DR.005 — the DR posture: backup-restore WITH DOWNTIME, not hot failover. Acceptable at ADR-001 scale
 *  (≤~20 users / ≤~20 clients). No auto-failover (Enterprise-only on Supabase). HA / read-replicas are a
 *  per-client UPSELL, never a v1 default (OOS-014). The RTO is a MEASURED number (NFR-DR.005 / AF-069), not
 *  assumed — the AF-069 Path B rehearsal measured 19.4s (ISSUE-004); the production-tier RTO is confirmed at the
 *  standing rehearsal. */
export const DR_POSTURE = {
  recovery_model: 'backup-restore-with-downtime' as const,
  hot_failover: false, // Supabase auto-failover is Enterprise-only
  rto_is_measured_not_assumed: true, // NFR-DR.005 — measured at the AF-069 rehearsal
  af069_path_b_measured_rto_seconds: 19.4, // ISSUE-004 Path B (off-platform pg_dump→restore); production-tier RTO confirmed at the standing rehearsal
  ha_read_replica: 'per-client-upsell' as const, // OOS-014, never a v1 default
  acceptable_scale: '≤~20 users / ≤~20 clients (ADR-001)',
} as const;

/** NFR-DR.007 — Storage buckets OUT OF SCOPE for v1 backup (OOS-013). v1 Storage holds ONLY regenerable
 *  offboarding export files; per the golden rule source files/records are referenced by `source_ref`, never
 *  copied into Supabase — so the off-platform dump backs up only the derived DB layer. A future component
 *  storing NON-regenerable files in Storage re-opens this (bucket-copy must then join the off-platform job). */
export const STORAGE_SCOPE = {
  buckets_backed_up_in_v1: false, // OOS-013
  v1_storage_contents: 'regenerable offboarding export files ONLY',
  source_files_copied_into_supabase: false, // golden rule — referenced by source_ref, never copied
  reopens_if: 'a future component stores NON-regenerable files in Storage',
} as const;

/** NFR-DR.008 — defense-in-depth durability: backup ∩ append-only tamper-evident audit history ∩ shadow-retain
 *  each INDEPENDENTLY preserve knowledge; no single layer is the sole guarantor. The audit-sink immutability
 *  ENFORCEMENT lives in compliance.md (CMP-f / enforce_audit_append_only()); this asserts the DR-side
 *  composition (that the three layers exist and are independent). */
export const DEFENSE_IN_DEPTH_LAYERS = [
  { layer: 'proven-restore', owner: 'NFR-DR.003 (this domain)', independent: true },
  { layer: 'append-only-tamper-evident-audit-history', owner: 'compliance.md CMP-f / enforce_audit_append_only()', independent: true },
  { layer: 'shadow-retain', owner: 'retention.md (retention-freeze)', independent: true },
] as const;

/** The default recovery tier per silo (AC-NFR-DR.001.1) — free daily in-project + hourly off-platform, PITR off. */
export const DEFAULT_TIER_POSTURE: {
  daily_in_project: true;
  hourly_off_platform: true;
  pitr: false;
  default_tier: RecoveryTier;
} = {
  daily_in_project: true,
  hourly_off_platform: true,
  pitr: false,
  default_tier: 'hourly_off_platform',
};
