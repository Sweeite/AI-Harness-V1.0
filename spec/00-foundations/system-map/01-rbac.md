# Zoom-in: C1 RBAC — "what you may do / see"

This opens up the **authorization layer** that sits right behind C0's front door. C0 hands forward
`auth.uid()`; C1 answers *what that identity may do and which rows it may touch*. It is the spec home
of **ADR-006** (data-driven RLS) and reflects the C1 resolutions (OD-024…OD-031). Where this map and a
requirement disagree, the requirement wins and this map updates (change control).

**Scope:** roles · the permission matrix · sensitivity clearances · Restricted grants · the RLS layer ·
the post-invite user lifecycle · the access audit. **Seams out:** invite/seed/session → **C0**; memory
tier-tagging + retrieval mechanism → **C2**; tool/agent/asset/system action *behaviour* → their own
components (C1 only *catalogs + gates* them); audit storage/retention/export → **C7**; the mid-task
abort/quarantine *mechanism* + compensation → **C5/C6/C8** (+ OD-010).

## The three enforcement layers (only two are load-bearing)

```
  a request to act / read
        │
  ┌─────┴─────────────────────────────────────────────────────────┐
  │ 1. PROMPT scope   advisory only — never sufficient (L401-403)  │   not authoritative
  ├───────────────────────────────────────────────────────────────┤
  │ 2. HARNESS can(user,node,context)   PRIMARY gate, in code      │ ◄─┐ both read the
  │    full matrix; default-deny; blocks regardless of the prompt  │   │ SAME permission
  ├───────────────────────────────────────────────────────────────┤   │ tables → cannot
  │ 3. RLS (DB)   independent backstop for the ROW-ACCESS subset    │ ◄─┘ drift (AF-080)
  │    visibility + sensitivity + Restricted; default-deny          │
  └───────────────────────────────────────────────────────────────┘
        │
   allowed only if the authoritative layers (2 + 3) agree
```
- **Harness is primary** (FR-1.PERM.001/003): a failed `can()` blocks the action no matter what a prompt
  says — this is ADR-007 containment (a successful injection is *contained*, not relied-on to be caught).
- **RLS is the backstop** (FR-1.RLS.001/003): holds even if harness code has a bug. Owns only the
  row-access subset; **no `client_slug`** (isolation is physical, ADR-001).

## Permissions are DATA, not code (the ADR-006 spine)

```
  roles · role_permissions · user_roles · sensitivity_clearances · restricted_grants   ← editable ROWS
        │                                                                                  (no migration)
  edit a role / toggle a (role,node) / grant a clearance  =  a row write
        │
  RLS policies are STATIC + GENERIC (never name a role); read current permissions LIVE via
  (select user_clearances(auth.uid()))  ← once-per-statement initPlan, NOT per-row  [AF-067]
        │
  ⇒ every change — grant AND revoke — is INSTANT on the next query (FR-1.RLS.006)
     no JWT snapshot · no staleness window · no propagation rule · no forced logout
```
- **PERMISSION_NODES.md** (FR-1.PERM.005) is the build-time catalog (12 categories, 74 seed nodes) that
  drives the admin matrix UI — *"no code change required to adjust permissions"* (L639) made literal.
- **`(select …)` wrapping is binding** (AF-067): bare helper calls re-evaluate per-row → 178,000 ms → 12 ms.

## Sensitivity & Restricted — who sees what

```
  TIERS:  Standard ──► Confidential ──► Personal ──► Restricted
          (any task)   (where relevant) (extra care)  (NEVER auto-injected; full audit)   (L426-433)

  CLEARANCE: explicit, never inherited (L448) · scoped by ENTITY TYPE (L450)
             Finance sees Confidential FINANCE — not Confidential client-strategy
             enforced BEFORE ranking/injection (L464/L1725) — excluded, never ranked-then-hidden

  RESTRICTED: per NAMED INDIVIDUAL, never a role default (L452 governs over L438) ·
              every grant logs who/when/why · Super Admin grants only           (FR-1.RST.*)

  REVIEW: configurable cadence (default 90d); overdue+un-actioned → ESCALATE,
          neither auto-revoke (silent #1) nor silently keep (silent #3)          (OD-028)
```

## The service-role seam — where the gate caught a hole

```
  HUMAN path (dashboard / chat-as-user)        AGENT / backend path
        │                                              │
   carries user JWT → RLS APPLIES                connects as service_role → RLS BYPASSED
        │                                              │  (no auth.uid(); governed by harness RBAC
   instant grant/revoke for free (RLS.006)            │   + ADR-004 sole-writer)
                                                       │
                          ┌────────────────────────────┴───────────────────────────┐
                          │ a task mid-flight when its originating user is           │
                          │ DEACTIVATED or a relied-on CLEARANCE is REVOKED:         │
                          │   • re-check at each step/injection boundary             │
                          │   • HALT + QUARANTINE before the next consequential      │
                          │     side effect (FR-1.RLS.007 / OD-031)                  │
                          │   • benign session-EXPIRY ≠ revocation → continue        │
                          │     (reconciles with C0 FR-0.SESS.006)                   │
                          └──────────────────────────────────────────────────────────┘
```
- The agent path has **no DB backstop by design** — so agent-path audit completeness (AF-081) and the
  mid-task re-check (FR-1.RLS.007) are **harness discipline**, the one place #2/#3 are most exposed.
- RLS-vs-harness divergence is made **observable**, not silently zero-rowed (FR-1.RLS.008 / AF-080).

## The six default roles (seeded as data, then fully editable)

```
  Super Admin  full access · the only role that manages roles/clearances/Restricted-grants
  Admin        full operations · CANNOT manage roles/plugins or offboard
  Finance      Confidential (finance entities) · approves financial actions
  HR           Personal (team-member entities) · approves HR actions
  Account Mgr  Confidential (assigned clients) · approves their clients' actions
  Standard     Standard only · chat, read client info, own-assigned approvals, memory commands
```
- **No lockout:** the last Super Admin can't be deactivated / role-changed / deleted, guarded atomically
  (FR-1.ROLE.005, ADR-004) — protects #1/#3.

## Non-negotiables, mapped

- **#1 (never lose/corrupt knowledge):** instant revoke without losing legitimate access (review escalates,
  never auto-revokes); deactivation is revocation-not-deletion (audit retained); no-lockout guard.
- **#2 (never do what it shouldn't):** default-deny everywhere; harness-primary blocks past any prompt;
  Restricted per-individual + never auto-injected; mid-task revocation halts before a side effect.
- **#3 (never fail silently):** denied direct access → explicit 403 + log (not empty-200); full access +
  RBAC-change audit across BOTH paths; RLS/harness divergence surfaced.

## Feasibility residuals (paper-until-proven)

AF-067 (live RLS perf on the hot path; D2 JWT-cache is the fallback) · AF-076 (complete `aal2` coverage) ·
AF-079 (every table actually ships RLS) · AF-080 (harness/RLS agree + runtime divergence is signalled) ·
AF-081 (agent-path access-audit completeness) · AF-068 (containment red-team incl. the FR-1.RLS.007 gate).
