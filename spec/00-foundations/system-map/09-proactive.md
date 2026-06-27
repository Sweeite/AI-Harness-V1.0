# Zoom-in: C9 Proactive Intelligence — "what it does without being asked"

This opens up the **proactive-generation + cold-start-gating + chat-command layer**: the three **proactivity modes**,
the seven **generators**, the **suggestion lifecycle**, the **cold-start phase ladder** that decides when proactivity
turns on, the **action-autonomy matrix** (OD-088) with its non-negotiable floor, and the `/` **command dispatch**.
This map reflects the C9 resolutions (OD-082…OD-088) + the verification-gate hardening (the H1 send-time re-resolve,
H2 floor-across-suppression, M1…M4, AF-127…131). Where this map and a requirement disagree, the requirement wins.

**Scope (what C9 owns):** the **three modes** + mode-assignment + the **autonomy matrix/floor** · the **7 generators**
· the **suggestion lifecycle** (persist/rank/explain/deliver-route/dismissal-learn) · the **cold-start policy matrix**
+ **proactive-suppression** · the `/` **command registry + dispatch + node-gating**.
**Seams out (what C9 does NOT own):** **enforcement** of any proactive action (approval tiers, hard limits, anomaly,
injection) → **C6**; the **slow loop** + scheduled briefing trigger → **C5**; the **Insight Agent definition** →
**C8**; **coverage / Maturity / `[Building]` computation** → **C2** (ADR-002); **notification delivery** → **C7**; all
**rendering** (suggestion cards, briefing panel, init-progress indicator, command menu) → **Phase 3**; memory writes →
**C2** sole-writer; RBAC nodes → **C1**; tool execution → **C3**.

## The three modes — assigned by risk, never bypass the guardrails (L3658-3666)

```
   GENERATOR emits a proactive item
        │   MODE = f(C6 risk/approval tier, FR-6.APR.001)              (MODE.002)
        │     high risk → SUGGEST (human decides)
        │     medium    → PREPARE (work done in advance → approval queue; spawns a linked C5 task)
        │     low       → ACT (autonomous, within limits)
        │   indeterminate mode → SUGGEST (conservative default)        (MODE.001.2)
        ▼
   EVERY mode — including ACT — traverses the identical C6 pipeline      (MODE.003, #2)
        │   approval tier · hard limits · anomaly · injection — no proactive bypass path exists  (MODE.003.1)
        │   a proactive Act that hits a hard limit is blocked + logged, never auto-runs           (MODE.003.2)
```

## The action-autonomy matrix + the floor (OD-088, operator-decided #2 — amends C6 FR-6.APR.002/003)

```
   CFG-action_autonomy_matrix  (edit = PERM-guardrail.edit_autonomy, SUPER ADMIN only)   (MODE.004.4)
        │
        │   LOW-RISK EXTERNAL  (cold-lead / templated nurture → NON-client contacts)
        │       → configurable down to PREPARE or up to ACT after a trust period
        │       → ACT is rate-capped (C6 FR-6.RTL.001) + audited; the ONE bounded exception to
        │         OD-056 no-irreversible-auto, confined to this sub-type                  (MODE.004.1)
        │
        │   FLOORED  (existing-client / system-of-record comms · ANY financial · Confidential/Restricted)
        │       → FIXED at hard-approval; matrix CANNOT lower to Act/Prepare
        │       → any below-hard config is REJECTED AT WRITE                              (MODE.004.2, #2)
        │       → floored sub-type CAPS the mode regardless of matrix / Suggest-default   (MODE.004.6 / M4)
        ▼
   DEFENCE IN DEPTH (gate critical-check = NO HOLE):
     write-reject (004.2) → mode-assign floor (002.2) → C6 tier floor (AC-6.APR.002.1/.3)
     → ambiguity defaults to FLOORED (004.3) → SEND-TIME re-resolve vs system-of-record (004.5 / H1)
     → non-overridable hard-limit backstop (C6 HRD). ⚠️ AF-131 (the client/content tag accuracy the floor rests on)
```

## The seven generators (L3670-3684) — each independently enable/disable-able (default on), thresholds configurable

```
   PRO.001 Relationship mgmt  → not-contacted / sentiment drop / renewal → check-in DRAFT (client send = hard-approval)
   PRO.002 Meeting prep       → calendar trigger (C3→C5) → brief from memory → dashboard; client summary → approval queue
   PRO.003 Document prep      → likely-needed proposal/brief → draft from memory+template → approval queue
   PRO.004 Derisking          → Insight Agent scan: sentiment / payment / campaign / capacity / silent-renewal
        │                         → risk + suggested action, routed by risk type; scan-execution liveness (004.3 / L1)
        │                         → AT-FLOOR escalating risk delivered despite dismissal / suppression / disable (004.4 / H2)
   PRO.005 Opportunity        → growth / new-service / referral / market signal → reasoning + action
   PRO.006 Daily briefing     → due-today · at-risk · needs-attention · overnight (scheduled by C5; per-recipient clearance)
   PRO.007 Pattern            → Insight Agent cross-memory patterns → insight + evidence + pill
        │   Insight Agent = read-all / NO writes (C8 SPC.006); memory writes go via C2 sole-writer (ADR-004)
```

## The suggestion lifecycle — never dropped (OD-082)

```
   proactive_suggestions store (C9-owned; NOT task_queue)
        │   generated → surfaced → acted / dismissed / expired / superseded            (SUG.001.1)
        │   PREPARE item spawns a linked C5 task_queue task                            (SUG.001.2)
        │   delivery fail → stays `generated`, retried; stuck past timeout → ESCALATE  (SUG.001.3 / .4 / M2)
        ▼
   RANK by urgency × relevance, volume-capped (anti-spam)                              (SUG.002)
        │   no risk-floor item silently dropped; floor item exempt from TTL while past threshold  (SUG.002.1/.3 / M1)
   EXPLAIN: reasoning + answer-mode pill (Cited/Inferred/Unknown/Building), no inference-as-fact  (SUG.003)
   DELIVER: route by risk type → C7 notification centre → dashboard / chat / push; no recipient → escalate  (SUG.004)
   LEARN: acted → reinforce; dismissed → down-weight VOLUME — never SAFETY                          (SUG.005 / OD-084)
        │   derisking floor never silenced; escalating metric RE-SURFACES (the #1/#3 invariant). ⚠️ AF-128
```

## Cold-start phase ladder — C2 emits the phase, C9 gates the engine (L3725-3768)

```
   C2 emits cold-start phase from Maturity (FR-2.MAT.002, per-entity, ADR-002) — C9 CONSUMES, never recomputes
        │   signal absent OR STALE → fail-safe to COLD (never to full)                 (CST.001.2 / L2)
        ▼
   <20% COLD     proactive SUPPRESSED · loops reduced (C5) · [Unknown]+note · external writes read-only (C6/C3/C5)
   20-50% BASIC  human tasks normal · loops FULL · proactive still suppressed · [Building] still shows
   50-80% PROAC  proactive UNLOCKS (relationship health · meeting prep · briefings)
   >80%  FULL    all features · cold-start permanently OFF for the deployment
        │
        │   suppression caps ADVISORY volume, never a C6/C7 guardrail alert NOR an at-floor escalating risk (CST.002.3 / H2)
        │   external-write block enforced by C6/C3/C5; loop-freq by C5; [Building] by C2; banner/progress by Phase 3 (CST seams)
        │   per-entity coverage → a thin entity shows [Building] in an otherwise-covered deployment (CST.004, the Acme case)
        │   init-progress contract: 6 steps + coverage% + ETA(or "calculating") + verification-pass = highest priority (CST.007)
```

## The `/` command system (L3868-3915) — node-gated, not the "Agency Owner" ladder (OD-086)

```
   user types `/` → menu → dispatch to HOME component                                  (CMD.001)
        │   memory /remember /forget /recall /verify /memory-health → C2
        │   task   /run /queue /approve /reject /status              → C5/C6
        │   agent  /ask /research /summarise                         → C8
        │   system /trigger /schedule /health /alerts /help /tune    → C5/C7/config
        ▼
   GATE each command on a C1 PERMISSION NODE (NOT a role ladder; "Agency Owner" ≠ a C1 role → dissolved)  (CMD.002 / OD-086)
        │   default-deny; a command with no mapped node is denied by default            (CMD.002.3)
        │   node gate evaluated BEFORE the destructive-confirm prompt                   (CMD.003.3 / M3)
   DESTRUCTIVE (/forget /tune /reject) → confirm + the underlying action's C6 tier still governs  (CMD.003)
   EVERY command → answer-mode pill + event_log write; audit-critical fail CLOSED on log failure  (CMD.004 / L3)
   MOBILE → tap-optimised; common node-permitted commands as quick-tap buttons (render → Phase 3)  (CMD.005)
```

## The founder holiday problem (L3792-3864) — integration narrative, no new FRs

The eight break-points map to already-specified components (relationship context → C2 · decisions → C4/C6 · SOPs →
C2 · proactive work → C9 on the C5 slow loop · client relationships → C8/C9 · opportunities → C9 · prioritisation →
C9/C2 · system health → C7). The **founder-prep checklist** + the **initialisation guide** are operational documents →
**OOS-031 / OOS-032**. No orphaned design line.

## The three non-negotiables, in C9 terms

- **#1 never lose knowledge** — a generated suggestion is never dropped (SUG.001); a dismissed risk re-surfaces when
  it escalates (SUG.005 / OD-084); a deferred floor item can't silently expire (SUG.002.3).
- **#2 never do something it shouldn't** — every proactive Act traverses C6 (MODE.003); the autonomy floor can't be
  lowered for financial / client / Restricted, defended in depth incl. send-time re-resolution (MODE.004 / OD-088).
- **#3 never fail silently** — cold-start fails safe to cold (CST.001.2); the Insight scan has execution-liveness
  (PRO.004.3); a stuck suggestion escalates (SUG.001.4); audit-critical commands fail closed on log failure (CMD.004.3).
