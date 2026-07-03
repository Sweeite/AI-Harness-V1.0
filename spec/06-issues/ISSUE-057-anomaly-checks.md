---
id: ISSUE-057
title: Five pre-step anomaly checks (signal-not-gate, baseline learning)
epic: G — guardrails
status: blocked
github: "#57"
---

# ISSUE-057 — Five pre-step anomaly checks (signal-not-gate, baseline learning)

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Build the pre-step anomaly detection pipeline — five checks that run at the step boundary, treat every hit as a *signal* (pause + flag for soft review by default), with per-deployment configurable thresholds and history-derived baselines that never silently alter a gate.

## 2. Scope — in / out
**In:** The C6 ANM area end-to-end: the harness-invoked pre-step check (fires before any side-effecting action of a step), the five detectors (confidence, volume, contradiction, scope, sentiment), the detection-as-signal disposition (default = pause + `guardrail_log` type `anomaly` + flag for review; per-anomaly per-deployment severity can escalate a specific check to the hard-approval path), per-deployment threshold config (no code change to retune), and baseline learning from history (proposes tighten/loosen; any *gate-altering* change requires admin confirmation). Emits `anomaly`-type rows into the existing `guardrail_log` sink built by ISSUE-011.

**Out:** The *invocation point itself* — the per-step execution order that calls this check — is C5 FR-5.ASM.007, owned by **ISSUE-053** (this slice provides the callable check; ISSUE-053 wires it into the run pipeline). The hard-approval gate an escalated anomaly enters (FR-6.APR.002 path) is owned by **ISSUE-056**. The `guardrail_log` schema/append-only sink, the no-silent-failure invariant, and the *reusable* baseline-learning mechanism (FR-6.OPT.002) are owned by **ISSUE-060** — this slice consumes them, it does not build the log table or the generic learning framework. The C2 memory-conflict queue (stored-vs-stored) is C2/ISSUE-028; the contradiction check here is the distinct live-vs-stored signal only.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-6.ANM.001, FR-6.ANM.002, FR-6.ANM.003, FR-6.ANM.004, FR-6.ANM.005 (all component-06 Guardrails)
- **NFRs:** none (verification governed by AF-116 — see DoD)
- **Rests on:** ADR-007 (containment-first; detection-as-signal, part 3), OD-063 (anomaly → severity/approval-tier mapping), AF-116 (anomaly-detection accuracy — EVAL gate)

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-6.ANM.001.1
- AC-6.ANM.002.1
- AC-6.ANM.002.2
- AC-6.ANM.003.1
- AC-6.ANM.003.2
- AC-6.ANM.004.1
- AC-6.ANM.005.1
- **Gating spikes (if any):** none launch-gating. Build-time EVAL gate **AF-116** (per-anomaly precision/recall on a labelled set — volume/scope/sentiment carry no DOCS-provable threshold) must be run and its result recorded before this slice is trusted in production; AF-116 is not a blocking spike (not ISSUE-001..006) but is a DoD note per `feasibility-register.md` Block Q.

## 5. Touches (complete blast radius, by ID)
- **DATA:** `guardrail_log` (write rows with `guardrail_type = 'anomaly'`; consumes `status`, `escalated_at`; append-only sink built by ISSUE-011 — this slice writes, does not create)
- **PERM:** none new (admin-confirmation of a baseline change reuses the C1 RBAC admin gate; no ANM-specific node)
- **CFG:** `anomaly_thresholds` (structured object in `config_values`, per schema §Config cluster — holds every per-anomaly threshold + per-anomaly severity level soft-vs-hard-approval); anomaly baseline-learning enable/disable knob
- **UI:** none owned here (baseline-candidate surfacing is rendered under ISSUE-060/observability views; escalated anomalies appear in the approval queue owned by ISSUE-056)
- **Connectors:** none

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-06-guardrails.md — §ANM (FR-6.ANM.001–005 + their ACs); the C6 Context manifest header for the ADR-007 / OD-063 framing
- spec/04-data-model/schema.md §7 Guardrails — `guardrail_log` table (the `anomaly` type + `status`/`escalated_at` columns) and the `guardrail_type` enum in §Types
- spec/04-data-model/schema.md §12 Config cluster — the `anomaly_thresholds` structured config object
- spec/00-foundations/adr/ADR-007-*.md — containment-first / detection-as-signal posture (part 3)
- spec/00-foundations/feasibility-register.md — Block Q, AF-116 (EVAL method + what it de-risks)

## 7. Dependencies
- **Blocked-by:** ISSUE-011 (observability skeleton — `guardrail_log` append-only sink + silent-failure detector must exist to write `anomaly` rows into)
- **Blocks:** ISSUE-053 (run pipeline — invokes this check at the per-step gate sequence, C5 FR-5.ASM.007)

## 8. Build order within the slice
1. Config first: register the `anomaly_thresholds` structured object (schema §12) with the five per-anomaly thresholds + per-anomaly severity level (soft vs hard-approval), plus the baseline-learning enable/disable knob; ship starting-point values (FR-6.ANM.004).
2. The five detectors (FR-6.ANM.002): confidence, volume, contradiction (live-tool-vs-stored — keep distinct from the C2 stored-vs-stored conflict queue), scope, sentiment — each reads its threshold from config and produces a flag; guard the three judgment-based ones (volume/scope/sentiment) behind the AF-116 EVAL result.
3. The pre-step check entry point (FR-6.ANM.001): a single callable that runs all *configured* checks and resolves them *before* any side-effecting action; expose it for the harness step boundary (ISSUE-053 wires it) — this slice does not call itself into the pipeline.
4. Disposition / signal handling (FR-6.ANM.003): default path = pause + write `guardrail_log` type `anomaly` + flag for review (never silent-drop, never autonomous-continue); if a deployment raised that anomaly's severity to hard-approval, route into the FR-6.APR.002 hard-approval path (owned by ISSUE-056) instead.
5. Baseline learning (FR-6.ANM.005): compute baselines from history, propose tighten/loosen; where the change would alter a *gate* outcome (not just a signal), require admin confirmation — never silent auto-apply. Consume the reusable learning mechanism from ISSUE-060 (FR-6.OPT.002) rather than re-implementing it.
6. Tests to each AC in §4; run AF-116 EVAL (per-anomaly precision/recall) and record the result.

**Integration note (spans the bundled FRs):** ANM.001 (when) + ANM.002 (what) + ANM.003 (disposition) form one path — a check *fires* (002) only at the step boundary (001) and its *only* authorised outcomes are the signal dispositions in 003 (soft-flag by default, hard-approval if the deployment escalated that check). There is no autonomous block-and-act and no autonomous discard: that is ADR-007 detection-as-signal / OD-063. ANM.004 (thresholds are config) and ANM.005 (baselines learned from history) tune *when* 002 fires without touching that disposition contract — and 005's guardrail is that a learned change which would flip a *gate* (not merely a signal) is admin-confirmed, never silent.

## 9. Verification (how DoD is proven)
- Unit/integration tests per `spec/05-non-functional/test-strategy.md`: each of the five detectors fires on its condition and produces a flag (AC-6.ANM.002.1); the contradiction check is asserted distinct from the C2 conflict queue (AC-6.ANM.002.2); a default-severity anomaly pauses the step, writes a `guardrail_log` `anomaly` row, and flags — never silent-drop, never auto-continue (AC-6.ANM.003.1); a severity-raised anomaly enters the hard-approval path (AC-6.ANM.003.2); a threshold edit takes effect with no code change (AC-6.ANM.004.1); a baseline proposal that would alter a gate requires admin confirmation (AC-6.ANM.005.1); the pre-step check resolves before any side-effecting action (AC-6.ANM.001.1 — verified against the ISSUE-053 harness harness-invocation stub).
- **AF-116 (EVAL, build-time):** measure per-anomaly precision/recall against a labelled set on a runnable deployment; the volume/scope/sentiment detectors are trusted in production only once false-positive (alert-fatigue → #3) and false-negative (missed runaway → #2) rates are within the register's accepted bounds. Record the EVAL outcome in `feasibility-register.md` Block Q before the slice ships.
