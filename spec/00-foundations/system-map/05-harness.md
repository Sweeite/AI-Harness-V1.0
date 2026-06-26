# Zoom-in: C5 Agent Harness — "what makes it *run*"

This opens up the **execution layer** — the thing that takes a well-designed AI (memory C2, tools C3, prompts
C4) that "sits there doing nothing" (L2497) and makes it *act*. This map reflects the C5 resolutions
(OD-054…OD-059). Where this map and a requirement disagree, the requirement wins and this map updates (change
control).

**Scope (what C5 owns):** triggering · the `task_queue` (permanent audit record) · versioned task graphs ·
the context envelope · the three loops · the Inngest job engine + dead letter queue · prompt-stack **assembly**
+ the run pipeline · the harness optimisations.
**Seams out (what C5 does NOT own):** hard-limit / approval-gate **enforcement** + injection sanitization +
**anomaly detection** → **C6**; event-log sink + metrics + alert **delivery** + cost-ladder enforcement →
**C7**; orchestrator routing + agent registry → **C8**; memory read/write **mechanisms** → **C2**; tool
**execution** → **C3**; prompt-layer **content** → **C4**; RBAC/clearance **rules** → **C1**. C5 *sequences and
invokes*; it does not own their internals.

## The end-to-end run pipeline (the system loop, L3329-3367)

```
   TRIGGER fires (event · scheduled · human · chained)                       (TRG.001-004)
        │   event = verified webhook ingress only (C0 auth + C3 receiver)    (TRG.003)
        │   verified event → task is AT-LEAST-ONCE, never a silent no-op     (TRG.005, #1/#3)
        ▼
   TASK created in task_queue  — permanent audit record, never deleted       (QUE.001-006)
        │   status machine: pending→running→awaiting_approval→completed|failed
        │   + flagged/quarantine (C5 schema, C6-set, distinct)         (QUE.003 / OD-054)
        ▼
   PROMPT STACK ASSEMBLED per agent (retrieve L1-4 · inject · concat)        (ASM.001)
        │   version PINNED at assembly → in-flight finishes on its version   (ASM.002 / OD-050)
        │   safety-element validation (C4 FR-4.LYR.004) → halt if missing    (ASM.003, #2/#3)
        ▼
   GATES (before execution):  RBAC + clearance + tool perms (C1) → approval  (ASM.004)
        │   late-discovered consequential action re-enters the gate          (ASM.004.2, #2)
        │   approval wait past threshold → ESCALATE, never auto-approve       (QUE.005.2, #3)
        ▼
   TASK GRAPH executes step-by-step (defined per type, versioned)            (GRP.001-004)
        │   each step:  anomaly check(C6) → tool read(C3) → AI call → tool write(C3) → mem write(C2)
        │   every AI output carries an answer-mode pill [Cited|Inferred|Unknown]  (ASM.008)
        │   mid-task re-check: user deactivated / clearance revoked → halt+quarantine  (ASM.005)
        │       (implements C1 FR-1.RLS.007; benign session-expiry continues; retains WIP)
        ▼
   COMPLETE → chained trigger fires (durable) → record in event log + task_queue  (ASM.009 / TRG.004)
```

## State carried with the task — the context envelope (ENV)

```
   { task_id · original_request · entities · memory_retrieved · execution_plan ·
     current_step · previous_outputs · shared_context }                       (ENV.001)
        │   every step reads the FULL envelope, appends its output — NO step starts cold  (ENV.002)
   COMPRESSION in long chains (configurable threshold)                        (ENV.003 / OD-055)
        │   summarize for the next prompt — BUT retain full originals in the durable step
        │   record (resume + audit read them) ── economy, NEVER knowledge loss (#1)
        │   ⚠️ AF-115: prove the originals store outlives the chain + audit window, else
        │             persist to a C5-owned durable store (engine state = cache only)
   CHAINED A→B: B starts a FRESH envelope + handoff payload + provenance, re-retrieves
        under B's OWN scope/clearance — never inherits A's scope (ENV/TRG.004 / OD-059, #2)
```

## Execution engine — Inngest executes, Supabase records (JOB)

```
   INNGEST (cloud, v1) = the execution engine                                 (JOB.001/007)
        │   task type = step function · each graph step = a step.run · only the failed step retries (JOB.002)
        │   retry + backoff · unique event id = idempotency · fan-out (1 event→N jobs)  (JOB.003/005)
        │   SINGLE retry authority — task_queue.attempts is an AUDIT PROJECTION synced from
        │       Inngest, never a 2nd retry loop (no double-execution, #2)      (JOB.004 / OD-058)
        │   fan-out partial failure is detected + surfaced, never silently partial  (JOB.005.2, #1/#3)
        ▼
   DEAD LETTER QUEUE (exceed retry count) — full history · human-only requeue/discard  (JOB.006)
        │   never auto-retried · DLQ-not-empty past age → C5-EMITTED heartbeat   (JOB.006.2, #3)
   task_queue = the permanent record (Inngest executes, Supabase records, L2681)
   ⚠️ idempotency under catch-up/overlap at scale + crash-window key-before-side-effect = AF-112
```

## The three loops — continuous, independent, config-extensible (LOP)

```
   FAST  5-15 min   urgent triggers · new leads · flagged · overdue          (LOP.001)
   MEDIUM 1-4 hr    queued tasks · pending memory writes · stale approvals
   SLOW  daily/wkly consolidation · summaries · memory health · self-improvement
        │   independent (parallel, non-blocking)                              (LOP.003)
        │   new loop via config, registered at boot, no code change           (LOP.002 / ADR-005)
   NO concurrent same-loop runs (skip/queue-one on overrun) + SINGLE catch-up
        on a miss (not backfill-all → no post-outage stampede)                (LOP.004 / OD-057)
        │   idempotency guarantees a catch-up can't duplicate work (AF-112, #1)
   3 consecutive failures → ALERT (C7) · every run logged                     (LOP.005, #3)
```

## Optimisations (OPT)

- **Parallel step execution** (OPT.001 / OD-056): independent reversible steps run together, respecting the DAG;
  an approval-gated step blocks itself + dependents, but **no irreversible side effect outruns a pending
  approval** it should follow (#2; AF-113). **Smart scheduling** (OPT.002): run scheduled tasks when the queue
  is quiet. **Task decomposition** (OPT.003): a planning step builds the plan before execution. **Chained
  pre-warm** (OPT.004): warm B's *own* (OD-059-scoped) retrieval while A runs.

## The three non-negotiables, applied to C5

- **#1 never lose knowledge** — task_queue never deleted (QUE.001) · compression retains originals (ENV.003) ·
  quarantine/halt retains WIP (ASM.005, QUE.003.2) · verified event is at-least-once (TRG.005) · fan-out never
  silently partial (JOB.005.2) · durable chained-successor (ASM.009.2).
- **#2 never do what it shouldn't** — mid-task authorization re-check (ASM.005, implements C1 FR-1.RLS.007) ·
  single retry authority = no double-fire (JOB.004) · parallel never outruns a gate (OPT.001) · late-discovered
  approval re-enters the gate (ASM.004.2) · fresh-envelope chaining stays in B's scope (TRG.004) · assembly
  validates safety elements (ASM.003).
- **#3 never fail silently** — defined status always (QUE.003) · approval-wait escalates (QUE.005.2) · loop
  failure alert (LOP.005) · DLQ-not-empty heartbeat (JOB.006.2) · graph-less task fails loudly at creation
  (GRP.001.2) · trigger-with-no-task is alertable (TRG.005).

## Open items C5 hands forward

- **OD-010** (compensation / rollback of already-applied side effects on a mid-chain halt) — lands substantively
  at C5/C6/C8 build; ASM.005 halts + **retains** WIP so there is something to compensate.
- **AF-112/113/114/115** — build-time validations (catch-up idempotency · parallel-DAG + approval ordering ·
  compression fidelity · originals-store retention). None hold an FR from Approved; all are MUST-TEST before/while
  building.
- Seam labels: enforcement → **C6**, observability → **C7**, orchestration → **C8** (note: OD-047's register
  entry calls Guardrails "C7" — stale; reconcile to **C6** when the Guardrails component is specced).
