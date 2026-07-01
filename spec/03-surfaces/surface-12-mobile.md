# Surface: UI-MOBILE-* (surface-12) — Mobile View (action on the go)

**Status:** 🟢 **Drafted + gate-clean 2026-07-01** — OD-149–152 raised + resolved surface-local (recommendations). The
thirteenth Phase-3 surface (14th file); **1 of 14 remaining after this: `surface-01b-config-audit-log.md`.** This is a
**cross-component** surface: it is the **mobile treatment** the prior twelve surfaces each seamed here (every surface 00–11
carries a "Mobile" note that ends "Detailed mobile treatment: `surface-12-mobile.md`"). Grounded in the design-doc
canonical **"Dashboard 5 — Mobile view" (`design-doc-v4.md` L3266–3284)** — *"Purpose-built for action on the go. Not a
scaled down desktop… Designed for one-handed operation. Deep system management stays on desktop."* — which names exactly
**five mobile screens** (Home · Approval queue · Activity feed · Chat interface · Alerts) plus the **push-notification
contract**. Surface-12 specs **six sub-surfaces** (the five screens + the tap-optimised **command menu**, which carries its
own FR — FR-9.CMD.005/L3915 — and is referenced as its own surface by surface-08/10). Mobile is available to **all six
canonical roles** (design-doc L538 "Mobile view ✓✓✓✓✓✓"). **No PERM entry node is minted** — mobile is a *viewport
treatment*, not a new authority surface: each mobile screen inherits **exactly the same PERM node + C6 approval path** as
its desktop counterpart (a mobile approval is still `PERM-action.review` + the full C6 pipeline; a mobile `/` command is
still node-gated per FR-9.CMD.002). Third consecutive clean-no-mint surface (10, 11, 12). Next OD: OD-153.

> **Verification gate (independent zero-context subagent, checks a–f): CLEAN — 0 HIGH · 0 MED · 2 LOW (both benign).**
> (a) Coverage PASS — the design-doc's five named screens + the tap-optimised command menu are all addressed; every cited
> FR/AC (FR-7.VIEW.003 push routing, FR-9.CMD.005 command menu, FR-7.RTP.001/004 the two-Realtime cap + honest indicator,
> FR-7.ALR.001/008/009 notification chrome + protective banners, FR-4.CID.006/AC-7.VIEW.002.2 answer-mode pill,
> FR-9.MODE.003 no-bypass, FR-1.RST.003 Restricted reveal) resolves + paraphrases faithfully; every *deep-management*
> capability correctly seamed **out** to desktop (config/agent-builder/offboarding/memory-mutation/conflict-resolution/
> permission-matrix/command-authoring), matching the out-of-scope-on-mobile note each of surfaces 01/02/03/04/06/09/10/11
> already wrote. (b) CFG PASS — both mobile push keys real (`approval_push_frequency_minutes`=30 LIVE,
> `stale_queue_push_hours`=4 LIVE), edited on surface-01 (read-only reflected here). (c) DATA PASS — no `client_slug`;
> mobile reads the same per-user-scoped stores as the desktop surfaces (`task_queue`, `event_log`, `notifications`,
> `proactive_suggestions`, `conversations`/`messages`); the one **net-new** binding is a **push-subscription / device-token
> store** owed to C7 for web-push/native registration — flagged Phase-4, not asserted. (d) PERM PASS — **no entry node
> minted** (mobile inherits each screen's desktop node); six canonical roles; no role-string gates. (e) #1/#2/#3 sweep
> PASS — **no mobile back-door** (#2: every approve/act/command runs the identical C1 node gate + C6 pipeline; Restricted
> needs the same explicit audited reveal; deep mutations gated off mobile), **no false-healthy on a phone** (#3: the
> freshness/last-updated + breach badges + the honest Live/Reconnecting/Polling indicator + the two protective banners are
> **mandatory on mobile** — a stale "all-green"/"all caught up" on a phone is the single most dangerous false-healthy view
> in the product), **nothing lost** (#1: a mobile "disable" retains the definition; a dropped push is recoverable via the
> in-app notification centre, which persists read/unread until actioned, FR-7.ALR.001/006). (f) Seams PASS. **LOW-1:** the
> mobile push *delivery mechanism* (APNs/FCM/web-push) is a build detail; flagged as a paper-vs-proven note (the *routing
> contract* FR-7.VIEW.003 is decided, delivery reliability is a Phase-5 concern) — see Feasibility. **LOW-2:** this banner
> replaced its "pending" placeholder with the PASS result (done).

> The **action-on-the-go surface** — the one-handed phone view a manager or user opens away from their laptop to *stay
> informed and action approvals without needing a desktop* (design-doc "Mobile view" purpose, L316). It is deliberately a
> **narrow, high-signal subset** of the product, not the whole thing shrunk: the design-doc's own rule is *"Deep system
> management stays on desktop"* (L3284). Six sub-surfaces: **Home** (the glance — health score, pending-approvals count,
> active-alerts count, a quick-chat launcher), **Approval queue** (the primary mobile action surface — one-tap
> approve/reject with full context; one of the two Realtime surfaces on mobile), **Activity feed** (plain-English, the
> answer-mode pill on every AI output), **Chat interface** (`/` commands), the tap-optimised **command menu** (the most
> common node-permitted commands as quick-tap buttons above the keyboard, FR-9.CMD.005), and **Alerts** (the notification
> centre, filterable by severity — the second Realtime surface). A cross-cutting **push-notification** contract
> (FR-7.VIEW.003) delivers by class. The three non-negotiables it most directly serves: **#2** — there is **no mobile
> back-door**: approving an agent action, acting on a proactive suggestion, or running a `/` command routes through the
> *identical* C1 node gate + C6 guardrail pipeline as on desktop (FR-9.MODE.003, no bypass); Restricted content still
> requires the same explicit, audited reveal (FR-1.RST.003); and every deep-management / high-blast-radius action
> (config edit, agent-capability edit, offboarding hard-delete, memory mutation, conflict/consolidation resolution,
> permission-matrix edit, custom-command authoring) is **gated off mobile** to a "open on a wider display" notice — a
> mis-tap on a phone for a #1/#2 action is a real risk, better deferred than fat-fingered. **#3** — a phone is the device
> most likely to be stale or offline, so the **freshness badges, the honest Live/Reconnecting/Polling indicator
> (FR-7.RTP.004), and the two protective banners** (alert-engine-stalled AC-7.ALR.008.2, unroutable-alert AC-7.ALR.009.1)
> are **mandatory on every mobile screen**; no mobile screen ever shows a confident "all clear" it cannot stand behind.
> **#1** — a mobile "disable" (the one write mobile keeps for a misbehaving agent/command) retains the underlying
> definition; a push that fails to deliver is never the sole record — the in-app notification centre persists it
> read/unread until actioned (FR-7.ALR.001/006). It does **not** introduce any capability the desktop surfaces don't
> already own — it is a re-rendering of surfaces 04/07/08 (+ the read-only glances of 05/06) for a narrow viewport, plus
> the one mobile-native affordance the design-doc calls for (the tap-optimised command menu).

---

## Context manifest

- **Surface IDs (six sub-surfaces, all minted here):** **`UI-MOBILE-HOME`**, **`UI-MOBILE-APPROVALS`**,
  **`UI-MOBILE-ACTIVITY`**, **`UI-MOBILE-CHAT`**, **`UI-MOBILE-COMMAND-MENU`**, **`UI-MOBILE-ALERTS`**. The design-doc
  "Dashboard 5 — Mobile view" (L3266–3284) names the five screens by description + the push contract; FR-9.CMD.005 names
  the command menu; none assigns a formal `UI-` id. The operator's planning-doc "Mobile view — action on the go" (L316)
  maps here.
- **Owned by:** **cross-component** — the mobile screens re-render data produced by **C7** (observability: the alert/
  notification centre FR-7.ALR.*, the real-time/poll contract FR-7.RTP.*, the mobile push routing FR-7.VIEW.003, the
  activity feed's answer-mode pill AC-7.VIEW.002.2, the role dashboards FR-7.VIEW.001/002), **C6** (the approval tiers +
  the guardrail pipeline every mobile action runs through, FR-6.APR.*/FR-6.ESC.*), **C9** (the `/` command dispatch +
  the tap-optimised mobile command menu FR-9.CMD.001–005, proactive suggestions FR-9.SUG.004, the no-bypass rule
  FR-9.MODE.003), **C5** (the `task_queue` the Home count + Approvals + My-Queue read), **C4** (the answer-mode pill
  definition FR-4.CID.006), **C1** (the six roles + the per-action PERM nodes each mobile action inherits), **C2** (the
  Restricted reveal rule FR-1.RST.003 / FR-2.RET.004 the mobile feed/chat honour). No component is *newly* owned here;
  surface-12 is a viewport treatment.
- **FRs served (as rendering target / mobile treatment):**
  - **C7 — mobile push routing:** **FR-7.VIEW.003** (the design-doc L3277–3281 push contract — **critical alerts
    immediate**, **hard-limit hits immediate and always** (non-suppressible, AC-7.VIEW.003.1), **pending approvals at a
    configurable frequency**, **stale approval queue configurable** (AC-7.VIEW.003.2)).
  - **C7 — the two Realtime surfaces on mobile:** **FR-7.RTP.001** (exactly two Realtime/WebSocket surfaces product-wide —
    on mobile these are **Approvals** + **Alerts/notification centre**; every other mobile screen polls),
    **FR-7.RTP.004** (the honest **Live / Reconnecting / Polling** connection indicator — mandatory on mobile, re-fetches
    on reconnect before re-enabling actions), **FR-7.RTP.002/003** (poll cadence + connection prioritisation under budget).
  - **C7 — the notification centre chrome:** **FR-7.ALR.001** (the notification centre — primary, persistent, accessible
    from every view, persists read/unread until actioned; on mobile this is the **Alerts** screen + the bell),
    **FR-7.ALR.002** (the 7 alert rules, incl. the non-suppressible hard-limit AC-7.ALR.002.2), **FR-7.ALR.006**
    (Slack-independent durability — the in-app record is authoritative, never dependent on a push arriving),
    **FR-7.ALR.008** (alert-engine-stalled self-watch → the pinned banner AC-7.ALR.008.2), **FR-7.ALR.009** (unroutable
    alert → the pinned banner AC-7.ALR.009.1).
  - **C7/C4 — the answer-mode pill:** **AC-7.VIEW.002.2** / **FR-4.CID.006** (Cited / Inferred / Unknown on every AI
    output in the mobile activity feed + chat; an unresolved pill reads **"mode unknown", never silently "Cited"**).
  - **C9 — mobile chat + command menu:** **FR-9.CMD.005** (the **tap-optimised command menu** — most common node-permitted
    commands as quick-tap buttons above the keyboard, AC-9.CMD.005.1; full set still via `/`), **FR-9.CMD.001–004** (the
    `/` dispatch each command node-gated FR-9.CMD.002, destructive-confirm-after-gate FR-9.CMD.003, `event_log`
    fail-closed FR-9.CMD.004), **FR-9.SUG.004** (proactive suggestions delivered to mobile, incl. push per L3690),
    **FR-9.MODE.003** (every "act" routes through C6 — the no-bypass rule, on mobile too), **FR-9.SUG.005** (dismissal
    safety-floor preserved on mobile).
  - **C6 — the approval path on mobile:** **FR-6.APR.001–003** (the three tiers + the reversible-soft auto-run
    countdown, shown live on the mobile Approvals card), **FR-6.ESC.001/003** (flagged holds + Approve/Reject/Modify;
    **Modify degrades to desktop** on mobile — a #2 edit is not a phone task).
  - **C5 — the queue counts:** **FR-5.QUE.001 / FR-5.JOB.*** (the `task_queue` the Home pending-count + the Approvals
    list read, filtered to the viewer).
- **CFG dependencies (both read-only here — edited on `surface-01-config-admin.md` `#observability`):**
  - `approval_push_frequency_minutes` — *"How often you're pinged about items waiting for your approval"* — **30**, LIVE,
    int minutes ≥ 1 (config-registry L267; satisfies AC-7.VIEW.003.2).
  - `stale_queue_push_hours` — *"How long approvals sit untouched before you get a nudge"* — **4**, LIVE, int hours ≥ 1
    (config-registry L268; satisfies AC-7.VIEW.003.2).
  - *(Descriptions bind to `config-registry.md` — DRY; not re-typed.)*
- **PERM gates:** **no entry node minted.** Mobile is a viewport treatment: each mobile screen inherits **the same PERM
  node as its desktop counterpart** — Home/Chat/Activity via the viewer's Dashboard Access node (`PERM-dashboard.workspace`
  for a Standard User, `.overview`/`.ops` for management roles — FR-1.PERM.007, surface-07/08); Approvals via
  **`PERM-action.review`** (surface-04); the notification centre / Alerts is **node-free chrome** (clearance-scoped,
  FR-7.ALR.001); each `/` command node-gated per **FR-9.CMD.002**. No mobile-specific authority exists (design-doc L538
  grants all six roles the mobile view; *what* each sees is their existing clearance + nodes).
- **DATA bindings (Phase-4 stubs; **no `client_slug`** on any):** `task_queue` (Home count + Approvals + My-Queue,
  filtered to viewer via `originating_user_id` — the per-user field already flagged net-new on surface-04/08),
  `event_log` (activity feed, clearance+relevance scoped), `notifications` (the alert/notification centre — the same
  store surface-07 homes, incl. `escalation_state`/`escalated_at`/`actioned_at`), `proactive_suggestions` (C9 delivery),
  `conversations`/`messages` (the chat thread — the net-new store OD-135 flagged owed to C5/C9), `guardrail_log` (the
  approval context), plus the **one net-new mobile binding: a push-subscription / device-token store** (`push_subscriptions`
  — device/browser push registration for web-push or native delivery; RLS-scoped to the owning user; no `client_slug`) —
  owed to **C7** for FR-7.VIEW.003 delivery.
- **ADR constraints:** **ADR-001 §3** (silo isolation — no `client_slug` in any app table; mobile reads only the client's
  own deployment, never cross-deployment — the fleet view is desktop-only surface-06). **ADR-006** (static data-driven
  RLS — the mobile row filter is the *same* policy as desktop; a phone is not a privilege boundary). **ADR-007**
  (containment-first — the C6 pipeline every mobile action runs through is unchanged). **ADR-004** (sole-writer — the few
  mobile writes, e.g. an agent "disable", route through the owning component, never a direct client-side `UPDATE`).

---

## Overview

The mobile view is the **one-handed, action-on-the-go** face of a single client deployment — a purpose-built narrow subset
(design-doc: *"Not a scaled down desktop"*), used by any of the six roles from a phone to **stay informed and action
approvals without a laptop** (L316). It renders six sub-surfaces (Home, Approvals, Activity feed, Chat, the tap-optimised
command menu, Alerts) and delivers push notifications by class. Its governing constraint is a hard boundary: *"Deep system
management stays on desktop"* (L3284) — everything high-blast-radius (config, agent capability, offboarding, memory
mutation, conflict resolution, permission editing, command authoring) degrades to a "open on a wider display" notice, while
every action mobile *does* keep runs the identical C1 node gate + C6 guardrail pipeline as desktop. No layout section
below describes desktop behaviour — that lives in surfaces 04/05/06/07/08/10/11, which each point here.

---

## Access

> Uses the six canonical C1 roles (FR-1.ROLE.001). Mobile view is granted to **all six** (design-doc L538). *What* each
> role sees on each screen is their existing clearance + PERM nodes — mobile mints no new authority.

| Role | Can enter? | Notes |
|---|---|---|
| Super Admin | Yes | Full mobile subset; deep management (fleet/config/offboarding) still degrades to desktop notice. |
| Admin | Yes | Full mobile subset; capability edits degrade to desktop. |
| Finance | Yes | Sees the mobile screens scoped to Finance clearance + nodes (e.g. Cost-scoped glances). |
| HR | Yes | Sees the mobile screens scoped to HR clearance + nodes. |
| Account Manager | Yes | The primary day-to-day mobile user — their clients' approvals, activity, suggestions. |
| Standard User | Yes | Chat-first mobile home; approvals limited to items they hold `PERM-action.review` for. |

**Entry gate:** **no dedicated mobile node.** Each sub-surface gates on its desktop counterpart's node (above). A user who
lacks a node sees that screen's items hidden/disabled exactly as on desktop — never a mobile-only exposure.

---

## Layout

Mobile lives as its own responsive layout served to narrow viewports (< 768 px) / installed as a PWA — **not** a route
distinct from the product (the same auth, the same RLS, the same deployment). Primary navigation is a **fixed bottom tab
bar**: **Home · Approvals · Chat · Activity · Alerts** (five tabs; the command menu is an in-chat sheet, not a tab). A
persistent **notification bell** (with unread count) + the **honest Live/Reconnecting/Polling indicator** sit in the top
bar on every screen. The **two protective banners** (alert-engine-stalled, unroutable-alert) pin above all content when
active — they are never hidden behind a tab (a #3 rule carried from surface-05/07). Push-notification **settings**
(frequencies) live under a Settings/profile sheet, read-only-reflecting the `surface-01` config values. One-handed
operation is the design target (L3284): primary actions sit within thumb reach; destructive/deep actions are deliberately
absent (degraded to a desktop notice).

---

## Sections

### A — `UI-MOBILE-HOME` (Home — the glance)

**Purpose:** the at-a-glance landing (design-doc L3271) — health score, pending-approvals count, active-alerts count, and a
quick-chat launcher — the "is anything on fire / does anything need me" view.

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Health score | C7 FR-7.VIEW.001 (non-technical rollup, AC-7.VIEW.001.1 — C7 invents no signal) | Same rollup as surface-07 At-a-Glance; a **freshness/last-updated stamp is mandatory** (stale ≠ green). |
| Pending-approvals count | `task_queue` (C5) filtered to viewer's `PERM-action.review` scope | Tap → Approvals tab. A fetch failure shows "—", never "0". |
| Active-alerts count | `notifications` (C7 FR-7.ALR.001), clearance-scoped | Tap → Alerts tab. |
| Quick-chat launcher | C9 chat entry (→ `UI-MOBILE-CHAT`) | One tap to the chat composer. |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Tap a count / tile | Navigates to the owning tab (Approvals / Alerts / Chat) | same as that tab |

**Real-time / poll:** **polls** (Home is not one of the two Realtime surfaces — FR-7.RTP.001); health on the surface-07
cadence (30 s), counts on the notification/queue cadence (FR-7.RTP.002). Freshness stamp always shown.

**States:**
- **Loading:** skeleton tiles; counts show a spinner, never a provisional "0".
- **Empty:** genuine zero (no pending approvals, no active alerts) reads "Nothing waiting" **only when the fetch succeeded**; distinguished from a failed fetch.
- **Error:** each tile independently shows "—" + "couldn't load"; a failed health fetch **never renders green** (#3).
- **Partial:** tiles degrade independently (e.g. alerts loaded, health failed → health "—", alerts live).
- **Offline / stale:** the top-bar indicator flips Reconnecting/Offline; every tile shows its last-updated time; a stale "all-green" is explicitly labelled stale, not fresh.

---

### B — `UI-MOBILE-APPROVALS` (Approval queue — the primary action surface)

**Purpose:** the design-doc's *"primary action surface — full context, one-tap approve/reject"* (L3272) — the mobile
treatment of surface-04. One live queue of held agent actions (`awaiting_approval` C6 tiers + `flagged` safety holds).

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Held-action card | C6 FR-6.APR.* / FR-6.ESC.001 via `task_queue` + `guardrail_log` | Stacked cards: proposed action / tier badge / age / **live soft-run countdown** (FR-6.APR.003). |
| Answer-mode / context | full action context (C4 pill where AI-derived, FR-4.CID.006) | One-tap expand for full context (design-doc "full context"). |
| Live/connection indicator | C7 FR-7.RTP.004 | **Mandatory** — a phone is the likeliest device to drop mid-review; re-fetches on reconnect **before** re-enabling actions. |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Approve | Approves the held action → runs the **identical C6 pipeline** (no bypass); a Restricted-content action still needs the audited reveal first (FR-1.RST.003) | `PERM-action.review` |
| Reject | Rejects with a **mandatory reason** (FR-6.ESC.003) | `PERM-action.review` |
| Hold for full review | Promotes a reversible-soft item to explicit approval, stopping the auto-run (AC-6.APR.003.3) | `PERM-action.review` |
| **Modify** | **Degrades to "open on a wider display"** — editing action parameters on a phone is a #2 risk (surface-04 mobile note) | — (desktop) |

**Real-time / poll:** **Realtime** (one of the two per FR-7.RTP.001) — the WebSocket queue; the soft-run countdown is
**server-authoritative** (a soft item may auto-run server-side while the phone is offline — on reconnect the queue
re-fetches before re-enabling any action).

**States:**
- **Loading:** skeleton cards; action buttons disabled until loaded.
- **Empty:** "No actions waiting" — **only** on a confirmed-live connection; a queue that can't confirm live reads "can't confirm queue state," not empty.
- **Error:** "couldn't load the queue" + retry; actions disabled (never a blind approve).
- **Partial:** a card whose full context failed to load shows the summary + "context unavailable — review on desktop," and **disables Approve** (no approving what you can't see).
- **Offline / stale:** indicator flips to Reconnecting/Offline; actions **disabled**; on reconnect the queue re-fetches (a soft item may have auto-run) **before** any button re-enables.

---

### C — `UI-MOBILE-ACTIVITY` (Activity feed — plain English)

**Purpose:** the design-doc's *"Activity feed — plain English, answer mode pill"* (L3273) — the mobile treatment of the
surface-07/08 feed: what the AI did, clearance+relevance scoped.

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Feed row | `event_log` (C7 FR-7.LOG.001–006), clearance+relevance scoped | Plain-English one-liners; newest first. |
| Answer-mode pill | C4 FR-4.CID.006 / AC-7.VIEW.002.2 | **On every AI output**; an unresolved pill reads **"mode unknown", never silently "Cited"** (#3). |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Tap a row | Expands the event detail (read-only) | same as entry |
| Filter | By event class / time (read-only filter) | same as entry |

**Real-time / poll:** **polls** (FR-7.RTP.002 event-log cadence, 60 s); not a Realtime surface.

**States:**
- **Loading:** skeleton rows.
- **Empty:** "No recent activity" — only on a successful empty fetch; a failed fetch never reads empty (#3).
- **Error:** "couldn't load activity" + retry; the feed is not silently blank.
- **Partial:** rows that resolved render; a row whose pill couldn't resolve shows "mode unknown," not a guessed pill.
- **Offline / stale:** last-updated stamp + Reconnecting indicator; no false "nothing happened."

---

### D — `UI-MOBILE-CHAT` (Chat interface)

**Purpose:** the design-doc's *"Chat interface — / commands, tap-optimised command menu"* (L3274) — the mobile treatment of
surface-08's chat: converse with the AI, dispatch `/` commands, receive proactive suggestions inline.

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Message thread | `conversations`/`messages` (net-new store, OD-135) | Persisted (losing history is #1); async task results return **on poll + a notification nudge**, not a third Realtime socket (AC-7.RTP.001.3). |
| Inline AI output | C9 + C4 pill (FR-4.CID.006) | Every AI reply carries the answer-mode pill. |
| Inline suggestion | C9 FR-9.SUG.004 | Proactive suggestions may appear inline; act-through-C6 (FR-9.MODE.003). |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Send message | Posts to the chat; async work returns via poll + nudge | same as entry (`PERM-dashboard.workspace`) |
| Run `/` command | Dispatches — each command **node-gated** (FR-9.CMD.002); destructive commands **confirm after** the gate (FR-9.CMD.003.3); `event_log` write **fails closed** (FR-9.CMD.004.3) | per-command node |
| Act on inline suggestion | Routes through the **identical C6 path** (FR-9.MODE.003); dismissal safety-floor preserved (FR-9.SUG.005) | per-action node + C6 |

**Real-time / poll:** **polls** for async results + a notification-centre nudge (the two Realtime slots are Approvals +
Alerts — chat does **not** get a third socket, FR-7.RTP.001 / AC-7.RTP.001.3).

**States:**
- **Loading:** thread skeleton; composer disabled until the thread loads.
- **Empty:** an empty thread reads "Start a conversation" — **never** "no history" (a failed thread load is distinct, #1).
- **Error:** "couldn't load messages" + retry; a send failure is surfaced (not silently dropped).
- **Partial:** the thread loads but a pending async result hasn't returned → an explicit "working…" placeholder + nudge on arrival.
- **Offline / stale:** composer disabled offline; queued sends are held (not lost) and flagged pending.

---

### E — `UI-MOBILE-COMMAND-MENU` (Tap-optimised command menu)

**Purpose:** the design-doc's mobile-native affordance (L3915 / FR-9.CMD.005) — *"the most common commands surface as
quick-tap buttons above the keyboard"* — so a one-handed user isn't typing `/` slugs. A sub-component of the chat
composer, specced as its own sub-surface (its own FR).

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Quick-tap buttons | C9 FR-9.CMD.005 (AC-9.CMD.005.1) | The most common **node-permitted** commands (C9 owns "common"); the full set stays available via `/`. |
| Per-command visibility | FR-9.CMD.002 | A command the caller lacks the node for is **hidden/disabled**, never shown-then-denied. |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Tap a quick command | Inserts/dispatches it in chat — runs the **same node gate + C6 pipeline** as typing `/slug` (no shortcut bypass, #2) | per-command node (FR-9.CMD.002) |
| Open full command list | Falls back to the `/` picker for the complete set | per-command node |

**Real-time / poll:** **static on open** (the permitted-command set is resolved when the menu opens; re-resolved per open).

**States:**
- **Loading:** buttons render as the permitted set resolves (brief skeleton).
- **Empty:** a caller with no permitted common commands sees the `/` fallback only (not a broken empty bar).
- **Error:** if the permitted set can't resolve, the menu falls back to the `/` picker (fail-safe, never shows commands the caller may lack).
- **Partial:** resolved commands render; unresolved ones are omitted (never shown-then-denied).
- **Offline / stale:** the menu still opens (last-known permitted set); a tapped command that needs connectivity is queued/held like any chat send.

---

### F — `UI-MOBILE-ALERTS` (Alerts / notification centre — filterable by severity)

**Purpose:** the design-doc's *"Alerts — filterable by severity"* (L3275) — the mobile face of the notification centre
(FR-7.ALR.001): the persistent, clearance-scoped list of alerts, read/unread until actioned, with the two self-protective
banners. The second of the two Realtime surfaces on mobile.

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Alert row | `notifications` (C7 FR-7.ALR.001/002), clearance-scoped | All 7 rules; the hard-limit alert is **non-suppressible** (AC-7.ALR.002.2). Persists read/unread until actioned. |
| Severity filter | FR-7.ALR.002 severities | Filterable by severity (design-doc L3275). |
| Alert-engine-stalled banner | C7 AC-7.ALR.008.2 | **Pinned, always-loud** — the alert engine watching itself; never hidden behind a filter. |
| Unroutable-alert banner | C7 AC-7.ALR.009.1 | **Pinned, always-loud** — an alert with no delivery target fails loud, not silent. |
| Durability | FR-7.ALR.006 | The in-app record is authoritative and **independent of Slack/push arriving** (a dropped push is never the sole record — #1). |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Mark actioned / read | Updates the notification state (`actioned_at`) | same as entry (chrome, clearance-scoped) |
| Tap an alert | Deep-links to the owning surface (e.g. an approval alert → Approvals tab) | the target's node |

**Real-time / poll:** **Realtime** (the second of two, FR-7.RTP.001) — live delivery; the honest indicator (FR-7.RTP.004)
shows Live/Reconnecting/Polling and re-fetches on reconnect.

**States:**
- **Loading:** skeleton list; the two protective banners still evaluate + pin if active.
- **Empty:** "No alerts" — **only** on a confirmed-live connection; a queue that can't confirm live reads "can't confirm alert state," never a false "all clear" (#3).
- **Error:** "couldn't load alerts" + retry; the protective banners are computed independently and still show.
- **Partial:** loaded alerts render; if severity metadata is missing a row shows unfiltered rather than being silently dropped.
- **Offline / stale:** indicator flips Reconnecting/Offline; the last-known list shows with a staleness stamp; on reconnect it re-fetches. Push still fires server-side (FR-7.VIEW.003) so a critical alert reaches the phone even when the app is backgrounded.

---

### Cross-cutting — Push notifications (FR-7.VIEW.003)

**Purpose:** the design-doc L3277–3281 push contract — delivery by class, independent of whether the app is open. Governs
all six screens; not a screen itself.

**Delivery classes (FR-7.VIEW.003 / AC-7.VIEW.003.1–.2):**
| Class | Timing | Config |
|---|---|---|
| Critical alerts | **Immediate** | — |
| Hard-limit hits | **Immediate and always** — non-suppressible (AC-7.VIEW.003.1, pairs with ALR.002.2) | — |
| Pending approvals | Configurable frequency | `approval_push_frequency_minutes` (30, LIVE) |
| Stale approval queue | Configurable | `stale_queue_push_hours` (4, LIVE) |

**Settings surface:** the two frequencies are shown read-only on the mobile Settings sheet (edited on `surface-01`
`#observability`); the hard-limit/critical classes are **not** user-suppressible (a #3 guarantee). A push is a *delivery*,
never the *record*: every pushed item also persists in the notification centre (FR-7.ALR.006) so a missed/dropped push
loses nothing (#1).

---

### Cross-cutting — Out of scope on mobile (deep management → desktop)

Faithful to *"Deep system management stays on desktop"* (L3284), and consolidating the "degrades to a wider display" note
each desktop surface already wrote, the following are **deliberately gated off mobile** to an "open on a wider display"
notice (a mis-tap here is a #1/#2 event — better deferred than fat-fingered):

| Capability | Home surface | Why off mobile |
|---|---|---|
| Config editing (all 11 sections) | surface-01 | A mis-set knob is high-blast-radius (#2); read-only banner on mobile. |
| Permission-matrix editing | surface-02 | The matrix doesn't adapt < 768 px; read-only category list only. |
| Conflict / consolidation resolution | surface-03 | A wrong tap is a #1/#2 memory event; comparison views need width. |
| **Modify** an approval's parameters | surface-04 | Editing action params on a phone is a #2 risk (Approve/Reject stay). |
| Fleet actions (promote/rollback/provision/offboard/token) | surface-06 | Two-person deployment destruction is not a phone task. |
| Agent-capability editing + plan rollback | surface-09 | A mis-set scope/tool grant is a #2 risk; disable stays (retains definition, #1). |
| Custom-command authoring | surface-10 | A mis-gated command is a #2 risk; disable stays. |
| Memory mutations (correct/erase/merge) | surface-11 | A mis-issued correction/erasure is a #1/#2 action; verify/flag feedback stays. |

Each degradation is a **notice, not a silent omission** — the user is told the action lives on desktop, never left
wondering why a control is missing.

---

## Navigation / transitions

| Trigger | Destination |
|---|---|
| Bottom tab: Home / Approvals / Chat / Activity / Alerts | the corresponding `UI-MOBILE-*` sub-surface |
| Home count tap (approvals / alerts) | Approvals / Alerts tab |
| Quick-chat launcher | `UI-MOBILE-CHAT` |
| Command-menu quick tap | dispatches in `UI-MOBILE-CHAT` |
| Alert tap (deep-link) | the owning surface's mobile screen (e.g. approval alert → Approvals) |
| Any deep-management action | "open on a wider display" notice → the desktop surface (04/06/09/10/11 etc.) |
| Settings sheet | read-only push-frequency reflection (edit → surface-01) |

---

## Mobile

This **is** the mobile surface. (No further mobile treatment; the desktop surfaces 00–11 each point here.)

---

## Open decisions

**All resolved 2026-07-01 (surface-local; recommendations delegated, consistent with surfaces 05–11).**

| # | Question | Resolution |
|---|---|---|
| OD-149 🔑 | Sub-surface decomposition — how many mobile sub-surfaces, and are push / the command menu their own? | **(a)** Six sub-surfaces = the design-doc's five named screens (Home/Approvals/Activity/Chat/Alerts, L3266–3284) **+** the tap-optimised **command menu** (its own FR-9.CMD.005). **Push notifications** is a **cross-cutting delivery contract** (FR-7.VIEW.003), specced as a section governing all six, **not** a seventh screen. Faithful to the design-doc's own list. |
| OD-150 | Delivery platform — native app vs responsive PWA vs plain responsive web (affects push delivery). | **(a)** **Responsive web + PWA with web-push** for v1 (installable, same auth/RLS/deployment — no separate app to provision per silo); a **native wrapper is deferred → OOS-040**. The *routing contract* (FR-7.VIEW.003) is platform-agnostic; the *delivery mechanism* (web-push / APNs / FCM) is a build detail flagged paper-vs-proven (Feasibility below). |
| OD-151 | Navigation pattern. | **(a)** **Fixed bottom tab bar** (Home/Approvals/Chat/Activity/Alerts) + persistent notification bell + honest Live/Reconnecting/Polling indicator in the top bar + the two protective banners pinned above content. The command menu is an in-chat sheet, not a tab. Push settings under a Settings sheet. One-handed target (L3284). |
| OD-152 | The out-of-scope-on-mobile boundary — which desktop actions degrade to "open on a wider display." | **(a)** The **deep-management set** already named across surfaces 01/02/03/04/06/09/10/11 (config edit, permission-matrix edit, conflict/consolidation resolution, approval Modify, fleet actions, agent-capability edit + plan rollback, command authoring, memory mutation) degrades to a **notice** (never a silent omission). The low-risk retained writes (Approve/Reject, agent/command **disable**, verify/flag feedback, mark-actioned) stay — each runs the identical C6/node path. |

---

## Phase 4 data binding notes

Every `table.field` below is a DATA stub — Phase 4 defines the schema, RLS policy, and index. **No `client_slug` on any**
(ADR-001 §3 / OD-096 / FR-10.ISO.001). Mobile reads the **same** stores as its desktop counterparts under the **same** RLS
(a phone is not a privilege boundary — ADR-006):

- **`task_queue`** (Home pending-count + Approvals list) — filtered to the viewer via `originating_user_id` (the per-user
  field already flagged net-new on surface-04/08). Index on `(originating_user_id, status)`.
- **`event_log`** (activity feed) — clearance+relevance scoped; the relevance-scoping index already flagged on surface-08.
- **`notifications`** (alerts / notification centre) — the store surface-07 homes; fields incl.
  `escalation_state`/`escalated_at`/`actioned_at`; clearance-scoped RLS.
- **`proactive_suggestions`** (C9) — clearance-scoped; dismissal-floor state.
- **`conversations`/`messages`** (chat thread) — the **net-new store OD-135 flagged** owed to C5/C9; RLS-scoped to the
  user; no `client_slug`.
- **`guardrail_log`** (approval context) — read-only on the Approvals card.
- **NET-NEW: `push_subscriptions`** (device/browser push registration for FR-7.VIEW.003 delivery) — one row per
  user-device (endpoint / keys / platform / last-seen); RLS-scoped to the owning user; **no `client_slug`**; owed to
  **C7**. Flag: nullability of the endpoint affects whether a "push enabled" state can be shown truthfully (a
  registration that silently failed must read "push not enabled," never a false "on" — #3).

**Feasibility (paper-vs-proven, LOW-1):** the mobile push **delivery mechanism** — web-push (PWA service worker) and/or
native APNs/FCM — is **decided-on-paper only**. The *routing contract* (FR-7.VIEW.003: which classes fire when) is an
Approved C7 FR; whether background web-push reliably delivers a *"critical, immediate, always"* hard-limit alert to a
backgrounded phone is a **Phase-5 / build** concern (a dropped critical push would lean on the #1 guarantee that the
in-app notification centre persists it, FR-7.ALR.006 — but "immediate" is the unproven part). Recommend a Phase-5 AF
(`push-delivery-reliability`, method: SPIKE/LOAD) when the non-functional phase opens; **not minted here** (no Phase-3 FR
rests on it — the surface already fails safe to the persisted in-app record).
