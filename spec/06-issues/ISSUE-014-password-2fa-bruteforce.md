---
id: ISSUE-014
title: "Super-Admin password + TOTP 2FA + brute-force defense"
epic: B — identity & access
status: blocked
github: "#14"
---

# ISSUE-014 — Super-Admin password + TOTP 2FA + brute-force defense

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Build the external Super-Admin **email+password** login path with **TOTP 2FA** (enroll + challenge) and the **brute-force / credential-stuffing defense** (CAPTCHA + leaked-password protection + per-account soft-lock + 2FA soft-lock), including the post-login app-layer `aal2` gating that forces enrollment/challenge before protected data.

## 2. Scope — in / out
**In:** The non-OAuth authentication slice for **external (operator-side) Super Admins only** — the one narrowly-scoped password path (FR-0.AUTH.005). Concretely: the email+password credential grant that hands off to a same-page TOTP challenge; TOTP enrollment via QR / manual-entry secret against Supabase MFA (`auth.mfa_factors`); the 2FA challenge that elevates a session to `aal2`, blocks on wrong/skipped code, and soft-locks after `mfa_softlock_threshold` wrong codes; the **app-layer** side of deployment-wide 2FA enforcement — post-login gating that forces an `aal1` session to enroll/challenge before it reaches protected surfaces (FR-0.AUTH.008 clause (a)); and the brute-force posture (FR-0.AUTH.009): hCaptcha/Turnstile on the password form, leaked-password protection, per-account soft-lock counter → temporary block + Super-Admin alert, riding on the shared `/token` IP limit. Renders the password/2FA sections of `surface-00`: the operator sign-in disclosure + CAPTCHA on **UI-LOGIN**, **UI-2FA-ENROLL**, and **UI-2FA-CHALLENGE**.

**Out:**
- OAuth login (FR-0.AUTH.001/002/004) and all session/token lifecycle (SESS) → **ISSUE-013**.
- The **RLS coverage** side of `aal2` enforcement (FR-0.AUTH.008 clause (b): the restrictive `aal='aal2'` predicate on every protected table, complete-coverage proof) → **ISSUE-020** (RLS enforcement) with the CI/coverage gate AF-076/AF-079; this issue owns only the app-layer forced-enroll/challenge gate.
- Invite/seed setup flow that provisions the password credential + TOTP factor (FR-0.INV.004, FR-0.SEED.002) and **UI-INVITE-SETUP** → **ISSUE-015**.
- The auth audit-completeness assertion (FR-0.AUTH.010) → **ISSUE-013** owns AUTH completeness instrumentation; this slice emits its own security `event_log` writes (soft-lock trips, rejected identities) into the shared sink.
- The definitive attack-simulation proof of the brute-force posture is the **ISSUE-005** spike (AF-077); this issue **builds** the defense, the spike **gates** it.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-0.AUTH.005, FR-0.AUTH.006, FR-0.AUTH.007, FR-0.AUTH.008 (app-layer gating clause only), FR-0.AUTH.009 (all component-00 login).
- **NFRs:** NFR-SEC.009 (brute-force / credential defense on the external Super-Admin path); NFR-SEC.010 (the human-path `aal2` denial clause — the app-gate half; the RLS-coverage CI gate is ISSUE-020's).
- **Rests on:** ADR-001 §2/§5 (auth runs in the client-owned Supabase project; secrets never operator-held), ADR-006 (session establishes `auth.uid()`; `aal` rides the RLS/session path), ADR-007 (login is a #2 trust boundary; a failed check is a hard control, silent-to-attacker but logged), OD-018 (OAuth-only for tenant users; password+2FA scoped to external Super Admins; app-layer soft-lock decision), OD-016 (deployment-wide 2FA, no per-user exemptions; OAuth users → IdP MFA), OD-017 (2FA challenge same-page, no bypass, soft-lock), AF-077 (brute-force posture — no native per-account lockout), AF-075 (Microsoft Authenticator RFC-6238 compatibility unconfirmed), [SA16] (feasibility-register Block J — no per-account lockout, no separate password-grant limit beyond `/token` 1800/hr IP cap).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-0.AUTH.005.1, AC-0.AUTH.005.2 (component-00 login)
- AC-0.AUTH.006.1 (component-00 login)
- AC-0.AUTH.007.1, AC-0.AUTH.007.2, AC-0.AUTH.007.3 (component-00 login)
- AC-0.AUTH.008.1 (component-00 login — the app-layer forced-enroll/challenge clause; AC-0.AUTH.008.2 complete-RLS-coverage is ISSUE-020's)
- AC-0.AUTH.009.1, AC-0.AUTH.009.2 (component-00 login)
- AC-NFR-SEC.009.1 (security.md)
- AC-NFR-SEC.010.2 (security.md — human-path below-`aal2` query denied; the app-gate expression)
- **Gating spikes (if any):** **AF-077 must be GREEN** (🟢 in `feasibility-register.md` Block J) before this issue ships — proven by the **ISSUE-005** brute-force spike per OD-157 / RP-1. Also carries **AF-075** as a fast-follow feasibility flag on TOTP enrollment (do not name Microsoft Authenticator as a guaranteed compatible app until verified).

## 5. Touches (complete blast radius, by ID)
- **DATA:** `auth.users`, `auth.mfa_factors`, `auth.sessions` (Supabase-managed — referenced, not migrated; schema.md §1); `event_log` (failed-login rate, soft-lock trip, rejected identity, 2FA enroll/challenge — write into the C7 sink, owned by ISSUE-011). No net-new app table (the soft-lock counter is app-layer state keyed off `auth.users`; no `client_slug` anywhere per ADR-001).
- **PERM:** none — the password/2FA/challenge sections are **public / pre-auth**; the credential/TOTP factor *is* the gate (surface-00 Access table).
- **CFG:** `auth.account_lockout_threshold` (default 5), `auth.account_lockout_minutes` (default 15), `auth.mfa_softlock_threshold` (default 5), `auth.mfa_softlock_minutes` (default 15), `auth.captcha_enabled` (default true), `auth.leaked_password_protection` (default true, Pro+), `auth.two_factor_required` (harness-implemented intent flag driving the app-layer gate). (All LIVE class; config-registry.md §auth; edited on surface-01 `#auth`, read-only here.)
- **UI:** `UI-LOGIN` (operator sign-in disclosure + CAPTCHA + soft-lock state), `UI-2FA-ENROLL`, `UI-2FA-CHALLENGE` (surface-00).
- **Connectors:** none.

## 6. Context manifest (the EXACT files to open — nothing more)
- `spec/01-requirements/component-00-login.md` — the AUTH FR text + ACs (FR-0.AUTH.005–009).
- `spec/03-surfaces/surface-00-auth.md` — UI-LOGIN (password/CAPTCHA sections), UI-2FA-ENROLL, UI-2FA-CHALLENGE states/actions.
- `spec/04-data-model/schema.md §1 (Identity & Auth)` — Supabase-managed auth tables referenced by this slice.
- `spec/05-non-functional/security.md` — NFR-SEC.009 (brute-force) + NFR-SEC.010 (`aal2` app-gate clause).
- `spec/02-config/config-registry.md §auth` — the seven CFG keys above (defaults + classes).
- `spec/00-foundations/feasibility-register.md` — AF-077 (gate, Block J) + AF-075 (TOTP compat flag).

## 7. Dependencies
- **Blocked-by:** ISSUE-009 (RLS scaffold — the `aal2`/session predicate rides the RLS path this slice's app-gate mirrors), ISSUE-005 (SPIKE — must flip AF-077 🟢 per OD-157/RP-1 before this ships).
- **Blocks:** none (leaf).

## 8. Build order within the slice
1. **Config wiring** — read the seven `auth.*` LIVE keys from `config_values` (surface-01 owns editing); defaults per config-registry §auth. `two_factor_required` is the harness intent flag, not a Supabase setting.
2. **Password grant (FR-0.AUTH.005)** — email+password sign-in for external Super-Admin accounts only; correct credentials do **not** grant a session — they advance same-page to the TOTP challenge. Client-tenant users have no password account (they hit OAuth, ISSUE-013).
3. **TOTP enrollment (FR-0.AUTH.006)** — issue the Supabase MFA `otpauth://` secret; render QR + manual-entry fallback on **UI-2FA-ENROLL**; verify a live code → factor enrolled, account `aal2`-capable. Compat hint must not name Microsoft Authenticator as guaranteed (AF-075).
4. **2FA challenge + soft-lock (FR-0.AUTH.007)** — same-page challenge (no redirect); correct code → elevate session to `aal2`; wrong/skipped → no session; after `mfa_softlock_threshold` consecutive wrong codes → temporary lock (`mfa_softlock_minutes`) + security `event_log`; respect Supabase's 15/hr MFA-verify ceiling.
5. **Brute-force defense (FR-0.AUTH.009)** — CAPTCHA (hCaptcha/Turnstile) on the password form when `captcha_enabled`; leaked-password protection on; build the **app-layer per-account soft-lock** (failure counter → temporary block at `account_lockout_threshold` for `account_lockout_minutes` + Super-Admin alert). CAPTCHA fail-closed: if the widget can't load, the password submit is disabled (surface-00 UI-LOGIN Partial state).
6. **App-layer `aal2` gate (FR-0.AUTH.008 clause (a))** — post-login, force an `aal1` session to enroll/challenge before any protected surface; only `aal2` reaches protected data. (The complementary restrictive-RLS coverage is ISSUE-020 — this slice does not author RLS policies.)
7. **Surface wiring** — UI-LOGIN operator disclosure + CAPTCHA + soft-lock/rejected states; UI-2FA-ENROLL; UI-2FA-CHALLENGE, all per surface-00 states.
8. **Observability hooks** — emit the security `event_log` writes (soft-lock trip, failed-login rate, 2FA enroll/challenge outcomes) into the ISSUE-011 sink; never a silent lock/reject (#3).
9. **Tests to the AC** — cover every AC-* in §4.

## 9. Verification (how DoD is proven)
- **Unit + integration** (`spec/05-non-functional/test-strategy.md`): the password→challenge handoff, TOTP enroll/verify, wrong/skipped-code blocking, both soft-locks (2FA + account), CAPTCHA fail-closed, and the app-layer `aal1`→forced-challenge gate — asserting each AC-0.AUTH.005/006/007/008.1/009 and AC-NFR-SEC.010.2.
- **Launch-gate spike (blocking):** AF-077 must be 🟢 in `feasibility-register.md` (proven by ISSUE-005's scripted single-account + multi-IP attack simulation) before ship — this closes AC-NFR-SEC.009.1. The confirmed `account_lockout_*` / `mfa_softlock_*` threshold values from that spike are the values this build adopts.
- **Fast-follow feasibility (AF-075):** if a client needs a named TOTP-app guarantee, enroll Microsoft Authenticator against a live project (EVAL); until then it is not named as guaranteed on UI-2FA-ENROLL.
- **AC→`Verified` path:** each listed AC moves to `Verified` when its test layer passes and (for NFR-SEC.009) AF-077 is GREEN.
