---
id: ISSUE-016
title: Support-request recovery intake
epic: B — identity & access
status: done
github: "#16"
---

# ISSUE-016 — Support-request recovery intake

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Deliver the human-in-the-loop login-recovery path: a public "Trouble signing in?" intake form that files a `support_requests` row, plus the authenticated Super-Admin/Admin queue that tracks, notifies on, and re-escalates those requests — so a locked-out user is never silently abandoned.

## 2. Scope — in / out
**In:** The whole C0 **REC** area (login support, "trouble signing in"). Concretely: the deliberate *absence* of any self-service/automated password reset (only "Trouble signing in?"); the public 3-field intake form (email, name, issue) that inserts a `pending` `support_requests` row; the authenticated `UI-SUPPORT-REQUESTS` queue with `PERM-support.view`-gated visibility; the pending → in_progress → resolved status machine (`PERM-support.resolve`-gated transitions, resolved = immutable history, actor+timestamp per transition); notification of all Super Admin + Admin on submit; and the scheduled stale-request re-escalation. Includes the `support_requests` table migration and its RLS (public INSERT-only pre-auth + read/resolve gated).

**Out:**
- **All credential/reset mechanics.** This slice holds no password to reset — client-tenant users are OAuth-only, external-Super-Admin password recovery is the bootstrap seed re-run. The old phone-verify-before-credential-change flow (FR-0.REC.004) is **RETIRED**, not implemented here.
- **OAuth login + session lifecycle + the `UI-LOGIN` shell / re-auth prompt** the "Trouble signing in?" link hangs off — owned by **ISSUE-013** (blocked-by).
- **External-Super-Admin recovery via env-change seed re-run** — owned by **ISSUE-015** (INV/SEED).
- **The `PERM-support.view` / `PERM-support.resolve` node definitions + `can()` gate + role→node matrix** — homed in **ISSUE-018** (C1 PERM). This slice *consumes* those nodes as stubs (default-deny); it does not define them.
- **RLS scaffold / helpers / default-deny baseline + coverage CI gate** — **ISSUE-009**. This slice authors only the `support_requests` policy on that scaffold.
- **Notification/alert channel plumbing + escalation routing engine** — the alert-engine + notification centre are **ISSUE-075 / ISSUE-076 (C7)**; this slice emits the notify/re-escalate events and relies on that channel.
- **Log sink schema / retention / export** for the `event_log` / `audit` writes — **C7**; this slice only writes the records.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-0.REC.001, FR-0.REC.002, FR-0.REC.003, FR-0.REC.005, FR-0.REC.006, FR-0.REC.007 (all Component 0 — Login & Authentication). *(FR-0.REC.004 is RETIRED, OD-019 — not in scope; ID not reused.)*
- **NFRs:** NFR-A11Y.001 (surface accessibility baseline for `UI-SUPPORT-REQUESTS`, per coverage ledger).
- **Rests on:** ADR-001 §2/§3/§5 (auth in client-owned Supabase; isolation by deployment, no `client_slug` column — OD-096); ADR-006 (login establishes `auth.uid()`; the queue is on the human RLS path); ADR-007 (a failed check is silent-to-attacker but logged, #3). No gating AF (the C0 gating AFs — AF-073/074/075/076/077/078 — attach to AUTH/SESS/INV/WHK, not REC).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-0.REC.001.1 (no self-service reset; only "Trouble signing in?")
- AC-0.REC.002.1 (form → `pending` request created + admins notified)
- AC-0.REC.003.1 (no `PERM-support.view` → queue access denied)
- AC-0.REC.005.1 (pending→in_progress→resolved with actor + timestamp per transition)
- AC-0.REC.006.1 (new request → all Super Admin + Admin notified)
- AC-0.REC.007.1 (request pending past `support.stale_request_minutes` → re-alert)
- **Gating spikes (if any):** none. (Blocked-by ISSUE-013 is a feature issue, not a spike.)

## 5. Touches (complete blast radius, by ID)
- **DATA:** `support_requests` (`.id`, `.email`, `.name`, `.issue_description`, `.status`, `.assigned_to`, `.created_at`, `.updated_at`); `support_status` enum (`pending` | `in_progress` | `resolved`). Writes to `event_log` (support-request-created, notification-sent, re-escalation) and `audit` (status transitions). **No `client_slug` column** (ADR-001 §3 / OD-096). **No phone / contacted_by** (OD-019).
- **PERM:** `PERM-support.view` (queue read), `PERM-support.resolve` (status transitions) — both default-deny, defined in ISSUE-018/C1; consumed here as stubs.
- **CFG:** `CFG-support.stale_request_minutes`.
- **UI:** `UI-SUPPORT-REQUESTS` (authenticated queue); the "Trouble signing in?" **form/modal** entry-point (public, rendered on `UI-LOGIN` which is owned by ISSUE-013).
- **Connectors:** none.

## 6. Context manifest (the EXACT files to open — nothing more)
- `spec/01-requirements/component-00-login.md` — the REC FR text + ACs (§REC).
- `spec/04-data-model/schema.md` §1 Identity & Auth — the `support_requests` table + `support_status` enum.
- `spec/04-data-model/rls-policies.md` — the `support_requests` RLS predicates (public INSERT-only pre-auth intake; read/resolve gated by `PERM-support.view` / `.resolve`).
- `spec/03-surfaces/surface-00-auth.md` §UI-SUPPORT-REQUESTS — the queue's data bindings, actions, states, and the "Trouble signing in?" modal (also carries OD-106 default ordering: overdue pinned top, then newest-first).
- `spec/00-foundations/adr/ADR-001-*.md`, `ADR-006-*.md`, `ADR-007-*.md` — isolation/secrets custody, RLS/`auth.uid()` seam, containment-first logging posture.

## 7. Dependencies
- **Blocked-by:** ISSUE-013 (OAuth login + session lifecycle + `UI-LOGIN` shell — provides the authenticated shell the queue lives in and the login page the "Trouble signing in?" link hangs off).
- **Blocks:** none (leaf).

## 8. Build order within the slice
1. **Migration** — add the `support_status` enum + `support_requests` table (schema.md §1) via the expand-contract harness (ISSUE-008). No `client_slug`, no phone/contacted_by.
2. **RLS policy** — on the ISSUE-009 scaffold, author the `support_requests` policies: **public INSERT-only** for the pre-auth intake form; SELECT/UPDATE gated by `PERM-support.view` / `PERM-support.resolve` (rls-policies.md). Default-deny baseline already ships from the scaffold.
3. **Intake FR logic (FR-0.REC.001, .002)** — the public 3-field submit path: validate → insert a `pending` row → emit `event_log` support-request-created. Confirm no native Supabase recovery/magic-link reset flow is reachable (FR-0.REC.001).
4. **Queue + status machine (FR-0.REC.003, .005)** — `PERM-support.view`-gated list; `PERM-support.resolve`-gated pending→in_progress→resolved transitions, each appending actor + timestamp to status history; resolved rows immutable.
5. **Notification (FR-0.REC.006)** — on insert, notify all Super Admin + Admin via the C7 notification channel (ISSUE-075/076); log notification-sent and log delivery failure (don't let a dropped alert hide a stuck user, #3).
6. **Stale re-escalation (FR-0.REC.007)** — scheduled check over `pending` rows older than `CFG-support.stale_request_minutes` → re-alert; emit re-escalation `event_log`.
7. **Surface wiring** — render `UI-SUPPORT-REQUESTS` per surface-00 §UI-SUPPORT-REQUESTS (overdue pinned top → newest-first, OD-106; error state must not render an empty list, #3) and wire the "Trouble signing in?" modal into the ISSUE-013 `UI-LOGIN`.
8. **Tests to the ACs** — cover AC-0.REC.001.1 / .002.1 / .003.1 / .005.1 / .006.1 / .007.1.

## 9. Verification (how DoD is proven)
- Per `spec/05-non-functional/test-strategy.md`: unit + integration for the intake insert and the status machine; an **RLS test** proving the public-insert / gated-read boundary (AC-0.REC.003.1 — a caller without `PERM-support.view` is denied; a public caller can insert but not read); a scheduled-job test for the stale re-escalation (AC-0.REC.007.1); an E2E path from the login-page "Trouble signing in?" modal through queue resolution.
- `AC-NFR-A11Y.001` posture must hold for `UI-SUPPORT-REQUESTS` (surface accessibility baseline). The AC→`Verified` path for this slice: each REC AC green + the RLS boundary test + the a11y baseline check, with no auth-relevant event left unlogged (#3, per FR-0.AUTH.010's completeness requirement homed in ISSUE-013).
