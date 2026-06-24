# Standard — RBAC & Row-Level Security (two-level authorization)

- **Status:** Binding
- **Source:** ADR-006 (the whole ADR — this standard is its operational form); design-doc
  `L397–403` (two-level checks), `L420` (default-deny), `L448–456` (clearances + audit),
  `L625–639` (`PERMISSION_NODES.md`), `L717–736` (RLS). Owed since ADR-006 Consequences; authored
  during Component 1.
- **Applies to:** every gated action, every permission node, and every table policy in the codebase.

## Why this exists

ADR-006 resolved *how* authorization works (data-driven RLS over live permission tables); this
standard makes the binding rules a developer follows so no component re-derives them. It is the
RBAC expression of the three non-negotiables: a mis-read permission **loses or leaks knowledge**
(#1), an over-broad grant **does something it shouldn't** (#2), and an unaudited access or a silent
denial **fails silently** (#3).

## The model in one paragraph

Permissions are **data**, not code. Roles, the permission matrix, clearances, and Restricted grants
are rows in `roles` / `role_permissions` / `user_roles` / `sensitivity_clearances` /
`restricted_grants`, edited from the dashboard with **no migration** (ADR-006 part 1). Two layers
read those rows and enforce: the **harness** (application code) owns the *full* permission matrix
and is the *primary* gate; **RLS** (the database) independently owns the *row-access subset*
(visibility + sensitivity + Restricted) as the backstop. Both derive from the same rows, so they
cannot drift. A third, *advisory* layer — the AI's prompt-level scope — is never sufficient alone.

## The binding rules

1. **Default-deny, everywhere.** A permission node not explicitly granted is denied. A newly added
   node is denied for everyone until a Super Admin grants it. A new table is denied until a policy
   allows it. Absence is never an implicit allow. (`L420`)

2. **One `can(user, node, context)` check.** Every gated action — route handler, agent tool call,
   chat command, dashboard control — converges on the single harness check that reads the live
   permission tables. Permission logic lives in exactly one place. The harness is *primary*: a
   failed `can()` blocks the action **regardless of what the prompt says** (`L399`). The prompt-level
   scope is advisory only and never authorizes on its own (`L401–403`).

3. **`PERMISSION_NODES.md` is the build-time source of truth.** Every time a new gate is added,
   add its node to `PERMISSION_NODES.md` **immediately**, with: `Description`, `Default roles`,
   `Scope` (entity type / domain, if any), `Added in` (feature/PR). At build end this file drives the
   permission-matrix admin dashboard — every node a configurable (role × node) toggle, **no code
   change to adjust permissions** (`L629–639`). A gate whose node is missing from the file is a
   defect: it would be invisible and un-configurable (a silent #3). A CI check should flag gates
   whose node is absent.

4. **RLS policies are static, generic, and data-driven — they never name a role.** Each policy reads
   the acting user's *current* effective permissions **live** via `STABLE SECURITY DEFINER` helper
   functions keyed on `auth.uid()`. Editing a role is a row write; the same policy evaluates
   differently next query because the *data* changed. (ADR-006 part 2)

5. **Wrap helper calls in `(select …)` — non-negotiable for performance.** A helper called bare in a
   policy re-evaluates **per row**; wrapped as `(select user_clearances(auth.uid()))` it evaluates
   **once per statement** (the initPlan). The Supabase benchmark is **178,000 ms → 12 ms**. Also:
   index every column a policy filters on, scope policies `TO authenticated`, and keep the
   `auth_rls_initplan` advisor lint clean. (AF-067; `STABLE` alone is **not** enough.)

6. **RLS owns only the row-access subset, intra-client.** RLS enforces **visibility + sensitivity
   clearance + Restricted** on sensitive tables — nothing else. It contains **no** `client_slug` /
   cross-deployment predicate: client isolation is **physical** (one Supabase per client, ADR-001).
   Every other table still gets the **default-deny baseline** policy (authenticated + `aal2` where
   protected); "every table has RLS" ≠ "every table checks sensitivity." (ADR-006 parts 4–5)

7. **RLS guards the human path; the agent path bypasses it by design.** Authenticated end-user
   (dashboard / chat-as-user) queries are subject to RLS. The Memory Agent (sole writer, ADR-004)
   and backend jobs run as **`service_role`**, which **bypasses RLS** and has no `auth.uid()`. Their
   safety rests on harness RBAC + the sole-writer invariant. **No requirement may assume RLS guards a
   service-role write.** (ADR-006 part 6)

8. **Every change is instant.** Because nothing is cached on the JWT (it carries identity, not a
   permission snapshot), grants **and** revocations take effect on the user's **next query** — no
   re-login, no forced logout, no propagation window, no grant-vs-revoke split rule. (ADR-006 part 3)

9. **Clearances are explicit, scoped, and reviewed.** Every clearance above Standard is **explicitly
   granted by a Super Admin, never inherited** (`L448`), and is **scoped by entity type** (`L450`).
   Clearances are reviewed on a configurable cadence (`L454`); an un-actioned overdue review is
   **escalated, never auto-revoked and never silently retained** (OD-028).

10. **Restricted is per-named-individual, always logged, never auto-injected.** Restricted access is
    granted to a person, **not a role** — no role (including Super Admin) holds Restricted as a
    default (`L452`/`L620` govern over `L438`). Every grant records **who/when/why** (a reason is
    mandatory). Restricted content is **never injected automatically** (`L433`); it surfaces only via
    an explicit, audited access.

11. **Audit completeness across both paths.** Every Personal/Restricted **read, write, or injection**
    — human *and* `service_role`/agent — produces a permanent, immutable audit record (`L456`). Every
    RBAC mutation (role edit, matrix toggle, clearance, Restricted grant, role assignment,
    deactivation, 2FA reset) is audited with actor / target / before-after / time. A gap is a silent
    #1/#3 failure. (Storage/retention/export are owned by C7 / Phase 5; the *completeness + content*
    requirement is owned by RBAC.)

12. **No lockout.** The "one Super Admin minimum" (`L474`) is enforced: the last remaining Super Admin
    cannot be deactivated, role-changed, or have the Super Admin role deleted — guarded atomically
    (ADR-004 pattern) against concurrent removals.

## The two-vs-three-layer picture (so nothing is double-counted)

| Layer | Owns | Authoritative? |
|---|---|---|
| **Prompt scope** | telling the AI its limits | **No** — advisory only, never sufficient (`L401–403`) |
| **Harness `can()`** | the *full* permission matrix (tool risk, dashboard, agent invocation, approval, system/user/asset functions, **plus** visibility/sensitivity before ranking) | **Yes** — primary gate |
| **RLS** | the *row-access subset* (visibility + sensitivity + Restricted) on sensitive tables; default-deny baseline on all tables | **Yes** — independent DB backstop |

The harness and RLS are the two load-bearing layers; both read the same permission tables. The
"controls before gates" rule (ADR-003) applies: clearance + visibility are enforced **before** any
memory ranking/injection (`L464`, `L1725`), never after.

## Feasibility hooks

- **AF-067** — the live data-driven RLS lookup performs on the hot retrieval path (the `(select …)`
  initPlan composing with pgvector ranking). The D2 JWT-cache (OOS-012) is the documented fallback.
- **AF-076** — the deployment-wide `aal2` predicate has **complete** coverage (no protected table
  reachable at `aal1`).
- **AF-079** — **every** table ships with RLS enabled + a policy (CI/lint gate).
- **AF-080** — the harness `can()` and the RLS helpers **agree** (differential test; they read the
  same rows, so any divergence is a bug).
