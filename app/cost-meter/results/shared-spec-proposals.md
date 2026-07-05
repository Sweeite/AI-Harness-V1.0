# ISSUE-074 — shared-spec proposals (for the orchestrator to integrate; NOT written to shared files here)

Per the fan-out prohibitions, this slice does **not** edit `schema.md`, `config-registry.md`, `glossary.md`,
migrations, or any tracker. Everything below is a **proposal / integration note** for the orchestrator.

## 1. NO migration owed

This issue reads `event_log` / `task_queue` / `config_values` and writes `notifications` — all pre-existing
in `0001_baseline` (schema.md §6/§8/§12). **No new migration.** The meter never adds a cost table (OD-P4-05:
derive from `event_log`).

## 2. NO new config keys

The four ladder keys and `price_table` are **owned by ISSUE-010** (config store) and already in
`config-registry.md` §D/§App.A + `schema.md` §12:

- `price_table` (structured object — vendor×model → {input, output} $/1k tokens; embeddings single-rate)
- `cost_ladder_soft_threshold_daily_usd` (50)
- `cost_ladder_soft_threshold_weekly_usd` (200)
- `cost_ladder_throttle_threshold` (75)
- `cost_ladder_hard_kill_threshold` (100)

This meter **reads** them live; it defines no new keys (FR named none).

## 3. Load-bearing modelling decision — how a single `cost_tokens` is priced (needs a reviewer nod)

`event_log.cost_tokens` is a **single** `bigint` per event (schema.md §8 L556), but `price_table` carries a
`{input, output}` pair per model. The estimator therefore applies the **fail-safe higher-of-input/output**
rate to the whole `cost_tokens` count (`estimator.ts::failSafeRatePer1k`). This is the round-up-never-optimistic
posture ADR-003 §3 pt3 mandates (an estimator guarding a kill switch must OVERCOUNT). Two integration notes:

- **Where the model tag comes from:** the estimator reads `event_log.payload->>'model'` (the live adapter) /
  `EventLogCostRow.model` (the port). ISSUE-011's event-writer must populate a `model` field in `payload` on
  every model/tool cost event, or that event reads `cost_unknown` (a *surfaced* blind reading, never a silent
  0). **Proposal:** confirm ISSUE-011 writes `payload.model` for priced events; if not, that is a small
  ISSUE-011 addition, not a schema change.
- **If a future design splits input/output token counts** (two columns on `event_log`), the estimator can
  price each side exactly instead of the fail-safe max. That is a change-control item, not needed for v1.

## 4. C6 breach-signal contract (the seam ISSUE-058 consumes)

C7 emits `LadderBreachSignal` (`types.ts`) on the throttle/kill rungs: `{ rung, window:'daily',
estimated_usd, threshold_usd, emitted_at, enforced_by_c7:false }`. **ISSUE-058** (C6 cost-ladder guardrail,
OD-068 carry-forward) is the consumer that decides the disposition; **C5** executes. This package emits the
signal and **never** throttles or kills (NFR-COST.004). The owed C6 enforcement FR remains a tracked
carry-forward (OD-068 / AC-7.COST.003.3) — this slice does not fill it.
