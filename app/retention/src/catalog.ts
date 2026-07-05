// ISSUE-084 — the retention/isolation/residency CATALOG (the build-time constants this slice registers +
// asserts). Homed in TS to avoid the SQL/TS drift ISSUE-010 caught — this issue authors NO new DDL (it
// registers CFG keys into the ISSUE-010 config store and asserts the ISSUE-008 baseline schema). Every
// constant here cites its FR / config-registry source of truth so a zero-context reader can trace it.
//
// Sources:
//   - FR-10.RET.002 + config-registry §M — the four retention CFG keys + defaults + PERM-config.infra gate.
//   - FR-10.ISO.001 / schema.md "Global rules" — no client_slug on any application table.
//   - FR-10.ISO.003 + ADR-001 §Consequences + ADR-005 §5 — v1 residency default ap-southeast-2.
//   - AF-136 — the legal-minimum FLOORS are jurisdiction-dependent; the values below are conservative
//     engineering placeholders (a configurable safeguard, NOT legal advice) whose real per-jurisdiction
//     value is set by the FR-10.LEG.001 legal review before regulated data is handled.

// ── The four retention config keys (FR-10.RET.002, config-registry §M) ──────────────────────────────
export const RETENTION_KEYS = [
  'client_offboarding_retention_days',
  'individual_deletion_audit_years',
  'data_export_link_expiry_hours',
  'deletion_two_person_auth_required',
] as const;
export type RetentionKey = (typeof RETENTION_KEYS)[number];

/** The v2 residency-selection knob — STUBBED in v1 (region is locked to the default, FR-10.ISO.003). */
export const DEPLOYMENT_REGION_KEY = 'deployment_region' as const;

/** The one PERM node that may edit any of these values — Super Admin only, never delegable
 *  (config-registry §M · FR-10.RET.002 · FR-10.ISO.003). */
export const INFRA_PERM = 'PERM-config.infra' as const;

/** The v1 residency lock (ADR-001 §Consequences · ADR-005 §5 · FR-10.ISO.003 AC-10.ISO.003.1). */
export const V1_REGION_DEFAULT = 'ap-southeast-2' as const;

// ── Defaults (FR-10.RET.002 AC-10.RET.002.1 — 90 days / 7 years / 72 hours / true) ──────────────────
export const RETENTION_DEFAULTS: Readonly<Record<RetentionKey, number | boolean>> = {
  client_offboarding_retention_days: 90,
  individual_deletion_audit_years: 7,
  data_export_link_expiry_hours: 72,
  deletion_two_person_auth_required: true,
};

/** The value type of each key — numeric keys carry a floor; the boolean key does not. */
export type KeyKind = 'int' | 'bool';
export const KEY_KIND: Readonly<Record<RetentionKey, KeyKind>> = {
  client_offboarding_retention_days: 'int',
  individual_deletion_audit_years: 'int',
  data_export_link_expiry_hours: 'int',
  deletion_two_person_auth_required: 'bool',
};

// ── Legal-minimum FLOORS (AF-136 — jurisdiction-dependent; these are the conservative default safeguards
// the legal review REPLACES per jurisdiction, never a hard-coded legal truth). A write below its floor is
// rejected with the floor surfaced (AC-10.RET.002.2 / AC-NFR-CMP.004.1). The boolean key has no floor.
//
// The floors are held in a MUTABLE registry object so the legal review (FR-10.LEG.001) can set a
// jurisdiction's actual minimum at runtime — the store reads whatever the review installed, it never
// bakes a legal value in. `data_export_link_expiry_hours` has a hard floor of 1 (config-registry §M: an
// expiry of 0 is a degenerate link) that is a mechanical safeguard, not a legal minimum.
export interface FloorRegistry {
  client_offboarding_retention_days: number;
  individual_deletion_audit_years: number;
  data_export_link_expiry_hours: number;
}

/** The engineering default floors (AF-136 placeholder). `individual_deletion_audit_years` mirrors the
 *  7-year default because many audit regimes floor there; `client_offboarding_retention_days` floors low
 *  (30) because a shorter dispute window is jurisdiction-legal in some regimes — the review sets the truth. */
export const DEFAULT_FLOORS: Readonly<FloorRegistry> = {
  client_offboarding_retention_days: 30,
  individual_deletion_audit_years: 7,
  data_export_link_expiry_hours: 1,
};

// ── The two — and only two — sanctioned hard-delete paths (FR-10.RET.001 / NFR-CMP.003). Any hard-delete
// whose provenance is not one of these is an incidental delete, forbidden by the intentional-retention
// principle; the C2 tombstone with no authorisation behind it is the detector (AC-10.RET.001.3).
export const SANCTIONED_DELETE_PATHS = ['individual_erasure', 'client_offboarding'] as const;
export type DeletePath = (typeof SANCTIONED_DELETE_PATHS)[number];

/** The routine memory-lifecycle operations — NONE of which may ever hard-delete (AC-10.RET.001.1). */
export const ROUTINE_OPS = ['decay', 'supersede', 'archive', 'cold_tier'] as const;
export type RoutineOp = (typeof ROUTINE_OPS)[number];
