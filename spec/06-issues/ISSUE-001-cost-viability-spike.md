---
id: ISSUE-001
title: "SPIKE: cost viability under target/day"
epic: "S — spikes"
status: ready
github: "#1"
---

# ISSUE-001 — SPIKE: cost viability under target/day

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR/NFR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and run this spike to its Definition of done **without guessing**.

## 1. Goal (one line)
Prove — by measuring a real end-to-end task + memory write on a representative deployment — that a typical-volume healthy deployment lands at/under the ~$20/day viability target (under the $50/day soft alert), so the retainer/business model holds (AF-001, the launch go/no-go cost gate).

## 2. Scope — in / out
**In:** This is a **measurement + evidence spike**, not a feature build. Stand up (or reuse) a representative deployment fixture; run one real multi-agent task end-to-end (orchestrator → research → specialists) plus at least one surviving memory write through the ADR-003 §4 write-path shape (code filter → Haiku selective gate → Haiku pre-checks → ≤1 Sonnet writer); capture actual tokens and $ per vendor (Sonnet + Haiku + OpenAI `text-embedding-3-small`) using the fail-safe **round-up** estimator posture (count retries, no optimistic cache/batch discount). Extrapolate to a typical daily volume and confirm it sits under the soft alert. Record the result — PASS/FAIL with evidence — in `feasibility-register.md` (flip AF-001 🔴→🟢 on PASS). If measured typical volume is **above** the soft alert, apply the fixed cost-lever order (per AC-NFR-COST.006.2) and re-measure **before** any ceiling is raised. Also record the memory-write shape observed (feeds AF-043) and the estimate-vs-anticipated-invoice basis (feeds AF-042), since AF-001 is the umbrella spike for both.

**Out:** Does NOT build the cost meter/estimator, the four-rung ladder mechanism, or the per-task-type aggregation — those are the cost-observability build owned by **ISSUE-074** (C7 COST). Does NOT build the ladder enforcement (throttle/kill decide+execute) or the cost-lever/model-routing enforcement — owned by **ISSUE-058** (C6 RTL). Does NOT prove threshold *realism* of the $50/$100 defaults (AF-040/041) or estimate drift (AF-042) or gate self-funding (AF-043) as their own gates — those are **fast-follow** EVALs behind the fail-safe round-up + shadow-retain postures; this spike only proves the **viability target** itself (AF-001), which is the one blocking cost gate (RP-1).

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** none (spike; measures a posture, does not implement an FR). Exercises the ADR-003 §4 memory-write path and §7 lever ordering as the thing-under-measurement.
- **NFRs:** NFR-COST.006 (viability target ≤ ~$20/day — the AF-001 gate). Context/adjacent postures measured in passing: NFR-COST.005 (fail-safe round-up estimate source), NFR-COST.007 (lever precedence for the over-target response), NFR-COST.008 (memory-write cost shape).
- **Rests on:** ADR-003 (cost model — §4 write-path shape, §7 viability target + lever order, §3 fail-safe estimate) · ADR-001 (client-borne opex → estimate-not-invoice boundary) · AF-001 (the spike this issue *is*).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-NFR-COST.006.1 — measured typical-volume cost lands at/under ~$20/day and under the $50/day soft alert.
- AC-NFR-COST.006.2 — if measured above the soft alert, the levers are pulled in the COST.007 order before the ceiling is raised.
- **Gating spike:** this issue *is* the gate — **AF-001 must be flipped 🔴→🟢 in `feasibility-register.md` with logged evidence** for the DoD to close. AF-001 is one of the six launch go/no-go SPIKE-GATEs (RP-1, session 45).

## 5. Touches (complete blast radius, by ID)
- **DATA:** none written by this spike as a product artifact; reads `event_log.cost_tokens` (per-call token counts) as the measurement source.
- **PERM:** none.
- **CFG:** reads (does not set) `price_table` (vendor×model→$/token, incl. `text-embedding-3-small`), `rate_limit_memory_writes_per_minute` (30), and the ladder keys `cost_ladder_soft_threshold_daily_usd` (50) / `cost_ladder_soft_threshold_weekly_usd` (200) / `cost_ladder_hard_kill_threshold` (100) as the reference thresholds to measure against. **Canonical literal key names + defaults are `config-registry.md` (the naming source of truth per OD-164)** — ADR-003 §4's `memory_writes_per_minute` is design-doc shorthand for `rate_limit_memory_writes_per_minute`; use the config-registry names.
- **UI:** none.
- **Connectors:** none required for the measurement itself; the representative task may exercise connector calls but the spike does not own any connector.

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/05-non-functional/cost.md — NFR-COST.006 (the gate) + NFR-COST.005/007/008 postures being measured; the AC text.
- spec/00-foundations/adr/ADR-003-cost-model.md — §4 (memory-write shape), §7 (viability target + fixed lever order), §3 (fail-safe round-up estimate), §2 (the rung defaults measured against).
- spec/00-foundations/feasibility-register.md — AF-001 (row 23) + the C-block umbrella (AF-040/041/042/043) whose evidence this spike also feeds; flip AF-001 here.
- spec/05-non-functional/test-strategy.md — the SPIKE+EVAL method definition, the six-gate go/no-go section, and the AF-001 evidence-logging expectation (the Verification path for this issue).
- spec/02-config/config-registry.md — the concrete `price_table` **$/token rates + object shape** (App. A item 10: vendor×model→{input,output} $/1k tokens + embedding $/unit; e.g. sonnet 0.003/0.015, haiku 0.0008/0.004, openai `text-embedding-3-small`; main table row `price_table`), the canonical rate-cap key **`rate_limit_memory_writes_per_minute`** (30; ADR-003 §4's `memory_writes_per_minute` is design-doc shorthand — this file is the naming source of truth per OD-164), and the four `cost_ladder_*` threshold defaults. **Needed to convert `cost_tokens`→$; the named FR/ADR files reference `price_table` but do not carry the rates.**
- spec/04-data-model/schema.md — the `event_log.cost_tokens` column shape (**nullable `bigint` + companion `cost_unknown boolean` sentinel**, §7 `event_log`; a genuinely-costless event is `0`, an uncomputable one is `cost_unknown=true`, never a silent `0`) and the cost derivation basis (**no separate cost table — the running meter and per-task-type aggregation derive from `event_log.cost_tokens × config_values['price_table']`**, §8 Cost note / OD-P4-05). **This is the per-call measurement source read in build steps 2/4; the `price_table` JSON is stored under `config_values`.**

## 7. Dependencies
- **Blocked-by:** none (foundational spike; runs first / alongside per Tier 0).
- **Blocks:** ISSUE-058 (C6 cost-ladder enforcement — the ladder mechanism ships behind this viability proof), ISSUE-074 (C7 cost meter + per-task aggregation + ladder signal).

## 8. Build order within the slice
0. **Declare the typical-volume workload profile — a spike input, not a lookup (no manifest file quantifies it).** ADR-003 supplies loop *cadence* only (fast loop 144/day, §5; medium hourly-ish; slow daily) — it does **not** state the task/write volume that dominates cost. So the spike must **declare, and record in its evidence, the "typical healthy deployment / day" profile it measures against**: number of real multi-agent tasks/day, number of surviving memory writes/day, and the loop-run counts (144 fast / N medium / N slow). Anchor it to the ADR-003 §7 "typical-volume healthy deployment" intent and the ≤~20-user/silo envelope (test-strategy §1); this declared profile **is** the extrapolation basis for steps 4–5 and is part of the recorded result (so a re-run is reproducible and the number is auditable, not guessed). If the profile itself is contested, that is an EVAL follow-up under the AF-040/041 threshold-realism umbrella — this spike proves the target holds *for the declared profile*.
1. Assemble a representative deployment fixture — a runnable deployment loaded with the declared step-0 profile (loops + a real multi-agent task + memory writes). **The "AF-001/AF-002 shared corpus" named in test-strategy (§3/§8) has no canonical corpus file in the repo yet** — its contents are undefined, so the spike **assembles the corpus and records its composition** (entity/memory count, task types, mention mix — see AF-002 row 24 / AF-082 for the retrieval-corpus dimensions it shares) as a spike output; that recorded composition is what the AF-002 spike then reuses.
2. Ensure per-call token capture is available from `event_log.cost_tokens` (nullable `bigint`; `cost_unknown` sentinel ≠ silent `0` — schema.md §7) and the `price_table` config is loaded read-only from `config_values` (schema.md §8; rates + shape in config-registry.md App. A item 10) so `cost_tokens × price_table` → $ can be computed per vendor.
3. Run one real end-to-end multi-agent task (orchestrator → research → specialists) and drive ≥1 surviving memory write through the ADR-003 §4 path (verify the shape: code filter → Haiku gate → Haiku pre-checks → exactly 1 Sonnet writer; and a non-surviving event costs 0 Sonnet).
4. Compute cost with the fail-safe **round-up** estimator over **all vendors** (Sonnet + Haiku + OpenAI embeddings); extrapolate to a typical day.
5. Compare against the thresholds: assert typical ≤ ~$20/day and under the $50 soft alert (AC-NFR-COST.006.1). Capture the memory-write shape (AF-043 evidence) and the estimate basis vs anticipated invoice (AF-042 evidence).
6. If over the soft alert: apply the COST.007 lever order (`model routing → selective-writing gate → loop idle-gating → memory-injection limit → orchestrator confidence threshold`) and re-measure before raising any ceiling (AC-NFR-COST.006.2).
7. Log the result in `feasibility-register.md` and flip AF-001 🔴→🟢 on PASS. **The register defines the status glyphs + the AF-001 row but not an evidence template, so record these exact fields** (the shape a zero-context reader must be able to re-derive the verdict from): (a) **verdict** PASS/FAIL + new status glyph; (b) **date** + method (SPIKE+EVAL); (c) the **declared step-0 typical-volume profile** (tasks/day, surviving writes/day, loop counts) the number is extrapolated against; (d) the **measured per-vendor $ and tokens** (Sonnet, Haiku, OpenAI embeddings) for the one task + write, **round-up estimator**, and the **extrapolated $/day** vs the ~$20 target / $50 soft alert (AC-NFR-COST.006.1); (e) the **observed memory-write shape** (Sonnet + Haiku call counts; 0 Sonnet on a non-surviving event) → AF-043 evidence; (f) the **estimate-vs-anticipated-invoice basis** → AF-042 evidence; (g) the **assembled corpus composition** (step 1); (h) if over the soft alert, which COST.007 levers were pulled and the re-measured figure (AC-NFR-COST.006.2). Same evidence block is referenced from the AF-040/041/042/043 rows so the umbrella C-block reads consistently.

## 9. Verification (how DoD is proven)
- **Method: SPIKE+EVAL** (per `spec/05-non-functional/test-strategy.md`) — a runnable representative deployment is measured end-to-end; this is a go/no-go **SPIKE-GATE**, not a unit test.
- **AC→Verified path:** AC-NFR-COST.006.1/.2 move to `Verified` when the measured typical-volume daily cost is recorded at/under ~$20/day (under the $50 soft alert) with the round-up all-vendor estimator, evidence logged in the feasibility register, and **AF-001 flipped 🔴→🟢**. If the measurement fails the target, AF-001 stays 🔴, the launch gate does not clear, and the COST.007 levers are applied before any threshold change — a FAIL here slips launch or changes the design (RP-1).
