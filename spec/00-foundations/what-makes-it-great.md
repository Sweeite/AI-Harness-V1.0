# What Makes It Great — the quality bar + honest coverage audit

Two jobs in one doc:
1. **The bar.** The dimensions that separate a *functional* harness from a *great* one. Every
   component's requirements get checked against this — "did we do the great version here, or the
   good-enough one?" It's a gate, not a description.
2. **The audit.** For each dimension: **is the great version actually in our system?** Answered
   with where it lives (design-doc lines + ADRs) and an honest status. This answers "are the
   great things in the spec, or do we still need to capture them?"

**Status legend:** ✅ designed (in the design doc) · 🔵 hardened (decided/strengthened by an ADR)
· ⚠️ paper-pending-test (claimed but only a spike proves it — see AF) · 🔴 gap (not adequately
covered → tracked as an OD).

**Headline:** the design doc is genuinely ambitious — **most great-harness dimensions are already
designed in**, and several are hardened by our ADRs. The real gaps are few and now all tracked.

---

## The three non-negotiables (the operator's top bar)

Chosen explicitly by the operator (Austin). Failure is allowed; **silent** failure is not. These
three are inviolable: **when a Phase-1 trade-off pits one of these against convenience, speed, or
scope, the invariant wins.** They don't conflict with each other (they're integrity, safety,
observability) — they only cost rigor. This is the *ranking rule* for trade-offs, not just a wish.

| Invariant | Means | Held up by | Watch (what threatens it) |
|---|---|---|---|
| **1 · Never lose or corrupt knowledge** | memory integrity — nothing silently dropped, overwritten, or scrambled | supersede-not-delete · contradiction check · idempotency + per-entity serialize (ADR-004) · shadow-retain keeps a would-drop (ADR-003) · **backup/DR: PITR + independent client-owned off-platform copy + tested restore (ADR-008)** · dims #2,#3 | ⚠️ **AF-069** — the *restore* must be proven to work (a backup you've never restored is a guess); ADR-008 decided the posture, this is the paper-until-proven residual |
| **2 · Never do something it shouldn't** | bounded action — never acts outside its authority or the hard limits | hard limits enforced in **code** (L2053, L2066) · approval gates by risk · default-deny RBAC + RLS (ADR-006) · **containment-first injection posture (ADR-007)** — a tricked agent still can't escalate capability · dims #9,#10 | ⚠️ **AF-068** — the containment boundary must be **red-teamed** (no authorized-but-dangerous autonomous action path); the posture is decided, this is the paper-until-proven residual |
| **3 · Never fail silently** | observable failure — every failure surfaces to a human | heartbeats · amber zones · said-vs-did cross-checks · failure-health dashboard · every job logs its outcome · dim #5 | well-covered; the bar is keeping it true as each component is built |

These map onto the dimensions table below. Every component in Phase 1 is checked against them first.

---

| # | Dimension | The *great* bar | Where it lives | Status |
|---|---|---|---|---|
| 1 | **Failure handling** | per-step failure modes decided upfront (retry/skip/halt) · idempotent retries · graceful degradation (partial results) · detects *silent* failures | failure-mode map L2821 · per-step retry/skip/halt L3483 · DLQ L2585 · graceful degradation L2109 · silent-failure prevention L2857; idempotency ADR-004 | ✅🔵 |
| 1a | ↳ **compensation / rollback of partially-done chains** | a chain that already acted on the world (updated CRM) then halts has a defined cleanup/compensation story | not addressed — only halt+resume | 🔴 **OD-010** |
| 2 | **Memory compounds (doesn't rot)** | contradiction detection · consolidation (episodic→semantic, evidence kept) · erosion detection · confidence feedback loop | contradiction L1608 · consolidation L1776 · decay L1800 · erosion L1819 · feedback L1848 · confidence lifecycle L1662; ADR-002/003/004 | ✅🔵 + ⚠️ AF-002/031 (retrieval & writer *quality* unproven) |
| 3 | **Concurrency correctness** | per-entity serialize · idempotency · validate-and-commit; correct under fan-out | ADR-004 (was a doc gap, now closed) | 🔵 + ⚠️ AF-061/062/063 |
| 4 | **Cost discipline w/o quality loss** | controls-before-gates · model routing · cost ladder **with quality telemetry** (a silent quality regression is caught) | ADR-003 (dual-track AF-035) | 🔵 + ⚠️ AF-001/040-043 |
| 5 | **Observability of silent failure** | surfaces what's *degrading before it breaks* — amber zones, heartbeats, said-vs-did cross-checks | failure-health dashboard L3219 · heartbeats L2860 · cross-checks L2861 · amber zone L1697 | ✅ |
| 6 | **Trust / provenance** | every answer provenance-tagged · full audit trail · guardrail log as exportable trust evidence | answer pills L1755 · log-intent L3062 · guardrail log L2902 · personal/restricted audit L456 | ✅ + ⚠️ AF-033 (pill accuracy) |
| 7 | **Gets better over time** | self-healing + surfaced self-improvement + a **weekly feedback discipline** | self-healing L3547 · self-improvement L3567 · feedback flywheel/weekly review L3323 | ✅ (⚠️ surfacing usefulness unproven) |
| 8 | **Proactivity** | anticipates risk & opportunity, acting by risk tier (suggest/prepare/act) | component 9 (L3650+) | ✅ + ⚠️ depends on memory quality / AF-034 |
| 9 | **Determinism where it matters** | task graphs (deterministic orchestration) · structural limits in code, not prompts · hard limits can't be overridden | task graphs L2541 · hard limits in code L2053 · controls-before-gates ADR-003 | ✅🔵 |
| 10 | **Human-in-the-loop done right** | approval tiers matched to risk · escalations always resolve, never silently abandoned | approval tiers L2772 · escalation always resolves L2881 | ✅ |
| 11 | **Backup / disaster recovery** | tested restore · defined ownership under client-owned Supabase | PITR default + independent client-owned off-platform copy + operator-verified restore rehearsal + backup-health on the mgmt-plane push (ADR-008) | 🔵 + ⚠️ AF-069/070/071/072 |
| 12 | **Continuous quality evaluation** | systematic eval of prompt/agent output quality over time, not just ad-hoc | partial: self-improvement + AF flags + Phase 5 test strategy; no eval harness yet | ⚠️ firm up in Phase 5 |

## So — is the great stuff in our system?

**Mostly yes, and on purpose.** Dimensions 1–10 are designed in and several are ADR-hardened. The
*honest* picture:
- **🔴 One genuine gap left, tracked:** compensation/rollback of partial chains (OD-010). Backup/DR
  (was OD-009) is now decided — ADR-008 (PITR + independent client-owned off-platform copy + tested
  restore), residual is the paper-until-proven restore (AF-069).
- **⚠️ The rest of the risk is "great on paper, must be proven":** retrieval quality, writer
  quality, concurrency under load, cost envelope, pill accuracy — all in the feasibility register,
  to be tested by spikes. Greatness here is *claimed*, not yet *proven* — and that's stated, not hidden.
- **✅ Everything else is in the spec** and becomes real requirements in Phase 1.

## How this is enforced

Phase 1: each component's FRs are checked against the relevant rows here — if a dimension applies
and we only spec the "good" version, that's a flagged shortfall (an OD), not a silent choice. This
doc is the bar we hold every component to.
