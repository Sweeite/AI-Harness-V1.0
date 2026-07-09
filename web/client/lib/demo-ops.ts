// ISSUE-078 — the seeded signals for the surface-05 Operations dashboard (nine polled panels). These stand
// in for the C7 observability producers' real reads (event_log / task_queue / guardrail_log / cost meter),
// rendered through the honest seam on the dev-auth path. NO client_slug anywhere (ADR-001 §3 — single-tenant
// silo). Each panel carries its own RBAC node, poll cadence label, and default honest-state so the never-
// false-healthy discipline is visible: a genuine 0 (DLQ) reads "0", a stale panel reads "stale as-of …", a
// can't-confirm read reads "—", never a fabricated healthy value.
//
// ⚠️ Panel→node MAP is OD-121 (unresolved build artifact). These are the FIRM-catalog baseline assignments
// (every node below is a real app/rbac CATALOG node — no invented permission). The Finance "Cost-only" split
// is the unresolved part of OD-121 and is noted on the surface, not fabricated here.

import type { Sim } from './domain-seam.ts';

export interface PanelMetric { label: string; value: string; tone?: 'ok' | 'stale' | 'error' | 'unknown' }
export interface PanelRow { text: string; meta?: string; tone?: 'ok' | 'stale' | 'error' | 'unknown' }
export interface PanelPayload { metrics?: PanelMetric[]; rows?: PanelRow[]; note?: string }

export interface PanelDef {
  id: string;
  title: string;
  node: string; // a REAL app/rbac catalog node — absent ⇒ panel is ABSENT, not empty (AC-7.VIEW.002.1)
  poll: string; // the config-key cadence label (FR-7.RTP.002)
  /** default honest-state for THIS panel on the dev build (the range shown at a glance). */
  defaultSim?: Sim;
  emptyMsg: string; // the GENUINE-empty copy (distinct from error/stale)
  data: PanelPayload;
  /** true ⇒ carries the OD-198 ③ producer-RLS residual (false-healthy-0 on real authed data until it lands). */
  od198?: boolean;
}

export const OPS_PANELS: PanelDef[] = [
  {
    id: 'system-health', title: 'System Health', node: 'PERM-dashboard.ops', poll: 'polling_interval_health_metrics_s · 30s',
    emptyMsg: 'No activity yet — the system hasn’t run a task.',
    data: { metrics: [
      { label: 'Loops running', value: '3 / 3', tone: 'ok' },
      { label: 'Queue depth', value: '4 ↘', tone: 'ok' },
      { label: 'Task success rate', value: '98.2%', tone: 'ok' },
      { label: 'Pending approvals', value: '2' },
      { label: 'Connectors', value: '5 connected · 1 degraded', tone: 'stale' },
      { label: 'Agents', value: '11 healthy · 1 flagged', tone: 'stale' },
    ] },
  },
  {
    id: 'failure-health', title: 'Failure Health', node: 'PERM-dashboard.ops', poll: 'polling_interval_health_metrics_s · 30s',
    emptyMsg: 'No failures in the selected window. No silent-failure tasks detected.',
    data: { metrics: [
      { label: 'Failures (24h)', value: '3' },
      { label: 'Silent-failure tasks', value: '0', tone: 'ok' },
      { label: 'Failure-spike tracker', value: '2 / 5 in 30m', tone: 'ok' },
    ], rows: [
      { text: 'task_failed — connector timeout (GHL)', meta: '09:12 · task 4a1c', tone: 'error' },
      { text: 'guardrail_hit — rate limit (Slack)', meta: '08:40 · task 39f2', tone: 'stale' },
    ] },
  },
  {
    id: 'connector-health', title: 'Connector Health', node: 'PERM-tool.manage', poll: 'polling_interval_health_metrics_s · 30s',
    defaultSim: 'stale',
    emptyMsg: 'No connectors connected. Add one in Settings → Connectors.',
    data: { rows: [
      { text: 'Google Workspace — connected', meta: 'last call 2m ago · token expires 14d', tone: 'ok' },
      { text: 'Slack — degraded (re-arm failed)', meta: 'last call 41m ago', tone: 'stale' },
      { text: 'GoHighLevel — token expires 5d', meta: 'headroom 62%', tone: 'stale' },
    ], note: 'Token material is never shown (FR-3.TOK.001).' },
  },
  {
    id: 'memory-health', title: 'Memory Health', node: 'PERM-dashboard.ops', poll: 'polling_interval_memory_health_s · 300s',
    emptyMsg: 'Memory is still building. Health signals appear as the brain fills.',
    data: { metrics: [
      { label: 'Erosion-risk entities', value: '4' },
      { label: 'Amber-confidence share', value: '12%' },
      { label: 'Coverage', value: '[Building]', tone: 'stale' },
      { label: 'Maintenance queue', value: '7' },
    ] },
  },
  {
    id: 'event-log', title: 'Event Log', node: 'PERM-dashboard.ops', poll: 'polling_interval_event_log_s · 60s', od198: true,
    emptyMsg: 'No events in this range.',
    data: { rows: [
      { text: 'task_completed — weekly report generated', meta: '09:20 · 4.1s · 1,203 tokens' },
      { text: 'memory_written — client preference updated', meta: '09:18 · 0.3s · cost unknown', tone: 'stale' },
      { text: 'approval_requested — send external email', meta: '09:15 · —' },
    ], note: 'Payloads never contain tokens/secrets (FR-7.LOG.005).' },
  },
  {
    id: 'dlq', title: 'Dead-Letter Queue', node: 'PERM-ops.dlq_manage', poll: 'polling_interval_health_metrics_s · 30s', od198: true,
    emptyMsg: 'No dead-lettered tasks. Everything that failed was recovered or never exhausted its retries.',
    // A GENUINE zero — renders "0", the healthy state (distinct from a fetch failure which would render "—").
    data: { metrics: [{ label: 'Dead-lettered tasks', value: '0', tone: 'ok' }, { label: 'Unattended past stale age', value: '0', tone: 'ok' }] },
  },
  {
    id: 'cost', title: 'Cost Tracking', node: 'PERM-dashboard.ops', poll: 'polling_interval_cost_tracking_s · 300s',
    emptyMsg: '$0.00 estimated — no billable activity yet.',
    data: { metrics: [
      { label: 'Today (estimate)', value: '$12.40 est.' },
      { label: 'This week (estimate)', value: '$71.90 est.' },
      { label: 'Cost-ladder rung', value: 'soft ($50/d)', tone: 'stale' },
      { label: 'Blind-meter (cost unknown)', value: '3 events' },
    ], note: 'Every figure is an estimate (ADR-003) — token count × price table, rounded up. Never an invoice. Enforcement (throttle/hard-kill) is C6/C5, not this panel.' },
  },
  {
    id: 'guardrail-log', title: 'Guardrail Log', node: 'PERM-dashboard.ops', poll: 'polling_interval_health_metrics_s · 30s',
    emptyMsg: 'No guardrail events in this window.',
    data: { rows: [
      { text: 'rate_limit — Slack burst blocked', meta: 'blocked · 08:40', tone: 'stale' },
      { text: 'approval_gate — external email held', meta: 'pending · 09:15' },
      { text: 'hard_limit — cost ceiling (never approvable)', meta: 'blocked · 06:02', tone: 'error' },
    ] },
  },
  {
    id: 'self-improvement', title: 'Self-Improvement', node: 'PERM-dashboard.ops', poll: 'polling_interval_self_improvement_s · 600s',
    emptyMsg: 'Not enough history yet to surface improvements.',
    data: { metrics: [
      { label: 'Drift flags', value: '1', tone: 'stale' },
      { label: 'Dead-agent flags', value: '0', tone: 'ok' },
      { label: 'Routing-mismatch', value: '1' },
      { label: 'Insight suggestions', value: '3' },
    ], note: 'Everything here is flag-and-suggest — nothing auto-acts. Suggestions are displayed (C9), not generated here.' },
  },
];
