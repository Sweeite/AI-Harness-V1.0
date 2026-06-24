# Zoom-in: C0 Login & Authentication — "who you are"

This opens up the **front door** of the overview route (the gate every human request passes before
step 1, and the trust-boundary every inbound webhook passes). It reflects the accepted ADRs and the
C0 resolutions (OD-012…OD-023). Where this map and a future requirement disagree, the requirement
wins and this map gets updated (change control).

**Scope:** authentication only ("who you are"). Roles / permission matrix / RLS row-policies → **C1**;
connector OAuth token lifecycle (the AI's data access) → **C3**. The **seam** C0 hands forward is the
session establishing `auth.uid()` (which ADR-006's RLS keys on).

## The two doors

```
  HUMAN login (dashboard)                         MACHINE (inbound webhook)
        │                                                │
  ┌─────┴─────────────────────────┐              ┌───────┴───────────────────────┐
  │ client-tenant user → OAuth     │              │ verify signature (per connector)│
  │ external Super Admin → pw+2FA  │              │  GHL HMAC · Google JWT · Slack  │
  └─────┬─────────────────────────┘              └───────┬───────────────────────┘
        │                                                │  fail → 401 + guardrail_log
   2FA / aal2 elevation                                  │         'prompt_injection' + alert
        │                                                │  pass → hand verified payload to C2/C3
   session (JWT + rotating refresh, cookie)              │  (C0 owns the AUTH step only)
        │
   auth.uid()  ──────────►  handed to C1 (RBAC / RLS) and the rest of the route
```

## LOGIN flow — how a person gets in

```
  OAuth is PRIMARY (design L360); password is the SCOPED fallback (OD-018)
        ↓
  [client-tenant user]   → OAuth only (Google/Microsoft), tenant-pinned + email-verified (FR-0.AUTH.004)
  [external Super Admin]  → email+password (the ONLY non-OAuth path) → 2FA challenge (FR-0.AUTH.005/007)
        ↓
  [2FA / aal2]            deployment-wide required, BUILT not flagged: aal2 RLS + app gating (FR-0.AUTH.008)
                          OAuth users get the 2nd factor at the IdP; password accounts enroll TOTP
        ↓
  [session]               JWT access (1h) + refresh that ROTATES & never expires; reuse → whole-session
                          revoke; bound by inactivity/absolute timeout (FR-0.SESS.001–004)  [Block J/SA3]
        ↓
  [cookie]                stored in cookies, never localStorage; HttpOnly pursued (AF-073 gate) (FR-0.SESS.005)
        ↓
  auth.uid()  →  C1
```
- **The big correction (Block J):** "2FA required" is **not** a Supabase toggle and the "7-day refresh
  TTL" doesn't exist — both are re-modelled (FR-0.AUTH.008, FR-0.SESS.003/004). Six design-doc claims
  were corrected by dated research; each is cited from Block J, not the design doc.
- **Mid-task expiry:** a running task does **not** depend on the client session — background work runs as
  `service_role` (ADR-004 sole-writer / ADR-006 off-RLS path); user re-auths on next interaction (FR-0.SESS.006).

## ACCOUNT creation — nobody self-registers

```
  [invite]   Admin/Super Admin invites → ≤24h native link (OD-014) → custom SMTP (mandatory) → setup page
             one method at setup (client→OAuth, external admin→pw+2FA); add a 2nd later  (FR-0.INV.001–007)
  [seed]     first boot: SUPER_ADMIN_EMAIL → create the external bootstrap admin (pw+2FA), 24h setup link;
             runs once under an ATOMIC guard (ADR-004) so concurrent boots can't mint two; no UI re-trigger
             (FR-0.SEED.001–003)
```

## RECOVERY — human support, no automated reset (shrunk by OD-018)

```
  No self-service password reset (design L383).  Because client users are OAuth-only, the system holds
  NO client password to reset → IdP recovery handles them; the phone-verify-credential-change flow is RETIRED.
        ↓
  "Trouble signing in?" → generic login-support request (email/name/issue) → Super Admin+Admin notified,
   status pending→in-progress→resolved, stale requests re-escalate (FR-0.REC.001–007)
```

## WEBHOOK auth — the machine trust boundary (ADR-007 hard control)

```
  every inbound webhook AUTHENTICATED before any payload is processed (FR-0.WHK.001)
        ↓  raw body BEFORE parse · constant-time compare · per connector:
  GHL: HMAC-SHA256/X-GHL-Signature · Google: Pub/Sub JWT (keys+aud+exp) · Slack: signing-secret+5-min ts
        ↓
  fail → 401 + guardrail_log 'prompt_injection' ; >3/source/hr → Super Admin alert + auto-throttle (FR-0.WHK.005)
  extras: secret rotation dual-accept (007) · replay cache + accept-rate (008)
        ↓
  pass → verified payload handed to the ingesting component (C2/C3) — C0 owns the AUTH step only
```
- **Owed elsewhere:** a webhook that *never arrives* (provider outage) = a **missed-trigger** concern for
  C2/C3 ingestion / C7 observability (failure-overlay "loop heartbeat + catch-up", L2852) — parked, not C0.

## Where the decisions / config / surfaces live (for traceability)

- **ADRs:** 001 (Supabase-per-client, secrets custody), 004 (atomic guard for the seed race), 006
  (service-role bypass = mid-task continuation; `auth.uid()` seam to C1), 007 (webhook auth = hard control).
- **Research:** feasibility **Block J / SA1–17** (cite for all Supabase vendor facts), **AF-073–078**.
- **Config (Phase 2):** `auth.oauth_*`, `access_token_ttl`, `session_inactivity/absolute_timeout`,
  `two_factor_required`, `*_softlock/lockout_*`, `invite/seed_link_ttl`, `captcha/leaked_password`,
  `smtp_*` (SECRET), `webhook.replay_window/cache`, `accept_rate_limit`, `secret_rotation_window`,
  `failure_alert_threshold`, `support.stale_request_minutes`.
- **Surfaces (Phase 3):** `UI-LOGIN`, `UI-2FA-ENROLL/CHALLENGE`, `UI-INVITE-SETUP`, `UI-REAUTH-PROMPT`,
  `UI-SUPPORT-REQUESTS`, `UI-USER-MGMT`, `UI-CONFIG-AUTH`.
- **Data (Phase 4):** `support_requests`, versioned `credentials`, `webhook_replay_cache`;
  Supabase-managed `auth.*`. Covered by ADR-008 DB backup.
- **The three non-negotiables here:** #1 — C0 data under ADR-008 backup; #2 — tenant-pinning + no-aal1-bypass
  + atomic seed + getUser-on-revocation close the auth-bypass paths; #3 — send-failure surfacing, webhook
  alerts, stale-request re-escalation, audit-trail completeness (FR-0.AUTH.010) close the silent-failure paths.
```
