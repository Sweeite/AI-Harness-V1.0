---
id: ISSUE-055
title: Seven hard limits — code enforcement, un-overridable
epic: G — guardrails
status: in-progress
github: "#55"
---

# ISSUE-055 — Seven hard limits — code enforcement, un-overridable

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Enforce the seven hard limits in application code as an un-overridable gate — block + log + alert on every hit, with no approve/override affordance anywhere — so no role, config, or prompt content can make the system act autonomously against the #2 non-negotiable.

## 2. Scope — in / out
**In:** The C6 HRD area in full — the code-layer gate for the seven autonomous prohibitions (① external email/send, ② financial transaction, ③ record delete, ④ cross-client data share, ⑤ impersonate a named human, ⑥ self-approve a queued action, ⑦ treat monitored-tool content as instructions); the immediate `guardrail_log` write (type `hard_limit`) + alert requirement, with the block holding even if the row write fails; the no-human-override posture (no approve affordance; `status='approved'` invalid for a `hard_limit` row); and the coverage-gap governance posture (new dangerous capabilities route to hard-approval + rate caps, never to new hard limits; changes go through change-control). This is the central code gate — the "code half" of the paired prompt+code defense.

**Out:** The Layer-1 *prompt statement* of the hard limits (C4 FR-4.CID.004) — this slice is the code half only and must not depend on the prompt half. The per-connector *declaration/application* of the limits at the tool grain (C3 FR-3.ACT.002) is owned by **ISSUE-035**, which blocks-on this issue for the central gate. The approval-tier policy + mandatory-hard set + escalation/flagged workflow are **ISSUE-056** (APR/ESC). The `guardrail_log` schema table + append-only trigger are stood up by the LOG slice — this issue consumes them and writes `hard_limit` rows. Alert *delivery* (dashboard + admin Slack) is C7, provided by **ISSUE-011**/ISSUE-075; this slice emits the event + asserts the surfacing requirement. The AF-068 containment red-team itself is **ISSUE-003** (spike).

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-6.HRD.001, FR-6.HRD.002, FR-6.HRD.003, FR-6.HRD.004 (component-06 Guardrails)
- **NFRs:** NFR-SEC.004, NFR-SEC.005
- **Rests on:** ADR-007 (containment-first: capability containment in code, not detection), AF-068 (containment red-team — enforceability proof, GREEN gate via ISSUE-003)

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-6.HRD.001.1, AC-6.HRD.001.2, AC-6.HRD.001.3
- AC-6.HRD.002.1, AC-6.HRD.002.2
- AC-6.HRD.003.1, AC-6.HRD.003.2
- AC-6.HRD.004.1, AC-6.HRD.004.2
- AC-NFR-SEC.004.1, AC-NFR-SEC.004.2, AC-NFR-SEC.004.3
- AC-NFR-SEC.005.1
- **Gating spikes:** AF-068 must be GREEN before this issue ships (ISSUE-003 red-team proves no authorized-but-dangerous autonomous path; per OD-047/OD-157/RP-1 the seven stay absolute and un-relaxed until AF-068 clears — this is a launch-blocking gate, NFR-SEC.004).

## 5. Touches (complete blast radius, by ID)
- **DATA:** DATA-guardrail_log (writes type `hard_limit`; relies on the schema-level `check (not (guardrail_type='hard_limit' and status='approved'))` — AC-6.LOG.001.2, the DB-level no-override guard)
- **PERM:** none new (hard-limit block is code, not an RLS predicate or a `can()` node; the agent path is `service_role` per ADR-004)
- **CFG:** none — hard limits are un-overridable by design; no config key may relax one (AC-6.HRD.001.2)
- **UI:** hard-limit `guardrail_log` rows render as recorded blocks with NO approve/override control (AC-6.HRD.003.1); the actual dashboard/queue view mechanism is C7/ISSUE-075 (this slice asserts the no-affordance requirement)
- **Connectors:** none directly (the connector-grain application is ISSUE-035)

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-06-guardrails.md — the HRD FRs (FR-6.HRD.001–004) + their ACs; the OD-060/OD-047 resolutions; the Consumed-from-C3/C4 seam notes
- spec/04-data-model/schema.md §7 Guardrails (C6) — `guardrail_log` table, the `guardrail_type`/`guardrail_status` enums, and the `check (not (hard_limit and approved))` constraint
- spec/05-non-functional/security.md — NFR-SEC.004 (code-enforced, non-overridable) + NFR-SEC.005 (gate-don't-promote coverage posture)
- spec/00-foundations/adr/ADR-007-injection-posture.md — the containment-first spine (capability containment in code, not detection)

## 7. Dependencies
- **Blocked-by:** ISSUE-011 (observability skeleton — `guardrail_log` append-only sink + alert/surfacing path the immediate-alert requirement of FR-6.HRD.002 rides on) · ISSUE-003 (SPIKE — must prove AF-068 GREEN before this ships)
- **Blocks:** ISSUE-035 (write tools + seven hard limits at the connector grain — needs the central gate) · ISSUE-053 (run pipeline — pre-execution gate sequencing invokes the hard-limit check)

## 8. Build order within the slice
1. Confirm the `guardrail_log` table + `guardrail_type`/`guardrail_status` enums + the `hard_limit`≠`approved` check constraint exist (schema §7, landed by the LOG slice); if absent, block on it — do not re-declare the table here.
2. Build the code-layer hard-limit gate: a central, in-code decision point that classifies an attempted autonomous action against the seven prohibitions and blocks it irrespective of role, config value, or prompt content (FR-6.HRD.001). It must NOT depend on the C4 prompt statement being present (AC-6.HRD.001.3 — defense-in-depth).
3. Wire the immediate log + alert (FR-6.HRD.002): on every hit write a `guardrail_log` row (type `hard_limit`) and emit the alert event to C7's surfacing path (ISSUE-011). Make the block **fail-closed w.r.t. the log write** — the block is final and holds even if the row write fails; the row is best-effort logging of an already-taken decision, never a co-requisite (AC-6.HRD.002.1, reusing the AC-6.LOG.003.3 / AC-5.JOB.006.2 surfacing pattern for a dropped alert, AC-6.HRD.002.2).
4. Enforce the no-override posture (FR-6.HRD.003): expose NO approve/override affordance for a `hard_limit` event; reject any `status→approved` transition on a `hard_limit` row at every path (DB check + application). This is the point that must stay disjoint from ISSUE-056's approval-queue approve/reject/modify (those apply only to approval-gate/anomaly/injection/rate-limit flags).
5. Enforce the agent-definition write guard (AC-NFR-SEC.004.2): reject at save any agent definition that would grant Comms-send / Finance-transact / a non-Memory-Agent memory write — rejected, not merely audited.
6. Implement the coverage-gap governance posture (FR-6.HRD.004 / NFR-SEC.005): a newly-identified dangerous capability is routed to hard-approval + a rate cap (hand-off points into ISSUE-056 APR / ISSUE-058 RTL), never promoted to an eighth hard limit; any change to the set is a change-control item, not a config edit, and not before AF-068 clears.
7. Test to the ACs — unit + agent-definition-write tests locally; the AF-068 red-team battery (AC-NFR-SEC.004.3) runs via ISSUE-003 and must be GREEN to ship.

## 9. Verification (how DoD is proven)
- Unit tests per `spec/05-non-functional/test-strategy.md`: the code gate blocks each of the seven under adversarial role/config/prompt inputs (AC-6.HRD.001.*); the DB check + application reject `status→approved` on a `hard_limit` row (AC-6.HRD.003.2, AC-6.LOG.001.2); log-write failure does not roll the block back (AC-6.HRD.002.1).
- Agent-definition-write tests: a definition granting a hard-limited capability is rejected at save (AC-NFR-SEC.004.2).
- **AF-068 red-team (ISSUE-003, SPIKE):** drive the running system with live payloads and confirm no authorized-but-dangerous autonomous path reaches a hard-limited effect without an explicit, authorized, non-bypassable human step (AC-NFR-SEC.004.3). This is the launch-blocking `AC-NFR-SEC.004`→`Verified` path (RP-1); the FR is Approved-on-paper but the enforceability claim is GREEN only when AF-068 clears.
- Governance (DOCS): a hard-limit-set change is shown to route through change-control, and a new dangerous capability lands on hard-approval + a rate cap (AC-NFR-SEC.005.1).
