---
id: ISSUE-089
title: Render surface-02 user management (Users · Roles · Permissions matrix · Clearances · Reviews · Restricted)
epic: M — frontend
status: ready
github: "#89"
---
# ISSUE-089 — Render surface-02 (the access-control cockpit)

> **Self-sufficiency contract (read this first).** A *complete, precise build order that points into the repo by ID*;
> it does **not** restate `AC-*` text (read it in the surface spec + FR). A zero-context builder must build to the DoD
> from the Context manifest **without guessing.** Created session 80 by the [[OD-197]] `to-issues` render pass — the
> substrate `087` is done, so this surface's render layer is schedulable; the logic it renders is ISSUE-021 (`done`).

## 0. Context manifest (load only these)
- `spec/03-surfaces/surface-02-user-mgmt.md` — the surface being rendered (the six tabs + states + ACs).
- [[ISSUE-087]] — the `web/client` shell + RBAC nav gate + honest-state/a11y primitives + the typed seam. Consume, don't rebuild.
- [[ISSUE-021]] (`app/user-mgmt` — user management lifecycle + RBAC audit) + [[ISSUE-018]]/[[ISSUE-019]] (`app/rbac` — role model, `can()`, `PERMISSION_NODES.md`, the clearance model) — the backend logic this screen renders; already `done`.
- `spec/01-requirements/component-01-*` (C1) — the USR/ROLE/PERM/CLR/RST/AUD FRs. `spec/05-non-functional/` NFR-OBS.011 + NFR-A11Y.001.
- `app/rbac` — the `PERM-user.*` / `PERM-system.role_manage` nodes each tab gates on (the UI is not a second source of truth — AF-080 spirit).

## 1. Goal (one line)
Render surface-02 in **`web/client`** — the tabbed "Users & Access" cockpit (Users · Roles · Permissions matrix · Clearances · Reviews · Restricted) — consuming ISSUE-021/018/019's already-built logic through the `087` seam, with every tab RBAC-gated (absent-not-empty), the last-Super-Admin guard surfaced, and every list honest (a fetch failure is never a false-empty roster/matrix/review-queue — #3).

## 2. Scope — in / out
**In:** the render of the six tabs per the spec: **Users** (roster table + Invite + a per-user detail drawer with activity log) · **Roles** (list + New-role editor) · **Permissions** (the role×node matrix, 13 category-grouped accordions, optimistic-with-rollback on write failure) · **Clearances** (grant list) · **Reviews** (due+overdue queue + escalation banner) · **Restricted** (per-individual register, mandatory reason). Every state honest (#3): a roster fetch failure ≠ empty roster; matrix zero-nodes render "catalog failed to load", not an empty grid; a review-queue fetch failure never reads empty (which would hide overdue access). A reactivated user does **not** auto-regain above-Standard clearances/Restricted (must re-grant).
**Out:** the **user/role/clearance LOGIC** (ISSUE-021/018/019 — rendered, not built) · `clearance_review_cadence_days` **editing** (that's surface-01/#guardrails — this reads it) · the app shell/seam (087).

## 3. Implements (traceability spine — by ID, not restated)
- **Surface:** `surface-02` (UI-USER-MGMT). **FRs rendered:** FR-1.USR.001–005, FR-1.ROLE.001–005, FR-1.PERM.002/004/005/006/007, FR-1.CLR.001–005, FR-1.RST.001–003, FR-1.RLS.006, FR-1.AUD.001/002 + C0 invite FR-0.INV.001–003/006/007. **ACs:** AC-1.USR.002.2, AC-1.PERM.005.2, AC-1.ROLE.002.1, AC-1.RST.002.1/.2/.3 (+ the surface's section ACs).
- **NFRs:** NFR-OBS.011 · NFR-A11Y.001 · #2/#3.
- **Consumes (renders, owns none):** ISSUE-021/018/019 logic; the `087` shell + seam + primitives; the `PERM-user.*`/`PERM-system.role_manage` nodes.

## 4. Definition of done
- All six tabs render per `surface-02-user-mgmt.md`, each with its specified states.
- **RBAC absent-not-empty (load-bearing):** the surface + each tab is hidden and direct-URL-404s for a caller lacking the entry node (entry = any of `PERM-user.invite`/`.assign_role`/`.deactivate`); Roles+Permissions tabs need `PERM-system.role_manage` (Super Admin); Clearances/Reviews need `PERM-user.grant_clearance`; Restricted needs `PERM-user.grant_restricted` — all read from `app/rbac` (FR-1.PERM.006, no divergent second source).
- **#3 honesty:** a list fetch failure never renders empty; a failed invite shows "Send failed", never a silent success; the permission matrix renders "catalog failed to load" not an empty grid on a catalog-read failure; the review queue never reads empty on a fetch failure.
- **Last-Super-Admin guard surfaced:** a deactivate/role-change that would drop the last Super Admin is blocked with a visible reason (FR-1.ROLE.005).
- **Restricted reason mandatory** (OD-112); optional elsewhere; every grant/change → `access_audit`.
- **A11y + theming:** a11y baseline holds; light+dark render; the permission matrix renders a "needs a wider display" notice + read-only category list <768px (the one section that does not adapt).
- **Gating spikes:** none.

## 5. Touches (blast radius, by ID)
- **New:** `web/client` routes/components for the "Users & Access" tabs — from `@harness/web-shared`. **Consumes (no edits):** the `087` shell/seam/primitives; ISSUE-021/018/019; `app/rbac` nodes.
- **DATA:** read/write through the seam to ISSUE-021's store (users/roles/role_permissions/user_roles/sensitivity_clearances/restricted_grants/access_audit); reads `PERMISSION_NODES.md` catalog + the `clearance_review_cadence_days` CFG. **Mints no node, authors no migration.**

## 6. Evidence to capture (§10)
Component/UI-state tests (each tab happy + fetch-failure state); the RBAC-agreement test (tab visibility ≡ `can()` for allowed/denied); the matrix optimistic-rollback test; the last-Super-Admin-guard test; the honest-state tests (roster/matrix/review-queue fetch failure ≠ empty); an a11y audit; screenshots light+dark.

## 7. Blocked-by
- **`087`** ✅ done · **`021`** (user-mgmt logic) ✅ done · **`018`** (`can()`+catalog) ✅ done · **`019`** (clearance model) ✅ done.
- **Blocks:** the walking-skeleton milestone (the User-Management leg of auth→Ops→User-Management).

## 8. Build order within the slice
1. Users tab (roster + Invite + detail drawer) on the `087` seam to ISSUE-021.
2. Roles + Permissions matrix tabs (Super-Admin-gated; optimistic-with-rollback; matrix desktop-only notice <768px).
3. Clearances + Reviews (escalation banner) + Restricted (mandatory reason) tabs.
4. Wire the per-tab RBAC gate (absent-not-empty) + the last-Super-Admin guard surfacing; honest-state on every list.
5. A11y + theming pass; test to each §4 item.

## 9. Verification (how DoD is proven)
- **Component/UI-state layer** (+ the `preview` tooling): each tab renders its states; forced fetch failures render errors not empties; the matrix rollback + last-SA guard fire.
- **RBAC non-drift:** tab/section visibility reads `app/rbac`'s nodes and agrees with `can()` for allowed/denied (AF-080 spirit).
- **A11y:** the build-time a11y audit passes (NFR-A11Y.001).
