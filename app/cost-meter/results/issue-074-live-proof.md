# ISSUE-074 — live proof owed (Stage-3 checkpoint)

The offline half (this package) proves the full COST metering + ladder-signal contract against the
`InMemoryCostMeterStore` reference model. The following require a live client silo + real `event_log`
history and are **owed to the ISSUE-074 Stage-3 checkpoint** (a 💻 full / operator-present session). They
are NOT offline-provable and are deliberately NOT faked here:

| Owed proof | AC(s) | Why live | How to prove |
| --- | --- | --- | --- |
| Real `event_log` spend series crosses each rung | AC-7.COST.003.2, AC-NFR-COST.001.2 | needs real per-event `cost_tokens`/`cost_unknown` rows from a running deployment | run `SupabaseCostMeterStore.meterAndEvaluate(now)` against a seeded silo; confirm the rung set matches the synthetic-series test |
| `price_table` LIVE edit re-bases with no deploy | AC-7.COST.001.1, AC-NFR-COST.005.2 | needs a real `config_values` row + a running process | edit `config_values['price_table']`, re-run the meter, confirm the estimate changes without a restart |
| The soft-rung `cost_threshold_breach` row lands in `notifications` | AC-7.COST.004.1 | needs the live `notifications` table + `alert_type` enum | drive daily spend over $50, confirm exactly one `type='cost_threshold_breach'` row |
| AF-001 viability gate GREEN (≤ ~$20/day typical) | AC-NFR-COST.006.1/.2 | measured by ISSUE-001 spike over a real task + memory write | **already GREEN** — AF-001 PASS $2.09/day (feasibility-register / NFR-COST.006.1, Verified 2026-07-03). The meter's thresholds rest on this; no offline blocker. |

**Fast-follow (behind the fail-safe round-up posture, not blocking this meter):** AF-040/041 (real-task cost
acceptable; $50/$100 defaults realistic), AF-042 (estimate-vs-invoice drift), AF-043 (Haiku gate
self-funding). These ship as live follows under the AF-001 umbrella (issue §4 "Gating spikes").

## The live adapter is authored to the DDL but NOT run

`src/supabase-store.ts` implements the same `CostMeterStore` port against the real schema
(`event_log` §8, `task_queue` §6, `config_values` §12, `notifications` §8). It typechecks and the seam is
real; the proven reference is `InMemoryCostMeterStore`. Do not claim the live paths verified until the
checkpoint records evidence here.
