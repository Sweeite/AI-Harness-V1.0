// ISSUE-068 (C9 MODE) — the ProactivityStore PORT + the in-memory reference fake. The pure DECISIONS live in
// modes.ts; this layer ENACTS them: it persists the assigned mode to `proactive_suggestions.mode`, reads the
// `action_autonomy_matrix` object from `config_values`, and runs the Super-Admin-gated + write-validated matrix
// write path — logging BOTH a committed and a DENIED edit to `access_audit` (a denied matrix edit is never
// swallowed — #3, AC-9.MODE.004.4). The DB enum + the DB CHECK are the backstops; the floor/ceiling decision is
// made here in code before any write, so a DB outage can never lower a floored sub-type or admit an Act value.

import {
  isProactivityMode,
  validateMatrixEdit,
  SUBTYPE_CEILING,
  type AutonomyMatrix,
  type ProactivityMode,
  type RiskSubType,
} from './modes.ts';

// The config key that holds the structured matrix object (schema §12; config-registry §I item 9).
export const CFG_ACTION_AUTONOMY_MATRIX = 'action_autonomy_matrix';

// The Super-Admin-only PERM node gating a matrix write (PERMISSION_NODES.md L167; FR-1.PERM.005 discipline).
export const PERM_EDIT_AUTONOMY = 'PERM-guardrail.edit_autonomy';

// The access_audit action strings this slice writes (schema §access_audit; free-text `action` column).
export const AUDIT_ACTION_MATRIX_EDIT = 'autonomy_matrix_edit';
export const AUDIT_ACTION_MATRIX_EDIT_DENIED = 'autonomy_matrix_edit_denied';

/** Telemetry sink for a dropped stored-matrix entry (poisoned/legacy/tampered value). Never silent (#3). */
export type MatrixDropSink = (key: string, value: unknown, reason: string) => void;

/** Default drop sink — a structured warning so a rejected autonomy-matrix config value is observable rather
 *  than silently defaulted to Prepare. Fail-safe DIRECTION is unchanged; the drop is simply no longer silent. */
export function warnMatrixDrop(key: string, value: unknown, reason: string): void {
  console.warn(
    `[proactivity-modes] action_autonomy_matrix: DROPPED stored entry '${key}'=${JSON.stringify(value)} — ${reason}; falling back to the code-default ceiling (Prepare). Config value rejected, not honoured (#3, OD-161).`,
  );
}

/** The stored matrix object as it lives in `config_values.value` — a partial map of sub-type → ceiling. Only
 *  `low_risk_external_nonclient` is ever present (the only editable sub-type); floored sub-types are absent and
 *  fall through to their code-fixed Prepare ceiling. Implements AutonomyMatrix so it feeds assignMode directly. */
export class StoredAutonomyMatrix implements AutonomyMatrix {
  constructor(private readonly ceilings: Partial<Record<RiskSubType, ProactivityMode>> = {}) {}

  ceilingFor(subType: RiskSubType): ProactivityMode | undefined {
    return this.ceilings[subType];
  }

  /** the raw object as persisted to config_values.value (only editable, present sub-types). */
  toJSON(): Partial<Record<RiskSubType, ProactivityMode>> {
    return { ...this.ceilings };
  }

  /** parse a config_values.value blob into a StoredAutonomyMatrix, DROPPING any Act value or unknown key
   *  (fail-safe: a poisoned/legacy Act ceiling is never honoured at read; the code default Prepare applies).
   *  A drop is NEVER silent (#3): every dropped entry is surfaced via `onDrop` (default: a structured
   *  console.warn) so a poisoned/tampered/legacy autonomy-matrix config leaves telemetry rather than being
   *  quietly defaulted to Prepare. The DIRECTION stays fail-safe — the entry is still dropped — but the fact
   *  that a stored config value was rejected is now observable. */
  static fromValue(value: unknown, onDrop: MatrixDropSink = warnMatrixDrop): StoredAutonomyMatrix {
    const out: Partial<Record<RiskSubType, ProactivityMode>> = {};
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (!(k in SUBTYPE_CEILING)) {
          onDrop(k, v, 'unknown risk sub-type key — not one of the five (OD-161)');
          continue; // unknown sub-type → drop (never silent)
        }
        if (!isProactivityMode(v) || v === 'act') {
          onDrop(k, v, v === 'act' ? 'Act ceiling is not a reachable matrix value (OD-161)' : 'value is not a valid proactivity mode');
          continue; // Act / invalid → drop (OD-161 fail-safe, never silent)
        }
        out[k as RiskSubType] = v;
      }
    }
    return new StoredAutonomyMatrix(out);
  }
}

/** A matrix write request — the actor + the resolved PERM gate outcome + the proposed edit. */
export interface AutonomyMatrixWriteRequest {
  subType: string;
  ceiling: string;
  /** the human-readable identity attempting the edit — free text, written to access_audit.actor_identity
   *  (a `text not null` column). This is the AUDIT identity; it is NOT the FK below. */
  actorIdentity: string;
  /** the actor's profile UUID — written to config_values.updated_by, a `uuid references profiles(id)` FK
   *  (0001_baseline.sql L630). REQUIRED for a committed edit: a free-text name here throws 22P02/23503 live,
   *  so the live adapter validates the uuid and fails loud before writing (#3). Distinct from actorIdentity —
   *  the audit column is text (human name) and updated_by is a uuid FK; one field cannot serve both. */
  actorProfileId?: string | null;
  /** the resolved outcome of the PERM-guardrail.edit_autonomy node-gate — true iff the actor is Super-Admin. */
  isSuperAdmin: boolean;
}

export interface MatrixWriteOutcome {
  committed: boolean;
  denied: boolean;
  /** why committed / denied — never empty (#3). */
  reason: string;
}

/** An access_audit append (schema §access_audit). Reason mandatory for a denial (#3 — never silent). */
export interface AuditEntry {
  auditType: string;
  actorIdentity: string;
  action: string;
  targetType: string;
  beforeValue: unknown;
  afterValue: unknown;
  reason: string;
}

export interface ProactivityStore {
  /** persist the assigned mode onto a proactive_suggestions row (MODE.001/002 — stamped before it is surfaced). */
  persistMode(suggestionId: string, mode: ProactivityMode): Promise<void>;
  /** read the action_autonomy_matrix object from config_values (undefined key → empty matrix, code defaults). */
  loadMatrix(): Promise<StoredAutonomyMatrix>;
  /** the Super-Admin-gated + write-validated matrix write path; logs committed AND denied edits (MODE.004). */
  writeMatrix(req: AutonomyMatrixWriteRequest): Promise<MatrixWriteOutcome>;
  /** append an access_audit row (append-only). */
  appendAudit(entry: AuditEntry): Promise<void>;
}

// Shared write-path policy (used by BOTH the in-memory fake and the live adapter so the #2 gate + #3 audit are
// identical). Returns the outcome + the audit entry to append; the caller persists the config + the audit.
export interface MatrixWritePlan {
  outcome: MatrixWriteOutcome;
  audit: AuditEntry;
  /** the validated (subType, ceiling) to commit — present ONLY when outcome.committed. */
  commit?: { subType: RiskSubType; ceiling: ProactivityMode };
}

/**
 * The pure matrix-write decision: (1) PERM gate — a non-Super-Admin edit is DENIED + audited (AC-9.MODE.004.4);
 * (2) write-time validation — an Act ceiling (any sub-type) or a floored-sub-type edit is DENIED + audited
 * (AC-9.MODE.004.1 / .2); (3) otherwise committed. A denial always produces an audit entry (#3 — never silent).
 */
export function planMatrixWrite(req: AutonomyMatrixWriteRequest, before: unknown): MatrixWritePlan {
  const baseAudit = {
    auditType: 'config_change',
    actorIdentity: req.actorIdentity,
    targetType: CFG_ACTION_AUTONOMY_MATRIX,
    beforeValue: before,
  };

  // (1) PERM gate — Super-Admin only (PERM-guardrail.edit_autonomy). Denied edits are logged (AC-9.MODE.004.4).
  if (!req.isSuperAdmin) {
    const reason = `matrix edit DENIED — ${PERM_EDIT_AUTONOMY} is Super-Admin only; actor '${req.actorIdentity}' is not Super-Admin (AC-9.MODE.004.4).`;
    return {
      outcome: { committed: false, denied: true, reason },
      audit: { ...baseAudit, action: AUDIT_ACTION_MATRIX_EDIT_DENIED, afterValue: { subType: req.subType, ceiling: req.ceiling }, reason },
    };
  }

  // (2) Write-time floor/ceiling validation (AC-9.MODE.004.1 / .2).
  const v = validateMatrixEdit(req.subType, req.ceiling);
  if (!v.ok) {
    const reason = `matrix edit DENIED — ${v.error}`;
    return {
      outcome: { committed: false, denied: true, reason },
      audit: { ...baseAudit, action: AUDIT_ACTION_MATRIX_EDIT_DENIED, afterValue: { subType: req.subType, ceiling: req.ceiling }, reason },
    };
  }

  // (3) Accepted — subType/ceiling are proven valid by validateMatrixEdit above.
  const subType = req.subType as RiskSubType;
  const ceiling = req.ceiling as ProactivityMode;
  const reason = `matrix edit committed — sub-type '${subType}' ceiling set to '${ceiling}' (≤ Prepare) by Super-Admin '${req.actorIdentity}'.`;
  return {
    outcome: { committed: true, denied: false, reason },
    audit: { ...baseAudit, action: AUDIT_ACTION_MATRIX_EDIT, afterValue: { subType, ceiling }, reason },
    commit: { subType, ceiling },
  };
}

// ── In-memory reference fake — the semantics the live adapter must match 1:1 (proven by the R10 smoke) ──────
export class InMemoryProactivityStore implements ProactivityStore {
  private modes = new Map<string, ProactivityMode>();
  private ceilings: Partial<Record<RiskSubType, ProactivityMode>> = {};
  readonly audits: AuditEntry[] = [];

  /** test/seed helper — preload the stored matrix object (as it would sit in config_values). */
  seedMatrix(ceilings: Partial<Record<RiskSubType, ProactivityMode>>): void {
    // Route through fromValue so the same Act/unknown fail-safe applies to seeded data.
    this.ceilings = StoredAutonomyMatrix.fromValue(ceilings).toJSON();
  }

  /** test helper — read back the persisted mode for a suggestion. */
  modeOf(suggestionId: string): ProactivityMode | undefined {
    return this.modes.get(suggestionId);
  }

  async persistMode(suggestionId: string, mode: ProactivityMode): Promise<void> {
    if (!isProactivityMode(mode)) {
      // Fail loud — never persist an out-of-enum mode (the DB enum would reject it; #3).
      throw new Error(`persistMode: '${String(mode)}' is not a valid proactive_mode — refusing to persist (#3).`);
    }
    this.modes.set(suggestionId, mode);
  }

  async loadMatrix(): Promise<StoredAutonomyMatrix> {
    return new StoredAutonomyMatrix({ ...this.ceilings });
  }

  async writeMatrix(req: AutonomyMatrixWriteRequest): Promise<MatrixWriteOutcome> {
    const plan = planMatrixWrite(req, { ...this.ceilings });
    await this.appendAudit(plan.audit); // committed OR denied — always audited (#3).
    if (plan.commit) {
      this.ceilings[plan.commit.subType] = plan.commit.ceiling;
    }
    return plan.outcome;
  }

  async appendAudit(entry: AuditEntry): Promise<void> {
    this.audits.push(entry);
  }
}
