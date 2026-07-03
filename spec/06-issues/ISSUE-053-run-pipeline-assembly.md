---
id: ISSUE-053
title: Run pipeline — prompt-stack assembly + gates + memory injection + answer-mode + dual-record
epic: F — harness
status: blocked
github: "#53"
---

# ISSUE-053 — Run pipeline — prompt-stack assembly + gates + memory injection + answer-mode + dual-record

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Build the C5 **run pipeline** — the per-task path that assembles the four prompt layers, pins their versions, validates safety elements, runs the pre-execution + mid-task authorization gates, invokes the C2 memory read flow with per-agent scope, sequences each step's guardrail invocations, attaches the answer-mode pill, and records completion in both sinks.

## 2. Scope — in / out
**In:** The whole C5 **ASM** area — the *system loop* that ties the already-built pieces (prompt store, task_queue, memory retrieval, guardrails, hard limits, anomaly checks, orchestrator) into one executable run pipeline:
- Prompt-stack **assembly** (retrieve L1–L4 for the acting agent, inject dynamic + memory values, concatenate in fixed order) and **version pinning** at assembly (in-flight task completes on its pinned versions).
- **Assembly-time safety-element validation** (execute C4's required-element check; halt loudly if the resolved Layer 1 lacks the boundary instruction / hard-limit statement / principles block).
- **Pre-execution gate sequencing** (RBAC + clearance + tool-permission check, then `requires_approval` evaluation → `awaiting_approval`), including re-entry of the approval gate when a step becomes newly consequential.
- **Mid-task authorization re-check** on the `service_role` path (bind originating user; re-check active status + relied-on clearances at each step/injection boundary; halt+quarantine before the next consequential side effect on deactivation/clearance-revoke; benign session-expiry continues).
- **Memory read flow before task** (invoke C2 read flow → populate envelope `memory_retrieved`; apply the acting agent's `memory_scope` as an additional retrieval predicate that fails closed).
- **Per-step execution order** (invoke the C6 anomaly check and the C6 sanitize+boundary-tag pipeline at their named harness call sites, in order, before the AI call / side effect).
- **Answer-mode pill** attached to every substantive AI output.
- **Completion: chained trigger + dual record** (fire chained successor if configured; write `task_queue.completed_at` + final status AND emit the completion event to `event_log`; durable/at-least-once successor creation).

**Out:** This issue *invokes but does not own* the mechanisms it sequences:
- Prompt-layer **content** + the version store itself → ISSUE-042 (store), ISSUE-043 (L1 identity/principles/limits + answer-mode signalling), ISSUE-045 (L3 memory injection scoping/clearance/volume).
- `task_queue` schema, status state machine, priority, approval-blocking state → ISSUE-048.
- Task graphs, idempotency keys, resume-from-incomplete-step → ISSUE-049; context envelope structure + compression + originals retention → ISSUE-050; Inngest engine + step retry + fan-out + DLQ → ISSUE-052.
- The C2 memory **read mechanism** (entity extraction → dual search → clearance-before-ranking → rank) → ISSUE-025; per-agent scope **filter** definition → ISSUE-063.
- Seven-hard-limit **enforcement** → ISSUE-055; approval **tier policy + routing** → ISSUE-056; the five **anomaly checks** + thresholds → ISSUE-057; injection **sanitization pipeline** → ISSUE-059.
- Orchestrator **routing** + which agent runs + agents registry → ISSUE-061.
- Event-log **sink** + alert delivery → ISSUE-011; answer-mode pill **rendering** → C8; parallel-DAG / smart-scheduling / decomposition / pre-warm optimisations (C5 OPT) → ISSUE-054.

**Integration note (why these bundle):** ASM is the single ordered path where assembly, gating, memory injection, per-step guardrail invocation, and dual-record completion must interleave correctly. FR-5.ASM.004 (pre-exec gate) and FR-5.ASM.005 (mid-task re-check) share the same authorization surface; FR-5.ASM.006 (memory read) feeds the L3 slot that FR-5.ASM.001 assembles; FR-5.ASM.007 defines the per-step order that FR-5.ASM.005's re-check boundary rides on. They cannot be split without re-specifying their ordering, so they ship as one slice.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs (C5 — Agent Harness):** FR-5.ASM.001, FR-5.ASM.002, FR-5.ASM.003, FR-5.ASM.004, FR-5.ASM.005, FR-5.ASM.006, FR-5.ASM.007, FR-5.ASM.008, FR-5.ASM.009.
- **Consumed (invoked, owned elsewhere):** C4 FR-4.LYR.001 / FR-4.LYR.004 / FR-4.STO.006 / FR-4.CID.003 (+ AC-4.INJ.003.3 containment-breach halt); C1 FR-1.CLR.006 / FR-1.RLS.007 (+ OD-031); C2 FR-2.RET.* (read flow) / FR-2.RET.007 (pill); C6 FR-6.HRD.001 (hard limits at gate), FR-6.APR.002 (mandatory-hard set), FR-6.ANM.001/002 (per-step anomaly), FR-6.INJ.004 / FR-6.INJ.006 (+ AC-6.INJ.001.2 named call site); C8 FR-8.SCO.001 (per-agent scope predicate).
- **NFRs:** NFR-SEC.004, NFR-SEC.006, NFR-SEC.007 (containment holds through assembly + gating); NFR-PERF.006 (memory-injection cap); NFR-OBS.003 (dual-sink reconciliation); NFR-OBS.012 (answer-mode pill everywhere).
- **Rests on:** ADR-007 (containment-first injection posture), ADR-006 (`service_role` path is harness-enforced), ADR-004 (sole-writer / per-key concurrency), ADR-003 (per-step model calls are cost levers). OD-010 (compensation of applied side effects on mid-chain halt — open; the halt+retain path here is its input).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-5.ASM.001.1
- AC-5.ASM.002.1
- AC-5.ASM.003.1
- AC-5.ASM.004.1, AC-5.ASM.004.2
- AC-5.ASM.005.1
- AC-5.ASM.006.1, AC-5.ASM.006.2
- AC-5.ASM.007.1, AC-5.ASM.007.2
- AC-5.ASM.008.1
- AC-5.ASM.009.1, AC-5.ASM.009.2
- **Cross-cutting NFR ACs:** AC-NFR-SEC.007.1 (boundary tags + L1 statement present at assembly), AC-NFR-PERF.006.1 (injection cap honoured), AC-NFR-OBS.012.1 / AC-NFR-OBS.012.2 (pill everywhere; unresolved reads "mode unknown"), AC-NFR-OBS.003.1 (the two sinks reconcile).
- **Gating spikes (must be GREEN before this issue ships, per OD-157 / RP-1):**
  - **AF-068** (containment red-team) via blocked-by ISSUE-003 — no authorized-but-dangerous autonomous path survives assembly + gate sequencing (backs FR-5.ASM.003/004/005/007, NFR-SEC.004/006).
  - **AF-067** (RLS hot-path latency) via blocked-by ISSUE-002 — the mid-task re-check clearance lookups (FR-5.ASM.005) ride the same live-permission path; must clear the latency gate.

## 5. Touches (complete blast radius, by ID)
- **DATA:** `task_queue` (read status/priority/requires_approval; write `approved_by`/`approved_at`, `completed_at`, final `status`, `error`; read `originating_user_id` for the mid-task bind), `task_history` (read retained originals on resume/audit; written by ISSUE-050), `prompt_layers` (read L1–L4 by pinned version), `task_graph_versions` (read the step graph the pipeline executes), `event_log` (append completion event), `guardrail_log` (read/route on anomaly/injection/flag outcomes — rows written by C6).
- **PERM:** none owned here — the pre-exec gate *consumes* C1 RBAC/clearance/tool-permission checks (ISSUE-018/019/020); no new PERM node.
- **CFG:** none net-new owned here; reads the anomaly-check cadence key (shared with C6) and the L3 `memories_injected_per_task` cap (owned by ISSUE-045).
- **UI:** none (the run pipeline is headless; queue/DLQ/envelope viewers are ISSUE-048/052; renders are C7/C8 surfaces).
- **Connectors:** none directly — tool read/write steps are issued through the C3 runtime (ISSUE-032/035); the pipeline sequences, C3 executes.

## 6. Context manifest (the EXACT files to open — nothing more)
- `spec/01-requirements/component-05-harness.md` — the ASM FR text + ACs (this slice); the C5 seams table + doc-reconciliation notes.
- `spec/01-requirements/component-04-prompt.md` §FR-4.LYR.001/004, FR-4.STO.006, FR-4.CID.003, AC-4.INJ.003.3 — the assembly/pin/safety-element/boundary contracts this consumes.
- `spec/01-requirements/component-06-guardrails.md` §FR-6.HRD.001, FR-6.APR.002, FR-6.ANM.001/002, FR-6.INJ.004/006 (+ AC-6.INJ.001.2) — the guardrail invocation points sequenced here.
- `spec/01-requirements/component-08-agent-design.md` §FR-8.SCO.001 — the per-agent memory-scope predicate passed into the read flow.
- `spec/04-data-model/schema.md` §6 Execution / Harness (`task_queue`, `task_graph_versions`, `task_history`) and §8 Observability (`event_log`); §Global rules (audit-sink append-only immutability) for the dual-record write.
- `spec/05-non-functional/security.md` §NFR-SEC.004/006/007 · `spec/05-non-functional/performance.md` §NFR-PERF.006 · `spec/05-non-functional/observability.md` §NFR-OBS.003/012.
- `spec/00-foundations/adr/ADR-007-injection-posture.md`, `ADR-006-rls-dynamic-roles.md` — the containment posture + the `service_role` harness-enforced authorization the gates rest on.
- `spec/00-foundations/feasibility-register.md` §AF-068, §AF-067 — the two launch-gating spikes this slice waits on.

## 7. Dependencies
- **Blocked-by:** ISSUE-043 (L1 identity/principles/limits + answer-mode signalling — assembly needs the resolved L1 content + safety elements), ISSUE-045 (L3 memory injection scoping/clearance/volume — the L3 slot + cap), ISSUE-048 (`task_queue` record + status machine + approval-block state), ISSUE-055 (seven hard limits — the gate/step invocations enforce against them), ISSUE-056 (approval tiers + routing — the pre-exec/late-discovered approval gate), ISSUE-057 (five pre-step anomaly checks — invoked in the step order), ISSUE-061 (orchestrator + agents registry — supplies which agent runs + its `memory_scope`). **Spike gates:** ISSUE-002 (proves **AF-067** GREEN — mid-task clearance re-check latency), ISSUE-003 (proves **AF-068** GREEN — containment through the gates).
- **Blocks:** ISSUE-072 (command dispatch + node-gating — dispatches into this run pipeline).

## 8. Build order within the slice
1. **Assembly (FR-5.ASM.001 + FR-5.ASM.002):** given an acting agent + a dequeued task, read L1–L4 from `prompt_layers`, **pin** each layer version, inject dynamic + memory values, concatenate core → business → memory → task. Record the pinned version set on the run so an in-flight task completes on it.
2. **Safety-element validation (FR-5.ASM.003):** execute C4 FR-4.LYR.004 against the resolved Layer 1; halt loudly + emit defect signal if the boundary instruction / hard-limit statement / principles block is missing — no model call on a degraded prompt.
3. **Memory read flow (FR-5.ASM.006):** before execution invoke the C2 read flow to fill envelope `memory_retrieved`; pass the agent's `memory_scope` (FR-8.SCO.001) as an additional retrieval predicate that **fails closed** if unapplied; honour the L3 volume cap (NFR-PERF.006); above-clearance/Restricted content in the assembled L3 is a containment breach → halt+audit (AC-4.INJ.003.3).
4. **Pre-execution gate sequencing (FR-5.ASM.004):** run RBAC + clearance + tool-permission checks (C1), then evaluate `requires_approval` → move to `awaiting_approval` and block (ISSUE-048's state). Wire the **late-discovered approval** re-entry so a step that becomes consequential re-enters the gate before firing.
5. **Mid-task authorization re-check (FR-5.ASM.005):** bind `task_queue.originating_user_id`; at each step/injection boundary re-check active status + relied-on clearances; on deactivation/clearance-revoke, halt + quarantine **before** the next consequential side effect while **retaining** completed-step outputs + envelope (OD-010 input); benign session-expiry continues.
6. **Per-step execution order (FR-5.ASM.007):** at each step invoke, in order, the C6 anomaly check (FR-6.ANM.001) before any side effect, then on tool-read the C6 sanitize + boundary-tag pipeline (FR-6.INJ.004/006 at the AC-6.INJ.001.2 call site) **before** the AI call; a flagged/quarantine result routes the task per C6 (via the `flagged` state) rather than proceeding silently.
7. **Answer-mode pill (FR-5.ASM.008):** attach exactly one [Cited]/[Inferred]/[Unknown] pill to every substantive AI output; unresolved → "mode unknown" (NFR-OBS.012), never a defaulted "Cited".
8. **Completion: chained trigger + dual record (FR-5.ASM.009):** write `task_queue.completed_at` + final status **and** emit the completion event to `event_log` (both sinks — NFR-OBS.003); fire the chained successor if configured, with successor creation durable/at-least-once relative to completion recording.

## 9. Verification (how DoD is proven)
- **Unit / integration (per `spec/05-non-functional/test-strategy.md`):** assembly ordering + pin-holds-across-mid-run-edit (AC-5.ASM.001.1/.002.1); safety-element halt (AC-5.ASM.003.1); gate denial + approval-block + late-discovered re-entry (AC-5.ASM.004.1/.2); memory-read scope predicate fails closed + cap (AC-5.ASM.006.1/.2, AC-NFR-PERF.006.1); per-step invocation order with a flagged/quarantine branch (AC-5.ASM.007.1/.2); pill-on-every-output incl. "mode unknown" (AC-5.ASM.008.1, AC-NFR-OBS.012.*); dual-record write + durable chained successor (AC-5.ASM.009.1/.2, AC-NFR-OBS.003.1).
- **Mid-task re-check:** deactivation/clearance-revoke halts-and-retains before the next side effect; benign session-expiry continues (AC-5.ASM.005.1). This path's clearance lookups must sit behind the **AF-067**-proven live-permission pattern (`(select helper())` initPlan, indexed policy columns) before ship.
- **Security gate (SPIKE-GATE):** the **AF-068** red-team battery (ISSUE-003) must show no injected instruction reaches a consequential side effect through assembly or the gate sequence without hitting a code-enforced hard limit / RBAC / approval gate — the AC→`Verified` path for NFR-SEC.004/006 (AC-NFR-SEC.004.3, AC-NFR-SEC.006.1) and NFR-SEC.007 (AC-NFR-SEC.007.1) for this slice.
