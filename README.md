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
| 0 — Foundations | 🟢 complete |
| 1 — Requirements | 🟡 in progress — **C0 (Login) ✅ Approved** (42 FRs) · **C1 (RBAC) ✅ Approved 2026-06-24** (37 FRs) · **C2 (Memory) ✅ Approved 2026-06-25** (57 FRs — 56 Approved + 1 v2-deferred; OD-032…OD-038 resolved; verification gate clean — orphan/contradiction CLEAN + 7 quality findings reconciled; AF-082, OOS-016/017 logged; matrix + system-map wired). **C4 (Prompt Architecture) ✅ Approved 2026-06-26** (session 21) — **32 FRs** (LYR ×4 · CID ×6 · BIZ ×3 · INJ ×4 · TSK ×3 · PRIN ×3 · STO ×6 · OPT ×3), a content-definition component (C4 owns the layer content + storage; runtime assembly → C5, enforcement → C6). OD-048…OD-053 resolved; verification gate clean — orphan/contradiction CLEAN (all 6 traps PASS) + 7 quality findings reconciled (+FR-4.LYR.004 assembly-validates-safety-elements, principles-edit audit re-anchored, +the OD-053 principles **hard-floor**). AF-111 logged (EVAL, gates only the optimisation claim); matrix (32 rows) + system-map wired. **C5 (Agent Harness) ✅ Approved 2026-06-26** (session 22) — **43 FRs** (TRG ×5 · QUE ×6 · GRP ×4 · ENV ×3 · LOP ×5 · JOB ×7 · ASM ×9 · OPT ×4), the execution layer (triggers · task_queue · task graphs · context envelope · 3 loops · Inngest + DLQ · prompt-stack assembly + run pipeline · optimisations); enforcement → C6, observability → C7, orchestration → C8 are seams. OD-054…OD-059 resolved (OD-056 step-level approval + no-irreversible-outrun and OD-059 fresh-envelope chaining are the two #2-touching, user-decided; OD-054/055/057/058 delegated). Verification gate clean — orphan/contradiction CLEAN (all 6 traps PASS) + 11 quality findings reconciled (+FR-5.TRG.005 at-least-once event→task seam-atomicity, approval-wait + DLQ + chain-fire escalation reusing the C1/C2 don't-silently-abandon pattern, crash-window idempotency ordering, quarantine retains WIP). AF-112…AF-115 logged (block P — catch-up idempotency, parallel-DAG, compression fidelity, originals-store retention; all build-time, none hold an FR). Matrix (43 rows) + system-map wired. **C6 (Guardrails) ✅ Approved 2026-06-26** (session 23) — **35 FRs** (HRD ×4 · APR ×6 · ANM ×5 · RTL ×3 · ESC ×4 · INJ ×6 · LOG ×4 · OPT ×2 · FMM ×1), the enforcement layer ("the code half" of safety): code-side hard-limit enforcement · the 3 approval tiers + mandatory-hard set + contextual routing · 5 pre-step anomaly checks · rate-limit guardrails · the escalation/flagged workflow · the 4-step injection sanitization pipeline · the `guardrail_log` · optimisations. **ADR-007 is the spine** (containment-first; semantic scan off-by-default; thresholds are signal knobs; quarantine retains-not-discards). Carry-forwards **OD-047** (keep the seven hard limits absolute + gate-don't-promote coverage gaps) and **OD-010** (no auto-rollback + human-visible cleanup task) resolved here; OD-060…OD-066 resolved (the four #2-touching — OD-060 hard-limit-not-overridable, OD-064 soft-approval reversible-only, OD-047, OD-010 — surfaced to the operator, who delegated). Verification gate clean — orphan/contradiction CLEAN (all 6 traps PASS, the failure-map kept seamed not absorbed) + **12 quality findings reconciled** (the 3 HIGH were mechanism-wiring holes: +AC-6.INJ.001.2 named-harness-call-site, +AC-6.FMM.001.3 guardrail-check-itself-errors-fails-closed, +AC-6.LOG.003.3 log-write-failure-is-fail-closed; +M1 no-self-approval-at-human-tier, +M2 multi-fire-precedence, +M3 manifest tightened, +M4/M5 wait-point staleness owners, +M6/L1/L2/L3). AF-116/117 logged (EVAL — anomaly accuracy + injection-library coverage; build-time, none holds an FR); AF-068 still gates the enforceability *claim* of the hard limits. Matrix (35 rows) + system-map wired. **C7 (Observability) ✅ Approved 2026-06-26** (session 24) — **33 FRs** (LOG ×7 · RTP ×4 · ALR ×8 · COST ×4 · MGM ×5 · VIEW ×3 · OPT ×2), the **observability backbone** — `event_log` · the real-time-vs-polling contract · alerting (7 rules + routing + escalation + the engine watchdog) · the cost meter + ladder signal · the management-plane cross-deployment push (ADR-001 §7) + backup-health (ADR-008) · log retention/export. **Scope call (operator): backbone now, the 5 dashboard *surfaces* → Phase 3**; each panel's *signal* is produced by its home component (C2/C3/C5/C6/C8/C9). OD-067…OD-074 resolved (OD-068 cost-ladder ownership — C7 meters/signals, C6 decides, C5 executes, grounded in ADR-003 — and OD-074 log-erasure redaction-tombstone are the two user-decided #2/#1 calls; rest delegated). Verification gate clean — orphan/contradiction CLEAN (all 6 traps PASS) + **13 quality findings reconciled** (the strongest #3 backbone yet; the residual risk was the observability layer becoming its OWN silent point of failure: +FR-7.ALR.008 alert-engine watchdog, +AC-7.MGM.002.3 independent-heartbeat stale-detector, +AC-7.LOG.003.2 out-of-band log-failure path, +AC-7.LOG.003.3 cross-sink reconciliation, server-authoritative time, cost-unknown sentinel; F1 cost-seam corrected against ADR-003 — C5's "C7 enforces" line fixed via change-control + the owed C6 cost-ladder FR tracked). AF-118…AF-120 logged (block R — absence-of-signal liveness, out-of-band durability, clock-sync; all build-time, none holds an FR). OOS-028 (self-hosted Inngest, owed from C5) + OOS-029 (cross-deployment benchmarking, v2) logged. Carry-forward: C2 FR-2.MNT.017 owes a log-sink erasure amendment. Matrix (33 rows) + system-map wired. **Next: component 8 (Agent Design) — design-doc `## 8.` L3371–L3649.** · **C3 (Tool layer) ✅ Approved 2026-06-25** (session 20) — **53 FRs** (40 generic runtime: CONN/REG/TOK/RL/ACT-limits/TRIG/OPT/DSC + 13 connector instances: GHL/Google/Slack OBS/ACT/TOK/TRIG), citing the dossiers (not the design doc) for all vendor facts. Verification gate run: orphan/contradiction CLEAN (all 6 traps PASS) + **caught a real cross-component bug** — C0 FR-0.WHK.002 GHL webhook HMAC→**Ed25519**, corrected via change-control (**OD-046**); 10 quality findings reconciled (+FR-3.TRIG.005 watch re-arm, +FR-3.TRIG.006 event-gap reconcile, +8 AC tightenings). 3 viability gates hold FRs from build: Slack ingest (AF-083/084), GHL webhook (AF-090), GHL PHI (AF-098). Matrix (53 rows) + system-map wired. |
| 2 — Config | ⚪ not started |
| 3 — Surfaces | ⚪ not started |
| 4 — Data model | ⚪ not started |
| 5 — Non-functional | ⚪ not started |
| 6 — Issues | ⚪ not started |

Decisions chosen: spec home = git markdown repo · big decisions = grill load-bearing, fast-track rest · start = foundations then components in order.

ADRs: 🟢 ADR-001 (isolation) · 🟢 ADR-002 (coverage → Maturity + Retrieval Sufficiency; closes OD-008) · 🟢 ADR-003 (cost model — client-side viability + cost ladder; closes OD-003) · 🟢 ADR-004 (concurrency — per-entity serialize + optimistic validate-and-commit; closes OD-004) · 🟢 ADR-005 (deploy/provisioning — canary + release-train, scripted provisioning, bounded version skew; closes OD-005) · 🟢 ADR-006 (RLS/dynamic roles — static data-driven policies over live permission tables, intra-client only, instant grant/revoke; closes OD-006) · 🟢 ADR-007 (injection posture — containment-first, detection-as-signal, embedding scan off by default; closes OD-007) · 🟢 ADR-008 (backup/DR — hourly client-owned off-platform snapshot default + PITR opt-in upsell + operator-verified restore + backup-health on the mgmt-plane push; golden rule = source data referenced not copied; closes OD-009). **All load-bearing ADRs landed; no Phase-0 blockers remain.** Spikes: 🟡 **AF-003 (vendor-claims) DOCS pass done** — 3 claims stale/refuted (AF-010 Gmail quota, AF-011 GHL limits, AF-014 GHL refresh-token), 1 design fork (AF-012 Slack history throttle → OD-011); AF-013/015/016/018/020/021 verified; AF-019 stays SPIKE/LOAD-open. The 3 SPIKE/EVAL priority spikes (AF-001 cost, AF-002 retrieval, AF-004 provisioning) need a runnable prototype — deferred until build. New ODs: OD-011 (Slack app class, 🟡, Phase-1 Slack connector). New AF: AF-068 (injection containment red-team), AF-069–072 (backup/DR — restore-works, mgmt-API fields, region/residency, dump-at-scale).

**Phase 1 entered (2026-06-24).** Component 0 (Login) scope finalized as the golden exemplar (auth-only: login/2FA/sessions/invites/seed/recovery/webhook-auth; connector OAuth → C3, roles/RLS → C1 — see phase-playbooks "Component 0 entry finalization"). **Supabase Auth research-first gate run** (Block J in feasibility-register, 2026-06-24): a dated primary-source pass **refuted/corrected 6 design-doc claims** — 7-day refresh-token TTL (refresh tokens never expire, rotate single-use), HTTP-only cookies (not the default), "server-side session continues mid-task" (no such object), org-wide `two_factor_required` config (must be built via aal2 RLS + app gating), 72h invite links (24h hard cap), Microsoft Authenticator (unnamed; rests on RFC-6238). New **AF-073–077**; **AF-067 sharpened** (the `(select …)` initPlan rule — `STABLE` alone ≠ once-per-statement). **Component-0 FRs drafted + resolved (2026-06-24, Session 16):** `spec/01-requirements/component-00-login.md` — **42 live FRs** (AUTH ×10 · SESS ×8 · INV ×7 · SEED ×3 · REC ×6 · WHK ×8) + 1 retired (REC.004), all at `Ready`, citing Block J for vendor facts; the 6 refuted design-doc claims carried as a doc-reconciliation table. **OD-012…OD-023 all resolved** — headline: **OAuth-only for client-tenant users; password+2FA for external Super Admins only** (OD-018), which dissolved the credential-reset recovery flow (REC.004 retired) and the phone field. **Verification gate run** (2 zero-context subagents): orphan/contradiction pass **clean**; quality pass found **6 findings, all reconciled** (seed-race → atomic guard FR-0.SEED.003; +FR-0.AUTH.010 audit-completeness, +FR-0.INV.007 email-bounce, +FR-0.REC.007 stale-request; missed-webhook seam parked to C2/C3/C7; backup covered by ADR-008). New **AF-078** (webhook verification, block K). Glossary +AAL/aal2, +refresh-token rotation, +JWKS. **Component 0 is signed off** (user-authorized, delegated) — 42 FRs `Approved`, `system-map/00-login.md` built, `traceability-matrix.csv` wired, OOS-015 logged (email-bounce deferral), ADR-007 cross-ref reconciled. Next: component 1 (RBAC).

**Component 1 (RBAC) drafted + resolved + Approved (2026-06-24).** `spec/01-requirements/component-01-rbac.md` — **37 FRs** (ROLE ×5 · PERM ×7 · CLR ×6 · RST ×3 · RLS ×8 · USR ×5 · AUD ×3), all `Approved`. ADR-006 is the spine (permissions-in-data · static data-driven RLS via `(select …)` initPlan · instant grant+revoke · intra-client only · harness/RLS division · human-path-RLS vs agent-path-service_role). **OD-024…OD-031 resolved** (delegated C0-style). **Wrote the owed `standards/rbac.md`** (12 binding rules, promised since ADR-006). **Verification gate clean:** orphan/contradiction pass CLEAN (4 traps avoided: no `client_slug` in policies, no RLS-guards-agent assumption, Restricted never a role-default, no role-name-in-policy); quality pass found **5 findings clustered at the service-role/mid-task seam, all reconciled** → +**FR-1.RLS.007** (a service_role task halts+quarantines on mid-task deactivation/clearance-revoke before a consequential side effect; benign session-expiry continues, reconciling C0 FR-0.SESS.006), +**FR-1.RLS.008** (RLS/harness divergence observable), +**OD-031**, +**AF-081** (agent-path audit completeness), reactivation re-grant branch. New **AF-079/080/081** (block L). Caught + resolved a real design contradiction (L438 vs L452 — Restricted is per-individual only). Homed the C0 PERM stubs + role tables; `system-map/01-rbac.md` built; matrix wired (37 rows).

**Component 2 (Memory) drafted + resolved + Approved (2026-06-25).** `spec/01-requirements/component-02-memory.md` — **57 FRs** (MEM ×2 · ENT ×5 · TAG ×3 · ING ×10 · WRT ×7 · RET ×7 · MNT ×17 · VEC ×3 · MAT ×3), **56 Approved + 1 v2-deferred** (cold storage). The heart of the system — the durable, entity-organised, sensitivity-tagged business brain. Three ADRs converge: **ADR-002** (Maturity drives cold-start gating; Retrieval Sufficiency drives the `[Building]` flag), **ADR-003** (≤1 Sonnet writer wrapped in cheap Haiku gates; the design's two ingestion filters reconcile to ADR-003's selective-writing + sensitivity-classify gates — no third model layer), **ADR-004** (sole-writer `service_role` + per-entity validate-and-commit). C2 **consumes** C1's clearance/visibility/Restricted model (enforced **before** ranking, FR-2.RET.004) and **owns the mechanisms C1 only ruled on** — sensitivity+entity-type tagging, the retrieval pipeline, never-auto-inject-Restricted. **OD-032…OD-038 resolved** (5 delegated C0/C1-style; **OD-034 cold-storage deferred to v2 → OOS-016** and **OD-038 compliance-erasure rule homed here, backups seamed to Phase 5** decided by the user directly). **Verification gate clean:** orphan/contradiction pass **CLEAN** (all design intents L1338–1967 mapped, 3 deferrals logged OOS-016/003/017, all 5 traps PASS, no ADR/C1 contradictions; one citation slip L1407→**L1414** + two cross-ref slips fixed); quality pass found **7 findings, all reconciled** → +**FR-2.WRT.007** (embedding-failure halts commit, never stores a null/invalid embedding), +**AC-2.WRT.006.3** (mid-task revocation re-check at commit, realizing C1 FR-1.RLS.007), ingestion-queue durability + escalation (FR-2.ING.003/MNT.010, closed a Rule-0 dangling decision), transitive **compliance erasure** (FR-2.MNT.017 walks supersede chain + merged/summarised derived rows), escalation ACs on the human-gated queues, re-embed completeness gate (AC-2.VEC.003.2). New **AF-082** (entity-resolution accuracy — the fragmentation risk). `system-map/02-memory.md` reconciled; matrix wired (57 rows). **Next: component 3 (Tool layer)** — the connectors behind C2's three ingestion pipelines + the live-data fetch for relevance cross-check; resolves **OD-011** (Slack app class) and propagates the AF-003 corrected vendor limits.
