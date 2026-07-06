// ISSUE-077 §5 DATA — the app-code projection of the ISSUE-008 0001 baseline DDL (app/silo/migrations/
// 0001_baseline.sql) for the C7 tables this slice governs above the ISSUE-011 skeleton. Rule 0: the migration
// is the source of truth; nothing here re-creates schema. Only the fields this slice reads/writes are modelled.
//
// This slice is READ-ONLY on the *content* of event_log / guardrail_log / config_audit_log (C6/C11 own the
// writes); it owns the retention window, the compliance redaction-tombstone (the ONE sanctioned in-place
// mutation), and the client-presentable export. No new C7 table (§8 build note).

// ── event_log (0001_baseline.sql L483-496) — C7 owns retention + tombstone here (write is ISSUE-011) ────
//
// `client_slug` is deliberately ABSENT (OD-067 — dropped intra-silo). `redacted_at` is the one-way
// redaction-tombstone target (schema.md §Immutability L69; DDL L494).
export interface EventLogRow {
  id: string;
  task_id: string | null;
  event_type: string; // the 17-value event_type enum (ISSUE-011 owns the guard); opaque to retention
  entity_ids: string[] | null; // PII target on erasure (FR-7.LOG.006.3)
  summary: string; // PII narrative target on erasure
  payload: Record<string, unknown> | null;
  duration_ms: number | null;
  cost_tokens: number | null;
  cost_unknown: boolean;
  answer_mode: AnswerMode | null;
  redacted_at: string | null; // ISO-8601; null until a compliance erasure tombstones the row
  created_at: string; // ISO-8601, server-authoritative
}

// ── guardrail_log (0001_baseline.sql L454-466) — C6 writes; C7 owns view/retention/tamper-evidence/export ──
//
// The `check (not (hard_limit and approved))` and append-only trigger are C6/ISSUE-060 concerns; here we model
// only the read/retention/export/tombstone projection. `description` is the PII target on erasure
// (FR-7.LOG.007.4). `redacted_at` is the one-way tombstone target (schema.md §Immutability L69) — NOTE the
// baseline DDL guardrail_log block does NOT yet carry a `redacted_at` column; see proposed-shared-spec.md
// (an additive ALTER owed to the orchestrator). We model it here so the tombstone contract is real offline.
export type GuardrailType = "hard_limit" | "approval_gate" | "anomaly" | "rate_limit" | "prompt_injection";
export type GuardrailStatus = "pending" | "approved" | "rejected" | "modified";

export interface GuardrailLogRow {
  id: string;
  task_id: string | null;
  guardrail_type: GuardrailType;
  description: string; // plain-English; PII target on erasure (FR-7.LOG.007.4)
  action_blocked: boolean;
  status: GuardrailStatus;
  reviewed_by: string | null;
  reviewed_at: string | null; // ISO-8601
  escalated_at: string | null; // ISO-8601
  redacted_at: string | null; // ISO-8601; one-way tombstone target (proposed additive column, see shared-spec)
  created_at: string; // ISO-8601, server-authoritative
}

// ── config_audit_log (0001_baseline.sql L517-523) — READ ONLY here, for the third-sink floor parity ────
// FR-7.LOG.008 (view/retention/export) is ISSUE-010; this slice reads it only to assert retention-floor parity.
export interface ConfigAuditLogRow {
  id: string;
  key: string;
  redacted_at: string | null;
  created_at: string;
}

// ── push_subscriptions (0001_baseline.sql L529-537) — mobile push routing (FR-7.VIEW.003) ────
export interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  keys: Record<string, unknown>;
  platform: string | null;
  last_seen: string; // ISO-8601
}

/** The `answer_mode` enum (0001_baseline.sql L81) — the pill rendered on every AI-output item (FR-7.VIEW.002.2). */
export type AnswerMode = "cited" | "inferred" | "unknown" | "building";
export const ANSWER_MODES: readonly AnswerMode[] = ["cited", "inferred", "unknown", "building"];
export function isAnswerMode(v: string): v is AnswerMode {
  return (ANSWER_MODES as readonly string[]).includes(v);
}

/** A terminal-status projection of task_queue (silent-failure detector input, LOG.003 — FR-7.VIEW.001.2). */
export interface TaskTerminalRow {
  task_id: string;
  status: "completed" | "failed";
  /** True while the task is still referenced by an open approval/cleanup item — retention must skip it. */
  referenced_open?: boolean;
}
