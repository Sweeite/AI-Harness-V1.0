# Surface: UI-DASHBOARD-AGENCY + UI-NOTIFICATION-CENTRE (surface-07) — Agency / Manager Dashboard + Notification Centre

**Status:** 🟢 **Signed off 2026-07-01** (operator: "take all four recommendations"). **8 of 14 Phase-3 surfaces
complete.** OD-129–132 🟢. **Verification gate (independent zero-context subagent, checks a–f): CLEAN-WITH-FIXES —
1 HIGH · 1 MED · 2 LOW (all reconciled).** Coverage (every cited C7 ALR/RTP/VIEW + C9 SUG/MODE/PRO + C4 CID.006 + C1
PERM/ROLE id verified verbatim), CFG wiring (all 11 keys exist with claimed class/default, edited on surface-01
#observability), DATA (no `client_slug`; net Phase-4 fields flagged), PERM (the no-`PERM-dashboard.*`-node gap verified
real; mint under the existing FR-1.PERM.007 category mirrors OD-117/OD-125), the #1/#2/#3 false-healthy sweep (no
false-healthy hole), seams, and role mapping all PASS. **Fixes applied:** **H1** — the no-bypass rule is **FR-9.MODE.003**
(not FR-9.PRO.005, which is Opportunity-spotting) — re-cited at all 6 use sites; **M1** — node-name drift: surface-05's
working name `PERM-dashboard.view_ops` canonicalised to `PERM-dashboard.ops` and surface-05's reference updated in
lockstep; **L1** — RTP.002 cadence defaults re-cited to the FR statement (not AC .1/.2); **L2** — dismissal-floor
tightened to AC-9.PRO.004.2/.4. The eighth Phase-3 surface. Two
surface IDs are minted here: **`UI-DASHBOARD-AGENCY`** — the **non-technical management / leadership view**
(FR-7.VIEW.002's "Manager (non-technical)" role surface: the business-activity lens, *not* the technical ops dashboard,
which is surface-05) — and **`UI-NOTIFICATION-CENTRE`** — the **second of exactly two Realtime/WebSocket surfaces in the
product** (FR-7.RTP.001; the other is surface-04's approval queue). The notification centre is **cross-cutting
chrome** (FR-7.ALR.001 "accessible from every view") but is **home-specced here**. **OD-129 mints the concrete
Dashboard Access PERM-node family** (`PERM-dashboard.overview` for this surface + formalises surface-05's
already-referenced node, working name `view_ops` → canonical `PERM-dashboard.ops`) via change-control — closing a real
Rule-0 gap (FR-1.PERM.007 *homes* the "Dashboard Access" category but no concrete node id was ever catalogued). This surface is also a **canonical home of the
answer-mode pill** (Cited / Inferred / Unknown, C4 FR-4.CID.006) — surface-05 seams the pill to "home surfaces 07/08".
Next OD: OD-133.

> The **agency owner's and manager's window onto what the AI is actually doing** — the non-technical counterpart to
> surface-05's technical ops dashboard. Where surface-05 answers "is the engine healthy?", surface-07 answers "what did
> the AI do for our clients, what needs my decision, and what is it suggesting?" Its core is three things: a live
> **notification centre** (the second Realtime surface — every alert lands here first, persists read/unread, and never
> silently freezes), an **activity feed** of AI-output items (each carrying its **answer-mode pill** so a non-technical
> leader can see at a glance whether an answer was grounded or inferred), and the **proactive suggestions** the C9
> engine routes to this person. The three non-negotiables it most directly serves: **#1** (a notification persists
> until actioned — never lost), **#2** (a hard-limit alert reaches the dashboard first, never Slack-only; an action a
> suggestion proposes still routes through the C6 guardrail), and **#3** (a dropped socket reads "reconnecting," never a
> stale-but-current view; a fetch failure never reads as "all caught up"). It does **not** render the technical ops
> panels (surface-05), the approval *queue* itself (surface-04 — though stale-approval *alerts* are delivered here), or
> any cross-deployment fleet view (surface-06).

---

## Context manifest

- **Surface IDs:**
  - **`UI-DASHBOARD-AGENCY`** (minted here) — FR-7.VIEW.002 names five role surfaces, one of which is the **Manager
    (non-technical)** view, but assigns no formal `UI-` id. The operator's planning-doc "Agency Owner" / "Manager"
    dashboards map here. *(Role-label note: there is **no** "Agency Owner" or "Manager" C1 role — those are
    planning-doc shorthand. "Agency Owner" → **Super Admin**; "Manager" → **Admin / Account Manager**. The six
    canonical C1 roles are the authority, FR-1.ROLE.001; mirrors how C7/C8/C9 dissolved the non-existent "Agency
    Owner" role.)*
  - **`UI-NOTIFICATION-CENTRE`** (minted here) — FR-7.RTP.001 names "the notification centre" as one of exactly two
    Realtime surfaces and FR-7.ALR.001 makes it "primary, persistent, accessible from every view," but assigns no
    formal `UI-` id. It is **cross-cutting chrome** (rendered on every dashboard, incl. surface-05/08), **home-specced
    here** (OD-131).
- **Owned by:** **C7 (Observability)** — for the notification centre + alerting (FR-7.ALR.001–009), the Realtime/poll
  contract (FR-7.RTP.001–004), and the role-scoped dashboard + answer-mode-pill contract (FR-7.VIEW.002/003). **C9
  (Proactive Intelligence)** produces the proactive suggestions this surface renders (FR-9.SUG.* / FR-9.PRO.*),
  delivered *via* the C7 notification centre (FR-9.SUG.004). **C4** owns the answer-mode-pill definition (FR-4.CID.006).
  The activity-feed *content* is produced by every acting component (C2/C5/C6/C8/C9) and read through the C7
  `event_log`; C7 guarantees the panel exists and is fed.
- **FRs served:**
  - **The notification centre (C7 ALR):** FR-7.ALR.001 (**primary + persistent + accessible from every view**;
    every alert produces a dashboard notification independent of Slack AC-7.ALR.001.1; unread until actioned, reachable
    from any view AC-7.ALR.001.2), FR-7.ALR.002 (**the seven alert rules** — task-failure spike · queue backup ·
    memory-confidence drop · **approval-queue stale** (to the specific reviewer) · **hard-limit hit** (immediate,
    always, **non-suppressible** AC-7.ALR.002.2) · cost-threshold breach · loop missed; each per-deployment thresholded
    AC-7.ALR.002.1), FR-7.ALR.003 (**routing by type to the correct person** — a stale-approval alert goes to *that
    item's* reviewer, not broadcast AC-7.ALR.003.1; targets resolve through C1 roles AC-7.ALR.003.2), FR-7.ALR.004
    (every alert logged in `event_log`, independent of delivery AC-7.ALR.004.1), FR-7.ALR.005 (**escalation window →
    secondary alert; critical never auto-cleared** AC-7.ALR.005.1/.2; server-authoritative time AC-7.ALR.005.3
    ⚠️ AF-120), FR-7.ALR.006 (**dashboard notification durable + independent of Slack** — a Slack outage never loses a
    dashboard notification AC-7.ALR.006.1; a failed Slack delivery is surfaced, not swallowed AC-7.ALR.006.2),
    FR-7.ALR.007 (**C7 delivers the alerts C5/C6 only emit** — the hard-limit-hit + stale-approval seams close here
    AC-7.ALR.007.1/.2), FR-7.ALR.008 (**the alert engine is itself watched** — heartbeat + independent watchdog;
    a stalled engine raises a critical condition AC-7.ALR.008.2 ⚠️ AF-118), FR-7.ALR.009 (**routing configured; an
    unroutable alert fails loud** — persists on the centre + raises an "alert delivery misconfigured" critical
    condition AC-7.ALR.009.1; a config write that would strand a critical alert is rejected fail-closed AC-7.ALR.009.3;
    quiet-hours never silences a critical AC-7.ALR.009.2).
  - **The Realtime / poll contract (C7 RTP):** FR-7.RTP.001 (**the notification centre is one of exactly two Realtime
    surfaces** — critical notifications appear without manual refresh AC-7.RTP.001.2; no other element here holds a
    Realtime subscription AC-7.RTP.001.3), FR-7.RTP.002 (the non-realtime panels poll at per-deployment-configurable
    cadences — the 60s event-log / 30s health defaults are in the FR-7.RTP.002 statement; read-from-config +
    live-effect are AC-7.RTP.002.1/.2), FR-7.RTP.003 (**per-silo connection budget with
    degrade-to-polling**; the notification centre is **prioritised** for live connections AC-7.RTP.003.1; a configurable
    headroom threshold degrades extras *before* the cap AC-7.RTP.003.2), FR-7.RTP.004 (**dropped socket reconnects or
    falls back to polling; the UI shows live-vs-reconnecting/polling honestly** AC-7.RTP.004.2 — never a stale view
    believed live).
  - **The role-scoped dashboard + answer-mode pill (C7 VIEW):** FR-7.VIEW.002 (**the Manager (non-technical) view is
    one of the five RBAC-gated role surfaces** — a role sees only the signals its C1 permissions allow AC-7.VIEW.002.1;
    **every AI-output item in an activity feed / chat carries its answer-mode pill** AC-7.VIEW.002.2, C4-sourced),
    FR-7.VIEW.003 (**mobile push-notification routing by class** — critical immediate, hard-limit immediate+always
    AC-7.VIEW.003.1, pending/stale-approval configurable AC-7.VIEW.003.2; the mobile *interaction design* → surface-12).
  - **The proactive suggestions delivered here (C9):** FR-9.SUG.004 (**multi-surface delivery routing "it follows you"**
    — each ranked suggestion routed to the right owner by risk-type and handed to the C7 notification centre for
    dashboard + chat + push delivery AC-9.SUG.004.1; no eligible recipient → escalate to a default owner, never dropped
    AC-9.SUG.004.2), FR-9.SUG.005 (**dismissal-learning with a safety floor** — a metric-past-threshold item is
    delivered regardless of prior dismissal AC-9.PRO.004.2/.4 floor), FR-9.PRO.001–007 (the generators whose items land here:
    relationship / meeting-prep / doc-prep / de-risking / opportunity / daily-briefing / pattern), FR-9.MODE.003 (**every
    proactive action — including Act-mode — routes through the identical C6 approval path**; a suggestion's "act" is
    never a back-door around the guardrail).
  - **The answer-mode pill (C4):** FR-4.CID.006 (the **Cited / Inferred / Unknown** classification — the canonical
    source; this surface renders it, never re-defines it).
- **CFG dependencies** (read here; **edited on surface-01 #observability** at the cited anchor — `PERM-config.observability`,
  Super-Admin-only; description text binds DRY to `config-registry.md`'s `What it does` column, never re-typed):
  - **Alert routing / delivery** (`#observability`, **LIVE**): `alert_routing_rules` (alert-type → {role, channel}),
    `escalation_contacts` (role → contact list; **must resolve** — #3), `quiet_hours` (holds non-urgent alerts;
    **never suppresses critical**), `alert_email_enabled` (email delivery on/off).
  - **Alert thresholds** (`#observability`, **LIVE**): `approval_staleness_alert_threshold` (**4 h** — how long an
    approval waits before the reviewer is nudged), `alert_escalation_window_hours` (**2** — unacknowledged → escalate),
    `cost_threshold_alert_limit` (**$50/day, $200/wk**).
  - **Realtime / poll** (`#observability`, **LIVE**): `realtime_connection_headroom_threshold` (**80%** — when live
    connections degrade extras to polling), `polling_interval_event_log_s` (**60** — the activity feed refresh),
    `polling_interval_health_metrics_s` (**30** — the at-a-glance rollup refresh).
  - **Secret** (read-existence only, **never displayed**): `SLACK_WEBHOOK_URL` (group N SECRET — the supplementary
    Slack delivery address; the surface shows Slack *delivery status*, never the URL; dashboard delivery is independent
    of it, FR-7.ALR.006).
- **PERM gates:** ⚠️ **OD-129 — a Rule-0 gap (change-control mint).** FR-1.PERM.007 **homes** the twelve design-doc
  permission categories — including **Dashboard Access** — as the seed catalog, but **no concrete `PERM-dashboard.*`
  node id was ever minted** in `PERMISSION_NODES.md`. surface-05 (signed off) already **references** a "Dashboard Access
  (ops)" node — "exact id in `PERMISSION_NODES.md`" — that does not yet exist there: an owed gate, the same drift the
  catalog already flags for surface-03/04. A gate with no catalog entry is a build-time #3 defect (PERMISSION_NODES.md
  rule). Resolved by **minting the concrete Dashboard Access node family via change-control** (OD-129), scope =
  **intra-client** (these are per-deployment dashboard views, not management-plane), under the **already-homed**
  FR-1.PERM.007 "Dashboard Access" category (no new category, no ADR supersede — mirrors surface-04 OD-117's mint under
  the existing "Approval Authority" category):
  - **Entry (this surface):** `PERM-dashboard.overview` — render the agency / management overview (the activity feed +
    at-a-glance rollup + proactive-suggestions panel). **Default: Super Admin, Admin, Account Manager.**
  - **Formalised (surface-05's already-referenced node):** `PERM-dashboard.ops` — render the technical operations
    dashboard (surface-05). **Default: Super Admin, Admin** (+ Finance scoped to the Cost panel per surface-05's
    OD-121). surface-05 carries this as the **working name `PERM-dashboard.view_ops`**; the canonical id is fixed
    **here** as `PERM-dashboard.ops` and surface-05's reference is updated in lockstep (it explicitly anticipated the
    id "materialising in `PERMISSION_NODES.md` at build"). Transcribed now to close the existing surface-05 drift, not
    deferred.
  - **The notification centre is NOT its own node (OD-131).** It is **cross-cutting chrome available to any holder of
    any Dashboard Access node** (`PERM-dashboard.overview` *or* `PERM-dashboard.ops` *or* surface-08's standard-user
    view), **scoped per the viewer's C1 clearances** — a viewer sees only notifications whose content they may see
    (AC-7.VIEW.002.1 / FR-9.SUG.004 clearance check). FR-7.ALR.001 ("accessible from every view") mandates it ride
    every dashboard rather than gate behind a single surface.
  - **Alert-routing config edits** are **not** an action of this surface — they live on surface-01 #observability,
    gated `PERM-config.observability` (Super Admin only). This surface *links* there.
  - All nodes default-deny (FR-1.PERM.002 / OD-030); build obligation = appear in `PERMISSION_NODES.md` with all four
    fields (FR-1.PERM.005). Recorded with all four fields in `open-decisions.md` OD-129. **C1 catalog grows; no FR
    re-approval, no ADR supersede.**
- **DATA bindings** (Phase-4 stubs; **intra-client — no `client_slug` on any of these** per OD-096 / FR-10.ISO.001;
  RLS-scoped to the silo + the viewer's clearances):
  - **C7-owned `notifications` store** (or the `event_log`-derived notification rows) — per-notification:
    `id`, `type` (one of the seven rules + proactive + delivery-misconfigured/engine-stalled), `severity`,
    `title`/`body` (plain-English), `read_state` (unread/read/actioned), `recipient` (resolved role/user),
    `escalation_state` + `escalated_at`, `created_at`, `actioned_at`, `delivery_state` (dashboard-persisted + Slack
    best-effort outcome). **Dashboard row persisted first + independently of Slack** (FR-7.ALR.006).
  - **C7-owned `event_log`** (read) — the activity-feed source: append-only plain-English timeline of what the system
    did (FR-7.LOG.001–006); each AI-output row carries its **answer-mode pill** value (C4 FR-4.CID.006) and, where
    applicable, the per-entity pill mix forwarded for the C2 thin-coverage signal (AC-7.VIEW.002.2; threshold owned by
    C2, not here).
  - **C9-owned `proactive_suggestions`** (read; dismissal/act write via C9) — per-suggestion: ranked urgency,
    reasoning, **answer-mode pill**, risk-type, recipient, delivery state, dismissal state + safety-floor flag
    (FR-9.SUG.001/004/005).
  - **Two net Phase-4 fields flagged** (like surface-04's `escalated_at`): `notifications.escalation_state` +
    `escalated_at` (FR-7.ALR.005) and `notifications.actioned_at` (FR-7.ALR.001 unread-until-actioned) — confirm these
    exist in the Phase-4 schema.
- **ADR constraints:**
  - **ADR-001 §3** — intra-client only; this surface lives in one client silo, sees only that silo's data, carries no
    `client_slug`; there is no cross-deployment view here (that is surface-06).
  - **ADR-006** — RLS is the authority for what a viewer sees; the notification centre's per-viewer clearance scoping
    and the activity feed's row visibility are RLS-enforced (human-path RLS), not UI-only filtering.
  - **The three non-negotiables** — **#1** (a notification persists unread-until-actioned; an undeliverable alert
    persists on the centre rather than evaporating, FR-7.ALR.009.1), **#2** (a hard-limit alert reaches the dashboard
    first and is non-suppressible, FR-7.ALR.002.2; a proactive "act" still routes through C6, FR-9.MODE.003), **#3**
    (a dropped socket reads "reconnecting/polling," never stale-as-live, FR-7.RTP.004; a fetch failure never reads as
    "all clear"; the alert engine is itself watched, FR-7.ALR.008).

---

## Overview

surface-07 is the **non-technical leadership view** of one client deployment — the agency owner's and manager's window
onto what the AI is doing for the business. It serves three roles by default: **Super Admin** (the "agency owner" lens —
the whole business at a glance), **Admin** (management overview), and **Account Manager** (the primary day-to-day user:
their clients' activity feed, the suggestions routed to them, the decisions awaiting them). It is deliberately the
*counterpart* to surface-05: surface-05 is the technical operator's instrument panel (loops, queue, DLQ, guardrail log);
surface-07 is the business view (activity, suggestions, notifications) — the same deployment seen through a non-technical
lens. Its heart is three things. The **notification centre** (one of exactly two Realtime surfaces, FR-7.RTP.001) is
where every alert lands first, persists read/unread until actioned, and is reachable from every dashboard in the product
— it is cross-cutting chrome, home-specced here. The **activity feed** is the plain-English timeline of AI-output items,
each carrying its **answer-mode pill** (Cited / Inferred / Unknown) so a non-technical leader can tell a grounded answer
from an inferred one without reading the trace. The **proactive suggestions** panel renders the C9 engine's ranked,
explained suggestions routed to this person. The cardinal sins here are a notification centre that silently freezes
while believing it is live, a hard-limit alert that hides because Slack was the only channel configured, and an
"all caught up" view that is really a fetch failure.

---

## Access

> Uses the six canonical C1 roles (FR-1.ROLE.001) — "Agency Owner"/"Manager" are planning-doc shorthand, **not** roles.
> Entry to the **agency dashboard** requires `PERM-dashboard.overview` (OD-129, minted via change-control under the
> FR-1.PERM.007 "Dashboard Access" category, intra-client). The **notification centre** is cross-cutting chrome — it
> rides **any** Dashboard Access node and is **clearance-scoped** per viewer (OD-131), so it is not gated to this
> surface's entry alone.

| Role | Can enter? | Notes |
|---|---|---|
| Super Admin | Yes | The "agency owner" lens — full agency dashboard (activity feed + at-a-glance + all suggestions). Also has the *technical* surface-05 and (if operator) the cross-deployment surface-06 |
| Admin | Yes | Management overview — activity + suggestions + decisions awaiting. The operational/technical view is surface-05 |
| Account Manager | Yes | **The primary non-technical user** — their clients' activity feed + the suggestions routed to them by risk-type + their pending decisions; client-facing activity lives here (not surface-05) |
| Finance | No (default) | Cost lives on surface-05's Cost panel; a deployment may grant a scoped overview. Still receives the **notification centre** (clearance-scoped) on whatever dashboard they can enter |
| HR | No (default) | A deployment may grant a scoped view; still receives the clearance-scoped notification centre |
| Standard User | No | Their view is surface-08 (My Workspace). **They still get the notification centre** (cross-cutting, clearance-scoped) on surface-08 — the centre is not exclusive to this surface |

**Entry gate:** the **agency dashboard** renders iff the caller holds `PERM-dashboard.overview`; a caller without it
never sees the nav item and a direct URL returns 404 (FR-1.PERM.006 — denied surfaces are absent, not visible-but-empty).
**The notification centre is available to any holder of any Dashboard Access node** (`PERM-dashboard.overview` /
`PERM-dashboard.ops` / surface-08's standard-user node), **clearance-scoped** so a viewer sees only notifications whose
content their C1 clearances permit (AC-7.VIEW.002.1). **Per-item content** in the activity feed and suggestions is
clearance-scoped at the row (ADR-006 RLS): a Personal/Restricted/Confidential item the viewer can't see is not rendered.
**Editing alert routing is not an action of this surface** — it links to surface-01 #observability (`PERM-config.observability`).
All nodes default-deny (OD-030).

---

## Layout

A sectioned dashboard on the client deployment — the leadership user's home after sign-in (alongside surface-05 for the
technical roles). The recommended structure (**OD-130**) is a **persistent notification-centre affordance (bell + slide-over
panel) as cross-cutting chrome + a sectioned main view**:

- **Persistent chrome (every dashboard, home-specced here):**
  - A **notification bell** with an unread count, top-right, opening the **Notification Centre slide-over** (Section A).
    Present on **every** dashboard (surface-05/07/08) — it is cross-cutting (OD-131). The bell carries a **live/​
    reconnecting/​polling** indicator (FR-7.RTP.004) so the user always knows whether the centre is live.
  - A **● Live (Realtime)** / **◐ Reconnecting** / **○ Polling** connection pill (FR-7.RTP.004) — honest about the
    notification socket's state; never shows "Live" while actually disconnected.
  - The two **always-loud banners** pin to the top of any view regardless of section: **"alert delivery misconfigured"**
    (AC-7.ALR.009.1) and **"alert engine stalled"** (AC-7.ALR.008.2) — the conditions that mean "no notifications" may
    be untrustworthy.
  - An **answer-mode pill legend** affordance (a small "what do these mean?" that links to the C4 FR-4.CID.006
    definition) — the pill meanings bind DRY to C4, never re-typed here.
- **The main agency dashboard** is sectioned: **At-a-Glance (B) · Activity Feed (C) · Proactive Suggestions (D)**.

Only the notification centre holds a Realtime subscription (FR-7.RTP.001/.003); every other section **polls**
(FR-7.RTP.002). On approaching the per-silo connection budget the notification centre is **prioritised** for the live
connection while other tabs degrade to polling first (AC-7.RTP.003.1/.2).

---

## Sections

> Section A (the notification centre, `UI-NOTIFICATION-CENTRE`) is the Realtime cross-cutting panel; B–D are the agency
> dashboard's polled sections. Each live section states its Realtime/poll contract and all five states.

---

### Section A — Notification Centre (`UI-NOTIFICATION-CENTRE`, Realtime)

**Purpose:** The single place every alert lands first (FR-7.ALR.001) — the seven alert rules, proactive-suggestion
notifications, and the two self-protective conditions — persistent, read/unread, reachable from every dashboard. The
embodiment of #1 (a notification is never lost) and #3 (it never silently freezes). **This is the second of exactly two
Realtime surfaces** (FR-7.RTP.001; surface-04's approval queue is the first).

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Notification list | C7 `notifications` store (FR-7.ALR.001) | Per-row: type, severity, plain-English title/body, read_state, created_at; **dashboard row persisted independent of Slack** (FR-7.ALR.006) |
| The seven alert types | FR-7.ALR.002 | task-failure spike · queue backup · memory-confidence drop · **approval-queue stale** (to *this* reviewer, FR-7.ALR.003.1) · **hard-limit hit** (always, non-suppressible) · cost-threshold breach · loop missed |
| Proactive-suggestion notifications | C9 FR-9.SUG.004 (delivered via C7) | A new ranked suggestion arrives here; opening it jumps to Section D |
| Read/unread/actioned state | FR-7.ALR.001 (AC-7.ALR.001.2) | Persists **unread until explicitly actioned**; reachable from any view |
| Escalation state | FR-7.ALR.005 | Unacknowledged → secondary alert at the end of the (configurable) window; a critical never auto-clears |
| Slack-delivery status | FR-7.ALR.006 | Per-notification best-effort Slack outcome; a Slack failure is **shown, not swallowed** (AC-7.ALR.006.2) — dashboard row unaffected |
| "Alert delivery misconfigured" banner | AC-7.ALR.009.1 | An unroutable alert **persists here** + raises this critical condition — pinned, always loud |
| "Alert engine stalled" banner | AC-7.ALR.008.2 (watchdog) | The alert engine's own heartbeat stalled → "no alerts" may be untrustworthy ⚠️ AF-118 |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Mark read / actioned | Transitions a notification's `read_state`; a **critical/hard-limit** item is not silenced until resolved (FR-7.ALR.005.2) | any Dashboard Access node (clearance-scoped) |
| Acknowledge (stop escalation) | Acknowledges within the escalation window (FR-7.ALR.005.1) — stops the secondary alert; a critical stays visible until resolved | any Dashboard Access node |
| Go to source | Jumps to the originating surface (stale-approval → surface-04; cost breach → surface-05 Cost; suggestion → Section D) | the destination surface's own gate |
| Notification settings → | Links to surface-01 #observability (alert routing, escalation, quiet-hours) | `PERM-config.observability` (Super Admin only) |

**Real-time / poll:** **Realtime via Supabase subscription** (FR-7.RTP.001 — the one Realtime element of this surface).
Critical notifications appear without a manual refresh (AC-7.RTP.001.2). On a dropped socket it **reconnects or falls
back to polling**, and the connection pill shows **live vs reconnecting/polling honestly** (AC-7.RTP.004.2). On
reconnect it **re-fetches** so a notification that arrived while offline is not missed (mirrors surface-04's offline
re-fetch discipline). Under connection-budget pressure the centre is **prioritised** for the live connection
(AC-7.RTP.003.1).

**States:**
- **Loading:** Skeleton notification rows; the bell shows a neutral state — **never "0 unread / all clear" before data**.
- **Empty:** **The genuine healthy state** — "You're all caught up — no notifications." (distinct from a fetch failure
  or a stalled engine).
- **Error:** The notification read fails → "Couldn't load notifications." + retry; the bell shows **"—", not "0"**
  (a "0 unread" that is really a fetch failure would hide a hard-limit alert — the cardinal #1/#3 sin here). Any
  previously-latched critical banner persists.
- **Partial:** The list loads but a row's detail / Slack-status fails → render the notification, flag "detail
  unavailable," **never drop a critical row**.
- **Offline / stale:** The socket dropped → connection pill **"Reconnecting / Polling"** (never "Live"); the centre
  falls back to polling and **re-fetches on reconnect**; a latched critical persists. If the **alert-engine-stalled**
  banner is up, "no new notifications" is explicitly marked untrustworthy (AC-7.ALR.008.2) — the user is told the
  watcher itself may be down.

---

### Section B — At-a-Glance (management rollup)

**Purpose:** The non-technical leadership summary — "what's pending my decision, what did the AI handle, what needs
attention?" — a business-framed rollup distinct from surface-05's technical health panels (FR-7.VIEW.002, the Manager
non-technical view). Each tile reads a producing component's signal; **C7 invents no signal** (AC-7.VIEW.001.1).

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Pending my approval | C5/C6 awaiting_approval count for this user (FR-7.ALR.002 stale-approval seam) | Count + "oldest waiting HH:MM"; click → surface-04 (the live queue) |
| Handled today | C7 `event_log` rollup (FR-7.LOG.*) | A plain-English count of AI actions completed (business framing, not raw task metrics) |
| Open notifications | C7 `notifications` (Section A) | Unread + escalated count; click → Section A |
| Active suggestions | C9 `proactive_suggestions` (Section D) | Count of undismissed ranked suggestions for this user |
| Client activity highlights (Account Manager) | C7 `event_log` filtered to this AM's entities (clearance-scoped, ADR-006) | The AM's clients' recent AI activity; **no `client_slug`** — intra-client entity scoping |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Open approval queue | Navigates to surface-04 (the live awaiting_approval / flagged queue) | `PERM-action.review` (surface-04's gate) |
| Jump to feed / suggestions | Scrolls to Section C / D | same as entry |

**Real-time / poll:** **Polls** at `polling_interval_health_metrics_s` (30s) for the count tiles (FR-7.RTP.002); the
pending-approval count reflects the live queue but the *live* queue itself is surface-04 (Realtime). New notification
counts ride the Section A Realtime socket.

**States:**
- **Loading:** Skeleton tiles — **never a green "nothing pending" before data**.
- **Empty:** "Nothing pending — the AI is handling things and nothing needs your decision right now." (a true quiet
  state, distinct from a fetch failure).
- **Error:** A tile's read fails → that tile shows **"—", not "0"** + retry (a "0 pending approvals" that is really a
  fetch failure would hide a decision waiting on this user). Tiles degrade independently.
- **Partial:** Some tiles resolve, others fail → render the resolved; failed tiles show "—," never "0"/"✓".
- **Offline / stale:** "as-of HH:MM" on each tile; counts marked stale rather than silently frozen.

---

### Section C — Activity Feed (with the answer-mode pill)

**Purpose:** The plain-English timeline of what the AI did, each AI-output item carrying its **answer-mode pill**
(Cited / Inferred / Unknown, C4 FR-4.CID.006) so a non-technical leader can judge groundedness at a glance
(AC-7.VIEW.002.2). This surface is a **canonical home of the answer-mode pill** (surface-05 seams it here). Read-only
business lens; the technical event log is surface-05's Event Log panel.

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Activity items | C7 `event_log` (FR-7.LOG.001–006), clearance-scoped (ADR-006) | Plain-English "what happened" rows; redaction-tombstone retention honoured (AC-7.LOG.006.3); a viewer sees only rows their clearance permits |
| **Answer-mode pill** | **C4 FR-4.CID.006** (Cited / Inferred / Unknown) | Rendered on **every AI-output item** (AC-7.VIEW.002.2); the pill *meaning* binds DRY to C4 — never re-typed here. `[Building]` entity-coverage is a **C2** flag (FR-2.MNT.*), seamed not redefined |
| Per-entity pill mix (forwarded) | AC-7.VIEW.002.2 | The proportion of Inferred/Unknown per entity is **forwarded to C2** for the thin-coverage signal; **the threshold is C2's**, not this surface's |
| Item detail | C7 `event_log` row | Expand for the plain-English detail; a "view trace" deep-link is a technical affordance (surface-05), gated separately |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Filter feed | By type / entity / answer-mode / time | same as entry (results clearance-scoped) |
| Expand item | Shows the plain-English detail | same as entry |
| View technical trace → | Deep-links to surface-05's Event Log (for a technical role) | `PERM-dashboard.ops` |

**Real-time / poll:** **Polls** the `event_log` at `polling_interval_event_log_s` (60s) (FR-7.RTP.002) — the feed is
not a Realtime surface (only the notification centre + approval queue are, FR-7.RTP.001).

**States:**
- **Loading:** Skeleton feed rows.
- **Empty:** "No activity yet." (a genuine new-deployment / quiet state).
- **Error:** Read fails → "Couldn't load the activity feed." + retry; **never an empty 'nothing happened'** (a blank
  feed that is really a fetch failure would imply the AI is idle when it may be very active). Show "—".
- **Partial:** Some rows load, others fail (or a pill can't resolve) → render what loaded; a row whose **answer-mode
  pill can't be resolved is marked "mode unknown," never silently shown as Cited** (a false "Cited" would overstate
  groundedness — a #3 trust hole).
- **Offline / stale:** "as-of HH:MM"; the feed is marked stale rather than read as current.

---

### Section D — Proactive Suggestions

**Purpose:** The C9 engine's ranked, explained suggestions routed to this person (FR-9.SUG.004 / FR-9.PRO.001–007) —
the "what the AI thinks you should do next" panel. C9 produces the items + their routing-by-risk-type; **C7 delivers**;
this surface **renders**. Every suggestion's "act" routes through the C6 guardrail (FR-9.MODE.003) — a suggestion is
never a back-door around approval.

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Suggestion cards | C9 `proactive_suggestions` (FR-9.SUG.001/004), clearance-scoped | Ranked by urgency; recipient determined by risk-type/ownership (FR-9.SUG.004) |
| Reasoning + answer-mode pill | C9 FR-9.SUG.003 + C4 FR-4.CID.006 | Each card explains *why* + carries its pill (Cited / Inferred / Unknown) |
| Risk type / generator | C9 FR-9.PRO.001–007 | relationship · meeting-prep · doc-prep · de-risking · opportunity · daily-briefing · pattern |
| Dismissal + safety-floor state | C9 FR-9.SUG.005 | A dismissed suggestion learns; a **metric-past-threshold (floored) item re-delivers regardless of prior dismissal** (AC-9.PRO.004.2/.4 floor) |
| Proposed action + mode | C9 FR-9.MODE.* / FR-9.MODE.003 | Suggest / Prepare / Act mode = f(C6 risk tier); an "act" **routes through the C6 approval path** — floored rows (client/financial/Restricted comms) never auto-act |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Act on suggestion | Routes the proposed action through the **identical C6 approval path** (FR-9.MODE.003) — a held action lands in surface-04; an Act-mode reversible item may auto-run per C6, never bypassing the guardrail | the action's own C6 tier + clearance (C1) |
| Prepare (draft) | Generates the draft and routes it to the approval queue (surface-04) per the generator's mode | the action's C6 tier |
| Dismiss | Dismisses + feeds dismissal-learning (FR-9.SUG.005); **a floored item cannot be dismissed away** — it re-delivers if its metric stays past threshold (AC-9.PRO.004.2/.4) | same as entry |
| Explain | Expands the reasoning + the answer-mode basis | same as entry |

**Real-time / poll:** **Polls** the `proactive_suggestions` store (FR-7.RTP.002); a **new** suggestion's *notification*
rides the Section A Realtime socket (FR-9.SUG.004 delivery via the C7 notification centre), so a freshly-ranked
suggestion surfaces live in the bell while the panel list refreshes on poll.

**States:**
- **Loading:** Skeleton suggestion cards.
- **Empty:** "No suggestions right now — the AI will surface things as it spots them." (genuine quiet; distinct from
  a fetch failure and from the cold-start suppression state).
- **Error:** Read fails → "Couldn't load suggestions." + retry; shows "—", **never an empty 'nothing suggested'** that
  is really a fetch failure (a floored de-risking suggestion hidden by a silent failure is a #3 hole).
- **Partial:** Some cards load, others fail → render what loaded; a card whose reasoning/pill can't resolve is shown
  "detail unavailable," never silently dropped (especially a floored item — AC-9.PRO.004.2/.4).
- **Offline / stale:** "as-of HH:MM"; the panel is marked stale; a floored item latched before going stale persists.
  *(Cold-start suppression — C9's phase ladder — is a distinct, labelled state, not an error: "Suggestions are paused
  while the system learns your business." FR-9 cold-start.)*

---

## Navigation / transitions

| Trigger | Destination |
|---|---|
| Leadership sign-in (client deployment) | surface-07 (agency dashboard) |
| Notification bell | Section A notification-centre slide-over (cross-cutting, every dashboard) |
| Notification → Go to source (stale approval) | surface-04 (the live approval queue) |
| Notification → Go to source (cost breach) | surface-05 Cost panel |
| Notification → Go to source (suggestion) | Section D |
| At-a-Glance → Pending my approval | surface-04 |
| Activity item → View technical trace | surface-05 Event Log (`PERM-dashboard.ops`) |
| Suggestion → Act / Prepare | The C6 approval path → surface-04 (if held) |
| Notification / alert settings → | surface-01 #observability (`PERM-config.observability`) |
| Answer-mode pill legend → | The C4 FR-4.CID.006 definition (DRY source) |

---

## Mobile

The notification centre and the activity feed are **genuine mobile use cases** — a manager glancing at "what needs my
decision" and "what did the AI do" from a phone. The **notification-centre push routing is FR-7.VIEW.003**: critical
alerts **immediate**, hard-limit hits **immediate and always** (non-suppressible, AC-7.VIEW.003.1), pending-/stale-
approval pushes at a **configurable frequency** (AC-7.VIEW.003.2). On a narrow viewport the dashboard collapses to a
stacked single column — notification bell + At-a-Glance tiles + a condensed activity feed; the **live/reconnecting
indicator and the two protective banners are mandatory on mobile** (a stale "all caught up" on a phone is a dangerous
false-healthy view). Acting on a suggestion still routes through the **same C6 approval path** (no mobile back-door).
Detailed mobile treatment: `surface-12-mobile.md`.

---

## Open decisions

| # | Question | Options | Recommendation |
|---|---|---|---|
| OD-129 ⚠️ **Rule-0 PERM gap** | FR-1.PERM.007 **homes** the twelve permission categories — incl. **Dashboard Access** — but **no concrete `PERM-dashboard.*` node id was ever catalogued**. surface-05 (signed off) already references a "Dashboard Access (ops)" node that does not exist in `PERMISSION_NODES.md` — an owed gate (same drift the catalog flags for surface-03/04). A gate with no catalog entry is a build-time #3 defect. | (a) **Mint the Dashboard Access node family via change-control** under the existing FR-1.PERM.007 category, scope **intra-client**: `PERM-dashboard.overview` (this surface — Super Admin/Admin/Account Manager) **and** formalise `PERM-dashboard.ops` (surface-05 — Super Admin/Admin + Finance-scoped-to-Cost; canonicalises surface-05's working name `PERM-dashboard.view_ops`, whose reference is updated in lockstep), transcribed now to close surface-05's drift; the **notification centre is NOT a node** (cross-cutting chrome on any Dashboard Access node, clearance-scoped). (b) One coarse `PERM-dashboard.view` for all dashboards (no least-privilege between the technical ops view and the leadership view). (c) Reuse `PERM-config.observability` (wrong — that gates *editing* alert config, not *viewing* a dashboard). | **(a)** — least-privilege (a non-technical Account Manager gets the agency view without the technical ops dashboard or its DLQ controls), closes a **real existing drift** (surface-05's dangling node reference) rather than adding to it, sits under the **already-homed** FR-1.PERM.007 category (no new category, no ADR supersede — mirrors surface-04 OD-117's mint under "Approval Authority"), and keeps the cross-cutting notification centre node-free per FR-7.ALR.001 ("accessible from every view"). Records all nodes with the four fields in OD-129; transcribe into `PERMISSION_NODES.md` immediately (per the catalog's add-on-ship rule). **C1 catalog grows; no FR re-approval.** |
| OD-130 | **Layout** — notification centre as a persistent bell + slide-over (cross-cutting chrome) + a sectioned main agency view, vs a tabbed dashboard, vs a single scroll with the notifications as a column. | (a) **Persistent bell + slide-over (cross-cutting) + sectioned main view** (At-a-Glance / Activity Feed / Suggestions). (b) Fully tabbed (Notifications / Activity / Suggestions tabs). (c) Single scroll with a notifications side-column. | **(a)** — the notification centre is cross-cutting chrome that must ride **every** dashboard (FR-7.ALR.001), so a persistent bell + slide-over is the only treatment that works on surface-05/07/08 alike; tabbing it (b) would hide the unread count and break the "accessible from every view" guarantee; a fixed side-column (c) wastes space on the technical dashboards. The main agency view is task-oriented and reads best as discrete sections. The two always-loud banners pin above any section so a critical condition never hides behind a tab. |
| OD-131 | **Notification-centre scope** (behaviour) — is the notification centre exclusive to surface-07, or cross-cutting chrome rendered on every dashboard (surface-05/08 too)? | (a) **Cross-cutting chrome, home-specced here** — rendered on every dashboard (bell + slide-over), available to any holder of any Dashboard Access node, **clearance-scoped per viewer**. (b) Exclusive to surface-07 (a Standard User on surface-08 would have no notification centre). (c) A separate stand-alone surface only. | **(a)** — FR-7.ALR.001 is explicit: the notification centre is "primary, persistent, **accessible from every view**." (b) would leave a Standard User with no way to receive a notification on their own surface (surface-08), violating FR-7.ALR.001; (c) buries the most time-sensitive surface in the product behind a navigation step. Home-speccing it here (the agency dashboard) while declaring it cross-cutting chrome keeps one canonical spec without gating it to one surface. The per-viewer **clearance scoping** (AC-7.VIEW.002.1 / FR-9.SUG.004) means a viewer only ever sees notifications whose content they may see. |
| OD-132 | **Proactive-suggestion actions** (behaviour) — when a user "acts" on a suggestion here, does it execute inline, or route through the C6 approval path? And can a floored suggestion be dismissed away? | (a) **Every "act" routes through the identical C6 approval path** (FR-9.MODE.003) — a held action lands in surface-04, a reversible Act-mode item may auto-run *per C6*, never bypassing the guardrail; **a floored item (client/financial/Restricted) cannot be dismissed away** — it re-delivers while its metric stays past threshold (AC-9.PRO.004.2/.4). (b) Inline execution from this surface (a back-door around C6). (c) Read-only — suggestions can only be viewed, never acted on here. | **(a)** — FR-9.MODE.003 mandates that *every* proactive action, including Act-mode, routes through the same C6 guardrail; an inline executor (b) would be a #2 violation (a route that does something it shouldn't, bypassing the autonomy matrix); (c) is too weak — the value of the suggestion is acting on it. The dismissal **safety floor** (FR-9.SUG.005 / AC-9.PRO.004.2/.4) is preserved: a de-risking or floored item the user keeps dismissing still re-surfaces while the risk persists — dismissal-learning never silences a safety-critical suggestion. |

---

## Phase 4 data binding notes

- **`notifications` store** (C7-owned, intra-client) — `id`, `type`, `severity`, `title`, `body`, `read_state`
  (unread/read/actioned), `recipient` (resolved role/user), **`escalation_state` + `escalated_at`** (FR-7.ALR.005 —
  a **net Phase-4 field-set**, like surface-04's `escalated_at`), **`actioned_at`** (FR-7.ALR.001 unread-until-actioned
  — net field), `delivery_state` (dashboard-persisted-first + Slack best-effort outcome, FR-7.ALR.006), `created_at`.
  **The dashboard row is persisted before/independent of any Slack fan-out** (FR-7.ALR.006); Phase 4 must enforce the
  dashboard row is never contingent on Slack success. **No `client_slug`** (OD-096); RLS-scoped to the silo + viewer
  clearance (ADR-006).
- **`event_log`** (C7-owned, read here) — the activity-feed source; each AI-output row carries an **answer-mode pill
  value** (C4 FR-4.CID.006). Phase 4: confirm the pill value is a stored column on the output row (or derivable at read
  time) and that the per-entity pill-mix aggregation (forwarded to C2) has an index. Redaction-tombstone retention
  (AC-7.LOG.006.3) applies. **No `client_slug`.**
- **`proactive_suggestions`** (C9-owned, read here; dismissal/act via C9) — ranked urgency, reasoning, answer-mode pill,
  risk-type, recipient, delivery state, **dismissal state + safety-floor flag** (FR-9.SUG.005 / AC-9.PRO.004.2/.4). Phase 4:
  the floor flag must be queryable so a floored item re-delivers regardless of dismissal. **No `client_slug`.**
- **New intra-client PERM nodes (OD-129)** — `PERM-dashboard.overview` (Super Admin/Admin/Account Manager) +
  `PERM-dashboard.ops` (Super Admin/Admin + Finance-scoped), scope **intra-client**, under the FR-1.PERM.007
  "Dashboard Access" category; owed to `PERMISSION_NODES.md` with all four fields (FR-1.PERM.005). The **notification
  centre is node-free** (rides any Dashboard Access node, clearance-scoped).
- **Clearance scoping (ADR-006)** — the activity feed, the suggestions panel, and the notification centre are all
  **RLS-scoped at the row** to the viewer's C1 clearances (Personal/Restricted/Confidential); Phase 4 must define these
  policies so a viewer never sees a notification/activity/suggestion whose content they may not see — UI filtering alone
  is insufficient (human-path RLS, ADR-006).
- **Realtime filter (FR-7.RTP.003.3)** — the notification-centre Realtime subscription's filter **does not depend on
  `client_slug`** (intra-silo only); Phase 4's Realtime policy must honour this.
