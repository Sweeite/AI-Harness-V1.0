# Component 8 — Agent Design (who does the work)

- **Status:** 🟢 **Approved 2026-06-26 (session 25)** — 37 FRs, verification gate run + all 10 quality findings
  reconciled; ODs **OD-075…OD-081** resolved (OD-076 #1 cache, OD-077 #3 clarification, OD-080 #2 capability-edits,
  OD-081 #2 scope-wiring all surfaced; the rest delegated); feasibility **block S (AF-121…AF-126)** logged; OOS-030
  logged. **Sign-off:** user-authorized (delegated; "Sign off — Approve C8"). Area codes: ORC ×8 · REG ×6 · SPC ×6 ·
  SCO ×3 · PLAN ×4 · HLTH ×4 · LRN ×3 · COST ×3 (**37 FRs**). C8 is the **routing + agent-definition layer** — *who* does the work and *how the work is
  routed to them*. One **orchestrator** that routes-and-plans-only, a roster of **specialist agents** each owning one
  domain, the **agent registry** (`agents` table) that makes them data-driven and discoverable, the **memory-scoping
  matrix** per agent, **per-step failure-mode assignment** at plan-build time, the **agent-health / drift /
  dead-agent** metric *production*, **orchestrator learning + result caching**, and **cost-routing by complexity**.
- **Scope decision (entry):** **routing + definitions + metric-production now; execution, surfaces, and healing
  mechanisms stay seamed.** C8 owns the orchestrator's decision-making and the agent registry; it does **not** own the
  *execution* of a plan (the context-envelope machinery, retry/skip/halt loops, DLQ, parallel execution, warm-up →
  **C5**), the *dashboards* that show agent/cost/health (→ **C7** display + **Phase 3** rendering), the *self-healing
  mechanisms* (→ C2/C3/C5), or the *insight generation* behind self-improvement suggestions (→ **C9**). C8 **produces
  the signals** (agent health, drift, routing outcomes, cost-by-route); their home components surface, enforce, or
  act on them. Mirrors C6's "seam, don't absorb" and C7's "backbone now, surfaces → Phase 3."

> **Verification gate (2 zero-context subagents, 2026-06-26):**
> - **Orphan/contradiction pass — CLEAN.** Every intent L3371–3649 + the cross-cut sites maps to an FR or is
>   correctly seamed (envelope/execution → C5, self-healing → C2/C3/C5, dashboards → C7/Phase-3, insight generation →
>   C9, cost metering/enforcement → C7/C6, prompt content → C4). **5 of 6 traps PASS**; the 6th (citations) clean in
>   the spot-check. Two real issues caught + fixed: **(1)** the design's `agents.client_slug` column contradicts
>   ADR-001 §3 (which deletes `client_slug` from app tables intra-silo) — **dropped**, mirroring C7 OD-067, and the
>   mis-citation removed (AC-8.REG.001.3 rewritten); **(2)** a dead citation `FR-2.RST.003` → corrected to
>   `FR-2.RET.006` / `C1 FR-1.RST.003`. Minor: `FR-5.TRG.*` slow-loop ref → `FR-5.LOP.001`.
> - **Quality/failure pass — 10 findings (3 HIGH, 4 MED, 3 LOW), ALL reconciled in-file.** **H1** (the structural
>   hole): the per-agent `memory_scope` matrix had **no enforcement consumer** — C2 enforces clearance/RLS, C5
>   invokes it with task-clearance + task-entities, but nothing applied "which agent is running" at retrieval (#2
>   unwired, most acute for the `service_role` orchestrator). → **OD-081 resolved + applied via change-control**
>   (+AC-5.ASM.006.2 fail-closed + AC-2.RET.004.2 narrow-within-clearance) + SCO.001 rewritten as a real retrieval
>   filter (+AC-8.SCO.001.3 fail-closed). **H2** orchestrator crash mid-route → +AC-8.ORC.001.3 (idempotent re-route,
>   never dequeued-but-unplanned). **H3** metric-producer silent stall → +AC-8.HLTH.004.2 (producer liveness/heartbeat
>   for HLTH.001/003 + LRN.002, mirroring HLTH.002.2). **M4** cache blind spots → +AC-8.LRN.003.2/.3 (write-triggered
>   invalidation by the Memory Agent commit + miss-on-uncertainty). **M5** orchestrator service_role narrowing → tied
>   to OD-081 (note on ORC.008). **M6** Comms/Finance tool-grant tampering → +AC-8.SPC.003.3/.004.3 (reject the grant
>   at write, not just audit) + AC-8.REG.006.3 (positive seed check). **M7** owed C6 cost-ladder FR → kept as a
>   tracked carry-forward (OD-068). **L8** outcome-write-failure secondary sink, **L9** warn-at-disable-last-agent,
>   **L10** halt-escalate inherits staleness escalation — all added. Meta: C8 upholds the three non-negotiables; the
>   biggest residual (H1) is now wired, not asserted.

- **What C8 is:** the answer to "*who* actually does the work, and how does a task reach the right one" (L3375). One
  **orchestrator** — never does the work, routes and plans only via a **seven-step routing process** (classify →
  read the registry → score candidates → build the execution plan → confidence-check → version + log, L3387–3417),
  driven **by agent descriptions, not hardcoded logic** (L3400, L3419 — "the most important thing"). Eight seed
  **specialist agents** (Research / Client / Campaign / Comms / Ops / Memory / Finance / Insight, L3425–3439), each
  scoped to one domain with a defined **memory scope** (L3466–3479). The **agent registry** (`agents`, L3499–3517) —
  adding a specialist is inserting a row; the orchestrator discovers it automatically (L3519). Per-step **failure
  modes assigned upfront** (L3485–3493). The **drift / dead-agent / agent-health** metrics (L3642–3644, L3589) and
  **orchestrator learning** (L3640) that the self-improvement layer consumes. **Cost-routing by complexity** and the
  **confidence threshold** — "the highest leverage single tunable for cost vs quality" (L3620).
- **What C8 is NOT (seams):**
  - The **context envelope** (shape, travel, `previous_outputs` accumulation, compression) is **C5** (FR-5.ENV.*,
    FR-5.ASM.*). C8 *populates* the `execution_plan` field and hands it off; it does not own the envelope mechanism.
  - **Failure-mode execution** — retry-with-backoff, skip-and-log, halt-and-escalate, the DLQ, loop catch-up — is
    **C5** (FR-5.LOP.*, FR-5.JOB.*). C8 owns only the *assignment* of a failure mode to each step at plan-build time.
  - **Self-healing mechanisms:** orphaned-memory re-link / duplicate-merge / expiry-exclude / hard-conflict /
    restricted-memory → **C2** (FR-2.MNT.*); connector auth refresh → **C3** (FR-3.TOK.*); failed-tool retry /
    failed-task retry+DLQ / loop catch-up → **C5**. C8 owns none of these.
  - The **self-improvement panel**, **improvement history**, and the **dashboards** that show agent/cost/health →
    **C7** display + **Phase 3** rendering. The *insight generation* behind proactive suggestions → **C9** (the
    Insight Agent feeds it). C8 produces the agent-health / drift / routing-outcome **metrics**; it does not render
    them or generate the suggestions.
  - **Cost** — metering + the cost dashboard → **C7**; the cost-ladder *enforcement* (throttle / hard kill) → **C6**
    (the owed C6 cost-ladder FR, OD-068 carry-forward); execution → **C5**. C8 owns the cost-*routing* logic + the
    confidence dial.
  - **Layer-1 prompt content** + the `prompt_layers` store + version discipline → **C4**. C8 reconciles the
    `agents.system_prompt` column (OD-048 → OD-075) but does not own prompt content.
  - **Anomaly baseline**, **approval tiers / auto-approve** → **C6**; **RBAC + sensitivity clearance** → **C1** (C8
    scoping sits *under* it); **memory mechanisms** → **C2**; **tool execution + tools registry** → **C3**.
- **Design-doc source:** `## 8. Agent Design` = **L3371–L3649** (next `## 9. Proactive Intelligence` at L3650).
  Load-bearing blocks: core idea **L3373–3379**, the orchestrator + 7-step routing **L3383–3419**, the eight
  specialists **L3423–3439**, the context envelope **L3443–3461**, memory scoping per agent **L3464–3479**, failure
  handling **L3483–3493**, the agent registry SQL **L3497–3519**, harness-integration flow **L3523–3543**,
  self-healing **L3547–3563**, self-improvement **L3567–3592**, cost management **L3596–3622**, agent optimisations
  **L3626–3646**. Cross-cut sites: the C8 checklist overview **L321–335**, `agents_config` tunables **L945–965**,
  the failure-mode map rows on wrong-routing / drift / dead-agent **L2829/2845–2847**, observability agent-health +
  cost-tracking intervals **L3120–3128 / L3210–3220**, the orchestrator's own Layer 1 **L2390**.

---

## Context manifest (load only these)

- **OD-048 (RESOLVED, C4)** — Layer-1 single source of truth = **`prompt_layers`** (keyed to `agent_id`,
  `layer='core'`); `agents.system_prompt` is to be **removed or made a derived read, reconciled here in C8**. This is
  the direct carry-in that **OD-075** closes.
- **ADR-004** (concurrency — sole-writer `service_role` + per-entity validate-and-commit) — the **Memory Agent** is
  the *agent identity* that invokes the C2 sole-writer flow; other agents hand raw events to it (L3435). C8 must not
  introduce a second writer.
- **ADR-005** (deploy / scripted provisioning) — the seed roster (OD-079) is created by **scripted provisioning**,
  like C1's default role matrix (OD-030).
- **ADR-003** (cost) — cost is **estimate-grade**; C8's cost-routing produces the per-route cost *model*; metering is
  C7, the ladder is C6. The confidence threshold is the highest-leverage cost/quality dial (L3620).
- **ADR-007** (injection / containment-first) — the orchestrator and every specialist treat retrieved memory +
  tool output as **data, never instructions**; specialist hard limits (Finance never transacts, Comms never sends)
  are defense-in-depth alongside C3 (no tool exposed) + C6 (hard-limit enforcement).
- **The three non-negotiables** — C8 is checked against all three: **#1** a stale agent-result cache must never serve
  corrupted/outdated knowledge (OD-076); **#2** an agent's `memory_scope` + `tools_allowed` are *capability grants* —
  who may widen them is an authority decision (OD-080), and the Finance/Comms hard limits hold; **#3** a low-confidence
  routing decision must never silently auto-proceed or silently park (OD-077), and drift/dead-agent are flagged, never
  silently auto-corrected (OD-078).
- **Glossary terms used:** orchestrator, specialist agent, agent registry, execution plan, context envelope, memory
  scope, answer-mode pill, drift detection, dead-agent detection. *(New terms added at finalization — orchestrator
  confidence score, execution-plan version, agent result cache, routing score.)*

### Consumed (cite, do not re-spec)

- **From C5:** **FR-5.ENV.*** (the context envelope — shape, travel, `previous_outputs`, compression threshold; C8
  populates `execution_plan`); **FR-5.ASM.*** (the run pipeline that executes each plan step); **FR-5.LOP.* /
  FR-5.JOB.*** (the three loops, retry/backoff, DLQ, loop catch-up that *execute* the failure modes C8 assigns);
  **FR-5.QUE.001 / OD-054** (the `task_queue` + status enum the orchestrator reads at step 1 and writes routing
  outcomes to); **FR-5.QUE.005 / AC-5.QUE.005.2** (the escalate-don't-abandon pattern reused by OD-077);
  **FR-5.LOP.001** (the slow loop the Insight Agent runs on).
- **From C4:** **FR-4.LYR.001 / FR-4.STO.*** (`prompt_layers` is the single Layer-1 store, keyed to `agent_id` —
  OD-048/OD-075); **FR-4.LYR.004** (assembly-time required-element validation); **FR-4.CID.006** (the answer-mode
  pill — a quality signal C8's dead-agent metric reads).
- **From C2:** **FR-2.WRT.*** (the sole-writer write flow the Memory Agent invokes); **FR-2.RET.*** (retrieval +
  clearance-before-ranking the orchestrator's `memory_retrieved` rides on); **FR-2.MNT.*** (memory-health signals C8
  does not recompute).
- **From C3:** **FR-3.REG.002** (the tool registry — `tools_allowed` references tool ids; the orchestrator's "tool
  scope fit" score reads tool descriptions); **FR-3.ACT.*** (no autonomous-send / no-transaction tools exposed — the
  code half of the Comms/Finance hard limits).
- **From C1:** **FR-1.CLR.* / FR-1.RST.* / FR-1.RLS.***** (sensitivity clearance applies *on top of* memory scope —
  L3479; the agent path runs `service_role` with mid-task re-check FR-1.RLS.007); **FR-1.ROLE.* / PERM.*** (who may
  edit the registry — OD-080); **OD-030** (seed-then-authoritative provisioning, mirrored by OD-079).
- **From C6:** **FR-6.HRD.* / FR-6.APR.*** (hard-limit enforcement + approval tiers — the Comms approval-queue output
  and Finance no-transaction limit are *enforced* here); the owed **C6 cost-ladder FR** (OD-068 carry-forward).
- **From C7:** **FR-7.VIEW.* / FR-7.OPT.*** (C7 reserves the agent-health / drift / routing-outcome surfaces; C8
  produces the metrics they display); **event_log** (where C8 writes routing decisions + outcomes).

### Forward seams (named here, specced later)

- **C9 (Proactive Intelligence):** consumes the **Insight Agent** output (L3439) + the routing/health metrics C8
  produces to generate the *surfaced* and *guided* self-improvement suggestions (L3575–3592). C8 produces evidence;
  C9 turns it into suggestions; C7 displays them.
- **Phase 3 (Surfaces):** the self-improvement panel, agent-health cards, and the routing/clarification UI are
  rendered in Phase 3; C8 defines the *signals + the RBAC-routed need*, not the layout.

---

## Open decisions (drafted — to resolve before any FR is `Ready`)

| OD | Question | Touches | Recommendation |
|----|----------|---------|----------------|
| **OD-075** | `agents.system_prompt` disposition (closes OD-048) | #1 (dual store) | **(a) remove the column**; Layer-1 lives solely in `prompt_layers` keyed to `agent_id`; the registry resolves it by `agent_id`. No sync surface. |
| **OD-076** | Agent result cache invalidation | **#1** | **(b) scope-aware + time-bounded**: cache key includes the in-scope entity ids + their last-write/memory version; any write to an in-scope entity invalidates the entry, *and* a max time window applies. Time-window-only (the design's literal `cache_time_window`) can serve stale knowledge after a relevant write. |
| **OD-077** | Low-confidence clarification that no human answers | **#3** | **(a) tracked + escalating**: the clarification request is a `task_queue` item that escalates on timeout (reuse C1 OD-028 / C5 AC-5.QUE.005.2); never silently auto-proceeds below threshold, never silently parks. |
| **OD-078** | Drift + dead-agent detection: threshold, signal, action | #2/#3 | **(a) flag-only, never auto-disable** (auto-disabling is itself an autonomous action — consistent with L3563 + OD-010); configurable thresholds with defaults; quality signal = task success/failure + answer-mode-pill distribution + human approval/rejection outcomes; C8 produces the metric, C7 surfaces, a human decides. Gated by AF-123/124. |
| **OD-079** | Specialist roster seeding | — | **(a) seed the 8 canonical specialists + the orchestrator at provisioning** (ADR-005 scripted, mirrors C1 OD-030), editable/extensible after. |
| **OD-080** | Who may edit the registry / roll back plans | **#2** | **(a) split by authority**: changes to `memory_scope` / `tools_allowed` / `enabled` (capability grants) = **Super Admin only** (mirrors C4 OD-049 principles-are-tighter); `description` / routing-weight tuning = Super Admin + Admin. Mandatory `change_reason` + audit on every change. |
| **OD-081** | Per-agent `memory_scope` enforcement wiring (verification-gate H1) | **#2** | **(a) wire it**: amend C5 FR-5.ASM.006 + C2 FR-2.RET.004 to apply the agent-scope predicate — **resolved + applied this session via change-control** (+AC-5.ASM.006.2 fail-closed, +AC-2.RET.004.2 narrow-within-clearance). |

_(OOS-030 logged: **automatic execution-plan rollback** deferred to v2 — rollback is human-decided, consistent with
OD-010 no-auto-rollback. AFs block S = AF-121…AF-126. All six original ODs + the gate-raised OD-081 are RESOLVED.)_

---

## Functional requirements

### Area ORC — Orchestrator & routing

#### FR-8.ORC.001 — Orchestrator routes and plans only, never does the work
- **Statement:** The system shall route every task through a single orchestrator that classifies, plans, and
  delegates but never performs domain work itself.
- **Source:** design-doc-v4.md L3375, L3385
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** A task reaching the front of the `task_queue` (C5 FR-5.QUE.001).
- **Preconditions:** RBAC + sensitivity clearance check has passed (C1; L3528–3529).
- **Behaviour:**
  - Happy path: orchestrator reads the task → runs the 7-step routing process (ORC.002–008) → emits an execution
    plan → hands off to C5 for execution. The orchestrator itself invokes no action/observation tool beyond reading
    the registry, the entity model, and semantic memory (its scope, FR-8.SCO scope row).
  - Branches: simple task → single-agent plan; complex → multi-agent chain.
  - Edge / failure: if the orchestrator cannot produce a plan, the task halts and escalates (never silently drops) —
    FR-8.PLAN.002 default.
- **Data touched:** `task_queue` (read), `agents` (read), `event_log` (write — routing decision).
- **Permissions:** N/A (system agent; runs `service_role`, C1 FR-1.RLS.007).
- **Config dependencies:** CFG-orchestrator_confidence_threshold, CFG-chain_depth_limit (L945–948).
- **Surfaces:** N/A (backend) — routing decisions surface via C7.
- **Observability:** every routing decision logged to `event_log` (plan, scores, confidence).
- **Acceptance criteria:**
  - AC-8.ORC.001.1 — Given a task at the queue front, When the orchestrator runs, Then it produces an execution plan
    and performs no domain action tool call itself (verified: orchestrator's `tools_allowed` is empty / read-only).
  - AC-8.ORC.001.2 — Given the orchestrator cannot route, When planning fails, Then the task halts-and-escalates and
    the failure is logged — never silently consumed.
  - AC-8.ORC.001.3 — Given the orchestrator process is interrupted (crash/timeout) **between dequeue (step 1) and
    plan-persist (ORC.007)**, When recovery runs, Then the task returns to a re-routable queue state and the
    interruption is logged — a task is never left dequeued-but-unplanned (idempotent re-route; relies on the C5
    task-lifecycle crash-window guarantee, FR-5.GRP.003 + the `task_queue` status model). _(H2)_
- **Open decisions:** —
- **Feasibility assumptions:** AF-121 (description-driven routing accuracy).
- **Notes:** Orchestrator model = `claude-sonnet-4-6` (L158). The routing computation is itself a Sonnet call that can
  time out with the task already off the queue front — AC.3 closes that crash window.

#### FR-8.ORC.002 — Classify the task (domain, complexity, context, output)
- **Statement:** The system shall classify each task by domain, complexity, context scope, and expected output type
  before selecting agents.
- **Source:** L3392–3396
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Orchestrator, step 2.
- **Preconditions:** Task read.
- **Behaviour:**
  - Happy path: derive domain ∈ {client, campaign, comms, ops, finance, insight}; complexity ∈ {single, multi};
    context = entities + memory scope; output ∈ {action, draft, summary, flag}.
  - Branches: ambiguous classification lowers the routing confidence (feeds ORC.006).
  - Edge / failure: unclassifiable task → low confidence → clarification (ORC.006).
- **Data touched:** `event_log` (write — classification).
- **Permissions:** N/A.
- **Config dependencies:** —
- **Surfaces:** N/A.
- **Observability:** classification recorded with the routing decision.
- **Acceptance criteria:**
  - AC-8.ORC.002.1 — Given a task, When classified, Then domain/complexity/context/output are recorded on the
    routing record.
  - AC-8.ORC.002.2 — Given an ambiguous task, When classification confidence is low, Then it propagates to the
    confidence check (ORC.006), not silently defaulted.
- **Open decisions:** —
- **Feasibility assumptions:** AF-121.

#### FR-8.ORC.003 — Read the registry; route by description, not hardcoded logic
- **Statement:** The system shall route by reading every enabled agent's description from the registry, never by
  hardcoded task→agent mappings.
- **Source:** L3398–3401, L3419
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Orchestrator, step 3.
- **Preconditions:** Registry populated (REG.006 seed).
- **Behaviour:**
  - Happy path: read all rows where `enabled = true`; use `description` as the routing signal.
  - Branches: a disabled agent is invisible to routing (REG.005).
  - Edge / failure: no enabled agent matches → low confidence → clarification (ORC.006); never route to a disabled
    or non-existent agent.
- **Data touched:** `agents` (read).
- **Permissions:** N/A.
- **Config dependencies:** —
- **Surfaces:** N/A.
- **Observability:** the candidate set logged.
- **Acceptance criteria:**
  - AC-8.ORC.003.1 — Given a code change request to add a task→agent rule, When reviewed, Then it is rejected:
    routing is data-driven; the fix for mis-routing is the agent **description** (REG), not code.
  - AC-8.ORC.003.2 — Given an agent with `enabled = false`, When routing runs, Then that agent is never a candidate.
- **Open decisions:** —
- **Feasibility assumptions:** AF-121.

#### FR-8.ORC.004 — Score candidate agents on configurable weights
- **Statement:** The system shall score candidate agents on domain match, complexity fit, memory-scope fit, and
  tool-scope fit, with all weights configurable per deployment.
- **Source:** L3403–3405
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Orchestrator, step 4.
- **Preconditions:** Candidate set from ORC.003.
- **Behaviour:**
  - Happy path: compute a routing score per candidate from the four weighted factors; rank.
  - Branches: tie / near-tie lowers confidence.
  - Edge / failure: all scores below a floor → low confidence → clarification.
- **Data touched:** `agents` (read), `event_log` (write — scores).
- **Permissions:** N/A.
- **Config dependencies:** CFG-routing_weights (domain/complexity/memory/tool — L3404 "all weights configurable").
- **Surfaces:** N/A.
- **Observability:** per-candidate scores logged (feeds drift/routing-mismatch metric, LRN.002).
- **Acceptance criteria:**
  - AC-8.ORC.004.1 — Given candidates, When scored, Then each gets a recorded routing score from the four weighted
    factors.
  - AC-8.ORC.004.2 — Given a deployment changes a routing weight, When the next task routes, Then the new weight is
    in effect.
- **Open decisions:** —
- **Feasibility assumptions:** AF-121, AF-122 (confidence calibration).

#### FR-8.ORC.005 — Build the execution plan (single vs chain, deps, parallel, failure modes)
- **Statement:** The system shall build an execution plan that is a single-agent direct route for simple tasks or an
  ordered chain with dependencies and identified parallel steps for complex tasks, with a failure mode assigned to
  every step.
- **Source:** L3407–3410
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Orchestrator, step 5.
- **Preconditions:** Ranked candidates (ORC.004); within `chain_depth_limit` (PLAN.003).
- **Behaviour:**
  - Happy path: simple → `[specialist]`; complex → ordered chain with explicit dependencies, parallel-eligible steps
    marked, every step assigned a failure mode (PLAN.001). Research Agent placed first when information-gathering is
    needed (SPC.002).
  - Branches: chain would exceed `chain_depth_limit` → reject/trim and lower confidence (PLAN.003).
  - Edge / failure: a step with no assignable failure mode defaults to halt-and-escalate (PLAN.002).
- **Data touched:** writes `execution_plan` into the context envelope (C5 FR-5.ENV.*); `event_log`.
- **Permissions:** N/A.
- **Config dependencies:** CFG-chain_depth_limit, CFG-parallel_execution (L948–949).
- **Surfaces:** N/A.
- **Observability:** the plan logged + versioned (ORC.007 / PLAN.004).
- **Acceptance criteria:**
  - AC-8.ORC.005.1 — Given a simple task, When planned, Then the plan is a single agent.
  - AC-8.ORC.005.2 — Given a complex task, When planned, Then the plan is an ordered chain with dependencies, parallel
    steps marked, and every step carrying a failure mode (PLAN.001).
  - AC-8.ORC.005.3 — Given the plan is built, When handed off, Then it is written into the context envelope's
    `execution_plan` field (C5) — C8 does not execute it.
- **Open decisions:** —
- **Feasibility assumptions:** AF-121.

#### FR-8.ORC.006 — Confidence check → human clarification below threshold (never silent)
- **Statement:** The system shall compute a routing confidence and, when it is below the configurable threshold,
  request human clarification via the dashboard rather than executing the plan.
- **Source:** L3412–3413, L947, L3632
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Orchestrator, step 6.
- **Preconditions:** Plan built; `orchestrator_confidence_threshold` configured (default 0.75).
- **Behaviour:**
  - Happy path: confidence ≥ threshold → proceed to ORC.007 + execution.
  - Branches: confidence < threshold → emit a clarification request to the dashboard, set the task to an
    awaiting-clarification state (C5 status enum, OD-054), and **do not execute**.
  - Edge / failure: **the clarification request escalates on timeout** (OD-077, reuse C5 AC-5.QUE.005.2) — it is never
    silently dropped and the plan is never silently auto-executed below threshold.
- **Data touched:** `task_queue` (status), `event_log`.
- **Permissions:** the clarification is actionable by the task-owning role (C1).
- **Config dependencies:** CFG-orchestrator_confidence_threshold (L947); CFG-clarification_escalation window (OD-077).
- **Surfaces:** clarification request UI (Phase 3); routed via C7.
- **Observability:** low-confidence routing logged; escalation timer logged.
- **Acceptance criteria:**
  - AC-8.ORC.006.1 — Given confidence < threshold, When the check runs, Then a clarification request is raised and the
    plan is not executed.
  - AC-8.ORC.006.2 — Given a clarification request goes unanswered past its window, When the timer fires, Then it
    escalates (never silently parks, never auto-proceeds) — OD-077.
- **Open decisions:** **OD-077.**
- **Feasibility assumptions:** AF-122 (the threshold must meaningfully separate good/bad routing).

#### FR-8.ORC.007 — Version and log every plan; track its outcome
- **Statement:** The system shall version and log every execution plan and track its outcome so routing can be
  evaluated and improved.
- **Source:** L3415–3416
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Orchestrator, step 7.
- **Preconditions:** Plan accepted (≥ threshold) or resolved via clarification.
- **Behaviour:**
  - Happy path: persist the plan with a version id; on completion record the outcome (success/failure/skip per step)
    against the plan version (feeds LRN.001 + PLAN.004 + HLTH.001).
  - Branches: a re-planned task after clarification gets a new plan record linked to the original.
  - Edge / failure: outcome write failure is itself logged (no silent loss of the learning signal).
- **Data touched:** `event_log` (write), execution-plan store (PLAN.004).
- **Permissions:** N/A.
- **Config dependencies:** —
- **Surfaces:** routing-outcome metrics (C7).
- **Observability:** plan + outcome are the substrate for orchestrator learning.
- **Acceptance criteria:**
  - AC-8.ORC.007.1 — Given a plan executes, When it completes, Then its outcome is recorded against the plan version.
  - AC-8.ORC.007.2 — Given the outcome write fails, When detected, Then the failure is surfaced through a **secondary
    sink / heartbeat** distinct from the failed channel (the C5/C7 secondary-sink pattern — "the reporter of failures
    must not be the thing that failed"), never silently dropped. _(L8)_
- **Open decisions:** —
- **Feasibility assumptions:** AF-126 (outcome tracking measurably improves routing).

#### FR-8.ORC.008 — The orchestrator is itself a scoped registry agent
- **Statement:** The system shall represent the orchestrator as a registry agent with its own Layer 1 and its own
  restricted memory scope (semantic only + entity model + tool registry).
- **Source:** L2390, L3476
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** Provisioning (REG.006).
- **Preconditions:** Registry exists.
- **Behaviour:**
  - Happy path: the orchestrator has a row in `agents` (or an equivalent registry record) with `memory_scope` =
    semantic + entity model + tool registry, and its Layer 1 in `prompt_layers` (OD-075).
  - Branches: —
  - Edge / failure: the orchestrator never receives episodic/procedural memory or business-entity content beyond its
    scope (containment; SCO.001).
- **Data touched:** `agents`, `prompt_layers` (read).
- **Permissions:** edited per OD-080.
- **Config dependencies:** —
- **Surfaces:** N/A.
- **Observability:** orchestrator version changes audited (REG.004).
- **Acceptance criteria:**
  - AC-8.ORC.008.1 — Given the deployment is provisioned, When the registry is read, Then the orchestrator is present
    with the L3476 memory scope and a `prompt_layers` Layer 1.
  - AC-8.ORC.008.2 — Given a task, When the orchestrator runs, Then it cannot read memory outside its scope (enforced
    by the SCO.001 agent-scope retrieval filter — **OD-081**).
- **Open decisions:** OD-075, **OD-081**.
- **Feasibility assumptions:** —
- **Notes:** _(M5)_ The orchestrator runs on the `service_role` (RLS-bypass) path, so its containment rests **entirely**
  on the `memory_scope` filter of SCO.001 — making OD-081's wiring especially load-bearing for the most broadly
  exposed agent (it sees every task). Until OD-081 lands, the orchestrator's scope narrowing is owed.

### Area REG — Agent registry

#### FR-8.REG.001 — The `agents` registry table
- **Statement:** The system shall store all agents in a single `agents` registry table carrying the columns required
  to discover, route to, scope, version, and audit each agent.
- **Source:** L3499–3517
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Provisioning + registry edits.
- **Preconditions:** Schema migrated.
- **Behaviour:**
  - Happy path: columns = `id`, `name` ('{client_slug}_<role>_agent' — the slug is part of the human-readable name
    string only), `description`, `memory_scope` (json), `tools_allowed` (uuid[]), `max_tokens`, `enabled`,
    `version`, `created_at`/`updated_at`, `created_by`, `previous_version_id`, `change_reason`. **`system_prompt` is
    removed / derived** (OD-075). **The design doc's `client_slug` column is dropped intra-silo** (ADR-001 §3 — there
    is exactly one client per silo; mirrors C7 OD-067 which dropped it from `event_log`).
  - Branches: —
  - Edge / failure: a row missing a required column (e.g. empty `description`) is rejected at write (vague
    description = wrong routing, L3419).
- **Data touched:** `agents` (DDL).
- **Permissions:** OD-080.
- **Config dependencies:** —
- **Surfaces:** registry editor (Phase 3).
- **Observability:** every write audited (REG.004).
- **Acceptance criteria:**
  - AC-8.REG.001.1 — Given the schema, When inspected, Then it carries all listed columns and **no** `system_prompt`
    storage column (OD-075).
  - AC-8.REG.001.2 — Given an insert with an empty `description`, When attempted, Then it is rejected.
  - AC-8.REG.001.3 — Given the silo model, When the `agents` schema is inspected, Then there is **no** `client_slug`
    column (dropped intra-silo, ADR-001 §3 + C7 OD-067) — the slug survives only inside the `name` string.
- **Open decisions:** OD-075.
- **Feasibility assumptions:** —

#### FR-8.REG.002 — Layer 1 resolves from `prompt_layers`, not `agents.system_prompt` (closes OD-048)
- **Statement:** The system shall resolve each agent's Layer 1 from `prompt_layers` keyed by `agent_id`
  (`layer='core'`), with no duplicate authoritative copy stored on the agent row.
- **Source:** OD-048 (resolved), L3504, L2458–2469
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Prompt assembly (C5) reading an agent's Layer 1.
- **Preconditions:** `prompt_layers` is the single store (C4 FR-4.STO.*).
- **Behaviour:**
  - Happy path: assembly fetches Layer 1 from `prompt_layers WHERE agent_id = ? AND layer='core'`; the `agents` row
    references the agent only by `id`.
  - Branches: legacy/migrated rows with a populated `system_prompt` are migrated into `prompt_layers` and the column
    dropped (one-time migration, Phase 4/6).
  - Edge / failure: if no `core` layer exists for an agent, assembly halts (C4 FR-4.LYR.004) — never assembles from a
    stale/absent prompt.
- **Data touched:** `prompt_layers` (read), `agents` (read).
- **Permissions:** principle/prompt edits per C4 OD-049; agent capability edits per OD-080.
- **Config dependencies:** —
- **Surfaces:** N/A.
- **Observability:** —
- **Acceptance criteria:**
  - AC-8.REG.002.1 — Given an agent, When its Layer 1 is needed, Then it is read from `prompt_layers` by `agent_id` —
    there is exactly one authoritative store.
  - AC-8.REG.002.2 — Given the migration runs, When complete, Then no `agents.system_prompt` value remains as a
    second source of truth.
- **Open decisions:** OD-075.
- **Feasibility assumptions:** —
- **Notes:** This is the C8 reconciliation OD-048 deferred here.

#### FR-8.REG.003 — Add a specialist by inserting a row; auto-discovered
- **Statement:** The system shall make adding a new specialist a matter of inserting an enabled registry row, which
  the orchestrator discovers automatically with no code change.
- **Source:** L3519
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Super Admin (OD-080) adding an agent.
- **Preconditions:** Valid row (REG.001).
- **Behaviour:**
  - Happy path: insert row with `enabled=true` → next routing pass includes it as a candidate.
  - Branches: insert with `enabled=false` → present but not routed (REG.005).
  - Edge / failure: malformed row rejected (REG.001).
- **Data touched:** `agents` (write).
- **Permissions:** OD-080.
- **Config dependencies:** —
- **Surfaces:** registry editor (Phase 3).
- **Observability:** audited.
- **Acceptance criteria:**
  - AC-8.REG.003.1 — Given a valid enabled row inserted, When the next task routes, Then the new agent is a candidate
    with no deployment/code change.
- **Open decisions:** OD-080.
- **Feasibility assumptions:** —

#### FR-8.REG.004 — Version discipline: immutable history, mandatory `change_reason`, audited
- **Statement:** The system shall version every agent change with a mandatory `change_reason`, a `previous_version_id`
  link, and an audit record, never overwriting prior versions in place.
- **Source:** L3510–3515
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Any registry edit.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: an edit creates a new version, increments `version`, sets `previous_version_id`, requires a non-empty
    `change_reason`, and writes an audit row.
  - Branches: capability-changing edits (scope/tools/enabled) are flagged as authority changes (OD-080).
  - Edge / failure: edit without `change_reason` rejected.
- **Data touched:** `agents` (write), audit.
- **Permissions:** OD-080.
- **Config dependencies:** —
- **Surfaces:** version history (Phase 3).
- **Observability:** every version audited; capability changes flagged for review.
- **Acceptance criteria:**
  - AC-8.REG.004.1 — Given an edit without `change_reason`, When saved, Then it is rejected.
  - AC-8.REG.004.2 — Given an edit, When saved, Then a new version with `previous_version_id` is created and the prior
    version remains retrievable.
- **Open decisions:** OD-080.
- **Feasibility assumptions:** —

#### FR-8.REG.005 — `enabled` gates discovery
- **Statement:** The system shall route only to agents with `enabled = true`; a disabled agent is retained but never
  a routing candidate.
- **Source:** L3508, L3398–3401
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Routing (ORC.003) + registry edits.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: `enabled=false` removes the agent from candidacy without deleting its definition/history.
  - Branches: disabling an agent with in-flight tasks does not abort them mid-run (C5 owns in-flight); new routing
    excludes it.
  - Edge / failure: disabling the last agent able to serve a domain → tasks in that domain hit low-confidence
    clarification (ORC.006), never silent failure.
- **Data touched:** `agents`.
- **Permissions:** OD-080 (enable/disable = capability change → Super Admin).
- **Config dependencies:** —
- **Surfaces:** registry editor.
- **Observability:** enable/disable audited.
- **Acceptance criteria:**
  - AC-8.REG.005.1 — Given an agent disabled, When routing runs, Then it is excluded and its row/history persists.
  - AC-8.REG.005.2 — Given a domain loses its only enabled agent, When such a task arrives, Then it routes to
    clarification, not to a silent drop.
  - AC-8.REG.005.3 — Given an operator disables the **sole enabled agent** for a domain, When the edit is made, Then a
    warning is surfaced at disable-time (the operator learns before the next task stalls, not after). _(L9)_
- **Open decisions:** OD-080.
- **Feasibility assumptions:** —

#### FR-8.REG.006 — Seed the canonical roster + orchestrator at provisioning
- **Statement:** The system shall seed the orchestrator and the eight canonical specialist agents into the registry
  at deployment provisioning, after which the registry is authoritative and operator-editable.
- **Source:** L3423–3439, ADR-005, C1 OD-030 (pattern)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Scripted provisioning (ADR-005).
- **Preconditions:** Schema migrated; `prompt_layers` seeded (C4).
- **Behaviour:**
  - Happy path: provisioning inserts orchestrator + Research/Client/Campaign/Comms/Ops/Memory/Finance/Insight with
    their descriptions, `memory_scope` (SCO matrix), `tools_allowed`, and `enabled` defaults.
  - Branches: operator may edit/extend/disable after seeding (REG.003/005).
  - Edge / failure: a partial seed is detected and re-run idempotently (never a half-provisioned roster).
- **Data touched:** `agents` (write).
- **Permissions:** provisioning.
- **Config dependencies:** —
- **Surfaces:** N/A.
- **Observability:** seed logged.
- **Acceptance criteria:**
  - AC-8.REG.006.1 — Given a freshly provisioned deployment, When the registry is read, Then the orchestrator + 8
    specialists exist with their SCO scopes.
  - AC-8.REG.006.2 — Given provisioning is interrupted, When re-run, Then it converges to the full roster without
    duplicates (idempotent).
  - AC-8.REG.006.3 — Given the seed roster, When verified, Then the Comms Agent's `tools_allowed` **excludes** any
    autonomous-send tool and the Finance Agent's **excludes** any transaction tool (a positive seed-time check of the
    SPC.003/SPC.004 negative invariants). _(M6)_
- **Open decisions:** OD-079.
- **Feasibility assumptions:** —

### Area SPC — Specialist roster & hard limits

#### FR-8.SPC.001 — Eight single-domain specialists, each owning one job
- **Statement:** The system shall define each specialist agent with a single-domain responsibility and a description
  precise enough to route to (Research, Client, Campaign, Comms, Ops, Memory, Finance, Insight).
- **Source:** L3423–3439
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Provisioning (REG.006) + routing.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: each specialist's `description` states its one domain (the basis of routing); roles per L3425–3439.
  - Branches: a domain needing a new specialist → add a row (REG.003).
  - Edge / failure: an over-broad description degrades routing → surfaced via the routing-mismatch metric (LRN.002).
- **Data touched:** `agents`.
- **Permissions:** OD-080.
- **Config dependencies:** —
- **Surfaces:** registry editor.
- **Observability:** routing outcomes per agent (HLTH.001).
- **Acceptance criteria:**
  - AC-8.SPC.001.1 — Given the seed roster, When inspected, Then all eight specialists exist, each with a
    single-domain description.
- **Open decisions:** OD-079.
- **Feasibility assumptions:** AF-121.

#### FR-8.SPC.002 — Research Agent is read-only and called first
- **Statement:** The system shall define the Research Agent as read-only (never writes) and place it first in any
  chain that requires information gathering.
- **Source:** L3425
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Plan building (ORC.005).
- **Preconditions:** —
- **Behaviour:**
  - Happy path: when a plan needs gathered context, Research runs first and its output seeds `previous_outputs`.
  - Branches: a task needing no gathering may skip Research.
  - Edge / failure: Research has no write tools (`tools_allowed` read-only) — it cannot mutate memory or call action
    tools.
- **Data touched:** memory (read).
- **Permissions:** read-only scope (SCO.001).
- **Config dependencies:** result cache window for Research (LRN.003, L953).
- **Surfaces:** N/A.
- **Observability:** —
- **Acceptance criteria:**
  - AC-8.SPC.002.1 — Given a chain needing gathered context, When planned, Then Research is the first step.
  - AC-8.SPC.002.2 — Given the Research Agent, When inspected, Then it holds no write/action tools.
- **Open decisions:** —
- **Feasibility assumptions:** —

#### FR-8.SPC.003 — Comms Agent never sends autonomously; outputs to the approval queue
- **Statement:** The system shall ensure the Comms Agent drafts external communications and routes every output to
  the dashboard approval queue, never sending autonomously.
- **Source:** L3431
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** A comms task.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: Comms produces a draft → routed to the approval queue (C6 FR-6.APR.*); a human approves before send
    (C3 send tool).
  - Branches: —
  - Edge / failure: Comms holds **no** autonomous-send tool (`tools_allowed` excludes it, C3 FR-3.ACT.*) — defense in
    depth: prompt (this FR) + missing tool (C3) + approval gate (C6).
- **Data touched:** approval queue.
- **Permissions:** send is human-gated.
- **Config dependencies:** —
- **Surfaces:** approval queue (Phase 3, C7).
- **Observability:** every draft + approval logged.
- **Acceptance criteria:**
  - AC-8.SPC.003.1 — Given a comms output, When produced, Then it lands in the approval queue, not an outbound send.
  - AC-8.SPC.003.2 — Given the Comms Agent, When inspected, Then it has no autonomous-send tool.
  - AC-8.SPC.003.3 — Given a registry edit that would add an autonomous-send tool to the Comms Agent's
    `tools_allowed`, When written, Then it is **rejected at write** (a code-level deny, not merely an audited
    capability change) — the "never sends autonomously" limit is a negative invariant, not just policy. _(M6)_
- **Open decisions:** —
- **Feasibility assumptions:** —

#### FR-8.SPC.004 — Finance Agent never initiates transactions (hard limit + scoped clearance)
- **Statement:** The system shall ensure the Finance Agent is read-heavy, never initiates transactions, and holds
  Confidential clearance scoped to finance entities only.
- **Source:** L3437, L3474, ADR-007 hard limits
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** A finance task.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: Finance reads invoice/retainer/payment status and flags; output is a summary/flag, never a
    transaction.
  - Branches: a payment action is surfaced as a flag for a human, never executed.
  - Edge / failure: Finance holds **no** transaction tool (C3) and the "never initiate transactions" hard limit is
    enforced in code (C6 FR-6.HRD.*) — prompt + tool-absence + hard-limit, three layers.
- **Data touched:** finance memory (read, Confidential scope).
- **Permissions:** Confidential clearance, finance-entity scoped (C1 FR-1.CLR.*).
- **Config dependencies:** —
- **Surfaces:** N/A.
- **Observability:** —
- **Acceptance criteria:**
  - AC-8.SPC.004.1 — Given the Finance Agent, When inspected, Then it holds no transaction-initiating tool and its
    clearance is finance-scoped Confidential.
  - AC-8.SPC.004.2 — Given a task implies a payment, When Finance handles it, Then it produces a flag for a human —
    never a transaction (cross-ref C6 hard limit, AF-068).
  - AC-8.SPC.004.3 — Given a registry edit that would add a transaction-initiating tool to the Finance Agent's
    `tools_allowed`, When written, Then it is **rejected at write** (code-level deny, not merely an audited
    capability change) — "never initiates transactions" is a negative invariant. _(M6)_
- **Open decisions:** —
- **Feasibility assumptions:** AF-068 (hard-limit containment red-team).

#### FR-8.SPC.005 — Memory Agent is the sole agent identity for the C2 write flow
- **Statement:** The system shall route all memory writes through the Memory Agent, which invokes the C2 sole-writer
  flow; other agents hand raw events to it and never write memory directly.
- **Source:** L3435, ADR-004
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** End-of-task memory write (L3540) or consolidation.
- **Preconditions:** C2 write flow (FR-2.WRT.*) exists.
- **Behaviour:**
  - Happy path: a specialist emits a raw event → hands it to the Memory Agent → Memory Agent runs the C2 ingestion
    filters + write flow (the single `service_role` writer, ADR-004).
  - Branches: consolidation + verification-queue management also run via the Memory Agent.
  - Edge / failure: no other agent has memory-write tools in `tools_allowed` (SCO matrix) — preserves ADR-004's
    single writer (#1: no competing writers corrupting memory).
- **Data touched:** memory (write, via C2).
- **Permissions:** Memory Agent = full read/write scope (SCO.MEMORY); all others read-only to memory.
- **Config dependencies:** —
- **Surfaces:** verification queue (C2/Phase 3).
- **Observability:** writes audited by C2.
- **Acceptance criteria:**
  - AC-8.SPC.005.1 — Given any specialist produces a memory-worthy event, When written, Then the write occurs only
    via the Memory Agent invoking the C2 flow.
  - AC-8.SPC.005.2 — Given the registry, When `tools_allowed` is inspected, Then only the Memory Agent has
    memory-write capability (consistent with ADR-004 single writer).
- **Open decisions:** —
- **Feasibility assumptions:** —

#### FR-8.SPC.006 — Insight Agent runs on the slow loop, read-only, feeding the proactive layer
- **Statement:** The system shall run the Insight Agent only on the slow loop (not on demand), read-only across all
  memory and activity, producing patterns/risks/opportunities for the proactive-intelligence and self-improvement
  layers.
- **Source:** L3439, L3475
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** Slow loop (C5 FR-5.LOP.001).
- **Preconditions:** —
- **Behaviour:**
  - Happy path: on the slow loop, Insight reads broadly (no writes) and emits findings consumed by C9.
  - Branches: not invocable as an on-demand specialist in a normal routing chain.
  - Edge / failure: Insight holds no write tools.
- **Data touched:** all memory (read).
- **Permissions:** read-all, no-write (SCO.INSIGHT).
- **Config dependencies:** slow-loop schedule (L940).
- **Surfaces:** self-improvement panel (C7/C9, Phase 3).
- **Observability:** runs logged.
- **Acceptance criteria:**
  - AC-8.SPC.006.1 — Given the slow loop fires, When Insight runs, Then it reads broadly and writes nothing.
  - AC-8.SPC.006.2 — Given an on-demand task, When routing runs, Then Insight is not selected as a chain specialist.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Forward seam → C9 consumes Insight output.

### Area SCO — Memory scoping per agent

#### FR-8.SCO.001 — Per-agent memory scope is applied as a least-privilege retrieval filter
- **Statement:** The system shall apply each agent's `memory_scope` (memory types + entity classes) as an additional
  retrieval filter — passed by the run pipeline into the C2 read flow on every agent invocation — so an agent
  receives only in-scope memory, denying anything outside its scope by default.
- **Source:** L3464–3479
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Any agent reading memory.
- **Preconditions:** `memory_scope` defined (REG.001); the run-pipeline→C2 read invocation accepts an agent-scope
  predicate (**OD-081** — the cross-component wiring this FR depends on).
- **Behaviour:**
  - Happy path: the scope matrix (L3467–3476) governs each agent: Research read-all; Client semantic+episodic for
    client/contact; Campaign semantic+episodic+procedural for campaign; Comms semantic for brand/contact prefs; Ops
    procedural SOPs + semantic team + Internal Org; Memory full r/w; Finance semantic contract/invoice only; Insight
    read-all no-write; Orchestrator semantic + entity model + tool registry. The **consumer** of `memory_scope` is the
    C5 run pipeline (FR-5.ASM.006), which passes the running agent's scope into the C2 read flow (FR-2.RET.004)
    **in addition to** the task clearance + task entities C2 already filters on.
  - Branches: an agent requesting out-of-scope memory gets nothing (not an error that leaks existence).
  - Edge / failure: scope misconfiguration is surfaced (drift/health), never silently widened. **If the agent-scope
    predicate is not applied (the wiring is absent or fails), retrieval fails closed — the agent gets nothing rather
    than the full clearance-only set** (least-privilege on failure).
- **Data touched:** memory (read), `agents.memory_scope`.
- **Permissions:** scope changes = Super Admin (OD-080).
- **Config dependencies:** —
- **Surfaces:** N/A.
- **Observability:** out-of-scope access attempts logged.
- **Acceptance criteria:**
  - AC-8.SCO.001.1 — Given an agent, When it retrieves memory, Then the run pipeline passes its `memory_scope` into
    the C2 read flow and only in-scope types+entities are returned (the scope is a real retrieval filter, not just a
    registry annotation).
  - AC-8.SCO.001.2 — Given an out-of-scope request, When made, Then it returns empty without revealing the
    existence of the out-of-scope memory.
  - AC-8.SCO.001.3 — Given the agent-scope predicate is not applied (wiring missing/failed), When an agent retrieves,
    Then retrieval fails closed (returns nothing), never silently widening to the clearance-only set.
- **Open decisions:** OD-080, **OD-081**.
- **Feasibility assumptions:** —
- **Notes:** OD-081 (the cross-component wiring this FR rests on) is **RESOLVED + applied this session** via
  change-control — C5 **AC-5.ASM.006.2** (harness passes the agent's `memory_scope` into the C2 read, fails closed)
  + C2 **AC-2.RET.004.2** (C2 drops out-of-agent-scope candidates before ranking). The SCO area's least-privilege is
  now executable, not asserted-only (closed the verification-gate H1 finding).

#### FR-8.SCO.002 — Sensitivity clearance applies on top of memory scope
- **Statement:** The system shall apply task-context sensitivity clearance (C1/C2) on top of an agent's memory
  scope, so scope never grants access above the task's clearance.
- **Source:** L3468, L3479, C1 FR-1.CLR.*/RST.*
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Any agent reading memory.
- **Preconditions:** Clearance model (C1/C2) in force.
- **Behaviour:**
  - Happy path: effective access = `memory_scope` ∩ task clearance; clearance-before-ranking (C2 FR-2.RET.004) runs
    regardless of scope.
  - Branches: Restricted memory is never auto-injected (C2 FR-2.RET.006 / C1 FR-1.RST.003) even for read-all agents
    (Research/Insight).
  - Edge / failure: above-clearance content in an assembled context = containment breach → halt-and-audit (C4
    FR-4.INJ.003 / AC-4.INJ.003.3).
- **Data touched:** memory (read).
- **Permissions:** C1 clearance.
- **Config dependencies:** —
- **Surfaces:** N/A.
- **Observability:** clearance denials logged.
- **Acceptance criteria:**
  - AC-8.SCO.002.1 — Given a read-all agent (Research), When the task clearance is below a memory's sensitivity, Then
    that memory is excluded.
  - AC-8.SCO.002.2 — Given Restricted memory, When any agent retrieves, Then it is never auto-injected (C2 FR-2.RET.006 / C1 FR-1.RST.003).
- **Open decisions:** —
- **Feasibility assumptions:** —

#### FR-8.SCO.003 — Memory scope is defined in the registry, not in code
- **Statement:** The system shall define every agent's memory scope as registry data (`memory_scope` json), so scope
  changes are data edits, not code changes.
- **Source:** L3479, L3505
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Registry edit.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: editing `memory_scope` (Super Admin, OD-080) changes the agent's access on the next run.
  - Branches: —
  - Edge / failure: an invalid scope spec is rejected at write.
- **Data touched:** `agents.memory_scope`.
- **Permissions:** OD-080.
- **Config dependencies:** —
- **Surfaces:** registry editor.
- **Observability:** scope changes audited as capability changes (REG.004 / OD-080).
- **Acceptance criteria:**
  - AC-8.SCO.003.1 — Given a `memory_scope` edit, When saved, Then the new scope governs the next run with no code
    change.
- **Open decisions:** OD-080.
- **Feasibility assumptions:** —

### Area PLAN — Execution plan & failure-mode assignment

#### FR-8.PLAN.001 — Assign a failure mode to every step upfront
- **Statement:** The system shall assign one of {retry, skip-and-continue, halt-and-escalate} to every step of an
  execution plan at plan-build time, never deciding the mode at failure time.
- **Source:** L3410, L3483–3491
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Orchestrator, plan build (ORC.005).
- **Preconditions:** Plan structure exists.
- **Behaviour:**
  - Happy path: each step carries a failure mode; C5 *executes* the mode on failure (retry-with-backoff /
    skip+log+flag / halt+escalate+preserve-envelope).
  - Branches: criticality of a step's output drives the mode (required → halt; non-critical → skip).
  - Edge / failure: see PLAN.002 default.
- **Data touched:** execution plan (in envelope, C5).
- **Permissions:** N/A.
- **Config dependencies:** retry limits (C5).
- **Surfaces:** N/A.
- **Observability:** assigned modes logged with the plan.
- **Acceptance criteria:**
  - AC-8.PLAN.001.1 — Given a built plan, When inspected, Then every step has an assigned failure mode.
  - AC-8.PLAN.001.2 — Given a step fails at runtime, When handled, Then C5 applies the *pre-assigned* mode — the mode
    is never chosen at failure time.
- **Open decisions:** —
- **Feasibility assumptions:** —

#### FR-8.PLAN.002 — Default to halt-and-escalate when no mode is assigned
- **Statement:** The system shall default any step lacking an explicit failure mode to halt-and-escalate.
- **Source:** L3493
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Plan build / execution.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: an unassigned step is treated as halt-and-escalate (fail safe, #3 — never silently skipped).
  - Branches: —
  - Edge / failure: —
- **Data touched:** execution plan.
- **Permissions:** N/A.
- **Config dependencies:** —
- **Surfaces:** N/A.
- **Observability:** default application logged.
- **Acceptance criteria:**
  - AC-8.PLAN.002.1 — Given a step with no failure mode, When it fails, Then the chain halts and escalates (never
    silently continues).
  - AC-8.PLAN.002.2 — Given a halt-and-escalate event (assigned or defaulted), When the escalation goes unattended,
    Then it inherits the same **staleness-escalation** guarantee as the clarification path (OD-077 / C5
    AC-5.QUE.005.2) — an unattended halt re-escalates rather than parking unseen. _(L10)_
- **Open decisions:** —
- **Feasibility assumptions:** —

#### FR-8.PLAN.003 — Enforce the chain-depth limit at plan-build time
- **Statement:** The system shall reject or trim any plan that would exceed the configurable chain-depth limit,
  lowering routing confidence rather than spawning an unbounded chain.
- **Source:** L3605, L948
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Plan build (ORC.005).
- **Preconditions:** `chain_depth_limit` configured (default 6).
- **Behaviour:**
  - Happy path: a plan within the limit proceeds.
  - Branches: a plan exceeding the limit is trimmed/rejected and the task drops to low-confidence clarification
    (ORC.006).
  - Edge / failure: never silently truncate a chain mid-execution (the limit is a build-time gate).
- **Data touched:** execution plan, `event_log`.
- **Permissions:** N/A.
- **Config dependencies:** CFG-chain_depth_limit (L948).
- **Surfaces:** N/A.
- **Observability:** depth-limit hits logged (cost signal).
- **Acceptance criteria:**
  - AC-8.PLAN.003.1 — Given a plan exceeding `chain_depth_limit`, When built, Then it is not executed as-is; it is
    trimmed/rejected and surfaced.
- **Open decisions:** —
- **Feasibility assumptions:** —

#### FR-8.PLAN.004 — Version execution plans per task type; human-decided rollback
- **Statement:** The system shall version execution plans for common task types, attribute outcome shifts to plan
  versions, and support human-decided rollback to a prior plan version.
- **Source:** L3646
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** Plan creation (ORC.007) + a human reviewing outcomes.
- **Preconditions:** Outcome tracking (ORC.007).
- **Behaviour:**
  - Happy path: a recurring task type has a versioned plan; outcomes attribute to the version; a human may roll back.
  - Branches: a new plan version supersedes but never deletes the prior (audit).
  - Edge / failure: **rollback is human-decided** — no automatic rollback (OOS-030, consistent with OD-010).
- **Data touched:** execution-plan store, `event_log`.
- **Permissions:** rollback = OD-080 (Super Admin/Admin per the split).
- **Config dependencies:** —
- **Surfaces:** plan-version history (Phase 3 / C7).
- **Observability:** version→outcome attribution logged.
- **Acceptance criteria:**
  - AC-8.PLAN.004.1 — Given a common task type, When plans change, Then outcomes are attributable to plan versions.
  - AC-8.PLAN.004.2 — Given a rollback, When performed, Then it is human-initiated and audited — never automatic.
- **Open decisions:** —
- **Feasibility assumptions:** AF-126.

### Area HLTH — Agent health, drift & dead-agent metric production

#### FR-8.HLTH.001 — Produce per-agent health metrics (success/failure rate, last run)
- **Statement:** The system shall produce per-agent health metrics — success rate, failure rate, and last-run — from
  task outcomes, for the observability layer to surface.
- **Source:** L3589, L3217, L3578
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Continuous, from outcome tracking (ORC.007).
- **Preconditions:** Outcomes recorded.
- **Behaviour:**
  - Happy path: aggregate outcomes per agent into health metrics; expose to C7 (which polls ~60s, L3217).
  - Branches: a high failure rate (e.g. the L3578 "40%") is a surfaced suggestion (via C7/C9), not auto-acted.
  - Edge / failure: C8 produces the metric; it does not render it or decide on it.
- **Data touched:** `event_log` (read outcomes), metric store.
- **Permissions:** N/A.
- **Config dependencies:** —
- **Surfaces:** agent-health panel (C7, Phase 3).
- **Observability:** metrics are themselves observability output.
- **Acceptance criteria:**
  - AC-8.HLTH.001.1 — Given agent task outcomes, When aggregated, Then success/failure rate + last-run are available
    to C7.
  - AC-8.HLTH.001.2 — Given a high failure rate, When detected, Then it is surfaced (C7/C9), not auto-corrected (OD-078).
- **Open decisions:** OD-078.
- **Feasibility assumptions:** AF-124.

#### FR-8.HLTH.002 — Produce specialisation-drift detection metric (flag, never auto-correct)
- **Statement:** The system shall periodically validate each agent is operating within its intended scope and produce
  a drift signal that is flagged for human review, never auto-corrected.
- **Source:** L3642, L3563, L2847
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** Periodic (slow loop / scheduled).
- **Preconditions:** A scope definition + a behaviour signal.
- **Behaviour:**
  - Happy path: compare each agent's recent behaviour against its intended scope; emit a drift score; above the
    configurable threshold → flag for review.
  - Branches: prompt drift specifically → flagged, never auto-corrected (L3563 — too risky).
  - Edge / failure: the drift detector's own failure must surface (no silent loss of the signal, #3).
- **Data touched:** `event_log`, metric store.
- **Permissions:** N/A.
- **Config dependencies:** CFG-drift_threshold.
- **Surfaces:** agent-health / self-improvement panel (C7/C9).
- **Observability:** drift flags logged.
- **Acceptance criteria:**
  - AC-8.HLTH.002.1 — Given an agent drifting from its scope, When the periodic check runs, Then a drift flag is
    raised for human review and nothing is auto-changed.
  - AC-8.HLTH.002.2 — Given the drift check fails to run, When detected, Then its absence is surfaced (not silently
    green).
- **Open decisions:** OD-078.
- **Feasibility assumptions:** AF-123 (drift detection accuracy).

#### FR-8.HLTH.003 — Produce dead-agent detection metric (flag, never auto-disable)
- **Statement:** The system shall detect agents that consistently fail or produce low-quality output and flag them in
  the dashboard automatically, without auto-disabling them.
- **Source:** L3644
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** Continuous / periodic.
- **Preconditions:** A quality signal (OD-078: task success/failure + answer-mode pill + approval/rejection outcomes).
- **Behaviour:**
  - Happy path: above a configurable consistent-failure/low-quality threshold → flag for human attention.
  - Branches: a flagged ("dead") agent is **not** auto-disabled (auto-disable is an autonomous action; OD-078).
  - Edge / failure: false positives are tunable via the threshold (AF-124).
- **Data touched:** `event_log`, metric store.
- **Permissions:** N/A.
- **Config dependencies:** CFG-dead_agent_threshold.
- **Surfaces:** dashboard flag (C7).
- **Observability:** dead-agent flags logged.
- **Acceptance criteria:**
  - AC-8.HLTH.003.1 — Given an agent consistently failing/low-quality, When the threshold is crossed, Then it is
    flagged automatically.
  - AC-8.HLTH.003.2 — Given a flagged agent, When flagged, Then it remains enabled until a human decides (no
    auto-disable, OD-078).
- **Open decisions:** OD-078.
- **Feasibility assumptions:** AF-124.

#### FR-8.HLTH.004 — Metrics are produced here, surfaced and acted on elsewhere
- **Statement:** The system shall confine C8 to producing agent-health / drift / dead-agent / routing-outcome
  metrics, delegating their display to C7 and any suggestion/action to C9 + a human.
- **Source:** L3575–3592, L3217
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Metric production (HLTH.001–003, LRN.002).
- **Preconditions:** —
- **Behaviour:**
  - Happy path: C8 writes metrics; C7 polls/renders; C9 turns them into surfaced/guided suggestions; a human decides.
  - Branches: —
  - Edge / failure: C8 never auto-acts on a health/drift metric (the boundary that keeps "flag, never auto-correct"
    true).
- **Data touched:** metric store, `event_log`.
- **Permissions:** N/A.
- **Config dependencies:** —
- **Surfaces:** C7 panels (Phase 3).
- **Observability:** —
- **Acceptance criteria:**
  - AC-8.HLTH.004.1 — Given a health/drift/dead-agent metric, When produced, Then C8 takes no autonomous corrective
    action on it.
  - AC-8.HLTH.004.2 — Given any metric **producer** (HLTH.001 health aggregator, HLTH.003 dead-agent detector,
    LRN.002 routing-mismatch detector) **stalls or stops emitting**, When the staleness window passes, Then its
    *absence* is itself surfaced to C7 as a stale/heartbeat signal — a stalled producer is never silently shown as
    last-known-good green (mirrors HLTH.002.2 + the C5 AC-5.JOB.006.2 heartbeat pattern). _(H3)_
- **Open decisions:** OD-078.
- **Feasibility assumptions:** —

### Area LRN — Orchestrator learning & result caching

#### FR-8.LRN.001 — Refine routing from outcome tracking
- **Statement:** The system shall refine routing over time from tracked execution-plan outcomes (orchestrator
  learning).
- **Source:** L3572, L3640, L3416
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** Continuous, post-outcome (ORC.007).
- **Preconditions:** Outcome history.
- **Behaviour:**
  - Happy path: outcome signal adjusts routing scoring/selection so future routing of similar tasks improves.
  - Branches: learning adjustments are observable + reversible (not an opaque drift).
  - Edge / failure: a learning update that degrades routing is detectable via HLTH.001 + LRN.002.
- **Data touched:** routing model/weights, `event_log`.
- **Permissions:** N/A.
- **Config dependencies:** —
- **Surfaces:** routing-outcome trend (C7).
- **Observability:** routing changes attributable.
- **Acceptance criteria:**
  - AC-8.LRN.001.1 — Given outcome history, When learning runs, Then routing of similar future tasks reflects the
    feedback, and the adjustment is logged.
- **Open decisions:** —
- **Feasibility assumptions:** AF-126 (learning measurably improves routing).

#### FR-8.LRN.002 — Produce the routing-mismatch metric (consistently rerouted → description signal)
- **Statement:** The system shall detect task types that are consistently rerouted and surface that an agent
  description may need updating.
- **Source:** L3582, L2846
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** Continuous.
- **Preconditions:** Routing outcomes.
- **Behaviour:**
  - Happy path: a recurring reroute pattern for a task type → surface a "description may need updating" suggestion
    (via C7/C9).
  - Branches: —
  - Edge / failure: the fix is the **description** (data), never code (ORC.003).
- **Data touched:** `event_log`, metric store.
- **Permissions:** N/A.
- **Config dependencies:** —
- **Surfaces:** self-improvement panel (C7/C9).
- **Observability:** reroute patterns logged.
- **Acceptance criteria:**
  - AC-8.LRN.002.1 — Given a task type consistently rerouted, When detected, Then a description-update suggestion is
    surfaced.
- **Open decisions:** —
- **Feasibility assumptions:** AF-121.

#### FR-8.LRN.003 — Agent result caching with scope-aware, time-bounded invalidation
- **Statement:** The system shall cache and reuse recent agent outputs (per-agent configurable window) only while the
  underlying in-scope data is unchanged, invalidating on either window expiry or a write to any in-scope entity.
- **Source:** L3603, L3630, L952–960
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** Plan build / agent invocation.
- **Preconditions:** A cacheable agent (e.g. Research, L953) + cache window config.
- **Behaviour:**
  - Happy path: a cache entry keyed on (agent, in-scope entity ids, their last-write/memory version) is reused within
    its window if no in-scope entity changed.
  - Branches: window config per agent type (research 30 / client 60 / campaign 60 / comms 15 / ops 120 / finance
    120 / insight 1440, L952–960).
  - Edge / failure: **a write to any in-scope entity invalidates the entry** (OD-076) — the cache never serves stale
    knowledge (#1); on uncertainty, miss-and-recompute rather than risk a stale hit.
- **Data touched:** result cache, memory version (read).
- **Permissions:** N/A.
- **Config dependencies:** CFG-cache_time_window (per agent type, L952–960).
- **Surfaces:** N/A.
- **Observability:** cache hit/miss + invalidations logged (cost signal).
- **Acceptance criteria:**
  - AC-8.LRN.003.1 — Given a cached Research output and no in-scope entity change, When the same input recurs within
    the window, Then the cached output is reused.
  - AC-8.LRN.003.2 — Given an in-scope entity is written after caching, When the agent is next invoked, Then the
    cache is invalidated and recomputed — never a stale hit (OD-076, #1). The invalidation is **write-triggered by
    the Memory Agent's commit** (SPC.005 is the sole writer, so the commit is a single, nameable producer of the
    "entity X changed" signal) — not only a best-effort poll.
  - AC-8.LRN.003.3 — Given uncertainty about whether a write is in-scope for a cached entry (entity-extraction
    confidence below a floor, or a write to an *entity class* the cached agent reads but not the specific keyed id),
    When the agent is next invoked, Then it **misses and recomputes** rather than risk a stale hit — the
    blind-spot-fails-safe rule (closes the out-of-band-write / entity-not-in-key gap). _(M4)_
- **Open decisions:** **OD-076.**
- **Feasibility assumptions:** AF-125 (cache staleness safety — incl. the M4 races).

### Area COST — Cost routing by complexity

#### FR-8.COST.001 — Route by complexity tier (single / two-agent / full chain)
- **Statement:** The system shall map task complexity to a cost tier — single-agent (cheapest), two-agent chain
  (moderate), full chain (most expensive) — and prefer the cheapest tier that satisfies the task.
- **Source:** L3613–3617
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** Plan build (ORC.005).
- **Preconditions:** Classification (ORC.002).
- **Behaviour:**
  - Happy path: a simple task gets a single-agent route; complexity escalates the tier only as needed.
  - Branches: the confidence threshold prevents expensive chains on poorly specified tasks (COST.002).
  - Edge / failure: a chain never exceeds `chain_depth_limit` (PLAN.003).
- **Data touched:** execution plan, `event_log` (cost estimate).
- **Permissions:** N/A.
- **Config dependencies:** CFG-chain_depth_limit; routing weights.
- **Surfaces:** cost-by-task-type (C7).
- **Observability:** route tier logged for cost attribution.
- **Acceptance criteria:**
  - AC-8.COST.001.1 — Given a simple task, When routed, Then it takes the single-agent tier, not a full chain.
- **Open decisions:** —
- **Feasibility assumptions:** —

#### FR-8.COST.002 — The confidence threshold is the cost/quality dial
- **Statement:** The system shall treat the orchestrator confidence threshold as the primary configurable control
  that trades cost against quality by gating expensive chains on under-specified tasks.
- **Source:** L3606, L3620, L947
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Plan build / confidence check (ORC.006).
- **Preconditions:** Threshold configured (default 0.75).
- **Behaviour:**
  - Happy path: a low-confidence task is sent to clarification before an expensive chain runs (ORC.006).
  - Branches: raising the threshold reduces wasted spend but increases clarification load; lowering does the inverse —
    the single highest-leverage dial (L3620).
  - Edge / failure: the threshold change is per-deployment + audited.
- **Data touched:** CFG.
- **Permissions:** threshold edit per OD-080.
- **Config dependencies:** CFG-orchestrator_confidence_threshold (L947).
- **Surfaces:** N/A.
- **Observability:** threshold changes audited; clarification rate vs cost trend (C7).
- **Acceptance criteria:**
  - AC-8.COST.002.1 — Given the threshold is raised, When under-specified tasks arrive, Then more route to
    clarification and fewer expensive chains run.
- **Open decisions:** —
- **Feasibility assumptions:** AF-122.

#### FR-8.COST.003 — Emit the per-route cost model for C7 metering / C6 ladder
- **Statement:** The system shall record the cost-relevant shape of each routing decision (one call per orchestrator
  decision, one per specialist, up to three per memory-write event) so C7 can meter and C6 can apply the cost ladder.
- **Source:** L3598, ADR-003, OD-068
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Each routing/execution.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: the plan records its expected call profile; actual per-call cost is metered by C7 (estimate-grade,
    ADR-003); the cost ladder (throttle/kill) is enforced by C6 (the owed C6 cost-ladder FR, OD-068).
  - Branches: —
  - Edge / failure: C8 does not meter or enforce — it emits the routing-cost shape only (boundary).
- **Data touched:** `event_log` (cost shape).
- **Permissions:** N/A.
- **Config dependencies:** —
- **Surfaces:** cost dashboard (C7).
- **Observability:** the substrate for cost-per-task-type.
- **Acceptance criteria:**
  - AC-8.COST.003.1 — Given a routing decision, When made, Then its expected call profile is recorded for C7
    metering — C8 neither meters nor enforces the ladder (OD-068 boundary).
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Carry-in — the **C6 cost-ladder enforcement FR is still owed** (OD-068); C8 only feeds it.

---

## Seams out (named, not specced here)

| Design intent | Home | Why not C8 |
|---|---|---|
| Context envelope shape/travel/compression | **C5** FR-5.ENV.* | C5 owns the envelope mechanism; C8 populates `execution_plan` |
| Retry/skip/halt **execution**, backoff, DLQ, loop catch-up | **C5** FR-5.LOP./JOB.* | C8 assigns the mode; C5 executes it |
| Self-healing: orphan re-link, dup merge, expiry, hard-conflict, restricted | **C2** FR-2.MNT.* | memory mechanisms |
| Self-healing: connector auth refresh / non-refreshable auth | **C3** FR-3.TOK.* | connector auth |
| Self-improvement **panel**, improvement history, dashboards | **C7** + Phase 3 | display/rendering |
| Self-improvement **suggestion generation**, Insight output | **C9** | proactive intelligence |
| Cost **metering** + cost dashboard | **C7** | observability |
| Cost-ladder **enforcement** (throttle/kill) | **C6** (owed, OD-068) | guardrail enforcement |
| Layer-1 **content** + `prompt_layers` versioning | **C4** | prompt architecture |
| Anomaly baseline; approval tiers / auto-approve | **C6** | guardrails |
| RBAC + sensitivity clearance rules | **C1** | authorization |
| Parallel execution / warm-up / human checkpoints (execution) | **C5** | harness execution |
| Answer-mode pill rendering | **C7** (content C4) | observability/UI |

---

## Feasibility assumptions (block S — AF-121…AF-126)

| AF | Claim that needs testing | Method | Gates |
|----|--------------------------|--------|-------|
| **AF-121** | Description-driven routing routes correctly at acceptable accuracy (the core C8 premise, L3400/3419) | EVAL | the routing-quality claim (not the FR machinery) |
| **AF-122** | The orchestrator confidence score is calibrated — the threshold meaningfully separates good vs bad routing (L3620) | EVAL | ORC.006, COST.002 quality claim |
| **AF-123** | Specialisation drift can be detected reliably without excessive false positives (L3642) | EVAL | HLTH.002 detection claim |
| **AF-124** | The dead-agent / low-quality signal is reliable (L3644) | EVAL | HLTH.003 detection claim |
| **AF-125** | The scope-aware cache invalidation actually prevents stale-data reuse (OD-076) | SPIKE/EVAL | LRN.003 #1 staleness claim |
| **AF-126** | Outcome-driven orchestrator learning measurably improves routing over time (L3640) | EVAL | LRN.001, PLAN.004, ORC.007 improvement claim |

_None of AF-121…126 holds an FR from being `Approved` — each gates a quality/accuracy **claim**, not the FR
machinery (the gate analog of C4's AF-111 / C6's block-Q / C7's block-R)._
