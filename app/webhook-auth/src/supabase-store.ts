// ISSUE-017 — the LIVE WebhookStore adapter (pg, against the client-owned silo Supabase). It is the
// only module that imports `pg`. It implements the same port as InMemoryWebhookStore against the real
// DDL (schema.md §1 webhook_secrets / webhook_replay_cache, §7 guardrail_log, §8 event_log, audit).
//
// ⚠️ NOT YET RUN LIVE. Per OD-172 the empirical per-connector webhook verification against real vendor
// key material is re-gated to ONBOARDING (owed here + on ISSUE-039/040/041). This adapter is authored
// to the DDL so the seam is real and typechecks; the InMemoryWebhookStore is the proven reference
// model. Do NOT claim these code paths verified until an onboarding live run records evidence.
//
// Design notes tied to the three non-negotiables:
//   - secret_value is Vault-encrypted at rest, service_role-only; this reads the decrypted value and
//     MUST NOT log it (#2). The read filters active=true and returns every version (dual-accept).
//   - replay insert uses ON CONFLICT (connector_type, event_id) DO NOTHING → a 0-row result IS a
//     replay (the PK does the dedup atomically, closing the check-then-act race — #1).
//   - the per-source failure/accept counters + throttle are in-process here. The current deployment
//     model is a single Railway service (one instance), so in-process is correct now; a multi-instance
//     rollout owes a shared counter/throttle store (Redis or a table) — tracked, not silently assumed (#3).

import pg from 'pg';
import type { SecretKind } from './config.js';
import type {
  ActiveSecret,
  AuditRow,
  Connector,
  EventLogRow,
  GuardrailLogRow,
  NewAudit,
  NewEvent,
  NewGuardrail,
  WebhookAlert,
  WebhookSecretRow,
  WebhookStore,
} from './store.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SupabaseWebhookStore implements WebhookStore {
  private pool: pg.Pool;
  // In-process counters/throttle — see the header note on the single-instance deployment model.
  private failures = new Map<string, number[]>();
  private accepts = new Map<string, number[]>();
  private throttledUntil = new Map<string, number>();

  constructor(connectionString: string) {
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
  }

  async readActiveSecrets(connector: Connector, kind: SecretKind): Promise<ActiveSecret[]> {
    const res = await this.pool.query<{ secret_version: number; secret_value: string }>(
      `select secret_version, secret_value from webhook_secrets
       where connector = $1 and secret_kind = $2 and active = true
       order by secret_version desc`,
      [connector, kind],
    );
    return res.rows.map((r) => ({ version: r.secret_version, value: r.secret_value }));
  }

  async addSecretVersion(connector: Connector, kind: SecretKind, value: string, _now: number): Promise<WebhookSecretRow> {
    const res = await this.pool.query<WebhookSecretRow>(
      `insert into webhook_secrets (connector, secret_kind, secret_value, secret_version, active)
       values ($1, $2, $3,
         (select coalesce(max(secret_version), 0) + 1 from webhook_secrets where connector = $1 and secret_kind = $2),
         true)
       returning id, connector, secret_kind, secret_value, secret_version, active, rotated_at, created_at`,
      [connector, kind, value],
    );
    return res.rows[0]!;
  }

  async retireSecretVersion(connector: Connector, kind: SecretKind, version: number, now: number): Promise<void> {
    await this.pool.query(
      `update webhook_secrets set active = false, rotated_at = to_timestamp($4)
       where connector = $1 and secret_kind = $2 and secret_version = $3`,
      [connector, kind, version, now],
    );
  }

  async recordOrDetectReplay(
    connector: Connector,
    eventId: string,
    sourceId: string,
    now: number,
    windowSeconds: number,
  ): Promise<{ replay: boolean }> {
    // Purge expired first (ephemeral cache; auto-purge after window — schema §1 comment).
    await this.pool.query(`delete from webhook_replay_cache where window_expires_at <= to_timestamp($1)`, [now]);
    const res = await this.pool.query(
      `insert into webhook_replay_cache (event_id, connector_type, source_id, seen_at, window_expires_at)
       values ($1, $2, $3, to_timestamp($4), to_timestamp($5))
       on conflict (connector_type, event_id) do nothing`,
      [eventId, connector, sourceId, now, now + windowSeconds],
    );
    return { replay: res.rowCount === 0 }; // 0 rows inserted → PK collision → already seen → replay
  }

  private windowed(map: Map<string, number[]>, sourceId: string, now: number, windowSeconds: number): number[] {
    const arr = (map.get(sourceId) ?? []).filter((t) => t > now - windowSeconds);
    map.set(sourceId, arr);
    return arr;
  }
  async bumpFailure(sourceId: string, now: number): Promise<number> {
    const arr = this.windowed(this.failures, sourceId, now, 3600);
    arr.push(now);
    return arr.length;
  }
  async bumpAccept(sourceId: string, now: number): Promise<number> {
    const arr = this.windowed(this.accepts, sourceId, now, 60);
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
    const res = await this.pool.query<GuardrailLogRow>(
      `insert into guardrail_log (task_id, guardrail_type, description, action_blocked, status, escalated_at)
       values ($1, $2, $3, $4, $5, $6)
       returning id, task_id, guardrail_type, description, action_blocked, status,
                 reviewed_by, reviewed_at, escalated_at, created_at`,
      [row.task_id, row.guardrail_type, row.description, row.action_blocked, row.status, row.escalated_at ?? null],
    );
    return res.rows[0]!;
  }

  async logEvent(row: NewEvent): Promise<EventLogRow> {
    // entity_ids is uuid[] (schema.md L531) — webhook event ids (e.g. "ghl-evt-1", "slack-123") are
    // NOT uuids; they live in summary/payload. Drop non-UUID ids so the uuid[] insert is valid.
    const uuids = row.entity_ids.filter((id) => UUID_RE.test(id));
    const res = await this.pool.query<EventLogRow>(
      `insert into event_log (task_id, event_type, entity_ids, summary, payload)
       values ($1, $2, $3, $4, $5)
       returning id, task_id, event_type, entity_ids, summary, payload, created_at`,
      [row.task_id, row.event_type, uuids, row.summary, JSON.stringify(row.payload)],
    );
    return res.rows[0]!;
  }

  async writeAudit(row: NewAudit): Promise<AuditRow> {
    // Rotation is a security-relevant action → the immutable `access_audit` sink (schema.md §1 L259).
    // NOT config_audit_log — that table explicitly excludes SECRET-class changes (schema.md L566).
    // actor_type is 'system' (service_role provisioning, machine-driven — enum L91: user|agent|system).
    const res = await this.pool.query<{ id: string; created_at: string }>(
      `insert into access_audit (audit_type, actor_identity, actor_type, action, target_type, after_value, reason)
       values ('webhook_secret', 'service_role:provisioning', 'system', $1, 'webhook_secrets', $2, $3)
       returning id, created_at`,
      [row.action, JSON.stringify({ connector: row.connector, secret_kind: row.secret_kind }), row.detail],
    );
    return { id: res.rows[0]!.id, created_at: res.rows[0]!.created_at, ...row };
  }

  async alertSuperAdmins(alert: WebhookAlert): Promise<void> {
    // Seam to the alerting surface (FR-0.WHK.005 → C7 FR-3.DSC.006 / Phase-3 alert surface, ISSUE-075).
    // Recorded to event_log so the alert is never a silent no-op (#3) until the alert surface lands.
    await this.pool.query(
      // 'webhook_failure_alert' is an event_type enum value (change-control OD-179). entity_ids is
      // empty — the source id (not a uuid) lives in the summary + payload.
      `insert into event_log (task_id, event_type, entity_ids, summary, payload)
       values (null, 'webhook_failure_alert', '{}', $1, $2)`,
      [`webhook failure alert: ${alert.connector} ${alert.source_id} (${alert.failures_this_hour}/hr)`, JSON.stringify(alert)],
    );
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}
