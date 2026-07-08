---
id: ISSUE-079
title: Mobile surface (responsive/PWA + web-push)
epic: J — observability
status: in-progress
github: "#79"
---

# ISSUE-079 — Mobile surface (responsive/PWA + web-push)

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Build the one-handed, action-on-the-go **mobile surface** (surface-12) as a responsive/PWA re-rendering of the existing desktop surfaces for a narrow viewport — six sub-surfaces (Home, Approvals, Activity, Chat, Command-menu, Alerts) plus the web-push delivery contract — where every action runs the *identical* C1 node-gate + C6 pipeline as desktop and no stale screen ever shows a false "all clear".

## 2. Scope — in / out
**In:**
- The six mobile sub-surfaces minted by surface-12 — `UI-MOBILE-HOME`, `UI-MOBILE-APPROVALS`, `UI-MOBILE-ACTIVITY`, `UI-MOBILE-CHAT`, `UI-MOBILE-COMMAND-MENU`, `UI-MOBILE-ALERTS` — served as a responsive layout to narrow viewports (< 768 px) / installable as a PWA (OD-150): **same auth, same RLS, same deployment**, not a distinct route. Fixed bottom tab bar (Home/Approvals/Chat/Activity/Alerts), a persistent notification bell + unread count, the honest **Live/Reconnecting/Polling** indicator (FR-7.RTP.004), and the two protective banners (alert-engine-stalled AC-7.ALR.008.2, unroutable-alert AC-7.ALR.009.1) pinned above all content (OD-151).
- The two Realtime mobile surfaces (Approvals + Alerts) wired to the C7 RTP contract; every other mobile screen polls (FR-7.RTP.001). The honest connection indicator re-fetches on reconnect **before** re-enabling actions.
- The mobile **web-push** client: register a device/browser subscription into `push_subscriptions`, and receive pushes by class per the C7 routing contract (FR-7.VIEW.003) — critical + hard-limit immediate/non-suppressible, pending/stale approvals at the configured frequency. A failed registration reads "push not enabled", never a false "on" (#3).
- The mobile answer-mode pill on every AI output in Activity + Chat (AC-7.VIEW.002.2 / FR-4.CID.006) — an unresolved pill reads "mode unknown", never silently "Cited".
- The mobile chat + tap-optimised command menu (FR-9.CMD.005): quick-tap node-permitted commands above the keyboard; full set via `/`; each dispatch node-gated + C6-piped like desktop; inline proactive suggestions delivered to mobile (FR-9.SUG.004) and acted through C6 (FR-9.MODE.003).
- The **out-of-scope-on-mobile degradation notices**: every deep-management / high-blast-radius action (config edit, permission-matrix edit, conflict/consolidation resolution, approval **Modify**, fleet actions, agent-capability edit + plan rollback, custom-command authoring, memory mutation) renders a "open on a wider display" **notice, never a silent omission** (OD-152) — the mobile expression of NFR-SEC.013 (no back-door).

**Out:**
- The **data contracts + signals** the mobile screens render are authored by their home components, not here: the alert/notification centre + the seven rules + watchdog + unroutable-fails-loud (C7 ALR — **ISSUE-075**); the real-time/polling contract + connection budget + degrade (C7 RTP — **ISSUE-076**); the mobile **push routing contract** FR-7.VIEW.003 itself (C7 — ISSUE-075/078 own the C7 VIEW/ALR authorship); the approval tiers + escalation/flagged workflow + surface-04 approval queue (C6 APR/ESC — **ISSUE-056**); the `/` command dispatch + node-gating + custom commands + surface-10 (C9 CMD — **ISSUE-072**); proactive-suggestion lifecycle (C9 SUG — **ISSUE-070**). This issue is the **narrow-viewport re-rendering + web-push client**, not the producing logic.
- The desktop surfaces themselves (04/05/06/07/08/09/10/11) — each already drafted; mobile re-renders 04/07/08 + the read-only glances of 05/06 and points *back* to the others for the degraded actions.
- Every degraded deep-management action's actual editor lives on its desktop surface (config→ISSUE-086, permission-matrix→ISSUE-021, conflict/consolidation→ISSUE-028, approval Modify→ISSUE-056, fleet→ISSUE-078, agent-capability→ISSUE-067, command-authoring→ISSUE-072, memory-mutation→ISSUE-031). Mobile shows the notice only.
- No new PERM node is minted — mobile is a viewport treatment; each screen inherits its desktop counterpart's node (surface-12 Access).

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-7.VIEW.003 (mobile push routing), FR-7.RTP.001, FR-7.RTP.002, FR-7.RTP.003, FR-7.RTP.004 (the two-Realtime cap + poll cadence + connection budget + honest indicator), FR-7.ALR.001, FR-7.ALR.002, FR-7.ALR.006, FR-7.ALR.008, FR-7.ALR.009 (notification-centre chrome + non-suppressible hard-limit + Slack-independent durability + the two protective banners) — all Component 7 (Observability); FR-4.CID.006 (answer-mode pill — Component 4); FR-9.CMD.005 (tap-optimised command menu), FR-9.CMD.001–004 (mobile `/` dispatch), FR-9.MODE.003 (no-bypass), FR-9.SUG.004 (delivery to mobile), FR-9.SUG.005 (dismissal safety-floor) — Component 9; FR-6.APR.001–003 (the three tiers + reversible-soft countdown shown on the mobile card), FR-6.ESC.001/003 (flagged holds + Approve/Reject; Modify degrades) — Component 6; FR-1.RST.003 (Restricted reveal on mobile too) — Component 1; FR-5.QUE.001 (the `task_queue` the Home count + Approvals list read) — Component 5.
- **NFRs:** NFR-SEC.013 (no back-door — every path runs the identical gate), NFR-OBS.011 (never-false-healthy — the surface perceivability duty), NFR-A11Y.001 (accessibility baseline floor — one of the 14 surfaces).
- **Rests on:** ADR-001 §3 (silo isolation — no `client_slug`; mobile reads only the client's own deployment, never the fleet), ADR-006 (static data-driven RLS — a phone is not a privilege boundary; same policy as desktop), ADR-007 (containment-first — the C6 pipeline every mobile action runs through is unchanged), ADR-004 (sole-writer — the few mobile writes route through the owning component, never a direct client-side `UPDATE`); OD-149–152 (surface-12 decomposition/platform/nav/OOS boundary), OD-135 (`conversations`/`messages` net-new store), OD-150→OOS-040 (native wrapper deferred). *(No AF is minted here; the mobile push **delivery-reliability** paper-vs-proven note is deferred to a Phase-5 spike per surface-12 — no Phase-3 FR rests on it, the surface fails safe to the persisted in-app record.)*

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-7.VIEW.003.1, AC-7.VIEW.003.2 (FR-7.VIEW.003 — hard-limit push immediate + non-suppressible; approval push frequencies configurable)
- AC-7.RTP.001.1, AC-7.RTP.001.2, AC-7.RTP.001.3 (FR-7.RTP.001 — Approvals + Alerts live; no third socket, chat polls)
- AC-7.RTP.004.1, AC-7.RTP.004.2 (FR-7.RTP.004 — teardown on unmount; honest reconnect/poll indicator)
- AC-7.ALR.001.1, AC-7.ALR.001.2 (FR-7.ALR.001 — notification centre primary/persistent, unread-until-actioned)
- AC-7.ALR.002.2 (FR-7.ALR.002 — hard-limit alert non-suppressible)
- AC-7.ALR.006.1, AC-7.ALR.006.2 (FR-7.ALR.006 — dashboard record survives Slack outage; failed delivery surfaced not dropped)
- AC-7.ALR.008.2 (FR-7.ALR.008 — stalled-engine critical banner)
- AC-7.ALR.009.1 (FR-7.ALR.009 — unroutable alert fails loud)
- AC-7.VIEW.002.2 (FR-7.VIEW.002 — answer-mode pill on every AI-output item)
- AC-9.CMD.005.1 (FR-9.CMD.005 — most-common node-permitted commands as quick-tap buttons; full set via `/`)
- AC-9.CMD.002.1, AC-9.CMD.002.3 (FR-9.CMD.002 — per-command node gate; no-mapped-node denied)
- AC-9.CMD.003.3 (FR-9.CMD.003 — destructive-confirm never the sole barrier; gate first)
- AC-9.CMD.004.3 (FR-9.CMD.004 — audit-critical command fail-closed on log failure)
- AC-9.MODE.003.1, AC-9.MODE.003.2 (FR-9.MODE.003 — proactive/act traverses the same C6 pipeline; hard-limit halts)
- AC-9.SUG.004.1 (FR-9.SUG.004 — delivered/routed to the correct owner, incl. mobile)
- AC-9.SUG.005.3 (FR-9.SUG.005 — dismissal never drives a hard-risk class below the floor)
- AC-6.APR.003.3 (FR-6.APR.003 — soft-run held for full review, stopping auto-run)
- AC-6.ESC.003.1 (FR-6.ESC.003 — Approve resumes; Modify degrades to desktop)
- AC-1.RST.003.1 (FR-1.RST.003 — Restricted content not auto-injected; explicit audited reveal only)
- AC-NFR-SEC.013.1, AC-NFR-SEC.013.2 (identical gate from desktop/mobile/`/`/quick-tap; destructive denied before confirm)
- AC-NFR-OBS.011.1, AC-NFR-OBS.011.2 (stale/errored reads "—"/"can't confirm" never "0"/"✓"/"Live"; re-fetch before re-enabling on reconnect)
- AC-NFR-A11Y.001.1, AC-NFR-A11Y.001.2 (keyboard-nav + contrast + semantic + labelled; state not colour-alone)
- **Gating spikes (if any):** none direct. Ships **after** its blockers land (ISSUE-075/076/056 — none is a spike). The web-push **delivery-reliability** concern is a Phase-5 note, **not** a launch-gating AF (surface-12 Feasibility) — no Phase-3 FR rests on it; the surface already fails safe to the persisted in-app notification record (FR-7.ALR.006).

## 5. Touches (complete blast radius, by ID)
- **DATA:** DATA-push_subscriptions (the **one net-new binding** owed to C7 — device/browser registration for FR-7.VIEW.003; RLS-scoped to the owning user; no `client_slug`); read-composed, all under the *same* RLS as desktop: DATA-task_queue (Home pending-count + Approvals + My-Queue, filtered to viewer via `originating_user_id`), DATA-event_log (activity feed, clearance+relevance scoped), DATA-notifications (alert/notification centre — incl. `escalation_state`/`escalated_at`/`actioned_at`/`read_state`), DATA-proactive_suggestions (C9 delivery), DATA-conversations, DATA-messages (chat thread, OD-135; `answer_mode` pill on agent messages), DATA-guardrail_log (approval context, read-only on the card).
- **PERM:** **none newly minted** (mobile inherits each screen's desktop node): PERM-action.review (Approvals), PERM-dashboard.workspace / .overview / .ops (Home/Chat/Activity per role, FR-1.PERM.007), each `/` command's own node (FR-9.CMD.002). The Alerts/notification centre is node-free clearance-scoped chrome.
- **CFG:** CFG-approval_push_frequency_minutes (30, LIVE — read-only on the mobile Settings sheet), CFG-stale_queue_push_hours (4, LIVE — read-only); both edited on surface-01 `#proactive`, satisfy AC-7.VIEW.003.2. The hard-limit/critical push classes are **not** user-suppressible.
- **UI:** UI-MOBILE-HOME, UI-MOBILE-APPROVALS, UI-MOBILE-ACTIVITY, UI-MOBILE-CHAT, UI-MOBILE-COMMAND-MENU, UI-MOBILE-ALERTS (all minted by surface-12).
- **Connectors:** none directly (mobile push delivery = web-push/service-worker + the `push_subscriptions` registration; the routing contract is platform-agnostic per OD-150).

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/03-surfaces/surface-12-mobile.md — the six sub-surfaces, layout, per-screen data bindings + states, the push contract section, and the out-of-scope-on-mobile table (the authoritative surface spec for this build).
- spec/01-requirements/component-07-observability.md — FR/AC text for FR-7.VIEW.002/003, FR-7.RTP.001–004, FR-7.ALR.001/002/006/008/009 (the C7 contracts mobile renders).
- spec/01-requirements/component-09-proactive.md — FR-9.CMD.001–005, FR-9.MODE.003, FR-9.SUG.004/005 (the mobile chat + command menu + suggestion delivery).
- spec/01-requirements/component-06-guardrails.md — FR-6.APR.001–003, FR-6.ESC.001/003 (the approval path every mobile Approve/Reject runs).
- spec/01-requirements/component-01-rbac.md — FR-1.RST.003 (the Restricted reveal rule the mobile feed/chat honour), FR-1.PERM.007 (the Dashboard-Access nodes mobile screens inherit).
- spec/04-data-model/schema.md §8 (Observability — `push_subscriptions`, `notifications`, `event_log`), §6 (Execution — `task_queue`), §10 (Proactive — `proactive_suggestions`), §11 (Chat — `conversations`/`messages`), §7 (Guardrails — `guardrail_log`).
- spec/05-non-functional/security.md — NFR-SEC.013 (no back-door).
- spec/05-non-functional/observability.md — NFR-OBS.011 (never-false-healthy), NFR-A11Y.001 (accessibility baseline).
- spec/00-foundations/adr/ADR-001-*.md §3 (silo isolation / no `client_slug`), ADR-006-rls-dynamic-roles.md (a phone is not a privilege boundary).

## 7. Dependencies
- **Blocked-by:** ISSUE-075 (C7 ALR — the notification centre + seven rules + watchdog + unroutable-fails-loud + the push routing this surface renders), ISSUE-076 (C7 RTP — the real-time/polling contract + connection budget + honest indicator the two Realtime mobile screens consume), ISSUE-056 (C6 APR/ESC + surface-04 approval queue — the approval tiers + reversible-soft countdown + Approve/Reject/Modify the mobile Approvals screen re-renders). *(None is a spike.)*
- **Blocks:** none (leaf — Tier-7 surface).
- **⚠️ Render prerequisite (hidden dependency — [[OD-198]] ③, added Session 78):** the surface's READ tables (`task_queue`, `notifications`, `conversations`, `messages`, `proactive_suggestions`, …) are RLS-enabled with **no `authenticated` policy** (0001c default-deny) → a logged-in user's reads return **0 rows live** — fail-CLOSED (no leak, good for #2) but a **false-healthy "0"/"all-clear"** (#3). Owed to the **producer** issues (`075`/`076`/`056`/…), not this leaf. **This surface's render layer must NOT be called live-verified until (a) the producer issues add the aal2-gated human-path read policies AND (b) the render distinguishes "authz returned nothing" from "genuinely zero."** The ISSUE-087 substrate's honest-state primitives already provide (b) — an `unknown`/can't-confirm read renders `—`, not `0`.

## 8. Build order within the slice
1. Stand up the **responsive/PWA shell** (OD-150): a narrow-viewport layout on the *same* app (same auth/RLS/deployment — not a new route), installable as a PWA; the fixed bottom tab bar (Home/Approvals/Chat/Activity/Alerts) + top-bar notification bell + the honest Live/Reconnecting/Polling indicator + the two protective banners pinned above content (OD-151). Wire NFR-A11Y.001 into the shell (keyboard-nav, semantic markup, labelled controls, non-colour-alone state) from the start.
2. Build **`UI-MOBILE-HOME`**: health-score tile (FR-7.VIEW.002 rollup — C7 invents no signal), pending-approvals count + active-alerts count (read `task_queue` / `notifications`, filtered to viewer), quick-chat launcher; every tile carries a freshness stamp and degrades to "—"/"can't confirm" on a failed fetch — never a provisional "0"/green (NFR-OBS.011 → AC-NFR-OBS.011.1).
3. Build **`UI-MOBILE-APPROVALS`** as a Realtime surface (FR-7.RTP.001): held-action cards from `task_queue` + `guardrail_log` with tier badge + live soft-run countdown (FR-6.APR.003); Approve/Reject run the **identical C6 pipeline** (FR-9.MODE.003 / NFR-SEC.013), a Restricted action needs the audited reveal first (FR-1.RST.003), **Modify** renders the "open on a wider display" notice (FR-6.ESC.003 → ISSUE-056); on reconnect re-fetch **before** re-enabling any button (AC-NFR-OBS.011.2 / AC-7.RTP.004.2).
4. Build **`UI-MOBILE-ACTIVITY`** (polls, FR-7.RTP.002): `event_log` rows clearance+relevance scoped, the answer-mode pill on every AI output (AC-7.VIEW.002.2 / FR-4.CID.006) — an unresolved pill reads "mode unknown".
5. Build **`UI-MOBILE-CHAT`** + **`UI-MOBILE-COMMAND-MENU`**: `conversations`/`messages` thread (OD-135; async results return on poll + a notification nudge, **not** a third socket — AC-7.RTP.001.3); `/` dispatch each node-gated (FR-9.CMD.002), destructive-confirm-after-gate (FR-9.CMD.003), `event_log` fail-closed (FR-9.CMD.004); the quick-tap menu shows only node-permitted common commands (FR-9.CMD.005) and runs the same gate as typing `/slug` (NFR-SEC.013); inline suggestions act through C6 (FR-9.MODE.003), dismissal floor preserved (FR-9.SUG.005).
6. Build **`UI-MOBILE-ALERTS`** as the second Realtime surface (FR-7.RTP.001): `notifications` list clearance-scoped, the non-suppressible hard-limit alert (AC-7.ALR.002.2), the two pinned protective banners (AC-7.ALR.008.2 / AC-7.ALR.009.1), durability independent of Slack/push arriving (FR-7.ALR.006); "No alerts" only on a confirmed-live connection, else "can't confirm alert state" (NFR-OBS.011).
7. Implement the **web-push client + `push_subscriptions` registration** (FR-7.VIEW.003): register the device/browser subscription (RLS-scoped to the user, no `client_slug`); consume the C7 routing classes — critical + hard-limit immediate/non-suppressible, pending/stale approvals at `approval_push_frequency_minutes` / `stale_queue_push_hours` (read-only reflected on the Settings sheet); a failed registration reads "push not enabled", never a false "on"; every pushed item also persists in the notification centre (FR-7.ALR.006) so a dropped push loses nothing (#1).
8. Wire the **out-of-scope-on-mobile notices** (OD-152 / NFR-SEC.013): each deep-management action renders an explicit "open on a wider display" notice pointing at its desktop home — a notice, never a silent omission.
9. Test to each AC in field 4 across the six sub-surfaces + the push contract, on both the human path (RLS) and the offline/stale/error states.

## 9. Verification (how DoD is proven)
- **Component / UI-integration (per spec/05-non-functional/test-strategy.md):** each sub-surface renders its bound data under the viewer's RLS + node scope; Approvals/Alerts receive live updates without a manual refresh and no third surface holds a socket — AC-7.RTP.001.1/.2/.3; teardown-on-unmount + honest reconnect indicator — AC-7.RTP.004.1/.2.
- **No-back-door (NFR-SEC.013):** the same action invoked from mobile, a `/` command, and the quick-tap menu passes the identical node-gate + C6 pipeline as desktop, and a destructive command from an unauthorized caller is denied **before** the confirm dialog — AC-NFR-SEC.013.1/.2 (composes with AC-9.CMD.002.1/.3, AC-9.CMD.003.3, AC-9.MODE.003.1/.2, AC-1.RST.003.1).
- **Never-false-healthy (NFR-OBS.011):** a stale/errored tile, feed, queue, or alert list reads "—"/"can't confirm" — never "0"/"✓"/"all clear"/"Live"; on return from offline the surface re-fetches before re-enabling actions — AC-NFR-OBS.011.1/.2 (composes with AC-7.ALR.008.2/.009.1 banners, AC-7.VIEW.002.2 "mode unknown").
- **Push contract:** a hard-limit push is immediate + non-suppressible and the pending/stale frequencies read from config — AC-7.VIEW.003.1/.2; a Slack/push outage leaves every notification-centre row intact and surfaces the failure — AC-7.ALR.006.1/.2; a failed `push_subscriptions` registration never renders a false "push on".
- **Accessibility (NFR-A11Y.001):** the build-time a11y audit passes keyboard-nav + contrast + semantic markup + labelled controls, and no status is conveyed by colour alone — AC-NFR-A11Y.001.1/.2.
- **Spike gate:** none. This is a leaf surface; its blockers (ISSUE-075/076/056) must be `done` and their ACs `Verified` before this issue's ACs reach `Verified`. The web-push delivery-reliability paper-vs-proven item is a Phase-5 note, not a precondition to shipping any Phase-3 FR here.
