# Component 0 — Login & Authentication (FRs)

> **Golden exemplar.** This is the first component specced in Phase 1; later components
> pattern-match it. Scope and the research-first gate were finalized in
> `phase-playbooks.md` → "Component 0 — entry finalization" (2026-06-24). **C0 = authentication
> only ("who you are").** Roles / permission matrix / clearances / RLS row-access → **C1 (RBAC)**;
> connector OAuth + token lifecycle for the AI's *data access* → **C3 (Tool Layer)**.

**Status:** 🟢 Approved — OD-012…OD-023 resolved; verification gate clean; 6 quality findings reconciled; signed off.
**Sign-off:** ☑ **Approved 2026-06-24 (Session 16), user-authorized** — delegated ("I trust you and your recommendations"); the 3 LOW confirmations accepted (status enum `contacted`→`in-progress`; phone-recovery retired; ADR-007 cross-ref reconciled) and FR-0.INV.007 deferral logged as OOS-015. All 42 live FRs set to `Approved`.
**Drafted:** 2026-06-24 (Session 16). **ODs resolved:** 2026-06-24 (Session 16).

> **Key resolution (OD-018):** all **client-tenant** users log in via **OAuth only**; email+password+2FA
> exists **solely for external (operator-side) Super Admins** who cannot SSO into the client tenant. This
> cascaded: the credential-reset recovery flow is **retired** (OAuth users have no password we hold — see
> REC) and the data model loses its phone field + custom invite-token table.

---

## Context Manifest (load only these)

| Dependency | What it constrains here |
|---|---|
| **ADR-001 §2 / §5** (isolation; Supabase per client; secrets custody) | Supabase Auth runs in the **client-owned** project; auth secrets (service-role key, signing keys, SMTP, webhook secrets) live in that project / Railway env, never with the operator. |
| **ADR-006** (data-driven RLS; **service-role bypass**) | The session establishes `auth.uid()` — the **seam** C0 hands to C1. Backend/agents run as **service_role** (bypass RLS, no `auth.uid()`) — this is the mechanism behind mid-task continuation (FR-0.SESS.006). |
| **ADR-007** (containment-first; **webhook HMAC/JWT = a hard control = authentication**, not content detection) | WHK FRs are *authentication*; a failed verify is logged as `prompt_injection` and the payload is rejected **before** any content handling (which belongs to C2/C3). |
| **Standards:** `config-edit-taxonomy.md`, `migration-discipline.md` | Every parked `CFG-` is classified SECRET/BOOT/LIVE/REBUILD; any new auth table follows expand-contract. |
| **Feasibility Block J (SA1–SA17) + AF-073–077; AF-067** | **Cite Block J, not the design doc, for every Supabase vendor fact.** The pass refuted/corrected 6 design-doc claims (see "Doc-reconciliation" below). |
| **Glossary** | AAL / aal1 / aal2; Refresh-token rotation + reuse-detection; Asymmetric JWT / JWKS local verification; Service-role bypass; Containment-first injection posture. |
| **Design doc** | `design-doc-v4.md` **L358–390** (C0's own header) + **L643–816** (re-homed from under the `## 1.` RBAC header by semantics: app auth flow, sessions, webhook security). |

## Area codes

| Code | Area |
|---|---|
| **AUTH** | Login methods — OAuth (primary), email+password (secondary), 2FA enrollment + challenge |
| **SESS** | Sessions & tokens — JWT, TTLs, refresh rotation, cookies, expiry/re-auth, mid-task continuation |
| **INV** | Invite-based account creation |
| **SEED** | First-boot Super Admin seed |
| **REC** | Recovery — "trouble signing in" / human-verified support flow |
| **WHK** | Inbound webhook authentication |

## Doc-reconciliation — 6 design-doc claims corrected by Block J (carry these, do not re-derive from prose)

1. **Refresh-token "7-day TTL" (L699) — REFUTED.** Supabase refresh tokens **never expire**; they
   **rotate single-use** (10 s reuse interval) with reuse-detection that **revokes the whole session**.
   `auth.session_refresh_days:7` maps to **no native setting** → re-modelled as OD-012. [SA3]
2. **"HTTP-only cookies" is the default (L700) — STALE.** `@supabase/ssr` uses cookies but HttpOnly is
   *"not necessary"* per docs → must be **forced** (AF-073) or accepted as non-HttpOnly → OD-015. [SA4]
3. **"Server-side session continues mid-task" (L704–710) — REFUTED (wrong mechanism).** No such object;
   background work runs as **service_role** or middleware refreshes the JWT → OD-013. [SA5]
4. **`two_factor_required` as a config flag (L377) — REFUTED for end-users.** No project-wide end-user
   MFA toggle; must be **built** via restrictive `aal2` RLS + app gating → FR-0.AUTH.008, AF-076. [SA9]
5. **72 h invite link (L653) — REFUTED.** OTP/invite/recovery expiry is **hard-capped at 24 h (86400 s)**,
   **global** (not per-link) → re-spec to ≤24 h **or** build a custom invite-token layer → OD-014, AF-074. [SA11]
6. **"Google + Microsoft Authenticator" named compatibility (L375) — partly UNCONFIRMED.** Supabase names
   Google Authenticator (et al.) but **never names Microsoft Authenticator**; compat rests on RFC-6238 → AF-075. [SA8]

Carried priorities from entry-finalization: **OAuth is primary, email+password+2FA is secondary** (L360, L373);
**no automated/self-service password reset — deliberate** (L382), recovery is the human-verified flow (REC).

---

# AUTH — Login methods

### FR-0.AUTH.001 — OAuth as the primary login method
- **Statement:** The system shall offer OAuth (provider Google **or** Microsoft, selected per deployment by config) as the primary login method on the dashboard login surface.
- **Source:** design-doc-v4.md L360–369; [SA10]
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** A dashboard user initiating login.
- **Preconditions:** `CFG-auth.oauth_enabled = true`; `CFG-auth.oauth_provider` set; the per-client OAuth app exists in the client's own IdP account (provisioned per ADR-005 runbook — registration is **out of C0**).
- **Behaviour:**
  - Happy path: login surface presents the OAuth button **first/primary**; user authenticates with the IdP; on success a Supabase session is established (→ FR-0.SESS.001).
  - Branches: `oauth_provider=google` → Google IdP; `=microsoft` → Azure provider (slug `azure`).
  - Edge / failure: IdP returns no/invalid token → login does not proceed (FR-0.AUTH.002); IdP returns an unverified-email identity → rejected (FR-0.AUTH.004).
- **Data touched:** Supabase `auth.users`, `auth.identities` (Supabase-managed).
- **Permissions:** Public (pre-auth surface).
- **Config dependencies:** `CFG-auth.oauth_enabled`, `CFG-auth.oauth_provider`.
- **Surfaces:** `UI-LOGIN` (OAuth leads).
- **Observability:** Supabase auth log; successful login → `event_log` sign-in event.
- **Acceptance criteria:**
  - AC-0.AUTH.001.1 — Given `oauth_enabled=true` and `oauth_provider=google`, When the login page renders, Then the Google OAuth control is the primary/leading control.
  - AC-0.AUTH.001.2 — Given a valid Google sign-in, When the IdP returns a verified identity, Then a Supabase session is established and the user lands on their role-default view.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** "Google OAuth" here = **login-identity** OAuth (Supabase Auth handles it). *Connector* OAuth for Gmail/Drive data access is **C3**, not this FR.

### FR-0.AUTH.002 — OAuth is the only login path for client-tenant users
- **Statement:** The system shall, when `CFG-auth.oauth_enabled = true`, grant a session to a **client-tenant** user only on presentation of a valid OAuth token, and shall permit the email+password path **solely for external (operator-side) Super Admin** accounts.
- **Source:** design-doc-v4.md L369, L373; **resolved by OD-018**
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Any login attempt on an OAuth-enabled deployment.
- **Preconditions:** `oauth_enabled = true`.
- **Behaviour:**
  - Happy path: a client-tenant user authenticates via OAuth (FR-0.AUTH.001); no valid OAuth token → no session.
  - Branches: an **external Super Admin** (not in the client tenant, so cannot SSO) authenticates via email+password+2FA (FR-0.AUTH.005) — the one permitted, narrowly-scoped non-OAuth path.
  - Edge / failure: expired/forged OAuth token → denied + logged; a client-tenant identity has no password account to fall back to.
- **Permissions:** Public (pre-auth).
- **Config dependencies:** `CFG-auth.oauth_enabled`.
- **Surfaces:** `UI-LOGIN`.
- **Observability:** failed-auth `event_log` entry.
- **Acceptance criteria:**
  - AC-0.AUTH.002.1 — Given `oauth_enabled=true`, When a client-tenant user presents no valid OAuth token, Then no session is granted.
  - AC-0.AUTH.002.2 — Given the same deployment, When an external Super Admin authenticates by email+password+2FA, Then a session is granted (the one permitted non-OAuth path).
- **Open decisions:** — (OD-018 resolved)
- **Feasibility assumptions:** —
- **Notes:** Resolves the L369/L373 tension — OAuth-only is the default (L369); the password "alternative" (L373) exists but is scoped to external admins, so no client user carries a dormant password.

### FR-0.AUTH.003 — Provider/enable toggle is dashboard config, not a code change
- **Statement:** The system shall let an authorized operator change `oauth_provider` and `oauth_enabled` from the dashboard without a code deploy.
- **Source:** design-doc-v4.md L362, L369
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** Agency owner / Super Admin editing auth config.
- **Preconditions:** `PERM-auth.provider_toggle` (default-deny; granted to Super Admin / agency owner — defined in C1).
- **Behaviour:**
  - Happy path: operator selects provider/toggle → value persisted → takes effect per its config-edit class.
  - Edge / failure: switching provider while sessions exist does not retroactively invalidate active sessions (it governs *new* logins).
- **Config dependencies:** `CFG-auth.oauth_provider` (enum google|microsoft), `CFG-auth.oauth_enabled` (bool) — **edit-class TBD in Phase 2** (likely BOOT/REBUILD if the IdP app wiring is read at boot; flag for config taxonomy).
- **Permissions:** `PERM-auth.provider_toggle`.
- **Surfaces:** `UI-config-admin#auth` (Phase 3).
- **Observability:** config-change `audit` entry (who/old/new).
- **Acceptance criteria:**
  - AC-0.AUTH.003.1 — Given a Super Admin changes `oauth_provider`, When saved, Then the next login uses the new provider with no deploy.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Live-vs-reload behaviour is a Phase-2 config-taxonomy call.

### FR-0.AUTH.004 — Login-identity hardening (tenant pinning, email scope, verified-email)
- **Statement:** The system shall pin the OAuth login-identity to the client's own tenant and reject identities without a verified email.
- **Source:** [SA10] (no design-doc origin — a security correctness requirement surfaced by the Supabase research)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Any OAuth login.
- **Preconditions:** Per-client IdP app configured (ADR-005 runbook).
- **Behaviour:**
  - Happy path: Azure → single-tenant URL pins to the client's tenant; require the `email` scope; enable the `xms_edov` claim to confirm the email domain is verified; Google → require verified email.
  - Branches: provider=google vs azure differ only in the mechanism, not the rule.
  - Edge / failure: identity from another tenant, or unverified email → **reject** (protects non-negotiable #2 — never let the wrong person in).
- **Permissions:** Public (pre-auth).
- **Config dependencies:** none new (provider config + IdP app settings).
- **Surfaces:** `UI-LOGIN` (error state on rejection).
- **Observability:** rejected-identity → `event_log` security event.
- **Acceptance criteria:**
  - AC-0.AUTH.004.1 — Given an Azure identity from a tenant other than the configured one, When login is attempted, Then it is rejected.
  - AC-0.AUTH.004.2 — Given an OAuth identity whose email is unverified, When login is attempted, Then it is rejected.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Without tenant pinning + `email` scope, "Sign in with Microsoft" would admit *any* Microsoft account — a real hole. This is the C0 expression of #2.

### FR-0.AUTH.005 — Email + password (external Super Admins only)
- **Statement:** The system shall support email + password login **only for external (operator-side) Super Admin** accounts — operator staff who administer the deployment but are not in the client's tenant and so cannot SSO.
- **Source:** design-doc-v4.md L373; [SA13]; **scoped by OD-018**
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** An external Super Admin choosing the email+password path.
- **Preconditions:** The account is an external Super Admin with a password credential set (via the seed FR-0.SEED.002 or an admin-provisioned invite). Self-registration is never possible (FR-0.INV.001 / [SA13]).
- **Behaviour:**
  - Happy path: correct email+password → 2FA challenge (FR-0.AUTH.007) → session.
  - Branches: a **client-tenant** user has no password account, so this path is unavailable to them (they use OAuth, FR-0.AUTH.001).
  - Edge / failure: wrong credentials → denied; repeated failures → app-layer soft-lock (FR-0.AUTH.009).
- **Data touched:** Supabase `auth.users` (Supabase-managed).
- **Permissions:** Public (pre-auth), but only external-admin accounts have a usable password credential.
- **Config dependencies:** —
- **Surfaces:** `UI-LOGIN` (secondary control, present for the external-admin path).
- **Observability:** failed/succeeded sign-in `event_log`.
- **Acceptance criteria:**
  - AC-0.AUTH.005.1 — Given an external Super Admin with correct email+password and an enrolled TOTP factor, When submitted, Then the 2FA challenge is presented before a session is granted.
  - AC-0.AUTH.005.2 — Given a client-tenant user, When they attempt the email+password path, Then no password account exists for them and access is via OAuth only.
- **Open decisions:** — (OD-018 resolved)
- **Feasibility assumptions:** —
- **Notes:** The password population is essentially the seeded bootstrap admin (OD-021) plus any operator-side Super Admins. Keeping this path is what prevents a client-tenant IdP outage from locking the operator out of the deployment.

### FR-0.AUTH.006 — 2FA TOTP enrollment via QR
- **Statement:** The system shall let a user enroll a TOTP authenticator app by scanning a QR code during account setup.
- **Source:** design-doc-v4.md L375; [SA7], [SA8]
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** An external Super Admin completing seed/invite setup on the email+password path.
- **Preconditions:** Account exists; email+password chosen (external-admin path).
- **Behaviour:**
  - Happy path: system presents a TOTP secret as a QR (`otpauth://`); user scans with an RFC-6238 app (Google Authenticator confirmed; Microsoft Authenticator **unconfirmed** — AF-075); user confirms a test code → factor enrolled (Supabase MFA, `aal2` capable).
  - Branches: **client-tenant OAuth users do not enroll app-level TOTP** — their second factor is asserted at the IdP (Google/Microsoft MFA) per OD-016. App-level TOTP enrollment applies to external Super Admin password accounts.
  - Edge / failure: confirmation code wrong → enrollment not completed; user retries.
- **Data touched:** Supabase `auth.mfa_factors` (Supabase-managed).
- **Permissions:** The enrolling user only.
- **Config dependencies:** —
- **Surfaces:** `UI-2FA-ENROLL`.
- **Observability:** enrollment `event_log`.
- **Acceptance criteria:**
  - AC-0.AUTH.006.1 — Given an external admin scans the QR with an RFC-6238 app, When they enter a valid current code, Then the factor is enrolled and the account is `aal2`-capable.
- **Open decisions:** — (OD-016 resolved: OAuth users → IdP MFA; password accounts → app TOTP)
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-075 (Microsoft Authenticator named-compatibility — verify by enrolling against a live project if the client needs a named guarantee).
- **Notes:** TOTP is GA + enabled-by-default on Supabase projects [SA7]; 30 s interval, ±1 skew. Do **not** spec Passkeys/WebAuthn as a 2FA factor — Supabase positions it as *primary* auth, not 2FA [SA7].

### FR-0.AUTH.007 — 2FA challenge on the email+password path; wrong code blocks; no bypass
- **Statement:** The system shall, after correct email+password, require a valid TOTP code before granting a session, and shall not grant a session if the code is wrong or skipped.
- **Source:** design-doc-v4.md L375–377; **resolved by OD-017**
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** A user who passed the email+password step on a 2FA-enrolled account.
- **Preconditions:** A TOTP factor is enrolled.
- **Behaviour:**
  - Happy path: correct code on the **same-page** challenge (no redirect) → session elevated to `aal2` → granted.
  - Branches: wrong code → access blocked, retry; no code presented → no session.
  - Edge / failure: repeated wrong codes → Supabase MFA-verify limit (15/hr [SA16]) **plus** an app-layer soft-lock after ~5 wrong codes (temporary lock + logged security event), per OD-017.
- **Data touched:** Supabase `auth.mfa_factors`, session AAL.
- **Permissions:** The authenticating user.
- **Config dependencies:** `CFG-auth.mfa_softlock_threshold` (default 5), `CFG-auth.mfa_softlock_minutes`.
- **Surfaces:** `UI-2FA-CHALLENGE` (same-page).
- **Observability:** failed/succeeded 2FA `event_log`; soft-lock trip → security `event_log`.
- **Acceptance criteria:**
  - AC-0.AUTH.007.1 — Given a 2FA-enrolled account that passed email+password, When an incorrect TOTP code is submitted, Then no session is granted.
  - AC-0.AUTH.007.2 — Given the same, When the 2FA step is skipped/omitted, Then no session is granted (no bypass).
  - AC-0.AUTH.007.3 — Given `mfa_softlock_threshold=5`, When a 6th consecutive wrong code is submitted, Then the challenge is temporarily locked and the event is logged.
- **Open decisions:** — (OD-017 resolved)
- **Feasibility assumptions:** —
- **Notes:** "Cannot bypass once enabled" (L377) is the load-bearing clause — the `aal2` elevation is what FR-0.AUTH.008 then *requires* at the resource layer.

### FR-0.AUTH.008 — Deployment-wide 2FA enforcement is **built** (aal2 RLS + app gating), not a config flag
- **Statement:** The system shall enforce "2FA required across the deployment" by (a) post-login app-layer gating that forces enrollment/challenge before access and (b) restrictive RLS requiring `aal = 'aal2'` on every protected resource — because no native project toggle exists.
- **Source:** design-doc-v4.md L377 (intent); **corrected by [SA9] / AF-076** (the native flag does not exist); **scope by OD-016**
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Every authenticated request on a 2FA-required deployment.
- **Preconditions:** `CFG-auth.two_factor_required` is the operator's *intent* flag (the harness implements it — it is **not** a Supabase setting).
- **Behaviour:**
  - Happy path: an `aal1` session (not yet 2FA-elevated) is gated out of protected surfaces and forced to enroll/challenge; only `aal2` sessions reach protected data. OAuth users reach `aal2`-equivalent via IdP-asserted MFA.
  - Branches: **deployment-wide, no per-user exemptions** (OD-016) — "cannot be bypassed once enabled" (L377).
  - Edge / failure: **one** protected table without the `aal2` RLS clause = a silent `aal1` bypass (violates #2 + #3) → AF-076 must prove *complete coverage*.
- **Data touched:** RLS on **all** protected tables (authored in C1 / data-model; C0 owns the *requirement* that the `aal2` predicate exists).
- **Permissions:** N/A (enforcement layer).
- **Config dependencies:** `CFG-auth.two_factor_required` (harness-implemented intent flag).
- **Surfaces:** `UI-2FA-ENROLL` / `UI-2FA-CHALLENGE` (forced post-login).
- **Observability:** an `aal1` access attempt at a protected resource → security `event_log`.
- **Acceptance criteria:**
  - AC-0.AUTH.008.1 — Given `two_factor_required=true`, When an `aal1` session requests any protected surface, Then it is forced to enroll/challenge and denied the data until `aal2`.
  - AC-0.AUTH.008.2 — Given the full table inventory, When audited, Then **no** protected table is reachable at `aal1` (complete-coverage assertion — the AF-076 test target).
- **Open decisions:** — (OD-016 resolved: deployment-wide, no exemptions)
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-076 (org-wide enforcement has no silent bypass — prove `aal2` RLS coverage is complete). Composes with AF-067 (the `(select …)` initPlan rule) since the `aal2` check rides on the RLS path.
- **Notes:** This is the single biggest doc-vs-reality correction in C0: the design treats 2FA-required as a flip; it is an **always-on engineering invariant** spanning C0 (gating) and C1/data-model (RLS).

### FR-0.AUTH.009 — Login brute-force / credential-stuffing posture
- **Statement:** The system shall defend the password login path against brute-force/credential-stuffing using platform and app-layer controls, given Supabase provides **no native per-account lockout**.
- **Source:** [SA16] / AF-077 (no design-doc origin); **resolved by OD-018**
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** Repeated failed password attempts (external-admin path).
- **Preconditions:** email+password path (external Super Admins).
- **Behaviour:**
  - Happy path: CAPTCHA (hCaptcha/Turnstile) on the login form + leaked-password protection (Pro+) on; the shared `/token` IP limit (1800/hr) applies.
  - Branches: **build an app-layer per-account soft-lock** (counter → temporary block + Super Admin alert) on the password path (OD-018).
  - Edge / failure: distributed attack from many IPs → IP limits insufficient → defense leans on CAPTCHA + leaked-password + the app soft-lock.
- **Permissions:** N/A.
- **Config dependencies:** `CFG-auth.captcha_enabled`, `CFG-auth.leaked_password_protection`, `CFG-auth.account_lockout_threshold`, `CFG-auth.account_lockout_minutes`.
- **Surfaces:** `UI-LOGIN` (CAPTCHA).
- **Observability:** failed-login rate → security `event_log`/alert.
- **Acceptance criteria:**
  - AC-0.AUTH.009.1 — Given `account_lockout_threshold` consecutive failed password attempts on one account, When the threshold is crossed, Then that account's password path is temporarily locked and a Super Admin alert fires.
  - AC-0.AUTH.009.2 — Given the login form, When rendered, Then CAPTCHA and leaked-password protection are active.
- **Open decisions:** — (OD-018 resolved)
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-077 (brute-force posture — no native lockout; confirm the platform controls + app-layer lockout actually stop the attack).
- **Notes:** There is **no separate password-grant rate limit** beyond the `/token` IP cap [SA16] — the per-account dimension is ours to add if required.

### FR-0.AUTH.010 — Auth audit-trail completeness
- **Statement:** The system shall log every authentication-relevant event — login (success/failure), logout, session establishment/revocation, 2FA enroll/challenge, invite issue/activate/revoke, seed run, auth-config change, and webhook-auth failure — so the auth audit trail is complete (no auth-relevant action is unlogged).
- **Source:** quality-gate finding (Dim 6 trust/provenance + non-negotiable #3); consolidates the per-FR `event_log`/`audit`/`guardrail_log` writes across C0
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Any auth-relevant event in C0.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: each listed event writes a structured record (actor/subject, event type, timestamp, outcome) to the appropriate sink.
  - Branches: detailed sink schema, retention, tamper-evidence, and export are **owned by C7 (Observability) / Phase 5** — C0 owns the *completeness requirement*, analogous to how FR-0.AUTH.008 owns the `aal2`-coverage requirement.
  - Edge / failure: a gap in coverage (an auth action with no log) is the failure this FR forbids (#3).
- **Data touched:** `event_log`, `audit`, `guardrail_log` (write).
- **Permissions:** N/A.
- **Config dependencies:** —
- **Surfaces:** audit views (C7 / Phase 3).
- **Observability:** this FR *is* the observability-completeness assertion for auth.
- **Acceptance criteria:**
  - AC-0.AUTH.010.1 — Given the full list of auth-relevant event types, When audited, Then each produces a log record (no type is unlogged).
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Seam to **C7** — the trail's storage/retention/export spec lives there; C0 asserts coverage so nothing auth-relevant is silently unrecorded.

---

# SESS — Sessions & tokens

### FR-0.SESS.001 — Session = JWT access token + rotating refresh token
- **Statement:** The system shall represent an authenticated session as a Supabase JWT access token plus an opaque single-use rotating refresh token.
- **Source:** design-doc-v4.md L696–697; [SA1]
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Successful login (any method).
- **Preconditions:** Authentication passed (incl. `aal2` where required).
- **Behaviour:**
  - Happy path: Supabase issues access JWT + refresh token; client uses access token until expiry, then exchanges the refresh token.
  - Edge / failure: see FR-0.SESS.003 for rotation/reuse handling.
- **Data touched:** Supabase Auth session store (Supabase-managed).
- **Permissions:** the session owner.
- **Config dependencies:** `CFG-auth.access_token_ttl`.
- **Surfaces:** N/A (backend/cookie).
- **Observability:** sign-in `event_log`.
- **Acceptance criteria:**
  - AC-0.SESS.001.1 — Given a successful login, When the session is established, Then an access JWT and a refresh token are issued.
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-0.SESS.002 — Access token TTL = 1 hour (configurable)
- **Statement:** The system shall set the access-token TTL to 1 hour by default, operator-configurable.
- **Source:** design-doc-v4.md L698; [SA2]
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Token issuance.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: access token expires after `CFG-auth.access_token_ttl` (default 3600 s); client refreshes.
  - Branches: operator may lower it (rec floor 5 min) or raise it (>1 h discouraged by Supabase) [SA2].
- **Config dependencies:** `CFG-auth.access_token_ttl` (default 3600 s).
- **Surfaces:** N/A.
- **Observability:** —
- **Acceptance criteria:**
  - AC-0.SESS.002.1 — Given default config, When an access token is older than 3600 s, Then it is rejected and a refresh is required.
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-0.SESS.003 — Refresh-token rotation, reuse-detection, and persistence
- **Statement:** The system shall treat refresh tokens as single-use rotating credentials, persist the new token on every rotation, and treat reuse-detection (whole-session revocation) as a handled failure mode.
- **Source:** **[SA3] (refutes design L699's "7-day TTL")**
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** A token refresh; or a detected refresh-token reuse.
- **Preconditions:** An active session.
- **Behaviour:**
  - Happy path: client exchanges refresh token → Supabase issues a new access + new refresh token (old one invalid); the client/cookie store **persists the new refresh token** (10 s reuse-interval tolerance for races).
  - Branches: reuse of an already-rotated token outside the interval → Supabase **revokes the whole session** → user is logged out and must re-authenticate.
  - Edge / failure: failure to persist the rotated token → silent loss of session continuity → must be handled (re-auth), never a silent hang (#3).
- **Data touched:** Supabase Auth session store.
- **Permissions:** session owner.
- **Config dependencies:** session-bound settings → OD-012.
- **Surfaces:** `UI-REAUTH-PROMPT` on revocation.
- **Observability:** reuse-detection revocation → security `event_log`.
- **Acceptance criteria:**
  - AC-0.SESS.003.1 — Given a refresh, When a new refresh token is issued, Then the prior token is rejected on subsequent use (outside the 10 s interval) and the session is revoked.
- **Open decisions:** OD-012 (overall session-lifetime model).
- **Feasibility assumptions:** —
- **Notes:** The design's `auth.session_refresh_days:7` is **removed** — it maps to no native setting. Session bounds are re-modelled in OD-012.

### FR-0.SESS.004 — Session lifetime bound (inactivity / time-box)
- **Statement:** The system shall bound session lifetime via Supabase's inactivity-timeout and/or absolute time-box settings (in lieu of the non-existent refresh-token TTL).
- **Source:** [SA3] (replacement for design L699); **resolved by OD-012**
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** Refresh-time evaluation.
- **Preconditions:** Pro+ plan (these settings are Pro+, no default, enforced **lazily at next refresh**) [SA3].
- **Behaviour:**
  - Happy path: (a) adopt Supabase's **inactivity-timeout** (~7–14 d idle, approximating the design's 7-day intent) **+ an absolute time-box**; a session past either bound is invalidated at its next refresh.
  - Branches: enforcement is **lazy** — invalidation happens at the next refresh attempt, not proactively; the UX must not imply an idle session is already dead (#3).
  - Edge / failure: `auth.session_refresh_days` is **removed** (maps to no native setting); reuse-detection (FR-0.SESS.003) independently revokes a compromised session.
- **Config dependencies:** `CFG-auth.session_inactivity_timeout`, `CFG-auth.session_absolute_timeout` (replace `auth.session_refresh_days`).
- **Surfaces:** `UI-REAUTH-PROMPT`.
- **Observability:** session-expiry `event_log`.
- **Acceptance criteria:**
  - AC-0.SESS.004.1 — Given an idle session older than `session_inactivity_timeout`, When it next attempts a refresh, Then the refresh is refused and re-auth is required.
- **Open decisions:** — (OD-012 resolved)
- **Feasibility assumptions:** —

### FR-0.SESS.005 — Cookie session storage; HttpOnly posture
- **Statement:** The system shall store the session in cookies (not localStorage) and shall determine the HttpOnly posture per OD-015.
- **Source:** design-doc-v4.md L700–701; **corrected by [SA4] / AF-073**; **resolved by OD-015**
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Session establishment.
- **Preconditions:** `@supabase/ssr` cookie-based session.
- **Behaviour:**
  - Happy path: **pursue HttpOnly** cookies (via `@supabase/ssr` cookie options, session reads moved server-side) to prevent XSS token theft (L701) — **gated by the AF-073 spike** proving it doesn't break required client-side session access.
  - Branches: if the spike shows HttpOnly breaks the app → fall back to the **non-HttpOnly default + XSS mitigation** (strict CSP, short access-token TTL) — the documented fallback.
  - Edge / failure: localStorage is rejected outright regardless; only the HttpOnly attribute is the spike's open question.
- **Data touched:** session cookie.
- **Permissions:** N/A.
- **Config dependencies:** —
- **Surfaces:** N/A.
- **Observability:** —
- **Acceptance criteria:**
  - AC-0.SESS.005.1 — Given the session is established, When inspected, Then the session token is in a cookie (never localStorage), and HttpOnly is set unless the AF-073 fallback is in effect (then CSP + short TTL mitigations are active).
- **Open decisions:** — (OD-015 resolved; HttpOnly is the target, AF-073 is the gate)
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-073 (HttpOnly can be forced via `@supabase/ssr` without breaking client session reads, else fall back + mitigate).
- **Notes:** localStorage is rejected outright; only the HttpOnly attribute is in question.

### FR-0.SESS.006 — Mid-task continuation when the client session expires
- **Statement:** The system shall continue an already-running server-side task to completion when the user's client session expires, via a mechanism selected in OD-013, and prompt the client to re-auth on next dashboard interaction.
- **Source:** design-doc-v4.md L703–710; **corrected by [SA5]** (no "server-side session" object exists); **resolved by OD-013**
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** A long-running task whose initiating user's access token expires mid-run.
- **Preconditions:** A task is executing in the background (Inngest/harness).
- **Behaviour:**
  - Happy path: (b) **background work runs as `service_role`** (bypasses RLS, **no `auth.uid()`**, governed by harness RBAC) — so the task does not depend on the client session and runs to completion.
  - Branches: the dashboard shows a re-auth prompt on the user's next interaction (→ FR-0.SESS.007).
  - Edge / failure: a `service_role` task is **not** bound by the user's RLS — its safety comes from harness RBAC + the ADR-004 sole-writer invariant, not from `auth.uid()`.
- **Data touched:** service_role writes are governed by harness RBAC, not RLS.
- **Permissions:** N/A.
- **Config dependencies:** —
- **Surfaces:** `UI-REAUTH-PROMPT`.
- **Observability:** task-continuation `event_log`.
- **Acceptance criteria:**
  - AC-0.SESS.006.1 — Given a background task whose initiating user's session expires mid-run, When the session expires, Then the task continues to completion as `service_role` and the user is prompted to re-auth on next interaction.
- **Open decisions:** — (OD-013 resolved: service_role)
- **Feasibility assumptions:** —
- **Notes:** Consistent with the locked architecture — ADR-004 (Memory Agent = sole writer as service_role) and ADR-006 (backend work off the RLS path). The design's "server-side session continues" means "the task does not depend on the client session."

### FR-0.SESS.007 — Dashboard expiry → re-auth prompt, state preserved
- **Statement:** The system shall, on dashboard session expiry, present a re-auth prompt and preserve current page state where possible, with no data loss.
- **Source:** design-doc-v4.md L712–715
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** A dashboard interaction after the client session expired.
- **Preconditions:** Session expired/revoked.
- **Behaviour:**
  - Happy path: user interacts → re-auth prompt → on success, returns to the preserved page state.
  - Branches: unsaved form input preserved where technically possible.
  - Edge / failure: re-auth fails → user remains logged out; no partial/ambiguous state.
- **Surfaces:** `UI-REAUTH-PROMPT`.
- **Observability:** re-auth `event_log`.
- **Acceptance criteria:**
  - AC-0.SESS.007.1 — Given an expired dashboard session, When the user next interacts, Then a re-auth prompt appears and, on success, the prior page state is restored without data loss.
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-0.SESS.008 — JWT verification: local JWKS, with `getUser` where revocation matters
- **Statement:** The system shall verify access-token JWTs locally via JWKS (`getClaims()`) on the hot path, and use `getUser()` (an Auth-server round-trip) wherever authoritative revocation/logout state is required.
- **Source:** [SA17] (no design-doc origin — an architecture-relevant platform change)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Any request presenting a JWT.
- **Preconditions:** Project uses asymmetric signing keys (RS256/ES256, default since 2025-10-01) [SA17].
- **Behaviour:**
  - Happy path: backend fetches JWKS once (`/auth/v1/.well-known/jwks.json`) and verifies tokens locally — no Auth-server round-trip per request.
  - Branches: for logout/revocation-sensitive checks, use `getUser()` (which sees server-side logout state that `getClaims()` cannot).
  - Edge / failure: relying solely on `getClaims()` for a logout-sensitive decision → a revoked user still appears valid until token expiry (#2 risk) — disallowed.
- **Data touched:** Supabase JWKS endpoint.
- **Permissions:** N/A.
- **Config dependencies:** secrets-custody — signing keys live in the client project (ADR-001 §5); API-key names `anon`→`sb_publishable_…`, `service_role`→`sb_secret_…` (legacy migrate by late 2026) [SA17].
- **Surfaces:** N/A.
- **Observability:** verification-failure `event_log`.
- **Acceptance criteria:**
  - AC-0.SESS.008.1 — Given a token whose user was logged out server-side, When a revocation-sensitive endpoint is hit, Then `getUser()` is used and the request is denied.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Flag for the C3/secrets work: API-key rename + late-2026 legacy-key migration deadline.

---

# INV — Invite-based account creation

### FR-0.INV.001 — No self-registration; accounts are invite-only
- **Statement:** The system shall not allow self-registration; only an Admin or Super Admin may create a user, by invitation.
- **Source:** design-doc-v4.md L647; [SA13]
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Admin/Super Admin issuing an invite from User Management.
- **Preconditions:** `PERM-user.invite` (default-deny; Admin/Super Admin — defined in C1).
- **Behaviour:**
  - Happy path: Supabase "Allow new users to sign up" toggle **off**; the admin API (`createUser`/`inviteUserByEmail`/`generateLink`) bypasses that toggle — which is *why* invite-only works [SA13].
  - Edge / failure: any public sign-up attempt → rejected.
- **Data touched:** Supabase `auth.users`.
- **Permissions:** `PERM-user.invite`.
- **Surfaces:** `UI-USER-MGMT` (invite action) — Phase 3.
- **Observability:** invite-issued `audit`.
- **Acceptance criteria:**
  - AC-0.INV.001.1 — Given the public signup toggle is off, When a user attempts self-registration, Then no account is created.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Optional **Before User Created Hook** can enforce a domain allowlist [SA13] — flag as a hardening option.

### FR-0.INV.002 — Invite link generation and expiry
- **Statement:** The system shall generate a time-limited invite link for an invited user, with an expiry determined by OD-014.
- **Source:** design-doc-v4.md L649–654; **corrected by [SA11] / AF-074**; **resolved by OD-014**
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Admin/Super Admin issuing an invite.
- **Preconditions:** `PERM-user.invite`.
- **Behaviour:**
  - Happy path: generate a **native Supabase invite link bounded ≤24 h** (no custom token layer); deliver via custom SMTP (FR-0.INV.003).
  - Branches: expired before use → one-click **resend** / re-issue (FR-0.INV.006).
  - Edge / failure: the 24 h cap is a **global** project setting that also bounds magic/recovery links and trips the ≤1 h advisor — accepted (AF-074 confirms the coupling on hosted Supabase).
- **Data touched:** Supabase invite token (no custom `DATA-invite_tokens` table — dropped per OD-014).
- **Permissions:** `PERM-user.invite`.
- **Config dependencies:** `CFG-auth.invite_link_ttl` (≤24 h, global).
- **Surfaces:** `UI-USER-MGMT`.
- **Observability:** invite-issued/expired `audit`.
- **Acceptance criteria:**
  - AC-0.INV.002.1 — Given an admin issues an invite, When generated, Then the link expires in ≤24 h and is delivered via custom SMTP.
- **Open decisions:** — (OD-014 resolved: 24 h native)
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-074 (24 h hard cap + global coupling — confirm on hosted Supabase that lowering the global slider also shortens invite links).

### FR-0.INV.003 — Invite email delivery via custom SMTP
- **Statement:** The system shall deliver invite emails through a configured custom SMTP provider (the built-in auth email service is demo-only).
- **Source:** design-doc-v4.md L654; [SA14]
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Invite issuance.
- **Preconditions:** Custom SMTP configured (mandatory for prod — built-in is **2 emails/hour** [SA14]).
- **Behaviour:**
  - Happy path: invite email sent via custom SMTP (default 30 new-user emails/hr, raisable).
  - Edge / failure: SMTP not configured / throttled → the invite **silently looks like nothing happened** (#3) — must surface a send failure to the issuer, never fail silently.
- **Data touched:** SMTP config (secret).
- **Permissions:** `PERM-user.invite`.
- **Config dependencies:** `CFG-auth.smtp_*` (SECRET; mandated — flag to Phase 5 too).
- **Surfaces:** `UI-USER-MGMT` (send-status feedback).
- **Observability:** email send success/failure `event_log` + issuer-visible status.
- **Acceptance criteria:**
  - AC-0.INV.003.1 — Given custom SMTP is not configured, When an invite is issued, Then the issuer sees an explicit failure (not a success), so a throttled/dropped invite is never mistaken for a sent one.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** This is a direct #3 ("never fail silently") control — a throttled invite is the classic silent failure.

### FR-0.INV.004 — Setup page: user chooses OAuth or email+password+2FA
- **Statement:** The system shall, when an invited user opens the setup link, let them establish their login method — either connect OAuth, or set an email+password and configure 2FA.
- **Source:** design-doc-v4.md L656–661; **resolved by OD-020 / OD-018**
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Invited user clicking a valid setup link.
- **Preconditions:** Valid, unexpired invite token.
- **Behaviour:**
  - Happy path: setup page → **one** method (OD-020): a **client-tenant** user takes Option A (connect OAuth); an **external Super Admin** takes Option B (email+password, then 2FA enroll FR-0.AUTH.006) → account activated (→ FR-0.INV.005).
  - Branches: a second method can be added later from account settings (OD-020); in practice client users are OAuth-only, so the "both at setup" case is moot.
  - Edge / failure: expired/used link → no setup → re-request (FR-0.INV.006).
- **Data touched:** Supabase `auth.users`, `auth.identities`/`auth.mfa_factors`.
- **Permissions:** the invited user (token-scoped).
- **Surfaces:** `UI-INVITE-SETUP`.
- **Observability:** activation `event_log`.
- **Acceptance criteria:**
  - AC-0.INV.004.1 — Given a valid setup link for an external admin, When they complete Option B, Then a password credential and a TOTP factor are established and the account activates.
  - AC-0.INV.004.2 — Given a valid setup link for a client-tenant user, When they complete Option A, Then their OAuth identity is connected and the account activates (no password is set).
- **Open decisions:** — (OD-020 resolved: one method at setup)
- **Feasibility assumptions:** —

### FR-0.INV.005 — Activation → redirect to role-default view
- **Statement:** The system shall, on successful setup, activate the account and redirect the user to the default dashboard view for their assigned role.
- **Source:** design-doc-v4.md L662–664
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Completion of setup.
- **Preconditions:** Account activated; a role is assigned.
- **Behaviour:**
  - Happy path: redirect to the role's default view.
  - Edge / failure: no role assigned → safe default / no-access landing (role model is **C1** — this FR owns only the *redirect-by-role* seam).
- **Data touched:** `user_roles` (read; **owned by C1**).
- **Permissions:** N/A.
- **Surfaces:** role-default dashboard view.
- **Observability:** —
- **Acceptance criteria:**
  - AC-0.INV.005.1 — Given an activated account with role R, When setup completes, Then the user lands on R's default view.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** **Seam to C1.** Role assignment, the permission matrix, and "default view per role" definitions live in C1; C0 consumes the assigned role to route.

### FR-0.INV.006 — Invite lifecycle edge cases
- **Statement:** The system shall define expired-invite re-request, early revocation, and resend behaviours.
- **Source:** design-doc-v4.md L649–664 (gap — not specified in prose); **resolved by OD-020**
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** Admin or invited user hitting an edge case.
- **Behaviour:**
  - Happy path: expired link → admin re-issues / user re-requests (via the support form); admin can **revoke** an outstanding invite before use; **resend** is one click.
  - Edge / failure: revoking an already-used invite is a no-op (account exists); all actions `audit`-logged.
- **Permissions:** `PERM-user.invite` for revoke/resend.
- **Surfaces:** `UI-USER-MGMT`.
- **Observability:** invite revoke/resend `audit`.
- **Acceptance criteria:**
  - AC-0.INV.006.1 — Given an unused invite, When an admin revokes it, Then the link no longer activates an account and the action is logged.
  - AC-0.INV.006.2 — Given an expired invite, When the admin re-issues, Then a fresh ≤24 h link is delivered.
- **Open decisions:** — (OD-020 resolved)
- **Feasibility assumptions:** —

### FR-0.INV.007 — Invite / seed email delivery-failure surfacing (incl. bounce)
- **Statement:** The system shall surface a delivery failure for invite and seed setup emails — both the send-side failure (FR-0.INV.003) and, where the SMTP provider reports it, an asynchronous **bounce** — so a sent-but-undelivered invite is not mistaken for success.
- **Source:** quality-gate finding (non-negotiable #3); extends FR-0.INV.003 + FR-0.SEED.002
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** Invite/seed email send; later, a provider bounce notification.
- **Preconditions:** Custom SMTP configured (FR-0.INV.003).
- **Behaviour:**
  - Happy path: send-side failure surfaces to the issuer immediately (FR-0.INV.003); if the SMTP provider exposes bounce webhooks, a later bounce marks the invite as undelivered and re-alerts the issuer.
  - Branches: provider without bounce reporting → the invite shows "sent, delivery unconfirmed" and relies on the recipient/admin noticing (resend via FR-0.INV.006; seed recovery via env re-run, FR-0.SEED.002).
  - Edge / failure: a bounced invite that silently looks "sent" is the failure this FR closes (#3).
- **Data touched:** invite/`support`-adjacent delivery status; `event_log`.
- **Permissions:** `PERM-user.invite` sees status.
- **Config dependencies:** `CFG-auth.smtp_bounce_webhook` (if the provider supports it).
- **Surfaces:** `UI-USER-MGMT` (delivery status).
- **Observability:** delivery-failure/bounce `event_log`.
- **Acceptance criteria:**
  - AC-0.INV.007.1 — Given the SMTP provider reports a bounce for an invite, When received, Then the invite is marked undelivered and the issuer is re-alerted.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** **Decided (2026-06-24):** v1 ships the **send-side guard (FR-0.INV.003) as the primary control**; bounce surfacing is **best-effort where the SMTP provider exposes it**. Full bounce-webhook reconciliation is **deferred to Phase 5 / connector work → OOS-015**. This keeps the #3 (never-fail-silently) guarantee on the common case (send failure) without C0 owning provider-specific bounce plumbing.

---

# SEED — First-boot Super Admin

### FR-0.SEED.001 — Seed creates the first Super Admin from deployment env
- **Statement:** The system shall, on first deployment boot, create the first Super Admin account from the `SUPER_ADMIN_EMAIL` deployment env value and assign the Super Admin role.
- **Source:** design-doc-v4.md L671–681; [SA12], [SA13]
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** The one-time seed script during provisioning (ADR-005).
- **Preconditions:** `SUPER_ADMIN_EMAIL` set; no Super Admin exists yet (FR-0.SEED.003).
- **Behaviour:**
  - Happy path: seed calls admin `createUser` (no password, no email auto-sent) for `SUPER_ADMIN_EMAIL`; assigns the Super Admin role [SA12/SA13].
  - Edge / failure: env unset → seed aborts with a loud error (never creates a blank/guessable admin) (#2/#3).
- **Data touched:** Supabase `auth.users`; `user_roles` (Super Admin) — role table owned by C1.
- **Permissions:** N/A (provisioning script, service_role).
- **Config dependencies:** `SUPER_ADMIN_EMAIL` (BOOT env, not a dashboard config).
- **Surfaces:** N/A.
- **Observability:** seed-run `audit`.
- **Acceptance criteria:**
  - AC-0.SEED.001.1 — Given `SUPER_ADMIN_EMAIL` set and no existing Super Admin, When the seed runs, Then exactly one Super Admin user is created with that email.
- **Open decisions:** — (OD-021 resolved: email+password+2FA only — the external bootstrap admin)
- **Feasibility assumptions:** —

### FR-0.SEED.002 — Seed sends a one-time 24 h setup link
- **Statement:** The system shall send the seeded Super Admin a one-time setup link, valid 24 hours, to set their password and 2FA.
- **Source:** design-doc-v4.md L681–683; **[SA12]**; **resolved by OD-014 / OD-021**
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Seed completion.
- **Preconditions:** Super Admin user created; custom SMTP available (FR-0.INV.003 / [SA14]).
- **Behaviour:**
  - Happy path: seed uses `generateLink` and delivers it (custom SMTP); link valid **≤24 h** via the global OTP-expiry setting (same native mechanism as invites, OD-014 — no custom token).
  - Branches: the 24 h global setting also bounds all magic/recovery links and trips the ≤1 h advisor — accepted.
  - Edge / failure: email bounce / link expiry before use → **re-run the seed via a deliberate env change** (the only non-UI re-trigger, FR-0.SEED.003, guarded by the existence check) — OD-021.
- **Data touched:** Supabase recovery/OTP token.
- **Permissions:** N/A.
- **Config dependencies:** `CFG-auth.seed_setup_link_ttl` (≤24 h), couples with `CFG-auth.invite_link_ttl`.
- **Surfaces:** `UI-INVITE-SETUP` (reused for the seed admin).
- **Observability:** seed setup-link `audit`.
- **Acceptance criteria:**
  - AC-0.SEED.002.1 — Given the seed completes, When the setup email is sent, Then it carries a one-time link valid ≤24 h delivered via custom SMTP.
  - AC-0.SEED.002.2 — Given the setup email bounced or the link expired, When recovery is needed, Then the only path is a deliberate env-change seed re-run (guarded by the existence check), with no UI trigger.
- **Open decisions:** — (OD-014 + OD-021 resolved)
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-074 (24 h cap + global coupling).

### FR-0.SEED.003 — Seed is idempotent (atomic guard), runs once, not UI-triggerable
- **Statement:** The system shall run the seed exactly once using an **atomic** guard (a DB-level uniqueness constraint or advisory lock, per ADR-004) — not a bare check-then-create — so that concurrent boots cannot mint two Super Admins; and it cannot be re-triggered from the UI, only via a deliberate deployment env change.
- **Source:** design-doc-v4.md L685–690; **hardened per ADR-004** (verification-gate finding — close the check-then-create TOCTOU)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Deployment boot / re-deploy (possibly concurrent instances).
- **Preconditions:** —
- **Behaviour:**
  - Happy path: Super Admin absent → create under the atomic guard (FR-0.SEED.001/002); Super Admin present → exit, no-op.
  - Branches: re-deploy / concurrent boots → at most one creation wins; the others see the constraint/lock and no-op (not a bare existence check).
  - Edge / failure: no UI path can invoke it (closes the "re-seed to mint a second admin" attack — #2); a lost race is a clean no-op, not a second admin.
- **Data touched:** atomic guard over the Super-Admin-role assignment (`pg_advisory_xact_lock` and/or a unique constraint, ADR-004 pattern).
- **Permissions:** N/A (deploy-time, service_role).
- **Config dependencies:** —
- **Surfaces:** N/A.
- **Observability:** seed-skipped/seed-ran `audit`.
- **Acceptance criteria:**
  - AC-0.SEED.003.1 — Given a Super Admin already exists, When the deployment re-boots and the seed runs, Then no second Super Admin is created.
  - AC-0.SEED.003.2 — Given any UI surface, When a user attempts to trigger the seed, Then there is no such path.
  - AC-0.SEED.003.3 — Given two seed runs execute concurrently on first boot, When both attempt creation, Then exactly one Super Admin is created (the atomic guard serializes them).
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Reuses ADR-004's per-entity serialization / idempotency mechanism — the project's standard answer to a TOCTOU, applied here to the seed.

---

# REC — Login support ("trouble signing in")

> **Reframed by OD-018/OD-019.** Since all client-tenant users are **OAuth-only**, the system holds
> **no client-user password to reset** — a stuck client user recovers at their IdP (Google/Microsoft) or
> via an admin checking their tenant membership/role. The only resettable credentials are **external
> Super Admin** passwords, recovered via the **bootstrap path** (env-change seed re-run, OD-021). So the
> old phone-verify-before-credential-change flow is **retired** (FR-0.REC.004); what remains is a generic
> **login-support intake**.

### FR-0.REC.001 — No automated/self-service password reset
- **Statement:** The system shall not provide any automated or self-service password-reset mechanism.
- **Source:** design-doc-v4.md L383 (deliberate security decision)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** A user who cannot sign in.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: there is no "reset link." Client-tenant users have no system-held password (OAuth-only); external Super Admin password recovery is the bootstrap path (OD-021), not a self-service reset.
  - Edge / failure: any Supabase native recovery/magic-link reset flow is **disabled/unused** so it cannot become a backdoor.
- **Permissions:** N/A.
- **Surfaces:** `UI-LOGIN` (no "forgot password" link; a "Trouble signing in?" button instead).
- **Observability:** —
- **Acceptance criteria:**
  - AC-0.REC.001.1 — Given the login page, When a user looks for password reset, Then there is no self-service reset — only "Trouble signing in?".
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** This deliberately removes a common attack vector (L383). OD-018 (OAuth-only client users) shrinks the surface further — there is barely a password in the picture.

### FR-0.REC.002 — "Trouble signing in?" form creates a support request
- **Statement:** The system shall present a "Trouble signing in?" form (email, name, issue description) whose submission creates a login-support request.
- **Source:** design-doc-v4.md L385; **reframed by OD-019**
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** A stuck user (locked out, IdP issue, wrong role/access).
- **Preconditions:** —
- **Behaviour:**
  - Happy path: user submits the 3 fields → a `support_requests` row is created with status `pending`; an admin resolves it by checking access/membership (it is **not** a credential-reset request).
  - Edge / failure: spam/abuse of the form → rate-limit / CAPTCHA (ties to FR-0.AUTH.009 controls).
- **Data touched:** `DATA-support_requests` (email, name, issue, status, timestamps) — **write**. *(No phone field — the phone-verify flow is retired, OD-019.)*
- **Permissions:** Public (pre-auth submission).
- **Surfaces:** `UI-LOGIN` → form; creates entry in `UI-SUPPORT-REQUESTS`.
- **Observability:** support-request-created `event_log`.
- **Acceptance criteria:**
  - AC-0.REC.002.1 — Given the form with all three fields, When submitted, Then a `pending` support request is created and Super Admin + Admin are notified (FR-0.REC.006).
- **Open decisions:** — (OD-019 resolved)
- **Feasibility assumptions:** —

### FR-0.REC.003 — Support request visibility (Super Admin / Admin)
- **Statement:** The system shall make support requests visible to Super Admin and Admin users in the dashboard.
- **Source:** design-doc-v4.md L385
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Super Admin/Admin viewing the support queue.
- **Preconditions:** `PERM-support.view` (default-deny; Super Admin/Admin — C1).
- **Behaviour:**
  - Happy path: the queue lists requests with their status; others cannot see it.
  - Edge / failure: a non-privileged user has no access (default-deny).
- **Data touched:** `DATA-support_requests` (read).
- **Permissions:** `PERM-support.view`.
- **Surfaces:** `UI-SUPPORT-REQUESTS`.
- **Observability:** —
- **Acceptance criteria:**
  - AC-0.REC.003.1 — Given a user without `PERM-support.view`, When they attempt to open the support queue, Then access is denied.
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-0.REC.004 — ~~Phone verification before any credential change~~ **RETIRED**
- **Status:** **Retired (2026-06-24, OD-019).** ID not reused.
- **Why retired:** This FR existed to gate the manual reset of a **user password**. Under OD-018 all
  client-tenant users are **OAuth-only** — the system holds no client-user password to reset, so there is
  nothing to phone-verify-and-reset. (Removing it also deletes the social-engineering surface where a
  recovery request could redirect the verification call to an attacker.) The only resettable credentials —
  **external Super Admin** passwords — recover via the **bootstrap path** (env-change seed re-run, OD-021),
  not a phone-verify flow.
- **Superseded by:** FR-0.SEED.002/003 (external-admin recovery) + FR-0.REC.002/006 (generic support intake).

### FR-0.REC.005 — Request status tracking (pending / in_progress / resolved)
- **Statement:** The system shall track every login-support request through the states pending → in_progress → resolved.
- **Source:** design-doc-v4.md L387; **reframed by OD-019**
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** State transitions during handling.
- **Preconditions:** A request exists.
- **Behaviour:**
  - Happy path: pending (created) → in_progress (an admin picks it up) → resolved (access fixed / question answered). *(The old "contacted" state was tied to the retired phone-verify flow.)*
  - Edge / failure: invalid transitions blocked; a resolved request is immutable history.
- **Data touched:** `DATA-support_requests.status`.
- **Permissions:** `PERM-support.resolve` for transitions.
- **Surfaces:** `UI-SUPPORT-REQUESTS`.
- **Observability:** status-transition `audit`.
- **Acceptance criteria:**
  - AC-0.REC.005.1 — Given a pending request, When an admin marks it in_progress then resolved, Then the status history reflects pending→in_progress→resolved with actor + timestamp on each.
- **Open decisions:** —
- **Feasibility assumptions:** —

### FR-0.REC.006 — Support-request notification
- **Statement:** The system shall notify all Super Admin and Admin users when a login-support request is submitted.
- **Source:** design-doc-v4.md L385–387 (gap — notification not specified); **resolved by OD-019**
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** Request submission.
- **Preconditions:** A request was created (FR-0.REC.002).
- **Behaviour:**
  - Happy path: on submit, notify all Super Admin + Admin (in-dashboard + email) so the request isn't unseen (#3).
  - Edge / failure: notification delivery failure is itself logged (don't let a dropped alert hide a stuck user).
- **Permissions:** `PERM-support.view`/`.resolve`.
- **Surfaces:** `UI-SUPPORT-REQUESTS` + notification channel.
- **Observability:** notification-sent `event_log`.
- **Acceptance criteria:**
  - AC-0.REC.006.1 — Given a new support request, When it is created, Then all Super Admin + Admin users are notified.
- **Open decisions:** — (OD-019 resolved; unreachable-user escalation no longer applies — no credential change occurs here)
- **Feasibility assumptions:** —

### FR-0.REC.007 — Stale support-request re-escalation
- **Statement:** The system shall re-alert when a login-support request sits unactioned (status `pending`) past a configured threshold, so a stuck user is never silently abandoned.
- **Source:** quality-gate finding (Dim 10 human-in-the-loop + non-negotiable #3)
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** A scheduled check over open requests.
- **Preconditions:** A request has been `pending` longer than `CFG-support.stale_request_minutes`.
- **Behaviour:**
  - Happy path: a `pending` request older than the threshold → re-alert Super Admin + Admin (escalating channel).
  - Edge / failure: a request that is never picked up keeps re-alerting (bounded) rather than vanishing silently (#3).
- **Data touched:** `DATA-support_requests` (read); `event_log`.
- **Permissions:** N/A (system).
- **Config dependencies:** `CFG-support.stale_request_minutes`.
- **Surfaces:** `UI-SUPPORT-REQUESTS` (overdue indicator) + notification.
- **Observability:** re-escalation `event_log`.
- **Acceptance criteria:**
  - AC-0.REC.007.1 — Given a request `pending` past `stale_request_minutes`, When the check runs, Then Super Admin + Admin are re-alerted.
- **Open decisions:** —
- **Feasibility assumptions:** —

---

# WHK — Inbound webhook authentication

> **Seam (per entry-finalization + ADR-007):** C0 owns *authenticating* the webhook — verify
> signature → reject `401` on failure → log the failure as `prompt_injection`. The **content /
> payload handling** of a *verified* webhook belongs to the **ingesting component (C2/C3)**.
> ADR-007 homes HMAC verification to "connector ingress"; that is not a contradiction — C0 owns
> the **auth step** (a hard control that ignores prompt content), the ingest component owns **what
> the payload does**.
>
> **Owed elsewhere (quality-gate seam, OWED-FR-1):** C0 authenticates webhooks that *arrive*. Detecting
> a webhook that **never arrives** (provider outage / dropped delivery) is a **missed-trigger** concern —
> the failure-overlay's "loop heartbeat + catch-up" (design L2852). That belongs to **C2/C3 ingestion**
> or **C7 observability / C9 proactive**, *not* C0 auth. Explicitly parked here so it is not silently
> dropped at the auth boundary (#3). **RESOLVED — OD-104** (2026-06-28): owned by **C3 FR-3.TRIG.005** (watch
> re-arm) + **FR-3.TRIG.006** (event-gap detect + reconcile from watermark — "dropped/late events never become
> silent loss"), alerted via FR-3.DSC.006 → C7. No new FR; auth ≠ liveness. **OWED-FR-1 CLOSED.**

### FR-0.WHK.001 — Authenticate every inbound webhook before processing; reject unverified
- **Statement:** The system shall verify the authenticity of every incoming webhook before any payload is processed, and reject an unverified webhook with HTTP 401.
- **Source:** design-doc-v4.md L742; ADR-007 (webhook auth = a hard control)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Any inbound webhook to a connector endpoint.
- **Preconditions:** The connector's verification secret/keys are available (`DATA-webhook_secrets`).
- **Behaviour:**
  - Happy path: signature/JWT verified → hand the *verified* payload to the ingesting component (C2/C3).
  - Branches: per-connector mechanism — GHL (FR-0.WHK.002), Google (FR-0.WHK.003), Slack (FR-0.WHK.004).
  - Edge / failure: verification fails → reject `401`, **do not process**, log as `prompt_injection` (FR-0.WHK.005).
- **Data touched:** `DATA-webhook_secrets` (read); `guardrail_log` (write on failure).
- **Permissions:** N/A (machine-to-machine; the signature *is* the auth).
- **Config dependencies:** —
- **Surfaces:** N/A (operator sees failures via alerts, FR-0.WHK.005).
- **Observability:** verified → `event_log`; failed → `guardrail_log` (`prompt_injection`).
- **Acceptance criteria:**
  - AC-0.WHK.001.1 — Given an inbound webhook with an invalid/absent signature, When it arrives, Then it is rejected `401` and no payload processing occurs.
- **Open decisions:** — (OD-022 resolved → FR-0.WHK.007/008)
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-078 (end-to-end webhook verification across GHL/Google/Slack — raw-body capture before parse, constant-time compare, replay window — actually rejects forged/replayed events).

### FR-0.WHK.002 — GHL Ed25519 signature verification
- **Statement:** The system shall verify GHL webhooks by validating the **Ed25519** signature in the `X-GHL-Signature` header against GHL's **published public key**, and shall reject the legacy RSA `X-WH-Signature` header after its 2026-07-01 deprecation.
- **Source:** tool-integrations/gohighlevel.md §5 L95–98 (primary-source, 2026-06-25); ADR-007 OD-044 clarification note; design-doc-v4.md L747–763 (superseded for the algorithm)
- **Status:** Approved *(corrected 2026-06-25 via change-control — see note)*
- **Priority:** Must
- **Actor / trigger:** Inbound GHL webhook.
- **Preconditions:** GHL's published Ed25519 public key available to the verifier (the signing key is GHL's, not a per-client shared secret).
- **Behaviour:**
  - Happy path: read raw body (before JSON parse) → verify the `X-GHL-Signature` Ed25519 signature against GHL's published public key → valid → process.
  - Branches: a request bearing only the legacy `X-WH-Signature` (RSA) is rejected after the 2026-07-01 deprecation (transition handling before that date is a build concern under AF-090).
  - Edge / failure: invalid/missing signature → `401` + log `prompt_injection` "Unverified webhook rejected — GHL" (L763).
- **Data touched:** GHL published public key (read; not a secret); `guardrail_log` (write).
- **Permissions:** N/A.
- **Surfaces:** N/A.
- **Observability:** `guardrail_log` on failure.
- **Acceptance criteria:**
  - AC-0.WHK.002.1 — Given a GHL webhook whose `X-GHL-Signature` Ed25519 signature does not verify against GHL's published public key, When received, Then it is rejected `401` and logged as `prompt_injection`.
  - AC-0.WHK.002.2 — Given a GHL request bearing only the legacy `X-WH-Signature`, When received after 2026-07-01, Then it is rejected.
- **Open decisions:** — (OD-022 resolved → FR-0.WHK.007/008)
- **Feasibility assumptions:** ⚠️ AF-078 (webhook verification); ⚠️ AF-090 (exact Ed25519 signing input — shared with C3 FR-3.TRIG.004).
- **Notes:** **Change-control (OD-046, 2026-06-25):** the original FR specced **HMAC-SHA256**, which is stale — the GHL dossier established the RSA→Ed25519 migration (primary-source 2026-06-25). Corrected in place per OD-046; the design doc (L747–763) is superseded for the algorithm, the dossier is authoritative. Posture unchanged (verified authenticated ingress, a hard control per ADR-007 OD-044); only the algorithm + key model changed.

### FR-0.WHK.003 — Google Pub/Sub JWT verification
- **Statement:** The system shall verify Google push webhooks by validating the JWT signature against Google's public keys and checking audience and expiry.
- **Source:** design-doc-v4.md L765–777
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Inbound Google (Gmail/Drive/Calendar) Pub/Sub push.
- **Preconditions:** Expected audience value configured for this deployment.
- **Behaviour:**
  - Happy path: extract JWT from `Authorization` → verify signature via `https://www.googleapis.com/oauth2/v3/certs` → audience matches this deployment → not expired → process.
  - Edge / failure: any check fails → `401` + log.
- **Data touched:** Google JWKS (fetched); `guardrail_log` (write).
- **Permissions:** N/A.
- **Config dependencies:** `CFG-webhook.google_expected_audience`.
- **Surfaces:** N/A.
- **Observability:** `guardrail_log` on failure.
- **Acceptance criteria:**
  - AC-0.WHK.003.1 — Given a Google push whose JWT audience does not match this deployment, When received, Then it is rejected `401` and logged.
- **Open decisions:** — (OD-022 resolved → FR-0.WHK.007/008)
- **Feasibility assumptions:** ⚠️ AF-078.

### FR-0.WHK.004 — Slack signing-secret + timestamp verification (with replay window)
- **Statement:** The system shall verify Slack webhooks by rejecting requests whose timestamp is more than 5 minutes old, then computing HMAC-SHA256 over `v0:[timestamp]:[raw body]` with the Slack signing secret and constant-time-comparing to `X-Slack-Signature`.
- **Source:** design-doc-v4.md L779–792
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Inbound Slack webhook.
- **Preconditions:** Slack signing secret in `DATA-webhook_secrets`.
- **Behaviour:**
  - Happy path: timestamp within 5 min → build base string → HMAC → constant-time compare → match → process.
  - Edge / failure: stale timestamp (replay) **or** signature mismatch → `401` + log.
- **Data touched:** `DATA-webhook_secrets.secret_value` (secret_kind='slack_signing') (read); `guardrail_log` (write).
- **Permissions:** N/A.
- **Config dependencies:** `CFG-webhook.replay_window_seconds` (default 300).
- **Surfaces:** N/A.
- **Observability:** `guardrail_log` on failure.
- **Acceptance criteria:**
  - AC-0.WHK.004.1 — Given a Slack webhook with a timestamp older than 5 minutes, When received, Then it is rejected as a replay before signature checking.
  - AC-0.WHK.004.2 — Given a valid timestamp but a mismatched signature, When received, Then it is rejected `401` and logged.
- **Open decisions:** — (OD-022 resolved → FR-0.WHK.007/008)
- **Feasibility assumptions:** ⚠️ AF-078.
- **Notes:** The Slack *connector app class* (Marketplace vs internal-custom) is **OD-011**, resolved at the C3 Slack connector — not here. This FR is only the inbound auth check.

### FR-0.WHK.005 — Shared verification principles (raw body, constant-time, log, alert)
- **Statement:** The system shall, across all connectors, read the raw body before JSON parsing, use constant-time signature comparison, log every failed verification in `guardrail_log` as `prompt_injection`, and alert when more than 3 failures come from the same source within 1 hour.
- **Source:** design-doc-v4.md L795–809; ADR-007; **resolved by OD-023**
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Every webhook verification.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: raw-body-before-parse (parsing changes bytes → invalidates the signature); `crypto.timingSafeEqual` (never `===`).
  - Branches: ≥3 failures/source/hour → alert **all Super Admin** (a `prompt_injection` signal per ADR-007), **identify the source** by connector + endpoint token + source IP, and **auto-throttle that source** (OD-023).
  - Edge / failure: a single failure is logged immediately; the threshold governs *alerting + throttle*, not logging.
- **Data touched:** `guardrail_log` (write).
- **Permissions:** N/A.
- **Config dependencies:** `CFG-webhook.failure_alert_threshold` (default 3 / hour / source).
- **Surfaces:** alert surface (Phase 3).
- **Observability:** `guardrail_log` (`prompt_injection`) + threshold alert.
- **Acceptance criteria:**
  - AC-0.WHK.005.1 — Given a connector that parses then verifies, When tested, Then it fails the spec (raw body must be captured before parsing).
  - AC-0.WHK.005.2 — Given 4 failed verifications from one source within an hour, When the 4th arrives, Then a Super Admin alert fires, the source is identified (connector + token + IP), and the source is auto-throttled.
- **Open decisions:** — (OD-023 resolved; per-source accept-rate limit → FR-0.WHK.008)
- **Feasibility assumptions:** ⚠️ AF-078.
- **Notes:** Logging webhook-auth failures as `prompt_injection` is per ADR-007 (an unverified webhook is an injection attempt at the trust boundary).

### FR-0.WHK.006 — Webhook endpoint obscurity token
- **Statement:** The system shall include a deployment-specific random token in the webhook URL structure and shall not publish webhook endpoints in client-facing documentation.
- **Source:** design-doc-v4.md L811–815
- **Status:** Approved
- **Priority:** Could
- **Actor / trigger:** Endpoint provisioning.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: endpoint URL embeds a random per-deployment token; not documented publicly.
  - Edge / failure: obscurity is **not** a security control — it "raises the bar" only; the signature check (FR-0.WHK.001) is the real boundary.
- **Data touched:** deployment config (the URL token).
- **Permissions:** N/A.
- **Surfaces:** N/A.
- **Observability:** —
- **Acceptance criteria:**
  - AC-0.WHK.006.1 — Given a webhook endpoint, When inspected, Then its URL contains a per-deployment random token and it is absent from client-facing docs.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Explicitly labelled "not a security measure" in the design (L814) — captured so no later requirement leans on it as one.

### FR-0.WHK.007 — Webhook secret rotation (dual-accept window)
- **Statement:** The system shall support rotating a connector's webhook secret via the provisioning runbook with a dual-accept window during which both the old and new secret verify, so rotation causes no dropped events.
- **Source:** OD-022 (gap — design specifies verification but not rotation)
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** Operator rotating a webhook secret (runbook).
- **Preconditions:** `DATA-webhook_secrets` holds the per-connector secret(s).
- **Behaviour:**
  - Happy path: new secret added → both old and new accepted for the dual-accept window → old secret retired → only new accepted.
  - Edge / failure: a webhook signed with the retired secret after the window → rejected `401` + logged (FR-0.WHK.005).
- **Data touched:** `DATA-webhook_secrets` (versioned secret per connector) — read/write.
- **Permissions:** operator/runbook (service-role provisioning).
- **Config dependencies:** `CFG-webhook.secret_rotation_window`.
- **Surfaces:** N/A (runbook).
- **Observability:** rotation `audit`.
- **Acceptance criteria:**
  - AC-0.WHK.007.1 — Given a rotation in progress, When a webhook arrives signed with either the old or new secret within the window, Then it verifies; after the window, only the new secret verifies.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Auth-side rotation lives in C0; connector credential provisioning broadly is C3.

### FR-0.WHK.008 — Replay cache + per-source accept-rate limit
- **Statement:** The system shall reject already-seen webhook event IDs within a window (for connectors lacking a native timestamp defense) and apply a per-source accept-rate limit on verified webhooks.
- **Source:** OD-022 (gap)
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** Verified inbound webhook.
- **Preconditions:** Connector emits a stable event ID (GHL/Google); Slack already has the 5-min timestamp defense (FR-0.WHK.004).
- **Behaviour:**
  - Happy path: on a verified webhook, check the event ID against a replay cache → unseen → process + record; seen within the window → drop as a replay (logged).
  - Branches: a flood of *valid* events from one source → per-source accept-rate limit throttles (feeds the FR-0.WHK.005 alert/throttle).
  - Edge / failure: connector without a stable event ID → fall back to timestamp/window heuristics; note the residual gap.
- **Data touched:** replay cache (event IDs); `guardrail_log` on replay drop.
- **Permissions:** N/A.
- **Config dependencies:** `CFG-webhook.replay_cache_window`, `CFG-webhook.accept_rate_limit`.
- **Surfaces:** N/A.
- **Observability:** replay-drop + rate-throttle `event_log`.
- **Acceptance criteria:**
  - AC-0.WHK.008.1 — Given a verified webhook whose event ID was seen within the replay window, When it arrives again, Then it is dropped as a replay and logged.
  - AC-0.WHK.008.2 — Given verified webhooks from one source exceeding `accept_rate_limit`, When the limit is crossed, Then the source is throttled.
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ AF-078 (replay/rate handling proven end-to-end). Some ingest-side rate handling may live in C3.

---

## Parked cross-phase stubs (feed Phases 2–4)

### CFG- (Phase 2 — classify in config-edit-taxonomy)
| Key | Default | Notes |
|---|---|---|
| `CFG-auth.oauth_enabled` | true | bool |
| `CFG-auth.oauth_provider` | — | enum google\|microsoft |
| `CFG-auth.access_token_ttl` | 3600 s | floor 5 min; >1 h discouraged [SA2] |
| `CFG-auth.session_inactivity_timeout` | ~7–14 d idle | replaces `auth.session_refresh_days` (removed); Pro+, lazy enforcement [SA3] |
| `CFG-auth.session_absolute_timeout` | (operator-set) | Pro+; lazy enforcement [SA3] |
| `CFG-auth.two_factor_required` | true | **harness-implemented intent flag**, not a Supabase setting [SA9/AF-076] |
| `CFG-auth.mfa_softlock_threshold` / `_minutes` | 5 / (set) | 2FA wrong-code soft-lock (OD-017) |
| `CFG-auth.account_lockout_threshold` / `_minutes` | (set) | password-path per-account soft-lock (OD-018) |
| `CFG-auth.invite_link_ttl` | ≤24 h | native, **global** setting [SA11/AF-074] |
| `CFG-auth.seed_setup_link_ttl` | ≤24 h | couples with invite TTL [SA12] |
| `CFG-auth.captcha_enabled` | true | hCaptcha/Turnstile [AF-077] |
| `CFG-auth.leaked_password_protection` | true | Pro+ [AF-077] |
| `CFG-auth.smtp_*` | — | **SECRET; custom SMTP mandatory for prod** [SA14] |
| `CFG-webhook.replay_window_seconds` | 300 | Slack replay window |
| `CFG-webhook.replay_cache_window` / `accept_rate_limit` | (set) | GHL/Google replay cache + per-source rate (OD-022, FR-0.WHK.008) |
| `CFG-webhook.secret_rotation_window` | (set) | dual-accept rotation window (OD-022, FR-0.WHK.007) |
| `CFG-webhook.failure_alert_threshold` | 3 / hr / source | webhook alert + auto-throttle (OD-023) |
| `CFG-webhook.google_expected_audience` | — | per deployment |

### PERM- (defined in C1; referenced here, default-deny)
`PERM-user.invite` · `PERM-auth.provider_toggle` · `PERM-support.view` · `PERM-support.resolve`

### UI- (Phase 3)
`UI-LOGIN` (OAuth-primary + email/password fallback + "Trouble signing in?") · `UI-2FA-ENROLL` · `UI-2FA-CHALLENGE` · `UI-INVITE-SETUP` · `UI-REAUTH-PROMPT` · `UI-SUPPORT-REQUESTS` · `UI-USER-MGMT` · `UI-config-admin#auth`

### DATA- (Phase 4)
- `DATA-support_requests` (id, email, name, issue_description, status[pending|in_progress|resolved], assigned_to, created_at, updated_at) — **C0-owned**. *(No phone/contacted_by — the phone-verify flow is retired, OD-019.)*
- `DATA-webhook_secrets` (per-connector webhook secrets, **versioned** for rotation: `ghl_webhook_secret`, `slack_signing_secret`, Google audience) — read by WHK; broader connector creds are **C3**.
- `DATA-webhook_replay_cache` (seen event IDs + window) — FR-0.WHK.008.
- Supabase-managed: `auth.users`, `auth.identities`, `auth.mfa_factors`, session store (referenced, not owned).
- Shared: `guardrail_log` (webhook failures, `prompt_injection`), `event_log`, `audit`.
- *Dropped:* `DATA-invite_tokens` (OD-014 = native 24 h, no custom token layer).
- **Backup (ADR-008):** the C0-owned tables (`support_requests`, versioned `credentials`) live in the client's Supabase DB and are therefore covered by ADR-008's hourly off-platform snapshot + tested-restore posture — **no C0-specific backup FR is owed**. `credentials` are SECRET-class (ADR-001 custody); `webhook_replay_cache` is ephemeral (no backup needed). *(Reconciles quality-gate SHORTFALL-1.)*

### Glossary additions (made this session)
AAL / aal1 / aal2 · Refresh-token rotation + reuse-detection · Asymmetric JWT / JWKS local verification.
(*Custom invite-token layer* was **not** added — OD-014 resolved to native 24 h, so the term is unused.)

---

## Open decisions raised by this component (OD-012 … OD-023) — all 🟢 RESOLVED 2026-06-24

Resolutions recorded in `open-decisions.md`. Summary:
- **OD-012** 🟢 — native rotating refresh + inactivity/absolute timeout; `auth.session_refresh_days` removed.
- **OD-013** 🟢 — background work runs as **service_role** (per ADR-004/006).
- **OD-014** 🟢 — **24 h native** invite/setup links; no custom token layer.
- **OD-015** 🟢 — pursue **HttpOnly** (AF-073 gate); non-HttpOnly + mitigation is the fallback.
- **OD-016** 🟢 — **deployment-wide aal2**, no exemptions; OAuth users via IdP MFA.
- **OD-017** 🟢 — same-page challenge + 15/hr limit + app soft-lock after ~5 wrong codes.
- **OD-018** 🟢 — **OAuth-only for client-tenant users; password+2FA for external Super Admins only**; app soft-lock on the password path.
- **OD-019** 🟢 — dissolved by OD-018: phone-verify flow **retired** (FR-0.REC.004); generic support intake kept; notify Super Admin + Admin.
- **OD-020** 🟢 — one method at setup (add second later); expired→re-issue; admin revoke; audit-logged.
- **OD-021** 🟢 — seed = email+password+2FA (external bootstrap admin); recovery = env-change re-run.
- **OD-022** 🟢 — secret rotation (dual-accept, FR-0.WHK.007) + replay cache & accept-rate (FR-0.WHK.008).
- **OD-023** 🟢 — Super Admin alert + source identification + auto-throttle.

## FR roster after resolution + verification gate
- **42 live FRs** + **1 retired** (FR-0.REC.004). AUTH ×10 · SESS ×8 · INV ×7 · SEED ×3 · REC ×6 · WHK ×8.
- Added by the quality gate: **FR-0.AUTH.010** (audit completeness), **FR-0.INV.007** (email delivery/bounce), **FR-0.REC.007** (stale-request re-escalation); **FR-0.SEED.003 hardened** (atomic seed guard, ADR-004).
- All live FRs at **Status: Ready** (zero open ODs). Sign-off (`Approved`) pending user.

## Verification gate results (2026-06-24, two independent zero-context subagents)
- **Orphan/contradiction gate: CLEAN.** All 49 extracted design intents map to ≥1 FR; the 6 design-doc deviations are the intended Block-J corrections, each cited; RLS/`aal2` + webhook-ingress seams acknowledged; no unsupported claims.
- **Quality-bar / failure-overlay gate: 6 findings, all reconciled** — SHORTFALL-3 (seed race) → FR-0.SEED.003 hardened; SHORTFALL-2 (audit completeness) → FR-0.AUTH.010; SHORTFALL-4 (stale request) → FR-0.REC.007; OWED-FR-2 (email bounce) → FR-0.INV.007; OWED-FR-1 (missed webhook) → seam parked to C2/C3/C7; SHORTFALL-1 (backup) → covered by ADR-008 (cross-ref noted).
- **3 LOW items for sign-off confirmation:** (1) support-status enum renamed `contacted`→`in-progress` (the "contacted" state was tied to the retired phone-verify flow); (2) the design's "contact by phone" recovery channel is intentionally retired (OD-018/019); (3) external — ADR-007 still says webhook ingress is "component 1"; reconcile that cross-ref with the C0/C2/C3 homing.

## Remaining Phase-1 steps for this component
1. ✅ ODs resolved + ACs finalized.
2. ✅ Verification gate run (orphans clean; 6 quality findings reconciled).
3. Build `system-map/00-login.md` zoom-in.
4. Update `traceability-matrix.csv`; **user sign-off** (incl. the 3 LOW confirmations) → set FRs `Approved`; SESSION-LOG + commit.
