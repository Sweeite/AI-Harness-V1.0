---
id: ISSUE-073
title: User + agency dashboards + notification centre
epic: I — proactive
status: blocked
github: "#73"
---

# ISSUE-073 — User + agency dashboards + notification centre

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Build the two non-technical render surfaces — the leadership/agency dashboard (surface-07) and the Standard User workspace (surface-08) — plus the cross-cutting Realtime **notification centre** that rides every dashboard, each panel binding to its home component's already-built data contract and never rendering a false-healthy view.

## 2. Scope — in / out
**In:**
- **`UI-DASHBOARD-AGENCY` (surface-07)** — the non-technical Manager/leadership view of one deployment: **At-a-Glance** management rollup (reads producing-component counts; C7 invents no signal), **Activity Feed** (plain-English `event_log` rows, each carrying its answer-mode pill), and **Proactive Suggestions** panel (renders C9's ranked/explained items). Entry gated `PERM-dashboard.overview` (OD-129).
- **`UI-DASHBOARD-USER` (surface-08)** — the Standard User personal workspace: **Chat interface** (`/` command menu + inline AI output with pill, backed by the `conversations`/`messages` store), **My Queue** (this user's `task_queue` slice), **Activity Feed** (clearance+relevance-scoped), and **Proactive Suggestions** (routed to me). Entry gated `PERM-dashboard.workspace` (OD-133).
- **`UI-NOTIFICATION-CENTRE`** — the second of exactly two Realtime surfaces (FR-7.RTP.001; the approval queue is the first). Home-specced on surface-07, rendered as cross-cutting chrome on every dashboard (surface-05/07/08), clearance-scoped per viewer (OD-131). Bell + slide-over + the two always-loud protective banners + the live/reconnecting/polling indicator.
- The render-side **five-state discipline** on every panel (Loading / Empty / Error / Partial / Offline-stale) enforcing the never-false-healthy rule: "—" not "0", "mode unknown" never "Cited", "reconnecting/polling" never a stale "Live".

**Out:**
- **The notification transport, alert rules, escalation, routing, delivery durability, watchdog, unroutable-fails-loud** — those are **ISSUE-075** (C7 ALR); this slice *renders* the delivered notifications, it does not evaluate or route them.
- **The Realtime/polling contract, per-silo connection budget, degrade-to-polling, subscription lifecycle** — **ISSUE-076** (C7 RTP); this slice *subscribes* per that contract, it does not own it.
- **The proactive-suggestion lifecycle** (persist/rank/explain/deliver-routing/dismissal-learn) — **ISSUE-070** (C9 SUG); this slice renders its output and offers act/dismiss/explain, which write back *via C9*.
- **The `/` command dispatch, node-gating, destructive-confirm, custom-command invocation** — **ISSUE-072** (C9 CMD); this surface hosts the chat that *invokes* commands, but the dispatch/gating machinery is ISSUE-072's.
- **The answer-mode pill definition** (C4 FR-4.CID.006) and the `[Building]` coverage flag (C2/ADR-002) — consumed and rendered, never defined here.
- **The technical ops dashboard** (surface-05) and **super-admin fleet console** (surface-06): **ISSUE-078**. **The mobile/PWA surface** (surface-12): **ISSUE-079** (this slice honours the FR-7.VIEW.003 push-routing contract but not the mobile interaction design).
- **The C1 permission-node catalog entries** (`PERM-dashboard.overview/.ops/.workspace`, `PERM-action.review`): minted via change-control in OD-129/OD-133/OD-117 and owed to `PERMISSION_NODES.md`; this slice *consumes* them as entry gates.
- **The net-new `conversations`/`messages` chat store schema authoring** (OD-135) — homed to C5/C9; this slice reads/writes the thread but the migration is the schema owner's.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-7.VIEW.002, FR-7.VIEW.003 (Component 7 — Observability; the role-scoped dashboard + answer-mode-pill + mobile-push-routing contract this slice renders) · FR-7.ALR.001 (the notification centre is primary/persistent/accessible-from-every-view — rendered here as cross-cutting chrome) · FR-7.RTP.001, FR-7.RTP.004 (the notification centre is one of exactly two Realtime surfaces; honest connection state on reconnect) · FR-7.RTP.002 (every other panel polls at the configured cadence) · FR-9.SUG.004, FR-9.SUG.005 (the delivered/floored suggestions this slice renders + acts on) · FR-9.MODE.003 (every "act" on a suggestion routes through the identical C6 path — no surface back-door) · FR-9.CST.002, FR-9.CST.001 (the cold-start "learning" suppression state this surface renders as a labelled non-error state) · FR-9.CMD.001, FR-9.CMD.004 (the chat hosts `/`-command invocation + inline pill'd result — dispatch itself is ISSUE-072) · FR-4.CID.006 (the answer-mode pill this slice renders on every AI-output item).
- **NFRs:** NFR-OBS.011 (never-false-healthy surface duty), NFR-OBS.012 (answer-mode pill everywhere; unresolved reads "mode unknown"), NFR-A11Y.001 (the 14-surface accessibility baseline floor).
- **Rests on:** ADR-001 §3 (intra-client only — one silo, no `client_slug`, no cross-deployment view), ADR-006 (human-path RLS is the authority for what a viewer sees — row-level clearance scoping, not UI-only filtering), ADR-002 (the `[Building]` coverage pill semantics); OD-129 (`PERM-dashboard.overview` mint), OD-130 (surface-07 layout), OD-131 (notification centre = cross-cutting chrome, node-free, clearance-scoped), OD-132 (suggestion-act routes through C6 + floor-can't-be-dismissed), OD-133 (`PERM-dashboard.workspace` mint), OD-134 (surface-08 chat-led layout), OD-135 (net-new `conversations`/`messages` store + poll+nudge async-result path), OD-136 (three suggestion delivery surfaces); AF-078 (notification-delivery, inherited via ISSUE-075), AF-118/AF-120 (alert-engine liveness + clock-sync, inherited via ISSUE-075 — the two protective banners this slice renders).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-7.VIEW.002.1, AC-7.VIEW.002.2 (FR-7.VIEW.002 — RBAC-gated panels; pill on every AI-output item)
- AC-7.VIEW.003.1, AC-7.VIEW.003.2 (FR-7.VIEW.003 — mobile-push routing by class; hard-limit immediate+non-suppressible)
- AC-7.ALR.001.1, AC-7.ALR.001.2 (FR-7.ALR.001 — dashboard notification independent of Slack; unread-until-actioned, reachable from any view)
- AC-7.RTP.001.2, AC-7.RTP.001.3 (FR-7.RTP.001 — critical notification appears without refresh; no third Realtime subscription)
- AC-7.RTP.002.1, AC-7.RTP.002.2 (FR-7.RTP.002 — poll cadence read from config; config change takes effect without code)
- AC-7.RTP.004.2 (FR-7.RTP.004 — honest Live/Polling/Reconnecting; re-fetch on reconnect)
- AC-9.SUG.004.1, AC-9.SUG.004.2 (FR-9.SUG.004 — rendered/routed to the right owner; escalate-never-drop)
- AC-9.SUG.005.2, AC-9.SUG.005.3 (FR-9.SUG.005 — floored item re-delivers past threshold regardless of prior dismissal; never below floor)
- AC-9.MODE.003.1, AC-9.MODE.003.2 (FR-9.MODE.003 — "act" passes the identical C6 pipeline; hard-limit failure surfaced)
- AC-9.CST.002.1, AC-9.CST.002.3 (FR-9.CST.002 — suppressed "learning" state rendered; guardrail-class safety event still delivered)
- AC-9.CST.001.2 (FR-9.CST.001 — fail-safe-to-cold when the C2 phase signal is stale/absent)
- AC-9.CMD.001.1, AC-9.CMD.001.2 (FR-9.CMD.001 — valid `/`-command result inline; unknown command shows guidance, never a silent no-op)
- AC-9.CMD.004.2 (FR-9.CMD.004 — every command response carries an answer-mode pill)
- AC-4.CID.006.1 (FR-4.CID.006 — the pill the surface renders)
- AC-NFR-OBS.011.1, AC-NFR-OBS.011.2 (never-false-healthy: "—"/"can't confirm" not "0"/"✓"/"Live"; re-fetch-before-re-enable + honest indicator)
- AC-NFR-OBS.012.1, AC-NFR-OBS.012.2 (pill on every AI output; unresolved reads "mode unknown", never defaulted "Cited")
- AC-NFR-A11Y.001.1, AC-NFR-A11Y.001.2 (keyboard/contrast/semantic/labelled baseline; status not by colour alone)
- **Gating spikes (if any):** none blocking this slice directly. This is a **Tier-7 leaf render surface**; its dependencies' spike gates are proven upstream — notification delivery inherits **AF-078 GREEN** (proven in ISSUE-075, not re-proven here), and the two protective banners render the **AF-118 / AF-120** liveness-and-clock-sync conditions that ISSUE-075 owns.

## 5. Touches (complete blast radius, by ID)
- **DATA:** `notifications` (read — the notification centre; C7-owned §8) · `event_log` (read — both activity feeds; C7-owned §8; each AI-output row's `answer_mode` pill) · `proactive_suggestions` (read; act/dismiss written **via C9**; §10) · `task_queue` (read — surface-08 My Queue, filtered by `originating_user_id`/assignment; C5-owned §6) · `conversations`, `messages` (read/write — the surface-08 chat thread, incl. `messages.answer_mode`; net-new §11 / OD-135, schema owned by C5/C9) · `signal_weights` (not touched here — dismissal-learning is C9/ISSUE-070). **No `client_slug` on any** (OD-096 / FR-10.ISO.001); every read RLS-scoped to the silo + viewer clearance (ADR-006).
- **PERM:** `PERM-dashboard.overview` (surface-07 entry; OD-129) · `PERM-dashboard.workspace` (surface-08 entry, default all six roles; OD-133) · `PERM-dashboard.ops` (consumed only for the "view technical trace" deep-link to surface-05; OD-129) · `PERM-action.review` (consumed for the "go decide → surface-04" link; OD-117). The notification centre is **node-free** — rides any Dashboard Access node, clearance-scoped (OD-131). No new node minted in this issue.
- **CFG:** `polling_interval_event_log_s` (60) · `polling_interval_health_metrics_s` (30) · `realtime_connection_headroom_threshold` (80%) · `cold_start_proactive_threshold` (50% — surface-08 suppression state). All read-only here; edited on surface-01 #observability / #proactive.
- **UI:** `UI-DASHBOARD-AGENCY` (surface-07, minted here) · `UI-DASHBOARD-USER` (surface-08, minted here) · `UI-NOTIFICATION-CENTRE` (minted on surface-07, rendered as cross-cutting chrome).
- **Connectors:** none directly (connector-status display is surface-05 / C3).

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/03-surfaces/surface-07-dashboard-agency.md — `UI-DASHBOARD-AGENCY` + `UI-NOTIFICATION-CENTRE`: sections, states, data bindings, OD-129/130/131/132.
- spec/03-surfaces/surface-08-dashboard-user.md — `UI-DASHBOARD-USER`: chat / My Queue / activity feed / suggestions, states, OD-133/134/135/136.
- spec/01-requirements/component-07-observability.md — FR-7.VIEW.002/003, FR-7.ALR.001, FR-7.RTP.001/002/004 + their ACs (the data + Realtime/poll contract).
- spec/01-requirements/component-09-proactive.md — FR-9.SUG.004/005, FR-9.MODE.003, FR-9.CST.001/002, FR-9.CMD.001/004 + their ACs (the rendered suggestion + chat-command contract).
- spec/01-requirements/component-04-prompt.md — FR-4.CID.006 (the answer-mode pill definition, rendered here).
- spec/04-data-model/schema.md §8 (Observability — `event_log`, `notifications`), §10 (Proactive — `proactive_suggestions`), §11 (Chat — `conversations`, `messages`; OD-135), §6 (Execution — `task_queue`).
- spec/05-non-functional/observability.md — NFR-OBS.011 (never-false-healthy), NFR-OBS.012 (pill everywhere), NFR-A11Y.001 (the 14-surface accessibility baseline floor).
- spec/00-foundations/adr/ADR-001-isolation-model.md §3 (intra-client isolation), spec/00-foundations/adr/ADR-006-rls-dynamic-roles.md (human-path RLS scoping), spec/00-foundations/adr/ADR-002-coverage-metric.md (the `[Building]` pill).

## 7. Dependencies
- **Blocked-by:** ISSUE-070 (suggestion lifecycle — produces the ranked/explained/delivered/floored items this slice renders + acts on), ISSUE-075 (alerting — the notification transport/rules/escalation/watchdog this centre displays; carries AF-078/118/120), ISSUE-076 (real-time/polling contract — the subscription + per-silo budget + degrade-to-polling this slice subscribes under). None is a spike.
- **Blocks:** none (leaf — Tier 7).

## 8. Build order within the slice
1. **Confirm dependencies landed** — ISSUE-076's Realtime/poll subscription hook + connection-budget degrade, ISSUE-075's `notifications` transport + protective-banner conditions (delivery-misconfigured / engine-stalled), ISSUE-070's `proactive_suggestions` delivery + floor flag. Confirm §8/§10/§11/§6 tables are migrated (ISSUE-008 harness); confirm `PERM-dashboard.overview/.workspace` are in `PERMISSION_NODES.md`.
2. **Notification centre (`UI-NOTIFICATION-CENTRE`)** — build the cross-cutting bell + slide-over + live/reconnecting/polling indicator + the two pinned always-loud banners; subscribe via the ISSUE-076 Realtime hook (the one Realtime element), clearance-scope the list per viewer (ADR-006), re-fetch on reconnect (FR-7.ALR.001 / FR-7.RTP.001/.004 → AC-7.ALR.001.1/.2, AC-7.RTP.001.2/.3, AC-7.RTP.004.2). Render this chrome on surface-05/07/08 alike (OD-131).
3. **surface-07 shell + entry gate** — render iff caller holds `PERM-dashboard.overview` (absent-not-empty on deny, FR-1.PERM.006); mount the notification-centre chrome + answer-mode-pill legend.
4. **surface-07 Section B (At-a-Glance)** — count tiles, each reading a producing component's signal (C7 invents none, AC-7.VIEW.001.1); poll at `polling_interval_health_metrics_s`; five-state discipline with "—" not "0" (NFR-OBS.011).
5. **surface-07 Section C (Activity Feed)** — `event_log` rows, clearance-scoped, poll at `polling_interval_event_log_s`; render the answer-mode pill on every AI-output row, "mode unknown" never silently "Cited" (FR-7.VIEW.002 / FR-4.CID.006 → AC-7.VIEW.002.2, NFR-OBS.012).
6. **surface-07 Section D (Proactive Suggestions)** — render `proactive_suggestions` (reasoning + pill); wire Act → identical C6 path (FR-9.MODE.003 → AC-9.MODE.003.1/.2), Prepare → surface-04, Dismiss → C9 with the **floor guard** (a floored item can't be dismissed away, AC-9.SUG.005.2/.3); poll the list, new items nudge via the Section-A socket (FR-9.SUG.004).
7. **surface-08 shell + entry gate** — render iff `PERM-dashboard.workspace` (default all six roles); mount the same notification-centre chrome; chat-led layout (OD-134).
8. **surface-08 Section B (Chat)** — bind the `conversations`/`messages` thread (reload-durable, #1); host the `/` command menu (dispatch is ISSUE-072) — a valid command returns inline with a pill, an unknown command shows guidance not a silent no-op (AC-9.CMD.001.1/.2, AC-9.CMD.004.2); async `task_queue` results return on poll + a notification nudge, never a third Realtime socket (OD-135); an unresolved pill reads "mode unknown".
9. **surface-08 Sections C–E** — My Queue (`task_queue` filtered by `originating_user_id`/assignment, decision → surface-04), Activity Feed (clearance+relevance-scoped), Proactive Suggestions (same act/dismiss/floor wiring as step 6) **plus** the cold-start "learning" suppression state below `cold_start_proactive_threshold` as a labelled non-error, fail-safe-to-cold on stale phase (FR-9.CST.002/001 → AC-9.CST.002.1/.3, AC-9.CST.001.2).
10. **Accessibility + five-state sweep** — run the build-time a11y audit across both surfaces (keyboard/contrast/semantic/labelled, status-not-by-colour-alone); assert every panel's Loading/Empty/Error/Partial/Offline-stale states hold the never-false-healthy invariant (NFR-A11Y.001, NFR-OBS.011).
11. **Tests to every AC** in field 4, across both the notification-centre Realtime path and the polled panels.

## 9. Verification (how DoD is proven)
- **Component/UI tests** per spec/05-non-functional/test-strategy.md: each panel's five states render correctly (Loading/Empty/Error/Partial/Offline-stale) — the never-false-healthy assertions ("—" not "0", "mode unknown" never "Cited", "Reconnecting/Polling" never a stale "Live") prove AC-NFR-OBS.011.1/.2 + AC-NFR-OBS.012.1/.2.
- **RBAC/RLS integration:** an under-cleared viewer sees no forbidden notification / feed row / suggestion (row-level, not UI-filtered) — AC-7.VIEW.002.1; a caller lacking the entry node gets 404-not-empty — proves the entry gate.
- **Realtime path:** a new critical notification appears without a manual refresh and no panel outside the notification centre holds a subscription — AC-7.RTP.001.2/.3; a dropped socket reconnects/falls-back with an honest indicator and re-fetches — AC-7.RTP.004.2; a config poll-interval change takes effect without code — AC-7.RTP.002.1/.2.
- **Suggestion + command paths:** an "act" routes through the identical C6 pipeline (AC-9.MODE.003.1/.2); a floored dismissed item re-delivers past threshold (AC-9.SUG.005.2/.3); a valid/unknown `/` command behaves per AC-9.CMD.001.1/.2 with a pill (AC-9.CMD.004.2); the cold-start suppression renders as a labelled state, fail-safe-to-cold on stale phase (AC-9.CST.002.1/.3, AC-9.CST.001.2).
- **Accessibility:** the build-time a11y audit passes on both surfaces — AC-NFR-A11Y.001.1/.2.
- **Inherited spike gates:** notification delivery relies on AF-078 GREEN (proven in ISSUE-075); the protective banners render the AF-118/AF-120 conditions owned there — not re-proven in this slice. The AC→`Verified` path for each rendered AC runs once its upstream producer (ISSUE-070/075/076) is GREEN.
