---
id: ISSUE-013
title: OAuth login + session lifecycle
epic: B — identity & access
status: done
github: "#13"
---

# ISSUE-013 — OAuth login + session lifecycle

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Deliver the OAuth login path (the only sign-in path for client-tenant users) and the full session/token lifecycle — issue, refresh-rotate, expiry, re-auth, and mid-task service_role continuation — so a client-tenant user can sign in and hold a bounded, self-healing session.

## 2. Scope — in / out
**In:** The OAuth login-identity flow (Google/Microsoft, provider selected by config), tenant-pinning + verified-email hardening, and the runtime provider/enable toggle (C0 AUTH.001–004). The complete session mechanism: JWT access token + rotating single-use refresh token, 1h configurable access TTL, refresh rotation with reuse-detection, session lifetime bounds (inactivity + absolute time-box), cookie storage with the HttpOnly posture (AF-073 gate), local JWKS verification with `getUser()` for revocation-sensitive checks, dashboard-expiry re-auth with page-state preservation, and mid-task continuation as `service_role` when the client session expires (C0 SESS.001–008). The OAuth-facing states of `UI-LOGIN` and the whole `UI-REAUTH-PROMPT` surface. The app-side `profiles` mirror keyed to `auth.uid()`.
**Out:** Email+password + TOTP 2FA enrollment/challenge + brute-force soft-lock and the aal2 enforcement requirement → **ISSUE-014** (owns C0 AUTH.005–010, the password states of `UI-LOGIN`, `UI-2FA-*`). Invite/seed account creation and `UI-INVITE-SETUP` → **ISSUE-015**. "Trouble signing in?" support intake + `UI-SUPPORT-REQUESTS` + `support_requests` table → **ISSUE-016**. The actual `aal2` RLS predicate authoring and the `service_role` mid-task **re-check/halt-on-revocation** mechanism → **ISSUE-009/020** (this issue only continues a *benign* expiry; the security re-check that halts a revoked user is NFR-SEC.012's owner, ISSUE-020). Role table + `user_roles` + "role-default view" definition → **C1 / ISSUE-018** (this issue consumes the assigned role to route, per the FR-0.INV.005 seam, but does not define it).

## 3. Implements (traceability spine — by ID, not restated)
- **FRs (Component 0 — Login & Authentication):** FR-0.AUTH.001, FR-0.AUTH.002, FR-0.AUTH.003, FR-0.AUTH.004 (OAuth login-identity), FR-0.SESS.001, FR-0.SESS.002, FR-0.SESS.003, FR-0.SESS.004, FR-0.SESS.005, FR-0.SESS.006, FR-0.SESS.007, FR-0.SESS.008 (sessions & tokens).
- **NFRs:** none owned. (Cross-ref only: NFR-SEC.012 names FR-0.SESS.006 for the "benign session expiry continues" reconciliation; its enforcement — the deactivation/revocation re-check — is ISSUE-020's, not this slice's.)
- **Rests on:** ADR-001 §2/§5 (auth runs in the client-owned Supabase project; auth/signing secrets never in operator custody), ADR-006 (login establishes `auth.uid()` — the seam handed to C1; background work runs as `service_role` off the RLS path, the mechanism behind FR-0.SESS.006), AF-073 (HttpOnly cookie posture — gates FR-0.SESS.005).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-0.AUTH.001.1, AC-0.AUTH.001.2
- AC-0.AUTH.002.1, AC-0.AUTH.002.2
- AC-0.AUTH.003.1
- AC-0.AUTH.004.1, AC-0.AUTH.004.2
- AC-0.SESS.001.1
- AC-0.SESS.002.1
- AC-0.SESS.003.1
- AC-0.SESS.004.1
- AC-0.SESS.005.1
- AC-0.SESS.006.1
- AC-0.SESS.007.1
- AC-0.SESS.008.1
- **Gating spikes (if any):** none launch-gating. Build-time feasibility gate: **AF-073** (HttpOnly forced via `@supabase/ssr` without breaking client-side session reads) must be resolved GREEN, or its documented fallback (non-HttpOnly + strict CSP + short access-token TTL) applied, before FR-0.SESS.005 (AC-0.SESS.005.1) is accepted — see `spec/00-foundations/feasibility-register.md`.

## 5. Touches (complete blast radius, by ID)
- **DATA:** `profiles` (app-side user mirror keyed to `auth.users(id)`; `last_active_at` supports the session-activity/expiry path — schema §1). Supabase-managed, referenced not defined: `auth.users`, `auth.identities`, `auth.sessions` (session store + JWKS).
- **PERM:** `PERM-auth.provider_toggle` (gates FR-0.AUTH.003 config edit; node is default-deny, *homed in C1* — consumed here as a stub, not defined).
- **CFG:** `CFG-auth.oauth_enabled`, `CFG-auth.oauth_provider`, `CFG-auth.access_token_ttl`, `CFG-auth.session_inactivity_timeout`, `CFG-auth.session_absolute_timeout`.
- **UI:** `UI-LOGIN` (OAuth-primary control, identity-rejection error states, OAuth-handshake-failed state — **password/CAPTCHA states are ISSUE-014's**), `UI-REAUTH-PROMPT` (whole surface: expiry/reuse-revocation trigger, page-state preservation, mid-task-continuation note, inline-vs-redirect re-auth per OD-108).
- **Connectors:** none. (This is *login-identity* OAuth via Supabase Auth — connector OAuth for Gmail/Drive data access is C3/ISSUE-033.)

## 6. Context manifest (the EXACT files to open — nothing more)
- `spec/01-requirements/component-00-login.md` §AUTH (FR-0.AUTH.001–004) and §SESS (FR-0.SESS.001–008) — the FR text + ACs + the Doc-reconciliation block (carries the 6 Supabase vendor corrections; cite Block J, not the design doc, for vendor facts).
- `spec/04-data-model/schema.md` §1 (Identity & Auth) — the `profiles` mirror + the Supabase-managed auth tables note.
- `spec/03-surfaces/surface-00-auth.md` — `UI-LOGIN` (OAuth path) and `UI-REAUTH-PROMPT` sections (states, actions, OD-105/OD-108).
- `spec/00-foundations/adr/ADR-001-*.md` (§2/§5 secrets custody + isolation), `spec/00-foundations/adr/ADR-006-*.md` (`auth.uid()` seam + service_role bypass).
- `spec/00-foundations/feasibility-register.md` — AF-073 (HttpOnly cookie posture gate).

## 7. Dependencies
- **Blocked-by:** ISSUE-009 (RLS scaffold — helpers, default-deny, 100%-coverage CI gate). Establishes the RLS baseline the `profiles` table and the `auth.uid()` seam plug into. *(Not a spike — no AF must be GREEN to unblock; ISSUE-009 itself carries the 002 RLS-latency spike.)*
- **Blocks:** ISSUE-015 (invite + seed — needs the session/OAuth path to land activated users), ISSUE-016 (support-request recovery intake — hangs off `UI-LOGIN`).

## 8. Build order within the slice
1. **Migration (schema §1):** create the `profiles` mirror keyed to `auth.users(id)` (`on delete cascade`, `active`, `last_active_at`); expand-contract per migration discipline. Register its RLS policy on the ISSUE-009 default-deny baseline (owner reads own row via `auth.uid()`).
2. **Config:** register the five `CFG-auth.*` keys (oauth_enabled/oauth_provider/access_token_ttl/session_inactivity_timeout/session_absolute_timeout) with their edit-classes; wire `PERM-auth.provider_toggle` as the gate on `oauth_enabled`/`oauth_provider` edits (FR-0.AUTH.003).
3. **OAuth login (FR-0.AUTH.001–004):** provider-selectable Supabase OAuth (google → Google IdP; microsoft → azure); on success establish the session (→ step 4). Enforce identity hardening: Azure single-tenant pinning + `email` scope + `xms_edov`, Google verified-email; reject wrong-tenant/unverified identities to the error state.
4. **Session issuance + verification (FR-0.SESS.001, .002, .005, .008):** issue JWT access (default 3600s TTL) + opaque rotating refresh; store in cookies (never localStorage) with the HttpOnly posture per **AF-073** (fallback: non-HttpOnly + CSP + short TTL); verify tokens locally via JWKS (`getClaims()`) on the hot path and via `getUser()` on revocation-sensitive checks.
5. **Refresh + lifetime (FR-0.SESS.003, .004):** single-use refresh rotation with 10s reuse-interval tolerance + reuse-detection whole-session revocation; persist the rotated token every rotation; bound lifetime via inactivity + absolute time-box, enforced lazily at next refresh.
6. **Expiry / re-auth (FR-0.SESS.007) + mid-task continuation (FR-0.SESS.006):** on client-session expiry render `UI-REAUTH-PROMPT` over the current page preserving state; any already-running server-side task continues as `service_role` (off RLS, no `auth.uid()`) to completion — a *benign* expiry does **not** halt it (the revocation/deactivation halt is ISSUE-020).
7. **Observability hooks:** emit the auth `event_log` events this slice produces (sign-in success/failure, session establishment, rejected-identity security event, reuse-detection revocation, task-continuation, verification failure). *(The completeness-across-all-auth-paths assertion FR-0.AUTH.010 is owned in the AUTH-completeness slice — this issue emits its own events, it does not own the completeness gate.)*
8. **Surface wiring:** `UI-LOGIN` OAuth-primary control + rejection/handshake-failed states (OD-105 keeps the password path collapsed — that path is ISSUE-014); `UI-REAUTH-PROMPT` inline-vs-redirect re-auth per OD-108, background-task note per FR-0.SESS.006.
9. **Tests to the AC** (see Verification).

**Integration note (bundled FRs):** AUTH and SESS are one slice because the OAuth success path *is* the session-issuance trigger (FR-0.AUTH.001 → FR-0.SESS.001) and the whole point of the session mechanism is invisible to the two populations — the OAuth flow and the refresh/expiry/re-auth machinery share `UI-REAUTH-PROMPT` and the same cookie/JWKS plumbing. The `service_role` mid-task path (FR-0.SESS.006) is built here only to the "benign expiry continues" boundary; it deliberately stops short of the revocation re-check (NFR-SEC.012 / ISSUE-020) so the two issues share the mechanism without either owning the other's guarantee.

## 9. Verification (how DoD is proven)
- **Unit / integration** (per `spec/05-non-functional/test-strategy.md`): OAuth provider branching + identity-hardening rejections (AC-0.AUTH.001/002/004); provider-toggle takes effect without deploy (AC-0.AUTH.003.1); access-TTL expiry forces refresh (AC-0.SESS.002.1); refresh rotation invalidates the prior token + reuse-detection revokes the session (AC-0.SESS.003.1); inactivity bound refuses refresh (AC-0.SESS.004.1); cookie-not-localStorage + HttpOnly-or-fallback (AC-0.SESS.005.1); mid-task service_role continuation on benign expiry (AC-0.SESS.006.1); expiry → re-auth with preserved state (AC-0.SESS.007.1); `getUser()` denies a server-side-logged-out token (AC-0.SESS.008.1).
- **Feasibility gate:** AF-073 must be GREEN (or its fallback applied) before AC-0.SESS.005.1 is marked `Verified`.
- **AC → Verified path:** each listed AC-* moves to `Verified` when its test layer passes on CI atop the ISSUE-009 RLS baseline; the slice is `done` only when every AC in §4 is `Verified` and AF-073 is resolved.
