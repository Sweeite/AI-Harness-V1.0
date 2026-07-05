# ISSUE-075 alerting — proposed shared-spec deltas (for the orchestrator; NOT applied here)

This slice does **not** edit any shared file (schema.md, config-registry.md, PERMISSION_NODES.md, glossary.md,
migrations). The proposals below are for the integration step to reconcile into the shared registry. Every
config key here is a **read** for this slice (the write UI is ISSUE-086); the structured objects are stored as
`config_values.value` JSON per schema.md §12 (they are **not** new tables — no migration is owed by this slice).

## 1. Config keys (config-registry.md — `PERM-config.observability`, Super Admin)

The five keys named in ISSUE-075 §5 CFG. `alert_routing_rules` / `escalation_contacts` / `quiet_hours` are the
**structured objects** already listed in schema.md §12 (L742); `alert_email_enabled` is a scalar knob;
`SLACK_WEBHOOK_URL` is a SECRET (presence-only via `secret_manifest`, never stored in `config_values`).

| Key | Class | Edit class | Shape (proposed) | Notes |
|---|---|---|---|---|
| `alert_routing_rules` | structured object | LIVE | `{ [alert_type]: { role: string, channels: ("slack"\|"email")[] } }` | alert-type → destination. A **critical** alert type (`hard_limit_hit`, `alert_delivery_misconfigured`, `alert_engine_stalled`) with no resolvable destination is **rejected at write time** (AC-7.ALR.009.3). Dashboard is always implicit + durable; `channels` are best-effort fan-out only. |
| `escalation_contacts` | structured object | LIVE | `{ [role: string]: string[] }` | role → ordered chain of contacts (role names or user ids). Drives FR-7.ALR.005 secondary-alert chain + the escalate-don't-drop fallback in routing. |
| `quiet_hours` | structured object | LIVE | `{ enabled: boolean, start_min: 0..1439, end_min: 0..1439 }` | server-clock minute-of-day window (wraps midnight if `start_min > end_min`). Suppresses **only non-critical** alerts (AC-7.ALR.009.2 / OD-097); can never silence a critical/hard-limit alert. |
| `alert_email_enabled` | scalar knob | LIVE | `boolean` (default `false`) | gates the `email` fan-out channel. |
| `SLACK_WEBHOOK_URL` | **SECRET** | SECRET (never UI-editable) | env var; presence-only via `secret_manifest` | best-effort Slack fan-out. A missing/invalid webhook at runtime is surfaced as a delivery-failure (AC-7.ALR.009.4), never fatal to the dashboard row. Add to `secret_manifest` seed if not already present. |

Per-rule threshold knobs (the seven rules, FR-7.ALR.002) — proposed scalar keys under the same
`PERM-config.observability` group (each per-deployment configurable, AC-7.ALR.002.1):

- `alert.task_failure_spike.failures` (int) + `alert.task_failure_spike.window_ms` (int)
- `alert.queue_backup.pending` (int) + `alert.queue_backup.for_ms` (int)
- `alert.memory_confidence_drop.below` (float 0..1)
- `alert.approval_queue_stale.after_ms` (int)
- `alert.cost_threshold_breach.daily` (int tokens) + `alert.cost_threshold_breach.weekly` (int tokens)
- `alert.escalation_window_ms` (int) — the FR-7.ALR.005 escalation window duration
- `hard_limit_hit` has **no** threshold knob and **no** suppress toggle (always-on, AC-7.ALR.002.2).

## 2. Enum / schema deltas

**None owed by this slice.** `notifications.type` (`alert_type` enum) and the `event_type` enum already carry
every value this slice writes (`alert_delivery_misconfigured`, `alert_engine_stalled`, `hard_limit_hit`,
`guardrail_hit`, the six threshold-rule event types) — confirmed against `app/silo/migrations/0001_baseline.sql`
(L141-144 `alert_type`, L60-65 `event_type`) and `spec/04-data-model/schema.md` §8/§12. No migration is authored.

## 3. Permission nodes

**None new.** Reuses `PERM-config.observability` (routing/escalation/quiet-hours read+write authority, ISSUE-075
§5 PERM). Recipient authority stays with the C1 role model (this slice routes *to* a role; C1 owns who holds it).

## 4. Seams consumed (not authored here)

- **ISSUE-011** owns `event_log` (append-only trigger) + the alert-engine heartbeat/watchdog. This slice appends
  alert rows to `event_log` and latches the `alert_delivery_misconfigured` mgmt-plane health bit onto the same
  watchdog/push path (AC-7.ALR.009.1). The `HealthBitChannel` here is the seam; ISSUE-012 carries the push.
- **ISSUE-086** owns the config-admin write UI — it must call `validateConfigOrReject()` on Save (AC-7.ALR.009.3).
- **ISSUE-073 / 078 / 079** render the notification centre (data/state contract only, here).
