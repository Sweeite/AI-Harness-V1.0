---
id: ISSUE-068
title: Proactivity modes + action-autonomy matrix (Prepare-only, OD-161)
epic: I — proactive
status: blocked
github: "#68"
---

# ISSUE-068 — Proactivity modes + action-autonomy matrix (Prepare-only, OD-161)

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
The proactive-autonomy policy layer: stamp every proactive item with exactly one mode (Suggest / Prepare / Act) *derived from the C6 approval tier* (no second risk classifier), route every proactive action through the identical C6 pipeline as a reactive one, and enforce the operator-configurable action-autonomy matrix with its non-negotiable floor — capped at **Prepare** for every sub-type, no Act path anywhere (OD-161).

## 2. Scope — in / out
**In:** The C9 **MODE** area (FR-9.MODE.001–004) — the assignment + enforcement of proactive autonomy, upstream of the generators and the suggestion lifecycle:
- **Mode assignment (MODE.001/002):** every generated proactive item is stamped with exactly one mode ∈ {Suggest, Prepare, Act} before it is persisted; the mode is *mapped from the action's C6 tier* (auto→Act, soft→Prepare, hard→Suggest/Prepare-to-hard-queue), never from an independent C9 risk classifier; an indeterminate mode defaults to **Suggest** (conservative), never Act.
- **No-bypass invariant (MODE.003):** every proactive action — including any Act-mode tool call — traverses the identical C6 guardrail pipeline (approval tier, hard limits, anomaly, injection sanitization) that governs reactive actions; a proactive action that hits a hard limit or fails a guardrail check is blocked + logged + surfaced, never auto-executed on the basis of being "low-risk proactive"; guardrail-check errors fail closed.
- **Action-autonomy matrix + floor (MODE.004):** the operator-configurable matrix mapping an action's risk sub-type to its permitted maximum mode, with the write-time enforcement of the **non-negotiable floor** — low-risk-external (cold-lead/templated nurture to non-client contacts) is configurable between Suggest and **Prepare** only; the floored set (existing-client/SoR comms, financial, Confidential/Restricted) is fixed at hard-approval; **no sub-type can be configured to Act** (OD-161 — Act is not a reachable matrix value); sub-type-ambiguous → treated as floored; the floor caps the mode regardless of matrix or indeterminate-default (precedence). The matrix write path is gated by `PERM-guardrail.edit_autonomy` (Super-Admin only) and denied edits are logged.

**Out:**
- The **approval-tier policy + mandatory-hard set + escalation/flagged workflow** (the C6 tiers this slice *maps from* and the floor it *rides on*) → **ISSUE-056** (C6 APR/ESC). This slice consumes the C6 tier as an input to mode assignment; it does not classify the tier.
- The **seven hard limits (un-overridable code enforcement)** → **ISSUE-055** (C6 HRD). MODE.003 routes proactive tool calls *into* that gate; it does not build the gate.
- The **anomaly checks + injection sanitization** that the proactive action also traverses → **ISSUE-057 / ISSUE-059** (C6 ANM/INJ).
- The **seven proactive generators** that *emit* the items this slice stamps (PRO.001–007) → **ISSUE-069** (C9 PRO). This slice is upstream: it defines the mode the generators' output receives.
- The **suggestion lifecycle** — persist/rank/explain/deliver/dismissal-learn (SUG.001–005) → **ISSUE-070** (C9 SUG). A Prepare-mode item's *linked C5 task + delivery + persistence* is owned there; this slice only assigns the mode that lifecycle carries.
- The **cold-start phase gating** (CST.001–007) → **ISSUE-071** (C9 CST).
- The **autonomy-matrix editor UI** (rendering + edit surface) → the config-admin surface **ISSUE-086 / surface-01**; this slice owns the write-time floor/ceiling **validation logic** and the `PERM-guardrail.edit_autonomy` gate, not the rendered editor.
- **Config editing** of `action_autonomy_matrix` values themselves flows through surface-01; the stored object shape is Phase-4 schema.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs (C9 Proactive):** FR-9.MODE.001, FR-9.MODE.002, FR-9.MODE.003, FR-9.MODE.004.
- **Consumes / maps-from (do not re-spec):** FR-6.APR.001 (three-tier classification — the source of the mode mapping); FR-6.APR.002 (the mandatory-hard floor MODE.004 rides on, restored to all external comms per OD-161); FR-6.APR.003 (soft-auto reversible-only); FR-6.HRD.* + FR-6.ANM.* + FR-6.INJ.* (the pipeline MODE.003 traverses); FR-6.FMM.001 (fail-closed on guardrail-check error); FR-1.CLR.* / FR-1.RST.* (the Confidential/Restricted sub-type tags the floor rests on); FR-1.PERM.005 (the `PERM-guardrail.edit_autonomy` node discipline).
- **NFRs:** NFR-SEC.013 (no back-door — MODE.003 is a named implementer: every proactive path runs the identical node-gate + C6 pipeline, no bypass).
- **Rests on:** ADR-007 (containment-first — "no config change can override a hard limit"; the locked text OD-161 defers to); AF-068 (containment red-team — enforceability of the floor under the matrix); AF-131 (accuracy of the non-client / content-sensitivity classification the floor's sub-type resolution rests on).
- **Change-control provenance:** OD-083 (mode mapped from C6 tier + no-bypass, no second classifier), OD-088 (the configurable matrix — original operator decision, Act-tier portion now superseded), **OD-161** (the key reversal: FR-9.MODE.004's Act-tier autonomous external send rolled back to **Prepare-only**; low-risk-external never reaches Act; C6 FR-6.APR.002/003 floor restored to all external comms; the retired prior `AC-9.MODE.004.5` and renumbered `.6→.5`), OD-047 / OD-056 (the vindicated "low-risk automation flows through the approval gate, never autonomous" stance OD-161 restores).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- **MODE.001 (three modes + conservative default):** AC-9.MODE.001.1, AC-9.MODE.001.2.
- **MODE.002 (mapped from C6 tier + floored-set-never-Act):** AC-9.MODE.002.1, AC-9.MODE.002.2.
- **MODE.003 (identical C6 pipeline, no proactive bypass):** AC-9.MODE.003.1, AC-9.MODE.003.2.
- **MODE.004 (matrix + floor, Prepare-ceiling, write-time enforcement):** AC-9.MODE.004.1, AC-9.MODE.004.2, AC-9.MODE.004.3, AC-9.MODE.004.4, AC-9.MODE.004.5. *(Note: the former `AC-9.MODE.004.5` — send-time Act-tier client re-resolution, gate H1 — is **retired by OD-161** as the Act path it bounded no longer exists; the former `.6` is renumbered `.5`. Build only the five ACs listed.)*
- **NFR posture that must hold:** AC-NFR-SEC.013.1, AC-NFR-SEC.013.2 (a proactive action — from any invocation path — passes the identical node-gate + C6 pipeline; none is a bypass).
- **Gating spikes:** **AF-068 must be GREEN before ship** — the containment red-team (ISSUE-003) proves no authorized-but-dangerous autonomous path exists around the C6 hard-approval floor, which MODE.002/.004 rely on to guarantee no floored proactive action reaches Act. **AF-131** (non-client / content-sensitivity classification accuracy, EVAL) gates the correctness of the sub-type resolution that feeds AC-9.MODE.004.3; it is a build-time EVAL de-risking DoD note, not a ship-blocker on the scale of AF-068. (Both are currently 🔴 in `feasibility-register.md`.)

## 5. Touches (complete blast radius, by ID)
- **DATA:** `proactive_suggestions` (write `mode` — the `proactive_mode` enum column; per schema §10, MODE.001/002 stamp it). Read-only: `guardrail_log` (via C6 — the tier/hard-limit outcome MODE.003 routes through, written by ISSUE-056/055/060, not here); `config_values` (read the `action_autonomy_matrix` object at mode assignment, MODE.002/004). No `client_slug` (OD-096 — deleted from app tables; recipient client-status resolves via the C1/C2 system-of-record tags, not a slug).
- **PERM:** `PERM-guardrail.edit_autonomy` (Super-Admin only; the matrix write gate, MODE.004 — minted under the guardrail-config category, FR-1.PERM.005 discipline; default-deny; a non-Super-Admin edit is denied + logged per AC-9.MODE.004.4). Consumes C1 clearance / Restricted tags (FR-1.CLR.*/RST.*) as inputs to floored-sub-type resolution.
- **CFG:** `action_autonomy_matrix` (the structured config object — `config_values.value` JSON per schema §12; read at mode assignment, written only via the Super-Admin-gated MODE.004 path with the floor/ceiling validation this slice owns; the `act_trust_period_days` field + the standalone `external_act_trust_period` key are **removed** per OD-161 — do not reintroduce them).
- **UI:** the autonomy-matrix editor (surface-01 `UI-config-admin`) is a **seam** — Phase 3 / ISSUE-086 renders it over this slice's validation logic + `PERM-guardrail.edit_autonomy` gate; the mode is shown on the suggestion card (Phase 3, ISSUE-070/073 render). No surface is owned here.
- **Connectors:** none directly (a proactive Act/Prepare action's external send would flow through C3, but this slice only assigns the mode + routes through C6; it does not send).

## 6. Context manifest (the EXACT files to open — nothing more)
- `spec/01-requirements/component-09-proactive.md` — the **MODE** FRs/ACs (FR-9.MODE.001–004, the spine of this slice) + the OD-082…088 / OD-161 resolution table + the C9 seam statements.
- `spec/01-requirements/component-06-guardrails.md` — FR-6.APR.001/002/003 (the tiers this slice maps from + the floor it enforces) and FR-6.FMM.001 (fail-closed); read-only, the source of the tier input.
- `spec/00-foundations/open-decisions.md` — **OD-161** (the Prepare-only reversal — the load-bearing decision behind MODE.004's current shape), OD-088 (superseded Act-tier portion), OD-083, OD-047/056.
- `spec/04-data-model/schema.md` §10 Proactive (`proactive_suggestions` — the `mode` column + `proactive_mode` enum) and §12 Config cluster (`config_values` — the `action_autonomy_matrix` structured object).
- `spec/05-non-functional/security.md` §NFR-SEC.013 (no back-door — MODE.003 as named implementer).
- `spec/00-foundations/adr/ADR-007-*.md` (containment-first — "no config change can override a hard limit," the text OD-161 defers to); `spec/00-foundations/feasibility-register.md` (AF-068 ship gate + AF-131 status).

## 7. Dependencies
- **Blocked-by:** ISSUE-056 (approval tiers + mandatory-hard set + escalation workflow — this slice **maps** the proactive mode from the C6 tier ISSUE-056 assigns, and the MODE.004 floor is the proactive expression of ISSUE-056's non-downgradable mandatory-hard floor; without the tier classifier there is no mode to assign). **Gating spike:** AF-068 (proven by ISSUE-003) must be GREEN before ship (see DoD).
- **Blocks:** ISSUE-070 (suggestion lifecycle — persist/rank/explain/deliver/dismissal-learn; every item it persists carries the mode this slice stamps, and a Prepare-mode item's linked C5 task is created against the mode assigned here).

## 8. Build order within the slice
1. **Read the tier input (no new schema):** confirm the `proactive_suggestions.mode` column + `proactive_mode` enum are present (schema §10, landed by the ISSUE-070 lifecycle migration or earlier — verify, do not re-add) and that `config_values` can hold the `action_autonomy_matrix` object (schema §12). This slice adds no tables.
2. **PERM node:** mint `PERM-guardrail.edit_autonomy` (Super-Admin only, default-deny) under the guardrail-config category; it must appear in `PERMISSION_NODES.md` at build (FR-1.PERM.005 discipline). Deny-and-log any non-Super-Admin matrix write (AC-9.MODE.004.4).
3. **Mode-assignment mapper (MODE.001/002):** given a generated item + its C6 tier (from ISSUE-056), stamp exactly one mode — auto→Act, soft→Prepare, hard→Suggest/Prepare-to-hard-queue; indeterminate/tier-unavailable → **Suggest** (never Act). Persist the `mode` before the item is surfaced (upstream of ISSUE-070's `generated` state).
4. **Floored-set + matrix resolution (MODE.004):** resolve each action's risk sub-type from the C6 tier + C1 tags (recipient client/non-client via the system-of-record; content financial/Confidential/Restricted); floored sub-types are non-downgradable in code (not config); low-risk-external ceiling = **Prepare**; **Act is not a reachable value for any sub-type** (OD-161); sub-type-ambiguous → floored (hard). The floor caps the mode regardless of matrix or the MODE.001 indeterminate-default — floor always wins (AC-9.MODE.004.5 precedence).
5. **Matrix write-validation (MODE.004):** on a matrix edit (behind `PERM-guardrail.edit_autonomy`), **reject at write** any attempt to set a floored sub-type below hard (AC-9.MODE.004.2) or any sub-type to Act (AC-9.MODE.004.1) — the floor/ceiling is enforced before the config commits, mirroring the C6 AC-6.APR.002.1 write-time floor.
6. **No-bypass wiring (MODE.003):** route a proactive Act/Prepare item's tool call into the identical C6 pipeline (ISSUE-055/056/057/059) — no proactive-only path; a hard-limit hit blocks + logs + surfaces (AC-9.MODE.003.2); a guardrail-check error fails closed (FR-6.FMM.001). Assert no proactive bypass path exists (AC-9.MODE.003.1 / AC-NFR-SEC.013.1).
7. **Test to the ACs** (see Verification).

## 9. Verification (how DoD is proven)
- **Unit / policy layer:** the mapper stamps exactly one mode and defaults indeterminate → Suggest, never Act (AC-9.MODE.001.1/.2); auto→Act, hard→never-Act (AC-9.MODE.002.1); a floored-set action is never assigned Act (AC-9.MODE.002.2 — the load-bearing #2 test); the matrix rejects at write any floored-below-hard or any-to-Act edit (AC-9.MODE.004.1/.2); sub-type-ambiguous → floored (AC-9.MODE.004.3); the floor caps regardless of matrix/default (AC-9.MODE.004.5 precedence); non-Super-Admin matrix edit denied + logged (AC-9.MODE.004.4).
- **Integration:** a proactive Act/Prepare tool call runs the identical C6 pipeline as a reactive call, with no bypass path (AC-9.MODE.003.1); a proactive action hitting a hard limit is blocked + logged, never auto-executed (AC-9.MODE.003.2); a guardrail-check error fails closed.
- **No-bypass / E2E:** a proactive action invoked from any path passes the identical node-gate + C6 pipeline (AC-NFR-SEC.013.1/.2) — no proactive shortcut.
- **De-risking EVAL:** AF-131 — the non-client / content-sensitivity classifier feeding AC-9.MODE.004.3's sub-type resolution meets its accuracy bar (conservative on ambiguity → floored) before this slice's floor is trusted in production.
- **Ship gate:** AF-068 red-team GREEN in `feasibility-register.md` (per OD-157/RP-1) — no authorized-but-dangerous autonomous path around the C6 hard-approval floor — before this issue ships. Test layers per `spec/05-non-functional/test-strategy.md`.
