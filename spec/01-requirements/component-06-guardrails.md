# Component 6 — Guardrails (what stops it doing something catastrophic)

- **Status:** 🟢 **Approved 2026-06-26 (session 23)** — 35 FRs, verification gate run + all findings reconciled;
  ODs **OD-060…OD-066** resolved (+ carry-forwards **OD-047** and **OD-010** resolved here); feasibility
  **block Q (AF-116…AF-117)** logged. Area codes: HRD ×4 · APR ×6 · ANM ×5 · RTL ×3 · ESC ×4 · INJ ×6 · LOG ×4 ·
  OPT ×2 · FMM ×1. C6 is the **enforcement layer** — "the code half" of system safety; detection/alert delivery →
  C7, orchestration → C8, the per-component *mechanisms* → C2/C3/C5 are seams.
- **Sign-off:** ☑ **Approved 2026-06-26, user-authorized (delegated)** — the four #2-touching calls all resolved
  (**OD-060** hard-limit = block+log, no override; **OD-064** soft-approval auto-executes reversible-only;
  **OD-047** keep the seven absolute + gate-don't-promote coverage gaps; **OD-010** no auto-rollback +
  human-visible cleanup task), all **delegated to recommendation by the operator** ("what do you suggest",
  2026-06-26); OD-061/062/063/065/066 delegated per the C0–C5 pattern. Gate clean on orphans/contradictions + all
  12 quality findings reconciled in-file. **AF-068** still gates the enforceability *claim* of HRD.001/OD-047
  (build-time red-team); AF-116/117 are EVAL gates on the anomaly-accuracy / injection-library claims — none
  holds an FR from being Approved-on-paper.

> **Verification gate (2 zero-context subagents, 2026-06-26):**
> - **Orphan/contradiction pass — CLEAN.** Zero orphans (all L2746–3030 + the L2053–2066 / L2976–2980 cross-cuts
>   map or are correctly seamed), no contradictions with ADR-007/003/004/006, glossary, or consumed C0/C1/C3/C4/C5
>   FRs, **all 6 traps PASS** (`client_slug` label-only · C6 never usurps C2/C3/C5/C8 detection — the failure-map
>   scope · hard-limit-not-overridable kept distinct from approval-overridable · semantic-scan off-by-default +
>   thresholds are signal knobs + quarantine retains-not-discards · anomaly-as-signal-not-gate · 12 citations
>   spot-checked, no miscites). Two non-blocking finalization notes (glossary terms — now added; numbering drift —
>   already patched).
> - **Quality/failure pass — 12 findings (3 HIGH, 6 MED, 3 LOW), ALL reconciled in-file:** **+AC-6.FMM.001.3**
>   (a guardrail check that **itself errors** fails CLOSED — the missing #3 invariant, H2); **+AC-6.INJ.001.2**
>   (the injection pipeline's named harness call site between tool-read and AI-call + the C5 step-order
>   reconciliation — H1); **+AC-6.LOG.003.3** (a `guardrail_log` write-failure is fail-closed: the block holds
>   even if the row fails, never rolls back into the action proceeding — H3); **+AC-6.APR.005.3** (no
>   self-approval at the human tier — initiator ≠ approver, the human-tier expression of hard limit #6 — M1);
>   **+AC-6.ESC.001.3** (multi-fire precedence — most-restrictive governs, `hard_limit` dominates, each hit still
>   logs — M2); **manifest tightened** (the mid-task re-check *mechanism* is C5 FR-5.ASM.005; C6 owns only the
>   guardrail_log row + flagged-review — M3, removed an overclaim); **+AC-6.ESC.004.3** (every wait-point has a
>   named staleness owner — `flagged`→this FR, `awaiting_approval`→C5 AC-5.QUE.005.2 — M4); **+AC-6.INJ.006.4**
>   (quarantine-review staleness made explicit — M5); **+AC-6.OPT.001.2** (un-actioned tier/baseline candidate
>   persists, doesn't vanish — M6); **+AC-6.LOG.001.3** (`pending` disambiguation by type — L1); **AC-6.RTL.001.1**
>   meaningful-finite-ceiling clause (L2); **OD-047 sub-question CLOSED** (no open sub-question points at an
>   Approved FR — L3). The reviewer's meta-finding: the posture-level safety logic was already sound; the real
>   risk was **mechanism wiring** (H1/H2/H3 — a guardrail correctly designed but never run, or failing open) —
>   all three closed. Confirmed great-tier: ADR-007 reconciliations faithful, hard-limit-vs-approval split handled
>   at three layers (FR + AC + schema-status), failure-map scope discipline, OD-010's no-auto-rollback care.

- **What C6 is:** the **enforcement layer** — "guardrails are what stop a capable autonomous system from doing
  something catastrophic… the same bad judgment call made a thousand times before anyone notices" (L2750). C6
  owns the **code-side enforcement** of the four guardrail layers — **hard limits** (the code half of "both
  prompt AND code"), **approval gates** (the three-tier policy + the mandatory-hard set + contextual routing),
  **anomaly detection** (the five pre-step checks + thresholds + baseline learning), **rate-limit guardrails**
  (the configurable-never-unlimited caps) — plus the **escalation/flagged workflow**, the **prompt-injection
  sanitization pipeline** (ADR-007-reconciled), the **`guardrail_log`** (the append-only trust-evidence store),
  and the **guardrail optimisations**. C6 is where ADR-007's containment-first posture becomes mechanism.
- **What C6 is NOT (seams):** task-queue / loops / DLQ / context-envelope / run-pipeline **execution** → **C5**
  (C5 *invokes* the guardrail check at the step boundary, FR-5.ASM.007, and *records* the resulting state,
  OD-054; C6 owns the policy + mechanism); event-log / metrics sinks / **alert delivery** / dashboard views /
  retention / export mechanism → **C7**; orchestrator routing / agent registry → **C8**; memory read/write +
  health scans + confidence decay **mechanisms** → **C2**; tool execution + connector health + tool-state
  cross-check **mechanisms** → **C3**; prompt-layer **content** (the Layer-1 boundary instruction + hard-limit
  statement) → **C4**; RBAC / sensitivity-clearance **rules** → **C1**; webhook **authentication** → **C0**.
  **Scope boundary (the failure-mode-map call, OD-061):** the failure-mode map (L2821–2862) is a
  **cross-component catalogue** — each row's *detection* lives in its home component and its *alert path* is C7;
  C6 owns only the **guardrail-class responses** (hard-limit / injection / anomaly / rate-limit /
  approval-abandonment) and the **no-silent-failure invariant** (#3). C6 does **not** re-implement memory health
  scans (C2), connector health (C3), loop heartbeats / DLQ / envelope integrity (C5), or orchestrator confidence
  logging (C8).

- **Design-doc source:** `## 6. Guardrails` = **L2746–L3030** (next `## 7. Observability` at L3031). Load-bearing
  blocks: Layer-1 hard limits **L2754–2768**, approval gates **L2772–2787**, anomaly detection **L2791–2803**,
  rate limits **L2807–2817**, failure-mode map **L2821–2862**, escalation path **L2865–2881**, `guardrail_log`
  schema **L2887–2902**, optimisations **L2906–2912**, prompt-injection sanitization **L2916–3027**. Cross-cut:
  the seven hard limits as declared **L2053–2066** (C3), the external-data boundary instruction **L2976–2980**
  (C4). C6 checklist overview **L287–~296** (confirm at decomposition).

---

## Context manifest (load only these)

- **ADR-007** (containment-first injection posture) — **the spine.** The security boundary is **capability
  containment in code, not detection** (part 1). Hard limits, default-deny RBAC+RLS, approval gates, rate
  limits, physical isolation, sole-writer memory are the controls that ignore prompt content entirely.
  **Detection is demoted to a signal** (part 3): the cheap deterministic layers (boundary tagging, regex
  tripwires, webhook auth) stay always-on for logging; the **embedding-similarity scan ships OFF by default**
  (`injection_semantic_detection`, part 3) and when on may only **flag content for human review, never
  autonomously gate**. **Fail-safe = retain + route to human** (part 4): a quarantine **holds and retains**
  content (shadow-retain), never machine-discards — discard is a human-only logged decision (#1). The
  thresholds `injection_semantic_threshold` (0.85) / `injection_quarantine_threshold` (0.95) are **reframed as
  signal-tuning knobs, NOT safety dials** (part 5). **AF-068** (SPIKE / red-team) is the enforceability proof:
  the containment boundary holds end-to-end, no authorized-but-dangerous autonomous action path.
- **ADR-003** (cost; "controls before gates") — guardrails are **structural/code limits first**; the rate-limit
  ladder (soft alert → throttle → hard kill) is modelled on the cost ladder. Anomaly/semantic-scan model calls
  are token-cost levers — the always-on deterministic layer is free, the semantic scan is the paid (and
  default-off) one.
- **ADR-004** (sole-writer `service_role` + per-entity validate-and-commit) — the agent/background path is
  `service_role`. **The mid-task authorization re-check + quarantine *mechanism* is C5 FR-5.ASM.005** (the
  harness re-checks the originating user's active status + relied-on clearances at the step boundary and halts +
  quarantines per C1 FR-1.RLS.007 / OD-031). **C6 owns only the resulting guardrail-class response** — the
  `guardrail_log` row, the `flagged` state, and the flagged-review/compensation handling (FR-6.ESC.003). *(M3
  reconciliation: C6 does not re-enforce the re-check; it consumes C5's halt and handles the guardrail
  bookkeeping — no overclaim, no gap.)*
- **ADR-006 / `standards/rbac.md`** — approval routing + the Confidential/Restricted hard-approval triggers
  **consume** C1's sensitivity-clearance model (FR-1.CLR.*, FR-1.RST.*); C6 sets policy, it does not re-decide
  RBAC. The agent path is `service_role` (bypasses RLS) — guardrail enforcement is code, not an RLS predicate.
- **ADR-001 §3/§4** (Silo isolation) — `client_slug` on `guardrail_log` (L2897) is a **label, not an RLS key**
  — cross-client isolation is physical; it appears in no RLS policy predicate (mirrors C1–C5).
- **standards/change-control.md** — OD-047 and OD-010 touch **Approved** decisions (ADR-007, FR-3.ACT.002 are
  Approved). Any change to the seven hard limits or the compensation model goes through change-control, not a
  silent edit.
- **Glossary:** hard limit, approval gate (auto/soft/hard), anomaly detection, rate limit, escalation,
  `guardrail_log`, external-data boundary tag, prompt-injection sanitization, quarantine, `flagged` status,
  containment-first, detection-as-signal. *(New terms to add at finalization: approval tier, hard-approval set,
  escalation timeout, contextual approval routing, injection-pattern library, shadow-retain — confirm against
  existing glossary first.)*

### Consumed (cite, do not re-spec)

- **From C3:** **FR-3.ACT.002** (the seven hard limits *declared* + applied at the connector grain — C6 is the
  central code gate behind it); FR-3 boundary-tag application at tool-read (the always-on deterministic tag);
  FR-3.RL.* (connector rate-limit tracker + the irreversible/billed halt-and-escalate route); FR-3.TRIG.*
  (event ingress that feeds anomaly/contradiction checks).
- **From C4:** **FR-4.CID.003** (every Layer 1 carries the external-data boundary instruction — the prompt half
  of step 2); **FR-4.CID.004** (every Layer 1 states the hard limits — the prompt half of the hard-limit
  defense); **FR-4.LYR.004** (assembly halts if a Layer-1 safety element is missing — C6's enforcement assumes a
  validated stack).
- **From C5:** **FR-5.QUE.005** (a `requires_approval` task moves to `awaiting_approval` and blocks — C6 owns
  the tier *policy* that sets the flag); **OD-054 / FR-5.QUE.001** (the `flagged` status is **defined in the C5
  schema, SET by C6** on a guardrail hit, distinct from `awaiting_approval`); **FR-5.ASM.007** (the harness
  invokes the per-step anomaly/guardrail check — C6 owns the check); **FR-5.ASM.004/005** (mid-task re-check +
  approval gate on the consequential-action path); **FR-5.JOB.*** (DLQ + retry counts the rate-limit cap
  references); the **quarantine-retains-WIP** clauses (AC-5.ASM.005.1 / AC-5.QUE.003.2).
- **From C1:** **FR-1.CLR.001/004/006** (sensitivity tags drive the Confidential/Restricted hard-approval
  triggers); **FR-1.RST.003** (Restricted never auto-injected); **FR-1.RLS.007 / OD-031** (mid-task revocation
  re-check — C6 enforces the quarantine); **OD-024** (`access_audit` is a *distinct* store from `guardrail_log`).
- **From C0:** **FR-0.WHK.001–005** (webhook authentication; failed verification is logged as `prompt_injection`
  — an existing producer of `guardrail_log` rows).

---

## Doc-reconciliations carried into C6 (cite these, not the raw design line)

1. **`client_slug` on `guardrail_log` (L2897) is a label, not an RLS key** — cross-client isolation is physical
   (ADR-001 §3/§4); it appears in no RLS predicate. (Mirrors C1–C5.)
2. **The injection thresholds (0.85 / 0.95, L3017–3027) are signal-tuning knobs, NOT safety dials** — per ADR-007
   part 5. The semantic-similarity scan is **off by default** (`injection_semantic_detection`); the always-on
   deterministic **regex** layer is what runs unconditionally. The design's step-1 "regex + semantic" reads as
   "regex always, semantic when enabled."
3. **Quarantine = retain-and-route-to-human, never machine-discard** — ADR-007 part 4. The design's step-4
   "discard (task continues without that content)" is a **human-only** logged decision, not an automatic drop.
4. **Anomaly detection is a signal, not an autonomous hard-gate** — ADR-007 part 3 / "detection-as-signal." An
   anomaly **flags + routes to review** (the soft path) by default; it does not autonomously block or act. (See
   OD-063 for the per-anomaly severity policy.)
5. **The failure-mode map (L2821–2862) is a cross-component catalogue, not a C6 work-list** — detection in the
   home component, alert path in C7; C6 owns only the guardrail-class responses + the no-silent invariant (OD-061).
6. **Hard limits are NOT human-overridable; approval gates are** — L2066 ("no user role, no agent instruction,
   no config change can override a hard limit") vs L2782 (hard approval "blocks until a human explicitly
   approves"). A hard-limit hit is block+log+alert with **no approve affordance**; the approval queue's
   approve/reject/modify actions apply to approval-gate and anomaly/injection flags, never to a hard-limit
   violation. (See OD-060.)

---

## Area codes

| Code | Area | Scope |
|---|---|---|
| **HRD** | Hard-limit enforcement | The code half of the seven hard limits; immediate-log-and-alert; un-overridable posture; the set/rigidity/enforceability review (OD-047) |
| **APR** | Approval gates | The three tiers (auto/soft/hard); the mandatory-hard set; soft-timeout auto-execute posture; contextual routing; the C5 seam contract |
| **ANM** | Anomaly detection | The five pre-step checks; detection-as-signal severity; configurable thresholds; baseline learning |
| **RTL** | Rate-limit guardrails | The five configurable-never-unlimited caps; the ownership split; breach → log + ladder |
| **ESC** | Escalation / flagged workflow | Guardrail-hit → pause → flagged; reviewer notification; approve/reject/modify resolutions; no-silent-abandon + escalation timeout |
| **INJ** | Injection sanitization | The four-step pipeline (regex / boundary-wrap / log / quarantine), ADR-007-reconciled; semantic scan off-by-default; retain-route-human |
| **LOG** | Guardrail log | The `guardrail_log` schema + 5 types; append-only; write-completeness; export + view seam |
| **OPT** | Guardrail optimisations | Approval-pattern learning (admin-confirmed, never auto); anomaly baseline learning |
| **FMM** | Failure-mode-map anchor | The no-silent-failure guardrail invariant + the cross-component catalogue scoping |

---

## Seams (do not double-spec)

| Intent (design line) | Home | Why it is not a C6 FR |
|---|---|---|
| Alert *delivery* (dashboard + admin Slack) on a hard-limit hit (L2768) | **C7** | C6 produces the event + requires the alert; C7 owns the delivery channel + routing |
| `flagged` status enum value + task pause/resume *mechanism* (L2870, 2876) | **C5** | C6 *sets* the state + decides resume; C5 owns the state machine + checkpoint |
| Dead-letter-queue move + retry counter (L2816, 2826) | **C5** | The cap is a C6 guardrail; the DLQ/retry mechanism is C5 FR-5.JOB.* |
| Loop heartbeat / missed-run catch-up (L2828, 2852, 2860) | **C5** | C5 FR-5.LOP.* owns liveness; C6 references it as a failure-map row |
| Memory structural health scan / confidence amber zone / consolidation-job logging / conflict-queue age (L2832–2835, 2859) | **C2** | C2 FR-2.MNT.* owns memory health; these are catalogue rows, not C6 mechanisms |
| Connector auth-expiry / partial-return / write-state cross-check (L2839–2841) | **C3** | C3 owns connector health + tool-state cross-check |
| Orchestrator confidence logging / routing flags / dead-agent detection / specialist-drift (L2829, 2846–2849) | **C8** | C8 owns orchestration + agent design |
| Context-envelope integrity check at handoff (L2848) | **C5** | C5 FR-5.ENV.* owns the envelope |
| Boot-time config validation / CI-CD silent-break detection (L2853–2854) | **C5 / ADR-005** | Provisioning + deploy concern |
| The `guardrail_log` *dashboard view*, *retention*, *tamper-evidence*, *export mechanism* (L2902) | **C7** | C6 owns the write contract + completeness; C7 owns where it lives + how long + how it's shown/exported |
| Sensitivity-clearance *rules* behind the Confidential/Restricted hard-approval triggers | **C1** | C6 consumes the tags; C1 owns the clearance model |
| Webhook-auth-failure → `prompt_injection` log (L806–809) | **C0** | C0 FR-0.WHK.005 already produces this row; C6 owns the table it lands in |

---

## Open Decisions (ALL RESOLVED 2026-06-26 — the four #2-touching delegated to recommendation by the operator)

> **Carry-forwards resolved here:** **OD-047** (the seven hard limits — set / rigidity / enforceability) and
> **OD-010** (compensation/rollback for partial chains). Both touch **Approved** decisions → change-control.
> **Disposition:** all on the recommended option. OD-060/047/064/010 (#2-touching) were surfaced to the operator,
> who delegated ("what do you suggest"); OD-061/062/063/065/066 delegated per the C0–C5 pattern.

### OD-060 — Hard-limit override posture: is a hard-limit hit ever human-overridable? 🟢 RESOLVED → (a)
**Why it matters:** L2066 says **no role, instruction, or config can override a hard limit**; L2782 says hard
*approval* "blocks until a human explicitly approves." If the approval queue exposes an "approve" affordance on
a **hard-limit** violation the same way it does for an approval-gate flag, the absolute boundary becomes
human-overridable — collapsing the #2 guarantee. The two must be kept distinct.
**Options:** (a) **hard limit = block + log + alert, with NO approve/override affordance** anywhere (the queue's
approve/reject/modify apply only to approval-gate, anomaly, and injection flags); a hard-limit violation is
recorded and the attempting step is killed — the *only* way to do the limited action is to redesign the task so
it is not autonomous (e.g. a human sends the email themselves); (b) hard limits are overridable by a Super
Admin with a logged reason (weaker — reintroduces an override path, conflicts L2066); (c) some hard limits
absolute, others Super-Admin-overridable (a hybrid — couples to OD-047's per-limit rigidity).
**Recommendation:** **(a)** — the value of a hard limit is that it is *not* a judgment call. Legitimate
"the client actually wants this automation" cases are served by the **approval-gate** layer (a human approves
the *specific* action), not by weakening the autonomous-prohibition. Pairs with OD-047. → FR-6.HRD.003.

### OD-047 — The seven hard limits: right set, right rigidity, and enforceable? 🟢 RESOLVED → keep seven absolute; gate-don't-promote
**Resolution proposed (2026-06-26):** **Keep the seven as absolute, strict-by-default; do not tier-gate or
remove any before the AF-068 red-team.** Reasoning across the two failure directions the OD raised:
- **Too-strict** is handled *without* weakening a limit: every hard limit is "never **autonomously** X." The
  legitimate low-risk automation a client wants (routine outbound comms, etc.) flows through the **approval-gate
  layer** (auto/soft/hard) — a human-approved action is not an autonomous one, so it never trips the limit.
  Tier-gating a hard limit itself is rejected (it turns an invariant into a config).
- **Too-lax** (are seven enough?) is handled by **coverage via approval-gates + rate-limits, not new hard
  limits**: bulk data export, mass memory-delete, public/external posting, connector-mediated spend, and
  destructive config changes are routed to **hard-approval** (FR-6.APR.002) and/or **rate-limit caps**
  (FR-6.RTL.001) rather than promoted to an eighth absolute limit — keeping the absolute set small, auditable,
  and "boring to maintain" (L2768). *Sub-question (promote {bulk export, mass-delete, connector spend} to an
  absolute limit, or gate?)* **CLOSED (2026-06-26):** operator delegated ("what do you suggest") → **gate, don't
  promote** — these keep a legitimate human-authorized path (a client may genuinely want a bulk export) that an
  absolute limit would forbid; hard-approval + a rate cap blocks the *autonomous* runaway while preserving the
  human-in-the-loop path. No open sub-question points at FR-6.HRD.004 (L3 reconciliation — Rule 0).
- **Enforceability** is **not yet proven** — it rests on **AF-068** (the containment red-team: no
  authorized-but-dangerous autonomous path, live payloads). The seven stay the safe default *because*
  enforceability is unproven; do not relax before AF-068 clears. → FR-6.HRD.001/004; gated on AF-068.

### OD-061 — Failure-mode-map ownership / scope 🟢 RESOLVED → (a)
**Why it matters:** the map (L2821–2862) lists 26 failure modes across task/memory/tool/agent/system. Read
literally, C6 would re-implement memory health scans, connector health, loop heartbeats, orchestrator
confidence logging — usurping C2/C3/C5/C8 and ballooning C6.
**Recommendation:** **(a)** the map is a **cross-component catalogue**: each row's *detection* belongs to its
home component (seam table above) and its *alert path* is C7. C6 owns only (i) the **guardrail-class responses**
(hard-limit / injection / anomaly / rate-limit / approval-abandonment) and (ii) the **no-silent-failure
invariant** — every guardrail-class event is detected, recorded in `guardrail_log`, and surfaced; none is
silently swallowed (#3). → FR-6.FMM.001.

### OD-062 — Rate-limit guardrail ownership split 🟢 RESOLVED → (a)
**Why it matters:** the five caps (L2811–2816) overlap existing owners: `max memory writes/min` is C2/ADR-004
(`memory_writes_per_minute`), `max concurrent tasks` + `max retries → DLQ` are C5 (FR-5.JOB.*), `max tool writes
per task` + `max external comms/hour` are C6/C3.
**Recommendation:** **(a)** C6 **frames all five as guardrails** — configurable, never-unlimited (L2809), breach
→ `guardrail_log` (type `rate_limit`) + the ladder — and **delegates the enforcement mechanism** to the home
owner (memory→C2, concurrency/DLQ→C5, tool/comms→C6+C3). C6 owns the *policy + the breach response*; it does not
re-implement the counters that already exist. → FR-6.RTL.002.

### OD-063 — Anomaly → severity / approval-tier mapping 🟢 RESOLVED → (a)
**Why it matters:** L2791–2803 defines five anomaly checks but never says what an anomaly *does* — flag only, or
block? Per ADR-007 detection-as-signal, it must not autonomously hard-gate.
**Recommendation:** **(a)** an anomaly **flags + routes to human review (the soft path) by default**, with a
**per-anomaly, per-deployment configurable severity** that can escalate a specific anomaly to hard-approval
(e.g. a volume anomaly on an external-comms step). No anomaly autonomously blocks-and-acts; it pauses + flags.
→ FR-6.ANM.003.

### OD-064 — Soft-approval auto-execute-on-inaction posture 🟢 RESOLVED → (a)
**Why it matters:** soft approval "executes after X minutes unless rejected" (L2780) = human **inaction →
auto-execute**. For an irreversible/external action that is a #2 exposure; it must reconcile with C5 **OD-056**
(no irreversible action auto-executes; step-level gating).
**Recommendation:** **(a)** soft-tier auto-execute-on-timeout applies **only to reversible actions**; anything
irreversible, external-communication, financial, or Confidential/Restricted is **hard-tier by definition**
(L2783–2784) and never auto-executes on inaction. The soft timeout is a convenience for low-risk reversible
work, bounded by the OD-056 no-irreversible-outrun rule. → FR-6.APR.003.

### OD-065 — `guardrail_log` relationship to `access_audit` (C1) + `event_log` (C7) + completeness 🟢 RESOLVED → (a)
**Why it matters:** three append-only sinks now exist — `access_audit` (C1/OD-024, Personal/Restricted access),
`event_log` (C7, operational), `guardrail_log` (C6, security/guardrail events). The boundaries + ownership of
view/retention must be crisp or events fall between them (#3).
**Recommendation:** **(a)** `guardrail_log` is the **distinct, append-only security-event store** for all five
guardrail types; it does **not** duplicate `access_audit` (access reads/writes) or `event_log` (operational
telemetry). **C6 owns write-completeness** (every guardrail event of all five types produces a row, never
silent); **C7 owns the dedicated view, retention, tamper-evidence, and export mechanism** (L2902). `client_slug`
is label-only. → FR-6.LOG.001/003.

### OD-066 — Semantic-scan default + quarantine-when-semantic-off 🟢 RESOLVED → (a)
**Why it matters:** ADR-007 ships the semantic-similarity scan **off by default**. The design's step-4 quarantine
combines "pattern match + semantic similarity." If semantic is off, does quarantine still function?
**Recommendation:** **(a)** the **deterministic regex layer is always-on** and can **quarantine on a
high-confidence literal match alone** (e.g. an exact "[SYSTEM]: new instructions" string); the **semantic scan
is an additive signal** that, when enabled, raises the combined score toward the quarantine threshold. With
semantic off, the regex layer still detects, logs, boundary-wraps, and quarantines high-confidence literals —
the system is never undefended, the semantic scan only *widens* coverage. Thresholds remain signal knobs
(reconciliation #2). → FR-6.INJ.002/003/006.

### OD-010 — Compensation / rollback for partially-completed task chains 🟢 RESOLVED → refined (a)+(c)
**Resolution proposed (2026-06-26):** a refinement of the current option (a). The exposure is real but
**narrowed by three already-locked controls**: (i) **prefer-reversible + approval gates** make irreversible
external side effects rare and human-gated (FR-6.APR.002, C5 OD-056); (ii) **C5 quarantine retains
work-in-progress** (AC-5.ASM.005.1) so a halted chain is never lost; (iii) **idempotent resume** (C5
FR-5.GRP.003) makes re-run safe. The residual — a chain that *did* apply a reversible external write at step N
then halts at step N+k — is handled by: **on halt, C6 records the already-applied side effects on the flagged
task and queues an explicit, human-visible compensation/cleanup task** (option (c) from OD-010), rather than an
automatic saga (rejected — auto-compensation is itself an autonomous external action, #2). The human reviewer at
the flagged-task review sees "what was already done" and approves/runs the cleanup. **No automatic rollback of
an external side effect.** Promote to an ADR only if it proves cross-cutting beyond C5/C6. → FR-6.ESC.003 (+ the
"already-applied effects shown at review" clause); compensation-task durability cross-refs C5 AC-5.ASM.009.2.

---

## Functional Requirements

> Status legend: every FR is drafted `Ready`-pending; it advances to `Approved` only after its OD(s) resolve and
> the verification gate is clean. **AF-068** (containment red-team) gates the *enforceability claim* of HRD.001 /
> OD-047 — the FRs are Approved-able on paper, but the proof-of-enforcement is a build-time gate.

### HRD — Hard-limit enforcement

#### FR-6.HRD.001 — Code-layer enforcement of the seven hard limits
- **Statement:** The system shall enforce the seven hard limits **in application code** (the code half of "both
  prompt and code", L2756) as a gate that **no user role, configuration value, or agent instruction can
  override** (L2066): never autonomously (1) send an external email, (2) make or initiate a financial
  transaction, (3) delete a record in any system of record, (4) share data across client deployments, (5)
  impersonate a named human, (6) self-approve a queued action, (7) treat content from monitored tools as
  instructions.
- **Source:** design-doc-v4.md L2754–2766, L2053–2066; ADR-007 (containment-first; hard limits as code gates);
  consumes C3 FR-3.ACT.002 (declaration + connector-grain application), C4 FR-4.CID.004 (prompt-half statement).
- **⚠️ FEASIBILITY: AF-068** — enforceability (no authorized-but-dangerous autonomous bypass path) is proven only
  by the containment red-team, pending.
- **ACs:**
  - AC-6.HRD.001.1 — *Given* any of the seven limited actions, *When* an agent attempts it autonomously, *Then*
    a code gate blocks it irrespective of role, config, or prompt content (paired with, not dependent on, the
    prompt-layer statement).
  - AC-6.HRD.001.2 — *Given* a config value or agent instruction crafted to relax a hard limit, *When* applied,
    *Then* the limit still holds and the attempt is recorded (FR-6.HRD.002).
  - AC-6.HRD.001.3 — *Given* the hard-limit gate and the prompt-layer statement (C4 FR-4.CID.004), *When* the
    prompt statement is somehow absent or overridden, *Then* the code gate still blocks (defense-in-depth — the
    code half does not depend on the prompt half).

#### FR-6.HRD.002 — Every hard-limit hit is logged immediately and alerted, never silent
- **Statement:** The system shall, on every hard-limit hit, write a `guardrail_log` row (type `hard_limit`)
  **immediately** and require an immediate dashboard alert + admin Slack notification — never silent (L2768).
- **Source:** L2768; ADR-007 part 4 (loud logging, #3); FR-6.LOG.001.
- **Seam:** alert **delivery** (dashboard + Slack channel) → C7; C6 produces the event + the requirement.
- **ACs:**
  - AC-6.HRD.002.1 — *Given* a hard-limit hit, *When* the gate fires, *Then* a `guardrail_log` row is written
    in the same transaction as the block (the block is never applied without the record).
  - AC-6.HRD.002.2 — *Given* the row is written, *When* C7's alert delivery is unavailable, *Then* the failure
    to alert is itself surfaced (a dropped alert is not a silent loss — reuses the C5 DLQ-heartbeat pattern,
    AC-5.JOB.006.2).

#### FR-6.HRD.003 — A hard-limit violation is not human-overridable
- **Statement:** The system shall **not** expose any approve/override affordance for a hard-limit violation: a
  hard-limit hit is block + log + alert only. The approval-queue resolutions (approve/reject/modify, FR-6.ESC.003)
  apply to approval-gate, anomaly, and injection flags — **never** to a `hard_limit` event. [OD-060]
- **Source:** L2066 ("no role, instruction, or config can override"); reconciliation #6; OD-060.
- **ACs:**
  - AC-6.HRD.003.1 — *Given* a `hard_limit` `guardrail_log` row, *When* it is shown in the dashboard, *Then* it
    is presented as a recorded block with **no** approve/override control; the only forward path is redesigning
    the task so the action is human-performed (not autonomous).
  - AC-6.HRD.003.2 — *Given* an attempt to mark a `hard_limit` event `approved`, *When* submitted via any path,
    *Then* it is rejected (the `status` transition approve is not valid for type `hard_limit`).

#### FR-6.HRD.004 — The seven-limit set is the audited safe-default; coverage gaps route to gates, not new limits
- **Statement:** The system shall treat the seven as the **complete absolute set** for v1; additional dangerous
  autonomous actions (bulk data export, mass memory-delete, public/external posting, connector-mediated spend,
  destructive config change) shall be covered by **hard-approval (FR-6.APR.002)** and/or **rate-limit caps
  (FR-6.RTL.001)** rather than promoted to absolute limits — keeping the absolute set small and "boring to
  maintain" (L2768). Any change to the set or the per-limit rigidity goes through **change-control** (touches
  ADR-007 + FR-3.ACT.002, Approved). [OD-047]
- **Source:** L2768; OD-047; standards/change-control.md; ADR-007.
- **⚠️ FEASIBILITY: AF-068** — gates relaxing any limit from absolute.
- **ACs:**
  - AC-6.HRD.004.1 — *Given* a candidate dangerous action not in the seven, *When* classified, *Then* it is
    assigned a hard-approval tier and/or a rate-limit cap (FR-6.APR.001 / FR-6.RTL.001), not silently auto-allowed.
  - AC-6.HRD.004.2 — *Given* a proposal to add/remove/relax a hard limit, *When* raised, *Then* it is processed
    as a change-control item (supersede/OD), not a config edit, and not before AF-068 clears.

### APR — Approval gates

#### FR-6.APR.001 — Three-tier approval classification
- **Statement:** The system shall classify each gated action into one of three tiers — **auto-approve** (low
  risk, execute immediately), **soft approval** (notify, execute after a configurable delay unless rejected),
  **hard approval** (block until explicit human approval) — by the action's `risk_level` (C3 FR-3.REG.001) plus
  its reversibility/sensitivity. C6 owns the tier policy; C5 enacts the block (FR-5.QUE.005).
- **Source:** L2772–2782; consumes C5 FR-5.QUE.005, C3 FR-3.REG.001.
- **ACs:**
  - AC-6.APR.001.1 — *Given* a gated action, *When* evaluated, *Then* exactly one tier is assigned and recorded;
    no action is un-classified (default = hard approval if classification is uncertain — fail-safe, #2).
  - AC-6.APR.001.2 — *Given* an auto-approve action, *When* dequeued, *Then* it executes without a human step;
    *Given* soft/hard, *Then* C5 moves it to `awaiting_approval` per FR-5.QUE.005.

#### FR-6.APR.002 — Mandatory hard-approval set
- **Statement:** The system shall require **hard approval** (never auto, never soft) for: **floored external
  communications** — communications to **existing clients or systems of record** — financial-record operations, and
  Confidential- or Restricted-tagged memory operations (L2783–2784) — plus the FR-6.HRD.004 gated extensions (bulk
  export, mass-delete, connector spend, destructive config). **Low-risk external communication** (cold-lead /
  templated nurture to **non-client contacts**) is **not** in this floor — it is governed by the **C9
  action-autonomy matrix (FR-9.MODE.004)** + **contextual approval routing (FR-6.APR.005)**, operator-configurable
  down to Prepare or up to Act after a trust period. The Confidential/Restricted triggers consume C1 sensitivity
  tags (FR-1.CLR.001/004).
- **Source:** L2783–2784; consumes C1 FR-1.CLR.*, FR-1.RST.003; **amended OD-088 (2026-06-27)**.
- **ACs:**
  - AC-6.APR.002.1 — *Given* a **floored** action — an external communication to an **existing client / system of
    record**, a financial operation, or a Confidential/Restricted memory action — *When* tiered, *Then* it is
    hard-approval regardless of any config that would lower it (the floor, mirroring the C4 principles hard-floor).
  - AC-6.APR.002.2 — *Given* a Restricted-tagged memory operation, *When* gated, *Then* the hard-approval routes
    to a grantee/Super-Admin per C1's Restricted model, and the access is audited in `access_audit` (C1 OD-024),
    distinct from the `guardrail_log` `approval_gate` row.
  - AC-6.APR.002.3 — *(OD-088)* *Given* a **low-risk external** communication (cold-lead / non-client templated
    nurture), *When* tiered, *Then* it is **not** floored to hard — its tier is the one assigned by the C9
    action-autonomy matrix (FR-9.MODE.004); but *Given* the recipient is an existing client / system-of-record, or
    the content is financial / Confidential / Restricted, *Then* it **remains floored to hard** and the matrix
    **cannot** lower it.

> **Change-control (2026-06-27 · C9 session 26 · OD-088, operator-decided #2):** the mandatory-hard **external**
> element is **narrowed** from "all external communications" to **existing-client / system-of-record** comms.
> Low-risk external (cold-lead / templated nurture to non-client contacts) is removed from the floor and governed by
> the new C9 **action-autonomy matrix (FR-9.MODE.004)** — operator-configurable down to Prepare or up to Act after a
> trust period, bounded by the C6 rate caps (max external comms/hour, FR-6.RTL.001) and full audit. **Financial,
> existing-client / system-of-record, and Confidential/Restricted comms remain floored to hard, never configurable
> below.** This also refines **OD-056 / FR-6.APR.003**: the blanket "external-communication never auto-executes"
> becomes "**floored**-external never auto-executes"; an Act-tier low-risk external send is a **conscious,
> operator-opt-in, trust-gated, rate-capped** exception to the no-irreversible-auto default — bounded to the
> non-client low-risk sub-type only (see FR-9.MODE.004 for the bounds; surfaced, not hidden).

#### FR-6.APR.003 — Soft-approval auto-execute is reversible-only
- **Statement:** The system shall auto-execute a **soft-approval** action after its configurable delay only if
  the action is **reversible**; any irreversible / **floored-external** (existing-client / system-of-record) /
  financial / Confidential / Restricted action is hard-approval by definition (FR-6.APR.002) and **never**
  auto-executes on human inaction — reconciling C5 **OD-056** (no irreversible action auto-executes). The one
  bounded exception is an **Act-tier low-risk external** send authorized via the C9 action-autonomy matrix
  (FR-9.MODE.004, OD-088) — operator-opt-in + trust-gated + rate-capped — which is *not* a soft-approval timeout
  path but an explicitly configured autonomy grant for the non-client low-risk sub-type only. [OD-064, OD-088]
- **Source:** L2779–2780; OD-064; consumes C5 OD-056; **amended OD-088 (2026-06-27)**.
- **ACs:**
  - AC-6.APR.003.1 — *Given* a soft-approval action whose delay elapses with no human action, *When* the timer
    fires, *Then* it executes **only if** flagged reversible; an irreversible action could not have been soft-tier
    (it is forced hard by FR-6.APR.002) so this path never auto-runs an irreversible effect.
  - AC-6.APR.003.2 — *Given* a soft-approval action, *When* a human rejects before the delay elapses, *Then* it
    does not execute and is logged (reject path).

#### FR-6.APR.004 — Auto-approve immediate execution
- **Statement:** The system shall execute an **auto-approve** (low-risk) action immediately without a human step,
  recording the tier decision so the auto-approve population is auditable (feeds OPT.001 learning).
- **Source:** L2777.
- **ACs:**
  - AC-6.APR.004.1 — *Given* a low-risk action, *When* classified auto-approve, *Then* it executes immediately
    and the tier decision is logged (not necessarily a `guardrail_log` row — auto-approve is the non-event path —
    but the classification is retained for OPT.001).

#### FR-6.APR.005 — Contextual approval routing
- **Statement:** The system shall route an approval request to the **contextually appropriate reviewer** by
  action type/context (CRM update → account manager, financial flag → operations lead, L2787), via a
  configurable routing rule set. C6 owns the routing *rules*; the queue UI + delivery → C7/C8.
- **Source:** L2787, L2908; seam UI/delivery → C7/C8.
- **ACs:**
  - AC-6.APR.005.1 — *Given* an action with a routing-relevant context, *When* gated, *Then* the approval is
    addressed to the configured reviewer role for that context; *Given* no specific rule matches, *Then* it
    routes to a default reviewer (never unrouted — #3).
  - AC-6.APR.005.2 — *Given* the designated reviewer is unavailable/inactive, *When* routing resolves, *Then* it
    falls back + escalates rather than silently stalling (ties to FR-6.ESC.004).
  - AC-6.APR.005.3 — *(Verification gate — M1, no self-approval at the human tier.)* *Given* a flagged/gated item
    whose **triggering identity equals the candidate reviewer identity**, *When* routing resolves, *Then* it
    routes to an alternate reviewer / escalates — an action's initiator **cannot be its own approver**. This is
    the human-tier expression of hard limit #6 (FR-6.HRD.001), which otherwise covers only the agent
    self-approving its own queued action.

#### FR-6.APR.006 — C5 seam contract (tier policy vs block mechanism)
- **Statement:** The system shall keep the division explicit: **C6 decides the tier** (sets `requires_approval`
  and the tier), **C5 enacts the block** (moves to `awaiting_approval`, holds execution, resumes on approval —
  FR-5.QUE.005 / FR-5.ASM.004). C6 does not implement the task state machine; C5 does not decide the policy.
- **Source:** C5 FR-5.QUE.005 / FR-5.ASM.004 (lines 135–136 of the C5 file); reconciliation.
- **ACs:**
  - AC-6.APR.006.1 — *Given* C6 sets a hard-approval tier, *When* the task reaches the gated step, *Then* C5
    holds it in `awaiting_approval` and no execution step runs until a human approves; the two responsibilities
    do not overlap or gap.

### ANM — Anomaly detection

#### FR-6.ANM.001 — Pre-step anomaly check
- **Statement:** The system shall run the anomaly checks **before each task step** (L2793), invoked by the
  harness at the step boundary (C5 FR-5.ASM.007); never after the step has acted.
- **Source:** L2791–2793; consumes C5 FR-5.ASM.007.
- **ACs:**
  - AC-6.ANM.001.1 — *Given* a task step about to execute, *When* the harness invokes the guardrail check,
    *Then* all configured anomaly checks run and resolve **before** any side-effecting action of that step.

#### FR-6.ANM.002 — The five anomaly checks
- **Statement:** The system shall implement five anomaly checks: **confidence** (key memory confidence drops
  below threshold mid-task), **volume** (about to perform an unusually high number of actions), **contradiction**
  (live tool data conflicts with stored memory), **scope** (task expanded significantly beyond its trigger),
  **sentiment** (client communication unusually negative or urgent).
- **Source:** L2795–2801.
- **⚠️ FEASIBILITY: AF-116** — sentiment/scope/volume detection accuracy (false-positive/negative rates) is an
  EVAL gate, not DOCS-provable.
- **ACs:**
  - AC-6.ANM.002.1 — *Given* each of the five conditions, *When* it occurs at a step boundary, *Then* the
    corresponding check fires and produces a flag (FR-6.ANM.003).
  - AC-6.ANM.002.2 — *Given* a contradiction anomaly (live data vs memory), *When* it fires, *Then* it is
    distinct from the C2 memory-conflict queue (which resolves stored-vs-stored conflicts) — this is a
    retrieval-time live-vs-stored signal that pauses the step.

#### FR-6.ANM.003 — Anomalies are signals, not autonomous gates
- **Statement:** The system shall treat an anomaly as a **signal**: it pauses the step and **flags for human
  review (the soft path) by default**, with a **per-anomaly, per-deployment configurable severity** that may
  escalate a specific anomaly to hard-approval. No anomaly autonomously blocks-and-acts or autonomously discards
  work (ADR-007 detection-as-signal). [OD-063]
- **Source:** ADR-007 part 3; OD-063; reconciliation #4.
- **ACs:**
  - AC-6.ANM.003.1 — *Given* an anomaly fires at default severity, *When* handled, *Then* the step pauses, a
    `guardrail_log` row (type `anomaly`) is written, and the task is flagged for review — not silently dropped,
    not autonomously continued.
  - AC-6.ANM.003.2 — *Given* a deployment raises a specific anomaly's severity to hard-approval, *When* that
    anomaly fires, *Then* it enters the hard-approval gate (FR-6.APR.002 path).

#### FR-6.ANM.004 — All anomaly thresholds configurable per deployment
- **Statement:** The system shall make every anomaly threshold configurable per deployment (L2803); the shipped
  values are starting points, not permanent.
- **Source:** L2803.
- **ACs:**
  - AC-6.ANM.004.1 — *Given* an anomaly threshold, *When* an operator edits it, *Then* the new value takes
    effect for subsequent step checks without a code change (config-driven).

#### FR-6.ANM.005 — Baseline learning from historical data
- **Statement:** The system shall build anomaly **baselines from historical data over time** (L2803, L2912), so
  thresholds adapt to demonstrated normal behaviour; fixed thresholds are the starting point. Where a learned
  baseline would change a *gate* outcome (not just a signal), it is surfaced for admin confirmation, never
  silently auto-applied (consistency with OPT.001's never-auto-change rule).
- **Source:** L2803, L2912; OPT.002.
- **ACs:**
  - AC-6.ANM.005.1 — *Given* accumulated history, *When* a baseline is computed, *Then* threshold tightening or
    loosening is proposed; *Given* the change would alter a gate decision, *Then* it requires admin confirmation.

### RTL — Rate-limit guardrails

#### FR-6.RTL.001 — The five configurable, never-unlimited caps
- **Statement:** The system shall enforce five rate-limit caps, **all configurable, none settable to unlimited**
  (L2809): max tool writes per task run, max external communications per hour, max memory writes per minute, max
  concurrent tasks per deployment, max retries before dead-letter-queue.
- **Source:** L2807–2817.
- **ACs:**
  - AC-6.RTL.001.1 — *Given* any of the five caps, *When* an operator attempts to set it to unlimited/zero-guard,
    *Then* the edit is rejected (a guardrail cannot be disabled — #2). *(L2 refinement: the validator also
    enforces a **meaningful finite ceiling** per cap — an absurdly high value (e.g. 10⁹ external comms/hour) is
    "not unlimited" yet functionally unguarded; the config-validation upper bound is a per-cap setting, flagged
    for the config registry, Phase 2.)*
  - AC-6.RTL.001.2 — *Given* a cap is reached, *When* the next action would exceed it, *Then* the action is
    blocked and a `guardrail_log` row (type `rate_limit`) is written (FR-6.RTL.003).

#### FR-6.RTL.002 — Ownership split (policy here, mechanism at the home owner)
- **Statement:** The system shall frame all five caps as guardrails owned by C6 (policy + breach response) while
  **delegating the enforcement mechanism** to the home owner: memory-writes/min → C2/ADR-004
  (`memory_writes_per_minute`), concurrent-tasks + retries-to-DLQ → C5 (FR-5.JOB.*), tool-writes/task +
  external-comms/hour → C6 with C3's connector tracker. C6 does not re-implement counters that already exist. [OD-062]
- **Source:** OD-062; consumes C2 ADR-004, C5 FR-5.JOB.*, C3 FR-3.RL.*.
- **ACs:**
  - AC-6.RTL.002.1 — *Given* each cap, *When* it breaches, *Then* the breach is recorded under the C6 guardrail
    contract regardless of which component's counter detected it (one consistent breach response, no per-owner
    divergence).

#### FR-6.RTL.003 — Breach response: log + ladder
- **Statement:** The system shall, on a rate-limit breach, write a `guardrail_log` row and apply the tiered
  ladder where applicable (soft alert → throttle non-critical → hard stop), modelled on the cost ladder
  (ADR-003). An irreversible/billed action at the cap routes to halt-and-escalate, never auto-retry (consumes
  C3 AC-3.RL.006.2).
- **Source:** L2807–2817; ADR-003 (ladder); consumes C3 AC-3.RL.006.2.
- **ACs:**
  - AC-6.RTL.003.1 — *Given* a soft breach, *When* it fires, *Then* an alert is raised but non-critical work
    continues; *Given* a hard breach, *Then* the offending action class is stopped and flagged.
  - AC-6.RTL.003.2 — *Given* an irreversible/billed action at its cap, *When* evaluated, *Then* it halts and
    escalates (it is excluded from auto-retry).

### ESC — Escalation / flagged workflow

#### FR-6.ESC.001 — Guardrail hit → pause → `flagged`
- **Statement:** The system shall, on any guardrail hit (hard-limit aside — see FR-6.HRD.003), pause the task and
  set its status to **`flagged`** — the state **defined in the C5 schema (OD-054) and SET by C6** — kept distinct
  from `awaiting_approval` (a safety hold is not a routine approval wait).
- **Source:** L2868–2870; consumes C5 OD-054 / FR-5.QUE.001.
- **ACs:**
  - AC-6.ESC.001.1 — *Given* a guardrail hit, *When* C6 sets state, *Then* the task is `flagged` and paused; no
    further step executes until the flag resolves.
  - AC-6.ESC.001.2 — *Given* a `hard_limit` hit, *When* recorded, *Then* the attempting step is killed + logged
    (FR-6.HRD.003) — `flagged`-for-review applies to approval/anomaly/injection/rate-limit hits, which have a
    human-resolution path; a hard-limit block has none.
  - AC-6.ESC.001.3 — *(Verification gate — M2, multi-fire precedence.)* *Given* a single step that trips
    **multiple** guardrails at once (e.g. a hard-limit AND an anomaly, or an injection-quarantine AND a
    rate-limit), *When* resolved, *Then* the **most-restrictive disposition governs** — a `hard_limit` hit
    dominates (block, no resume) regardless of any co-firing approvable flag, so a reviewer can never "approve"
    an anomaly flag and inadvertently resume a step that should have been hard-killed — and **each** hit still
    writes its own `guardrail_log` row (no hit is masked by another).

#### FR-6.ESC.002 — Reviewer notification + queue placement
- **Statement:** The system shall notify the designated reviewer (dashboard + optionally Slack) immediately on a
  flag, and place the flagged item in the dashboard approval queue (L2872–2874). C6 owns the requirement +
  routing (FR-6.APR.005); delivery + the queue UI → C7/C8.
- **Source:** L2872–2874; seam → C7/C8.
- **ACs:**
  - AC-6.ESC.002.1 — *Given* a flag, *When* raised, *Then* the designated reviewer is notified and the item
    appears in the queue; a notification-delivery failure is itself surfaced (no silent un-notified flag, #3).

#### FR-6.ESC.003 — Three resolutions: approve / reject / modify (+ already-applied effects shown)
- **Statement:** The system shall offer three human resolutions for a flagged item: **approve** (task resumes
  from where it paused), **reject** (task cancelled, logged with reason), **modify** (human edits parameters,
  task requeues) — L2876–2878. At review, the system shall **display the side effects already applied** by the
  chain so far and, where a reversible external write was applied before the halt, **queue an explicit
  human-visible compensation/cleanup task** rather than auto-rolling-back. [OD-010]
- **Source:** L2876–2878; OD-010; consumes C5 AC-5.ASM.009.2 (durable successor-task creation), C5 resume.
- **ACs:**
  - AC-6.ESC.003.1 — *Given* a flagged item, *When* a human approves, *Then* C5 resumes the task from the paused
    point; *When* rejected, *Then* the task is cancelled and the reason recorded; *When* modified, *Then* the
    edited task requeues.
  - AC-6.ESC.003.2 — *Given* a chain that applied a reversible external side effect before halting, *When* the
    human reviews, *Then* the already-applied effects are shown and a compensation/cleanup task is offered/queued
    (durably, per AC-5.ASM.009.2) — the system never auto-rolls-back an external effect autonomously (#2).
  - AC-6.ESC.003.3 — *Given* an irreversible side effect was applied (which should be rare — gated by
    FR-6.APR.002), *When* reviewed, *Then* it is surfaced as non-compensable with an explicit operator note (no
    false impression it can be undone).

#### FR-6.ESC.004 — No flagged item silently abandoned; escalation timeout
- **Statement:** The system shall ensure **every flag is resolved** — a flagged item **cannot be silently
  abandoned** (L2881). A configurable **escalation timeout** triggers a reminder notification chain; an
  un-actioned flag escalates (alert + badge) until resolved, reusing the standardized **C1 OD-028 / C2 OD-032 /
  C5 AC-5.QUE.005.2 escalate-don't-abandon pattern** (the system's three wait-points now share one rule).
- **Source:** L2881; reuses C1 OD-028, C2 OD-032, C5 AC-5.QUE.005.2.
- **ACs:**
  - AC-6.ESC.004.1 — *Given* a flagged item un-actioned past its escalation timeout, *When* the timeout fires,
    *Then* a reminder + escalation is raised; the flag is neither auto-resolved nor silently dropped.
  - AC-6.ESC.004.2 — *Given* repeated timeouts, *When* they accrue, *Then* the escalation widens (e.g. to Super
    Admin) rather than looping silently.
  - AC-6.ESC.004.3 — *(Verification gate — M4, every wait-point has a named staleness owner.)* *Given* the
    system's review wait-points, *When* any sits un-actioned, *Then* the escalate-don't-abandon rule covers
    **both** C6-set `flagged` items (this FR) **and** C5 `awaiting_approval` waits (**C5 AC-5.QUE.005.2** is the
    named home for the latter) — so a pure approval-gate wait cannot fall into a gap between FR-6.ESC.004
    (flagged-only) and the C5 staleness clause.

### INJ — Injection sanitization (ADR-007-reconciled)

#### FR-6.INJ.001 — Every monitored-tool content passes the application-layer pipeline
- **Statement:** The system shall pass **every piece of content read from a monitored tool** through the
  application-layer sanitization pipeline **before it is injected into any prompt layer** — in code, not in the
  prompt (L2918, L2940). Prompt-level instruction alone is explicitly insufficient (L2918).
- **Source:** L2916–2940; ADR-007 part 1 (code, not prompt).
- **ACs:**
  - AC-6.INJ.001.1 — *Given* any monitored-tool read (Slack/GHL/Gmail/Drive), *When* its content is about to
    enter a prompt layer, *Then* it has passed steps 1–4 of the pipeline; no tool content reaches a prompt
    un-sanitized.
  - AC-6.INJ.001.2 — *(Verification gate — H1, named invocation seam.)* *Given* the harness step order (C5
    FR-5.ASM.007: anomaly-check → tool-read → AI-call → tool-write → memory-write), *When* a step performs a tool
    read, *Then* the harness invokes the C6 sanitization pipeline **between tool-read and AI-call** — the call
    site is explicit, mirroring how FR-6.ANM.001 binds the anomaly check to FR-5.ASM.007. **Cross-component note:**
    C5 FR-5.ASM.007's step order must name the **injection-sanitization** step (it currently names only the
    anomaly check); raised as a C5 change-control reconciliation so the pipeline C6 owns has a guaranteed run
    point and AC-6.INJ.001.1's "about to enter a prompt layer" is enforceable, not implicit.

#### FR-6.INJ.002 — Step 1a: deterministic regex pattern detection (always-on)
- **Statement:** The system shall scan tool content for the known literal injection patterns via **regex,
  always-on** (the cheap deterministic layer): "ignore previous instructions", "ignore all previous", "disregard
  your", "you are now", "new system prompt", "as an AI you must", "[SYSTEM]", "[INST]", "Assistant:" (at start),
  "Human:" (at start) — L2947–2957.
- **Source:** L2943–2957; ADR-007 part 3 (deterministic layer always on).
- **ACs:**
  - AC-6.INJ.002.1 — *Given* content containing a listed pattern, *When* scanned, *Then* it matches, is logged
    (FR-6.INJ.005), and — if high-confidence literal — can quarantine on the regex layer alone (OD-066).
  - AC-6.INJ.002.2 — *Given* the pattern list, *When* it is updated, *Then* the update is versioned/testable (not
    a silent prod change) — pattern-library maintenance is a tracked concern (AF-117).

#### FR-6.INJ.003 — Step 1b: semantic-similarity scan is OFF by default
- **Statement:** The system shall ship the **embedding semantic-similarity scan OFF by default**
  (`injection_semantic_detection`, ADR-007 part 3). When enabled, it embeds content, compares to a library of
  known injection embeddings, and **flags** above `injection_semantic_threshold` (default 0.85) — as an
  **additive signal for human review, never an autonomous gate**. The threshold is a signal knob, not a safety
  dial (reconciliation #2). [OD-066]
- **Source:** L2959–2963, L3017–3022; ADR-007 parts 3 + 5; OD-066.
- **⚠️ FEASIBILITY: AF-117** — the known-injection-embedding library's coverage/quality is an EVAL gate.
- **ACs:**
  - AC-6.INJ.003.1 — *Given* a fresh deployment, *When* inspected, *Then* `injection_semantic_detection` is off;
    the regex layer (FR-6.INJ.002) still defends.
  - AC-6.INJ.003.2 — *Given* the semantic scan is on and content scores above 0.85, *When* handled, *Then* it
    flags for review (raises the combined score toward quarantine) — it never autonomously blocks or discards.

#### FR-6.INJ.004 — Step 2: external-data boundary wrapping
- **Statement:** The system shall ensure all tool-read content is **wrapped in `<external_data>` boundary tags**
  (with source/channel/timestamp attributes) before injection (L2965–2974). C3 applies the tag at read (the
  always-on deterministic mark); C4 FR-4.CID.003 ensures every Layer 1 instructs that tagged content is data,
  never instructions; C6 ensures the pipeline ordering (tag before inject, sanitize before tag-inject).
- **Source:** L2965–2980; consumes C3 (tag application), C4 FR-4.CID.003 (Layer-1 instruction).
- **ACs:**
  - AC-6.INJ.004.1 — *Given* tool content entering a prompt, *When* assembled, *Then* it is enclosed in
    `<external_data>` tags with its provenance attributes; un-tagged tool content never reaches a prompt layer.

#### FR-6.INJ.005 — Step 3: every match logged
- **Statement:** The system shall log **every sanitization pattern match** to `guardrail_log` as type
  `prompt_injection`, capturing the source (tool + record), the triggering content, which pattern matched, and
  the action taken (sanitised vs quarantined) — L2982–2989.
- **Source:** L2982–2989, L3007–3014; FR-6.LOG.001.
- **ACs:**
  - AC-6.INJ.005.1 — *Given* any pattern match (regex or semantic), *When* it fires, *Then* a `prompt_injection`
    row is written with all four fields; a match is never detected-but-unlogged (#3).

#### FR-6.INJ.006 — Step 4: high-confidence quarantine = retain + route to human
- **Statement:** The system shall, for content scoring above `injection_quarantine_threshold` (default 0.95,
  combined pattern + semantic — or a high-confidence literal regex match when semantic is off, OD-066),
  **quarantine the tool-read result**: it is not used in the task; the task is paused + flagged; the quarantined
  content is **retained** (shadow-retain, never machine-discarded — ADR-007 part 4) and shown to a human
  reviewer; the human decides **discard** (task continues without it — a human-only logged decision) or **review
  and include** (manually approved safe); **the task never proceeds with quarantined content without explicit
  human approval** (L2991–3004).
- **Source:** L2991–3005, L3024–3026; ADR-007 part 4 (retain-route-human); reconciliations #2/#3; OD-066.
- **ACs:**
  - AC-6.INJ.006.1 — *Given* content above the quarantine threshold, *When* handled, *Then* it is quarantined,
    retained, the task pauses + flags, and the content is surfaced to a human — it is never auto-used and never
    auto-discarded.
  - AC-6.INJ.006.2 — *Given* a human reviewer, *When* they choose discard, *Then* the decision is logged
    (who/when) and the task continues without the content; *When* they choose include, *Then* the content is
    admitted only after explicit approval.
  - AC-6.INJ.006.3 — *Given* a quarantine while `injection_semantic_detection` is off, *When* a high-confidence
    literal regex match scores above the bar, *Then* quarantine still functions on the deterministic layer alone
    (OD-066).
  - AC-6.INJ.006.4 — *(Verification gate — M5, quarantine review has a staleness owner.)* *Given* a quarantine
    awaiting a human discard/include decision **past the escalation timeout**, *When* the timeout fires, *Then* it
    escalates per FR-6.ESC.004 (the quarantine sets `flagged` via FR-6.ESC.001, so it is covered — made explicit
    and testable here) — a quarantined-and-forgotten task is never silently stuck holding retained content (#1/#3).

### LOG — Guardrail log

#### FR-6.LOG.001 — The `guardrail_log` schema + five types
- **Statement:** The system shall maintain a `guardrail_log` table — `id`, `task_id`, `guardrail_type`,
  `description` (plain English), `action_blocked`, `status` (`pending` | `approved` | `rejected`), `reviewed_by`,
  `reviewed_at`, `client_slug`, `created_at` — with `guardrail_type` ∈ {`hard_limit`, `approval_gate`, `anomaly`,
  `rate_limit`, `prompt_injection`} (L2887–2899, L3007–3014). `client_slug` is a **label, not an RLS key**
  (reconciliation #1).
- **Source:** L2887–2899, L3007–3014; ADR-001 (client_slug label-only).
- **ACs:**
  - AC-6.LOG.001.1 — *Given* a guardrail event of any of the five types, *When* it fires, *Then* a row with the
    full schema is written; `guardrail_type` is always one of the five (never blank/unknown).
  - AC-6.LOG.001.2 — *Given* the `status` field, *When* set, *Then* `approved` is invalid for a `hard_limit` row
    (FR-6.HRD.003); `hard_limit` rows terminate at the recorded-block state.
  - AC-6.LOG.001.3 — *(Verification gate — L1, `pending` disambiguation.)* *Given* the design's
    `status` ∈ {`pending`, `approved`, `rejected`}, *When* an event is unresolved, *Then* `pending` covers
    **all** unresolved review states (approval-gate wait, quarantine-review wait, anomaly/rate-limit review)
    disambiguated by `guardrail_type` — a reviewer reads the type, not the status, to tell an approval-gate
    `pending` from a quarantine `pending`. (The `flagged` *task* status, C5 OD-054, is the task-level state; this
    is the per-event log state — distinct fields, no conflict.)

#### FR-6.LOG.002 — Append-only
- **Statement:** The system shall make `guardrail_log` **append-only** — no deletes or updates to historical rows
  (L2901) — except the controlled `status`/`reviewed_by`/`reviewed_at` transition on resolution, which is itself
  recorded (a resolution is a forward state change, not a rewrite of history). Mirrors the C1 `access_audit`
  immutability.
- **Source:** L2901; consumes C1 OD-024 (immutability pattern).
- **ACs:**
  - AC-6.LOG.002.1 — *Given* a historical `guardrail_log` row, *When* a delete or content rewrite is attempted,
    *Then* it is rejected; only the defined resolution transition is permitted and it is timestamped/attributed.

#### FR-6.LOG.003 — Write-completeness (C6 owns; C7 owns view/retention/export)
- **Statement:** The system shall guarantee **write-completeness**: every guardrail event of all five types
  produces a `guardrail_log` row, never silent (#3). **C6 owns completeness**; **C7 owns** the dedicated
  dashboard view, retention, tamper-evidence, and export mechanism. The store is **distinct** from `access_audit`
  (C1) and `event_log` (C7) — no event falls between them. [OD-065]
- **Source:** OD-065; consumes C1 OD-024, C7 (view/retention/export).
- **ACs:**
  - AC-6.LOG.003.1 — *Given* every code path that blocks/flags/quarantines, *When* it acts, *Then* it writes a
    row (no block-without-record, no record-without-block) — the record and the safe action are bound together.
  - AC-6.LOG.003.2 — *Given* the three sinks, *When* an event is classified, *Then* it lands in exactly one
    (guardrail event → `guardrail_log`; access read/write → `access_audit`; operational telemetry → `event_log`).
  - AC-6.LOG.003.3 — *(Verification gate — H3, log-write-failure is fail-closed.)* *Given* the `guardrail_log`
    write itself fails (store unreachable, constraint error), *When* a guardrail would block/flag/quarantine,
    *Then* the **safe action (block/halt) is still taken** — the block is **never** abandoned for want of a row —
    and the lost-row event is escalated out-of-band (the AC-6.HRD.002.2 / AC-5.JOB.006.2 surfacing pattern). The
    "bound together" of AC-6.LOG.003.1 resolves to **block-holds-even-if-row-fails**, never "no block if no row":
    a log-write failure must not roll back into the dangerous action proceeding (#2) nor a silently lost record (#3).

#### FR-6.LOG.004 — Exportable trust evidence + dedicated view
- **Statement:** The system shall make `guardrail_log` **exportable as client trust evidence** and surfaced in a
  **dedicated dashboard view** (L2902). C6 owns the exportable-content requirement; the export + view **mechanism**
  → C7.
- **Source:** L2902; seam → C7.
- **ACs:**
  - AC-6.LOG.004.1 — *Given* a client trust/compliance request, *When* an export is produced, *Then* it contains
    the complete `guardrail_log` for the period with all five event types represented and no gaps.

### OPT — Guardrail optimisations

#### FR-6.OPT.001 — Approval-pattern learning (admin-confirmed, never auto)
- **Statement:** The system shall track approval patterns over time and **surface candidates for tier changes**
  in the dashboard; **an admin confirms — the system never changes a tier automatically** (L2910).
- **Source:** L2906–2910.
- **ACs:**
  - AC-6.OPT.001.1 — *Given* a consistent approval pattern (e.g. an action class always auto-approved by a
    human), *When* detected, *Then* a tier-change candidate is surfaced; *Given* the candidate, *Then* it applies
    only after explicit admin confirmation (no silent auto-retiering — #2).
  - AC-6.OPT.001.2 — *(Verification gate — M6, un-actioned candidate doesn't vanish.)* *Given* a surfaced
    tier-change (FR-6.OPT.001) or baseline (FR-6.ANM.005) candidate the admin neither confirms nor rejects,
    *When* it goes stale, *Then* it **persists / re-surfaces** rather than silently disappearing — the
    fail-direction is safe (the gate stays at its strict prior value), but a dropped candidate is still a state
    that must remain visible (#3).

#### FR-6.OPT.002 — Anomaly baseline learning
- **Statement:** The system shall build anomaly baselines from historical data and tighten/loosen thresholds on
  demonstrated normal behaviour (L2912); a change that would alter a *gate* decision requires admin confirmation
  (FR-6.ANM.005), not silent application.
- **Source:** L2912; FR-6.ANM.005.
- **ACs:**
  - AC-6.OPT.002.1 — *Given* accumulated normal behaviour, *When* a baseline shift is computed, *Then* signal
    thresholds may auto-tune but gate-altering shifts are admin-confirmed.

### FMM — Failure-mode-map anchor

#### FR-6.FMM.001 — The no-silent-failure guardrail invariant + the catalogue scoping
- **Statement:** The system shall uphold the **no-silent-failure invariant** for every guardrail-class event:
  each is detected, recorded in `guardrail_log`, and surfaced — none is silently swallowed (#3). The
  failure-mode map (L2821–2862) is a **cross-component catalogue**: each row's *detection* is owned by its home
  component (C2 memory health, C3 connector/tool, C5 loops/DLQ/envelope, C8 orchestrator) and its *alert path* is
  C7; **C6 owns only the guardrail-class responses** (hard-limit / injection / anomaly / rate-limit /
  approval-abandonment) and this invariant. [OD-061]
- **Source:** L2821–2862; ADR-007 (#3, never silent); OD-061; the seam table above.
- **ACs:**
  - AC-6.FMM.001.1 — *Given* any guardrail-class failure, *When* it occurs, *Then* it produces a record + a
    surface; there is no guardrail path that fails closed-and-silent.
  - AC-6.FMM.001.2 — *Given* a failure-map row owned by another component (e.g. connector auth expiry), *When*
    specced, *Then* C6 references the home owner + C7 alert path and does **not** re-implement the detection — the
    catalogue is honored without C6 absorbing it.
  - AC-6.FMM.001.3 — *(Verification gate — H2, fail-closed invariant.)* *Given* a guardrail check that **itself
    errors** (anomaly model call times out, regex/embedding engine throws, the check cannot decide), *When* it
    fails, *Then* the step **fails closed** — it halts + flags, the check error is itself written to
    `guardrail_log` and surfaced — a guardrail evaluation error **never** lets the step proceed unchecked. (The
    only stated fail-safe default was AC-6.APR.001.1; this generalizes it to ANM/INJ/RTL.)

---

## Verification gate

**Run 2026-06-26 (2 independent zero-context subagents). Result: CLEAN + all findings reconciled** — full
summary in the Status header above. Orphan/contradiction pass CLEAN (all 6 traps PASS, no orphans, no
contradictions, 12 citations verified); quality/failure pass found 12 findings (3 HIGH, 6 MED, 3 LOW), all
reconciled in-file (the new ACs carry a `(Verification gate — Hn/Mn/Ln, …)` tag at the point of fix).

## Traceability

35 rows wired into `traceability-matrix.csv` (FR-6.* — HRD ×4 · APR ×6 · ANM ×5 · RTL ×3 · ESC ×4 · INJ ×6 ·
LOG ×4 · OPT ×2 · FMM ×1). `system-map/06-guardrails.md` built; `system-map/README.md` marks 06 ✅.
