---
id: ISSUE-066
title: Orchestrator learning + scope-aware result cache + cost-routing
epic: H — agent design
status: ready
github: "#66"
---

# ISSUE-066 — Orchestrator learning + scope-aware result cache + cost-routing

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Close the orchestrator's feedback loop: learn routing from tracked outcomes, cache agent results with scope-aware write-triggered invalidation, and route by cost tier — feeding (never enforcing) the C7 meter / C6 ladder.

## 2. Scope — in / out
**In:** The C8 LRN + COST areas — the "make routing cheaper and self-improving over time" slice sitting on top of the already-built orchestrator (ISSUE-061). Specifically:
- **Learning (LRN):** refine routing scoring from tracked `execution_plan` outcomes; the routing-mismatch detector that turns a consistently-rerouted task type into a *description-update* suggestion (data fix, never code); learning adjustments must be observable + reversible.
- **Result cache (LRN.003):** the `agent_result_cache` read/write path keyed on (agent, in-scope entity ids, their last-write/memory version); per-agent-type time window; **write-triggered invalidation** on any in-scope-entity write (the Memory Agent's commit is the named producer of the "entity X changed" signal); **miss-on-uncertainty** when scope/version can't be confirmed.
- **Cost-routing (COST):** map complexity → tier (single / two-agent / full chain) and prefer the cheapest satisfying tier; treat the confidence threshold as the cost/quality dial; emit the per-route cost *shape* (call profile) so C7 can meter it.

**Out:**
- **Cost metering / aggregation itself** — C7 owns the meter (ISSUE-074 supplies the meter + per-task-type aggregation this slice's cost-shape feeds).
- **Cost-ladder enforcement (throttle / hard-kill)** — C6 decides, C5 executes (owed C6 FR, OD-068); out of this issue.
- **The orchestrator 7-step, agents registry, classification + scoring machinery** — ISSUE-061 (this slice consumes its routing model + `execution_plans` + `agents`).
- **Agent-health / drift / dead-agent metrics** — ISSUE-065 (LRN.001 degradation is *detectable via* HLTH.001/LRN.002, but the HLTH metrics are built there).
- **The Memory Agent sole-writer commit path** that emits the invalidation trigger — C2 WRT / ISSUE-024 owns the write; this slice only subscribes to it.
- **Self-improvement panel / cost dashboard rendering** — C7 + Phase 3 (this slice emits signals only).

**Integration note (spanning the bundled FRs):** the cache (LRN.003) and cost-routing (COST.*) share the plan-build hot path — the orchestrator, at plan build, first consults `agent_result_cache` (LRN.003) before selecting a cost tier (COST.001), and both the tier decision and the cache hit/miss are recorded as cost signal for COST.003 → C7. The confidence threshold (`orchestrator_confidence_threshold`) is one shared dial: it gates expensive chains (COST.002) *and* is the ORC.006 clarification trigger built in ISSUE-061 — this slice tunes cost behaviour on it, it does not redefine it.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-8.LRN.001, FR-8.LRN.002, FR-8.LRN.003, FR-8.COST.001, FR-8.COST.002, FR-8.COST.003 (all component-08 agent-design).
- **NFRs:** NFR-PERF.012 (scope-aware caching), NFR-COST.010 (cost-per-task-type from day one; re-rank/HyDE off by default).
- **Rests on:** ADR-003 (cost model — the ≤1 Sonnet + ≤3 Haiku write-path shape COST.003 emits); OD-076 (cache invalidation = scope-aware + time-bounded, #1); OD-068 (C8 feeds, C6 enforces — the meter/ladder boundary); OD-080 (confidence-threshold edit permission); AF-125 (cache staleness safety), AF-126 (learning improves routing), AF-121 (routing-mismatch signal), AF-122 (confidence calibration).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-8.LRN.001.1
- AC-8.LRN.002.1
- AC-8.LRN.003.1
- AC-8.LRN.003.2
- AC-8.LRN.003.3
- AC-8.COST.001.1
- AC-8.COST.002.1
- AC-8.COST.003.1
- AC-NFR-PERF.012.1
- AC-NFR-PERF.012.2
- AC-NFR-COST.010.1
- AC-NFR-COST.010.2
- **Gating spikes (if any):** none launch-gating (no ISSUE-001..006 blocker). AF-125 (LRN.003 staleness safety, NFR-PERF.012) and AF-126 (LRN.001 improvement) are **fast-follow EVAL/SPIKE**, not launch gates — the slice ships behind the safe posture (OD-076: write-triggered invalidation + miss-on-uncertainty); AF-002 governs whether re-rank/HyDE may be turned on (NFR-COST.010, default off, fast-follow). None blocks `Approved`; each gates a quality/accuracy *claim*, verified per `test-strategy.md`.

## 5. Touches (complete blast radius, by ID)
- **DATA:** `agent_result_cache` (id, agent_id, scope_entity_ids, memory_version, output, expires_at, created_at — schema §9); `execution_plans` (read: outcome + plan-version source for LRN.001; §9); `agent_health_metrics.routing_mismatch_count` (LRN.002 increments; §9); `event_log` (LRN.001 adjustment log, LRN.002 reroute patterns, COST.001 route tier, COST.003 per-route cost shape).
- **PERM:** confidence-threshold edit gated per OD-080 (COST.002) — no new permission node minted here; reuses the C8 registry/tuning authority.
- **CFG:** `cache_time_window` (per-agent-type minutes: research 30 · client 60 · campaign 60 · comms 15 · ops 120 · finance 120 · insight 1440); `orchestrator_confidence_threshold` (default 0.75; the COST.002 dial); `chain_depth_limit` (COST.001 chain cap); `routing_weights` (COST.001 tier selection).
- **UI:** none owned by this slice (routing-outcome trend, self-improvement panel, cost-by-task-type all render in C7 + Phase 3).
- **Connectors:** none.

## 6. Context manifest (the EXACT files to open — nothing more)
- `spec/01-requirements/component-08-agent-design.md` §Area LRN + §Area COST — the FR text + ACs (FR-8.LRN.001–003, FR-8.COST.001–003).
- `spec/04-data-model/schema.md` §9 Agent Design — `agent_result_cache`, `execution_plans`, `agent_health_metrics`; §12 Config cluster — `cache_time_window`, `orchestrator_confidence_threshold`, `chain_depth_limit`, `routing_weights`.
- `spec/05-non-functional/performance.md` §NFR-PERF.012 — the caching posture (write-triggered invalidation + miss-on-uncertainty).
- `spec/05-non-functional/cost.md` §NFR-COST.010 — per-task-type-from-day-one + re-rank/HyDE-off posture.
- `spec/00-foundations/adr/ADR-003-cost-model.md` — the call-profile shape COST.003 emits (≤1 Sonnet wrapped in ≤3 Haiku per write; one call per orchestrator decision, one per specialist).

## 7. Dependencies
- **Blocked-by:** ISSUE-061 (orchestrator + 7-step routing + agents registry — supplies the routing model, `execution_plans`, `agents`, and the confidence check this slice tunes); ISSUE-074 (C7 cost meter + per-task-type aggregation — the consumer of the COST.003 cost shape; not a spike). *Also depends on the Memory Agent commit signal (ISSUE-024 / C2 WRT) for LRN.003.2 write-triggered invalidation — subscribe to it; if not yet landed, gate the cache behind time-window + miss-on-uncertainty until the trigger is wired.*
- **Blocks:** none (leaf).

## 8. Build order within the slice
1. **Cache store wiring** — confirm the `agent_result_cache` migration landed with ISSUE-061's schema group; ensure `cache_time_window` (per-agent-type) is in the config store (§12) with the documented defaults.
2. **Cost-routing tier selection (COST.001 + COST.002)** — at plan build, map classification → cost tier using `routing_weights`, prefer the cheapest satisfying tier, cap at `chain_depth_limit`; wire the `orchestrator_confidence_threshold` as the cost/quality dial (low-confidence → clarification before an expensive chain, reusing the ISSUE-061 ORC.006 path); record chosen tier to `event_log`.
3. **Result-cache read path (LRN.003.1)** — before invoking a cacheable agent, look up `agent_result_cache` on (agent_id, scope_entity_ids, memory_version); serve on hit within `expires_at`.
4. **Cache write path** — on agent output, write the entry with the scope-aware key + per-agent-type `expires_at`.
5. **Write-triggered invalidation (LRN.003.2)** — subscribe to the Memory Agent's commit (C2 sole-writer) as the named "entity X changed" producer; invalidate any entry whose `scope_entity_ids` intersect the written entity — never a stale hit (#1, OD-076).
6. **Miss-on-uncertainty guard (LRN.003.3)** — when entity-extraction confidence is below floor, or the write hits an entity *class* the cached agent reads but not the specific keyed id, miss-and-recompute (blind-spot-fails-safe).
7. **Cost-shape emission (COST.003)** — on each routing/execution decision, record the expected call profile per ADR-003 to `event_log` for C7 to meter; C8 neither meters nor enforces (OD-068 boundary). Confirm per-task-type aggregation is live from the first task (NFR-COST.010) and re-rank/HyDE are off by default.
8. **Learning loop (LRN.001)** — refine routing scoring/selection from tracked `execution_plans` outcomes; make each adjustment observable + reversible and logged to `event_log`.
9. **Routing-mismatch detector (LRN.002)** — detect task types consistently rerouted; increment `agent_health_metrics.routing_mismatch_count` and surface a *description-update* suggestion (via C7/C9) — the fix is data (description), never code.
10. **Tests to the AC** — exercise each AC in field 4, incl. the two cache race conditions (write-during-window, entity-not-in-key) and the miss-on-uncertainty path.

## 9. Verification (how DoD is proven)
- **Unit / integration** (`spec/05-non-functional/test-strategy.md`): cost-tier selection (COST.001), threshold-as-dial behaviour (COST.002), cost-shape emission matches ADR-003 profile (COST.003), cache hit within window (LRN.003.1), write-triggered invalidation (LRN.003.2), miss-on-uncertainty (LRN.003.3), learning adjustment logged + reversible (LRN.001), reroute → description-suggestion (LRN.002).
- **AF EVAL/SPIKE (fast-follow, does not block go-live):** AF-125 proves the scope-aware cache never serves stale knowledge after an in-scope write (NFR-PERF.012 → its AC→`Verified` path); AF-126 proves outcome-driven learning measurably improves routing (LRN.001); AF-122 the confidence calibration (COST.002 quality claim); AF-121 the routing-mismatch signal (LRN.002). The FRs are `Approved` on the safe posture (OD-076) ahead of these evals per the C8 block-S rule.
- **Posture holds:** NFR-PERF.012 (invalidate-on-write + miss-on-uncertainty) and NFR-COST.010 (per-task-type from day one; re-rank/HyDE off until AF-002) verified DOCS + build-time test.
