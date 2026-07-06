# ISSUE-051 (loops-heartbeat) — proposed shared-spec deltas

Deltas this slice needs the orchestrator to apply SERIALLY after the fan-out. This slice touched ONLY
`app/loops-heartbeat/`; everything below is a described delta to a shared artifact (never edited here).

## 1. Config keys (config_values §12) — ADD (config-registry.md + schema.md §12 doc)

The loop layer CONSUMES these keys; ISSUE-051 does not own the registry. Add to the config registry with the
documented defaults and classes (all **BOOT** class — a cadence/loop change takes effect at next deployment boot,
per ADR-005 Inngest cron-registered-at-boot; FR-5.LOP.002).

| key | class | default (jsonb) | notes |
|---|---|---|---|
| `loop_cadence_fast` | BOOT | `"*/10 * * * *"` | cron string; resolved interval must fall in the fast range **5–15 min** (FR-5.LOP.001 / NFR-PERF.010). |
| `loop_cadence_medium` | BOOT | `"0 */2 * * *"` | cron string; range **1–4 h**. |
| `loop_cadence_slow` | BOOT | `"0 8 * * *"` | cron string; range **daily–weekly** (08:00 daily default). |
| `loop_task_lists` | BOOT | (structured object, below) | the documented per-loop named task lists (FR-5.LOP.001). |
| `loop_definitions_additional` | BOOT | `[]` | config-extensible extra loops (name, class, cadence, cron, taskList) — registered at boot with NO code change (FR-5.LOP.002). |
| `loop_failure_heartbeat_threshold` | BOOT | `3` | consecutive-failure count that trips the loop-failure heartbeat (FR-5.LOP.005). |

`loop_task_lists` default object (documented task lists — FR-5.LOP.001):
```json
{
  "fast":   ["urgent_triggers", "new_leads", "flagged_messages", "overdue_tasks"],
  "medium": ["queued_tasks", "pending_memory_writes", "stale_approvals"],
  "slow":   ["consolidation", "summaries", "memory_health", "self_improvement", "insight_runs"]
}
```

These keys live under the existing `PERM-config.*` RLS group (ISSUE-010) — **no net-new permission node**
(issue §5 PERM: none). Verify-present: the `config_values` table + key-prefix RLS already exist (0001_baseline.sql
L626); this is a registry/doc addition, not a DDL change.

## 2. event_type enum — VERIFY-PRESENT (no change)

This slice emits onto `event_log` using only enum values already present in the baseline
(`app/silo/migrations/0001_baseline.sql` L60–65):
- `loop_missed` — the detected-missed-window signal (present ✓).
- `task_failure_spike` — reused as the three-consecutive-failure loop-failure heartbeat alert seam to C7 (present ✓).
- `task_completed` / `task_failed` — the per-run outcome log rows (present ✓).

**No new enum value is required.** If a future reviewer prefers a dedicated `loop_failure` event_type rather than
reusing `task_failure_spike`, that is an additive expand-contract enum change (a shared-spec delta), NOT built here
— flagged for consideration, not required for the ACs.

## 3. RLS / trigger / CHECK / index — NONE

`event_log` is append-only and C7-owned (ISSUE-011); this slice only INSERTs. No RLS policy, trigger, CHECK, or
index is added by ISSUE-051. Verify-present: `event_log` DDL exists (0001_baseline.sql L483).

## 4. No new table

All tables read (`task_queue`, `task_graph_versions`) and written (`event_log`) exist in the baseline. No
create-table / create-type migration authored (isolation rule honoured).

## 5. tsconfig `paths` note (informational — no shared change)

`app/loops-heartbeat/tsconfig.json` maps `@harness/task-queue` → `../task-queue/src/store.ts` (type-only import of
`TaskQueue`/`TaskType`, erased at runtime by tsx). No root workspace/tsconfig change needed; the sibling is
consumed via a local `file:../task-queue` dependency + a paths mapping, matching the house standalone-package shape.
