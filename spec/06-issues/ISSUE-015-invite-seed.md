---
id: ISSUE-015
title: Invite + seed bootstrap
epic: B — identity & access
status: done
github: "#15"
---

# ISSUE-015 — Invite + seed bootstrap

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Deliver invite-only account creation and the first-boot Super-Admin seed: an Admin/Super-Admin invites a user (native ≤24 h link, custom SMTP), the user sets up their login method and is activated to their role-default view, and provisioning atomically seeds exactly one bootstrap Super Admin.

## 2. Scope — in / out
**In:** The two account-genesis paths, both C0-owned. (a) **Invite:** no self-registration; Admin/Super-Admin issues a native Supabase invite link bounded ≤24 h, delivered via custom SMTP with an explicit send-failure surface; the invited user opens `UI-INVITE-SETUP` and establishes **one** login method (client-tenant → connect OAuth; external Super Admin → email+password then TOTP enroll via `UI-2FA-ENROLL`); on setup completion the account activates and redirects to the role-default view; the invite lifecycle (expire/revoke/resend) and best-effort delivery-failure/bounce surfacing. (b) **Seed:** on first deployment boot, create the first Super Admin from `SUPER_ADMIN_EMAIL`, send a one-time ≤24 h setup link (reusing `UI-INVITE-SETUP`), under an **atomic** idempotency guard so concurrent boots cannot mint two admins and no UI path can re-trigger it.

**Out:**
- OAuth login mechanics, the email+password credential submission, 2FA enrollment/challenge *behaviour*, and session establishment — those FRs (FR-0.AUTH.006/007, FR-0.SESS.*) are **ISSUE-013** (OAuth login + session) and **ISSUE-014** (password + TOTP + brute-force). This slice **wires to** `UI-2FA-ENROLL` on the external-admin setup branch but does not implement the TOTP factor logic.
- The `PERM-user.invite` node definition + `can()` gate — homed in **ISSUE-018** (C1 permission matrix). This slice consumes the node as a gate; it does not define it.
- Role assignment and the "default view per role" definition — **C1 / ISSUE-018**. This slice reads the assigned role only to route the post-activation redirect (FR-0.INV.005 seam).
- `UI-USER-MGMT` (the invite-issuance admin surface) — rendered by **ISSUE-021** (user management lifecycle + surface-02). This slice provides the invite/revoke/resend behaviour it invokes.
- Full SMTP-provider bounce-webhook reconciliation — deferred to **OOS-015** (v1 ships the send-side guard as the primary #3 control; bounce surfacing is best-effort where the provider exposes it).

## 3. Implements (traceability spine — by ID, not restated)
- **FRs (component-00-login):** FR-0.INV.001, FR-0.INV.002, FR-0.INV.003, FR-0.INV.004, FR-0.INV.005, FR-0.INV.006, FR-0.INV.007, FR-0.SEED.001, FR-0.SEED.002, FR-0.SEED.003
- **NFRs:** none directly owned (auth-audit completeness is FR-0.AUTH.010 → ISSUE-013; invite/seed events feed it via `event_log`/`audit` writes below)
- **Rests on:** ADR-001 §2/§5 (auth + SMTP + secrets in the client-owned Supabase/Railway env, never operator custody), ADR-004 (atomic per-entity serialization / idempotency guard — the seed's TOCTOU close), ADR-006 (seed/setup run as `service_role` off the RLS path), AF-074 (24 h native link cap + global invite/OTP coupling — gating, see §4)

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-0.INV.001.1
- AC-0.INV.002.1
- AC-0.INV.003.1
- AC-0.INV.004.1, AC-0.INV.004.2
- AC-0.INV.005.1
- AC-0.INV.006.1, AC-0.INV.006.2
- AC-0.INV.007.1
- AC-0.SEED.001.1
- AC-0.SEED.002.1, AC-0.SEED.002.2
- AC-0.SEED.003.1, AC-0.SEED.003.2, AC-0.SEED.003.3
- **Gating spikes (if any):** none of the six OD-157 launch-gating spikes (ISSUE-001..006) block this issue. **Build-time AF:** `⚠️ AF-074` must be GREEN before ship — the ≤24 h link TTL and the global invite/OTP coupling are DOCS+SPIKE-verified on hosted Supabase (lowering the global slider actually shortens invite *and* seed links); this backs AC-0.INV.002.1 and AC-0.SEED.002.1. Related: AF-073 (HttpOnly) touches FR-0.SESS.005 in ISSUE-013, not this slice.

## 5. Touches (complete blast radius, by ID)
- **DATA:** `support_requests` (read via the "request a new link" fallback on invalid/expired setup token → routes to FR-0.REC.002 intake; this slice does not own the table — ISSUE-016 does — but the invite/setup error states link into it), Supabase-managed `auth.users`, `auth.identities`, `auth.mfa_factors` (referenced, never app-schema'd); `profiles` (activation writes/reads the mirror row). No custom invite-token table (dropped per OD-014 — native Supabase invite link only).
- **PERM:** `PERM-user.invite` (gate on issue/revoke/resend — node homed in C1/ISSUE-018)
- **CFG:** `auth.invite_link_ttl` (≤24 h global), `auth.seed_setup_link_ttl` (≤24 h, couples with invite TTL), `auth.smtp_*` (SECRET — custom SMTP, mandatory for prod), `auth.smtp_bounce_webhook` (optional, if provider supports it)
- **UI:** `UI-INVITE-SETUP` (invited user + reused for the seeded admin), `UI-2FA-ENROLL` (external-admin setup branch entry — behaviour owned by ISSUE-014); `UI-USER-MGMT` invite/revoke/resend actions are invoked here but rendered by ISSUE-021
- **Connectors:** none (custom SMTP is a delivery config, not a C3 connector)

## 6. Context manifest (the EXACT files to open — nothing more)
- `spec/01-requirements/component-00-login.md` — the INV + SEED FR text + ACs (and the REC.002 seam the setup error states link into)
- `spec/04-data-model/schema.md` §1 (Identity & Auth) — `profiles`, `support_requests`; the Supabase-managed `auth.*` tables referenced but not defined
- `spec/03-surfaces/surface-00-auth.md` — `UI-INVITE-SETUP` and `UI-2FA-ENROLL` sections (data bindings, actions, states, transitions)
- `spec/00-foundations/adr/ADR-001-*.md` — isolation + secrets custody (SMTP + auth secrets in the client project)
- `spec/00-foundations/adr/ADR-004-*.md` — atomic serialization / idempotency guard for the seed
- `spec/00-foundations/adr/ADR-006-*.md` — service_role off the RLS path (seed + setup)
- `spec/00-foundations/feasibility-register.md` — AF-074 (verification method + GREEN gate)

## 7. Dependencies
- **Blocked-by:** ISSUE-009 (RLS scaffold — default-deny + helpers must exist before `support_requests`/`profiles` policies and the public insert-only intake policy the setup error path relies on), ISSUE-013 (OAuth login + session lifecycle — the Option-A "connect OAuth" setup branch and the post-activation session both build on it). Neither is a spike.
- **Blocks:** none (leaf)

## 8. Build order within the slice
1. **Migration** (schema.md §1): ensure `profiles` and `support_requests` exist (landed by their owning issues; add only what activation needs — the `profiles` mirror row on setup completion). No custom invite-token table (OD-014).
2. **Seed script** (provisioning / ADR-005, runs as `service_role`): read `SUPER_ADMIN_EMAIL`; abort loudly if unset (FR-0.SEED.001); create the first Super Admin under an **atomic guard** — a DB unique constraint / `pg_advisory_xact_lock` per ADR-004 (FR-0.SEED.003) — no bare check-then-create; assign the Super Admin role (role table owned by C1).
3. **Seed setup link** (FR-0.SEED.002): `generateLink` → deliver via custom SMTP; ≤24 h via `auth.seed_setup_link_ttl` (AF-074); no-UI re-trigger — recovery is a deliberate env-change seed re-run guarded by the existence check.
4. **Invite issuance** (FR-0.INV.001/.002/.003): gate on `PERM-user.invite`; keep the Supabase public-signup toggle **off** (FR-0.INV.001); generate native ≤24 h link (`auth.invite_link_ttl`, AF-074); send via custom SMTP; **surface send-side failure explicitly** to the issuer (FR-0.INV.003 — #3 control, never a false "sent").
5. **Setup flow** (`UI-INVITE-SETUP`, FR-0.INV.004): validate token server-side → render method options by account type; **Option A** client-tenant connects OAuth (no password set); **Option B** external admin sets email+password → hand off to `UI-2FA-ENROLL` (TOTP behaviour = ISSUE-014); partial Option-B (password set, TOTP abandoned) must **not** activate (no half-provisioned account).
6. **Activation + redirect** (FR-0.INV.005): on setup completion, activate the account and redirect to the role-default view (read assigned role from `user_roles` — C1 seam).
7. **Invite lifecycle** (FR-0.INV.006): expired-link re-issue, pre-use revoke (revoking an already-used invite is a no-op), one-click resend; all `audit`-logged.
8. **Delivery-failure surfacing** (FR-0.INV.007): send-side guard is the primary control (step 4); wire best-effort bounce via `auth.smtp_bounce_webhook` where the provider exposes it → mark invite undelivered + re-alert issuer. Full bounce reconciliation is OOS-015.
9. **Observability hooks:** invite-issued/expired/revoke/resend + seed-run/seed-skipped → `audit`; activation + email send success/failure → `event_log` (feeds FR-0.AUTH.010 completeness owned by ISSUE-013).
10. **Tests** to every AC in §4.

## 9. Verification (how DoD is proven)
- **AF-074 GREEN gate** (`spec/00-foundations/feasibility-register.md`): DOCS+SPIKE on hosted Supabase confirming the 24 h hard cap, the global (not per-link) coupling, and that lowering the global slider shortens both invite and seed links — required before AC-0.INV.002.1 / AC-0.SEED.002.1 are `Verified`, per `spec/05-non-functional/test-strategy.md`.
- **Integration tests** (per `spec/05-non-functional/test-strategy.md`): invite-issue → SMTP send → setup (both Option A and Option B branches) → activation → role-default redirect; SMTP-not-configured yields an explicit issuer-visible failure (AC-0.INV.003.1); expired/used/revoked token renders the error state and routes to the support-request modal, not a blank/half-activated account.
- **Concurrency test** for the seed: two seed runs on first boot mint exactly one Super Admin (AC-0.SEED.003.3), re-boot is a no-op (AC-0.SEED.003.1), no UI trigger exists (AC-0.SEED.003.2) — proving the ADR-004 atomic guard closes the check-then-create TOCTOU.
- Each auth-relevant event in step 9 produces its `event_log`/`audit` record (the C0 side of no-silent-failure, #3).
