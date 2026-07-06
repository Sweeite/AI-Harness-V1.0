---
id: ISSUE-074
title: Cost meter + per-task aggregation + ladder signal
epic: J — observability
status: done
github: "#74"
---

# ISSUE-074 — Cost meter + per-task aggregation + ladder signal

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Build the C7 cost meter — the estimate-grade token→$ running spend total (all vendors, fail-safe rounded-up), the per-task-type aggregation from day one, and the four-rung cost-ladder trigger that fires the soft alert and emits the throttle/kill breach signal — **metering + signalling only**; C6 decides and C5 executes the throttle/kill.

## 2. Scope — in / out
**In:**
- The token→$ cost estimator: computes each figure from `event_log.cost_tokens × config_values['price_table']` over **all vendors** (Sonnet + Haiku + OpenAI embeddings), fail-safe **rounded up** (counts retries, no optimistic cache/batch discount), surfaced honestly as an estimate — never the vendor invoice (FR-7.COST.001).
- Per-task-type cost aggregation, queryable/groupable by task type, populated from the **first** task (not retrofitted) — the ROI substrate + benchmarking feed (FR-7.COST.002; feeds FR-7.OPT.002 substrate, referenced not built here).
- The running per-deployment spend meter + the four-rung ladder trigger: detect each rung breach against the per-deployment-configurable thresholds; on the soft rung fire the cost-threshold-breach alert; on throttle/kill **emit a breach signal to the C6 cost-ladder guardrail** — C7 does not itself throttle or kill (FR-7.COST.003, FR-7.COST.004).
- The `cost_unknown` sentinel path on the meter: an event whose cost could not be computed reads the sentinel, never a silent `0`, so a blind/dark meter is detectable (FR-7.COST.001 rests on AC-7.LOG.004.1; the sentinel column itself is owned by ISSUE-011).

**Out:**
- The cost-ladder **enforcement mechanism** — pausing non-critical admission (throttle) and hard-killing a run: a **C6 cost-ladder guardrail FR** (owed carry-forward, OD-068 / AC-7.COST.003.3) decided by C6 and executed by the C5 harness — **ISSUE-058** owns the C6 rate-limit-guardrail + cost-ladder enforcement side; this issue emits the signal it consumes.
- `event_log` schema, the `cost_tokens`/`cost_unknown` columns, the append-only invariant, and the per-event cost/duration capture (FR-7.LOG.004): **ISSUE-011** (observability skeleton) owns these; the meter reads them.
- The `price_table` / `cost_ladder_*` config keys' storage + registry: **ISSUE-010** (config store) owns the store; this issue reads the values live.
- The per-route cost model that C8 emits (FR-8.COST.003): **ISSUE-066** consumes the aggregate; C8 authors the model. Ops cost dashboard rendering (surface-05) and the Super Admin cross-deployment cost overview: Phase 3 / **ISSUE-078**; C7 owns the data contract, not the render.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-7.COST.001, FR-7.COST.002, FR-7.COST.003, FR-7.COST.004 (all Component 7 — Observability).
- **NFRs:** NFR-COST.005 (fail-safe token estimate, never invoice), NFR-COST.010 (per-task-type from day one; re-rank/HyDE off-by-default), NFR-COST.001 (four-rung ladder — meter/signal half), NFR-COST.004 (C7-meters / C6-decides / C5-executes ownership split), NFR-COST.006 (≤ ~$20/day viability target — the AF-001 gate).
- **Rests on:** ADR-003 §2 (the ladder), §3 (fail-safe token estimate source of truth), §7 (viability target + lever order), OD-068 (decide/execute ownership); OD-P4-05 (no separate cost table — derive from `event_log`); AF-001, AF-040, AF-041, AF-042, AF-043, AF-035.

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-7.COST.001.1, AC-7.COST.001.2 (FR-7.COST.001 — operator-editable price table re-bases; labelled estimate, never invoice)
- AC-7.COST.002.1, AC-7.COST.002.2 (FR-7.COST.002 — groupable by task type; populated from the first task)
- AC-7.COST.003.1, AC-7.COST.003.2, AC-7.COST.003.3 (FR-7.COST.003 — three thresholds configurable; soft→alert, throttle/kill→C6 breach signal; decide/execute seam bilateral)
- AC-7.COST.004.1 (FR-7.COST.004 — daily/weekly over-threshold raises a dashboard notification)
- AC-NFR-COST.005.1, AC-NFR-COST.005.2 (estimate all-vendors rounded-up, never invoice; price change re-bases without deploy)
- AC-NFR-COST.010.1 (per-task-type aggregation from the first task, groupable)
- AC-NFR-COST.001.1, AC-NFR-COST.001.2 (four rungs exist at defaults 50/200/75/100, per-deployment editable; no rung skipped or silent)
- AC-NFR-COST.004.1, AC-NFR-COST.004.2 (C7 emits signal / C6 decides / C5 executes; ops surface lights the rung but never claims it enforced)
- **Gating spikes (if any):** **AF-001 must be GREEN** before this issue ships — proven by **ISSUE-001** (cost-viability spike, per backlog "074 blocked-by 001(spike)" + OD-157 / RP-1). AF-001 measures a real end-to-end task + memory write and confirms typical volume lands ≤ ~$20/day, under the $50 soft alert (AC-NFR-COST.006.1); if it lands above, the COST.007 lever order is pulled before raising the ceiling (AC-NFR-COST.006.2). AF-040/041 (real-task cost acceptable; the $50/$100 defaults realistic) and AF-042 (estimate-vs-invoice drift) / AF-043 (Haiku gate self-funding) are **fast-follow** under the AF-001 umbrella — they ship behind the fail-safe round-up posture, not blocking this meter.

## 5. Touches (complete blast radius, by ID)
- **DATA:** DATA-event_log (reads `.cost_tokens`, `.cost_unknown`, `.task_id`, `.event_type`, `.created_at`; append-only, not written by this issue), DATA-task_queue (join for `task_type` on the per-task-type aggregation), DATA-config_values (reads `price_table` + the `cost_ladder_*` threshold keys), DATA-notifications (writes the soft-rung cost-threshold-breach row via the C7 notification path), DATA-guardrail_log (the hard-kill `rate_limit`-class row is written by C6/C5 on enforcement — referenced, not written here). No separate cost table (OD-P4-05).
- **PERM:** PERM-config.observability (Super Admin — cost-threshold / price-table config surface, read by the meter live). No new node created here.
- **CFG:** `price_table` (vendor×model→$/token, incl. `text-embedding-3-small`; LIVE-editable, re-bases estimates), `cost_ladder_soft_threshold_daily_usd` (50), `cost_ladder_soft_threshold_weekly_usd` (200), `cost_ladder_throttle_threshold` (75), `cost_ladder_hard_kill_threshold` (100) — all per-deployment, operator-editable (see ADR-003 §2 OD-164 naming reconciliation).
- **UI:** none built here — the ops cost dashboard (surface-05, ladder state + per-task-type trend) and Super Admin cost overview render this contract in Phase 3 / ISSUE-078. C7 owns the data + signal.
- **Connectors:** none.

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-07-observability.md — the FR text + ACs (COST.001–004; and LOG.004 for the `cost_tokens`/`cost_unknown` contract this meter reads).
- spec/05-non-functional/cost.md — NFR-COST.001/004/005/006/010 (the economic posture: fail-safe estimate, per-task-type-from-day-one, the meter/decide/execute split, the viability target).
- spec/04-data-model/schema.md §8 (Observability) — `event_log` (`cost_tokens`, `cost_unknown`), `notifications`; §12 (Config cluster) — `config_values` + `price_table` structured object + the `cost_ladder_*` keys; and the §8 Cost note (OD-P4-05: derive the meter/aggregation from `event_log`, no separate table); §6 (Execution) — `task_queue`/`task_types` for the per-task-type join.
- spec/00-foundations/adr/ADR-003-cost-model.md — §2 (the four-rung ladder), §3 (fail-safe token estimate source of truth), §7 (viability target + lever order), and the §2/§3 OD-164 config-key naming reconciliation.

## 7. Dependencies
- **Blocked-by:** ISSUE-011 (observability skeleton — `event_log` append-only + `cost_tokens`/`cost_unknown` columns the meter reads; FR-7.LOG.004), ISSUE-001 (**SPIKE** — proves AF-001 GREEN: a healthy deployment runs ≤ ~$20/day under the soft alert; the viability gate this meter's thresholds assume). Also assumes ISSUE-010 (config store) for the `price_table` + `cost_ladder_*` keys (transitive via the shared Tier-2 scaffold).
- **Blocks:** ISSUE-058 (rate-limit guardrails + cost-ladder enforcement — consumes the throttle/kill breach signal this issue emits), ISSUE-066 (orchestrator learning + cost-routing — consumes the per-task-type cost aggregate).

## 8. Build order within the slice
1. Confirm ISSUE-011 landed: `event_log` is append-only with `cost_tokens bigint` (nullable) + `cost_unknown boolean` populated per FR-7.LOG.004 (model/tool events carry a cost or the sentinel) — this slice **reads** these, it does not add them.
2. Build the token→$ estimator: `cost_tokens × config_values['price_table']` over all vendors (Sonnet + Haiku + OpenAI `text-embedding-3-small`), fail-safe **rounded up** (count retries, no optimistic cache/batch discount); a `cost_unknown` event contributes the sentinel, never a silent `0`; every figure labelled an estimate (FR-7.COST.001 → NFR-COST.005). Assert a `price_table` edit re-bases subsequent estimates with no deploy (AC-7.COST.001.1 / AC-NFR-COST.005.2).
3. Build the per-task-type aggregation: join `event_log.task_id → task_queue` for the task type; make it queryable/groupable by task type; ensure it accumulates from the **first** task, not retrofitted (FR-7.COST.002 → NFR-COST.010; AC-7.COST.002.2). This is the ROI substrate feeding ISSUE-066 + the FR-7.OPT.002 benchmarking substrate.
4. Build the running per-deployment spend meter (daily + weekly windows) over the estimator output.
5. Build the four-rung ladder trigger reading the `cost_ladder_*` config thresholds: on the soft rung (daily $50 / weekly $200) fire the cost-threshold-breach alert to the notification centre (FR-7.COST.004 → AC-7.COST.004.1); on the throttle ($75) / kill ($100) rungs **emit a breach signal to the C6 cost-ladder guardrail** — C7 does NOT throttle or kill (FR-7.COST.003 → AC-7.COST.003.2). Assert no rung is skipped or silent (AC-NFR-COST.001.2).
6. Wire the decide/execute seam bilaterally: this issue emits the signal; the enforcement FR is owned by C6 (ISSUE-058) and executed by C5 — leave the ops surface to render the lit rung without claiming it enforced (AC-7.COST.003.3 → AC-NFR-COST.004.1/.2). Do not over-reach to fill the owed C6 FR (OD-068 carry-forward).
7. Test to each AC in field 4: estimator (all-vendors, round-up, sentinel, re-base), per-task-type aggregation (from first task, groupable), ladder trigger (synthetic spend series crosses each rung → correct action, soft-alert vs throttle/kill-signal), and the C7-meters-not-enforces boundary.

## 9. Verification (how DoD is proven)
- **Estimator unit/build test** (per spec/05-non-functional/test-strategy.md): all-vendor round-up over synthetic `event_log` rows; a `cost_unknown` row is counted as sentinel not `$0`; a `price_table` edit re-bases without deploy — proves AC-7.COST.001.1/.2, AC-NFR-COST.005.1/.2.
- **Aggregation test:** cost grouped by task type from the first synthetic task, queryable — proves AC-7.COST.002.1/.2, AC-NFR-COST.010.1.
- **Ladder trigger test:** a synthetic spend series crossing each of the four rungs fires exactly that rung's behaviour (soft→dashboard alert; throttle/kill→C6 breach signal, no self-throttle), no rung skipped or silent — proves AC-7.COST.003.1/.2, AC-7.COST.004.1, AC-NFR-COST.001.1/.2, AC-NFR-COST.004.1.
- **Ownership-seam test:** on a throttle/kill breach, C7 emits → C6 decides → C5 executes; the ops surface lights the rung but does not enforce — proves AC-7.COST.003.3, AC-NFR-COST.004.2.
- **Spike gate:** AF-001 GREEN (ISSUE-001 cost-viability spike) is a precondition to shipping — the meter's thresholds rest on typical volume landing ≤ ~$20/day under the soft alert (AC-NFR-COST.006.1); AF-040/041/042/043/035 are fast-follow behind the fail-safe round-up posture. The AC→`Verified` path for each COST AC runs once AF-001 is GREEN.
