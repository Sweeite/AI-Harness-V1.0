---
id: ISSUE-021
title: User management lifecycle + RBAC audit
epic: B — identity & access
status: blocked
github: "#21"
---

# ISSUE-021 — User management lifecycle + RBAC audit

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Deliver the post-invite user-authorization lifecycle (assign/change role, deactivate/reactivate, reset 2FA, view activity, grant/revoke clearance) and the complete RBAC/access audit trail — across both the human and `service_role` (agent) paths — rendered on surface-02.

## 2. Scope — in / out
**In:** The C1 **USR** area (the five post-invite lifecycle actions on an existing user's authorization) and the C1 **AUD** area (the completeness + content requirements for the Personal/Restricted access audit and every RBAC-mutation audit, plus the seam declaration to C7). The `service_role`-path audit coverage (agent-path Personal/Restricted access is audited via harness discipline, no DB backstop). The surface-02 **Users** tab actions and the per-user activity drawer, and the reason-capture-on-sensitive-mutation duty (NFR-SEC.016). Reactivation must NOT auto-restore above-Standard clearances or Restricted grants.

**Out:**
- Role model / permission matrix / `can()` gate itself — **ISSUE-018** (C1 ROLE, PERM). Last-Super-Admin protection (FR-1.ROLE.005) is *called* by the deactivate/role-change actions here but is owned and built there.
- Clearance model + Restricted model (the tier definitions, per-role defaults, entity-type scope, review cadence, Restricted per-individual rule) — **ISSUE-019** (C1 CLR, RST). This slice *invokes* grant/revoke; the model is built there.
- RLS enforcement (visibility/sensitivity/Restricted/aal2 predicates, instant-propagation on next query, mid-task revocation halt FR-1.RLS.007) — **ISSUE-020**. This slice relies on "effective next query" (FR-1.RLS.006, built in ISSUE-018/020) but authors no RLS policy.
- Invite issuance, setup page, seed, SMTP, bounce tracking (FR-0.INV.*/SEED.*) — **ISSUE-015**; the surface-02 Users tab *renders* those invite-lifecycle controls but the C0 logic is not built here.
- Audit **storage / retention / tamper-evidence / export** — **C7 / ISSUE-077** (FR-1.AUD.003 is the seam; this slice fixes only *what* is captured and *that* it is complete + immutable).
- Individual right-to-erasure (hard delete) — **ISSUE-082** (C10 DEL); this slice does revocation-not-deletion only.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs (Component 1 — RBAC):** FR-1.USR.001, FR-1.USR.002, FR-1.USR.003, FR-1.USR.004, FR-1.USR.005, FR-1.AUD.001, FR-1.AUD.002, FR-1.AUD.003.
- **NFRs:** NFR-SEC.016 (reason-capture on sensitive mutations).
- **Rests on:** ADR-006 (data-driven RBAC; grants effective on next query, no migration), ADR-004 (agent path runs as `service_role`, off RLS — why the agent-path audit is harness discipline), ADR-001 §3 (physical isolation; no `client_slug`), AF-081 (agent-path access-audit completeness).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-1.USR.001.1
- AC-1.USR.002.1, AC-1.USR.002.2
- AC-1.USR.003.1
- AC-1.USR.004.1
- AC-1.USR.005.1, AC-1.USR.005.2
- AC-1.AUD.001.1, AC-1.AUD.001.2
- AC-1.AUD.002.1
- AC-1.AUD.003.1
- AC-NFR-SEC.016.1
- **Gating spikes (if any):** none (blocked-by ISSUE-018/019 are feature issues, not spikes). **Build-time gating AF:** AF-081 (agent-path access-audit completeness) must be GREEN before ship — prove no agent-path Personal/Restricted access is unlogged (gates FR-1.AUD.001; same shape as the AF-076/079 coverage gates; per feasibility-register.md + test-strategy.md).

## 5. Touches (complete blast radius, by ID)
- **DATA:** DATA-user_roles (role assign/change, deactivate `active` flag), DATA-sensitivity_clearances (grant/revoke), DATA-restricted_grants (read — reactivation must not auto-restore), DATA-access_audit (append-only write — every mutation + every Personal/Restricted access), DATA-roles (read, last-Super-Admin count guard invoked from ISSUE-018). Supabase-managed (referenced, not defined here): `auth.mfa_factors` (2FA reset), profiles/`users` `active` flag.
- **PERM:** PERM-user.assign_role, PERM-user.deactivate, PERM-user.reset_2fa, PERM-user.view_activity, PERM-user.grant_clearance. (Nodes homed in ISSUE-018's `PERMISSION_NODES.md` catalog; consumed here.)
- **CFG:** none owned here. (`clearance_review_cadence_days` is read by ISSUE-019's Reviews path, not this slice.)
- **UI:** UI-USER-MGMT (surface-02 Users tab, incl. UI-USER-ACTIVITY folded into the per-user detail drawer).
- **Connectors:** none.

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-01-rbac.md — the USR + AUD FR text and their ACs (§USR FR-1.USR.001–005; §AUD FR-1.AUD.001–003).
- spec/04-data-model/schema.md §2 (RBAC & Access) — `user_roles`, `sensitivity_clearances`, `restricted_grants`, `access_audit`; and §Global-rules "Immutability enforcement (audit sinks)" for the `access_audit` append-only trigger.
- spec/03-surfaces/surface-02-user-mgmt.md — the UI-USER-MGMT (Users) section: data bindings, actions, PERM gates, and states.
- spec/05-non-functional/security.md §NFR-SEC.016 — the reason-capture posture (and adjacent NFR-SEC.012 for the mid-task halt seam owned by ISSUE-020).
- spec/00-foundations/adr/ADR-006-*.md (data-driven RBAC, next-query propagation), ADR-004 (service_role agent path), ADR-001 §3 (physical isolation).

## 7. Dependencies
- **Blocked-by:** ISSUE-018 (role model + permission matrix + `can()` gate — the nodes + last-Super-Admin guard this slice calls), ISSUE-019 (clearance + Restricted model — the grant/revoke targets this slice invokes). Neither is a spike.
- **Blocks:** ISSUE-082 (individual right-to-erasure workflow — depends on the audit trail + user-lifecycle actions built here).

## 8. Build order within the slice
1. **Migration prerequisite check** — confirm schema.md §2 tables (`user_roles`, `sensitivity_clearances`, `restricted_grants`, `access_audit`) and the `access_audit` append-only trigger already landed via ISSUE-008/018/019; this slice adds no new table, only the lifecycle + audit logic on top.
2. **`access_audit` write path (AUD spine first)** — build the append-only audit writer used by every action below: actor, actor_type (human vs `service_role`), action, target, before/after, reason, path_context, originating_user_id. This is a prerequisite of every USR mutation (FR-1.AUD.002) and every Personal/Restricted access (FR-1.AUD.001), so build it before the actions so no action can ship un-audited (#3).
3. **USR mutations, each writing an audit record via step 2:** FR-1.USR.001 (assign/change role → `user_roles`; call ISSUE-018's last-Super-Admin guard on the last-SA branch), FR-1.USR.002 (deactivate → `active=false`, sessions invalidated; reactivate must re-read `restricted_grants`/`sensitivity_clearances` and NOT auto-restore above-Standard — AC-1.USR.002.2), FR-1.USR.003 (reset 2FA via Supabase `auth.mfa_factors` admin API; OAuth-user branch = explicit no-op, not false success), FR-1.USR.005 (grant/revoke clearance → `sensitivity_clearances`; Admin-denied, Super-Admin-only; Restricted-tier attempt routes to ISSUE-019's Restricted flow).
4. **Agent-path (`service_role`) audit coverage** — FR-1.AUD.001 branch: every agent-path Personal/Restricted read/write/injection appends an `access_audit` row with `originating_user_id` set; this is the AF-081 completeness surface (no DB backstop on the service_role path — harness discipline).
5. **FR-1.USR.004 view path** — the gated, read-only activity drawer over `event_log`/`access_audit`, with Personal/Restricted entries redacted unless the viewer is cleared, and the view itself audited.
6. **Reason-capture (NFR-SEC.016)** — mandatory reason on Restricted grants (enforced in ISSUE-019's Restricted flow, asserted here as content), optional-but-captured on role change / clearance revoke / deactivation → written to `access_audit` (OD-112).
7. **surface-02 Users tab wiring** — bind the actions above to UI-USER-MGMT per surface-02 (PERM-gated per action; no-op/failed states surfaced, never silent).
8. **FR-1.AUD.003 seam note** — leave storage/retention/export to C7 (ISSUE-077); do not build retention here.
9. **Tests to the ACs** in §4.

## 9. Verification (how DoD is proven)
- Per spec/05-non-functional/test-strategy.md: build-time / integration tests for each USR action AC; an **audit-completeness** test proving every USR mutation and every Personal/Restricted access (both human and `service_role` paths) writes an immutable `access_audit` row (FR-1.AUD.001/002; the AF-081 assertion for the agent path). Immutability proven by attempting UPDATE/DELETE on `access_audit` and asserting the append-only trigger rejects it.
- Reactivation test: a previously-deactivated user holding a Restricted grant is reactivated and the grant is NOT auto-restored (AC-1.USR.002.2).
- NFR-SEC.016 posture: a Restricted grant without a reason is rejected; a reason given on a non-Restricted sensitive mutation is written to `access_audit` (AC-NFR-SEC.016.1).
- AF-081 must be GREEN (agent-path audit completeness) before sign-off; FR-1.AUD.003's C7 seam is a scope boundary, not a test here.
