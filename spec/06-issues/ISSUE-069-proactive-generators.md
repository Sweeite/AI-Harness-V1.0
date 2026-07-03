---
id: ISSUE-069
title: Seven proactive generators (each enable/disable + thresholded)
epic: I — proactive
status: blocked
github: "#69"
---

# ISSUE-069 — Seven proactive generators (each enable/disable + thresholded)

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Build the seven independent proactive scanners (relationship, meeting-prep, document-prep, derisking, opportunity, daily-briefing, pattern-recognition) that each emit a `proactive_suggestions` item — each scanner separately enable/disable-able and threshold-configurable, all on by default.

## 2. Scope — in / out
**In:** The seven PRO generators as content producers. Each scanner: reads memory (C2) + live connector data (C3) within Insight/Client-agent scope, detects its signal against configurable thresholds, and *writes a `proactive_suggestions` row* (setting `reasoning`, `answer_mode`, `risk_type`, and — for derisking floor items — `is_floor`). Per-scanner `CFG-scanner_*_enabled` (default `true`) + threshold keys wired into the Phase-2 config registry; a disabled scanner produces no items but its underlying C6/C7 safety-alert path is untouched. The derisking scanner's producer-liveness/scan-execution heartbeat (PRO.004.3) so a live-but-unproductive scan is caught. The `is_floor` flag write on escalating-risk derisking items (PRO.004.4) — the *data* that lets the downstream floor hold.
**Out:** Mode assignment (Suggest/Prepare/Act stamping) → ISSUE-068 (C9 MODE). Suggestion *lifecycle* — persistence-state machine, ranking, reasoning+pill rendering contract, delivery routing, dismissal-learning + the floor's *enforcement* — → ISSUE-070 (C9 SUG); this slice only *populates* rows and sets `is_floor`. Cold-start suppression that gates whether a scanner fires at all → ISSUE-071 (C9 CST). The slow loop / scheduled briefing trigger (*when* scanners run) → C5 (ISSUE-051). Insight Agent definition + read-all-no-write scope → C8 (ISSUE-062). Coverage/Maturity/`[Building]` computation → C2. Notification delivery of surfaced items → C7. All rendering (cards, briefing panel) → Phase 3.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-9.PRO.001, FR-9.PRO.002, FR-9.PRO.003, FR-9.PRO.004, FR-9.PRO.005, FR-9.PRO.006, FR-9.PRO.007 (all C9 — component-09-proactive)
- **NFRs:** none
- **Rests on:** AF-127 (signal-detection accuracy — PRO.001/004/005/007), AF-128 (dismissal-learning never suppresses a true escalating risk — PRO.004), AF-129 (ranking/briefing surface genuinely important items — PRO.002/003/006), OD-084 (derisking dismissal-learning floor), ADR-002 (Maturity/phase, consumed for `[Building]` pill on thin coverage), ADR-007 (injection posture — proactive items built from memory + live tool data)

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-9.PRO.001.1, AC-9.PRO.001.2
- AC-9.PRO.002.1, AC-9.PRO.002.2
- AC-9.PRO.003.1, AC-9.PRO.003.2
- AC-9.PRO.004.1, AC-9.PRO.004.2, AC-9.PRO.004.3, AC-9.PRO.004.4
- AC-9.PRO.005.1
- AC-9.PRO.006.1, AC-9.PRO.006.2, AC-9.PRO.006.3
- AC-9.PRO.007.1
- **Gating spikes (if any):** none. AF-127 / AF-128 / AF-129 are build-time EVALs (block T), not OD-157 launch spikes; they must be GREEN before this issue ships per the AF de-risking schedule (`test-strategy.md`), and each is verified against the DoD ACs above (see Verification).

## 5. Touches (complete blast radius, by ID)
- **DATA:** `proactive_suggestions` (write — `reasoning`, `answer_mode`, `risk_type`, `is_floor`; other lifecycle columns owned by ISSUE-070). Reads: memory tables (C2), connector data (C3) — no writes to either.
- **PERM:** none new (reads governed by C1 clearance + C8 per-agent scope, enforced by their owning issues)
- **CFG:** `CFG-scanner_relationship_enabled`, `CFG-not_contacted_window`, `CFG-renewal_lookahead_days`, `CFG-scanner_meeting_prep_enabled`, `CFG-meeting_prep_lead_time`, `CFG-scanner_document_prep_enabled`, `CFG-scanner_derisking_enabled`, `CFG-risk_thresholds`, `CFG-scanner_opportunity_enabled`, `CFG-opportunity_thresholds`, `CFG-scanner_briefing_enabled`, `CFG-briefing_schedule`, `CFG-scanner_pattern_enabled` (all `_enabled` default `true`)
- **UI:** none (content contract only; suggestion cards / relationship-health panel / briefing panel / insight cards render in Phase 3)
- **Connectors:** Google (Calendar read — PRO.002), plus generic read-only connector pulls for relationship/derisking live signals; no writes

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-09-proactive.md — the PRO FR text + ACs (and the "Scanner configuration" preamble governing PRO.001–007)
- spec/04-data-model/schema.md §10. Proactive (C9) — the `proactive_suggestions` table
- spec/00-foundations/adr/ADR-002-*.md — Maturity/coverage phase (consumed for the `[Building]` pill)
- spec/00-foundations/adr/ADR-007-*.md — injection posture (containment-first) for items built from memory + live tool data
- spec/00-foundations/feasibility-register.md — AF-127 / AF-128 / AF-129 verification methods (block T)

## 7. Dependencies
- **Blocked-by:** ISSUE-051 (C5 three loops — the slow loop scanners run on), ISSUE-025 (C2 retrieval + clearance-before-ranking — the read path scanners pull memory through). Neither is a spike.
- **Blocks:** ISSUE-070 (C9 SUG lifecycle consumes the rows this slice writes), ISSUE-071 (C9 CST cold-start gates when these scanners fire)

## 8. Build order within the slice
1. Confirm the `proactive_suggestions` write surface exists (schema §10 landed via the Memory/C9 migration path); this slice only *inserts* rows and sets `reasoning`/`answer_mode`/`risk_type`/`is_floor`.
2. Register the fourteen `CFG-scanner_*` enable + threshold keys in the Phase-2 config registry (all `_enabled` default `true`); wire a single scanner-gate helper so each scanner reads its own enable flag and thresholds.
3. Build the shared scanner harness: invoked on the C5 slow loop (ISSUE-051) / briefing trigger, pulls memory (C2, ISSUE-025 retrieval) + connector reads (C3) within Insight/Client scope, emits a candidate item. Route all detection reads through the C2 retrieval path so clearance/scope already applies.
4. Implement the seven detectors on the harness — PRO.001 relationship, PRO.002 meeting-prep (Google Calendar trigger), PRO.003 document-prep, PRO.004 derisking, PRO.005 opportunity, PRO.006 daily-briefing (assembles due-today/at-risk/needs-attention/overnight from C5 task_queue + C7 event_log, degraded-section-flagged never dropped, per-recipient clearance filter), PRO.007 pattern. Each detector honours its enable flag + thresholds and carries the `[Building]` pill when subject-entity coverage is thin (ADR-002 / CST.004 signal).
5. Derisking specifics (PRO.004): set `is_floor=true` on escalating-risk items (metric past threshold); add the scan-execution producer-liveness heartbeat (mirrors C8 AC-8.HLTH.004.2 / C5 AC-5.JOB.006.2) so a live-but-unproductive scan raises a heartbeat-absence flag; log a scanner-disable as a deliberate operator action, never a silent gap.
6. Integration note (spans ISSUE-070/071): PRO.004.4's floor is *enforced* downstream — dismissal-learning (SUG.005, ISSUE-070), cold-start suppression (CST.002, ISSUE-071), and TTL-exempt-while-active (SUG.002.3, ISSUE-070). This slice's contribution is only the `is_floor` flag + re-surface-on-escalation detection (PRO.004.2); the caps on all three suppression axes are asserted by the DoD test here against the downstream enforcers.
7. Tests to the ACs above (see Verification).

## 9. Verification (how DoD is proven)
- Per spec/05-non-functional/test-strategy.md: integration tests for each scanner (seeded memory + connector fixtures → assert a `proactive_suggestions` row with correct `reasoning`/`answer_mode`/`risk_type`); config tests that a disabled scanner emits nothing while the C6/C7 safety path is unaffected; a liveness test for the derisking scan-execution heartbeat (PRO.004.3); a cross-issue floor test (PRO.004.4) asserting an escalating derisking item is delivered despite prior dismissal, cold-start suppression, and scanner-disable.
- AF gate: AF-127 / AF-128 / AF-129 (EVAL, block T) must reach GREEN before ship; the EVAL corpora are the `Verified` path for PRO.001/004/005/007 (127), PRO.004 floor (128), and PRO.002/003/006 relevance (129).
