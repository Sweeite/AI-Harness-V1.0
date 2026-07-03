---
id: ISSUE-019
title: Clearance + Restricted model — four tiers, per-role defaults, entity-scope, per-individual grants
epic: B — identity & access
status: blocked
github: "#19"
---

# ISSUE-019 — Clearance + Restricted model — four tiers, per-role defaults, entity-scope, per-individual grants

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Build the ADR-006 sensitivity-clearance and Restricted-grant *model + grant/revoke flows* — the four
tiers, the per-role default clearances, entity-type-scoped grants, the configurable review cadence,
and the per-named-individual Restricted grant with mandatory reason — so downstream memory tagging,
RLS enforcement, and retrieval slices have a data-driven clearance substrate to read.

## 2. Scope — in / out
**In:** The clearance/Restricted *authorization model and its mutation flows*, sitting on the ISSUE-018
`can()` gate and the ISSUE-008 tables. Concretely: (a) the **four sensitivity tiers** — Standard
(implicit), Confidential, Personal, Restricted — as the definitional model consumed by memory + RLS
(FR-1.CLR.001); (b) the **per-role default clearances + entity-type scope** seeded with the six roles
(FR-1.CLR.002), noting that Restricted is *never* a role default (doc-reconciliation #2); (c) the
**explicit-grant-never-inherited** rule and the grant flow behind `PERM-user.grant_clearance`
(FR-1.CLR.003); (d) **entity-type scoping** of a clearance — a `sensitivity_clearances.entity_type_scope`
that bounds the tier to specified entity types, `null` = Global (FR-1.CLR.004); (e) the **configurable
review cadence** with the flag-and-escalate default and the `fail_closed` auto-revoke opt-in
(FR-1.CLR.005); (f) the **per-named-individual Restricted grant** with mandatory reason, instant
revoke, and the never-a-role-default invariant (FR-1.RST.001, FR-1.RST.002); (g) the **never
auto-injected** rule for Restricted content (FR-1.RST.003) — the *rule* is owned here, the retrieval
*mechanism* is ISSUE-025. This slice writes/reads `sensitivity_clearances` and `restricted_grants`
and audits every grant/revoke to `access_audit`.

**Out:** The **RLS row-access predicates** that read this model at the DB — visibility ∩ sensitivity ∩
Restricted, the `aal2` clause, mid-task revocation re-check, harness/RLS divergence signal
(FR-1.RLS.002 full predicate / .003 / .005 / .007 / .008) — are **ISSUE-020**. The **clearance +
visibility enforcement *before ranking/injection* in the retrieval pipeline** (the FR-1.CLR.006
*harness-path mechanism* and the AF-067 hot-path composition) is **ISSUE-025** (retrieval); this slice
owns FR-1.CLR.006 only as the *definitional control-before-gate rule*, not its retrieval wiring.
Memory **sensitivity tagging** at write (C2 TAG) is **ISSUE-022**. The `roles`/`role_permissions`/
`user_roles` model and the `can()` gate are **ISSUE-018**. Per-clearance grant/revoke **UI**
(`UI-CLEARANCE-MGMT` / `UI-CLEARANCE-REVIEW` / `UI-RESTRICTED-GRANT`) and the user-management lifecycle
that drives them (FR-1.USR.005) are **ISSUE-021**. The `access_audit` **completeness posture**
(NFR-SEC.016 reason-capture, agent-path coverage AF-081) is **ISSUE-021**; this slice only *writes* the
grant/revoke records the audit slice later proves complete.

> **Integration note (bundled FRs).** CLR and RST are one coherent model: the four tiers (CLR.001)
> define the ladder; per-role defaults (CLR.002) seat every role on it except for Restricted, which
> CLR.002-Notes + RST.001 pull out into a strictly per-individual grant (doc-reconciliation #2 — L438's
> "Restricted for Super Admin" is *authority to grant*, not a held default). Explicit-grant (CLR.003)
> and entity-type scope (CLR.004) are the two axes every non-Restricted grant carries; the review
> cadence (CLR.005) is the lifecycle maintenance on those grants; RST.002 adds the mandatory-reason +
> instant-revoke discipline unique to Restricted; RST.003 is the never-auto-inject invariant that both
> the RLS slice (020) and the retrieval slice (025) later enforce. Build the tier model and the two
> tables' grant/revoke flows as the shared substrate; 020 reads it at the DB, 025 reads it before
> ranking, 022 tags memories against it.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-1.CLR.001, FR-1.CLR.002, FR-1.CLR.003, FR-1.CLR.004, FR-1.CLR.005, FR-1.CLR.006
  (Component 1 — RBAC; CLR.006 owned here as the *control-before-gate rule*, its retrieval-path
  mechanism is ISSUE-025); FR-1.RST.001, FR-1.RST.002, FR-1.RST.003 (Component 1 — RBAC).
- **NFRs:** none (this is a pure model/flow slice; the clearance-model coverage ledger maps CLR/RST to
  ISSUE-019 with no NFR domain; NFR-SEC.016's reason-capture *posture* is claimed by ISSUE-021 though
  its mechanism is FR-1.RST.002 built here).
- **Rests on:** ADR-006 (part 1 — permissions/clearances in data, entity-type-scoped, edited from the
  dashboard, no migration; part 3 — instant grant/revoke); ADR-002 / ADR-003 ("controls before gates"
  — clearance + visibility are a *control* applied ahead of the retrieval gate); AF-067 (the live
  clearance predicate composes with pgvector ranking on the hot path — *proven* by ISSUE-002, *consumed*
  by CLR.006's retrieval mechanism in ISSUE-025, not by this model slice directly).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-1.CLR.001.1 (Restricted-tier memory is never auto-injected — the tier's defining handling rule)
- AC-1.CLR.002.1 (fresh deployment seeds each role's documented default clearances + scope)
- AC-1.CLR.003.1 (only-Standard user has no above-Standard access absent an explicit grant)
- AC-1.CLR.004.1 (a Finance-scoped Confidential clearance excludes a Confidential client-strategy memory)
- AC-1.CLR.005.1 (elapsed review, `fail_closed`=false → flagged + escalated, neither auto-revoked nor marked reviewed)
- AC-1.CLR.005.2 (elapsed review, `fail_closed`=true → auto-revoked, audited, and still alerted — never silent)
- AC-1.CLR.006.1 (a memory outside the requester's clearance is excluded *before* ranking, not ranked-then-hidden)
- AC-1.RST.001.1 (Restricted cannot be set as a role default — per-individual only)
- AC-1.RST.001.2 (a non-Super-Admin attempting to grant Restricted is denied)
- AC-1.RST.002.1 (a Restricted grant with no reason is rejected)
- AC-1.RST.002.2 (a Restricted grant writes an immutable audit record: granter, grantee, time, reason)
- AC-1.RST.002.3 (a revoked Restricted grant denies access on the user's next query)
- AC-1.RST.003.1 (a user holding a Restricted grant still gets no auto-injection; Restricted surfaces only via explicit audited access)
- **Gating spikes (if any):** none block this model slice directly. AF-067 (RLS/clearance hot-path
  latency — ISSUE-002 launch-gating spike, OD-157/RP-1) gates the *retrieval-path* enforcement of
  FR-1.CLR.006, which is ISSUE-025's DoD, not this slice's.

## 5. Touches (complete blast radius, by ID)
- **DATA:** `DATA-sensitivity_clearances` (schema.md §2 — write on grant/revoke/seed; `entity_type_scope`
  null=Global, `last_reviewed_at` drives the cadence, exactly-one-subject CHECK on user_id|role_id);
  `DATA-restricted_grants` (schema.md §2 — write on grant/revoke; `grantee_user_id` named individual,
  mandatory `reason`, `revoked_at` soft-delete); `DATA-access_audit` (schema.md §2 — append-only write
  on every grant/revoke); reads `DATA-roles` / `DATA-role_permissions` / `DATA-user_roles` (seed +
  effective-clearance resolution) and `DATA-entities.type` (for entity-type scope evaluation, C2).
- **PERM:** `PERM-user.grant_clearance` (Super Admin — grant/revoke a clearance); `PERM-user.grant_restricted`
  (Super Admin — grant Restricted per named individual); `PERM-system.add_sensitivity` (Super Admin,
  unseeded — the extension point behind CLR.001's "may add custom tiers later", not exercised in v1).
- **CFG:** `CFG-clearance_review_cadence_days` (LIVE, default 90); `CFG-clearance_review_fail_closed`
  (LIVE, default `false` — per-deployment opt-in to auto-revoke overdue reviews instead of flag+escalate).
- **UI:** none built here — `UI-CLEARANCE-MGMT`, `UI-CLEARANCE-REVIEW`, `UI-RESTRICTED-GRANT` are ISSUE-021.
- **Connectors:** none.

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-01-rbac.md — FR-1.CLR.001–006 + FR-1.RST.001–003 text + their ACs (the CLR + RST areas)
- spec/04-data-model/schema.md §2 (RBAC & Access) — `sensitivity_clearances`, `restricted_grants`,
  `access_audit` (DDL landed by ISSUE-008), and the `clearance_tier` enum in §Types
- spec/00-foundations/adr/ADR-006-rls-dynamic-roles.md — parts 1 & 3 (clearances-in-data, entity-type
  scope, instant grant/revoke)
- spec/00-foundations/adr/ADR-002-coverage-metric.md, spec/00-foundations/adr/ADR-003-cost-model.md —
  "controls before gates" (clearance/visibility as a control ahead of the retrieval gate; CLR.006's rule)

## 7. Dependencies
- **Blocked-by:** ISSUE-018 (Role model + permission matrix + `can()` gate — the `roles`/`user_roles`
  the per-role default clearances attach to, and the `can()` gate the grant flows call for
  `PERM-user.grant_clearance` / `PERM-user.grant_restricted`; not a spike).
- **Blocks:** ISSUE-020 (RLS enforcement reads this clearance/Restricted model at the DB), ISSUE-021
  (user-management + RBAC audit drive the clearance grant/revoke UI + audit-completeness), ISSUE-022
  (memory tagging tags memories against these four tiers).

## 8. Build order within the slice
1. **Tier model** — encode the four sensitivity tiers (Standard implicit, Confidential, Personal,
   Restricted) via the `clearance_tier` enum (schema.md §Types) + the definitional handling semantics,
   including the extension point (`PERM-system.add_sensitivity`) that keeps the model from hardcoding
   exactly four (FR-1.CLR.001).
2. **Per-role default seed** — extend the six-role provisioning seed (ISSUE-018) with each role's
   documented default clearances + entity-type scope, seating Super Admin/Admin at Personal-Global,
   HR/Finance/Account-Manager at their scoped tiers, Standard User at Standard-Global — and asserting
   **no role, including Super Admin, holds Restricted as a default** (FR-1.CLR.002 + RST.001 invariant).
3. **Clearance grant/revoke flow** — the `PERM-user.grant_clearance`-gated write to
   `sensitivity_clearances` with an entity-type scope, explicit-grant-never-inherited enforced (no code
   path confers a tier implicitly), audited to `access_audit` (FR-1.CLR.003, FR-1.CLR.004).
4. **Review cadence** — the loop/schedule that surfaces above-Standard clearances at
   `CFG-clearance_review_cadence_days`; on an un-actioned overdue review, flag+escalate by default, or
   auto-revoke (audited, still alerted) when `CFG-clearance_review_fail_closed`=true — never silent
   (FR-1.CLR.005).
5. **Restricted grant/revoke flow** — the `PERM-user.grant_restricted`-gated write to
   `restricted_grants`: named individual only (never a role/role_permissions default — reject at the
   model level), mandatory non-empty `reason`, granter/grantee/time captured, revoke = instant
   soft-delete effective next query, every grant/revoke to `access_audit` (FR-1.RST.001, FR-1.RST.002).
6. **Never-auto-inject rule** — encode FR-1.RST.003 as the model-level invariant (Restricted excluded
   from any automatic retrieval even for a holder; explicit audited access only) that ISSUE-020 (RLS)
   and ISSUE-025 (retrieval) then enforce; and FR-1.CLR.006 as the control-before-gate rule those
   slices realize (FR-1.RST.003, FR-1.CLR.006 rule-only).
7. **Tests to the ACs** — the DoD list above (seed correctness, scope exclusion, cadence both branches,
   Restricted per-individual + mandatory reason + instant revoke + never-auto-inject).

## 9. Verification (how DoD is proven)
- **Migration/DB-integration layer** (per spec/05-non-functional/test-strategy.md): a seed test
  asserting each role's default clearances + scope (AC-1.CLR.002.1); a scope-exclusion test that a
  Finance-scoped Confidential clearance excludes an out-of-scope Confidential memory (AC-1.CLR.004.1);
  an explicit-grant test that a Standard-only user has no above-Standard access absent a grant
  (AC-1.CLR.003.1).
- **Unit / flow layer:** the two review-cadence branches — flag+escalate vs `fail_closed` auto-revoke,
  both non-silent (AC-1.CLR.005.1, AC-1.CLR.005.2); the Restricted grant flow — reject-without-reason,
  audit-record-on-grant, deny-on-revoke-next-query, cannot-be-a-role-default, non-Super-Admin-denied
  (AC-1.RST.002.1/.2/.3, AC-1.RST.001.1/.2).
- **Rule-level (contract):** the never-auto-inject invariant (AC-1.CLR.001.1, AC-1.RST.003.1) and the
  control-before-gate rule (AC-1.CLR.006.1) are asserted here as the model contract; their *enforcement*
  is Verified in ISSUE-020 (RLS) and ISSUE-025 (retrieval, where AF-067's GREEN spike is the blocking
  `AC → Verified` path). This slice's DoD is met when the model + flows pass; the enforcement ACs it
  shares are re-Verified in the enforcing slices.
