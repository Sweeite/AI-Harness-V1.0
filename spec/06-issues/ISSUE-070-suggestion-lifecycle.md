---
id: ISSUE-070
title: Suggestion lifecycle — persist, rank, explain, deliver, dismissal-learn
epic: I — proactive
status: blocked
github: "#70"
---

# ISSUE-070 — Suggestion lifecycle — persist, rank, explain, deliver, dismissal-learn

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Persist every generated proactive item through its explicit lifecycle, rank it by urgency×relevance under a volume cap, attach reasoning + answer-mode pill, route it to the right owner for C7 delivery, and learn from dismissals — all bounded by a never-silence derisking safety floor.

## 2. Scope — in / out
**In:** The C9 **SUG** slice — the state machine and store behind every proactive item (ISSUE-069's seven generators feed this). Specifically: (1) the `proactive_suggestions` lifecycle (`generated → surfaced → acted / dismissed / expired / superseded`), never-silently-dropped, with a linked C5 `task_queue` task for Prepare-mode items and delivery-failure keeping the item `generated`; (2) urgency×relevance ranking with a configurable volume cap and floor-item expiry exemption; (3) the reasoning + answer-mode pill (Cited/Inferred/Unknown/Building) on every item; (4) delivery **routing** by risk-type/ownership that hands the item to C7's notification centre (this issue determines recipient + records delivery state — it does NOT own the notification transport); (5) dismissal-learning into `signal_weights` with the OD-084 safety floor that never suppresses a derisking/hard-risk class and re-surfaces on metric escalation. Includes the stuck-`generated` escalate-don't-abandon path (AC-9.SUG.001.4).

**Out:** The seven generators that produce items and assign mode (ISSUE-069, C9 PRO/MODE). The notification-transport / delivery durability / retry mechanics (C7 ISSUE-075 ALR + ISSUE-076 RTP; this slice only *hands off* to them). Cold-start suppression of the whole engine (ISSUE-071, C9 CST). The answer-mode pill *definition* (C4) and the [Building] flag *computation* (C2 / ADR-002 — consumed here, not produced). Rendering of the suggestion feed / briefing panel / cards (ISSUE-073, surface-07/08). Any memory write (C2 sole-writer). C6 enforcement of an acted-on action (identical reactive pipeline).

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-9.SUG.001, FR-9.SUG.002, FR-9.SUG.003, FR-9.SUG.004, FR-9.SUG.005 (all component-09 Proactive).
- **NFRs:** NFR-OBS.007 (escalate-don't-abandon — names "a stuck suggestion" wait-point explicitly, covers AC-9.SUG.001.4).
- **Rests on:** ADR-002 (coverage metric — the Building pill this slice attaches); OD-082 (dedicated `proactive_suggestions` store + Prepare→linked task); OD-084 (dismissal-learning safety floor); AF-128 (learning never suppresses a true escalating signal); AF-129 (ranking surfaces the genuinely important items); AF-033 (answer-mode pill accuracy, carry-in).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-9.SUG.001.1, AC-9.SUG.001.2, AC-9.SUG.001.3, AC-9.SUG.001.4
- AC-9.SUG.002.1, AC-9.SUG.002.2, AC-9.SUG.002.3
- AC-9.SUG.003.1, AC-9.SUG.003.2
- AC-9.SUG.004.1, AC-9.SUG.004.2
- AC-9.SUG.005.1, AC-9.SUG.005.2, AC-9.SUG.005.3
- AC-NFR-OBS.007.1 (the stuck-suggestion wait-point escalates + persists; ties AC-9.SUG.001.4)
- **Gating spikes (if any):** none blocking this slice directly. Build-time EVALs must be run per the Verification field: **AF-128** (dismissal-learning floor holds — gates SUG.005), **AF-129** (ranking surfaces genuinely important items — gates SUG.002). Delivery hand-off inherits **AF-078** (webhook/notification delivery) from C7 ISSUE-075 — proven there, not re-proven here.

## 5. Touches (complete blast radius, by ID)
- **DATA:** `proactive_suggestions` (mode, state, reasoning, answer_mode, risk_type, recipient_id, delivery_state, rank, is_floor, linked_task_id, generated_at, surfaced_at) · `signal_weights` (signal_key, weight, floor, updated_at) · `task_queue` (write — linked Prepare-mode task, C5-owned) · reads `entities.maturity` for the Building pill (C2, via ADR-002).
- **PERM:** none new (the proactive engine writes; delivery recipient must hold C1 clearance for the item's content — enforced at C7 delivery, not here).
- **CFG:** CFG-suggestion_ttl_days · CFG-suggestion_volume_limit · CFG-dismissal_decay · CFG-risk_floor.
- **UI:** none in this slice (feed/pill rendering is surface-07/08 → ISSUE-073).
- **Connectors:** none directly (derisking/relationship live-data reads live in ISSUE-069's generators).

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-09-proactive.md §SUG (FR-9.SUG.001–005 + their ACs)
- spec/04-data-model/schema.md §10 Proactive (`proactive_suggestions`, `signal_weights`; and `task_queue` in §6 for the Prepare link)
- spec/05-non-functional/observability.md §NFR-OBS.007 (escalate-don't-abandon)
- spec/00-foundations/adr/ADR-002-coverage-metric.md (the Building pill semantics)

## 7. Dependencies
- **Blocked-by:** ISSUE-069 (seven generators produce the items + assign mode that this lifecycle persists), ISSUE-068 (proactivity modes / action-autonomy matrix — Prepare vs Suggest mode is stamped upstream, drives the linked-task branch). Neither is a spike.
- **Blocks:** ISSUE-073 (user + agency dashboards + notification centre render this slice's ranked, explained, delivered suggestions).

## 8. Build order within the slice
1. **Schema** — confirm `proactive_suggestions` + `signal_weights` from §10 are migrated (via the ISSUE-008 harness); no new columns expected — verify the enum/column set matches the FRs before proceeding.
2. **Lifecycle state machine (FR-9.SUG.001)** — implement `generated → surfaced → acted/dismissed/expired/superseded` with the single-terminal-state guarantee; wire the Prepare-mode branch to create a linked `task_queue` row (`linked_task_id`) and record its outcome; ensure a delivery failure leaves the row `generated` (never `surfaced` until delivery confirms).
3. **Ranking + volume cap (FR-9.SUG.002)** — score urgency×relevance (adjusted by the learned weight from step 6), apply CFG-suggestion_volume_limit, defer the rest; implement the floor-item TTL-exemption (AC-9.SUG.002.3: an `is_floor` item cannot go `expired` while its metric stays past the OD-084 threshold).
4. **Explanation (FR-9.SUG.003)** — attach `reasoning` + exactly one `answer_mode` pill; derive Building from `entities.maturity` (ADR-002); enforce "no verified provenance ⇒ never Cited".
5. **Delivery routing (FR-9.SUG.004)** — resolve recipient(s) by risk_type/ownership, hand to C7 notification centre, record `delivery_state`; no-eligible-recipient ⇒ escalate to default owner (never drop).
6. **Dismissal-learning (FR-9.SUG.005)** — on terminal act/dismiss, update `signal_weights` for the signal_key/context; enforce the `floor` **before** committing the weight update (AC-9.SUG.005.3); re-surface on metric escalation past threshold regardless of prior dismissal.
7. **Escalate-don't-abandon hook (AC-9.SUG.001.4 / NFR-OBS.007)** — a row stuck in `generated` past the delivery-escalation timeout escalates to default owner / Super Admin, reusing the standardized pattern (C1 OD-028 / C5 AC-5.QUE.005.2 / C6 FR-6.ESC.004).
8. **Tests to the ACs** — including the two negative-path floor tests (AF-128) and the ranking-relevance EVAL (AF-129).

## 9. Verification (how DoD is proven)
- **Unit / integration** per spec/05-non-functional/test-strategy.md: state-machine transitions (SUG.001), rank ordering + cap + floor-exemption (SUG.002), pill assignment rules (SUG.003), routing + no-recipient escalation (SUG.004), weight update + floor-enforced-before-commit + re-surface (SUG.005).
- **Escalate-don't-abandon:** AC-NFR-OBS.007.1 must hold — the stuck-`generated` wait-point escalates + persists; prove alongside the four other timed wait-points.
- **Build-time EVALs (AC → `Verified` path):** AF-128 (a dismissal never drives a hard-risk class below floor; escalating metric always re-surfaces) and AF-129 (ranking + briefing surface the genuinely important items) must pass before this slice is signed off. Delivery correctness inherits AF-078 GREEN from C7 ISSUE-075.
