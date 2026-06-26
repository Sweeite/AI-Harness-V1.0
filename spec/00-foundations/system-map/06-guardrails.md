# Zoom-in: C6 Guardrails — "what stops it doing something catastrophic"

This opens up the **enforcement layer** — "the code half" of system safety. It is where ADR-007's
containment-first posture becomes mechanism. This map reflects the C6 resolutions (OD-047, OD-010, OD-060…066).
Where this map and a requirement disagree, the requirement wins and this map updates (change control).

**Scope (what C6 owns):** code-side **hard-limit enforcement** · the three **approval tiers** + the mandatory-hard
set + contextual routing · **anomaly detection** (5 pre-step checks) · **rate-limit guardrails** · the
**escalation/flagged workflow** · the four-step **injection sanitization** pipeline · the **`guardrail_log`** ·
the guardrail optimisations.
**Seams out (what C6 does NOT own):** task-queue / loops / DLQ / envelope / run-pipeline **execution** → **C5**
(C5 *invokes* the guardrail check at the step boundary, FR-5.ASM.007, and *records* the `flagged` state, OD-054);
event-log + metrics + alert **delivery** + dashboard views + retention + export **mechanism** → **C7**;
orchestrator routing + agent registry → **C8**; memory health scans + confidence decay + tool-state cross-check +
connector health (the **failure-map detection rows**) → **C2/C3/C5/C8**; prompt-layer **content** (the Layer-1
boundary instruction + hard-limit statement) → **C4**; RBAC / clearance **rules** → **C1**; webhook **auth** → **C0**.

## The four guardrail layers (L2754-2817)

```
   LAYER 1 — HARD LIMITS (code half; prompt half = C4 FR-4.CID.004)            (HRD.001)
        │   never autonomously: external email · financial txn · delete-of-record ·
        │   cross-deployment share · impersonate · self-approve · tool-content-as-instructions
        │   NO role/config/instruction override (L2066) ── un-overridable        (HRD.001)
        │   a hit = BLOCK + LOG + ALERT, with NO approve affordance              (HRD.003 / OD-060, #2)
        │       (distinct from an approval gate, which IS human-overridable)
        │   coverage gaps (bulk export · mass-delete · connector spend) → GATED, not promoted  (HRD.004 / OD-047)
        │   ⚠️ AF-068: enforceability (no authorized-but-dangerous autonomous path) = red-team, pending
        ▼
   LAYER 2 — APPROVAL GATES (3 tiers, C6 policy · C5 enacts the block FR-5.QUE.005)  (APR.001/006)
        │   auto (low risk → immediate) · soft (notify → execute after delay UNLESS rejected,
        │       REVERSIBLE-only — reconciles C5 OD-056) · hard (block until human approves)  (APR.003 / OD-064)
        │   mandatory-hard set: external comms · financial · Confidential/Restricted memory  (APR.002, consumes C1)
        │   contextual routing (CRM→account mgr · financial→ops lead) · initiator ≠ approver  (APR.005, #2)
        ▼
   LAYER 3 — ANOMALY DETECTION (runs BEFORE each step, C5 FR-5.ASM.007 invokes)  (ANM.001)
        │   confidence · volume · contradiction · scope · sentiment              (ANM.002, ⚠️ AF-116)
        │   a SIGNAL not an autonomous gate (ADR-007): flag + route to review;
        │       per-anomaly configurable severity may escalate to hard-approval  (ANM.003 / OD-063)
        │   thresholds configurable · baselines learned (gate-altering = admin-confirmed)  (ANM.004/005)
        ▼
   LAYER 4 — RATE-LIMIT GUARDRAILS (configurable, NEVER unlimited, L2809)        (RTL.001)
        │   tool-writes/task · ext-comms/hr · mem-writes/min · concurrent-tasks · retries→DLQ
        │   ownership split: C6 frames+responds · mechanism homes (C2 mem · C5 concurrency/DLQ · C3 tool)  (RTL.002 / OD-062)
        │   breach → guardrail_log + the ladder (soft alert → throttle → hard stop, ADR-003)  (RTL.003)
```

## Injection sanitization — the 4-step pipeline (L2916-3005, ADR-007-reconciled)

```
   Every monitored-tool read → pipeline BEFORE any prompt injection (in code, not prompt)  (INJ.001)
        │   named harness call site: between tool-read and AI-call (C5 FR-5.ASM.007 step order)  (INJ.001.2, H1)
        ▼
   STEP 1a  REGEX pattern scan — ALWAYS ON (the cheap deterministic layer)       (INJ.002, ⚠️ AF-117)
   STEP 1b  SEMANTIC scan — OFF BY DEFAULT (injection_semantic_detection, ADR-007)  (INJ.003 / OD-066)
        │       when on: FLAG above 0.85 — a signal for human review, NEVER an autonomous gate
        │       (0.85 / 0.95 are SIGNAL KNOBS, not safety dials — reconciliation #2)
   STEP 2   BOUNDARY WRAP in <external_data> tags (C3 applies tag · C4 L1 instruction)  (INJ.004)
   STEP 3   LOG every match → guardrail_log type 'prompt_injection'               (INJ.005, #3)
   STEP 4   QUARANTINE above combined 0.95 (or high-confidence literal if semantic off, OD-066):  (INJ.006)
        │       hold out of task · RETAIN (shadow-retain, never machine-discard) · pause+flag ·
        │       show to human → discard (logged, human-only) or review-and-include ·
        │       NEVER proceeds without explicit human approval (ADR-007 part 4, #1)
        │   un-reviewed past escalation timeout → escalates (INJ.006.4, #1/#3)
```

## Escalation path + the guardrail log (L2865-2902)

```
   GUARDRAIL HIT → task paused → status 'flagged' (C5 schema/OD-054, C6 SETS)    (ESC.001)
        │   multi-fire: most-restrictive governs · hard_limit dominates · each hit logs  (ESC.001.3, M2)
        ▼
   NOTIFY designated reviewer (dashboard + optional Slack) → approval queue       (ESC.002, delivery=C7)
        ▼
   APPROVE → resume from pause  ·  REJECT → cancel + reason  ·  MODIFY → edit + requeue  (ESC.003)
        │   already-applied side effects SHOWN at review; reversible → queue human-visible
        │       CLEANUP task (NO auto-rollback — auto-compensation is itself autonomous, #2)  (ESC.003 / OD-010)
        │   irreversible applied effect → surfaced as NON-COMPENSABLE (no false 'undo')  (ESC.003.3)
   NO flagged item silently abandoned · escalation timeout → reminder chain        (ESC.004, L2881)
        │   every wait-point has a named staleness owner: flagged→ESC.004, awaiting_approval→C5 QUE.005.2  (ESC.004.3, M4)

   guardrail_log (append-only) — 5 types: hard_limit | approval_gate | anomaly | rate_limit | prompt_injection  (LOG.001)
        │   distinct from access_audit (C1) + event_log (C7) · client_slug = label, not RLS key  (LOG.003 / OD-065)
        │   C6 owns write-COMPLETENESS · C7 owns view + retention + export · exportable trust evidence  (LOG.004)
```

## The three non-negotiables, applied to C6

- **#1 never lose knowledge** — quarantine RETAINS content (shadow-retain, never machine-discard, INJ.006) ·
  OD-010 halt retains + shows already-applied effects, no silent drop (ESC.003) · un-reviewed quarantine escalates
  (INJ.006.4).
- **#2 never do what it shouldn't** — hard limits are code-enforced + **un-overridable** (HRD.001/003) ·
  no self-approval at agent OR human tier (HRD.001 #6 + APR.005.3) · soft-approval auto-executes reversible-only
  (APR.003) · anomaly is a signal not an autonomous act (ANM.003) · no auto-rollback (ESC.003) · semantic scan
  never autonomously gates (INJ.003).
- **#3 never fail silently** — every hard-limit hit logged + alerted (HRD.002) · **a guardrail check that itself
  errors fails CLOSED** (FMM.001.3) · a guardrail_log write-failure is fail-closed, block holds (LOG.003.3) ·
  write-completeness across all 5 types (LOG.003) · no flagged item abandoned (ESC.004) · the failure-map is the
  cross-component no-silent-failure invariant (FMM.001).

## The failure-mode map = a cross-component catalogue (FMM.001 / OD-061)

C6 does **not** absorb the 26-row map (L2821-2862). Each row's **detection** lives in its home component
(C2 memory health · C3 connector/tool · C5 loops/DLQ/envelope · C8 orchestrator) and its **alert path** is C7.
C6 owns only the **guardrail-class responses** (hard-limit · injection · anomaly · rate-limit ·
approval-abandonment) and the **no-silent-failure invariant**. This keeps C6 from usurping C2/C3/C5/C8.

## Open items C6 hands forward

- **OD-010** RESOLVED here for the C5/C6 surface (no auto-rollback + human-visible cleanup) — promote to an ADR only
  if it proves cross-cutting beyond C5/C6.
- **AF-068** (containment red-team) — the enforceability proof for HRD.001/OD-047; build-time. **AF-116** (anomaly
  accuracy) + **AF-117** (injection-library coverage) — EVAL gates on the *detection-quality* claims; none holds an
  FR from Approved-on-paper.
- **C5 step-order reconciliation** (INJ.001.2): C5 FR-5.ASM.007's step order should name the injection-sanitization
  step explicitly (it currently names only the anomaly check) — raised as a C5 change-control note so the pipeline
  C6 owns has a guaranteed run point.
- Seam labels: alert delivery + views + retention + export → **C7**; orchestrator → **C8**.
