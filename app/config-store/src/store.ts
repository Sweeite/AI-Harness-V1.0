// ISSUE-010 — the ConfigStore PORT + in-memory fake (the house port+fake pattern, cf. app/webhook-auth
// store.ts, app/silo). Every live side effect of the config backbone goes through here so the logic stays
// unit-testable with NO live DB. The in-memory fake is BOTH the test double AND the reference model that
// the live pg adapter (supabase-store.ts) must match against the DDL.
//
// Faithful to the DDL in schema.md §12 (config_values, secret_manifest) + §8 (config_audit_log) + the
// §"Immutability enforcement" trigger. Invariants enforced in the fake EXACTLY as the DB trigger/RLS/
// taxonomy would (so a test against the fake proves the contract the live silo must uphold):
//   1. config_audit_log is APPEND-ONLY — no in-place UPDATE, no DELETE, EXCEPT the two whitelisted
//      mutations the enforce_audit_append_only() trigger allows: a one-way redaction-tombstone (set
//      redacted_at + scrub actor_id) and the privileged retention prune. Everything else raises.
//   2. A SECRET-class key NEVER produces a config_audit_log row (config-edit-taxonomy rule 2) and is NEVER
//      stored in config_values (schema.md L716) — appendAudit rejects a SECRET key.
//   3. secret_manifest exposes presence + last_rotated ONLY — never a value (NFR-SEC.003); the port has no
//      method that returns a secret value because none exists to return.
//   4. Retention never prunes a row inside the audit/compliance floor and logs every run (AC-7.LOG.008.2).
//   5. Export is ALL-OR-FAIL: it returns every matching row in range+scope, or throws — never a silent
//      partial file (AC-7.LOG.008.1); and it is gated by PERM-compliance.download_records.

import { configKeyGroup, callerCanReadKey } from './keygroup.ts';
import { isSecretKey, redactCredentialMaterial, containsCredentialMaterial, REDACTED } from './redaction.ts';

// ── config_values (schema.md §12) ───────────────────────────────────────────────
export interface ConfigValueRow {
  key: string;
  value: unknown; // jsonb
  updated_at: string;
  updated_by: string | null; // → profiles(id)
}

// ── secret_manifest (schema.md §12) — presence + last_rotated ONLY, never a value ─
export interface SecretManifestRow {
  key: string; // env-var name (the 11 platform secrets)
  present: boolean; // required-missing blocks boot
  last_rotated: string | null; // deploy-hook populated (OD-102); null renders "Unknown"
}
/** What a read path (surface/API) is allowed to return for a secret — presence + last-rotated ONLY. */
export interface SecretPresence {
  key: string;
  present: boolean;
  last_rotated: string | null; // caller renders null as "Unknown"
}

// ── config_audit_log (schema.md §8) — the third audit sink ───────────────────────
export interface ConfigAuditRow {
  id: string;
  key: string;
  old_value: unknown | null; // null on first-ever write
  new_value: unknown; // not null
  actor_id: string | null; // → profiles(id); redaction-tombstone target on erasure
  redacted_at: string | null; // one-way redaction-tombstone target
  changed_at: string;
}
/** A new audit append (the config-admin write path, ISSUE-086, calls this on Save). */
export type NewConfigAudit = {
  key: string;
  old_value: unknown | null;
  new_value: unknown;
  actor_id: string | null;
};

export interface ExportRequest {
  from: string; // inclusive ISO
  to: string; // inclusive ISO
  /** the caller's held PERM-config.* nodes — the key-prefix read scope */
  callerConfigPerms: readonly string[];
  /** the caller's held PERM-* nodes for the download gate (must include PERM-compliance.download_records) */
  callerPerms: readonly string[];
}

export interface RetentionResult {
  pruned: number;
  floorProtected: number; // rows inside the floor window that were skipped
  window_applied_years: number;
  ran_at: string;
}

export const DOWNLOAD_RECORDS_PERM = 'PERM-compliance.download_records' as const;

// The port. Sync in the fake, modelled async for the DB adapter.
export interface ConfigStore {
  // ── config_values (RLS-scoped reads; writes are under the postgres owner (RLS-bypass) / ISSUE-086) ──
  /** Read a single config value IFF the caller holds the owning PERM-config.* node (key-prefix RLS). */
  readConfigValue(key: string, callerConfigPerms: readonly string[]): Promise<ConfigValueRow | null>;
  /** postgres-owner (RLS-bypass) upsert (the ISSUE-086 write path calls this AFTER validate; RLS-bypass). */
  putConfigValue(key: string, value: unknown, updatedBy: string | null, now: number): Promise<ConfigValueRow>;

  // ── secret_manifest — presence + last_rotated only ──
  /** The boot gate: the env-var names of REQUIRED secrets whose `present` is false (empty = boot OK). */
  requiredMissingSecrets(required: readonly string[]): Promise<string[]>;
  /** The read path — presence + last-rotated ONLY; there is deliberately no value in the shape. */
  readSecretPresence(key: string): Promise<SecretPresence | null>;
  /** Deploy-hook / provisioning upsert of a presence row (never a value). */
  putSecretPresence(row: SecretManifestRow): Promise<SecretManifestRow>;

  // ── config_audit_log — the append-only sink ──
  /** Append an audit row on Save. REJECTS a SECRET key (AC-7.LOG.008.5) + redacts payloads (NFR-SEC.003). */
  appendAudit(row: NewConfigAudit, now: number): Promise<ConfigAuditRow>;
  /** Key-prefix-scoped read of the sink (caller's PERM-config.* nodes; ops-grade view). */
  readAudit(from: string, to: string, callerConfigPerms: readonly string[]): Promise<ConfigAuditRow[]>;
  /** ALL-OR-FAIL export over range + key-prefix scope, gated by PERM-compliance.download_records. */
  exportAudit(req: ExportRequest): Promise<ConfigAuditRow[]>;
  /** Privileged retention prune: never removes a floor-window row; logs the run (AC-7.LOG.008.2). */
  runRetention(floorYears: number, now: number): Promise<RetentionResult>;
  /** Redaction-tombstone on erasure: scrub actor_id attribution, retain key/old/new/changed_at + row. */
  redactActor(actorId: string, now: number): Promise<number>;
}

// The two forbidden mutations, surfaced as the exact messages the DB trigger raises, so a test can assert
// the same failure the live silo produces. Post-OD-180, the DELETE message names the retention-prune GUC
// (0005_retention_prune_whitelist.sql) — a DELETE is allowed ONLY inside a transaction that set
// app.retention_prune='on'; every other DELETE is still rejected exactly as before.
export const ERR_DELETE_FORBIDDEN =
  'audit sink config_audit_log: DELETE forbidden (append-only; retention prune must set app.retention_prune)';
export const ERR_UPDATE_FORBIDDEN =
  'audit sink config_audit_log: in-place UPDATE forbidden (append-only / tamper-evident)';

// ───────────────────────────────────────────────────────────────────────────────
// In-memory fake — the reference model. Deterministic: a logical `now` (epoch seconds) is supplied by
// the caller; no Date.now()/random (house discipline). A per-row content hash gives tamper-evidence: any
// unsanctioned mutation changes the hash, which the integrity check detects (the app-level analog of the
// DB append-only trigger, exercised in the tests).
// ───────────────────────────────────────────────────────────────────────────────
function contentHash(r: Pick<ConfigAuditRow, 'key' | 'old_value' | 'new_value' | 'changed_at'>): string {
  // A stable, order-independent hash of the immutable audit content (NOT actor_id/redacted_at, which the
  // sanctioned redaction-tombstone legitimately changes). djb2 over the canonical JSON — deterministic.
  const canon = JSON.stringify([r.key, r.old_value ?? null, r.new_value, r.changed_at]);
  let h = 5381;
  for (let i = 0; i < canon.length; i++) h = ((h << 5) + h + canon.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

export class InMemoryConfigStore implements ConfigStore {
  private seq = 0;
  readonly configValues = new Map<string, ConfigValueRow>();
  readonly secretManifest = new Map<string, SecretManifestRow>();
  readonly auditLog: ConfigAuditRow[] = [];
  // Tamper-evidence ledger: id → hash of the immutable content at append time.
  private readonly integrity = new Map<string, string>();
  // Every retention run is itself logged (AC-7.LOG.008.2 — pruning is never silent).
  readonly retentionRuns: RetentionResult[] = [];

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(4, '0')}`;
  }
  private iso(now: number): string {
    return new Date(now * 1000).toISOString();
  }

  // ── config_values ──
  async readConfigValue(key: string, callerConfigPerms: readonly string[]): Promise<ConfigValueRow | null> {
    if (!callerCanReadKey(key, callerConfigPerms)) return null; // key-prefix RLS (app mirror of 0003)
    return this.configValues.get(key) ?? null;
  }

  async putConfigValue(key: string, value: unknown, updatedBy: string | null, now: number): Promise<ConfigValueRow> {
    if (isSecretKey(key)) {
      // SECRET keys never live in config_values (schema.md L716) — reject, fail-closed (#2).
      throw new Error(`config_values: SECRET-class key '${key}' cannot be stored here (secret_manifest presence only)`);
    }
    const row: ConfigValueRow = { key, value, updated_at: this.iso(now), updated_by: updatedBy };
    this.configValues.set(key, row);
    return row;
  }

  // ── secret_manifest (presence only) ──
  async requiredMissingSecrets(required: readonly string[]): Promise<string[]> {
    // required-missing = a required env var whose presence row is absent OR present=false → blocks boot.
    return required.filter((k) => {
      const row = this.secretManifest.get(k);
      return !row || !row.present;
    });
  }

  async readSecretPresence(key: string): Promise<SecretPresence | null> {
    const row = this.secretManifest.get(key);
    if (!row) return null;
    // Only presence + last_rotated cross the boundary — NEVER a value (there is none to return).
    return { key: row.key, present: row.present, last_rotated: row.last_rotated };
  }

  async putSecretPresence(row: SecretManifestRow): Promise<SecretManifestRow> {
    const clean: SecretManifestRow = { key: row.key, present: row.present, last_rotated: row.last_rotated };
    this.secretManifest.set(row.key, clean);
    return clean;
  }

  // ── config_audit_log ──
  async appendAudit(row: NewConfigAudit, now: number): Promise<ConfigAuditRow> {
    if (isSecretKey(row.key)) {
      // AC-7.LOG.008.5: a SECRET-class change never produces an audit row (it is never UI-editable).
      throw new Error(
        `config_audit_log: SECRET-class key '${row.key}' can never produce an audit row (config-edit-taxonomy rule 2 / AC-7.LOG.008.5)`,
      );
    }
    // NFR-SEC.003.2 / FR-7.LOG.005: redact any credential material in old/new BEFORE the row is written.
    const old_value = row.old_value == null ? null : redactCredentialMaterial(row.old_value);
    const new_value = redactCredentialMaterial(row.new_value);
    const full: ConfigAuditRow = {
      id: this.nextId('ca'),
      key: row.key,
      old_value,
      new_value,
      actor_id: row.actor_id,
      redacted_at: null,
      changed_at: this.iso(now),
    };
    this.auditLog.push(full);
    this.integrity.set(full.id, contentHash(full));
    return full;
  }

  async readAudit(from: string, to: string, callerConfigPerms: readonly string[]): Promise<ConfigAuditRow[]> {
    return this.auditLog.filter(
      (r) =>
        r.changed_at >= from &&
        r.changed_at <= to &&
        callerConfigPerms.includes(configKeyGroup(r.key)),
    );
  }

  async exportAudit(req: ExportRequest): Promise<ConfigAuditRow[]> {
    // Gate: PERM-compliance.download_records (AC-7.LOG.008.1 — export is a download-authorised action).
    if (!req.callerPerms.includes(DOWNLOAD_RECORDS_PERM)) {
      throw new Error(
        `config_audit_log export denied: caller lacks ${DOWNLOAD_RECORDS_PERM} (AC-7.LOG.008.1)`,
      );
    }
    // All-or-fail: assemble the full result; if ANY row in range+scope fails its integrity check, the
    // whole export ABORTS to an error — never a silent partial file (#3).
    const rows = this.auditLog.filter(
      (r) =>
        r.changed_at >= req.from &&
        r.changed_at <= req.to &&
        req.callerConfigPerms.includes(configKeyGroup(r.key)),
    );
    for (const r of rows) {
      if (!this.verifyIntegrity(r)) {
        throw new Error(
          `config_audit_log export ABORTED: row ${r.id} failed the tamper-evidence check — refusing a partial/compromised export (all-or-nothing, AC-7.LOG.008.1/.3)`,
        );
      }
    }
    return rows;
  }

  // OD-180 / 0005: the DB immutability trigger rejects EVERY delete on this sink UNLESS the transaction set
  // app.retention_prune='on'. The reference model mirrors that whitelist: this flag is the app-level analog
  // of the transaction-local GUC — it is set ONLY for the duration of runRetention() and is the SOLE
  // sanctioned delete path. `deleteRowForRetention` rejects if the flag is not set (a non-retention delete
  // is conceptually forbidden, exactly as the DB trigger forbids it — #2/#3).
  private retentionPruneActive = false;

  /** The ONLY sanctioned delete path (OD-180). Rejects unless invoked inside a retention run — the app
   * mirror of the 0005 `app.retention_prune='on'` transaction-local whitelist. */
  private deleteRowForRetention(id: string): void {
    if (!this.retentionPruneActive) {
      // mirrors the 0005 trigger: DELETE forbidden unless app.retention_prune='on'
      throw new Error(ERR_DELETE_FORBIDDEN);
    }
    const idx = this.auditLog.findIndex((r) => r.id === id);
    if (idx >= 0) this.auditLog.splice(idx, 1);
    this.integrity.delete(id);
  }

  async runRetention(floorYears: number, now: number): Promise<RetentionResult> {
    const floorMs = floorYears * 365 * 24 * 3600 * 1000;
    const cutoff = now * 1000 - floorMs; // rows older than the floor MAY be pruned; inside it never.
    let pruned = 0;
    let floorProtected = 0;
    const toPrune: string[] = [];
    for (const r of this.auditLog) {
      const age = Date.parse(r.changed_at);
      if (age >= cutoff) {
        floorProtected += 1; // inside the floor window — NEVER pruned (AC-7.LOG.008.2)
      } else {
        toPrune.push(r.id); // past the floor — eligible; the JOB (not the trigger) enforces the floor.
      }
    }
    // Open the transaction-local whitelist (OD-180), delete ONLY past-floor rows, then close it. The flag
    // never outlives this call — mirroring `set local` auto-reset at COMMIT (never leaks past the job).
    this.retentionPruneActive = true;
    try {
      for (const id of toPrune) {
        this.deleteRowForRetention(id);
        pruned += 1;
      }
    } finally {
      this.retentionPruneActive = false;
    }
    const result: RetentionResult = {
      pruned,
      floorProtected,
      window_applied_years: floorYears,
      ran_at: this.iso(now),
    };
    this.retentionRuns.push(result); // the run is itself logged — pruning is never silent.
    return result;
  }

  /** Test/contract hook: attempt a delete OUTSIDE a retention run. Mirrors the DB trigger rejecting any
   * non-retention DELETE (OD-180) — it must throw ERR_DELETE_FORBIDDEN. There is deliberately no public
   * delete method on the port; this exists so the reference model can PROVE the whitelist contract. */
  attemptNonRetentionDelete(id: string): void {
    this.deleteRowForRetention(id); // retentionPruneActive is false here → throws (the point)
  }

  async redactActor(actorId: string, now: number): Promise<number> {
    // The sanctioned mutation (NFR-CMP.007): scrub actor_id attribution + set redacted_at, while KEEPING
    // key/old_value/new_value/changed_at. The content hash is over the retained fields ONLY, so the
    // integrity check still passes afterwards (the tombstone is not tampering — AC-7.LOG.008.4).
    let count = 0;
    for (const r of this.auditLog) {
      if (r.actor_id === actorId) {
        r.actor_id = null;
        r.redacted_at = this.iso(now);
        count += 1;
      }
    }
    return count;
  }

  // ── tamper-evidence helpers (app-level analog of the DB append-only trigger) ──
  /** Recompute the content hash and compare to the append-time hash. A mismatch = a post-hoc edit. */
  verifyIntegrity(r: ConfigAuditRow): boolean {
    const expected = this.integrity.get(r.id);
    if (expected === undefined) return false; // unknown row — treat as failed
    return contentHash(r) === expected;
  }

  /** True if EVERY row still passes its integrity check (the sink-wide tamper-evidence assertion). */
  integrityHolds(): boolean {
    return this.auditLog.every((r) => this.verifyIntegrity(r));
  }

  /** No row (or nested payload) carries credential material — the AC-7.LOG.008.5 / NFR-SEC.003.2 audit. */
  noCredentialMaterial(): boolean {
    return this.auditLog.every(
      (r) => !containsCredentialMaterial(r.old_value) && !containsCredentialMaterial(r.new_value),
    );
  }

  // Test-only: simulate a tamper (an out-of-band in-place edit the DB trigger would have rejected) so the
  // integrity check can be shown to CATCH it. Does NOT update the integrity ledger (that is the point).
  _tamperInPlace(id: string, mutate: (r: ConfigAuditRow) => void): void {
    const r = this.auditLog.find((x) => x.id === id);
    if (!r) throw new Error(`no such row ${id}`);
    mutate(r);
  }
}

export { REDACTED };
