# NFR — Cost & Economic Viability  (`NFR-COST`)

> **Context manifest.** Depends on: ADR-003 (cost model — the ladder, the estimate source, the
> memory-write shape, "controls before gates", the viability target, the Haiku trust window) ·
> ADR-001 (client-borne opex → the isolation boundary that forces estimate-not-invoice) · the
> enforcement/metering FRs in C7 (meter + ladder signal: FR-7.COST.001–003) · C6 (decides:
> FR-6.RTL.004) · C5 (executes the throttle/kill) · C8 (emits the per-route cost model:
> FR-8.COST.003) · C2 (the memory write-path routing + shadow-retain gate) · the config registry
> `cost_ladder_*` / `price_table` / `rate_limit_memory_writes_per_minute` keys · feasibility
> AF-001/040/041/042/043/035/002. **Reference-don't-re-spec:** each `NFR-COST` row names the
> FR/ADR that *implements* it and adds only the economic posture, the threshold the design implied,
> or the verification method (the `AF-*` that proves it).
>
> **Upholds primarily quality/viability** — a deployment must stay economically worth running — with
> **#3 alongside** (the cost ladder never silently overspends: a hard-kill is loud, and a blind meter
> reads a `cost_unknown` sentinel, never $0 — that honesty duty lives in `observability.md` / inventory
> row OBS-m; cross-ref, not duplicated here) and **#1** (shadow-retain never loses a would-drop memory).

---

### NFR-COST.001 — The four-rung cost ladder (operator-editable per client)

- **Requirement:** The system shall bound each deployment's spend with a **four-rung ladder** — soft alert `$50/day` (+ sustained `$200/week`) → **throttle** `$75/day` → **hard ceiling / kill** `$100/day` — modelled on the rate-limit ladder, with **every threshold operator-editable per client** to that client's spend tolerance; auto-actions are daily-anchored (the weekly soft alert is human-attention only, no weekly auto-throttle at v1).
- **Type:** threshold + posture.
- **Upholds:** quality/viability (a single deployment cannot burn unbounded client money) + #3 (each rung transition is loud, never silent).
- **Implemented by:** ADR-003 §2 · FR-7.COST.003 (meter + ladder signal) · FR-6.RTL.004 (decides) · config `cost_ladder_soft_threshold` (50/day, 200/wk) · `cost_ladder_throttle_threshold` (75/day) · `cost_ladder_hard_kill_threshold` (100/day).
- **Target / threshold:** 50 → 75 (1.5×) → 100 (2×) $/day; weekly soft 200; all per-deployment `LIVE`-editable. Daily ≠ weekly×7 is intentional (daily catches spikes, weekly catches ~$28/day sustained burn).
- **Verification:** DOCS (config keys + defaults confirmed against `config-registry.md`) + a build-time test that a synthetic spend series crosses each rung and fires the correct rung behaviour. The mechanism (meter/decide/execute + the thresholds) is a locked-ADR posture, **in place at launch**; the *realism of the defaults* is measured by AF-001/040/041 (fast-follow).
- **Launch gate:** the ladder **mechanism** is blocking-by-posture (locked ADR, present at launch); the threshold-realism spikes (AF-040/041) are fast-follow (they ship behind the fail-safe round-up + shadow-retain postures).
- **Acceptance criteria:**
  - AC-NFR-COST.001.1 — Given the deployed config, When the cost keys are inspected, Then the four rungs exist with the defaults 50/200/75/100 and every threshold is per-deployment editable.
  - AC-NFR-COST.001.2 — Given estimated spend crossing a threshold, When each rung is reached, Then the ladder takes exactly that rung's action (alert → throttle → hard-kill) and no rung is skipped or silent.
- **Notes / OD:** OD-068 fixed the decide/execute ownership (see COST.004). The `$50/$200` alert pair pre-existed in the design; ADR-003 added the throttle + kill rungs.

### NFR-COST.002 — Throttle action (pause non-critical, slow the loops)

- **Requirement:** The system shall, on crossing the throttle rung, **pause non-critical work** — proactive suggestions, the insight agent, self-improvement, consolidation/summaries, the medium-loop batch — and **reduce loop frequency**, while leaving user-facing and urgent work untouched; critical/in-flight consequential work is never silently dropped (it escalates if it cannot proceed).
- **Type:** posture (graceful degradation, not a cliff).
- **Upholds:** quality/viability (degrade the cheap-to-lose work first) + #3 (throttle is logged, work isn't silently starved).
- **Implemented by:** ADR-003 §2 · FR-6.RTL.004 (AC-6.RTL.004.2 — C6 directs C5 to defer/queue non-critical work) · FR-7.COST.003 (the throttle-rung signal).
- **Target / threshold:** fires at `cost_ladder_throttle_threshold` ($75/day default).
- **Verification:** build-time test (throttle signal → non-critical admission deferred/queued, user-facing + urgent still run, deferral logged).
- **Launch gate:** blocking-by-posture (locked-ADR ladder mechanism present at launch).
- **Acceptance criteria:**
  - AC-NFR-COST.002.1 — Given the throttle rung, When crossed, Then non-critical work (proactive suggestions, insight/self-improvement/consolidation, medium-loop) is paused and loop cadence is reduced, and the throttle writes a `guardrail_log` row.
  - AC-NFR-COST.002.2 — Given a user-facing or urgent task during throttle, When it runs, Then it is not throttled; When a critical in-flight task cannot proceed, Then it escalates rather than being silently dropped.
- **Notes / OD:** the critical set (never-throttled) is defined in COST.003.

### NFR-COST.003 — Hard-ceiling action (kill non-critical; allow only urgent + human-approved)

- **Requirement:** The system shall, on crossing the hard ceiling, engage the **kill switch** — halt all non-critical work and allow only **urgent fast-loop triggers + human-initiated requests + human-approved actions + guardrail/security functions** — and shall log the hard-kill to `guardrail_log` (a `rate_limit`-class event) with an **immediate alert**; a cost rung **never** overrides or relaxes a hard limit, and an irreversible/billed action at this rung **halts-and-escalates** rather than proceeding.
- **Type:** posture (the runaway backstop).
- **Upholds:** quality/viability (unbounded overnight burn on the client's card is the guarantee this closes) + #3 (a hard-kill is loud — logged + immediately alerted, never a silent stop) + #2 (never relaxes a hard limit).
- **Implemented by:** ADR-003 §2 · FR-6.RTL.004 (AC-6.RTL.004.3 — hard-kill stops new consequential spend, halt-and-escalate on irreversible/billed) · FR-7.COST.003 (kill-rung signal → `guardrail_log` + immediate alert).
- **Target / threshold:** fires at `cost_ladder_hard_kill_threshold` ($100/day default); set with margin below the true "unacceptable" number (fail-safe estimate, COST.005).
- **Verification:** build-time test (kill signal → non-critical halted, urgent/human-initiated/human-approved/guardrail paths still allowed, hard-kill logged + alerted, hard limits untouched).
- **Launch gate:** blocking-by-posture (locked-ADR kill switch present at launch — the guarantee ADR-003 exists to provide).
- **Acceptance criteria:**
  - AC-NFR-COST.003.1 — Given the hard-ceiling rung, When crossed, Then all non-critical work halts and only urgent fast-loop triggers + human-initiated + human-approved + guardrail functions may run.
  - AC-NFR-COST.003.2 — Given a hard-kill, When it fires, Then a `guardrail_log` `rate_limit`-class row is written and an alert is raised immediately; the kill never overrides a hard limit and an irreversible/billed action halts-and-escalates.
- **Notes / OD:** "critical (never killed)" = human-initiated requests, urgent fast-loop triggers (new leads, flagged messages, overdue tasks), human-approved actions, guardrail/security functions (ADR-003 §2).

### NFR-COST.004 — Cost-ladder decision/execute split (C7 meters · C6 decides · C5 executes)

- **Requirement:** The system shall separate the cost ladder into **metering (C7)**, **deciding (C6)**, and **executing (C5)**: C7 owns the running spend meter and emits the breach signal at each rung; C6 decides the disposition (the cost ladder is a **guardrail class**, sibling to the rate-limit ladder); C5 executes the throttle/kill on the run pipeline — C7 never itself throttles or kills, and the surface that *renders* the lit rung never claims to have enforced it.
- **Type:** posture (ownership boundary — the same decide/execute seam as approval gates).
- **Upholds:** quality/viability (clean ownership so no component over-reaches or leaves the ladder toothless) + #3 (the breach signal is explicit, not implicit in a meter reading).
- **Implemented by:** FR-7.COST.003 (C7 meters + signals) · FR-6.RTL.004 (C6 decides) · C5 run pipeline (executes) · FR-8.COST.003 (C8 emits the per-route cost model C7 meters — C8 neither meters nor enforces) · OD-068 (the ownership resolution).
- **Target / threshold:** N/A (uniform ownership invariant).
- **Verification:** build-time test (C7 emits a rung signal → C6 decides → C5 defers/kills; the ops cost surface lights the rung but does not enforce). Cross-check the C6↔C7 bilateral seam (AC-7.COST.003.3).
- **Launch gate:** blocking (governance/ownership in place at launch — the ladder can't work without the seam wired).
- **Acceptance criteria:**
  - AC-NFR-COST.004.1 — Given a rung breach, When it fires, Then C7 emits the signal, C6 decides the disposition, and C5 executes; C7 does not throttle or kill the run itself.
  - AC-NFR-COST.004.2 — Given the ops cost dashboard, When a rung is lit, Then the surface renders the rung state and never claims the surface enforced the throttle/kill (C6 decides, C5 executes).
- **Notes / OD:** OD-068 corrected a prior "C7 enforces" line; the owed C6 FR-6.RTL.004 was written via change-control (session 27) to clear the carry-forward.

### NFR-COST.005 — Cost source is a fail-safe token estimate (never an invoice)

- **Requirement:** The system shall drive every dashboard figure **and** every ladder rung from a **token-derived estimate** (event-log `cost_tokens` × an operator-editable `price_table`, all vendors incl. OpenAI embeddings), **never the vendor invoice** (the ADR-001 boundary forbids reading client billing), and the estimator shall be **fail-safe biased — it rounds *up*** (counts retries, assumes no optimistic cache/batch discount) so the ceiling fires **early, not late**; all figures are surfaced honestly as estimates.
- **Type:** posture + duty.
- **Upholds:** quality/viability (an estimate fit to anchor a kill switch) + #3 (labelled estimate, never a false-precision invoice; the meter never quietly under-reports).
- **Implemented by:** FR-7.COST.001 (estimate-grade, rounded-up, all-vendors, operator-editable price table) · ADR-003 §3 · config `price_table` (vendor×model→$/token, incl. `text-embedding-3-small`; changing a price re-bases subsequent estimates).
- **Target / threshold:** rounds up; all vendors counted (Sonnet + Haiku + OpenAI embeddings); `price_table` is `LIVE`-editable, no deploy.
- **Verification:** DOCS (round-up + all-vendor rules) + **reconcile estimate vs a real Anthropic/OpenAI bill** (AF-042 — the token-estimate accuracy / drift spike). The fail-safe round-up posture ships at launch; the drift measurement is fast-follow.
- **Launch gate:** the estimate-and-round-up posture is blocking-by-posture (the ladder rests on it); AF-042 (drift accuracy) is **fast-follow** — it ships behind the fail-safe round-up bias.
- **Acceptance criteria:**
  - AC-NFR-COST.005.1 — Given any cost figure, When rendered, Then it is computed from `cost_tokens × price_table` over all vendors, rounded up, and labelled/treated as an estimate — never presented as the vendor invoice.
  - AC-NFR-COST.005.2 — Given a price change, When `price_table` is edited, Then subsequent estimates re-base without a deploy.
- **Notes / OD:** the `cost_unknown ≠ $0` sentinel (a blind meter must be detectable, not averaged as free) is the co-located **observability** duty — see `observability.md` (inventory row OBS-m / FR-7.LOG.004). Cross-ref, not duplicated here.

### NFR-COST.006 — Viability target ≤ ~$20/day (the AF-001 gate)

- **Requirement:** The system shall keep a **typical-volume healthy deployment comfortably below the soft alert** — target **≤ ~$20/day (~$600/mo)**, with `$50/day` as the "investigate" line and `$100/day` as the backstop — because if a healthy deployment cannot run at this target the retainer stops being worth paying and the business model breaks.
- **Type:** threshold (the economic envelope).
- **Upholds:** quality/viability (this *is* the viability question ADR-003 exists to answer — the one target whose failure invalidates the architecture).
- **Implemented by:** ADR-003 §7 · measured end-to-end by AF-001 (a real multi-agent task + memory write).
- **Target / threshold:** ≤ ~$20/day (~$600/mo) typical; soft $50 = investigate; hard $100 = backstop.
- **Verification:** **SPIKE+EVAL — AF-001** (run a real end-to-end task + memory write, measure actual tokens/$; confirm typical volume lands under the soft alert). If AF-001 measures typical volume *above* the soft alert, the response is to pull the levers in the COST.007 order **before** raising the ceiling.
- **Launch gate:** **blocking (RP-1, session 45).** AF-001 is one of the six blocking spikes — if a healthy deployment can't run at the target, the business model breaks, so this NFR is launch-gating (not fast-follow like the other cost AFs).
- **Acceptance criteria:**
  - AC-NFR-COST.006.1 — Given the AF-001 spike over a real task + memory write, When typical-volume cost is measured, Then it lands at or below ~$20/day and under the $50/day soft alert.
  - AC-NFR-COST.006.2 — Given AF-001 measures typical volume above the soft alert, When the team responds, Then the cost levers are pulled in the COST.007 order before the ceiling is raised.
- **Notes / OD:** AF-040/041 (real-task cost acceptable; the $50/$100 defaults realistic) sit under the AF-001 umbrella; they are the threshold-realism half and are fast-follow, but the **viability target itself is blocking**.

### NFR-COST.007 — "Controls before gates" — the cost-discipline precedence

- **Requirement:** The system shall order cost controls **structural/code limits first, cheap model-gates only where a genuine judgment is needed AND the gate reliably prevents a costlier call, and never an LLM gate whose own cost/quality-risk exceeds what it saves** — and, when a deployment runs hot, shall pull the levers in the fixed order `model routing → selective-writing gate → loop idle-gating → memory-injection limit → orchestrator confidence threshold` (the highest-leverage single tunable) **before** raising the ceiling; v1 keeps exactly **one** cost model-gate (the Haiku selective-writing gate).
- **Type:** posture (binding anti-bloat discipline on downstream FRs).
- **Upholds:** quality/viability (the cheapest call is the one you never make; no self-defeating machinery).
- **Implemented by:** ADR-003 §6 (controls-before-gates) · §7 (lever ordering) · structural limits: `chain_depth_limit` / `memories_injected_per_task` / loop condition pre-check (ADR-003 §5) / the rate caps · the one model-gate: the Haiku selective-writing gate (COST.008).
- **Target / threshold:** exactly one v1 cost model-gate; lever order fixed as above.
- **Verification:** DOCS (the lever precedence + the "exactly one gate" invariant are honoured by the FR set — no second LLM cost-gate mandated; re-rank/HyDE off-by-default per COST.010).
- **Launch gate:** blocking (governance/design posture in place at launch).
- **Acceptance criteria:**
  - AC-NFR-COST.007.1 — Given a hot deployment, When the response is chosen, Then the levers are pulled in the ADR-003 §7 order before the ceiling is raised.
  - AC-NFR-COST.007.2 — Given the v1 cost model, When its model-gates are inventoried, Then exactly one exists (the Haiku selective-writing gate) and no gate costs more than it saves.
- **Notes / OD:** loop idle-gating (a plain DB/condition check before waking the Sonnet orchestrator, ADR-003 §5) is a structural control, not a model-gate — an idle deployment's loop floor ≈ free.

### NFR-COST.008 — Memory-write cost model (Haiku-dominant, ≤1 Sonnet writer)

- **Requirement:** The system shall shape each memory-write event as **code noise-filter → Haiku selective-writing gate → Haiku pre-checks (contradiction + sensitivity) → exactly one Sonnet writer**, so a *written* memory costs **exactly 1 Sonnet call wrapped in ≤3 Haiku calls** and a non-surviving event costs **0 Sonnet** (the common case dies at the code filter or the Haiku gate); the Sonnet writer is capped by `rate_limit_memory_writes_per_minute` (30/min, never unlimited).
- **Type:** posture + threshold.
- **Upholds:** quality/viability (memory drops from "scariest cost line" to bounded + mostly-Haiku).
- **Implemented by:** ADR-003 §4 · C2 memory write-path (the two design filters map onto the Haiku layer; ≤1 Sonnet writer) · config `rate_limit_memory_writes_per_minute` (30, `LIVE`, int ≥ 1 — never unlimited).
- **Target / threshold:** ≤1 Sonnet + ≤3 Haiku per written memory; `rate_limit_memory_writes_per_minute=30` caps the **Sonnet** writer (not 90); the gate is tuned conservative (kills only obvious noise, passes through when in doubt — the writer is the real judge).
- **Verification:** **EVAL — AF-043** (does the Haiku gate filter enough to pay for its own Haiku cost, and is it accurate enough to trust?), measured in the AF-001 spike + the shadow-retain trust window. If it fails either bar, drop or retune it (controls-before-gates).
- **Launch gate:** the write-path *shape* is blocking-by-posture (locked ADR, present at launch); **AF-043 (gate quality/self-funding) is fast-follow** — it ships behind the shadow-retain posture (COST.009), so nothing is lost while the gate is unproven.
- **Acceptance criteria:**
  - AC-NFR-COST.008.1 — Given a memory-write event, When it produces a written memory, Then the path made exactly one Sonnet call wrapped in ≤3 Haiku calls; When the event does not survive, Then zero Sonnet calls were made.
  - AC-NFR-COST.008.2 — Given sustained write load, When the Sonnet writer rate is measured, Then it does not exceed `rate_limit_memory_writes_per_minute` (30/min) and the cap is never configurable to unlimited.
- **Notes / OD:** OD-003's "3 Sonnet calls per write" was rejected by ADR-003 §4 — it's ≤1 Sonnet + Haiku pre-checks.

### NFR-COST.009 — Selective-writing gate ships in shadow-retain (nothing lost while unproven)

- **Requirement:** The system shall, during a **trust window** (default ~3 weeks, `haiku_audit_window_days=21`), run the selective-writing gate in **shadow-retain mode** — a "would-drop" memory is **written anyway and tagged `haiku_would_drop`**, so nothing is lost and every drop is reviewable — and shall let the gate go **autonomous (drops actually drop)** only after the window if the operator disagree-rate is under `haiku_gate_disagree_threshold`; otherwise the gate stays supervised and is retuned.
- **Type:** posture + duty.
- **Upholds:** **#1** (shadow-retain never loses a would-drop memory — the gate saves nothing during the window, which is acceptable because a new deployment is low-volume/cold-start) + quality/viability (the cheap model earns trust before it is trusted to discard).
- **Implemented by:** ADR-003 §8 · C2 (FR-2.ING.001 + OD-036 — the trust-window shadow-retain mechanics + exit criteria) · config `haiku_audit_window_days` (21) + `haiku_gate_disagree_threshold` (both named in ADR-003 §8 as Phase-2 keys — see Notes).
- **Target / threshold:** ~21-day window; autonomous only if disagree-rate < `haiku_gate_disagree_threshold`.
- **Verification:** **EVAL — AF-035 (memory-path half) + AF-043** — the Haiku decision log (every keep/drop/contradiction/sensitivity verdict + downstream outcome) is the validation data; operator agree/disagree on the review queue feeds gate tuning. Standing dual-track (cost + quality), not a one-off.
- **Launch gate:** the shadow-retain posture is **blocking-by-posture** (it *is* the #1 safeguard that lets AF-043/035 be fast-follow); the gate's graduation-to-autonomy is gated on the disagree-rate, not on launch.
- **Acceptance criteria:**
  - AC-NFR-COST.009.1 — Given the trust window, When the gate would drop a memory, Then the memory is written and tagged `haiku_would_drop` (nothing lost) and the decision is logged for review.
  - AC-NFR-COST.009.2 — Given the window ends, When the disagree-rate is under threshold, Then the gate goes autonomous; When over threshold, Then it stays supervised and is retuned.
- **Notes / OD:** OD-036 owns the retain mechanics + exit criteria. **Config:** `haiku_audit_window_days` (21) and `haiku_gate_disagree_threshold` (0.05) — owed by ADR-003 §8 and **added to `config-registry.md` §E via the Phase-5 gap-sweep change-control** (both per-deployment, LIVE, operator-editable).

### NFR-COST.010 — Cost-per-task-type from day one; re-ranking/HyDE off by default

- **Requirement:** The system shall aggregate cost **per task type from day one** (the ROI substrate — which task types are expensive, where ROI is highest), populated from the first task and not retrofitted; and shall keep **re-ranking and HyDE off by default** in the v1 cost model — optional read-path LLM cost justified **only** by an AF-002 eval that shows they earn their keep.
- **Type:** duty + posture.
- **Upholds:** quality/viability (evidence base for tuning the routing table + not paying read-path LLM cost for unproven payoff).
- **Implemented by:** FR-7.COST.002 (per-task-type from day one, queryable/groupable) · ADR-003 §6 (re-rank/HyDE not mandated, off-by-default) / §8 (per-task-type telemetry) · FR-8.COST.003 (the per-route cost model feeding the aggregate).
- **Target / threshold:** aggregation live from the first task; re-rank/HyDE default off.
- **Verification:** DOCS (default-off flags) + **EVAL — AF-002** (retrieval relevance): re-rank/HyDE are enabled only if AF-002 shows they earn their read-path cost. The from-day-one aggregation is a build-time test.
- **Launch gate:** per-task-type aggregation is blocking (substrate must exist from day one — can't be retrofitted); **AF-002 (whether re-ranking earns its cost) is fast-follow** — re-rank/HyDE stay off until proven.
- **Acceptance criteria:**
  - AC-NFR-COST.010.1 — Given the first task on a fresh deployment, When cost is recorded, Then it is aggregated per task type from that first task (not retrofitted), and is queryable/groupable by task type.
  - AC-NFR-COST.010.2 — Given the default config, When the system boots, Then re-ranking and HyDE are off; they are enabled only after an AF-002 eval justifies their read-path cost.
- **Notes / OD:** the model-routing dual-track telemetry (cost track + quality track, AF-035) is the standing evidence base for tuning the config-driven routing table.

---

*Drafted session 45 (2026-07-01). Cites verified against ADR-003, `config-registry.md`
(`cost_ladder_soft/throttle/hard_kill_threshold`, `price_table`,
`rate_limit_memory_writes_per_minute`), and the C5–C8 component FRs. Notes: (1)
`haiku_audit_window_days` (21) / `haiku_gate_disagree_threshold` (0.05) were added to
`config-registry.md` §E via the Phase-5 gap-sweep change-control (COST.009); (2) the
`cost_unknown ≠ $0` meter-honesty duty is cross-referenced to `observability.md` (OBS-m /
FR-7.LOG.004), not duplicated here. AF-001 marked **blocking** per RP-1; AF-042/043/035/002
fast-follow behind the shadow-retain + fail-safe-round-up postures.*
