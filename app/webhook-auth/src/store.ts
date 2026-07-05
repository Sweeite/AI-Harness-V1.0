// ISSUE-017 §8 step 1 + the write sinks — the WebhookStore PORT. Every live side effect of webhook
// authentication (reading versioned secrets, the replay cache, guardrail_log/event_log/audit writes,
// the per-source failure + accept-rate counters, the Super-Admin alert + source throttle) goes
// through here, so the verification pipeline stays unit-testable with NO live DB (the house port+fake
// pattern — cf. app/canary/src/port.ts, app/silo). The in-memory fake below is the test double and
// the reference model; the live pg/Supabase adapter (supabase-store.ts) is the thin translation whose
// per-connector confirmation is owed at onboarding (OD-172).
//
// Faithful to the DDL in schema.md §1 (webhook_secrets, webhook_replay_cache), §7 (guardrail_log),
// §8 (event_log). Invariants enforced in the fake exactly as the DB check/trigger would:
//   1. guardrail_log + event_log + audit are APPEND-ONLY (no update/delete).
//   2. webhook_replay_cache PK is (connector_type, event_id) — a duplicate insert IS a replay.
//   3. webhook_secrets.secret_value is service_role-only + Vault-decrypted on read (the port models
//      the decrypted read; encryption-at-rest is the adapter's job).

import type { SecretKind } from './config.js';

export type Connector = 'ghl' | 'google' | 'slack';

// ── webhook_secrets (versioned; dual-accept rotation FR-0.WHK.007) ─────────────────
export interface WebhookSecretRow {
  id: string;
  connector: Connector;
  secret_kind: SecretKind;
  secret_value: string; // decrypted value as returned to the verifier (Vault-decrypted; never logged)
  secret_version: number;
  active: boolean;
  rotated_at: string | null;
  created_at: string;
}

/** An active secret version handed to a verifier. During a rotation window MORE THAN ONE is active. */
export interface ActiveSecret {
  version: number;
  value: string;
}

// ── guardrail_log (append-only; `prompt_injection` on every failed verify — ADR-007) ─
// Values mirror the schema.md L105 `guardrail_type` enum exactly (this path only ever writes
// 'prompt_injection'); listed in full so a future writer of another type has the correct spelling.
export type GuardrailType = 'hard_limit' | 'approval_gate' | 'anomaly' | 'rate_limit' | 'prompt_injection';
export type GuardrailStatus = 'pending' | 'approved' | 'rejected' | 'modified';
export interface GuardrailLogRow {
  id: string;
  task_id: string | null;
  guardrail_type: GuardrailType;
  description: string;
  action_blocked: boolean;
  status: GuardrailStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  escalated_at: string | null;
  created_at: string;
}

// ── event_log (verified · replay-dropped · rate-throttled rows) ────────────────────
// event_type values are the webhook members of the schema.md L110 `event_type` enum, added via
// change-control OD-179: webhook_verified | webhook_replay_dropped | webhook_rate_throttled |
// webhook_failure_alert. entity_ids is uuid[] in the DDL — the live adapter drops non-UUID webhook
// event ids (they live in summary/payload); the in-memory fake keeps them for assertion convenience.
export interface EventLogRow {
  id: string;
  task_id: string | null;
  event_type: string;
  entity_ids: string[];
  summary: string;
  payload: unknown;
  created_at: string;
}

// ── audit (rotation) ───────────────────────────────────────────────────────────────
export interface AuditRow {
  id: string;
  action: string; // webhook_secret_rotated | webhook_secret_retired
  connector: Connector;
  secret_kind: SecretKind;
  detail: string;
  created_at: string;
}

/** The Super-Admin alert emitted past the failure threshold (FR-0.WHK.005 / AC-0.WHK.005.2). */
export interface WebhookAlert {
  source_id: string;
  connector: Connector;
  failures_this_hour: number;
  reason: string;
}

// The port. All methods are sync in the fake but modelled async for the DB adapter.
export interface WebhookStore {
  /** All ACTIVE secret versions for (connector, kind) — the verifier tries each (dual-accept). */
  readActiveSecrets(connector: Connector, kind: SecretKind): Promise<ActiveSecret[]>;

  /** Provisioning-side (runbook, service_role): add a new secret version, active. FR-0.WHK.007. */
  addSecretVersion(connector: Connector, kind: SecretKind, value: string, now: number): Promise<WebhookSecretRow>;
  /** Provisioning-side: retire a secret version (active=false, rotated_at set). FR-0.WHK.007. */
  retireSecretVersion(connector: Connector, kind: SecretKind, version: number, now: number): Promise<void>;

  /** Replay dedup keyed (connector_type, event_id). Returns replay:true if already seen in-window. */
  recordOrDetectReplay(
    connector: Connector,
    eventId: string,
    sourceId: string,
    now: number,
    windowSeconds: number,
  ): Promise<{ replay: boolean }>;

  /** Bump + read the per-source verification-failure count within the trailing hour. */
  bumpFailure(sourceId: string, now: number): Promise<number>;
  /** Bump + read the per-source verified-accept count within the trailing minute. */
  bumpAccept(sourceId: string, now: number): Promise<number>;
  /** Is this source currently throttled (auto-throttle set on threshold breach)? */
  isThrottled(sourceId: string, now: number): Promise<boolean>;
  /** Auto-throttle a source for `seconds` (FR-0.WHK.005 alert path + FR-0.WHK.008 rate path). */
  throttleSource(sourceId: string, now: number, seconds: number): Promise<void>;

  logGuardrail(row: NewGuardrail): Promise<GuardrailLogRow>;
  logEvent(row: NewEvent): Promise<EventLogRow>;
  writeAudit(row: NewAudit): Promise<AuditRow>;
  /** Fired to all Super Admins past the failure threshold. */
  alertSuperAdmins(alert: WebhookAlert): Promise<void>;
}

export type NewGuardrail = Omit<
  GuardrailLogRow,
  'id' | 'created_at' | 'reviewed_by' | 'reviewed_at' | 'escalated_at'
> &
  Partial<Pick<GuardrailLogRow, 'escalated_at'>>;
export type NewEvent = Omit<EventLogRow, 'id' | 'created_at'>;
export type NewAudit = Omit<AuditRow, 'id' | 'created_at'>;

// ───────────────────────────────────────────────────────────────────────────────────
// In-memory fake — the test double AND the reference model. Deterministic: a logical `now`
// (epoch seconds) is supplied by the caller; no Date.now()/random (house discipline — testable,
// resumable). Time-windowed counters purge on read so the trailing-window semantics are exact.
// ───────────────────────────────────────────────────────────────────────────────────
export class InMemoryWebhookStore implements WebhookStore {
  private seq = 0;
  readonly secrets: WebhookSecretRow[] = [];
  readonly replayCache = new Map<string, { source_id: string; window_expires_at: number }>();
  readonly guardrailLog: GuardrailLogRow[] = [];
  readonly eventLog: EventLogRow[] = [];
  readonly audit: AuditRow[] = [];
  readonly alerts: WebhookAlert[] = [];
  private failures = new Map<string, number[]>(); // sourceId → failure timestamps (epoch s)
  private accepts = new Map<string, number[]>(); // sourceId → accept timestamps (epoch s)
  private throttledUntil = new Map<string, number>(); // sourceId → epoch s

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(4, '0')}`;
  }
  private stamp(): string {
    this.seq += 1;
    return `t+${String(this.seq).padStart(4, '0')}`;
  }

  // ── seeding (provisioning-side; not part of the hot path) ──
  seedSecret(row: Omit<WebhookSecretRow, 'id' | 'created_at'>): WebhookSecretRow {
    const full: WebhookSecretRow = { id: this.nextId('ws'), created_at: this.stamp(), ...row };
    this.secrets.push(full);
    return full;
  }

  async readActiveSecrets(connector: Connector, kind: SecretKind): Promise<ActiveSecret[]> {
    return this.secrets
      .filter((r) => r.connector === connector && r.secret_kind === kind && r.active)
      .sort((a, b) => b.secret_version - a.secret_version) // newest first
      .map((r) => ({ version: r.secret_version, value: r.secret_value }));
  }

  async addSecretVersion(connector: Connector, kind: SecretKind, value: string, now: number): Promise<WebhookSecretRow> {
    const versions = this.secrets.filter((r) => r.connector === connector && r.secret_kind === kind);
    const nextVersion = versions.reduce((m, r) => Math.max(m, r.secret_version), 0) + 1;
    return this.seedSecret({
      connector,
      secret_kind: kind,
      secret_value: value,
      secret_version: nextVersion,
      active: true,
      rotated_at: null,
    });
  }

  async retireSecretVersion(connector: Connector, kind: SecretKind, version: number, now: number): Promise<void> {
    const row = this.secrets.find(
      (r) => r.connector === connector && r.secret_kind === kind && r.secret_version === version,
    );
    if (!row) throw new Error(`cannot retire ${connector}/${kind} v${version}: no such secret row`);
    row.active = false;
    row.rotated_at = new Date(now * 1000).toISOString();
  }

  async recordOrDetectReplay(
    connector: Connector,
    eventId: string,
    sourceId: string,
    now: number,
    windowSeconds: number,
  ): Promise<{ replay: boolean }> {
    // Purge expired entries first (a seen-ID past its window is no longer a replay).
    for (const [k, v] of this.replayCache) if (v.window_expires_at <= now) this.replayCache.delete(k);
    const key = `${connector}::${eventId}`; // PK (connector_type, event_id)
    if (this.replayCache.has(key)) return { replay: true };
    this.replayCache.set(key, { source_id: sourceId, window_expires_at: now + windowSeconds });
    return { replay: false };
  }

  private windowed(map: Map<string, number[]>, sourceId: string, now: number, windowSeconds: number): number[] {
    const arr = (map.get(sourceId) ?? []).filter((t) => t > now - windowSeconds);
    map.set(sourceId, arr);
    return arr;
  }

  async bumpFailure(sourceId: string, now: number): Promise<number> {
    const arr = this.windowed(this.failures, sourceId, now, 3600); // trailing hour
    arr.push(now);
    return arr.length;
  }

  async bumpAccept(sourceId: string, now: number): Promise<number> {
    const arr = this.windowed(this.accepts, sourceId, now, 60); // trailing minute
    arr.push(now);
    return arr.length;
  }

  async isThrottled(sourceId: string, now: number): Promise<boolean> {
    const until = this.throttledUntil.get(sourceId);
    return until !== undefined && until > now;
  }

  async throttleSource(sourceId: string, now: number, seconds: number): Promise<void> {
    const cur = this.throttledUntil.get(sourceId) ?? 0;
    this.throttledUntil.set(sourceId, Math.max(cur, now + seconds));
  }

  async logGuardrail(row: NewGuardrail): Promise<GuardrailLogRow> {
    if (row.guardrail_type === 'hard_limit' && row.status === 'approved') {
      throw new Error('INVARIANT VIOLATION: a hard_limit guardrail_log row can never be approved (schema CHECK)');
    }
    const full: GuardrailLogRow = {
      id: this.nextId('gl'),
      created_at: this.stamp(),
      reviewed_by: null,
      reviewed_at: null,
      escalated_at: row.escalated_at ?? null,
      ...row,
    };
    this.guardrailLog.push(full);
    return full;
  }

  async logEvent(row: NewEvent): Promise<EventLogRow> {
    const full: EventLogRow = { id: this.nextId('ev'), created_at: this.stamp(), ...row };
    this.eventLog.push(full);
    return full;
  }

  async writeAudit(row: NewAudit): Promise<AuditRow> {
    const full: AuditRow = { id: this.nextId('au'), created_at: this.stamp(), ...row };
    this.audit.push(full);
    return full;
  }

  async alertSuperAdmins(alert: WebhookAlert): Promise<void> {
    this.alerts.push(alert);
  }
}
