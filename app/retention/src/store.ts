// ISSUE-084 — the RetentionStore PORT + in-memory fake reference model (the house port+fake pattern, cf.
// app/config-store, app/rbac, app/webhook-auth). Every live side effect of the C10 retention/isolation/
// residency invariants goes through this port so the logic stays unit-testable with NO live DB. The
// in-memory fake is BOTH the test double AND the reference model the live pg adapter (supabase-store.ts)
// must match against the ISSUE-008 baseline schema + the ISSUE-010 config store it registers into.
//
// This slice authors NO migration: it REGISTERS the four FR-10.RET.002 CFG keys into the ISSUE-010
// config_values store (with floor-validation on write), ASSERTS the ISSUE-008 baseline schema has no
// client_slug on any application table (the isolation lint), records the v1 residency default, and homes
// the RET.001 intentional-retention detector. Invariants enforced in the fake EXACTLY as the DB / config
// store / RBAC would (so a test against the fake proves the contract the live silo must uphold):
//   1. Retention values resolve to their defaults when unset (90/7/72/true) — AC-10.RET.002.1.
//   2. A write below a key's legal-minimum floor is REJECTED with the floor surfaced; a non-Super-Admin
//      write is REJECTED by RBAC (PERM-config.infra) — AC-10.RET.002.2 / AC-NFR-CMP.004.1. Fail-closed:
//      an unresolvable floor blocks the write, never silently accepts a non-compliant window (#2/#3).
//   3. Every accepted change is AUDITED (who/old/new/when) — AC-10.RET.002.3 / AC-NFR-CMP.003.2.
//   4. Client identity (client_slug) lives ONLY in the management-plane registry; an app-table row can
//      never carry it — AC-10.ISO.001.2 / AC-NFR-SEC.001.2. The schema lint (index.ts) proves .001.1.
//   5. Residency defaults to ap-southeast-2 and is RECORDED per deployment (never silently defaulted) —
//      AC-10.ISO.003.1 / AC-NFR-CMP.001.1; the v2 knob is selectable — AC-10.ISO.003.2.
//   6. A hard-delete produces a tombstone; a tombstone with NO sanctioned DEL/OFF authorisation behind it
//      is the detectable RET.001 violation — AC-10.RET.001.2/.3 / AC-NFR-CMP.003.1. A routine op never
//      hard-deletes — AC-10.RET.001.1.
//   7. Physical isolation = airtight deletion evidence: no shared store holds a client's business data —
//      AC-10.ISO.002.1.
//   8. The legal-review gate is a GO-LIVE PRECONDITION, not an engineering default — AC-10.LEG.001.1/.2 /
//      AC-NFR-CMP.004.2 / AC-NFR-CMP.011.1; an ADR-posture change routes through change-control —
//      AC-NFR-CMP.011.2. This is proven-as-a-precondition here; the actual lawyer sign-off is owed to a
//      live onboarding session (OD-172 pattern — see results/notes).

import {
  RETENTION_KEYS,
  RETENTION_DEFAULTS,
  DEFAULT_FLOORS,
  KEY_KIND,
  INFRA_PERM,
  V1_REGION_DEFAULT,
  SANCTIONED_DELETE_PATHS,
  type RetentionKey,
  type FloorRegistry,
  type DeletePath,
  type RoutineOp,
} from './catalog.ts';

// ── Errors (machine reason + message, so callers surface, never swallow — #3) ───────────────────────
export class RetentionError extends Error {
  constructor(
    public reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'RetentionError';
  }
}
export const ERR_DENIED = 'denied'; // non-Super-Admin write to a retention value (RBAC)
export const ERR_BELOW_FLOOR = 'below_floor'; // value < legal-minimum floor
export const ERR_FLOOR_UNRESOLVED = 'floor_unresolved'; // fail-closed: no floor to check against
export const ERR_BAD_TYPE = 'bad_type'; // wrong value kind for the key
export const ERR_CLIENT_SLUG = 'client_slug_forbidden'; // an app-table row tried to carry client identity
export const ERR_UNAUTHORISED_DELETE = 'unauthorised_hard_delete'; // tombstone w/o DEL/OFF authorisation

// ── Row shapes ──────────────────────────────────────────────────────────────────────────────────────
/** An audit row for a retention-config change (mirrors ISSUE-010 config_audit_log — who/old/new/when). */
export interface RetentionAuditRow {
  key: string;
  old_value: number | boolean | null;
  new_value: number | boolean;
  actor_id: string;
  changed_at: number; // logical epoch seconds
}

/** A management-plane client_registry row — the ONE valid home of client_slug + region (schema §13). */
export interface RegistryRow {
  client_slug: string;
  region: string;
}

/** A hard-delete tombstone (the C2 sole-writer + ADR-004 model — AC-10.RET.001.3). `path` is the
 *  sanctioned provenance; null ⇒ no DEL/OFF authorisation behind it ⇒ the detectable violation. */
export interface Tombstone {
  memory_id: string;
  path: DeletePath | null;
  authorised_by: string | null; // the DEL/OFF authorisation record; null ⇒ violation
  at: number;
}

/** The residency record for a deployment (recorded, never silently defaulted — AC-NFR-CMP.001.1). */
export interface ResidencyRecord {
  region: string;
  recorded: true; // presence is the point: residency is an explicit recorded fact
  surfaced_for_legal_review: boolean; // AC-NFR-CMP.001.2 — surfaced under FR-10.LEG.001
}

/** A legal-review gate record (FR-10.LEG.001). A deployment may not go live handling regulated personal
 *  data, nor enable a jurisdiction-sensitive feature (HR content), until this is affirmatively reviewed. */
export interface LegalReview {
  jurisdiction: string;
  retention_values_reviewed: boolean;
  deletion_procedures_reviewed: boolean;
  reviewed_by: string | null; // the qualified lawyer; null ⇒ not yet reviewed ⇒ gate closed
}

// ── The port ────────────────────────────────────────────────────────────────────────────────────────
export interface RetentionStore {
  // Retention config (registered into the ISSUE-010 store; floor-validated on write).
  getValue(key: RetentionKey): Promise<number | boolean>; // resolves default when unset
  setValue(key: RetentionKey, value: number | boolean, actorPerms: readonly string[], actorId: string, now: number): Promise<void>;
  setFloor(key: keyof FloorRegistry, floor: number): Promise<void>; // legal review installs the real floor
  audits(): Promise<RetentionAuditRow[]>;

  // Isolation (identity only in the registry — the app-table rows can never carry client_slug).
  registerClient(row: RegistryRow): Promise<void>; // management-plane registry write
  registryHome(clientSlug: string): Promise<RegistryRow | null>;
  writeAppRow(table: string, row: Record<string, unknown>): Promise<void>; // rejects any client_slug column
  hasSharedBusinessStore(): Promise<boolean>; // AC-10.ISO.002.1 — must be false (physical isolation)

  // Residency.
  recordResidency(region: string | null): Promise<ResidencyRecord>; // null ⇒ v1 default, RECORDED
  residency(): Promise<ResidencyRecord | null>;

  // Intentional retention (RET.001) — the detector.
  routineOp(op: RoutineOp, memoryId: string): Promise<void>; // NEVER hard-deletes (asserts intact)
  hardDelete(memoryId: string, path: DeletePath | null, authorisedBy: string | null, now: number): Promise<Tombstone>;
  tombstones(): Promise<Tombstone[]>;
  unauthorisedTombstones(): Promise<Tombstone[]>; // the RET.001 violations detected

  // Legal-review gate (FR-10.LEG.001) — go-live precondition, not an engineering default.
  recordLegalReview(review: LegalReview): Promise<void>;
  mayHandleRegulatedData(jurisdiction: string): Promise<boolean>;
  mayEnableSensitiveFeature(jurisdiction: string, feature: string): Promise<boolean>;
}

// ── The in-memory fake reference model ──────────────────────────────────────────────────────────────
export class InMemoryRetentionStore implements RetentionStore {
  private values = new Map<RetentionKey, number | boolean>();
  private floors: FloorRegistry = { ...DEFAULT_FLOORS };
  private auditLog: RetentionAuditRow[] = [];
  private registry = new Map<string, RegistryRow>();
  private appRows: Array<{ table: string; row: Record<string, unknown> }> = [];
  private residencyRec: ResidencyRecord | null = null;
  private tombstoneLog: Tombstone[] = [];
  private reviews = new Map<string, LegalReview>();

  // ── retention config ──
  async getValue(key: RetentionKey): Promise<number | boolean> {
    // AC-10.RET.002.1 — unset resolves to the catalog default.
    return this.values.has(key) ? this.values.get(key)! : RETENTION_DEFAULTS[key];
  }

  async setValue(
    key: RetentionKey,
    value: number | boolean,
    actorPerms: readonly string[],
    actorId: string,
    now: number,
  ): Promise<void> {
    // RBAC (AC-10.RET.002.2 tail / AC-NFR-CMP.004.1): only PERM-config.infra (Super Admin) may edit.
    if (!actorPerms.includes(INFRA_PERM)) {
      throw new RetentionError(ERR_DENIED, `retention value '${key}' is ${INFRA_PERM}-gated (Super Admin only); actor lacks it`);
    }
    // Type discipline — a bool key takes a bool, an int key a non-negative integer.
    const kind = KEY_KIND[key];
    if (kind === 'bool') {
      if (typeof value !== 'boolean') throw new RetentionError(ERR_BAD_TYPE, `'${key}' is a boolean toggle`);
    } else {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new RetentionError(ERR_BAD_TYPE, `'${key}' is a non-negative integer`);
      }
      // AC-10.RET.002.2 / AC-NFR-CMP.004.1 — reject a value below its legal-minimum floor, floor surfaced.
      const floor = this.floors[key as keyof FloorRegistry];
      if (floor === undefined || floor === null || Number.isNaN(floor)) {
        // Fail-closed (#2/#3): a value with no resolvable floor is never silently accepted.
        throw new RetentionError(ERR_FLOOR_UNRESOLVED, `'${key}' has no resolvable legal-minimum floor — write blocked (fail-closed)`);
      }
      if (value < floor) {
        throw new RetentionError(ERR_BELOW_FLOOR, `'${key}' = ${value} is below the legal-minimum floor of ${floor} — rejected (set the value at or above ${floor})`);
      }
    }
    const old = this.values.has(key) ? this.values.get(key)! : RETENTION_DEFAULTS[key];
    this.values.set(key, value);
    // AC-10.RET.002.3 / AC-NFR-CMP.003.2 — every accepted change is audited (who/old/new/when).
    this.auditLog.push({ key, old_value: old, new_value: value, actor_id: actorId, changed_at: now });
  }

  async setFloor(key: keyof FloorRegistry, floor: number): Promise<void> {
    // The legal review (FR-10.LEG.001) installs the jurisdiction's actual floor (AF-136).
    if (!Number.isInteger(floor) || floor < 0) throw new RetentionError(ERR_BAD_TYPE, `floor for '${key}' must be a non-negative integer`);
    this.floors[key] = floor;
  }

  async audits(): Promise<RetentionAuditRow[]> {
    return this.auditLog.map((r) => ({ ...r }));
  }

  // ── isolation ──
  async registerClient(row: RegistryRow): Promise<void> {
    // The management-plane registry is the ONE valid home of client_slug (schema §13).
    this.registry.set(row.client_slug, { ...row });
  }
  async registryHome(clientSlug: string): Promise<RegistryRow | null> {
    return this.registry.get(clientSlug) ?? null;
  }

  async writeAppRow(table: string, row: Record<string, unknown>): Promise<void> {
    // AC-10.ISO.001.2 / AC-NFR-SEC.001.2 — an application-table row can NEVER carry a client-identity
    // column. Inside a client silo there is exactly one client, so there is nothing to filter against
    // (ADR-001 §3); a client_slug here is an isolation-model contradiction, rejected.
    for (const col of Object.keys(row)) {
      if (col === 'client_slug' || col === 'client_id' || col === 'tenant_id' || col === 'tenant') {
        throw new RetentionError(
          ERR_CLIENT_SLUG,
          `application table '${table}' may not carry client-identity column '${col}' (FR-10.ISO.001 / ADR-001 §3) — identity lives only in the management-plane client_registry`,
        );
      }
    }
    this.appRows.push({ table, row: { ...row } });
  }

  async hasSharedBusinessStore(): Promise<boolean> {
    // AC-10.ISO.002.1 — physical isolation: each client's data lives only in their own Supabase; there is
    // NO shared business-data store, so deprovisioning it is airtight deletion evidence. The reference
    // model holds business rows only in per-client silos (modelled by writeAppRow), never a shared table.
    return false;
  }

  // ── residency ──
  async recordResidency(region: string | null): Promise<ResidencyRecord> {
    // AC-10.ISO.003.1 / AC-NFR-CMP.001.1 — the region is RECORDED, never silently defaulted. A null
    // (unspecified) region resolves to the v1 lock ap-southeast-2 and is still an explicit recorded fact.
    const resolved = region ?? V1_REGION_DEFAULT;
    this.residencyRec = { region: resolved, recorded: true, surfaced_for_legal_review: true };
    return { ...this.residencyRec };
  }
  async residency(): Promise<ResidencyRecord | null> {
    return this.residencyRec ? { ...this.residencyRec } : null;
  }

  // ── intentional retention (RET.001) ──
  async routineOp(op: RoutineOp, memoryId: string): Promise<void> {
    // AC-10.RET.001.1 — a routine operation (decay/supersede/archive/cold-tier) NEVER hard-deletes. It is
    // a no-op on the tombstone log by construction: the record persists, only its lifecycle metadata moves.
    void op;
    void memoryId;
    // Deliberately does NOT push to tombstoneLog — proving no routine op produces a hard-delete.
  }

  async hardDelete(memoryId: string, path: DeletePath | null, authorisedBy: string | null, now: number): Promise<Tombstone> {
    // AC-10.RET.001.2/.3 — every hard-delete produces a tombstone; a tombstone whose provenance is not one
    // of the two sanctioned paths (individual_erasure / client_offboarding) WITH an authorisation record is
    // the detectable violation. We record it either way (the tombstone must exist), then the detector
    // surfaces the unauthorised ones — the delete is never silently accepted.
    const sanctioned = path !== null && (SANCTIONED_DELETE_PATHS as readonly string[]).includes(path) && authorisedBy !== null;
    const tomb: Tombstone = { memory_id: memoryId, path: sanctioned ? path : null, authorised_by: sanctioned ? authorisedBy : null, at: now };
    this.tombstoneLog.push(tomb);
    return { ...tomb };
  }

  async tombstones(): Promise<Tombstone[]> {
    return this.tombstoneLog.map((t) => ({ ...t }));
  }
  async unauthorisedTombstones(): Promise<Tombstone[]> {
    // The RET.001 detector (AC-10.RET.001.3): a tombstone with no DEL/OFF authorisation behind it.
    return this.tombstoneLog.filter((t) => t.path === null || t.authorised_by === null).map((t) => ({ ...t }));
  }

  // ── legal-review gate (FR-10.LEG.001) ──
  async recordLegalReview(review: LegalReview): Promise<void> {
    this.reviews.set(review.jurisdiction, { ...review });
  }

  private reviewComplete(jurisdiction: string): boolean {
    const r = this.reviews.get(jurisdiction);
    return !!r && r.retention_values_reviewed && r.deletion_procedures_reviewed && r.reviewed_by !== null;
  }

  async mayHandleRegulatedData(jurisdiction: string): Promise<boolean> {
    // AC-10.LEG.001.1 — a deployment handling regulated personal data may go live ONLY after the retention
    // values + deletion procedures are legally reviewed for that jurisdiction. Default: closed (#2).
    return this.reviewComplete(jurisdiction);
  }
  async mayEnableSensitiveFeature(jurisdiction: string, feature: string): Promise<boolean> {
    // AC-10.LEG.001.2 — a jurisdiction-sensitive feature (e.g. HR content) requires the review before
    // enablement. Same gate; the feature name is recorded for the caller's audit context.
    void feature;
    return this.reviewComplete(jurisdiction);
  }
}

export { RETENTION_KEYS, RETENTION_DEFAULTS, INFRA_PERM, V1_REGION_DEFAULT, SANCTIONED_DELETE_PATHS };
