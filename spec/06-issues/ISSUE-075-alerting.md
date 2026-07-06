---
id: ISSUE-075
title: Alerting — seven rules + routing + escalation + notification centre + fails-loud
epic: J — observability
status: done
github: "#75"
---

# ISSUE-075 — Alerting — seven rules + routing + escalation + notification centre + fails-loud

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR/NFR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Build the alerting layer on top of the ISSUE-011 observability skeleton — the persistent dashboard notification centre, the seven configurable alert rules, RBAC route-by-type, the escalation-window → secondary-alert chain (escalate-don't-abandon), dashboard-persisted-first delivery durability with best-effort Slack fan-out, the C5/C6 → C7 delivery seam, and the alert-routing config whose unroutable state must fail loud.

## 2. Scope — in / out
**In:**
- The **dashboard notification centre** as the primary, persistent surface: every alert produces a dashboard notification independent of Slack; a notification stays `unread` until explicitly actioned and is reachable from any view (FR-7.ALR.001) — persisted to the `notifications` store.
- The **seven alert rules with per-deployment configurable thresholds** — task-failure spike, queue backup, memory-confidence drop, approval-queue stale, hard-limit hit (always-on, never suppressible), cost-threshold breach, loop missed (references C5 catch-up, not a C7 re-run) (FR-7.ALR.002).
- **Route-by-type** to the correct recipient, resolving targets through C1 roles/permissions; an unresolvable target escalates rather than being silently dropped (FR-7.ALR.003).
- **Every raised alert logged** to `event_log` independent of delivery success (FR-7.ALR.004).
- The **escalation window → secondary alert** chain: no ack within the (configurable) window fires the next recipient; a critical/hard-limit alert is never auto-cleared by timeout; all window/staleness math uses a single server-authoritative timestamp (FR-7.ALR.005).
- **Delivery durability** — the dashboard notification is persisted first and independently; Slack is a best-effort fan-out off the persisted row; a Slack failure never loses the notification and is itself surfaced (FR-7.ALR.006).
- The **C5/C6 → C7 delivery seam**: C7 delivers alerts whose triggering *event* is produced elsewhere — the C6 hard-limit-hit event (immediate dashboard + Slack) and the C5 `awaiting_approval`-stale event (stale-approval alert to the reviewer) (FR-7.ALR.007).
- The **alert-routing configuration** (the destination layer FR-7.ALR.003 routes *through*) and the **unroutable-alert-fails-loud** guarantee: no-deliverable-destination raises a distinct "alert delivery misconfigured" critical, quiet-hours never silences a critical/hard-limit alert, a config write that would leave a critical-alert type with no destination is rejected at config time, and a runtime-invalid Slack webhook is surfaced as a delivery-failure (FR-7.ALR.009).

**Out:**
- The **alert-engine watchdog** (FR-7.ALR.008 / NFR-OBS.004 — "the watcher is watched", heartbeat + independent watchdog): built in **ISSUE-011** (observability skeleton). This slice *consumes* the watchdog path — AC-7.ALR.009.1 routes the "alert delivery misconfigured" critical through it and onto the management-plane push — but does not author the heartbeat/watchdog.
- `event_log` table, its `event_type` enum, the silent-failure detector, retention/redaction-tombstone: **ISSUE-011**. This slice only *appends* alert rows to it (FR-7.ALR.004).
- Alert-routing config **UI/registry surface** (`UI-config-admin#observability`) and the config-audit-log rendering: config *store* + validation live here; the admin surface is **ISSUE-086** (config surfaces) and the ops dashboards that render the notification centre are **ISSUE-078**; the mobile/web-push notification surface is **ISSUE-079**; the user/agency notification-centre panels are **ISSUE-073**.
- The cost meter + per-task aggregation + ladder signal that *raises* the cost-threshold-breach event: **ISSUE-074** (C7 COST). This slice owns the *alert rule* on the breach, not the metering.
- Producing the triggering events themselves — C6 hard-limit (`guardrail_log`), C5 `awaiting_approval` staleness, C2 confidence, C5 loop-missed/queue-depth: owned by their home components; C7 only delivers.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-7.ALR.001, FR-7.ALR.002, FR-7.ALR.003, FR-7.ALR.004, FR-7.ALR.005, FR-7.ALR.006, FR-7.ALR.007, FR-7.ALR.009 (all Component 7 — Observability). *(FR-7.ALR.008 watchdog is built in ISSUE-011 and consumed here.)*
- **NFRs:** NFR-OBS.008 (unroutable-alert-fails-loud + quiet-hours never silence critical), NFR-OBS.009 (alert-delivery invariant — dashboard-persisted-first, Slack best-effort), NFR-OBS.016 (every guardrail-hit + every alert logged, independent of delivery). *(NFR-OBS.004 alert-engine watchdog is realized by ISSUE-011.)*
- **Rests on:** OD-069 (escalation window / escalate-don't-abandon), OD-070 (delivery durability), OD-097 (alert-routing config + unroutable-fails-loud + quiet-hours-never-silences-critical); non-negotiable #3 (never fail silently). ⚠️ FEASIBILITY: **AF-118** (absence-of-signal detection is only as live as its evaluator — the watchdog path AC-7.ALR.009.1 reuses), **AF-120** (cross-deployment clock-sync for the escalation-window / staleness math, AC-7.ALR.005.3).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-7.ALR.001.1, AC-7.ALR.001.2 (FR-7.ALR.001 — dashboard notification always produced; unread-until-actioned, reachable from any view)
- AC-7.ALR.002.1, AC-7.ALR.002.2, AC-7.ALR.002.3 (FR-7.ALR.002 — per-deployment thresholds; hard-limit-hit always-on/non-suppressible; loop-missed references C5 catch-up)
- AC-7.ALR.003.1, AC-7.ALR.003.2 (FR-7.ALR.003 — stale-approval to the specific reviewer; unresolvable target escalates, not dropped)
- AC-7.ALR.004.1 (FR-7.ALR.004 — every alert has an `event_log` row even if Slack later fails)
- AC-7.ALR.005.1, AC-7.ALR.005.2, AC-7.ALR.005.3 (FR-7.ALR.005 — secondary alert on window expiry; critical never auto-resolved; single server-authoritative timestamp)
- AC-7.ALR.006.1, AC-7.ALR.006.2 (FR-7.ALR.006 — Slack outage leaves dashboard intact; failed Slack delivery surfaced)
- AC-7.ALR.007.1, AC-7.ALR.007.2 (FR-7.ALR.007 — C6 hard-limit event → immediate C7 alert; C5 stale `awaiting_approval` → stale-approval alert to reviewer)
- AC-7.ALR.009.1, AC-7.ALR.009.2, AC-7.ALR.009.3, AC-7.ALR.009.4 (FR-7.ALR.009 — unroutable → "alert delivery misconfigured" critical via watchdog path; quiet-hours never silences critical/hard-limit; config write rejected if a critical type has no destination; runtime-invalid Slack webhook surfaced)
- AC-NFR-OBS.008.1, AC-NFR-OBS.008.2 (unroutable → misconfigured-critical escalated; quiet-hours still delivers hard-limit/critical)
- AC-NFR-OBS.009.1, AC-NFR-OBS.009.2 (dashboard persisted first & independently; failed Slack fan-out retains the row + surfaces the failure)
- AC-NFR-OBS.016.1 (guardrail-hit/alert audit-sink row written & retained even when delivery fails)
- **Gating spikes (if any):** none block this issue directly (backlog roster lists blocked-by ISSUE-011 only, no spike gate). Build-time AFs to satisfy as DoD notes, not launch spikes: **AF-118** (watchdog liveness — proven in ISSUE-011) and **AF-120** (clock-sync for the FR-7.ALR.005.3 window math) must hold before the escalation/fails-loud path is signed off (`test-strategy.md`).

## 5. Touches (complete blast radius, by ID)
- **DATA:** DATA-notifications (incl. `.escalation_state`, `.escalated_at`, `.actioned_at`, `.delivery_state`, `.read_state`, `.recipient`, `.recipient_role`, `.type`, `.severity`); DATA-event_log (append-only; alert rows via FR-7.ALR.004 — table owned by ISSUE-011); reads DATA-config_values (`alert_routing_rules`, `escalation_contacts`, `quiet_hours` structured objects); DATA-config_audit_log (routing-config writes audited); reads DATA-guardrail_log / DATA-task_queue as the C6/C5 event sources (delivered, not written here); DATA-deployment_health (`.alert_counts` on the mgmt-plane push for AC-7.ALR.009.1). Enums: `alert_type` (`hard_limit_hit`, `alert_delivery_misconfigured`, `alert_engine_stalled`, …), `notification_read` (`unread`/`read`/`actioned`).
- **PERM:** PERM-config.observability (Super Admin — alert-routing + escalation config; read/write of the routing objects and quiet-hours). Recipient authority is the C1 role model (C7 routes *to* a role; C1 owns who).
- **CFG:** CFG-alert_routing_rules, CFG-escalation_contacts, CFG-quiet_hours, CFG-alert_email_enabled, CFG-SLACK_WEBHOOK_URL (secret; presence via `secret_manifest`); per-rule threshold knobs for the seven rules (task-failure spike, queue-backup, memory-confidence, approval-stale, cost-threshold, loop-missed) and the escalation-window duration.
- **UI:** UI-dashboard-* notification centre is rendered downstream (data/state contract only here) — ISSUE-078 (ops), ISSUE-073 (user/agency), ISSUE-079 (mobile/push); UI-config-admin#observability routing config surface is ISSUE-086.
- **Connectors:** Slack (best-effort webhook fan-out only — `SLACK_WEBHOOK_URL`; dashboard is never dependent on it).

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-07-observability.md — the FR text + ACs (ALR.001–007, ALR.009; and ALR.008 for the watchdog seam this slice consumes).
- spec/05-non-functional/observability.md — NFR-OBS.008, NFR-OBS.009, NFR-OBS.016 (and NFR-OBS.004 for the watchdog posture consumed from ISSUE-011).
- spec/04-data-model/schema.md §8 (Observability — `notifications`, `event_log`, `config_audit_log`) and §12 (Config cluster — `config_values` structured objects `alert_routing_rules`/`escalation_contacts`/`quiet_hours`; the enum block for `alert_type`/`notification_read`; §13 `deployment_health.alert_counts` for the mgmt-plane push).

## 7. Dependencies
- **Blocked-by:** ISSUE-011 (observability skeleton — provides `event_log` + the append-only immutability trigger this slice writes alert rows to, and the FR-7.ALR.008 alert-engine heartbeat/watchdog that AC-7.ALR.009.1 routes the misconfigured-critical through).
- **Blocks:** ISSUE-073 (user + agency dashboards + notification centre — renders this contract), ISSUE-078 (ops dashboards — single-deployment + super-admin fleet console), ISSUE-079 (mobile surface — responsive/PWA + web-push of alerts).

## 8. Build order within the slice
1. Confirm the ISSUE-011 skeleton is in place — `event_log` append-only table + immutability trigger, and the alert-engine heartbeat/watchdog (FR-7.ALR.008). This slice adds alert *rules + delivery*, not the log or the watchdog.
2. Stand up the `notifications` store writes (schema.md §8 — the table exists in Phase-4 schema): dashboard-first persist path — write the notification row **before** any Slack fan-out, defaulting `read_state = 'unread'`, so the row survives a Slack failure (FR-7.ALR.006 / NFR-OBS.009).
3. Implement the seven alert rules as an evaluation pass with per-deployment configurable thresholds; make `hard_limit_hit` always-on and non-suppressible; wire "loop missed" to reference the C5 catch-up rather than a C7 re-run (FR-7.ALR.002).
4. Wire route-by-type: resolve each alert's recipient through the C1 role/permission model; on an unresolvable target, escalate (do not drop) — hand to the FR-7.ALR.005 chain (FR-7.ALR.003 → NFR-OBS.008).
5. Append every raised alert to `event_log` independent of delivery outcome (FR-7.ALR.004 / NFR-OBS.016).
6. Build the escalation-window → secondary-alert chain: on no-ack within the configurable window, fire the next recipient; never auto-resolve a critical/hard-limit alert; drive all window/staleness math off a single server-authoritative timestamp (FR-7.ALR.005 → AF-120, OD-069).
7. Close the C5/C6 → C7 delivery seam: a C6 hard-limit event → immediate dashboard + Slack alert; a C5 stale `awaiting_approval` item → stale-approval alert to its specific reviewer (FR-7.ALR.007).
8. Build the alert-routing config layer in `config_values` (`alert_routing_rules`, `escalation_contacts`, `quiet_hours`, `alert_email_enabled`, `SLACK_WEBHOOK_URL`) behind `PERM-config.observability`, auditing writes to `config_audit_log`; add write-time validation that **rejects** a config leaving any critical-alert type with no resolvable destination (AC-7.ALR.009.3); make quiet-hours suppress only non-critical alerts (AC-7.ALR.009.2); on an unroutable alert, raise the `alert_delivery_misconfigured` critical, route it to Super Admin, and carry it on the mgmt-plane push reusing the FR-7.ALR.008 watchdog path (AC-7.ALR.009.1); surface a runtime-invalid `SLACK_WEBHOOK_URL` as a delivery-failure reusing AC-7.ALR.006.2 (AC-7.ALR.009.4) — FR-7.ALR.009 → OD-097, NFR-OBS.008.
9. Test to each AC in field 4 across delivery-success, Slack-outage, unresolvable-recipient, quiet-hours-critical, and misconfigured-routing paths.

## 9. Verification (how DoD is proven)
- **Unit/rule layer** (per spec/05-non-functional/test-strategy.md): each of the seven rules fires exactly at its configured threshold and `hard_limit_hit` cannot be suppressed — AC-7.ALR.002.1/.2/.3; every raised alert produces an `event_log` row — AC-7.ALR.004.1, AC-NFR-OBS.016.1.
- **Delivery-durability integration:** with Slack forced to fail, the dashboard notification is persisted first and retained and the Slack failure is itself surfaced — AC-7.ALR.006.1/.2, AC-NFR-OBS.009.1/.2.
- **Routing/escalation integration:** a stale-approval alert reaches the specific reviewer; an unresolvable target escalates; no-ack within the window fires the secondary alert; a critical alert is never auto-cleared; the window math uses a server-authoritative timestamp — AC-7.ALR.003.1/.2, AC-7.ALR.005.1/.2/.3 (AF-120 must hold).
- **Seam integration:** a C6 hard-limit event and a C5 stale `awaiting_approval` item each produce the correct C7 alert — AC-7.ALR.007.1/.2.
- **Fails-loud integration:** an unroutable alert raises the `alert_delivery_misconfigured` critical routed to Super Admin and carried on the mgmt-plane push (watchdog path); a config write that would strand a critical type is rejected; quiet-hours still delivers a hard-limit/critical alert; a runtime-invalid webhook is surfaced — AC-7.ALR.009.1/.2/.3/.4, AC-NFR-OBS.008.1/.2 (reuses the ISSUE-011 FR-7.ALR.008 watchdog, AF-118). The AC→`Verified` path for each alerting AC runs once ISSUE-011 has landed the `event_log` + watchdog it depends on.
