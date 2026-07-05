---
id: ISSUE-011
title: Observability skeleton — event_log + silent-failure detector + alert-engine watchdog
epic: A — foundations
status: ready
github: "#11"
---

# ISSUE-011 — Observability skeleton — event_log + silent-failure detector + alert-engine watchdog

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR/NFR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Stand up the observability backbone — the append-only `event_log`, the silent-failure detector (a
terminal task with no terminal event is a detectable gap), and the alert-engine watchdog ("the
watcher is watched") — so that from this point on nothing the system does can fail silently.

## 2. Scope — in / out
**In:**
- The **`event_log` as the unified append-only system timeline** (FR-7.LOG.001): the table, its
  15-value `event_type` enum, plain-English `summary` (FR-7.LOG.002), the append-only enforcement
  (no in-place UPDATE/DELETE outside retention pruning), and the DB-level immutability trigger
  (`schema.md` §Global rules — `enforce_audit_append_only()` on `event_log`).
- The **silent-failure detector** (FR-7.LOG.003 / NFR-OBS.001): exactly one terminal event per
  `task_id`; a terminal `task_queue` status with **no** terminal `event_log` row is flagged as a
  detectable gap — the load-bearing #3 mechanism. Plus the **out-of-band log-write-failure path**
  (AC-7.LOG.003.2 / NFR-OBS.002 — local stderr/file + `log-write-failing` health bit) and the
  **cross-sink reconciliation** (AC-7.LOG.003.3 / NFR-OBS.003 — `event_log` ⋈ `guardrail_log`).
- **Per-event duration + cost capture** (FR-7.LOG.004): `duration_ms`, `cost_tokens`, and the
  `cost_unknown` sentinel distinct from a genuine `0` (NFR-OBS.013).
- **Tokens/secrets never in the log** (FR-7.LOG.005 — the `payload`/`summary` redaction invariant).
- **`event_log` retention + compliance redaction-tombstone** (FR-7.LOG.006 / NFR-OBS.010): the
  configurable retention window with a floor, never-prune-a-referenced-row, pruning-is-logged, and
  the PII redaction-tombstone (scrub `summary`/`entity_ids` in place, retain row + audit metadata).
- The **alert-engine watchdog** (FR-7.ALR.008 / NFR-OBS.004): the alert-evaluation engine emits a
  heartbeat; an **independent** watchdog raises a critical alert if it stalls (and the mgmt-plane
  push carries the stalled condition). This is the skeleton hook every later alert rule plugs into.
- The **`notifications` store shell** (`schema.md` §8) — created here so the watchdog's critical
  alert has somewhere to land (append-only-first row with `escalation_state`/`escalated_at`/
  `actioned_at`); the full notification-centre lifecycle is not built here (see Out).

**Out:**
- **The seven alert rules, routing-by-type, escalation-window→secondary, delivery durability,
  unroutable-fails-loud, and the notification-centre lifecycle** (FR-7.ALR.001–007, ALR.009) —
  owned by **ISSUE-075** (this issue only lands the watchdog ALR.008 and the bare `notifications`
  table shell it writes into). *Escalate-don't-abandon as a full alerting behaviour is ISSUE-075;*
  the watchdog here reuses that pattern only for its own stall alert.
- **The real-time / polling contract** (FR-7.RTP.001–004: Realtime-vs-polling, per-surface cadences,
  per-silo connection budget, subscription lifecycle / NFR-OBS.011/014) — owned by **ISSUE-076**.
- **Cost meter, per-task aggregation, and the cost ladder** (FR-7.COST.001–004) — owned by
  **ISSUE-074** (this issue only records the raw per-event `cost_tokens`/`cost_unknown` in LOG.004).
- **The `guardrail_log` view/retention/tamper-evidence/export** (FR-7.LOG.007) and the
  **`config_audit_log` governance** (FR-7.LOG.008) — LOG.008 is owned by **ISSUE-010** (config
  store); LOG.007's C7-side view/export rides with alerting/ops surfaces (**ISSUE-077**). This issue
  creates the shared `enforce_audit_append_only()` trigger that binds all four sinks, but the
  guardrail/config sinks' *governance* is not claimed here.
- **The management-plane health-reporter push, staleness detector, and health grid** (FR-7.MGM.*) —
  owned by **ISSUE-012**; this issue only sets the `log-write-failing` health bit that MGM carries.
- **All dashboard rendering** (the failure-health view, event-log view) — Phase-3 surfaces
  (**ISSUE-078**); C7 owns the data contract + signals, not the screens.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-7.LOG.001, FR-7.LOG.002, FR-7.LOG.003, FR-7.LOG.004, FR-7.LOG.005, FR-7.LOG.006,
  FR-7.ALR.008 (all Component 7 — Observability).
- **NFRs:** NFR-OBS.001 (silent-failure detector), NFR-OBS.002 (out-of-band write-failure path),
  NFR-OBS.003 (cross-sink reconciliation), NFR-OBS.004 (alert-engine watchdog), NFR-OBS.010
  (append-only plain-English timeline), NFR-OBS.013 (`cost_unknown` ≠ $0).
- **Rests on:** ADR-001 (Silo isolation — `client_slug` dropped intra-silo, OD-067; the mgmt-plane
  push carries the `log-write-failing` bit), ADR-003 (estimate-grade cost — feeds LOG.004),
  OD-074 (compliance erasure → redaction-tombstone), OD-072 (three-sink retention floors),
  OD-065 (three distinct append-only sinks), AF-118 / AF-119 / AF-120 (the build-time proofs of
  the #3 mechanisms — see Definition of done).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-7.LOG.001.1, AC-7.LOG.001.2, AC-7.LOG.001.3
- AC-7.LOG.002.1, AC-7.LOG.002.2
- AC-7.LOG.003.1, AC-7.LOG.003.2, AC-7.LOG.003.3
- AC-7.LOG.004.1, AC-7.LOG.004.2
- AC-7.LOG.005.1
- AC-7.LOG.006.1, AC-7.LOG.006.2, AC-7.LOG.006.3
- AC-7.ALR.008.1, AC-7.ALR.008.2
- AC-NFR-OBS.001.1, AC-NFR-OBS.001.2 · AC-NFR-OBS.002.1, AC-NFR-OBS.002.2 · AC-NFR-OBS.003.1 ·
  AC-NFR-OBS.004.1, AC-NFR-OBS.004.2 · AC-NFR-OBS.010.1, AC-NFR-OBS.010.2 · AC-NFR-OBS.013.1
- **Gating spikes (if any):** these are **build-time SPIKEs** in `feasibility-register.md` (Block R),
  each proving a #3 mechanism this issue ships and each **blocking (RP-1)** per `observability.md`:
  - **AF-118** — absence-of-signal detection is only as live as its evaluator; gates the silent-
    failure detector (NFR-OBS.001) + the alert-engine watchdog (AC-7.ALR.008.2 / NFR-OBS.004).
  - **AF-119** — last-resort out-of-band log-failure surface durability; gates AC-7.LOG.003.2 /
    NFR-OBS.002 (the degraded stderr/file + `log-write-failing` health-bit path).
  - **AF-120** — cross-deployment clock-sync for window math; gates the server-authoritative-time
    posture the watchdog + retention math rely on. *(None of these is an OD-157 launch-spike ISSUE
    001–006; they are attached here as DoD notes per the coverage ledger's NFR-TEST line.)*

## 5. Touches (complete blast radius, by ID)
- **DATA:** `DATA-event_log` (+ fields `event_type`, `entity_ids`, `summary`, `payload`,
  `duration_ms`, `cost_tokens`, `cost_unknown`, `answer_mode`, `created_at`, `redacted_at`);
  `DATA-notifications` (shell only — `escalation_state`/`escalated_at`/`actioned_at`); reads
  `DATA-task_queue` (terminal-status join for the silent-failure detector); reconciles against
  `DATA-guardrail_log` (cross-sink check, read-only here). Enum types `event_type`, `alert_type`,
  `notification_read`, `answer_mode` (schema.md §Types).
- **PERM:** none defined or gated by this slice (infrastructure backbone; alert-routing PERM nodes
  are ISSUE-075's).
- **CFG:** `CFG-event_log_retention_window` (default 365d); the `log-write-failing` health bit is a
  push field, not a config key. *(Staleness/escalation windows are ISSUE-012/075 config.)*
- **UI:** none (failure-health / event-log views are Phase-3 surfaces, ISSUE-078).
- **Connectors:** none.

## 6. Context manifest (the EXACT files to open — nothing more)
- `spec/01-requirements/component-07-observability.md` — the FR text + ACs for LOG.001–006 and
  ALR.008 (the LOG area and the ALR.008 watchdog FR), plus the reconciliations (#1 `client_slug`
  drop, #4 three-sink) and OD-067/072/074 resolutions.
- `spec/05-non-functional/observability.md` — NFR-OBS.001/002/003/004/010/013 (the #3-mechanism
  postures + AC-NFR-OBS.* and the AF-118/119/120 launch-gate rule).
- `spec/04-data-model/schema.md` §Types (the `event_type`/`alert_type`/`notification_read`/
  `answer_mode` enums), §Global rules → "Immutability enforcement" (`enforce_audit_append_only()`
  trigger + the `redacted_at` column note), and §8 Observability (`event_log`, `notifications`).
- `spec/04-data-model/migrations.md` — Migration 0001 §"Migration 0001" (where `event_log` /
  `notifications` are created, dependency order after `guardrail_log`).
- `spec/00-foundations/adr/ADR-001-*.md` (Silo isolation + §7 management-plane push — the
  `log-write-failing` bit's channel; `client_slug` dropped intra-silo) and
  `spec/00-foundations/adr/ADR-003-*.md` (estimate-grade cost — LOG.004's method).

## 7. Dependencies
- **Blocked-by:** ISSUE-008 (migration harness + 0001 baseline — the `event_log`/`notifications`
  tables, the enums, and the `enforce_audit_append_only()` trigger are created by 0001, so the
  schema must exist before this slice's logic + tests can run).
- **Blocks:** ISSUE-012, ISSUE-047, ISSUE-048, ISSUE-055, ISSUE-057, ISSUE-059, ISSUE-060,
  ISSUE-065, ISSUE-074, ISSUE-075, ISSUE-076, ISSUE-077 (every component that must emit `event_log`
  events, plug into the watchdog/alerting skeleton, or build on the observability backbone).

## 8. Build order within the slice
1. **Schema is present (from ISSUE-008):** confirm 0001 created `event_log`, `notifications`, the
   `event_type`/`alert_type`/`notification_read`/`answer_mode` enums, the `redacted_at` column on
   `event_log`, and the `t_append_only` trigger bound to `event_log` (`schema.md` §Global rules).
   If any is missing it is an ISSUE-008 gap, not a re-create here.
2. **Append-only enforcement (FR-7.LOG.001):** verify the DB trigger rejects in-place UPDATE/DELETE
   on `event_log` outside the whitelisted redaction-tombstone + the retention job; reject an
   out-of-enum `event_type`; assert no `client_slug` column intra-silo (AC-7.LOG.001.3, OD-067).
3. **Event-write API + intent semantics (FR-7.LOG.002, LOG.004, LOG.005):** the write path that
   populates `summary` (plain-English what+why, never empty), `payload` (structured, redacted — no
   token/secret ever, LOG.005), `duration_ms`, and `cost_tokens` with the `cost_unknown` sentinel
   distinct from `0` (LOG.004 / NFR-OBS.013, estimate-grade per ADR-003).
4. **Silent-failure detector (FR-7.LOG.003 / NFR-OBS.001):** the join of terminal `task_queue`
   status ⋈ terminal `event_log` event; a terminal status with no terminal event is flagged as a
   detectable gap (the Failure-Health finding — the data signal only; the view is Phase 3).
5. **Out-of-band write-failure path (AC-7.LOG.003.2 / NFR-OBS.002):** a failed `event_log` write
   records to a local stderr/file degraded sink **and** sets a `log-write-failing` health bit that
   the mgmt-plane push (ISSUE-012's reporter) carries — visible even when the silo DB is down (AF-119).
6. **Cross-sink reconciliation (AC-7.LOG.003.3 / NFR-OBS.003):** the periodic job that flags any
   `guardrail_log` row without its `event_log` `guardrail_hit` counterpart (and vice-versa).
7. **Retention + redaction-tombstone (FR-7.LOG.006 / NFR-OBS.010):** the pruning job honouring
   `CFG-event_log_retention_window` with the floor, skipping rows still referenced by an open item,
   logging every run; and the compliance-erasure path that scrubs `summary`/`entity_ids` in place
   via `redacted_at` while retaining the row + audit metadata (OD-074; the whitelisted trigger path).
8. **Alert-engine watchdog (FR-7.ALR.008 / NFR-OBS.004):** the alert-evaluation engine emits a
   periodic heartbeat; an **independent** watchdog process (not the engine itself) detects a missed
   heartbeat and raises a critical alert into `notifications`, with the stalled condition carried on
   the mgmt-plane push (AF-118). This is the extension point ISSUE-075 wires the seven rules onto.
9. **Tests** to every AC in Definition of done (see Verification).

## 9. Verification (how DoD is proven)
- **Data-layer / invariant tier** (`spec/05-non-functional/test-strategy.md`): the append-only
  trigger refuses UPDATE/DELETE and out-of-enum writes (AC-7.LOG.001.1/.2); redaction-tombstone
  scrubs PII yet retains row + metadata and is itself allowed by the trigger (AC-7.LOG.006.3);
  retention prune skips referenced rows + logs itself (AC-7.LOG.006.1/.2, AC-NFR-OBS.010.2).
- **Silent-failure detector — SPIKE (AF-118):** drive tasks to abrupt termination and confirm the
  missing-terminal-event gap is detected + surfaced (AC-7.LOG.003.1, AC-NFR-OBS.001.1/.2); + the
  build-time terminal-event invariant test.
- **Out-of-band path — SPIKE (AF-119):** induce an `event_log` write failure (DB unreachable) and
  confirm the stderr/file record + the `log-write-failing` push bit both surface (AC-7.LOG.003.2,
  AC-NFR-OBS.002.1/.2).
- **Cross-sink reconciliation:** inject a one-sided `guardrail_log`/`event_log` row → reconciliation
  flags it (AC-7.LOG.003.3, AC-NFR-OBS.003.1).
- **Watchdog — SPIKE (AF-118, shared):** stall the alert engine → the independent watchdog fires a
  critical alert and the mgmt-plane push carries the stalled condition (AC-7.ALR.008.1/.2,
  AC-NFR-OBS.004.1/.2).
- **Cost honesty:** force an un-computable cost → `cost_unknown=true` recorded, never a silent `0`
  (AC-7.LOG.004.1, AC-NFR-OBS.013.1); `duration_ms` captured for every measurable span (AC-7.LOG.004.2).
- **Token-no-leak:** a sample audit of `event_log` finds no credential material (AC-7.LOG.005.1).
- **AF gate:** AF-118 / AF-119 / AF-120 are blocking (RP-1) build-time SPIKEs — each must be GREEN in
  `feasibility-register.md` before the #3 mechanism it proves is trusted at launch (`observability.md`
  launch-gate rule).
