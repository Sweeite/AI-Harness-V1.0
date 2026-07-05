// ISSUE-060 §5 — the guardrail_log / injection_quarantine row shapes + the C6 enums, authored to
// schema.md §7 Guardrails + §Types. These mirror the DDL in results/proposed-migration-0009_guardrails.sql
// exactly (enums first, then the two tables). The InMemory stores (store.ts) re-implement every invariant the
// DDL enforces so the offline tests prove the SAME guarantees the DB would (append-only trigger, the
// hard_limit!=approved check constraint, the FK, and the five-value guardrail_type domain).
//
// Phase-4 note (OD-096 / FR-10.ISO.001): `client_slug` is DELETED — it is NOT a column on either table (it
// lives only in the mgmt-plane client_registry). Isolation is silo-per-client, not a label column.

// ── §Types enums (schema.md L120-122) ────────────────────────────────────────────────────────────────

/** The five guardrail classes every C6 slice writes (schema.md L120). Blank/unknown is never valid. */
export const GUARDRAIL_TYPES = [
  "hard_limit",
  "approval_gate",
  "anomaly",
  "rate_limit",
  "prompt_injection",
] as const;
export type GuardrailType = (typeof GUARDRAIL_TYPES)[number];

/** The per-event review state (schema.md L121). `pending` covers ALL unresolved states, disambiguated by
 *  guardrail_type (AC-6.LOG.001.3); `modified` = FR-6.ESC.003 modify resolution. */
export const GUARDRAIL_STATUSES = ["pending", "approved", "rejected", "modified"] as const;
export type GuardrailStatus = (typeof GUARDRAIL_STATUSES)[number];

/** The terminal states a forward status transition may reach (append-only trigger whitelist, schema.md L61). */
export const RESOLVED_STATUSES = ["approved", "rejected", "modified"] as const;
export type ResolvedStatus = (typeof RESOLVED_STATUSES)[number];

/** The human quarantine verdict (schema.md L122). `null` = pending review; the content is NEVER discarded
 *  by machine (shadow-retain, ADR-007 part 4). */
export const QUARANTINE_DECISIONS = ["discard", "approved_safe"] as const;
export type QuarantineDecision = (typeof QUARANTINE_DECISIONS)[number];

export function isGuardrailType(v: string): v is GuardrailType {
  return (GUARDRAIL_TYPES as readonly string[]).includes(v);
}
export function isGuardrailStatus(v: string): v is GuardrailStatus {
  return (GUARDRAIL_STATUSES as readonly string[]).includes(v);
}
export function isResolvedStatus(v: string): v is ResolvedStatus {
  return (RESOLVED_STATUSES as readonly string[]).includes(v);
}
export function isQuarantineDecision(v: string): v is QuarantineDecision {
  return (QUARANTINE_DECISIONS as readonly string[]).includes(v);
}

// ── §7 guardrail_log row (schema.md L517-529) ────────────────────────────────────────────────────────

export interface GuardrailLogRow {
  id: string;
  task_id: string | null; // references task_queue(id); nullable (schema.md L519)
  guardrail_type: GuardrailType;
  description: string; // plain-English; not null (schema.md L521)
  action_blocked: boolean; // not null (schema.md L522)
  status: GuardrailStatus; // default 'pending' (schema.md L523)
  reviewed_by: string | null; // references profiles(id)
  reviewed_at: string | null; // ISO-8601
  escalated_at: string | null; // ⊕ net-new, server-owned (schema.md L526)
  created_at: string; // ISO-8601, server-authoritative
}

/** The caller's intent when a guardrail acts — the writer stamps id/status/created_at server-side. */
export interface GuardrailEventInput {
  task_id?: string | null;
  guardrail_type: GuardrailType;
  description: string;
  action_blocked: boolean;
}

// ── §7 injection_quarantine row (schema.md L531-542) ─────────────────────────────────────────────────

export interface QuarantineRow {
  id: string;
  guardrail_log_id: string; // FK -> guardrail_log(id); not null (schema.md L533)
  quarantined_content: string; // never machine-discarded (schema.md L534)
  source_tool: string;
  source_record_id: string | null;
  human_decision: QuarantineDecision | null; // null = pending
  reviewed_by: string | null;
  reviewed_at: string | null;
  escalated_at: string | null;
  created_at: string;
}

// ── The whitelisted forward resolution (schema.md L61 trigger branch) ────────────────────────────────

/** The ONLY mutation the append-only trigger permits on guardrail_log: pending -> a resolved status, with
 *  description + task_id UNCHANGED, timestamped/attributed. Nothing else may be rewritten. */
export interface Resolution {
  status: ResolvedStatus;
  reviewed_by: string;
  reviewed_at: string;
}
