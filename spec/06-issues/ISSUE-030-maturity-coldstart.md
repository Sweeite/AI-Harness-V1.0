---
id: ISSUE-030
title: Maturity + cold-start gating signal
epic: C — memory
status: done
github: "#30"
---

# ISSUE-030 — Maturity + cold-start gating signal

> **✅ BUILT + LIVE-VERIFIED — Session 83 (2026-07-10).** Package `app/maturity/` (@harness/maturity — port +
> InMemory reference fake + `supabase-store.ts` live adapter + `check` gate + **52/52** tests + tsc clean). The
> ADR-002 metrics spine: expected-slots config (5–8/type, slots.ts), per-entity + aggregate Maturity
> (`filled/expected`, filled = ≥1 live memory; maturity.ts), the recompute orchestration (daily + on-write,
> stamps `maturity_updated_at`; recompute.ts), the one-time cold-start **ONE-WAY LATCH** (permanent deactivation
> at 80%, never re-arms; coldstart.ts) with a SQL-level OR-guard on the persisted latch so two interleaved
> recomputes around a threshold dip can't clear a committed deactivation, and query-time Retrieval Sufficiency →
> the `[Building]` flag (thin sufficiency AND touched-entity Maturity < proactive_threshold; sufficiency.ts).
> Built via the Stage-6 fan-out workflow → independent adversarial-verify (2 findings: MAJOR + MINOR, fixed
> regression-test-first, no BLOCKER). Migration `0040_maturity_recompute_event_type.sql` **applied LIVE** (silo
> head `0039→0040`). **R10 live-adapter smoke PASSED** (`results/live-smoke.sql`, 5 assertions vs the real silo,
> rolled back — the `setMaturity` UPDATE on numeric(4,3), the live-memory slot-fill read, **the cold-start latch
> OR-guard proven at the SQL level (a stale `false` cannot clear a committed `true` — AC-2.MAT.002.1)**, the
> config read, and the `maturity_recomputed` event via `::event_type`). All 5 CFG knobs already registered LIVE
> (value seeding deferred to ISSUE-010, adapter degrades to registry defaults). **AF-034 🔴 carried** (EVAL —
> does slot-fill Maturity predict usefulness + does the Sufficiency threshold cleanly separate `[Building]` from
> `[Unknown]`; validated in the AF-002 real-corpus spike, NOT a sign-off blocker per §4/§9). GitHub #30 CLOSED.

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Compute per-entity Maturity (`filled slots / expected slots`) from operator-editable expected knowledge slots, roll it up to an aggregate that drives one-time cold-start gating, and emit the query-time Retrieval Sufficiency signal that raises the `[Building]` flag — the ADR-002 metrics spine.

## 2. Scope — in / out
**In:** The `MAT` area group as backend signal-producers only — (a) the expected-slots config shape per entity type (5–8 slots, operator-editable) and its use to seed onboarding gap-questions; (b) the stored per-entity Maturity numeric on `entities`, recomputed daily (slow loop) and on memory-write for the touched entity, plus the cheap `avg()` aggregate rollup; (c) the one-time cold-start *mode* state machine keyed to the 20/50/80 thresholds that deactivates permanently at the 80% `full_threshold`; (d) the inline, query-time Retrieval Sufficiency computation (no stored metric) that decides `[Building]` vs plain `[Unknown]` when combined with the touched entities' Maturity. This slice produces the signals and owns the gating math and its persistence.

**Out:** Consuming the cold-start signal to actually suppress/throttle proactive behaviour — that is C9 CST, owned by **ISSUE-071** (blocks). Rendering the `[Building]`/`[Unknown]` pills and the answer-mode decision on responses — C8, not this slice. Rendering the Maturity / onboarding dashboard surface — **ISSUE-031** (memory navigation surface). The retrieval signals that Sufficiency reads (relevance × confidence over surfaced memory) are produced by retrieval (`RET`), owned by **ISSUE-025**; this slice only reads them. The `entities` table and entity resolution themselves are **ISSUE-022** (blocked-by). The onboarding interview / gap-detection ingestion path (FR-2.ING.008/009) is ingestion, not this slice — this slice only exposes the empty-slot list it consumes.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-2.MAT.001, FR-2.MAT.002, FR-2.MAT.003 (all component-02 Memory)
- **NFRs:** none
- **Rests on:** ADR-002 (Maturity / Retrieval Sufficiency — the metric split, the 20/50/80 `cold_start` thresholds, the one-time-mode resolution); AF-034 (feasibility)

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-2.MAT.001.1
- AC-2.MAT.002.1
- AC-2.MAT.003.1
- **Gating spikes (if any):** none. AF-034 (slot-fill Maturity predicts usefulness; Sufficiency cleanly separates `[Building]`/`[Unknown]`) is an EVAL feasibility item tagged on all three FRs, not an OD-157 launch-gating spike — it does not block this issue from shipping; carry it as a feasibility flag per `spec/00-foundations/feasibility-register.md`.

## 5. Touches (complete blast radius, by ID)
- **DATA:** `DATA-entities.maturity`, `DATA-entities.maturity_updated_at` (stored per-entity Maturity + recompute stamp on the existing `entities` table). Aggregate Maturity is a derived `avg(entities.maturity)` rollup — **no new table**. Retrieval Sufficiency is derived inline per query — **not stored**. Expected slots live as a config structured object (`expected_slots`) in `config_values`, **not a table** (see schema §Config cluster).
- **PERM:** config authority for editing expected slots is homed in C1 (no MAT-specific PERM node); no new permission introduced by this slice.
- **CFG:** `CFG-expected_slots` (per entity type), `CFG-cold_start_full_threshold` (80%) + the 20/50/80 `cold_start` gate thresholds (ADR-002), `CFG-retrieval_sufficiency_threshold`.
- **UI:** none in this slice (Maturity/onboarding dashboard = ISSUE-031; `[Building]` pill = C8).
- **Connectors:** none.

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-02-memory.md — the `MAT` area group (FR-2.MAT.001–003) + their ACs; also FR-2.RET.007 for the answer-mode/`[Building]` seam this slice feeds.
- spec/04-data-model/schema.md §3 Memory — the `entities` table (`maturity`, `maturity_updated_at`); and §12 Config cluster — `expected_slots` as a config object.
- spec/00-foundations/adr/ADR-002-coverage-metric.md — the metric split, the `cold_start { 20, 50, 80 }` thresholds, and the one-time-mode (permanent deactivation at 80%) resolution.

## 7. Dependencies
- **Blocked-by:** ISSUE-022 (entity model — the `entities` table this slice stores Maturity on). Not a spike; no gate.
- **Blocks:** ISSUE-071 (cold-start phase ladder + proactive suppression — consumes the gating signal produced here).

## 8. Build order within the slice
1. Schema/config: confirm `entities.maturity` + `entities.maturity_updated_at` exist from ISSUE-022's migration; add the `expected_slots` config structured object (per entity type, 5–8 slots) to the config cluster with operator-edit path (FR-2.MAT.001).
2. Maturity compute (FR-2.MAT.002): the `filled slots / expected slots` per-entity calculation (binary slot fill at v1 per ADR-002); wire it to (a) the daily slow-loop recompute and (b) an on-memory-write recompute for the touched entity, both stamping `maturity_updated_at`. Expose the empty-slot list for onboarding gap-question seeding (consumed by ingestion, not built here).
3. Aggregate rollup: the cheap `avg(entities.maturity)` over the stored column (no separate table).
4. Cold-start mode state machine (FR-2.MAT.002): keyed to the 20/50/80 `cold_start` thresholds; deactivates **permanently** for the deployment once the aggregate crosses `CFG-cold_start_full_threshold` (80%) — a one-way latch. Emit the mode/threshold signal for ISSUE-071 to consume; per-entity `[Building]` eligibility survives after the mode is off.
5. Retrieval Sufficiency (FR-2.MAT.003): compute inline per query from existing retrieval signals (ISSUE-025's relevance × confidence over surfaced memory — read, never store); the `[Building]` vs plain `[Unknown]` decision = thin sufficiency AND touched-entity Maturity below the proactive threshold, gated by `CFG-retrieval_sufficiency_threshold`. Emit the Sufficiency verdict for the FR-2.RET.007 answer-mode seam (C8 renders).
6. Observability hooks: log Maturity recompute (per FR-2.MAT.002) and the Sufficiency distribution (per FR-2.MAT.003).
7. Tests to the three ACs (§4).

## 9. Verification (how DoD is proven)
- Unit/integration per `spec/05-non-functional/test-strategy.md`: assert the three ACs — (001.1) an entity type carries 5–8 editable slots; (002.1) aggregate Maturity reaching 80% permanently deactivates cold-start mode (prove the latch does not re-arm on a later dip); (003.1) thin sufficiency on a low-Maturity entity → `[Building]`, on a mature entity → `[Unknown]` without `[Building]`.
- No `AC-NFR-*` posture is claimed by this slice. Carry AF-034 as an open EVAL feasibility flag against the `MAT` FRs (does not block sign-off) — its EVAL confirms slot-fill Maturity actually predicts usefulness and that the Sufficiency threshold cleanly separates `[Building]` from `[Unknown]`; the AC→`Verified` path for this slice is the three ACs above passing on the built signal-producers.
