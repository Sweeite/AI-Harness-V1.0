---
id: ISSUE-088
title: Render surface-00 auth screens (login · 2FA · invite-setup · re-auth · support queue)
epic: M — frontend
status: done
github: "#88"
---
# ISSUE-088 — Render surface-00 (the auth trust boundary screens)

> **✅ BUILT + live-verified (Session 81, 2026-07-09) → `done`.** Rendered in `web/client` on the `087` dev-auth seam.
> `/login` (UI-LOGIN: OAuth-primary + collapsed operator disclosure OD-105 + **fail-closed CAPTCHA** — submit
> disabled with the exact copy when the widget fails + "Trouble signing in?" public insert-only support intake +
> same-page **UI-2FA-CHALLENGE** step + every login error state) · `/setup` (UI-INVITE-SETUP valid/expired/invalid +
> operator **UI-2FA-ENROLL** step, QR-fail→manual-secret) · **UI-REAUTH-PROMPT** modal/bottom-sheet (`?reauth=1`,
> mounted in the shell) · `/support-requests` authenticated queue (overdue-`pending` pinned OD-106, status filter
> chips, transitions gated on `PERM-support.resolve`). **Verified in-browser:** login→RBAC shell; support-queue
> fetch-failure (`?sim=error`) renders an error **not** a false-empty list (#3); the queue nav entry is **absent**
> for a caller without `PERM-support.view` and the direct URL **404s** (FR-1.PERM.006); setup token states; light+dark
> (pure token swap); a11y (dialog/tablist roles, labelled controls, focus rings). **No new live DB adapter → R10 N/A**
> (like `087`); real OAuth = OD-175 onboarding. Evidence: SESSION-LOG Session 81.

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build order that points into
> the repo by ID*. It does **not** restate `AC-*` text — that lives in the surface spec + FR and is read there. A
> builder with **zero conversation history** must be able to open the files in the Context manifest and build this
> slice to its Definition of done **without guessing.** Created session 80 by the [[OD-197]] `to-issues` render pass
> (the substrate `087` is done, so this surface's render layer is now schedulable — the logic it consumes is ISSUE-013).

## 0. Context manifest (load only these)
- `spec/03-surfaces/surface-00-auth.md` — the surface being rendered (the six sections + all load/error states + the ACs).
- [[ISSUE-087]] — the substrate this mounts into: `web/client` app shell + the Supabase server-session wiring + the honest-state/a11y primitives in `@harness/web-shared` + the RBAC nav gate. **Consume it; don't re-build it.**
- [[ISSUE-013]] (`app/token-lifecycle`/auth session — OAuth login + session lifecycle) + [[ISSUE-014]] (Super-Admin pw+2FA+brute-force) + [[ISSUE-016]] (`app/support-recovery` — the `support_requests` recovery logic) — the backend signal/logic this screen renders; already `done`.
- `spec/05-non-functional/observability.md` NFR-OBS.011 (never-false-healthy) + `spec/05-non-functional/` NFR-A11Y.001 (a11y baseline) — the substrate primitives every surface inherits.
- `app/rbac` — the `PERM-support.view`/`.resolve` nodes the authenticated support queue gates on (invents no auth).

## 1. Goal (one line)
Render surface-00 in **`web/client`** — the six auth-boundary sections (login · 2FA enroll · 2FA challenge · invite-setup · re-auth prompt · the authenticated support-request queue) — mounting into the `087` shell, consuming ISSUE-013/014/016's already-built session + support logic through the typed seam, so every rejection/lockout/throttle/dropped-notification is *visible, never a silent dead end* (#3) and no support-queue fetch failure ever renders as a false-empty "no one needs help".

## 2. Scope — in / out
**In:** the React render of surface-00's six sections per the spec: **UI-LOGIN** (`/login` — OAuth primary + a collapsed operator email/pw disclosure + a **fail-closed** CAPTCHA (submit disabled if the widget can't load) + a "Trouble signing in?" modal) · **UI-2FA-ENROLL** (QR + manual secret + code) · **UI-2FA-CHALLENGE** (same-page code step) · **UI-INVITE-SETUP** (`/setup?token`) · **UI-REAUTH-PROMPT** (a modal over the current page; a bottom sheet <768px) · **UI-SUPPORT-REQUESTS** (`/support-requests` — the authenticated queue, overdue-`pending` pinned top, OD-106). The pre-auth support-request intake writes through a **public insert-only** path (can insert, cannot read existing rows). Every state honest (#3): a queue fetch failure renders an explicit error, never an empty list; a failed notification is logged + re-surfaced.
**Out:** the **session/OAuth/2FA/brute-force LOGIC** (ISSUE-013/014 — this renders it, builds none) · the **live real-OAuth close** (OD-175, onboarding — this builds against the `087` seeded-dev session path + the wired `@supabase/ssr` path, live-verified at ISSUE-013's onboarding) · the `support_requests` recovery mechanics (ISSUE-016) · the app shell/session wiring (087).

## 3. Implements (traceability spine — by ID, not restated)
- **Surface:** `surface-00` (UI-AUTH). **FRs rendered:** FR-0.AUTH.001–009, FR-0.REC.001–003/005/006/007, FR-0.INV.004/005, FR-0.SEED.002/003, FR-0.SESS.003/004/006/007. **ACs:** AC-0.INV.004.1/.2 (+ the surface's own section ACs, read in the spec).
- **NFRs:** NFR-OBS.011 (honest-state — the substrate primitive) · NFR-A11Y.001 (a11y baseline) · non-negotiables #2/#3.
- **Consumes (renders, owns none):** ISSUE-013 session, ISSUE-014 2FA/brute-force, ISSUE-016 support-recovery, the `087` shell + seam + primitives, the `PERM-support.*` nodes.

## 4. Definition of done (the `AC-*`/state IDs that must pass — text read in the surface spec + FR)
- All six sections render per `surface-00-auth.md`, each with all its specified load/empty/error/partial/offline states.
- **#3 honesty:** a support-queue fetch failure renders an explicit error (never a false-empty "no requests"); a rejection/lockout/throttle is always surfaced; a failed recipient notification is logged + re-surfaced (the queue stays the durable source of truth).
- **Fail-closed CAPTCHA:** the login submit is disabled if the CAPTCHA widget fails to load.
- **RBAC absent-not-empty:** the support-queue nav entry is hidden and the direct URL 404s for a caller without `PERM-support.view` (FR-1.PERM.006); resolve/transition gated on `PERM-support.resolve`.
- **A11y + theming:** the `087` a11y baseline holds (keyboard nav, labelled controls, semantic landmarks, no colour-only status); light+dark render; re-auth is a bottom sheet <768px.
- **Gating spikes:** none. (Live real-OAuth is OD-175 onboarding, not a build gate — build on the `087` dev-auth/`@supabase/ssr` seam.)

## 5. Touches (blast radius, by ID)
- **New:** `web/client` routes/components for `/login`, `/setup`, the re-auth modal, `/support-requests`, and the 2FA enroll/challenge steps — all built from `@harness/web-shared` tokens/components (no hardcoded styling). **Consumes (no edits):** the `087` shell + `DataSeam` + honest-state primitives; ISSUE-013/014/016 logic; `app/rbac` nodes.
- **DATA:** read-only through the seam (`support_requests`, `auth.*` referenced-never-written). **Mints no node, authors no migration.**

## 6. Evidence to capture (§10)
Component/UI-state tests (each section's happy + error/partial/offline state); the fail-closed-CAPTCHA test; the RBAC-absent (hidden nav + 404) test for the support queue; the honest-state test (queue fetch failure ≠ empty); an a11y audit pass; screenshots of `/login` + the support queue in light+dark.

## 7. Blocked-by
- **`087`** (frontend substrate) ✅ done · **`013`** (session/OAuth logic) ✅ done · **`014`** (2FA/brute-force) ✅ done · **`016`** (support-recovery) ✅ done. *(No Stage-6+ backend — a render is gated only on `087` + its own backend signal, per the Frontend-track rule.)*
- **Blocks:** the walking-skeleton milestone (this is the auth entry of auth→Ops→User-Management).

## 8. Build order within the slice
1. `/login` (OAuth-primary + operator email/pw disclosure + fail-closed CAPTCHA + "Trouble signing in?" modal) on the `087` session seam.
2. The 2FA enroll + challenge steps; the invite-setup `/setup?token` flow; the re-auth prompt modal/bottom-sheet.
3. The pre-auth support-request intake (public insert-only) + the authenticated `/support-requests` queue (overdue-pinned, `PERM-support.*`-gated, honest-state on fetch failure).
4. A11y + theming pass; test to each §4 item.

## 9. Verification (how DoD is proven)
- **Component/UI-state layer** (per `spec/05-non-functional/test-strategy.md` + the `preview` tooling): each section renders its states; a forced queue-fetch failure renders an error, never empty; the CAPTCHA-fail path disables submit.
- **RBAC non-drift:** the support-queue gate reads `app/rbac`'s `PERM-support.view` (hidden + 404 when absent) — no second source of truth.
- **A11y:** the build-time a11y audit passes (NFR-A11Y.001). **Live real-OAuth = OD-175 onboarding**, not re-done here.
