---
id: ISSUE-009
title: RLS scaffold — helpers, default-deny baseline, 100% coverage CI gate
epic: A — foundations
status: ready
github: "#9"
---

# ISSUE-009 — RLS scaffold — helpers, default-deny baseline, 100% coverage CI gate

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Stand up the ADR-006 RLS substrate — the `(select …)`-wrapped permission-lookup helper functions,
a default-deny baseline policy on **every** application table, the instant-propagation guarantee, and
the CI coverage/initPlan lint gates — so every downstream table and enforcement slice inherits a
guarded, data-driven, no-migration-to-edit foundation.

## 2. Scope — in / out
**In:** The RLS *scaffold*, not its sensitivity predicates. Concretely: (a) the four
`SECURITY DEFINER STABLE` helper functions (`user_perms`, `user_clearances`, `user_restricted`,
`user_aal`) with `search_path` pinning, each invoked only via the `(select helper(auth.uid()))`
scalar-subquery wrapper that forces a once-per-statement initPlan; (b) a **default-deny baseline
policy** (`TO authenticated`, intra-client, RLS enabled) on every application table so no table is
reachable without an explicit policy decision (FR-1.RLS.001); (c) the **human-path vs
`service_role`-path** connection split (FR-1.RLS.004) — user JWT → RLS applies, `service_role` →
RLS bypassed; (d) the **instant-propagation** property (FR-1.RLS.006) — permissions read live from
the tables, nothing cached on the JWT, so a grant/revoke row-write takes effect on the next query;
(e) the two **CI gates** that make the scaffold self-policing: the `auth_rls_initplan` advisor lint
(every helper call wrapped, every policy-referenced column indexed, policies scoped
`TO authenticated`) and the **table-coverage lint** that fails the build if any `public`-schema table
ships without RLS enabled + ≥1 policy.

**Out:** The *sensitivity* row-access predicates that compose ON TOP of the baseline —
visibility ∩ sensitivity ∩ Restricted, the `aal2` clause, mid-task revocation re-check, and the
harness/RLS divergence signal (FR-1.RLS.002 full predicate composition, .003, .005, .007, .008) are
**ISSUE-020**. The permission tables' DDL and the append-only immutability trigger are **ISSUE-008**
(migration 0001 baseline). The harness `can()` gate is **ISSUE-018**. The clearance/Restricted data
model + grant flows are **ISSUE-019**. This slice authors the *generic* policy shape and the helper
contracts those slices then specialise; it does **not** author any per-table sensitivity cell.

> **Integration note (bundled FRs).** FR-1.RLS.001/004/006 are one coherent unit: the default-deny
> baseline (001) is only meaningful once the two connection identities are distinguished (004 — RLS
> guards the human path, `service_role` bypasses), and the "no migration to edit, instant on next
> query" promise (006) is exactly what the live helper lookup delivers. The helper functions are the
> shared mechanism all three rest on; their full clearance/visibility *predicate* is ISSUE-020's, but
> their **contract + initPlan wrapping rule** (FR-1.RLS.002, AF-067) must be built here because the
> baseline policies and the initPlan lint reference them. Build the helpers as the composable
> primitive; ISSUE-020 extends the same static policies with the sensitivity cells with no re-author.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-1.RLS.001, FR-1.RLS.004, FR-1.RLS.006 (Component 1 — RBAC); FR-1.RLS.002 (Component 1
  — helper-function contract + `(select …)` initPlan rule; co-built here as the primitive, full
  sensitivity-predicate composition owned by ISSUE-020).
- **NFRs:** NFR-PERF.001 (RLS on the hot retrieval path — the initPlan overhead budget); NFR-SEC.010
  (complete aal2 + RLS coverage — the 100%-table CI gate; the aal2 half is ISSUE-020, the
  coverage/default-deny half is this slice).
- **Rests on:** ADR-006 (parts 1/2/3/6 — permissions-in-data, static data-driven policies, instant
  change, human-path-RLS/agent-path-service_role); AF-067 (initPlan hot-path perf); AF-079 (RLS
  coverage completeness CI/lint gate).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-1.RLS.001.1 (every table has RLS enabled + ≥1 default-deny policy)
- AC-1.RLS.002.1, AC-1.RLS.002.2 (role edit re-evaluates the same static policy with no migration;
  `auth_rls_initplan` lint clean)
- AC-1.RLS.004.1, AC-1.RLS.004.2 (`service_role` bypasses RLS; user-session query is RLS-constrained)
- AC-1.RLS.006.1 (revoke takes effect on the user's next query — no re-login)
- AC-NFR-PERF.001.1, AC-NFR-PERF.001.2 (initPlan overhead within budget + evaluated once per
  statement; `auth_rls_initplan` advisor lint passes in CI)
- AC-NFR-SEC.010.1 (coverage check fails the build if any table lacks a policy)
- **Gating spikes (if any):** AF-067 (SPIKE+LOAD — live data-driven RLS initPlan latency on the hot
  path) must be **GREEN** before this issue ships — this is the ISSUE-002 launch-gating spike
  (blocked-by, per OD-157/RP-1; feasibility-register block G — **🟢 PASS 2026-07-04** via ISSUE-002, so
  this gate is already GREEN: initPlan 1.06 ms/stmt, once-per-statement, lint PASS). AF-079 (RLS coverage
  completeness) is the CI/lint gate this slice **builds**; its proof rides on the gate passing.

## 5. Touches (complete blast radius, by ID)
- **DATA:** helper functions `user_perms`, `user_clearances`, `user_restricted`, `user_aal`
  (rls-policies.md §Helper functions) — reading `DATA-roles`, `DATA-role_permissions`,
  `DATA-user_roles`, `DATA-sensitivity_clearances`, `DATA-restricted_grants`; the generic
  default-deny policy attached to **every** application table (schema.md §2 and all sections). No
  table DDL is created here (ISSUE-008 owns migration 0001); this slice attaches policies + helpers.
- **PERM:** none authored here — the baseline policy is presence/absence of a `role_permissions`
  grant (default-deny); the specific `PERM-*` nodes are consumed by ISSUE-018/019/020 predicates.
- **CFG:** none (ADR-006 part 3: permission propagation is no longer token-TTL-bound; the JWT carries
  identity only).
- **UI:** none (DB/CI-layer slice, no surface).
- **Connectors:** none.

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-01-rbac.md — FR-1.RLS.001/002/004/006 text + their ACs (the RLS area)
- spec/04-data-model/rls-policies.md — the model (5 rules), the four helper-function contracts, the
  per-table policy summary, and the `(select …)` initPlan wrapping rule
- spec/04-data-model/schema.md §2 (RBAC & Access) — `roles`/`role_permissions`/`user_roles`/
  `sensitivity_clearances`/`restricted_grants`/`access_audit` the helpers read (DDL landed by ISSUE-008)
- spec/05-non-functional/performance.md — NFR-PERF.001 (initPlan hot-path budget + the lint AC)
- spec/05-non-functional/security.md — NFR-SEC.010 (100% coverage CI gate + aal2 duty)
- spec/00-foundations/adr/ADR-006-rls-dynamic-roles.md — the spine (D3 chosen; six binding parts)

## 7. Dependencies
- **Blocked-by:** ISSUE-008 (migration harness + 0001 baseline — the permission tables the helpers
  read must exist first); ISSUE-002 (SPIKE — RLS hot-path latency; proves **AF-067** GREEN before
  this scaffold ships, per OD-157).
- **Blocks:** ISSUE-013, ISSUE-014, ISSUE-015, ISSUE-018, ISSUE-020 (every identity/access slice
  reads through these helpers and inherits the default-deny baseline + coverage gate).

## 8. Build order within the slice
1. **Helper functions** — author `user_perms`, `user_clearances`, `user_restricted`, `user_aal` as
   `SECURITY DEFINER STABLE` with pinned `search_path`, reading the ISSUE-008 permission tables
   (rls-policies.md §Helper functions). These are the shared primitive for everything below.
2. **Default-deny baseline policy** — a generic policy scoped `TO authenticated`, RLS **enabled** on
   every application table, no cross-client (`client_slug`) predicate (ADR-006 part 4). Non-sensitive
   tables get only this baseline; sensitive tables' extra cells are ISSUE-020 (FR-1.RLS.001).
3. **Human/service_role split** — confirm user-JWT connections are RLS-subject and `service_role`
   connections bypass; document that no requirement may assume RLS guards a `service_role` write
   (FR-1.RLS.004).
4. **initPlan wrapping** — every helper call in every policy wrapped as `(select helper(auth.uid()))`;
   index every policy-referenced column (per indexes.md, landed by ISSUE-008) (FR-1.RLS.002, AF-067).
5. **Instant-propagation check** — verify a `role_permissions`/clearance row-write re-evaluates the
   same static policy on the next query with no migration and no re-login (FR-1.RLS.006).
6. **CI gates** — wire the `auth_rls_initplan` advisor lint (0003) AND the table-coverage lint that
   fails the build when any `public` table lacks RLS + ≥1 policy (AF-079 / NFR-SEC.010).
7. **Tests to the ACs** — the DoD list above, including the AF-067 latency measurement (ISSUE-002).

## 9. Verification (how DoD is proven)
- **Migration/DB-integration layer** (per spec/05-non-functional/test-strategy.md): a table-coverage
  test asserting every `public`-schema table has RLS enabled + ≥1 policy (AC-1.RLS.001.1 /
  AC-NFR-SEC.010.1); an initPlan test asserting helper calls are `(select …)`-wrapped and evaluated
  once per statement (AC-1.RLS.002.2 / AC-NFR-PERF.001.2); a role-edit test (AC-1.RLS.002.1) and a
  revoke-takes-effect-next-query test (AC-1.RLS.006.1); a two-identity test proving `service_role`
  bypasses and user-session applies (AC-1.RLS.004.1/.2).
- **CI gate:** the `auth_rls_initplan` advisor lint and the coverage lint run on every migration; a
  table added without a policy fails the build (AC-NFR-SEC.010.1 / AF-079).
- **AC-NFR-PERF.001.1** posture: the initPlan overhead budget is confirmed by the **AF-067** LOAD
  spike (ISSUE-002) — it must be GREEN before ship; the D2 JWT-cache fallback (OOS-012) is the
  documented escape if it fails at scale. This is the blocking `AC → Verified` path for the slice.
