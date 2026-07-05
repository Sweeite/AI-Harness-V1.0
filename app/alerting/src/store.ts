// ISSUE-075 §5 — the ports the alerting layer reads/writes through (house port+fake pattern; cf.
// app/observability/src/store.ts, app/config-store, app/webhook-auth). All tables are CLIENT-SILO tables
// already created by ISSUE-008's 0001_baseline. The in-memory fakes are the test doubles AND the reference
// model that re-implements every FR invariant the DB/DDL would enforce; the live pg adapter
// (supabase-store.ts) is the thin translation authored to the DDL but NOT run in this offline half.
//
// This slice authors NO migration. It:
//   - WRITES `notifications` (dashboard-first, before any Slack fan-out — FR-7.ALR.006 / NFR-OBS.009)
//   - APPENDS `event_log` alert rows (independent of delivery — FR-7.ALR.004 / NFR-OBS.016)
//   - READS the §12 config structured objects (alert_routing_rules / escalation_contacts / quiet_hours)

import type {
  AlertConfig,
  DeliveryState,
  EventLogRow,
  NotificationInput,
  NotificationRow,
  ReadState,
} from "./types.ts";

// ── errors that mirror the delivery / durability invariants ──────────────────────────────────────────

/** A Slack fan-out failure. Best-effort: it NEVER loses the persisted row; it is itself surfaced
 *  (AC-7.ALR.006.2 / AC-7.ALR.009.4). Thrown by the fake Slack client's fault-injection. */
export class SlackDeliveryFailure extends Error {
  constructor(cause: string) {
    super(`slack delivery failed: ${cause}`);
    this.name = "SlackDeliveryFailure";
  }
}

// ── notifications write/read port (the durable, dashboard-first surface) ─────────────────────────────

export interface NotificationStore {
  /** Persist a notification FIRST + independently (FR-7.ALR.006). Defaults read_state='unread'. Returns the
   *  durable row; any Slack fan-out happens AFTER and off this row. */
  create(input: NotificationInput, id: string, createdAt: string): Promise<NotificationRow>;
  /** Record the Slack fan-out outcome onto the durable row's delivery_state — never blocks/loses the row. */
  setDeliveryState(id: string, state: DeliveryState): Promise<void>;
  /** The escalation-chain mutation (FR-7.ALR.005): advance escalation_state + escalated_at. */
  escalate(id: string, escalationState: string, escalatedAt: string): Promise<void>;
  /** A human actions the notification → read_state='actioned' + actioned_at (unread-until-actioned). */
  action(id: string, actionedAt: string): Promise<void>;
  get(id: string): Promise<NotificationRow | null>;
  all(): Promise<NotificationRow[]>;
}

export class InMemoryNotificationStore implements NotificationStore {
  private readonly rows = new Map<string, NotificationRow>();

  async create(input: NotificationInput, id: string, createdAt: string): Promise<NotificationRow> {
    if (this.rows.has(id)) throw new Error(`notification id collision: ${id}`);
    const row: NotificationRow = {
      id,
      type: input.type,
      severity: input.severity,
      title: input.title,
      body: input.body,
      recipient: input.recipient ?? null,
      recipient_role: input.recipient_role ?? null,
      read_state: "unread", // unread-until-actioned (FR-7.ALR.001)
      escalation_state: null,
      escalated_at: null,
      actioned_at: null,
      delivery_state: null, // set AFTER, by the best-effort fan-out (never a precondition of persistence)
      created_at: createdAt,
    };
    this.rows.set(id, row);
    return { ...row };
  }

  async setDeliveryState(id: string, state: DeliveryState): Promise<void> {
    const row = this.rows.get(id);
    if (!row) throw new Error(`notification ${id} not found`);
    row.delivery_state = { ...state };
  }

  async escalate(id: string, escalationState: string, escalatedAt: string): Promise<void> {
    const row = this.rows.get(id);
    if (!row) throw new Error(`notification ${id} not found`);
    row.escalation_state = escalationState;
    row.escalated_at = escalatedAt;
  }

  async action(id: string, actionedAt: string): Promise<void> {
    const row = this.rows.get(id);
    if (!row) throw new Error(`notification ${id} not found`);
    row.read_state = "actioned";
    row.actioned_at = actionedAt;
  }

  async get(id: string): Promise<NotificationRow | null> {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  async all(): Promise<NotificationRow[]> {
    return [...this.rows.values()].map((r) => ({ ...r }));
  }

  /** Test convenience: set read_state directly to model a human read-but-not-actioned or an ack. */
  _setReadState(id: string, state: ReadState): void {
    const row = this.rows.get(id);
    if (!row) throw new Error(`notification ${id} not found`);
    row.read_state = state;
  }

  /** Test-only: forge the stored row's created_at to a client-asserted value. Used to PROVE the engine's
   *  window math ignores the row's (forgeable) timestamp and uses the injected server clock (AC-7.ALR.005.3).
   *  The forgery lands on the ACTUAL stored row (not a clone), so if the engine trusted it, the test would break. */
  _forgeCreatedAt(id: string, createdAt: string): void {
    const row = this.rows.get(id);
    if (!row) throw new Error(`notification ${id} not found`);
    row.created_at = createdAt;
  }
}

// ── event_log append port (alert rows — independent of delivery, FR-7.ALR.004 / NFR-OBS.016) ─────────

export interface AlertEventLogStore {
  /** Append an alert's event_log row. This happens on a path independent of (and prior to) the fan-out
   *  attempt (NFR-OBS.016), so the audit history survives a delivery failure. */
  append(row: EventLogRow): Promise<void>;
  all(): Promise<EventLogRow[]>;
}

export class InMemoryAlertEventLogStore implements AlertEventLogStore {
  private readonly rows = new Map<string, EventLogRow>();
  async append(row: EventLogRow): Promise<void> {
    if (this.rows.has(row.id)) throw new Error(`event_log id collision: ${row.id}`);
    this.rows.set(row.id, { ...row });
  }
  async all(): Promise<EventLogRow[]> {
    return [...this.rows.values()].map((r) => ({ ...r }));
  }
}

// ── config read port (§12 structured objects; reads, this slice does not own the write UI) ───────────

export interface AlertConfigStore {
  read(): Promise<AlertConfig>;
}

export class InMemoryAlertConfigStore implements AlertConfigStore {
  constructor(private config: AlertConfig) {}
  async read(): Promise<AlertConfig> {
    // deep-ish copy so a consumer cannot mutate the stored config in place
    return {
      alert_routing_rules: { ...this.config.alert_routing_rules },
      escalation_contacts: { ...this.config.escalation_contacts },
      quiet_hours: { ...this.config.quiet_hours },
      alert_email_enabled: this.config.alert_email_enabled,
      slack_webhook_present: this.config.slack_webhook_present,
    };
  }
  /** The config-admin write path (ISSUE-086) sets a validated config; used by tests to swap config. */
  _set(config: AlertConfig): void {
    this.config = config;
  }
}

// ── Slack best-effort fan-out client (a channel off the persisted row, never load-bearing) ───────────

export interface SlackClient {
  /** Best-effort. Throws SlackDeliveryFailure on outage / invalid webhook (surfaced, never fatal to the row). */
  send(title: string, body: string): Promise<void>;
}

/** A controllable fake: healthy by default; a test can force it to fail (outage) or mark the webhook invalid. */
export class InMemorySlackClient implements SlackClient {
  private failCause: string | null = null;
  readonly sent: { title: string; body: string }[] = [];

  /** Force the NEXT (and subsequent) sends to fail — models an outage or a revoked/404 webhook. */
  induceFailure(cause = "webhook 404"): void {
    this.failCause = cause;
  }
  /** Restore healthy delivery. */
  recover(): void {
    this.failCause = null;
  }

  async send(title: string, body: string): Promise<void> {
    if (this.failCause !== null) throw new SlackDeliveryFailure(this.failCause);
    this.sent.push({ title, body });
  }
}
