// ISSUE-075 — the LIVE alerting adapters (pg, against the client-owned silo Supabase). The only module that
// imports `pg`. It implements the SAME ports as the in-memory fakes against the real DDL:
//   - `notifications`      (0001_baseline L500-514) — the durable, dashboard-first store
//   - `event_log`          (0001_baseline L483-495) — the append-only alert audit rows
//   - `config_values`      (0001_baseline L626-631, schema.md §12) — the alert-routing structured objects
// NO migration is authored by this slice; every table above already exists (ISSUE-008 0001_baseline).
//
// ⚠️ NOT YET RUN LIVE. The append-only trigger on event_log actually rejecting a service_role UPDATE/DELETE,
// the dashboard-first ordering surviving a real Slack outage, and the routing/escalation window math against
// a real server clock are proven by the ISSUE-075 delivery-durability + fails-loud integration tests at the
// Stage-3 checkpoint (see results/issue-075-notes.md). This adapter is authored to the DDL so the seam is
// real and typechecks; the in-memory fakes are the proven reference model. Do NOT claim these paths verified
// until the checkpoint records evidence.
//
// Design notes tied to the three non-negotiables:
//   - the notification row is INSERTed and committed BEFORE any Slack fan-out (FR-7.ALR.006 / NFR-OBS.009);
//     the Slack outcome is written back to delivery_state in a SEPARATE statement — a Slack failure can never
//     roll back or lose the durable row (#1/#3).
//   - the event_log append runs on a path independent of delivery (NFR-OBS.016); it is never conditioned on a
//     successful send.
//   - all created_at / escalated_at / actioned_at are `now()` server-side (AC-7.ALR.005.3) — never a
//     client-supplied timestamp.

import pg from "pg";
import type {
  AlertConfig,
  DeliveryState,
  EventLogRow,
  NotificationInput,
  NotificationRow,
} from "./types.ts";
import type { AlertConfigStore, AlertEventLogStore, NotificationStore } from "./store.ts";

// The three ports collide on the method name `all()` with different row types, so they are implemented as
// three sibling classes over a shared pool (not one class) — the same seam-per-table shape as the fakes.
export class SupabaseNotificationStore implements NotificationStore {
  constructor(private readonly pool: pg.Pool) {}

  // ── notifications (dashboard-first durable store) ──────────────────────────────────────────────────
  async create(input: NotificationInput, _id: string, _createdAt: string): Promise<NotificationRow> {
    // id + created_at are server-assigned (gen_random_uuid() / now()); the _id/_createdAt args exist only to
    // satisfy the port shared with the deterministic fake — they are deliberately ignored on the live side.
    const res = await this.pool.query<NotificationRow>(
      `insert into notifications (type, severity, title, body, recipient, recipient_role, read_state)
       values ($1, $2, $3, $4, $5, $6, 'unread')
       returning id, type, severity, title, body, recipient, recipient_role, read_state,
                 escalation_state, escalated_at, actioned_at, delivery_state, created_at`,
      [input.type, input.severity, input.title, input.body, input.recipient ?? null, input.recipient_role ?? null],
    );
    return res.rows[0]!;
  }

  async setDeliveryState(id: string, state: DeliveryState): Promise<void> {
    // a SEPARATE write, AFTER the durable insert committed — the Slack outcome never gates the row.
    await this.pool.query(`update notifications set delivery_state = $2::jsonb where id = $1`, [
      id,
      JSON.stringify(state),
    ]);
  }

  async escalate(id: string, escalationState: string, _escalatedAt: string): Promise<void> {
    // escalated_at is server-authoritative now() (AC-7.ALR.005.3) — never the client-passed value.
    await this.pool.query(
      `update notifications set escalation_state = $2, escalated_at = now() where id = $1`,
      [id, escalationState],
    );
  }

  async action(id: string, _actionedAt: string): Promise<void> {
    await this.pool.query(
      `update notifications set read_state = 'actioned', actioned_at = now() where id = $1`,
      [id],
    );
  }

  async get(id: string): Promise<NotificationRow | null> {
    const res = await this.pool.query<NotificationRow>(
      `select id, type, severity, title, body, recipient, recipient_role, read_state,
              escalation_state, escalated_at, actioned_at, delivery_state, created_at
         from notifications where id = $1`,
      [id],
    );
    return res.rows[0] ?? null;
  }

  async all(): Promise<NotificationRow[]> {
    const res = await this.pool.query<NotificationRow>(
      `select id, type, severity, title, body, recipient, recipient_role, read_state,
              escalation_state, escalated_at, actioned_at, delivery_state, created_at
         from notifications order by created_at`,
    );
    return res.rows;
  }
}

// ── event_log alert rows (append-only; independent of delivery) ───────────────────────────────────────
export class SupabaseAlertEventLogStore implements AlertEventLogStore {
  constructor(private readonly pool: pg.Pool) {}

  async append(row: EventLogRow): Promise<void> {
    // id + created_at server-assigned; cost columns follow the cost_unknown split (0001_baseline L491-492).
    await this.pool.query(
      `insert into event_log (task_id, event_type, entity_ids, summary, payload, duration_ms,
                              cost_tokens, cost_unknown, answer_mode)
       values ($1, $2, $3::uuid[], $4, $5::jsonb, $6, $7, $8, $9)`,
      [
        row.task_id,
        row.event_type,
        row.entity_ids,
        row.summary,
        row.payload === null ? null : JSON.stringify(row.payload),
        row.duration_ms,
        row.cost_tokens,
        row.cost_unknown,
        row.answer_mode,
      ],
    );
  }

  /** ISSUE-011 owns the read side of event_log; this slice only appends. Provided for port symmetry. */
  async all(): Promise<EventLogRow[]> {
    const res = await this.pool.query<EventLogRow>(
      `select id, task_id, event_type, entity_ids, summary, payload, duration_ms, cost_tokens,
              cost_unknown, answer_mode, redacted_at, created_at
         from event_log order by created_at`,
    );
    return res.rows;
  }
}

// ── config_values structured objects (§12) — reads only (write UI is ISSUE-086) ───────────────────────
export class SupabaseAlertConfigStore implements AlertConfigStore {
  constructor(private readonly pool: pg.Pool) {}

  async read(): Promise<AlertConfig> {
    const res = await this.pool.query<{ key: string; value: unknown }>(
      `select key, value from config_values
        where key in ('alert_routing_rules','escalation_contacts','quiet_hours','alert_email_enabled')`,
    );
    const byKey = new Map(res.rows.map((r) => [r.key, r.value]));
    // SLACK_WEBHOOK_URL presence comes from secret_manifest, never config_values (never the value).
    const secret = await this.pool.query<{ present: boolean }>(
      `select present from secret_manifest where key = 'SLACK_WEBHOOK_URL'`,
    );
    return {
      alert_routing_rules: (byKey.get("alert_routing_rules") as AlertConfig["alert_routing_rules"]) ?? {},
      escalation_contacts: (byKey.get("escalation_contacts") as AlertConfig["escalation_contacts"]) ?? {},
      quiet_hours:
        (byKey.get("quiet_hours") as AlertConfig["quiet_hours"]) ??
        ({ enabled: false, start_min: 0, end_min: 0 } as AlertConfig["quiet_hours"]),
      alert_email_enabled: Boolean(byKey.get("alert_email_enabled") ?? false),
      slack_webhook_present: secret.rows[0]?.present ?? false,
    };
  }
}

/**
 * Convenience factory: build all three sibling adapters over ONE shared pool. The `connectionString` is the
 * client-owned silo Supabase. NOT run live in this offline half (see file header + results/issue-075-notes.md).
 */
export function makeSupabaseAlertStores(connectionString: string): {
  notifications: SupabaseNotificationStore;
  eventLog: SupabaseAlertEventLogStore;
  config: SupabaseAlertConfigStore;
  pool: pg.Pool;
} {
  const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
  const pool = new pg.Pool({ connectionString, ssl });
  return {
    notifications: new SupabaseNotificationStore(pool),
    eventLog: new SupabaseAlertEventLogStore(pool),
    config: new SupabaseAlertConfigStore(pool),
    pool,
  };
}
