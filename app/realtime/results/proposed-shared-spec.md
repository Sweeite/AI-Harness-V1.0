# ISSUE-076 — proposed shared-spec deltas (config keys)

> **Proposal only.** Per the fan-out hard prohibitions, this slice does NOT edit the shared config-registry,
> schema.md, or glossary. These are the config keys ISSUE-076 *reads* (§5 CFG); the orchestrator integrates
> them into `spec/02-config/config-registry.md` / `config_values`. NO migration, NO new table — this slice
> reads `notification_source`/`task_queue` states and `config_values`; it creates nothing.

## 1. Per-surface polling cadences (FR-7.RTP.002 → AC-7.RTP.002.1/.2)

All six are **LIVE** (change with no code change, no rebuild), stored in `config_values.value` (jsonb int,
seconds), read at their documented default when unset. Defaults are the component-07 FR-7.RTP.002 values
(L434–436).

Key names below are the LITERAL `pollIntervalKey` string each surface uses in `app/realtime/src/surfaces.ts`
`SURFACE_CATALOGUE` (session 72 fix: this table previously drifted from the shipped code — `poll_interval_*
_seconds` here vs `polling_interval_*_s` in the code — a config write following this doc would silently land
on a key `loadConfig()` never reads, indistinguishable from "correctly using the default"). If the registry
ever renames these, update `surfaces.ts` FIRST and this table to match — never the reverse.

| config key | surface | type | default (seconds) | class | AC |
|---|---|---|---|---|---|
| `polling_interval_health_metrics_s`       | health metrics       | int > 0 | 30  | LIVE | AC-7.RTP.002.1/.2 |
| `polling_interval_event_log_s`            | event log            | int > 0 | 60  | LIVE | AC-7.RTP.002.1/.2 |
| `polling_interval_memory_health_s`        | memory health        | int > 0 | 300 | LIVE | AC-7.RTP.002.1/.2 |
| `polling_interval_self_improvement_s`     | self-improvement     | int > 0 | 600 | LIVE | AC-7.RTP.002.1/.2 |
| `polling_interval_cost_tracking_s`        | cost tracking        | int > 0 | 300 | LIVE | AC-7.RTP.002.1/.2 |
| `polling_interval_agent_health_s`         | agent health         | int > 0 | 60  | LIVE | AC-7.RTP.002.1/.2 |

Notes:
- Key names are the slug the reference model uses (`app/realtime/src/surfaces.ts` `SURFACE_CATALOGUE`). If
  the registry prefers a different naming convention (e.g. a `realtime.` prefix), only the string constant in
  `surfaces.ts` needs to change — the contract is unaffected.
- An UNSET key MUST return "no value" (not 0) so the documented default applies — a missing cadence must
  never read as "poll never" (#3). The live adapter (`supabase-store.ts` `loadConfig`) enforces this: a null
  / absent `config_values` row leaves the surface on its default.

## 2. Connection-budget headroom threshold (FR-7.RTP.003 / NFR-PERF.011 → AC-7.RTP.003.2)

| config key | type | default | range | class | AC |
|---|---|---|---|---|---|
| `realtime_connection_headroom_threshold` | int | 80 | 1–100 (percent of the per-silo cap) | LIVE | AC-7.RTP.003.2, AC-NFR-PERF.011.1 |

- Semantics: a **non-trust-critical** Realtime subscription degrades to polling once live Realtime
  connections reach `floor(threshold% × cap)` — i.e. **before** the hard cap. The two trust-critical
  surfaces (approval queue + notification centre) are prioritised: they may use the **full cap** and are the
  **last** to degrade (AC-NFR-PERF.011.2).
- Per-silo cap is the Supabase project tier ceiling (Free ~200 / Pro ~500 concurrent) — a deploy-time
  property of the silo, not a `config_values` key (it is the tier, not a knob). Modelled in
  `surfaces.ts` `SILO_CAP`; the orchestrator may choose to expose it as a `realtime_silo_cap` override key
  if a deployment needs to pin it — **not required** by any AC here.
- Validation: reject a value outside 1–100 (never silently clamp to a wrong budget) — enforced in
  `effectiveThresholdPercent`.

## 3. What this slice does NOT add

- **No migration, no new table.** The two Realtime subscriptions read existing stores: `task_queue`
  (`awaiting_approval` rows — C5-owned) and `notifications` (table shell owned by ISSUE-011). Both seed
  selects carry an intra-silo predicate only, **no `client_slug`** (ADR-001 §3, reconciliation #1 →
  AC-7.RTP.003.3).
- **No new PERM node.** RTP is a transport/freshness layer; each surface it feeds enforces its own C1 read
  grant.
