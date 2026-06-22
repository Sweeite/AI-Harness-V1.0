# ADR-001 — Isolation Model

- **Status:** Accepted
- **Date decided:** 2026-06-22
- **Resolves:** OD-001
- **Affects:** Data model (all tables), RLS (ADR-006), deploy/provisioning (ADR-005), cost model (ADR-003), Super Admin management plane, secrets handling (NFR-SEC), components 1/2/7/10

## Context

The design doc describes a **Silo** architecture (each client gets a physically isolated
Supabase project + Railway service; "nothing is shared between clients") but its schema and
RLS use **Pooled** multi-tenant mechanisms (`client_slug` on several tables; RLS "where
client_slug matches… to prevent cross-deployment access"). The two are mutually exclusive,
and `memories`/`entities` lack `client_slug` while other tables have it. The `client_slug`
pattern was introduced to serve the agency-monitoring tool (seeing all of the operator's
clients at once) — a real need solved with the wrong mechanism for an isolated architecture.

"Client" throughout = a customer of the operator's agency (Transpera AI). Confirmed: no
deployment ever holds more than one client's data; sub-brands of a client are modelled as
entities *within* that client's deployment.

## Decision

**Silo — one isolated deployment per client — with a hybrid account-ownership model.**

1. **Isolation:** Each client gets a physically separate Supabase project. Client data
   never shares a database with another client. "Physically separate" is a hard product
   promise (compliance + sales), not a nice-to-have.

2. **Single codebase, N runtimes:** One git repo, one set of migration *files*, deployed as
   identical code to N runtimes. Per-client variation lives only in (a) env config
   (`DEPLOYMENT_CONFIG` + secrets) and (b) the `/plugins` folder. No per-client code forks.

3. **Data model consequence — `client_slug` is deleted from all application tables.** Inside
   a client's database there is only one client, so there is nothing to filter against.
   Client identity exists in exactly one place: the `client_registry` table in the operator's
   separate Super Admin **management deployment**.

4. **RLS consequence:** Inside a client DB, RLS enforces only **role / visibility /
   sensitivity** — never client separation. (Detailed model: ADR-006.)

5. **Account ownership — hybrid (moat-protecting):**
   - **Client owns** the data + cost-bearing accounts on **their card**: Supabase,
     Anthropic & OpenAI API keys, and their own connector SaaS (GHL, Google, Slack).
   - **Operator owns** the **compute layer (Railway)** in the operator's own account, so the
     codebase (the moat/IP) never sits inside a client's account.
   - The app runs on the operator's Railway, connecting to the client's Supabase using the
     client's keys (held as secrets in the operator's Railway).
   - *Exception:* a client may own compute too if they insist; documented as a per-client
     exception, not the default.

6. **Deploy mechanism:** Each client's Railway project connects to the one shared GitHub
   repo and **auto-deploys on push to main** (Railway native GitHub integration); migrations
   run per-deployment against that deployment's Supabase on release. No custom fan-out CI is
   required. (Detail + provisioning: ADR-005.)

7. **Super Admin management plane:**
   - Runs as its own deployment in the operator's account; holds `client_registry` only.
   - **Boundary rule (hard):** only *operational metadata* may cross from a client
     deployment to the management plane — health score, queue depth, alert counts, core
     version, connector status, cost-to-date. **No client business data ever crosses** (no
     memories, entity content, message text, sensitive data). If the management plane were
     fully compromised, it would reveal operational status and nothing about any client's
     business.
   - "Look inside a client" = click through and **log into that client's own dashboard**,
     where their RBAC applies. The management plane is a map, not a warehouse.
   - **Push, not pull:** each client deployment posts a health snapshot to the management
     plane on an interval + on significant events; the Super Admin dashboard reads from the
     management DB (fast; shows "last reported X ago" if a deployment goes dark).

## Consequences

**Becomes required (new requirements to write):**
- Remove `client_slug` from every application table; relocate client identity to
  `client_registry` in the management plane.
- A per-deployment outbound "health reporter" job (pushes operational-metadata snapshots).
- Management-plane ingest endpoint with per-deployment auth (each deployment authenticates
  *to* the management plane) → NFR-SEC.
- Operator's Railway securely stores each client's Supabase service key + API keys → NFR-SEC
  (secrets custody).
- Provisioning runbook/automation: client creates accounts + adds card + grants operator dev
  access; operator connects their Railway to the repo and provisions → ADR-005.

**Simplifications gained:**
- **Cost tracking is no longer invoice-grade for the operator** — vendors bill the client
  directly. Cost dashboards remain for client visibility + spend management, but the operator
  does not meter-and-rebill opex. (Note for ADR-003.)
- Offboarding becomes provably clean: deprovision the client's Supabase project = airtight
  deletion evidence (strengthens component 10 / Scenario 3).
- Per-client data residency is trivially possible later (each client owns their Supabase);
  v1 default region stays Sydney (ap-southeast-2).

**Ruled out:**
- Pooled multi-tenant (shared DB + `client_slug` RLS). Kept only as a documented fallback if
  the operator ever pivots to many tiny, price-sensitive clients.
- Custom CI pipeline pushing code into N accounts (Railway GitHub integration replaces it).
- Operator fronting client operating costs (client's card is on the vendors directly).

**Business model context (for the whole spec):** Operator (Transpera AI) charges a retainer
for building + managing; the **client pays all operating costs** (Supabase, API, connector
SaaS) on their own card. Operator absorbs/flat-bills only the small Railway compute cost.
Scale: ~5 clients year one, ~20 year two — ADR-005 provisioning automation should be in place
before client #3–5.

**Spawns / informs:** ADR-003 (cost model — now client-borne, visibility-grade not
invoice-grade), ADR-005 (provisioning + Railway GitHub deploy + per-client account setup),
ADR-006 (RLS now intra-client only), NFR-SEC (secrets custody + management-plane push auth).
