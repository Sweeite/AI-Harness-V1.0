---
id: ISSUE-065
title: Agent health / drift / dead-agent metrics + producer heartbeat (flag-never-auto-correct)
epic: H — agent design
status: done
github: "#65"
---

# ISSUE-065 — Agent health / drift / dead-agent metrics + producer heartbeat (flag-never-auto-correct)

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR/NFR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Produce the C8 agent-health signals — per-agent success/failure rate + last-run, specialisation-drift
score, and dead-agent flag — plus a producer liveness heartbeat, under the invariant that C8 only
*produces and flags* these metrics (never auto-corrects, auto-disables, or renders them).

## 2. Scope — in / out
**In:**
- **Per-agent health aggregation** (FR-8.HLTH.001): roll task outcomes (from the orchestrator's
  outcome tracking, ORC.007) into `success_rate` / `failure_rate` / `last_run` per agent, written to
  `agent_health_metrics`, for C7 to poll. A high failure rate is *surfaced*, never auto-acted.
- **Specialisation-drift detection** (FR-8.HLTH.002): a periodic (slow-loop / scheduled) check that
  compares each agent's recent behaviour against its intended `memory_scope`/role, emits a
  `drift_score`, and *flags* it above `CFG-drift_threshold` — flag only, never auto-corrected.
- **Dead-agent detection** (FR-8.HLTH.003): the consistent-failure / low-quality signal (task
  success/failure + answer-mode-pill distribution + human approval/rejection outcomes, per OD-078)
  that sets `dead_agent_flag` above `CFG-dead_agent_threshold` — flag only, the agent **stays
  enabled** until a human decides (no auto-disable).
- **Metrics-produced-here / acted-elsewhere boundary** (FR-8.HLTH.004): C8 writes the metric store
  and takes **no** autonomous corrective action; C7 polls/renders, C9 turns metrics into suggestions,
  a human decides.
- **Producer liveness heartbeat** (AC-8.HLTH.004.2 / NFR-OBS.005): the health aggregator, the
  dead-agent detector, and the LRN.002 routing-mismatch detector each stamp `producer_heartbeat`;
  when a producer's heartbeat goes overdue its metric must read **stale/unknown**, never a
  carried-forward green — the #3 "no news ≠ good news" mechanism for these producers.

**Out:**
- **Rendering** of agent-health cards / drift / dead-agent flags / routing-outcome trends — Phase-3
  surfaces (**ISSUE-067** agent builder surface renders C8 REG/SPC/PLAN/HLTH; ops/self-improvement
  panels are C7/**ISSUE-078**/**ISSUE-073**). C8 produces the data contract + signals, not the screens.
- **Orchestrator outcome tracking + routing-mismatch metric production** (FR-8.ORC.007, FR-8.LRN.002)
  — owned by **ISSUE-061** (orchestrator) and **ISSUE-066** (learning). This slice *consumes* the
  outcome signal HLTH.001 aggregates and *heartbeats* the LRN.002 producer, but does not build the
  learning loop or the routing-mismatch detector itself.
- **The `event_log` append-only backbone, silent-failure detector, and alert-engine watchdog** —
  owned by **ISSUE-011**; this slice reads `event_log` outcomes and emits its own producer heartbeat
  onto that backbone, but does not build the timeline or the watchdog.
- **Any auto-correction / auto-disable behaviour** — explicitly *never built* (OD-078 / NFR-OBS.015):
  the disable action, if a human takes it, rides the registry-edit path (`agents.enabled`,
  ISSUE-061/067), not this slice.
- **Result caching, cost-routing, orchestrator learning** (FR-8.LRN.*, FR-8.COST.*) — ISSUE-066.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-8.HLTH.001, FR-8.HLTH.002, FR-8.HLTH.003, FR-8.HLTH.004 (all Component 8 — Agent Design).
- **NFRs:** NFR-OBS.005 (metric-producer liveness — stale, never green), NFR-OBS.015 (drift /
  dead-agent flag-never-auto-correct).
- **Rests on:** OD-078 (drift + dead-agent detection: flag-only, never auto-disable; quality signal =
  success/failure + answer-mode pill + approval/rejection; C8 produces, C7 surfaces, a human decides),
  AF-118 (absence-of-signal detection liveness — the heartbeat's build-time proof), AF-123 (drift
  detection accuracy), AF-124 (dead-agent / low-quality signal reliability).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR/NFR)
- AC-8.HLTH.001.1, AC-8.HLTH.001.2
- AC-8.HLTH.002.1, AC-8.HLTH.002.2
- AC-8.HLTH.003.1, AC-8.HLTH.003.2
- AC-8.HLTH.004.1, AC-8.HLTH.004.2
- AC-NFR-OBS.005.1 · AC-NFR-OBS.015.1
- **Gating spikes (if any):** these are **build-time SPIKEs** in `feasibility-register.md` (none is an
  OD-157 launch-spike ISSUE-001–006; they are attached here as DoD notes per the coverage ledger's
  NFR-TEST line):
  - **AF-118** — absence-of-signal detection is only as live as its evaluator; **blocking (RP-1)** per
    `observability.md` — gates the producer-heartbeat / stale-never-green mechanism (AC-8.HLTH.004.2 /
    NFR-OBS.005).
  - **AF-123** — specialisation-drift detection accuracy (EVAL); gates FR-8.HLTH.002. Fast-follow: the
    flag-only posture (OD-078) already de-risks it, but the score must be shown to separate real drift
    from noise before the flag is trusted.
  - **AF-124** — dead-agent / low-quality signal reliability (EVAL); gates FR-8.HLTH.001/003.
    Fast-follow for the same reason (flag-only, human decides).

## 5. Touches (complete blast radius, by ID)
- **DATA:** `DATA-agent_health_metrics` (fields `agent_id`, `success_rate`, `failure_rate`,
  `last_run`, `drift_score`, `dead_agent_flag`, `routing_mismatch_count`, `producer_heartbeat`,
  `updated_at`); reads `DATA-event_log` (outcome + answer-mode events) and `DATA-agents`
  (`memory_scope`/role for the drift comparison, `enabled` — read-only, never written here).
- **PERM:** none defined or gated by this slice (metric production is infrastructure; the human
  disable action that consumes these flags rides `PERM-agents.manage`, owned by ISSUE-061/067).
- **CFG:** `CFG-drift_threshold` (default 0.3), `CFG-dead_agent_threshold` (default 0.5 success-rate),
  `CFG-polling_interval_health_metrics_s` (default 30 — C7's poll cadence this slice's write rate
  must not outrun).
- **UI:** none (agent-health cards / drift / dead-agent flags are Phase-3 surfaces — ISSUE-067/073/078).
- **Connectors:** none.

## 6. Context manifest (the EXACT files to open — nothing more)
- `spec/01-requirements/component-08-agent-design.md` — Area HLTH: FR-8.HLTH.001–004 (the FR text +
  ACs, incl. the AC-8.HLTH.004.2 producer-heartbeat criterion) and OD-078 as recorded in the header.
- `spec/05-non-functional/observability.md` — NFR-OBS.005 (metric-producer liveness, stale-never-green)
  and NFR-OBS.015 (drift / dead-agent flag-never-auto-correct), with AC-NFR-OBS.005.1 / .015.1 and the
  AF-118/124 launch-gate + fast-follow notes.
- `spec/04-data-model/schema.md` §9 Agent Design — the `agent_health_metrics` table (and `agents`,
  read-only, for the drift comparison).
- `spec/00-foundations/open-decisions.md` §OD-078 — the flag-only posture, quality-signal definition,
  and threshold defaults this slice enforces.
- `spec/00-foundations/feasibility-register.md` §Block R — AF-118, and the C8 block — AF-123 / AF-124
  (the verification methods + launch-gate status).

## 7. Dependencies
- **Blocked-by:** ISSUE-061 (orchestrator + agents registry + 7-step routing — supplies the outcome
  tracking, ORC.007, that HLTH.001 aggregates, and the `agents` rows whose scope drift is measured
  against), ISSUE-011 (observability skeleton — the append-only `event_log` these producers read
  outcomes from and emit their liveness heartbeat onto). *(Neither is an OD-157 launch spike.)*
- **Blocks:** ISSUE-067 (agent builder surface — renders C8 REG/SPC/PLAN/HLTH; needs this slice's
  metric contract + stale-never-green signal to draw the agent-health cards).

## 8. Build order within the slice
1. **Schema is present (from ISSUE-061 / Migration 0001):** confirm `agent_health_metrics` exists with
   `producer_heartbeat` and the flag/score columns (`schema.md` §9). If missing it is an upstream gap,
   not a re-create here.
2. **Health aggregation (FR-8.HLTH.001):** the periodic/continuous job that reads task outcomes from
   `event_log` (produced by ORC.007) and upserts per-agent `success_rate` / `failure_rate` /
   `last_run` into `agent_health_metrics`, stamping `producer_heartbeat` on each run. A high failure
   rate is written as a value only — never a corrective action (AC-8.HLTH.001.2).
3. **Drift detection (FR-8.HLTH.002):** the slow-loop check comparing each agent's recent behaviour
   against its intended `agents.memory_scope`/role; write `drift_score`; when it crosses
   `CFG-drift_threshold`, raise a flag for human review and change nothing (AC-8.HLTH.002.1). If the
   drift check itself fails to run, its absence is surfaced, not silently green (AC-8.HLTH.002.2 —
   the same producer-heartbeat mechanism as step 5).
4. **Dead-agent detection (FR-8.HLTH.003):** compute the consistent-failure / low-quality signal from
   task success/failure + answer-mode-pill distribution + approval/rejection outcomes (OD-078); above
   `CFG-dead_agent_threshold` set `dead_agent_flag`. The flagged agent **stays enabled** — no
   auto-disable (AC-8.HLTH.003.2).
5. **Producer heartbeat + stale-never-green (FR-8.HLTH.004 / NFR-OBS.005):** each producer (health
   aggregator, dead-agent detector, and the LRN.002 routing-mismatch detector it shares the store
   with) stamps `producer_heartbeat`; a reader/evaluator marks the metric **stale/unknown** when the
   heartbeat is overdue, never carrying forward a last-known-good green (AC-8.HLTH.004.2,
   AC-NFR-OBS.005.1 — mirrors the C5 AC-5.JOB.006.2 heartbeat pattern). Assert C8 takes no autonomous
   action on any metric (AC-8.HLTH.004.1 / NFR-OBS.015).
6. **Tests** to every AC in Definition of done (see Verification).

## 9. Verification (how DoD is proven)
- **Aggregation tier** (`spec/05-non-functional/test-strategy.md`): seed outcome events → the
  aggregator produces correct `success_rate`/`failure_rate`/`last_run` available to C7, and a high
  failure rate is surfaced only, never auto-acted (AC-8.HLTH.001.1/.2).
- **Drift — EVAL (AF-123):** feed on-scope vs off-scope behaviour → the drift score separates them and
  the flag fires above threshold with nothing auto-changed (AC-8.HLTH.002.1); build-time test that a
  failed drift check surfaces its own absence (AC-8.HLTH.002.2).
- **Dead-agent — EVAL (AF-124):** drive an agent to consistent failure/low-quality → `dead_agent_flag`
  set above threshold and the agent remains enabled until a human decides (AC-8.HLTH.003.1/.2).
- **Producer heartbeat — SPIKE (AF-118):** stall a producer (health aggregator / dead-agent detector /
  routing-mismatch detector) → its metric reads stale/unknown, never a carried-forward green
  (AC-8.HLTH.004.2, AC-NFR-OBS.005.1).
- **Flag-never-auto-correct invariant:** assert no code path in this slice disables or auto-corrects an
  agent on a health/drift/dead-agent signal (AC-8.HLTH.004.1, AC-NFR-OBS.015.1 — OD-078).
- **AF gate:** AF-118 is a blocking (RP-1) build-time SPIKE; AF-123 / AF-124 are EVAL fast-follows
  (the flag-only posture de-risks them) — their status in `feasibility-register.md` governs when each
  detection claim is trusted at launch (`observability.md` launch-gate rule).

---
## §10 Evidence — built + closed (session 77, 2026-07-08)
- **Built** via the Stage-5 offline-batch fan-out (`app/agent-health/`): 20/20 offline AC tests green + typecheck clean + `check` non-drift guard.
- **Adversarially verified** (independent zero-context agent); findings fixed **regression-test-first, fail-safe** (see [[OD-198]] for the batch-close forks; all fail-safe-shipped).
- **R10 live-adapter smoke GREEN** against the real silo — `app/agent-health/results/live-smoke.sql` (rolled back). Proves the adapter's real SQL/casts/constraints vs the 0001+delta DDL (the fake-passes-offline / live-diverges class).
- **status: ready → done.** GitHub closed. Full narrative + evidence: `spec/SESSION-LOG.md` (Session 77).
