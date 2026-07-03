---
id: ISSUE-005
title: "SPIKE: brute-force / credential-stuffing defense stops an automated attack"
epic: S — spikes
status: ready
github: "#5"
---

# ISSUE-005 — SPIKE: brute-force / credential defense stops an automated attack

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Prove, against a runnable throwaway, that the external Super-Admin password+2FA login withstands a scripted credential-stuffing / brute-force attack — turning **AF-077** GREEN so ISSUE-014 may ship (one of the six OD-157/RP-1 launch-gate spikes).

## 2. Scope — in / out
**In:** A red-team / attack-simulation spike (throwaway harness against a live Supabase Auth project, no production code path required to survive) that exercises the brute-force posture the spec commits to — the app-layer per-account soft-lock (counter → temporary block + Super-Admin alert), the 2FA-challenge soft-lock, CAPTCHA on the login form, leaked-password protection, and the shared `/token` IP limit — and demonstrates that a scripted single-account attack **and** a multi-IP distributed attack are both halted before success, with the attempts logged + alerted. Deliverable is a **logged PASS/FAIL verdict + evidence** written into `spec/00-foundations/feasibility-register.md` (AF-077 → 🟢 or ⛔), plus the confirmed `account_lockout_threshold` / `account_lockout_minutes` / `mfa_softlock_threshold` values the build should adopt.

**Out:** The production login/session build itself — OAuth, email+password grant, TOTP enrollment/challenge, the actual soft-lock code, and `surface-00` — all owned by **ISSUE-013** (OAuth+session) and **ISSUE-014** (password + 2FA + brute-force defense). This spike **gates** ISSUE-014; it does not implement it. Webhook-forgery defense is a separate spike (**ISSUE-006** / AF-078). Deployment-wide `aal2` RLS coverage is AF-076/079 (POSTURE, not this spike).

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-0.AUTH.009 (component-00 login — the brute-force/credential-stuffing posture under test), FR-0.AUTH.007 (component-00 login — the 2FA-challenge soft-lock, since the attack target is the password+2FA path).
- **NFRs:** NFR-SEC.009 (brute-force / credential defense on the external Super-Admin path).
- **Rests on:** AF-077 (the assumption this spike exists to prove — no native per-account lockout on Supabase; confirm platform controls + app-layer soft-lock actually stop the attack), OD-018 (resolves the app-layer soft-lock + OAuth-only-for-tenant decision), ADR-007 (containment-first posture — the login path is a #2 trust boundary), [SA16] (feasibility-register Block J: no per-account lockout, no separate password-grant limit beyond the 1800/hr `/token` IP cap).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-NFR-SEC.009.1 (security.md — scripted attack halted before success, logged + alerted).
- AC-0.AUTH.009.1 (component-00 login — per-account soft-lock at threshold + Super-Admin alert).
- AC-0.AUTH.009.2 (component-00 login — CAPTCHA + leaked-password protection active on the form).
- AC-0.AUTH.007.3 (component-00 login — 2FA challenge soft-locks after `mfa_softlock_threshold` wrong codes).
- **Spike verdict logged:** AF-077 flipped to 🟢 (or ⛔ with the redesign it forces) in `feasibility-register.md` Block J/K, with the attack battery, evidence, and the confirmed threshold values recorded — per `test-strategy.md` §4 (the six go/no-go gates need a logged PASS with evidence).
- **Gating spikes (if any):** none — this issue **is** a launch-gate spike (SPIKE-GATE per RP-1); it has no upstream spike blocker.

## 5. Touches (complete blast radius, by ID)
- **DATA:** `event_log` (failed-login rate → security event; soft-lock trip; Super-Admin alert). *(Throwaway-harness scope — the spike observes/asserts these writes; the durable schema is C7 / ISSUE-011.)*
- **PERM:** none (the login path is pre-authorization; N/A per FR-0.AUTH.009).
- **CFG:** `CFG-auth.account_lockout_threshold`, `CFG-auth.account_lockout_minutes`, `CFG-auth.captcha_enabled`, `CFG-auth.leaked_password_protection`, `CFG-auth.mfa_softlock_threshold`.
- **UI:** UI-LOGIN (CAPTCHA presence assertion only; no surface build here).
- **Connectors:** none (Supabase Auth platform, not a client connector).

## 6. Context manifest (the EXACT files to open — nothing more)
- `spec/01-requirements/component-00-login.md` — FR-0.AUTH.009 + FR-0.AUTH.007 (statements, behaviour, config deps, ACs); the auth `CFG-*` table.
- `spec/05-non-functional/security.md` §NFR-SEC.009 — the posture + AC-NFR-SEC.009.1.
- `spec/05-non-functional/test-strategy.md` §2 + §4 — the "SPIKE-GATE" definition, the red-team/attack-sim test layer, and the six-gate logged-evidence bar.
- `spec/00-foundations/feasibility-register.md` Block J ([SA16], AF-077) + Block K — the exact platform facts (no per-account lockout; 1800/hr IP cap; CAPTCHA / leaked-password controls) and the register row to update with the verdict.

## 7. Dependencies
- **Blocked-by:** none (foundational spike — runnable against a bare Supabase Auth project; needs no other issue landed).
- **Blocks:** ISSUE-014 (Super-Admin password + TOTP 2FA + brute-force defense) — AF-077 must be GREEN before ISSUE-014 ships (per the backlog "Gate" column, OD-157/RP-1 spike sequencing 005 → 014).

## 8. Build order within the slice
1. Stand up a throwaway Supabase Auth project with the email+password + TOTP factor enabled; seed one external-Super-Admin test account.
2. Turn on the platform controls the posture names: CAPTCHA (hCaptcha/Turnstile) on the form (`captcha_enabled`), leaked-password protection (`leaked_password_protection`, Pro+), and confirm the shared `/token` IP limit (1800/hr) is in force.
3. Implement the minimal app-layer per-account soft-lock (failed-attempt counter → temporary block after `account_lockout_threshold`, unlock after `account_lockout_minutes`, fire a Super-Admin alert) and the 2FA-challenge soft-lock (`mfa_softlock_threshold`) — throwaway quality, only enough to measure the defense.
4. Build the attack battery: (a) scripted single-account credential-stuffing from one IP; (b) distributed multi-IP attack (IP limits alone insufficient — must lean on CAPTCHA + leaked-password + soft-lock); assert each is halted before a successful login.
5. Assert the observability hook: every attempt is logged and the threshold crossing raises a Super-Admin alert (`event_log`).
6. Record the verdict + evidence + the confirmed threshold values in `feasibility-register.md` (AF-077 → 🟢/⛔); if ⛔, capture the redesign it forces (change-control) — this is the DoD, not the app-layer code.

## 9. Verification (how DoD is proven)
- **Red-team / attack-simulation layer** (per `test-strategy.md` §1 taxonomy — "Red-team: an adversary cannot exceed the containment boundary … brute-force"): the scripted single-account + multi-IP batteries in step 4 are the test; PASS = neither achieves a session before lockout/backoff halts it.
- **Launch-gate bar** (`test-strategy.md` §4 #6): AF-077 shows a **PASS with evidence logged** in the feasibility register — until then AC-NFR-SEC.009.1 and the AUTH.009/007 ACs it holds are `Ready`, **not** `Verified` (the `AF → Verified` rule). Flipping AF-077 🟢 is what lets ISSUE-014's dependent ACs reach `Verified` and unblocks the ISSUE-014 build.
