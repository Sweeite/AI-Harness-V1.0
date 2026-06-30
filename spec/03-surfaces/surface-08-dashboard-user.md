# Surface: UI-DASHBOARD-USER (surface-08) — Standard User Dashboard (My Workspace · Chat · My Queue · Activity Feed)

**Status:** 🟢 **Signed off 2026-07-01** (operator: "Cool do it" — recommendations delegated). **9 of 14 Phase-3 surfaces
complete.** OD-133–136 🟢. **Verification gate (independent zero-context subagent, checks a–f): _pending — recorded below
on completion_.** The ninth Phase-3 surface. One surface ID is minted here: **`UI-DASHBOARD-USER`** — the **Standard User
role view** (FR-7.VIEW.002 names five RBAC-gated role surfaces, one of which is the **Standard User** view, but assigns
no formal `UI-` id). This surface is also a **canonical home of the answer-mode pill** (Cited / Inferred / Unknown, C4
FR-4.CID.006) — the *other* home is surface-07; surface-05 seams the pill to "home surfaces 07/08". **OD-133 mints the
third Dashboard Access node `PERM-dashboard.workspace`** via change-control — anticipated explicitly by surface-07/OD-129
("surface-08's standard-user node"), closing the family. Next OD: OD-137.

> The **everyday user's home** — the surface a Standard User (and every other role, as their personal workspace) lands on
> after sign-in. Where surface-05 is the technical operator's instrument panel and surface-07 is leadership's business
> view, surface-08 is **"me and my work with the AI"**: a **chat interface** for direct interaction and `/` commands, a
> **My Queue** of the tasks assigned to or awaiting me, an **Activity Feed** of what the AI has done relevant to my work,
> and the cross-cutting **notification centre** + the **proactive suggestions** routed to me. Every AI output it
> renders — in chat and in the feed — carries its **answer-mode pill** so a non-technical user can tell a grounded
> answer from an inferred one. The three non-negotiables it most directly serves: **#1** (a chat thread and a queued
> task are never silently lost; a notification persists until actioned), **#2** (a `/` command routes through the same
> C1 node gate + C6 guardrail as any action — chat is never a back-door; a destructive command demands confirmation),
> and **#3** (an unknown command shows guidance never a silent no-op; a fetch failure never reads as "nothing happening";
> an `[Unknown]`/cold-start answer is labelled, never dressed up as Cited). It does **not** render the technical ops
> panels (surface-05), the leadership rollup (surface-07), the full approval *queue* (surface-04 — though *my* pending
> items link there), or any cross-deployment view (surface-06).

---

## Context manifest

- **Surface ID:** **`UI-DASHBOARD-USER`** (minted here) — FR-7.VIEW.002 names the **Standard User** view as one of the
  five RBAC-gated role surfaces but assigns no formal `UI-` id. The operator's planning-doc "My Workspace / Inbox /
  Decisions / chat" labels map here; the **design-doc canonical** (`design-doc-v4.md` L3256–3262, "Dashboard 4 —
  Standard user view") names exactly three panels — **My queue · Activity feed · Chat interface** — which this surface
  renders, plus the two FR-mandated carry-ins (notification centre + proactive suggestions). *(Label note: "My
  Workspace" = this surface / the chat; "Inbox" = the notification centre + delivered suggestions; "Decisions" = My
  Queue — the items awaiting my input. These are planning-doc framings, not new concepts; the design-doc three panels
  are the authority. Mirrors how surface-07 mapped "Agency Owner"/"Manager" onto the six canonical C1 roles.)*
- **Owned by:** **C7 (Observability)** — the role-scoped dashboard + answer-mode-pill contract (FR-7.VIEW.001/002), the
  Realtime/poll contract (FR-7.RTP.001–004), and the notification centre + alerting (FR-7.ALR.001). **C9 (Proactive
  Intelligence)** — the `/` command dispatch (FR-9.CMD.001–008), the proactive suggestions delivered here
  (FR-9.SUG.004/005 / FR-9.MODE.003), and the cold-start suppression that governs what a user sees (FR-9.CST.001/002).
  **C5 (Agent Harness)** — the `task_queue` that backs My Queue and the human-initiated chat→task path (FR-5.TRG.001).
  **C4** owns the answer-mode-pill definition (FR-4.CID.006). The notification centre is **home-specced on surface-07**;
  it rides here as cross-cutting chrome (FR-7.ALR.001 / OD-131).
- **FRs served:**
  - **The Standard User role view + answer-mode pill (C7 VIEW):** FR-7.VIEW.002 (**the Standard User view is one of the
    five RBAC-gated role surfaces** — a role sees only the signals its C1 permissions allow AC-7.VIEW.002.1; **every
    AI-output item in an activity feed / chat carries its answer-mode pill** AC-7.VIEW.002.2, C4-sourced). FR-7.VIEW.001
    is the parent dashboard contract (each panel's signal produced by its home component, C7 invents none AC-7.VIEW.001.1).
  - **The Realtime / poll contract (C7 RTP):** FR-7.RTP.001 (**exactly two Realtime surfaces** — the approval queue and
    the notification centre; **no surface outside those two holds a Realtime subscription by default** AC-7.RTP.001.3 —
    so the chat, My Queue, and the activity feed all **poll**), FR-7.RTP.002 (per-surface poll cadences, configurable —
    event log 60s, health 30s; read-from-config + live-effect AC-7.RTP.002.1/.2), FR-7.RTP.004 (**a dropped socket
    reconnects or falls back to polling; the UI shows live-vs-reconnecting/polling honestly** AC-7.RTP.004.2 — for the
    notification centre socket that rides here).
  - **The notification centre (C7 ALR, cross-cutting chrome — home spec surface-07):** FR-7.ALR.001 (**primary +
    persistent + accessible from every view**; every alert produces a dashboard notification independent of Slack
    AC-7.ALR.001.1; unread until actioned, reachable from any view AC-7.ALR.001.2). A Standard User who never opens
    Slack relies entirely on this centre; it is **clearance-scoped** so they see only notifications whose content their
    C1 clearances permit.
  - **The `/` command interface (C9 CMD):** FR-9.CMD.001 (**the `/` command system in the chat interface** — dispatches
    each command to its home component; a valid command returns a result AC-9.CMD.001.1, an unknown command shows
    **guidance, never a silent no-op** AC-9.CMD.001.2), FR-9.CMD.002 (**each command gated on a C1 permission node**, not
    a role ladder; a caller without the node is **denied + logged** AC-9.CMD.002.1; no "Agency Owner" role
    AC-9.CMD.002.2; unmapped → default-deny AC-9.CMD.002.3), FR-9.CMD.003 (**a destructive command requires explicit
    confirmation** AC-9.CMD.003.1, the confirm does **not** bypass the underlying C6 gate AC-9.CMD.003.2, and the
    **node gate is evaluated before the confirm prompt** AC-9.CMD.003.3), FR-9.CMD.004 (**every command produces an
    answer-mode-pill response + an `event_log` entry** AC-9.CMD.004.1/.2; a node-gated/destructive command whose
    `event_log` write fails **fails closed** AC-9.CMD.004.3), FR-9.CMD.006/007/008 (**custom commands** — defined/managed
    on surface-10, but **invoked here**: a permitted custom command appears in the `/` menu AC-9.CMD.007.1, resolves
    `$ARGUMENTS` and returns **inline in the chat thread with a pill**, same C6 pipeline, **no `task_queue` entry**
    AC-9.CMD.008.1/.3; an assigned-agent error surfaces inline, never silent AC-9.CMD.008.2; a disabled agent →
    "command unavailable" AC-9.CMD.006.3).
  - **The proactive suggestions delivered here (C9 SUG/MODE/CST):** FR-9.SUG.004 (**multi-surface delivery "it follows
    you"** — a ranked suggestion routed to the right owner is delivered across **dashboard, chat interface, and mobile
    push** via the C7 notification centre AC-9.SUG.004.1; no eligible recipient → escalate, never dropped AC-9.SUG.004.2),
    FR-9.SUG.005 (**dismissal-learning with a safety floor** — a dismissed signal down-weights *for that
    entity/context* AC-9.SUG.005.1, but a derisking/hard-risk signal **never falls below the floor** and **re-surfaces
    when its metric escalates past threshold regardless of prior dismissal** AC-9.SUG.005.2/.3), FR-9.MODE.003 (**every
    proactive action — including Act-mode — routes through the identical C6 guardrail pipeline**; proactivity changes
    *who initiates*, never *what is permitted* AC-9.MODE.003.1/.2), FR-9.CST.002 (**proactive suggestions fully
    suppressed below the proactive threshold** — "doesn't know enough to suggest anything" AC-9.CST.002.1; unlock at/above
    AC-9.CST.002.2; a **guardrail-class** safety event is still delivered AC-9.CST.002.3), FR-9.CST.001 (**the cold-start
    phase matrix** — &lt;20% agents read-only on external systems + every `[Unknown]` carries the cold-start note;
    consumes C2's phase, fails safe to **cold** when the phase signal is stale/absent AC-9.CST.001.2).
  - **The chat→task path (C5):** FR-5.TRG.001 (a human-initiated chat command becomes a **human-initiated task** in
    `task_queue` — the write path is C5's, not a direct insert; an async task's result returns to chat on poll / via the
    notification-centre nudge, **not** a third Realtime socket — FR-7.RTP.001).
  - **The answer-mode pill (C4):** FR-4.CID.006 (the **Cited / Inferred / Unknown** classification — the canonical
    source; this surface renders it on every chat output + feed item, never re-defines it).
- **CFG dependencies** (read here; **edited on surface-01** at the cited anchor — never editable from this surface;
  description text binds DRY to `config-registry.md`'s `What it does` column, never re-typed):
  - **Realtime / poll** (`#observability`, **LIVE**, `PERM-config.observability`): `realtime_connection_headroom_threshold`
    (**80%** — when live connections degrade extras to polling; the notification-centre socket is prioritised),
    `polling_interval_event_log_s` (**60** — the activity-feed + chat-result refresh), `polling_interval_health_metrics_s`
    (**30** — the My-Queue count refresh).
  - **Cold-start** (`#proactive`, **LIVE**, `PERM-config.proactive`): `cold_start_proactive_threshold` (**50%** — below
    this, the proactive-suggestions panel is suppressed with a labelled "learning" state, FR-9.CST.002).
- **PERM gates:** ⚠️ **OD-133 — a Rule-0 gap (change-control mint), anticipated by surface-07.** OD-129 minted the
  Dashboard Access node family (`PERM-dashboard.overview`, `PERM-dashboard.ops`) and **explicitly named a third,
  not-yet-minted node — "surface-08's standard-user node"** — as a holder of the cross-cutting notification centre.
  This surface mints it: **`PERM-dashboard.workspace`** — enter the personal user workspace (chat + My Queue + my
  activity feed + my suggestions). Scope **intra-client**, under the **already-homed** FR-1.PERM.007 "Dashboard Access"
  category (no new category, no ADR supersede — mirrors OD-129/OD-117/OD-125). **Default roles: all six** (Super Admin,
  Admin, Finance, HR, Account Manager, Standard User) — every authenticated user has a personal workspace/chat; the
  higher roles also hold `PERM-dashboard.overview`/`.ops` for their management/technical views. Per-action gating
  inside is **finer than entry**:
  - **Each `/` command is gated on its own C1 node** (FR-9.CMD.002), evaluated against the caller's node set — entry to
    the chat does **not** grant any command; a caller without `/forget`'s node is denied + logged, never shown the confirm
    (AC-9.CMD.003.3). Custom commands carry the node set at definition (FR-9.CMD.006, surface-10).
  - **My Queue's "go decide" routes to surface-04**, gated there by `PERM-action.review`; this surface shows *my*
    pending/assigned items but the decision UI is surface-04's.
  - **Acting on a suggestion** is gated by the action's own **C6 tier + C1 clearance** (FR-9.MODE.003) — never by chat
    entry alone.
  - **The notification centre is node-free** (OD-131) — cross-cutting chrome available to any Dashboard Access holder
    (`PERM-dashboard.workspace` here), **clearance-scoped** per viewer (AC-7.VIEW.002.1).
  - All nodes default-deny (FR-1.PERM.002 / OD-030); build obligation = appear in `PERMISSION_NODES.md` with all four
    fields (FR-1.PERM.005). Recorded in `open-decisions.md` OD-133. **C1 catalog grows; no FR re-approval, no ADR
    supersede.**
- **DATA bindings** (Phase-4 stubs; **intra-client — no `client_slug` on any** per OD-096 / FR-10.ISO.001; RLS-scoped to
  the silo + the viewer's clearances, ADR-006):
  - **C5-owned `task_queue`** (read; filtered to *this user* — assigned to me or awaiting my input/approval) — per-row:
    `id`, `type` (`human`/proactive/etc.), `status` (incl. `awaiting_approval`, `flagged`), `originating_user_id` (the
    net Phase-4 field flagged on surface-04), `created_at`, plain-English summary. The decision UI for an
    `awaiting_approval` row is **surface-04**.
  - **C7-owned `event_log`** (read; the activity-feed source) — append-only plain-English rows (FR-7.LOG.001–006),
    **clearance + relevance scoped** to this user's work; each AI-output row carries its **answer-mode pill** value
    (C4 FR-4.CID.006); redaction-tombstone retention honoured (AC-7.LOG.006.3).
  - **C7-owned `notifications`** (read; the notification centre — home-specced surface-07) — clearance-scoped to this
    viewer.
  - **C9-owned `proactive_suggestions`** (read; dismissal/act write via C9) — ranked urgency, reasoning, answer-mode
    pill, risk-type, recipient, dismissal state + safety-floor flag (FR-9.SUG.001/004/005).
  - **NET-NEW Phase-4 store — the chat thread (OD-135).** The spec defines **no `chat_messages`/`conversations` store
    today** — the chat is currently a rendering surface over `task_queue` + `event_log` + command results. OD-135
    resolves to **persist the thread** (a Phase-4 `conversations` + `messages` store keyed to the user, RLS-scoped, no
    `client_slug`) so a user's interaction history is not silently lost on reload (#1). Flagged as a **net-new Phase-4
    schema obligation**, owed to C5/C9 to home formally. Synchronous custom-command results (FR-9.CMD.008) write **no
    `task_queue` row** — the message store (+ the `event_log` audit entry FR-9.CMD.004) is their only record.
- **ADR constraints:**
  - **ADR-001 §3** — intra-client only; one client silo, no `client_slug`, no cross-deployment view (that is surface-06).
  - **ADR-006** — RLS is the authority for what this user sees; the activity feed, My Queue, the notification centre,
    and the suggestions panel are **RLS-scoped at the row** to the viewer's C1 clearances (human-path RLS), not UI-only
    filtering. A Standard User's default clearance is the floor (FR-1.CLR.*); a Personal/Restricted/Confidential item
    they may not see is never rendered.
  - **The three non-negotiables** — **#1** (the chat thread persists, OD-135; a queued task is never lost; a
    notification persists unread-until-actioned), **#2** (a `/` command routes through its C1 node gate + the underlying
    C6 guardrail — chat is no back-door, FR-9.CMD.002/.003.2; a proactive "act" routes through C6, FR-9.MODE.003), **#3**
    (an unknown command shows guidance not a silent no-op, AC-9.CMD.001.2; a node-gated command whose log write fails
    fails closed, AC-9.CMD.004.3; a fetch failure never reads as "nothing happening"; an `[Unknown]`/cold-start answer
    is labelled, never shown as Cited).

---

## Overview

surface-08 is the **everyday user's home** on a client deployment — the surface a **Standard User** lands on after
sign-in, and the personal workspace every other role also has alongside their management (surface-07) or technical
(surface-05) views. It renders the design-doc's three Standard-User panels (`design-doc-v4.md` L3256–3262) — **Chat
interface · My Queue · Activity feed** — plus the two FR-mandated carry-ins: the cross-cutting **notification centre**
(home-specced surface-07, FR-7.ALR.001) and the **proactive suggestions** routed to this person (FR-9.SUG.004). Its
heart is the **chat interface**: direct natural-language interaction with the AI, the `/` command menu (FR-9.CMD.001),
and inline results that each carry an **answer-mode pill** (Cited / Inferred / Unknown) so a non-technical user can read
groundedness at a glance. **My Queue** is the user's slice of work — tasks assigned to them or awaiting their input,
with the decision UI for a held item living on surface-04. The **Activity Feed** is the plain-English, clearance-scoped
timeline of what the AI did relevant to this user's work. The cardinal sins here are a `/` command that does something
the user's role shouldn't (a #2 back-door), an `[Unknown]` answer dressed up as Cited (a #3 trust hole), and a chat or
queue that silently loses the user's work (#1).

---

## Access

> Uses the six canonical C1 roles (FR-1.ROLE.001). **Every** role can enter their personal workspace — the entry node
> `PERM-dashboard.workspace` (OD-133, minted via change-control under the FR-1.PERM.007 "Dashboard Access" category,
> intra-client) defaults to **all six roles**. The **notification centre** is cross-cutting chrome riding any Dashboard
> Access node, **clearance-scoped** per viewer (OD-131). What differs by role is **content** (clearance-scoped rows) and
> **per-command authority** (each `/` command gated on its own C1 node, FR-9.CMD.002) — not entry.

| Role | Can enter? | Notes |
|---|---|---|
| Super Admin | Yes | Their personal workspace (chat + My Queue + my feed). Also has surface-05/06/07. Holds the broadest `/` command node set |
| Admin | Yes | Personal workspace; also surface-05/07. Broad command node set |
| Finance | Yes | Personal workspace; sees Finance-clearance content; finance-scoped command node set |
| HR | Yes | Personal workspace; sees HR-clearance content; HR-scoped command node set |
| Account Manager | Yes | Personal workspace; the AM's primary management view is surface-07 — this is their personal chat + queue |
| Standard User | Yes | **The primary user of this surface** — chat, My Queue, my activity feed, my suggestions, the clearance-scoped notification centre. Floor clearance, narrowest command node set |

**Entry gate:** the workspace renders iff the caller holds `PERM-dashboard.workspace`; a caller without it never sees the
nav item and a direct URL returns 404 (FR-1.PERM.006 — denied surfaces are absent, not visible-but-empty). **Entry grants
no command** — each `/` command is independently node-gated (FR-9.CMD.002), and an unauthorized destructive command is
denied **before** the confirm prompt (AC-9.CMD.003.3). **Per-item content** (chat outputs, feed rows, queue items,
suggestions, notifications) is **clearance-scoped at the row** (ADR-006 RLS): an item the viewer's C1 clearances don't
permit is not rendered. **No config is editable here** — config links to surface-01. All nodes default-deny (OD-030).

---

## Layout

A sectioned personal workspace on the client deployment — the user's home after sign-in. The structure (**OD-134**) is a
**chat-centric main view + a persistent notification-centre affordance (cross-cutting chrome) + supporting panels**:

- **Persistent chrome (every dashboard, home-specced on surface-07):**
  - A **notification bell** with an unread count, top-right, opening the **Notification Centre slide-over** (Section A) —
    cross-cutting (OD-131), **clearance-scoped** to this viewer. The bell carries a **live / reconnecting / polling**
    indicator (FR-7.RTP.004) so the user knows whether the centre is live.
  - The two **always-loud banners** pin to the top of any view: **"alert delivery misconfigured"** (AC-7.ALR.009.1) and
    **"alert engine stalled"** (AC-7.ALR.008.2) — the conditions that mean "no notifications" may be untrustworthy.
  - An **answer-mode pill legend** affordance (links to the C4 FR-4.CID.006 definition — bound DRY, never re-typed).
- **The main workspace** is **chat-led**: a primary **Chat interface (B)** occupying the centre, with **My Queue (C)**,
  **Activity Feed (D)**, and **Proactive Suggestions (E)** as adjacent/collapsible panels (a sidebar on wide viewports,
  stacked sections on narrow — see Mobile).

Only the notification centre holds a Realtime subscription (FR-7.RTP.001/AC-7.RTP.001.3); **every other section polls**
(FR-7.RTP.002) — including the chat (an async task result returns on poll / via a notification nudge, **never** a third
Realtime socket; OD-135). Under connection-budget pressure the notification centre is **prioritised** for the live
connection while extras degrade to polling first (AC-7.RTP.003.1/.2).

---

## Sections

> Section A (the notification centre) is the Realtime cross-cutting panel, **home-specced on surface-07** — rendered
> here, clearance-scoped, not re-defined. Sections B–E are this surface's polled panels. Each live section states its
> Realtime/poll contract and all five states.

---

### Section A — Notification Centre (cross-cutting chrome; Realtime; home spec = surface-07)

**Purpose:** The single place every alert lands first (FR-7.ALR.001), riding here as cross-cutting chrome (OD-131) so a
Standard User who never opens Slack still receives every notification — **clearance-scoped** to what this viewer may see.
The full spec is surface-07 §A (`UI-NOTIFICATION-CENTRE`); this section binds to it, not re-defines it.

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Notification list | C7 `notifications` (FR-7.ALR.001), clearance-scoped | A Standard User sees only notifications whose content their C1 clearances permit (AC-7.VIEW.002.1); the seven alert rules + proactive-suggestion notifications + the two self-protective conditions — exactly as surface-07 §A |
| Proactive-suggestion notifications | C9 FR-9.SUG.004 (delivered via C7) | A new ranked suggestion routed to this user arrives here; opening it jumps to Section E |
| Live/reconnecting/polling indicator | FR-7.RTP.004 | Honest about the socket's state; never "Live" while disconnected |

**Actions:** identical to surface-07 §A (Mark read/actioned, Acknowledge, Go to source, Notification settings →
surface-01 #observability gated `PERM-config.observability`), available to any Dashboard Access holder, clearance-scoped.

**Real-time / poll:** **Realtime via Supabase subscription** (FR-7.RTP.001) — the one Realtime element here. Reconnects
or falls back to polling on a dropped socket; **re-fetches on reconnect** so a notification that arrived while offline is
not missed (AC-7.RTP.004.2). Prioritised for the live connection under budget pressure (AC-7.RTP.003.1).

**States:** identical posture to surface-07 §A — **Loading:** skeleton rows, bell neutral, never "0 / all clear" before
data. **Empty:** the genuine "You're all caught up" state. **Error:** "Couldn't load notifications" + retry; bell shows
**"—", not "0"** (a false "0 unread" would hide a hard-limit alert); any latched critical banner persists. **Partial:** a
row's detail fails → render the notification, flag "detail unavailable," never drop a critical row. **Offline / stale:**
pill "Reconnecting / Polling" (never "Live"); re-fetch on reconnect; if the alert-engine-stalled banner is up, "no new
notifications" is explicitly marked untrustworthy (AC-7.ALR.008.2).

---

### Section B — Chat interface (`/` commands + inline AI output, the answer-mode-pill home)

**Purpose:** Direct natural-language interaction with the AI and the `/` command menu (FR-9.CMD.001) — the heart of the
Standard User's workspace (design-doc L3261). Every AI output carries its **answer-mode pill** (AC-7.VIEW.002.2 / C4
FR-4.CID.006). This is a **canonical home of the pill** alongside surface-07's feed.

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Chat thread (messages) | **Net-new Phase-4 `conversations`/`messages` store (OD-135)**, RLS-scoped, no `client_slug` | The persisted user↔AI thread; reload-durable (#1). Synchronous command results (FR-9.CMD.008) live here + an `event_log` audit row — **no `task_queue` entry** |
| `/` command menu | C9 FR-9.CMD.001 + custom commands FR-9.CMD.007 | System commands (memory/task/agent/trigger) + permitted **custom** commands (defined on surface-10); only commands whose C1 node the caller holds are shown (AC-9.CMD.007.1; inactive/unpermitted hidden AC-9.CMD.007.2) |
| Inline command/agent result | C9 FR-9.CMD.004/.008 | Returned **inline in the thread with an answer-mode pill** (AC-9.CMD.004.2 / AC-9.CMD.008.1); `$ARGUMENTS` substituted for custom commands |
| Answer-mode pill | **C4 FR-4.CID.006** (Cited / Inferred / Unknown) | On every AI-output message; meaning binds DRY to C4. A pill that can't resolve reads **"mode unknown," never silently "Cited"** |
| Cold-start note | C9 FR-9.CST.001 | Below 20% coverage every `[Unknown]` carries the cold-start note; the chat surfaces it (fails safe to cold when the C2 phase is stale/absent, AC-9.CST.001.2) |
| Async-task status | C5 `task_queue` (FR-5.TRG.001) | A human chat command that becomes a `human` task shows a **"queued / running / done"** status inline; the result lands on poll / a notification nudge (not a Realtime socket) |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Send message | Natural-language turn → routed to the orchestrator (C8) → agent run; result inline with pill | entry (`PERM-dashboard.workspace`); the underlying agent run carries its own C6 guardrail |
| Invoke `/` command | Dispatches to the command's home component (FR-9.CMD.001); result inline with pill + `event_log` entry (FR-9.CMD.004) | **the command's own C1 node** (FR-9.CMD.002) — *not* entry; unmapped/unauthorized → denied + logged (AC-9.CMD.002.1/.3) |
| Confirm destructive command | A destructive command (`/forget`, `/reject`, destructive `/tune`) demands explicit confirmation **after** the node gate, **before** dispatch; the confirm does not bypass the underlying C6 gate | the command's node (evaluated *before* the confirm, AC-9.CMD.003.3) + the action's C6 tier |
| Run an async task (`/run`, …) | Creates a `human` `task_queue` row (FR-5.TRG.001); the chat shows queued status; an `awaiting_approval` outcome routes the decision to surface-04 | the command's node + the action's C6 tier |

**Real-time / poll:** **Polls** (FR-7.RTP.001 AC-7.RTP.001.3 — the chat is **not** a Realtime surface). Synchronous
custom/system commands (FR-9.CMD.008) return **inline immediately** (synchronous from the user's perspective). An async
`task_queue` result is reflected on the next poll at `polling_interval_health_metrics_s` / `polling_interval_event_log_s`,
and a **notification-centre nudge** (Section A, Realtime) tells the user it's ready — no third Realtime socket (OD-135).

**States:**
- **Loading:** Skeleton message rows; the composer is enabled but the thread shows a spinner — **never a blank "no
  history" before the thread loads** (a false-empty thread would imply lost history — #1).
- **Empty:** Genuine new user → a welcome / "Ask me anything, or type `/` for commands" zero-state.
- **Error:** Thread read fails → "Couldn't load your chat history" + retry; **never render an empty thread as if there
  were no history**. A command dispatch error surfaces **inline** ("that didn't run: …"), never a silent no-op
  (AC-9.CMD.001.2 / AC-9.CMD.008.2); a `/` command whose `event_log` write fails **fails closed** (AC-9.CMD.004.3).
- **Partial:** Thread loads but a message's pill / detail can't resolve → render the message, pill reads **"mode
  unknown," never "Cited"**; a disabled custom-command agent → "command unavailable," not a silent drop (AC-9.CMD.006.3).
- **Offline / stale:** Composer disabled with "You're offline — messages will send when you reconnect"; queued sends are
  not silently dropped; an in-flight async task's status is marked stale ("as-of HH:MM"), not shown as live.

---

### Section C — My Queue (tasks assigned to / awaiting me — the "Decisions" panel)

**Purpose:** The user's slice of work — tasks assigned to them or awaiting their input/decision (design-doc L3258, "My
queue: tasks assigned to me or waiting for my input"). The decision UI for a held item is **surface-04**; this panel is
the user's personal view + the route to it.

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| My tasks | C5 `task_queue` filtered to this user (`originating_user_id` or assigned), clearance-scoped | Status (queued/running/`awaiting_approval`/`flagged`/done), plain-English summary, "waiting since HH:MM" |
| Awaiting my decision | C5 `task_queue` `awaiting_approval`/`flagged` routed to this user (FR-6.APR.005 contextual routing) | Count + oldest-waiting; the **decision** happens on surface-04 (this panel links there) |
| Result / outcome | C5 `task_queue` terminal state + `event_log` row | A completed task's outcome with its answer-mode pill |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Open in approval queue | Navigates to surface-04 for the Approve/Reject/Modify decision (FR-6.ESC.003) | `PERM-action.review` (surface-04's gate) |
| View result | Expands the task outcome (plain-English + pill) | entry (clearance-scoped) |
| Retry / resume (where offered) | Re-submits a failed *human* task; routes through the same C6 guardrail | the action's C6 tier |

**Real-time / poll:** **Polls** at `polling_interval_health_metrics_s` (30s) for counts/status (FR-7.RTP.002); the *live*
approval queue is surface-04 (Realtime), the new-item *nudge* rides Section A's socket.

**States:**
- **Loading:** Skeleton rows — **never a green "nothing waiting" before data**.
- **Empty:** "Nothing in your queue — you're all caught up." (true quiet, distinct from a fetch failure).
- **Error:** Read fails → "—" + retry (a "0 waiting" that is really a fetch failure would hide a decision waiting on this
  user — a #3 hole); counts degrade independently.
- **Partial:** Some rows resolve, others fail → render the resolved; failed counts show "—," never "0".
- **Offline / stale:** "as-of HH:MM" on counts; marked stale rather than silently frozen.

---

### Section D — Activity Feed (my-work-relevant, with the answer-mode pill)

**Purpose:** The plain-English timeline of what the AI did relevant to *this user's* work (design-doc L3259), each
AI-output item carrying its **answer-mode pill** (AC-7.VIEW.002.2). Clearance + relevance scoped; read-only (the
technical event log is surface-05).

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Activity items | C7 `event_log` (FR-7.LOG.001–006), clearance + relevance scoped (ADR-006) | Plain-English "what happened relevant to me" rows; redaction-tombstone retention (AC-7.LOG.006.3); only rows this viewer's clearance permits |
| Answer-mode pill | **C4 FR-4.CID.006** | On every AI-output item (AC-7.VIEW.002.2); meaning binds DRY to C4; an unresolved pill reads **"mode unknown," never "Cited"** |
| Item detail | C7 `event_log` row | Expand for plain-English detail; a technical "view trace" deep-link is surface-05, gated `PERM-dashboard.ops` |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Filter feed | By type / answer-mode / time | entry (results clearance-scoped) |
| Expand item | Plain-English detail | entry |

**Real-time / poll:** **Polls** the `event_log` at `polling_interval_event_log_s` (60s) (FR-7.RTP.002) — not Realtime.

**States:**
- **Loading:** Skeleton feed rows.
- **Empty:** "No activity yet relevant to your work." (genuine quiet / new user).
- **Error:** Read fails → "Couldn't load your activity feed" + retry; **never an empty 'nothing happened'** (a blank feed
  that is really a fetch failure would imply the AI is idle when it may be active). Show "—".
- **Partial:** Some rows load, others fail → render what loaded; a row whose **pill can't resolve is "mode unknown,"
  never silently Cited**.
- **Offline / stale:** "as-of HH:MM"; marked stale rather than read as current.

---

### Section E — Proactive Suggestions (routed to me)

**Purpose:** The C9 engine's ranked, explained suggestions routed to this user (FR-9.SUG.004) — "what the AI thinks you
should do next." C9 produces + routes; **C7 delivers** (via the notification centre + here); this surface **renders**.
Every "act" routes through the C6 guardrail (FR-9.MODE.003) — never a back-door.

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Suggestion cards | C9 `proactive_suggestions` (FR-9.SUG.001/004), clearance-scoped | Ranked by urgency; routed to this user by risk-type/ownership |
| Reasoning + answer-mode pill | C9 FR-9.SUG.003 + C4 FR-4.CID.006 | Each card explains *why* + carries its pill |
| Dismissal + safety-floor state | C9 FR-9.SUG.005 | A dismissed suggestion learns; a **floored (derisking/hard-risk) item re-delivers regardless of prior dismissal** when its metric is past threshold (AC-9.SUG.005.2/.3) |
| Proposed action + mode | C9 FR-9.MODE.003 | Suggest / Prepare / Act = f(C6 risk tier); an "act" routes through the C6 approval path — floored rows never auto-act |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Act on suggestion | Routes the proposed action through the **identical C6 approval path** (FR-9.MODE.003) — a held action lands in surface-04; a reversible Act-mode item may auto-run *per C6*, never bypassing the guardrail | the action's own C6 tier + clearance (C1) |
| Prepare (draft) | Generates a draft, routes it to surface-04 per the generator's mode | the action's C6 tier |
| Dismiss | Dismisses + feeds dismissal-learning (FR-9.SUG.005); **a floored item cannot be dismissed away** — it re-delivers while its metric stays past threshold (AC-9.SUG.005.2/.3) | entry |
| Explain | Expands the reasoning + answer-mode basis | entry |

**Real-time / poll:** **Polls** the `proactive_suggestions` store (FR-7.RTP.002); a **new** suggestion's *notification*
rides Section A's Realtime socket (FR-9.SUG.004 delivery via the notification centre).

**States:**
- **Loading:** Skeleton cards.
- **Empty:** "No suggestions right now — the AI will surface things as it spots them." (genuine quiet; distinct from a
  fetch failure and from cold-start suppression).
- **Error:** Read fails → "Couldn't load suggestions" + retry; "—", **never an empty 'nothing suggested'** (a floored
  de-risking suggestion hidden by a silent failure is a #3 hole).
- **Partial:** Some cards load, others fail → render what loaded; a card whose reasoning/pill can't resolve shows "detail
  unavailable," never silently dropped (especially a floored item — AC-9.SUG.005.2/.3).
- **Offline / stale:** "as-of HH:MM"; a floored item latched before going stale persists.
- **Cold-start (a distinct, labelled state — not an error):** below `cold_start_proactive_threshold` (50%) the panel
  reads **"Suggestions are paused while the system learns your business"** (FR-9.CST.002 / AC-9.CST.002.1) — but a
  guardrail-class safety event is still delivered via the notification centre (AC-9.CST.002.3). Fails safe to cold when
  the C2 phase is stale/absent (AC-9.CST.001.2).

---

## Navigation / transitions

| Trigger | Destination |
|---|---|
| User sign-in (Standard User, client deployment) | surface-08 (personal workspace) |
| Notification bell | Section A notification-centre slide-over (cross-cutting) |
| Chat: async task → `awaiting_approval` | surface-04 (the live approval queue) |
| My Queue → Open in approval queue | surface-04 (`PERM-action.review`) |
| Activity item → View technical trace | surface-05 Event Log (`PERM-dashboard.ops`, if held) |
| Suggestion → Act / Prepare | The C6 approval path → surface-04 (if held) |
| `/` command menu → manage custom commands | surface-10 (`PERM-commands.manage`, if held) |
| Notification / alert settings → | surface-01 #observability (`PERM-config.observability`, if held) |
| Answer-mode pill legend → | The C4 FR-4.CID.006 definition (DRY source) |

---

## Mobile

This is a **primary mobile surface** — a user chatting with the AI and glancing at "what's waiting for me" from a phone
is the core mobile use case. On a narrow viewport the workspace collapses to a **stacked single column, chat-first**:
the chat occupies the screen, with My Queue / Activity Feed / Suggestions as scrollable sections or a bottom-tab switch;
the **notification bell + live/reconnecting indicator + the two protective banners are mandatory on mobile** (a stale
"all caught up" on a phone is a dangerous false-healthy view). The `/` command menu adapts to a tap-to-select sheet.
Notification push routing is FR-7.VIEW.003 (critical immediate; hard-limit immediate+always). Acting on a suggestion or
running a command still routes through the **same C1 node gate + C6 approval path** (no mobile back-door). Detailed
mobile treatment: `surface-12-mobile.md`.

---

## Open decisions

| # | Question | Options | Recommendation |
|---|---|---|---|
| OD-133 ⚠️ **Rule-0 PERM gap** | The Standard User workspace needs a Dashboard Access entry node. surface-07/OD-129 minted `PERM-dashboard.overview` + `.ops` and **explicitly named a third, not-yet-minted "surface-08's standard-user node"** as a holder of the cross-cutting notification centre — but never catalogued it. A gate with no catalog entry is a build-time #3 defect. | (a) **Mint `PERM-dashboard.workspace` via change-control** under the existing FR-1.PERM.007 "Dashboard Access" category, scope **intra-client**, **default = all six roles** (every authenticated user has a personal workspace/chat); per-command authority stays finer (each `/` command on its own C1 node, FR-9.CMD.002). (b) Reuse `PERM-dashboard.overview` (wrong — that gates the *leadership* view; a Standard User must not get the agency rollup). (c) No entry node, gate the workspace on authentication alone (breaks the catalog rule that every surface entry is a node). | **(a)** — closes the gap surface-07 explicitly flagged, completes the Dashboard Access family (`overview`/`ops`/`workspace`) under the **already-homed** FR-1.PERM.007 category (no new category, no ADR supersede — mirrors OD-129/OD-117/OD-125), defaults to all six roles (the personal workspace is the baseline everyone gets) while keeping least-privilege at the **command** level. Transcribe into `PERMISSION_NODES.md` immediately (catalog 44→45). **C1 catalog grows; no FR re-approval.** |
| OD-134 | **Layout** — chat-centric main view + supporting panels (My Queue / Activity Feed / Suggestions) + the cross-cutting notification bell, vs a fully-tabbed dashboard, vs a single scroll. | (a) **Chat-led main view + adjacent collapsible panels** (sidebar on wide, stacked on narrow) + persistent notification bell + the two always-loud banners pinned. (b) Fully tabbed (Chat / Queue / Activity / Suggestions). (c) Single scroll with chat as one section among equals. | **(a)** — the chat is the Standard User's primary tool (design-doc L3261), so it earns the centre; the supporting panels are glanceable but secondary. Tabbing (b) buries the queue/suggestions and hides whether something is waiting; a flat scroll (c) demotes the chat. The notification bell + protective banners must ride every dashboard (FR-7.ALR.001), pinned so a critical condition never hides behind a tab — consistent with surface-07 OD-130. |
| OD-135 | **Chat thread — persistence + async-result return path** (behaviour + Phase-4 data). The spec defines **no `chat_messages`/`conversations` store** today, and FR-7.RTP.001 caps Realtime at two surfaces (approval queue + notification centre) — so how does the chat persist history, and how does an async task result get back into the thread? | (a) **Persist the thread** (a net-new Phase-4 `conversations`+`messages` store, RLS-scoped, no `client_slug`) so history survives reload (#1); **async results return on poll** (`task_queue` status) **+ a notification-centre nudge** — **no third Realtime socket**. (b) Ephemeral chat (reconstructed from `task_queue` + `event_log`, no message store) — history lost on reload. (c) Make the chat a third Realtime surface — violates FR-7.RTP.001's "exactly two." | **(a)** — losing a user's interaction history on reload is a #1 violation, so the thread is persisted (flagged as a **net-new Phase-4 schema obligation** owed to C5/C9 — not invented as an FR here, surfaced for Phase 4). The async-result path reuses the existing poll + notification mechanisms, honouring FR-7.RTP.001's two-Realtime-surface cap (no new socket). Synchronous commands (FR-9.CMD.008) already return inline with no `task_queue` row — their record is the message store + the `event_log` audit entry. |
| OD-136 | **Proactive-suggestion placement** (UX) — a dedicated Suggestions panel, vs notification-centre only, vs inline-in-chat only. | (a) **All three delivery surfaces** (FR-9.SUG.004 names dashboard + chat + push): a dedicated **Suggestions panel (Section E)** for act/dismiss + the notification-centre nudge + the option to surface inline in chat — with the dismissal **safety floor** preserved everywhere (FR-9.SUG.005). (b) Notification-centre only (no standing panel — a user can't review all active suggestions in one place). (c) Inline-in-chat only (clutters the conversation; no ranked overview). | **(a)** — FR-9.SUG.004 explicitly delivers across dashboard, chat, and push; a dedicated panel gives the user a ranked, reviewable list with act/dismiss, while the notification centre provides the time-sensitive nudge. The dismissal **safety floor** (FR-9.SUG.005 / AC-9.SUG.005.2/.3) holds on every surface — a floored de-risking item re-delivers while its metric stays past threshold, and **every "act" routes through the C6 guardrail** (FR-9.MODE.003). Cold-start suppression (FR-9.CST.002) shows the labelled "learning" state, not an empty panel. |

---

## Phase 4 data binding notes

- **NET-NEW `conversations` + `messages` store (OD-135)** — the persisted user↔AI chat thread; per-message: `id`,
  `conversation_id`, `sender` (user/agent), `body`, **`answer_mode_pill`** value (C4 FR-4.CID.006) on agent messages,
  `created_at`, optional `task_queue_id` link (for async-task messages). **No `client_slug`** (OD-096); RLS-scoped to
  the owning user + silo (ADR-006). **Owed to C5/C9 to home formally** — this surface flags it; Phase 4 defines schema +
  RLS + index. Synchronous command results (FR-9.CMD.008) persist here with **no `task_queue` row**.
- **`task_queue`** (C5-owned, read here) — My Queue filtered to this user via **`originating_user_id`** (the net-new
  field flagged on surface-04) and/or assignment; clearance-scoped. Phase 4: confirm `originating_user_id` exists and is
  indexed for the per-user filter. **No `client_slug`.**
- **`event_log`** (C7-owned, read here) — the activity-feed source, **clearance + relevance scoped**; each AI-output row
  carries an **answer-mode pill** value (C4 FR-4.CID.006). Phase 4: confirm the relevance-scoping (which rows are "mine")
  has an index; redaction-tombstone retention (AC-7.LOG.006.3) applies. **No `client_slug`.**
- **`notifications`** (C7-owned, read here; home spec surface-07) — clearance-scoped to this viewer.
- **`proactive_suggestions`** (C9-owned, read here; dismissal/act via C9) — ranked urgency, reasoning, answer-mode pill,
  risk-type, recipient, **dismissal state + safety-floor flag** (FR-9.SUG.005). Phase 4: the floor flag must be queryable
  so a floored item re-delivers regardless of dismissal. **No `client_slug`.**
- **New intra-client PERM node (OD-133)** — `PERM-dashboard.workspace` (default: all six roles), scope **intra-client**,
  under the FR-1.PERM.007 "Dashboard Access" category; owed to `PERMISSION_NODES.md` with all four fields (FR-1.PERM.005).
- **Clearance scoping (ADR-006)** — the chat thread, My Queue, the activity feed, the suggestions panel, and the
  notification centre are all **RLS-scoped at the row** to the viewer's C1 clearances; Phase 4 must define these policies
  so a viewer never sees content their clearance forbids — UI filtering alone is insufficient (human-path RLS).
- **Realtime filter (FR-7.RTP.003.3)** — the notification-centre Realtime subscription's filter **does not depend on
  `client_slug`** (intra-silo only); Phase 4's Realtime policy must honour this.
