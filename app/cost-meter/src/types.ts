// ISSUE-074 §5 DATA — the app-code projection of the tables this meter READS/WRITES. Rule 0: the DDL is the
// source of truth (app/silo/migrations/0001_baseline.sql via schema.md §6/§8/§12). Nothing here re-creates
// schema; only the fields the cost meter touches are modelled. This slice READS event_log/task_queue/
// config_values and WRITES a single notifications row (the soft-rung cost_threshold_breach). It NEVER writes
// event_log/task_queue/config_values and NEVER throttles or kills (C7 meters, C6 decides, C5 executes —
// NFR-COST.004).

// ── event_log (schema.md §8, L548-561) ─────────────────────────────────────────────────────────────
// The DDL splits cost into `cost_tokens bigint` (nullable) + `cost_unknown boolean not null default false`
// (AC-7.LOG.004.1 — the sentinel is ≠ 0). ISSUE-011 owns the columns; this meter READS them. The vendor/
// model that priced the event is carried in `payload` (jsonb) — the estimator reads `payload.model` to pick
// the price_table rate. An event with a positive cost but NO resolvable model is a blind cost: the estimator
// treats it as cost_unknown (never a silent 0 or a silent free ride — #3).
export interface EventLogCostRow {
  id: string;
  task_id: string | null; // null for deployment-level events (join to task_queue is left-outer)
  event_type: string; // 'tool_called' | 'memory_written' | ... — not narrowed here (ISSUE-011 owns the enum)
  cost_tokens: number | null; // nullable per the DDL; null WITH cost_unknown=true is the sentinel
  cost_unknown: boolean; // the sentinel flag — true ⇒ this event's cost could not be computed
  /** The pricing tag (vendor/model) the estimator needs to look up a price_table rate. Lives in event_log.
   *  payload (jsonb). Absent/unknown ⇒ the estimator cannot price it ⇒ cost_unknown path (never a silent 0). */
  model?: string | null;
  created_at: string; // ISO-8601, server-authoritative — the window boundary for the daily/weekly meter
}

// ── task_queue (schema.md §6, L469-486) — read-only join for the per-task-type aggregation ──────────
// `type` is the task_type enum ('scheduled'|'event'|'human'|'chained'). The aggregation groups the priced
// event cost by this value (FR-7.COST.002). An event whose task_id does not resolve to a task_queue row is
// bucketed under UNATTRIBUTED_TASK_TYPE — never silently dropped (a lost cost figure would be a #1/#3 risk).
export interface TaskTypeRow {
  task_id: string;
  task_type: string; // task_queue.type
}
export const UNATTRIBUTED_TASK_TYPE = '__unattributed__' as const;

// ── config_values (schema.md §12) — the price_table + cost_ladder_* keys (owned by ISSUE-010) ───────
// price_table is a structured jsonb object: vendor×model → { input, output } $/1k tokens; embeddings carry a
// single `input` $/1k rate (config-registry §App.A #10 / ADR-003 §3). event_log.cost_tokens is a SINGLE token
// count per event (the DDL does not split input/output), so the estimator applies the FAIL-SAFE rate: the
// HIGHER of {input, output} for the model (ADR-003 §3 pt3 — round up, never optimistically pick the cheaper
// side). Rates are $/1k tokens.
export interface ModelPrice {
  input: number; // $ per 1k input tokens (≥ 0)
  output?: number; // $ per 1k output tokens (≥ 0); absent for embeddings (single-rate models)
}
/** price_table: model-id → its per-1k-token rates. Flat model-id keyed (e.g. 'sonnet', 'haiku',
 *  'text-embedding-3-small') — the estimator looks up event.model here. Operator-editable, LIVE (re-bases
 *  estimates without a deploy — AC-7.COST.001.1 / AC-NFR-COST.005.2). */
export type PriceTable = Record<string, ModelPrice>;

/** The four cost-ladder threshold keys (schema.md §12 / config-registry §D / ADR-003 §2 OD-164 naming).
 *  All per-deployment, operator-editable, in USD. daily/weekly soft are deliberately NOT weekly=7×daily. */
export interface CostLadderConfig {
  cost_ladder_soft_threshold_daily_usd: number; // default 50
  cost_ladder_soft_threshold_weekly_usd: number; // default 200
  cost_ladder_throttle_threshold: number; // default 75 (daily)
  cost_ladder_hard_kill_threshold: number; // default 100 (daily)
}

/** The ADR-003 §2 / NFR-COST.001.1 defaults — 50 / 200 / 75 / 100. */
export const LADDER_DEFAULTS: CostLadderConfig = {
  cost_ladder_soft_threshold_daily_usd: 50,
  cost_ladder_soft_threshold_weekly_usd: 200,
  cost_ladder_throttle_threshold: 75,
  cost_ladder_hard_kill_threshold: 100,
};

// ── notifications (schema.md §8, L563-577) — the ONE row this meter writes ───────────────────────────
// The soft-rung cost_threshold_breach alert (FR-7.COST.004 → AC-7.COST.004.1). `type` is the alert_type enum;
// this meter only ever uses 'cost_threshold_breach'. Persisted before any Slack fan-out (FR-7.ALR.006) — the
// meter's job ends at the row.
export const COST_THRESHOLD_BREACH = 'cost_threshold_breach' as const;
export interface NotificationInput {
  type: typeof COST_THRESHOLD_BREACH;
  severity: string;
  title: string;
  body: string;
}
export interface NotificationRow extends NotificationInput {
  id: string;
  created_at: string;
}

// ── The four ladder rungs, in escalation order (NFR-COST.001) ────────────────────────────────────────
// A rung is a NAMED level, not a raw number, so "no rung skipped or silent" (AC-NFR-COST.001.2) is testable.
export const RUNGS = ['soft_daily', 'soft_weekly', 'throttle', 'hard_kill'] as const;
export type Rung = (typeof RUNGS)[number];

/** What C7 does at each rung. `alert` = write the notification (soft rungs); `signal` = emit a breach signal
 *  to the C6 cost-ladder guardrail (throttle/kill) — C7 NEVER enforces (NFR-COST.004). */
export type RungAction = 'alert' | 'signal';

/** The C6 breach signal C7 EMITS on throttle/kill. It is a signal, not an enforcement — C6 decides the
 *  disposition, C5 executes (AC-7.COST.003.2/.3, AC-NFR-COST.004.1). C7 records that it emitted; it does not
 *  pause admission or kill a run. */
export interface LadderBreachSignal {
  rung: 'throttle' | 'hard_kill';
  window: 'daily';
  estimated_usd: number;
  threshold_usd: number;
  emitted_at: string;
  /** ALWAYS false from C7 — the surface/consumer must never read this as "C7 enforced it" (AC-NFR-COST.004.2). */
  enforced_by_c7: false;
}
