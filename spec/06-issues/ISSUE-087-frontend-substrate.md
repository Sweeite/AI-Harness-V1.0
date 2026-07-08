---
id: ISSUE-087
title: Frontend substrate — Next.js app-shell (client deployment + super-admin) that every surface renders into
epic: M — frontend
status: done
github: "#87"
---
# ISSUE-087 — Frontend substrate (the UI analog of ISSUE-008)

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR/surface spec and is read there. A builder with **zero conversation history** must be able to
> open the files named in the Context manifest and build this slice to its Definition of done
> **without guessing.** This issue exists because [[OD-197]] found that the plan specs all 13
> surfaces but never schedules the app they render into.

## 0. Context manifest (load only these)
- **[[OD-197]]** — the decision this issue implements: frontend as a parallel vertical-slice track; the logic/render split; the walking-skeleton milestone.
- `spec/source/design-doc-v4.md` — the locked UI stack: **Next.js (App Router) + Tailwind CSS + shadcn/ui**; "each project has one service: the Next.js app"; the Super-Admin dashboard "runs as its own separate deployment … its own Railway project, its own Next.js app, its own Supabase instance."
- `spec/00-foundations/adr/ADR-001-isolation-model.md` §3/§7 — physical isolation; the management plane is its **own** deployment (the client app and the super-admin app are two separate Next.js apps; `client_slug` is valid ONLY in the super-admin app's management plane).
- `spec/00-foundations/adr/ADR-009` — implementation stack (TypeScript/Node); `spec/00-foundations/adr/ADR-011-single-repo.md` — the product code lives in this single repo (so the Next.js app(s) live here alongside `app/*`).
- `spec/03-surfaces/surface-00-auth.md` — the auth surface (this issue wires the session; the auth *screens* are its render layer / ISSUE-013).
- `spec/05-non-functional/observability.md` — **NFR-OBS.011** (never-false-healthy) — the honest-state UI primitives this substrate must provide to every surface.
- `spec/05-non-functional/` — **NFR-A11Y.001** (accessibility baseline every surface inherits).
- The RBAC gate: `app/rbac/` (`can()` + `PERMISSION_NODES.md`) — the app-shell nav and per-panel gating **reuse these exact nodes**; the UI invents no auth logic (AF-080 non-drift — the UI must not become a second, divergent source of truth for permissions).

## 1. Goal (one line)
Stand up the **Next.js app substrate** — the client-deployment app and the separate super-admin app — that every surface (surface-00…12) renders into: routing + layout + Supabase auth session + an RBAC-driven app shell that reuses `can()`'s nodes + a typed data-access seam to the `app/*` backend packages + the shared honest-state/a11y UI primitives + a local dev harness. This is the UI analog of ISSUE-008 (the DB baseline): it builds **no screen's content**, but nothing renders without it.

## 2. Scope — in / out
**In:**
- **Two Next.js (App Router) apps** in this repo (ADR-001 §7, ADR-011): `web/client/` (the per-client deployment app) and `web/admin/` (the separate super-admin app). Tailwind + shadcn/ui configured in each. TypeScript strict (ADR-009).
- **Supabase auth session wiring** — server-side session (SSR-safe), the authenticated/anonymous split, sign-out, the `aal2`-aware session surface (consumes ISSUE-013's session logic + the ISSUE-020 aal2 posture; renders no auth *screen* — that is surface-00's render layer).
- **The RBAC-driven app shell** — the authenticated layout: left nav + top bar, where **each nav entry and each future panel is gated by a `can()` permission node** read from `app/rbac` (a denied node ⇒ the entry is **absent, not empty** — the FR-1.PERM.006 discipline the shell must make trivial for every surface to adopt). The UI reads the same node catalog the RLS/`can()` gate reads — it does not re-encode permissions.
- **The data-access seam** — a typed boundary (server actions / route handlers) through which surfaces call the `app/*` backend packages against the deployment's own Supabase (client app) or the management DB (admin app, `client_slug`-valid). One documented pattern surfaces reuse; no surface talks to the DB directly.
- **Shared UI primitives that encode the non-negotiables** — the **honest-state** components every panel/tile/feed uses (loading · stale · errored · "can't confirm") so that a failed/stale read **never renders a false-healthy "0"/"✓"/all-green** (NFR-OBS.011); the **answer-mode pill** primitive (NFR-OBS.012 seam); the theming (light/dark) + the **a11y baseline** (keyboard nav, contrast, semantic markup, no colour-only status — NFR-A11Y.001).
- **Local dev harness** — `npm run dev` per app against a local/seeded Supabase, plus the build wiring so each app deploys as the single Railway service the design doc names (composes with ISSUE-080/081 release/propagation; the live per-deployment deploy is verified there, not re-done here).

**Out:**
- **The individual surface screens** — every `surface-NN` render layer is its own deliverable (its owning issue's render sub-deliverable per [[OD-197]]); this issue builds the shell they mount into, not their content.
- **All business logic** — owned by the `app/*` packages (this issue *calls* them, builds none).
- **The auth/login screens** (surface-00 render → ISSUE-013), the management-plane lifecycle logic (ISSUE-012), releases/migrations/provisioning (ISSUE-080/081/007) — this substrate consumes them.

## 3. Implements (traceability spine — by ID, not restated)
- **Decision:** [[OD-197]] (frontend track + logic/render split). **Stack:** design-doc UI-stack lines; ADR-001 §7 (two apps), ADR-009 (TS), ADR-011 (single repo).
- **Serves (as the render host, does not own):** every `surface-00…12` and their FRs; the RBAC render-gate consumes FR-1.PERM.002/006 + the `app/rbac` node catalog; the honest-state primitives serve NFR-OBS.011; the answer-mode pill serves NFR-OBS.012; a11y serves NFR-A11Y.001.

## 4. Definition of done
- Both apps boot (`web/client`, `web/admin`), typecheck strict, and `npm run dev` serves an authenticated shell locally against a seeded Supabase.
- Auth: an unauthenticated visitor cannot reach the shell; a signed-in user lands on the RBAC-scoped shell; sign-out clears the server session; an `aal2`-required area is gated (renders the step-up, does not leak).
- **RBAC shell (the load-bearing AC):** the nav renders only the entries whose `can()` node the caller holds — a denied entry is **absent, not empty** — and the gating reads the **same** `PERMISSION_NODES` catalog `app/rbac` exposes (a test proves the UI gate and `can()` agree for a representative allowed/denied pair — no divergent second source of truth).
- **Honest-state primitives:** a forced failed/stale read in the shared component renders "can't load"/"stale" and **never** "0"/"✓"/all-green (the NFR-OBS.011 discipline, unit-proven on the primitive so every surface inherits it).
- The data-access seam calls a real `app/*` package end-to-end (e.g. renders one live signal) through the typed boundary — proving the pattern surfaces will reuse.
- A11y baseline passes on the shell (keyboard nav + contrast + semantic landmarks + labelled controls; no colour-only status) — NFR-A11Y.001.
- Theming (light/dark) works; the shell is responsive.

## 5. Touches (blast radius)
- **New:** `web/client/` and `web/admin/` (Next.js apps). **Consumes (no edits):** `app/rbac` (nodes + `can()`), the `app/*` packages the seam calls, ISSUE-013 session logic, ISSUE-020 aal2 posture.
- **PERM:** consumes existing nodes (Dashboard-Access + per-surface nodes already minted on the surface issues); **mints none**.
- **CFG/DATA:** read-only through the seam; authors no migration.

## 6. Definition of done — evidence to capture (§10)
Component/UI-state tests on the shell + the honest-state primitive; the RBAC-agreement test; the a11y audit result; a screenshot/ё of the booted shell in both themes.

## 7. Blocked-by
- **`007`** (provisioning — the Railway/Supabase the apps deploy to) ✅ done.
- **`013`** (OAuth login + session lifecycle — the session this substrate wires) ✅ done (offline; real-OAuth live-owed OD-175 — the substrate consumes the session logic; the live OAuth close is that issue's residual, not this one's).
- **`018`** (role model + `can()` + `PERMISSION_NODES`) ✅ done — the nodes the shell gates on.
- *(Not blocked by any Stage-5+ backend — a screen's render layer is gated on its own backend signal, not this substrate; this substrate only needs auth + RBAC.)*

## 8. Build order within the slice
1. Scaffold `web/client` (Next.js App Router + Tailwind + shadcn/ui, TS strict); repeat for `web/admin`. Shared config/tokens factored so both apps share the design system.
2. Wire the Supabase server-side session (SSR-safe) + the authenticated/anonymous split + sign-out + the aal2-aware guard.
3. Build the RBAC app shell: nav + top bar; the `can()`-node gate helper (absent-not-empty) reading `app/rbac`'s catalog; the RBAC-agreement test.
4. Build the shared honest-state primitives (loading/stale/errored/can't-confirm) + the answer-mode pill + theming; unit-prove the never-false-healthy behaviour.
5. Build the typed data-access seam; render one live `app/*` signal through it end-to-end.
6. A11y pass on the shell; local dev harness (`npm run dev`) documented; deploy wiring composed with ISSUE-080/081 (live deploy verified there).
7. Test to each §4 AC (component/UI-state + the RBAC-agreement + honest-state + a11y).

## 9. Verification (how DoD is proven)
- **Component/UI-state layer** (per `spec/05-non-functional/test-strategy.md`): the shell renders authenticated-only; the honest-state primitive never shows false-healthy on a forced failure; theming + responsive states render.
- **RBAC non-drift:** an automated check that the UI node-gate and `app/rbac`'s `can()` agree for allowed/denied cases (the UI is not a second source of truth for permissions — AF-080 spirit).
- **A11y:** the build-time a11y audit passes (NFR-A11Y.001).
- **Live:** `npm run dev` serves the shell against a seeded Supabase; one live signal renders through the seam. The live per-deployment **deploy** is proven in ISSUE-080/081, not re-done here.
- **Spike gate:** none.

## 10. Evidence — BUILT + verified (Session 78, 2026-07-08, 💻 FULL)

**Structure (skin-swappable per OD-197):** an `npm` workspace at `web/` with three packages —
- **`web/shared` (`@harness/web-shared`)** — the substrate core: `tokens.css` (the SWAPPABLE skin — every
  colour/type/spacing a CSS variable, light+dark, `[data-theme]` wins over OS), `components.css` (structural,
  token-only), the pure-logic core (`nav.ts`, `honest-state.ts`, `answer-mode.ts`, `seam.ts`) + thin React
  renderers (`components.tsx`, `theme.tsx`). No hardcoded styling in markup — dark-theme render is a pure token
  swap (proven, see screenshots) = a reskin, not a rebuild.
- **`web/rbac-bridge` (`@harness/rbac-bridge`)** — a workspace-internal adapter that re-exports the pg-free leaf
  modules of the REAL `@harness/rbac` (`store`/`can`/`catalog`), so the apps consume the ONE source of truth for
  permissions (AF-080 spirit). (Needed because Turbopack resolves workspace members but not a `file:` symlink
  outside the tree; `next.config` sets `turbopack.root` to the repo so `app/rbac/` is in-tree per ADR-011.)
- **`web/client` + `web/admin`** — the two Next.js (App Router, TS strict) apps (ADR-001 §7). Both boot, both
  typecheck clean.

**Tests / typecheck:** `web/shared` **11/11** offline tests green (`tsx --test`, the repo harness) — importing the
REAL `@harness/rbac`, not a copy. `tsc --noEmit` clean across shared / rbac-bridge / client / admin.

**§4 Definition-of-done — each item proven:**
- **Both apps boot + `npm run dev` serves the authenticated shell:** client on :3100, admin on :3200 — booted +
  driven this session.
- **Auth split:** unauthenticated `GET /` → **307 → /login** (middleware gate); sign-in establishes the server
  session → RBAC-scoped shell; **sign-out clears the session** (driven in-browser); **aal2 gate** — an aal1 Super
  Admin at `/config` gets the **step-up prompt and the config content does NOT leak**; aal2 renders it.
- **RBAC shell (load-bearing AC) — absent-not-empty + no second source of truth:** `nav.test.ts` proves the UI
  nav-gate agrees with `can()` **pairwise for every seeded role**, and every nav node ∈ `app/rbac`'s `CATALOG`
  (no invented permission). Live: Super Admin → **13** nav entries; Standard User → **1** (`/workspace` only);
  Admin in the management-plane app → **0** fleet entries. The UI reads the SAME `PERMISSION_NODES` catalog.
- **Honest-state primitives (never false-healthy, NFR-OBS.011 / OD-198 ③):** `honest-state.test.ts` proves no
  non-ok read is ever `healthy=true` and an errored/can't-confirm metric renders `—`, never `0`/`✓`. Visible on
  `/ops`: genuine 0 → "0 / Live"; errored → "— / Unavailable"; not-permitted → "— / Can't confirm"; a can't-confirm
  read is visibly distinct from a genuine zero.
- **Data-access seam calls a real `app/*` package end-to-end:** the home tile reads the caller's effective RBAC
  nodes THROUGH the typed `DataSeam` from the real `@harness/rbac` — Super Admin renders **55 nodes granted** live.
- **A11y baseline (NFR-A11Y.001):** accessibility tree shows semantic landmarks (`navigation`/`banner`/`main`),
  a skip-link, labelled controls (`aria-label` on icon buttons), headings/regions; status is never colour-only
  (every tone carries text + a glyph); single high-contrast `:focus-visible` ring; keyboard-navigable links/buttons.
- **Theming + responsive:** light/dark both render (screenshots captured both themes); rail collapses < 768px.

**Screenshots captured (both themes):** Super-Admin shell (13-entry sectioned rail, live 55-node signal) in light
and dark; the honest-state `/ops` tiles; the Standard-User shell (1-entry rail — absent-not-empty proof).

**Honest residual (flagged, not silent):** the shell boots against a **seeded-dev cookie session** (offline, the
"see it" path the issue permits). The real `@supabase/ssr` server-session path is **wired** (`lib/supabase-server.ts`,
activates when the deployment's Supabase env is present) but was **not live-verified against a running Supabase this
session** — that live-auth close is ISSUE-013's residual (real OAuth, **OD-175**) + the per-deployment deploy is
ISSUE-080/081's, exactly as this issue's §7 scopes it. The substrate introduces **no new live DB adapter** (the seam
calls `app/rbac`'s InMemory reference model), so **R10 is N/A here** — no `src/supabase-store.ts` is shipped.

**Deferred hygiene (trivial, non-blocking):** Next 16 deprecates the `middleware` filename in favour of `proxy`
(a warning only — the auth gate is verified working); rename is a cosmetic follow-up.

---
*Created session 77 (2026-07-08) per [[OD-197]] — the frontend-substrate gate the plan was missing. Opens the **Frontend track** (see BUILD-SCHEDULE.md). Each surface's **render** layer depends on this issue; the surface **logic** does not.*
