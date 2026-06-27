# Component 9 — Proactive Intelligence (what it does without being asked)

- **Status:** 🟢 **Approved 2026-06-27 (session 26)** — 28 FRs `Approved`. **Sign-off:** user-authorized ("i am
  happy"; OD-082…087 delegated, **OD-088 operator-decided #2** — the configurable action-autonomy matrix, amending C6
  FR-6.APR.002/003 via change-control, accepted at sign-off). Feasibility **block T (AF-127…AF-131)** logged,
  OOS-031/032 logged. **Verification gate run** — orphan/contradiction CLEAN (all 6 traps PASS) + **critical
  floor-narrowing check NO HOLE** + 9 quality findings reconciled. Area codes: MODE ×4 · PRO ×7 ·
  SUG ×5 · CST ×7 · CMD ×5 (**28 FRs**). C9 is the
  **proactive-generation + cold-start-gating + chat-command layer** — what the system does *without being asked*
  (L3654), how proactivity is *gated* before the memory is rich enough to be useful, and the `/` command surface
  for fast direct interaction.
- **Scope decision (entry):** **generation + cold-start policy + command dispatch now; enforcement, delivery,
  surfaces, and the coverage metric stay seamed.** C9 owns *what gets proactively produced* and *when proactivity
  turns on*; it does **not** own the *enforcement* of any proactive action (the same C6 guardrails as reactive —
  approval tiers, hard limits, anomaly, injection), the *slow loop* the Insight Agent runs on or the scheduled
  briefing trigger (→ **C5**), the **Insight Agent definition** + its read-all/no-writes memory scope (→ **C8**),
  the **coverage / Maturity / `[Building]` computation** (→ **C2**, ADR-002), the **notification delivery** of a
  surfaced suggestion (→ **C7** notification centre), or the **rendering** of any surface — suggestion cards,
  briefing panel, initialisation-progress indicator, the `/` command menu (→ **Phase 3**). C9 **produces the
  proactive item + assigns its mode + gates the proactive engine on cold-start phase**; the home components
  enforce, schedule, deliver, and render. Mirrors C8's "produce signals, others act," C6's "seam, don't absorb,"
  and C7's "backbone now, surfaces → Phase 3."

> **Verification gate (2 zero-context subagents, 2026-06-27):**
> - **Orphan/contradiction pass — CLEAN.** Every design intent L3650–3918 maps to an FR, a correct seam, or an OOS
>   (founder checklist/init guide → OOS-031/032; the 8 founder-holiday break-points → existing C2/C4/C5/C6/C7/C8/C9,
>   no orphan). **All 6 traps PASS** (no "Agency Owner" role — node-based gating · consumes C2 coverage, never
>   recomputes · proactive Act never bypasses C6 · the OD-088 floored set can't be lowered to Act/Prepare · Insight
>   Agent not redefined / no second writer · 14/14 citations verified). No `client_slug`. Two editorial nits fixed
>   (stale FR count; a MAT.002/003 citation precision).
> - **Quality/failure pass — critical check NO HOLE + 9 findings (2 HIGH, 4 MED, 3 LOW), ALL reconciled in-file.**
>   **Critical check (operator-requested):** nothing **financial / existing-client / system-of-record /
>   Confidential / Restricted** can reach autonomous **Act** through the new FR-9.MODE.004 matrix — defended in depth
>   (write-time reject AC-9.MODE.004.2 → mode-assignment AC-9.MODE.002.2 → C6 tier floor AC-6.APR.002.1/.3 →
>   ambiguity-defaults-to-floored AC-9.MODE.004.3 → the non-overridable hard-limit backstop), and the OD-056
>   irreversibility exception is consciously bounded to non-client low-risk + rate-capped. **H1** (the residual the
>   floor-narrowing introduced): a *confident-but-wrong* client/content tag is the one unguarded route in →
>   **+AC-9.MODE.004.5** (re-resolve recipient client-status against the system-of-record **at send time**, re-floor
>   on match) + **AF-131** (classification-accuracy EVAL). **H2** Insight-detected escalating risks have no C6/C7
>   path → sharpened **AC-9.CST.002.3** + **+AC-9.PRO.004.4** (the OD-084 floor spans dismissal **and** cold-start
>   suppression **and** scanner-disable). **M1** deferred floor item could silently expire → +AC-9.SUG.002.3. **M2**
>   stuck-`generated` suggestion → +AC-9.SUG.001.4 (escalate-don't-abandon). **M3** node-gate-before-confirm +
>   `/forget`→C2 trace → +AC-9.CMD.003.3. **M4** floored-caps-mode precedence → +AC-9.MODE.004.6. **L1** scan-
>   execution (not just process) liveness → AC-9.PRO.004.3. **L2** stale-phase fail-open → AC-9.CST.001.2 freshness.
>   **L3** audit-critical command fail-closed on log failure → +AC-9.CMD.004.3.

- **What C9 is:** the answer to "*what does the system do without being asked*" (L3654). Three **proactivity
  modes** (Suggest / Prepare / Act, L3661–3666) assigned by risk; seven **proactive work generators** (relationship
  management, meeting prep, document prep, derisking, opportunity spotting, priority surfacing / daily briefing,
  pattern recognition, L3672–3684) that each emit a proactive item; the **suggestion lifecycle** — persist, rank by
  urgency, explain (reasoning + answer-mode pill), deliver-route by risk type, and **learn from dismissals**
  (L3688–3697); the **cold-start gating policy** — the four coverage phases that decide when proactivity, external
  writes, and full-frequency loops turn on (L3700–3788); and the `/` **command system** — dispatch + per-command
  permission-node gating + destructive-confirm + event-logging (L3868–3915).
- **What C9 is NOT (seams):**
  - **Enforcement of any proactive action** — approval tiers, the mandatory hard-approval set, hard limits, anomaly
    checks, injection sanitization → **C6** (FR-6.APR.*, FR-6.HRD.*, FR-6.ANM.*, FR-6.INJ.*). "All proactive actions
    follow the same guardrails as reactive ones" (L3666). C9 assigns the **mode**; C6 enforces the **gate**.
  - The **slow loop** the Insight Agent runs on (FR-5.LOP.001) and the **scheduled trigger** that fires the daily
    briefing (FR-5.TRG.*) → **C5**. C9 owns the briefing/insight *content generation*; C5 owns *when it runs*.
  - The **Insight Agent definition** + its `read all memory, no writes` scope (L3439, L3475) → **C8** (FR-8.SPC.006,
    FR-8.SCO.*). C9 consumes the Insight Agent's output; it does not define the agent.
  - **Coverage / Maturity / `[Building]` computation** → **C2** (FR-2.MAT.002 emits the cold-start phase + per-entity
    Maturity; FR-2.RET.007 emits the `[Building]` flag), ADR-002. C9 **consumes** the phase to gate the proactive
    engine; it does not recompute coverage.
  - **Notification delivery** of a surfaced suggestion (dashboard alert / chat / mobile push) → **C7** (the
    notification centre, FR-7.ALR.*). C9 produces the item + its routing-by-risk-type; C7 delivers.
  - **Rendering** of every surface — suggestion cards, the daily-briefing panel, the initialisation-progress
    indicator, the cold-start banner, the `/` command menu + mobile quick-tap buttons → **Phase 3**. C9 owns the
    *content + state contract*; Phase 3 renders.
  - **Memory writes** — proactive scanning never writes memory directly (Insight Agent is read-only, L3475); a
    proactive item is a C9 suggestion record, and any memory write goes through the **Memory Agent sole-writer** path
    (→ **C2**, ADR-004). **RBAC / clearance** → **C1**; **tool execution** (sending a drafted email, posting a brief)
    → **C3**; **prompt content + the answer-mode pill definition** → **C4**.
- **Design-doc source:** `## 9. Proactive Intelligence` = **L3650–L3918** (next `## 10. Infrastructure &
  Compliance` at L3919). Load-bearing blocks: core idea **L3652–3654**, the three modes **L3658–3666**, the seven
  generators **L3670–3684**, how-it-feels **L3688–3697**, cold start **L3700–3788** (progress indicator L3704–3723,
  the phase behaviour matrix L3725–3768, thresholds L3770–3778, per-entity L3780–3782, verification-pass priority
  L3784–3788), the founder-holiday problem **L3792–3864**, UI chat commands **L3868–3915**. Cross-cut sites: the C9
  **checklist** overview **L339–350**, the `cold_start` config block **L930–934** + labelled thresholds L3773–3776,
  the **mobile push** config **L1026–1030**, the **Insight Agent** definition **L3439** + its memory scope **L3475**,
  the **slow loop** **L2570–2572 / L3359**, the **answer-mode pill / `[Building]`** sites **L1772 / L3741–3759 /
  L3782**, the **approval tiers** **L2774–2785**, the **chat-interface / `/` command** mentions **L3261 / L3274**.

---

## Context manifest (load only these)

- **ADR-002 (Maturity / Retrieval Sufficiency)** — the single source of the coverage metric. **Maturity** (filled
  slots / expected slots per entity, daily + on-write) **drives cold-start gating (20/50/80)**; **Retrieval
  Sufficiency** drives the `[Building]` flag. C9 **consumes** the phase + the flag; it never recomputes them.
- **ADR-007 (injection posture — containment-first)** — proactive items built from memory + live tool data are
  subject to the same boundary-tagging + sanitization as reactive; a proactive Act never bypasses the pipeline.
- **C2 FR-2.MAT.002** — Maturity recompute → emits the cold-start phase (`cold` / `basic` / `proactive` / `full`)
  per the 20/50/80 thresholds; Maturity is computed **per-entity, not global** (FR-2.MAT.002 stores per-entity; the
  low-Maturity flag is FR-2.MAT.003; per-entity coverage drives the Acme case L3780–3782).
- **C2 FR-2.RET.007** — answer modes (Cited / Inferred / Unknown) + the `[Building]` flag when retrieval is thin
  **and** the touched entities' Maturity is low. C9's cold-start `[Building]` framing is this flag, not a new one.
- **C5 FR-5.LOP.001** — the **slow loop** (daily/weekly) the Insight Agent + consolidation jobs run on. C5 also owns
  the scheduled-trigger model (FR-5.TRG.*) that fires the daily briefing and reduces loop frequency in cold start.
- **C6 FR-6.APR.001/002/003** — the three approval tiers (auto-approve / soft / hard), the mandatory hard set
  (external-communication, financial, Restricted-memory), and soft-approval-is-reversible-only. C9's three modes map
  onto these tiers; **C6 enforces**.
- **C8 FR-8.SPC.006** — the **Insight Agent** (runs on the slow loop, reads all memory, no writes, feeds the
  proactive layer + the self-improvement panel). C8 produces the agent-health / drift / routing metrics; **C9 turns
  the Insight Agent output + those metrics into surfaced/guided suggestions**.
- **C7 FR-7.ALR.*** — the notification centre that **delivers** a surfaced suggestion (dashboard / chat / push) and
  the `event_log` every `/` command is written to. **C1** — the permission-node model the `/` commands gate on (the
  six roles: Super Admin, Admin, Finance, HR, Account Manager, Standard User — there is **no "Agency Owner" role**).

---

## Open decisions (all RESOLVED 2026-06-27 — OD-082…087 delegated to recommendation; OD-088 operator-decided)

| OD | Question | Touches | Resolution |
|---|---|---|---|
| **OD-082** 🟢 | **Proactive-item persistence** — `task_queue` (C5) or a dedicated C9 store? | #3, data-model | **(a)** A dedicated `proactive_suggestions` store, C9-owned, state-tracked (`generated → surfaced → acted / dismissed / expired / superseded`); a **Prepare-mode** item spawns a linked C5 `task_queue` task. Keeps "what was surfaced + what the human did" distinct from the execution record. → FR-9.SUG.001. |
| **OD-083** 🟢 | **Mode-assignment + no-bypass** — does a proactive Act bypass the reactive guardrails? | **#2** | **(a)** C9 **maps** mode from C6's risk/tier (FR-6.APR.001); **every proactive action — including Act — traverses the identical C6 pipeline**. Proactivity changes *who initiates*, never *what's allowed*; no second risk classifier. → FR-9.MODE.002/003. |
| **OD-084** 🟢 | **Dismissal-learning floor** — learn-down without going silent on a real escalating risk? | **#1 / #3** | **(a)** Dismissal down-weights that signal type *for that context* (volume), but a **derisking/hard-risk** signal is never suppressed below a floor and **re-surfaces** when its underlying metric escalates. Learning tunes *volume*, never *safety*. → FR-9.SUG.005, AC-9.PRO.004.2. |
| **OD-085** 🟢 | **Cold-start ownership** — who owns the phase behaviour matrix? | **#2 / #3**, scope | **(a)** **C2 emits the phase** (FR-2.MAT.002, per-entity); **C9 owns the policy matrix + proactive-suppression**; enforcement of the rest seamed (external-write → C6/C3/C5, loop freq → C5, `[Building]` → C2, banner/progress → Phase 3). C9 assigns; owners enforce. → FR-9.CST.*. |
| **OD-086** 🟢 | **`/` command gating** — the design's table uses **"Agency Owner,"** not one of C1's six roles. | **#2**, RBAC reconciliation (**contradiction trap caught**) | **(a)** Gate each command on a **C1 permission node**, not a hardcoded role ladder; the four-tier table becomes the **default node assignment**. "Agency Owner" dissolves into "whoever holds the node" (ADR-006 permissions-in-data). → FR-9.CMD.002. |
| **OD-087** 🟢 | **Founder-resilience + init guide** — FRs or out-of-scope? | scope | **(a)** **OOS** — both are operational/onboarding documents; the readiness they check is covered by existing FRs. → OOS-031 / OOS-032; the eight break-points map to existing components (integration narrative, **no orphan**). |
| **OD-088** 🟢 | **Configurable action-risk/autonomy matrix** — "all external comms = hard" (C6 FR-6.APR.002) is too blunt; a cold-lead nurture email is low-risk but can't even be drafted. | **#2** (operator-decided → **option b**) | **(b)** Split "external comms" into sub-types: **low-risk external** (cold-lead / templated nurture to **non-client** contacts) → configurable down to **Prepare** or up to **Act** after a trust period (rate-capped, audited); **floored** (existing-client / system-of-record comms, financial, Confidential/Restricted) → fixed at hard-approval, **never** configurable below. **Amends C6 FR-6.APR.002 + FR-6.APR.003 via change-control** (narrow the mandatory-hard "external" element; low-risk external rides FR-6.APR.005); adds **FR-9.MODE.004** (the matrix + floor; `CFG-action_autonomy_matrix`; `PERM-guardrail.edit_autonomy` Super-Admin; UI → Phase 3). The Act-tier low-risk-external send is the **one bounded, opt-in, trust-gated, rate-capped** exception to OD-056's no-irreversible-auto default — **surfaced, not hidden** (gate must confirm no floored sub-type can reach Act). |

> **Gate focus (operator-requested):** confirm the C6 floor-narrowing opened **no hole** — that nothing **financial,
> existing-client / system-of-record, or Confidential/Restricted** can reach Act through the new matrix, and that the
> OD-056 irreversibility interaction is bounded to the non-client low-risk sub-type only.

---

## Functional requirements

### MODE — the three proactivity modes

#### FR-9.MODE.001 — Three proactivity modes
- **Statement:** The system shall classify every proactive item into exactly one of three modes — **Suggest**
  (surface insight/recommendation, human decides), **Prepare** (do work in advance, human reviews and approves), or
  **Act** (execute autonomously within defined limits).
- **Source:** design-doc-v4.md L3658–3666, L343 (checklist)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** The proactive engine, when a generator (PRO.*) emits an item.
- **Preconditions:** Item generated; its target action (if any) is known.
- **Behaviour:**
  - Happy path: each item is stamped with exactly one mode before it is persisted (SUG.001).
  - Branches: a pure-insight item with no action (e.g. a pattern observation) defaults to **Suggest**.
  - Edge / failure: an item whose mode cannot be determined is treated as **Suggest** (the most conservative —
    human decides), never silently auto-Acted.
- **Data touched:** `proactive_suggestions` (write — `mode`).
- **Permissions:** N/A (engine).
- **Config dependencies:** —
- **Surfaces:** mode shown on the suggestion card (Phase 3).
- **Acceptance criteria:**
  - AC-9.MODE.001.1 — Given a generated proactive item, When persisted, Then exactly one mode ∈ {Suggest, Prepare,
    Act} is recorded.
  - AC-9.MODE.001.2 — Given an item whose mode is indeterminate, When classified, Then it defaults to **Suggest**,
    never Act.
- **Open decisions:** OD-082 (the store).
- **Feasibility assumptions:** —

#### FR-9.MODE.002 — Mode assigned from risk / approval tier
- **Statement:** The system shall assign the proactivity mode from the action's **risk level and approval tier as
  classified by C6** (FR-6.APR.001) — **high risk → Suggest**, **low risk → Act**, **medium risk → Prepare and queue
  for approval** — and shall not maintain a second, independent risk classifier.
- **Source:** L3666 ("Mode determined by risk level and approval tier. High risk always Suggest. Low risk can Act.
  Medium risk Prepare and queue for approval."); C6 FR-6.APR.001
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** The proactive engine, at mode assignment.
- **Preconditions:** The item's target action has a C6 tier (auto-approve / soft / hard).
- **Behaviour:**
  - Happy path: C6 tier `auto-approve` → **Act**; `soft` → **Prepare** (do the work, queue for the soft window);
    `hard` → **Suggest** or **Prepare**-to-hard-queue (work prepared but blocked on explicit human approval).
  - Branches: an action in C6's **floored hard set** (FR-6.APR.002 as amended by OD-088 — **existing-client /
    system-of-record external comms**, financial operations, Confidential/Restricted memory) is **never Act** — at
    most Prepare-to-hard-queue. **Low-risk external** (cold-lead / non-client templated nurture) is **not** floored:
    its tier comes from the action-autonomy matrix (FR-9.MODE.004), configurable down to Prepare / up to Act.
  - Edge / failure: C6 tier unavailable → default **Suggest** (MODE.001 conservative default).
- **Data touched:** `proactive_suggestions` (write).
- **Permissions:** N/A.
- **Config dependencies:** the C6 tier mapping (FR-6.APR.001).
- **Surfaces:** —
- **Acceptance criteria:**
  - AC-9.MODE.002.1 — Given a low-risk (auto-approve) action, When mode-assigned, Then it is **Act**; given a
    high-risk (hard-approval) action, Then it is **Suggest** or Prepare-to-hard-queue — never Act.
  - AC-9.MODE.002.2 — Given an action in C6's **floored** hard set (FR-6.APR.002 as amended by OD-088 —
    existing-client/system-of-record external comms, financial, Confidential/Restricted), When mode-assigned, Then
    it is never assigned **Act** (verified against FR-6.APR.002 + the FR-9.MODE.004 floor).
- **Open decisions:** OD-083, OD-088.
- **Feasibility assumptions:** —

#### FR-9.MODE.003 — Proactive actions traverse the same guardrails as reactive
- **Statement:** The system shall route every proactive action — **including Act-mode** — through the identical C6
  guardrail pipeline that governs reactive actions (approval tier, hard limits, anomaly detection, injection
  sanitization); proactivity changes *who initiates* an action, never *what is permitted*.
- **Source:** L3666 ("All proactive actions follow the same guardrails as reactive ones"); C6 (FR-6.APR/HRD/ANM/INJ)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** The harness, when a proactive Act/Prepare item produces a tool call.
- **Preconditions:** Item in Act or Prepare mode with a concrete action.
- **Behaviour:**
  - Happy path: an Act-mode item's tool call enters the C6 pipeline exactly as a human-initiated one would; a hard
    limit blocks it; an approval gate holds it; injection sanitization applies to its memory/tool inputs.
  - Branches: an Act-mode item that hits a hard limit is blocked + logged + surfaced (it does **not** silently
    proceed because it was "low risk proactive").
  - Edge / failure: if the guardrail check itself errors, the proactive action **fails closed** (C6 FR-6.FMM.001).
- **Data touched:** `guardrail_log` (via C6), `event_log`.
- **Permissions:** enforced by C6 / C1 on the action, not relaxed for proactivity.
- **Config dependencies:** —
- **Surfaces:** blocked/held proactive actions appear in the same approval/flagged queues as reactive (C6/C7).
- **Acceptance criteria:**
  - AC-9.MODE.003.1 — Given a proactive Act-mode tool call, When executed, Then it passes through the same C6
    pipeline as a reactive call (verified: no proactive bypass path exists).
  - AC-9.MODE.003.2 — Given a proactive action that hits a hard limit or fails the guardrail check, When evaluated,
    Then it is blocked and logged — never auto-executed on the basis of being proactive.
- **Open decisions:** OD-083.
- **Feasibility assumptions:** AF-068 (hard-limit containment, carry-in).

#### FR-9.MODE.004 — Configurable action-autonomy matrix (with a non-negotiable floor)
- **Statement:** The system shall provide an **operator-configurable action-autonomy matrix** that maps an action's
  **risk sub-type** to its permitted maximum proactivity mode (Suggest / Prepare / Act), with a **non-negotiable
  floor**: **low-risk external** communication (cold-lead / templated nurture to **non-client contacts**) is
  configurable **down to Prepare or up to Act after a trust period**; **everything in the floored set —
  existing-client / system-of-record external comms, any financial operation, any Confidential/Restricted data
  action — is fixed at hard-approval and the matrix cannot lower it to Act or Prepare**. Act for a low-risk external
  send is a conscious, **opt-in, trust-gated, rate-capped** autonomy grant (bounded by C6 `max external comms/hour`,
  FR-6.RTL.001), and is the **only** exception to the no-irreversible-auto-execute default (OD-056), confined to the
  non-client low-risk sub-type.
- **Source:** OD-088 (operator-decided #2); amends C6 FR-6.APR.002 / FR-6.APR.003 via change-control; rides
  contextual routing FR-6.APR.005; bounded by FR-6.RTL.001.
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** A Super Admin editing the matrix; the engine reading it at mode assignment (MODE.002).
- **Preconditions:** Each action carries a risk sub-type (floored vs low-risk-external) resolved from C6 + C1 tags
  (recipient = client/non-client; content = financial / Confidential / Restricted?).
- **Behaviour:**
  - Happy path: a low-risk external nurture action → matrix permits Prepare by default; after the operator opts in +
    the trust period elapses, it may be configured to Act (still rate-capped + audited).
  - Branches: any attempt to configure a floored sub-type (client/SoR comms, financial, Confidential/Restricted)
    below hard is **rejected at write** — the floor is enforced before the config commits (mirrors C4 principles
    hard-floor + C6 AC-6.APR.002.1).
  - Edge / failure: sub-type ambiguous (can't prove the recipient is a non-client) → treat as **floored**
    (conservative — defaults to hard, never to Act).
- **Data touched:** `CFG-action_autonomy_matrix` (config, write — Super Admin); risk sub-type (read, C6/C1).
- **Permissions:** `PERM-guardrail.edit_autonomy` (Super Admin only).
- **Config dependencies:** CFG-action_autonomy_matrix, CFG-external_act_trust_period (Phase 2); bounded by
  FR-6.RTL.001 caps.
- **Surfaces:** the autonomy-matrix editor (Phase 3).
- **Acceptance criteria:**
  - AC-9.MODE.004.1 — Given a Super Admin sets a low-risk external sub-type to Act after the trust period, When
    saved, Then nurture sends to non-client contacts may auto-execute, rate-capped (FR-6.RTL.001) and audited.
  - AC-9.MODE.004.2 — Given any attempt to set a **floored** sub-type (existing-client/SoR comms, financial,
    Confidential/Restricted) below hard-approval, When saved, Then it is **rejected at write** — the floor holds.
  - AC-9.MODE.004.3 — Given an action whose sub-type cannot be proven non-client/low-risk, When mode-assigned, Then
    it is treated as floored (hard), never Act.
  - AC-9.MODE.004.4 — Given a matrix edit, When attempted by a non-Super-Admin, Then it is denied
    (`PERM-guardrail.edit_autonomy` is Super-Admin-only) and logged.
  - AC-9.MODE.004.5 — *(gate H1 — the confident-but-wrong tag)* Given an Act-tier low-risk external send, When it
    is about to execute, Then the recipient's client/non-client status is **re-resolved against the system of record
    at send time** (not only at matrix-config or generation time); if the recipient matches **any** existing-client
    / system-of-record record, or the content resolves financial / Confidential / Restricted, the send is
    **re-floored to hard-approval** and not auto-executed. The floor is defended *upstream of the tag*, not only by
    the tag.
  - AC-9.MODE.004.6 — *(gate M4 — precedence)* Given an action whose risk sub-type resolves to **floored**, When the
    mode is assigned, Then the floor caps the mode at hard-approval **regardless** of what the autonomy matrix or the
    FR-9.MODE.001 indeterminate-default ("Suggest") would otherwise assign — the floor always wins.
- **Open decisions:** OD-088.
- **Feasibility assumptions:** AF-068 (containment of the floored set under the new matrix); **AF-131** (accuracy of
  the non-client / content-sensitivity classification the floor rests on).

### PRO — the seven proactive generators

> **Scanner configuration (applies to PRO.001–007).** Each of the seven proactive scanners is **independently
> enable/disable-able per deployment** (all **on by default**) and its detection thresholds are **configurable**.
> A disabled scanner produces **no** items — silently, by operator choice — but disabling a scanner never disables
> the underlying **safety** path (a hard-limit/guardrail event is still a C6/C7 alert; disabling the *derisking
> scanner's proactive surfacing* does not suppress a C6 hard-limit alert, consistent with CST.002). The per-scanner
> `CFG-scanner_*_enabled` (default `true`) + threshold keys are captured on each FR below for the **Phase-2** config
> registry. Each governs only its own scanner; the global cold-start gate (CST) still applies on top.

#### FR-9.PRO.001 — Relationship management
- **Statement:** The system shall proactively surface clients not contacted recently, flag sentiment drops and
  relationship-health signals, suggest check-in outreach **with prepared drafts**, and remind the team of renewals
  and milestones.
- **Source:** L3672
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Client/Insight agents on the slow loop (C5 FR-5.LOP.001).
- **Preconditions:** Coverage ≥ proactive threshold (CST.002); relationship data in memory (C2) + live (C3).
- **Behaviour:**
  - Happy path: detect not-contacted-recently / sentiment drop / approaching renewal → emit a proactive item with a
    suggested action and (for outreach) a prepared draft → mode-assign (MODE.002) → persist (SUG.001).
  - Branches: a drafted client send is an external communication → C6 mandatory hard set → **Prepare-to-hard-queue**.
  - Edge / failure: sentiment classification uncertain → item carries a confidence/answer-mode pill (SUG.003).
- **Data touched:** `proactive_suggestions` (write); memory (read, C2); connectors (read, C3).
- **Permissions:** read per C1 clearance + per-agent scope (C8 SCO).
- **Config dependencies:** CFG-scanner_relationship_enabled (default true), CFG-not_contacted_window,
  CFG-renewal_lookahead_days (Phase 2).
- **Surfaces:** suggestion card + relationship-health panel (Phase 3).
- **Acceptance criteria:**
  - AC-9.PRO.001.1 — Given a client not contacted within the configured window, When the loop runs, Then a check-in
    suggestion with a prepared draft is generated.
  - AC-9.PRO.001.2 — Given a prepared client outreach draft, When mode-assigned, Then it routes to hard-approval
    (external communication, FR-6.APR.002) — never auto-sent.
- **Open decisions:** OD-084 (dismissal-learning on relationship signals).
- **Feasibility assumptions:** AF-127 (sentiment/relationship-signal detection accuracy).

#### FR-9.PRO.002 — Meeting preparation
- **Statement:** The system shall detect upcoming meetings from calendar triggers, automatically prepare briefs
  (retrieved memories, recent interactions, talking points), draft pre-meeting summaries for client send (routed to
  the approval queue), and post briefs to the dashboard before meetings start.
- **Source:** L3674
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Calendar trigger (C3 → C5 event→task) → meeting-prep generation.
- **Preconditions:** Calendar connector active (C3); coverage ≥ proactive threshold.
- **Behaviour:**
  - Happy path: calendar event detected → retrieve memories + recent interactions for the attendees/entity →
    assemble brief + talking points → post to dashboard before start; any client-send summary → approval queue.
  - Branches: a brief whose entity coverage is thin → carries the `[Building]` pill (CST.004).
  - Edge / failure: calendar trigger missed (C3 watch expiry, FR-3.TRIG.005) → no brief; the gap surfaces via C3's
    degraded-ingest path, not silently.
- **Data touched:** `proactive_suggestions` (write); memory (read); calendar (read, C3).
- **Permissions:** read per clearance/scope.
- **Config dependencies:** CFG-scanner_meeting_prep_enabled (default true), CFG-meeting_prep_lead_time (Phase 2).
- **Surfaces:** brief on the dashboard (Phase 3); client-send summary in the approval queue (C5/C6).
- **Acceptance criteria:**
  - AC-9.PRO.002.1 — Given a detected upcoming meeting, When prep runs, Then a brief is posted to the dashboard
    before the meeting start time.
  - AC-9.PRO.002.2 — Given a drafted pre-meeting client summary, When generated, Then it routes to the approval
    queue (never auto-sent).
- **Open decisions:** —
- **Feasibility assumptions:** AF-129 (brief relevance / talking-point quality).

#### FR-9.PRO.003 — Document preparation
- **Statement:** The system shall detect when a proposal or brief is likely needed, prepare a draft from memory and
  templates, and route it to the approval queue.
- **Source:** L3676
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** Slow loop / signal-driven generation.
- **Preconditions:** Templates available; coverage ≥ proactive threshold.
- **Behaviour:**
  - Happy path: detect likely-needed document → assemble draft from memory + template → **Prepare** → approval queue.
  - Branches: thin coverage on the subject entity → `[Building]` pill on the draft.
  - Edge / failure: no suitable template → fall back to a memory-only draft, flagged as such.
- **Data touched:** `proactive_suggestions` (write); memory (read); templates (read).
- **Permissions:** read per clearance/scope.
- **Config dependencies:** CFG-scanner_document_prep_enabled (default true) (Phase 2).
- **Surfaces:** prepared draft in the approval queue (Phase 3).
- **Acceptance criteria:**
  - AC-9.PRO.003.1 — Given a detected document need, When prep runs, Then a draft is prepared and routed to the
    approval queue in **Prepare** mode.
  - AC-9.PRO.003.2 — Given no matching template, When the draft is prepared, Then it is produced from memory and
    flagged template-less, never silently skipped.
- **Open decisions:** —
- **Feasibility assumptions:** AF-129.

#### FR-9.PRO.004 — Derisking (continuous risk scan)
- **Statement:** The system shall, via the Insight Agent, continuously scan for risk signals — client sentiment
  dropping, payment overdue, campaign underperforming, capacity stretched, contract approaching renewal without
  discussion — and surface each risk **with a suggested action, routed to the right person by risk type**.
- **Source:** L3678
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Insight Agent on the slow loop (C8 FR-8.SPC.006 / C5 FR-5.LOP.001).
- **Preconditions:** Memory + live data available; (derisking is **not** suppressed by dismissal — OD-084).
- **Behaviour:**
  - Happy path: detect a risk signal → generate a risk item with reasoning + suggested action → route to the
    risk-type owner (SUG.004) → persist.
  - Branches: an escalating risk previously dismissed **re-surfaces** (OD-084 floor).
  - Edge / failure: the Insight Agent run stalls → the producer-liveness heartbeat flags it (mirrors C8
    AC-8.HLTH.004.2 / C5 AC-5.JOB.006.2) — the risk scan never goes silently dark.
- **Data touched:** `proactive_suggestions` (write); memory (read-all, Insight scope); connectors (read).
- **Permissions:** Insight Agent read-all, no writes (C8 SCO).
- **Config dependencies:** CFG-scanner_derisking_enabled (default true; disabling stops proactive *surfacing*, not
  the C6/C7 safety alert path), CFG-risk_thresholds (Phase 2).
- **Surfaces:** risk cards routed by type (Phase 3); delivery via C7.
- **Acceptance criteria:**
  - AC-9.PRO.004.1 — Given a detected risk signal, When surfaced, Then it carries a suggested action and is routed
    to the configured owner for that risk type.
  - AC-9.PRO.004.2 — Given a risk signal whose underlying metric worsens past threshold, When re-evaluated, Then it
    re-surfaces even if previously dismissed (OD-084).
  - AC-9.PRO.004.3 — *(gate L1 — scan-execution, not just process)* Given the Insight Agent risk **scan** stalls or
    silently no-ops (e.g. empty read scope, threshold misconfig) — distinct from the agent *process* being alive —
    When liveness is checked, Then a heartbeat-absence flag is raised on the **scan's own execution** (not merely the
    loop), so a live-but-unproductive scan is caught — the scan never fails silently.
  - AC-9.PRO.004.4 — *(gate H2 — the floor spans all three axes)* Given a derisking risk **at the OD-084 escalation
    floor** (metric past threshold), When it is evaluated, Then it is delivered **regardless of** (i) prior dismissal
    (SUG.005), (ii) cold-start proactive suppression (CST.002), or (iii) the derisking scanner being disabled — the
    OD-084 floor caps *all three* suppression axes, not only dismissal. Disabling the derisking scanner suppresses
    *advisory* surfacing only and is itself logged as a deliberate operator action, never a silent gap.
- **Open decisions:** OD-084.
- **Feasibility assumptions:** AF-127 (risk-signal detection accuracy), AF-128 (dismissal-learning never suppresses a
  true escalating risk).

#### FR-9.PRO.005 — Opportunity spotting
- **Statement:** The system shall scan for positive signals — client growing, new-service fit, referral opportunity,
  market signal relevant to a client — and surface each with reasoning and a suggested action.
- **Source:** L3680
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** Insight Agent on the slow loop.
- **Preconditions:** Coverage ≥ proactive threshold.
- **Behaviour:**
  - Happy path: detect positive signal → generate item with reasoning + suggested action → persist → rank (SUG.002).
  - Branches: low-confidence opportunity → lower rank, carries pill.
  - Edge / failure: as PRO.004 (producer-liveness).
- **Data touched:** `proactive_suggestions` (write); memory (read).
- **Permissions:** Insight read-all.
- **Config dependencies:** CFG-scanner_opportunity_enabled (default true), CFG-opportunity_thresholds (Phase 2).
- **Surfaces:** opportunity cards (Phase 3).
- **Acceptance criteria:**
  - AC-9.PRO.005.1 — Given a detected positive signal, When surfaced, Then it carries reasoning and a suggested
    action.
- **Open decisions:** —
- **Feasibility assumptions:** AF-127.

#### FR-9.PRO.006 — Priority surfacing / daily briefing
- **Statement:** The system shall generate a **daily morning briefing** — what's due today, what's at risk, what
  needs attention, and what the AI did overnight — to keep the team oriented without the founder directing them.
- **Source:** L3682, L348 (checklist)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Scheduled trigger (C5 FR-5.TRG.*) fires the briefing generation.
- **Preconditions:** Coverage ≥ proactive threshold (suppressed in cold start, CST.002).
- **Behaviour:**
  - Happy path: at the configured time, assemble due-today (C5 task_queue) + at-risk (PRO.004) + needs-attention +
    overnight-activity (C7 event_log / C5 task_queue) → produce the briefing → deliver (SUG.004).
  - Branches: nothing notable → a minimal "all quiet" briefing, not silence (the team still gets oriented).
  - Edge / failure: a source subsystem unavailable → the briefing is produced with the missing section flagged, not
    omitted silently.
- **Data touched:** `proactive_suggestions` (write); task_queue + event_log (read).
- **Permissions:** briefing content respects each recipient's clearance (C1) on a per-recipient basis.
- **Config dependencies:** CFG-scanner_briefing_enabled (default true), CFG-briefing_schedule (L930–934 / Phase 2).
- **Surfaces:** the briefing panel (Phase 3); delivery via C7 (incl. mobile push).
- **Acceptance criteria:**
  - AC-9.PRO.006.1 — Given the configured briefing time, When the trigger fires, Then a briefing covering due-today /
    at-risk / needs-attention / overnight-activity is produced.
  - AC-9.PRO.006.2 — Given a briefing source subsystem is unavailable, When the briefing is assembled, Then the
    affected section is flagged present-but-degraded, not silently dropped.
  - AC-9.PRO.006.3 — Given a recipient, When the briefing is delivered, Then its content is filtered to that
    recipient's clearance (no above-clearance leakage).
- **Open decisions:** —
- **Feasibility assumptions:** AF-129 (briefing relevance).

#### FR-9.PRO.007 — Pattern recognition
- **Statement:** The system shall, via the Insight Agent, look across all memory and activity for patterns humans
  would not notice (e.g. "this campaign type has underperformed three times", "this client always delays payment in
  Q4", "team capacity drops every August") and surface them as insights.
- **Source:** L3684
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** Insight Agent on the slow loop.
- **Preconditions:** Sufficient memory + activity history.
- **Behaviour:**
  - Happy path: detect a cross-entity / temporal pattern → generate an insight item with the supporting evidence →
    persist → surface.
  - Branches: a pattern that implies a risk routes through PRO.004's risk-owner routing.
  - Edge / failure: spurious-pattern guard — an insight carries its evidence + answer-mode pill so a human can judge.
- **Data touched:** `proactive_suggestions` (write); memory + activity (read-all, Insight scope).
- **Permissions:** Insight read-all, no writes.
- **Config dependencies:** CFG-scanner_pattern_enabled (default true) (Phase 2).
- **Surfaces:** insight cards on the dashboard (Phase 3).
- **Acceptance criteria:**
  - AC-9.PRO.007.1 — Given a cross-memory pattern, When surfaced, Then the insight includes the supporting evidence
    and an answer-mode pill.
- **Open decisions:** —
- **Feasibility assumptions:** AF-127 (pattern-detection precision / false-positive rate).

### SUG — suggestion lifecycle, ranking, explanation, delivery, learning

#### FR-9.SUG.001 — Proactive-item persistence + lifecycle
- **Statement:** The system shall persist every generated proactive item in a dedicated store with an explicit
  lifecycle state (`generated → surfaced → acted / dismissed / expired / superseded`); a generated item is never
  silently dropped, and a **Prepare**-mode item that does work in advance spawns a linked C5 `task_queue` task for
  the prepared work.
- **Source:** L3694–3697 (dismissed suggestions learned from — implies persistence), L3676 (route to approval queue);
  OD-082
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** The proactive engine on generation; the user on act/dismiss.
- **Preconditions:** Item generated + mode-assigned.
- **Behaviour:**
  - Happy path: generate → persist (`generated`) → deliver (`surfaced`) → user acts (`acted`) or dismisses
    (`dismissed`); unviewed past a TTL → `expired`; a newer item on the same signal → `superseded`.
  - Branches: a **Prepare** item creates a linked C5 task for the actual work; the suggestion tracks the work's
    outcome.
  - Edge / failure: a delivery failure leaves the item `generated` (not lost) and retried/escalated via C7, never
    marked `surfaced` until delivery is confirmed.
- **Data touched:** `proactive_suggestions` (write); `task_queue` (write, for Prepare links).
- **Permissions:** N/A (engine).
- **Config dependencies:** CFG-suggestion_ttl_days (Phase 2).
- **Surfaces:** the suggestion/insight feed (Phase 3).
- **Acceptance criteria:**
  - AC-9.SUG.001.1 — Given a generated proactive item, When persisted, Then it has exactly one lifecycle state and is
    never dropped without reaching a terminal state (`acted` / `dismissed` / `expired` / `superseded`).
  - AC-9.SUG.001.2 — Given a Prepare-mode item, When work is done in advance, Then a linked C5 task is created and the
    suggestion records its outcome.
  - AC-9.SUG.001.3 — Given a delivery failure, When the item is processed, Then it remains `generated` (not lost) and
    is retried/escalated — never silently marked surfaced.
  - AC-9.SUG.001.4 — *(gate M2 — no infinite stuck-generated)* Given an item stuck in `generated` past a
    delivery-escalation timeout (repeated C7 delivery failure), When the timeout elapses, Then it escalates to a
    default owner / Super Admin rather than sitting silently — reusing the standardized escalate-don't-abandon pattern
    (C1 OD-028 / C5 AC-5.QUE.005.2 / C6 FR-6.ESC.004). A suggestion never sits undelivered forever.
- **Open decisions:** OD-082.
- **Feasibility assumptions:** —

#### FR-9.SUG.002 — Ranking by urgency + relevance; configurable volume (anti-spam)
- **Statement:** The system shall rank surfaced suggestions by urgency and relevance and shall cap volume per a
  configurable limit so the system does not spam the user.
- **Source:** L3694 ("suggestions ranked by urgency and relevance. Volume configurable.")
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** The proactive engine before delivery.
- **Preconditions:** A set of `generated` items.
- **Behaviour:**
  - Happy path: score each item (urgency × relevance, adjusted by learned dismissal weight, SUG.005) → surface the
    top-N within the configured volume → defer the rest.
  - Branches: a deferred item that is **derisking** is never dropped below the risk floor (OD-084); it surfaces in a
    later cycle.
  - Edge / failure: if volume is exhausted by low-value items, higher-urgency items still pre-empt (urgency wins).
- **Data touched:** `proactive_suggestions` (read/write rank).
- **Permissions:** N/A.
- **Config dependencies:** CFG-suggestion_volume_limit (L3694 / Phase 2).
- **Surfaces:** ordered feed (Phase 3).
- **Acceptance criteria:**
  - AC-9.SUG.002.1 — Given more items than the volume cap, When ranked, Then the highest urgency×relevance items
    surface and the rest defer — no risk-floor item is silently dropped.
  - AC-9.SUG.002.2 — Given the volume cap is reconfigured, When the next cycle runs, Then the new cap takes effect
    with no code change.
  - AC-9.SUG.002.3 — *(gate M1 — a deferred floor item can't silently expire)* Given a derisking / floor-class item
    deferred by the volume cap, When its TTL would elapse (SUG.001 `expired`), Then it is **exempt from expiry while
    its underlying metric remains past the OD-084 threshold** — a floor item cannot transition to `expired`
    unsurfaced; only a genuine return-below-threshold (or human action) retires it.
- **Open decisions:** OD-084.
- **Feasibility assumptions:** AF-129 (ranking surfaces the genuinely important items).

#### FR-9.SUG.003 — Every suggestion explains itself (reasoning + answer-mode pill)
- **Statement:** The system shall attach to every proactive suggestion its **reasoning** and an **answer-mode pill**
  (Cited / Inferred / Unknown / Building), so the user always knows why it was surfaced.
- **Source:** L3692 ("every proactive suggestion shows reasoning and answer mode pill. You always know why."); C2
  FR-2.RET.007 (the pill), C4 (pill definition)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** The proactive engine on generation.
- **Preconditions:** The item's supporting memory/evidence is known.
- **Behaviour:**
  - Happy path: each item carries the reasoning + the provenance-derived pill (Cited when grounded in verified
    memory/live data; Inferred when reasoned; Building when thin-due-to-cold-start, CST.004).
  - Branches: an insight with weak grounding shows Inferred/Unknown, never presented as fact.
  - Edge / failure: missing provenance → the item cannot claim Cited; defaults to Inferred/Unknown.
- **Data touched:** `proactive_suggestions` (write — reasoning, pill).
- **Permissions:** N/A.
- **Config dependencies:** —
- **Surfaces:** reasoning + pill on the card (Phase 3).
- **Acceptance criteria:**
  - AC-9.SUG.003.1 — Given any surfaced suggestion, When displayed, Then it carries reasoning and exactly one
    answer-mode pill.
  - AC-9.SUG.003.2 — Given a suggestion without verified provenance, When the pill is assigned, Then it is not Cited
    (no inference-as-fact).
- **Open decisions:** —
- **Feasibility assumptions:** AF-033 (said-vs-did pill accuracy, carry-in).

#### FR-9.SUG.004 — Multi-surface delivery routing ("it follows you")
- **Statement:** The system shall route each surfaced suggestion to the right person — by risk type / ownership — and
  request delivery across the dashboard, chat interface, and mobile push, via the C7 notification centre.
- **Source:** L3690 ("suggestions appear in the dashboard, chat interface, and as push notifications on mobile"),
  L3678 ("routes to right person by risk type"); C7 FR-7.ALR.*
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** The proactive engine after ranking.
- **Preconditions:** Item ranked + recipient(s) determined.
- **Behaviour:**
  - Happy path: determine recipient(s) by risk-type/ownership → hand to C7 for delivery to dashboard + chat + push;
    record delivery state on the suggestion (SUG.001).
  - Branches: a recipient offline → C7's notification durability handles retry (FR-7.ALR.*); the item stays
    `generated` until delivery confirms.
  - Edge / failure: no eligible recipient → escalate to a default owner, never drop.
- **Data touched:** `proactive_suggestions` (write — recipient, delivery state); C7 notification.
- **Permissions:** recipient must hold clearance for the item's content (C1).
- **Config dependencies:** CFG-mobile push (L1026–1030).
- **Surfaces:** dashboard / chat / push (Phase 3 + C7).
- **Acceptance criteria:**
  - AC-9.SUG.004.1 — Given a ranked suggestion, When delivered, Then it is routed to the correct owner by type and
    handed to C7 for multi-surface delivery.
  - AC-9.SUG.004.2 — Given no eligible recipient, When routing runs, Then the item escalates to a default owner — it
    is never silently dropped.
- **Open decisions:** —
- **Feasibility assumptions:** —

#### FR-9.SUG.005 — Dismissal-learning with a safety floor ("it gets smarter")
- **Statement:** The system shall learn from user actions — acted-on suggestions reinforce that signal type,
  dismissed suggestions down-weight that signal type **for that entity/context** — **but shall never suppress a
  derisking / hard-risk signal below a floor, and shall re-surface any signal whose underlying metric escalates past
  threshold regardless of prior dismissal**.
- **Source:** L3696 ("suggestions acted on reinforce the signal. Dismissed suggestions reduce that signal type over
  time."); OD-084
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** The learning loop, on act/dismiss events.
- **Preconditions:** Suggestions reaching a terminal state (SUG.001).
- **Behaviour:**
  - Happy path: act → raise the weight for that signal type/context; dismiss → lower it (affects future ranking/
    volume, SUG.002).
  - Branches: the down-weight is bounded by a floor for derisking signal classes — they can be deprioritised, never
    silenced.
  - Edge / failure: an escalating metric re-surfaces the signal even if its learned weight is at the floor — the
    learning tunes *volume*, never *safety* (the #1/#3 invariant).
- **Data touched:** signal-weight store (write); `proactive_suggestions` (read terminal states).
- **Permissions:** N/A.
- **Config dependencies:** CFG-dismissal_decay, CFG-risk_floor (Phase 2).
- **Surfaces:** —
- **Acceptance criteria:**
  - AC-9.SUG.005.1 — Given repeated dismissals of a signal type, When ranked next, Then its volume/rank decreases for
    that context.
  - AC-9.SUG.005.2 — Given a derisking signal at its floor weight, When the underlying metric escalates past
    threshold, Then it re-surfaces regardless of prior dismissals.
  - AC-9.SUG.005.3 — Given any dismissal, When applied, Then it never drives a hard-risk signal class below the floor
    (verified: floor is enforced before the weight update commits).
- **Open decisions:** OD-084.
- **Feasibility assumptions:** AF-128 (learning never suppresses a true signal).

### CST — cold start

#### FR-9.CST.001 — Cold-start phase behaviour matrix
- **Statement:** The system shall define a cold-start policy matrix that **assigns**, for each coverage phase, the
  set of behaviours that apply — and shall consume the **phase emitted by C2** (FR-2.MAT.002), not recompute
  coverage. The matrix: **<20% (cold)** — proactive suppressed, loops reduced, every `[Unknown]` carries the
  cold-start note, agents read-only on external systems; **20–50% (basic)** — human-initiated tasks normal, loops at
  full frequency, proactive still suppressed, `[Building]` still appears; **50–80% (proactive)** — proactive
  unlocks; **>80% (full)** — all features, cold-start mode permanently deactivated for that deployment.
- **Source:** L3725–3768; C2 FR-2.MAT.002 (phase), ADR-002; OD-085
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** All proactive/loop/write subsystems read the matrix against the current phase.
- **Preconditions:** C2 emits the current phase per deployment (and per entity, CST.004).
- **Behaviour:**
  - Happy path: each subsystem consumes the phase + the matrix to gate its own behaviour (C9 enforces proactive
    suppression itself, CST.002; others enforce their assigned behaviour — see seams).
  - Branches: thresholds are configurable (CST.003); a lowered threshold unlocks behaviours earlier.
  - Edge / failure: phase signal unavailable → fail safe to the **most restrictive** phase (cold) until coverage is
    known — never default to full.
- **Data touched:** coverage phase (read, C2); the matrix (config).
- **Permissions:** N/A.
- **Config dependencies:** the three thresholds (CST.003).
- **Surfaces:** the cold-start banner + progress indicator (Phase 3).
- **Acceptance criteria:**
  - AC-9.CST.001.1 — Given a deployment phase, When any gated behaviour is evaluated, Then it matches the matrix for
    that phase.
  - AC-9.CST.001.2 — Given the C2 phase signal is unavailable **or stale** (older than its expected refresh window —
    e.g. coverage was wiped/restored and the cached phase still reads `full`), When evaluated, Then the system fails
    safe to the most restrictive (cold) phase — never to full. The gate checks phase **freshness**, not just
    presence, so a stale-`full` cannot fail open.
- **Open decisions:** OD-085.
- **Feasibility assumptions:** AF-034 (Maturity predicts usefulness, carry-in from C2).

#### FR-9.CST.002 — Proactive suppression below the proactive threshold
- **Statement:** The system shall fully suppress proactive suggestions while coverage is below the proactive
  threshold (default 50%) — the system "does not know enough to suggest anything" — and unlock them at/above it.
- **Source:** L3735–3736, L3753, L3755–3758
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** The proactive engine, gating its own output.
- **Preconditions:** C2 phase available.
- **Behaviour:**
  - Happy path: below proactive threshold → generators emit nothing to the user; at/above → proactive unlocks
    (relationship health, meeting prep, briefings begin).
  - Branches: derisking risk-scan still **runs** internally for audit/escalation but is not surfaced as proactive
    suggestion volume below threshold (a genuinely critical hard-limit/guardrail event is still a C6/C7 alert, not a
    proactive suggestion — the suppression is of *proactive suggestions*, not of *safety alerts*).
  - Edge / failure: phase unknown → suppress (CST.001 fail-safe).
- **Data touched:** coverage phase (read).
- **Permissions:** N/A.
- **Config dependencies:** CFG-cold_start_proactive_threshold (CST.003).
- **Surfaces:** suppressed state reflected in the banner (Phase 3).
- **Acceptance criteria:**
  - AC-9.CST.002.1 — Given coverage below the proactive threshold, When generators run, Then no proactive suggestion
    is surfaced to the user.
  - AC-9.CST.002.2 — Given coverage reaches the proactive threshold, When the next cycle runs, Then proactive
    suggestions unlock.
  - AC-9.CST.002.3 — *(gate H2 — two classes)* Given suppression is active, When a **C6/C7 guardrail-class** safety
    event occurs, Then it is still delivered via the C6/C7 alert path — suppression never silences a guardrail alert.
    **And** given an **Insight-detected** derisking risk **at the OD-084 escalation floor** (its underlying metric
    past threshold) — which has *no* independent C6/C7 path and exists only as a proactive item — Then it is **still
    delivered** despite cold-start proactive suppression. Suppression caps *advisory volume*, never an *at-floor
    escalating risk* (see AC-9.PRO.004.4).
- **Open decisions:** OD-085.
- **Feasibility assumptions:** —

#### FR-9.CST.003 — Configurable coverage thresholds
- **Statement:** The system shall expose the three cold-start thresholds — `cold_start_basic_threshold` (default
  20%), `cold_start_proactive_threshold` (default 50%), `cold_start_full_threshold` (default 80%) — as configurable
  per deployment.
- **Source:** L3770–3778, L930–934
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Admin/Super Admin tuning (per OD-086 node gating); the engine reads them.
- **Preconditions:** —
- **Behaviour:**
  - Happy path: defaults 20/50/80; a complex business may lower them to unlock features earlier on deep coverage of
    its most important entities; a simpler business reaches full faster.
  - Branches: thresholds must remain ordered (basic ≤ proactive ≤ full); an out-of-order set is rejected.
  - Edge / failure: invalid value → rejected with validation error, prior value retained.
- **Data touched:** config store (read/write).
- **Permissions:** `PERM-system.tune` (or the threshold-config node), per OD-086.
- **Config dependencies:** self (the three CFG keys, L930–934).
- **Surfaces:** config UI (Phase 2/3).
- **Acceptance criteria:**
  - AC-9.CST.003.1 — Given a Super Admin/Admin edit of a threshold, When saved, Then it takes effect with no deploy.
  - AC-9.CST.003.2 — Given an out-of-order or invalid threshold, When saved, Then it is rejected and the prior value
    retained.
- **Open decisions:** OD-086 (the gating node).
- **Feasibility assumptions:** —

#### FR-9.CST.004 — Per-entity cold-start coverage + `[Building]` framing
- **Statement:** The system shall use **per-entity** coverage (not global) when deciding whether a specific response
  or suggestion is in cold-start `[Building]` mode — consuming C2's per-entity Maturity + Retrieval Sufficiency
  (FR-2.MAT.003 / FR-2.RET.007). A response about a thin entity shows `[Building]` even in an otherwise well-covered
  deployment; above the full threshold the deployment treats gaps as genuine `[Unknown]`, and the `[Building]` pill
  no longer appears.
- **Source:** L3741–3743, L3752, L3759–3761, L3780–3782; C2 FR-2.MAT.003 / FR-2.RET.007
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Response/suggestion generation referencing an entity.
- **Preconditions:** C2 emits per-entity coverage + the `[Building]` flag.
- **Behaviour:**
  - Happy path: thin-due-to-incomplete-init on the touched entity → `[Building]`; deployment past full → gaps are
    `[Unknown]`, `[Building]` retired.
  - Branches: well-covered deployment + thin entity (the Acme example) → `[Building]` for that entity's responses.
  - Edge / failure: per-entity coverage unavailable → treat as thin (`[Building]`), conservative.
- **Data touched:** per-entity coverage (read, C2).
- **Permissions:** N/A.
- **Config dependencies:** CST.003 (full threshold).
- **Surfaces:** the pill on the response/card (Phase 3 / C4 definition).
- **Acceptance criteria:**
  - AC-9.CST.004.1 — Given a thin entity in an otherwise covered deployment, When a response about it is produced,
    Then it shows `[Building]`.
  - AC-9.CST.004.2 — Given the deployment exceeds the full threshold, When a gap is hit, Then the response is
    `[Unknown]`, not `[Building]`.
- **Open decisions:** —
- **Feasibility assumptions:** AF-034 (Sufficiency separates Building/Unknown, carry-in).

#### FR-9.CST.005 — Read-only external writes below the proactive threshold
- **Statement:** The system shall, while coverage is below the proactive (50%) threshold, run agents in **read-only
  mode on external systems where possible** — they do not write to external systems until coverage reaches the
  threshold. C9 **sets** the cold-start phase flag; the **external-write block is enforced by C6/C3/C5** (the same
  guardrail/connector path as any blocked write).
- **Source:** L3744–3746 ("agents run in read-only mode where possible … do not write to external systems until
  coverage reaches the 50% threshold")
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Any agent attempting an external write during cold start.
- **Preconditions:** Coverage < proactive threshold.
- **Behaviour:**
  - Happy path: an external-write tool call during cold start is blocked by C6/C3 (read-only mode) and surfaced, not
    silently swallowed; reads proceed.
  - Branches: at/above the threshold, external writes unlock through the normal C6 approval pipeline.
  - Edge / failure: phase unknown → treat as cold (read-only), conservative.
- **Data touched:** coverage phase (read); enforcement in C6/C3.
- **Permissions:** enforced by C6/C3.
- **Config dependencies:** CST.003.
- **Surfaces:** blocked-write surfaced via C6/C7.
- **Acceptance criteria:**
  - AC-9.CST.005.1 — Given coverage below the proactive threshold, When an agent attempts an external write, Then it
    is blocked (read-only) and surfaced — never silently dropped or auto-executed.
  - AC-9.CST.005.2 — Given coverage at/above the threshold, When an external write is attempted, Then it proceeds via
    the normal C6 approval pipeline.
- **Open decisions:** OD-085.
- **Feasibility assumptions:** —

#### FR-9.CST.006 — Reduced loop frequency below the basic threshold
- **Statement:** The system shall run scheduled loops at **reduced frequency** while coverage is below the basic
  (20%) threshold, and at **full frequency** at/above it. C9 **sets** the policy; **C5 (FR-5.LOP.* / FR-5.TRG.*)
  schedules** the loops.
- **Source:** L3737 ("scheduled loops run at reduced frequency"), L3750–3751 ("Scheduled loops run at full
  frequency")
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** C5 loop scheduler, reading the cold-start phase.
- **Preconditions:** C2 phase available.
- **Behaviour:**
  - Happy path: below basic → reduced cadence; at/above → full cadence.
  - Branches: thresholds configurable (CST.003).
  - Edge / failure: phase unknown → reduced (conservative).
- **Data touched:** coverage phase (read); scheduling in C5.
- **Permissions:** N/A.
- **Config dependencies:** CST.003.
- **Surfaces:** —
- **Acceptance criteria:**
  - AC-9.CST.006.1 — Given coverage below the basic threshold, When loops are scheduled, Then they run at the reduced
    cadence; at/above, at full cadence.
- **Open decisions:** OD-085.
- **Feasibility assumptions:** —

#### FR-9.CST.007 — Cold-start status + verification-pass priority
- **Statement:** The system shall produce the cold-start status contract — the current phase, the per-step
  initialisation progress (entity model / systems connected / structured ingested / documents ingested / onboarding
  interviews / human verification pass), overall coverage %, an estimated-time-to-full based on current ingestion
  rate, the persistent cold-start banner copy, and the **human verification pass surfaced as the highest-priority
  incomplete step with a count of memories awaiting verification** — for the Phase-3 initialisation-progress
  indicator to render. The step-completion signals are sourced from their owners (ingestion/coverage → C2;
  provisioning/connection → ADR-005/C3); the verification queue/count → C2 (FR-2.MNT verification).
- **Source:** L3704–3723, L3784–3788
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** The dashboard requests the cold-start status; the engine assembles it.
- **Preconditions:** C2 coverage + verification-queue signals available.
- **Behaviour:**
  - Happy path: assemble phase + per-step status + coverage % + ETA + banner + verification priority → expose for
    Phase-3 rendering.
  - Branches: the verification pass is always ranked the highest-priority incomplete step (the anchor — verified
    memories accelerate everything, L3786).
  - Edge / failure: ingestion-rate unknown → ETA shown as "calculating," not a fabricated estimate.
- **Data touched:** coverage + step signals (read, C2 / provisioning); verification count (read, C2).
- **Permissions:** dashboard read per C1.
- **Config dependencies:** CST.003 (thresholds for the phase label).
- **Surfaces:** the initialisation-progress indicator + banner (Phase 3).
- **Acceptance criteria:**
  - AC-9.CST.007.1 — Given an initialising deployment, When the status is requested, Then it includes phase, per-step
    progress, coverage %, ETA (or "calculating"), and the verification-pass priority with a waiting-count.
  - AC-9.CST.007.2 — Given an incomplete verification pass, When the status is assembled, Then verification is ranked
    the highest-priority incomplete step.
- **Open decisions:** —
- **Feasibility assumptions:** AF-130 (the ETA estimate from ingestion rate is meaningful).

### CMD — the `/` chat command system

#### FR-9.CMD.001 — `/` command registry + dispatch
- **Statement:** The system shall provide a `/` command system in the chat interface — a typed/tapped command menu —
  that dispatches each command to its home component's action: memory (`/remember`, `/forget`, `/recall`, `/verify`,
  `/memory-health` → C2), task (`/run`, `/queue`, `/approve`, `/reject`, `/status` → C5/C6), agent (`/ask`,
  `/research`, `/summarise` → C8), and trigger/system (`/trigger`, `/schedule`, `/health`, `/alerts`, `/help`,
  `/tune` → C5/C7/config).
- **Source:** L3868–3905
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** A user typing `/` in chat.
- **Preconditions:** User authenticated (C0); command exists in the registry.
- **Behaviour:**
  - Happy path: user types `/` → menu appears → command + args dispatched to the home component → result returned
    with an answer-mode pill (CMD.004).
  - Branches: unknown command → `/help`-style guidance, never a silent no-op.
  - Edge / failure: home component unavailable → the command returns an explicit error, not a hang.
- **Data touched:** dispatch only; home component owns the action's data.
- **Permissions:** per-command node gating (CMD.002).
- **Config dependencies:** —
- **Surfaces:** the command menu (Phase 3).
- **Acceptance criteria:**
  - AC-9.CMD.001.1 — Given a valid `/` command, When entered, Then it dispatches to the correct home component and
    returns a result.
  - AC-9.CMD.001.2 — Given an unknown command, When entered, Then guidance is shown — never a silent no-op.
- **Open decisions:** —
- **Feasibility assumptions:** —

#### FR-9.CMD.002 — Per-command permission-node gating (reconciles to C1)
- **Statement:** The system shall gate each `/` command on a **C1 permission node**, evaluated against the caller's
  node set — **not** on a hardcoded role ladder. The design's role-gating table (Standard User / "Agency Owner" /
  Admin / Super Admin, L3907–3912) is realized as the **default node assignment** across C1's six roles; the role
  **"Agency Owner" does not exist in C1** and is mapped to the deployment owner's actual role (Admin / Account
  Manager) by node, not by name.
- **Source:** L3907–3913; C1 FR-1.ROLE.001 (the six roles), ADR-006 (permissions-in-data); OD-086
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Command dispatch, before executing.
- **Preconditions:** The command has a required node; the caller has a node set (C1).
- **Behaviour:**
  - Happy path: caller holds the command's node → execute; default node assignment: memory/basic-task/agent
    commands + `/health` `/alerts` `/help` → Standard User and up; `/approve` `/reject` `/schedule` `/trigger` →
    approval/scheduling nodes; `/tune` + full system commands → `PERM-system.tune` (Admin and up); all commands →
    Super Admin.
  - Branches: a caller lacking the node → denied + logged (default-deny, C1).
  - Edge / failure: a command with no mapped node is **denied by default**, never open.
- **Data touched:** node check (C1); `event_log` (CMD.004).
- **Permissions:** the command's mapped node (C1).
- **Config dependencies:** —
- **Surfaces:** denied commands surfaced inline.
- **Acceptance criteria:**
  - AC-9.CMD.002.1 — Given a caller without a command's required node, When the command is entered, Then it is denied
    and logged (default-deny).
  - AC-9.CMD.002.2 — Given the design's "Agency Owner" gating row, When realized, Then it is expressed as node
    assignments across C1's six roles — no "Agency Owner" role is introduced.
  - AC-9.CMD.002.3 — Given a command with no mapped node, When evaluated, Then it is denied by default.
- **Open decisions:** OD-086.
- **Feasibility assumptions:** —

#### FR-9.CMD.003 — Destructive commands require confirmation
- **Statement:** The system shall require explicit confirmation before executing a destructive command (e.g.
  `/forget`, `/reject`, a destructive `/tune`), in addition to any C6 approval gate the underlying action carries.
- **Source:** L3870 ("Destructive commands require confirmation")
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** A user entering a destructive command.
- **Preconditions:** Command classified destructive.
- **Behaviour:**
  - Happy path: destructive command → confirm prompt → on confirm, dispatch (still subject to the action's C6 gate).
  - Branches: no confirm → the command is not executed.
  - Edge / failure: the confirmation is a UI gate **in addition to**, not a replacement for, the action's guardrail
    (a `/forget` of a memory still hits the C2/C6 retirement path).
- **Data touched:** dispatch only.
- **Permissions:** CMD.002 node + the action's C6 gate.
- **Config dependencies:** —
- **Surfaces:** confirm dialog (Phase 3).
- **Acceptance criteria:**
  - AC-9.CMD.003.1 — Given a destructive command, When entered, Then execution requires explicit confirmation.
  - AC-9.CMD.003.2 — Given a confirmed destructive command, When dispatched, Then it still passes through the
    underlying action's C6 guardrail — the confirm does not bypass it.
  - AC-9.CMD.003.3 — *(gate M3 — order + the UI confirm is never the sole barrier)* Given a destructive command,
    When entered, Then the CMD.002 **node gate is evaluated before** the confirmation prompt (an unauthorized caller
    is denied, never shown the confirm); and the dispatched action's **C6 tier governs execution** — for `/forget`,
    the action is a C2 memory-retirement (the Memory-Agent sole-writer path, FR-2.MNT retire) carrying its own C6
    tier, so the UI confirm is never the sole barrier even for a single-item destructive op.
- **Open decisions:** —
- **Feasibility assumptions:** —

#### FR-9.CMD.004 — Every command produces a pill response + is logged
- **Statement:** The system shall, for every `/` command, produce a response carrying an answer-mode pill and write
  the command invocation to the `event_log` (C7).
- **Source:** L3870 ("Every command produces a response with an answer mode pill. All commands logged in the event
  log."); C7 `event_log`
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Command execution.
- **Preconditions:** Command dispatched.
- **Behaviour:**
  - Happy path: execute → response with pill → write invocation (command, caller, args summary, outcome) to
    `event_log`.
  - Branches: a denied command is still logged (CMD.002).
  - Edge / failure: an `event_log` write failure is surfaced per C7's log-failure path, not silently swallowed.
- **Data touched:** `event_log` (write, C7).
- **Permissions:** N/A.
- **Config dependencies:** —
- **Surfaces:** the response + pill (Phase 3).
- **Acceptance criteria:**
  - AC-9.CMD.004.1 — Given any executed or denied command, When processed, Then an `event_log` entry is written.
  - AC-9.CMD.004.2 — Given a command response, When returned, Then it carries an answer-mode pill.
  - AC-9.CMD.004.3 — *(gate L3 — audit-critical commands fail closed on log failure)* Given a **destructive or
    node-gated** command whose `event_log` write fails, When execution is evaluated, Then it **fails closed** (the
    command does not silently execute unlogged), mirroring C6 AC-6.LOG.003.3 — a destructive `/forget`/`/tune` that
    cannot be audited must not proceed.
- **Open decisions:** —
- **Feasibility assumptions:** —

#### FR-9.CMD.005 — Mobile command menu (tap-optimised)
- **Statement:** The system shall present, on mobile, a tap-optimised command menu with the most common commands as
  quick-tap buttons above the keyboard. (The rendering is a Phase-3 surface; C9 owns the command set + which are
  "common.")
- **Source:** L3915
- **Status:** Approved
- **Priority:** Could
- **Actor / trigger:** A mobile user opening the command menu.
- **Preconditions:** Mobile client.
- **Behaviour:**
  - Happy path: common commands surface as quick-tap buttons; the full set remains available via `/`.
  - Branches: node-gated commands the caller lacks are hidden/disabled (CMD.002).
  - Edge / failure: —
- **Data touched:** —
- **Permissions:** CMD.002.
- **Config dependencies:** —
- **Surfaces:** mobile command menu (Phase 3).
- **Acceptance criteria:**
  - AC-9.CMD.005.1 — Given a mobile user, When the command menu opens, Then the most common (node-permitted) commands
    appear as quick-tap buttons.
- **Open decisions:** —
- **Feasibility assumptions:** —

---

## The founder holiday problem (integration narrative — no new FRs)

L3792–3864 is an **integration narrative**: it shows how the already-specified system covers a founder's 6-week
absence. The eight break-points map to existing components — relationship context → C2 (tacit-knowledge interviews,
Internal Org entity); decision-making → C4 (operating principles) + C6 (approval gates); institutional knowledge →
C2 (SOPs as procedural memories); proactive work → C9 PRO.* on the C5 slow loop; client relationships → C8 Client
Agent + C9 PRO.001; opportunities → C9 PRO.005; prioritisation → C9 PRO.006 + memory goals/OKRs (C2); system health →
C7. **No orphaned design line.** The **founder-preparation checklist** (L3831–3864) and the **initialisation guide**
(L3786) are explicitly *operational documents*, not system behaviour → **OOS-031 / OOS-032**; the readiness each item
checks is covered by the existing FRs above and in C1–C8.

---

## Feasibility (block T — build-time, none holds an FR)

- **AF-127** — proactive **signal-detection accuracy** (sentiment/relationship-health, risk signals, opportunity
  signals, cross-memory patterns). Method: EVAL. Gates the *quality* of PRO.001/004/005/007, not the FR machinery.
- **AF-128** — dismissal-learning **never suppresses a true escalating signal** (the OD-084 floor holds under real
  usage). Method: EVAL. Gates SUG.005.
- **AF-129** — ranking + briefing surface the **genuinely important** items (relevance, low-noise). Method: EVAL.
- **AF-130** — the cold-start **ETA** from ingestion rate is meaningful (not misleading). Method: SPIKE.

Carry-ins relied on: **AF-034** (Maturity/Sufficiency, C2), **AF-068** (hard-limit containment, C6), **AF-033**
(said-vs-did pill accuracy).

---

## Traceability

All **28** FRs wired into `traceability-matrix.csv` (2026-06-27). `system-map/09-proactive.md` built.
