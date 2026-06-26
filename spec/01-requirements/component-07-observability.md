# Component 7 — Observability (how you know what it's doing)

- **Status:** 🟢 **Approved 2026-06-26 (session 24)** — 33 FRs, verification gate run + all 13 findings reconciled;
  ODs **OD-067…OD-074** resolved (OD-068 cost-ladder ownership + OD-074 log-erasure user-decided; the rest
  delegated); feasibility **block R (AF-118…AF-120)** logged. Area codes: LOG ×7 · RTP ×4 · ALR ×8 · COST ×4 ·
  MGM ×5 · VIEW ×3 · OPT ×2 (**33 FRs**). C7 is
  the **observability backbone** — the data + logic layer of "how you know what the system is doing": the
  `event_log`, the real-time-vs-polling contract, the alerting rules + routing + escalation, cost tracking, the
  management-plane cross-deployment push, and log retention/export. **The dashboard *surfaces* (the five role views,
  every panel, all states) are Phase-3 UI work, not C7** — and each panel's *signals* are produced by their home
  component (C2/C3/C5/C6/C8/C9). C7 owns the spine; the screens render it.
- **Scope decision (operator, 2026-06-26, entry):** **backbone now, surfaces → Phase 3.** C7 specifies the
  observability *functions* as Phase-1 FRs; the five dashboards get a thin "this view exists + needs these signals +
  is RBAC-routed" contract, with full layout/state deferred to the dedicated Phase-3 Surfaces pass. This keeps C7 at
  ~32 FRs and avoids both duplicating Phase 3 and usurping the producing components. Mirrors C6's "seam, don't
  absorb" call on the failure-mode map.

> **Verification gate (2 zero-context subagents, 2026-06-26):**
> - **Orphan/contradiction pass — CLEAN.** Zero orphaned design lines (every intent L3031–3328 + checklist L304–326
>   maps to an FR or is correctly seamed — the six "displayed-here, produced-elsewhere" panel signals to
>   C2/C3/C5/C6/C8/C9, the cost-ladder enforcement to C5/C6, the catch-up to C5, all surfaces to Phase 3); no
>   contradictions with ADR-001/003/008, glossary, or the consumed C1–C6 FRs; **all 6 traps PASS** (`client_slug`
>   label-only · cross-deployment is PUSH operational-metadata-only, never a pull/mirror · three distinct log sinks,
>   C7 owns guardrail_log view/retention/export not its write-completeness · cost estimate-grade never the invoice ·
>   surfaces → Phase 3, no signal usurpation · 10/10 citations spot-checked clean).
> - **Quality/failure pass — 13 findings (4 HIGH, 5 MED, 4 LOW), ALL reconciled in-file.** The reviewer's
>   meta-finding: C7 has the strongest #3 instincts of any component so far (it enumerates more silent-failure modes
>   than its predecessors) — the residual risk was **the observability layer becoming its own silent single point of
>   failure**, plus two real cross-component seam holes. **F1** (cost-ladder enforcement seam): verified against
>   **ADR-003 §"Guardrails component" (L181–182)** which assigns throttle/kill to **C6** — so OD-068(a) is correct;
>   the contradiction was **C5's seam line ("C7 enforces") + C6's never-written cost-ladder FR** → C5 line corrected
>   via change-control, the owed C6 FR logged as a tracked carry-forward, FR-7.COST.003 re-cited to ADR-003.
>   **F2** → +AC-7.MGM.002.3 (independent-heartbeat staleness evaluator — the stale-detector can't itself fail
>   silently) + AC-7.MGM.001.3 (reporter logs each push attempt/failure to the *local* event_log so a deployment
>   that can't reach the mgmt plane surfaces it on its own dashboard). **F3/OD-074** (PII in append-only logs survives
>   C2 erasure) → **redaction-tombstone** (+AC-7.LOG.006.3 / AC-7.LOG.007.4; C2 FR-2.MNT.017 amendment owed —
>   carry-forward). **F7** → +FR-7.ALR.008 (the alert-evaluation engine emits a heartbeat; an independent watchdog
>   raises a critical alert if it stalls — "the watcher is watched"). **F8** → AC-7.LOG.003.2 hardened with an
>   out-of-band degraded path (a log-write failure can't be surfaced only through the substrate that just failed;
>   local stderr/file + a "log-write-failing" health bit on the push). **F9** → +AC-7.LOG.003.3 (periodic
>   event_log↔guardrail_log pairing reconciliation). **F6** → server-authoritative timestamps on all
>   staleness/escalation/window math (AC-7.MGM.002.4 / AC-7.ALR.005.3). **F10/F11/F12** → cost-unknown sentinel vs a
>   genuine 0 (AC-7.LOG.004.1), configurable connection-headroom threshold (AC-7.RTP.003.2), pill-coverage
>   thresholding seamed to C2 (FR-7.VIEW.002). **F4/F5** → registers wired + statuses reconciled. New **AF-118**
>   (absence-of-signal detection is only as live as its evaluator), **AF-119** (last-resort out-of-band log-failure
>   surface durability), **AF-120** (cross-deployment clock-sync for window math) — all build-time, none holds an FR.

- **What C7 is:** the answer to "how do you know what the system is actually doing" (L3035). C7 owns the three
  observability pillars as a data/logic backbone — **logging** (the `event_log`: the unified, plain-English,
  append-only timeline of everything the system did), **monitoring** (the real-time-vs-polling contract that feeds
  every health surface), and **alerting** (the notification centre, the seven alert rules, routing-by-type,
  escalation). Plus the **cost meter** (estimate-grade accounting + the cost ladder, ADR-003), the
  **management-plane cross-deployment push** (the Super Admin view, ADR-001 §7 + backup-health ADR-008), and
  **retention/export** of the three log sinks (incl. the C7 side of the `guardrail_log`, OD-065). **The dashboard is
  the primary interface; Slack is supplementary** (L3039) — a load-bearing posture C7 enforces.
- **What C7 is NOT (seams):** the **rendering** of any dashboard panel, every visual state, layout, and the mobile
  surface design → **Phase 3 (Surfaces)**; the **signals** each panel shows are produced elsewhere and only
  *displayed* here — memory health / confidence / coverage / erosion → **C2** (FR-2.MNT.*), connector status / error
  rates → **C3**, loop status / task-queue depth / success rate / DLQ → **C5** (FR-5.LOP./QUE./JOB.*), guardrail
  write-completeness → **C6** (FR-6.LOG.*), agent health / drift detection / routing outcomes → **C8**, the
  self-improvement *suggestions* themselves → **C9** (the Insight Agent). C7 **delivers** the alerts that C6
  (hard-limit hit) and C5 (stale approval) only *emit the event* for. The **answer-mode pill** *content* is C4
  (FR-4.CID); C7 only renders/uses it as a coverage signal. The cost-ladder *enforcement mechanism* (throttle / hard
  kill of a running task) is a guardrail/harness action → **C5/C6** (see OD-068); C7 owns the meter + the ladder
  *trigger*. RBAC routing *rules* → **C1**; webhook auth → **C0**.

- **Design-doc source:** `## 7. Observability` = **L3031–L3328** (next `## The complete system loop` at L3329).
  Load-bearing blocks: core idea **L3033–3039**, `event_log` schema **L3045–3064**, real-time-vs-polling
  **L3068–3179**, the five dashboards **L3183–3284** (Super Admin L3183–3203, Operations L3207–3238, Manager
  L3242–3252, Standard User L3256–3262, Mobile L3266–3284), alerting **L3288–3315**, optimisations **L3319–3325**.
  C7 checklist overview **L304–326**. Cross-cut sites landing in C7: `guardrail_log` schema **L2887–2902** (C6),
  task_queue **L2518–2568** (C5), DLQ **L2587/2738** (C5), connector health panel **L2364–2375** (C3), answer-mode
  pill **L1755–1772** (C4), confidence amber zone **L1697** + erosion signals **L1825–1829** (C2), token-no-leak
  **L2231** (C3).

---

## Context manifest (load only these)

- **ADR-001** (Silo isolation + hybrid ownership) — **the spine for cross-deployment observability.** One isolated
  Supabase per client; `client_slug` deleted from all app tables (§3). **§7 management plane:** Super Admin sees all
  clients via **push, not pull** — a per-deployment outbound "health reporter" job posts *operational-metadata-only*
  snapshots (health score, queue depth, alert counts, core version); **no client business data may cross** the
  boundary ("the management plane is a map, not a warehouse"). The cross-deployment dashboards (MGM area) are built
  entirely on this push.
- **ADR-008** (backup/DR) — backup-health is monitored **remotely via the Supabase Management API**
  (`GET /v1/projects/{ref}/database/backups`) **without touching business data**, a clean fit for the ADR-001 push;
  backup-health is part of the management-plane push. "A backup exists ≠ a restore works" — operator-verified.
- **ADR-003** (cost) — cost tracking is **estimate-grade**: token counts × an operator-editable price table (all
  vendors incl. OpenAI embeddings), fail-safe rounded **up**; **never the vendor invoice** (the ADR-001 boundary
  forbids reading client billing). Breach = a **tiered ladder** (soft alert $50/day + $200/week → throttle
  non-critical at $75 → hard kill at $100), per-deployment tunable, modelled on the rate-limit ladder.
- **The three non-negotiables** — C7 *is* invariant #3 made into a system: **never fail silently.** Observability is
  the component whose whole job is to make failure visible. Every C7 FR is checked against: a missed event, a
  dropped alert, a stale-but-green card, or a lost notification is a #3 violation.
- **Glossary terms used:** `event_log`, `guardrail_log`, `access_audit`, management plane, operational metadata,
  cost ladder, answer-mode pill, Supabase Realtime, notification centre, escalation window. *(New terms this
  component introduces are added to the glossary at finalization — check the existing glossary first.)*

### Consumed (cite, do not re-spec)

- **From C5:** **FR-5.QUE.001** (the `task_queue` schema + status enum — the source for approval-queue depth, task
  success rate, queue depth); **FR-5.QUE.005 / OD-054** (`awaiting_approval` + `flagged` states C7 subscribes to);
  **FR-5.LOP.*** (loop status / last-run / next-run / missed-run + the catch-up the "loop missed" alert references);
  **FR-5.JOB.*** (the dead-letter queue C7 surfaces; the DLQ-not-empty heartbeat AC-5.JOB.006.2); **FR-5.ENV.*** (the
  per-event cost/duration the run pipeline emits).
- **From C6:** **FR-6.LOG.001/003/004** (the `guardrail_log` write-completeness — C6 writes every row; C7 owns the
  *view, retention, tamper-evidence, export*, OD-065); **FR-6.HRD.002 / FR-6.ESC.002** (the hard-limit-hit + flagged
  events that *require* an immediate alert — C7 delivers it); **FR-6.APR.*** (the approval-tier flags surfaced in the
  approval queue).
- **From C2:** **FR-2.MNT.*** (memory health signals: confidence amber zone L1697, coverage gaps L1825, structural
  issues L1827, relevance review flags L1829, maintenance queue, confidence distribution) — C7 *displays*, C2
  *computes*.
- **From C3:** **FR-3.OBS.* / connector health panel** (status, error rate, quota %, L2364–2375); **FR-3.TOK.***
  (the **token-never-in-logs** invariant L2231 — a hard constraint on what C7 may write to `event_log`).
- **From C4:** **FR-4.CID.006** (the answer-mode pill — Cited/Inferred/Unknown — rendered on every AI-output item and
  used as a thin-coverage signal, L1755–1772).
- **From C1:** **FR-1.ROLE.* / PERM.*** (which role may action which alert / see which surface — the routing target);
  **OD-024** (`access_audit` is a *distinct* sink with C7-owned retention).
- **From C8 (forward seam):** agent health / drift detection / orchestrator confidence — C7 reserves the surface; C8
  produces the metric.
- **From C9 (forward seam):** the **Insight Agent** suggestions populating the self-improvement panel — C9 produces,
  C7 displays + tracks acted/improvement-history.

---

## Doc-reconciliations carried into C7 (cite these, not the raw design line)

1. **`client_slug` on `event_log` (L3048), `guardrail_log` (L2896), and the Realtime filters (L3085, L3159) is a
   label/moot, not an RLS key** — under the Silo model (ADR-001 §3) each client has their own Supabase, so app
   tables are **single-tenant** and carry no `client_slug`; client identity lives only in the management-plane
   `client_registry`. Intra-silo the column is dropped; the `client_slug=eq.…` Realtime filter is a no-op within a
   deployment. (Mirrors C1–C6.) **See OD-067.**
2. **Cross-deployment observability is PUSH, operational-metadata-only** (ADR-001 §7) — the Super Admin deployment
   health grid, cross-deployment alerts, CI/CD status, and cost overview are fed by each deployment's outbound
   health-reporter snapshots, **never by the management plane pulling business data**. "Click into a card → that
   deployment's operations dashboard" (L3191) means **navigating into the client deployment itself**; it does **not**
   mirror business data into the management plane ("a map, not a warehouse").
3. **Cost figures are estimate-grade** (ADR-003) — token counts × an operator-editable price table, rounded **up**;
   **never** the vendor invoice (the ADR-001 boundary forbids reading client billing). The L3201/L3321 "token costs"
   are this estimate, surfaced honestly as an estimate.
4. **`event_log` / `access_audit` (C1) / `guardrail_log` (C6) are three distinct append-only sinks** (OD-065) — C7
   owns `event_log` end-to-end + the `guardrail_log` **view/retention/tamper-evidence/export** (C6 owns its
   write-completeness); `access_audit` retention was seamed to C7 by **C1 OD-024**. No event falls between them (#3).
5. **The Supabase Realtime "~100 concurrent users" budget (L3139–3141) is per-silo, not operator-global** — each
   client has its own Supabase project with its own 200/500-connection cap; the budget is per-deployment. Approaching
   it **degrades to polling, never silently stops updating** (#3). "It is a signal the product is working, not a
   blocker" (L3145).

---

## Area codes

| Code | Area | Scope |
|---|---|---|
| **LOG** | Event log + log retention | The `event_log` schema (silo-reconciled) + the 8-value event_type enum; log-intent semantics; append-only; completeness; duration/cost capture; token-no-leak; retention; the C7 side of the `guardrail_log` (view/retention/export) |
| **RTP** | Real-time vs polling | The hybrid contract (Realtime for approval-queue + notifications; polling elsewhere); per-surface cadences; configurable intervals; the per-silo connection budget + degrade-to-polling; subscription lifecycle |
| **ALR** | Alerting | The notification centre (dashboard-first, persistent); the seven alert rules + configurable thresholds; routing-by-type (RBAC); every alert logged; escalation-window → secondary alert; delivery durability; the C5/C6→C7 delivery seam; the watchdog on the alert engine itself |
| **COST** | Cost tracking | Estimate-grade accounting (ADR-003); per-task-type aggregation from day one; the cost ladder (meter + trigger; enforcement seamed); the cost-threshold alert |
| **MGM** | Management-plane / cross-deployment | The outbound health-reporter push (operational-metadata-only, ADR-001 §7); push-staleness → stale-not-green; the deployment health grid; cross-deployment alerts + CI/CD status; backup-health (ADR-008) + cost overview |
| **VIEW** | Dashboard surface contracts | The thin "this view exists + RBAC-routed + sources these signals" FRs for the five role dashboards; the answer-mode pill render seam; mobile push-notification routing — **full layout/state → Phase 3** |
| **OPT** | Observability optimisations | The feedback-flywheel signal substrate (signals captured + surfaced; the weekly-review *discipline* noted non-spec); deployment benchmarking (v2 → OOS-029) + the v1 cost-per-task-type substrate that feeds it |

---

## Seams (do not double-spec)

| Intent (design line) | Home | Why it is not a C7 FR |
|---|---|---|
| Every dashboard panel's **rendering**, visual states, layout, mobile surface design (L3183–3284) | **Phase 3 (Surfaces)** | C7 owns the data/contract + which signals feed it; the screens are the dedicated Surfaces pass |
| Memory health signals: confidence amber zone, coverage gaps, structural issues, relevance flags, maintenance queue, confidence distribution (L3224–3229) | **C2** | C2 FR-2.MNT.* computes them; C7 displays |
| Connector status / error rate / quota (L3216, L2364–2375) | **C3** | C3 owns connector health; C7 displays |
| Loop status / task-queue depth / success rate / DLQ contents (L3212–3215, L3231) | **C5** | C5 FR-5.LOP./QUE./JOB.* produce them; C7 displays |
| `guardrail_log` **write-completeness** (every guardrail event → a row) (L2900) | **C6** | C6 FR-6.LOG.* owns the write contract; C7 owns the view/retention/export (LOG.007) |
| Agent health / drift detection / orchestrator confidence (L3217, L3642) | **C8** | C8 owns agent design + orchestration metrics |
| Self-improvement **suggestions** themselves (prompt/routing/tier/tuning + evidence + impact) (L3233–3237) | **C9** | C9's Insight Agent produces them; C7 displays + tracks acted/history |
| Answer-mode pill **content** (Cited/Inferred/Unknown classification) (L1755–1772) | **C4** | C4 FR-4.CID.006 produces the pill; C7 renders it + uses it as a coverage signal |
| The cost-ladder **enforcement mechanism** (throttle non-critical / hard-kill a running task) (ADR-003) | **C5/C6** | A guardrail/harness action; C7 owns the meter + ladder trigger (COST.003, OD-068) |
| Alert **routing rules** — which role may action which alert | **C1** | C7 routes *to* the C1-defined role; C1 owns the role model |
| The catch-up run on a missed loop (L3312) | **C5** | C5 FR-5.LOP.* owns the catch-up; C7 owns the "loop missed" alert |

---

## Open Decisions (ALL RESOLVED 2026-06-26 — OD-068 + OD-074 user-decided, the rest delegated to recommendation)

> **Two user-decided calls:** **OD-068** (cost-ladder enforcement ownership, #2) → (a) C7 meters + signals; C6
> decides + C5 executes (the proven approval-gate decide/execute split, grounded in ADR-003 §"Guardrails
> component"). **OD-074** (compliance erasure vs append-only logs, #1, surfaced by the verification gate) → (a)
> redaction-tombstone. OD-067/069/070/071/072/073 are #3-silent-failure-avoidance calls that all resolve toward the
> established escalate-don't-abandon / stale-not-green / degrade-don't-freeze pattern; all **delegated to
> recommendation** by the operator per the C0–C6 pattern. All land on option (a).

### OD-067 — `event_log` (+ `guardrail_log`) `client_slug` under the Silo model 🟢 RESOLVED → (a) (delegated)
**Blocks:** FR-7.LOG.001, FR-7.RTP.003. **Why it matters:** the design schemas carry `client_slug text` and the
Realtime examples filter on it; under ADR-001 §3 each client is a single-tenant silo with the column **deleted** —
keeping it invites the exact multi-tenant confusion ADR-001 removed.
**Options:** (a) **drop `client_slug` intra-silo** — identity is implicit (the whole DB is one client); the Realtime
filter reduces to `status=eq.awaiting_approval`; client identity appears only at the management-plane
`client_registry`. (b) keep it as an inert label column. **Recommendation → (a)**, consistent with C1–C6.

### OD-068 — Cost-ladder enforcement ownership: who throttles / hard-kills? 🟢 RESOLVED → (a) — **#2-touching, user-decided**
**Blocks:** FR-7.COST.003. **Why it matters:** ADR-003's ladder ends in **throttle non-critical ($75)** and **hard
kill ($100)** — these *stop the system from acting*. C7 owns the cost meter (it has the running total); but
executing a throttle/kill is an autonomous control action. If ownership is fuzzy, either a runaway burns unbounded
client money (#1) or the system halts legitimate work without a clear authority (#2/#3).
**Options:** (a) **C7 owns the meter + the ladder *trigger logic*** (detect the breach, fire the soft alert, and
*signal* throttle/kill); the **enforcement mechanism** (pausing non-critical task admission / hard-killing a run) is
a **guardrail action seamed to C6**, executed by the **C5 harness** — exactly the C6-decides / C5-executes split
already locked for approval gates. The hard-kill is logged to `guardrail_log` (a `rate_limit`-class event) and
alerts immediately. (b) C7 owns trigger *and* mechanism end-to-end (C7 becomes an enforcement component — breaks the
"C6 is the enforcement layer" boundary). (c) the whole ladder lives in C6 (but C6 doesn't hold the cost total).
**Recommendation → (a)** — keeps the meter where the data is, the enforcement where enforcement lives, and reuses
the already-proven decide/execute seam. **Surfaced for the operator's decision** (the #2-touching call).

### OD-069 — Alert escalation: no-response → secondary alert (no silent drop) 🟢 RESOLVED → (a) (delegated)
**Blocks:** FR-7.ALR.005. **Why it matters:** L3315 says "no response within the escalation window triggers a
secondary alert" but names no owner or end-state — a classic place a critical alert dies silently (#3).
**Options:** (a) **every alert carries an escalation window + a routing chain**; no acknowledgement in the window
escalates to the next person in the chain, and a hard-limit/critical alert that exhausts its chain stays
**persistently unresolved + visibly escalated**, never auto-cleared — reusing the C1 OD-028 / C2 OD-032 / C5
AC-5.QUE.005.2 escalate-don't-abandon pattern. (b) single alert, no escalation (rejected — #3). **Recommendation →
(a)**.

### OD-070 — Notification-centre delivery durability vs Slack 🟢 RESOLVED → (a) (delegated)
**Blocks:** FR-7.ALR.006. **Why it matters:** the dashboard is primary, Slack supplementary (L3039/L3290) — but if
the two share a delivery path, a Slack outage could drop the dashboard notification (#3).
**Options:** (a) **the dashboard notification is persisted first and independently** (read/unread row); Slack is a
best-effort *fan-out* off that row; a Slack-delivery failure never loses the dashboard notification and is **itself
surfaced** (a delivery-failure event), never silently swallowed. (b) deliver-then-persist (rejected — a crash
between loses it). **Recommendation → (a)**.

### OD-071 — Management-plane push staleness: stale-not-green 🟢 RESOLVED → (a) (delegated)
**Blocks:** FR-7.MGM.002. **Why it matters:** the Super Admin grid is fed by a **push** (ADR-001 §7) — if a
deployment's health-reporter stops pushing (crash, network), the last snapshot would show a **stale-but-green** card,
hiding a dead deployment (the single most dangerous #3 in cross-deployment ops).
**Options:** (a) **every card carries a freshness timestamp; a snapshot older than a configurable staleness window
flips the card to `stale`/`unreachable`** and raises a cross-deployment alert — absence of signal is itself a
signal. (b) show last-known state (rejected — silent). **Recommendation → (a)**.

### OD-072 — Three-sink retention windows + completeness 🟢 RESOLVED → (a) (delegated)
**Blocks:** FR-7.LOG.006, FR-7.LOG.007. **Why it matters:** `event_log`, `guardrail_log`, and `access_audit` (C1
OD-024) each need a retention policy; under-retain and you lose the audit trail (#1/#3), over-retain and you hold
data past its purpose (C10 compliance). The C2 compliance-erasure rule (FR-2.MNT.017) and the C10 retention principle
both bear on logs.
**Options:** (a) **each sink has a per-deployment configurable retention window with a floor** (audit/guardrail logs
retained ≥ the compliance/audit minimum; `event_log` retained ≥ a configurable operational window); a log row is
**never pruned while still referenced** by an open task/approval/cleanup; pruning is logged. Erasure of a compliance
subject walks the same transitive rule as C2. (b) infinite retention (rejected — collides with C10). **Recommendation
→ (a)**; the exact numeric floors are a C10/Phase-5 compliance input (flagged, not invented here).

### OD-073 — Realtime connection budget per-silo + degrade-to-polling 🟢 RESOLVED → (a) (delegated)
**Blocks:** FR-7.RTP.003. **Why it matters:** the 200/500 Realtime cap is **per Supabase project**, i.e. per silo
(reconciliation #5). If a busy deployment exhausts its connection budget, new dashboard tabs must not silently stop
receiving live updates (#3).
**Options:** (a) **on approaching the per-silo cap, new/extra subscriptions degrade to the polling cadence** (the
data still updates, just not instantly) and the condition is surfaced as a health signal; the two trust-critical
subscriptions (approval queue + notifications) are prioritized for live connections. (b) hard-fail extra tabs
(rejected — silent stale view). **Recommendation → (a)**.

### OD-074 — Compliance erasure vs the append-only log sinks 🟢 RESOLVED → (a) — **#1/compliance, user-decided**
**Surfaced by:** the C7 verification gate (quality finding F3). **Blocks:** FR-7.LOG.006, FR-7.LOG.007. **Why it
matters:** `event_log.summary` (plain-English narrative) and `entity_ids`, and `guardrail_log.description`, carry the
**PII a GDPR/erasure request targets**. C2's erasure rule **FR-2.MNT.017** walks the *memory* layers + an
`access_audit` tombstone — it does **not** reach `event_log`/`guardrail_log`. Append-only + a retention floor means an
erased person's identity **persists in the logs** after their memory is gone — the C2↔C7 erasure rule was asserted on
C7's side but unsupported on C2's (a real #1 / compliance hole).
**Options:** (a) **redaction-tombstone** — on erasure, scrub the PII fields (`summary`, `entity_ids`,
`description`) **in place** while retaining the row's existence + audit metadata (timestamp, event_type, task_id,
outcome); the audit trail survives, the subject is unidentifiable. (b) **legal-basis exemption** — treat the
audit/guardrail logs as exempt under audit-necessity (GDPR Art. 17(3)), logged explicitly (leaves PII for the
retention window; needs per-client/jurisdiction legal sign-off). (c) **full-delete** the log rows (punches holes in
the append-only audit / guardrail trust-evidence — rejected).
**✅ Resolution → (a) redaction-tombstone** (operator-decided, 2026-06-26 — the parent erasure rule OD-038 was also
user-decided). Homed in **AC-7.LOG.006.3 / AC-7.LOG.007.4**. **Carry-forward (change-control):** **C2 FR-2.MNT.017
must be amended** to name `event_log` + `guardrail_log` in its transitive erasure walk (the redaction-tombstone is
triggered from C2's compliance-erasure path); tracked in the session log, owed to C2.

---

## Functional Requirements

> **Status legend:** `Draft` → `Ready` (OD-free + cited) → `Approved`. All FRs below are **`Approved`** (OD-067…074
> resolved, verification gate run + all 13 findings reconciled). Citations are to the design doc unless a
> reconciliation/ADR is named.

### LOG — Event log + log retention

#### FR-7.LOG.001 — The `event_log` is the unified, append-only system timeline
**Status:** Approved · **Cites:** L3045–3064; reconciliation #1 (OD-067); reconciliation #4 (OD-065)
The system maintains an append-only `event_log` table — the single unified timeline of everything the system did —
with columns: `id`, `task_id`, `event_type`, `entity_ids`, `summary`, `payload`, `duration_ms`, `cost_tokens`,
`created_at`. **`client_slug` is dropped intra-silo** (OD-067 → single-tenant). `event_type` is one of the
enumerated set: `task_started` · `tool_called` · `memory_read` · `memory_written` · `guardrail_hit` ·
`approval_requested` · `task_completed` · `task_failed`. The log is **append-only** — rows are never updated or
deleted in place (retention pruning per FR-7.LOG.006 is the only removal path).
- **AC-7.LOG.001.1** — A write that would `UPDATE` or `DELETE` an existing `event_log` row (outside the LOG.006
  retention job) is rejected at the data layer.
- **AC-7.LOG.001.2** — An event with an `event_type` outside the enumerated set is rejected, not silently coerced.
- **AC-7.LOG.001.3** — No `event_log` row carries a `client_slug` column within a client deployment.

#### FR-7.LOG.002 — Log intent, not just action
**Status:** Approved · **Cites:** L3054, L3062
Every `event_log` row's `summary` is a plain-English, single-sentence statement of **what happened and why** —
including the trigger and the reasoning where applicable ("Updating deal stage because memory indicates client
confirmed budget in last call, triggered by scheduled morning review"), **not** a bare mechanical line ("Tool called:
ghl_update_deal"). The structured detail lives in `payload`; the human narrative lives in `summary`.
- **AC-7.LOG.002.1** — A `tool_called` event's `summary` names the intent/trigger, not only the tool — verifiable
  against a sample: no summary is solely "Tool called: <name>".
- **AC-7.LOG.002.2** — `payload` carries the structured machine detail; `summary` is never empty for any event type.

#### FR-7.LOG.003 — Event-log completeness across the task lifecycle
**Status:** Approved · **Cites:** L3050–3052 (enum); non-negotiable #3
Every task lifecycle transition produces its corresponding `event_log` row — at minimum `task_started`,
`task_completed` **or** `task_failed` for every task, plus a `tool_called` per tool invocation, `memory_read` /
`memory_written` per memory access, `guardrail_hit` per guardrail event (paired with the `guardrail_log` row,
FR-6.LOG.*), and `approval_requested` per approval gate. A task that ends in **neither** `task_completed` nor
`task_failed` is itself a detectable gap (a silent-failure indicator surfaced in the failure-health view).
- **AC-7.LOG.003.1** — For every `task_id`, the log contains exactly one terminal event (`task_completed` or
  `task_failed`); a task with a terminal `task_queue` status but no terminal `event_log` row is flagged as a silent
  failure (#3), not ignored.
- **AC-7.LOG.003.2** — A failure to write an `event_log` row does not silently proceed: the write failure is
  surfaced via an **out-of-band degraded path** — it is **not** surfaced only through the same DB substrate that just
  failed (local stderr/file + a `log-write-failing` health bit carried on the management-plane push, so the Super
  Admin grid sees it even when the silo's own DB is unreachable). ⚠️ FEASIBILITY: **AF-119** (last-resort surface
  durability is paper-until-proven).
- **AC-7.LOG.003.3** — A periodic **cross-sink reconciliation** flags any `guardrail_log` row (C6-written) without
  its `event_log` `guardrail_hit` counterpart, and vice-versa, as a completeness gap — the cross-sink analog of the
  AC-7.LOG.003.1 terminal-event check (the two append-only sinks cannot silently diverge, #3).

#### FR-7.LOG.004 — Per-event duration and cost capture
**Status:** Approved · **Cites:** L3056–3057
Each event records `duration_ms` (execution time) and `cost_tokens` (estimated token cost of that event, per the
ADR-003 estimate-grade method). These feed the cost-tracking (COST area) and performance/trend surfaces.
- **AC-7.LOG.004.1** — Model-call and tool-call events carry a non-null `cost_tokens` (estimate-grade, rounded up per
  ADR-003). A genuinely costless event records `0`; an event whose cost **could not be computed** records a distinct
  **`cost_unknown` sentinel/flag**, never a silent `0` — so a blind/dark cost meter is *detectable* rather than
  averaging in as free (#3).
- **AC-7.LOG.004.2** — `duration_ms` is captured for every event with a measurable span.

#### FR-7.LOG.005 — Tokens and secrets never appear in the log
**Status:** Approved · **Cites:** L2231 (C3 token-no-leak); non-negotiable #2
No connector token value, secret, or credential ever appears in `event_log.summary`, `event_log.payload`, or any
other field — consistent with the C3 token-non-disclosure invariant (FR-3.TOK.*).
- **AC-7.LOG.005.1** — A logged payload that would include a token/secret field is redacted before write; a sample
  audit of `event_log` finds no credential material.

#### FR-7.LOG.006 — `event_log` retention + compliance erasure (redaction-tombstone)
**Status:** Approved · **Cites:** OD-072; OD-074; reconciliation #4; C2 FR-2.MNT.017
`event_log` is retained for a **per-deployment configurable window with an operational floor**; a row is **never
pruned while still referenced** by an open task, approval, or cleanup item; every pruning run is itself logged. The
numeric floor is a C10/Phase-5 compliance input (flagged, not fixed here). **Compliance erasure of a subject
(OD-074) → redaction-tombstone:** the PII fields (`summary` narrative, `entity_ids`) of the affected rows are
**scrubbed in place** while the row's **existence + audit metadata** (`created_at`, `event_type`, `task_id`,
outcome) is **retained** — the audit trail survives ("an event happened here"), the person becomes unidentifiable.
- **AC-7.LOG.006.1** — The retention window is a configurable client-config value; a pruning run that would remove a
  referenced row skips it and records why.
- **AC-7.LOG.006.2** — Each pruning run records a summary event (count pruned, window applied) — pruning is never
  silent.
- **AC-7.LOG.006.3** — A compliance erasure scrubs PII fields in the matching `event_log` rows but retains the row +
  audit metadata (redaction-tombstone); the erasure is itself logged. **Carry-forward:** C2 **FR-2.MNT.017** must be
  amended to name `event_log` + `guardrail_log` in its transitive erasure walk (change-control, owed to C2).

#### FR-7.LOG.007 — The `guardrail_log` view, retention, tamper-evidence, and export (C7 side of OD-065)
**Status:** Approved · **Cites:** L2902; OD-065; OD-072
C7 owns the **dedicated dashboard view, retention, tamper-evidence, and export** of the `guardrail_log` (C6 owns its
write-completeness, FR-6.LOG.*). The log is exportable as **trust evidence for clients** (L2902); export is a
faithful, complete extract of the selected window; retention follows OD-072 with the audit/security floor (≥ the
compliance minimum, never below it).
- **AC-7.LOG.007.1** — An export of the `guardrail_log` over a date range returns every row in that range (no silent
  truncation) in a client-presentable format.
- **AC-7.LOG.007.2** — `guardrail_log` retention honors the security/audit floor; a pruning run never removes a row
  inside the floor window.
- **AC-7.LOG.007.3** — Tamper-evidence: any post-hoc modification of a `guardrail_log` row is detectable (append-only
  + integrity check), since the log's value is as immutable trust evidence.
- **AC-7.LOG.007.4** — Compliance erasure (OD-074) applies the same **redaction-tombstone** to `guardrail_log` —
  PII scrubbed, the security event + audit metadata retained — so a guardrail export stays complete (no missing
  events) while the subject is unidentifiable; the redaction is itself a tamper-evident, logged operation (it does
  not violate AC-7.LOG.007.3's integrity check, which distinguishes an authorized redaction from tampering).

### RTP — Real-time vs polling

#### FR-7.RTP.001 — The hybrid real-time/polling contract
**Status:** Approved · **Cites:** L3068–3093
The dashboard uses **Supabase Realtime (WebSocket) for exactly the two trust-critical surfaces** — the **approval
queue** (new `awaiting_approval` items must appear immediately) and the **notification centre** (critical alerts —
hard-limit hits, connector disconnections, loop failures — must surface immediately) — and **polling for everything
else**. Holding open WebSocket connections for slow-moving data is explicitly out.
- **AC-7.RTP.001.1** — A new `awaiting_approval` task appears in the approval queue without a manual refresh (live).
- **AC-7.RTP.001.2** — A new critical notification appears in the notification centre without a manual refresh.
- **AC-7.RTP.001.3** — No surface outside those two holds an open Realtime subscription by default.

#### FR-7.RTP.002 — Per-surface polling cadences, configurable per deployment
**Status:** Approved · **Cites:** L3099–3128, L3179
Non-real-time surfaces poll at defined default cadences — health metrics **30s**, event log **60s** (or on-demand),
memory health **5m**, self-improvement panel **10m**, cost tracking **5m**, agent health **60s** — and **all polling
intervals are configurable per deployment** in the client config.
- **AC-7.RTP.002.1** — Each surface's poll interval is read from the client config; the documented defaults apply when
  unset.
- **AC-7.RTP.002.2** — Changing a poll interval in config takes effect without code change.

#### FR-7.RTP.003 — Per-silo connection budget with degrade-to-polling
**Status:** Approved · **Cites:** L3131–3146; reconciliation #5; OD-073
The Realtime connection budget is **per silo** (each client's own Supabase project: Free 200 / Pro 500 concurrent;
~2 subscriptions/user ⇒ ~100 concurrent users). On approaching the per-deployment cap, **extra subscriptions degrade
to the polling cadence rather than silently stop updating** (#3); the two trust-critical subscriptions (approval
queue + notifications) are prioritized for live connections; the degraded condition is surfaced as a health signal.
- **AC-7.RTP.003.1** — Beyond the connection budget, a new dashboard tab still receives updates via polling (never a
  silently frozen view).
- **AC-7.RTP.003.2** — A **configurable headroom threshold** (e.g. 80% of the per-silo cap) triggers degrade-to-
  polling for new/extra subscriptions **before** the cap is hit (not at the cap, by when some tabs would already be
  silent); approaching/at the threshold is surfaced as a health signal, not hidden.
- **AC-7.RTP.003.3** — The Realtime filter within a silo does not depend on `client_slug` (reconciliation #1).

#### FR-7.RTP.004 — Subscription lifecycle and reconnect
**Status:** Approved · **Cites:** L3172–3176; non-negotiable #3
Realtime subscriptions are cleaned up on unmount; a dropped WebSocket **reconnects or falls back to polling**, and a
client never silently holds a stale view believing it is live.
- **AC-7.RTP.004.1** — On unmount, the subscription and any poller are torn down (no leaked connections counting
  against the budget).
- **AC-7.RTP.004.2** — A dropped/again-failed subscription reconnects or falls back to polling; the UI reflects
  "live" vs "reconnecting/polling" honestly.

### ALR — Alerting

#### FR-7.ALR.001 — The dashboard notification centre is primary and persistent
**Status:** Approved · **Cites:** L3039, L3290
**All alerts surface in the dashboard notification centre first; Slack is optional and supplementary.** A user who
doesn't use Slack can rely entirely on the dashboard. Dashboard notifications **persist as read/unread until
actioned** and are accessible from every view.
- **AC-7.ALR.001.1** — Every alert produces a dashboard notification (independent of whether Slack is configured).
- **AC-7.ALR.001.2** — A notification stays in unread state until explicitly actioned; it is reachable from any view.

#### FR-7.ALR.002 — The seven alert rules with configurable thresholds
**Status:** Approved · **Cites:** L3293–3313
The system raises these alerts, each with **configurable thresholds** and the specified delivery: **task failure
spike** (N failures in X min → dashboard + Slack admin channel) · **queue backup** (N pending for X+ min → dashboard +
Slack admin channel) · **memory confidence drop** (avg confidence below threshold → dashboard, flag for review) ·
**approval queue stale** (item waiting > N hours → direct dashboard notification to the reviewer) · **hard limit hit**
(any hard limit → immediate dashboard + Slack, **always**) · **cost threshold breach** (daily/weekly spend over
threshold → dashboard) · **loop missed** (any loop misses its scheduled run → dashboard; catch-up run triggered by C5).
- **AC-7.ALR.002.1** — Each rule's threshold(s) are per-deployment configurable; the rule fires when its threshold is
  crossed.
- **AC-7.ALR.002.2** — The **hard limit hit** alert is immediate dashboard + Slack and is **not** suppressible by
  configuration (the one always-on alert; pairs with C6 FR-6.HRD.002).
- **AC-7.ALR.002.3** — A "loop missed" alert references the C5 catch-up (FR-5.LOP.*), not a C7-owned re-run.

#### FR-7.ALR.003 — Routing by type to the correct person
**Status:** Approved · **Cites:** L3315, L418 (C1)
Alerts **route to the correct recipient based on type** — admin-channel alerts to admins, a stale-approval alert to
the **specific reviewer** holding the item, etc. — using the C1 role/permission model as the routing authority (C7
routes *to* the role; C1 owns who that is).
- **AC-7.ALR.003.1** — A stale-approval alert is delivered to the reviewer responsible for that item, not broadcast.
- **AC-7.ALR.003.2** — Routing targets resolve through C1 roles/permissions; a routing target that can't be resolved
  escalates (it is not silently dropped — see ALR.005).

#### FR-7.ALR.004 — Every alert is logged in the event log
**Status:** Approved · **Cites:** L3315; non-negotiable #3
Every alert raised is recorded in the `event_log` (the audit trail of what was surfaced and when), independent of
delivery success.
- **AC-7.ALR.004.1** — Each raised alert has a corresponding `event_log` row, even if its Slack delivery later fails.

#### FR-7.ALR.005 — Escalation window → secondary alert (no silent drop)
**Status:** Approved · **Cites:** L3315; OD-069; reuses C1 OD-028 / C2 OD-032 / C5 AC-5.QUE.005.2
Every alert carries an **escalation window and a routing chain**. No acknowledgement within the window triggers a
**secondary alert** to the next recipient in the chain. A critical/hard-limit alert that exhausts its chain remains
**persistently unresolved and visibly escalated** — never auto-cleared (the escalate-don't-abandon pattern).
- **AC-7.ALR.005.1** — An unacknowledged alert fires a secondary alert at the end of its (configurable) escalation
  window.
- **AC-7.ALR.005.2** — A critical alert is never auto-resolved by timeout; it stays visible/escalated until a human
  actions it.
- **AC-7.ALR.005.3** — All escalation-window / staleness / "N hours" / daily-weekly math uses a **single
  server-authoritative timestamp**, never a client- or reporter-asserted clock — so a skewed clock cannot make an
  escalation window miscompute and silently skip the secondary alert (#3). ⚠️ FEASIBILITY: **AF-120**
  (cross-deployment clock-sync).

#### FR-7.ALR.006 — Notification delivery durability (dashboard independent of Slack)
**Status:** Approved · **Cites:** L3290; OD-070; non-negotiable #3
The dashboard notification is **persisted first and independently**; Slack delivery is a best-effort fan-out off the
persisted row. A **Slack-delivery failure never loses the dashboard notification** and is itself surfaced as a
delivery-failure condition, never silently swallowed.
- **AC-7.ALR.006.1** — A Slack outage leaves every dashboard notification intact.
- **AC-7.ALR.006.2** — A failed Slack delivery is recorded/surfaced (not silently dropped).

#### FR-7.ALR.007 — C7 delivers the alerts C5/C6 only emit the event for
**Status:** Approved · **Cites:** L3088–3093, L3305–3306; consumes C6 FR-6.HRD.002/ESC.002, C5 FR-5.QUE.005
C7 owns the **delivery** of alerts whose triggering *event* is produced by another component — most critically the
**hard-limit-hit** alert (C6 emits the event; C7 delivers it immediately, always) and the **stale-approval** alert (C5
emits/holds the awaiting_approval item; C7 delivers to the reviewer). This realizes the C5/C6 → C7 alert-delivery
seam those components depend on.
- **AC-7.ALR.007.1** — A C6 hard-limit event results in an immediate C7 dashboard + Slack alert (the seam closes
  end-to-end: C6 event → C7 delivery).
- **AC-7.ALR.007.2** — A C5 `awaiting_approval` item exceeding its stale threshold produces the C7 stale-approval
  alert to its reviewer.

#### FR-7.ALR.008 — The alert engine is itself watched (the watcher is watched)
**Status:** Approved · **Cites:** non-negotiable #3; reuses the C5 loop/DLQ heartbeat pattern (AC-5.JOB.006.2)
The component whose job is to make failure visible must not be its own silent single point of failure. The
**alert-evaluation engine** (the job that detects threshold crossings and raises notifications) emits a **heartbeat**;
an **independent watchdog** raises a critical alert if the engine stalls. Without this, the seven alert rules could
silently stop firing while every surface stays green — the worst #3.
- **AC-7.ALR.008.1** — The alert-evaluation engine emits a periodic heartbeat; a missed heartbeat is detected by an
  independent watchdog (not by the engine itself).
- **AC-7.ALR.008.2** — A stalled alert engine raises a critical alert via the watchdog (and the management-plane
  push carries the condition, so a fully-down silo still surfaces on the Super Admin grid). ⚠️ FEASIBILITY:
  **AF-118** (absence-of-signal detection is only as live as its evaluator).

### COST — Cost tracking

#### FR-7.COST.001 — Estimate-grade cost accounting
**Status:** Approved · **Cites:** ADR-003; reconciliation #3
Cost is tracked **estimate-grade**: per-event `cost_tokens` × an **operator-editable price table** (all vendors,
including OpenAI embeddings), fail-safe **rounded up**. The system **never** reads or claims the vendor invoice (the
ADR-001 boundary forbids reading client billing); all cost figures are surfaced honestly as estimates.
- **AC-7.COST.001.1** — The price table is operator-editable per deployment; changing a price re-bases subsequent
  estimates.
- **AC-7.COST.001.2** — Cost figures are labelled/treated as estimates, never presented as the vendor invoice.

#### FR-7.COST.002 — Cost tracking per task type, from day one
**Status:** Approved · **Cites:** L3321, L3120–3123
Cost is aggregated **per task type from day one**, so that over time the operator can see which task types are
expensive and where ROI is highest; the cost-tracking surface polls every 5 minutes (RTP.002).
- **AC-7.COST.002.1** — Cost aggregates are queryable/groupable by task type.
- **AC-7.COST.002.2** — The aggregation is populated from the first task (not retrofitted later).

#### FR-7.COST.003 — The cost ladder: C7 meters + signals; C6 enforces, C5 executes
**Status:** Approved · **Cites:** ADR-003 §"Guardrails component" (L181–182, the cost-ladder guardrail = a C6
class); OD-068 (user-decided → (a))
C7 owns the **cost meter** (the running per-deployment spend total) and the **cost-ladder trigger signal**: the tiered
ladder — **soft alert** ($50/day + $200/week) → **throttle non-critical** ($75) → **hard kill** ($100), per-deployment
tunable. C7 **detects each breach, fires the alert, and emits the breach signal**. Per **ADR-003**, the cost ladder is
a **guardrail class (sibling to the rate-limit ladder), owned by C6**: the **enforcement mechanism** (pausing
non-critical task admission / hard-killing a run) is a **C6 guardrail action executed by the C5 harness** — the same
decide/execute split as approval gates (OD-068 → (a)). A hard-kill is logged to `guardrail_log` (a `rate_limit`-class
event) and alerts immediately.
- **AC-7.COST.003.1** — The three ladder thresholds are per-deployment configurable.
- **AC-7.COST.003.2** — Crossing the soft threshold fires the cost-threshold alert (COST.004); crossing throttle/kill
  thresholds **emits a breach signal to the C6 cost-ladder guardrail** (C7 does not itself throttle or kill the run).
- **AC-7.COST.003.3** — The decide/execute seam is **bilaterally specified**: C7 emits the signal here, and the
  enforcement is owned by a **C6 cost-ladder guardrail FR** (ADR-003) executed by C5. **Carry-forward
  (change-control):** ADR-003 spawned this C6 FR but C6 (session 23) did not write it, and C5's seam line previously
  read "C7 enforces" (now corrected) — the owed **C6 cost-ladder enforcement FR** is tracked in the session log and
  OD-068's resolution; C7 does not over-reach to fill it.

#### FR-7.COST.004 — Cost-threshold-breach alert
**Status:** Approved · **Cites:** L3308–3309
A daily/weekly spend over its configured threshold raises a **cost threshold breach** alert to the notification centre
(the soft tier of the ladder).
- **AC-7.COST.004.1** — Exceeding the daily or weekly cost threshold raises a dashboard notification.

### MGM — Management-plane / cross-deployment

#### FR-7.MGM.001 — The outbound health-reporter push (operational-metadata-only)
**Status:** Approved · **Cites:** ADR-001 §7; reconciliation #2
Each client deployment runs a per-deployment **outbound "health reporter" job** that **posts operational-metadata-only
snapshots** to the operator's management plane — health score, queue depth, alert counts, core version, and similar
operational signals. **No client business data** (memories, entity content, message text, sensitive data) crosses the
boundary; the model is **push, not pull**.
- **AC-7.MGM.001.1** — The snapshot payload contains only the allow-listed operational-metadata fields; any business-
  data field is rejected before send (the ADR-001 boundary is enforced at the reporter, #2).
- **AC-7.MGM.001.2** — The management plane never initiates a pull of client data; it only receives pushed snapshots.
- **AC-7.MGM.001.3** — The reporter job logs each push **attempt and failure** to the deployment's **local**
  `event_log`, so a deployment that cannot reach the management plane surfaces the condition on **its own** operations
  dashboard — not only (invisibly) by absence on the Super Admin grid.

#### FR-7.MGM.002 — Push staleness → stale, not silently green
**Status:** Approved · **Cites:** OD-071; reconciliation #2; non-negotiable #3
Every deployment card carries the snapshot's **freshness timestamp**; a snapshot older than a configurable staleness
window flips the card to **`stale` / `unreachable`** and raises a cross-deployment alert — absence of signal is itself
treated as a signal, never shown as a healthy green card.
- **AC-7.MGM.002.1** — A deployment that stops pushing flips to `stale`/`unreachable` within the staleness window.
- **AC-7.MGM.002.2** — A stale deployment raises a cross-deployment alert; it is not rendered as healthy.
- **AC-7.MGM.002.3** — The staleness evaluation runs on an **independent heartbeat**, not a one-shot poll the
  receiver could itself miss; a **stalled evaluator is itself a surfaced condition** (the stale-detector cannot fail
  silently — the meta-#3 this FR exists to prevent). ⚠️ FEASIBILITY: **AF-118**.
- **AC-7.MGM.002.4** — The staleness window is computed against a **single server-authoritative timestamp**, never a
  reporter-asserted clock — a fast reporter clock cannot make a dead deployment's snapshot look fresh (#3). ⚠️
  FEASIBILITY: **AF-120**.

#### FR-7.MGM.003 — Deployment health grid
**Status:** Approved · **Cites:** L3188–3191; reconciliation #2
The Super Admin view shows a **deployment health grid** — every active client deployment as a card with health score,
last active, open alerts, approval queue depth, and core version, keyed on the management-plane `client_registry`.
**Clicking a card navigates into that deployment's own operations dashboard** (it does not mirror business data into
the management plane).
- **AC-7.MGM.003.1** — The grid renders one card per active deployment from pushed snapshots (no business-data pull).
- **AC-7.MGM.003.2** — Card click-through navigates into the client deployment, not a management-plane copy of its
  data.

#### FR-7.MGM.004 — Cross-deployment alerts + CI/CD status
**Status:** Approved · **Cites:** L3193–3199
The Super Admin view surfaces **any critical alert across any deployment immediately**, and shows **CI/CD status** —
which core version each deployment runs, which deployments failed the last push, and plugin versions per deployment
(consistent with ADR-005 release-train / ADR-001 auto-deploy-on-push).
- **AC-7.MGM.004.1** — A critical alert in any deployment appears in the cross-deployment alert surface.
- **AC-7.MGM.004.2** — The CI/CD panel shows per-deployment core version and last-push status.

#### FR-7.MGM.005 — Backup-health + cross-deployment cost overview on the push
**Status:** Approved · **Cites:** ADR-008; L3201–3202
Backup-health is part of the management-plane push: the operator monitors each deployment's backup status **remotely
via the Supabase Management API** (`GET /v1/projects/{ref}/database/backups`) **without touching business data**
(ADR-008). The Super Admin view also shows a **cross-deployment cost overview** — estimated token costs across all
deployments with trend lines (estimate-grade per COST.001).
- **AC-7.MGM.005.1** — Backup-health for each deployment is visible in the Super Admin view, sourced from the
  Management API (no business data crosses).
- **AC-7.MGM.005.2** — The cost overview aggregates per-deployment estimated cost with trend, labelled as estimates.

### VIEW — Dashboard surface contracts (full layout/state → Phase 3)

#### FR-7.VIEW.001 — The operations dashboard is the per-deployment source of truth
**Status:** Approved · **Cites:** L3207–3238, L3039
A per-deployment **operations dashboard** exists as the primary technical interface and source of truth (Slack
supplementary). It surfaces the **system-health panel** (loop status, queue depth + trend, success rate vs threshold,
connector status, agent health), the **failure-health view** (live failure feed by category, silent-failure
indicators, threshold tracker with pre-breach trend lines), the **memory-health view** (erosion-risk panel, confidence
distribution, coverage by entity, maintenance queue), the **event log / dead-letter queue / cost tracking / guardrail
log** views, and the **self-improvement panel**. **Each panel's signals are produced by their home component**
(C2/C3/C5/C6/C8/C9); C7 guarantees the panel exists and is fed. **Full layout and all visual states → Phase 3.**
- **AC-7.VIEW.001.1** — Each named panel has a defined data source mapping to a producing component's FR (no panel
  sources a signal C7 invents).
- **AC-7.VIEW.001.2** — Silent-failure indicators in the failure-health view are driven by the LOG.003 completeness
  gaps (a task with no terminal event).
- **AC-7.VIEW.001.3** — The self-improvement panel displays C9 Insight-Agent suggestions and tracks acted/improvement
  history; C7 does not generate the suggestions.

#### FR-7.VIEW.002 — Role-scoped, RBAC-gated dashboards + the answer-mode pill
**Status:** Approved · **Cites:** L3242–3284, L1755–1772 (C4); consumes C1
The five role surfaces exist and are **RBAC-gated** — Super Admin (cross-deployment), Operations (Admin), Manager
(non-technical), Standard User, Mobile — each surfacing **only the signals its role may see** (C1 is the authority).
The **answer-mode pill** (Cited / Inferred / Unknown, from C4 FR-4.CID.006) is rendered on **every AI-output item** in
the activity feeds and chat. The *thresholding* of "a high proportion of Inferred/Unknown on an entity → a
thin-coverage signal" is **seamed to C2** (the memory-coverage owner, FR-2.MNT.*); C7 renders the pill and forwards
the per-entity pill mix, it does not define the coverage threshold. **Full surface specification (layout, every
state, mobile interaction design) → Phase 3.**
- **AC-7.VIEW.002.1** — A role sees only the panels/signals its C1 permissions allow; an unpermitted signal is not
  rendered to it.
- **AC-7.VIEW.002.2** — Every AI-output item in an activity feed/chat carries its answer-mode pill (C4-sourced).

#### FR-7.VIEW.003 — Mobile push-notification routing
**Status:** Approved · **Cites:** L3277–3281
The mobile surface delivers push notifications by class: **critical alerts immediate**, **hard-limit hits immediate
and always**, **pending approvals at a configurable frequency**, **stale approval queue configurable**. (The mobile
interaction design itself → Phase 3; the notification *routing contract* is C7.)
- **AC-7.VIEW.003.1** — A hard-limit-hit push is immediate and not suppressible (pairs with ALR.002.2).
- **AC-7.VIEW.003.2** — Pending-approval and stale-approval push frequencies are configurable per deployment/user.

### OPT — Observability optimisations

#### FR-7.OPT.001 — The feedback-flywheel signal substrate
**Status:** Approved · **Cites:** L3323
Every approval, rejection, memory flag, and task failure is **captured as a reviewable signal** (via `event_log`,
`guardrail_log`, the memory-flag records, and the self-improvement panel) and **surfaced for human review** — the data
substrate that lets the system compound in quality. *(The weekly-review **discipline** itself is a human process, not
a software requirement; C7's obligation is that the signals are captured and surfaced, never lost.)*
- **AC-7.OPT.001.1** — Each of the four signal classes (approval / rejection / memory flag / task failure) is durably
  recorded and retrievable for review.

#### FR-7.OPT.002 — Deployment benchmarking (v1 substrate; cross-deployment comparison → v2)
**Status:** Approved · **Cites:** L3325; OOS-029
v1 captures the per-deployment substrate (cost-per-task-type COST.002, outcome/health signals) that **deployment
benchmarking** would compare. **Cross-deployment outcome comparison ("which configurations produce better outcomes")
is deferred to v2** (OOS-029) — it requires aggregating across silos and a maturity of data the launch scale doesn't
yet have; v1 does not silently imply it exists.
- **AC-7.OPT.002.1** — The per-deployment benchmarkable signals (cost-per-task-type, outcome/health) are captured in
  v1.
- **AC-7.OPT.002.2** — No v1 surface claims cross-deployment benchmarking is live (it is logged OOS-029).

---

## Traceability

**33 rows** (LOG ×7 · RTP ×4 · ALR ×8 · COST ×4 · MGM ×5 · VIEW ×3 · OPT ×2) wired into `traceability-matrix.csv`;
`system-map/07-observability.md` built.
