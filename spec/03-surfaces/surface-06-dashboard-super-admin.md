# Surface: UI-DASHBOARD-SUPER-ADMIN (surface-06) — Super Admin Management Plane (Fleet)

**Status:** 🟢 **Signed off 2026-06-30** (operator: "yes sign off"). **7 of 14 Phase-3 surfaces complete.** OD-125–128 🟢
(operator "take all four recommendations"). **Verification gate (independent zero-context
subagent, checks a–f): CLEAN-WITH-FIXES — 0 HIGH · 0 MED · 3 LOW (all reconciled).** Coverage, CFG wiring, DATA (the
`client_slug`-valid-here claim verified against ADR-001 §3/§7 + FR-10.MGT.001/ISO.001/OFF.006), PERM (the 5 `PERM-fleet.*`
nodes recorded), the #2/#3 false-healthy sweep, and all seams PASS. The 3 LOW were citation-precision fixes: AC-7.MGM.002.4
re-tagged **AF-120 (clock-sync)** not AF-118 (which is the independent-heartbeat liveness on .002.3); Backup-Health
re-tagged **AF-069/AF-070** (restore-works / mgmt-API fields) not AF-071; the two-person-auth parent **FR-10.DEL.003**
added alongside AC-10.DEL.006. The seventh Phase-3 surface and the **only
cross-deployment surface in the product** — the external operator's fleet console, running on the **separate
management deployment** (ADR-001 §7), not on any client silo. Where surface-05 is one deployment's instrument panel,
surface-06 is the **map of every deployment**: a grid of client cards fed by the push-only management-plane ingest
(FR-7.MGM.001–005 / FR-10.MGT.001–004), plus the operator workflows that act *across* the fleet — releases, migrations,
provisioning, cost, backup, and the destructive client-offboarding sequence. **OD-125 mints five management-plane PERM
nodes via change-control** (`PERM-fleet.view/.provision/.promote_release/.offboard/.rotate_token`) — closing a real
Rule-0 gap (C7/C10 named the operator/Super-Admin holder of every fleet action in prose but bound **no `PERM-` node** to
any of them). OD-126–128 resolved in-file. **This is the one surface where `client_slug` is valid** (it lives only in
`client_registry`, ADR-001 §3/§7 — never in an app table; OD-096). Next OD: OD-129.

> The **Super Admin management plane** — the operator's fleet console. It renders, across deployments, only what the
> push-fed management store holds: per-deployment **health · alerts · version/CI-CD · migration status · provisioning
> status · cost · backup health · registry/offboarding lifecycle**. Its two defining rules are the two non-negotiables
> it most directly serves. **#2 — the management plane is a map, not a warehouse** (FR-10.MGT.003): *only operational
> metadata crosses* from a client deployment (health score, queue depth, alert counts, core version, connector status,
> cost-to-date) — **no client business data ever** (no memories, entity content, message text, sensitive data). To
> "look inside a client" the operator **clicks through and logs into that client's own dashboard, under that client's
> RBAC** — the fleet console never reads client business data. **#3 — a deployment that has gone dark must never read
> as healthy** (FR-7.MGM.002): a card with no recent push flips to `stale`/`unreachable`, evaluated on an *independent*
> heartbeat against a *server-authoritative* timestamp; a **frozen** (offboarding) deployment is shown **expected-quiet,
> not dead-alert and not green** (AC-10.OFF.004.4). It does **not** render any single-deployment ops panel (that is
> surface-05), the approval queue (surface-04), or per-client business content — those are seams.

---

## Context manifest

- **Surface ID:** `UI-DASHBOARD-SUPER-ADMIN` (minted here — FR-7.VIEW.002 named "the Super Admin (cross-deployment)
  dashboard" by description and FR-7.MGM.003 defined "a deployment health grid" but assigned no formal `UI-` id; this
  is its surface. The operator's planning-doc `s-c-*` control-plane screens — Fleet Clients, Deploys, Health,
  Provisioning, Migrations, Cost, Plugins — all map here.)
- **Owned by:** **C7 (Observability)** for the cross-deployment *signals* (FR-7.MGM.001–005: the health push, staleness,
  grid, cross-deployment alerts + CI/CD, backup-health + cost overview) and the poll/transport contract (FR-7.RTP.002);
  **C10 (Infrastructure & Compliance)** for the *management-plane substrate + lifecycle* (FR-10.MGT.001–004 the
  `client_registry` + ingest endpoint + token lifecycle, FR-10.DEP.* releases, FR-10.MIG.* migrations, FR-10.PRV.*
  provisioning, FR-10.OFF.* offboarding, FR-10.ISO.* isolation/residency). The surface renders the C10-owned registry +
  the C7-owned push-fed health store; it **never pulls a client endpoint** (AC-10.MGT.002.3) and **never reads client
  business data** (FR-10.MGT.003).
- **FRs served:**
  - **The cross-deployment signals (C7 MGM):** FR-7.MGM.001 (**outbound health push** — operational-metadata-only; each
    push attempt/failure also logs to the deployment's *own* `event_log`, AC-7.MGM.001.3 — a disconnected deployment
    surfaces its condition locally too), FR-7.MGM.002 (**push staleness → `stale`/`unreachable`, never silently green**;
    raises a cross-deployment alert AC-7.MGM.002.2; the staleness check runs on an **independent heartbeat** AC-7.MGM.002.3
    ⚠️ AF-118; against a **server-authoritative timestamp** AC-7.MGM.002.4 ⚠️ AF-120 (clock-sync)), FR-7.MGM.003 (**the deployment health
    grid** — one card per active deployment: health score, last active, open alerts, approval-queue depth, core version;
    from pushed snapshots only, **no pull**; click-through into the client AC-7.MGM.003.2), FR-7.MGM.004 (**cross-deployment
    critical alerts + CI/CD status** — per-deployment core version + last-push status), FR-7.MGM.005 (**backup-health
    (via the Supabase Management API) + cross-deployment cost overview** — estimate-grade, labelled as estimates).
  - **The poll contract (C7 RTP):** FR-7.RTP.001 (**this surface is NOT one of the two Realtime surfaces** — those are
    the approval queue (surface-04) + the notification centre (surface-07); the fleet console **polls** the push-fed
    management store), FR-7.RTP.002 (per-surface configurable cadence), FR-7.RTP.004 (a stale/failed poll shown honestly
    — adopted as each card/panel's offline/stale state).
  - **The cross-deployment alerting (C7 ALR):** FR-7.ALR.004 (every alert logged), FR-7.ALR.007 (C7 delivers the
    C5/C6-emitted alerts), FR-7.ALR.008 (**the alert engine is itself watched** — heartbeat + independent watchdog;
    a stalled engine raises a critical condition carried on the push AC-7.ALR.008.2 ⚠️ AF-118), FR-7.ALR.009 (**routing
    configured; an unroutable alert fails loud** — persists on the dashboard + raises an "alert delivery misconfigured"
    critical condition routed to Super Admin + the push AC-7.ALR.009.1; a config write that would strand a critical
    alert is rejected fail-closed AC-7.ALR.009.3).
  - **The management plane (C10 MGT):** FR-10.MGT.001 (**`client_registry`** — the *only* place client identity exists,
    ADR-001 §3: `id`, `client_slug`, `client_name`, `railway_url`, `internal_token` (encrypted), `core_version`,
    `region`, `status` ∈ {initialising, active, offboarding, frozen}, `created_at`, `offboarding_at`; status is timestamped
    on every lifecycle transition AC-10.MGT.001.2; `internal_token` encrypted at rest AC-10.MGT.001.3), FR-10.MGT.002
    (**the ingest endpoint** — receives the per-deployment push, authenticates by `internal_token`, **push-only +
    operational-metadata-only**, idempotent on re-delivery; rejects + logs an invalid/missing token AC-10.MGT.002.2;
    **reads its own store, never pulls a client** AC-10.MGT.002.3), FR-10.MGT.003 (**push-only boundary — a map, not a
    warehouse**: only operational metadata crosses; to inspect a client the operator clicks through into that client's
    dashboard under the client's RBAC AC-10.MGT.003.2), FR-10.MGT.004 (**`internal_token` lifecycle** — minted at
    provisioning, dual-stored encrypted, **rotatable** without losing push continuity, revoked on deprovision).
  - **The release model (C10 DEP):** FR-10.DEP.001 (Railway per-project auto-deploy; GitHub Actions is a *test merge
    gate*, not a deployer), FR-10.DEP.002 (**the canary + release-train promotion gate** — promote (fast-forward)
    `release`→`main` only when tests green **+** clean canary migration **+** green smoke battery **+** elapsed
    `canary_soak_minutes`; **deliberate operator action** in v1, OD-094), FR-10.DEP.003 (**rollback = redeploy the prior
    Railway build**; schema rolls *forward* — no destructive down-migration), FR-10.DEP.004 (**version reporting + the
    max-skew alert** — fires when a deployment is > `deploy_max_version_skew` behind **or** > `deploy_max_skew_days`
    stale; a laggard is caught, never silently drifting), FR-10.DEP.005 (**plugins stay out of the release train** —
    per-deployment, version-reported so plugin drift is visible; automated distribution → OOS-033).
  - **Migration propagation (C10 MIG):** FR-10.MIG.001 (per-deployment migrate-on-release against its own Supabase,
    independently), FR-10.MIG.002 (**per-deployment migration-failure isolation** — a failure halts *only* that
    deployment, prior version stays live, an alert fires, **never silent** AC-10.MIG.002.2, no other client affected).
  - **Provisioning (C10 PRV):** FR-10.PRV.001 (**the operator-side provisioning flow** — Railway link → config/secrets →
    **mint + dual-store `internal_token`** → insert the `client_registry` row → first deploy runs the idempotent seed,
    status `initialising`; **idempotent + loud on partial failure**; operator-side only, no self-registration
    AC-10.PRV.001.2), FR-10.PRV.002 (per-client OAuth app registration in the *client's* accounts), FR-10.PRV.003 (the
    canary = a seeded synthetic client, the promotion-gate fixture), FR-10.PRV.004 (the client-side onboarding runbook).
  - **Isolation + residency (C10 ISO):** FR-10.ISO.001 (**`client_slug` deleted from all app tables** — identity exists
    only in `client_registry`; OD-096's terminus: the column is not created), FR-10.ISO.003 (**residency** — v1 region
    lock Sydney `ap-southeast-2`, recorded per deployment in `client_registry.region`, selectable in v2).
  - **Offboarding (C10 OFF):** FR-10.OFF.001 (**Step 1 — initiate** (Super-Admin); `status` → `offboarding`,
    `offboarding_initiated_at`), FR-10.OFF.002 (**Step 2 — export, verified-complete before any deletion**; an
    unverifiable export **blocks** the sequence AC-10.OFF.002.4 — #1), FR-10.OFF.003 (encrypted time-limited delivery +
    **client receipt sign-off** before retention; expired link surfaced not silently dead AC-10.OFF.003.2; no sign-off →
    held + escalated AC-10.OFF.003.3), FR-10.OFF.004 (**Step 3 — retention freeze**: data retained frozen for
    `client_offboarding_retention_days` (90); C5 freeze-gate writes/runs nothing (OD-091); **frozen ≠ dead** —
    server-authoritative `status` shown expected-quiet, not green, not a dead-alert AC-10.OFF.004.4; reactivation within
    the window unfreezes), FR-10.OFF.005 (**Step 4 — hard-delete + deprovision**: truncate/drop → deprovision Supabase →
    deprovision Railway → hard-delete credentials → revoke connector OAuth tokens; **token revoked first / re-driven**
    AC-10.OFF.005.5; each sub-step idempotent + recorded **to the management plane before the next destructive step**
    AC-10.OFF.005.4; a sub-step failure → `deletion_failed` + escalate, **never complete on a partial deprovision**, no
    auto-rollback AC-10.OFF.005.2), FR-10.OFF.006 (**Step 5 — the offboarding compliance meta-record** in the management
    plane: nine fields + `systems_deprovisioned[]` + `tokens_revoked[]`; **no client business data**; references the
    client by `client_registry` identity — the **only valid `client_slug` use** AC-10.OFF.006.2). The hard-delete is a
    **two-person authorisation** (distinct second approver, no self-second — C10 DEL two-person rule, FR-10.DEL.003 /
    AC-10.DEL.006).
  - **Role-scoped dashboards (C7 VIEW):** FR-7.VIEW.002 (the **Super Admin (cross-deployment)** view is one of the five
    role surfaces — RBAC-gated; this surface is its rendering).
- **CFG dependencies** (read here; the values are **edited on surface-01** at the cited anchor; description text binds
  DRY to `config-registry.md`'s `What it does` column, never re-typed):
  - **Release / skew** (`#infra`, **LIVE**): `canary_soak_minutes` (**60** — the soak window the promotion gate enforces),
    `deploy_max_version_skew` (**3** — versions-behind before the skew alert), `deploy_max_skew_days` (**14** — days-stale
    before the skew alert).
  - **Residency / retention** (`#infra`, **BOOT**): `deployment_region` (**ap-southeast-2** — v1 lock, recorded per
    deployment), `client_offboarding_retention_days` (**90** — frozen-retention before hard-delete).
  - **Staleness** (`#observability`, **LIVE**): `deployment_staleness_window` (**15 min** — how old a card's last push
    may be before it is marked `stale`; the threshold FR-7.MGM.002 evaluates).
  - **Cost** (`#guardrails`, **LIVE**): `price_table` (object — the per-model estimate prices; read to render the
    cross-deployment cost overview as **estimates**, ADR-003; edited on surface-01).
  - **Secret** (read-existence only, **never displayed**): `X_INTERNAL_TOKEN` (§N SECRET — the management-plane push
    auth, ADR-001 §7; the surface shows token *status/rotation state*, never the token — same discipline as a connector
    credential, FR-3.TOK.001 analogue).
- **PERM gates:** ⚠️ **OD-125 — a Rule-0 gap (change-control mint).** The C7/C10 FRs name the **operator / Super Admin**
  as the holder of every fleet action *in prose* (FR-10.PRV.001 provisioning, FR-10.DEP.002 promotion, FR-10.OFF.001/005
  offboarding, FR-10.MGT.004 token rotation) but bind **no `PERM-` node** to any of them, and **no node gates the fleet
  view itself** — a gate with no catalog entry is a build-time #3 defect (PERMISSION_NODES.md rule). The existing
  `PERM-config.infra` / `PERM-config.observability` gate *editing the thresholds* the fleet consumes, **not** viewing the
  fleet or executing its actions. Resolved by **minting five management-plane nodes via change-control** (OD-125),
  scope = **management-plane** (the operator's separate Super Admin deployment, ADR-001 §7 — a scope *beyond* intra-client,
  alongside the existing `deployment` scope), all **Super Admin only, never delegable**:
  - **Entry:** `PERM-fleet.view` — render the fleet console (the grid + read-only cross-deployment panels).
  - **`PERM-fleet.provision`** — run/track the provisioning flow + register a new client (FR-10.PRV.001).
  - **`PERM-fleet.promote_release`** — promote a release (canary→main) and roll back (FR-10.DEP.002/003).
  - **`PERM-fleet.offboard`** — initiate + execute the offboarding workflow (FR-10.OFF.*); the **hard-delete step
    additionally requires two-person auth** (a distinct second `PERM-fleet.offboard` holder, no self-second —
    AC-10.DEL.006), which is an *action-level* check on top of the node.
  - **`PERM-fleet.rotate_token`** — rotate a deployment's `internal_token` (FR-10.MGT.004).
  - **Click-through into a client deployment** is **not** a management-plane node — it is **logging into that client's
    own dashboard under that client's RBAC** (FR-10.MGT.003.2); the management plane carries no cross-client grant.
  - All nodes default-deny (FR-1.PERM.002 / OD-030); build obligation = appear in `PERMISSION_NODES.md` with all four
    fields (FR-1.PERM.005). Recorded with all four fields in `open-decisions.md` OD-125. **C1 catalog grows; no FR
    re-approval** (mirrors surface-03 OD-115 / surface-04 OD-117).
- **DATA bindings** (Phase-4 stubs; **`client_slug` IS valid here** — it lives only in `client_registry`, the management
  plane, ADR-001 §3/§7; this is the **one** surface that renders it, in contrast to every per-deployment surface
  00–05/07–12 where it is deleted, OD-096 / FR-10.ISO.001):
  - **C10-owned `client_registry`** (management DB) — `id`, `client_slug`, `client_name`, `railway_url`, `internal_token`
    *(encrypted — never displayed; status/rotation only)*, `core_version`, `region`, `status` ∈ {initialising, active,
    offboarding, frozen}, `created_at`, `offboarding_at` (+ `offboarding_initiated_at`). **`status` is server-authoritative**
    and is the field that distinguishes frozen-from-dead (AC-10.OFF.004.4).
  - **C7-owned health store** (management DB, push-fed) — per-deployment latest snapshot: health score, last-push-at,
    open-alert counts, approval-queue depth, core version + last-migrated timestamp, connector-status rollup,
    cost-to-date, **plugin version** (FR-10.DEP.005), backup-health (FR-7.MGM.005). **Operational metadata only** —
    no memories / entity content / message text / sensitive data ever (FR-10.MGT.003.1). Read-only; never pulled.
  - **C10-owned offboarding meta-records** (management DB, FR-10.OFF.006) — nine lifecycle timestamps +
    `systems_deprovisioned[]` + `tokens_revoked[]`; no client business data; retained for the legal period (FR-10.LEG.001).
  - **Cross-deployment alert/CI-CD feed** (C7, push-fed) — critical alerts surfaced from any deployment (FR-7.MGM.004),
    the "alert delivery misconfigured" condition (AC-7.ALR.009.1), the alert-engine-stalled condition (AC-7.ALR.008.2).
  - **Backup-health** (FR-7.MGM.005) — read from the **Supabase Management API** (operational metadata, no business
    data); per-deployment last-backup + status.
  - **No client business tables are reachable from this deployment at all** (physical isolation, ADR-001 §3) — the
    management deployment holds `client_registry` + the health/meta stores only.
- **ADR constraints:**
  - **ADR-001 §3 + §7** — the management plane is its **own deployment** in the operator's account, holding
    `client_registry` + operational metadata only; **push, not pull**; **the hard boundary (no business data crosses)**
    is the governing #2 rule of this surface; `client_slug` exists **only here**.
  - **ADR-003** — the cross-deployment cost overview is **estimate-grade** (labelled "estimate," never an invoice).
  - **ADR-005 §5/§7** — the provisioning + canary/release-train model; plugins out of the train.
  - **The three non-negotiables** — **#2** (a map not a warehouse — the surface can never surface client business data,
    and the only way "into" a client is the client's own RBAC'd dashboard) and **#3** (a dark deployment never reads as
    healthy; a frozen one reads expected-quiet not green; the staleness check + alert engine are themselves watched;
    offboarding never completes on a partial-silent deprovision — #1 also: export verified-complete before any deletion).

---

## Overview

surface-06 is the **external operator's fleet console** — the cross-deployment Super Admin dashboard, running on the
separate management deployment (ADR-001 §7). It serves exactly one role: the **Super Admin acting as the platform
operator** (the external, password+2FA admin of C0 OD-018 — *not* a client-side Super Admin, who is confined to their
own silo). Its core is a **grid of deployment cards** (FR-7.MGM.003), each fed by that deployment's push (FR-7.MGM.001),
plus the operator workflows that act across the fleet: releases/CI-CD, migrations, provisioning, cost, backup health, and
the full client-offboarding lifecycle. Two rules define it. **First, it is a map, not a warehouse** (#2, FR-10.MGT.003):
only operational metadata ever crosses from a client deployment — never a memory, an entity, a message, a sensitive
field — and to actually look inside a client the operator clicks through and logs into *that client's* dashboard under
*that client's* RBAC. **Second, a deployment that has gone dark must never look fine** (#3, FR-7.MGM.002): a card with no
recent push flips to `stale`/`unreachable` (evaluated on an independent heartbeat against server-authoritative time), and
a deliberately **frozen** deployment (mid-offboarding) reads **expected-quiet — not green, not a dead alert**
(AC-10.OFF.004.4). The cardinal sin here is a fleet that looks all-green while a client is silently down — or, worse, a
console that leaks one client's business data into the operator's cross-deployment view.

---

## Access

> Uses the six canonical C1 roles (FR-1.ROLE.001), but this surface lives on the **operator's management deployment**,
> whose only meaningful actor is the **external Super Admin (operator)**. Client-side roles never reach it (it is a
> physically separate deployment — ADR-001 §3/§7). Entry requires `PERM-fleet.view` (OD-125, minted via change-control,
> scope = management-plane, Super Admin only / never delegable).

| Role | Can enter? | Notes |
|---|---|---|
| Super Admin (operator) | Yes | The **only** user — the external platform operator (C0 OD-018 password+2FA). Full fleet console: grid + all cross-deployment panels + all fleet actions (subject to two-person auth on hard-delete) |
| Super Admin (client-side) | No | A client's own Super Admin is confined to their silo (ADR-001 §3); they never see another client. The management deployment is physically separate — there is no nav path to it from a client deployment |
| Admin | No | Operational authority is intra-client (surface-05); the fleet is operator-only |
| Finance | No | Cross-deployment cost lives here but the surface is operator-only; per-deployment cost is surface-05's Cost panel |
| HR | No | — |
| Account Manager | No | — |
| Standard User | No | — |

**Entry gate:** the surface renders iff the caller holds `PERM-fleet.view` on the management deployment; absent it, the
console is not reachable (there is no client-deployment nav path to it at all — physical isolation, not just a hidden
item). **Fleet actions are individually node-gated beyond entry** (OD-125): provisioning → `PERM-fleet.provision`;
promote/rollback → `PERM-fleet.promote_release`; offboarding → `PERM-fleet.offboard` (**+ two-person auth on the
hard-delete step** — a distinct second approver, no self-second, AC-10.DEL.006); token rotation → `PERM-fleet.rotate_token`.
**Clicking into a client is not an action of this surface** — it hands off to that client's own dashboard, authenticated
under that client's RBAC (FR-10.MGT.003.2). All nodes default-deny (OD-030).

---

## Layout

A dedicated console on the management deployment — the operator's home after sign-in. The recommended structure
(**OD-126**) is a **fleet-grid landing + sectioned management areas + a per-deployment detail drawer**:

- The **landing** is the **Fleet Health Grid** (Section A) — one card per deployment — with a sticky **fleet-summary
  strip** above it (n active / n initialising / n offboarding-frozen / **n stale-or-unreachable** / n with open critical
  alerts / fleet version spread / today's cross-deployment estimated cost). Each summary chip carries its own
  last-updated-at and turns an alert colour on breach. **A stale/unreachable count > 0 is always rendered loud** (#3).
- A **section nav** (anchor or left rail) reaches the cross-cutting management areas: **Cross-Deployment Alerts (B) ·
  Releases & CI/CD (C) · Migrations (D) · Provisioning & Onboarding (E) · Cross-Deployment Cost (F) · Backup Health (G) ·
  Client Registry & Offboarding (H)**.
- Clicking a deployment card opens a **detail drawer** — that deployment's pushed snapshot (health, alerts, version,
  migration status, cost, backup, plugin version, registry status) **plus a "Open client dashboard ↗" click-through**
  (FR-10.MGT.003.2 — logs into the client's own deployment under their RBAC; opens their surface-05). The drawer renders
  **only operational metadata**; it can never show client business content.
- **Persistent chrome:** a global **● Polling (push-fed)** indicator (this surface is **never** Realtime — it reads the
  push-fed management store, FR-7.RTP.001/002), a **Refresh all** affordance, and a banner slot for the two
  always-loud conditions — **"alert delivery misconfigured"** (AC-7.ALR.009.1) and **"alert engine stalled"**
  (AC-7.ALR.008.2) — which pin to the top regardless of section.

No element here is over a WebSocket; the management plane reads its own store and **never pulls a client endpoint**
(AC-10.MGT.002.3).

---

## Sections

> One sub-section per management area. The Fleet Health Grid (A) is the landing; B–H are the cross-cutting panels and
> workflows. Each live section states its poll/freshness contract and all five states. The destructive workflows
> (offboarding in H) are specced as guarded multi-step flows, not single buttons.

---

### Section A — Fleet Health Grid (landing)

**Purpose:** One card per deployment (FR-7.MGM.003) — the at-a-glance "is every client healthy, and is anyone dark?"
view. The embodiment of #3 at fleet scale: a deployment that stopped reporting is loudly `stale`/`unreachable`, never
silently absent or green.

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Deployment card | `client_registry` (`client_name`, `client_slug`, `region`, `status`) + C7 health store | One card per registry row; **`client_slug`/`client_name` valid here** (management plane only) |
| Health score | C7 health store (pushed) | From the snapshot; **never pulled** (AC-7.MGM.003.1) |
| Last active / last push | C7 health store `last_push_at` | "last reported HH:MM ago"; drives the staleness flip |
| Open alerts | C7 health store alert counts | Critical count badged; click → Section B / drawer |
| Approval-queue depth | C7 health store | A rollup only — the live queue is *that client's* surface-04 (via click-through) |
| Core version | C7 health store `core_version` + `client_registry.core_version` | Compared to the fleet `main` version (Section C) |
| Status badge | `client_registry.status` (server-authoritative) | `initialising` / `active` / `offboarding` / `frozen` — **frozen ≠ dead** (AC-10.OFF.004.4) |
| **Stale / unreachable state** | `last_push_at` vs `deployment_staleness_window` (15 min), on an **independent heartbeat** | **AC-7.MGM.002.1/.3/.4** — flips to `stale`/`unreachable`, raises a cross-deployment alert; **server-authoritative time** ⚠️ AF-118 (heartbeat) / AF-120 (clock-sync) |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Open deployment detail | Opens the per-deployment drawer (pushed snapshot, operational metadata only) | `PERM-fleet.view` |
| Open client dashboard ↗ | Clicks through into that client's own deployment, **under the client's RBAC** (FR-10.MGT.003.2) | the client's own login + RBAC — **not** a management-plane node |
| Filter / sort | By status, health, version, stale-first | `PERM-fleet.view` |

**Real-time / poll:** **Polls the push-fed management store** (not Realtime; FR-7.RTP.001/002). Staleness is computed
against `deployment_staleness_window` (15 min) on C7's **independent heartbeat** with **server-authoritative time**
(AC-7.MGM.002.3/.4) — so a card goes `stale` even if no operator is watching and even if a deployment's own clock is
skewed.

**States:**
- **Loading:** Skeleton cards; the summary strip shows skeletons — **never a green "all healthy" before data**.
- **Empty:** No deployments registered yet → "No client deployments yet. Provision the first client in Provisioning &
  Onboarding." (a true empty for a fresh operator install).
- **Error:** The management-store read fails → "Couldn't load the fleet." + retry; **the grid shows '—', not an empty
  all-green** (a blank fleet that is really a fetch failure would hide every client at once — the cardinal #3 sin at
  fleet scale).
- **Partial:** The registry loads but some cards' health snapshots are missing → render those cards as **`stale` /
  "no recent report"**, never as healthy. Each card degrades independently.
- **Offline / stale:** A deployment past `deployment_staleness_window` → its card flips to **`stale`/`unreachable`**
  with "last reported HH:MM ago" + a raised cross-deployment alert (AC-7.MGM.002.2); a **`frozen`** deployment that
  stopped pushing reads **"offboarding — expected quiet"**, *not* stale-alert and *not* green (AC-10.OFF.004.4).

---

### Section B — Cross-Deployment Alerts

**Purpose:** Critical alerts surfaced from any deployment (FR-7.MGM.004), plus the two conditions that protect the
observability layer itself — **alert-delivery-misconfigured** (AC-7.ALR.009.1) and **alert-engine-stalled**
(AC-7.ALR.008.2). The fleet-level "is anything on fire, and is the thing that tells me it's on fire still alive?" panel.

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Cross-deployment critical alerts | C7 push-fed alert feed (FR-7.MGM.004 / FR-7.ALR.004) | Per-deployment critical alerts; every alert is also logged (AC-7.ALR.004.1) |
| Alert-delivery-misconfigured banner | AC-7.ALR.009.1 | An unroutable alert **persists on the dashboard** + raises this critical condition — pinned, always loud |
| Alert-engine-stalled banner | AC-7.ALR.008.2 (watchdog) | The alert engine's own heartbeat stalled → critical, carried on the push ⚠️ AF-118 |
| Escalation state | FR-7.ALR.005/007 | Unacknowledged → escalates; critical alerts never auto-clear |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Acknowledge alert | Marks an alert acknowledged (does not silence a critical until resolved) | `PERM-fleet.view` |
| Go to deployment | Opens that deployment's drawer / client dashboard | `PERM-fleet.view` (+ client RBAC for click-through) |
| Open routing config | Links to surface-01 #observability (alert routing — FR-7.ALR.009) | `PERM-config.observability` |

**Real-time / poll:** **Polls the push-fed alert store** (FR-7.RTP.002). The **live** critical-alert experience is the
notification centre (surface-07, one of the two Realtime surfaces, FR-7.RTP.001) — this panel is the fleet-scoped
polled view; the two protective banners are server-emitted and persist even when idle.

**States:**
- **Loading:** Skeleton alert rows.
- **Empty:** **The healthy state** — "No active cross-deployment alerts." (genuinely nothing raised — distinct from a
  fetch failure).
- **Error:** Read fails → "Couldn't load cross-deployment alerts." + retry; **never an empty 'all clear'** (an empty
  alert panel that is really a fetch failure would hide a fleet-wide incident). Badge "—". The two protective banners,
  if previously latched, persist.
- **Partial:** The alert feed loads but a deployment's detail fails → show the alert, flag "detail unavailable," never
  drop a critical row.
- **Offline / stale:** "stale as-of HH:MM"; a latched critical persists; the alert-engine-stalled banner is itself the
  signal that "no alerts" may be untrustworthy — shown explicitly.

---

### Section C — Releases & CI/CD

**Purpose:** The fleet version spread, the max-skew alert, and the operator's promote/rollback controls (FR-7.MGM.004 +
FR-10.DEP.001–005). The "is everyone on the right version, and can I safely roll the fleet forward?" panel.

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Fleet version spread | C7 health store `core_version` per deployment vs `main` | Visualises laggards; the canary tracks `release`, the fleet tracks `main` (FR-10.DEP.001) |
| Promotion-gate status | FR-10.DEP.002 — tests green + clean canary migration + green smoke battery + elapsed `canary_soak_minutes` | All four required; any failure **blocks** promote (AC-10.DEP.002.1) |
| Max-skew alert | `core_version` skew vs `deploy_max_version_skew` (3) **or** last-migrated age vs `deploy_max_skew_days` (14) | A laggard (e.g. stuck on a failed migration) fires the alert (AC-10.DEP.004.2) |
| Last-push / CI-CD status | C7 health store `last_push_at` + CI status | Per-deployment build/push status |
| Plugin version per deployment | C7 health store plugin version (FR-10.DEP.005) | **Plugins are out of the release train** — drift is shown, never auto-pushed (OOS-033) |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Promote release (canary → main) | Fast-forwards `release`→`main` **only when all four gate conditions pass**; deliberate operator action (FR-10.DEP.002, OD-094) | `PERM-fleet.promote_release` |
| Roll back | Redeploys the prior Railway build (per-deployment or fleet-wide); **schema is not un-migrated** (FR-10.DEP.003) | `PERM-fleet.promote_release` |
| View deployment build history | Opens that deployment's version/build trail | `PERM-fleet.view` |

**Real-time / poll:** **Polls** the push-fed version/CI store (FR-7.RTP.002).

**States:**
- **Loading:** Skeleton version table + gate-status chips.
- **Empty:** Single deployment / nothing to promote → "Fleet is on a single version. Nothing to promote." (true state).
- **Error:** Read fails → "Couldn't load release status." + retry; **the gate status shows 'unknown', never 'ready'**
  (a "ready to promote" that is really a fetch failure could green-light an unsafe promotion — a #3 hole). **Promote is
  disabled while the gate status is unknown.**
- **Partial:** Version spread loads but the canary gate status fails → show the spread, **disable Promote**, flag the
  gate "couldn't verify."
- **Offline / stale:** "stale as-of HH:MM"; **Promote/Rollback disabled while stale** (never act on a stale gate); a
  latched skew alert persists.

---

### Section D — Migrations

**Purpose:** Per-deployment schema-migration status and the failure-isolation view (FR-10.MIG.001/002) — the "did the
last release migrate cleanly everywhere, and is anyone stuck?" panel. A migration failure is **isolated and never
silent** (AC-10.MIG.002.2).

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Per-deployment migration status | C7 health store last-migrated timestamp + migration outcome | Each deployment migrates against its own Supabase, independently (FR-10.MIG.001) |
| Stuck / failed-migration flag | FR-10.MIG.002 + the skew alert (FR-10.DEP.004) | A failed migration **halts only that deployment** (prior version live); surfaced as stuck — never silent |
| Failure isolation note | AC-10.MIG.002.1 | A failure on one deployment never affects another |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| View migration detail | Opens that deployment's migration log / failure reason | `PERM-fleet.view` |
| Re-attempt (redeploy) | Re-drives the stuck deployment's release (a redeploy — the recovery path; no destructive down-migration, FR-10.DEP.003) | `PERM-fleet.promote_release` |

**Real-time / poll:** **Polls** the push-fed migration-status store (FR-7.RTP.002).

**States:**
- **Loading:** Skeleton rows.
- **Empty:** No migrations pending and all current → "All deployments are on the current schema." (true state).
- **Error:** Read fails → "Couldn't load migration status." + retry; **a stuck migration must not vanish** — show "—",
  never an implied "all migrated" (a false all-clear would hide a half-applied schema, the #3 failure FR-10.MIG.002
  forbids).
- **Partial:** Some deployments resolve, others fail → render the resolved; flag the rest "status unknown," never "ok."
- **Offline / stale:** "stale as-of HH:MM"; a latched stuck-migration flag persists (a deployment stuck before the
  dashboard went stale is still stuck).

---

### Section E — Provisioning & Onboarding

**Purpose:** New-client provisioning status and the onboarding runbook reference (FR-10.PRV.001–004) — the "is the new
client coming up cleanly?" panel. The provisioning script is **operator-run and idempotent + loud on partial failure**
(FR-10.PRV.001); this surface **tracks and surfaces** that flow.

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Provisioning status | `client_registry.status = initialising` + the script's recorded step results | A new client appears here until it reaches `active`; **partial failure is shown loud**, never half-provisioned-silently (FR-10.PRV.001) |
| Provisioning checklist | FR-10.PRV.001 steps (Railway link → config/secrets → token mint+dual-store → registry insert → first-deploy seed) | Per-step state; the seed creates Internal Org + first Super Admin (C0/C1) |
| OAuth app registration | FR-10.PRV.002 | Per-client OAuth apps live in the **client's** accounts (redirect URIs → that deployment's Railway domain) |
| Onboarding runbook | FR-10.PRV.004 | The client-side, consent-gated runbook (client owns Supabase + API + connector accounts, grants delegated access) — a referenced document |
| Canary | FR-10.PRV.003 | The seeded synthetic client (the promotion-gate fixture, Section C) — shown as a special always-present "deployment" |
| Region | `client_registry.region` (`deployment_region`, v1 `ap-southeast-2`) | v1 single-region lock (FR-10.ISO.003); v2 selectable |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Provision new client | Launches/tracks the operator-side provisioning flow (OD-128 — v1 surfaces *status + a guided checklist*; the token-minting/secret-setting script remains operator-run) | `PERM-fleet.provision` |
| View provisioning detail | Opens the per-step result trail for an `initialising` client | `PERM-fleet.provision` |
| Open onboarding runbook | Opens the FR-10.PRV.004 runbook document | `PERM-fleet.provision` |

**Real-time / poll:** **Polls** the registry + the recorded provisioning-step store (FR-7.RTP.002).

**States:**
- **Loading:** Skeleton checklist.
- **Empty:** No client provisioning in progress → "No provisioning in progress. Start a new client when ready."
- **Error:** Read fails → "Couldn't load provisioning status." + retry; a provisioning client must not read as `active`
  when its status is actually unknown — show "—", never a false-complete.
- **Partial:** Some steps recorded, others failed → **render the failed step loud** (FR-10.PRV.001's "loud on partial
  failure"); the client stays `initialising`, never silently advanced.
- **Offline / stale:** "stale as-of HH:MM"; a latched partial-failure persists.

---

### Section F — Cross-Deployment Cost

**Purpose:** The estimate-grade cost overview across the fleet (FR-7.MGM.005) — the "what is the platform costing across
all clients?" panel. Like surface-05's Cost panel, it **renders estimates** and never claims invoice accuracy (ADR-003).

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Per-deployment cost-to-date | C7 health store cost-to-date (pushed) × context | Each client owns/pays their own opex (ADR-003); this is the operator's cross-deployment overview |
| Fleet cost trend | C7 health store cost over time | **Labelled "estimate"** (ADR-003 / FR-7.MGM.005) — never an invoice |
| Price basis | `price_table` (per-model estimate prices) | Read to *explain* a figure; edited on surface-01 #guardrails |
| Blind-meter indicator | `cost_unknown` sentinel (per FR-7.LOG.004 analogue) | A deployment reporting no cost is shown explicitly, **not** as "$0" |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| View per-deployment breakdown | Expands the per-client cost table | `PERM-fleet.view` |
| Open price table | Links to surface-01 #guardrails (where `price_table` is edited) | `PERM-config.guardrails` |

**Real-time / poll:** **Polls** the push-fed cost store (FR-7.RTP.002).

**States:**
- **Loading:** Skeleton figures.
- **Empty:** No reported spend yet → "$0.00 estimated across the fleet — no billable activity reported yet." (true zero,
  distinct from blind-meter / error).
- **Error:** Read fails → "Couldn't load fleet cost." + retry; **shows '—', not '$0'** (a "$0" that is really a fetch
  failure would hide runaway cross-deployment spend).
- **Partial:** Some deployments report, others are blind → render the reported total + flag the blind ones explicitly
  (not as "$0").
- **Offline / stale:** "stale as-of HH:MM"; the figure is marked "as-of last poll."

---

### Section G — Backup Health

**Purpose:** Per-deployment backup-health across the fleet (FR-7.MGM.005), read from the **Supabase Management API** —
the "is every client's data actually being backed up?" panel. Operational metadata only (no business data).

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Per-deployment backup status | Supabase Management API (FR-7.MGM.005) | Last-backup timestamp + status; **no business data crosses** — only backup metadata |
| Backup staleness | last-backup age vs the backup-health expectation | A deployment whose backups stopped is surfaced loud (a #1 risk — knowledge could be lost) ⚠️ AF-069/AF-070 (restore-works / mgmt-API fields; block, build-time) |
| Backup-health rollup | C7 health store (carried on the push, AC-7.MGM.005.1) | Rolls up to the fleet-summary strip |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| View backup detail | Opens that deployment's backup history (from the Management API) | `PERM-fleet.view` |

**Real-time / poll:** **Polls** the push-fed backup-health store + (where applicable) the Supabase Management API
(FR-7.RTP.002).

**States:**
- **Loading:** Skeleton rows.
- **Empty:** No deployments / no backup data yet → "No backup data reported yet."
- **Error:** Read fails → "Couldn't load backup health." + retry; **a deployment's backups must not read as healthy
  when unknown** — show "—" (a false "backed up ✓" that is really a fetch failure is a #1 hole — it implies recoverable
  data that may not exist).
- **Partial:** Some report, others fail → render the reported; flag the rest "backup status unknown," never "✓."
- **Offline / stale:** "stale as-of HH:MM"; a latched stale-backup warning persists. *(Full backup/DR ownership +
  verified-restore is Phase 5 — ADR-008 / OD-009; this panel renders the health *signal* only.)*

---

### Section H — Client Registry & Offboarding

**Purpose:** The `client_registry` rows (FR-10.MGT.001), the `internal_token` lifecycle (FR-10.MGT.004), and the
**guarded client-offboarding workflow** (FR-10.OFF.001–006). This is the most consequential section — it can destroy a
client's entire deployment — so it is specced as a **multi-step guarded flow with #1 gates at every transition**.

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Registry rows | `client_registry` (`client_slug`, `client_name`, `railway_url`, `region`, `core_version`, `status`, `created_at`, `offboarding_at`) | **The only place client identity exists** (ADR-001 §3); `client_slug` valid here; `internal_token` **never displayed** |
| Token status | `client_registry.internal_token` (encrypted) | Shows **status/rotation state only** (minted / rotated-at / revoked), never the token value (AC-10.MGT.001.3) |
| Offboarding lifecycle | `client_registry.status` (offboarding/frozen) + offboarding meta-record (FR-10.OFF.006) | The 5-step sequence + its nine recorded timestamps; **resumable from the management plane** (AC-10.OFF.005.4) |
| Export verification state | FR-10.OFF.002/003 | Export **verified-complete + client-acknowledged** before any deletion (AC-10.OFF.002.4 / AC-10.OFF.003.3) |
| Retention countdown | `client_offboarding_retention_days` (90) | The frozen-retention window; reactivation within it unfreezes (FR-10.OFF.004) |
| Deletion progress | FR-10.OFF.005 per-system status (`systems_deprovisioned[]`, `tokens_revoked[]`) | **`deletion_failed` on partial**, never complete-on-partial; token revoked first (AC-10.OFF.005.2/.5) |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Rotate internal token | Re-mints + dual-updates `internal_token` without losing push continuity (FR-10.MGT.004) | `PERM-fleet.rotate_token` |
| Initiate offboarding (Step 1) | `status` → `offboarding`, sets `offboarding_initiated_at` (FR-10.OFF.001); opens the guarded wizard | `PERM-fleet.offboard` |
| Trigger / verify export (Step 2) | Runs the full export; **only an affirmative verified-complete result advances** (AC-10.OFF.002.4); tracks client sign-off (AC-10.OFF.003) | `PERM-fleet.offboard` |
| Freeze (Step 3) | Begins the retention freeze (C5 freeze-gate; OD-091); reactivation possible within the window | `PERM-fleet.offboard` |
| Execute hard-delete + deprovision (Step 4) | Truncate/drop → deprovision Supabase → deprovision Railway → hard-delete credentials → revoke OAuth tokens; **token revoked first** (AC-10.OFF.005.5); each step recorded to the management plane before the next (AC-10.OFF.005.4) | `PERM-fleet.offboard` **+ two-person auth** (a distinct second approver, no self-second — AC-10.DEL.006) |
| View offboarding meta-record (Step 5) | Opens the FR-10.OFF.006 compliance meta-record (nine fields; **no client business data**) | `PERM-fleet.offboard` |
| Reactivate (within retention) | Unfreezes a `frozen` deployment → `active` (data was never destroyed, FR-10.OFF.004) | `PERM-fleet.offboard` |

**Real-time / poll:** **Polls** the registry + offboarding-meta store (FR-7.RTP.002). The offboarding sequence is
**server-driven and resumable** (AC-10.OFF.005.4) — its progress is correct even if the operator closes the console
mid-sequence.

**States:**
- **Loading:** Skeleton registry table.
- **Empty:** No clients registered → "No clients registered yet." (matches Section A empty).
- **Error:** Read fails → "Couldn't load the client registry." + retry; **the registry must never render empty-as-fact**
  (a blank registry that is really a fetch failure could imply no clients exist — and worse, must never enable a
  destructive action against a row it can't confirm). **All offboarding/hard-delete actions disabled while unloaded.**
- **Partial:** A registry row loads but its offboarding meta fails → render the row, **disable the destructive steps**
  for it (never advance a destruction you can't read the state of), keep read-only view available.
- **Offline / stale:** "stale as-of HH:MM"; **all destructive actions disabled while stale** (never hard-delete on a
  stale view); a `deletion_failed` state latched before going stale persists; an in-progress offboarding shows
  "resuming server-side" (the sequence does not depend on the console being open — AC-10.OFF.005.4).

---

## Navigation / transitions

| Trigger | Destination |
|---|---|
| Operator sign-in (management deployment) | surface-06 (Fleet Health Grid landing) |
| Deployment card → Open detail | The per-deployment drawer (operational metadata only) |
| Drawer → Open client dashboard ↗ | **That client's own deployment**, logged in under the client's RBAC (their surface-05 / dashboards) — FR-10.MGT.003.2 |
| Cross-Deployment Alerts → routing config | surface-01 #observability (FR-7.ALR.009) |
| Releases → (no destination) | In-section promote/rollback (guarded) |
| Provisioning → onboarding runbook | The FR-10.PRV.004 runbook document |
| Cost → Open price table | surface-01 #guardrails (where `price_table` is edited) |
| Registry → offboarding wizard | The guarded multi-step offboarding flow (Section H) |
| A live critical alert | surface-07 notification centre (the Realtime surface — seam) |

---

## Mobile

A read-only **fleet-status summary** is a genuine mobile use case (an operator glancing at whether any client is down
from a phone). The fleet-summary strip + the grid (status / health / stale-or-unreachable / open-critical-alerts per
card) collapses to stacked status cards; the **freshness/last-reported and stale/unreachable badges are mandatory on
mobile** (a stale "all-green fleet" on a phone is the most dangerous false-healthy view in the product). **All fleet
actions — promote/rollback, provisioning, token rotation, and especially the offboarding hard-delete — degrade to an
"open on a wider display" notice** (a two-person-authorised deployment destruction from a phone is out of scope for the
mobile treatment). Critical-alert *push* is the FR-7.VIEW.003 notification routing, owned by C7 and delivered to
surface-07/mobile — not this surface. Detailed mobile treatment: `surface-12-mobile.md`.

---

## Open decisions

| # | Question | Options | Recommendation |
|---|---|---|---|
| OD-125 ⚠️ **Rule-0 PERM gap** | The C7/C10 FRs name the operator/Super Admin as the holder of every fleet action **in prose** (FR-10.PRV.001 provisioning, FR-10.DEP.002 promotion, FR-10.OFF.* offboarding, FR-10.MGT.004 token rotation) but bind **no `PERM-` node** to any of them, and **no node gates the fleet view itself**. `PERM-config.infra`/`.observability` gate *editing the thresholds*, not viewing/acting on the fleet. A gate with no catalog entry is a build-time #3 defect (PERMISSION_NODES.md rule). | (a) **Mint five management-plane nodes via change-control** — `PERM-fleet.view` (entry), `PERM-fleet.provision`, `PERM-fleet.promote_release`, `PERM-fleet.offboard` (+ two-person auth on hard-delete), `PERM-fleet.rotate_token` — scope = **management-plane** (the operator's separate deployment, ADR-001 §7), all **Super Admin only / never delegable**; click-through-into-a-client uses the client's own RBAC, not a node. (b) One coarse `PERM-fleet.admin` node for everything (simpler, but no least-privilege between view and deployment-destruction — violates the spirit of FR-1.PERM least-privilege). (c) Reuse `PERM-config.infra` (wrong — that gates config edits, not fleet actions; conflates two concerns). | **(a)** — least-privilege (a view-only operator is possible; destruction is its own node + two-person auth), introduces the **management-plane scope** the operator deployment genuinely needs (ADR-001 §7 — a scope beyond intra-client), and mirrors surface-03 OD-115 / surface-04 OD-117 (mint via change-control when no existing node fits). Records all five nodes with the four fields in OD-125; build obligation = `PERMISSION_NODES.md`. **C1 catalog grows; no FR re-approval, no ADR supersede.** |
| OD-126 | **Layout** — fleet-grid landing + sectioned management areas + per-deployment detail drawer, vs a flat single-scroll, vs fully tabbed. | (a) **Grid landing + section nav + detail drawer** (grid is home; B–H reachable via nav; a card opens a drawer with the click-through). (b) Flat single-scroll (like surface-05). (c) Fully tabbed. | **(a)** — the fleet *grid* is the operator's primary glance and deserves to be the landing; the management areas (releases, migrations, provisioning, offboarding) are task-oriented and read better as discrete sections than crammed into one scroll; the drawer keeps per-deployment detail one click from the grid without leaving the fleet view. The always-loud banners (alert-delivery-misconfigured, alert-engine-stalled) pin above any section so a degrading-panel-behind-a-tab #3 risk doesn't apply to the critical conditions. |
| OD-127 | **Offboarding workflow UI** (behaviour) — is the destructive offboarding driven from this surface as a guarded multi-step wizard, and how is the two-person auth on hard-delete presented? | (a) **A guarded multi-step wizard on this surface**: Initiate → Export (verified-complete + client sign-off gate) → Freeze (retention countdown, reactivation possible) → Hard-delete (**inline two-person auth — a distinct second approver, no self-second**) → Meta-record. Each transition shows its #1 gate and cannot be skipped; the sequence is server-driven/resumable. (b) Initiate here, but hard-delete only via an operator CLI (no destructive UI). (c) A single "Offboard" button with one confirmation. | **(a)** — the workflow already exists in C10 with hard gates (export-verified-before-delete AC-10.OFF.002.4, sign-off before retention AC-10.OFF.003.3, two-person on hard-delete AC-10.DEL.006, resumable AC-10.OFF.005.4); a guarded wizard makes those gates *visible* and *enforced in the UI* rather than relying on operator memory. The two-person auth is an inline second-approver step (the first approver cannot self-second). (c) is dangerous (one click to destroy a client); (b) hides the gates from the surface that should enforce them. |
| OD-128 | **Provisioning launch vs track** (scope) — does this surface *launch* the provisioning script, or *track* an operator-run script? | (a) **v1: track + guided checklist** — the surface shows provisioning status (registry `initialising` → `active`), the per-step results, and the onboarding runbook, with a "Provision new client" entry that **launches the guided flow**; the token-minting / Railway-secret-setting steps remain the **operator-run script** (FR-10.PRV.001 "scripted, operator-run"), surfaced loud on partial failure. Full one-click web provisioning is a v2 consideration. (b) Fully web-driven provisioning in v1 (the surface mints tokens + sets Railway secrets). (c) No provisioning UI at all (CLI only). | **(a)** — FR-10.PRV.001 specifies an *operator-run, idempotent, loud-on-partial-failure* script that handles secrets + token minting; fully webifying secret-handling/token-minting in v1 (b) widens the attack surface of the most privileged operation in the product without a driving requirement, while (c) leaves provisioning invisible to the fleet console. Tracking + a guided checklist + loud partial-failure surfacing gives operator visibility while keeping the secret-bearing steps in the hardened script. Matches the C10 posture; revisit one-click provisioning in v2. |

---

## Phase 4 data binding notes

- **`client_registry`** (C10-owned, management DB) — `id`, `client_slug` *(valid here — the **only** table with a
  client-identity column; ADR-001 §3/§7 / FR-10.ISO.001; **no app table has it**)*, `client_name`, `railway_url`,
  `internal_token` *(encrypted at rest, AC-10.MGT.001.3 — **never returned to the surface**; the API exposes
  status/rotation metadata only)*, `core_version`, `region`, `status` *(enum {initialising, active, offboarding,
  frozen} — **server-authoritative**, the frozen-vs-dead discriminator AC-10.OFF.004.4)*, `created_at`, `offboarding_at`,
  `offboarding_initiated_at`. Lives **only on the management deployment**.
- **C7 health store** (management DB, push-fed) — per-deployment latest snapshot: health score, `last_push_at`,
  open-alert counts, approval-queue depth, `core_version` + last-migrated timestamp, connector-status rollup,
  cost-to-date, plugin version, backup-health. **Operational metadata only** (FR-10.MGT.003.1) — Phase 4 must enforce
  that no business-data column can exist here. Index for "deployments with `last_push_at` older than
  `deployment_staleness_window`" (the staleness sweep, AC-7.MGM.002.3) and for the fleet version-spread/skew query.
- **Offboarding meta-records** (C10-owned, management DB, FR-10.OFF.006) — nine lifecycle timestamps
  (`offboarding_initiated_at`, `export_delivered_at`, `export_acknowledged_at`, `retention_window_end`,
  `deletion_executed_at`, `deletion_executed_by`, + `created_at`/identity) + `systems_deprovisioned[]` +
  `tokens_revoked[]`. **No client business data.** Retained for the legal period (FR-10.LEG.001). The destructive
  sequence writes per-step status here **before the next destructive step** (AC-10.OFF.005.4) so it is resumable.
- **Two-person authorisation record** (for the hard-delete, AC-10.DEL.006) — Phase 4 must define how the first
  approver + the **distinct** second approver (no self-second) are recorded; this is a net field-set owed for the
  offboarding hard-delete (flag as a new Phase-4 obligation, like surface-04's `escalated_at`).
- **Cross-deployment alert / CI-CD feed** (C7, push-fed) — critical alerts per deployment (FR-7.MGM.004), the
  alert-delivery-misconfigured condition (AC-7.ALR.009.1), the alert-engine-stalled condition (AC-7.ALR.008.2). The
  staleness + escalation math uses **server-authoritative timestamps** (AC-7.MGM.002.4 / AC-7.ALR.005.3).
- **Backup-health** — read from the **Supabase Management API** (FR-7.MGM.005) and/or the push-fed rollup; metadata
  only. Full backup/DR (verified restore) is **Phase 5** (ADR-008 / OD-009) — this surface renders the health signal.
- **`client_slug` is valid on this surface only** — every per-deployment surface (00–05, 07–12) carries **no
  `client_slug`** (deleted from app tables, OD-096 / FR-10.ISO.001); here it is the cross-deployment identity key in
  `client_registry`. Phase 4 must not create a `client_slug` column in any app table; it exists solely in the
  management DB.
- **No client business tables are reachable from the management deployment** (physical isolation, ADR-001 §3) — Phase 4
  schema for this deployment is `client_registry` + the health/meta/alert stores only.
- **New management-plane PERM nodes (OD-125)** — `PERM-fleet.view/.provision/.promote_release/.offboard/.rotate_token`,
  scope = **management-plane**, Super Admin only / never delegable; owed to `PERMISSION_NODES.md` with all four fields
  (FR-1.PERM.005). A new **scope value (`management-plane`)** is introduced — the catalog's Scope column must admit it
  (alongside intra-client / deployment).
