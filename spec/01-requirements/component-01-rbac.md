# Component 1 — RBAC: Roles, Permissions, Clearances & RLS (FRs)

> **Second component, pattern-matched to the C0 golden exemplar** (`component-00-login.md`).
> **C1 = authorization ("what you may do / see").** It answers the question C0's session
> deliberately left open: once `auth.uid()` is established (the C0→C1 seam), *what is this
> identity allowed to do, and which rows may it read/write?* C1 **homes** the `PERM-*` nodes C0
> referenced as stubs (`PERM-user.invite`, `PERM-auth.provider_toggle`, `PERM-support.view`,
> `PERM-support.resolve`) and the role tables (`user_roles`, `roles`) that C0's
> FR-0.INV.005 / FR-0.SEED.001 read. C1 is the spec home of **ADR-006** (data-driven RLS).

**Status:** 🟢 Approved — **37 FRs** decomposed, cited, and resolved; **OD-024…OD-031 resolved**; **verification gate clean** (orphan/contradiction pass CLEAN; quality pass found 5 findings at the service-role/mid-task seam, all reconciled — +FR-1.RLS.007/008, +OD-031, +AF-081, reactivation branch on USR.002); matrix + system-map wired.
**Sign-off:** ☑ **Approved 2026-06-24, user-authorized** — delegated C0-style ("lets sign off unless you think i need to review something"); ODs 024–031 resolved on my recommendations, the service-role-seam gate findings reconciled in-file. All 37 FRs set to `Approved`.
**Drafted:** 2026-06-24. **ODs resolved:** 2026-06-24 (delegated, C0-style). **Verification gate:** 2026-06-24 (2 zero-context subagents).

> **Spine:** ADR-006 is not a constraint *on* C1 — it largely *is* C1's architecture. The six binding
> parts of ADR-006 (permissions-in-data · static data-driven RLS · instant grant+revoke · intra-client
> only · harness+RLS division of labor · human-path-RLS / agent-path-service-role) map almost
> one-to-one onto the RLS/PERM/CLR FRs below. Where a FR restates an ADR-006 part, it cites it rather
> than re-deciding it.

---

## Context Manifest (load only these)

| Dependency | What it constrains here |
|---|---|
| **ADR-006** (data-driven RLS; service-role bypass) — **the spine** | Permissions live in tables, edited from the dashboard, no migration (part 1); RLS policies are static + generic, reading current permissions live via `STABLE SECURITY DEFINER` helpers keyed on `auth.uid()` (part 2); every change is instant (part 3); intra-client only, `client_slug` deleted (part 4); harness owns the full matrix, RLS owns the visibility/sensitivity/Restricted row-access subset (part 5); RLS guards the human path, `service_role` bypasses it (part 6). |
| **ADR-001 §3 / §4** (Silo isolation) | RLS is **intra-client only** — cross-client isolation is **physical** (one Supabase per client), never an RLS predicate. The doc's `client_slug` clause (`L724`) is **deleted**. |
| **ADR-004** (Memory Agent = sole writer as `service_role`) | The agent/backend write path is **off** the RLS path; its correctness rests on harness RBAC + the sole-writer invariant, not on `auth.uid()`. No C1 requirement may assume RLS guards a service-role write. |
| **ADR-002 / ADR-003** (memory retrieval; "controls before gates") | Clearance + visibility are enforced **before ranking/injection** (`L464`, `L1725`) — RBAC is a *control*, applied ahead of the retrieval gate. The hot-path performance of the live RLS lookup is **AF-067**. |
| **ADR-007** (containment-first) | Default-deny RBAC + RLS are named by ADR-007 as part of the **containment boundary** that makes a successful prompt injection *harmless* — a denied node is denied regardless of what a prompt says. |
| **C0 seam** (`component-00-login.md`) | C0 establishes `auth.uid()` / session `aal`. C1 **consumes** it: FR-0.INV.005 routes by assigned role (defined here), FR-0.SEED.001 assigns the Super Admin role (table defined here), and **FR-0.AUTH.008's `aal2`-coverage requirement** is realized in the RLS policies authored here. |
| **Standards:** `config-edit-taxonomy.md`, `migration-discipline.md`, **`rbac.md` (NEW — authored this session)** | `rbac.md` codifies the two-level model, default-deny, the RLS-vs-harness division, the service-role caveat, entity-type-scoped clearance, and the `PERMISSION_NODES.md` convention (owed since ADR-006). |
| **Feasibility** | **AF-067** (live data-driven RLS performs on the hot path; the `(select …)` initPlan rule) · **AF-076** (complete `aal2` RLS coverage, from C0) · **AF-079 / AF-080** (new — RLS coverage completeness; harness/RLS non-drift). |
| **Design doc** | `design-doc-v4.md` **L397–639** (the RBAC system: two-level checks, six default roles, the permission matrix, `PERMISSION_NODES.md`, sensitivity clearances, Restricted grants, the audit requirement) + **L717–736** (the RLS policy example) + cross-refs **L210–218, L464, L1725** (role-gating before ranking). |

## Area codes

| Code | Area |
|---|---|
| **ROLE** | Role model — the six defaults, runtime CRUD, custom roles, deletion-if-unused, last-Super-Admin protection |
| **PERM** | Permission matrix & enforcement — two-level checks, default-deny, the `can()` gate, the node catalog, `PERMISSION_NODES.md`, denied-access behavior |
| **CLR** | Sensitivity clearances — the four tiers, per-role defaults, explicit-grant-never-inherited, entity-type scope, review cadence, enforce-before-injection |
| **RST** | Restricted grants — per-named-individual, who/when/why audit, never auto-injected |
| **RLS** | Row-level security layer — data-driven policies, helper functions, intra-client, human-path-vs-service-role, the `aal2` coverage seam, instant propagation |
| **USR** | User management — role assignment/change, deactivation, 2FA reset, activity logs, clearance grant/revoke (the post-invite lifecycle; invite itself is C0) |
| **AUD** | Audit of Personal & Restricted access + permission/role/clearance changes |

## Doc-reconciliation — carry these into the FRs (do not re-derive from prose)

1. **`client_slug` in the RLS example (L724) — DELETED** (ADR-001 §3/§4). RLS is intra-client only;
   cross-client isolation is physical. Every RLS FR omits any cross-deployment predicate.
2. **"Restricted" listed as a Super Admin *role* clearance (L438) vs "Restricted is per named
   individual, the role alone does not grant it" (L452, L620) — CONTRADICTION.** Governing rule =
   **L452**: Restricted is **always** a per-named-individual grant, never a role default — even for
   Super Admin. L438's "Restricted" for Super Admin reads as *eligibility/authority to self-grant
   with logging*, not an automatic role clearance. Resolved by **RST.001 + OD-027** (see).
3. **"Every database table has RLS" (L719) vs the row-access subset being visibility/sensitivity/
   Restricted (L722–732).** Reconciled by **RLS.001**: *every* table ships a default-deny policy
   (authenticated + `aal2`); **sensitive** tables add the visibility/sensitivity/Restricted
   predicates. "Has RLS" ≠ "has the full sensitivity predicate" — a non-sensitive table's policy is
   just the default-deny baseline.
4. **The permission matrix is "tracked during the build, not finalised before it" (L504, L629).**
   So C1 specs the **mechanism** (data-driven matrix + `PERMISSION_NODES.md` + the admin dashboard),
   not a frozen node list. The 74 design-doc nodes (L509–615) are the **seed defaults**, editable
   thereafter with no code change (`L639`).
5. **Two-level enforcement (L397–403): the harness is the *primary* gate (code), the prompt is
   *advisory* (not sufficient alone), and "both must agree."** Per ADR-006 part 5 the third level —
   **RLS** — is the independent DB backstop. So C1 enforces **three** layers (prompt-advisory ·
   harness-code · RLS-DB), of which the harness and RLS are the load-bearing two.

---

# ROLE — Role model & management

### FR-1.ROLE.001 — Six default roles ship with every deployment
- **Statement:** The system shall provision six default roles on every new deployment — Super Admin, Admin, Finance, HR, Account Manager, Standard User — each with a default permission-node set and default sensitivity clearances.
- **Source:** design-doc-v4.md L471–498; L435–443
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Deployment provisioning / first-boot seed (ADR-005).
- **Preconditions:** A fresh deployment with the role tables migrated (RLS/data-model).
- **Behaviour:**
  - Happy path: provisioning seeds the six roles as **data rows** (`roles` + `role_permissions` + default `sensitivity_clearances`), per the design's default matrix (L509–615) and default clearances (L438–443).
  - Branches: the seeded defaults are **fully editable thereafter** (FR-1.ROLE.002) — they are starting points, not immutable.
  - Edge / failure: a partial seed (some roles missing) must fail loudly at provisioning, never leave a deployment with an incomplete role set (#3).
- **Data touched:** `DATA-roles`, `DATA-role_permissions`, `DATA-sensitivity_clearances` (write, seed).
- **Permissions:** N/A (provisioning, `service_role`).
- **Config dependencies:** —
- **Surfaces:** `UI-ROLE-MGMT` (Phase 3, displays the seeded roles).
- **Observability:** role-seed `audit`.
- **Acceptance criteria:**
  - AC-1.ROLE.001.1 — Given a fresh deployment, When provisioning completes, Then exactly the six named default roles exist, each with its default node set and clearances.
- **Open decisions:** OD-027 (the per-role default clearance/entity-scope mapping); OD-030 (default-matrix seed mechanism).
- **Feasibility assumptions:** —
- **Notes:** Roles named per L474–498. The **Standard User** can use chat, view the activity feed, read client info, create human-initiated tasks, action own-assigned approvals, and use memory commands (L493–498) — encoded as that role's default node set.

### FR-1.ROLE.002 — Roles are fully editable at runtime, no migration
- **Statement:** The system shall let a Super Admin create, edit, and delete roles and adjust any role's permission-node assignments entirely as data writes — with no code change, migration, or redeploy.
- **Source:** design-doc-v4.md L409, L471, L639; **ADR-006 part 1**
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Super Admin editing roles from the dashboard.
- **Preconditions:** `PERM-system.role_manage` (default-deny; Super Admin only — L561).
- **Behaviour:**
  - Happy path: edit a role / add a custom role / toggle a node for a role → a row write to `roles`/`role_permissions` → effective on the **next query** for affected users (FR-1.RLS.006, ADR-006 part 3).
  - Branches: a **custom** role is a new `roles` row with its own node assignments; identical mechanism to editing a default.
  - Edge / failure: an attempt to edit roles without `PERM-system.role_manage` → denied + logged (FR-1.PERM.006).
- **Data touched:** `DATA-roles`, `DATA-role_permissions` (write).
- **Permissions:** `PERM-system.role_manage` (Super Admin).
- **Config dependencies:** —
- **Surfaces:** `UI-ROLE-MGMT`, `UI-PERMISSION-MATRIX` (Phase 3).
- **Observability:** role create/edit/delete `audit` (who/old/new) — FR-1.AUD.002.
- **Acceptance criteria:**
  - AC-1.ROLE.002.1 — Given a Super Admin toggles a node for a role, When saved, Then affected users' permissions change on their next request with no deploy.
  - AC-1.ROLE.002.2 — Given a Super Admin adds a custom role, When saved, Then it is assignable to users immediately.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** This is the "no code change required to adjust permissions" promise (L639) made literal by ADR-006's data-driven model. The naive one-policy-per-role RLS (ADR-006 D1) is **rejected** precisely because it would force a migration here.

### FR-1.ROLE.003 — Role management is Super-Admin-only
- **Statement:** The system shall restrict role create/edit/delete to the Super Admin role; no other role (including Admin) may manage roles.
- **Source:** design-doc-v4.md L409, L477–479 ("Admin … cannot manage roles"), L561
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Any attempt to manage roles.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: Super Admin holds `PERM-system.role_manage`; the action proceeds.
  - Branches: Admin or any other role attempts role management → denied (default-deny; the node is not in their set).
  - Edge / failure: denied attempt → 403 + security `event_log` (FR-1.PERM.006).
- **Data touched:** —
- **Permissions:** `PERM-system.role_manage` (Super Admin only; default-deny for all others).
- **Config dependencies:** —
- **Surfaces:** `UI-ROLE-MGMT`.
- **Observability:** denied role-management attempt → security `event_log`.
- **Acceptance criteria:**
  - AC-1.ROLE.003.1 — Given an Admin user, When they attempt to create/edit/delete a role, Then the action is denied and logged.
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-1.ROLE.004 — Role deletion is allowed only when unused; protected roles cannot be deleted
- **Statement:** The system shall permit deleting a role only when no user is assigned to it and it is not a protected role, and shall block the deletion otherwise with an explicit reason.
- **Source:** design-doc-v4.md L471 ("Roles can be removed if unused"); **gap (criterion unspecified) → OD-025**
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** Super Admin deleting a role.
- **Preconditions:** `PERM-system.role_manage`.
- **Behaviour:**
  - Happy path: role with **zero** assigned users and not protected → deletable; deletion audited.
  - Branches: role with ≥1 assigned user → **blocked**, with a message naming the assigned-user count (reassign first); a **protected** role (Super Admin, and per OD-025 possibly the other defaults) → blocked.
  - Edge / failure: deleting a role mid-assignment must never orphan a user into a no-role state (#1/#3) — the block prevents it.
- **Data touched:** `DATA-roles` (delete), `DATA-user_roles` (read, to count assignments).
- **Permissions:** `PERM-system.role_manage` (Super Admin).
- **Config dependencies:** —
- **Surfaces:** `UI-ROLE-MGMT`.
- **Observability:** role-delete (or blocked-delete) `audit`.
- **Acceptance criteria:**
  - AC-1.ROLE.004.1 — Given a role with one assigned user, When a Super Admin attempts deletion, Then it is blocked with a message indicating users must be reassigned first.
  - AC-1.ROLE.004.2 — Given a role with zero assigned users that is not protected, When deleted, Then it is removed and the action is audited.
- **Open decisions:** OD-025 (the exact "unused" criterion + which roles are protected).
- **Feasibility assumptions:** —

### FR-1.ROLE.005 — At least one Super Admin must always exist (no lockout)
- **Statement:** The system shall prevent the removal, deactivation, or role-change of the last remaining Super Admin, so a deployment can never be left with zero Super Admins.
- **Source:** design-doc-v4.md L474 ("One per deployment minimum"); **gap (enforcement unspecified) → OD-029**
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Deactivating a user, changing a user's role, or deleting the Super Admin role.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: the action proceeds only if **at least one** Super Admin would remain afterward.
  - Branches: the action would drop the Super Admin count to zero → **blocked** with an explicit reason.
  - Edge / failure: a race between two concurrent demotions of the last two Super Admins must not both succeed and leave zero (atomic guard, ADR-004 pattern).
- **Data touched:** `DATA-user_roles` (read/write under a guard).
- **Permissions:** `PERM-system.role_manage` / `PERM-user.deactivate` (the gated actions).
- **Config dependencies:** —
- **Surfaces:** `UI-USER-MGMT`, `UI-ROLE-MGMT`.
- **Observability:** blocked last-Super-Admin action → `audit` + alert.
- **Acceptance criteria:**
  - AC-1.ROLE.005.1 — Given exactly one Super Admin, When an action would remove their Super Admin role or deactivate them, Then the action is blocked.
  - AC-1.ROLE.005.2 — Given two concurrent demotions of the last two Super Admins, When both execute, Then at most one succeeds and ≥1 Super Admin remains.
- **Open decisions:** OD-029 (confirm the protection scope: deactivate + role-change + role-delete all covered).
- **Feasibility assumptions:** —
- **Notes:** Directly protects non-negotiables #1 (don't lose the ability to administer) and #3 (a lockout that silently bricks administration). Reuses the ADR-004 atomic-guard mechanism (as FR-0.SEED.003 did).

---

# PERM — Permission matrix & enforcement

### FR-1.PERM.001 — Two-level enforcement: harness is primary, prompt is advisory, both must agree
- **Statement:** The system shall enforce every gated action in application code (the harness), treat the AI's prompt-level scope as advisory only (never sufficient alone), and require both levels to agree before an action proceeds.
- **Source:** design-doc-v4.md L397–403, L218; **ADR-007** (containment-first)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Any action the AI or a user attempts that is permission-gated.
- **Preconditions:** A permission node exists for the action.
- **Behaviour:**
  - Happy path: the harness `can(user, node, context)` check passes **and** the prompt-level scope permits → action proceeds.
  - Branches: harness denies → action blocked **regardless of what the prompt says** (L399); prompt-level instruction alone is never enough to authorize (L401–402).
  - Edge / failure: a prompt-injection that "convinces" the AL it may act → still blocked by the harness check that ignores prompt content (ADR-007 containment).
- **Data touched:** reads `DATA-role_permissions`, `DATA-user_roles`.
- **Permissions:** N/A (this *is* the enforcement layer).
- **Config dependencies:** —
- **Surfaces:** N/A (cross-cutting).
- **Observability:** every deny → `event_log` (and security `guardrail_log` where injection-adjacent).
- **Acceptance criteria:**
  - AC-1.PERM.001.1 — Given a harness permission check that fails, When the prompt instructs the AI to proceed anyway, Then the action is still blocked.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** RLS (FR-1.RLS.*) is the **third** independent layer for the row-access subset — the DB backstop that holds even if harness code has a bug (L733–735).

### FR-1.PERM.002 — Default-deny
- **Statement:** The system shall deny any permission node that is not explicitly granted to a user's role; absence of a grant is a denial, never an implicit allow.
- **Source:** design-doc-v4.md L420 (default-deny), L218; **ADR-006 part 1**
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Any permission check.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: a node present in the user's effective set → allowed.
  - Branches: a node absent from the set → denied.
  - Edge / failure: a brand-new node (added at build time, not yet assigned to any role) defaults to **denied for everyone** until a Super Admin grants it — never silently open.
- **Data touched:** reads `DATA-role_permissions`.
- **Permissions:** N/A.
- **Config dependencies:** —
- **Surfaces:** N/A.
- **Observability:** denials are logged (FR-1.PERM.006).
- **Acceptance criteria:**
  - AC-1.PERM.002.1 — Given a node not present in any of a user's roles, When the action is attempted, Then it is denied.
  - AC-1.PERM.002.2 — Given a newly added node with no role assignment, When any user attempts it, Then it is denied until explicitly granted.
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-1.PERM.003 — A single `can(user, node, context)` check gates every action
- **Statement:** The system shall route every permission decision through one harness check, `can(user, node, context)`, that reads the live permission tables — so there is exactly one place permission logic lives.
- **Source:** **ADR-006 Consequences** ("a single `can(user, node, context)` check used everywhere an action is gated"); L399
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Any gated action (route handler, agent tool call, chat command, dashboard action).
- **Preconditions:** The action declares the node it requires.
- **Behaviour:**
  - Happy path: the gate calls `can(...)`; it resolves the user's effective nodes (role → `role_permissions`) plus context (entity-type scope, ownership for "own items" nodes) and returns allow/deny.
  - Branches: context-scoped nodes (e.g. "Approve own-domain actions" L581, "Approval queue (own items)" L536) evaluate the `context` argument; un-scoped nodes ignore it.
  - Edge / failure: no node declared for a gated action = a build-time defect (every gate must name its node, mirrored in `PERMISSION_NODES.md`, FR-1.PERM.005).
- **Data touched:** reads `DATA-user_roles`, `DATA-role_permissions`, `DATA-sensitivity_clearances`, `DATA-restricted_grants`.
- **Permissions:** N/A.
- **Config dependencies:** —
- **Surfaces:** N/A.
- **Observability:** `can()` denials → `event_log`.
- **Acceptance criteria:**
  - AC-1.PERM.003.1 — Given a context-scoped node, When `can()` is called with an out-of-scope context, Then it returns deny.
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-080 (the harness `can()` and RLS read the **same** tables and cannot drift — verify they agree on the visibility/sensitivity/Restricted subset).
- **Notes:** "How" the gate is wired (middleware vs explicit call site) is an implementation choice; the **requirement** is that all paths converge on `can()`. The harness owns the *full* matrix; RLS owns only the row-access subset (ADR-006 part 5).

### FR-1.PERM.004 — The permission matrix is data (role × node), edited from the dashboard
- **Statement:** The system shall represent the permission matrix as data — a grant row per (role, permission-node) pair — editable from a Super Admin dashboard with a toggle at each intersection, requiring no code change.
- **Source:** design-doc-v4.md L502–504, L639; **ADR-006 part 1**
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Super Admin configuring the matrix.
- **Preconditions:** `PERM-system.role_manage`.
- **Behaviour:**
  - Happy path: the matrix UI shows every node × every role; a toggle writes/removes a `role_permissions` row; effective immediately (FR-1.RLS.006).
  - Branches: toggling a node that maps to an RLS-relevant capability (visibility/sensitivity) changes both the harness result and the RLS result, because both read the same rows.
  - Edge / failure: removing the last grant of a system-critical node (e.g. `PERM-system.role_manage` from the only Super Admin) is guarded (FR-1.ROLE.005 / OD-029).
- **Data touched:** `DATA-role_permissions` (write).
- **Permissions:** `PERM-system.role_manage`.
- **Config dependencies:** —
- **Surfaces:** `UI-PERMISSION-MATRIX` (Phase 3).
- **Observability:** matrix-change `audit` (FR-1.AUD.002).
- **Acceptance criteria:**
  - AC-1.PERM.004.1 — Given the permission-matrix UI, When a Super Admin toggles a (role, node) intersection, Then a grant row is added/removed and takes effect with no deploy.
- **Open decisions:** OD-030 (default seed of the matrix).
- **Feasibility assumptions:** —

### FR-1.PERM.005 — `PERMISSION_NODES.md` is the build-time source of truth for the node catalog
- **Statement:** The system shall maintain `PERMISSION_NODES.md` as the authoritative catalog of every permission node, updated whenever a new gate is added, with each node carrying description, default roles, scope, and origin — and this catalog shall drive the permission-matrix admin dashboard.
- **Source:** design-doc-v4.md L625–639
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** A developer adding any new permission gate during the build.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: every new dashboard view / action / config function / command that is gated adds a node entry to `PERMISSION_NODES.md` **immediately** (L629), with Description / Default roles / Scope / Added-in (L631–636).
  - Branches: at build end the file is the source for generating the admin matrix UI (FR-1.PERM.004) — node list never hardcoded in the UI.
  - Edge / failure: a gate added without a catalog entry is a **process defect** — the node would be invisible to the admin matrix (a silent un-configurable permission, #3). A CI check should flag gates whose node is absent from the catalog.
- **Data touched:** `PERMISSION_NODES.md` (repo file, build-time) → seeds `DATA-role_permissions` defaults.
- **Permissions:** N/A (build-time convention).
- **Config dependencies:** —
- **Surfaces:** `UI-PERMISSION-MATRIX` is generated from it.
- **Observability:** —
- **Acceptance criteria:**
  - AC-1.PERM.005.1 — Given a new gated action, When it ships, Then `PERMISSION_NODES.md` contains its node with all four required fields.
  - AC-1.PERM.005.2 — Given the catalog, When the admin matrix renders, Then every catalog node appears as a configurable row (no node hardcoded or omitted).
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** This is a **build-time discipline** captured now as a requirement so Phase 6 issues inherit it. The 74 seed nodes (13 categories, L509–615) are this catalog's v1 content. Codified in `standards/rbac.md`.

### FR-1.PERM.006 — Denied-access behavior: hidden in UI, refused at the API, never silent
- **Statement:** The system shall, for a denied permission, omit the corresponding surface from the user's UI **and** refuse a direct programmatic attempt with an explicit authorization error, logging the refusal — never returning a silent empty/partial success.
- **Source:** design-doc-v4.md L462 (denied views "do not exist in their UI"), L420; **gap (direct-access behavior unspecified) → OD-026**
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** A user attempting a denied action via UI or direct API.
- **Preconditions:** The user lacks the required node.
- **Behaviour:**
  - Happy path (UI): the surface/control is not rendered for users without the node (L462).
  - Branches (direct/API): a direct request to a denied endpoint or action → an explicit **403-equivalent** authorization error (per OD-026), not a 404, not a 200-with-empty-data, not a silent redirect-loop.
  - Edge / failure: a denied **row read** that slips past the harness is still caught by RLS (returns no rows) — but the harness must not *rely* on that to mask a missing check; both layers refuse.
- **Data touched:** —
- **Permissions:** N/A.
- **Config dependencies:** —
- **Surfaces:** all gated surfaces.
- **Observability:** every denied direct attempt → security `event_log`.
- **Acceptance criteria:**
  - AC-1.PERM.006.1 — Given a user without node N, When they call N's endpoint directly, Then they receive an explicit authorization error and the attempt is logged.
  - AC-1.PERM.006.2 — Given the same user, When their dashboard renders, Then N's surface is absent.
- **Open decisions:** OD-026 (exact error semantics — 403 vs 404-to-avoid-enumeration — and whether to log at info or security level).
- **Feasibility assumptions:** —

### FR-1.PERM.007 — The permission-node catalog (13 categories) is homed here
- **Statement:** The system shall recognize the design's thirteen permission-node categories as the seed catalog and shall home the `PERM-*` nodes that Component 0 referenced as stubs.
- **Source:** design-doc-v4.md L509–615 (the full matrix); C0 stubs (FR-0.AUTH.003, FR-0.INV.001, REC)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** N/A (a cataloging requirement).
- **Preconditions:** —
- **Behaviour:**
  - Happy path: the catalog (in `PERMISSION_NODES.md`, FR-1.PERM.005) contains the thirteen categories — **Memory Access · Sensitivity Clearance · Dashboard Access · Tool Access · Agent Invocation · Asset Management · System Functions · User Management · Approval Authority · Ingestion & Initialisation · Compliance · Observability · Chat Commands** (L509–615) — with their seed role-default assignments.
  - Branches: **C0 stubs homed** → `PERM-auth.provider_toggle` (under System Functions / "Manage deployment config", L564); `PERM-user.invite` (User Management / "Invite users", L572, Super Admin + Admin); `PERM-support.view` / `PERM-support.resolve` (the "trouble signing in" support queue, visible to Super Admin + Admin per C0 REC / L385). These are the existing stub IDs; the catalog reconciles them with the design's node names.
  - Edge / failure: a C0-referenced node missing from the catalog would orphan a C0 FR (caught by the verification gate).
- **Data touched:** `PERMISSION_NODES.md`; `DATA-role_permissions` (seed defaults).
- **Permissions:** N/A.
- **Config dependencies:** —
- **Surfaces:** `UI-PERMISSION-MATRIX`.
- **Observability:** —
- **Acceptance criteria:**
  - AC-1.PERM.007.1 — Given the seed catalog, When inspected, Then all thirteen categories and every C0 stub node are present with default-role assignments.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** The full per-node enumeration lives in `PERMISSION_NODES.md` (build artifact) and is surfaced in Phase 3's admin matrix — not duplicated row-by-row here, per L504/L629 ("tracked during the build").

---

# CLR — Sensitivity clearances

### FR-1.CLR.001 — Four sensitivity tiers
- **Statement:** The system shall define four sensitivity tiers — Standard, Confidential, Personal, Restricted — with the documented handling semantics for each.
- **Source:** design-doc-v4.md L426–433
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** N/A (a definitional requirement; consumed by memory + RLS).
- **Preconditions:** —
- **Behaviour:**
  - Happy path: **Standard** = general business knowledge, injectable into any relevant task; **Confidential** = commercially sensitive, injected only where directly relevant; **Personal** = about individuals, extra care regardless of visibility; **Restricted** = highest, **never injected automatically**, full audit trail.
  - Branches: custom sensitivity levels may be added later (`PERM-system.add_sensitivity` exists, L563) — out of v1 default set but the model must not hardcode exactly four if the design allows extension (flag, not block).
  - Edge / failure: an unclassified memory must default to the **most restrictive sane tier**, never silently to Standard (#1/#2) — confirm in OD-024-adjacent handling / C2.
- **Data touched:** sensitivity tier is a field on memory rows (`DATA-memories.sensitivity`, owned by C2; referenced here).
- **Permissions:** N/A.
- **Config dependencies:** custom-sensitivity additions (`PERM-system.add_sensitivity`).
- **Surfaces:** clearance UIs (Phase 3).
- **Acceptance criteria:**
  - AC-1.CLR.001.1 — Given a memory tagged Restricted, When any automatic retrieval runs, Then it is never auto-injected (FR-1.RST.003).
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** The tier semantics are consumed by C2 (memory) and enforced by CLR.006 + RLS. C1 owns the *definition* and the *clearance-to-tier* access model; C2 owns tagging memories with a tier.

### FR-1.CLR.002 — Default clearances per role
- **Statement:** The system shall seed each default role with the documented default sensitivity clearances and entity-type scope.
- **Source:** design-doc-v4.md L435–443
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Provisioning seed (with FR-1.ROLE.001).
- **Preconditions:** Roles seeded.
- **Behaviour:**
  - Happy path: seed clearances — **Super Admin**: Standard+Confidential+Personal, Global (Restricted is **not** a role default — see Notes); **Admin**: Standard+Confidential+Personal, Global; **HR**: Standard+Personal, scoped to team-member entities; **Finance**: Standard+Confidential, scoped to finance entities; **Account Manager**: Standard+Confidential, scoped to assigned clients; **Standard User**: Standard, Global.
  - Branches: editable thereafter via clearance grant/revoke (FR-1.USR.005).
  - Edge / failure: a seed that grants more than the documented default (e.g. Restricted to a role) is a defect — Restricted is per-individual only (FR-1.RST.001).
- **Data touched:** `DATA-sensitivity_clearances` (seed).
- **Permissions:** N/A (seed).
- **Config dependencies:** —
- **Surfaces:** `UI-CLEARANCE-MGMT`.
- **Observability:** seed `audit`.
- **Acceptance criteria:**
  - AC-1.CLR.002.1 — Given a fresh deployment, When seeded, Then each role has exactly its documented default clearances and scope.
- **Open decisions:** OD-027 (how entity-type scope is represented + the doc's L438 Restricted-for-Super-Admin contradiction).
- **Feasibility assumptions:** —
- **Notes:** **Doc-reconciliation #2:** L438 lists "Restricted" among Super Admin's clearances, but L452/L620 make Restricted strictly per-named-individual. Governing rule = L452 → **no role, including Super Admin, holds Restricted as a default**; Super Admin instead holds the *authority to grant* Restricted (`PERM-user.grant_restricted`, L577) and may self-grant per-entity with logging (FR-1.RST.001).

### FR-1.CLR.003 — Clearance is explicitly granted, never inherited
- **Statement:** The system shall require every clearance above Standard to be explicitly granted by a Super Admin, and shall never confer a clearance by inheritance or as a side effect of another grant.
- **Source:** design-doc-v4.md L448
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** A clearance grant.
- **Preconditions:** `PERM-user.grant_clearance` (Super Admin only, L576).
- **Behaviour:**
  - Happy path: a Super Admin explicitly grants Standard+N to a role/user with a scope → a `sensitivity_clearances` row.
  - Branches: assigning a user a role confers that role's **default** clearances (FR-1.CLR.002), which were themselves explicit grants — there is no transitive escalation beyond the role's defaults.
  - Edge / failure: no code path grants a clearance implicitly (e.g. "they can see the entity so give them Confidential") — disallowed.
- **Data touched:** `DATA-sensitivity_clearances` (write).
- **Permissions:** `PERM-user.grant_clearance` (Super Admin).
- **Config dependencies:** —
- **Surfaces:** `UI-CLEARANCE-MGMT`.
- **Observability:** clearance grant/revoke `audit` (FR-1.AUD.002).
- **Acceptance criteria:**
  - AC-1.CLR.003.1 — Given a user with only Standard, When no explicit above-Standard grant exists, Then they have no Confidential/Personal/Restricted access regardless of role membership beyond the role's own explicit defaults.
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-1.CLR.004 — Clearance is scoped by entity type
- **Statement:** The system shall scope a clearance to specified entity types, so a clearance to a tier for one entity type does not grant that tier for another.
- **Source:** design-doc-v4.md L450; **ADR-006 part 1** (entity-type-scoped clearance)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Any clearance evaluation during retrieval/access.
- **Preconditions:** Clearances carry an entity-type scope.
- **Behaviour:**
  - Happy path: a Finance role with "Confidential, scoped to finance entities" sees Confidential **finance** memories but **not** Confidential client-strategy memories (L450).
  - Branches: a "Global" scope (e.g. Super Admin) applies across all entity types.
  - Edge / failure: a memory whose entity type is outside the user's clearance scope is **excluded entirely** before ranking (L464, L1725) — never ranked-then-hidden.
- **Data touched:** `DATA-sensitivity_clearances.entity_type_scope`; evaluated against `DATA-memories.entity_ids` joined to `DATA-entities.type` (C2).
- **Permissions:** N/A (evaluation).
- **Config dependencies:** —
- **Surfaces:** `UI-CLEARANCE-MGMT` (scope selector).
- **Observability:** —
- **Acceptance criteria:**
  - AC-1.CLR.004.1 — Given a Finance-scoped Confidential clearance, When a Confidential client-strategy memory is candidate for retrieval, Then it is excluded.
- **Open decisions:** OD-027 (scope representation).
- **Feasibility assumptions:** —

### FR-1.CLR.005 — Clearances are reviewed on a configurable cadence
- **Statement:** The system shall surface above-Standard clearances for Super Admin review on a configurable cadence, and shall handle un-actioned reviews without silently revoking or silently retaining access.
- **Source:** design-doc-v4.md L454; **handling of un-actioned reviews → OD-028**
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** The review cadence elapsing (a loop/schedule).
- **Preconditions:** `CFG-clearance_review_cadence_days` (default 90).
- **Behaviour:**
  - Happy path: at each cadence, the dashboard surfaces every above-Standard clearance for the Super Admin to **confirm** (still appropriate) or **revoke**.
  - Branches: an **un-actioned** review (cadence elapsed, Super Admin hasn't responded) → **flagged + escalated (alert)**, per OD-028 — **not** auto-revoked (avoid silent #1 access loss) and **not** silently left as if reviewed (avoid silent #3 staleness), **unless** the deployment has opted into `CFG-clearance_review_fail_closed` (LIVE, default `false`), in which case an un-actioned overdue review **auto-revokes** the clearance instead of merely flagging it — still logged and still escalated as an alert, never silent.
  - Edge / failure: a revoked clearance takes effect instantly (FR-1.RLS.006).
- **Data touched:** `DATA-sensitivity_clearances` (read; `last_reviewed_at`); `audit` on confirm/revoke/auto-revoke.
- **Permissions:** `PERM-user.grant_clearance` (to action a review).
- **Config dependencies:** `CFG-clearance_review_cadence_days` (LIVE, default 90); `CFG-clearance_review_fail_closed` (LIVE, default `false` — per-deployment opt-in to auto-revoke instead of flag-and-persist, OD-028).
- **Surfaces:** `UI-CLEARANCE-REVIEW` (Phase 3).
- **Observability:** review-due, confirm, revoke, and overdue-escalation `event_log`/`audit`.
- **Acceptance criteria:**
  - AC-1.CLR.005.1 — Given a clearance whose review cadence has elapsed without action, When `clearance_review_fail_closed` is `false` (default), Then it is flagged and escalated, and is neither auto-revoked nor marked reviewed.
  - AC-1.CLR.005.2 — Given a clearance whose review cadence has elapsed without action, When `clearance_review_fail_closed` is `true`, Then it is auto-revoked, the revocation is audited, and the Super Admin is still alerted (never a silent revoke).
- **Open decisions:** OD-028 (un-actioned-review handling; resolved — default flag+escalate, fail-closed is a per-deployment opt-in).
- **Feasibility assumptions:** —

### FR-1.CLR.006 — Clearance + visibility enforced before ranking/injection (harness) and at the DB (RLS)
- **Statement:** The system shall enforce the user's/agent's visibility scope and sensitivity clearance **before** any memory ranking or injection in the harness, and independently enforce the row-access subset at the database via RLS.
- **Source:** design-doc-v4.md L464, L1725; **ADR-006 part 5**; **ADR-003** ("controls before gates")
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Any memory read/retrieval for a user-session request.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: candidate memories are filtered by visibility + clearance **first**, then ranked/injected (L1725 "Both run before ranking — never after").
  - Branches: the **same** check is enforced at RLS for the human/session path (FR-1.RLS.003); the agent path runs as `service_role` and is governed by harness RBAC, not RLS (FR-1.RLS.004, ADR-006 part 6).
  - Edge / failure: a memory outside permitted visibility/clearance is **excluded entirely and never ranked** (L1725) — it must not appear in a ranked set and then be stripped (a leak risk, #2).
- **Data touched:** reads `DATA-memories` (C2) under clearance/visibility predicates.
- **Permissions:** evaluated via `can()` + clearance tables.
- **Config dependencies:** —
- **Surfaces:** N/A (retrieval path).
- **Observability:** Personal/Restricted access → `access_audit` (FR-1.AUD.001).
- **Acceptance criteria:**
  - AC-1.CLR.006.1 — Given a candidate set containing a memory outside the requester's clearance, When retrieval runs, Then that memory is excluded before ranking (not ranked then hidden).
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-067 (the live clearance/visibility predicate composes with pgvector ranking on the hot path within latency budget).
- **Notes:** This is the C1 anchor of ADR-002/003's "controls before gates." The performance of this predicate **is** AF-067.

---

# RST — Restricted grants

### FR-1.RST.001 — Restricted is granted per named individual, never per role
- **Statement:** The system shall grant Restricted access only to a named individual (not to a role), only by a Super Admin, and shall not confer Restricted as any role's default.
- **Source:** design-doc-v4.md L452, L524, L620, L577; **doc-reconciliation #2**
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** A Super Admin granting Restricted to an individual.
- **Preconditions:** `PERM-user.grant_restricted` (Super Admin only, L577).
- **Behaviour:**
  - Happy path: Super Admin grants Restricted to a named user, optionally scoped (entity/entity-type), with a mandatory reason → a `restricted_grants` row (FR-1.RST.002).
  - Branches: a role — even Super Admin — never carries Restricted as a default clearance (FR-1.CLR.002 Notes); holding `PERM-user.grant_restricted` is the *authority to grant*, distinct from *holding* Restricted access to a given entity.
  - Edge / failure: any attempt to attach Restricted to a `roles`/`role_permissions` default is rejected (model-level invariant).
- **Data touched:** `DATA-restricted_grants` (write).
- **Permissions:** `PERM-user.grant_restricted` (Super Admin).
- **Config dependencies:** —
- **Surfaces:** `UI-RESTRICTED-GRANT` (Phase 3).
- **Observability:** grant → `audit` + `access_audit`.
- **Acceptance criteria:**
  - AC-1.RST.001.1 — Given a role, When clearances are configured, Then Restricted cannot be set as a role default (only a per-individual grant).
  - AC-1.RST.001.2 — Given a non-Super-Admin, When they attempt to grant Restricted, Then it is denied.
- **Open decisions:** OD-027 (confirms the L438 reconciliation).
- **Feasibility assumptions:** —

### FR-1.RST.002 — Every Restricted grant is logged (who, when, why); revocation is instant
- **Statement:** The system shall record, for every Restricted grant, who granted it, when, and why, and shall make revocation take effect instantly.
- **Source:** design-doc-v4.md L452 ("Every grant is logged — who granted it, when, and why"); **ADR-006 part 3** (instant revoke)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Grant or revoke of a Restricted access.
- **Preconditions:** `PERM-user.grant_restricted`.
- **Behaviour:**
  - Happy path: grant requires a non-empty reason; the row captures granter, grantee, timestamp, reason, scope; revoke removes/expires the grant and takes effect on the next query (FR-1.RLS.006).
  - Branches: a grant with no reason → rejected (the "why" is mandatory, L452).
  - Edge / failure: a missing audit record for a grant is the failure this FR forbids (#1/#3).
- **Data touched:** `DATA-restricted_grants` (write), `DATA-access_audit` (write).
- **Permissions:** `PERM-user.grant_restricted`.
- **Config dependencies:** —
- **Surfaces:** `UI-RESTRICTED-GRANT`.
- **Observability:** grant/revoke → permanent `access_audit` (FR-1.AUD.001/002).
- **Acceptance criteria:**
  - AC-1.RST.002.1 — Given a Restricted grant attempt with no reason, When submitted, Then it is rejected.
  - AC-1.RST.002.2 — Given a Restricted grant, When created, Then an immutable audit record captures granter, grantee, time, and reason.
  - AC-1.RST.002.3 — Given a Restricted grant is revoked, When the user next queries, Then access is denied.
- **Open decisions:** OD-024 (the audit-record store/schema).
- **Feasibility assumptions:** —

### FR-1.RST.003 — Restricted is never auto-injected
- **Statement:** The system shall never automatically inject Restricted-tier content into a task or agent context; access requires an explicit, audited path.
- **Source:** design-doc-v4.md L433 ("Never injected automatically. Full audit trail.")
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Any automatic retrieval/injection.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: automatic memory retrieval excludes Restricted content entirely (even for a user who holds a Restricted grant) — Restricted surfaces only via an explicit, audited access (e.g. a deliberate `/recall` of a Restricted item by a cleared user), each logged.
  - Branches: a `service_role` agent path likewise never auto-injects Restricted (the sole-writer/harness governs it).
  - Edge / failure: any code path that would fold Restricted into an auto-injected context is disallowed (#2).
- **Data touched:** reads `DATA-memories` (Restricted tier); `DATA-access_audit` (write on any access).
- **Permissions:** Restricted grant (FR-1.RST.001) for explicit access.
- **Config dependencies:** —
- **Surfaces:** N/A.
- **Observability:** every Restricted read/injection → `access_audit` (FR-1.AUD.001).
- **Acceptance criteria:**
  - AC-1.RST.003.1 — Given a user holding a Restricted grant, When automatic retrieval runs, Then Restricted content is still not auto-injected; it surfaces only via an explicit audited access.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Seam to **C2 (Memory)** — the retrieval/injection pipeline enforces this; C1 owns the *rule*, C2 owns the *mechanism*.

---

# RLS — Row-level security layer

### FR-1.RLS.001 — Every table has an RLS policy (default-deny baseline)
- **Statement:** The system shall enable RLS with a policy on every application table, defaulting to deny, so no table is reachable by an authenticated user without an explicit policy decision.
- **Source:** design-doc-v4.md L717–719, L733–735; **ADR-006 part 5**; **doc-reconciliation #3**
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Any authenticated user-session query.
- **Preconditions:** Tables migrated with RLS enabled.
- **Behaviour:**
  - Happy path: every table has RLS enabled + at least the **default-deny baseline** policy (authenticated, intra-client by physical isolation, `aal2` where required); **sensitive** tables add the visibility/sensitivity/Restricted predicates (FR-1.RLS.003).
  - Branches: a non-sensitive table's policy is just the baseline; a sensitive table's policy composes the baseline + the sensitivity predicates.
  - Edge / failure: a table that ships **without** RLS enabled is a silent hole (the DB backstop is absent) — forbidden; a lint/CI check must catch it (AF-079).
- **Data touched:** all application tables (policy definitions; Phase 4 / data-model authors the SQL).
- **Permissions:** N/A (DB layer).
- **Config dependencies:** —
- **Surfaces:** N/A.
- **Observability:** RLS-denied query → surfaced as no-rows (and the harness's own check logs the denial, FR-1.PERM.006).
- **Acceptance criteria:**
  - AC-1.RLS.001.1 — Given the full table inventory, When audited, Then every table has RLS enabled and at least a default-deny policy.
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-079 (RLS coverage completeness — prove no table ships without RLS; a CI/lint gate, analogous to AF-076 for `aal2`).
- **Notes:** "Every table has RLS" (L719) ≠ "every table checks sensitivity" — non-sensitive tables only need the baseline. C0's FR-0.AUTH.008 contributes the `aal2` clause of the baseline.

### FR-1.RLS.002 — Policies are static and data-driven — they never name a role
- **Statement:** The system shall author RLS policies that are generic (never referencing a literal role name) and that read the acting user's current effective permissions live via `STABLE SECURITY DEFINER` helper functions keyed on `auth.uid()`, wrapped to evaluate once per statement.
- **Source:** **ADR-006 part 2**; design-doc-v4.md L722–732 (minus `client_slug`)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Every user-session query against a guarded table.
- **Preconditions:** Helper functions (`user_clearances(uid)`, `user_visibility(uid)`, `user_restricted(uid)`, `user_aal()`) exist; permission tables indexed.
- **Behaviour:**
  - Happy path: a policy calls the helper(s) wrapped as `(select user_clearances(auth.uid()))` so Postgres evaluates it **once per statement** (the initPlan), then applies the result as a filter over the rows (AF-067).
  - Branches: editing a role/clearance is a row write — the **same** static policy evaluates differently next query because the data changed (no migration; FR-1.ROLE.002, FR-1.RLS.006).
  - Edge / failure: a helper called **bare** (not wrapped in `(select …)`) re-evaluates per-row → catastrophic latency (Supabase benchmark 178,000 ms → 12 ms) — the `(select …)` wrapping + indexed policy columns + `TO authenticated` scoping + the `auth_rls_initplan` lint are **binding** (AF-067 sharpened).
- **Data touched:** reads `DATA-roles`, `DATA-role_permissions`, `DATA-user_roles`, `DATA-sensitivity_clearances`, `DATA-restricted_grants` via helpers.
- **Permissions:** N/A (DB layer).
- **Config dependencies:** —
- **Surfaces:** N/A.
- **Observability:** the `auth_rls_initplan` advisor lint must be clean.
- **Acceptance criteria:**
  - AC-1.RLS.002.1 — Given a role edit, When an affected user next queries, Then the same policy yields the new result with no migration.
  - AC-1.RLS.002.2 — Given the policies, When linted, Then `auth_rls_initplan` is clean (all helper calls wrapped, evaluated once per statement).
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-067 (the once-per-statement helper lookup composes with pgvector ranking within latency budget; D2 JWT-cache is the documented fallback if it fails at scale).
- **Notes:** This FR is essentially ADR-006 part 2 + the AF-067 sharpening made into a buildable requirement. The `(select …)` rule is codified in `standards/rbac.md`.

### FR-1.RLS.003 — RLS enforces visibility + sensitivity + Restricted (the row-access subset), intra-client only
- **Statement:** The system shall have RLS enforce exactly the row-access subset — visibility tier, sensitivity clearance, and Restricted per-individual grants — on sensitive tables, and shall include no cross-client predicate.
- **Source:** design-doc-v4.md L722–732; **ADR-006 parts 4 & 5**; **doc-reconciliation #1**
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** A user-session read/write on a sensitive table (e.g. `memories`).
- **Preconditions:** Helper functions resolve the user's clearances/visibility/Restricted.
- **Behaviour:**
  - Happy path: a user may read a sensitive row only if their role has the row's **visibility tier** AND the required **sensitivity clearance** (scoped by entity type, FR-1.CLR.004) AND, for Restricted rows, an explicit **Restricted grant** (FR-1.RST.001).
  - Branches: the `client_slug` clause from the doc's example (L724) is **omitted** — isolation is physical (ADR-001).
  - Edge / failure: a Personal/Restricted row read is additionally **audited** at the DB/harness boundary (FR-1.AUD.001).
- **Data touched:** `DATA-memories` and other sensitive tables.
- **Permissions:** N/A (DB layer; mirrors the harness clearance check, FR-1.CLR.006).
- **Config dependencies:** —
- **Surfaces:** N/A.
- **Observability:** Personal/Restricted access → `access_audit`.
- **Acceptance criteria:**
  - AC-1.RLS.003.1 — Given a user lacking the clearance for a Confidential row, When they query, Then RLS returns no such row.
  - AC-1.RLS.003.2 — Given the policy SQL, When inspected, Then it contains no `client_slug`/cross-deployment predicate.
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-1.RLS.004 — RLS guards the human path; the service-role/agent path bypasses it
- **Statement:** The system shall subject authenticated end-user (dashboard / chat-as-user) queries to RLS, and shall run the Memory Agent and backend jobs as `service_role` (bypassing RLS, with no `auth.uid()`), whose correctness rests on harness RBAC and the ADR-004 sole-writer invariant.
- **Source:** **ADR-006 part 6**; **ADR-004** (sole writer as service_role); design-doc-v4.md L1055
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Any DB access — distinguishing user-session vs backend.
- **Preconditions:** `service_role` key custody in the client project (ADR-001 §5).
- **Behaviour:**
  - Happy path: user-session connections carry the user JWT → RLS applies; backend/agent connections use `service_role` → RLS bypassed, governed by harness RBAC.
  - Branches: this is the mechanism behind C0's FR-0.SESS.006 (mid-task continuation as `service_role`).
  - Edge / failure: **no requirement may assume RLS guards a service-role write** (ADR-006 part 6) — the agent path's safety is harness RBAC + sole-writer, not `auth.uid()`. The `service_role` key is god-mode (bypass-RLS) and its custody/use is a security control (#2).
- **Data touched:** all tables (via the two connection identities).
- **Permissions:** harness RBAC governs the service-role path.
- **Config dependencies:** `service_role` key (SECRET).
- **Surfaces:** N/A.
- **Observability:** service-role writes are governed/observed via the harness + ADR-004 audit, not RLS.
- **Acceptance criteria:**
  - AC-1.RLS.004.1 — Given a backend job connecting as `service_role`, When it queries, Then RLS does not constrain it (and its access is governed by harness RBAC).
  - AC-1.RLS.004.2 — Given a user-session connection, When it queries, Then RLS applies.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Defense-in-depth is for the **human** path; the agent path is intentionally off-RLS (ADR-004/006). This split is load-bearing — getting it wrong either breaks the agent (if RLS blocked it) or creates a false sense of DB-enforced agent safety.

### FR-1.RLS.005 — The deployment-wide `aal2` predicate is part of every protected policy
- **Statement:** The system shall include an `aal = 'aal2'` requirement in the RLS policy of every protected table, realizing C0's FR-0.AUTH.008 deployment-wide-2FA requirement at the database layer.
- **Source:** **C0 FR-0.AUTH.008** (the requirement); design-doc-v4.md L377; **[SA9] / AF-076**
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Any user-session query on a protected table.
- **Preconditions:** Sessions carry `aal` (C0); `two_factor_required` intent flag on.
- **Behaviour:**
  - Happy path: a protected table's policy requires `aal2`; an `aal1` session reads no protected rows (composes with FR-1.RLS.002's helper pattern).
  - Branches: OAuth users reach `aal2`-equivalent via IdP-asserted MFA (C0 OD-016); the predicate is uniform.
  - Edge / failure: **one** protected table missing the `aal2` clause = a silent `aal1` bypass (#2/#3) → AF-076 must prove complete coverage.
- **Data touched:** all protected tables (policy).
- **Permissions:** N/A (DB layer).
- **Config dependencies:** `CFG-auth.two_factor_required` (C0).
- **Surfaces:** N/A.
- **Observability:** an `aal1` access attempt at a protected resource → security `event_log` (C0 FR-0.AUTH.008).
- **Acceptance criteria:**
  - AC-1.RLS.005.1 — Given the protected-table inventory, When audited, Then every one includes the `aal2` predicate (no table reachable at `aal1`).
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-076 (complete `aal2` coverage — no silent bypass). Composes with AF-067 (the `(select …)` initPlan rule) and AF-079 (RLS coverage completeness).
- **Notes:** **Realizes the C0 seam.** C0 owns the *requirement that the `aal2` predicate exists*; C1/data-model owns *authoring it on every policy*. This is where FR-0.AUTH.008 lands.

### FR-1.RLS.006 — Every permission/clearance change is instant (no token snapshot)
- **Statement:** The system shall make every grant and revoke — role change, clearance grant/revoke, Restricted grant/revoke, user deactivation — take effect on the user's next query, with no JWT-cached permission snapshot and no propagation delay.
- **Source:** **ADR-006 part 3**; design-doc-v4.md L639
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Any permission-data write.
- **Preconditions:** RLS reads permissions live (FR-1.RLS.002); the JWT carries identity, not a permission snapshot.
- **Behaviour:**
  - Happy path: a Super Admin revokes a clearance → the user's very next query reflects it (the helper reads the changed row); no re-login, no forced logout, no propagation window.
  - Branches: same for grants (immediately usable) and deactivation (immediately denied).
  - Edge / failure: there is **no** stale-access window because nothing is cached on the token (the D2 JWT-cache approach is rejected precisely to avoid this; OOS-012).
- **Data touched:** the permission tables (read live by helpers).
- **Permissions:** N/A.
- **Config dependencies:** access-token TTL stays Supabase's 1 h (C0 FR-0.SESS.002) — **no longer load-bearing** for permission propagation under ADR-006.
- **Surfaces:** N/A.
- **Observability:** the grant/revoke itself is audited (FR-1.AUD.002).
- **Acceptance criteria:**
  - AC-1.RLS.006.1 — Given a Super Admin revokes a user's clearance, When the user issues their next query, Then the revoked access is denied (no re-login required).
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** This is the single biggest payoff of ADR-006's D3 choice — it deletes the entire stale-permission bug class. Deactivation's instant effect also underpins FR-1.USR.002. **But** "instant on next query" is an RLS/human-path guarantee; the **service-role/agent path has no `auth.uid()` and bypasses RLS**, so an *in-flight* service-role task does not get this for free — see FR-1.RLS.007.

### FR-1.RLS.007 — A service-role task carries its originating user's authorization context; deactivation/revocation stops it before the next consequential side effect
- **Statement:** The system shall bind the originating user's identity to any task executed as `service_role`, re-evaluate that user's active status and the clearances/grants the task relies on at each step/injection boundary, and prevent the task from performing a further **consequential side effect** once the originating user is deactivated or a relied-on clearance/Restricted grant is revoked.
- **Source:** verification-gate finding (service-role seam, #2/#3); **ADR-006 part 6** (service_role bypasses RLS) + **ADR-004** (sole writer) + **ADR-007** (containment — a consequential side effect must hit a code gate) + **C0 FR-0.SESS.006** (mid-task continuation as service_role); **resolved by OD-031**
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** A background/agent task running as `service_role` whose originating user's authorization changes mid-run.
- **Preconditions:** The task records the originating user identity (even though the connection is `service_role` with no `auth.uid()`).
- **Behaviour:**
  - Happy path: the task runs; at each step/injection boundary the harness re-checks the originating user is **active** and still holds the clearances/grants the task relies on → continue.
  - Branches: the originating user's **session merely expired** (not revoked) → **continue** (benign — this is precisely what C0 FR-0.SESS.006 allows; expiry ≠ revocation). The originating user is **deactivated**, OR a relied-on **clearance/Restricted grant is revoked** → **stop before the next consequential side effect** (external comm, financial action, cross-entity write, or a memory write of relied-on-sensitive content), per OD-031 → halt + quarantine for human review (never silently drop the work, #1).
  - Edge / failure: a consequential side effect **already applied** before the revoke is a **compensation/rollback** concern → **OD-010** (Harness/Guardrails); referenced, not solved here. The **mechanism** (step-boundary interception, abort/quarantine machinery) is seamed to **C5/C6/C8**; C1 owns the **authorization rule**.
- **Data touched:** reads `DATA-user_roles` (active), `DATA-sensitivity_clearances`, `DATA-restricted_grants` at each boundary; `DATA-access_audit` on a stop.
- **Permissions:** N/A (enforcement on the agent path).
- **Config dependencies:** —
- **Surfaces:** quarantine/review surface (C6/C8, Phase 3).
- **Observability:** a mid-task stop (deactivation/revocation) → security `event_log` + `access_audit`.
- **Acceptance criteria:**
  - AC-1.RLS.007.1 — Given a service-role task whose originating user is deactivated mid-run, When the task reaches its next consequential-side-effect boundary, Then it is halted and quarantined (not run to completion).
  - AC-1.RLS.007.2 — Given a service-role task whose originating user's relied-on clearance is revoked mid-run, When the next boundary is reached, Then the task does not act on the now-forbidden content.
  - AC-1.RLS.007.3 — Given a service-role task whose originating user's session merely expired (no revocation), When boundaries are reached, Then it continues (expiry ≠ revocation, per C0 FR-0.SESS.006).
- **Open decisions:** — (OD-031 resolved)
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-068 (containment red-team — confirm no authorized-but-revoked autonomous path reaches a consequential side effect without hitting this code gate).
- **Notes:** This closes the gate's sharpest finding: ADR-006 part 6 removes the RLS backstop on the agent path *by design*, so the authorization re-check there is **harness discipline, not a DB guarantee**. The expiry-vs-revocation distinction is what reconciles this with C0 FR-0.SESS.006 (which must keep working for a benign session-expiry).

### FR-1.RLS.008 — RLS-vs-harness divergence is observable (no silent zero-rows masking a harness miss)
- **Statement:** The system shall surface a divergence between the harness `can()` decision and the RLS outcome — when RLS filters rows the harness believed permitted (or vice-versa) — as a logged/alerted signal, rather than letting an RLS-filtered empty result be indistinguishable from "no data exists."
- **Source:** verification-gate finding (#3 — the silent zero-rows backstop); sharpens **AF-080**
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** A user-session query where the harness and RLS disagree.
- **Preconditions:** Both layers read the same permission tables (FR-1.PERM.003, FR-1.RLS.002).
- **Behaviour:**
  - Happy path: harness and RLS agree → no signal needed.
  - Branches: the harness permitted a read but RLS returned **zero rows** (a forgotten/incorrect `can()` gate, or a policy bug) → log a **divergence** event so the silent backstop becomes observable (#3).
  - Edge / failure: relying on RLS's silent zero-rows to mask a missing harness check is exactly the silent failure this FR forbids; the divergence signal is what makes a harness gap *visible* before it's a leak or a phantom-empty.
- **Data touched:** reads the permission tables; writes a divergence `event_log`.
- **Permissions:** N/A.
- **Config dependencies:** —
- **Surfaces:** observability/alerting (C7).
- **Observability:** divergence → `event_log` + alert; feeds the AF-080 differential test.
- **Acceptance criteria:**
  - AC-1.RLS.008.1 — Given a query the harness believed permitted but RLS returns zero rows, When it occurs, Then a divergence event is logged (the empty result is not silently returned as "no data").
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-080 (harness/RLS non-drift — sharpened to include **runtime** divergence detection, not just rule-level agreement).
- **Notes:** Turns ADR-006 part 5's "cannot drift" claim from an assertion into an observable. Pairs with AF-080's differential test (build-time) — this is the run-time counterpart.

---

# USR — User management (post-invite lifecycle)

> Invite issuance, the setup page, and first-boot seed are **C0** (FR-0.INV.*, FR-0.SEED.*). C1 owns
> what happens to a user's **authorization** after they exist: role assignment/change, clearance
> grant/revoke, deactivation, 2FA reset, and activity-log visibility (design L571–578).

### FR-1.USR.001 — Assign and change a user's role
- **Statement:** The system shall let a Super Admin or Admin assign a role to a user and change it, with the change audited and effective instantly.
- **Source:** design-doc-v4.md L575 ("Assign roles to users" — Super Admin + Admin)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Super Admin / Admin in User Management.
- **Preconditions:** `PERM-user.assign_role` (Super Admin + Admin per L575).
- **Behaviour:**
  - Happy path: select a user → set/change role → `user_roles` write → effective next query (FR-1.RLS.006); audited (who/old/new/when).
  - Branches: changing the last Super Admin's role is blocked (FR-1.ROLE.005).
  - Edge / failure: assigning a non-existent/deleted role → rejected.
- **Data touched:** `DATA-user_roles` (write); `DATA-access_audit` (write).
- **Permissions:** `PERM-user.assign_role` (Super Admin + Admin).
- **Config dependencies:** —
- **Surfaces:** `UI-USER-MGMT`.
- **Observability:** role-change `audit` (FR-1.AUD.002).
- **Acceptance criteria:**
  - AC-1.USR.001.1 — Given a Super Admin changes a user's role, When saved, Then the user's permissions change on their next request and the change is audited.
- **Open decisions:** OD-029 (audit-of-role-change requirement).
- **Feasibility assumptions:** —
- **Notes:** Whether a single user may hold **multiple** roles or exactly one is a model question — default to **one role per user** (matches the design's role-default-view routing, C0 FR-0.INV.005); flag if multi-role is needed (→ OD-029 scope).

### FR-1.USR.002 — Deactivate a user account (revocation, not deletion)
- **Statement:** The system shall let a Super Admin or Admin deactivate a user account, immediately revoking all access while preserving the account record and its audit history.
- **Source:** design-doc-v4.md L573 ("Deactivate user accounts" — Super Admin + Admin)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Super Admin / Admin.
- **Preconditions:** `PERM-user.deactivate` (Super Admin + Admin).
- **Behaviour:**
  - Happy path: deactivate → user's sessions invalidated / next query denied (FR-1.RLS.006); the account row and audit trail are **retained** (not deleted — #1).
  - Branches: deactivating the last Super Admin is blocked (FR-1.ROLE.005).
  - Branches: **reactivation does not silently restore prior above-Standard clearances or Restricted grants** — base role membership may restore, but every above-Standard clearance and every Restricted grant must be **explicitly re-granted** (avoids a stale over-grant silently returning, #2). (Verification-gate finding.)
  - Edge / failure: a deactivated user attempting login/queries → denied; reactivation is a separate explicit action.
- **Data touched:** `DATA-user_roles` / a user `active` flag (write); sessions.
- **Permissions:** `PERM-user.deactivate` (Super Admin + Admin).
- **Config dependencies:** —
- **Surfaces:** `UI-USER-MGMT`.
- **Observability:** deactivate/reactivate `audit`.
- **Acceptance criteria:**
  - AC-1.USR.002.1 — Given an active user, When deactivated, Then their next query is denied and their record + audit history are retained.
  - AC-1.USR.002.2 — Given a previously-deactivated user holding a Restricted grant before deactivation, When reactivated, Then the Restricted grant is not auto-restored and must be explicitly re-granted.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** "Revocation not deletion" preserves the audit trail (#1) and avoids orphaning historical references. Hard-delete (offboarding) is a separate Compliance concern (L593–597), out of C1.

### FR-1.USR.003 — Reset a user's 2FA
- **Statement:** The system shall let a Super Admin or Admin reset a user's 2FA factor, forcing re-enrollment on next login.
- **Source:** design-doc-v4.md L574 ("Reset user 2FA" — Super Admin + Admin)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Super Admin / Admin (recovery for a user who lost their authenticator).
- **Preconditions:** `PERM-user.reset_2fa` (Super Admin + Admin).
- **Behaviour:**
  - Happy path: reset → the user's enrolled TOTP factor is removed; on next login they must re-enroll (C0 FR-0.AUTH.006) before reaching `aal2`.
  - Branches: for OAuth users whose MFA is at the IdP, "reset 2FA" is a no-op at the app layer (their factor is the IdP's) — surface that clearly rather than implying success.
  - Edge / failure: a reset must be audited (it lowers a user to `aal1` until re-enroll — a security-sensitive action, #2/#3).
- **Data touched:** Supabase `auth.mfa_factors` (via admin API); `DATA-access_audit`.
- **Permissions:** `PERM-user.reset_2fa` (Super Admin + Admin).
- **Config dependencies:** —
- **Surfaces:** `UI-USER-MGMT`.
- **Observability:** 2FA-reset `audit` + security `event_log`.
- **Acceptance criteria:**
  - AC-1.USR.003.1 — Given an Admin resets a password-account user's 2FA, When the user next logs in, Then they must re-enroll TOTP before reaching `aal2`, and the reset is audited.
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-1.USR.004 — View user activity logs
- **Statement:** The system shall let a Super Admin or Admin view a user's activity log.
- **Source:** design-doc-v4.md L578 ("View user activity logs" — Super Admin + Admin)
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** Super Admin / Admin reviewing a user.
- **Preconditions:** `PERM-user.view_activity` (Super Admin + Admin).
- **Behaviour:**
  - Happy path: the activity log surfaces the user's actions (from `event_log`/`audit`), read-only.
  - Branches: viewing **Personal/Restricted** access entries is itself subject to the viewer's clearance and is audited (a viewer without clearance sees redacted entries).
  - Edge / failure: —
- **Data touched:** reads `event_log`/`audit`.
- **Permissions:** `PERM-user.view_activity` (Super Admin + Admin).
- **Config dependencies:** —
- **Surfaces:** `UI-USER-MGMT` / `UI-USER-ACTIVITY` (Phase 3).
- **Observability:** —
- **Acceptance criteria:**
  - AC-1.USR.004.1 — Given an Admin, When they open a user's activity log, Then they see that user's recorded actions, read-only.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Storage/retention/export of the underlying logs is **C7 (Observability)**; C1 owns the *gated view*.

### FR-1.USR.005 — Grant and revoke sensitivity clearances
- **Statement:** The system shall let a Super Admin grant or revoke a user's/role's above-Standard sensitivity clearance, with entity-type scope, audited and effective instantly.
- **Source:** design-doc-v4.md L576 ("Grant sensitivity clearances" — Super Admin only), L448, L450
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Super Admin in Clearance Management.
- **Preconditions:** `PERM-user.grant_clearance` (Super Admin only).
- **Behaviour:**
  - Happy path: grant Standard+N with an entity-type scope → `sensitivity_clearances` write → effective next query (FR-1.RLS.006); revoke → instant denial.
  - Branches: Admin may **not** grant clearances (L576 Super Admin only) — even though Admin holds default Personal+Confidential themselves.
  - Edge / failure: a grant exceeding the documented model (e.g. Restricted via this flow) → routed to the Restricted-grant flow (FR-1.RST.001), not this one.
- **Data touched:** `DATA-sensitivity_clearances` (write); `DATA-access_audit`.
- **Permissions:** `PERM-user.grant_clearance` (Super Admin only).
- **Config dependencies:** —
- **Surfaces:** `UI-CLEARANCE-MGMT`.
- **Observability:** clearance grant/revoke `audit`.
- **Acceptance criteria:**
  - AC-1.USR.005.1 — Given an Admin (not Super Admin), When they attempt to grant a clearance, Then it is denied.
  - AC-1.USR.005.2 — Given a Super Admin grants Confidential/finance to a user, When the user next queries finance entities, Then the new clearance applies.
- **Open decisions:** OD-027 (scope representation).
- **Feasibility assumptions:** —

---

# AUD — Audit of Personal & Restricted access + permission changes

### FR-1.AUD.001 — Every Personal/Restricted access produces a permanent audit record
- **Statement:** The system shall write a permanent, immutable audit record for every read, write, or injection of Personal- or Restricted-tier content, capturing who/what accessed it, when, the entity, and the access path.
- **Source:** design-doc-v4.md L456 ("All Personal and Restricted memory access is fully audited. Every read, write, or injection produces a permanent audit record.")
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Any access (human or agent) to Personal/Restricted content.
- **Preconditions:** The access is permitted (else it's a denial, logged separately).
- **Behaviour:**
  - Happy path: each Personal/Restricted read/write/injection appends an `access_audit` record (subject, actor — user or agent identity, tier, entity, path, timestamp, outcome).
  - Branches: the **agent/service_role** path is audited via the harness (ADR-004), since RLS doesn't see it — so audit coverage spans **both** the human and agent paths (a gap here would be a silent #1/#3 failure).
  - Edge / failure: an access with no audit record is the failure this FR forbids — completeness is the requirement (mirrors FR-0.AUTH.010's completeness pattern).
- **Data touched:** `DATA-access_audit` (append-only write); reads `DATA-memories` (tier).
- **Permissions:** N/A (the access itself is gated elsewhere).
- **Config dependencies:** —
- **Surfaces:** audit views (C7 / Phase 3).
- **Observability:** this FR *is* the access-audit-completeness assertion.
- **Acceptance criteria:**
  - AC-1.AUD.001.1 — Given a Personal-tier memory is injected into a task, When the injection occurs, Then an immutable audit record is written.
  - AC-1.AUD.001.2 — Given an agent (service_role) reads a Restricted memory, When the read occurs, Then it is audited (the agent path is covered, not just the human path).
- **Open decisions:** — (OD-024 resolved: dedicated append-only `access_audit` table; C7 owns retention/export).
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-081 (agent-path access-audit completeness — the `service_role` path has **no** RLS/DB backstop, so audit coverage there rests entirely on harness discipline; prove no agent-path Personal/Restricted access is unlogged, same shape as AF-076/079).
- **Notes:** Completeness across **both** access paths is the load-bearing property. Storage/retention/tamper-evidence/export are **C7 / Phase 5** — C1 owns the *completeness requirement* and the *what-must-be-captured*.

### FR-1.AUD.002 — Permission, role, and clearance changes are audited (who/when/what/why)
- **Statement:** The system shall write an audit record for every change to a role, the permission matrix, a clearance, a Restricted grant, a role assignment, a deactivation, or a 2FA reset — capturing who made the change, when, the before/after, and (where required) why.
- **Source:** design-doc-v4.md L452 (Restricted "who/when/why"); **extends** the design's implied audit to all RBAC mutations; **gap → OD-029**
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Any RBAC-configuration mutation.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: each mutation appends an audit record (actor, action, target, before/after, timestamp; reason mandatory for Restricted grants per L452).
  - Branches: a reason field is mandatory for Restricted (FR-1.RST.002) and optional-but-captured elsewhere (per OD-029).
  - Edge / failure: an unaudited RBAC change (e.g. a silent privilege escalation) is the failure this FR forbids (#2/#3).
- **Data touched:** `DATA-access_audit` (append-only); reads the permission tables for before/after.
- **Permissions:** N/A (the mutations are gated by their own nodes).
- **Config dependencies:** —
- **Surfaces:** audit views (C7).
- **Observability:** this FR *is* the RBAC-change-audit-completeness assertion.
- **Acceptance criteria:**
  - AC-1.AUD.002.1 — Given a Super Admin toggles a node for a role, When saved, Then an audit record captures actor, the (role, node) target, before/after, and timestamp.
- **Open decisions:** OD-024 (store), OD-029 (which mutations require a mandatory reason; single-vs-multi role model).
- **Feasibility assumptions:** —

### FR-1.AUD.003 — The audit trail is the seam to C7 (storage / retention / export)
- **Statement:** The system shall treat the RBAC/access audit trail's storage, retention, tamper-evidence, and export as owned by Observability (C7) / Phase 5, with C1 asserting only the completeness and content requirements (FR-1.AUD.001/002).
- **Source:** seam declaration (mirrors C0 FR-0.AUTH.010's C7 seam)
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** N/A (a scoping requirement).
- **Preconditions:** —
- **Behaviour:**
  - Happy path: C1 defines *what* must be captured and *that* it must be complete + immutable; C7 defines *where* it lives, *how long*, *how it's protected*, and *how it's exported* (L597 "Download compliance records").
  - Branches: —
  - Edge / failure: a retention/export gap is a C7 concern, flagged here so it isn't lost.
- **Data touched:** `DATA-access_audit` (definition seam).
- **Permissions:** `PERM-compliance.download_records` (L597) for export — homed in the catalog, specced in C7.
- **Config dependencies:** audit-retention config (Phase 5).
- **Surfaces:** audit/compliance views (C7).
- **Observability:** —
- **Acceptance criteria:**
  - AC-1.AUD.003.1 — Given the audit content requirements (FR-1.AUD.001/002), When C7 is specced, Then storage/retention/export are defined there without re-opening C1's completeness requirement.
- **Open decisions:** OD-024 (the boundary of what C1 fixes vs what C7 fixes).
- **Feasibility assumptions:** —

---

## Parked stubs (for later phases)

**CFG-** (Phase 2): `clearance_review_cadence_days` (LIVE, default 90); `two_factor_required` (C0-owned intent flag, consumed by FR-1.RLS.005); audit-retention (Phase 5).

**UI-** (Phase 3): `UI-ROLE-MGMT`, `UI-PERMISSION-MATRIX`, `UI-CLEARANCE-MGMT`, `UI-CLEARANCE-REVIEW`, `UI-RESTRICTED-GRANT`, `UI-USER-MGMT`, `UI-USER-ACTIVITY`, audit/compliance views (C7).

**DATA-** (Phase 4 / data-model): `roles`, `role_permissions`, `user_roles`, `sensitivity_clearances` (with `entity_type_scope`, `last_reviewed_at`), `restricted_grants` (granter/grantee/reason/scope/time), `access_audit` (append-only); helper functions `user_clearances(uid)`, `user_visibility(uid)`, `user_restricted(uid)`, `user_aal()`; a generic RLS policy per table; indexes on policy columns.

**PERM-** (catalog, FR-1.PERM.005 / `PERMISSION_NODES.md`): the 13 categories' nodes (L509–615) seeded with default-role assignments; C0 stubs homed: `PERM-system.role_manage`, `PERM-user.assign_role`, `PERM-user.deactivate`, `PERM-user.reset_2fa`, `PERM-user.view_activity`, `PERM-user.grant_clearance`, `PERM-user.grant_restricted`, `PERM-user.invite` (C0), `PERM-auth.provider_toggle` (C0), `PERM-support.view`/`PERM-support.resolve` (C0), `PERM-compliance.download_records`.

**AF-** (feasibility): AF-067 (RLS hot-path perf — existing), AF-076 (`aal2` coverage — existing, from C0), AF-068 (containment red-team — existing, referenced by FR-1.RLS.007), **AF-079** (RLS coverage completeness — new), **AF-080** (harness/RLS non-drift, sharpened to runtime divergence — new), **AF-081** (agent-path access-audit completeness — new).

**OOS-**: OOS-012 (D2 JWT-cached permission claims, deferred as the fallback optimisation — already logged via ADR-006).

---

## Open decisions raised by this component (OD-024…OD-031 — all 🟢 RESOLVED)

> Logged + resolved in `open-decisions.md` (OD-024…030 delegated C0-style; OD-031 raised by the
> verification gate and resolved the same way).

- **OD-024** 🟢 — Audit store: **dedicated append-only `access_audit` table**; C7 owns retention/export.
- **OD-025** 🟢 — Role deletion: **deletable iff zero assigned users AND not protected**; Super Admin always protected; other defaults un-deletable while in use.
- **OD-026** 🟢 — Denied direct access: **explicit 403 + security log**; surface absent in UI; never silent empty success.
- **OD-027** 🟢 — `entity_type_scope` column (`NULL`=global); **Restricted is per-individual only** (L452 governs over L438).
- **OD-028** 🟢 — Overdue clearance review: **flag + escalate**; neither auto-revoke nor silently retain (fail-closed is per-deployment opt-in).
- **OD-029** 🟢 — **Audit every RBAC mutation**; **one role per user (v1)**; **last Super Admin protected** across deactivate/role-change/role-delete.
- **OD-030** 🟢 — **Seed default matrix once at provisioning**; operator edits authoritative after; new nodes default-deny.
- **OD-031** 🟢 *(gate-raised)* — Mid-task authorization revocation: re-check at step boundaries; on **deactivation/clearance-revoke, halt + quarantine** before the next consequential side effect (benign session-expiry continues, per C0 FR-0.SESS.006); already-applied side effects → OD-010; mechanism seamed to C5/C6/C8. → **FR-1.RLS.007**.
