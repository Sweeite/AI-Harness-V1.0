---
id: ISSUE-052
title: Inngest execution engine + step retry + fan-out + DLQ
epic: F — harness
status: blocked
github: "#52"
---

# ISSUE-052 — Inngest execution engine + step retry + fan-out + DLQ

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Stand up **Inngest as the execution engine** for the harness — every task type is an Inngest step
function with step-level retry + configurable backoff, single-authority retry/DLQ (task_queue is the
audit projection, never a second retry loop), fan-out to parallel child jobs with loud partial-failure
detection, and a human-only dead-letter queue that emits its own liveness heartbeat.

## 2. Scope — in / out
**In:** The JOB area only — the engine that *runs* the task graphs ISSUE-049 defines:
- Inngest as the v1 execution engine (cloud-hosted, no execution-time timeout), chosen over Edge
  Functions (2 s CPU cap) + pg_cron (FR-5.JOB.001 / FR-5.JOB.007).
- Task type → Inngest step function; each graph step is a `step.run`; **only the failing step
  retries**, not the whole chain; completed-step outputs preserved (FR-5.JOB.002, realising
  ISSUE-049's resume-from-incomplete).
- Configurable exponential backoff per job type + unique-event-id de-duplication so a re-delivered
  event never double-executes (FR-5.JOB.003).
- **Single retry/DLQ authority (OD-058):** Inngest owns retry/DLQ; the harness *syncs*
  `task_queue.attempts` / `next_retry_at` / `status` as an audit projection written from Inngest's
  reported lifecycle — task_queue never independently schedules a retry (FR-5.JOB.004).
- **Fan-out:** one event dispatches multiple parallel child jobs, each its own tracked task; a
  partial fan-out failure is **detected and surfaced loudly** (parent records which children were /
  weren't created) and reconciled or retried-as-a-unit under idempotency — never silently partial
  (FR-5.JOB.005).
- **DLQ (human-only recovery):** exceed retry count → DLQ with full error history + final reason;
  never auto-retried; explicit human requeue/discard; and **C5 itself emits an escalating heartbeat**
  when an entry sits in the DLQ past a configurable age, so an unattended DLQ is a loud condition
  (FR-5.JOB.006).

**Out:**
- **`task_queue` table + status machine + the `attempts`/`next_retry_at`/`error` columns themselves**
  — C5 QUE, owned by **ISSUE-048**. This slice *writes the projection into* those columns; it does
  not define the table.
- **Task graphs, step dependencies, idempotency-key generation, resume-from-incomplete-step logic**
  — C5 GRP, owned by **ISSUE-049** (blocked-by). This slice *executes* those graphs and *consumes*
  the idempotency keys for de-duplication; it does not generate them.
- **Context envelope structure + `task_history` originals store + inter-step compression** — C5 ENV,
  owned by **ISSUE-050**. The envelope travels as Inngest step-state at runtime; this slice carries
  it between steps but does not own its schema or the durable originals store.
- **Loop registration (Inngest cron) + catch-up/overlap semantics** — C5 LOP, owned by **ISSUE-051**.
- **Parallel-*step*-within-a-graph DAG execution + scheduling/decomposition/pre-warm** — C5 OPT,
  owned by **ISSUE-054** (blocks). Note: FR-5.JOB.005 fan-out (multiple *jobs* from one event) is in
  scope here; FR-5.OPT.001 parallel *steps* inside one graph is ISSUE-054.
- **Alert delivery, ops-dashboard DLQ view + requeue/discard affordances, cost meter** — C7, owned by
  **ISSUE-075 / ISSUE-076 / ISSUE-074**. This slice *emits* the DLQ heartbeat + run events at the seam.
- **The `max retries-to-DLQ` rate-cap policy framing** — C6 RTL, owned by **ISSUE-058**. This slice
  consumes the configured retry-count ceiling; the guardrail cap is C6's.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-5.JOB.001, FR-5.JOB.002, FR-5.JOB.003, FR-5.JOB.004, FR-5.JOB.005, FR-5.JOB.006,
  FR-5.JOB.007 (all Component 5 — Agent Harness).
- **NFRs:** NFR-INF.011 (Inngest single retry/DLQ authority; cloud-hosted v1) — this slice is its
  primary implementer; touches NFR-INF.014 (idempotent retry — the replayed-step-no-duplicate leg;
  crash-window resume itself is ISSUE-049).
- **Rests on:** ADR-004 (concurrency model — Inngest per-key concurrency serializes same-entity
  steps; the sole-writer `service_role` path), ADR-005 (deploy/provisioning — Inngest functions
  registered at boot), ADR-006 (`service_role` background path — authorization is harness-enforced,
  not RLS). Reconciliations: **OD-058** (Inngest = single retry/DLQ authority; task_queue = audit
  projection). Feasibility: **AF-018** (Inngest no-time-limit / step-retry / DLQ — VERIFIED, per-step
  cap ≤ 2 h), **AF-017** (Edge-Function CPU-cap rationale — corrected/STALE-noted), **AF-063**
  (Inngest per-key concurrency serializes same-entity steps — the ADR-004 assumption), **AF-112**
  (idempotency holds under retry/catch-up).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-5.JOB.001.1
- AC-5.JOB.002.1
- AC-5.JOB.003.1
- AC-5.JOB.004.1
- AC-5.JOB.004.2
- AC-5.JOB.005.1
- AC-5.JOB.005.2
- AC-5.JOB.006.1
- AC-5.JOB.006.2
- AC-5.JOB.007.1
- AC-NFR-INF.011.1, AC-NFR-INF.011.2
- **Gating spikes (if any):** no launch-gating spike (ISSUE-001–006) gates this slice. Build-time
  AFs attach as DoD notes: **AF-018** must stay GREEN (VERIFIED — confirm the ≤ 2 h per-step cap and
  DLQ/onFailure semantics still hold at build), and **AF-063** (per-key concurrency serialization,
  currently 🔴 unverified) must be confirmed or the design must degrade safely to advisory-lock-alone
  per ADR-004 — the fan-out + idempotent-retry correctness (AC-5.JOB.004.2 / AC-5.JOB.005.2) rides on
  it. **AF-112** underwrites the replayed-step-no-duplicate leg.

## 5. Touches (complete blast radius, by ID)
- **DATA:** `task_queue` (schema §6) — this slice **writes the OD-058 audit projection** into
  `attempts`, `next_retry_at`, `status`, and appends per-attempt entries to `error`; it does not add
  or alter columns (ISSUE-048 owns the schema). Reads `task_graph_versions.steps` (§6) to map a task
  type to its Inngest step function. The live context envelope is Inngest step-state at runtime, with
  `task_history` (§6, ISSUE-050) as its durable tail — this slice does not write `task_history`.
- **PERM:** none introduced. Background execution runs on the `service_role` path (ADR-006 —
  authorization is harness-enforced, not RLS). DLQ requeue/discard is a human action gated by C7's
  ops-dashboard RBAC (ISSUE-075/078), not defined here.
- **CFG:** retry-count + exponential-backoff policy **per job type** (FR-5.JOB.003 — consumes the
  guardrail `max retries-to-DLQ` ceiling framed by C6 FR-6.RTL.001 in ISSUE-058); DLQ-age heartbeat
  threshold (FR-5.JOB.006 / AC-5.JOB.006.2). *(Config-key homing is the Phase-2 registry §12; this
  slice consumes the keys, does not define the registry.)*
- **UI:** none built here. The DLQ view + requeue/discard affordances are C7 ops-dashboard surfaces
  (ISSUE-075/078); this slice emits the DLQ-not-empty heartbeat + run events at the seam.
- **Connectors:** none directly (Inngest is the execution engine, not a client connector). Tool steps
  dispatched inside a job hit C3 connectors, but that is the run pipeline's concern (ISSUE-053).

## 6. Context manifest (the EXACT files to open — nothing more)
- `spec/01-requirements/component-05-harness.md` — the JOB FR text + all AC-5.JOB.* acceptance
  criteria; the OD-058 single-authority reconciliation; the C5→C7 event-emission seam rows
  (run/loop/DLQ events); the ADR-003/004/005/006 context-manifest notes.
- `spec/04-data-model/schema.md` §6 (Execution / Harness — `task_queue` projection columns
  `attempts`/`next_retry_at`/`status`/`error`; `task_graph_versions.steps`; `task_history` as the
  durable envelope tail) and §Types (`task_status`).
- `spec/05-non-functional/infrastructure.md` — NFR-INF.011 (single retry/DLQ authority, cloud-hosted
  v1) and NFR-INF.014 (idempotent-retry / no-duplicate leg).
- `spec/00-foundations/adr/ADR-004-concurrency-model.md` — Inngest per-key concurrency + sole-writer
  `service_role`; the AF-063 assumption and its safe-degrade fallback.
- `spec/00-foundations/adr/ADR-005-deploy-provisioning.md` — Inngest functions registered at boot.
- `spec/00-foundations/adr/ADR-006-rls-dynamic-roles.md` — the `service_role` background path.
- `spec/00-foundations/feasibility-register.md` — AF-018 / AF-017 / AF-063 / AF-112 status + method.

## 7. Dependencies
- **Blocked-by:** ISSUE-049 (task graphs + idempotency keys + resume-from-incomplete-step). Not a
  spike — no AF gate to turn GREEN as a precondition; this slice *executes* the graphs ISSUE-049
  defines and consumes its idempotency keys.
- **Blocks:** ISSUE-054 (execution optimisation — parallel-step DAG / scheduling / decomposition /
  pre-warm, which run on this engine), ISSUE-064 (execution plans + per-step failure-mode assignment,
  which the engine enacts).

## 8. Build order within the slice
1. **Inngest engine bootstrap (FR-5.JOB.001 / FR-5.JOB.007 / ADR-005)** — wire the Inngest
   cloud-hosted client; register functions at boot per ADR-005. Confirm no platform execution-time
   timeout on the long-job path (AF-018 ≤ 2 h per-step cap noted). Self-hosting is OOS-028 — do not
   build it.
2. **Task type → step function (FR-5.JOB.002)** — map each `task_graph_versions` task type to an
   Inngest function whose graph steps are `step.run` calls; the context envelope (ISSUE-050) travels
   as accumulated step-state. A step failure retries **only that step**; completed steps are not
   re-run and their outputs are preserved (defers the resume semantics to ISSUE-049's keys).
3. **Retry/backoff + event-id de-dup (FR-5.JOB.003)** — configurable exponential backoff per job type
   (from the CFG retry-policy key); a unique event id per job so a re-delivered event does not execute
   twice (consumes ISSUE-049 idempotency keys; underwritten by AF-112).
4. **Single-authority projection sync (FR-5.JOB.004 / OD-058 / NFR-INF.011)** — as Inngest reports
   attempts/outcomes, write `task_queue.attempts` / `next_retry_at` / `status` as a **read-only audit
   projection**; enforce that the `task_queue` path never issues its own retry (the exactly-one-retry-
   loop invariant — AC-5.JOB.004.1/.2, AC-NFR-INF.011.1). Per-key concurrency (ADR-004 / AF-063)
   serializes same-entity steps so one failure is executed by exactly one engine.
5. **Fan-out + partial-failure reconciliation (FR-5.JOB.005)** — one event dispatches multiple child
   jobs concurrently, each a tracked task; the parent records which children were / weren't created;
   on partial dispatch failure, surface it loudly and either retry-the-fan-out-as-a-unit under
   idempotency or reconcile the missing children — never silently partial (AC-5.JOB.005.2, #1/#3).
6. **DLQ + human-only recovery (FR-5.JOB.006)** — on exceeding the configured retry count, move to the
   DLQ with full error history + final reason; block any auto-retry; expose requeue/discard as an
   explicit human action (the affordance is C7's ISSUE-075/078; here only the state + gate).
7. **DLQ liveness heartbeat (AC-5.JOB.006.2)** — when an entry sits in the DLQ past the configurable
   age, **C5 itself emits** an escalating, recorded signal to ISSUE-011's `event_log` (like the
   FR-5.LOP.005 heartbeat — not a one-shot a C7 pull could miss); the failure-handler must not fail
   silently.
8. **Tests to the ACs** — one test per AC-5.JOB.* + the two AC-NFR-INF.011.* listed in §4, including a
   build-time test that a retry is **never** issued by the `task_queue` path (NFR-INF.011 verification).

## 9. Verification (how DoD is proven)
- Per `spec/05-non-functional/test-strategy.md`: **integration/engine tests** against Inngest prove
  AC-5.JOB.001.1 (no platform timeout), AC-5.JOB.002.1 (step-level retry preserves completed steps),
  AC-5.JOB.003.1 (backoff + event-id de-dup); a **single-authority test** proves AC-5.JOB.004.1/.2 +
  AC-NFR-INF.011.1 — no second, independent retry from the `task_queue` path (the OD-058 invariant);
  **fan-out tests** prove AC-5.JOB.005.1 (concurrent dispatch, each tracked) and AC-5.JOB.005.2
  (injected partial-dispatch failure is detected + surfaced + reconciled, never silent); **DLQ tests**
  prove AC-5.JOB.006.1 (human-only recovery, no auto-retry) and AC-5.JOB.006.2 (age-triggered
  heartbeat fires on `event_log`, failure-handler never silent); a **provisioning test** proves
  AC-5.JOB.007.1 (Inngest cloud-hosted) + AC-NFR-INF.011.2.
- Build-time AF confirmations gate `Verified`: **AF-018** (Inngest semantics — DOCS/spike, VERIFIED)
  and **AF-063** (per-key concurrency serialization — DOCS+SPIKE; if unproven, the design must degrade
  safely to advisory-lock-alone per ADR-004); **AF-112** underwrites the replayed-step-no-duplicate leg.
- Posture that must hold: the no-dual-retry / no-double-execution invariant (#2) and no-silent-failure
  (#3) — a fan-out is never silently partial and an unattended DLQ is a loud, recorded condition. The
  AC→`Verified` path is the per-AC tests above passing green under the JOB FRs in
  `component-05-harness.md` and NFR-INF.011 in `infrastructure.md`.
