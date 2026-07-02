# Surface: UI-AUTH (surface-00) — Authentication surfaces

**Status:** 🟢 **Signed off 2026-06-29** (operator-authorized — "sign off and commit and push to main"; OD-105–108 delegated "take all 4 recs"). Verification gate CLEAN (0 HIGH, 1 MED + 1 LOW patched). 2 of 14 Phase-3 surfaces complete.

> Consolidates the six pre-auth / auth-boundary surfaces from Component 0 (Login). Each is specced
> as its own section below: **UI-LOGIN · UI-2FA-ENROLL · UI-2FA-CHALLENGE · UI-INVITE-SETUP ·
> UI-REAUTH-PROMPT · UI-SUPPORT-REQUESTS**. Five of the six are **public / pre-auth**; the support
> *queue* (UI-SUPPORT-REQUESTS) is the one authenticated, PERM-gated section.

---

## Context manifest

- **Surface ID(s):** `UI-LOGIN`, `UI-2FA-ENROLL`, `UI-2FA-CHALLENGE`, `UI-INVITE-SETUP`, `UI-REAUTH-PROMPT`, `UI-SUPPORT-REQUESTS`
- **Owned by:** **C0 (Login & Authentication)** — the rendering target for all C0 AUTH/SESS/INV/SEED/REC FRs. (Role-default landing after login is a **C1** seam.)
- **FRs served:**
  - **UI-LOGIN** — FR-0.AUTH.001 (OAuth primary), FR-0.AUTH.002 (OAuth-only for client users; password path is external-admin-only), FR-0.AUTH.004 (identity-hardening rejection states), FR-0.AUTH.005 (email+password, external Super Admins), FR-0.AUTH.009 (CAPTCHA + per-account soft-lock), FR-0.REC.001 (no self-service reset), FR-0.REC.002 (the "Trouble signing in?" form entry-point)
  - **UI-2FA-ENROLL** — FR-0.AUTH.006 (TOTP QR enrollment)
  - **UI-2FA-CHALLENGE** — FR-0.AUTH.007 (TOTP challenge; wrong/skipped code blocks), FR-0.AUTH.008 (aal2 gating forces challenge before protected data)
  - **UI-INVITE-SETUP** — FR-0.INV.004 (setup page: choose OAuth or email+password+2FA), FR-0.INV.005 (activation → role-default view), FR-0.SEED.002 (reused for the seeded Super Admin's setup link)
  - **UI-REAUTH-PROMPT** — FR-0.SESS.003 (reuse-detection revocation → re-auth), FR-0.SESS.004 (lifetime-bound expiry → re-auth), FR-0.SESS.006 (mid-task continuation as service_role; prompt on next interaction), FR-0.SESS.007 (expiry → re-auth prompt, page state preserved)
  - **UI-SUPPORT-REQUESTS** — FR-0.REC.003 (queue visibility, Super Admin/Admin), FR-0.REC.005 (status pending→in-progress→resolved), FR-0.REC.006 (notify on submit), FR-0.REC.007 (stale-request re-escalation)
- **CFG dependencies** (all in `config-registry.md` group A/B/C; edited on `surface-01` `#auth`, read-only here):
  `auth.oauth_enabled`, `auth.oauth_provider`, `auth.two_factor_required`, `auth.captcha_enabled`,
  `auth.leaked_password_protection`, `auth.account_lockout_threshold`, `auth.account_lockout_minutes`,
  `auth.mfa_softlock_threshold`, `auth.mfa_softlock_minutes`, `auth.invite_link_ttl`,
  `auth.seed_setup_link_ttl`, `support.stale_request_minutes`
- **PERM gates:**
  - UI-LOGIN, UI-2FA-*, UI-INVITE-SETUP, UI-REAUTH-PROMPT — **public / pre-auth** (no node; the token/credential *is* the gate)
  - UI-SUPPORT-REQUESTS (queue) — entry `PERM-support.view`; resolve/transition `PERM-support.resolve` (both default-deny, defined in C1)
  - The "Trouble signing in?" **form** is public (pre-auth submission, FR-0.REC.002)
- **DATA bindings:**
  - `support_requests.{id,email,name,issue_description,status,assigned_to,created_at,updated_at}` (Phase 4 stub; C0-owned — **no phone/contacted_by**, OD-019)
  - Supabase-managed (referenced, never written by this surface): `auth.users`, `auth.identities`, `auth.mfa_factors`, session store
  - `event_log` / `audit` (sign-in, 2FA, support-request, re-auth events — write is C0/C7, this surface does not render them except where noted)
- **ADR constraints:**
  - ADR-001 §2/§5 — auth runs in the client-owned Supabase project; the surface holds no operator-side secret
  - ADR-006 — login establishes `auth.uid()` (the seam handed to C1); background work runs as `service_role` off the RLS path (underpins UI-REAUTH-PROMPT mid-task continuation)
  - ADR-007 — a failed identity check is a hard control; rejection is silent-to-the-attacker but logged (#3)

---

## Overview

surface-00 is the system's front door and trust boundary. An unauthenticated user lands on **UI-LOGIN**,
authenticates via OAuth (the only path for client-tenant users) or — for external operator-side Super
Admins — email + password followed by a **UI-2FA-CHALLENGE**. Invited users and the seeded first admin
arrive via **UI-INVITE-SETUP** to establish their login method (and, on the password path, enroll TOTP via
**UI-2FA-ENROLL**). An already-signed-in user whose session expires meets **UI-REAUTH-PROMPT** without
losing in-progress work. A stuck user files a support request from the login page; admins work those in the
**UI-SUPPORT-REQUESTS** queue. The governing rule across every section is non-negotiable #3: a rejection,
lock-out, throttle, or dropped email is **always made visible** — never a silent dead end.

---

## Access

> The five pre-auth sections have **no role** — the caller is unauthenticated. The Access table applies only
> to the **UI-SUPPORT-REQUESTS queue**, which is authenticated. Uses the six canonical C1 roles (FR-1.ROLE.001).

**UI-SUPPORT-REQUESTS (queue):**

| Role | Can enter? | Notes |
|---|---|---|
| Super Admin | Yes | Full queue; resolve/transition (holds `PERM-support.view` + `.resolve`) |
| Admin | Yes | Full queue; resolve/transition (holds `PERM-support.view` + `.resolve`) |
| Finance | No | No `PERM-support.*` by default → nav item hidden |
| HR | No | No `PERM-support.*` by default → nav item hidden |
| Account Manager | No | No `PERM-support.*` by default → nav item hidden |
| Standard User | No | No `PERM-support.*` by default → nav item hidden |

**Entry gate (queue):** `PERM-support.view` — callers without it never see the nav item and a direct URL returns 404.
**Pre-auth sections:** reachable by any unauthenticated caller; UI-INVITE-SETUP and UI-2FA-ENROLL additionally
require a valid token / in-progress setup context (an invalid/expired token renders the error state, not the form).

---

## Layout

These are **standalone full-page routes**, not items in the authenticated app shell (the sidebar/chrome does
not render pre-auth):

- `UI-LOGIN` → `/login` — centered single-column card on a neutral full-bleed background; product mark on top.
- `UI-INVITE-SETUP` → `/setup?token=…` — same card chrome as login.
- `UI-2FA-ENROLL` → step within the setup flow (`/setup` → enroll step); not a directly-navigable URL.
- `UI-2FA-CHALLENGE` → same-page step of `/login` (no redirect — FR-0.AUTH.007); the card swaps to the code field.
- `UI-REAUTH-PROMPT` → **modal overlay** rendered *over the current authenticated page* (so page state is
  preserved, FR-0.SESS.007); it is not a route.
- `UI-SUPPORT-REQUESTS` → `/support-requests` — a normal in-app surface inside the authenticated shell
  (sidebar item "Support Requests"), visible only to gated roles.

The **"Trouble signing in?"** form is a **modal launched from UI-LOGIN** (not a separate route), so a stuck
user never has to authenticate to reach help.

---

## Sections

---

### UI-LOGIN — Sign in

**Purpose:** Authenticate a returning user; route the two populations (client-tenant → OAuth; external Super
Admin → email+password+2FA) and give a stuck user a way out.

**Data bindings:**

| Element | Source | Notes |
|---|---|---|
| OAuth button (primary) | `auth.oauth_enabled`, `auth.oauth_provider` (read) | Rendered first/primary; label + icon follow the provider (Google / Microsoft). Hidden iff `oauth_enabled=false` |
| Operator sign-in (email + password) | static; visibility per `auth.oauth_enabled` | Secondary path; collapsed behind an "Operator / admin sign-in" disclosure (OD-105) — the external-admin path, not for client users |
| CAPTCHA widget | `auth.captcha_enabled` (read) | hCaptcha/Turnstile on the password form when enabled (FR-0.AUTH.009) |
| "Trouble signing in?" link | static (FR-0.REC.002) | Opens the support-request modal (below) |
| Provider/error copy | client-side from auth result | See states; helper/error strings bind to the canonical auth-error copy (DRY) — never re-typed per-locale here |

> **DRY rule for human-readable text.** Error and helper strings (e.g. "This account isn't permitted to sign
> in here", lock-out copy) bind to a single canonical auth-copy source, not duplicated per section.

**Actions:**

| Action (label) | What it does | PERM gate |
|---|---|---|
| Continue with [Google\|Microsoft] | Initiates OAuth (FR-0.AUTH.001); on a verified, tenant-pinned identity → session established → role-default view (C1 seam). Unverified-email or wrong-tenant identity → rejected to the error state (FR-0.AUTH.004) | Public |
| Sign in (email + password) | Submits external-admin credentials (FR-0.AUTH.005); correct → advances **same-page** to UI-2FA-CHALLENGE; wrong → error + failed-attempt count toward soft-lock (FR-0.AUTH.009) | Public (only external-admin accounts have a usable password) |
| Trouble signing in? | Opens the support-request modal (3 fields: email, name, issue) → creates a `pending` `support_requests` row (FR-0.REC.002) | Public |

**Real-time / poll:** Static on page load; auth result is on-demand (user-initiated). No subscription.

**States:**
- **Loading:** Card with a disabled, spinner-bearing OAuth button while the redirect/handshake is in flight; password submit shows an inline spinner.
- **Empty:** N/A — the form is always present. If `oauth_enabled=false` *and* no operator path is exposed, show "Sign-in is not configured for this deployment. Contact your administrator." (a config/provisioning error, never a blank card).
- **Error:**
  - *Bad credentials* — "Email or password is incorrect." (deliberately not distinguishing which — #2).
  - *Rejected identity* (FR-0.AUTH.004: wrong tenant / unverified email) — "This account isn't permitted to sign in here." Logged as a security `event_log` entry; the user is **told it was rejected** (visible failure, #3), not left spinning.
  - *Soft-locked* (FR-0.AUTH.009) — "Too many attempts. This account is temporarily locked. Try again in N minutes or use 'Trouble signing in?'." A Super Admin alert fires server-side.
  - *OAuth handshake failed* — "Sign-in with [provider] didn't complete. Try again." with a retry.
- **Partial:** If the CAPTCHA widget fails to load while `captcha_enabled=true`, the password **submit is disabled** with "Couldn't load the security check — refresh to retry." (fail-closed; never let the password path through without the configured CAPTCHA — #2). OAuth remains available.
- **Offline / stale:** No network → "You appear to be offline. Check your connection and try again." Submit disabled; no silent hang.

---

### UI-2FA-ENROLL — Set up two-factor authentication

**Purpose:** Let an **external Super Admin** (password path) enroll a TOTP authenticator during setup
(FR-0.AUTH.006). Client-tenant OAuth users do **not** see this — their second factor is asserted at the IdP (OD-016).

**Data bindings:**

| Element | Source | Notes |
|---|---|---|
| QR code | Supabase MFA `otpauth://` enrollment secret (`auth.mfa_factors`, server-issued) | Rendered as a scannable QR; the secret is never persisted by this surface |
| Manual-entry secret | same enrollment secret | Text fallback for users who can't scan |
| Confirmation code field | user input | 6-digit TOTP; verified against the pending factor |
| Compatible-app hint | static | "Use an authenticator app (e.g. Google Authenticator)." ⚠️ Microsoft Authenticator is **unconfirmed** (AF-075) — do not name it as guaranteed |

**Actions:**

| Action (label) | What it does | PERM gate |
|---|---|---|
| Verify & enable | Submits the confirmation code; valid current code → factor enrolled, account becomes `aal2`-capable (FR-0.AUTH.006), continue to activation; wrong code → error, retry | The enrolling user (token-scoped) |

**Real-time / poll:** Static; verification is on-demand. No subscription.

**States:**
- **Loading:** Skeleton where the QR will render while the enrollment secret is requested.
- **Empty:** N/A — enrollment always has a secret. If secret generation fails: "Couldn't start two-factor setup. Try again." with retry (never proceed without an enrolled factor on a 2FA-required deployment — #2).
- **Error:** Wrong/expired code → "That code didn't match. Codes refresh every 30 seconds — try the current one." Field stays, retry unlimited at this step (the gate is the later challenge's soft-lock, not enrollment).
- **Partial:** QR image fails but secret string loaded → show the manual-entry secret prominently with "Can't see the QR? Enter this key in your app instead." (graceful degrade).
- **Offline / stale:** "You're offline — two-factor setup needs a connection." Verify disabled.

---

### UI-2FA-CHALLENGE — Enter your authentication code

**Purpose:** After correct email+password, require a valid TOTP code before a session is granted; no bypass
(FR-0.AUTH.007). Also the surface an `aal1` session is forced through when reaching protected data on a
2FA-required deployment (FR-0.AUTH.008).

**Data bindings:**

| Element | Source | Notes |
|---|---|---|
| Code field | user input | 6-digit TOTP; same-page (no redirect from the password step) |
| Attempts-remaining hint | derived from `auth.mfa_softlock_threshold` minus consecutive failures | Shown only as the threshold approaches (e.g. last 2 attempts) so the user isn't blindsided by the lock (#3) |

**Actions:**

| Action (label) | What it does | PERM gate |
|---|---|---|
| Verify | Submits the code; correct → session elevated to `aal2` → granted → role-default view; wrong → blocked + increment failure counter; skipped/omitted → no session (FR-0.AUTH.007) | The authenticating user |

**Real-time / poll:** Static; verification on-demand.

**States:**
- **Loading:** Inline spinner on Verify while the code is checked.
- **Empty:** N/A — the code field is always present; there's no fetched data set that could be empty.
- **Error:**
  - *Wrong code* — "That code is incorrect." with remaining-attempts hint as the soft-lock nears.
  - *Soft-locked* (after `mfa_softlock_threshold`, default 5, consecutive wrong codes) — "Too many incorrect codes. Try again in `mfa_softlock_minutes` minutes." A security `event_log` entry is written (FR-0.AUTH.007). The lock is **shown**, never a silent rejection (#3).
  - *Supabase MFA-verify ceiling* (15/hr [SA16]) — same locked treatment with the platform message folded in.
- **Partial:** N/A (single control).
- **Offline / stale:** "You're offline — we can't verify your code right now." Verify disabled; the half-authenticated state does **not** silently grant access.

---

### UI-INVITE-SETUP — Set up your account

**Purpose:** An invited user (or the seeded first Super Admin, FR-0.SEED.002) opens their link and establishes
a login method, then is activated and routed to their role-default view (FR-0.INV.004/.005).

**Data bindings:**

| Element | Source | Notes |
|---|---|---|
| Invite/setup token validity | Supabase OTP/invite token (server-validated) | Drives form-vs-error; native ≤24 h link (`auth.invite_link_ttl` / `auth.seed_setup_link_ttl`) |
| Method options | derived from account type | Client-tenant → Option A (connect OAuth); external Super Admin → Option B (email+password → enroll TOTP). One method at setup (OD-020) |
| Assigned role (for redirect) | `user_roles` (read; **C1-owned**) | Used only to choose the post-activation landing (FR-0.INV.005) |

**Actions:**

| Action (label) | What it does | PERM gate |
|---|---|---|
| Connect with [provider] (Option A) | Client-tenant user connects OAuth identity → account activated, no password set (AC-0.INV.004.2) → role-default view | Token-scoped invited user |
| Set password & continue (Option B) | External admin sets email+password → proceeds to **UI-2FA-ENROLL** → on enroll, account activates (AC-0.INV.004.1) → role-default view | Token-scoped invited user |

**Real-time / poll:** Static; activation on-demand.

**States:**
- **Loading:** Card skeleton while the token is validated server-side.
- **Empty:** N/A — a validated token always resolves to method options to render; an invalid/expired token is the Error state below, not an empty one.
- **Error:**
  - *Invalid / already-used token* — "This setup link is no longer valid." with "Request a new link" → opens the support-request modal (FR-0.REC.002). The seeded-admin recovery path is a deliberate env-change re-run (FR-0.SEED.003), surfaced to the operator as guidance, not a self-service button.
  - *Expired token* (>24 h) — "This setup link has expired (links are valid for up to 24 hours)." → "Request a new link".
- **Partial:** Option B password set but TOTP enrollment abandoned → the account is **not** activated (no half-provisioned account, #2); re-opening the still-valid link resumes at enrollment.
- **Offline / stale:** "You're offline — account setup needs a connection." Actions disabled.

---

### UI-REAUTH-PROMPT — Session expired, please sign in again

**Purpose:** When an authenticated user's session expires/revokes, prompt re-auth **without losing in-progress
work** (FR-0.SESS.007), while any already-running server-side task continues as `service_role` (FR-0.SESS.006).

**Data bindings:**

| Element | Source | Notes |
|---|---|---|
| Trigger | client session state (expired / reuse-revoked) | Lifetime-bound expiry (FR-0.SESS.004) or reuse-detection revocation (FR-0.SESS.003) |
| Preserved page context | current client page state | Unsaved form input retained where technically possible (FR-0.SESS.007) |
| Background-task note | optional | If a task the user kicked off is still running, "Your earlier action is still being processed and will finish." (reflects service_role continuation, FR-0.SESS.006) |

**Actions:**

| Action (label) | What it does | PERM gate |
|---|---|---|
| Sign in again | Re-runs the appropriate login path (OAuth or operator) **in the modal where possible**; on success the modal closes and the preserved page state is restored (FR-0.SESS.007); OAuth that requires a full redirect returns to the same route post-redirect | Public (the user re-proving identity) |

**Real-time / poll:** Event-driven — the prompt appears the moment a request returns an expired/revoked session (lazy, at next interaction/refresh, per FR-0.SESS.004); not polled.

**States:**
- **Loading:** Re-auth in progress → spinner on the modal's primary button; the underlying page stays rendered (dimmed) so context is visibly preserved.
- **Empty:** N/A — the modal only renders once triggered by an expired/revoked session, so a sign-in path is always present.
- **Error:** Re-auth fails → "We couldn't sign you back in." with retry; the user stays logged out with no partial/ambiguous state (FR-0.SESS.007). Reuse-detection revocations (FR-0.SESS.003) show "For your security, this session was ended. Please sign in again."
- **Partial:** Some preserved fields restorable, others not → restore what's possible and flag "Some unsaved changes couldn't be restored." rather than silently dropping them (#3).
- **Offline / stale:** "You're offline — reconnect to sign back in." The page stays in its dimmed preserved state; nothing is discarded.

---

### UI-SUPPORT-REQUESTS — Login support queue

**Purpose:** Where Super Admins / Admins see and resolve login-support requests so a locked-out user is never
silently abandoned (FR-0.REC.003/.005/.006/.007). The intake **form** is public (on UI-LOGIN); this **queue**
is authenticated and gated.

**Data bindings:**

| Element | Source | Notes |
|---|---|---|
| Request rows | `support_requests.{email,name,issue_description,status,assigned_to,created_at,updated_at}` | Listed newest-first with overdue requests pinned to top (OD-106) |
| Status badge | `support_requests.status` | `pending` / `in-progress` / `resolved` (FR-0.REC.005) |
| Overdue indicator | `created_at` vs `support.stale_request_minutes` | A `pending` row older than the threshold is flagged overdue (FR-0.REC.007) |
| Assignee | `support_requests.assigned_to` | Who picked it up (set on the pending→in-progress transition) |

**Actions:**

| Action (label) | What it does | PERM gate |
|---|---|---|
| Pick up (→ in-progress) | Sets `status=in-progress`, `assigned_to=caller`; appends to status history with actor + timestamp (FR-0.REC.005) | `PERM-support.resolve` |
| Resolve (→ resolved) | Sets `status=resolved`; resolved rows are immutable history (FR-0.REC.005) | `PERM-support.resolve` |
| (Invalid transitions) | Blocked — e.g. resolved→pending is rejected | — |

> This queue is **not** a credential-reset tool (OD-019) — an admin resolves a request by checking the user's
> access/membership/role, not by resetting a password the system doesn't hold.

**Real-time / poll:** **Polls** (same cadence family as the other non-Realtime surfaces, FR-7.RTP.002) — this is
**not** one of the product's two Realtime/WebSocket surfaces (those are surface-04's approval queue and
surface-07's notification centre, FR-7.RTP.001/AC-7.RTP.001.3, OD-163). A new `pending` request appears on the
next poll / on-demand refresh, and on submit all Super Admin + Admin are notified in-dashboard + email
(FR-0.REC.006).
**If a notification fails to send**, the failure is logged and re-surfaced rather than swallowed (FR-0.REC.006 —
"don't let a dropped alert hide a stuck user"); the request still lands in this queue regardless, so a delivery
failure never loses the request itself. Notification *delivery* mechanics are a C7 seam — this surface owns only
that the queue remains the durable source of truth (#3).

**States:**
- **Loading:** Skeleton list rows while `support_requests` is fetched.
- **Empty:** "No open support requests." — the healthy zero-state (no CTA needed).
- **Error:** Fetch failure → "Couldn't load support requests." with retry; **does not** render an empty list (which would falsely read as "no one needs help" — #3).
- **Partial:** List loads but a poll cycle is missed/delayed → show "Live updates paused — showing data as of [time]. Refresh for the latest." (stale-but-labelled, never silently frozen).
- **Offline / stale:** Connectivity lost → the stale banner above; actions disabled until reconnect so an admin doesn't think a resolve landed when it didn't.

---

## Navigation / transitions

| Trigger | Destination |
|---|---|
| UI-LOGIN → "Continue with [provider]", verified identity | role-default dashboard view (C1 seam, FR-0.INV.005) |
| UI-LOGIN → correct email+password | UI-2FA-CHALLENGE (same page) |
| UI-LOGIN → "Trouble signing in?" | support-request modal (creates `support_requests` row) |
| UI-2FA-CHALLENGE → correct code | role-default dashboard view |
| UI-INVITE-SETUP → Option B "Set password & continue" | UI-2FA-ENROLL |
| UI-2FA-ENROLL → "Verify & enable" | account activated → role-default view |
| UI-INVITE-SETUP / UI-2FA-* error → "Request a new link" | support-request modal |
| Authenticated `aal1` session reaches a protected surface (2FA-required deployment) | UI-2FA-CHALLENGE (forced enroll/challenge before data, FR-0.AUTH.008) |
| Authenticated page, session expires | UI-REAUTH-PROMPT (modal over current page) |
| UI-REAUTH-PROMPT → "Sign in again", success | back to preserved page state |
| Support-request submitted | notification to Super Admin + Admin → UI-SUPPORT-REQUESTS |

---

## Mobile

All five pre-auth sections are single-column cards that already work on narrow viewports — no dedicated mobile
treatment needed; the QR (UI-2FA-ENROLL) keeps its manual-entry secret fallback for users authenticating on the
same device. **UI-REAUTH-PROMPT** renders as a full-width bottom sheet rather than a centered modal on
< 768 px. **UI-SUPPORT-REQUESTS** (the authenticated queue) collapses each request to a stacked card; its full
mobile dashboard treatment is covered in `surface-12-mobile.md`. No section is out of scope on mobile.

---

## Open decisions

**All resolved 2026-06-29 (operator: "take all 4 recs").**

| # | Question | Resolution |
|---|---|---|
| OD-105 🟢 | On UI-LOGIN, how prominent is the external-admin email+password path? | **(a)** Collapsed behind an "Operator / admin sign-in" disclosure; OAuth shown primary. Client-tenant users are OAuth-only (FR-0.AUTH.002); a visible password form invites a path they have no account on. |
| OD-106 🟢 | Default ordering / filtering of the UI-SUPPORT-REQUESTS queue | **(a)** Overdue `pending` pinned top, then newest-first; status filter chips. FR-0.REC.007 makes "overdue" first-class — surfacing it by default is the #3 expression for this queue. |
| OD-107 🟢 | Does UI-2FA-ENROLL issue recovery/backup codes? | **(a)** No backup codes in v1 — the only TOTP accounts are external Super Admins, who recover via the env-change seed re-run (FR-0.SEED.003). Deferral logged → **OOS-039** (not a silent omission). |
| OD-108 🟢 | UI-REAUTH-PROMPT: modal-inline re-auth vs full-page redirect | **(a)** Re-auth inside the modal where possible (preserves page state); full redirect only when the OAuth provider forces it, returning to the same route. FR-0.SESS.007 requires preserving page state with no data loss. |

---

## Phase 4 data binding notes

- **`support_requests`** — `id` (pk), `email` (text), `name` (text), `issue_description` (text),
  `status` (enum `pending|in-progress|resolved`, default `pending`), `assigned_to` (fk users, nullable —
  null while `pending`), `created_at`, `updated_at`. RLS: readable/writable only with `PERM-support.view` /
  `PERM-support.resolve`; public **insert** allowed for the pre-auth intake form (FR-0.REC.002) — Phase 4 must
  define an insert-only public policy that cannot read existing rows. `created_at` + `status` drive the overdue
  computation (OD-106/FR-0.REC.007) — index `(status, created_at)`.
- **Supabase-managed** (`auth.users`, `auth.identities`, `auth.mfa_factors`, session store) — referenced, not
  defined by Phase 4; no app-table schema owed.
- **No `client_slug` column** on `support_requests` (ADR-001 §3 / OD-096 — isolation is by deployment, not a column).
- Notification fan-out for FR-0.REC.006/.007 reads the Super Admin + Admin role membership (`user_roles`, C1) —
  the recipient resolution is a C1/C7 seam, not a new C0 table.
