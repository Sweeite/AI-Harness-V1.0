# Surface: UI-APPROVAL-QUEUE (surface-04) — Agent Action Approval Queue

**Status:** 🟢 **Signed off 2026-06-30** (operator: "im happy" — delegated "what do you recommend" → all four recommendations taken; OD-117–120 🟢). **5 of 14 Phase-3 surfaces complete.** OD-117 mints `PERM-action.review` (homed under the existing **Approval Authority** category, FR-1.PERM.007) via change-control; OD-120 amends C6 FR-6.APR.003 (AC-6.APR.003.3). **Verification gate (1 independent zero-context subagent, checks a–f): CLEAN-WITH-FIXES — 1 HIGH + 3 MED, all reconciled.** (HIGH c-1: stale `client_slug` "fate undecided" framing → corrected to OD-096-deleted / C10 FR-10.ISO.001, a closed decision. MED c-2: `originating_user_id` + `escalated_at` flagged as new Phase-4 fields owed to C5/C6. MED a-1: soft-countdown server-authoritative timing re-cited — server-owned timer per FR-6.APR.003 + an analogous surface obligation, not covered by alert AC-7.ALR.005.3. MED d-1: `PERM-action.review` re-homed under the existing Approval Authority category, not a new one.) The three non-negotiables, FR coverage, CFG wiring, role model, and the OD-120 change-control all passed clean.

> The **real-time human gate on agent *action*** — the counterpart to surface-03's poll-based memory
> gate. Where surface-03 holds candidate *knowledge* before it's written, surface-04 holds a candidate
> *action* before the agent takes it. It renders the two trust-critical states an agent task can be
> parked in: **`awaiting_approval`** (a C6 approval-tier gate — FR-6.APR.* / C5 FR-5.QUE.005) and
> **`flagged`** (a C6 safety hold — anomaly / rate-limit / injection, FR-6.ESC.001), and lets a routed
> reviewer **Approve · Reject · Modify** each one (FR-6.ESC.003). It is one of **exactly two**
> Realtime/WebSocket surfaces in the whole product (FR-7.RTP.001) — a new held item must appear
> **without a manual refresh**, because an action waiting unseen either stalls silently (#3) or, for a
> reversible soft-tier item, **auto-runs on a timer while no one is looking** (#2). This surface is the
> operator-facing embodiment of non-negotiable **#2 (never do something it shouldn't)**: nothing
> consequential the agent proposes executes past this gate without an explicit, audited human decision —
> and nothing held here is ever lost or silently abandoned (#1/#3).

---

## Context manifest

- **Surface ID:** `UI-APPROVAL-QUEUE` (minted here — Phase 1 referenced "the dashboard approval queue" by description across FR-6.ESC.002 / FR-7.RTP.001 / FR-5.QUE.005 but assigned no formal `UI-` id; this is its surface).
- **Owned by:** **C7 (Observability)** for the live-delivery contract (FR-7.RTP.*, the queue is a C7-rendered Realtime surface) — **but the queue's *contents* are produced by C5** (the `awaiting_approval` / `flagged` task states) and **classified + routed by C6** (the approval tier + the safety-hold reason + the reviewer routing). The surface renders C5/C6 state over the C7 transport. **Notification centre is the *other* Realtime surface and lives on surface-07** (seam — FR-7.ALR.001); this surface is the queue only.
- **FRs served:**
  - **The held items (C5 state):** FR-5.QUE.005 (`requires_approval` → `awaiting_approval`, no execution until a human approves; `approved_by`/`approved_at` recorded; un-actioned past threshold escalates, never auto-approved/abandoned — AC-5.QUE.005.2), FR-5.ASM.004 (the pre-execution gate that *produces* an `awaiting_approval` item; AC-5.ASM.004.2 — a consequential side effect surfacing late **re-enters** the gate, so approval is never assessed too early), FR-5.ASM.005 (a task quarantined on mid-task deactivation/clearance-revoke lands here too, retaining completed-step outputs — recoverable, #1).
  - **The tiers + routing (C6 classification):** FR-6.APR.001 (3-tier classification: auto / soft / hard; default-hard if uncertain), FR-6.APR.002 (the **mandatory-hard floor** — existing-client/system-of-record comms, financial ops, Confidential/Restricted memory ops: always hard, never downgradable; AC-6.APR.002.1/.2), FR-6.APR.003 (**soft auto-executes after `approval_soft_timeout` only if reversible** — irreversible/floored never auto-runs; AC-6.APR.003.1), FR-6.APR.005 (**contextual routing** — the item is addressed to the configured reviewer role; **no-self-approval**, AC-6.APR.005.3 — the initiator can never be its own approver; unavailable reviewer falls back + escalates, AC-6.APR.005.2), FR-6.APR.006 (the C6/C5 seam — C6 decides the tier, C5 holds execution).
  - **The safety holds + resolutions (C6 ESC):** FR-6.ESC.001 (a guardrail hit pauses the task to `flagged` — distinct from `awaiting_approval`; **hard-limit hits are NOT here** — they're killed+logged with no approve affordance, AC-6.ESC.001.2; most-restrictive disposition governs, AC-6.ESC.001.3), FR-6.ESC.002 (reviewer notified + item placed in this queue; an un-delivered notification is itself surfaced — no silent un-notified flag), FR-6.ESC.003 (the **three resolutions** — Approve resumes from the pause, Reject cancels + logs, Modify edits params + requeues; **already-applied side effects shown** + a human-visible compensation/cleanup task queued for reversible external writes, **never auto-rolled-back** — OD-010; an irreversible already-applied effect is surfaced as non-compensable, AC-6.ESC.003.3), FR-6.ESC.004 (**no flagged item silently abandoned** — escalation on `approval_escalation_timeout`, widening to Super Admin on repeat; covers both `flagged` and `awaiting_approval`).
  - **The audit trail (C6 LOG):** FR-6.LOG.001 (every approval/flag event is a `guardrail_log` row — `guardrail_type` ∈ {hard_limit, approval_gate, anomaly, rate_limit, prompt_injection}; `status` ∈ {pending, approved, rejected}; **`approved` is invalid for a `hard_limit` row**, AC-6.LOG.001.2), FR-6.LOG.003 (write-completeness — every decision writes a row; a log-write failure fails closed, never lets the action proceed un-recorded, AC-6.LOG.003.3).
  - **The realtime contract (C7 RTP):** FR-7.RTP.001 (**this queue is a Supabase Realtime/WebSocket surface** — a new `awaiting_approval` item appears live, AC-7.RTP.001.1), FR-7.RTP.002 (the poll cadences for everything *else* — context for the degrade path), FR-7.RTP.003 (**per-silo connection budget** — on approaching `realtime_connection_headroom_threshold` extra tabs **degrade to polling rather than silently freeze**; the approval queue is **prioritized** for the live connection, AC-7.RTP.003.1/.2), FR-7.RTP.004 (**subscription lifecycle** — a dropped socket reconnects or falls back to polling; the UI must show **live vs reconnecting/polling honestly**, never a stale view believed live, AC-7.RTP.004.2).
  - **The escalation alerts (C7 ALR — seam, delivery only):** FR-7.ALR.002 (the **approval-queue-stale** alert — item waiting > `approval_staleness_alert_threshold` → direct notification to the reviewer), FR-7.ALR.003 (routed to the responsible reviewer, not broadcast — AC-7.ALR.003.1), FR-7.ALR.005 (escalation window + server-authoritative timing, AC-7.ALR.005.3), FR-7.ALR.007 (C7 delivers the alert C5/C6 only emit). **This surface renders the queue + badges; it does not own alert delivery** (seam).
- **CFG dependencies** (read-only here — all edited on `surface-01`; description text binds DRY to `config-registry.md`'s `What it does` column, never re-typed):
  - `approval_soft_timeout` (default **10 min**, **LIVE** — `#guardrails`) — a **reversible soft-tier** item auto-executes after this delay if not actioned (FR-6.APR.003). Drives the **live countdown** on soft items.
  - `approval_escalation_timeout` (default **4 h**, **LIVE** — `#guardrails`) — an un-actioned **`flagged`/`awaiting_approval`** item escalates (reminders, widening to Super Admin) past this (FR-6.ESC.004).
  - `approval_staleness_alert_threshold` (default **4 h**, **LIVE** — `#observability`) — how long an approval waits before the reviewer is nudged (FR-7.ALR.002).
  - `realtime_connection_headroom_threshold` (default **80%**, **LIVE** — `#observability`) — the per-silo live-connection headroom at which extra surfaces degrade to polling (FR-7.RTP.003); shown as the live/degraded indicator's basis.
  - `alert_escalation_window_hours` (default **2**, **LIVE** — `#observability`), `escalation_contacts`, `alert_routing_rules`, `quiet_hours` — drive the C7-owned escalation/routing of the stale-approval alert (seam; not edited here).
  - `action_autonomy_matrix` (object, **LIVE**, `PERM-guardrail.edit_autonomy` — `#guardrails`) — the **tier policy** that decided whether an action is auto/soft/hard and which rows are **floored** (read here only to *explain* an item's tier; edited on `surface-01`).
  - Referenced as context, not edited: `rate_limit_*` (a rate-limit `flagged` item cites which cap it hit), `anomaly_thresholds` (an anomaly hold cites which of the five checks fired).
- **PERM gates:**
  - **Entry + decide (Approve/Reject/Modify):** **`PERM-action.review`** — a node minted by **OD-117** (resolved). The C5/C6/C7 FRs named **no** permission for *deciding* an individual held item: FR-5.QUE.005 says "a human approves," FR-6.APR.005 routes to a "reviewer role," FR-6.ESC.003 says "human resolutions" — none cited a PERM node, and `PERM-guardrail.edit_autonomy` gates editing the autonomy **config**, not deciding a queue item. A real Rule-0 gap (the OD-115 situation on surface-03). **Resolved (OD-117): mint `PERM-action.review`** via change-control, **homed under the existing "Approval Authority" category** (FR-1.PERM.007's fixed twelve — *not* a new category, which would conflict with that fixed set; this is an *addition of a node within* an existing category, the natural home for authority over approving agent actions). Default-deny.
  - **Authority = node AND routing AND not-self:** holding `PERM-action.review` lets you *enter*; a specific item is **actionable by you** only if you are its routed reviewer (or the fallback/escalation target per FR-6.APR.005) **and** you are **not** the item's initiating identity (AC-6.APR.005.3 — no self-approval). Items routed elsewhere are visible-but-read-only (or hidden — OD-118).
  - **Clearance-before-view (#2):** a held item whose action touches **Confidential / Personal / Restricted** content (e.g. a memory op, or a comms draft quoting sensitive memory) is only viewable by a reviewer holding the matching C1 sensitivity clearance (FR-1.CLR.*); viewing it is an audited access (FR-1.AUD.001). A Restricted-tagged action routes to the grantee/Super-Admin per C1's Restricted model (AC-6.APR.002.2).
  - All nodes default-deny (FR-1.PERM.002); per-action gates inline below.
- **DATA bindings** (Phase-4 stubs; **no `client_slug` rendered** — single-tenant per silo, ADR-001 §3 / OD-096):
  - **C5-owned** `task_queue` (`id`, `status` ∈ {queued, running, **awaiting_approval**, **flagged**, …; the `flagged`/quarantine value is the OD-054 enum extension}, `requires_approval`, `approved_by`, `approved_at`, the step/action payload — proposed tool call + params + target, `created_at`). **⊕ New Phase-4 field owed to C5:** `originating_user_id` (drives no-self-approval + the FR-5.ASM.005 mid-task re-check) — FR-5.ASM.005 binds "originating user identity" conceptually but FR-5.QUE.002's `task_queue` schema defines no such column; Phase 4 must add it.
  - **C6-owned** `guardrail_log` (`id`, `task_id`, `guardrail_type` ∈ {hard_limit, approval_gate, anomaly, rate_limit, prompt_injection}, `description`, `action_blocked`, `status` ∈ {pending, approved, rejected}, `reviewed_by`, `reviewed_at`, `created_at`). **⊕ New Phase-4 field owed to C6:** `escalated_at` (nullable, server-owned by the C5/C6 escalation loop) — not in FR-6.LOG.001's schema; Phase 4 must add it. **`client_slug` is NOT rendered and NOT carried:** OD-096 (🟢 resolved 2026-06-27) **deleted `client_slug` from all application tables** (realised in C10 FR-10.ISO.001 — identity lives only in the management-plane registry); FR-6.LOG.001's older "label-only `client_slug`" wording is superseded and owes only a one-line clerical reconciliation in Phase 4. This is a **closed** decision, not an open schema call.
  - Read-only context: `agents` (C8 — which specialist proposed the action), `memories`/`entities` (C2 — when the action targets memory, with `[Building]`/tier), `access_audit` (C1, append-only — the decision + any sensitive view). The compensation/cleanup successor task an Approve/Modify may create routes through **C5** (AC-5.ASM.009.2), not written by this surface.
- **ADR constraints:**
  - **ADR-007** (containment-first; detection-as-signal) — the surface must **never imply an approval is reversible when it isn't**: a hard-tier/floored item carries a non-downgradable badge; a `hard_limit` row is **never** shown with an Approve affordance (it was killed, not held — AC-6.ESC.001.2 / AC-6.LOG.001.2). Anomaly/injection/rate-limit holds are the *signal* guardrails and **are** human-resolvable here.
  - **OD-010 / FR-6.ESC.003** (no auto-rollback; human-visible cleanup) — at review the surface **shows already-applied side effects** and offers/queues a durable compensation task; it **never** presents a one-click "undo" that silently reverses an external write.
  - **OD-056 / FR-6.APR.003** (no irreversible action auto-runs) — the only auto-execute path is a **reversible soft-tier** item on `approval_soft_timeout`; the surface's soft-item countdown must make that timer **visible and interruptible**, and must never show a running countdown on an irreversible/floored item (there is none).
  - **ADR-001 §3** — physical isolation; **no `client_slug`** rendered; the Realtime filter is intra-silo (AC-7.RTP.003.3).

---

## Overview

surface-04 is the operator's **action gate** — the one place a human stands between what an agent *proposes*
and what it *does*. It serves the **contextually-routed reviewers** (FR-6.APR.005): an Account Manager approves a
client-facing comms draft, Finance approves a financial-record write, an Admin/Super Admin catches the default and
the safety holds. It is a **single live queue** of every held agent task, each item showing **what the agent wants
to do, why it was held (which tier or which guardrail), and what — if anything — has already happened**, with
**Approve · Reject · Modify** and a mandatory audited reason. Two things make it different from surface-03: it is
**Realtime, not polled** (a held action must appear the instant it's created — FR-7.RTP.001), and some items carry a
**live auto-run countdown** (a reversible soft-tier action runs itself when `approval_soft_timeout` elapses unless a
human intervenes — FR-6.APR.003). The surface's defining job is making held actions **loud, finite, and honest**:
every item escalates if ignored (never abandoned — #3), no floored/irreversible action can be quietly downgraded or
auto-run (#2), and the surface **always tells the truth about whether it's live** — a dropped socket degrades to
polling *visibly*, never a frozen view believed current (FR-7.RTP.004, #3).

---

## Access

> Uses the six canonical C1 roles (FR-1.ROLE.001). "Can enter?" requires `PERM-action.review` (OD-117, pending);
> *which* items are actionable is then narrowed by contextual routing (FR-6.APR.005) + no-self-approval + clearance.
> Custom roles are data-defined; the six defaults are the baseline.

| Role | Can enter? | Notes |
|---|---|---|
| Super Admin | Yes | Holds `PERM-action.review` + all clearances; the **default reviewer + escalation terminus** (FR-6.APR.005.1, FR-6.ESC.004.2); sees every item; injection-type holds route here by default |
| Admin | Yes | Holds `PERM-action.review`; the **default reviewer** when no context rule matches (FR-6.APR.005.1); sees Confidential/Personal/Restricted-touching items only with the matching clearance |
| Finance | Only if granted + routed | Granted `PERM-action.review` for **financial-context** items (FR-6.APR.005 routing — financial → ops/finance); sees only items routed to the finance role + within finance-tier clearance |
| Account Manager | Only if granted + routed | Granted `PERM-action.review` for **CRM/client-context** items (FR-6.APR.005 — CRM → account manager); the typical approver of client-comms drafts |
| HR | Only if granted + routed | No routing by default → hidden; meaningful only if a deployment routes an HR-context action class to the HR role |
| Standard User | No | No `PERM-action.review` by default → nav item hidden; a Standard user is frequently the *initiator* of a held task (and therefore barred from approving it — no self-approval) |

**Entry gate:** the surface renders iff the caller holds `PERM-action.review` (OD-117). A caller without it never sees
the "Approvals" nav item; a direct URL returns 404 (FR-1.PERM.006 — denied surfaces are absent, not visible-but-empty).
**No-self-approval is enforced at the item, not the surface** (AC-6.APR.005.3): a reviewer who holds the node still
cannot action an item whose `originating_user_id` is their own — the resolve actions are disabled with an explicit
"You initiated this — it needs another approver" note, and the item escalates/falls back per FR-6.APR.005.2.

---

## Layout

A standard in-app surface inside the authenticated shell — sidebar item **"Approvals"** carrying a **live count badge**
(pending + an alert-coloured overdue count), a sticky header, and a **live/connection indicator** that honestly shows
**● Live** (Realtime connected) · **◐ Polling** (degraded — connection budget reached, FR-7.RTP.003) · **⟳ Reconnecting**
(socket dropped, FR-7.RTP.004). The body is a **single queue** (list/table) with:

- **Filter chips** (OD-118): *All* · *Approvals* (`awaiting_approval`) · *Safety holds* (`flagged`: anomaly / rate-limit / injection) · and an *Overdue* filter. Each item shows a **type/tier badge** (Hard · Soft · Anomaly · Rate-limit · Injection · Quarantine) so the queue reads at a glance.
- **A row per held item:** the proposed action (one-line: the agent + the tool call + target), the tier/hold reason, age vs escalation, the routed reviewer, and — **for soft items — a live countdown to auto-run**.
- **A detail panel** (click a row): the full proposed action + params, provenance (which specialist/task, FR-5.ASM provenance), the tier rationale (which `action_autonomy_matrix` row / which guardrail + threshold), **already-applied side effects** (FR-6.ESC.003 / OD-010), clearance-gated content preview, and the **Approve / Reject / Modify** action set with a mandatory reason field.

Every resolving action uses a confirm step; the **reason** is captured to `guardrail_log` (`reviewed_by`/`reviewed_at`)
and `access_audit`.

---

## Sections

> One unified queue (OD-118), so a single section spec with the item-class differences called out. If OD-118 resolves
> to tabs, this section splits into **Approvals** and **Safety holds** tabs (same bindings, same states).

---

### UI-APPROVAL-QUEUE — Held Agent Actions

**Purpose:** Surface every agent task parked in `awaiting_approval` (a C6 approval-tier gate) or `flagged` (a C6 safety
hold) and let the routed, cleared, non-initiating reviewer Approve / Reject / Modify it — so nothing consequential the
agent proposes executes without an explicit, audited human decision (#2), and nothing held is silently abandoned (#3).

**Data bindings:**

| Element | Source | Notes |
|---|---|---|
| Queue rows | `task_queue` where `status ∈ {awaiting_approval, flagged}` joined to the latest pending `guardrail_log` row (`guardrail_type`, `description`) | One row per held task; sorted oldest-first so the nearest-to-escalation (and nearest-to-auto-run) surfaces; **a `hard_limit` row is never in this set** (killed, not held — AC-6.ESC.001.2) |
| Tier / hold badge | `guardrail_log.guardrail_type` + the C6 tier (auto/soft/hard) from `action_autonomy_matrix` | Hard · Soft · Anomaly · Rate-limit · Injection · Quarantine; **floored** items carry a non-downgradable marker (FR-6.APR.002) |
| Proposed action + params | `task_queue` step/action payload | The tool call, parameters, and target the agent wants to execute — the thing being approved |
| Why held | `guardrail_log.description` + the matched `action_autonomy_matrix` row / `anomaly_thresholds` check / `rate_limit_*` cap | Binds to the classifier/guardrail output + config — never re-typed; explains *which* rule held it |
| Provenance | `agents` (the proposing specialist) + `task_queue.id`/originating task | Which agent + task, for context (FR-5.ASM) |
| Already-applied side effects | `task_queue` step outputs + FR-6.ESC.003 / AC-5.ASM.009.2 | What the task already did before the halt (reversible → cleanup task offered; irreversible → flagged non-compensable) — **#1/#2** |
| Routed reviewer | `alert_routing_rules` / FR-6.APR.005 routing | Who this item is addressed to; an item not routed to the caller is read-only (or hidden — OD-118) |
| Soft auto-run countdown | `created_at` + `approval_soft_timeout`, **server-authoritative time** | **Only on reversible soft items** (FR-6.APR.003); a live countdown to auto-execute; absent on hard/floored/irreversible (they never auto-run) |
| Overdue flag | `guardrail_log.escalated_at` + `created_at` vs `approval_escalation_timeout` | Server-owned `escalated_at` (C6/C5 loop); past cadence → overdue styling + escalation badge (FR-6.ESC.004) |

> **DRY rule for human-readable text.** Tier/guardrail labels, the autonomy-matrix row meanings, and CFG helper text
> bind to their canonical sources (`config-registry.md`, glossary, the C6 FRs) — never re-typed here.

**Actions:**

| Action (label) | What it does | PERM gate |
|---|---|---|
| Approve | Confirm (reason captured) → records `approved_by`/`approved_at`, `guardrail_log.status=approved`; **C5 resumes the task from its paused point** (FR-6.ESC.003 / FR-5.QUE.005 — *not* a direct execute by the surface); any already-applied effects shown beforehand; audited | `PERM-action.review` + routed-to-caller + **not initiator** + tier clearance |
| Reject | Confirm (reason **mandatory**) → task cancelled, `guardrail_log.status=rejected`, outcome recorded; the task does **not** execute (AC-5.QUE.005.1); audited | `PERM-action.review` + routed + not-initiator |
| Modify | Open a structured editor of the action's **editable** params → on save, the task **requeues and re-enters the guardrail gate** (FR-6.ESC.003 / AC-5.ASM.004.2 — a modify can't smuggle past the tier; an edit that raises risk re-classifies); audited (OD-119 scopes the editor) | `PERM-action.review` + routed + not-initiator + tier clearance |
| View detail | Opens the proposed action + params + side effects + rationale; for a Confidential/Personal/Restricted-touching action, opening is an audited access (FR-1.AUD.001) requiring the matching clearance | `PERM-action.review` (+ tier clearance for sensitive) |
| Queue cleanup task | When already-applied **reversible** side effects exist, offers/queues the durable human-visible compensation task (FR-6.ESC.003 / OD-010 / AC-5.ASM.009.2) — **never an auto-rollback** | `PERM-action.review` + routed |
| Hold for full review *(pending OD-120)* | On a **soft** item, freeze the auto-run countdown and convert it to require explicit approval, so it can't auto-run mid-review | `PERM-action.review` + routed |

**Real-time / poll:** **Realtime/WebSocket — this is one of the two live surfaces** (FR-7.RTP.001). A Supabase Realtime
subscription on `task_queue` filtered to `status ∈ {awaiting_approval, flagged}` pushes new/updated held items **without
a manual refresh** (AC-7.RTP.001.1). **Degrade path (FR-7.RTP.003):** when the per-silo live-connection budget passes
`realtime_connection_headroom_threshold`, the approval queue is **prioritized** to keep its live connection; if it still
must degrade, it **falls back to polling and says so** (the ◐ Polling indicator) — never a silently frozen view.
**Reconnect (FR-7.RTP.004):** a dropped socket reconnects or falls to polling, and the indicator shows **⟳ Reconnecting**
honestly; subscriptions tear down on unmount (no leaked connections). The **soft auto-run timer is server-owned**
(the auto-execute is a C5/C6 server action on `approval_soft_timeout`, FR-6.APR.003); the **displayed countdown must
follow server-authoritative time** so a skewed/stale client clock can never mislead a reviewer about how long an item
has — the same discipline AC-7.ALR.005.3 applies to *alert* timing, adopted here as a surface obligation (see the
Phase-4 note — no C6 FR yet mandates it for the displayed countdown). **Escalation alerts are delivered by C7**
(FR-7.ALR.002/.007 — seam); this surface renders the queue + badge.

**States:**
- **Loading:** Skeleton rows + a skeleton count badge and a **● connecting** indicator — **never a "0" badge while still loading** (a false "nothing to approve").
- **Empty:** "No actions waiting for your approval. The agent will pause here before doing anything that needs a human's OK." — the healthy zero-state (the gate is working; nothing is held).
- **Error:** Fetch/subscription fails → "Couldn't load the approval queue." + retry; **does not render an empty queue** (an empty queue that is actually a fetch failure would hide a held action — a stuck task #3, or an unseen item whose soft timer is *still running server-side* #2). Badge shows "—", not "0"; the indicator shows the failure, not ● Live.
- **Partial:** Rows load but a row's params / side-effects / rationale fail to resolve → render it flagged "details unavailable" and **disable Approve and Modify** (never approve or edit an action you can't fully see — #2); **Reject stays available** (you can always refuse). **For a soft item whose detail failed while its countdown is running**, the row shows a prominent "can't fully load — will auto-run at HH:MM unless you Reject / Hold" so the reviewer is never silently carried past an auto-run (#2/#3).
- **Offline / stale:** The **defining risk state for a Realtime surface.** The indicator shows **⟳ Reconnecting / ◐ Polling / stale as-of T**; **all resolve actions are disabled** while the view is known-stale (a decision must never be made against stale state — #2). Because a soft item may have **auto-run server-side while the client was offline**, on reconnect the queue **re-fetches before re-enabling actions**, and any soft countdown shown offline is marked "may have changed — refreshing." The overdue badge persists (an overdue item offline is still overdue).

---

## Navigation / transitions

| Trigger | Destination |
|---|---|
| Sidebar "Approvals" | surface-04 (default filter = All, oldest-first) |
| Click a row | Item detail panel (proposed action, params, why-held, provenance, already-applied side effects) |
| Approve / Reject | Confirm modal (reason) → on confirm, decision recorded; C5 resumes (Approve) or cancels (Reject) the task; row leaves the queue |
| Modify | Structured param editor → on save, task requeues + re-enters the guardrail gate (may reappear at a new tier) |
| Queue cleanup task | Creates the durable compensation task (C5); links to where that task is tracked (ops dashboard, surface-05) |
| Provenance: agent link | Agent Fleet / specialist config (surface-09) |
| Provenance: target entity/memory | Memory navigation / entity browser (surface-11) |
| Overdue escalation badge | (alert delivered via C7 → notification centre on surface-07; the badge links to the overdue item) |

---

## Mobile

Approving agent actions on the go is a **genuine mobile use case** (a manager OK-ing a client email from their phone),
unlike surface-03's comparison views. The queue collapses to stacked cards (proposed action / tier badge / age /
**soft countdown**) with Approve/Reject in a per-row action sheet and a mandatory reason. **Modify and any
Confidential/Restricted-content review degrade to a "needs a wider display" notice with a read-only summary** — editing
action parameters or reviewing sensitive content on a phone is error-prone and a wrong tap here is a #2 event. The
live/connection indicator and the auto-run countdown are **mandatory on mobile** (a phone is the most likely device to
go offline mid-review — the honest live/stale signal matters most here). Detailed mobile treatment: `surface-12-mobile.md`.

---

## Open decisions

**All resolved 2026-06-30 (operator delegated "what do you recommend" on all four → recommendations taken).**

| # | Question | Resolution |
|---|---|---|
| OD-117 🟢 ⚠️ **Rule-0 PERM gap** | The C5/C6/C7 FRs name **no PERM node** for *deciding* a held item (FR-5.QUE.005 "a human approves," FR-6.APR.005 "reviewer role," FR-6.ESC.003 "human resolutions" — none cite a node; `PERM-guardrail.edit_autonomy` gates editing the autonomy **config**, not deciding a queue item). Who may Approve/Reject/Modify? | **Mint `PERM-action.review`** via change-control, **homed under the existing "Approval Authority" category** (FR-1.PERM.007's fixed twelve — a node *added within* that category, not a new category, which would conflict with the fixed set). Recorded in `open-decisions.md` OD-117 with four-field definition; appears in `PERMISSION_NODES.md` at build (FR-1.PERM.005 discipline — an *addition*, not an ADR supersede). Per-item authority = holds-node **AND** routed-reviewer/fallback (FR-6.APR.005) **AND** not-the-initiator (AC-6.APR.005.3) **AND** tier clearance for sensitive content. Default roles Super Admin + Admin; Finance/Account Manager only when granted + routed. Mirrors OD-115's clean mint. |
| OD-118 🟢 | One unified live queue with filter chips, or two tabs (Approvals vs Safety holds)? | **One queue + filter chips** (All / Approvals / Safety holds / Overdue) + per-item type-tier badge. The resolution model, escalation model, and Realtime transport are **identical** across `awaiting_approval` and `flagged`; one queue keeps the live count + connection singular and is lighter than tabs. Filters give the split without fragmenting the live socket. |
| OD-119 🟢 | What does **Modify** expose, and what happens on requeue? | **A structured editor of the action's declared editable params only**; on save the task **requeues and re-enters the full guardrail gate** (re-classifies tier; an edit that raises risk can re-floor it). FR-6.ESC.003 names Modify explicitly and AC-5.ASM.004.2 already requires a late-surfacing consequential change to re-enter the gate — so a Modify can never downgrade a tier or smuggle an action past the gate (#2). |
| OD-120 🟢 | May a reviewer **freeze a soft item's auto-run countdown** to buy time for a full review ("Hold for full review")? | **Yes** — a "Hold for full review" promotes the soft item to require explicit approval (stops the `approval_soft_timeout` auto-run); one-directional (soft→explicit only, never hard→soft). **Applied via change-control to C6 FR-6.APR.003 as AC-6.APR.003.3.** An action must not auto-run while a human is mid-review of it (#2). |

---

## Phase 4 data binding notes

- **`task_queue`** (C5-owned) — the held-item source: `status` enum must carry **both** `awaiting_approval` (FR-5.QUE.005) and the `flagged`/quarantine value (OD-054 extension, set by C6); `requires_approval`, `approved_by`, `approved_at`, `originating_user_id` (drives no-self-approval + the FR-5.ASM.005 mid-task re-check), the step/action payload (proposed tool call + params + target). Index `(status, created_at)` for the oldest-first + overdue + Realtime-filter queries. RLS: readable with `PERM-action.review`; sensitive-content rows additionally gated by clearance; the Realtime filter is intra-silo (AC-7.RTP.003.3). **No `client_slug`** (ADR-001 §3).
- **`guardrail_log`** (C6-owned) — `id`, `task_id`, `guardrail_type` ∈ {hard_limit, approval_gate, anomaly, rate_limit, prompt_injection}, `description`, `action_blocked`, `status` ∈ {pending, approved, rejected}, `reviewed_by`, `reviewed_at`, `created_at`, **⊕ `escalated_at`** (nullable, server-owned — **new field owed to C6**, not in FR-6.LOG.001's schema; Phase 4 must add it). **`status=approved` is invalid where `guardrail_type=hard_limit`** (AC-6.LOG.001.2 — hard-limit rows terminate at recorded-block; they never appear in this queue). **`client_slug` is deleted, not "label-only":** OD-096 (🟢 resolved) deleted `client_slug` from all app tables (C10 FR-10.ISO.001); FR-6.LOG.001's older "label-only" wording is superseded and owes only a one-line clerical Phase-4 reconciliation — a **closed** decision. The surface renders none regardless.
- **`escalated_at` is server-owned, not a surface computation:** populated by the C5/C6 loop when an un-actioned item passes `approval_escalation_timeout` (FR-6.ESC.004), which also emits the stale-approval alert via C7 (FR-7.ALR.002/.007 — seam). The surface **reads** `escalated_at` + `created_at` vs the cadence to render overdue styling + badge; it never decides escalation, so the badge is correct even when no dashboard is open (#3) — same discipline as surface-03.
- **Soft auto-run timing is server-owned; the displayed countdown must follow server time:** the auto-execute itself is a **C5/C6 server action** on `approval_soft_timeout` (FR-6.APR.003) — the server owns the timer, not the client. The surface's countdown is a *display* of that server-owned timer and **must be computed against server-authoritative time** — applying the **same server-authoritative-time discipline** that AC-7.ALR.005.3 mandates for alert staleness/escalation math (that AC governs *alert* timing, not the soft-timeout timer, so this is an **analogous obligation the surface adopts**, not a claim that AC covers it). A stale/offline client must re-fetch before trusting the countdown (see Offline state). ⚠️ **Owed:** no current C6 FR states the *displayed* soft-countdown must be server-authoritative — this is a surface-introduced UI obligation; if it warrants a requirement, it is a one-line C6/Phase-4 note, not assumed covered by an alert AC.
- **`access_audit`** — append-only (FR-1.AUD.001/002): every Approve/Reject/Modify, every Hold, and every view of a Confidential/Personal/Restricted-touching item (actor, action, target, tier, reason, timestamp). Immutable; C7 owns retention/export.
- **Read-only joins:** `agents` (C8 — proposing specialist), `memories`/`entities` (C2 — when the action targets memory, with `[Building]`/tier per ADR-002), the compensation/cleanup successor task (C5 AC-5.ASM.009.2 — created via C5, not written here).
- **PERM node (OD-117 resolved):** `PERM-action.review` is minted under the **existing "Approval Authority" category** (FR-1.PERM.007 — not a new category) and recorded in OD-117 / SESSION-LOG; it must appear in `PERMISSION_NODES.md` (build artifact) with its four fields (Description / Default roles / Scope / Added-in) when that catalog is materialised at build (FR-1.PERM.005 discipline) — same path as OD-115's two memory nodes.
- **No `client_slug`** rendered on any binding on this surface (ADR-001 §3 / OD-096 — isolation is by deployment; the Realtime filter is intra-silo).
