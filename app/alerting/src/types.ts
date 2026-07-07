// ISSUE-075 §5 DATA — the app-code projection of the ISSUE-008 0001_baseline DDL (app/silo/migrations/
// 0001_baseline.sql) + the §12 config structured objects. These interfaces mirror `notifications`,
// `event_log`, and the `config_values` structured objects (`alert_routing_rules`, `escalation_contacts`,
// `quiet_hours`) EXACTLY as they already exist (Rule 0 — the migration is the source of truth; nothing here
// re-creates schema). Only the fields this slice reads/writes are modelled. NO migration is authored: this
// slice writes `notifications`/`event_log` and reads the config structured objects (schema.md §12: they are
// `config_values.value` JSON, not tables).

// ── event_type enum (0001_baseline L60-65 / observability/types.ts) ──────────────────────────────────
// The 6 alert-type event_log rows this slice appends (FR-7.ALR.004). The full enum is owned by ISSUE-011;
// this slice only ever writes these six + is defensive against anything else. hard_limit_hit and the two
// "meta" alert types (alert_delivery_misconfigured / alert_engine_stalled) are NOTIFICATION types, not
// event_log event_types — an alert of those classes still logs under its nearest lifecycle mapping, so we
// keep a distinct EVENT_LOG projection here (see alertEventType()).
export const ALERT_EVENT_TYPES = [
  "task_failure_spike",
  "queue_backup",
  "memory_confidence_drop",
  "approval_queue_stale",
  "cost_threshold_breach",
  "loop_missed",
  "guardrail_hit", // the event_log row for a hard_limit_hit alert (paired with guardrail_log, FR-7.LOG.003)
] as const;
export type AlertEventType = (typeof ALERT_EVENT_TYPES)[number];

// ── alert_type enum (0001_baseline L141-144 / schema.md §8) — the `notifications.type` ───────────────
export const ALERT_TYPES = [
  "task_failure_spike",
  "queue_backup",
  "memory_confidence_drop",
  "approval_queue_stale",
  "hard_limit_hit",
  "cost_threshold_breach",
  "loop_missed",
  "proactive",
  "alert_delivery_misconfigured",
  "alert_engine_stalled",
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export function isAlertType(v: string): v is AlertType {
  return (ALERT_TYPES as readonly string[]).includes(v);
}

// The seven CONFIGURABLE alert rules (FR-7.ALR.002). `hard_limit_hit` is the always-on, non-suppressible
// one (AC-7.ALR.002.2). loop_missed references C5 catch-up, never a C7 re-run (AC-7.ALR.002.3).
export const SEVEN_RULE_TYPES = [
  "task_failure_spike",
  "queue_backup",
  "memory_confidence_drop",
  "approval_queue_stale",
  "hard_limit_hit",
  "cost_threshold_breach",
  "loop_missed",
] as const;
export type RuleType = (typeof SEVEN_RULE_TYPES)[number];

// ── severity classification (OD-097 / NFR-OBS.008 — quiet-hours may never silence these) ─────────────
export type Severity = "critical" | "warning" | "info";

/**
 * The CRITICAL / safety class quiet-hours can NEVER silence and config can never strand (AC-7.ALR.009.2/.3,
 * AC-NFR-OBS.008.2). hard_limit_hit is critical + non-suppressible; the two "the-alerting-itself-is-broken"
 * meta-types are critical (a mis-configured or stalled alerting layer must fail loud). Everything else is a
 * routine rule whose severity is per-config, defaulting to warning.
 */
export const CRITICAL_ALERT_TYPES: ReadonlySet<AlertType> = new Set<AlertType>([
  "hard_limit_hit",
  "alert_delivery_misconfigured",
  "alert_engine_stalled",
]);

export function isCriticalType(type: AlertType): boolean {
  return CRITICAL_ALERT_TYPES.has(type);
}

// ── notifications (0001_baseline L500-514) ───────────────────────────────────────────────────────────
export type ReadState = "unread" | "read" | "actioned";

/** The Slack fan-out outcome persisted onto the durable row (delivery_state jsonb). */
export interface DeliveryState {
  slack_attempted: boolean;
  slack_ok: boolean;
  /** set when Slack failed — the surfaced delivery-failure reason (AC-7.ALR.006.2 / AC-7.ALR.009.4). */
  slack_error: string | null;
}

/** What a caller supplies to raise an alert (id/created_at/read_state are engine-assigned). */
export interface NotificationInput {
  type: AlertType;
  severity: Severity;
  title: string;
  body: string;
  /** resolved user id, or null when routed to a role/broadcast (see routing). */
  recipient?: string | null;
  recipient_role?: string | null;
  /** set only by an escalation create — stamps the chain step at creation so a second write to set it
   *  is never needed (a crash between "create secondary" and "stamp its step" would otherwise leave the
   *  secondary indistinguishable from a fresh, never-escalated primary). */
  escalation_state?: string | null;
}

/** A persisted notification row (schema-faithful; `notifications`). */
export interface NotificationRow {
  id: string;
  type: AlertType;
  severity: Severity;
  title: string;
  body: string;
  recipient: string | null;
  recipient_role: string | null;
  read_state: ReadState;
  escalation_state: string | null; // FR-7.ALR.005: which chain step is live / "exhausted"
  escalated_at: string | null; // ISO-8601, server-authoritative
  actioned_at: string | null; // set when a human actions it (unread-until-actioned)
  delivery_state: DeliveryState | null;
  created_at: string; // ISO-8601, server-authoritative
}

// ── event_log projection (0001_baseline L483-495) — this slice APPENDS alert rows ────────────────────
export interface EventLogRow {
  id: string;
  task_id: string | null;
  event_type: AlertEventType;
  entity_ids: string[] | null;
  summary: string;
  payload: Record<string, unknown> | null;
  duration_ms: number | null;
  cost_tokens: number | null;
  cost_unknown: boolean;
  answer_mode: null;
  redacted_at: string | null;
  created_at: string; // ISO-8601, server-authoritative
}

// ── §12 config structured objects (schema.md §12 — config_values.value JSON, NOT tables) ─────────────

/** One route: alert-type → {role, channel[]} (FR-7.ALR.009 `alert_routing_rules`). */
export interface RoutingRule {
  /** the C1 role this alert type routes TO (C1 owns who holds the role — FR-7.ALR.003). */
  role: string;
  /** the ordered fan-out channels; "dashboard" is always implicit + durable, listed channels are best-effort. */
  channels: readonly ("slack" | "email")[];
}

/** `alert_routing_rules`: alert-type → routing rule. A type absent here has NO configured destination. */
export type AlertRoutingRules = Partial<Record<AlertType, RoutingRule>>;

/** `escalation_contacts`: role → the ordered contact chain (contact = a resolvable user id or role). */
export type EscalationContacts = Record<string, readonly string[]>;

/** `quiet_hours`: a server-clock window in which NON-critical alerts are suppressed (never criticals). */
export interface QuietHours {
  enabled: boolean;
  /** minute-of-day [0,1440) start/end, server-authoritative (AF-120). Window may wrap past midnight. */
  start_min: number;
  end_min: number;
}

/** The full alert-routing config this slice reads out of config_values (§12) + validates on write. */
export interface AlertConfig {
  alert_routing_rules: AlertRoutingRules;
  escalation_contacts: EscalationContacts;
  quiet_hours: QuietHours;
  alert_email_enabled: boolean;
  /** presence-only mirror of the SLACK_WEBHOOK_URL secret (secret_manifest; never the value here). */
  slack_webhook_present: boolean;
}

/** The C1 role-resolution port view: given a role, who currently holds it (FR-7.ALR.003 routing authority). */
export interface RoleResolver {
  /** the user ids currently holding this role, or [] when none (→ unresolvable → escalate/fail-loud). */
  usersForRole(role: string): readonly string[];
  /** the reviewer holding a specific approval item (AC-7.ALR.003.1 — direct, not broadcast). */
  reviewerForApprovalItem(itemId: string): string | null;
  /**
   * Is `userId` an ACTUAL, currently-known recipient the C1 model can deliver to? This is the fail-CLOSED
   * resolvability gate (AC-7.ALR.009.3 / AC-NFR-OBS.008.1): a contact that is neither a role anyone holds nor a
   * known user id resolves to NO ONE — a typo'd/role-shaped dead string a critical alert must NEVER be routed
   * to. Both write-time validation and runtime routing consult this so an unresolvable destination fails LOUD
   * instead of silently reaching a dead string that nobody holds.
   */
  isKnownRecipient(userId: string): boolean;
}

/**
 * Resolve one destination string (a routed role's chosen holder, or an escalation-contact) to a CONCRETE
 * deliverable user id, or `null` if it resolves to NO actual recipient. A contact resolves iff it is (a) a role
 * currently held by ≥1 user → its first holder, or (b) a bare user id the C1 model actually knows
 * (`isKnownRecipient`). Anything else — a typo'd role name, a stale/removed user id, a role nobody holds with no
 * known-user fallback — is UNRESOLVABLE and returns `null` (fail-closed). This is the SINGLE resolvability rule
 * shared by write-time validation and runtime routing, so they can never disagree about what "has a destination"
 * means (the exact drift that let a critical alert reach a dead role-shaped string).
 */
export function resolveContact(contact: string, roles: RoleResolver): string | null {
  if (contact.length === 0) return null;
  const holders = roles.usersForRole(contact);
  if (holders.length > 0) return holders[0]!;
  if (roles.isKnownRecipient(contact)) return contact; // a genuine, known bare user id is deliverable
  return null; // role-shaped dead string / unknown id → resolves to no one (fail-closed)
}
