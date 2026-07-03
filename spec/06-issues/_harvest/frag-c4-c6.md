# Phase 6 Coverage Inventory — Components 4–6 (Prompt, Harness, Guardrails)

**Prepared:** 2026-07-02 | **Scope:** FR decomposition for C4, C5, C6 | **Status:** Ready for slicing

---

## Component 4 — Prompt Architecture (C4)

**ID:** C4 | **Name:** Prompt Architecture | **Total FRs:** 32 | **Status:** 🟢 Approved 2026-06-26

### Area: LYR — Layer model & assembly contract (4 FRs)
*Defines the four-layer structure, ordering, per-agent L1, mid-run immutability, and assembly validation.*

- FR-4.LYR.001 — Four-layer prompt structure (core, business, memory, task — fixed order)
- FR-4.LYR.002 — Layer 1 is per-agent, not global (orchestrator + specialists each own their L1)
- FR-4.LYR.003 — Layer 1 is immutable mid-run (version pinning, FR-4.STO.006)
- FR-4.LYR.004 — Assembly-time required-element validation (halt if L1 lacks boundary instruction, hard-limit statement, or principles block)

### Area: CID — Layer 1 Core Identity content (6 FRs)
*Specifies the mandatory Layer 1 content: identity, principles, communication style, hard limits, uncertainty handling, answer mode.*

- FR-4.CID.001 — Layer 1 required content set (six elements: who, principles, style, limits, scope, answer mode)
- FR-4.CID.002 — Layer 1 length bound advisory (~500 words, non-blocking warning)
- FR-4.CID.003 — Layer 1 external-data boundary instruction (data never instructions; C4 owns instruction presence, C6 owns tagging+sanitization)
- FR-4.CID.004 — Layer 1 states the hard limits (prompt statement paired with C6 code enforcement; both, never just one)
- FR-4.CID.005 — Uncertainty & conflicting-instruction handling (defaults to principles; confirm-when-uncertain, memory-as-context, stay-in-lane)
- FR-4.CID.006 — Answer-mode signalling convention (Cited/Inferred/Unknown; never dead-end; pill rendering/evaluation → C5/C8)

### Area: BIZ — Layer 2 Business Context (3 FRs)
*Shared deployment context, static vs dynamic fields, value sources.*

- FR-4.BIZ.001 — Layer 2 shared business content (name, description, tone, tool stack, approvals, hours, escalation paths; shared across all agents)
- FR-4.BIZ.002 — Static vs dynamic Layer 2 split (explicit classification; dynamic fields injected at assembly, not baked)
- FR-4.BIZ.003 — Dynamic field declaration + value source (declared in config; live values in operator-editable store; staleness surfaced to operator, required not optional)

### Area: INJ — Layer 3 Memory Injection (4 FRs)
*Per-agent and sensitivity scoping of injected memory.*

- FR-4.INJ.001 — Layer 3 carries retrieved memory (presented as Business Context)
- FR-4.INJ.002 — Per-agent memory scoping (agent receives only memories within its `memory_scope`; finance agent ≠ campaign memories)
- FR-4.INJ.003 — Sensitivity-clearance scoping of Layer 3 (no above-clearance memory; Restricted never auto-injected; containment-breach halt-and-audit if filter bypassed)
- FR-4.INJ.004 — Layer 3 volume bound (configurable per-task limit, token-cost control via `memories_injected_per_task`)

### Area: TSK — Layer 4 Task Instruction (3 FRs)
*Per-call task, parameters, output format, task templates.*

- FR-4.TSK.001 — Layer 4 task content (instruction, parameters, constraints, **explicitly specified** output format; never implicit)
- FR-4.TSK.002 — Task templates (reusable stored templates, versioned `layer='task_template'`, populated with runtime parameters)
- FR-4.TSK.003 — Task templates are versioned assets (same version + change_reason + rollback discipline as other layers)

### Area: PRIN — Operating principles (3 FRs)
*The shared seven-principle block in every Layer 1; Super-Admin-editable with floor protection.*

- FR-4.PRIN.001 — The canonical operating-principles block (seven principles verbatim: observe before acting, confirm-uncertain, prefer-reversible, flag-sensitive, memory-is-context, stay-in-lane, be-honest)
- FR-4.PRIN.002 — Principles are shared, Super-Admin-editable, with seven-principle floor held (editable only by Super Admin via `PERM-prompt.edit_principles`; mandatory `change_reason`; safety-relevant event to C7; hard-block removal attempt; six refinement/strengthen ok)
- FR-4.PRIN.003 — Principles state what code enforces (not enforcement itself; prefer-reversible→C6 approval, memory-is-context→C2, stay-in-lane→C1 RBAC)

### Area: STO — Prompt storage & versioning (6 FRs)
*`prompt_layers` store, edit path, version discipline, rollback.*

- FR-4.STO.001 — The prompt store (`prompt_layers`: id, layer, name, content, agent_id, client_slug, enabled, version, created_at, created_by, previous_version_id, change_reason)
- FR-4.STO.002 — Layer 1 single source of truth (`prompt_layers` is authoritative for all four layers; `agents.system_prompt` removed/derived; no duplication)
- FR-4.STO.003 — Edit-in-place forbidden; version on every change (never overwrite; increment version; retain prior versions via `previous_version_id`; mandatory `change_reason`)
- FR-4.STO.004 — Version history viewable + rollback supported (prior versions viewable; rollback creates new version with `change_reason`; no destructive revert)
- FR-4.STO.005 — Dashboard edit without redeployment (editable from dashboard; general content `PERM-prompt.edit` (Super Admin + Admin); principles `PERM-prompt.edit_principles` (Super Admin only))
- FR-4.STO.006 — Version pinning across an edit (task version pinned at assembly; in-flight tasks complete on pinned version; new tasks use new version post-edit)

### Area: OPT — Optimisations (3 FRs)
*Version performance tracking, dynamic Layer 2, compression.*

- FR-4.OPT.001 — Prompt versioning with performance tracking (version identity stable; outcome attribution enabled; version-in-force captured; AF-111 gates feasibility)
- FR-4.OPT.002 — Dynamic Layer 2 injection (current goals, active campaigns, this-week priorities injected fresh each session; no redeploy/reboot needed)
- FR-4.OPT.003 — Prompt compression is maintained discipline (audited word-by-word; inconsistently-followed content removed; compressed preferred over organic; AF-111 gates feasibility)

#### C4 Touchpoints

**DATA-prompt_layers:** schema per FR-4.STO.001; dynamic-field value store (per OD-052); `agents.system_prompt` removed/derived (OD-048) → C8 Phase 4

**PERM-** nodes:
- `PERM-prompt.edit` (Super Admin + Admin, L556)
- `PERM-prompt.edit_principles` (Super Admin only — new per OD-049)
- `PERM-prompt.view_history` (L557–558)
- `PERM-prompt.rollback` (L557–558)

**CFG-** keys:
- `memories_injected_per_task` (Layer-3 volume, L914)
- `business_context.dynamic_fields` list (L851)
- `dynamic_field_freshness_threshold` (AC-4.BIZ.003.3)

**UI-** surfaces:
- Prompt-layer editor (content + version + mandatory change_reason + word-count advisory)
- Principles-editor (Super-Admin-only, safety-warning per OD-049)
- Version-history + rollback view (L557–558)
- Dynamic-Layer-2 value editor with `last_updated` hint (per OD-052)

**AF-** feasibility gates:
- **AF-111** (version-to-outcome attribution is signal not noise at low volume; compressed/audited prompts measurably outperform — EVAL, build-time)

#### C4 Seams

- **Runtime prompt-stack assembly** → C5 Agent Harness (L3338–3347). C4 defines layers; C5 assembles them.
- **Memory retrieval/ranking + clearance enforcement before injection** → C1/C2 (FR-1.CLR.006, FR-2.RET.004). C4 scopes Layer 3; C2/C5 enforce gate.
- **External-data tagging + injection sanitization** → C6 Guardrails (L2940). C4 owns Layer-1 boundary *instruction* (FR-4.CID.003).
- **Hard-limit enforcement in code** → C6 (+ C3 FR-3.ACT.002). C4 owns Layer-1 *statement* (FR-4.CID.004).
- **Answer-mode pill rendering/evaluation** → C5/C8 (consumes C2 FR-2.RET.007). C4 owns Layer-1 signalling instruction.
- **Orchestrator routing logic** → C8 Agent Design (L3387–3417). C4 owns orchestrator's own Layer 1; routing behaviour is C8.
- **Prompt-health/version-performance signals** → C7 Observability (L3578, L3589–3591). C4 owns version identity + pin (FR-4.OPT.001); C7 owns signals.
- **`agents` registry** → C8. C4 touches only Layer-1 storage (OD-048); rest of registry is C8.

#### C4 Gating AFs

- **AF-111** gates FR-4.OPT.001 / OPT.003 (version attribution + compression efficacy — EVAL, build-time; no FR blocked, but feasibility proof required)

---

## Component 5 — Agent Harness (C5)

**ID:** C5 | **Name:** Agent Harness (Execution) | **Total FRs:** 43 | **Status:** 🟢 Approved 2026-06-26

### Area: TRG — Triggering (5 FRs)
*Four trigger types, config-defined registry, verified webhook ingress, chained scope, at-least-once delivery.*

- FR-5.TRG.001 — Four trigger types (event/scheduled/human/chained; recorded in `task_queue.type`; deployment-freeze gate at dispatch boundary per OD-091 / OD-162)
- FR-5.TRG.002 — Triggers are config-defined, not hardcoded (new trigger added to config; enablement per deployment; no code change at boot)
- FR-5.TRG.003 — Event triggers consume verified webhook ingress (C0 FR-0.WHK.* auth + C3 FR-3.TRIG.* receiver contract; never unverified)
- FR-5.TRG.004 — Chained trigger on completion (fresh scope + handoff; handoff payload + provenance link; re-run memory retrieval under own scope/clearance; doesn't inherit parent envelope)
- FR-5.TRG.005 — Verified event → task is at-least-once, never silent no-op (C3→C5 seam: committed `task_queue` row or loud ingest-failure event + delivery watermark; one-shot event has no second chance)

### Area: QUE — Task queue & lifecycle (6 FRs)
*`task_queue` schema, status state machine, priority, approval state, error record.*

- FR-5.QUE.001 — `task_queue` is permanent audit record (every task recorded; never deleted; source of truth for what happened and when)
- FR-5.QUE.002 — Task record schema (id, type, task_name, payload, status, priority, requires_approval, approved_by, approved_at, attempts, next_retry_at, client_slug, created_at, completed_at, error; client_slug label-only)
- FR-5.QUE.003 — Status state machine incl. guardrail/quarantine state (enum extends `pending → running → awaiting_approval → completed | failed` with explicit `flagged`/quarantine state distinct from approval wait; no undefined status persisted)
- FR-5.QUE.004 — Priority ordering (dequeue by `priority` order; configurable scheme; lower number = higher priority)
- FR-5.QUE.005 — Approval state blocks execution (requires_approval task → awaiting_approval, does not execute until human approves; escalation on staleness, never auto-approved)
- FR-5.QUE.006 — Error recording & full history (every failed run records error text; full history preserved across attempts; never collapsed to single last-error)

### Area: GRP — Task graphs (4 FRs)
*Versioned multi-step sequences, step dependencies, idempotency keys, resume-from-failure.*

- FR-5.GRP.001 — Defined task graph per task type (ordered multi-step sequence with explicit dependencies; harness executes graph, never ad-hoc; missing graph fails loud at creation/dequeue)
- FR-5.GRP.002 — Task graphs are versioned (new version on edit; prior versions retained; mandatory `change_reason`; mirrors C4 prompt-version discipline)
- FR-5.GRP.003 — Idempotency keys per task and per step (generated at creation; prevents duplicate completed-step work on retry; key committed no later than side effect; collision-resistant)
- FR-5.GRP.004 — Resume from first incomplete step (retried task resumes at first incomplete step; completed-step outputs preserved + reused; not re-executed from start)

### Area: ENV — Context envelope (3 FRs)
*Stateful per-task container, step-output accumulation, inter-step compression.*

- FR-5.ENV.001 — Context-envelope structure (task_id, original_request, entities, memory_retrieved, execution_plan, current_step, previous_outputs, shared_context; travels through entire chain)
- FR-5.ENV.002 — Every step reads full envelope; no cold start (every step reads envelope, appends output to `previous_outputs`, passes updated envelope to next step)
- FR-5.ENV.003 — Inter-step compression in long chains (lossless source) (earlier outputs compressed into summaries per configurable token/step threshold; **full original outputs retained in durable step record** — economy, never loss; AF-114/115 gate durability)

### Area: LOP — Loop architecture (5 FRs)
*Three default loops, configurable cadences, config-extensibility, catch-up/overlap, failure alert.*

- FR-5.LOP.001 — Three default loops with configurable cadence (fast 5–15 min, medium 1–4 h, slow daily/weekly; each has named task list)
- FR-5.LOP.002 — Loops are config-extensible at boot (new loop in config; discovered + registered at boot as Inngest cron; no code change)
- FR-5.LOP.003 — Loops run independently (all loops run independently; may fire in parallel without blocking each other)
- FR-5.LOP.004 — Missed-run catch-up & same-loop overlap (no concurrent same-loop runs; single catch-up on miss, not backfill-all; idempotency prevents duplicate work; AF-112 gates)
- FR-5.LOP.005 — Loop failure alert & run logging (three consecutive failures trigger alert; every run logged with timestamp + outcome)

### Area: JOB — Job execution (Inngest) (7 FRs)
*Inngest as engine, step-level retry, fan-out, idempotency, dead letter queue, v1 hosting.*

- FR-5.JOB.001 — Inngest is execution engine (cloud-hosted for v1; no execution-time limit; chosen over Edge Functions (2s CPU cap) + pg_cron; AF-017/018 verify)
- FR-5.JOB.002 — Task type = Inngest step function; step-level retry (each task maps to Inngest step function; step fails → step retries, not whole chain; context envelope accumulates step state)
- FR-5.JOB.003 — Retry with backoff; idempotent execution (configurable exponential backoff per job type; unique event id prevents duplicate execution on retry)
- FR-5.JOB.004 — Inngest executes, task_queue records (single retry authority) (Inngest is execution engine; task_queue is audit projection synced from it; no double-execution)
- FR-5.JOB.005 — Fan-out (single event triggers multiple parallel jobs; each tracked; partial fan-out failure detected + surfaced, never silent)
- FR-5.JOB.006 — Dead letter queue (human-only recovery) (exceeds retry count → DLQ; full error history + final reason; never auto-retried; explicit human requeue/discard; DLQ age triggers escalating heartbeat signal)
- FR-5.JOB.007 — v1 hosting = Inngest cloud (cloud-hosted, managed, no infrastructure; self-hosted post-v1 — OOS)

### Area: ASM — Assembly & run pipeline (9 FRs)
*Assemble 4 layers → version-pin → safety-validate → gate-sequence → execute step-by-step → pill → complete.*

- FR-5.ASM.001 — Prompt-stack assembly per task (assemble four layers: L1+L2+L3+L4; inject dynamic + memory values; concatenate in fixed order; C4 content, C5 assembly)
- FR-5.ASM.002 — Version pinning at assembly (pin layer versions at assembly; in-flight task completes on pinned versions; new tasks use new versions post-edit)
- FR-5.ASM.003 — Assembly-time safety-element validation (execute C4 FR-4.LYR.004: halt + surface loud if resolved L1 lacks boundary instruction, hard-limit statement, or principles block)
- FR-5.ASM.004 — Pre-execution gate sequencing (after assembly: check RBAC + clearance + tool permissions (C1), evaluate requires_approval (→ awaiting_approval); execution only on auth pass + approval granted)
- FR-5.ASM.005 — Mid-task authorization re-check (implements C1 FR-1.RLS.007/OD-031) (service_role task binds originating user; each step/injection boundary re-check user active status + relied-on clearances; deactivation/clearance-revoke → halt + quarantine before consequential side effect; benign session-expiry continues)
- FR-5.ASM.006 — Memory read flow before task (invoke C2 memory read flow; entity extraction → dual search → filter → clearance gate → rank → inject; store result in envelope's `memory_retrieved`; agent's `memory_scope` applied as additional retrieval predicate; fails closed if predicate unapplied)
- FR-5.ASM.007 — Per-step execution order (anomaly-check → tool-read → sanitize+boundary-tag tool output (C6 FR-6.INJ.004/006) → AI-call → tool-write → memory-write; C5 owns harness invocation points; C6 owns mechanism)
- FR-5.ASM.008 — Answer-mode pill on every output (every substantive AI output carries [Cited]/[Inferred]/[Unknown] pill without exception; C5 attaches; rendering C8; accuracy AF-033)
- FR-5.ASM.009 — Completion: chained trigger + dual record (on completion: fire chained trigger if configured; record outcome in event_log (C7) + task_queue `completed_at`; durable chained-successor creation)

### Area: OPT — Optimisations (4 FRs)
*Parallel step execution, smart scheduling, task decomposition, chained-task pre-warm.*

- FR-5.OPT.001 — Parallel step execution (per-deployment) (independent steps run simultaneously per config; respects dependency DAG; approval-gated step blocks itself + dependents; irreversible step never outruns pending approval; AF-113 gates)
- FR-5.OPT.002 — Smart scheduling (scheduled non-urgent tasks run when queue quiet; configurable; avoids congestion)
- FR-5.OPT.003 — Task decomposition (planning step) (complex tasks: upfront planning/decomposition before execution; ordered, dependency-aware step chain; stored in envelope's `execution_plan`)
- FR-5.OPT.004 — Chained-task pre-warm (Task B's memory retrieval may pre-warm while Task A still running; read-only optimization; respects OD-059 scope rule; discarded if B never runs)

#### C5 Touchpoints

**DATA-task_queue:** schema per FR-5.QUE.002; task-graph version store; context-envelope persistence; task-history (Phase 4 consolidation for originals-store durability, AF-115)

**CFG-** keys:
- Loop cadences (fast, medium, slow ranges)
- Retry counts per job type
- Compression threshold (token/step)
- Priority scheme
- Parallel execution on/off
- Smart scheduling on/off
- Anomaly-check cadence (with C6)

**UI-** surfaces:
- Task queue + approval dashboard
- Dead-letter-queue view + requeue/discard affordances
- Loop run history + failure alerts
- Envelope/step-output viewer

**AF-** feasibility gates:
- **AF-112** (missed/overlapping loop catch-up doesn't duplicate; idempotency holds at scale — LOAD/EVAL)
- **AF-113** (parallel-step DAG honours dependencies + no shared_context race; irreversible never outruns approval — SPIKE/LOAD)
- **AF-114** (inter-step compression preserves task-critical state; no silent context loss — EVAL)
- **AF-115** (originals-store retains uncompressed outputs longer than longest chain + audit window; else persist to C5-owned durable store — DOCS/SPIKE)

#### C5 Seams

- **Hard-limit / approval-gate enforcement + injection sanitization + anomaly detection** → C6. C5 invokes check at step boundary (FR-5.ASM.007); C6 owns policy + mechanism.
- **Approval routing** → C6. C5 moves to `awaiting_approval`; C6 owns routing rules.
- **Event-log sink, metrics, alert delivery, cost meter + ladder signal** → C7. C5 emits run/loop/DLQ events; C7 owns sinks + alerting.
- **Cost-ladder enforcement (throttle/hard-kill)** → C6 decides, C5 executes. C7 signals breach (FR-7.COST.003); C6 decides via FR-6.RTL.004; C5 executes throttle/kill.
- **Orchestrator routing, agent registry, multi-agent dispatch** → C8. C5 runs *an* agent's stack; C8 owns which agent + registry.
- **Memory read/write mechanisms, ranking, sole-writer commit** → C2. C5 sequences within task graph; C2 owns internals.
- **Tool execution, connector token lifecycle, rate-limit ladder** → C3. C5 issues tool steps; C3 owns runtime.
- **Prompt-layer content + version identity** → C4. C5 assembles + pins; C4 owns content.
- **Compensation/rollback of applied side effects on mid-chain halt** → OD-010. C5 halts + quarantines; undo is C5/C6/C8 build.

#### C5 Gating AFs

- **AF-112** gates FR-5.LOP.004 / OD-057 (loop catch-up idempotency at scale)
- **AF-113** gates FR-5.OPT.001 / OD-056 (parallel execution DAG + no approval outrun)
- **AF-114** gates FR-5.ENV.003 / OD-055 (compression preserves needed state)
- **AF-115** gates FR-5.ENV.003 / FR-5.GRP.004 (originals-store retention lifetime)
- **AF-135** gates FR-5.TRG.001 (deployment-freeze propagation across all dispatch paths)

---

## Component 6 — Guardrails (C6)

**ID:** C6 | **Name:** Guardrails (Enforcement) | **Total FRs:** 36 | **Status:** 🟢 Approved 2026-06-26

### Area: HRD — Hard-limit enforcement (4 FRs)
*Code-side enforcement of seven hard limits; immediate log-and-alert; un-overridable posture.*

- FR-6.HRD.001 — Code-layer enforcement of the seven hard limits (no role/config/instruction can override: ① external email, ② financial transaction, ③ record delete, ④ cross-client data share, ⑤ impersonate human, ⑥ self-approve, ⑦ treat tool content as instructions; AF-068 gates enforceability)
- FR-6.HRD.002 — Every hard-limit hit is logged immediately and alerted, never silent (write `guardrail_log` type `hard_limit`; immediate dashboard alert + admin Slack; log-write failure doesn't roll back the block)
- FR-6.HRD.003 — A hard-limit violation is not human-overridable (no approve/override affordance; block + log + alert only; approval queue resolutions apply only to approval-gate/anomaly/injection flags)
- FR-6.HRD.004 — The seven-limit set is audited safe-default; coverage gaps route to gates, not new limits (seven complete for v1; additional dangerous actions covered by hard-approval (FR-6.APR.002) + rate-limit caps (FR-6.RTL.001); any change → change-control; AF-068 gates)

### Area: APR — Approval gates (6 FRs)
*Three-tier policy + mandatory-hard set + contextual routing + seam contract.*

- FR-6.APR.001 — Three-tier approval classification (auto-approve / soft / hard by risk_level + reversibility/sensitivity; exactly one tier assigned; default = hard if uncertain)
- FR-6.APR.002 — Mandatory hard-approval set (floored: **all external communications** (no sub-type exemption per OD-161), financial-record operations, Confidential/Restricted memory operations; never configurable below hard; consumes C1 FR-1.CLR.*/RST.003)
- FR-6.APR.003 — Soft-approval auto-execute is reversible-only (soft-tier auto-executes after delay **only if reversible**; irreversible/external-communication/financial/Confidential/Restricted forced hard by FR-6.APR.002, never auto-execute; soft approval on inaction may be promoted to explicit by reviewer Hold)
- FR-6.APR.004 — Auto-approve immediate execution (low-risk auto-approve executes immediately without human step; tier decision logged)
- FR-6.APR.005 — Contextual approval routing (route by action type/context via configurable rules; unavailable reviewer falls back + escalates; initiator ≠ approver, no self-approval at human tier)
- FR-6.APR.006 — C5 seam contract (C6 decides tier, C5 enacts block; no overlap/gap)

### Area: ANM — Anomaly detection (5 FRs)
*Five pre-step checks, detection-as-signal severity, configurable thresholds, baseline learning.*

- FR-6.ANM.001 — Pre-step anomaly check (runs before each task step, invoked by harness at step boundary (C5 FR-5.ASM.007); never after step acts)
- FR-6.ANM.002 — The five anomaly checks (confidence drop, volume spike, live-vs-memory contradiction, scope expansion, sentiment negative/urgent; AF-116 gates accuracy)
- FR-6.ANM.003 — Anomalies are signals, not autonomous gates (default: pause + flag for soft review; per-anomaly, per-deployment configurable severity escalates to hard-approval; no autonomous discard)
- FR-6.ANM.004 — All anomaly thresholds configurable per deployment (every threshold tunable; shipped values are starting points; config-driven, no code change)
- FR-6.ANM.005 — Baseline learning from historical data (baselines computed from history; thresholds adapt to demonstrated normal behaviour; gate-altering change requires admin confirmation, never silent)

### Area: RTL — Rate-limit guardrails (4 FRs)
*Five configurable-never-unlimited caps, ownership split, breach response, cost-ladder enforcement.*

- FR-6.RTL.001 — The five configurable, never-unlimited caps (max tool writes/task, max external comms/hour, max memory writes/min, max concurrent tasks/deployment, max retries-to-DLQ; none settable unlimited; meaningful finite ceiling enforced)
- FR-6.RTL.002 — Ownership split (policy here, mechanism at home owner) (C6 frames all five as guardrails; delegates enforcement to C2 (memory), C5 (concurrency/DLQ), C3/C6 (tool/comms); consistent breach response)
- FR-6.RTL.003 — Breach response: log + ladder (write `guardrail_log` type `rate_limit`; soft alert → throttle non-critical → hard stop; irreversible/billed action at cap → halt-and-escalate, never auto-retry)
- FR-6.RTL.004 — Cost-ladder enforcement (C7 meters → C6 decides → C5 executes) (C7 signals cost ladder rung; C6 directs throttle/kill; C5 executes; soft → throttle → hard-kill progression; never silent, never overrides hard limit)

### Area: ESC — Escalation / flagged workflow (4 FRs)
*Guardrail-hit → pause → flagged; reviewer notification; three resolutions + already-applied effects shown; no silent abandon.*

- FR-6.ESC.001 — Guardrail hit → pause → `flagged` (on guardrail hit: pause task, set status `flagged` (distinct from `awaiting_approval`); defined in C5 schema, SET by C6; hard-limit hit → kill + log, no resume; multiple hits → most-restrictive governs, each logged)
- FR-6.ESC.002 — Reviewer notification + queue placement (notify designated reviewer (dashboard + optionally Slack) immediately; place in approval queue; C6 owns routing, C7/C8 own delivery/UI)
- FR-6.ESC.003 — Three resolutions: approve/reject/modify (+ already-applied effects shown) (approve → resume from pause point, reject → cancel + log reason, modify → re-queue; **display already-applied side effects**; reversible external write before halt → queue explicit human-visible compensation/cleanup task, never auto-rollback; irreversible marked non-compensable)
- FR-6.ESC.004 — No flagged item silently abandoned; escalation timeout (configurable escalation timeout; un-actioned flag escalates (alert + badge), never auto-resolved/dropped; repeated escalations widen; reuses C1 OD-028 / C2 OD-032 / C5 AC-5.QUE.005.2 pattern; named staleness owner for `flagged` and `awaiting_approval`)

### Area: INJ — Injection sanitization (6 FRs)
*Four-step pipeline (regex / boundary-wrap / log / quarantine), ADR-007-reconciled.*

- FR-6.INJ.001 — Every monitored-tool content passes application-layer pipeline (before injection into any prompt layer, in code; prompt instruction alone insufficient; named harness call site between tool-read and AI-call per C5 FR-5.ASM.007)
- FR-6.INJ.002 — Step 1a: deterministic regex pattern detection (always-on) (scan for known literals: "ignore previous", "ignore all previous", "disregard your", "you are now", "new system prompt", "as an AI you must", "[SYSTEM]", "[INST]", "Assistant:", "Human:" — regex always-on; high-confidence literal can quarantine alone)
- FR-6.INJ.003 — Step 1b: semantic-similarity scan is OFF by default (`injection_semantic_detection_enabled` off at boot; when enabled: embed content, compare to known-injection library, flag above 0.85; additive signal only, never autonomous gate; thresholds are signal knobs; AF-117 gates library coverage)
- FR-6.INJ.004 — Step 2: external-data boundary wrapping (all tool content wrapped in `<external_data>` tags with source/channel/timestamp before injection; C3 applies tag at read, C4 FR-4.CID.003 ensures Layer-1 instruction, C6 ensures pipeline ordering)
- FR-6.INJ.005 — Step 3: every match logged (every pattern match → `guardrail_log` type `prompt_injection` with source/trigger-content/pattern/action; match never detected-but-unlogged)
- FR-6.INJ.006 — Step 4: high-confidence quarantine = retain + route to human (score ≥ 0.95 or high-confidence literal regex → quarantine: not used in task, paused + flagged, retained (shadow-retain, never machine-discard), shown to reviewer; reviewer decides discard (logged, task continues without) or review-and-include (explicit approval); never proceeds with quarantined content without approval; staleness escalated)

### Area: LOG — Guardrail log (4 FRs)
*`guardrail_log` schema + 5 types, append-only, write-completeness, exportable.*

- FR-6.LOG.001 — The `guardrail_log` schema + five types (id, task_id, guardrail_type, description, action_blocked, status, reviewed_by, reviewed_at, client_slug, created_at; type ∈ {hard_limit, approval_gate, anomaly, rate_limit, prompt_injection}; client_slug label-only; `pending` covers all unresolved states, disambiguated by type)
- FR-6.LOG.002 — Append-only (no deletes/updates to historical rows; only controlled status/reviewed_by/reviewed_at transition on resolution, timestamped; mirrors C1 `access_audit` immutability)
- FR-6.LOG.003 — Write-completeness (C6 owns completeness: every guardrail event writes a row, never silent; C7 owns view/retention/export; distinct from `access_audit` (C1) + `event_log` (C7); log-write failure doesn't roll back block — block holds even if row fails)
- FR-6.LOG.004 — Exportable trust evidence + dedicated view (exportable as client compliance evidence; dedicated dashboard view; C6 owns exportable-content requirement; C7 owns view/export mechanism)

### Area: OPT — Guardrail optimisations (2 FRs)
*Approval-pattern learning, anomaly baseline learning.*

- FR-6.OPT.001 — Approval-pattern learning (admin-confirmed, never auto) (track approval patterns; surface tier-change candidates in dashboard; admin confirms — never silent auto-retiering; un-actioned candidate persists/re-surfaces, doesn't vanish)
- FR-6.OPT.002 — Anomaly baseline learning (build baselines from history; tighten/loosen thresholds on demonstrated normal behaviour; gate-altering change requires admin confirmation)

### Area: FMM — Failure-mode-map anchor (1 FR)
*No-silent-failure guardrail invariant + cross-component catalogue scoping.*

- FR-6.FMM.001 — The no-silent-failure guardrail invariant + catalogue scoping (every guardrail-class event detected, recorded, surfaced — never silent (#3); failure-mode map is cross-component catalogue: detection at home component, alert path via C7, C6 owns responses + invariant; doesn't re-implement detection; guardrail check itself-erroring fails closed → halts + flags + logs, never proceeds unchecked)

#### C6 Touchpoints

**DATA-guardrail_log:** schema per FR-6.LOG.001; injection_quarantine (Phase 4); escalated_at timestamp (Phase 4)

**PERM-** nodes (inherited from C1 RBAC):
- Approval routing roles (contextual reviewers per action type)
- Super Admin for approval promotion (Hold → explicit)

**CFG-** keys:
- All five rate-limit caps + meaningful-ceiling upper bounds per cap
- All five anomaly thresholds + per-anomaly severity levels (soft vs hard-approval)
- Anomaly baseline learning enable/disable
- Approval-pattern learning enable/disable
- Escalation timeout (flagged items, quarantine reviews)
- Soft-approval timeout (reversible-only actions)
- `injection_semantic_detection_enabled` (off by default)
- `injection_semantic_threshold` (0.85, signal knob)
- `injection_quarantine_threshold` (0.95, signal knob)

**UI-** surfaces:
- Approval queue (approve/reject/modify affordances; no approve for hard-limit type)
- Flagged-item reviewer (displays already-applied effects; compensation task creation)
- Quarantine review (discard vs include, with human-only log decision)
- Guardrail dashboard + export view (C7 seam for view/retention)
- Anomaly baseline candidate + approval-pattern candidate surfacing

**AF-** feasibility gates:
- **AF-068** (containment red-team: no authorized-but-dangerous autonomous path — gates HRD.001 / OD-047 enforceability, SPIKE/red-team, build-time)
- **AF-116** (sentiment/scope/volume anomaly detection accuracy — EVAL, false-positive/negative rates)
- **AF-117** (known-injection-embedding library coverage/quality — EVAL)

#### C6 Seams

- **Task-queue / loops / DLQ / context-envelope / run-pipeline execution** → C5. C5 invokes guardrail check at step boundary (FR-5.ASM.007); C6 owns policy + mechanism.
- **Event-log sink, metrics, alert delivery, dashboard views, retention, export, cost meter + ladder signal** → C7. C6 produces events; C7 owns channels.
- **Orchestrator routing, agent registry** → C8. C6 consumes routing rules; C8 owns orchestration.
- **Memory read/write mechanisms, health scans, confidence decay** → C2. C2 owns internals; C6 references as failure-map rows.
- **Tool execution, connector health, tool-state cross-check** → C3. C3 owns internals; C6 references as failure-map rows.
- **Prompt-layer content** → C4. C4 owns Layer-1 boundary instruction + hard-limit statement (the "both" half); C6 owns code enforcement.
- **Sensitivity-clearance rules** → C1. C1 owns model; C6 consumes tags for approval triggers.
- **Webhook authentication → C0**. C0 authenticates; C6 logs failed verification as `prompt_injection`.

#### C6 Gating AFs

- **AF-068** gates FR-6.HRD.001 / FR-6.HRD.004 / OD-047 (seven-limit enforceability red-team, build-time SPIKE)
- **AF-116** gates FR-6.ANM.002 (anomaly detection accuracy, EVAL)
- **AF-117** gates FR-6.INJ.003 (injection-embedding library coverage, EVAL)

---

## OD-157 Launch-Gating Spikes Summary

The six OD-157-identified launch-gating spikes touch components 4–6 as follows:

| AF | Spike | Component(s) Gating | FRs Affected | Gating Type |
|---|---|---|---|---|
| **AF-068** | Injection/containment red-team | **C6** | FR-6.HRD.001 / FR-6.HRD.004 / FR-6.APR.002 (hard-approval floor) | SPIKE/Red-team (enforceability proof) |
| **AF-067** | RLS latency for multi-tenant at scale | **C1 / C5** | Not direct C4–C6; C5 consumes C1 FR-1.RLS.007 mid-task re-check | LOAD (cross-deployment isolation) |
| **AF-001** | Model cost control | **C6** (via FR-6.RTL.004) | FR-6.RTL.004 (cost-ladder enforcement) | DOCS/validation (pre-build) |
| **AF-078** | Webhook payload integrity | **C5** (via FR-5.TRG.003) | FR-5.TRG.003 (verified webhook ingress) | Already verified; C0/C3 seam |
| **AF-077** | Brute-force ingestion defense | **C5 + C6** (via rate-limits) | FR-5.LOP.004 (catch-up idempotency) + FR-6.RTL.001/003 (caps) | LOAD/Config (rate caps per deployment) |
| **AF-069** | State restoration on resume | **C5** | FR-5.GRP.004 / FR-5.ENV.003 (resume from incomplete step + compression durability) | AF-114/115 (originals-store retention) |

---

## Suggested Vertical-Slice Groupings (C4–C6)

**Rationale:** Organize decomposition by technical depth + cross-component hand-off points to maximize parallelism while respecting seams.

### Slice 1: Prompt Foundation (C4, with C5/C6 touchpoints)
**Vertical theme:** *Prompt content definition + storage; the "what the AI is" layer.*

**Includes:**
- C4 LYR.001/002/003 (four-layer structure, per-agent L1, immutability)
- C4 CID.001/003/004 (Layer 1 required content, boundary instruction, hard-limit statement)
- C4 STO.001/002/003 (single source of truth, version-never-overwrite discipline)
- C4 PRIN.001/003 (canonical principles, principles-as-statement-not-enforcement)
- **Touches:** C5 FR-5.ASM.001/002 (assembly, pinning); C6 FR-6.INJ.004 (boundary wrapping); C1 PERM (edit nodes)

**Deliverable:** Prompt schema + version store + single source of truth for all four layers.

---

### Slice 2: Prompt Safety Surface (C4 + C6 injection)
**Vertical theme:** *Prompt safety mechanisms — principles floor, hard-limit statement, boundary instruction; sanitization pipeline.*

**Includes:**
- C4 PRIN.002 (Super-Admin-editable, seven-principle floor hard-block)
- C4 LYR.004 (assembly-time validation of safety elements)
- C6 INJ.001/002/004/005 (sanitization pipeline: regex always-on, boundary wrapping, logging)
- **Touches:** C5 FR-5.ASM.003/007 (assembly-time halt, per-step invocation); C6 FR-6.HRD.001/002 (hard limits); C1 PERM (principles edit)

**Deliverable:** Immutable principles block + layer-1 validation gate + deterministic injection pipeline.

---

### Slice 3: Execution Triggering & Queuing (C5 TRG + QUE)
**Vertical theme:** *Task entry points + permanent audit record.*

**Includes:**
- C5 TRG.001/002/003 (four trigger types, config-defined, verified webhook ingress)
- C5 QUE.001/002/003/004 (task_queue permanent record, schema, status state machine, priority)
- **Touches:** C0 (webhook auth, C5 TRG.001.3 deployment-freeze gate); C3 (connector ingestion); C6 (status enum + `flagged` state)

**Deliverable:** Task queue schema + trigger registry + ingest contract.

---

### Slice 4: Approval Gates (C5 QUE.005 + C6 APR)
**Vertical theme:** *Human-in-the-loop control; three-tier gating policy.*

**Includes:**
- C5 QUE.005 (approval state blocks execution; escalation on staleness)
- C6 APR.001/002/003 (three-tier classification, mandatory-hard set, soft-timeout reversible-only)
- C6 APR.005 (contextual approval routing)
- C6 ESC.002/003/004 (reviewer notification, three resolutions, escalation timeout)
- **Touches:** C5 QUE.002 (requires_approval flag); C6 LOG.001 (approval_gate type); C7 (alert delivery, queue UI)

**Deliverable:** Approval tier policy + routing + resolution workflow.

---

### Slice 5: Memory Injection & Scoping (C4 INJ + C5 ASM.006)
**Vertical theme:** *What data reaches the agent; per-agent + clearance scoping.*

**Includes:**
- C4 INJ.002/003/004 (per-agent `memory_scope`, clearance gating, volume bound)
- C5 ASM.006 (memory read flow before task; scope + clearance as retrieval predicates)
- **Touches:** C2 (memory read mechanism, ranking, clearance-before-ranking); C1 (clearance model); C4 LYR.004 (assembly halt on missing Layer 1)

**Deliverable:** Memory injection contract + per-agent scope enforcement.

---

### Slice 6: Task Graphs & Resumability (C5 GRP + ENV)
**Vertical theme:** *Multi-step task orchestration + state continuity across retries.*

**Includes:**
- C5 GRP.001/002/003/004 (defined graphs, versioning, idempotency keys, resume-from-incomplete)
- C5 ENV.001/002/003 (envelope structure, full envelope per step, compression with originals retention)
- C5 JOB.002/003/004 (Inngest step functions, step-level retry, idempotent execution)
- **Touches:** C5 JOB.001 (Inngest engine choice); C6 (anomaly + approval gates); AF-112/113/114/115

**Deliverable:** Task graph + context envelope schemas + idempotency key generation + resume logic.

---

### Slice 7: Loops, Scheduling & Batch Cadence (C5 LOP + OPT.003)
**Vertical theme:** *Recurring work; catch-up semantics; no backfill stampede.*

**Includes:**
- C5 LOP.001/002/003/004/005 (three default loops, config-extensibility, parallel runs, catch-up + overlap prevention, heartbeat failure alert)
- C5 OPT.003 (task decomposition planning step)
- **Touches:** C5 TRG.002 (config-driven triggers); C6 (rate-limit caps); AF-112 (catch-up idempotency)

**Deliverable:** Loop registration + cadence config + catch-up dedup logic.

---

### Slice 8: Guardrails: Hard Limits (C6 HRD)
**Vertical theme:** *Seven absolute autonomous-action prohibitions; code-side enforcement only.*

**Includes:**
- C6 HRD.001/002/003/004 (seven limits in code, immediate log+alert, un-overridable, coverage via gates not new limits)
- **Touches:** C4 FR-4.CID.004 (Layer-1 statement); C3 FR-3.ACT.002 (declaration); C6 LOG.001 (hard_limit type); AF-068 (red-team)

**Deliverable:** Hard-limit gate + block-without-override logic + `guardrail_log` type.

---

### Slice 9: Guardrails: Anomaly Detection (C6 ANM)
**Vertical theme:** *Pre-step anomaly checks; detection-as-signal; baseline learning.*

**Includes:**
- C6 ANM.001/002/003/004/005 (pre-step check, five checks, signal-not-gate, configurable thresholds, baseline learning)
- **Touches:** C5 FR-5.ASM.007 (step-boundary invocation); C6 LOG.001 (anomaly type); C6 OPT.002; AF-116

**Deliverable:** Anomaly detection pipeline + threshold config + baseline learner.

---

### Slice 10: Guardrails: Rate Limits & Cost Ladder (C6 RTL)
**Vertical theme:** *Five configurable-never-unlimited caps + cost-ladder enforcement.*

**Includes:**
- C6 RTL.001/002/003/004 (five caps, ownership split, breach response, cost-ladder enforcement)
- **Touches:** C2 (memory-writes cap), C5 (concurrent-tasks/retries caps), C3 (tool-writes cap), C7 (cost meter), C6 LOG.001 (rate_limit type); AF-001

**Deliverable:** Rate-limit policy + enforcement delegation + cost-ladder decision logic.

---

### Slice 11: Guardrails: Injection Sanitization (C6 INJ + log + escalation)
**Vertical theme:** *Four-step injection pipeline; quarantine + human-review workflow.*

**Includes:**
- C6 INJ.002/003/006 (regex always-on, semantic OFF by default, high-confidence quarantine)
- C6 ESC.001 (quarantine → `flagged` state)
- C6 LOG.001/003 (guardrail_log `prompt_injection` type, write-completeness)
- **Touches:** C3 (boundary-tag application), C4 (Layer-1 instruction), C5 (step-order invocation, envelope retention), C6 FMM; AF-117

**Deliverable:** Regex pattern library + semantic-scan toggle + quarantine UI + injection log rows.

---

### Slice 12: Observability & Escalation (C5/C6 → C7)
**Vertical theme:** *Event logging, alert delivery, escalation timeouts.*

**Includes:**
- C5 LOP.005 (loop failure alert + run logging)
- C5 JOB.006 (DLQ heartbeat + escalation)
- C5 ASM.009 (completion dual record: task_queue + event_log)
- C6 ESC.002/004 (reviewer notification, escalation timeout on staleness)
- C6 LOG.004 (exportable trust evidence)
- **Touches:** C7 (event-log sink, metrics, alert delivery, cost meter, dashboard view), C5 ASM.005 (mid-task halt quarantine), C6 HRD.002 (hard-limit alert)

**Deliverable:** Event emission contract + alert trigger routing + escalation timeout rules + log export schema.

---

**Slice sequencing for parallelism:**
- **Phase-1 critical path:** Slices 1 → 3 → 8 (prompt foundation + task entry + hard limits form the safety backbone)
- **Phase-1 parallel:** Slices 2, 4, 5, 6, 7 (can run in parallel once schema/seams defined; all touch the same execution loop)
- **Phase-1 final:** Slices 9, 10, 11, 12 (guardrails + observability; depend on execution pipeline + event emission points)

