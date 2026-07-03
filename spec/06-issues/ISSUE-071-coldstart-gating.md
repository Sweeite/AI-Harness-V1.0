---
id: ISSUE-071
title: Cold-start phase ladder + proactive suppression
epic: I — proactive
status: blocked
github: "#71"
---

# ISSUE-071 — Cold-start phase ladder + proactive suppression

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Consume the C2-emitted coverage phase and drive the cold-start policy: the phase-behaviour matrix, full suppression of proactive suggestions below the proactive threshold, read-only external writes and reduced loops in the low phases, per-entity `[Building]` framing, configurable thresholds, and the initialisation-status contract — all failing safe to the most-restrictive phase when the phase signal is stale or unknown.

## 2. Scope — in / out
**In:** The `CST` area group as the cold-start *policy + gate* layer that sits on top of the C2 Maturity signal (from ISSUE-030) and the proactive generators (from ISSUE-069) — (a) the phase-behaviour matrix that maps each coverage phase (`cold` / `basic` / `proactive` / `full`) to the set of behaviours that apply, **consuming** the phase C2 emits rather than recomputing coverage, and **failing safe to `cold`** when the phase is unavailable *or stale* — the freshness check, not just presence (CST.001); (b) full suppression of proactive suggestion volume below the proactive threshold, with the two-class exception that a C6/C7 guardrail-class safety event and an at-floor escalating derisking risk are still delivered (CST.002); (c) the three configurable, ordered thresholds with no-deploy edits and reject-on-invalid (CST.003); (d) the per-entity `[Building]`-vs-`[Unknown]` framing decision that consumes C2's per-entity Maturity + Retrieval Sufficiency (CST.004); (e) C9 **setting** the cold-start phase flag that the external-write read-only block reads (CST.005) and the reduced-loop cadence policy reads (CST.006); (f) the cold-start status contract — phase, per-step init progress, coverage %, ETA (or "calculating"), banner copy, and the human-verification-pass surfaced as highest-priority incomplete step with a waiting-count — assembled for Phase-3 to render (CST.007). This slice **assigns policy and owns the proactive-suppression enforcement itself**; the other gated behaviours are set here and enforced by their owners (see Out).

**Out:** Computing coverage / per-entity Maturity / Retrieval Sufficiency / the `[Building]` flag — that is C2, owned by **ISSUE-030** (blocked-by); this slice only *reads* the phase and per-entity signals. Generating the proactive suggestions this slice suppresses — the seven scanners are **ISSUE-069** (blocked-by). Actually **enforcing** the external-write read-only block (CST.005 → C6/C3/C5 guardrail/connector path) and **scheduling** the reduced/full loop cadence (CST.006 → C5 FR-5.LOP.* / FR-5.TRG.*) — C9 sets the phase flag; those owners enforce it. Rendering the cold-start banner, the initialisation-progress indicator, and the `[Building]` pill — Phase 3 / C4 (this slice owns only the state contract). The suggestion lifecycle / ranking / delivery that suppression gates — **ISSUE-070** (SUG). The verification queue/count and per-step ingestion/coverage signals that CST.007 aggregates are sourced from C2 (verification) and ADR-005/C3 (provisioning/connection); this slice reads and assembles, it does not produce them.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-9.CST.001, FR-9.CST.002, FR-9.CST.003, FR-9.CST.004, FR-9.CST.005, FR-9.CST.006, FR-9.CST.007 (all component-09 Proactive)
- **NFRs:** none
- **Rests on:** ADR-002 (Maturity / Retrieval Sufficiency — the 20/50/80 `cold_start` thresholds and the per-entity phase this slice consumes); OD-085 (C2 emits the phase, C9 owns the policy matrix + proactive-suppression; other behaviours seamed to their owners); AF-034 (Maturity predicts usefulness; Sufficiency separates `[Building]`/`[Unknown]` — carry-in from C2, gates CST.004); AF-130 (cold-start ETA from ingestion rate is meaningful — gates CST.007)

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-9.CST.001.1
- AC-9.CST.001.2
- AC-9.CST.002.1
- AC-9.CST.002.2
- AC-9.CST.002.3
- AC-9.CST.003.1
- AC-9.CST.003.2
- AC-9.CST.004.1
- AC-9.CST.004.2
- AC-9.CST.005.1
- AC-9.CST.005.2
- AC-9.CST.006.1
- AC-9.CST.007.1
- AC-9.CST.007.2
- **Gating spikes (if any):** none. Neither blocked-by is an OD-157 launch-gating spike (ISSUE-001–006). Two build-time feasibility flags ride this slice and do **not** block ship: **AF-034** (EVAL — carry-in from C2, tagged on CST.001/CST.004) and **AF-130** (SPIKE build-time — the ingestion-rate ETA is meaningful, tagged on CST.007). Carry both per `spec/00-foundations/feasibility-register.md`; CST.007's ETA must degrade to "calculating" rather than fabricate an estimate (AC-9.CST.007.1) until AF-130 is proven.

## 5. Touches (complete blast radius, by ID)
- **DATA:** reads C2's per-deployment + per-entity coverage phase and per-entity Maturity (`DATA-entities.maturity`, produced by ISSUE-030 — read-only here) and C2's Retrieval Sufficiency verdict (derived inline, not stored); reads the verification queue/count from C2. Suppression gates the write path into `DATA-proactive_suggestions` (owned by ISSUE-070; this slice governs *whether* items surface, not the table schema). **No new table** — the cold-start policy/matrix is config + code; the phase itself is C2-owned.
- **PERM:** `PERM-system.tune` (Admin+, via `/tune`) **OR** `PERM-config.proactive` (Super-Admin, via surface-01) — either suffices for threshold edits (equivalent-guarantee alternate paths, FR-9.CST.003). No new PERM node introduced by this slice.
- **CFG:** `CFG-cold_start_basic_threshold` (20%), `CFG-cold_start_proactive_threshold` (50%), `CFG-cold_start_full_threshold` (80%) — the three ordered thresholds (basic ≤ proactive ≤ full), LIVE, no-deploy edits (FR-9.CST.003).
- **UI:** none built here. The cold-start banner + initialisation-progress indicator + `[Building]` pill are Phase 3 / C4; this slice produces only the CST.007 status contract they render.
- **Connectors:** none directly. The external-write read-only block (CST.005) is enforced on the C3/C6 path, not here — this slice only sets the phase flag it reads.

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-09-proactive.md — the `CST` area group (FR-9.CST.001–007) + their ACs; also the C9 seam table (Coverage/Maturity/`[Building]` → C2; proactive-suppression enforcement → C5/C6/C3; delivery → C7).
- spec/01-requirements/component-02-memory.md — the `MAT` area group (FR-2.MAT.002 phase, FR-2.MAT.003 Sufficiency, FR-2.RET.007) — the upstream signals this slice consumes (read-only; produced by ISSUE-030).
- spec/04-data-model/schema.md §3 Memory — the `entities.maturity` column this slice reads; §10 Proactive — the `proactive_suggestions` table whose surfacing this slice gates; §12 Config cluster — the config store for the three threshold keys.
- spec/00-foundations/adr/ADR-002-coverage-metric.md — the metric split, the `cold_start { 20, 50, 80 }` thresholds, and the one-time-mode (permanent deactivation at 80%) resolution.

## 7. Dependencies
- **Blocked-by:** ISSUE-030 (Maturity + cold-start gating signal — emits the per-deployment + per-entity phase and Sufficiency this slice consumes; not a spike, no gate). ISSUE-069 (seven proactive generators — the suggestion volume this slice suppresses; not a spike, no gate).
- **Blocks:** none (leaf).

## 8. Build order within the slice
1. Config: register the three threshold keys (`cold_start_basic_threshold` / `cold_start_proactive_threshold` / `cold_start_full_threshold`) as LIVE config with the ordered-invariant validator (basic ≤ proactive ≤ full) and reject-on-invalid keeping the prior value; wire the no-deploy edit path gated by `PERM-system.tune` OR `PERM-config.proactive` (FR-9.CST.003).
2. Phase read + freshness gate: read the C2-emitted phase (per-deployment and per-entity, from ISSUE-030), and build the **freshness check** — if the phase is missing *or* older than its expected refresh window, resolve to the most-restrictive (`cold`) phase; never fail open to `full` on a stale-`full` (FR-9.CST.001, AC-9.CST.001.2).
3. Phase-behaviour matrix (FR-9.CST.001): the config/code table mapping each phase → its behaviour set; expose the resolved phase + behaviour set for the enforcing owners (C5 loops, C6/C3 external-write) to consume.
4. Proactive suppression (FR-9.CST.002) — the enforcement this slice **owns**: below the proactive threshold, gate ISSUE-069's generator output so no proactive suggestion surfaces; unlock at/above. Implement the two-class carve-out — a C6/C7 guardrail-class safety event still flows on the C6/C7 alert path, and an at-floor escalating derisking risk (its `proactive_suggestions.is_floor` metric past threshold, AC-9.PRO.004.4) is still delivered despite suppression (AC-9.CST.002.3).
5. Per-entity `[Building]` framing (FR-9.CST.004): read C2's per-entity Maturity + Sufficiency; decide `[Building]` for a thin touched entity even in an otherwise covered deployment, and plain `[Unknown]` (no `[Building]`) once the deployment is past `cold_start_full_threshold`; unavailable per-entity coverage → treat as thin (conservative). Emit the verdict for the C4/Phase-3 pill.
6. Phase-flag set for seamed behaviours: set the cold-start phase flag that (a) the external-write read-only block reads (CST.005 — enforced by C6/C3/C5; below proactive threshold → external writes blocked-and-surfaced, at/above → normal C6 pipeline) and (b) the loop scheduler reads (CST.006 — below basic → reduced cadence, at/above → full; enforced by C5). This slice sets policy; verify the flag is readable by those owners.
7. Cold-start status contract (FR-9.CST.007): assemble phase + per-step init progress + coverage % + ETA (degrade to "calculating" when ingestion rate is unknown — never fabricate) + banner copy + the human-verification pass ranked highest-priority incomplete with its waiting-count (sourced from C2 verification); expose for Phase-3 rendering.
8. Observability hooks: log phase resolution + freshness fail-safe events, suppression decisions, and threshold edits (the config-audit path).
9. Tests to the fourteen ACs (§4) — including the stale-`full` fail-safe (AC-9.CST.001.2) and the two-class suppression carve-out (AC-9.CST.002.3).

## 9. Verification (how DoD is proven)
- Unit/integration per `spec/05-non-functional/test-strategy.md`: assert the fourteen ACs — most-load-bearing being (001.2) a stale-`full` phase fails safe to `cold`, never open; (002.1/002.3) proactive volume is fully suppressed below the proactive threshold **while** a guardrail-class alert and an at-floor escalating derisking risk still deliver; (003.2) an out-of-order/invalid threshold set is rejected with the prior value retained; (004.2) past the full threshold a gap reads `[Unknown]`, not `[Building]`; (005.1) a below-threshold external write is blocked-and-surfaced (asserted at the C6/C3 seam this slice's flag drives), never silently dropped; (007.1) the status contract shows "calculating" rather than a fabricated ETA when ingestion rate is unknown.
- No `AC-NFR-*` posture is claimed by this slice. Carry **AF-034** (EVAL) and **AF-130** (build-time SPIKE) as open feasibility flags against CST.001/004 and CST.007 respectively — neither blocks sign-off; the AC→`Verified` path for this slice is the fourteen ACs above passing on the built policy/gate layer over the ISSUE-030 signal and ISSUE-069 generators.
