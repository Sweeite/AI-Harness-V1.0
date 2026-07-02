# Surface: UI-USER-MGMT (surface-02) — User & Access Management

**Status:** 🟢 **Signed off 2026-06-30** (operator-authorized — "yes to all"; OD-109–112 delegated "take all 4 recs"). Verification gate CLEAN (0 HIGH, 1 MED + 2 LOW patched, 2 LOW justified-as-is). 3 of 14 Phase-3 surfaces complete.

> Consolidates the six C1 (RBAC) administration sub-surfaces into one tabbed **Users & Access** surface.
> Each is specced as its own section below: **UI-USER-MGMT · UI-ROLE-MGMT · UI-PERMISSION-MATRIX ·
> UI-CLEARANCE-MGMT · UI-CLEARANCE-REVIEW · UI-RESTRICTED-GRANT** (the `UI-CLEARANCE-*` glob expands to
> the two clearance surfaces — grant/revoke and the cadence review). The **Users** tab also renders the
> post-invite lifecycle actions that C0 (Login) named `UI-USER-MGMT` (invite issue / expiry / SMTP /
> revoke-resend / bounce). This is Tier-1 day-to-day record management, **not** harness config (surface-01).

---

## Context manifest

- **Surface ID(s):** `UI-USER-MGMT`, `UI-ROLE-MGMT`, `UI-PERMISSION-MATRIX`, `UI-CLEARANCE-MGMT`, `UI-CLEARANCE-REVIEW`, `UI-RESTRICTED-GRANT` (and `UI-USER-ACTIVITY` folded into the Users tab's per-user drawer)
- **Owned by:** **C1 (RBAC)** — the rendering target for the ROLE / PERM / CLR / RST / USR / AUD areas. The **Users** tab additionally renders **C0** invite-lifecycle FRs (FR-0.INV.*). Role-default landing after activation is a C0→C1 seam (FR-0.INV.005).
- **FRs served:**
  - **UI-USER-MGMT (Users tab)** — FR-1.USR.001 (assign/change role), FR-1.USR.002 (deactivate / reactivate — revocation not deletion), FR-1.USR.003 (reset 2FA), FR-1.USR.004 (view activity log), FR-1.ROLE.005 (last-Super-Admin protection), FR-1.RLS.006 (changes effective on next query); **+ C0 invite lifecycle** FR-0.INV.001 (invite-only, no self-registration), FR-0.INV.002 (link generation + ≤24 h expiry), FR-0.INV.003 (custom-SMTP send + failure surfacing), FR-0.INV.006 (revoke / resend / re-issue), FR-0.INV.007 (delivery-failure + bounce surfacing)
  - **UI-ROLE-MGMT (Roles tab)** — FR-1.ROLE.001 (six default roles), FR-1.ROLE.002 (runtime CRUD, no migration), FR-1.ROLE.003 (Super-Admin-only), FR-1.ROLE.004 (delete-if-unused + protected roles), FR-1.ROLE.005 (last-Super-Admin protection)
  - **UI-PERMISSION-MATRIX (Permissions tab)** — FR-1.PERM.004 (role × node grid, toggle-to-grant), FR-1.PERM.002 (default-deny), FR-1.PERM.005 (`PERMISSION_NODES.md` is the catalog source), FR-1.PERM.007 (thirteen-category seed catalog), FR-1.PERM.006 (denied surfaces absent)
  - **UI-CLEARANCE-MGMT (Clearances tab)** — FR-1.USR.005 (grant/revoke above-Standard clearance), FR-1.CLR.002 (per-role default clearances), FR-1.CLR.003 (explicit-never-inherited), FR-1.CLR.004 (entity-type scope), FR-1.CLR.001 (the four tiers — informational)
  - **UI-CLEARANCE-REVIEW (Reviews tab)** — FR-1.CLR.005 (configurable-cadence review; un-actioned = flag + escalate, never auto-revoke / never silently retain)
  - **UI-RESTRICTED-GRANT (Restricted tab)** — FR-1.RST.001 (per-named-individual, never per role, Super-Admin-only), FR-1.RST.002 (who/when/why audit; instant revoke), FR-1.RST.003 (never auto-injected — informational note)
  - **Cross-cutting:** FR-1.AUD.002 (every RBAC mutation audited — rendered as inline history/audit on each tab), FR-1.AUD.001 (Personal/Restricted access audit — surfaced read-only in the user-activity drawer)
- **CFG dependencies** (all read-only here — editing lives on `surface-01`, in the section noted per key):
  `clearance_review_cadence_days` (default 90, **LIVE**; edited on `surface-01` **`#guardrails`** — registry group D, gated `PERM-config.guardrails` — drives the Reviews tab due/overdue computation),
  `auth.invite_link_ttl` (≤24 h, **BOOT**; edited on `surface-01` **`#auth`** — invite expiry shown read-only on the Users tab), `auth.smtp_*` (SECRET; `surface-01` **`#auth`**/`#secrets` — invite delivery; surfaced only as send-status, never the secret value), `auth.smtp_bounce_webhook` (`surface-01` **`#auth`** — bounce surfacing, FR-0.INV.007)
- **PERM gates:**
  - **Surface entry:** any of `PERM-user.invite` / `PERM-user.assign_role` / `PERM-user.deactivate` (Users tab); the surface is hidden entirely from callers holding none of the access nodes.
  - **Users tab:** `PERM-user.invite` (invite/revoke/resend), `PERM-user.assign_role` (role change — Super Admin + Admin), `PERM-user.deactivate` (deactivate/reactivate — Super Admin + Admin), `PERM-user.reset_2fa` (Super Admin + Admin), `PERM-user.view_activity` (Super Admin + Admin)
  - **Roles tab + Permissions tab:** `PERM-system.role_manage` (**Super Admin only** — FR-1.ROLE.003)
  - **Clearances tab + Reviews tab:** `PERM-user.grant_clearance` (**Super Admin only** — FR-1.USR.005)
  - **Restricted tab:** `PERM-user.grant_restricted` (**Super Admin only** — FR-1.RST.001)
  - All nodes default-deny (FR-1.PERM.002); per-action gates noted inline below.
- **DATA bindings** (all Phase-4 stubs; C1-owned, no `client_slug` per ADR-001 §3 / OD-096):
  `users`/profile (`id`, `email`, `name`, `active`, `created_at`, `last_active_at`), `roles`, `role_permissions`, `user_roles`, `sensitivity_clearances` (`tier`, `entity_type_scope`, `last_reviewed_at`), `restricted_grants` (`granter`, `grantee`, `reason`, `scope`, `granted_at`, `revoked_at`), `access_audit` (append-only). Catalog source: `PERMISSION_NODES.md` (build artifact — drives the matrix). Supabase-managed (referenced, never written here): `auth.users`, `auth.mfa_factors`, invite tokens.
- **ADR constraints:**
  - **ADR-006** (the spine) — permissions/clearances live in data, edited from this surface with **no migration**; every grant/revoke is effective on the user's **next query** (FR-1.RLS.006), so this surface never promises a logout/re-login. The matrix toggle writes a `role_permissions` row; the (select …) initPlan / live-read mechanics are invisible here but are why "instant" is true.
  - **ADR-001 §3** — isolation is physical (one deployment per client); no `client_slug` column anywhere on this surface.
  - **ADR-004** — the Memory Agent / backend run as `service_role`; a mid-task authorization change (deactivate / clearance-revoke) does **not** instantly stop an in-flight agent task — that halt-before-next-side-effect is FR-1.RLS.007, enforced in C5/C6/C8 (per OD-031) and surfaced on the ops/quarantine surface (surface-05), **not** here. This surface owns the *authorization state*, not the agent-path interception.

---

## Overview

surface-02 is the operator's **access-control cockpit** — where Super Admins (and, for the Users tab, Admins)
manage who exists, what role they hold, which permission nodes each role carries, what sensitivity clearances
they're granted, and who holds per-individual Restricted access. It is a single tabbed surface with six tabs:
**Users · Roles · Permissions · Clearances · Reviews · Restricted**. Admins live mostly in **Users** (invite,
deactivate, reset 2FA, change role); the role/permission/clearance/Restricted machinery is **Super-Admin-only**.
Two non-negotiables govern the whole surface: **#2** (never grant something it shouldn't — every above-Standard
and Restricted grant is explicit, scoped, and reason-captured) and **#3** (never fail silently — a blocked
last-Super-Admin action, a throttled invite, an overdue clearance review are all surfaced, never swallowed).

---

## Access

> Uses the six canonical C1 roles (FR-1.ROLE.001). Custom roles are data-defined; the six defaults are the
> baseline. "Can enter?" is per-**tab** — the surface itself appears if the caller holds any Users-tab node.

| Role | Can enter? | Notes |
|---|---|---|
| Super Admin | Yes — all six tabs | Holds every `PERM-user.*` + `PERM-system.role_manage`; the only role that sees Roles / Permissions / Clearances / Reviews / Restricted |
| Admin | Yes — **Users tab only** | Holds `PERM-user.invite/.assign_role/.deactivate/.reset_2fa/.view_activity`; does **not** hold `role_manage` / `grant_clearance` / `grant_restricted` → the other five tabs are hidden (FR-1.ROLE.003, FR-1.USR.005, FR-1.RST.001) |
| Finance | No | No `PERM-user.*` / `role_manage` by default → nav item hidden |
| HR | No | No relevant nodes by default → nav item hidden (HR manages *team-member memory entities*, not platform users — a memory-nav concern, surface-11) |
| Account Manager | No | No relevant nodes by default → nav item hidden |
| Standard User | No | No relevant nodes by default → nav item hidden |

**Entry gate:** the surface renders iff the caller holds ≥1 of `PERM-user.invite` / `.assign_role` /
`.deactivate`. A caller without any never sees the "Users & Access" nav item; a direct URL returns 404
(FR-1.PERM.006 — denied surfaces are absent, not a visible-but-empty page). Each tab is independently gated;
a caller landing on the surface sees only the tabs whose node they hold.

---

## Layout

A standard in-app surface inside the authenticated shell — sidebar item **"Users & Access"**, a sticky page
header with the tab bar, and a content pane per tab:

- **Tabs:** Users · Roles · Permissions · Clearances · Reviews · Restricted (hidden per the Access table).
- **Users tab** — a searchable/filterable table of users (one row per user) + a primary **"Invite user"** action;
  clicking a row opens a right-hand **detail drawer** (role, clearances summary, 2FA status, activity log).
- **Roles tab** — a list of roles (six defaults + any custom) + **"New role"**; a role opens an editor.
- **Permissions tab** — the role × permission-node matrix, grouped by the thirteen catalog categories (OD-110).
- **Clearances tab** — a list of above-Standard clearance grants (user/role × tier × entity-type scope) + grant action.
- **Reviews tab** — the clearance-review queue (due + overdue), with an overdue-escalation banner (OD-111).
- **Restricted tab** — the per-individual Restricted-grant register + grant action.

Sensitive/destructive actions (deactivate, role delete, clearance revoke, Restricted grant/revoke) use a
confirm modal; an optional/required reason field per OD-112 writes to `access_audit` (FR-1.AUD.002).

---

## Sections

---

### UI-USER-MGMT — Users

**Purpose:** The roster of every user in the deployment and their post-invite lifecycle — invite new users,
change roles, deactivate/reactivate, reset 2FA, and inspect activity. Super Admin + Admin.

> **`UI-USER-ACTIVITY` is intentionally merged here**, not dropped — the per-user activity log (FR-1.USR.004)
> renders as the detail-drawer's activity panel rather than a standalone surface.

**Data bindings:**

| Element | Source | Notes |
|---|---|---|
| User rows | `users.{id,email,name,active,created_at,last_active_at}` + `user_roles` (current role) | Searchable by name/email; filter by role + active/deactivated |
| Role cell | `user_roles` → `roles.name` | One role per user (v1, OD-029); editable inline → confirm modal |
| Status badge | `users.active` | `Active` / `Deactivated` (FR-1.USR.002 — revocation, not deletion) |
| 2FA status | Supabase `auth.mfa_factors` (read) | `Enrolled` / `Not enrolled`; for OAuth users, "via identity provider" (FR-1.USR.003 branch) |
| Invite/delivery status | invite token state + `event_log` (FR-0.INV.003/.007) | Per pending invite: `Sent` / `Send failed` / `Delivery unconfirmed` / `Bounced` / `Expired` |
| Activity log (drawer) | `event_log` / `access_audit` (read; FR-1.USR.004 / FR-1.AUD.001) | Read-only; Personal/Restricted entries redacted unless the viewer is cleared, and viewing is itself audited |

> **DRY rule for human-readable text.** Role descriptions, clearance-tier meanings, and status-label copy bind
> to their canonical sources (role definition; glossary tier semantics, FR-1.CLR.001) — never re-typed here.

**Actions:**

| Action (label) | What it does | PERM gate |
|---|---|---|
| Invite user | Opens a modal (email, name, role); issues a native Supabase invite link ≤24 h (FR-0.INV.002), delivered via custom SMTP (FR-0.INV.003). Public signup stays off (FR-0.INV.001) | `PERM-user.invite` |
| Resend / re-issue invite | One-click resend of an outstanding/expired invite → fresh ≤24 h link (FR-0.INV.006) | `PERM-user.invite` |
| Revoke invite | Invalidates an unused invite so the link no longer activates an account; audited (FR-0.INV.006); no-op if already used | `PERM-user.invite` |
| Change role | Inline role change → confirm → `user_roles` write → effective next query (FR-1.RLS.006); audited who/old/new (FR-1.AUD.002). Blocked if it would drop the last Super Admin (FR-1.ROLE.005) | `PERM-user.assign_role` (Super Admin + Admin) |
| Deactivate user | Confirm modal (optional reason, OD-112) → `active=false` → sessions invalidated / next query denied; record + audit retained (FR-1.USR.002). Blocked for the last Super Admin (FR-1.ROLE.005) | `PERM-user.deactivate` |
| Reactivate user | Restores base role membership; **above-Standard clearances + Restricted grants are NOT auto-restored** — they must be explicitly re-granted (FR-1.USR.002, AC-1.USR.002.2) | `PERM-user.deactivate` |
| Reset 2FA | Removes the user's TOTP factor → re-enroll on next login (FR-1.USR.003); audited. For OAuth users this is a no-op at the app layer (MFA is at the IdP) — surfaced explicitly, not as false success | `PERM-user.reset_2fa` |
| View activity (drawer) | Opens the read-only activity log (FR-1.USR.004) | `PERM-user.view_activity` |

**Real-time / poll:** User list **static on page load + on-demand refresh**. **Invite delivery status** polls
so a `Send failed` / `Bounced` outcome appears without a manual refresh (FR-0.INV.003/.007 — a throttled or
bounced invite must never read as "sent", #3). Activity drawer fetches on open.

**States:**
- **Loading:** Skeleton table rows; drawer shows a skeleton on open.
- **Empty:** Only the seeded Super Admin exists → "You're the only user so far. Invite your team to get started." with the Invite action highlighted (never a blank table).
- **Error:** List fetch fails → "Couldn't load users." + retry; does **not** render an empty roster (which would falsely read as "no users"). An invite that fails to send shows an explicit **"Send failed — SMTP not configured / throttled. Retry."** inline (FR-0.INV.003), never a silent success.
- **Partial:** List loads but 2FA status or invite-delivery status fails to resolve → render the row with that cell showing "—" / "status unavailable", not a guessed value.
- **Offline / stale:** "You're offline — showing the last loaded list. Changes are disabled until you reconnect." Action buttons disabled so an admin can't believe a deactivate landed when it didn't.

---

### UI-ROLE-MGMT — Roles

**Purpose:** Create, edit, and delete roles entirely as data (no migration) — the six defaults ship seeded and
fully editable; custom roles are added the same way. **Super Admin only** (FR-1.ROLE.003).

**Data bindings:**

| Element | Source | Notes |
|---|---|---|
| Role rows | `roles.{id,name,is_protected}` + assigned-user count from `user_roles` | Six defaults first, then custom; count drives delete-eligibility |
| Assigned-user count | `COUNT(user_roles)` per role | A role with ≥1 user can't be deleted (FR-1.ROLE.004) |
| Protected flag | `roles.is_protected` | Super Admin always protected; other defaults protected-while-in-use (OD-025) |
| Per-role node summary | `role_permissions` (count / link to Permissions tab) | "Edit permissions" jumps to the matrix filtered to this role |

**Actions:**

| Action (label) | What it does | PERM gate |
|---|---|---|
| New role | Creates a `roles` row → immediately assignable (FR-1.ROLE.002); node assignment via the Permissions tab | `PERM-system.role_manage` |
| Rename / edit role | Edits the `roles` row; audited (FR-1.AUD.002) | `PERM-system.role_manage` |
| Delete role | Allowed **only** when zero assigned users **and** not protected (FR-1.ROLE.004); otherwise blocked with a message naming the assigned-user count ("reassign N users first") | `PERM-system.role_manage` |
| Edit permissions → | Deep-links to the Permissions tab scoped to this role | `PERM-system.role_manage` |

**Real-time / poll:** Static on page load + on-demand refresh. Assigned-user counts re-read on tab focus.

**States:**
- **Loading:** Skeleton role list.
- **Empty:** N/A — the six defaults always exist post-provisioning. If the role set is incomplete (a partial seed), show a **provisioning-error banner** ("Role set incomplete — provisioning may have failed; contact the operator"), never a silently short list (FR-1.ROLE.001 fails loud, #3).
- **Error:** Fetch fails → "Couldn't load roles." + retry. A blocked delete renders an explicit reason inline ("3 users still assigned" / "protected role").
- **Partial:** Role list loads but a user-count query fails → show the role with the count as "—" and **disable delete** for it (never allow a delete whose safety check didn't run — #2).
- **Offline / stale:** Stale banner; create/edit/delete disabled until reconnect.

---

### UI-PERMISSION-MATRIX — Permissions

**Purpose:** The role × permission-node grid — the single place permission assignments are toggled, generated
from `PERMISSION_NODES.md` (FR-1.PERM.005). **Super Admin only.**

**Data bindings:**

| Element | Source | Notes |
|---|---|---|
| Node rows | `PERMISSION_NODES.md` catalog (thirteen categories — FR-1.PERM.007) | Every catalog node renders as a row; none hardcoded or omitted (AC-1.PERM.005.2) |
| Node description / scope / added-in | `PERMISSION_NODES.md` (Description / Scope / Added-in fields) | Helper text binds to the catalog (DRY) — never re-typed; a missing description is a catalog defect, not a surface fallback |
| Role columns | `roles` | One column per role (defaults + custom) |
| Grant cell (toggle) | `role_permissions` (role × node row presence) | Checked = granted; unchecked = default-deny (FR-1.PERM.002) |

**Actions:**

| Action (label) | What it does | PERM gate |
|---|---|---|
| Toggle (role, node) | Adds/removes a `role_permissions` row → effective on affected users' next query, no deploy (FR-1.PERM.004 / AC-1.ROLE.002.1); audited before/after (FR-1.AUD.002) | `PERM-system.role_manage` |
| Search / filter nodes | Filters rows by node name or category | same as entry |
| Scope to role | Filters columns to one role (entry point from the Roles tab) | same as entry |

**Real-time / poll:** Static on page load; toggles write on-demand and reflect optimistically (with rollback on write failure). No subscription.

**States:**
- **Loading:** Skeleton grid (category headers + shimmer rows).
- **Empty:** N/A — the catalog always has nodes. If `PERMISSION_NODES.md` yields zero nodes, that's a build/seed defect → show "Permission catalog failed to load" (never an empty grid that reads as "no permissions exist", #3).
- **Error:** Catalog or grant-row fetch fails → "Couldn't load the permission matrix." + retry. A toggle write failure rolls the cell back and shows "Couldn't save that change — retry" (never leave the cell visually granted while the write failed — #2).
- **Partial:** Catalog loads but the `role_permissions` grants fail → render the grid with all cells in an "unknown" state and **disable toggling** until grants load (don't present default-deny as confirmed state).
- **Offline / stale:** Stale banner; toggles disabled until reconnect.

---

### UI-CLEARANCE-MGMT — Clearances

**Purpose:** Grant and revoke above-Standard sensitivity clearances (Confidential / Personal), each scoped by
entity type, explicit and never inherited. **Super Admin only** (FR-1.USR.005). Restricted is **not** here — it
has its own tab (FR-1.RST.001).

**Data bindings:**

| Element | Source | Notes |
|---|---|---|
| Clearance rows | `sensitivity_clearances.{subject,tier,entity_type_scope,last_reviewed_at}` | Subject = role (default clearances, FR-1.CLR.002) or user (explicit grants); tier ∈ {Confidential, Personal} |
| Tier meaning | glossary / FR-1.CLR.001 (DRY) | Standard / Confidential / Personal / Restricted semantics bind to the canonical definition |
| Entity-type scope | `sensitivity_clearances.entity_type_scope` (`NULL`=Global) | A clearance to a tier for one entity type does not grant it for another (FR-1.CLR.004) |
| Default-vs-explicit marker | derived | Role defaults (seeded, FR-1.CLR.002) vs explicit per-user grants, visually distinguished |

**Actions:**

| Action (label) | What it does | PERM gate |
|---|---|---|
| Grant clearance | Modal: subject (user/role), tier (Confidential/Personal), entity-type scope → `sensitivity_clearances` write → effective next query (FR-1.RLS.006); audited (FR-1.AUD.002). A grant is always explicit — never conferred as a side effect (FR-1.CLR.003) | `PERM-user.grant_clearance` |
| Revoke clearance | Confirm (optional reason, OD-112) → removes the grant → instant denial on next query | `PERM-user.grant_clearance` |
| (Restricted attempt) | A grant request for the Restricted tier is **routed to the Restricted tab**, not granted here (FR-1.USR.005 edge / FR-1.RST.001) | — |

**Real-time / poll:** Static on page load + on-demand refresh. Grant/revoke writes on-demand.

**States:**
- **Loading:** Skeleton list.
- **Empty:** "No above-Standard clearances granted yet. Everyone has Standard by default." (the healthy zero-state; Standard is the floor, FR-1.CLR.002).
- **Error:** Fetch fails → "Couldn't load clearances." + retry. A grant/revoke write failure surfaces explicitly and does not optimistically show the new state.
- **Partial:** List loads but a subject (user/role) name fails to resolve → show the grant with the id/"unknown subject" rather than dropping the row (a hidden clearance is worse than an ugly one — #3).
- **Offline / stale:** Stale banner; grant/revoke disabled.

---

### UI-CLEARANCE-REVIEW — Reviews

**Purpose:** Surface above-Standard clearances for periodic Super Admin review on the configured cadence, and
make un-actioned reviews **visible** — flagged and escalated, never auto-revoked and never silently retained
(FR-1.CLR.005, the #1∧#3 balance). **Super Admin only.**

**Data bindings:**

| Element | Source | Notes |
|---|---|---|
| Review rows | `sensitivity_clearances` where `last_reviewed_at` + cadence has elapsed | Due + overdue clearances surfaced for confirm/revoke |
| Cadence | `CFG-clearance_review_cadence_days` (default 90, read-only here; edited on surface-01) | Drives the due/overdue computation server-side |
| Overdue flag | `last_reviewed_at` vs cadence | An un-actioned, past-cadence clearance is **overdue** → escalation banner |
| Last-reviewed / reviewer | `sensitivity_clearances.last_reviewed_at` + audit | Shown per row |

**Actions:**

| Action (label) | What it does | PERM gate |
|---|---|---|
| Confirm (still appropriate) | Stamps `last_reviewed_at=now`; audited (FR-1.AUD.002); clears the due flag | `PERM-user.grant_clearance` |
| Revoke | Removes the clearance → instant denial (FR-1.RLS.006); audited | `PERM-user.grant_clearance` |

**Real-time / poll:** Due/overdue set is computed server-side and fetched on tab load; the overdue count badge on
the tab refreshes on a poll (the cadence is days-scale, so a slow poll / on-focus refresh suffices). The
overdue **escalation** (alert) is produced by the C5 review loop + C7 alerting — this surface renders the queue
and the banner, it does not own the escalation delivery (seam).

**States:**
- **Loading:** Skeleton review list.
- **Empty:** "No clearances are due for review." (healthy zero-state).
- **Error:** Fetch fails → "Couldn't load the review queue." + retry; does **not** render empty (an empty review queue that's actually a fetch failure would silently hide overdue access — #3).
- **Partial:** Queue loads but an overdue computation input is missing → surface the row as "review status unknown — treat as due" (fail toward review, never toward silently-reviewed).
- **Offline / stale:** Stale banner with the as-of time; confirm/revoke disabled. The overdue banner persists (an overdue clearance offline is still overdue).

---

### UI-RESTRICTED-GRANT — Restricted

**Purpose:** Grant and revoke Restricted access — the highest tier — only to a **named individual**, never to a
role, with a mandatory reason and a full audit trail. **Super Admin only** (FR-1.RST.001/.002).

**Data bindings:**

| Element | Source | Notes |
|---|---|---|
| Grant rows | `restricted_grants.{grantee,granter,reason,scope,granted_at,revoked_at}` | Per-named-individual grants; active + revoked (history retained) |
| Grantee | `users` (named individual) | Never a role — a role can't appear here (FR-1.RST.001) |
| Reason | `restricted_grants.reason` | **Mandatory** — a grant with no reason is rejected (FR-1.RST.002 / AC-1.RST.002.1) |
| Scope | `restricted_grants.scope` (entity / entity-type, optional) | Optional narrowing of the grant |
| Audit linkage | `access_audit` (FR-1.AUD.001/002) | Every grant/revoke + every Restricted access is permanently audited |

> **Note (informational, FR-1.RST.003):** Restricted content is **never auto-injected** into any task or agent
> context — even for a user holding a grant. It surfaces only via an explicit, audited access. This surface
> grants the *eligibility*; the never-auto-inject rule is enforced in the C2 retrieval pipeline (seam).

**Actions:**

| Action (label) | What it does | PERM gate |
|---|---|---|
| Grant Restricted | Modal: grantee (named user), optional scope, **mandatory reason** → `restricted_grants` write + `access_audit` (granter/grantee/time/reason — AC-1.RST.002.2). Reason empty → submit rejected | `PERM-user.grant_restricted` |
| Revoke Restricted | Confirm → revokes → instant denial on next query (FR-1.RST.002 / AC-1.RST.002.3); audited; history retained | `PERM-user.grant_restricted` |

**Real-time / poll:** Static on page load + on-demand refresh; grant/revoke on-demand.

**States:**
- **Loading:** Skeleton grant list.
- **Empty:** "No Restricted grants. Restricted access is per-person, granted only with a logged reason." (healthy + educational zero-state).
- **Error:** Fetch fails → "Couldn't load Restricted grants." + retry. A grant submitted without a reason is rejected client- and server-side with "A reason is required for Restricted access."
- **Partial:** List loads but the `access_audit` linkage fails to resolve → show the grant; flag "audit link unavailable" rather than implying the grant is unaudited.
- **Offline / stale:** Stale banner; grant/revoke disabled (a Restricted grant must not be attempted against stale state — #2).

---

## Navigation / transitions

| Trigger | Destination |
|---|---|
| Sidebar "Users & Access" | surface-02 (default tab = Users) |
| Users tab → "Invite user" | Invite modal → on send, a pending-invite row (delivery status tracked) |
| Users tab → click a user row | User detail drawer (role, clearances summary, 2FA, activity log) |
| Roles tab → "Edit permissions →" | Permissions tab scoped to that role |
| Clearances tab → Restricted-tier grant attempt | Restricted tab |
| Reviews tab → overdue escalation banner | (alert is delivered via C7; banner links to the affected clearance row) |
| Any blocked last-Super-Admin action | Inline block message on the Users/Roles tab (no navigation; the action is refused, FR-1.ROLE.005) |
| Invite setup completed by recipient | (recipient lands on UI-INVITE-SETUP, surface-00 — outside this surface) |

---

## Mobile

This is operator/admin tooling, primarily used on desktop. On narrow viewports the tab bar collapses to a
dropdown; the Users table collapses to stacked cards (name/email/role/status) with actions in a per-row overflow
menu; the **Permissions matrix is the one section that does not adapt** to a phone — below ~768 px it shows a
"This screen needs a wider display" notice with a read-only category list rather than a broken grid (editing the
matrix on a phone is out of scope). The detailed mobile dashboard treatment lives in `surface-12-mobile.md`.

---

## Open decisions

**All resolved 2026-06-30 (operator: "yes to all" — took all 4 recommendations).**

| # | Question | Resolution |
|---|---|---|
| OD-109 🟢 | One tabbed "Users & Access" surface, or six separate nav routes? | **(a)** One tabbed surface (Users/Roles/Permissions/Clearances/Reviews/Restricted) with per-tab PERM gating — the six are tightly coupled, share the same Super-Admin audience, and this mirrors surface-01's sectioned model. Admins (Users-only) just see one tab. |
| OD-110 🟢 | Matrix layout for ~37 nodes (thirteen categories) × 6+ roles? | **(a)** Category-grouped accordion — each category a node-row × role-column sub-grid with a sticky role header + node search. A flat grid is too wide to scan; grouping by the thirteen catalog categories (FR-1.PERM.007) keeps a node findable. The accordion is category-driven, not a fixed count — it renders one section per catalog category (now thirteen, not twelve), so no layout change is needed to accommodate the corrected count. |
| OD-111 🟢 | Clearance review (FR-1.CLR.005): own tab or inline badges? | **(a)** A separate "Reviews" tab surfacing due+overdue with an escalation banner — the escalate-don't-revoke posture is the surface's sharpest #3 expression and deserves a dedicated, countable queue (mirrors surface-00's overdue-pinning). |
| OD-112 🟢 | Reason mandatory on sensitive non-Restricted mutations (deactivate, role-delete, clearance-revoke)? | **(a)** Optional free-text reason, captured to `access_audit` when given; mandatory only for Restricted grants — keeps consistency with the locked OD-029 (audit every mutation; reason mandatory only for Restricted per FR-1.RST.002) while still capturing a why when provided. |

---

## Phase 4 data binding notes

- **`users`/profile** — `id` (pk), `email`, `name`, `active` (bool, default true — drives FR-1.USR.002 deactivation), `created_at`, `last_active_at` (nullable). RLS: readable with `PERM-user.*` view nodes; the `active` flag is the deactivation mechanism (revocation, not row delete). Index `(active)`.
- **`roles`** — `id`, `name`, `is_protected` (bool — Super Admin always true; others true-while-in-use per OD-025). **No `client_slug`** (ADR-001 §3 / OD-096).
- **`role_permissions`** — `(role_id, node)` grant rows (presence = granted; default-deny on absence). Index the policy-read columns (AF-067).
- **`user_roles`** — `(user_id, role_id)`; **one role per user (v1, OD-029)** — model as a unique constraint on `user_id`.
- **`sensitivity_clearances`** — `subject` (user or role), `tier` (Confidential/Personal — Standard is the implicit floor, Restricted is separate), `entity_type_scope` (`NULL`=Global, FR-1.CLR.004), `last_reviewed_at` (nullable — drives the Reviews tab cadence, FR-1.CLR.005). Index `(last_reviewed_at)` for the review query.
- **`restricted_grants`** — `granter`, `grantee` (named user — never a role), `reason` (**NOT NULL** — FR-1.RST.002), `scope` (nullable), `granted_at`, `revoked_at` (nullable; non-null = revoked, history retained). Index `(grantee, revoked_at)`.
- **`access_audit`** — append-only (FR-1.AUD.001/002): actor, action, target, before/after, reason (nullable except Restricted), timestamp. Immutable; C7 owns retention/export (FR-1.AUD.003). The activity drawer and per-tab history read from it.
- **`PERMISSION_NODES.md`** — build artifact (not a DB table); the Permissions matrix is generated from it (FR-1.PERM.005) and it seeds `role_permissions` defaults at provisioning.
- **Supabase-managed** (`auth.users`, `auth.mfa_factors`, invite tokens) — referenced, not defined by Phase 4.
- **No `client_slug`** on any table on this surface (ADR-001 §3 / OD-096 — isolation is by deployment).
