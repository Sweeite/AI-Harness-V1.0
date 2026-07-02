# Component 5 — Agent Harness (what makes it *run*)

- **Status:** 🟢 **Approved 2026-06-26 (session 22)** — 43 FRs, verification gate run + reconciled; ODs
  **OD-054…OD-059** all resolved; feasibility **block P (AF-112…AF-115)** logged. Area codes:
  TRG ×5 · QUE ×6 · GRP ×4 · ENV ×3 · LOP ×5 · JOB ×7 · ASM ×9 · OPT ×4. C5 is the **execution layer**
  (what makes it run); enforcement → C6, observability → C7, orchestration → C8 are seams.
  *(Change-control 2026-06-27, session 27: +AC-5.TRG.001.3 — the C10 OD-091 **deployment-freeze gate**; the C5
  dispatch layer blocks every trigger/agent/loop/task dispatch + fails closed when `client_registry.status = frozen`.
  No prior FR/decision changed.)*
- **Sign-off:** ☑ **Approved 2026-06-26, user-authorized** — OD-056 + OD-059 (the two #2-touching calls)
  user-decided; OD-054/055/057/058 delegated to recommendation; gate clean on orphans/contradictions + all 11
  quality findings reconciled in-file. No build-time viability gate holds any C5 FR (AF-112…115 are build-time
  validations of the catch-up/parallel/compression/retention claims, not of the FR machinery).

> **Verification gate (2 zero-context subagents, 2026-06-26):**
> - **Orphan/contradiction pass — CLEAN.** No orphaned design lines (all L2493–2745 + L3329–3367 intents map;
>   observability→C7, ingestion-filter mechanism→C2, oversight→C6/C7 correctly seamed), no contradictions with
>   ADR-004/006/007, glossary, or consumed C0/C1/C2/C4 FRs, **all 6 traps PASS** (`client_slug` label-only · C5
>   never usurps C6 enforcement/anomaly-detection/approval-policy · mid-task re-check consumes C1 FR-1.RLS.007 ·
>   no Inngest/task_queue double-retry · citations spot-checked · `flagged` status reconciled). 2 cosmetic
>   miscites fixed (extraneous L2349/L2343 dropped).
> - **Quality/failure pass — 11 findings (3 HIGH, 5 MED, 3 LOW), ALL reconciled in-file:** **+FR-5.TRG.005**
>   (verified-event→task at-least-once, the C3→C5 seam-atomicity hole — H1); **+AC-5.JOB.005.2** (fan-out partial
>   failure never silent — H2); **+AC-5.QUE.005.2** (approval-wait staleness escalation, reusing C1 OD-028 / C2
>   OD-032 — H3); **+AC-5.GRP.003.2/.3** (crash-window key-before-side-effect ordering + collision-resistance —
>   M1/L2); **+AC-5.ASM.009.2** (durable chained-successor creation — M2); **retention clauses** on AC-5.ASM.005.1
>   + AC-5.QUE.003.2 (quarantine keeps work-in-progress — M3); **+AF-115** + FR-5.ENV.003 note (originals-store
>   retention lifetime — M4); **+AC-5.JOB.006.2** (C5-emitted DLQ-not-empty heartbeat — M5); **+AC-5.ASM.004.2**
>   (late-discovered approval need re-enters the gate — L1); **+AC-5.GRP.001.2** (graph-less task fails loudly at
>   creation — L3). Confirmed great-tier: the six resolved ODs land the hard #1/#2 calls (fresh-envelope
>   chaining, compression-with-retained-originals, single retry authority, no backfill stampede, step-level
>   approval/no-outrun).
- **What C5 is:** the **execution layer** — "memory, tools, and prompts give you a well-designed AI that sits
  there doing nothing; the agent harness is what makes it run" (L2497). C5 owns **triggering**, the **task
  queue** (the permanent audit record), **task graphs** (versioned multi-step sequences), the **context
  envelope** (the stateful task container), the **three loops**, the **Inngest** job-execution engine + dead
  letter queue, the **prompt-stack assembly + run pipeline** (assemble 4 layers → gate → execute step-by-step),
  and the **harness optimisations**.
- **What C5 is NOT (seams):** hard-limit / approval-gate **enforcement** + injection sanitization + anomaly
  detection → **C6 (Guardrails)**; observability / event-log / metrics sinks + alert delivery → **C7**;
  orchestrator routing / agent registry / multi-agent dispatch → **C8**; memory read/write **mechanisms** →
  **C2**; tool **execution** → **C3**; prompt-layer **content** → **C4**; RBAC/clearance **rules** → **C1**.
  C5 *sequences and invokes* these; it does not own their internals. Scope boundary confirmed with the operator
  at entry (2026-06-26): **strict — C5 calls, C6 enforces.**

- **Design-doc source:** `## 5. Agent Harness` = **L2493–2745** (next `## 6. Guardrails` at L2746); the
  **complete system loop** **L3329–3367** (end-to-end run pipeline + the three loops). Load-bearing blocks:
  task_queue schema **L2517–2535**, task graphs **L2541–2555**, loops **L2561–2575**, idempotency **L2579–2581**,
  dead letter **L2585–2587**, context envelope **L2591–2609**, optimisations **L2612–2620**, Inngest
  **L2624–2742**. C5 checklist overview **L278–286**.

---

## Context manifest (load only these)

- **ADR-003** (cost; "controls before gates") — loops **short-circuit in code** before the Sonnet orchestrator;
  per-step model calls (anomaly check, AI call) are token-cost levers; compression (FR-5.ENV.003) is an economy
  measure. The viability ladder (soft/throttle/kill) is the cost guardrail C5 **feeds** and **executes**: per
  **ADR-003 §"Guardrails component"** the cost ladder is a **C6 guardrail class** (sibling to the rate-limit
  ladder) — **C7 meters + signals** the breach, **C6 decides**, **C5 executes** the throttle/kill. *(Change-control
  correction, 2026-06-26 / C7 session 24: this line previously read "C5 feeds but C7 enforces" — corrected to match
  ADR-003 + C7 OD-068; see C7 FR-7.COST.003. No C5 FR/AC changed.)*
- **ADR-004** (concurrency — sole-writer `service_role` + per-entity validate-and-commit) — the harness runs
  background/agent work as `service_role`; memory writes within a task step go through the C2 sole-writer path,
  **not** a second writer. The Inngest **per-key concurrency** assumption underpins ADR-004 (AF-063).
- **ADR-005** (deploy/provisioning — Inngest cron functions registered at boot; expand-contract migrations) —
  loop/trigger registration is **config-driven at boot**, no code change (FR-5.LOP.002 / FR-5.TRG.002).
- **ADR-006 / `standards/rbac.md`** — the agent/background path is `service_role` (bypasses RLS); authorization
  on that path is **harness-enforced** (FR-5.ASM.004) with the **mid-task re-check** rule from C1 (below).
  `client_slug` on `task_queue` (L2530) is a **label, not an RLS key** — cross-client isolation is physical
  (ADR-001).
- **ADR-007** (containment-first injection posture) — every assembled Layer 1 carries the boundary instruction
  (C4 FR-4.CID.003); the **sanitization + anomaly detection mechanism** is C6. The harness *invokes* the
  per-step anomaly check (FR-5.ASM.007); it does not own detection.
- **standards/change-control.md** — task-graph versioning (never overwrite, increment, retain, mandatory
  reason) is the component-level expression of change control over a runtime-editable asset (FR-5.GRP.002),
  mirroring C4's prompt-version discipline.
- **standards/tool-integration-research.md / C3 dossiers** — webhook ingress (trigger source) uses each
  connector's verified signature scheme (Slack HMAC / GHL Ed25519 / Gmail OIDC-JWT / Drive·Calendar signed
  channel-token); auth is C0 FR-0.WHK.*, ingest receiver contract is C3 (durable-queue→2xx, dedup).
- **Consumed from C0:** FR-0.WHK.001–005 (webhook authentication — the verified ingress that fires an
  event trigger). **Consumed from C1:** **FR-1.RLS.007 / OD-031** (mid-task authorization re-check on the
  `service_role` path — C5 implements the machinery C1 ruled on), FR-1.CLR.006 (clearance-before-ranking).
  **Consumed from C2:** the memory **read flow** (entity extraction → dual search → filter → rank → inject,
  FR-2.RET.*) and the sole-writer **write flow** (FR-2.WRT.*); answer-mode pill (FR-2.RET.007). **Consumed from
  C3:** the tool runtime (tool read/write calls, FR-3.ACT.*), the webhook **receiver contract** (FR-3.TRIG.*),
  rate-limit ladder. **Consumed from C4:** the four prompt layers + version pinning (FR-4.LYR.001/003,
  FR-4.STO.006) and the **assembly-time safety validation** (FR-4.LYR.004) that executes here.
- **Glossary:** task queue, task graph, context envelope, fast/medium/slow loop, dead letter queue,
  idempotency key, fan-out, Inngest, prompt-stack assembly, answer mode, `service_role`.
  *(New terms this component adds are listed in the stubs section.)*

---

## Area codes

| Code | Area | What it covers |
|---|---|---|
| **TRG** | Triggering | The four trigger types (event/scheduled/human/chained); config-defined trigger registry |
| **QUE** | Task queue & lifecycle | `task_queue` schema, status state machine, priority, approval state, error/audit record |
| **GRP** | Task graphs | Versioned multi-step graphs, step dependencies, idempotency keys, resume-from-failure |
| **ENV** | Context envelope | The stateful per-task container, step-output accumulation, inter-step compression |
| **LOP** | Loop architecture | The three default loops, configurable cadences, config-extensibility, catch-up/overlap, failure alert |
| **JOB** | Job execution (Inngest) | Inngest as engine, step-level retry, fan-out, idempotency, dead letter queue, v1 hosting |
| **ASM** | Assembly & run pipeline | Assemble the 4 layers → version-pin → safety-validate → gate-sequence → execute step-by-step → pill → complete |
| **OPT** | Optimisations | Parallel-step execution, smart scheduling, task decomposition, chained-task pre-warm |

---

## Doc-reconciliation notes (carried into the FRs)

1. **`client_slug` on `task_queue` (L2530) is a label, not an RLS key** — mirrors the C0–C4 reconciliation.
   Cross-client isolation is physical (ADR-001); no RLS policy keys on it. The agent/background path is
   `service_role` and bypasses RLS regardless.
2. **The mid-task authorization re-check is already decided** — the design's system loop checks RBAC/clearance
   **once** before execution (L3341), but C1 **FR-1.RLS.007 / OD-031** already ruled that a `service_role` task
   re-checks the originating user's active status + relied-on clearances **at each step/injection boundary** and
   halts+quarantines before the next consequential side effect (benign session-expiry continues). C5 **implements
   that machinery** (FR-5.ASM.005); it does not re-open the decision.
3. **`'flagged'` status vs the task_queue enum** — the schema enum is
   `pending | running | awaiting_approval | completed | failed` (L2523), but the guardrails section sets a task's
   status to `'flagged'` on a guardrail hit (L2870, C6). The enum and its usage must reconcile → **OD-054** (C5
   owns the schema/state machine; C6 sets the value).
4. **Inngest retry vs `task_queue.attempts`** — Inngest has built-in retry/backoff/DLQ (L2646–2648) **and** the
   task_queue has `attempts` / `next_retry_at` (L2528–2529). Two independent retry loops would double-execute →
   **OD-058** (Inngest is the execution authority; task_queue is the audit projection).
5. **Anomaly check is invoked here, owned in C6** — the per-step order "anomaly check → tool read → AI call →
   tool write → memory write" (L3346) is the harness's step loop; the **detection mechanism + thresholds** are
   C6 (Guardrails Layer 3). The harness owns *that the check runs at the step boundary*; its **cadence**
   (per-task vs per-step vs per-AI-call) is flagged as a cost/efficiency note seamed to C6 + ADR-003 (see seam
   note at FR-5.ASM.007).
6. **Answer-mode pill: attached here, rendered in C8** — the harness ensures every substantive AI output carries
   a Cited/Inferred/Unknown pill (L3347); the **rendering** is C5/C8 and the **said-vs-did accuracy** of the
   pill is the **⚠️ AF-033** evaluation gap (C7/C8), not a C5 mechanism.

---

## Seams (do not double-spec)

| Concern | Owner | C5's relationship |
|---|---|---|
| Hard-limit / approval-gate **enforcement**; the three approval tiers; injection sanitization; **anomaly detection** + thresholds | **C6** | C5 *invokes* the check at the step boundary (FR-5.ASM.007) and *records* the resulting state (OD-054); C6 owns the policy + mechanism |
| Approval **routing** (which person approves which task by context) | **C6** | C5 moves a `requires_approval` task to `awaiting_approval` and blocks (FR-5.QUE.005); C6 owns the routing rules |
| **Event-log** sink, metrics, alert **delivery**, ops-dashboard rendering, cost **meter + ladder signal** | **C7** | C5 *emits* run/loop/DLQ events + completion records (FR-5.LOP.005, FR-5.JOB.006, FR-5.ASM.009); C7 owns the sinks + alerting + the cost meter |
| Cost-ladder **enforcement** (throttle non-critical / hard-kill on a C7 breach signal) | **C6 decides, C5 executes** | Per ADR-003 the cost ladder is a C6 guardrail class; C7 signals the breach (FR-7.COST.003), C6 decides via **FR-6.RTL.004**, the C5 harness executes the throttle/kill. *(Change-control 2026-06-26: corrected from the prior "C7 enforces".)* |
| Orchestrator **routing**, agent registry, multi-agent dispatch, `agents.system_prompt` reconciliation | **C8** | C5 assembles + runs *an* agent's stack; C8 owns which agent and the registry |
| Memory **read/write mechanisms**, ranking, sole-writer commit | **C2** | C5 *sequences* the calls within a task graph (FR-5.ASM.006, GRP steps); C2 owns the internals |
| Tool **execution**, connector token lifecycle, rate-limit ladder | **C3** | C5 *issues* tool read/write steps; C3 owns the runtime |
| Prompt-layer **content** + version identity | **C4** | C5 *assembles + pins* the four layers (FR-5.ASM.001/002); C4 owns the content |
| **Compensation / rollback** of already-applied external side effects on a mid-chain halt | **OD-010** (C5/C6/C8 build) | C5 halts + quarantines (FR-5.ASM.005); the *undo* story is OD-010, still open |
| The **seven hard limits** review (set / rigidity / enforceability) | **OD-047** (C6) | C5 references the canonical set; the review lands at C6 with the AF-068 red-team |

---

## Functional Requirements

> Status: **Approved** (ODs resolved, ACs written, verification gate run + reconciled, signed off 2026-06-26).
> Citations are `L###` into `spec/source/design-doc-v4.md` (or a consumed FR / ADR). ACs are Given/When/Then.

### TRG — Triggering

**FR-5.TRG.001 — Four trigger types** · *Approved*
A task is initiated by exactly one of four trigger types, recorded in `task_queue.type`: **event** (a webhook
fires from a connected tool), **scheduled** (a time-based cadence), **human** (dashboard chat, Slack command, or
a dashboard UI button), **chained** (the output of one task triggers the next). — cites **L2503–2511, L2520**.
- **AC-5.TRG.001.1** — *Given* any created task, *When* its row is read, *Then* `type` is one of
  `scheduled | event | human | chained` and no other value is accepted.
- **AC-5.TRG.001.2** — *Given* each of the four trigger sources fires, *When* a task is created, *Then* exactly
  one task_queue row is created with the matching `type` and the originating `payload`.
- **AC-5.TRG.001.3** — *(Change-control 2026-06-27, session 27 — C10 OD-091 deployment-freeze gate; amended per
  **OD-162**.)* *Given* the deployment is in an offboarding **retention freeze**, signaled by a **local** read of
  `deployment_settings.frozen_at` (a per-deployment table living inside this client's own Supabase project, set by
  the management plane via the client's custodied `service_role` key when C10's offboarding trigger fires,
  C10 FR-10.OFF.004), *When* any of the four triggers would fire **or** the harness would dispatch a queued task to
  run, *Then* the dispatch is **blocked and fails closed** (no task created, no agent/loop runs, no new data written)
  and the block is logged — the freeze is an **enforced gate at the dispatch boundary**, not a status label. (Mirrors
  the C8 OD-081 memory-scope wiring: the policy is set by C10, the enforcement consumer is C5.) Gated by **AF-135**
  (freeze-propagation completeness across every dispatch path).

**FR-5.TRG.002 — Triggers are config-defined, not hardcoded** · *Approved*
Trigger definitions (conditions, schedules, enablement) live in deployment **config**; a new trigger is added,
and any trigger enabled/disabled per deployment, **without a code change**. — cites **L2505–2507, L2017** (C3
trigger registry).
- **AC-5.TRG.002.1** — *Given* a new trigger defined in deployment config, *When* the deployment (re)boots,
  *Then* the trigger is active with no code change; *and* a trigger marked disabled creates no tasks.

**FR-5.TRG.003 — Event triggers consume verified webhook ingress** · *Approved*
An event trigger fires only from a webhook that passed **authentication** (C0 FR-0.WHK.*) and the connector
**receiver contract** (C3 FR-3.TRIG.* — durable-queue → 2xx, dedup by delivery id). The harness publishes the
verified event to the job engine; it never accepts an unverified webhook as a trigger. — cites **L2505,
L2654, L2719–2721**; consumes **C0 FR-0.WHK.002/004**, **C3 FR-3.TRIG.***.
- **AC-5.TRG.003.1** — *Given* an inbound webhook failing signature verification, *When* it reaches the harness,
  *Then* no task is created (it is rejected upstream at C0/C3) and the security event is logged (seam to C7).

**FR-5.TRG.004 — Chained trigger on completion (fresh scope + handoff)** · *Approved*
On a task's successful completion, if a chained trigger is configured, the harness fires the next task. Per
**OD-059**, the chained task **starts a fresh context envelope** seeded with an explicit **handoff payload**
(the parent task's relevant output + a provenance link to the parent) and **re-runs its own memory retrieval
under its own entity scope + clearance** (the C2 read flow). It does **not** inherit the parent's full envelope
or memory scope — every task's memory access stays traceable to that task's own retrieval (#2; preserves C2
clearance-before-ranking). — cites **L2511, L2620**; consumes **C2 FR-2.RET.***.
- **AC-5.TRG.004.1** — *Given* Task A chains to Task B, *When* B is created, *Then* B's envelope is new (not A's
  envelope), carries the handoff payload + a provenance link to A, and B's `memory_retrieved` is populated by
  B's own retrieval under B's scope/clearance — never copied from A.
- **AC-5.TRG.004.2** — *Given* A held memories above B's clearance, *When* B runs, *Then* none of A's
  above-B-clearance memories appear in B's context (B retrieved independently).

**FR-5.TRG.005 — Verified event → task is at-least-once, never a silent no-op** · *Approved* · ⚠️ **AF-112**
*(Added by the verification gate — H1, seam-atomicity.)* A verified event accepted at the C3→C5 ingress seam
(FR-5.TRG.003) MUST result in **either** a committed `task_queue` row **or** a loud, recorded ingest-failure
event (to the C7 sink + a dead-letter-equivalent). The accept→enqueue step is **at-least-once with a delivery
watermark**: unlike a loop (which has catch-up, FR-5.LOP.004), a **one-shot event has no second chance**, so a
fired trigger that produces no task is an **alertable condition, never a silent no-op** (#1/#3). Mirrors the C3
receiver discipline (FR-3.TRIG.006) on the C5 side of the seam. — cites **L2503–2511, L2719–2721**; consumes
**C3 FR-3.TRIG.006**.
- **AC-5.TRG.005.1** — *Given* a verified event whose task-creation insert fails (or the engine is unreachable),
  *When* the harness processes it, *Then* the failure is recorded + surfaced (C7) and the event is **not**
  acknowledged as processed; no verified event is silently lost.
- **AC-5.TRG.005.2** — *Given* the enqueue path, *When* an event is accepted, *Then* a delivery watermark makes
  accept→task-row at-least-once; a re-delivered event is de-duplicated by idempotency (FR-5.GRP.003).

### QUE — Task queue & lifecycle

**FR-5.QUE.001 — `task_queue` is the permanent audit record** · *Approved*
Every task that ever ran is recorded in `task_queue`; **records are never deleted**; the table is the source of
truth for what happened and when, viewable from the operations dashboard. — cites **L2537, L2674–2678**.
- **AC-5.QUE.001.1** — *Given* a completed, failed, or dead-lettered task, *When* any retention/cleanup job
  runs, *Then* the task_queue row persists (no delete path exists for it).

**FR-5.QUE.002 — Task record schema** · *Approved*
A task_queue row carries: `id`, `type`, `task_name`, `payload`, `status`, `priority`, `requires_approval`,
`approved_by`, `approved_at`, `attempts`, `next_retry_at`, `client_slug`, `created_at`, `completed_at`, `error`.
**`client_slug` is a label, not an RLS key** (doc-reconciliation #1). *(Phase-4 reconciliation: the column is DELETED, not label-only — OD-096 / FR-10.ISO.001; it exists only in management-plane `client_registry`.)* — cites **L2517–2535**. (Schema: new field `task_queue.originating_user_id` — consolidated in `spec/04-data-model/schema.md`, Phase 4.)
- **AC-5.QUE.002.1** — *Given* a task row, *When* inspected, *Then* all listed fields are present and typed per
  the schema; `client_slug` is descriptive only and appears in no RLS policy predicate.

**FR-5.QUE.003 — Status state machine (incl. guardrail/quarantine state)** · *Approved*
A task moves through a defined status state machine. Per **OD-054** the enum extends the base
`pending → running → awaiting_approval → completed | failed` with an **explicit guardrail/quarantine state**
(`flagged`) — **defined in the C5 schema, set by C6** on a guardrail hit — kept **distinct from
`awaiting_approval`** (a safety hold is not a routine approval wait). **No undefined/blank status is ever
persisted** (#3). — cites **L2523, L2870**.
- **AC-5.QUE.003.1** — *Given* a task, *When* its status changes, *Then* the transition is one the state machine
  permits and the new value is a defined enum member (never null/unknown).
- **AC-5.QUE.003.2** — *Given* a guardrail fires on a task (C6), *When* its status is set, *Then* it becomes the
  defined `flagged`/quarantine state (not `awaiting_approval`, not an undefined value), and it leaves that state
  only by an explicit human review action (requeue / discard / approve); the held task's **work-in-progress
  (completed-step outputs + envelope) is retained** with the record, never discarded on the hold (#1).

**FR-5.QUE.004 — Priority ordering** · *Approved*
Tasks are dequeued in `priority` order (lower number = higher priority); the priority scheme is configurable.
— cites **L2524**.
- **AC-5.QUE.004.1** — *Given* two runnable tasks of differing priority, *When* the queue is drained, *Then* the
  lower-numbered task is selected first; the ordering rule is config-tunable.

**FR-5.QUE.005 — Approval state blocks execution** · *Approved*
A task with `requires_approval = true` moves to `awaiting_approval` and **does not execute** until a human
approves; on approval the system records `approved_by` + `approved_at`. *(C5 owns the blocking state + record;
the approval **tier policy + routing** are C6 — seam.)* — cites **L2525–2527, L2772–2782**.
- **AC-5.QUE.005.1** — *Given* a task requiring approval, *When* it is dequeued, *Then* it enters
  `awaiting_approval` and no execution step runs; *When* a human approves, *Then* `approved_by`/`approved_at`
  are recorded and execution proceeds; *if* rejected, *Then* it does not execute and the outcome is recorded.
- **AC-5.QUE.005.2** — *(Verification gate — H3, staleness escalation.)* *Given* a task in `awaiting_approval`
  past a configurable threshold, *When* the threshold is exceeded, *Then* it is **escalated** (alert + dashboard
  badge, C7 seam) and remains visibly pending — **never auto-approved** (#2) and **never silently abandoned**
  (#3). Reuses the C1 OD-028 / C2 OD-032 escalate-don't-auto-act pattern.

**FR-5.QUE.006 — Error recording & full history** · *Approved*
Every failed run records its error text in `task_queue.error`; the full error history across attempts is
preserved (never overwritten to a single last-error in a way that loses prior failures — #1/#3). — cites
**L2533, L2587**.
- **AC-5.QUE.006.1** — *Given* a task that failed on attempts 1..N, *When* its history is read, *Then* each
  attempt's error is recoverable (not silently collapsed to one).

### GRP — Task graphs

**FR-5.GRP.001 — Defined task graph per task type** · *Approved*
Each task type has a **defined task graph**: an ordered multi-step sequence with explicit step dependencies
(tool call / memory read / AI call / tool write / memory write). The harness **executes the graph**, never
ad-hoc improvises the step sequence. — cites **L2543–2553**.
- **AC-5.GRP.001.1** — *Given* a task of a known type, *When* it executes, *Then* it runs that type's defined
  graph steps in dependency order; a task type with no defined graph is a configuration error, not an ad-hoc run.
- **AC-5.GRP.001.2** — *(Verification gate — L3.)* *Given* a task created for a type with **no defined/registered
  graph**, *When* it is created/dequeued, *Then* it fails **loudly with a recorded error at creation/dequeue**
  (not left silently `pending`, not failing obscurely deep in execution) (#3).

**FR-5.GRP.002 — Task graphs are versioned (change control)** · *Approved*
Changing a task graph **creates a new version**; previous versions are retained; a **`change_reason` is
mandatory**. Mirrors the C4 prompt-version discipline / `standards/change-control.md`. — cites **L2555**.
- **AC-5.GRP.002.1** — *Given* an edit to a task graph, *When* it is saved, *Then* a new version row is created
  (the prior version retained) with a non-empty `change_reason`; a save without a reason is rejected.

**FR-5.GRP.003 — Idempotency keys per task and per step** · *Approved*
At creation time the harness generates an idempotency key **per task and per step**, so a retry cannot duplicate
already-completed work. — cites **L2579–2581, L2657–2658**; ties **AF-018/063, AF-112**.
- **AC-5.GRP.003.1** — *Given* a task and its steps, *When* created, *Then* each has a stable idempotency key;
  *When* a completed step is retried, *Then* the key prevents a duplicate side effect.
- **AC-5.GRP.003.2** — *(Verification gate — M1, crash-window ordering.)* *Given* an orchestrator crash **after**
  a step's side effect but **before** its completion is recorded, *When* the step is retried, *Then* the
  idempotency key (committed **no later than** the side effect) prevents a second side effect and the resumed
  step reuses/reconstructs the prior output (no double-fire #2, no lost output #1). *(The write-ordering claim
  is paper until proven — folded into **AF-112** scope.)*
- **AC-5.GRP.003.3** — *(Verification gate — L2, collision-resistance.)* *Given* the key-derivation scheme
  (e.g. `task_id` + `step_id` + payload-content hash), *When* two genuinely-distinct side effects are compared,
  *Then* their keys differ (no false-duplicate suppression, #1) and an identical retried action always matches
  (dedup holds, #2).

**FR-5.GRP.004 — Resume from first incomplete step** · *Approved*
A retried/resumed task resumes **from the first incomplete step**, not from the beginning; outputs of completed
steps are preserved and reused. — cites **L2581, L2638–2641, L2701**.
- **AC-5.GRP.004.1** — *Given* a task whose step *k* failed after steps 1..k-1 completed, *When* it is retried,
  *Then* steps 1..k-1 are **not** re-executed (their outputs are reused) and execution resumes at step *k*.

### ENV — Context envelope

**FR-5.ENV.001 — Context-envelope structure** · *Approved*
Each task carries a structured **context envelope** with at least: `task_id`, `original_request`, `entities`,
`memory_retrieved`, `execution_plan`, `current_step`, `previous_outputs`, `shared_context`. The envelope travels
with the task through its entire chain. — cites **L2593–2603**.
- **AC-5.ENV.001.1** — *Given* a running task, *When* its envelope is inspected, *Then* all listed fields are
  present and reflect the task's current state (`current_step` matches the executing step).

**FR-5.ENV.002 — Every step reads the full envelope; no cold start** · *Approved*
Every step reads the full envelope, appends its output to `previous_outputs`, and passes the updated envelope to
the next step. **No step starts cold** (without prior context). — cites **L2601, L2606**.
- **AC-5.ENV.002.1** — *Given* step *k* with k>1, *When* it begins, *Then* it has access to all prior steps'
  outputs via the envelope; *When* it completes, *Then* its output is appended to `previous_outputs`.

**FR-5.ENV.003 — Inter-step compression in long chains (lossless source)** · *Approved* · ⚠️ **AF-114**
In long task chains, earlier step outputs are compressed into summaries between steps to bound token growth, on
a **configurable token/step threshold**. Per **OD-055**, compression summarizes the outputs carried in the
**working envelope** for the next step's prompt, **but the full original (uncompressed) outputs are retained in
the durable step record** (Inngest step state / task history) — compression is a context-window **economy,
never knowledge loss** (#1). Resume-from-failure (FR-5.GRP.004) and audit read the retained originals.
*(Verification gate — M4: the durability of the originals store is itself an assumption — if Inngest cloud
step-state retention (FR-5.JOB.007) is shorter than the longest task chain + the audit window, the originals
must be persisted to a **C5-owned durable store** (task-history table), not relied on from the engine. Gated by
**AF-115**.)* — cites **L2608**.
- **AC-5.ENV.003.1** — *Given* a chain exceeding the configured compression threshold, *When* an earlier step's
  output is compressed for the next step, *Then* the next step receives the summary **and** the full original
  output remains recoverable from the durable step record.
- **AC-5.ENV.003.2** — *Given* a task resumed from a failed step after earlier outputs were compressed, *When*
  it resumes, *Then* it reconstructs from the retained originals (no needed state lost). *(Validated by
  **AF-114**.)*
- (Schema: durable `task_history` — consolidated in `spec/04-data-model/schema.md`, Phase 4.)

### LOP — Loop architecture

**FR-5.LOP.001 — Three default loops with configurable cadence** · *Approved*
The system ships three default loops, each with a configurable cadence and a named task list:
**fast** (5–15 min — urgent triggers, new leads, flagged messages, overdue tasks), **medium** (1–4 h — queued
tasks, pending memory writes, stale approvals), **slow** (daily/weekly — consolidation, summaries, memory
health, self-improvement signals, insight runs). — cites **L2561–2573, L3356–3359**.
- **AC-5.LOP.001.1** — *Given* a deployment, *When* its loops are inspected, *Then* the three default loops
  exist with configurable cadences within the documented ranges and their documented task lists.

**FR-5.LOP.002 — Loops are config-extensible at boot** · *Approved*
A new loop defined in deployment config (name, cadence, task list) is **discovered and registered at next boot**
as an Inngest cron function, with **no code change**. — cites **L2561, L2717**; ADR-005.
- **AC-5.LOP.002.1** — *Given* a new loop in config, *When* the deployment boots, *Then* it is registered and
  runs on its cadence with no code change.

**FR-5.LOP.003 — Loops run independently** · *Approved*
All loops run independently and may fire in parallel without blocking each other. — cites **L2575**.
- **AC-5.LOP.003.1** — *Given* the fast and slow loops are both due, *When* they fire, *Then* neither blocks the
  other's execution.

**FR-5.LOP.004 — Missed-run catch-up & same-loop overlap** · *Approved* · ⚠️ **AF-112**
Per **OD-057**: a loop **does not run concurrently with itself** — if a run overruns its cadence, the next tick
is **skipped or queued as exactly one** pending run (never a second concurrent run); a **missed run triggers a
single catch-up** on the next interval (**not** a backfill of every missed interval — no post-outage stampede);
and **idempotency keys** (FR-5.GRP.003) guarantee a catch-up cannot duplicate already-done work (#1). — cites
**L2575**.
- **AC-5.LOP.004.1** — *Given* a loop run still executing when its next tick is due, *When* the tick fires,
  *Then* no second concurrent run of that loop starts (it is skipped or a single run is queued).
- **AC-5.LOP.004.2** — *Given* one or more missed runs (e.g. after downtime), *When* the loop resumes, *Then* a
  single catch-up run executes (not one per missed interval), and idempotency prevents any duplicate side
  effect. *(Validated by **AF-112**.)*

**FR-5.LOP.005 — Loop failure alert & run logging** · *Approved*
**Three consecutive failures of a loop trigger an alert** (to operations); **every loop run is logged** with
timestamp and outcome. *(C5 emits the events + the threshold trip; the **alert delivery + dashboard** are C7 —
seam.)* — cites **L2575**.
- **AC-5.LOP.005.1** — *Given* a loop failing three runs in a row, *When* the third failure is recorded, *Then*
  an alert event is emitted; *and* every run (success or failure) produces a logged record with timestamp +
  outcome.

### JOB — Job execution (Inngest)

**FR-5.JOB.001 — Inngest is the execution engine** · *Approved*
Background job execution uses **Inngest** (cloud-hosted for v1): long-running jobs with **no execution-time
limit**, chosen because Supabase Edge Functions cannot serve core workflows (the real constraint is the **2 s
CPU cap on all plans**, not the "150 s" figure — **AF-017 corrected**) and pg_cron is not built for multi-step
orchestration. — cites **L2624–2635, L2742**; cites feasibility **AF-017** (corrected), **AF-018**.
- **AC-5.JOB.001.1** — *Given* a job exceeding Edge Function limits (e.g. a 500-memory consolidation or a
  6-step agent graph), *When* it runs on Inngest, *Then* it completes without a platform execution-time timeout.

**FR-5.JOB.002 — Task type = Inngest step function; step-level retry** · *Approved*
Every task type maps to an **Inngest step function**; each task-graph step is an Inngest `step.run`; the context
envelope travels as accumulated step state. If a step fails, **only that step retries** — not the whole chain
(realises FR-5.GRP.004). — cites **L2638–2641, L2683–2701**.
- **AC-5.JOB.002.1** — *Given* a task graph mapped to an Inngest function, *When* one step fails and retries,
  *Then* the already-completed steps are not re-run and their results are preserved.

**FR-5.JOB.003 — Retry with backoff; idempotent execution** · *Approved*
Inngest provides **configurable retry with exponential backoff per job type** and a **unique event id per job**
that prevents duplicate execution on retry. — cites **L2646, L2657–2658**; ties **AF-018, AF-063, AF-112**.
- **AC-5.JOB.003.1** — *Given* a transient step failure, *When* Inngest retries, *Then* it backs off per the
  job's configured policy; *Given* a duplicate event delivery, *Then* the unique event id prevents a second
  execution.

**FR-5.JOB.004 — Inngest executes, task_queue records (single retry authority)** · *Approved*
Inngest is the **execution engine** (runs jobs, manages retries, handles dead letters, step-level
observability); `task_queue` is the **permanent audit record**. Per **OD-058**, **Inngest is the single
retry/DLQ authority** — `task_queue.attempts` / `next_retry_at` / `status` are an **audit projection synced
from Inngest** (written as Inngest reports attempts/outcomes). There is **exactly one retry loop**; task_queue
never independently schedules a retry (no double-execution, #2). — cites **L2664–2681, L2528–2529**.
- **AC-5.JOB.004.1** — *Given* a step fails and Inngest retries it, *When* the retry occurs, *Then* no second,
  independent retry is scheduled by task_queue; `task_queue.attempts`/`status` update to mirror Inngest's
  reported lifecycle.
- **AC-5.JOB.004.2** — *Given* a consequential side-effecting step, *When* it fails and retries, *Then* it is
  executed by exactly one engine (Inngest) — never twice for one failure.

**FR-5.JOB.005 — Fan-out** · *Approved*
A single event can trigger **multiple parallel jobs** (e.g. new lead → research + memory-write + CRM jobs
simultaneously). — cites **L2650–2652**.
- **AC-5.JOB.005.1** — *Given* an event with a fan-out definition, *When* it fires, *Then* the multiple target
  jobs are dispatched concurrently, each as its own tracked task.
- **AC-5.JOB.005.2** — *(Verification gate — H2, partial-fan-out.)* *Given* a fan-out where one or more child
  dispatches fail, *When* the dispatch completes, *Then* the partial failure is **detected and surfaced loudly**
  (the parent records which children were and weren't created) and either the fan-out is retried as a unit under
  idempotency or the missing children are reconciled — a fan-out is **never silently partial** (#1/#3).

**FR-5.JOB.006 — Dead letter queue (human-only recovery)** · *Approved*
A task exceeding its configured retry count moves to the **dead letter queue** (Inngest's failed-function queue,
surfaced in the ops dashboard). DLQ entries store **full error history + final failure reason**; they are
**never auto-retried** — a human must explicitly **requeue or discard** from the dashboard. — cites
**L2585–2587, L2736–2738**.
- **AC-5.JOB.006.1** — *Given* a task that exceeds its retry count, *When* the limit is hit, *Then* it moves to
  the DLQ with full error history; *and* no automatic retry occurs; *and* only an explicit human action requeues
  or discards it.
- **AC-5.JOB.006.2** — *(Verification gate — M5, DLQ liveness.)* *Given* an entry resident in the DLQ beyond a
  configurable age, *When* the age is exceeded, *Then* **C5 itself emits** an escalating, recorded signal (like
  the FR-5.LOP.005 loop heartbeat — not a one-shot the C7 pull could miss), so an unattended DLQ is itself a
  loud condition (#3). The failure-handler must not fail silently.

**FR-5.JOB.007 — v1 hosting = Inngest cloud** · *Approved*
v1 uses Inngest **cloud-hosted** (managed, no infrastructure). Self-hosted Inngest (for a client requiring data
sovereignty / on-premise) is a **post-v1** consideration, not a v1 concern. — cites **L2742**.
- **AC-5.JOB.007.1** — *Given* v1, *When* job infrastructure is provisioned, *Then* it is Inngest cloud-hosted;
  self-hosting is documented as a later option, not built in v1. *(Logged as a deferral → OOS.)*

### ASM — Assembly & run pipeline (the system loop)

**FR-5.ASM.001 — Prompt-stack assembly per task** · *Approved*
Before a task executes, the harness **assembles the four prompt layers** for the acting agent: retrieve Layer 1
(identity) + Layer 2 (business) + Layer 3 (memory) + Layer 4 (task), inject dynamic + memory values, concatenate
in fixed order. *(C4 owns the layer content; C5 owns assembly — seam.)* — cites **L3338–3339**; consumes **C4
FR-4.LYR.001**.
- **AC-5.ASM.001.1** — *Given* a task ready to run, *When* its prompt is assembled, *Then* all four layers are
  present in order core → business → memory → task with dynamic + memory values injected.

**FR-5.ASM.002 — Version pinning at assembly** · *Approved*
At assembly the harness **pins the version** of each prompt layer; an in-flight task **completes on its pinned
versions** even if a layer is edited mid-run (realises C4 FR-4.LYR.003 / FR-4.STO.006 / OD-050). — cites
**L2475, L3338**; consumes **C4 FR-4.STO.006**.
- **AC-5.ASM.002.1** — *Given* a task assembled on layer versions {N}, *When* a layer is published to N+1
  mid-run, *Then* the task completes on {N}; only tasks assembled after the edit use N+1.

**FR-5.ASM.003 — Assembly-time safety-element validation** · *Approved*
The harness **executes C4 FR-4.LYR.004** at assembly: if the resolved Layer 1 lacks the external-data boundary
instruction, the hard-limit statement, or the operating-principles block, **assembly halts and surfaces the
defect loudly** — no degraded prompt reaches the model, never silently (#2/#3). — cites **L3338**; consumes
**C4 FR-4.LYR.004**.
- **AC-5.ASM.003.1** — *Given* a resolved Layer 1 missing a required safety element, *When* assembly runs,
  *Then* it halts, emits a loud defect signal, and no model call is made on the degraded prompt.

**FR-5.ASM.004 — Pre-execution gate sequencing** · *Approved*
After assembly and before execution, the harness checks **RBAC + sensitivity clearance + tool permissions**
(C1), then evaluates **requires_approval** (→ `awaiting_approval`, FR-5.QUE.005). Execution proceeds only when
authorization passes and approval is granted/not-required. *(C5 sequences the gates; C1 owns authorization
rules, C6 owns approval-gate policy/enforcement — seam.)* — cites **L3341–3344**; consumes **C1 FR-1.CLR.006**.
- **AC-5.ASM.004.1** — *Given* a task that fails the clearance/permission check, *When* the gate runs, *Then*
  execution does not begin and the denial is recorded (seam to C7); *Given* it passes but requires approval,
  *Then* it blocks at `awaiting_approval` until a human acts.
- **AC-5.ASM.004.2** — *(Verification gate — L1, late-discovered approval need.)* *Given* a step that resolves
  to a **consequential side effect not present at the initial gate evaluation** (e.g. a planning step,
  FR-5.OPT.003, decides external email is now needed), *When* it is about to fire, *Then* it **re-enters the
  approval gate before firing** — approval assessed too early never lets a newly-consequential action through
  (#2).

**FR-5.ASM.005 — Mid-task authorization re-check (implements C1 FR-1.RLS.007)** · *Approved* · ↪ **OD-010** (compensation)
A `service_role` task binds its originating user identity; at **each step / injection boundary** the harness
re-checks that user's active status + relied-on clearances. On **deactivation or clearance-revoke**, the task
**halts + quarantines** before the next consequential side effect (it is **not** silently dropped — #1); a
**benign session-expiry continues** (C0 FR-0.SESS.006). Compensation of already-applied side effects is
**OD-010**. — cites **L3341**; **implements C1 FR-1.RLS.007 / OD-031**.
- **AC-5.ASM.005.1** — *Given* a running `service_role` task whose originating user is deactivated (or a
  relied-on clearance revoked) mid-chain, *When* the next step boundary is reached, *Then* the task halts and is
  quarantined for human review before any further consequential side effect; *Given* instead a benign session
  expiry, *Then* the task continues to completion. The quarantined task **retains its completed-step outputs +
  envelope** (recoverable for review/resume), never discarded on halt (#1; you cannot compensate — OD-010 —
  what you didn't retain).

**FR-5.ASM.006 — Memory read flow before task** · *Approved*
Before task execution the harness invokes the C2 **memory read flow** (entity extraction → dual search → filter
→ clearance gate → rank → inject) and stores the result in the envelope's `memory_retrieved`. *(C2 owns the
mechanism incl. clearance-before-ranking; C5 invokes + carries the result — seam.)* — cites **L3346, L2598**;
consumes **C2 FR-2.RET.*, FR-1.CLR.006**.
- **AC-5.ASM.006.1** — *Given* a task with entities in scope, *When* assembly runs, *Then* the C2 read flow
  populates `memory_retrieved` (clearance already enforced by C2 before ranking); no above-clearance memory is
  injected (consumes C4 AC-4.INJ.003.3).
- **AC-5.ASM.006.2** — *(Change-control 2026-06-26, C8 session 25 — OD-081 / C8 H1.)* *Given* a step run by a
  specific agent, *When* the harness invokes the C2 read flow, *Then* it passes that agent's `memory_scope`
  (C8 FR-8.SCO.001) as an **additional retrieval predicate** alongside task clearance + entities; if the predicate
  cannot be applied, retrieval **fails closed** (returns nothing) rather than widening to the clearance-only set —
  realising C8's per-agent least-privilege (#2). *(No prior AC changed; this adds the agent-scope consumer the C8
  SCO area depends on.)*

**FR-5.ASM.007 — Per-step execution order** · *Approved*
Each task-graph step executes in the order **anomaly check → tool read → sanitize + boundary-tag tool-read
output (per ADR-007 / C6 FR-6.INJ.004/006 pipeline) → AI call → tool write → memory write** (as applicable to
the step). *(The harness owns that the anomaly check runs at the step boundary; the **detection mechanism +
thresholds** are C6 — seam. The harness likewise owns that the C6 injection-sanitization pipeline runs at this
named call site, between tool-read and AI-call, per **AC-6.INJ.001.2**; the pipeline's **mechanism** (pattern
detection, boundary-tagging, quarantine) is C6's. The check **cadence** — per-step vs per-AI-call — is a
cost/efficiency note seamed to C6 + ADR-003.)* — cites **L3346**; consumes **C6 FR-6.INJ.004/006, AC-6.INJ.001.2**.
- **AC-5.ASM.007.1** — *Given* a step with a tool-write side effect, *When* it executes, *Then* the C6 anomaly
  check is invoked before the side effect; a failed/flagged check routes the task per C6 (and FR-5.QUE.003 /
  OD-054) rather than proceeding silently.
- **AC-5.ASM.007.2** — *Given* a step with a tool read, *When* the tool-read output is returned, *Then* the
  harness invokes the C6 sanitize + boundary-tag pipeline (FR-6.INJ.004/006) **before** the AI call — the
  content never reaches the AI call un-sanitized/un-tagged; a quarantine result routes the task per C6
  FR-6.INJ.006 rather than proceeding silently.

**FR-5.ASM.008 — Answer-mode pill on every output** · *Approved*
Every substantive AI output produced within a task carries an answer-mode pill — **[Cited] [Inferred]
[Unknown]** — without exception. *(C5 ensures the pill is attached; **rendering** is C8; the **said-vs-did
accuracy** of the pill is **⚠️ AF-033**, a C7/C8 eval gap — seam.)* — cites **L3347, L1770**; consumes **C2
FR-2.RET.007**.
- **AC-5.ASM.008.1** — *Given* any substantive AI output in a task, *When* it is produced, *Then* it carries
  exactly one answer-mode pill from the three-mode set (never absent).

**FR-5.ASM.009 — Completion: chained trigger + dual record** · *Approved*
On completion the harness (a) fires the **chained trigger** if applicable (FR-5.TRG.004) and (b) records the
outcome in **both** the **event log** (C7 seam) and **`task_queue`** (`completed_at`, final status). — cites
**L3349–3351**.
- **AC-5.ASM.009.1** — *Given* a task completes, *When* finalization runs, *Then* `task_queue.completed_at` +
  final status are written and a completion event is emitted to the event log; *if* a chained trigger is
  configured, *Then* the next task is created.
- **AC-5.ASM.009.2** — *(Verification gate — M2, internal chain seam.)* *Given* a completed parent with a
  configured chained trigger, *When* the successor's creation fails or the process dies between recording
  completion and firing the chain, *Then* the successor creation is **durable/at-least-once relative to
  completion** (e.g. a pending-chain record reconciled by a loop) and a failure to create it is **surfaced** —
  never a silently broken chain (#1/#3).

### OPT — Optimisations

**FR-5.OPT.001 — Parallel step execution (per-deployment)** · *Approved* · ⚠️ **AF-113**
Independent task-graph steps may run **simultaneously**, enabled/disabled per deployment in config, **respecting
the dependency DAG**. Per **OD-056** the approval semantics are **step-level**: an approval-gated step blocks
**itself and its dependents**; independent reversible siblings proceed — **but no step may fire an irreversible
side effect ahead of a pending approval it should logically follow** (the planner/DAG marks such ordering so the
irreversible step waits). Protects #2 while maximising throughput. — cites **L2614, L3409**.
- **AC-5.OPT.001.1** — *Given* a parallel set with one approval-gated step, *When* the set runs, *Then* the
  gated step + its dependents block while independent reversible siblings proceed.
- **AC-5.OPT.001.2** — *Given* a step whose irreversible side effect should follow a still-pending approval
  elsewhere in the task, *When* parallel execution schedules it, *Then* it **waits** for that approval (no
  irreversible action outruns its gate, #2). *(DAG correctness + no `shared_context` race validated by
  **AF-113**.)*

**FR-5.OPT.002 — Smart scheduling** · *Approved*
Scheduled (non-urgent) tasks are run when the queue is **quiet**, to avoid congestion; configurable. — cites
**L2616**.
- **AC-5.OPT.002.1** — *Given* smart scheduling enabled, *When* the queue is busy, *Then* eligible scheduled
  tasks defer to a quiet window; *When* disabled, *Then* they run on their plain cadence.

**FR-5.OPT.003 — Task decomposition (planning step)** · *Approved*
For complex tasks, the harness runs an **upfront planning/decomposition step** before execution begins (builds
the ordered, dependency-aware step chain). — cites **L2618**.
- **AC-5.OPT.003.1** — *Given* a task flagged complex, *When* it starts, *Then* a planning step produces the
  execution plan (stored in the envelope's `execution_plan`) before any side-effecting step runs.

**FR-5.OPT.004 — Chained-task pre-warm** · *Approved*
The memory retrieval for a chained Task B may be **pre-warmed while Task A is still running**, to cut latency.
*(Pre-warm is a read-only optimisation; it must respect OD-059's scope rule for what B's scope actually is.)*
— cites **L2620**.
- **AC-5.OPT.004.1** — *Given* a chain A→B with pre-warm enabled, *When* A is running, *Then* B's memory
  retrieval may begin early; *and* pre-warming performs no side effect and is discarded if B never runs.

---

## Open Decisions (this component)

| OD | Question | Touches | Rec |
|---|---|---|---|
| **OD-054** | `task_queue` status enum vs the guardrail-set `'flagged'`/quarantine state | #3 | Extend the enum with an explicit guardrail/quarantine state owned in the C5 schema, set by C6 — a held task has a real recorded status, never undefined |
| **OD-055** | Context-envelope compression policy (trigger metric, strategy, original-output retention) | #1 | Configurable token/step threshold; summarize into the envelope **but** preserve full original outputs in the durable step record — economy, never loss (AF-114) |
| **OD-056** | Parallel execution × approval-gate semantics | **#2** | Step-level gating: an approval-gated step blocks itself + its dependents; independent siblings proceed; no pre-applied irreversible side effect ahead of a pending approval (AF-113) — *surface to operator* |
| **OD-057** | Loop missed-run catch-up + same-loop overlap | #1/#3 | No concurrent same-loop runs (skip/queue-one on overrun); missed run = single catch-up (not backfill-all); idempotency keys guarantee no duplicate work (AF-112) |
| **OD-058** | Inngest retry vs `task_queue.attempts` authority | #2 | Inngest = single retry/DLQ authority; task_queue = audit projection synced from it; never two retry loops |
| **OD-059** | Chained-task scope inheritance | **#2** | Chained task starts a **fresh** envelope with an explicit handoff payload (parent output + provenance) and re-runs its own memory retrieval — does not inherit the parent's full envelope/scope (avoids stale/over-broad context crossing task boundaries) — *surface to operator* |

> **All six RESOLVED 2026-06-26** — every one landed on option (a) above (OD-056 + OD-059 user-decided as the
> two #2-touching calls; OD-054/055/057/058 delegated to recommendation). Full write-ups in `open-decisions.md`.

## Feasibility (this component) — block P

| AF | Claim to prove | Method | Gates |
|---|---|---|---|
| **AF-112** | A missed/overlapping loop run does not duplicate writes or double-act; idempotency keys hold under catch-up at scale | LOAD/EVAL | FR-5.LOP.004 / OD-057 |
| **AF-113** | Parallel-step execution honours the DAG with no `shared_context`/`previous_outputs` race, and no side effect outruns a pending approval | SPIKE/LOAD | FR-5.OPT.001 / OD-056 |
| **AF-114** | Inter-step compression preserves task-critical state a later step needs (no silent loss of needed context) | EVAL | FR-5.ENV.003 / OD-055 |
| **AF-115** | The originals store (Inngest cloud step-state / task history) retains uncompressed outputs longer than the longest chain + audit window; else persist to a C5-owned durable store | DOCS/SPIKE | FR-5.ENV.003 / FR-5.GRP.004 (gate M4) |

> Carry-ins: **AF-018** (Inngest retry/idempotency/onFailure — verified), **AF-063** (Inngest per-key
> concurrency — underpins ADR-004), **AF-017** (Edge-Function 2 s CPU cap — the corrected rationale for
> choosing Inngest). Build-time spikes **AF-001/002/004** + **AF-111** unchanged.

---

## Stubs / new terms (to home at finalize)

- **Glossary candidates:** context envelope, task graph (versioned), dead letter queue, fan-out, idempotency key
  (per task/step), prompt-stack assembly, smart scheduling, task decomposition, loop catch-up.
- **OOS candidate:** self-hosted Inngest (post-v1, FR-5.JOB.007).
- **CFG candidates (Phase 2):** loop cadences, retry counts, compression threshold, priority scheme,
  parallel-execution on/off, smart-scheduling on/off, anomaly-check cadence (with C6).
- **DATA candidates (Phase 4):** `task_queue` (this component's schema), task-graph version store, context
  envelope persistence.
