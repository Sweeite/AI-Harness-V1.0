// ISSUE-012 — the operational-metadata allow-list: the ADR-001 §7 / NFR-SEC.002 boundary made concrete.
//
// This is the SINGLE source of truth for "what may cross from a client silo to the management plane".
// It is enforced on BOTH sides of the push seam (the integration note in ISSUE-012 §8):
//   • the reporter never ASSEMBLES a business-data field into the snapshot   (C7 side, AC-7.MGM.001.1)
//   • the ingest RE-VALIDATES and REJECTS one even if a rogue reporter sent it (C10 side, AC-NFR-SEC.002.1)
// A compromised management plane must reveal operational status and NOTHING about any client's business
// (#2) — so the boundary is an allow-list (deny-by-default), never a block-list. A field not on the list
// is business data by construction and is rejected at the boundary.

/** The allow-listed operational-metadata fields (schema.md §13 deployment_health, minus the mgmt-owned
 *  keys). These are the ONLY keys a health-reporter snapshot may carry across the boundary. Everything
 *  else — memories, entity content, message text, any client business data — is rejected. */
export const OPERATIONAL_METADATA_FIELDS = [
  'health_score',
  'queue_depth',
  'approval_queue_depth',
  'alert_counts',
  'core_version',
  'last_migrated_at',
  'connector_rollup',
  'cost_to_date',
  'plugin_version',
  'backup_health',
  'log_write_failing',
] as const;

export type OperationalField = (typeof OPERATIONAL_METADATA_FIELDS)[number];

const ALLOWED = new Set<string>(OPERATIONAL_METADATA_FIELDS);

/** An operational-metadata snapshot — exactly the allow-listed keys, all optional (a push carries whatever
 *  is currently known). No index signature: TypeScript itself refuses an unknown key at author time, and
 *  the runtime guard below refuses it at the boundary (defence in depth — a rogue/older reporter is caught). */
export interface OperationalSnapshot {
  health_score?: number;
  queue_depth?: number;
  approval_queue_depth?: number;
  alert_counts?: Record<string, number>;
  core_version?: string;
  last_migrated_at?: string; // ISO
  connector_rollup?: Record<string, unknown>;
  cost_to_date?: number;
  plugin_version?: string;
  backup_health?: Record<string, unknown>;
  log_write_failing?: boolean;
}

export class BusinessDataAtBoundaryError extends Error {
  constructor(public offendingFields: string[]) {
    super(
      `management-plane boundary: payload carries non-operational field(s) [${offendingFields.join(
        ', ',
      )}] — business data may never cross the boundary (ADR-001 §7 / NFR-SEC.002.1 / #2)`,
    );
    this.name = 'BusinessDataAtBoundaryError';
  }
}

/** The offending (non-allow-listed) keys in an arbitrary payload, in input order. Empty ⇒ payload is clean. */
export function offendingFields(payload: Record<string, unknown>): string[] {
  return Object.keys(payload).filter((k) => !ALLOWED.has(k));
}

/** True IFF every key in the payload is an allow-listed operational field (zero business-data fields). */
export function isOperationalOnly(payload: Record<string, unknown>): boolean {
  return offendingFields(payload).length === 0;
}

/** Reduce an arbitrary payload to ONLY its allow-listed operational fields. The reporter uses this to
 *  ASSEMBLE a clean snapshot (a business-data field is dropped before send — AC-7.MGM.001.1). It does not
 *  throw; assembly is a filter, whereas ingest is a reject (assertOperationalOnly). */
export function pickOperational(payload: Record<string, unknown>): OperationalSnapshot {
  const out: Record<string, unknown> = {};
  for (const f of OPERATIONAL_METADATA_FIELDS) {
    if (f in payload && payload[f] !== undefined) out[f] = payload[f];
  }
  return out as OperationalSnapshot;
}

/** Reject a payload carrying ANY business-data field. The INGEST boundary uses this — it does NOT silently
 *  drop, it refuses the whole push (a rogue reporter that sent business data is a boundary violation, not a
 *  formatting quirk — #2/#3). Returns the validated snapshot on success. */
export function assertOperationalOnly(payload: Record<string, unknown>): OperationalSnapshot {
  const bad = offendingFields(payload);
  if (bad.length > 0) throw new BusinessDataAtBoundaryError(bad);
  return payload as OperationalSnapshot;
}
