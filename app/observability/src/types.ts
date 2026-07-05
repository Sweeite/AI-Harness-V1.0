// ISSUE-011 §5 DATA — the app-code projection of the ISSUE-008 0001 baseline DDL (app/silo/migrations/
// 0001_baseline.sql). These interfaces mirror `event_log`, `notifications`, `task_queue`, and `guardrail_log`
// exactly as those tables already exist (Rule 0 — the migration is the source of truth; nothing here
// re-creates schema). Only the fields this slice reads/writes are modelled.

/**
 * The 17-value `event_type` enum, VERBATIM from 0001_baseline.sql L60-65. FR-7.LOG.001 names 15
 * (8 lifecycle + 6 alert + reporter_push); OD-170 (change-control) added `authz_revoked_midtask` +
 * `rls_harness_divergence` (C1 FR-1.RLS.007/008). This constant IS the enum guard (AC-7.LOG.001.2 —
 * an out-of-enum event_type is rejected, not silently coerced).
 */
export const EVENT_TYPES = [
  // 8 lifecycle
  "task_started",
  "tool_called",
  "memory_read",
  "memory_written",
  "guardrail_hit",
  "approval_requested",
  "task_completed",
  "task_failed",
  // 6 alert types (FR-7.ALR.004) + reporter_push (FR-7.MGM.001.3)
  "task_failure_spike",
  "queue_backup",
  "memory_confidence_drop",
  "approval_queue_stale",
  "cost_threshold_breach",
  "loop_missed",
  "reporter_push",
  // OD-170 additive (C1 RLS)
  "authz_revoked_midtask",
  "rls_harness_divergence",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** The two terminal lifecycle events (AC-7.LOG.003.1 — exactly one per task). */
export const TERMINAL_EVENT_TYPES = ["task_completed", "task_failed"] as const;
export type TerminalEventType = (typeof TERMINAL_EVENT_TYPES)[number];

export function isEventType(v: string): v is EventType {
  return (EVENT_TYPES as readonly string[]).includes(v);
}

export function isTerminalEventType(v: string): v is TerminalEventType {
  return (TERMINAL_EVENT_TYPES as readonly string[]).includes(v);
}

/**
 * The `alert_type` enum, VERBATIM from 0001_baseline.sql L71-73 — the `notifications.type`. Includes
 * `alert_engine_stalled` (the watchdog's own critical, FR-7.ALR.008) and `alert_delivery_misconfigured`.
 */
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

/** The `answer_mode` enum (0001_baseline.sql L81) — the pill stored on AI-output event rows. */
export type AnswerMode = "cited" | "inferred" | "unknown" | "building";

/**
 * The `cost_unknown` sentinel (0001_baseline.sql L491-492, AC-7.LOG.004.1 / NFR-OBS.013). The DDL splits
 * cost into two columns: `cost_tokens bigint` (nullable) + `cost_unknown boolean not null default false`.
 * We model that split faithfully:
 *   - a genuinely costless event → { cost_tokens: 0,    cost_unknown: false }
 *   - a measured cost           → { cost_tokens: N>0,   cost_unknown: false }
 *   - an un-computable cost      → { cost_tokens: null,  cost_unknown: true  }  ← never a silent 0
 */
export const COST_UNKNOWN = Symbol("cost_unknown");
export type CostInput = number | typeof COST_UNKNOWN;

/** The two persisted cost columns (schema-faithful). */
export interface CostColumns {
  cost_tokens: number | null;
  cost_unknown: boolean;
}

/**
 * An `event_log` row (0001_baseline.sql L483-495). `client_slug` is deliberately ABSENT (OD-067 /
 * AC-7.LOG.001.3 — dropped intra-silo). `redacted_at` is the one-way redaction-tombstone target.
 */
export interface EventLogRow {
  id: string;
  task_id: string | null;
  event_type: EventType;
  entity_ids: string[] | null;
  summary: string;
  payload: Record<string, unknown> | null;
  duration_ms: number | null;
  cost_tokens: number | null;
  cost_unknown: boolean;
  answer_mode: AnswerMode | null;
  redacted_at: string | null; // ISO-8601; null until a compliance erasure tombstones the row
  created_at: string; // ISO-8601, server-authoritative
}

/** The fields a caller supplies when writing an event (id/created_at are server-assigned). */
export interface EventLogInput {
  task_id?: string | null;
  event_type: EventType;
  entity_ids?: string[] | null;
  summary: string;
  payload?: Record<string, unknown> | null;
  duration_ms?: number | null;
  /** Pass a number for measured cost (0 = genuinely free), or COST_UNKNOWN when it can't be computed. */
  cost?: CostInput | null;
  answer_mode?: AnswerMode | null;
}

/**
 * The terminal-status projection of `task_queue` (0001_baseline.sql L398-415) the silent-failure detector
 * reads. `task_status` terminal values are `completed` / `failed` (the state machine's end states).
 */
export type TerminalTaskStatus = "completed" | "failed";

export interface TaskTerminalRow {
  task_id: string;
  status: TerminalTaskStatus;
  /** True while the task is still referenced by an open item (approval/cleanup) — retention must skip it. */
  referenced_open?: boolean;
}

/** The reconciliation projection of `guardrail_log` (0001_baseline.sql L454-466). Read-only here. */
export interface GuardrailLogRow {
  id: string;
  task_id: string | null;
  created_at: string; // ISO-8601
}

/** A notification row (0001_baseline.sql L500-514) — shell only; watchdog writes its critical here. */
export interface NotificationInput {
  type: AlertType;
  severity: string; // "critical" for the watchdog's stall alert
  title: string;
  body: string;
  recipient?: string | null;
  recipient_role?: string | null;
}

export interface NotificationRow extends NotificationInput {
  id: string;
  read_state: "unread" | "read" | "actioned";
  escalation_state: string | null;
  escalated_at: string | null;
  actioned_at: string | null;
  delivery_state: Record<string, unknown> | null;
  created_at: string;
}
