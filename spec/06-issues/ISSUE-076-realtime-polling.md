---
id: ISSUE-076
title: Real-time / polling contract + connection budget + degrade
epic: J — observability
status: done
github: "#76"
---

# ISSUE-076 — Real-time / polling contract + connection budget + degrade

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Build the client-side data-freshness contract for the whole dashboard: exactly **two** Supabase Realtime surfaces (approval queue + notification centre), everything else on configurable per-surface polling, a per-silo Realtime connection budget that **degrades extra subscriptions to polling** before the cap (never a silent freeze), and honest subscription lifecycle / reconnect.

## 2. Scope — in / out
**In:**
- The hybrid contract: only the approval queue and the notification centre hold open Realtime (WebSocket) subscriptions; no other surface subscribes by default (FR-7.RTP.001, NFR-OBS.014).
- Per-surface polling cadences read from client config with the documented defaults (health 30s, event log 60s/on-demand, memory health 5m, self-improvement 10m, cost tracking 5m, agent health 60s); a cadence change takes effect with no code change (FR-7.RTP.002).
- The per-silo connection budget (Supabase Free ~200 / Pro ~500 concurrent) with degrade-to-polling: at the configurable headroom threshold (default 80%) new/extra subscriptions switch to polling *before* the cap, the two trust-critical surfaces are prioritised (last to degrade), and the degraded condition surfaces as a health signal (FR-7.RTP.003, NFR-PERF.011).
- Subscription lifecycle: teardown of subscription + poller on unmount (no leaked connections against the budget); a dropped WebSocket reconnects or falls back to polling; the UI reflects an honest Live / Reconnecting / Polling indicator (FR-7.RTP.004).

**Out:**
- The `event_log` append-only backbone, the silent-failure detector, the shared audit-append-only trigger, and the bare `notifications` table shell: **ISSUE-011** owns these (this issue subscribes to / polls the stores it lands, it does not create them).
- The seven alert rules, routing, escalation-window, delivery durability, unroutable-fails-loud, and the notification-centre *lifecycle*: **ISSUE-075** — this issue only provides the Realtime *transport* the notification centre rides on.
- The `awaiting_approval` / `flagged` task states the approval-queue subscription watches: produced by C5 (`task_queue`) and surfaced through the approval queue owned by **ISSUE-056**; consumed here, not authored.
- All dashboard **rendering** (panels, layout, the "live vs polling" pill's visual design, mobile surface): Phase-3 surfaces — **ISSUE-078** (ops dashboards) / **ISSUE-079** (mobile). C7 owns the freshness data contract + signals; the screens render it.
- The config-key *definitions/registry* and their edit surface: the Phase-2 config store (**ISSUE-010**); this issue only *reads* the cadence + headroom keys.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-7.RTP.001, FR-7.RTP.002, FR-7.RTP.003, FR-7.RTP.004 (all Component 7 — Observability).
- **NFRs:** NFR-OBS.014 (exactly two Realtime surfaces), NFR-PERF.011 (connection-budget → degrade-to-polling, visibly).
- **Rests on:** ADR-001 §3/§7 (Silo isolation — the Realtime budget is per-silo, and the `client_slug=eq.…` Realtime filter is a no-op within a single-tenant deployment, doc-reconciliations #1 and #5).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-7.RTP.001.1, AC-7.RTP.001.2, AC-7.RTP.001.3 (FR-7.RTP.001 — two Realtime surfaces live, no third subscribes)
- AC-7.RTP.002.1, AC-7.RTP.002.2 (FR-7.RTP.002 — cadence from config, change with no code)
- AC-7.RTP.003.1, AC-7.RTP.003.2, AC-7.RTP.003.3 (FR-7.RTP.003 — degrade past budget; headroom threshold before cap; no `client_slug` dependence)
- AC-7.RTP.004.1, AC-7.RTP.004.2 (FR-7.RTP.004 — teardown on unmount; honest live/reconnecting/polling)
- AC-NFR-OBS.014.1 (only approval queue + notification centre use Realtime)
- AC-NFR-PERF.011.1, AC-NFR-PERF.011.2 (degrade shows honest indicator, never silent freeze; two prioritised surfaces last to degrade)
- **Gating spikes (if any):** none — no OD-157 launch spike gates the RTP FRs (per `_harvest/frag-c7-c10.md`, RTP is not in the AF-068/069/078 gating set). Verification is build-time/integration only.

## 5. Touches (complete blast radius, by ID)
- **DATA:** DATA-notifications (Realtime source for the notification centre — read/subscribe only; table shell owned by ISSUE-011), DATA-task_queue (`awaiting_approval`/`flagged` rows the approval-queue subscription watches — C5-owned, read/subscribe only); every polled surface reads its producer store at its cadence (no new table is created by this slice).
- **PERM:** none newly created (RTP is a transport/freshness layer; the surfaces it feeds enforce their own C1 read grants).
- **CFG:** `realtime_connection_headroom_threshold` (LIVE, int 1–100, default 80); the per-surface poll-interval keys read at their documented defaults (health / event-log / memory-health / self-improvement / cost-tracking / agent-health cadences) — all held in `config_values` (§12), all LIVE (change with no code, no rebuild).
- **UI:** UI-dashboard-operations, UI-dashboard-manager, UI-dashboard-standard-user, UI-dashboard-super-admin, UI-dashboard-mobile (this contract sets each surface's live-vs-polled freshness model + the Live/Reconnecting/Polling indicator; the panels themselves render in Phase 3 / ISSUE-078/079).
- **Connectors:** none.

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-07-observability.md — the FR text + ACs (RTP.001–004), the Context manifest (ADR-001 spine), and doc-reconciliations #1 and #5 (the per-silo budget + the `client_slug` Realtime-filter no-op).
- spec/05-non-functional/observability.md — NFR-OBS.014 (exactly two Realtime surfaces).
- spec/05-non-functional/performance.md — NFR-PERF.011 (connection budget → visible degrade-to-polling).
- spec/04-data-model/schema.md §8 (Observability — `notifications`) and §12 (Config cluster — `config_values`, where the cadence + headroom keys live).
- spec/00-foundations/adr/ADR-001-isolation-model.md — §3 (single-tenant app tables, no `client_slug`) + §7 (per-silo boundary the connection budget is scoped to).

## 7. Dependencies
- **Blocked-by:** ISSUE-011 (observability skeleton — lands `event_log`, the `notifications` table shell, and the silent-failure posture this contract subscribes to / polls; ISSUE-011 explicitly hands FR-7.RTP.001–004 and NFR-OBS.011/014 to this issue).
- **Blocks:** ISSUE-056 (approval queue — its live `awaiting_approval` surface rides the Realtime transport built here), ISSUE-073 (user + agency dashboards + notification centre), ISSUE-078 (ops dashboards — single-deployment + super-admin fleet console), ISSUE-079 (mobile surface — responsive/PWA + web-push).

## 8. Build order within the slice
1. Confirm ISSUE-011 landed `notifications` and `event_log` and the `task_queue` states exist (C5); this slice adds the *freshness transport*, it does not create those stores.
2. Read the per-surface poll-interval keys + `realtime_connection_headroom_threshold` from `config_values` (§12) with the documented defaults applied when unset (FR-7.RTP.002 → AC-7.RTP.002.1); prove a config change takes effect with no code change / no rebuild (AC-7.RTP.002.2).
3. Wire the **two** Realtime subscriptions — approval queue (`task_queue` `awaiting_approval`) and notification centre (`notifications`) — and assert no third surface opens a subscription by default; the intra-silo Realtime filter carries no `client_slug` predicate (FR-7.RTP.001 / NFR-OBS.014 → AC-7.RTP.001.1/.2/.3, AC-7.RTP.003.3, AC-NFR-OBS.014.1).
4. Put every other surface on its configured polling cadence (health/event-log/memory/self-improvement/cost/agent-health), reading from config (FR-7.RTP.002).
5. Implement the per-silo connection budget accounting + degrade: at `realtime_connection_headroom_threshold` of the cap, new/extra subscriptions degrade to polling *before* the cap, the two trust-critical surfaces are prioritised (last to degrade), and the degraded condition emits a health signal — never a silent freeze (FR-7.RTP.003 / NFR-PERF.011 → AC-7.RTP.003.1/.2, AC-NFR-PERF.011.1/.2).
6. Implement subscription lifecycle: tear down subscription + poller on unmount (no leaked budget), reconnect-or-fall-back-to-polling on a dropped WebSocket, and drive an honest Live / Reconnecting / Polling indicator (FR-7.RTP.004 → AC-7.RTP.004.1/.2).
7. Test to each AC in field 4 — the two-surface cap, cadence-from-config, degrade-at-threshold, and honest-reconnect paths.

## 9. Verification (how DoD is proven)
- **DOCS + build-time (two-surface cap):** the two Realtime surfaces are enumerated and a build-time test proves no third surface opens a Realtime subscription — AC-7.RTP.001.3, AC-NFR-OBS.014.1 (per NFR-OBS.014 verification).
- **Integration (cadence-from-config):** each surface's poll interval is read from `config_values` and a live edit changes it with no code change — AC-7.RTP.002.1/.2.
- **Integration (degrade, per spec/05-non-functional/test-strategy.md + NFR-PERF.011):** at the headroom threshold, extra connections switch to polling and the client shows an honest Polling/Reconnecting indicator (never a silent freeze reading as Live), and the approval queue + notification centre are the last to lose Realtime — AC-7.RTP.003.1/.2, AC-NFR-PERF.011.1/.2.
- **Integration (lifecycle):** an unmount tears down subscription + poller (no leaked connections); a dropped WebSocket reconnects or falls back to polling with the indicator reflecting the true state — AC-7.RTP.004.1/.2.
- **Isolation invariant:** the Realtime filter carries no `client_slug` predicate (doc-reconciliation #1) — AC-7.RTP.003.3.
- No spike gate applies; the AC→`Verified` path runs on the build-time + integration layers above.
