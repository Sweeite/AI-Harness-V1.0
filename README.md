# AI Harness — Requirements Specification

This repo turns the **design doc** (`spec/source/design-doc-v4.md`) into a **build-ready
requirements spec**: atomic, testable, fully traceable, zero ambiguity.

Point A = a narrative design doc. Point B = a spec that decomposes into GitHub issues,
where every built artifact traces back to a requirement you signed off on.

---

## How this repo is organised

```
spec/
  source/              The original design doc + extraction scaffolding (read-only reference)
  00-foundations/      Decide-once layer: conventions, glossary, ADRs, standards, decision log
    process-overview.md  Full optics — what/want/goal/why/how (read after CLAUDE.md)
    phase-playbooks.md   The repeatable procedure for every phase (0→6)
    system-map.md        Top-down view: how it all fits + the e2e request route
    system-map/          Per-component zoom-ins + failure-overlay (the shadow map)
    what-makes-it-great.md  The quality bar + honest coverage audit (great vs good)
    working-with-me.md   Grounding mode — how to support the user when overwhelmed
    glossary.md          Every load-bearing term, defined once
    id-conventions.md    The ID scheme (FR/CFG/UI/DATA/PERM/AC/OD/ADR)
    requirement-template.md  The shape every functional requirement takes
    open-decisions.md    The OD log — every unresolved question (the anti-ambiguity gate)
    out-of-scope.md      Things consciously NOT built / deferred to v2 (OOS-*)
    feasibility-register.md  Assumptions that can only be proven by testing (AF-*)
    adr/                 Architecture Decision Records (the 7 load-bearing decisions + more)
    standards/           Cross-cutting patterns (config edit taxonomy, change control, migration discipline, tool-integration research, RBAC, UI states)
    tool-integrations/   Per-tool research dossiers (research-first gate for every new connector) + template + index
  01-requirements/     Functional requirements, one file per component (0..10)
  02-config/           Config registry (every tunable, classified + surfaced)
  03-surfaces/         Dashboard/UI specs (every surface, all states)
  04-data-model/       Consolidated schema, RLS, indexes, migrations
traceability-matrix.csv  The master index — walk any requirement end to end
```

## The traceability spine ("ribbons")

```
design-doc line ─► FR-<comp>.<area>.<n> ─► {CFG-*, UI-*, DATA-*, PERM-*} ─► AC-* ─► ISSUE# ─► PR# ─► TEST
```

Every ID is stable. The traceability matrix lets you walk from any design intent to the
code that implements it and the test that proves it — in both directions.

## The anti-ambiguity rule

A requirement cannot reach status `Ready` while any **Open Decision (OD-*)** points at it.
Nothing is "assumed." Everything ambiguous becomes a tracked OD with options + a
recommendation, and stays open until you resolve it.

---

## The plan (phases, dependency-ordered)

| Phase | What | Done when |
|---|---|---|
| 0 | Foundations: glossary, 7 ADRs, standards, templates, matrix | Conventions locked; load-bearing ADRs resolved |
| 1 | Functional requirements per component (0→10) | Every design line maps to ≥1 FR; zero open ODs per FR |
| 2 | Config registry: classify + surface every key | Every CFG has surface + edit-mechanism + validation; zero `???` |
| 3 | Dashboard/UI specs: every surface, all states | Every UI- surface fully specified |
| 4 | Data model: schema, RLS, indexes, migrations | Every DATA- ref consolidated + consistent |
| 5 | Non-functional: security, infra, observability, cost, compliance, **backup & disaster recovery**, test strategy | All NFRs explicit |
| 6 | Issue decomposition: vertical slices → GitHub issues **+ build-order / dependency map** | Every FR maps to an issue; every issue back to FRs; build sequence defined |

**Standing verification gate:** after each component, an independent agent re-extracts FRs
from the design prose and confirms no design line is orphaned. Mechanizes "nothing left out."

**Parallel feasibility track:** a spec proves the design is *coherent*, not that it *works*.
Assumptions that can only be confirmed by testing are logged in
`spec/00-foundations/feasibility-register.md` (IDs `AF-*`) with a verification method
(DOCS / SPIKE / EVAL / LOAD), and tagged `⚠️ FEASIBILITY` wherever they're relied on. Four
priority spikes (cost, memory retrieval, vendor-claims, provisioning) run alongside the ADR
phase because they can invalidate the architecture. Paper-vs-proven is always stated openly.

## Working rhythm (per component)

1. **I draft** the FR set + the OD list (decisions needed from you), each OD with a recommendation.
2. **You decide** the ODs.
3. **I finalize** acceptance criteria, wire traceability, run the verification agent, commit.

## Definition of done for the spec

- Every design-doc line traces to ≥1 FR (no orphans).
- Every FR is atomic, has acceptance criteria, has zero open decisions.
- Every config: captured, classified, surfaced, edit-mechanism defined, validated.
- Every surface: fully specified with all states.
- Every component explicitly **signed off by you** before it proceeds to build.
- Every exclusion / deferral logged in `out-of-scope.md` (no silent scope drift).
- Every FR → a GitHub issue; every issue → back to FRs, in a defined build order.

---

## Status

| Phase | Status |
|---|---|
| 0 — Foundations | 🟡 in progress |
| 1 — Requirements | ⚪ not started |
| 2 — Config | ⚪ not started |
| 3 — Surfaces | ⚪ not started |
| 4 — Data model | ⚪ not started |
| 5 — Non-functional | ⚪ not started |
| 6 — Issues | ⚪ not started |

Decisions chosen: spec home = git markdown repo · big decisions = grill load-bearing, fast-track rest · start = foundations then components in order.

ADRs: 🟢 ADR-001 (isolation) · 🟢 ADR-002 (coverage → Maturity + Retrieval Sufficiency; closes OD-008) · 🟢 ADR-003 (cost model — client-side viability + cost ladder; closes OD-003) · 🟢 ADR-004 (concurrency — per-entity serialize + optimistic validate-and-commit; closes OD-004) · 🟢 ADR-005 (deploy/provisioning — canary + release-train, scripted provisioning, bounded version skew; closes OD-005) · 🟢 ADR-006 (RLS/dynamic roles — static data-driven policies over live permission tables, intra-client only, instant grant/revoke; closes OD-006) · 🟢 ADR-007 (injection posture — containment-first, detection-as-signal, embedding scan off by default; closes OD-007). **All seven load-bearing ADRs landed.** Spikes: 🟡 **AF-003 (vendor-claims) DOCS pass done** — 3 claims stale/refuted (AF-010 Gmail quota, AF-011 GHL limits, AF-014 GHL refresh-token), 1 design fork (AF-012 Slack history throttle → OD-011); AF-013/015/016/018/020/021 verified; AF-019 stays SPIKE/LOAD-open. The 3 SPIKE/EVAL priority spikes (AF-001 cost, AF-002 retrieval, AF-004 provisioning) need a runnable prototype — deferred until build. Still open before Phase 1: OD-009 (backup/DR, elevated). New ODs: OD-011 (Slack app class). New: AF-068 (injection containment red-team).
