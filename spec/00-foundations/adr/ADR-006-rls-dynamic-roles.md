# ADR-006 — Dynamic Roles vs Static RLS

- **Status:** Accepted
- **Date decided:** 2026-06-23
- **Resolves:** OD-006
- **Affects:** Data model (the permission tables + RLS policies on every table), RBAC standard,
  the harness permission-check layer, memory read/retrieval path (ADR-002/003), Super Admin
  role-management UI, the auth flow (ADR-001 / Supabase Auth), components 0/1 (Login/onboarding),
  2 (Memory), 7 (Guardrails/RBAC). New feasibility AF-067. Builds directly on **ADR-001**
  (Silo isolation → RLS is intra-client only; `client_slug` deleted) and **ADR-004** (the Memory
  Agent is the sole writer, running as the service role).

## Context

The design doc promises two things that pull against each other:

1. **Roles are fully editable at runtime.** Roles are "created, edited, and deleted from the
   dashboard" by the Super Admin (`L407–409`); six ship by default but "all are editable. Custom
   roles can be added. Roles can be removed if unused" (`L471`). The permission matrix is
   explicitly *not* finalised in code — `PERMISSION_NODES.md` becomes "the source of truth for
   building the permission matrix admin dashboard … **No code change required to adjust
   permissions**" (`L639`). Sensitivity clearances are likewise granted/revoked from the dashboard
   and reviewed on a cadence (`L448–454`).

2. **Every table is guarded by RLS at the database.** "Every database table has RLS policies that
   restrict what a logged-in user can read and write based on their role … even if application
   code bypasses the harness checks, the database enforces them" (`L717–736`).

The collision (OD-006): **RLS policies are SQL authored at migration time; roles are data edited at
runtime.** The naive implementation — one hardcoded policy per role (`… WHERE role = 'Finance'`) —
means every dashboard role edit or new custom role needs a migration, which directly breaks the
"no code change required" promise (`L471`, `L639`). The doc never reconciles this. "Data-driven RLS"
(policies that evaluate against permission *data*) is the obvious escape, but the doc flags it as
"much harder/slower" — so the open question is the *shape* of the data-driven model and whether it
performs.

**Two reconciliations ADR-001 already forced** (stated here so nothing downstream re-reads stale
doc text):

- **RLS is intra-client only.** The doc's example policy still checks `client_slug` for
  "cross-deployment data access" (`L724`). ADR-001 §3 **deleted `client_slug` from every
  application table** — there is only one client inside a deployment's database. So the
  cross-deployment clause is **gone**: isolation between clients is *physical* (one Supabase project
  per client), never an RLS predicate. RLS enforces only **role / visibility / sensitivity** (ADR-001
  §4).
- **RLS guards the *user-session* path; the backend bypasses it by design.** The Memory Agent — the
  **sole writer** (ADR-004) — and other backend jobs connect with the `SUPABASE_SERVICE_ROLE_KEY`
  (`L1055`), which **bypasses RLS**. So RLS is the backstop for *authenticated end-user* queries
  (the dashboard, chat acting as a user); **agent/backend writes are governed by harness RBAC + the
  ADR-004 sole-writer invariant, not by RLS.** This is intended defense-in-depth for the human path,
  not a guard on the agent path.

Scope note: RLS only governs **row reads/writes**. The full permission matrix (`L508–616`) is mostly
*action* authorization (tool risk, dashboard visibility, agent invocation, approval authority, system
functions) — not row access. Deciding what RLS owns vs what the harness owns is part of this ADR.

## Options considered

### Axis 1 — How RLS reconciles editable roles with migration-time policies

**D1 — One static policy per role (hardcoded role names).** `CREATE POLICY … USING (role = 'Finance'
AND …)`. Pros: simplest SQL, fastest reads. Cons: **every** dashboard role edit or new custom role
requires a migration + redeploy — the exact thing `L471`/`L639` forbid. **Rejected** — breaks the
runtime-editable-roles promise outright.

**D2 — Data-driven policies that read a *cached snapshot on the JWT*.** Denormalise each user's
effective permissions into custom JWT claims (via a Supabase `custom_access_token_hook`) at
login/refresh; policies read `auth.jwt() -> claims`. Pros: very fast reads (no lookup, just compare to
a claim). Cons: the token is a **snapshot** with a 1-hour TTL (`L698`) — a permission change doesn't
take effect until the token re-mints, creating a stale-access window and a whole grant-vs-revoke
propagation problem (do we force-logout on revoke? re-mint on grant?). Adds an auth-hook to build and
verify, plus forced-revocation machinery. **Rejected** — the caching buys speed we don't need at our
scale and imports a staleness problem we'd then have to engineer around.

**D3 — Data-driven policies that read permissions *live* from the tables (chosen).** Permissions live
in tables; RLS policies are **static and generic** (they never name a role) and look up the *current*
acting user's effective permissions **live** each query via `STABLE SECURITY DEFINER` helper functions
keyed on `auth.uid()`. Editing a role = a row write; the same static policy instantly evaluates
differently because the data changed. Pros: **roles stay fully editable with zero migrations**; one
source of truth (the tables), always current, so **every change — grant or revoke — takes effect
instantly** with no token-snapshot, no staleness window, no propagation rule, no forced-logout
machinery. Cons: a per-query permission lookup costs a beat more than reading a JWT claim — a
performance question on the hot retrieval path (Axis 3). **Chosen** — at ADR-001's scale (one client,
≤20 users, ~6 roles) the lookup is over a one-page, fully-indexed table, evaluated once per statement
(not per row), so the cost is negligible and it deletes an entire class of stale-permission bugs.

### Axis 2 — Division of labor between RLS and harness RBAC

The doc mandates **both** levels and says they must agree (`L397–403`, `L719`). The boundary:

- **RLS (DB) owns the row-data-access subset:** **visibility** tier + **sensitivity** clearance +
  **Restricted** per-named-individual grants, on memory and other sensitive tables. This is exactly
  the `L722–732` check (minus the deleted `client_slug` clause). It is the backstop that holds even
  if harness code has a bug.
- **Harness (application code) owns the full matrix:** tool risk levels, dashboard/view gating, agent
  invocation, approval authority, system/asset/user-management functions (`L508–616`) — none of which
  are row reads — **plus** the same visibility/sensitivity checks (defense in depth, applied *before*
  ranking/injection per `L464`).
- **Single source of truth = the permission tables.** Both readers (RLS helper functions and the
  harness) derive from the same rows, so they cannot drift, and both stay editable at runtime.

### Axis 3 — Does the live lookup perform on the hot path?

The only real cost of D3. RLS runs on every query, and the **memory retrieval path** (ADR-002/003)
pulls/ranks **many** memory rows per query (vector search), so the permission predicate must compose
with pgvector ranking without tanking latency. At our scale the helper-function result is computed
**once per statement** (`STABLE`) over tiny indexed tables, then applied as a filter — very likely
fine, but it is the one thing that is paper-until-proven → **AF-067**. (Escape hatch if it ever
fails at scale: the D2 JWT-cache is the documented fallback optimisation — see OOS.)

## Decision

Adopt **D3 + the Axis-2 split**. Six binding parts:

**1. Permissions live in data, edited from the dashboard.** Roles, the permission matrix,
clearances, and Restricted grants are **rows**, not code: `roles`, `role_permissions` (permission-node
→ role), `user_roles`, `sensitivity_clearances` (role/user × sensitivity × **entity-type scope**, per
`L450`), `restricted_grants` (per-named-individual, fully audited per `L452`/`L456`). Editing any of
these is a data write — **no migration, no redeploy** (`L471`, `L639`). Default-deny: a permission
node not explicitly granted is denied (`L420`).

**2. RLS policies are static and data-driven — they never name a role.** Each table's policy reads
the acting user's **current** effective permissions **live** via `STABLE SECURITY DEFINER` helper
functions keyed on `auth.uid()` (e.g. `user_clearances(auth.uid())`, `user_visibility(auth.uid())`).
The policy SQL is authored once at migration time and never changes when roles change; only the data
it reads changes.

**3. Every permission change is instant.** Because nothing is cached on the token, grants **and**
revocations (clearance pulled, role removed/downgraded, Restricted revoked, user deactivated) take
effect on the **next query** — no stale-access window, no grant-vs-revoke propagation rule, no forced
re-login. Supabase Auth continues to own login/OAuth/session/JWT (ADR-001, `L643–715`); the JWT
carries **identity** (`auth.uid()`), **not** a permission snapshot.

**4. RLS is intra-client only.** Policies enforce **visibility + sensitivity + Restricted** and
**never** client separation — the `client_slug` clause from the doc's example (`L724`) is **deleted**
(ADR-001 §3/§4). Cross-client isolation is physical (one Supabase per client).

**5. Division of labor (both levels, one source of truth).** The **harness** enforces the full
permission matrix in application code *before* acting (`L399`, and before ranking/injection per
`L464`); **RLS** independently enforces the visibility/sensitivity/Restricted row-access subset at the
DB as the backstop (`L719`). Both read the same permission tables; they cannot disagree.

**6. RLS guards the human path; the agent path is guarded by the harness.** Authenticated end-user
queries (dashboard, chat-as-user) are subject to RLS. The Memory Agent (sole writer, ADR-004) and
backend jobs run as the **service role**, which **bypasses RLS** by design — their correctness rests
on harness RBAC + the ADR-004 sole-writer invariant. No requirement may assume RLS guards a
service-role write.

## Consequences

**Becomes true / required (new requirements to write):**
- **Data-model FRs (component 2 + a new auth/RBAC schema slice):** the permission tables —
  `roles`, `role_permissions`, `user_roles`, `sensitivity_clearances` (with entity-type scope),
  `restricted_grants` (audited) — plus the `STABLE SECURITY DEFINER` helper functions and a generic
  RLS policy on every table. The audit table for all Personal/Restricted access (`L456`).
- **RBAC standard (`standards/rbac.md`, new — does not yet exist):** codify the two-level model, the
  default-deny rule, the RLS-vs-harness division (part 5), the service-role-bypass caveat (part 6),
  entity-type-scoped clearance, and the `PERMISSION_NODES.md` build-time convention (`L625–639`).
- **Super Admin UI (component 7/Surfaces):** the permission-matrix admin dashboard — every node ×
  every role with a toggle (`L639`); clearance grant/revoke + the cadence review (`L454`); Restricted
  per-individual grant flow with mandatory who/when/why log (`L452`).
- **Harness permission layer:** a single `can(user, node, context)` check used everywhere an action
  is gated, reading the permission tables; the same clearance/visibility check applied before memory
  ranking/injection (`L464`).
- **Config registry:** clearance-review cadence; (confirm) access-token TTL stays Supabase's 1h
  (`L698`) — no longer load-bearing for permission propagation under D3.

**Ruled out:** hardcoded one-policy-per-role RLS (D1, breaks editable roles); JWT-cached permission
claims as the v1 mechanism (D2, imports a staleness/propagation problem we don't need at this scale —
retained only as a documented future optimisation, see OOS); any `client_slug`/cross-client predicate
in RLS (deleted by ADR-001); assuming RLS guards service-role/agent writes (it does not).

**Feasibility (paper until proven):**
- **AF-067 (SPIKE+LOAD):** **live data-driven RLS performs on the hot retrieval path** — the
  `STABLE` helper-function permission lookup, evaluated once per statement over the (tiny, indexed)
  permission tables, composes with pgvector ranking of a large memory batch without unacceptable
  latency. The whole D3 choice rests on this; if it ever fails at scale, the D2 JWT-cache is the
  documented fallback.

**Spawns:** no new OD. New binding standard `standards/rbac.md` (the two-level RBAC + RLS model). New
OOS entry: JWT-cached permission claims deferred as a future optimisation (the D2 fallback). Glossary
gains: *Data-driven RLS*, *Permission tables*, *Restricted grant*, *Service-role bypass*,
*Entity-type-scoped clearance*. Cross-reference when components 0/1 (Login/onboarding), 2 (Memory),
and 7 (RBAC/Guardrails) are specced.
