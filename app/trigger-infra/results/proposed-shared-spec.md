# ISSUE-037 (trigger-infra) — proposed shared-spec deltas (owed to change-control)

This slice touched ONLY `app/trigger-infra/`. It authored **no** `app/silo/migration` and edited **no**
shared file (`schema.md`, `config-registry.md`, `PERMISSION_NODES.md`, any migration, any root file). The
deltas below are what the live integration owes; the orchestrator applies them SERIALLY through
change-control (next free migration tag is the orchestrator's to assign — this worktree's head was 0010;
the prompt's contract says 0018). Same change-control class as OD-170 / OD-179 (an FR mandates an
`event_log` write but the enum admits no matching value).

---

## 1. `event_type` enum — nine additive values (append-only, expand-contract-safe)  ⟵ REQUIRED

`schema.md` §4/§Types `event_type` (baseline `0001_baseline.sql` L60-70, extended additively by
`0007_stage3_event_types.sql`) has **no** value for the trigger-lifecycle events FR-3.TRIG.001/002/005/006
mandate this slice write into the append-only `event_log`. All nine are additive (never renamed/removed),
so they are expand-contract-safe exactly like OD-179's webhook values.

| value | emitted by | FR / AC |
|-------|-----------|---------|
| `trigger_inbound` | `handleInbound` — a verified event received + parsed → evaluation | FR-3.TRIG.001 / AC-3.TRIG.001.1 |
| `trigger_parse_failed` | `handleInbound` — a malformed payload rejected-and-logged (never silent) | FR-3.TRIG.001 / AC-3.TRIG.001.2 |
| `trigger_fired` | `handleInbound` — a matched rule launched a task | FR-3.TRIG.002 / AC-3.TRIG.002.1 |
| `watch_rearmed` | `runWatchRearm` — a watch re-armed before lapse, new expiry persisted | FR-3.TRIG.005 / AC-3.TRIG.005.1 |
| `watch_rearm_failed` | `runWatchRearm` — a failed/missed re-arm → connector degraded (loud) | FR-3.TRIG.005 / AC-3.TRIG.005.2 |
| `event_gap_detected` | `runReconciliationSweep` — events since the watermark = a delivery gap | FR-3.TRIG.006 / AC-3.TRIG.006.1/.3 |
| `event_gap_reconciled` | `runReconciliationSweep` — the gap re-read + re-ingested, watermark advanced | FR-3.TRIG.006 / AC-3.TRIG.006.1 |
| `delivery_degraded` | `runReconciliationSweep` — 2xx rate approaching the 95%/60min wall → degraded | FR-3.TRIG.006 / AC-3.TRIG.006.2 |
| `reconcile_sweep_failed` | `runReconciliationSweep` — the sweep itself could not run; gap NOT assumed empty | FR-3.TRIG.006 edge (#3) |

Proposed migration (orchestrator-owned; NOT authored into `app/silo` here):

```sql
-- additive; expand-contract-safe (cf. OD-170 / OD-179 / migration 0007)
alter type event_type add value if not exists 'trigger_inbound';
alter type event_type add value if not exists 'trigger_parse_failed';
alter type event_type add value if not exists 'trigger_fired';
alter type event_type add value if not exists 'watch_rearmed';
alter type event_type add value if not exists 'watch_rearm_failed';
alter type event_type add value if not exists 'event_gap_detected';
alter type event_type add value if not exists 'event_gap_reconciled';
alter type event_type add value if not exists 'delivery_degraded';
alter type event_type add value if not exists 'reconcile_sweep_failed';
```

Until applied, `SupabaseTriggerStore.logEvent`'s `$2::event_type` cast raises **loudly** on the live silo
(never a silent skip — #3), and the `InMemoryTriggerStore.logEvent` reference model rejects any value
outside `TRIGGER_EVENT_TYPES` — so the missing delta cannot hide offline OR live (anti-drift).

**Interaction with the C7 observability projection:** whatever `EVENT_TYPES` list `app/observability`
carries must gain these nine too (the same reconciliation OD-179 did for the webhook values). Flagged for
the orchestrator; this slice does not edit that package.

---

## 2. `tools.config` jsonb sub-tree — the trigger-config carrier (verify-present)  ⟵ NO DDL CHANGE

Per issue §5 + `schema.md` §4 schema-note, there is **no dedicated `trigger_config` / `watch_state` /
`event_watermark` table** — trigger definitions, default-set enable/disable flags, watch/subscription
state, per-channel watermarks, delivery samples, and the dedup ledger **ride in `tools.config` jsonb**.
The `tools` table already exists (`0001_baseline.sql` L304-322 + `0008_connector_runtime_triggers.sql`);
**verify-present, no DDL change**. This slice homes the config on a per-connector **carrier tool row**
(`name = '<connector>__triggers'`, `category='read'`) and reads/writes exactly this sub-tree:

```jsonc
// tools.config for a '<connector>__triggers' row
{
  "defaults":       [ { "eventName": "...", "availableFields": ["..."], "enabled": true } ],
  "rules":          [ { "id": "rule-1", "connector": "...", "eventName": "...",
                        "conditions": [ { "field": "...", "op": "eq|neq|exists|in", "value": "..." } ],
                        "taskName": "...", "enabled": true } ],
  "watches":        [ { "connector": "...", "kind": "gmail|drive_files|drive_changes|calendar",
                        "channelId": "...", "resourceId": "...", "expiresAt": 1800000000, "degraded": false } ],
  "watermarks":     [ { "connector": "...", "channel": "...", "position": "ts-… | historyId", "updatedAt": 1800000000 } ],
  "deliverySample": { "connector": "...", "successRate": 0.99, "updatedAt": 1800000000 },
  "seenEventIds":   [ "deliveryId | event_id | messageId", "..." ]
}
```

If a future builder finds jsonb insufficient (e.g. the `seenEventIds` dedup ledger or the watermark set
grows unbounded and needs its own indexed table), **that is a schema gap to raise via change-control
against the migration harness (ISSUE-008)** — NOT to improvise here (issue §5). Recorded as a known
scaling watch-item, not a blocker for the generic mechanism.

**Provisioning dependency:** the `<connector>__triggers` carrier row must be seeded when a connector is
provisioned (owned by the connector registry, ISSUE-032). `SupabaseTriggerStore.writeBlob` fails **loud**
if the carrier is absent (never a silent config no-op). Flagged for ISSUE-039/040/041 wiring.

---

## 3. Config keys (config-registry.md) — verify-present / additive  ⟵ REQUIRED IF ABSENT

Two CFG keys are named by FR-3.TRIG.005/006 (issue §5 CFG). This slice ships their per-connector defaults
in code (`config.ts` `CFG_WATCH_REARM_LEAD_MINUTES`, `CFG_EVENT_RECONCILIATION_SWEEP_MINUTES`); the
registry entry is owed so an operator can override per deployment:

| key | default (per-connector) | constraint | FR |
|-----|-------------------------|-----------|----|
| `CFG-watch_rearm_lead_minutes` | google=360 (6h); slack/ghl=0 (n/a — non-expiring) | MUST be < the shortest watch TTL (Drive `files` = 1 day) | FR-3.TRIG.005 |
| `CFG-event_reconciliation_sweep_minutes` | slack=15; google=30; ghl=0 (durable-queue) | > 0 for connectors with a history sweep | FR-3.TRIG.006 |

Verify-present in `config-registry.md`; if absent, add additively (orchestrator-owned). No behaviour in
this slice reads the registry directly — the code defaults are the fallback and the anti-drift source.

---

## 4. `audit` sink columns (verify-present)

`SupabaseTriggerStore.writeAudit` inserts `(action, actor, connector, detail)`. The concrete C7 audit /
`access_audit` table column mapping is reconciled at live-integration time; if the live table's columns
differ, the adapter's INSERT is the single place to reconcile (flagged, not guessed). No new table.

---

## Summary

- **REQUIRED additive migration:** the nine `event_type` values (§1) — expand-contract-safe.
- **verify-present, no DDL:** the `tools` table + its `config` jsonb sub-tree (§2); the `audit` sink (§4).
- **REQUIRED-if-absent additive:** the two CFG keys (§3).
- **No** create-table / create-type / RLS / trigger migration authored by this slice.
