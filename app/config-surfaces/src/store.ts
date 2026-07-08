// ISSUE-086 — the CONFIG-SURFACE store PORT + in-memory fake reference model (house port+fake pattern, cf.
// app/config-store store.ts, app/rls-enforcement store.ts). This is the READ/WRITE seam the two config
// surfaces use over the ISSUE-010 backbone tables (config_values / secret_manifest / config_audit_log,
// schema.md §12/§8). ISSUE-010 owns the tables + the append-only trigger + key-prefix RLS + the export
// contract; THIS package writes into and renders them.
//
// Invariants the fake enforces EXACTLY as the DB layer would, so a test against the fake proves the contract
// the live silo upholds:
//   1. SECRET / hard-limit keys NEVER reach putConfigValue or appendAudit (config-edit-taxonomy rule 2;
//      AC-7.LOG.008.5 / AC-7.LOG.005.1) — they throw, fail-closed (#2). NOTE: this rejection is APP-LAYER
//      (the isSecretKey/isHardLimitKey guards in both the fake and the live adapter), NOT a DB CHECK/trigger.
//      A raw-SQL / service_role write path that bypasses this adapter has NO database backstop today; a
//      config_values/config_audit_log CHECK constraint rejecting SECRET-class keys is recommended as
//      defense-in-depth (see the migrationsNeeded note in the ISSUE-086 fix report).
//   2. Credential material in old/new is redacted BEFORE the audit row is written (NFR-SEC.003 / FR-7.LOG.005).
//   3. config_audit_log is append-only + tamper-evident — a per-row content hash catches any post-hoc edit
//      (AC-7.LOG.008.3); the ONLY sanctioned mutation is the redaction-tombstone (AC-7.LOG.008.4).
//   4. exportAudit is ALL-OR-FAIL, gated by PERM-compliance.download_records (AC-7.LOG.008.1).
//   5. Reads are key-prefix-scoped to the caller's PERM-config.* nodes (ADR-006 / surface-01 RLS guidance).

import { configKeyGroup, isHardLimitKey } from './keys.ts';
import { DOWNLOAD_RECORDS_PERM } from './sections.ts';
import { isSecretKey, redactCredentialMaterial, containsCredentialMaterial } from './redaction.ts';

// ── config_values (schema.md §12) ────────────────────────────────────────────────
export interface ConfigValueRow {
  key: string;
  value: unknown; // jsonb
  updated_at: string;
  updated_by: string | null;
}

// ── secret_manifest (schema.md §12) — presence + last_rotated ONLY, never a value ─
export interface SecretPresence {
  key: string;
  present: boolean;
  last_rotated: string | null; // caller renders null as "Unknown"
}

// ── config_audit_log (schema.md §8) ──────────────────────────────────────────────
export interface ConfigAuditRow {
  id: string;
  key: string;
  old_value: unknown | null; // null on first-ever write
  new_value: unknown;
  actor_id: string | null; // → profiles(id); redaction-tombstone target on erasure
  redacted_at: string | null;
  changed_at: string;
}
/** A new audit append (the Save path calls this on write). */
export type NewConfigAudit = {
  key: string;
  old_value: unknown | null;
  new_value: unknown;
  actor_id: string | null;
};

/** One dirtied row to persist in an atomic Save batch (config_values upsert + its paired audit row). */
export interface BatchWriteRow {
  key: string;
  value: unknown; // the value to persist into config_values (== newValue)
  old_value: unknown | null;
  new_value: unknown;
}

/** The outcome of an atomic Save batch. */
export interface BatchWriteResult {
  writtenKeys: string[];
  auditIds: string[];
}

/** An actor as resolved for the audit view (surface-01b Section A/B). */
export interface ActorInfo {
  id: string;
  name: string;
  role: string;
}

/** The audit-timeline filter bar (surface-01b Section A). */
export interface AuditFilter {
  from: string; // inclusive ISO
  to: string; // inclusive ISO
  section?: string; // a PERM-config.* node (section scope)
  key?: string;
  actorId?: string;
}

export interface ExportRequest {
  filter: AuditFilter;
  /** the caller's held PERM-config.* nodes — the key-prefix read scope */
  callerConfigPerms: readonly string[];
  /** all held PERM-* nodes — must include PERM-compliance.download_records */
  callerPerms: readonly string[];
}

/** The two always-loud banner conditions pinned on BOTH surfaces (FR-7.ALR.001 / FR-7.RTP.001). */
export interface BannerSignals {
  alertEngineStalled: boolean; // AC-7.ALR.008.2
  alertDeliveryMisconfigured: boolean; // AC-7.ALR.009.1
}

// The port. Sync-shaped in the fake, async for the DB adapter.
export interface ConfigSurfaceStore {
  // ── render path (config_values / secret_manifest) ──
  /** Load every config_values row for a section's keys, key-prefix-scoped to the caller. */
  loadSection(sectionKeys: readonly string[], callerConfigPerms: readonly string[]): Promise<Map<string, ConfigValueRow>>;
  /** Read a single config value (RLS key-prefix scoped). */
  readConfigValue(key: string, callerConfigPerms: readonly string[]): Promise<ConfigValueRow | null>;
  /** Presence + last_rotated for the #secrets view — NEVER a value. */
  readSecretPresence(key: string): Promise<SecretPresence | null>;
  loadSecretManifest(manifestKeys: readonly string[]): Promise<Map<string, SecretPresence>>;

  // ── write path (Save) ──
  /** Upsert a config value AFTER validation (Save calls this; rejects SECRET/hard-limit keys, fail-closed). */
  putConfigValue(key: string, value: unknown, updatedBy: string | null, now: number): Promise<ConfigValueRow>;
  /** Append the who/when/old→new audit row. REJECTS SECRET/hard-limit keys + redacts credential material. */
  appendAudit(row: NewConfigAudit, now: number): Promise<ConfigAuditRow>;
  /**
   * Persist a WHOLE Save batch ATOMICALLY: for every row, putConfigValue THEN appendAudit, all inside ONE
   * transaction. Either every row commits (each config_values change paired with its audit row) or NONE do —
   * a mid-batch failure (a rejected key, an FK violation, a dropped connection) never leaves a section
   * half-saved (#1) and never leaves a config change with no audit row (#3). SECRET / hard-limit keys are
   * rejected fail-closed before anything is committed (#2). This is the ONLY sanctioned Save write path.
   */
  writeBatch(rows: readonly BatchWriteRow[], actorId: string | null, now: number): Promise<BatchWriteResult>;

  // ── audit render / export path (config_audit_log) ──
  /** Key-prefix-scoped, filtered, newest-first timeline read (surface-01b Section A). */
  readAudit(filter: AuditFilter, callerConfigPerms: readonly string[]): Promise<ConfigAuditRow[]>;
  /** ALL-OR-FAIL export gated by PERM-compliance.download_records (AC-7.LOG.008.1). */
  exportAudit(req: ExportRequest): Promise<ConfigAuditRow[]>;
  /** Resolve an actor_id → name+role; null actor (or none) means the caller renders "redacted (erased user)". */
  resolveActor(actorId: string | null): Promise<ActorInfo | null>;
  /** Redaction-tombstone on erasure: scrub actor_id, set redacted_at, retain the change record. */
  redactActor(actorId: string, now: number): Promise<number>;
  /** Tamper-evidence: true iff the row is unmodified since append (AC-7.LOG.008.3). */
  verifyIntegrity(row: ConfigAuditRow): Promise<boolean>;

  // ── loud banners ──
  /** The two always-loud banner conditions (AC-7.ALR.008.2 / AC-7.ALR.009.1). */
  bannerSignals(): Promise<BannerSignals>;
}

// ── The forbidden-mutation messages the APP-LAYER guards raise (fake + live adapter alike). These are NOT
//    raised by a DB trigger today — the guarantee is code-only until a DB CHECK backstop is added (see the
//    header note + the ISSUE-086 migrationsNeeded recommendation). ──
export const ERR_SECRET_IN_VALUES = (key: string) =>
  `config_values: SECRET-class key '${key}' cannot be stored here (secret_manifest presence only)`;
export const ERR_SECRET_IN_AUDIT = (key: string) =>
  `config_audit_log: SECRET-class key '${key}' can never produce an audit row (config-edit-taxonomy rule 2 / AC-7.LOG.008.5)`;
export const ERR_HARD_LIMIT_WRITE = (key: string) =>
  `config write rejected: '${key}' is a hard-limit prohibition (ADR-007/OD-047/OD-060) — never editable (#2)`;

// ───────────────────────────────────────────────────────────────────────────────
// In-memory fake — the reference model. Deterministic: a logical `now` (epoch seconds) is supplied by the
// caller (no Date.now()/random). A per-row content hash gives tamper-evidence (app-level analog of the DB
// append-only trigger).
// ───────────────────────────────────────────────────────────────────────────────
function contentHash(r: Pick<ConfigAuditRow, 'key' | 'old_value' | 'new_value' | 'changed_at'>): string {
  const canon = JSON.stringify([r.key, r.old_value ?? null, r.new_value, r.changed_at]);
  let h = 5381;
  for (let i = 0; i < canon.length; i++) h = ((h << 5) + h + canon.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

export class InMemoryConfigSurfaceStore implements ConfigSurfaceStore {
  private seq = 0;
  readonly configValues = new Map<string, ConfigValueRow>();
  readonly secretManifest = new Map<string, SecretPresence>();
  readonly auditLog: ConfigAuditRow[] = [];
  readonly actors = new Map<string, ActorInfo>();
  private readonly integrity = new Map<string, string>();
  private banners: BannerSignals = { alertEngineStalled: false, alertDeliveryMisconfigured: false };

  private iso(now: number): string {
    return new Date(now * 1000).toISOString();
  }

  // ── render path ──
  async loadSection(sectionKeys: readonly string[], callerConfigPerms: readonly string[]): Promise<Map<string, ConfigValueRow>> {
    const out = new Map<string, ConfigValueRow>();
    for (const key of sectionKeys) {
      if (!callerConfigPerms.includes(configKeyGroup(key))) continue; // key-prefix RLS
      const row = this.configValues.get(key);
      if (row) out.set(key, row);
    }
    return out;
  }

  async readConfigValue(key: string, callerConfigPerms: readonly string[]): Promise<ConfigValueRow | null> {
    if (!callerConfigPerms.includes(configKeyGroup(key))) return null;
    return this.configValues.get(key) ?? null;
  }

  async readSecretPresence(key: string): Promise<SecretPresence | null> {
    const row = this.secretManifest.get(key);
    if (!row) return null;
    return { key: row.key, present: row.present, last_rotated: row.last_rotated }; // presence only, never a value
  }

  async loadSecretManifest(manifestKeys: readonly string[]): Promise<Map<string, SecretPresence>> {
    const out = new Map<string, SecretPresence>();
    for (const key of manifestKeys) {
      const row = this.secretManifest.get(key);
      if (row) out.set(key, { key: row.key, present: row.present, last_rotated: row.last_rotated });
    }
    return out;
  }

  // ── write path ──
  async putConfigValue(key: string, value: unknown, updatedBy: string | null, now: number): Promise<ConfigValueRow> {
    if (isSecretKey(key)) throw new Error(ERR_SECRET_IN_VALUES(key));
    if (isHardLimitKey(key)) throw new Error(ERR_HARD_LIMIT_WRITE(key));
    const row: ConfigValueRow = { key, value, updated_at: this.iso(now), updated_by: updatedBy };
    this.configValues.set(key, row);
    return row;
  }

  async appendAudit(row: NewConfigAudit, now: number): Promise<ConfigAuditRow> {
    if (isSecretKey(row.key)) throw new Error(ERR_SECRET_IN_AUDIT(row.key));
    if (isHardLimitKey(row.key)) throw new Error(ERR_HARD_LIMIT_WRITE(row.key));
    // Defence-in-depth: redact any credential material before the row is written (NFR-SEC.003 / FR-7.LOG.005).
    const old_value = row.old_value == null ? null : redactCredentialMaterial(row.old_value);
    const new_value = redactCredentialMaterial(row.new_value);
    this.seq += 1;
    const full: ConfigAuditRow = {
      id: `ca-${String(this.seq).padStart(4, '0')}`,
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

  async writeBatch(rows: readonly BatchWriteRow[], actorId: string | null, now: number): Promise<BatchWriteResult> {
    // Model a DB transaction: snapshot every mutable table before the batch and restore it if ANY row throws,
    // so the fake exhibits the same all-or-nothing the live adapter's BEGIN/COMMIT/ROLLBACK gives (#1/#3).
    const cvSnapshot = new Map(this.configValues);
    const auditLen = this.auditLog.length;
    const seqSnapshot = this.seq;
    const integritySnapshot = new Map(this.integrity);
    try {
      const writtenKeys: string[] = [];
      const auditIds: string[] = [];
      for (const r of rows) {
        await this.putConfigValue(r.key, r.value, actorId, now);
        const audit = await this.appendAudit({ key: r.key, old_value: r.old_value, new_value: r.new_value, actor_id: actorId }, now);
        writtenKeys.push(r.key);
        auditIds.push(audit.id);
      }
      return { writtenKeys, auditIds };
    } catch (err) {
      // ROLLBACK — restore every table to its pre-batch state. No partial write survives a mid-batch failure.
      this.configValues.clear();
      for (const [k, v] of cvSnapshot) this.configValues.set(k, v);
      this.auditLog.length = auditLen;
      this.seq = seqSnapshot;
      this.integrity.clear();
      for (const [k, v] of integritySnapshot) this.integrity.set(k, v);
      throw err;
    }
  }

  // ── audit render / export ──
  async readAudit(filter: AuditFilter, callerConfigPerms: readonly string[]): Promise<ConfigAuditRow[]> {
    const rows = this.auditLog.filter((r) => {
      if (r.changed_at < filter.from || r.changed_at > filter.to) return false;
      if (!callerConfigPerms.includes(configKeyGroup(r.key))) return false; // #2 key-prefix scope
      if (filter.section && configKeyGroup(r.key) !== filter.section) return false;
      if (filter.key && r.key !== filter.key) return false;
      if (filter.actorId && r.actor_id !== filter.actorId) return false;
      return true;
    });
    // Newest-first (surface-01b Section A).
    return rows.sort((a, b) => (a.changed_at < b.changed_at ? 1 : a.changed_at > b.changed_at ? -1 : b.id.localeCompare(a.id)));
  }

  async exportAudit(req: ExportRequest): Promise<ConfigAuditRow[]> {
    if (!req.callerPerms.includes(DOWNLOAD_RECORDS_PERM)) {
      throw new Error(`config_audit_log export denied: caller lacks ${DOWNLOAD_RECORDS_PERM} (AC-7.LOG.008.1)`);
    }
    const rows = await this.readAudit(req.filter, req.callerConfigPerms);
    // All-or-fail: if ANY row fails its integrity check the WHOLE export aborts — never a silent partial file.
    for (const r of rows) {
      if (!(await this.verifyIntegrity(r))) {
        throw new Error(
          `config_audit_log export ABORTED: row ${r.id} failed the tamper-evidence check — refusing a partial/compromised export (all-or-nothing, AC-7.LOG.008.1/.3)`,
        );
      }
    }
    return rows;
  }

  async resolveActor(actorId: string | null): Promise<ActorInfo | null> {
    if (actorId == null) return null; // tombstoned / unattributed → caller renders "redacted (erased user)"
    return this.actors.get(actorId) ?? null;
  }

  async redactActor(actorId: string, now: number): Promise<number> {
    // Sanctioned tombstone (AC-7.LOG.008.4): scrub actor_id + set redacted_at; keep key/old/new/changed_at.
    // The content hash is over the retained fields only, so integrity still holds afterwards.
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

  async verifyIntegrity(row: ConfigAuditRow): Promise<boolean> {
    const expected = this.integrity.get(row.id);
    if (expected === undefined) return false;
    return contentHash(row) === expected;
  }

  async bannerSignals(): Promise<BannerSignals> {
    return { ...this.banners };
  }

  // ── test / seed helpers ──
  seedActor(a: ActorInfo): void {
    this.actors.set(a.id, a);
  }
  setBanners(b: Partial<BannerSignals>): void {
    this.banners = { ...this.banners, ...b };
  }
  /** No row carries credential material (AC-7.LOG.008.5 / NFR-SEC.003.2 audit). */
  noCredentialMaterial(): boolean {
    return this.auditLog.every((r) => !containsCredentialMaterial(r.old_value) && !containsCredentialMaterial(r.new_value));
  }
  /** Test-only: simulate an out-of-band in-place edit the DB trigger would reject, so verifyIntegrity CATCHES it. */
  _tamperInPlace(id: string, mutate: (r: ConfigAuditRow) => void): void {
    const r = this.auditLog.find((x) => x.id === id);
    if (!r) throw new Error(`no such row ${id}`);
    mutate(r);
  }
}
