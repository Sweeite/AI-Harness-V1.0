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
| 1 — Requirements | 🟡 in progress — **C0 (Login) ✅ Approved** (42 FRs) · **C1 (RBAC) ✅ Approved 2026-06-24** (37 FRs; OD-024…OD-031 resolved; verification gate clean — orphan/contradiction CLEAN + 5 service-role-seam findings reconciled; `standards/rbac.md` written; matrix + system-map wired). **Next: component 2 (Memory).** |
| 2 — Config | ⚪ not started |
| 3 — Surfaces | ⚪ not started |
| 4 — Data model | ⚪ not started |
| 5 — Non-functional | ⚪ not started |
| 6 — Issues | ⚪ not started |

Decisions chosen: spec home = git markdown repo · big decisions = grill load-bearing, fast-track rest · start = foundations then components in order.

ADRs: 🟢 ADR-001 (isolation) · 🟢 ADR-002 (coverage → Maturity + Retrieval Sufficiency; closes OD-008) · 🟢 ADR-003 (cost model — client-side viability + cost ladder; closes OD-003) · 🟢 ADR-004 (concurrency — per-entity serialize + optimistic validate-and-commit; closes OD-004) · 🟢 ADR-005 (deploy/provisioning — canary + release-train, scripted provisioning, bounded version skew; closes OD-005) · 🟢 ADR-006 (RLS/dynamic roles — static data-driven policies over live permission tables, intra-client only, instant grant/revoke; closes OD-006) · 🟢 ADR-007 (injection posture — containment-first, detection-as-signal, embedding scan off by default; closes OD-007) · 🟢 ADR-008 (backup/DR — hourly client-owned off-platform snapshot default + PITR opt-in upsell + operator-verified restore + backup-health on the mgmt-plane push; golden rule = source data referenced not copied; closes OD-009). **All load-bearing ADRs landed; no Phase-0 blockers remain.** Spikes: 🟡 **AF-003 (vendor-claims) DOCS pass done** — 3 claims stale/refuted (AF-010 Gmail quota, AF-011 GHL limits, AF-014 GHL refresh-token), 1 design fork (AF-012 Slack history throttle → OD-011); AF-013/015/016/018/020/021 verified; AF-019 stays SPIKE/LOAD-open. The 3 SPIKE/EVAL priority spikes (AF-001 cost, AF-002 retrieval, AF-004 provisioning) need a runnable prototype — deferred until build. New ODs: OD-011 (Slack app class, 🟡, Phase-1 Slack connector). New AF: AF-068 (injection containment red-team), AF-069–072 (backup/DR — restore-works, mgmt-API fields, region/residency, dump-at-scale).

**Phase 1 entered (2026-06-24).** Component 0 (Login) scope finalized as the golden exemplar (auth-only: login/2FA/sessions/invites/seed/recovery/webhook-auth; connector OAuth → C3, roles/RLS → C1 — see phase-playbooks "Component 0 entry finalization"). **Supabase Auth research-first gate run** (Block J in feasibility-register, 2026-06-24): a dated primary-source pass **refuted/corrected 6 design-doc claims** — 7-day refresh-token TTL (refresh tokens never expire, rotate single-use), HTTP-only cookies (not the default), "server-side session continues mid-task" (no such object), org-wide `two_factor_required` config (must be built via aal2 RLS + app gating), 72h invite links (24h hard cap), Microsoft Authenticator (unnamed; rests on RFC-6238). New **AF-073–077**; **AF-067 sharpened** (the `(select …)` initPlan rule — `STABLE` alone ≠ once-per-statement). **Component-0 FRs drafted + resolved (2026-06-24, Session 16):** `spec/01-requirements/component-00-login.md` — **42 live FRs** (AUTH ×10 · SESS ×8 · INV ×7 · SEED ×3 · REC ×6 · WHK ×8) + 1 retired (REC.004), all at `Ready`, citing Block J for vendor facts; the 6 refuted design-doc claims carried as a doc-reconciliation table. **OD-012…OD-023 all resolved** — headline: **OAuth-only for client-tenant users; password+2FA for external Super Admins only** (OD-018), which dissolved the credential-reset recovery flow (REC.004 retired) and the phone field. **Verification gate run** (2 zero-context subagents): orphan/contradiction pass **clean**; quality pass found **6 findings, all reconciled** (seed-race → atomic guard FR-0.SEED.003; +FR-0.AUTH.010 audit-completeness, +FR-0.INV.007 email-bounce, +FR-0.REC.007 stale-request; missed-webhook seam parked to C2/C3/C7; backup covered by ADR-008). New **AF-078** (webhook verification, block K). Glossary +AAL/aal2, +refresh-token rotation, +JWKS. **Component 0 is signed off** (user-authorized, delegated) — 42 FRs `Approved`, `system-map/00-login.md` built, `traceability-matrix.csv` wired, OOS-015 logged (email-bounce deferral), ADR-007 cross-ref reconciled. Next: component 1 (RBAC).

**Component 1 (RBAC) drafted + resolved + Approved (2026-06-24).** `spec/01-requirements/component-01-rbac.md` — **37 FRs** (ROLE ×5 · PERM ×7 · CLR ×6 · RST ×3 · RLS ×8 · USR ×5 · AUD ×3), all `Approved`. ADR-006 is the spine (permissions-in-data · static data-driven RLS via `(select …)` initPlan · instant grant+revoke · intra-client only · harness/RLS division · human-path-RLS vs agent-path-service_role). **OD-024…OD-031 resolved** (delegated C0-style). **Wrote the owed `standards/rbac.md`** (12 binding rules, promised since ADR-006). **Verification gate clean:** orphan/contradiction pass CLEAN (4 traps avoided: no `client_slug` in policies, no RLS-guards-agent assumption, Restricted never a role-default, no role-name-in-policy); quality pass found **5 findings clustered at the service-role/mid-task seam, all reconciled** → +**FR-1.RLS.007** (a service_role task halts+quarantines on mid-task deactivation/clearance-revoke before a consequential side effect; benign session-expiry continues, reconciling C0 FR-0.SESS.006), +**FR-1.RLS.008** (RLS/harness divergence observable), +**OD-031**, +**AF-081** (agent-path audit completeness), reactivation re-grant branch. New **AF-079/080/081** (block L). Caught + resolved a real design contradiction (L438 vs L452 — Restricted is per-individual only). Homed the C0 PERM stubs + role tables; `system-map/01-rbac.md` built; matrix wired (37 rows). **Next: component 2 (Memory)** — `system-map/02-memory.md` exists as the exemplar; C2 consumes the C1 clearance/visibility/Restricted model + the `(select …)` RLS pattern (AF-067), tags memories with a sensitivity tier + entity type, and owns the retrieval/injection mechanism that C1's CLR.006/RST.003 reference.
