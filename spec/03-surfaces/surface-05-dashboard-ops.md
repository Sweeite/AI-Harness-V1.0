# Surface: UI-DASHBOARD-OPS (surface-05) — Operations Dashboard

**Status:** 🟢 **Signed off 2026-06-30** (operator: "im happy"). **6 of 14 Phase-3 surfaces complete.** OD-121–124
🟢 (operator "yes" → all four recommendations taken). **Verification gate (1 independent zero-context subagent, checks
a–f): CLEAN — 0 HIGH · 0 MED · 0 LOW.** All six passed: full panel coverage (the 8→9 connector-split is a faithful
decomposition), every config key wired (incl. the new `dlq_stale_alert_hours`), no `client_slug` leak, PERM model reuses
existing C1 categories with no invented node, the #3 false-healthy discipline holds on every panel (notably the
silent-failure detector protects itself — its own failure shows "couldn't verify," never "0"), all seven seams correct,
and the cost-ladder enforcement seam correctly disclaimed. The sixth Phase-3 surface and the **poll-based read-only
counterpart to surface-04's Realtime approval queue**. Where surface-04 is one of **exactly two** live/WebSocket surfaces (FR-7.RTP.001), this one is the
canonical **polling** surface (FR-7.RTP.002): every panel refreshes on a named, per-deployment-configurable cadence,
none over a live socket. It is the per-deployment **source of truth** (FR-7.VIEW.001) — the technical operator's single
glass for "what is the system actually doing, and is anything failing silently?" **OD-123 minted `dlq_stale_alert_hours`
(24 h, LIVE, `#loops`) via change-control to the config registry** — closing a Rule-0 gap (C5 AC-5.JOB.006.2 assumed a
DLQ-staleness knob the registry lacked). OD-121 (per-panel role-scoping) binds to **existing** C1 categories — no node
mint. Next OD: OD-125.

> The **operations dashboard** — the operator's read-only instrument panel. It renders, as nine polled panels,
> every health/audit signal a deployment produces: **system health · failure health · connector health · memory
> health · event log · dead-letter queue · cost · guardrail log · self-improvement**. Each panel's *signal* is
> produced by its home component (C2/C3/C5/C6/C8/C9); C7 guarantees the panel exists, is fed, and is honest about
> its own freshness (FR-7.VIEW.001). This surface is the operator-facing embodiment of non-negotiable **#3 (never
> fail silently)**: the dashboard's defining job is to make a *silent* failure *loud* — a task with no terminal
> event, an unattended DLQ entry, a stale connector, a missed loop, a blind cost meter — and to **never render a
> false-healthy view** (a panel that failed to load must say so, never show a reassuring "0"). It does **not**
> render the Realtime approval queue (surface-04), the notification centre (surface-07), the cross-deployment fleet
> grid (surface-06), or mobile (surface-12) — those are seams.

---

## Context manifest

- **Surface ID:** `UI-DASHBOARD-OPS` (minted here — Phase 1's FR-7.VIEW.001 defined "the operations dashboard" by
  description and listed its panels but assigned no formal `UI-` id; this is its surface. The C7 area also referenced
  "the dashboard" generically across LOG/RTP/COST/ALR; those render here or on the seamed surfaces noted below.)
- **Owned by:** **C7 (Observability)** — C7 guarantees each panel exists and is fed (FR-7.VIEW.001) and owns the
  poll contract (FR-7.RTP.002), the `event_log` (LOG), the cost meter (COST), and the C7 side of the `guardrail_log`
  view/retention/export (FR-7.LOG.007). **But every panel's *signal* is produced by its home component** — C5 (loops,
  queue, DLQ), C3 (connector health), C2 (memory health), C6 (guardrail log content), C8 (agent health / drift /
  routing), C9 (Insight-Agent suggestions). The surface renders those signals over the C7 poll transport.
- **FRs served:**
  - **The dashboard contract (C7 VIEW):** FR-7.VIEW.001 (**the ops dashboard is the per-deployment source of truth**;
    the nine named panels; **each panel's signal maps to a producing component's FR — C7 invents no signal**,
    AC-7.VIEW.001.1; **silent-failure indicators are driven by LOG.003 completeness gaps**, AC-7.VIEW.001.2; the
    self-improvement panel **displays** C9 suggestions, does not generate them, AC-7.VIEW.001.3), FR-7.VIEW.002
    (**role-scoped, RBAC-gated** — a role sees only the panels/signals its C1 permissions allow, AC-7.VIEW.002.1; the
    answer-mode pill is a cross-cutting concern rendered on AI-output items, home surfaces 07/08 — seam here).
  - **The poll contract (C7 RTP):** FR-7.RTP.001 (**this surface is NOT one of the two Realtime surfaces** — context),
    FR-7.RTP.002 (**every panel polls on its named, per-deployment cadence**; the six `polling_interval_*_s` keys),
    FR-7.RTP.004 (a stale/failed poll must be shown honestly, never a frozen view believed current — adopted here as
    each panel's offline/stale state).
  - **The event log (C7 LOG):** FR-7.LOG.001 (`event_log` — the unified, append-only, plain-English timeline:
    `id`, `task_id`, `event_type`, `entity_ids`, `summary`, `payload`, `duration_ms`, `cost_tokens`, `created_at`),
    FR-7.LOG.002 (**log intent, not just action** — `summary` says what happened *and why*), FR-7.LOG.003 (**event-log
    completeness** — every task-lifecycle transition writes its row; **a task with a terminal `task_queue` status but
    no terminal `event_log` row is a silent failure**, AC-7.LOG.003.1 — this drives the Failure-Health panel),
    FR-7.LOG.004 (per-event `duration_ms` + `cost_tokens`, with the **`cost_unknown` sentinel** distinct from a genuine
    0, AC-7.LOG.004.1), FR-7.LOG.005 (**tokens/secrets never in the log** — a redaction guarantee the surface relies
    on when rendering `payload`), FR-7.LOG.006 (`event_log` retention window + compliance-erasure **redaction-tombstone**,
    OD-074), FR-7.LOG.007 (**C7 owns the `guardrail_log` view + retention + tamper-evidence + export**; C6 owns write-
    completeness — the Guardrail-Log panel).
  - **The cost meter + ladder (C7 COST):** FR-7.COST.001 (**estimate-grade** accounting — `cost_tokens` × the operator-
    editable `price_table`, rounded up; **never a vendor invoice**, ADR-003), FR-7.COST.002 (**cost per task-type from
    day one**), FR-7.COST.003 (**the cost ladder** — C7 owns the meter + the breach *signal* at three thresholds
    soft/throttle/hard-kill; **C6 decides, C5 executes** the throttle/kill — the surface renders the meter + which rung
    is lit, it does **not** enforce), FR-7.COST.004 (cost-threshold-breach alert — delivery is the C7 ALR seam).
  - **The DLQ (C5 JOB):** FR-5.JOB.006 (**the dead-letter queue, surfaced in this dashboard** — a task past its retry
    count lands here with **full error history + final failure reason**; **never auto-retried** — a human must explicitly
    **requeue or discard from the dashboard**, AC-5.JOB.006.1; **an entry resident past a configurable age makes C5 itself
    emit an escalating recorded signal**, AC-5.JOB.006.2 — an unattended DLQ is a loud condition, #3).
  - **The loops + queue (C5 LOP/QUE):** FR-5.LOP.005 (**every loop run logged + a loop-failure alert on 3 consecutive
    failures**, feeds System Health "loop status" + Failure Health), FR-5.QUE.001 (**`task_queue` is the permanent audit
    record** — queue depth + success rate read from it), FR-5.QUE.005 (the `awaiting_approval` count — a System-Health
    rollup; the *queue itself* is surface-04).
  - **Connector health (C3 DSC/TOK/RL/TRIG):** FR-3.DSC.005 (**the connector health panel** — per-connector status
    connected/degraded, last-successful-call, **token-expiry countdown**, rate-limit headroom), FR-3.DSC.006 (connector
    alerts — token expiring < `token_expiry_alert_days`, degraded, unresolved past `connector_disconnection_escalation_window`),
    FR-3.DSC.001 (system-wide vs individual disconnection — the panel distinguishes them), FR-3.TOK.001 (**credentials
    never in logs/env/UI** — the panel shows *status*, never a token), FR-3.RL.001 (rate-limit headroom vs `rate_alert_threshold`),
    FR-3.TRIG.005 (**watch/subscription re-arm** — a failed re-arm shows the connector degraded), FR-3.TRIG.006
    (event-gap detection/reconciliation status).
  - **Memory health (C2 MNT — seam, read-only signals):** FR-2.MNT.* (erosion-risk / confidence distribution / coverage-
    by-entity / the maintenance queue *counts*). The panel **renders C2-produced signals read-only and links the
    actionable maintenance queues to surface-03** (the Memory-Review surface owns the Include/conflict/consolidation
    *actions*); deep entity browsing → surface-11.
  - **The guardrail log (C6 LOG, rendered via C7):** FR-6.LOG.001 (`guardrail_log` schema — `guardrail_type` ∈
    {hard_limit, approval_gate, anomaly, rate_limit, prompt_injection}, `description`, `action_blocked`, `status` ∈
    {pending, approved, rejected}, `reviewed_by`, `reviewed_at`), FR-6.LOG.002 (**append-only** — resolution is a
    forward state change, no row is edited/deleted), FR-6.LOG.003 (write-completeness — every guardrail event of all
    five types produces a row), FR-6.LOG.004 (**exportable as client trust evidence** + a dedicated dashboard view),
    FR-6.HRD.002 (**every hard-limit hit logged immediately + alerted** — never silent).
  - **Self-improvement (C8 HLTH/LRN + C7/C6 OPT + C9):** FR-8.HLTH.001 (per-agent health — success/failure rate, last
    run), FR-8.HLTH.002 (**specialisation-drift** metric — **flag, never auto-correct**), FR-8.HLTH.003 (**dead-agent**
    metric — flag, never auto-disable), FR-8.HLTH.004 (metrics produced by C8, **surfaced + acted-on elsewhere; C8 never
    auto-acts**), FR-8.LRN.001 (orchestrator learning — routing refined from outcomes), FR-8.LRN.002 (**routing-mismatch**
    metric — consistently rerouted → "this agent's description may need updating"), FR-7.OPT.001 (**the feedback-flywheel
    substrate** — approval/rejection/memory-flag/task-failure captured + surfaced for review), FR-7.OPT.002 (per-deployment
    benchmarkable signals), FR-6.OPT.001 (**approval-pattern learning** — surface tier-change *candidates*; an admin
    confirms, never auto), and **C9 Insight-Agent suggestions** displayed per AC-7.VIEW.001.3.
- **CFG dependencies** (all read here; the *intervals/thresholds* are **edited on surface-01** at the cited anchor;
  description text binds DRY to `config-registry.md`'s `What it does` column, never re-typed):
  - **Poll cadences** (`#observability`, all **LIVE**, range ≥5 s): `polling_interval_health_metrics_s` (**30 s** —
    System Health + Connector summary), `polling_interval_event_log_s` (**60 s** — Event Log), `polling_interval_memory_health_s`
    (**300 s** — Memory Health), `polling_interval_self_improvement_s` (**600 s** — Self-Improvement), `polling_interval_cost_tracking_s`
    (**300 s** — Cost), `polling_interval_agent_health_s` (**60 s** — agent-health rows).
  - **Alert/threshold context** (read to render trend-vs-threshold + badge colour; **alert *delivery* is the C7 ALR
    seam → notification centre, surface-07**): `task_failure_spike_threshold` (**5 in 30 min**, LIVE, `#observability`),
    `queue_backup_threshold` (**20 for 60 min**, LIVE, `#observability`), `cost_threshold_alert_limit` (**$50/day,
    $200/wk**, LIVE, `#observability`).
  - **Cost ladder** (`#guardrails`, **LIVE** — read to show which rung is lit): `cost_ladder_soft_threshold` (**$50/day,
    $200/wk**), `cost_ladder_throttle_threshold` (**$75/day**), `cost_ladder_hard_kill_threshold` (**$100/day**),
    `price_table` (object, **LIVE** — the per-model estimate prices; read to *explain* a cost figure, edited on surface-01).
  - **Connector** (`#tools`, **LIVE**): `token_expiry_alert_days` (**7**), `connector_disconnection_escalation_window`
    (**24 h**), `rate_alert_threshold` (**0.80**).
  - **Retention** (`#observability`/`#infra`, **BOOT**): `event_log_retention_window` (**365 d**, ≥ legal/audit floor C10).
  - **DLQ** (`#loops`, **LIVE**): `max_retries_before_dead_letter` (**3** — the retry cap that *produces* a DLQ entry).
    ⚠️ **OD-123 — a Rule-0 config gap:** AC-5.JOB.006.2 mandates "an entry resident **beyond a configurable age**"
    triggers the C5 escalation signal, **but no config-registry key exists for that age** (`max_retries_before_dead_letter`
    is the *retry* cap, not the *staleness* age). The DLQ-stale escalation has no editable knob — see OD-123 (mint
    `dlq_stale_alert_hours` via change-control).
  - **Agent health** (`#agents`, **LIVE**): `drift_threshold` (**0.3** — drift above flags for review, FR-8.HLTH.002),
    `dead_agent_threshold` (**0.5 success-rate** — below flags as broken, FR-8.HLTH.003).
- **PERM gates:**
  - **Entry:** a **Dashboard Access** category node (FR-1.PERM.007 — the twelve categories include **Dashboard Access**
    *and* **Observability**). The ops dashboard is the **technical/Operations** view, gated to operators; the specific
    node id is **`PERM-dashboard.ops`** (canonicalised from this surface's working name `view_ops` and minted into
    `PERMISSION_NODES.md` by **surface-07 OD-129**, which formalises the whole Dashboard Access node family;
    FR-1.PERM.005/007 discipline — the per-node enumeration lives in that build artifact, not duplicated into FRs).
    **No new node is minted *in this file*** (unlike surface-03's OD-115 / surface-04's OD-117) — the category already exists and is the natural
    home; what *is* undecided is the **per-panel role-scoping** (OD-121, below), the FR-7.VIEW.002 AC-7.VIEW.002.1
    obligation that "a role sees only the panels its permissions allow."
  - **Per-panel gating** (FR-7.VIEW.002): panels are individually permission-scoped — e.g. the **Cost** panel maps to
    the Observability/Finance view, the **Guardrail Log** to a safety/compliance view, **Connector Health** to the
    Tool-Access view. The exact panel→node map is **OD-121**. Until resolved, the baseline is: a panel renders to a
    caller only if their C1 permissions cover that panel's signal (an unpermitted panel is **absent, not empty** —
    FR-1.PERM.006).
  - **Export** (Guardrail-Log / Event-Log export, FR-6.LOG.004 / FR-7.LOG.007): gated by `PERM-compliance.download_records`
    (the existing Compliance-category node, homed in C1) — exporting trust evidence is a compliance action.
  - **DLQ requeue/discard** (FR-5.JOB.006): an *action*, not a view — gated to operators who may re-drive jobs (working
    name a System-Functions node; exact id in `PERMISSION_NODES.md`). See OD-121's action-gating note.
  - All nodes default-deny (FR-1.PERM.002).
- **DATA bindings** (Phase-4 stubs; **no `client_slug` rendered** — single-tenant per silo, ADR-001 §3 / OD-096, a
  **closed** decision: C10 FR-10.ISO.001 deleted `client_slug` from all app tables):
  - **C7-owned** `event_log` (`id`, `task_id`, `event_type` ∈ {task_started, tool_called, memory_read, memory_written,
    guardrail_hit, approval_requested, task_completed, task_failed}, `entity_ids`, `summary`, `payload`, `duration_ms`,
    `cost_tokens` *(nullable / `cost_unknown` sentinel — FR-7.LOG.004)*, `created_at`). Append-only; retention per
    `event_log_retention_window`; compliance erasure = redaction-tombstone (FR-7.LOG.006).
  - **C5-owned** `task_queue` (`id`, `status` ∈ {queued, running, awaiting_approval, completed, failed, flagged}, the
    error history + `attempts` + final failure reason for DLQ rows, `created_at`). The DLQ view = `task_queue` rows in
    the failed/exhausted-retry state (Inngest's failed-function queue projected here); queue depth + success rate
    aggregate over it.
  - **C6-owned** `guardrail_log` (`id`, `task_id`, `guardrail_type` ∈ {hard_limit, approval_gate, anomaly, rate_limit,
    prompt_injection}, `description`, `action_blocked`, `status` ∈ {pending, approved, rejected}, `reviewed_by`,
    `reviewed_at`, `created_at`). Append-only (FR-6.LOG.002); C7 owns the view/retention/export (FR-7.LOG.007).
    **`status=approved` is invalid where `guardrail_type=hard_limit`** (a hard limit is killed-and-logged, never
    approved — AC-6.LOG.001.2). **`client_slug` deleted, not rendered** (OD-096).
  - **C3 connector state** (Phase-4 — surfaced read-only): per-connector status (connected/degraded), `last_successful_call`,
    token-expiry timestamp, rate-limit headroom; `DATA-credentials` is **never read for display** (FR-3.TOK.001 — status
    only, never the token), `DATA-rate_limit_tracker` for headroom.
  - **C8 agent-metrics** (Phase-4 — the metric store C8 produces): per-agent success/failure rate, last-run, drift score
    vs `drift_threshold`, dead-agent score vs `dead_agent_threshold`, routing-mismatch counts.
  - **C2 memory-health signals** (read-only): erosion-risk, confidence distribution, coverage-by-entity, maintenance-queue
    counts (the *actions* live on surface-03).
  - **C9** Insight-Agent suggestions store (read-only display per AC-7.VIEW.001.3).
  - Read-only joins for context: `agents` (C8 — which specialist), `entities`/`memories` (C2 — `event_log.entity_ids`
    resolution, with `[Building]`/tier per ADR-002), `access_audit` (C1 — an export or a sensitive view is itself audited).
- **ADR constraints:**
  - **ADR-003** (estimate-grade cost; the cost ladder) — the Cost panel must **label every figure "estimate"** and
    never imply invoice accuracy; the ladder rungs (soft/throttle/hard-kill) are **signals**, and the panel shows which
    is lit but **never claims the surface enforced it** (C6 decides, C5 executes — FR-7.COST.003).
  - **ADR-001 §3 / OD-096** — physical isolation; **no `client_slug`** anywhere; this is a **single-deployment** dashboard
    (the cross-deployment fleet view is surface-06 — OD-124 confirms the seam).
  - **ADR-002** — any entity context shown carries its `[Building]` / coverage state honestly (a thin-coverage entity is
    not rendered as authoritative).
  - **The three non-negotiables** — this surface is #3's instrument: it exists to make silent failure loud. **No panel
    may render a false-healthy state**; a failed poll shows "couldn't load," never "0"; an unattended DLQ/stale connector/
    missed loop/silent-failure task surfaces as a loud condition, not an absence.

---

## Overview

surface-05 is the technical operator's **instrument panel** — the per-deployment source of truth (FR-7.VIEW.001). It
serves the **Operations role** (Admin) and Super Admin: the people who keep one deployment running. It renders nine
read-only, polled panels — system health, failure health, connector health, memory health, the event log, the
dead-letter queue, cost, the guardrail log, and self-improvement — each fed by its home component, each refreshing on
its own configurable cadence (FR-7.RTP.002). Two things define it. First, it is the **polling** surface — the explicit
counterpart to surface-04's Realtime queue; nothing here is over a live socket, so every panel must be **honest about
its own freshness** (last-updated-at, "refreshing…", "stale as-of T" — FR-7.RTP.004). Second, its whole reason to exist
is **#3**: it is the place a *silent* failure becomes *loud* — a task that ended with no terminal event (AC-7.LOG.003.1),
a DLQ entry no one has touched in a day (AC-5.JOB.006.2), a connector whose token quietly expired, a loop that missed
three runs (FR-5.LOP.005), a cost meter that has gone blind (`cost_unknown`, not "0"). The cardinal sin of this surface
is a **false-healthy view**: a panel that failed to load must say so, never show a reassuring empty state.

---

## Access

> Uses the six canonical C1 roles (FR-1.ROLE.001). Entry requires a **Dashboard Access** node (FR-1.PERM.007 category;
> exact id in `PERMISSION_NODES.md`). Panels are **individually role-scoped** (FR-7.VIEW.002 / AC-7.VIEW.002.1) — the
> panel×role map is OD-121. Custom roles are data-defined; the six defaults are the baseline.

| Role | Can enter? | Notes |
|---|---|---|
| Super Admin | Yes | Full dashboard — every panel. The **cross-deployment** fleet view is a *different* surface (surface-06, FR-7.MGM.*); here a Super Admin sees **this one deployment** |
| Admin (Operations) | Yes | The primary user — the technical operator. Full single-deployment dashboard incl. DLQ requeue/discard + export |
| Finance | Partial — **Cost panel** | Enters to the **Cost** panel only (per FR-7.VIEW.002 role-scoping); other panels absent (not empty). OD-121 confirms |
| HR | No (default) | No ops-monitoring node by default → nav item hidden; a deployment may grant a scoped view |
| Account Manager | No (default) | Operational health is not their surface; client-facing activity lives on surface-07. May be granted Cost-read |
| Standard User | No | No `PERM-dashboard.ops` node by default → nav item hidden; their activity/health view is surface-08 |

**Entry gate:** the surface renders iff the caller holds the **`PERM-dashboard.ops`** node (Dashboard Access category); a caller without it
never sees the "Operations" nav item and a direct URL returns 404 (FR-1.PERM.006 — denied surfaces are absent, not
visible-but-empty). **Per-panel scoping is enforced at the panel** (AC-7.VIEW.002.1): a caller who may enter but lacks
a given panel's node does not see that panel rendered (it is absent). **Export and DLQ requeue/discard are action-gated**
beyond entry (FR-6.LOG.004 / FR-7.LOG.007 export → `PERM-compliance.download_records`; DLQ actions → a System-Functions
node — OD-121).

---

## Layout

A standard in-app surface inside the authenticated shell — sidebar item **"Operations"** (or "Ops Dashboard"). The
recommended structure (**OD-122**) is a **single-scroll, sectioned dashboard** with:

- A **sticky health-summary strip** at the top — the at-a-glance row: loops ●/◐/✕, queue depth + trend arrow, success
  rate vs threshold, connector rollup (n connected / m degraded), agent-health rollup, **today's cost vs the lit ladder
  rung**, open-DLQ count, pending-approval count (links to surface-04). Each chip carries its own **last-updated-at** and
  turns an alert colour on a threshold breach.
- A **sticky panel-nav** (anchor links) so an operator can jump to a panel; each panel is a collapsible section.
- **Per-panel poll + freshness:** every panel shows its **last-updated-at** and a subtle "refreshing…" tick on its
  cadence; a panel that fails its poll shows its **own** error/stale state **without taking down the rest of the
  dashboard** (the Partial state below).

Persistent chrome: a global **● Auto-refresh on (polling)** indicator (this surface is **never** Realtime — it states
so honestly), a manual **Refresh all** affordance (FR-7.RTP.002 on-demand path), and a time-range selector for the
log/cost/guardrail panels (default: last 24 h). No element here is over a WebSocket.

---

## Sections

> One sub-section per panel (FR-7.VIEW.001's enumerated set). Each panel is individually role-scoped (OD-121) and
> individually polled (FR-7.RTP.002). Memory Health and the maintenance queue **link** to surface-03 for actions but
> render read-only here.
>
> **Panel-count note (for traceability):** FR-7.VIEW.001 names *eight* views (system-health, failure-health,
> memory-health, event-log, DLQ, cost, guardrail-log, self-improvement); this surface renders **nine** by breaking
> **Connector Health** out of VIEW.001's "system-health" bundle into its own panel (connector status is an explicit
> system-health sub-signal there, sourced from C3 FR-3.DSC.005, and the Phase-3 playbook lists connector health as a
> first-class ops-dashboard panel). The 8→9 split is an intentional faithful decomposition, not an added signal.

---

### Panel 1 — System Health

**Purpose:** The at-a-glance "is the engine running?" panel — loop status, queue depth + trend, task success rate vs
threshold, a connector rollup, and an agent-health rollup (FR-7.VIEW.001 system-health panel).

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Loop status (●/◐/✕ per loop) | `event_log` loop-run events + FR-5.LOP.005 | Three loops; **3 consecutive failures = ✕ + a loop-failure alert** (delivered by C7 ALR — seam); last-run-at per loop |
| Queue depth + trend | `task_queue` (count by status) + `queue_backup_threshold` | Trend arrow vs the 30-s cadence; turns alert colour at **20 for 60 min** |
| Task success rate | `task_queue` / `event_log` terminal events | Completed ÷ terminal over the window, vs the deployment's success threshold |
| Pending approvals | `task_queue.status = awaiting_approval` (count) | A **rollup only** — the live queue is surface-04; chip links there |
| Connector rollup | C3 connector state (n connected / m degraded) | Summary; the detail is Panel 3 |
| Agent-health rollup | C8 agent-metrics (n healthy / m flagged) | Summary; the detail is Panel 9 |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Jump to failures | Anchors to Panel 2 (Failure Health) | same as entry |
| Open approval queue | Navigates to surface-04 | `PERM-action.review` (else the chip is read-only count) |

**Real-time / poll:** **Polls every `polling_interval_health_metrics_s` (default 30 s)** (FR-7.RTP.002) — not Realtime.

**States:**
- **Loading:** Skeleton chips + a "loading health…" line; the summary strip shows skeletons, **never a green ✓ before data**.
- **Empty:** A brand-new deployment with no runs yet → "No activity yet — the system hasn't run a task. Loops, queue, and
  agents will populate here once the first task runs." (a *true* empty, distinct from a failed fetch).
- **Error:** Poll fails → "Couldn't load system health." + retry; **the strip shows '—' not '0' and not '✓'** (a green
  health strip that is actually a fetch failure would hide a down engine — the cardinal #3 sin).
- **Partial:** E.g. queue + loops load but the connector/agent rollup fails → render those chips as "—" with a "couldn't
  load" tooltip; the panel does **not** imply all-clear. Each chip degrades independently.
- **Offline / stale:** Last poll older than ~2× its cadence → the strip is dimmed and badged **"stale — last updated HH:MM;
  retrying"** (FR-7.RTP.004); chips are not trusted as current. A breach colour latched before going stale persists (an
  alert seen before the dashboard lost connectivity is still real).

---

### Panel 2 — Failure Health (silent-failure indicators)

**Purpose:** The #3 panel — a live failure feed by category, **silent-failure indicators**, and a threshold tracker with
pre-breach trend lines (FR-7.VIEW.001 failure-health view). This is where a failure that left no loud trace is made loud.

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Failure feed by category | `event_log` `task_failed` + `guardrail_hit` events, grouped | Plain-English `summary` per FR-7.LOG.002 (what failed *and why*) |
| **Silent-failure indicator** | **AC-7.LOG.003.1** — `task_queue` rows with a terminal status but **no terminal `event_log` row** | The headline #3 detector: a task that ended without recording how. Each is listed for investigation |
| Task-failure-spike tracker | `event_log` `task_failed` count vs `task_failure_spike_threshold` (5 in 30 min) | Pre-breach trend line — shows the slope *before* the alert fires |
| Queue-backup tracker | `task_queue` depth vs `queue_backup_threshold` (20 for 60 min) | Pre-breach trend line |
| Missed-loop indicator | FR-5.LOP.005 loop heartbeat (3 consecutive failures) | A loop that stopped running is a silent failure of the whole engine |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Inspect failure | Opens the related `event_log` entries / task detail | same as entry |
| View in event log | Filters Panel 5 to that task_id | same as entry |

**Real-time / poll:** **Polls every `polling_interval_health_metrics_s` (default 30 s)** (FR-7.RTP.002).

**States:**
- **Loading:** Skeleton feed rows; "checking for failures…".
- **Empty:** **The healthy state** — "No failures in the selected window. No silent-failure tasks detected." (the
  detector ran and found nothing — distinct from the error state, which must not masquerade as this).
- **Error:** Poll/completeness-check fails → "Couldn't run the failure check." + retry; **explicitly NOT an empty 'all
  clear'** — "we could not verify there are no silent failures" (a failed silent-failure detector that showed "0" would
  itself be the silent failure it's meant to catch). Badge "—".
- **Partial:** The failure feed loads but the silent-failure reconciliation (the `task_queue`↔`event_log` join) fails →
  show the feed, flag the silent-failure indicator as "couldn't verify," do not show it as "0."
- **Offline / stale:** Dimmed + "stale as-of HH:MM"; the pre-breach trend lines freeze with a stale marker; a latched
  spike alert persists.

---

### Panel 3 — Connector Health

**Purpose:** Per-connector status, last-successful-call, token-expiry countdown, rate-limit headroom, and watch/subscription
health (FR-3.DSC.005/006) — so a quietly-dead integration is visible before it costs the deployment data.

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Per-connector status | C3 connector state (connected / degraded / disconnected) | FR-3.DSC.001 distinguishes **system-wide** vs **individual** disconnection |
| Last successful call | C3 `last_successful_call` | A connector "connected" but silent for too long is shown degraded |
| Token-expiry countdown | C3 token-expiry timestamp vs `token_expiry_alert_days` (7) | **Never shows the token** (FR-3.TOK.001) — only the expiry status/countdown |
| Rate-limit headroom | `DATA-rate_limit_tracker` vs `rate_alert_threshold` (0.80) | At ≥80% of cap → alert styling (FR-3.RL.001) |
| Watch/subscription health | FR-3.TRIG.005 re-arm status + FR-3.TRIG.006 gap-reconcile | A failed re-arm → degraded; a detected event-gap shows its reconciliation state |
| Unresolved-escalation flag | FR-3.DSC.006 + `connector_disconnection_escalation_window` (24 h) | A disconnection unfixed past the window is escalated (alert delivery = C7 seam) |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Reconnect / re-auth | Initiates the C3 re-auth flow for a degraded connector (FR-3.TOK.004) | Tool-Access node (OD-121) |
| View connector detail | Opens that connector's status history | same as entry |

**Real-time / poll:** **Polls every `polling_interval_health_metrics_s` (default 30 s)** for status (FR-7.RTP.002); the
token-expiry countdown is computed against **server-authoritative time** (a stale client clock must not mislead — the
same discipline surface-04 adopted for its countdown).

**States:**
- **Loading:** Skeleton connector rows.
- **Empty:** No connectors configured yet → "No connectors connected. Add a connector in Settings → Connectors
  (surface-01 #tools)." (a true empty for a fresh deployment).
- **Error:** Poll fails → "Couldn't load connector health." + retry; **does not render every connector as 'connected'**
  — shows "—" status (an all-green connector panel that is really a fetch failure hides a dead integration).
- **Partial:** Some connectors resolve, others fail → render the resolved ones; flag the unresolved as "status unknown,"
  never "connected."
- **Offline / stale:** Dimmed + "stale as-of HH:MM"; a token-expiry countdown shown while stale is marked "may have
  changed — refreshing"; a latched expiry/disconnection warning persists.

---

### Panel 4 — Memory Health  *(read-only signals; actions seam to surface-03)*

**Purpose:** Erosion-risk, confidence distribution, coverage-by-entity, and the maintenance-queue counts (FR-7.VIEW.001
memory-health view) — the "is the brain healthy?" panel. C2 produces every signal; this panel renders them read-only.

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Erosion-risk panel | C2 FR-2.MNT.* erosion signals | Entities trending stale (relates to `coverage_stale_window_days`, 30 d) |
| Confidence distribution | C2 confidence signals | The amber-zone proportion |
| Coverage by entity | C2 coverage + ADR-002 `[Building]` state | A thin-coverage entity is shown **`[Building]`**, never authoritative |
| Maintenance-queue counts | C2 maintenance queue (FR-2.MNT.*) | **Counts only** — the actionable Ingestion/Conflict/Consolidation queues are **surface-03** |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Open Memory Review | Navigates to surface-03 (the actionable queues) | `PERM-memory.*` per surface-03 (else read-only count) |
| Browse entities | Navigates to surface-11 (entity browser) | per surface-11 |

**Real-time / poll:** **Polls every `polling_interval_memory_health_s` (default 300 s)** (FR-7.RTP.002).

**States:**
- **Loading:** Skeleton distribution + count chips.
- **Empty:** Cold-start deployment → "Memory is still building. Health signals appear as the brain fills." (ties to the
  C2 cold-start/maturity ladder, ADR-002).
- **Error:** Poll fails → "Couldn't load memory health." + retry; counts show "—" not "0" (a "0 conflicts" that is really
  a fetch failure would hide a quarantined contradiction — #1/#3).
- **Partial:** Distribution loads but coverage fails (or vice-versa) → render what loaded, flag the rest "couldn't load."
- **Offline / stale:** Dimmed + "stale as-of HH:MM."

---

### Panel 5 — Event Log

**Purpose:** The unified, append-only, plain-English system timeline (FR-7.LOG.001/002) — the forensic record an
operator scrolls/filters to answer "what did the system do, and why?"

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Timeline rows | `event_log` (`event_type`, `summary`, `entity_ids`, `created_at`) | Newest-first; `summary` is plain-English intent (FR-7.LOG.002) |
| Per-event duration + cost | `event_log.duration_ms`, `event_log.cost_tokens` | **`cost_unknown` sentinel rendered distinctly from a genuine 0** (FR-7.LOG.004) |
| Payload detail | `event_log.payload` | **Tokens/secrets are never present** (FR-7.LOG.005) — the surface trusts this guarantee |
| Type / entity filters | `event_type` enum + `entity_ids` | Filter by type, task, entity, time-range |
| Retention notice | `event_log_retention_window` (365 d) | Shows the window; a compliance-erased row appears as a **redaction-tombstone** (FR-7.LOG.006), not a gap |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Filter / search | Narrows the timeline by type/task/entity/time | same as entry |
| Export | Exports the filtered range (no silent truncation) | `PERM-compliance.download_records` |
| View task | Pivots to the task's full event chain | same as entry |

**Real-time / poll:** **Polls every `polling_interval_event_log_s` (default 60 s)**, plus an on-demand refresh
(FR-7.RTP.002) — not Realtime.

**States:**
- **Loading:** Skeleton rows.
- **Empty:** "No events in this range." (with the current filter/time-range echoed, so an empty filter result isn't
  mistaken for a dead log).
- **Error:** Poll fails → "Couldn't load the event log." + retry; **never an empty timeline** (an empty log that is
  really a fetch failure hides everything the system did — #3). Badge "—".
- **Partial:** Rows load but a row's `payload`/cost fails to resolve → render the row with "detail unavailable" rather
  than dropping it.
- **Offline / stale:** "stale as-of HH:MM"; the live tail stops advancing and says so.

---

### Panel 6 — Dead-Letter Queue (DLQ)

**Purpose:** Tasks that exhausted their retries (FR-5.JOB.006) — the human-only recovery queue. Each carries full error
history + final failure reason; **nothing here is auto-retried** — an operator must explicitly **requeue or discard**.

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| DLQ rows | `task_queue` failed/exhausted-retry rows (Inngest failed-function queue projection) | Lands here after `max_retries_before_dead_letter` (3) attempts (AC-5.JOB.006.1) |
| Error history | `task_queue` per-attempt error + final failure reason | Full history, not just the last error |
| Age / staleness | `created_at`/entered-DLQ time vs the **DLQ-stale age** | ⚠️ **OD-123** — the staleness age has **no config key**; AC-5.JOB.006.2 mandates a "configurable age." See OD-123 |
| Unattended-escalation badge | **AC-5.JOB.006.2** — C5 emits an escalating recorded signal past the stale age | An unattended DLQ is itself a loud condition (#3); the badge reflects the C5-emitted state |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Requeue | Explicitly re-drives the task (the *only* path back — never automatic, AC-5.JOB.006.1); confirm + audited | System-Functions DLQ-action node (OD-121) |
| Discard | Explicitly drops the task with a mandatory reason; audited | System-Functions DLQ-action node (OD-121) |
| View error history | Opens the full per-attempt error trail | same as entry |

**Real-time / poll:** **Polls every `polling_interval_health_metrics_s` (default 30 s)** (FR-7.RTP.002). The
unattended-escalation signal is **C5-emitted server-side** (AC-5.JOB.006.2) — the badge is correct even when no
dashboard is open (the DLQ doesn't depend on someone watching it — #3).

**States:**
- **Loading:** Skeleton rows + a skeleton count badge — **never a "0" while loading**.
- **Empty:** **The healthy state** — "No dead-lettered tasks. Everything that failed was recovered or never exhausted
  its retries."
- **Error:** Poll fails → "Couldn't load the dead-letter queue." + retry; **badge shows '—', not '0'** (a "0" that is
  really a fetch failure hides tasks rotting unrecovered — a direct #3 hole). Requeue/Discard disabled while unloaded.
- **Partial:** Rows load but a row's error history fails → render the row, disable Requeue (don't re-drive a task whose
  failure you can't read), keep Discard available with its mandatory reason.
- **Offline / stale:** "stale as-of HH:MM"; **Requeue/Discard disabled while stale** (don't act on a stale DLQ); the
  unattended-escalation badge **persists** (a stale DLQ that was overdue is still overdue — the C5 signal is server-owned).

---

### Panel 7 — Cost Tracking

**Purpose:** Estimate-grade spend (FR-7.COST.001) — total + per-task-type (FR-7.COST.002) — and **which cost-ladder rung
is lit** (FR-7.COST.003). The panel renders the meter; it does **not** enforce the ladder (C6 decides, C5 executes).

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Today's / week's spend | Σ `event_log.cost_tokens` × `price_table`, rounded up | **Labelled "estimate"** (ADR-003 / FR-7.COST.001) — never an invoice |
| Cost per task-type | `event_log.cost_tokens` grouped by task-type | From day one (FR-7.COST.002) |
| Cost-ladder rung | spend vs `cost_ladder_soft_threshold` ($50/d) / `throttle` ($75/d) / `hard_kill` ($100/d) | Shows which rung is lit; **throttle/hard-kill are enforced by C6/C5, not here** (FR-7.COST.003) |
| Alert-limit marker | `cost_threshold_alert_limit` ($50/d, $200/wk) | The soft-alert line (delivery = C7 ALR seam) |
| Blind-meter indicator | `cost_unknown` sentinel count (FR-7.LOG.004) | A blind cost meter is shown explicitly, **not** as "$0" (#3) |
| Price basis | `price_table` (per-model estimate prices) | Read to *explain* a figure; edited on surface-01 #guardrails |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| View per-task-type breakdown | Expands the cost-by-type table | Cost panel node (OD-121) |
| Open price table | Links to surface-01 #guardrails (where `price_table` is edited) | `PERM-config.guardrails` |

**Real-time / poll:** **Polls every `polling_interval_cost_tracking_s` (default 300 s)** (FR-7.RTP.002).

**States:**
- **Loading:** Skeleton figures.
- **Empty:** No spend yet → "$0.00 estimated — no billable activity yet." (a *true* zero, clearly distinct from the
  blind-meter and error states).
- **Error:** Poll fails → "Couldn't load cost." + retry; **shows '—', not '$0'** (a "$0" that is really a fetch failure
  hides runaway spend — and the ladder rung shows "unknown," never "soft/ok").
- **Partial:** Total loads but per-task-type fails → render the total, flag the breakdown "couldn't load."
- **Offline / stale:** "stale as-of HH:MM"; the lit ladder rung is marked "as-of last poll" so a stale "ok" isn't trusted.

---

### Panel 8 — Guardrail Log

**Purpose:** The safety audit trail (FR-6.LOG.001/004 + FR-7.LOG.007) — every guardrail event of all five types, append-
only, exportable as client trust evidence. The visible proof that the safety layer is doing its job.

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Guardrail rows | `guardrail_log` (`guardrail_type`, `description`, `action_blocked`, `status`, `reviewed_by`, `reviewed_at`) | Append-only (FR-6.LOG.002); newest-first |
| Type filter | `guardrail_type` ∈ {hard_limit, approval_gate, anomaly, rate_limit, prompt_injection} | Filter by class |
| Hard-limit hits | `guardrail_type = hard_limit` rows | **Logged immediately + alerted** (FR-6.HRD.002); **`status=approved` is never valid here** (AC-6.LOG.001.2 — a hard limit is killed, not approved) |
| Resolution status | `guardrail_log.status` + `reviewed_by`/`reviewed_at` | A forward state change (the *acting* on a pending item is surface-04; this is the read-only record) |
| Tamper-evidence / retention | FR-7.LOG.007 | C7 owns retention + tamper-evidence; a compliance-erased row = redaction-tombstone (PII scrubbed, security event retained — OD-074) |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Filter / search | Narrows by type/task/time | same as entry |
| Export trust evidence | Exports the filtered range in a client-presentable format (no silent truncation, FR-6.LOG.004) | `PERM-compliance.download_records` |
| View task | Pivots to the related task / event chain | same as entry |

**Real-time / poll:** **Polls every `polling_interval_health_metrics_s` (default 30 s)** (FR-7.RTP.002) — frequent,
because a hard-limit hit must surface fast (its *alert* is delivered live via C7 to the notification centre — seam).

**States:**
- **Loading:** Skeleton rows.
- **Empty:** **The healthy state** — "No guardrail events in this window." (the safety layer logged nothing because
  nothing tripped — distinct from a fetch failure).
- **Error:** Poll fails → "Couldn't load the guardrail log." + retry; **never an empty log** (an empty safety log that is
  really a fetch failure would falsely imply nothing was blocked — a trust-evidence #3 hole). Badge "—".
- **Partial:** Rows load but a row's detail fails → render the row, flag "detail unavailable"; never drop a safety row.
- **Offline / stale:** "stale as-of HH:MM."

---

### Panel 9 — Self-Improvement

**Purpose:** Agent health / drift / dead-agent / routing-mismatch metrics (C8), the feedback-flywheel substrate (C7
FR-7.OPT.001), approval-pattern tier-change *candidates* (C6 FR-6.OPT.001), and the **displayed** C9 Insight-Agent
suggestions (AC-7.VIEW.001.3). **Everything here is flag-and-suggest — nothing auto-acts** (FR-8.HLTH.004).

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Per-agent health | C8 FR-8.HLTH.001 (success/failure rate, last run) | Rolls up to Panel 1's agent chip |
| Drift flags | C8 FR-8.HLTH.002 vs `drift_threshold` (0.3) | **Flag, never auto-correct** |
| Dead-agent flags | C8 FR-8.HLTH.003 vs `dead_agent_threshold` (0.5 success-rate) | **Flag, never auto-disable** |
| Routing-mismatch | C8 FR-8.LRN.002 | "Consistently rerouted → this agent's description may need updating" |
| Tier-change candidates | C6 FR-6.OPT.001 | Approval-pattern learning — **an admin confirms, never auto** |
| Insight-Agent suggestions | C9 (displayed per AC-7.VIEW.001.3) | C7/this surface **displays**, does not generate; tracks acted/improvement history |
| Flywheel signal feed | C7 FR-7.OPT.001 | approval/rejection/memory-flag/task-failure captured for review |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Review suggestion | Opens an Insight-Agent suggestion / drift flag for the operator to act on (acting happens on the relevant surface — agent config = surface-09) | same as entry (acting may need agent-config node) |
| Confirm tier-change candidate | Routes the C6 candidate to confirmation (never auto-applied) | `PERM-config.guardrails` |
| Open Agent Fleet | Navigates to surface-09 (agent builder/config) | per surface-09 |

**Real-time / poll:** **Polls every `polling_interval_self_improvement_s` (default 600 s)**; per-agent health rows
refresh every `polling_interval_agent_health_s` (default 60 s) (FR-7.RTP.002).

**States:**
- **Loading:** Skeleton metric cards.
- **Empty:** Too-young deployment → "Not enough history yet to surface improvements. Drift, routing, and suggestions
  appear as the system accumulates outcomes." (a true empty — the flywheel hasn't enough data).
- **Error:** Poll fails → "Couldn't load self-improvement metrics." + retry; **a drift/dead-agent flag must not silently
  vanish** — show "couldn't load," never an implied all-healthy. Badge "—".
- **Partial:** Health loads but suggestions/drift fail → render health, flag the rest "couldn't load."
- **Offline / stale:** "stale as-of HH:MM"; flags latched before going stale persist.

---

## Navigation / transitions

| Trigger | Destination |
|---|---|
| Sidebar "Operations" | surface-05 (single-scroll, summary strip at top) |
| Summary strip: pending approvals | surface-04 (the Realtime approval queue) |
| Memory Health: Open Memory Review | surface-03 (the actionable memory queues) |
| Memory Health: Browse entities | surface-11 (entity browser) |
| Connector Health: Reconnect/re-auth | C3 re-auth flow (in-context) / surface-01 #tools |
| Cost: Open price table | surface-01 #guardrails (where `price_table` is edited) |
| Self-Improvement: Open Agent Fleet | surface-09 (agent builder/config) |
| Any panel: Export | a download (compliance-gated) — audited in `access_audit` |
| Cross-deployment / fleet view | surface-06 (Super Admin management plane — FR-7.MGM.*; **not on this surface**, OD-124) |
| A delivered alert | surface-07 notification centre (C7 ALR — seam) |

---

## Mobile

A read-only **summary view** is a genuine mobile use case (an operator glancing at deployment health from a phone). The
summary strip (loops / queue / success / connectors / cost-vs-ladder / DLQ count) collapses to stacked status cards;
the **freshness/last-updated and any breach badges are mandatory on mobile** (a stale "all-green" on a phone is the most
dangerous false-healthy view). **Detail panels, exports, and DLQ requeue/discard degrade to a "open on a wider display"
notice** — re-driving a failed job or exporting trust evidence from a phone is error-prone and out of scope for the
mobile treatment. Critical-alert *push* (hard-limit, cost hard-kill) is the **notification routing** of FR-7.VIEW.003,
owned by C7 and delivered to surface-07/mobile — not this surface. Detailed mobile treatment: `surface-12-mobile.md`.

---

## Open decisions

| # | Question | Options | Recommendation |
|---|---|---|---|
| OD-121 | **Per-panel role-scoping + action-gating** (FR-7.VIEW.002 / AC-7.VIEW.002.1): which of the six roles sees which of the nine panels, and which existing/new PERM nodes gate entry, export, DLQ requeue/discard, and connector re-auth? The FRs say "RBAC-gated, C1 is the authority" but give no panel→node map. | (a) Entry via a **Dashboard Access (ops)** node (Super Admin + Admin full); **Finance** → Cost panel only; others hidden by default. Export → `PERM-compliance.download_records`; DLQ actions + connector re-auth → **System-Functions / Tool-Access** nodes. All node ids materialise in `PERMISSION_NODES.md` (FR-1.PERM.005) — **no new category, no mint** (the categories exist). (b) One coarse "ops view" node, no per-panel scoping (simpler, but violates AC-7.VIEW.002.1's least-privilege). (c) Mint a fresh "Operations" category. | **(a)** — least-privilege per AC-7.VIEW.002.1, reuses existing categories (Dashboard Access, Observability, Compliance, System Functions, Tool Access), and mirrors how surface-01/02 bound to existing `PERM-config.*`/`PERM-user.*` nodes. Records a panel×role×node table; **no FR re-approval, no ADR supersede** — a build-artifact enumeration, not a new decision. |
| OD-122 | **Layout** — single-scroll sectioned dashboard vs tabbed panels? | (a) **Single-scroll, sectioned**, with a sticky health-summary strip + anchor nav + collapsible, independently-polled panels. (b) Tabbed (one panel per tab). | **(a)** — a monitoring dashboard is glanced as a whole; tabs hide a degrading panel behind an unselected tab (a #3 risk — the failure you don't see). The summary strip gives the at-a-glance; anchors give fast access; independent per-panel polling + error states keep one bad panel from taking down the glass. |
| OD-123 ⚠️ **Rule-0 config gap** | AC-5.JOB.006.2 mandates an escalating signal when a DLQ entry sits "**beyond a configurable age**," but **no config-registry key exists** for that age (`max_retries_before_dead_letter`=3 is the *retry* cap, not the staleness age). The DLQ-unattended escalation currently has **no editable knob** — a #3 hole (the loud-condition's threshold is unspecified), the same shape as OD-097. | (a) **Mint `dlq_stale_alert_hours`** (default **24 h**, **LIVE**, `#loops`, `PERM-config.loops`) via change-control to `config-registry.md` — the knob AC-5.JOB.006.2 already assumes exists. (b) Hard-code 24 h (violates "configurable"). (c) Reuse `connector_disconnection_escalation_window` (wrong domain). | **(a)** — mint `dlq_stale_alert_hours` (24 h default, LIVE, `#loops`) via change-control. Closes a real Rule-0 gap: an FR's AC references a config that doesn't exist. Mirrors OD-097's resolution (a config key the FRs assumed but the registry lacked). Adds one registry row; no FR re-approval (it satisfies an existing AC). |
| OD-124 | **Single-deployment vs cross-deployment scope** — does surface-05 render any cross-deployment/management-plane signal (FR-7.MGM.*), or is that exclusively surface-06? | (a) **Exclusively surface-06** — surface-05 is strictly **this one deployment**; a Super Admin here sees only the local deployment, and the fleet grid / cross-deployment cost/health/CI-CD (FR-7.MGM.001–005) lives on surface-06. (b) Embed a fleet summary here for Super Admins. | **(a)** — clean seam, matches ADR-001 §3 isolation (no `client_slug`, no cross-silo data on a per-deployment surface) and the playbook's surface split (06 = "Super Admin dashboard + management-plane screens"). A Super Admin reaches the fleet via surface-06; surface-05 stays single-deployment. |

---

## Phase 4 data binding notes

- **`event_log`** (C7-owned) — the timeline source: `id`, `task_id`, `event_type` (enum, 8 values), `entity_ids`,
  `summary`, `payload` (**redacted — no tokens/secrets, FR-7.LOG.005**), `duration_ms`, `cost_tokens` (**nullable +
  a `cost_unknown` sentinel distinct from 0** — FR-7.LOG.004; Phase 4 must define how the sentinel is represented),
  `created_at`. Append-only; index `(event_type, created_at)` + `(task_id)` for the failure-reconciliation join.
  Retention = `event_log_retention_window` (365 d, ≥ legal/audit floor C10); compliance erasure = **redaction-tombstone**
  (PII scrubbed in place, row + audit metadata retained — FR-7.LOG.006 / OD-074). No `client_slug` (OD-096).
- **Silent-failure detection join** (AC-7.LOG.003.1) — Phase 4 must support the **`task_queue` (terminal status) ↔
  `event_log` (terminal event) reconciliation**: a task with a terminal `task_queue.status` but no terminal `event_log`
  row is the silent-failure indicator on Panel 2. Needs an index supporting "tasks lacking a terminal event in window."
- **`task_queue`** (C5-owned) — queue depth/success-rate aggregates + the DLQ projection: the failed/exhausted-retry
  rows with per-attempt `error` history + final failure reason + `attempts`. The DLQ-stale age (OD-123) drives the
  C5-emitted escalation; **`dlq_stale_alert_hours` is owed to the config registry** (OD-123 change-control). No
  `client_slug`.
- **`guardrail_log`** (C6-owned, C7-rendered/retained) — `id`, `task_id`, `guardrail_type` (5-value enum), `description`,
  `action_blocked`, `status` ∈ {pending, approved, rejected}, `reviewed_by`, `reviewed_at`, `created_at`. Append-only
  (FR-6.LOG.002). **`status=approved` invalid where `guardrail_type=hard_limit`** (AC-6.LOG.001.2). Tamper-evidence +
  export are the C7 side (FR-7.LOG.007). `client_slug` deleted (OD-096), as noted on surface-04.
- **C3 connector state** (Phase-4) — per-connector status, `last_successful_call`, token-expiry timestamp, rate-limit
  headroom, watch/subscription re-arm + gap-reconcile state. **`DATA-credentials` is never read for display** (FR-3.TOK.001);
  the panel binds only to status/expiry-metadata, never the token. The token-expiry countdown must compute against
  **server-authoritative time** (a UI obligation, like surface-04's countdown).
- **C8 agent-metrics store** (Phase-4) — per-agent success/failure rate, last-run, drift score (vs `drift_threshold`),
  dead-agent score (vs `dead_agent_threshold`), routing-mismatch counts. C8 produces; this surface reads (FR-8.HLTH.004
  — never auto-acts).
- **C2 memory-health signals** + **C9 suggestions store** — read-only displays; the actionable memory queues are
  surface-03, the actionable agent config is surface-09.
- **`access_audit`** (C1, append-only) — every Export and every view of a Personal/Restricted-touching log row is an
  audited access (FR-1.AUD.001/002). Immutable; C7 owns retention/export.
- **PERM nodes (OD-121)** — entry + per-panel + action nodes all resolve to **existing categories** (Dashboard Access,
  Observability, Compliance, System Functions, Tool Access — FR-1.PERM.007); exact ids materialise in `PERMISSION_NODES.md`
  at build (FR-1.PERM.005). **No new category, no node mint, no ADR supersede** — unlike surface-03/04 (which minted
  nodes because no category fit). The panel×role×node table is recorded with OD-121.
- **Owed to the config registry (OD-123):** `dlq_stale_alert_hours` (default 24 h, LIVE, `#loops`, `PERM-config.loops`)
  — a change-control addition closing the AC-5.JOB.006.2 gap.
- **No `client_slug`** rendered on any binding (ADR-001 §3 / OD-096); surface-05 is **single-deployment** (OD-124).
