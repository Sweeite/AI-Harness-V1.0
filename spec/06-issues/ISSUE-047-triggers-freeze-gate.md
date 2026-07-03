---
id: ISSUE-047
title: Triggers + deployment-freeze gate
epic: F — harness
status: blocked
github: "#47"
---

# ISSUE-047 — Triggers + deployment-freeze gate

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Stand up the four trigger types and the config-defined trigger registry as the C5 entry boundary, with the deployment-freeze gate that fails closed at every dispatch site during an offboarding retention window.

## 2. Scope — in / out
**In:** The C5 **TRG** area — the harness's task-entry boundary. This slice delivers: the four trigger types (event / scheduled / human / chained) recorded on `task_queue.type`; the config-defined, no-code-change trigger registry (enable/disable per deployment at boot); the harness side of the verified-webhook ingress seam (consume-only — the harness accepts a trigger *only* from an already-verified webhook and publishes it to the job engine); the chained-trigger-on-completion handoff (fresh envelope + provenance link + own-scope memory re-retrieval); the at-least-once "verified event → task row or loud ingest-failure" delivery guarantee with a delivery watermark; and the **deployment-freeze gate** — a local read of `deployment_settings.frozen_at` that blocks and logs every dispatch path (each of the four triggers firing, a queued task dispatched to run, a chained successor) and fails closed on any status-resolution ambiguity, per OD-091 / OD-162.

**Out:** Webhook *authentication* itself (signature verify, replay, per-vendor schemes) is C0 WHK, owned by **ISSUE-017** — this slice only *consumes* the already-verified event at the C3→C5 ingress seam and never re-verifies. The C3 connector receiver contract / webhook liveness / re-arm is **ISSUE-037** (C3 TRIG). The `task_queue` permanent-record semantics, status state machine, priority, approval-block, and error history are C5 **QUE**, owned by **ISSUE-048** — this slice writes the `type` and originating `payload` on insert but does not own the record's lifecycle. Loop cadences and catch-up are C5 **LOP** (ISSUE-051). Idempotency keys / de-dup on re-delivery is C5 **GRP** (ISSUE-049, FR-5.GRP.003) — referenced by AC-5.TRG.005.2 but built there. *Setting* `client_registry.status = frozen` and *writing* `deployment_settings.frozen_at` (the management-plane side of the freeze) is C10 **OFF**, owned by **ISSUE-083** — this slice is the enforcement *consumer* that reads the local flag, mirroring the C8 OD-081 memory-scope policy/consumer split.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-5.TRG.001, FR-5.TRG.002, FR-5.TRG.003, FR-5.TRG.004, FR-5.TRG.005 (all Component 5 — Agent Harness)
- **NFRs:** NFR-INF.012 (deployment freeze gate fails closed at the dispatch boundary)
- **Rests on:** ADR-001 §7 (management plane / client silo isolation — the freeze flag is written into the client's own Supabase via the custodied `service_role`, never a cross-deployment query); OD-091 (freeze needs an enforcement consumer = the C5 dispatch gate); OD-162 (`deployment_settings.frozen_at` is the local mirror the C5 gate reads); OD-059 (chained task = fresh scope + handoff); AF-135 (freeze-propagation completeness — build-time SPIKE); AF-112 (at-least-once event delivery, referenced by FR-5.TRG.005)

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-5.TRG.001.1
- AC-5.TRG.001.2
- AC-5.TRG.001.3  (the deployment-freeze dispatch-boundary gate)
- AC-5.TRG.002.1
- AC-5.TRG.003.1
- AC-5.TRG.004.1
- AC-5.TRG.004.2
- AC-5.TRG.005.1
- AC-5.TRG.005.2
- AC-NFR-INF.012.1, AC-NFR-INF.012.2  (freeze gate fails closed at the dispatch boundary; fails closed on status ambiguity)
- **Gating spikes (if any):** **AF-135** (deployment-freeze propagation completeness — build-time SPIKE, currently launch-blocking per RP-1 / NFR-INF.012) must be GREEN before this issue ships: freeze a test deployment and confirm *every* dispatch path — event trigger, scheduled loop, manual task, chained successor — is blocked and logged, with no path slipping through. It is not one of the six OD-157 launch-gating spike issues (ISSUE-001..006); it is verified as this slice's own build-time spike per `feasibility-register.md` / `test-strategy.md`.

## 5. Touches (complete blast radius, by ID)
- **DATA:** DATA-task_queue (writes `type`, `payload` on trigger-created insert — schema per FR-5.QUE.002, owned by ISSUE-048); DATA-deployment_settings (reads `frozen_at` — the local freeze flag, single-row-per-deployment); DATA-event_log (freeze-block + ingest-failure events, via the C7 sink)
- **PERM:** none (freeze is set by C10 Super-Admin in ISSUE-083; this slice reads a data flag, not a permission)
- **CFG:** trigger definitions (conditions / schedules / enablement) live in deployment config per FR-5.TRG.002 — no dedicated `CFG-` key; registered at boot
- **UI:** none (no surface in this slice)
- **Connectors:** none directly — consumes the verified-event ingress seam from C0 (ISSUE-017) / C3 (ISSUE-037); GHL/Google/Slack instances arrive in ISSUE-039/040/041

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-05-harness.md §TRG — the FR text + ACs for FR-5.TRG.001–005
- spec/01-requirements/component-10-infra-compliance.md §OFF — FR-10.OFF.004 (retention-freeze; how `client_registry.status = frozen` writes `deployment_settings.frozen_at`) — the producer side of the flag this gate reads
- spec/04-data-model/schema.md §6 (Execution / Harness — `task_queue`) and §14 / `deployment_settings` (the OD-162 local freeze mirror)
- spec/05-non-functional/infrastructure.md §NFR-INF.012 — the fail-closed freeze-gate posture
- spec/00-foundations/adr/ADR-001-isolation-model.md §7 — management plane / silo isolation (the freeze-flag write path)
- spec/00-foundations/feasibility-register.md — AF-135 (freeze propagation), AF-112 (at-least-once delivery)

## 7. Dependencies
- **Blocked-by:** ISSUE-011 (observability skeleton — event_log append-only + silent-failure detector; the freeze-block and ingest-failure events land in its sink, and the at-least-once guarantee needs the loud-failure path to exist); ISSUE-017 (webhook authentication — provides the verified-event ingress this slice consumes; ISSUE-017 is itself gated by SPIKE ISSUE-006 proving **AF-078** GREEN — this slice must not consume an ingress boundary that isn't proven)
- **Blocks:** ISSUE-083 (C10 client-offboarding workflow — its retention-freeze step (FR-10.OFF.004) is inert without this C5 enforcement consumer; the freeze→hard-delete sequence depends on the gate built here actually stopping dispatch)

## 8. Build order within the slice
1. **Trigger-type write path** (FR-5.TRG.001 / AC-5.TRG.001.1–.2): on task creation, stamp `task_queue.type` (one of `scheduled | event | human | chained`, enum-constrained per schema §6 `task_type`) and the originating `payload`; reject any other value. (The row's full lifecycle is ISSUE-048 — write only `type`+`payload` here.)
2. **Config-defined trigger registry** (FR-5.TRG.002 / AC-5.TRG.002.1): discover + register trigger definitions from deployment config at boot; enable/disable per deployment with no code change; a disabled trigger creates no tasks.
3. **Verified-webhook ingress consumer** (FR-5.TRG.003 / AC-5.TRG.003.1): accept an event trigger *only* for a webhook that already passed C0 auth (ISSUE-017) + the C3 receiver contract (ISSUE-037); publish the verified event to the job engine; never accept an unverified webhook. This is a seam-consume step — do not re-implement verification.
4. **At-least-once delivery guarantee** (FR-5.TRG.005 / AC-5.TRG.005.1–.2): make accept→`task_queue`-row at-least-once with a delivery watermark; a verified event that produces no row is a recorded + surfaced ingest-failure (C7 sink), never a silent no-op; a re-delivered event de-dups via idempotency (FR-5.GRP.003, built in ISSUE-049). ⚠️ AF-112.
5. **Chained-trigger-on-completion handoff** (FR-5.TRG.004 / AC-5.TRG.004.1–.2): on successful completion with a chained trigger configured, create the successor with a **fresh** context envelope seeded by an explicit handoff payload + provenance link to the parent; the successor re-runs its own memory retrieval under its own scope/clearance (OD-059) — never inherits the parent's envelope or above-clearance memories.
6. **Deployment-freeze gate** (FR-5.TRG.001 / AC-5.TRG.001.3 + NFR-INF.012 / AC-NFR-INF.012.1–.2): before *any* dispatch — each of the four triggers firing, a queued task dispatched to run, a chained successor created — read `deployment_settings.frozen_at` **locally** (this client's own Supabase, no cross-deployment query, OD-162); if frozen (or on any status-resolution ambiguity), block, create/run nothing, write no new data, and log the block to event_log — the gate lives at the dispatch boundary, not as a status label. Wire it into *every* path from steps 1–5 (this completeness is exactly what AF-135 verifies).
7. **Guardrail / observability hook:** confirm every freeze-block and every ingest-failure emits to the ISSUE-011 event_log sink (fails loud, never silent — #3).
8. **Test to the ACs** (see Verification).

## 9. Verification (how DoD is proven)
- Per `spec/05-non-functional/test-strategy.md`: integration tests for the trigger-type write + config-registry boot path; a **freeze-propagation SPIKE (AF-135)** that freezes a test deployment and attempts each dispatch path (event trigger, scheduled loop, manual task, chained successor), asserting each is blocked + logged and that a status-resolution ambiguity also fails closed — this is the AC-5.TRG.001.3 / AC-NFR-INF.012.1–.2 proof; an at-least-once delivery test (AF-112) forcing an insert/engine failure and asserting a loud, recorded ingest-failure with no silent loss (AC-5.TRG.005.1–.2); a chained-handoff test asserting a fresh envelope + provenance link + no above-clearance memory leak (AC-5.TRG.004.1–.2).
- The `AC→Verified` path holds when: NFR-INF.012's fail-closed posture is demonstrated at the dispatch boundary (not merely at the label), AF-135 is GREEN in the feasibility register, and every DoD `AC-*` above passes its layer.
