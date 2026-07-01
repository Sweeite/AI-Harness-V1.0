# NFR — Observability  (`NFR-OBS`)  ·  Accessibility baseline  (`NFR-A11Y`)

> **Context manifest.** Depends on: the non-negotiable **#3 (never fail silently)** from `CLAUDE.md`
> and `what-makes-it-great.md`; and the enforcement FRs in C7 (observability — LOG/ALR/MGM/RTP/COST/VIEW)
> · C6 (guardrail-hit logging) · C8 (agent-health producers) · C9 (proactive-intelligence producers)
> · C5 (queue/DLQ escalation) · C4 (answer-mode citation). **Reference-don't-re-spec:** each `NFR-OBS`
> row names the FR/AC that *implements* it and adds only the non-functional overlay — the posture, the
> threshold (a config key + default), the cross-component duty, or the verification method. The logging
> and alerting code is specified in those components; this file states the property that must hold and
> how it is proven.
>
> **Upholds overwhelmingly #3 (never fail silently)** — this domain is the *home* of #3. A handful of
> rows also uphold **#1 (never lose knowledge)** where the audit trail is a knowledge-durability layer
> (the append-only event log, guardrail-hit logging independent of delivery). The organising principle
> of #3 across all sixteen rows: **absence of a signal is itself a signal** — a task that stops emitting,
> a producer that goes quiet, a sink that can't be written, an alert that can't be routed, a stale read
> — each must become *loud and visible*, never a silent green.
>
> **Launch-gate rule (RP-1, session 45).** The observability *mechanisms* — the silent-failure detector,
> the alert-engine watchdog, escalate-don't-abandon, the out-of-band log path — are the #3 keystones that
> must be **in place at launch** (a #3 breach is un-detectable by definition once it ships, so it cannot
> be a fast-follow). These are marked **blocking**. The build-time *proofs* of those mechanisms — **AF-118**
> (absence-of-signal liveness), **AF-119** (out-of-band durability), **AF-120** (clock-sync / escalation) —
> gate the mechanism they verify; the mechanism is blocking, the AF is its build-time proof. **AF-124**
> (dead-agent detection *accuracy*) is fast-follow — the flag-only posture already de-risks it. None of
> the six globally-blocking spikes lives in this domain, but the #3 mechanisms themselves are
> non-negotiable-at-launch.

### The NFR row shape (per the `security.md` exemplar)

```
### NFR-<domain>.<nnn> — <short title>
- **Requirement:** The system shall <non-functional property / posture / threshold>.
- **Type:** posture | threshold | duty | verification
- **Upholds:** #1 | #2 | #3 | quality  (which non-negotiable, + one-line why)
- **Implemented by:** FR-*/AC-*/ADR-*  (the functional owner — reference, don't re-spec)
- **Target / threshold:** <number + config key, or N/A for a binary posture>
- **Verification:** DOCS | SPIKE | EVAL | LOAD | <test layer>  → AF-* gate (if paper-not-proven)
- **Launch gate:** blocking | fast-follow  (per RP-1, session 45)
- **Acceptance criteria:** AC-NFR-<id>.n — Given/When/Then (checkable).
- **Notes / OD:** <optional>
```

---

### NFR-OBS.001 — The silent-failure detector (terminal task ⋈ no terminal event)

- **Requirement:** The system shall guarantee that **every task emits exactly one terminal `event_log` event**, and shall treat a terminal `task_queue` status **with no matching terminal event** as a **detectable gap** surfaced in Failure Health — not merely a dashboard nicety but the load-bearing #3 mechanism. A task that stops emitting is the canonical silent failure; its *absence* is the signal.
- **Type:** duty (the #3 keystone).
- **Upholds:** #3 (a task cannot terminate invisibly; the gap between the two sinks is what makes silent failure *detectable*).
- **Implemented by:** FR-7.LOG.003 · AC-7.LOG.003.1 (exactly one terminal event per `task_id`).
- **Target / threshold:** binary — for every `task_id`, `count(terminal event_log rows) = 1`; a terminal queue status with zero terminal events raises a Failure-Health finding.
- **Verification:** **SPIKE — absence-of-signal liveness** (AF-118): drive tasks to abrupt termination and confirm the missing-terminal-event gap is detected and surfaced; + build-time invariant test.
- **Launch gate:** **blocking** — this is the #3 detector itself; it must exist before go-live.
- **Acceptance criteria:**
  - AC-NFR-OBS.001.1 — Given any `task_id`, When its lifecycle completes, Then the `event_log` contains exactly one terminal event for it.
  - AC-NFR-OBS.001.2 — Given a task that reaches a terminal `task_queue` status with **no** terminal `event_log` event, When Failure Health evaluates, Then the discrepancy is flagged as a detectable gap (AF-118), not silently ignored.
- **Notes / OD:** the single most important #3 row — everything else in this file is a variation on "make the absence loud."

### NFR-OBS.002 — Event-log write-failure out-of-band path

- **Requirement:** The system shall never let an `event_log` write-failure proceed silently: a failed log write shall be surfaced **out of band** via a local **stderr/file** degraded path **plus** a `log-write-failing` health bit carried on the management-plane push — so the failure is visible **even when the silo DB is unreachable** (the sink you'd normally report through is the one that's down).
- **Type:** duty.
- **Upholds:** #3 (the logging layer's *own* failure cannot be swallowed) + #1 (a lost audit write is detected, not silently dropped).
- **Implemented by:** AC-7.LOG.003.2 (out-of-band degraded path + `log-write-failing` health bit on the push).
- **Target / threshold:** binary — a log-write failure sets the `log-write-failing` bit on the next mgmt-plane push and writes the local stderr/file record.
- **Verification:** **SPIKE — out-of-band durability** (AF-119): induce an `event_log` write-failure (DB unreachable) and confirm the stderr/file record + the health bit both surface.
- **Launch gate:** **blocking** — the out-of-band path is a #3 keystone (without it, a down log sink is invisible).
- **Acceptance criteria:**
  - AC-NFR-OBS.002.1 — Given an `event_log` write that fails, When it fails, Then the event is recorded to the local stderr/file degraded sink and does not silently proceed.
  - AC-NFR-OBS.002.2 — Given a silo whose DB is unreachable, When the mgmt-plane push runs, Then it carries the `log-write-failing` health bit so the Super Admin sees the failure without needing the (down) silo (AF-119).
- **Notes / OD:** the health bit is the "reach the operator through a *different* channel" half of the pattern.

### NFR-OBS.003 — Cross-sink reconciliation (the two sinks cannot silently diverge)

- **Requirement:** The system shall run a **periodic cross-sink reconciliation** between `guardrail_log` and `event_log` — a `guardrail_log` row with no `event_log` counterpart (and vice-versa) shall be **flagged**, so the two audit sinks cannot silently drift apart.
- **Type:** duty.
- **Upholds:** #3 (divergence between the two histories is surfaced, not left to be discovered by accident) + #1 (neither sink silently loses rows the other has).
- **Implemented by:** AC-7.LOG.003.3 (periodic reconciliation flags divergence).
- **Target / threshold:** N/A (periodic reconciliation duty).
- **Verification:** build-time test (inject a one-sided row → reconciliation flags it).
- **Launch gate:** fast-follow (a completeness enhancement on top of the OBS.001 detector; the per-task terminal-event invariant is the launch-blocking core).
- **Acceptance criteria:**
  - AC-NFR-OBS.003.1 — Given a `guardrail_log` row with no corresponding `event_log` entry (or the reverse), When reconciliation runs, Then the divergence is flagged for review.
- **Notes / OD:** —

### NFR-OBS.004 — The alert-engine watchdog (the watcher is watched)

- **Requirement:** The system shall have the **alert-evaluation engine emit a heartbeat**, and an **independent watchdog** shall raise a **critical alert if the engine stalls** — because the worst possible #3 failure is the *observability layer itself* failing silently (if the alert engine dies, every other alert rule goes quiet and nothing notices).
- **Type:** duty (the #3 keystone for the observability layer's own liveness).
- **Upholds:** #3 (the layer that detects everything else's silence cannot itself be allowed to fail in silence).
- **Implemented by:** FR-7.ALR.008 · AC-7.ALR.008.1 (heartbeat + independent watchdog) · AC-7.ALR.008.2 (stall → critical alert). Reuses the C5 loop/DLQ heartbeat pattern (AC-5.JOB.006.2).
- **Target / threshold:** binary — a missed engine heartbeat, detected by a **separate** watchdog (not by the engine itself), raises a critical alert.
- **Verification:** **SPIKE — absence-of-signal liveness** (AF-118, shared with OBS.001): stall the alert engine and confirm the independent watchdog fires.
- **Launch gate:** **blocking** — a self-blind alert engine is an un-detectable #3 hole.
- **Acceptance criteria:**
  - AC-NFR-OBS.004.1 — Given the running alert-evaluation engine, When it emits heartbeats, Then an independent watchdog (a distinct process, not the engine) observes them.
  - AC-NFR-OBS.004.2 — Given the alert engine stalls, When its heartbeat is missed, Then the watchdog raises a **critical** alert (and the mgmt-plane surfaces the mis-configured/stalled silo), so the failure is not silent (AF-118).
- **Notes / OD:** "the watcher is watched" — the defining #3 row for the observability layer's own integrity.

### NFR-OBS.005 — Metric-producer liveness (stale, never green)

- **Requirement:** The system shall have each metric producer — agent-health, drift, dead-agent, and risk-scan scanners — **emit a liveness heartbeat**, and a **stalled producer shall read "stale", never green**. A health surface that shows green because *no data arrived* is a #3 lie; absence of a producer's signal must read as unknown/stale.
- **Type:** duty.
- **Upholds:** #3 (a dead producer never masquerades as a healthy one; "no news" is not "good news").
- **Implemented by:** AC-8.HLTH.004.2 · AC-9.PRO.004.3 (producer heartbeats; stalled → stale, not green).
- **Target / threshold:** binary — a producer whose heartbeat is overdue renders as **stale/unknown**, not as a green/healthy value.
- **Verification:** build-time test (stall a producer → its panel reads stale, not green); dead-agent detection *accuracy* is AF-124 (fast-follow).
- **Launch gate:** blocking (the stale-not-green rendering is a #3 mechanism); AF-124 detection-accuracy is fast-follow.
- **Acceptance criteria:**
  - AC-NFR-OBS.005.1 — Given a metric producer (agent-health / drift / dead-agent / risk-scan), When its heartbeat goes overdue, Then its panel reads "stale"/"unknown", never a green or healthy value.
- **Notes / OD:** pairs with the never-false-healthy surface duty (OBS.011) — same "no signal ≠ all clear" principle, applied to producers instead of surfaces.

### NFR-OBS.006 — Management-plane staleness (absence of signal is signal)

- **Requirement:** The system shall carry a **freshness timestamp on every management-plane card**, and a snapshot older than **`deployment_staleness_window` (15 min)** shall flip to **stale/unreachable + alert** — evaluated on **server-authoritative time** (so a fast-reporting silo's clock skew cannot mask staleness), on an **independent heartbeat** evaluator (the stale-detector cannot itself fail carry-forward), and shall distinguish **frozen ≠ dead** (a silo in retention-freeze is intentionally quiet, not silently failed).
- **Type:** threshold + duty.
- **Upholds:** #3 (a silo that stops reporting must read stale, not carry-forward a last-known-green).
- **Implemented by:** FR-7.MGM.002 · AC-7.MGM.002.3 (independent-heartbeat staleness evaluator) · AC-10.OFF.004.4 (frozen ≠ dead).
- **Target / threshold:** `deployment_staleness_window = 15 min` (config-registry, LIVE; duration ≥ push interval).
- **Verification:** **SPIKE — clock-sync / staleness** (AF-120) + absence-of-signal liveness (AF-118): confirm a silent silo flips to stale on server-authoritative time and that frozen silos are not mis-flagged dead.
- **Launch gate:** blocking (the stale-not-green mgmt-plane rendering is a #3 mechanism; AF-118/120 are its build-time proofs).
- **Acceptance criteria:**
  - AC-NFR-OBS.006.1 — Given a deployment whose last push is older than 15 min, When the Super Admin grid renders, Then that card reads stale/unreachable and an alert is raised — not a carried-forward green.
  - AC-NFR-OBS.006.2 — Given staleness evaluation, When it runs, Then it uses server-authoritative time on an independent heartbeat (a fast-reporter's clock skew cannot suppress it) (AF-120).
  - AC-NFR-OBS.006.3 — Given a silo in retention-freeze (`client_registry.status=frozen`), When it stops reporting, Then it reads frozen (intentionally quiet), not dead/failed (AC-10.OFF.004.4).
- **Notes / OD:** "absence of signal is itself a signal" — the mgmt-plane expression of the OBS.001 principle.

### NFR-OBS.007 — Escalate-don't-abandon (the universal wait-point pattern)

- **Requirement:** The system shall apply a **single escalate-don't-abandon pattern to every wait-point** — an un-actioned ingestion beyond `review_escalation_days`, an approval past its timeout, a dead-lettered task past `dlq_stale_alert_hours`, an unacked alert past `alert_escalation_window_hours`, a pending clarification, a halt, a stuck suggestion — each shall **escalate + persist**, and shall **never be auto-cleared, auto-approved, or silently parked**. A thing that is waiting must never be forgotten.
- **Type:** duty (the #3 keystone for wait-points).
- **Upholds:** #3 (nothing waits forever in silence; every stalled item eventually gets loud) + #1 (waiting work is persisted, never dropped).
- **Implemented by:** FR-6.ESC.004 · FR-7.ALR.005 · FR-5.QUE.005 · FR-8.ORC.006 · FR-9.SUG.001.
- **Target / threshold:** `review_escalation_days = 7` · `dlq_stale_alert_hours = 24` · `alert_escalation_window_hours = 2` (all config-registry, LIVE); approval/clarification/halt use their own timeouts.
- **Verification:** **SPIKE — clock-sync / escalation** (AF-120): confirm each wait-point escalates on its timer and none silently auto-resolves; + per-owner build-time tests.
- **Launch gate:** **blocking** — escalate-don't-abandon is a #3 keystone; a silently-parked wait-point is an un-detectable stall.
- **Acceptance criteria:**
  - AC-NFR-OBS.007.1 — Given any wait-point (ingestion / approval / DLQ / alert / clarification / halt / suggestion), When its threshold elapses, Then it escalates and persists — it is never auto-cleared, auto-approved, or silently dropped.
  - AC-NFR-OBS.007.2 — Given the four timed wait-points, When they are configured, Then they honour `review_escalation_days` (7), `dlq_stale_alert_hours` (24), and `alert_escalation_window_hours` (2) respectively (AF-120).
- **Notes / OD:** one pattern, five functional owners across C5/C6/C7/C8/C9 — this row is what makes it a *uniform* invariant rather than five separate behaviours.

### NFR-OBS.008 — Unroutable-alert-fails-loud (+ quiet-hours never silence critical)

- **Requirement:** The system shall make an **unroutable alert fail loud** — a routing target that cannot be resolved shall trigger an escalation + an **"alert delivery misconfigured" critical**, never a silent drop — and **quiet-hours shall never silence a hard-limit or critical alert**. The one thing an alerting system may never do is fail to deliver *quietly*.
- **Type:** posture + duty.
- **Upholds:** #3 (an alert that can't find its recipient becomes a louder alert, not a swallowed one).
- **Implemented by:** FR-7.ALR.009 (unroutable fails loud) · FR-7.ALR.003 (routing-by-type) · OD-097 (quiet-hours never silences critical).
- **Target / threshold:** binary — unresolved routing target → escalation + critical; quiet-hours suppression excludes hard-limit/critical classes.
- **Verification:** build-time test (mis-configure a route → "alert delivery misconfigured" critical fires; a critical alert during quiet-hours is delivered).
- **Launch gate:** blocking (a silently-dropped critical is a #3 breach at launch).
- **Acceptance criteria:**
  - AC-NFR-OBS.008.1 — Given an alert whose routing target cannot be resolved, When it fires, Then an "alert delivery misconfigured" critical is raised and escalated — never silently dropped.
  - AC-NFR-OBS.008.2 — Given quiet-hours are configured, When a hard-limit or critical alert fires within them, Then it is still delivered (OD-097).
- **Notes / OD:** OD-097 is the locked decision that quiet-hours may throttle noise but never silence #2/#3-class alerts.

### NFR-OBS.009 — Alert delivery invariant (dashboard-persisted-first, Slack best-effort)

- **Requirement:** The system shall **persist the dashboard notification first and independently**, and treat **Slack (and any fan-out channel) as best-effort** off that persisted row — a Slack delivery failure shall **never lose the notification** and shall **itself be surfaced**. The durable record is the source of truth; the fan-out is a convenience layer.
- **Type:** posture + duty.
- **Upholds:** #3 (a channel outage cannot make an alert disappear; the miss is itself visible) + #1 (the notification is durably persisted before any best-effort delivery).
- **Implemented by:** FR-7.ALR.006 (delivery durability — dashboard independent of Slack).
- **Target / threshold:** binary — dashboard row committed before Slack fan-out; Slack failure logged + surfaced, notification retained.
- **Verification:** build-time test (fail the Slack send → the dashboard notification still exists and the send-failure is surfaced).
- **Launch gate:** blocking.
- **Acceptance criteria:**
  - AC-NFR-OBS.009.1 — Given an alert, When it is raised, Then the dashboard notification is persisted first and independently of any Slack/fan-out attempt.
  - AC-NFR-OBS.009.2 — Given a Slack fan-out that fails, When it fails, Then the persisted notification is retained and the delivery failure is itself surfaced — not silently lost.
- **Notes / OD:** the ordering (persist → fan-out) is the invariant; the fan-out is never load-bearing for durability.

### NFR-OBS.010 — Append-only event log (plain-English, retention-pruning-logged)

- **Requirement:** The system shall maintain the `event_log` as a **unified, append-only, plain-English timeline** — every row's `summary` stating **what happened and why** — with **no UPDATE/DELETE except retention pruning**, and that pruning shall itself be **logged** and **never remove a row still referenced by an open item**.
- **Type:** duty.
- **Upholds:** #1 (the audit history is a durable knowledge layer; nothing is silently rewritten) + #3 (even the act of pruning is visible).
- **Implemented by:** FR-7.LOG.001 (append-only unified timeline) · FR-7.LOG.002 (log intent, not just action) · FR-7.LOG.006 (retention + redaction-tombstone pruning).
- **Target / threshold:** append-only; pruning honours `event_log_retention_window` (365 d, config-registry) and skips rows referenced by open items; every prune logged.
- **Verification:** DB append-only enforcement (the Phase-4 immutability trigger) + build-time test (a prune of a referenced row is refused; a prune writes its own log entry).
- **Launch gate:** blocking (append-only integrity is a #1/#3 foundation).
- **Acceptance criteria:**
  - AC-NFR-OBS.010.1 — Given any `event_log` row, When written, Then its `summary` states what happened and why, and the row is thereafter never UPDATEd/DELETEd except by retention pruning.
  - AC-NFR-OBS.010.2 — Given retention pruning, When it runs, Then it is logged and does not remove any row still referenced by an open item.
- **Notes / OD:** the tamper-evident immutability trigger (fired regardless of role) is specified in `compliance.md` (CMP-f) and the Phase-4 `schema.md`.

### NFR-OBS.011 — Never-false-healthy (the surface perceivability duty)

- **Requirement:** The system shall make every error/stale state on every surface read **"—" / "mode unknown" / "can't confirm"**, and **never** "0" / "$0" / "✓" / "all clear" / "Live". The connection indicator shall be honestly one of **Live / Polling / Reconnecting**, and after an offline period the surface shall **re-fetch before re-enabling actions** — a user must never act on a stale-but-green screen.
- **Type:** posture + duty (the surface expression of #3).
- **Upholds:** #3 (a stale or errored surface never presents itself as healthy; the human perceives the *true* state).
- **Implemented by:** FR-7.RTP.004 (subscription lifecycle / reconnect — honest indicator + re-fetch-before-re-enable) · AC-7.VIEW.002.2.
- **Target / threshold:** binary — no error/stale path renders a healthy-looking placeholder; connection state is truthfully labelled.
- **Verification:** build-time test (force stale/offline → surface reads "—" + honest indicator, actions re-enabled only after a successful re-fetch).
- **Launch gate:** blocking (a false-green surface is a #3 breach at the human boundary).
- **Acceptance criteria:**
  - AC-NFR-OBS.011.1 — Given a surface whose data is stale or errored, When it renders, Then it reads "—"/"can't confirm", never "0"/"✓"/"all clear"/"Live".
  - AC-NFR-OBS.011.2 — Given a surface returning from offline, When the connection is restored, Then it re-fetches before re-enabling actions, and the indicator honestly reads Live/Polling/Reconnecting throughout.
- **Notes / OD:** this is the row the A11Y baseline (below) is co-located with — same "the human can perceive the true state" family.

### NFR-OBS.012 — Answer-mode pill everywhere (unresolved reads "mode unknown")

- **Requirement:** The system shall attach an **answer-mode pill — Cited / Inferred / Unknown — to every AI output** on every surface, and an **unresolved mode shall read "mode unknown", never silently "Cited"**. A confident-looking answer whose provenance is unknown is a #3 failure — the uncertainty must be visible.
- **Type:** duty.
- **Upholds:** #3 (the trust level of every AI answer is surfaced; an un-established provenance is never up-rendered to "Cited").
- **Implemented by:** FR-4.CID.006 (answer-mode classification) · AC-7.VIEW.002.2 (every AI-output item carries its pill).
- **Target / threshold:** binary — every AI-output item carries a pill; unresolved → "mode unknown".
- **Verification:** build-time test (an output with unresolved provenance renders "mode unknown", not "Cited").
- **Launch gate:** blocking.
- **Acceptance criteria:**
  - AC-NFR-OBS.012.1 — Given any AI output in a feed/chat, When rendered, Then it carries a Cited/Inferred/Unknown pill.
  - AC-NFR-OBS.012.2 — Given an AI output whose mode cannot be resolved, When rendered, Then the pill reads "mode unknown" — never a defaulted "Cited".
- **Notes / OD:** pairs with never-false-healthy (OBS.011) — both are "don't dress uncertainty as certainty."

### NFR-OBS.013 — Cost-meter honesty (`cost_unknown` ≠ $0)

- **Requirement:** The system shall record a per-event cost estimate (rounded up, estimate-grade), and shall use a distinct **`cost_unknown` sentinel** for an event whose cost **could not be computed** — **never a silent $0**. A blind meter must be *detectable*, not averaged into the total as though it were free.
- **Type:** duty.
- **Upholds:** #3 (an un-metered event is visibly unknown, not silently costless — the cost blind-spot is surfaced).
- **Implemented by:** FR-7.LOG.004 (per-event duration + cost capture) · AC-7.LOG.004.1 (`cost_unknown` sentinel, distinct from a genuine 0) · FR-7.COST.001 (estimate-grade accounting).
- **Target / threshold:** binary — genuine costless event records `0`; un-computable cost records `cost_unknown`; never conflated.
- **Verification:** build-time test (force an un-computable cost → `cost_unknown` recorded, not 0) + estimate-grade validation (AF-042).
- **Launch gate:** fast-follow (the sentinel is a completeness enhancement; the cost-ladder *enforcement* that protects viability lives in `cost.md`).
- **Acceptance criteria:**
  - AC-NFR-OBS.013.1 — Given an event whose cost cannot be computed, When its row is written, Then it records `cost_unknown`, distinct from a genuine `0`.
- **Notes / OD:** AF-042 is the estimate-grade feasibility gate; the full cost model is `cost.md` (COST domain).

### NFR-OBS.014 — Realtime cap (exactly two Realtime surfaces)

- **Requirement:** The system shall run **exactly two** Realtime (push-subscription) surfaces — the **approval queue** and the **notification centre** — and **everything else shall poll** at defined, per-deployment-configurable cadences. The Realtime budget is deliberately bounded; extra live subscriptions are not silently added.
- **Type:** posture.
- **Upholds:** #3 (the live-vs-polled contract is explicit and bounded; a surface's freshness model is knowable, not accidental).
- **Implemented by:** FR-7.RTP.001 (hybrid real-time/polling contract) · FR-7.RTP.002 (per-surface polling cadences, configurable per deployment).
- **Target / threshold:** exactly 2 Realtime surfaces; all others polled at configured cadences (config-registry).
- **Verification:** DOCS (the two Realtime surfaces enumerated) + build-time test (no third surface opens a Realtime subscription).
- **Launch gate:** blocking (the connection-budget bound is foundational; see also PERF-k in `performance.md`).
- **Acceptance criteria:**
  - AC-NFR-OBS.014.1 — Given the running product, When surfaces subscribe, Then only the approval queue and the notification centre use Realtime; every other surface polls at its configured cadence.
- **Notes / OD:** the connection-headroom degradation (Realtime → polling at threshold) is the PERF-domain overlay (`performance.md` PERF-k).

### NFR-OBS.015 — Drift / dead-agent flag-never-auto-correct

- **Requirement:** The system shall **surface** agent drift and dead-agent conditions **for a human decision** and shall **never auto-disable or auto-fix** an agent on that signal. A detected anomaly is escalated to a person, never silently self-remediated (which would hide the fault).
- **Type:** posture.
- **Upholds:** #3 (an anomaly is made visible for human judgement, never silently corrected out of sight) + #2 (the system doesn't autonomously disable an agent).
- **Implemented by:** FR-8.HLTH.001 / FR-8.HLTH.002 / FR-8.HLTH.003 (drift / dead-agent detection) · OD-078 (flag-never-auto-correct posture).
- **Target / threshold:** binary — detection flags + escalates; no autonomous disable/fix path.
- **Verification:** build-time test (a drift/dead-agent detection raises a human-decision flag and never auto-disables) + dead-agent detection *accuracy* is AF-124 (fast-follow).
- **Launch gate:** fast-follow (flag-only posture — per RP-1, AF-124 detection-accuracy is fast-follow; the flag-only *behaviour* is low-risk because it never acts autonomously).
- **Acceptance criteria:**
  - AC-NFR-OBS.015.1 — Given a drift or dead-agent detection, When it fires, Then it is surfaced for a human decision and the agent is never auto-disabled or auto-corrected (OD-078).
- **Notes / OD:** the flag-only posture is *why* AF-124's accuracy can be fast-follow — a false flag costs a human glance, not an autonomous mis-action.

### NFR-OBS.016 — Every guardrail-hit + every alert logged, independent of delivery

- **Requirement:** The system shall write **every guardrail hit and every alert to an audit sink independent of delivery success** — the history survives even if the notification never reaches anyone. A failure to *deliver* an alert must never also mean a failure to *record* it.
- **Type:** duty.
- **Upholds:** #1 (the security/guardrail audit history is never lost, whatever happens downstream) + #3 (the record exists to be reconciled against delivery — a delivery gap is detectable).
- **Implemented by:** FR-6.INJ.005 (guardrail hit logged) · FR-7.ALR.004 (every alert logged in the event log).
- **Target / threshold:** binary — the log write happens on a path independent of, and prior to, the delivery attempt.
- **Verification:** build-time test (fail delivery → the guardrail_log/event_log row still exists).
- **Launch gate:** blocking (audit-history durability is a #1 foundation).
- **Acceptance criteria:**
  - AC-NFR-OBS.016.1 — Given a guardrail hit or an alert, When delivery fails, Then the audit-sink row is still written and retained (independent of delivery).
- **Notes / OD:** the write-first ordering here mirrors OBS.009's persist-first invariant — the durable record precedes the best-effort delivery.

---

## Accessibility baseline (`NFR-A11Y`)

> **Why here.** Accessibility is co-located with observability because it belongs to the same
> **"the human can perceive and operate the true state"** family as the never-false-healthy surface
> duty (OBS.011) and the honest-indicator / answer-mode-pill rows (OBS.011–012). Those rows ensure the
> *content* of a surface is honest; the a11y floor ensures the *human can actually perceive and act on
> it* — a colour-only status a colour-blind operator can't read, or a control a keyboard user can't
> reach, is a perceivability failure of the same shape as a false-green. RP-3 (session 45,
> operator-decided): a **baseline floor only** for v1; full WCAG conformance is deferred.

### NFR-A11Y.001 — Accessibility baseline floor (the 14 surfaces)

- **Requirement:** The system shall ensure the **14 surfaces** are **keyboard-navigable**, meet **sufficient colour-contrast**, use **semantic markup**, and carry **labelled action controls** — the baseline floor at which an operator can perceive and operate the true state without relying on colour alone or a mouse.
- **Type:** posture (baseline floor).
- **Upholds:** quality (the human can perceive + operate the true system state — the same family as never-false-healthy; status is never conveyed by colour alone).
- **Implemented by:** the 14 surface specs (surface-UX layer) — a11y is a cross-surface build-time property, not a single FR.
- **Target / threshold:** baseline — keyboard-nav + contrast + semantic markup + control labels on all 14 surfaces.
- **Verification:** **build-time a11y lint/audit** against the baseline (axe-class ruleset gating the baseline criteria).
- **Launch gate:** fast-follow (baseline floor; the honest-*content* duties it complements — OBS.011/012 — are the launch-blocking half).
- **Acceptance criteria:**
  - AC-NFR-A11Y.001.1 — Given each of the 14 surfaces, When the build-time a11y audit runs, Then it is keyboard-navigable, passes the contrast baseline, uses semantic markup, and every action control is labelled.
  - AC-NFR-A11Y.001.2 — Given any status indicator, When rendered, Then its state is not conveyed by colour alone (a text/shape cue accompanies it — reinforcing OBS.011).
- **Notes / OD:** RP-3 baseline; the richer conformance audit is deferred (A11Y.002).

### NFR-A11Y.002 — Full WCAG 2.1 AA conformance deferred to v2 (OOS)

- **Requirement:** The system shall defer a **full WCAG 2.1 AA conformance audit to v2**; v1 ships the baseline floor (A11Y.001) only. This deferral is logged as an out-of-scope item.
- **Type:** posture (scope boundary).
- **Upholds:** quality (states the honest limit of the v1 a11y claim — the baseline is a floor, not certified conformance).
- **Implemented by:** N/A (a deferral, not an implemented property).
- **Target / threshold:** N/A.
- **Verification:** DOCS — recorded as a new OOS item in `spec/00-foundations/out-of-scope.md`.
- **Launch gate:** N/A (deferred to v2).
- **Acceptance criteria:**
  - AC-NFR-A11Y.002.1 — Given the v1 a11y posture, When documented, Then full WCAG 2.1 AA conformance is stated as deferred to v2 and logged as an OOS item.
- **Notes / OD:** **Action for the main thread:** add this deferral to `spec/00-foundations/out-of-scope.md` as a new `OOS-NNN` (per RP-3). This file states the deferral; the OOS register records it.

---

## Cross-references

- **Cost-ladder enforcement** (soft-alert → throttle → hard-kill) is the COST domain — see `cost.md`;
  this file covers only cost-meter *honesty* (OBS.013).
- **Realtime connection-headroom degradation** (Realtime → polling at threshold) is the PERF domain —
  see `performance.md` PERF-k; this file covers only the two-surface Realtime *cap* (OBS.014).
- **Audit-sink immutability / tamper-evidence** (the Phase-4 append-only trigger fired regardless of
  role) is the CMP domain — see `compliance.md` CMP-f; this file covers the append-only *timeline*
  duty (OBS.010).
- **Security-event loudness** (every guardrail/security event is loud) overlaps SEC — see `security.md`;
  OBS.016 is the #1/#3 audit-durability view of the same seam.

---

*Drafted session 45 (2026-07-01). Cites verified inline against `component-07-observability.md`
(FR-7.LOG/ALR/MGM/RTP/COST/VIEW families incl. FR-7.ALR.008 watchdog, AC-7.LOG.003.1/.2/.3, AC-7.LOG.004.1
`cost_unknown` sentinel, `log-write-failing` health bit), `component-06-guardrails.md` (FR-6.ESC.004,
FR-6.INJ.005), `component-08-agent-design.md` (FR-8.HLTH.001–003, FR-8.ORC.006, AC-8.HLTH.004.2),
`component-09-proactive-intelligence.md` (FR-9.SUG.001, AC-9.PRO.004.3), C5 (FR-5.QUE.005), C4
(FR-4.CID.006), C10 (AC-10.OFF.004.4), and `config-registry.md` (deployment_staleness_window=15min,
review_escalation_days=7, dlq_stale_alert_hours=24, alert_escalation_window_hours=2,
event_log_retention_window=365d). AF-118/119/120/124/042 confirmed in the feasibility register.
OD-078 (drift flag-not-autocorrect) and OD-097 (quiet-hours never silences critical) confirmed. RP-3
a11y baseline; A11Y.002 OOS action owed to the main thread.*
