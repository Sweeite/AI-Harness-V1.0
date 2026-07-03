---
id: ISSUE-018
title: Role model + permission matrix + can() gate
epic: B — identity & access
status: blocked
github: "#18"
---

# ISSUE-018 — Role model + permission matrix + `can()` gate

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Build the C1 authorization core on the ISSUE-009 RLS scaffold — the six seeded roles + runtime role
CRUD, the data-driven permission matrix seeded from `PERMISSION_NODES.md`, and the single
`can(user, node, context)` harness gate (default-deny, two-level, no back-door) that every downstream
action routes through.

## 2. Scope — in / out
**In:** The **ROLE** and **PERM** area groups of C1. Concretely: (a) provisioning seeds exactly the
six default roles as data rows (`roles` + `role_permissions` + default `sensitivity_clearances`),
failing loud on a partial seed; (b) runtime role create/edit/delete entirely as data writes (no
migration/redeploy), Super-Admin-only, with the delete-if-unused + protected-role guard and the
last-Super-Admin no-lockout invariant; (c) the two-level enforcement model — the harness `can()`
check is the primary code gate, the prompt is advisory-only, both must agree; (d) **default-deny** —
absence of a grant is a denial, a brand-new node is denied for everyone until granted; (e) the single
`can(user, node, context)` gate that resolves a user's effective nodes (role → `role_permissions`)
plus context (entity-type scope, ownership) and that reads the **same** live tables RLS reads (the
non-drift invariant); (f) the permission matrix as data (role × node grant rows), edited from the
Super-Admin dashboard; (g) `PERMISSION_NODES.md` as the build-time catalog + the add-on-ship
discipline + the CI check that no gate ships without a catalog entry; (h) homing the thirteen-category
seed catalog and every C0 stub node with default-role assignments. The **Roles** and **Permissions**
tabs of surface-02 render this slice.

**Out:** The **CLR / RST** clearance and Restricted-grant model (FR-1.CLR.*, FR-1.RST.*) is
**ISSUE-019** — this slice seeds each role's *default* clearance rows (part of the FR-1.ROLE.001 /
FR-1.CLR.002 seed) but does **not** build the grant/revoke/review flows. The **RLS enforcement**
predicates (visibility ∩ sensitivity ∩ Restricted, aal2, mid-task revocation, the divergence signal
FR-1.RLS.002-full/.003/.005/.007/.008) are **ISSUE-020**; the RLS *scaffold* (helpers, default-deny
baseline, instant-propagation, coverage gate — FR-1.RLS.001/002-primitive/004/006) is **ISSUE-009**
(blocked-by). The **USR / AUD** post-invite lifecycle + RBAC audit (FR-1.USR.*, FR-1.AUD.*) and the
surface-02 **Users** tab are **ISSUE-021**. Table DDL + the append-only immutability trigger are
**ISSUE-008**. Command-dispatch node-gating (FR-9.CMD.*) is **ISSUE-072** (blocks). This slice does
not author any per-table sensitivity cell.

> **Integration note (bundled FRs).** ROLE and PERM are one coherent unit: the six seeded roles
> (ROLE.001) are meaningless without the matrix that assigns their nodes (PERM.004/.007), and the
> matrix is meaningless without the `can()` gate that reads it (PERM.001/.002/.003) and the catalog
> that sources it (PERM.005). The last-Super-Admin guard (ROLE.005) and the delete-if-unused guard
> (ROLE.004) are the two safety invariants over the role lifecycle; ROLE.005 additionally reaches into
> `PERM-user.deactivate` (an ISSUE-021 action) and role-change (an ISSUE-021 action), so this slice
> owns the *guard* while ISSUE-021 owns the *actions it guards* — build the guard as a shared
> precondition both slices call. `can()` and the RLS helpers must read the identical permission tables
> (AF-080 non-drift) — that is why `can()` is co-built against the ISSUE-009 helper contracts.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-1.ROLE.001, FR-1.ROLE.002, FR-1.ROLE.003, FR-1.ROLE.004, FR-1.ROLE.005; FR-1.PERM.001,
  FR-1.PERM.002, FR-1.PERM.003, FR-1.PERM.004, FR-1.PERM.005, FR-1.PERM.006, FR-1.PERM.007 (all
  Component 1 — RBAC).
- **NFRs:** NFR-SEC.013 (no back-door — every path runs the identical `can()` node-gate); NFR-SEC.005
  (coverage-gap posture — a gap fails safe to denial/approval, never to silent permission — the
  default-deny expression).
- **Rests on:** ADR-006 (parts 1/2/3/5 — permissions-in-data, static data-driven policies read live,
  instant grant/revoke, harness-owns-full-matrix / RLS-owns-row-access-subset); ADR-007
  (containment-first — a denied node is denied regardless of prompt content); FR-1.RLS.006 (ISSUE-009
  — instant propagation is why a matrix toggle takes effect on the next query); AF-080 (harness `can()`
  and RLS cannot drift — they read the same tables).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-1.ROLE.001.1 (fresh deployment → exactly the six named roles with default nodes + clearances)
- AC-1.ROLE.002.1, AC-1.ROLE.002.2 (toggle a node → effective next request no deploy; custom role
  immediately assignable)
- AC-1.ROLE.003.1 (Admin attempt to manage roles is denied + logged)
- AC-1.ROLE.004.1, AC-1.ROLE.004.2 (role with users → delete blocked with reassign message; unused +
  unprotected → deletable + audited)
- AC-1.ROLE.005.1, AC-1.ROLE.005.2 (last-Super-Admin removal/deactivation blocked; concurrent
  double-demotion → at most one succeeds, ≥1 Super Admin remains)
- AC-1.PERM.001.1 (harness deny holds even when the prompt instructs the AI to proceed)
- AC-1.PERM.002.1, AC-1.PERM.002.2 (node absent from a role → denied; brand-new unassigned node →
  denied until granted)
- AC-1.PERM.003.1 (context-scoped node with out-of-scope context → deny)
- AC-1.PERM.004.1 (matrix toggle adds/removes a `role_permissions` row, effective with no deploy)
- AC-1.PERM.005.1, AC-1.PERM.005.2 (new gate ships with a catalog entry carrying all four fields;
  admin matrix renders every catalog node, none hardcoded/omitted)
- AC-1.PERM.006.1, AC-1.PERM.006.2 (direct call to a denied endpoint → explicit auth error + logged;
  the surface is absent from the denied user's UI)
- AC-1.PERM.007.1 (seed catalog contains all thirteen categories + every C0 stub node with
  default-role assignments)
- AC-NFR-SEC.013.1, AC-NFR-SEC.013.2 (every invocation path hits the identical node-gate — no bypass;
  a destructive action's node-gate is evaluated before any confirm dialog)
- AC-NFR-SEC.005.1 (a coverage gap routes to denial/approval, never to silent permission)
- **Gating spikes (if any):** none is a blocked-by launch gate for this slice (ISSUE-009's AF-067 must
  already be GREEN as this issue's blocked-by chain). AF-080 (harness/RLS non-drift — EVAL
  differential test, feasibility-register block L, currently 🔴) is the build-time proof attached to
  FR-1.PERM.003 as a DoD note — `can()` and the RLS helpers must be shown to agree on the
  visibility/sensitivity/Restricted subset (the runtime divergence signal itself is ISSUE-020).

## 5. Touches (complete blast radius, by ID)
- **DATA:** `DATA-roles`, `DATA-role_permissions`, `DATA-user_roles` (write — seed + runtime CRUD +
  assignment counts for the delete/last-SA guards); `DATA-sensitivity_clearances` (write — the
  per-role *default* clearance seed only; grant/revoke flows are ISSUE-019); reads
  `DATA-restricted_grants` in `can()`'s effective-node resolution. Table DDL + `enforce_audit_append_only`
  trigger landed by ISSUE-008; default-deny policy + the four helper functions landed by ISSUE-009 —
  this slice consumes them, authoring no new DDL.
- **PERM:** `PERM-system.role_manage` (gates all role CRUD + matrix edits — Super Admin only);
  `PERM-user.deactivate` (referenced by the last-Super-Admin guard, FR-1.ROLE.005; the action itself is
  ISSUE-021). This slice **homes the full catalog** (`PERMISSION_NODES.md`, FR-1.PERM.005/.007) —
  seeding the thirteen categories' nodes with default-role assignments and the C0 stubs
  (`PERM-auth.provider_toggle`, `PERM-user.invite`, `PERM-support.view`, `PERM-support.resolve`).
- **CFG:** none (ADR-006 part 3: permission propagation is not token-TTL-bound; the JWT carries
  identity only).
- **UI:** `UI-ROLE-MGMT` (surface-02 Roles tab), `UI-PERMISSION-MATRIX` (surface-02 Permissions tab —
  category-grouped, generated from the catalog).
- **Connectors:** none.

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-01-rbac.md — FR-1.ROLE.001–005 + FR-1.PERM.001–007 text + their ACs
  (the ROLE and PERM areas); the doc-reconciliation notes (#4 matrix-is-tracked-not-frozen, #5
  three-layer enforcement)
- PERMISSION_NODES.md — the build-time node catalog this slice homes + seeds (FR-1.PERM.005/.007)
- spec/04-data-model/schema.md §2 (RBAC & Access) — `roles` (`is_default`/`is_protected`),
  `role_permissions` (unique(role_id, permission_node) = grant/deny), `user_roles` (unique(user_id) =
  one role per user, v1), `sensitivity_clearances` (default-seed rows)
- spec/03-surfaces/surface-02-user-mgmt.md — the Roles + Permissions tab states/actions (UI-ROLE-MGMT,
  UI-PERMISSION-MATRIX; OD-110 category-grouped matrix)
- spec/05-non-functional/security.md — NFR-SEC.013 (no back-door / single gate) + NFR-SEC.005
  (coverage-gap posture)
- spec/00-foundations/adr/ADR-006-rls-dynamic-roles.md — the spine (permissions-in-data, harness/RLS
  division of labour, instant change)
- spec/00-foundations/adr/ADR-007-containment.md — a denied node is denied regardless of prompt content

## 7. Dependencies
- **Blocked-by:** ISSUE-009 (RLS scaffold — the `can()` gate reads through the four helper functions
  and inherits the default-deny baseline; the permission tables + instant-propagation guarantee are its
  substrate). (No launch-gating spike is a direct blocked-by here; ISSUE-009's AF-067 gate must already
  be GREEN upstream.)
- **Blocks:** ISSUE-019 (Clearance + Restricted model — extends the seeded default clearances + the
  `can()` node set); ISSUE-021 (User-management lifecycle + RBAC audit — the role-assign/deactivate
  actions the ROLE.005 guard protects, and the matrix-mutation audit); ISSUE-072 (command dispatch —
  routes custom-command invocation through this `can()` node-gate, NFR-SEC.013/.014).

## 8. Build order within the slice
1. **Role seed** — provisioning writes the six default roles (`roles.is_default=true`, Super Admin
   `is_protected=true`) + their default `role_permissions` node sets + their default
   `sensitivity_clearances` rows, from the `PERMISSION_NODES.md` seed matrix; a partial seed fails loud
   (FR-1.ROLE.001, AC-1.ROLE.001.1).
2. **Catalog + matrix data** — load `PERMISSION_NODES.md` as the source of truth (thirteen categories,
   C0 stubs homed); the matrix is the presence/absence of `role_permissions` rows; wire the CI check
   that fails the build if a gate ships without a catalog entry (FR-1.PERM.004/.005/.007).
3. **The `can(user, node, context)` gate** — one function resolving effective nodes (role →
   `role_permissions`) + context (entity-type scope, ownership), default-deny, reading the **same**
   tables the ISSUE-009 RLS helpers read (FR-1.PERM.002/.003; AF-080 non-drift). Every gated call site
   converges on it (NFR-SEC.013 no back-door).
4. **Two-level enforcement** — the harness `can()` is primary and code-enforced; the prompt scope is
   advisory and never sufficient alone; a harness deny holds regardless of prompt content
   (FR-1.PERM.001, ADR-007).
5. **Denied-access behaviour** — denied surfaces absent in the UI; a direct/API attempt returns an
   explicit 403-equivalent auth error (OD-026), logged; never a silent empty/partial success
   (FR-1.PERM.006).
6. **Runtime role CRUD** — Super-Admin-only create/edit/delete + node toggles as data writes, effective
   next query (FR-1.ROLE.002/.003; FR-1.RLS.006 from ISSUE-009); delete allowed only when zero assigned
   users AND not protected, else blocked with a reason (FR-1.ROLE.004).
7. **Last-Super-Admin guard** — an atomic guard (ADR-004 pattern) blocking any removal/deactivation/
   role-change that would drop the Super Admin count to zero, safe under concurrency (FR-1.ROLE.005) —
   exposed as the shared precondition ISSUE-021's deactivate/role-change actions call.
8. **Surface wiring** — the surface-02 Roles + Permissions tabs (UI-ROLE-MGMT, UI-PERMISSION-MATRIX):
   the category-grouped matrix generated from the catalog, toggle-to-grant, blocked-delete + provisioning
   -incomplete + toggle-write-failure states.
9. **Tests to the ACs** — the DoD list above, including the AF-080 differential test proving `can()`
   and the RLS helpers agree.

## 9. Verification (how DoD is proven)
- **Unit/integration layer** (per spec/05-non-functional/test-strategy.md): a provisioning test
  asserting exactly the six roles with their seed nodes + default clearances (AC-1.ROLE.001.1); a
  `can()` battery over (user, node, context) covering default-deny, brand-new-node-denied, and
  out-of-scope-context (AC-1.PERM.002.1/.2, AC-1.PERM.003.1); a prompt-override test proving a harness
  deny holds regardless of prompt content (AC-1.PERM.001.1); a runtime-CRUD test proving a toggle/edit
  takes effect on the next request with no deploy and a custom role is immediately assignable
  (AC-1.ROLE.002.1/.2, AC-1.PERM.004.1).
- **Guard tests:** role-deletion (blocked-with-users vs unused-and-unprotected, AC-1.ROLE.004.1/.2);
  last-Super-Admin protection including the concurrent-double-demotion race (AC-1.ROLE.005.1/.2);
  Admin-attempt-to-manage-roles denied + logged (AC-1.ROLE.003.1).
- **Denied-access test:** a direct API call to a denied endpoint returns an explicit auth error and is
  logged, and the surface is absent from the denied user's UI (AC-1.PERM.006.1/.2).
- **Catalog/CI gate:** a build-time check that every gated action has a `PERMISSION_NODES.md` entry with
  all four fields and that the admin matrix renders every catalog node, none hardcoded/omitted
  (AC-1.PERM.005.1/.2); the seed-catalog completeness check (thirteen categories + C0 stubs,
  AC-1.PERM.007.1).
- **No-back-door test** (NFR-SEC.013): the same action invoked from desktop / `/`-command / quick-tap
  reaches the identical node-gate, and a destructive action's node-gate fires before any confirm dialog
  (AC-NFR-SEC.013.1/.2); the coverage-gap posture (AC-NFR-SEC.005.1) is a DOCS/build-time assertion that
  an ungated capability fails to denial, never to silent allow.
- **AF-080** differential test (build-time): for a matrix of (user, node, entity, tier) cases, `can()`
  and the RLS helper results agree on the visibility/sensitivity/Restricted subset — the blocking
  proof that the two readers cannot drift (the runtime divergence signal, FR-1.RLS.008, is ISSUE-020).
