---
id: ISSUE-056
title: Approval tiers + mandatory-hard set + escalation/flagged workflow
epic: G — guardrails
status: in-progress
github: "#56"
---

# ISSUE-056 — Approval tiers + mandatory-hard set + escalation/flagged workflow

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
The human-in-the-loop control layer: classify every gated agent action into an approval tier (auto/soft/hard) with a non-downgradable mandatory-hard floor, route it to the right non-initiating reviewer, and drive the pause→`flagged`→resolve→escalate workflow that keeps held actions loud, finite, and honest — rendered on the surface-04 approval queue.

## 2. Scope — in / out
**In:** The C6 **approval-tier policy** and the **escalation/flagged workflow**, plus their reviewer-facing surface:
- Three-tier classification (auto/soft/hard; default-hard-if-uncertain) driven by `risk_level` + reversibility/sensitivity.
- The **mandatory-hard floor** (all external comms — no sub-type exemption per OD-161 — financial ops, Confidential/Restricted memory ops, plus the FR-6.HRD.004 gated extensions), never configurable below hard.
- **Soft auto-execute** on timeout for reversible-only actions; the reviewer **Hold-for-full-review** promotion (soft→explicit, one-directional).
- Auto-approve immediate execution with logged tier decision.
- **Contextual routing** (action-type → reviewer role), fallback + escalate on unavailable reviewer, and **no-self-approval** (initiator ≠ approver — the human-tier expression of hard limit #6).
- The **C6/C5 seam contract** (C6 decides the tier + sets `requires_approval`; C5 enacts the block).
- The **escalation/flagged workflow**: guardrail hit → pause → `flagged` (set by C6, distinct from `awaiting_approval`), multi-fire most-restrictive precedence, reviewer notification + queue placement, the three resolutions (approve/reject/modify) with already-applied-side-effects shown + human-visible compensation task (no auto-rollback), and no-silent-abandon with an escalation timeout covering both `flagged` and `awaiting_approval` wait-points.
- The **surface-04 approval queue** (single live queue + filter chips, tier/hold badges, live soft-auto-run countdown, Approve/Reject/Modify/Hold/Queue-cleanup actions, live/degraded/reconnecting honesty), gated by `PERM-action.review`.

**Out:**
- The **hard-limit gate itself** (the seven un-overridable code limits, block+log+alert, no approve affordance) → **ISSUE-055** (C6 HRD). This slice consumes the fact that a `hard_limit` row is killed-not-held (never in the queue, no Approve) but does not build the gate.
- **Anomaly detection** (the five pre-step checks that *produce* an `anomaly` flag) → **ISSUE-057** (C6 ANM). This slice consumes an anomaly flag as a queue item; it does not build the checks.
- **Rate-limit / cost-ladder** guardrails (which *produce* a `rate_limit` flag) → **ISSUE-058** (C6 RTL).
- **Injection sanitization + quarantine** (which *produces* an injection/quarantine flag) → **ISSUE-059** (C6 INJ). This slice consumes a quarantine as a `flagged` item routed here.
- The **`guardrail_log` write-completeness invariant + guardrail-log optimisations/learning** (FR-6.LOG.*/FMM/OPT) → **ISSUE-060**. This slice **writes** approval_gate/status rows but the append-only completeness contract + learning is owned there.
- The **C5 task-queue / status machine / `requires_approval` / approval-block mechanism** (FR-5.QUE.*) → **ISSUE-048**; the **pre-execution + mid-task gate mechanics** (FR-5.ASM.004/005) and **completion/compensation successor-task durability** (FR-5.ASM.009) → **ISSUE-053**. This slice sets policy + state; C5 owns the state machine + resume.
- **Alert delivery + notification centre + the realtime/polling transport** → C7 (**ISSUE-075 / ISSUE-076**); this surface renders the queue + badges over that transport but does not own delivery.
- **Config editing** of the tiers/timeouts (`action_autonomy_matrix`, `approval_*` keys) → the config admin surface **ISSUE-086 / surface-01**; read-only here.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs (C6 Guardrails):** FR-6.APR.001, FR-6.APR.002, FR-6.APR.003, FR-6.APR.004, FR-6.APR.005, FR-6.APR.006 (approval tiers); FR-6.ESC.001, FR-6.ESC.002, FR-6.ESC.003, FR-6.ESC.004 (escalation/flagged workflow).
- **Renders / consumes (do not re-spec):** FR-5.QUE.005, FR-5.ASM.004, FR-5.ASM.005, FR-5.ASM.009 (C5 — the block/gate/resume/successor mechanism); FR-6.HRD.003, FR-6.HRD.004 (C6 HRD — hard-limit not-here / gated extensions); FR-6.LOG.001, FR-6.LOG.003 (C6 LOG — the `guardrail_log` row + write-completeness); FR-1.CLR.001/004, FR-1.RST.003 (C1 — the Confidential/Restricted hard triggers + Restricted routing); FR-1.PERM.007 (Approval Authority category home for the minted node); FR-7.RTP.001–004, FR-7.ALR.002/003/005/007 (C7 — realtime transport + stale-approval alert, seam).
- **NFRs:** NFR-SEC.013 (no back-door — every path runs the identical node-gate + C6 pipeline); NFR-OBS.007 (escalate-don't-abandon, the universal wait-point pattern); NFR-A11Y.001 (surface accessibility baseline).
- **Rests on:** ADR-007 (containment-first; detection-as-signal — hard vs approvable split, no reversible-implied-when-not); ADR-003 (controls-before-gates ladder posture); ADR-006 / standards/rbac.md (clearance model behind the hard triggers); ADR-001 §3 (physical isolation — no `client_slug` rendered/carried, OD-096); AF-068 (containment red-team — enforceability of the hard-approval floor).
- **Change-control provenance:** OD-060 (hard-limit not-overridable), OD-063 (anomaly severity may escalate to hard), OD-064 (soft auto-execute reversible-only), OD-161 (mandatory-hard floor restored to ALL external comms; retires the OD-088 carve-out; FR-9.MODE.004 low-risk-external capped at Prepare-only), OD-010 (no auto-rollback + human-visible cleanup task), OD-054 (`flagged` defined in C5 schema, set by C6), OD-117 (mint `PERM-action.review`), OD-118 (one unified queue + filter chips), OD-119 (Modify = editable-params → re-enter gate), OD-120 (Hold-for-full-review → AC-6.APR.003.3).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- **APR (tiers):** AC-6.APR.001.1, AC-6.APR.001.2; AC-6.APR.002.1, AC-6.APR.002.2; AC-6.APR.003.1, AC-6.APR.003.2, AC-6.APR.003.3; AC-6.APR.004.1; AC-6.APR.005.1, AC-6.APR.005.2, AC-6.APR.005.3; AC-6.APR.006.1.
- **ESC (escalation/flagged):** AC-6.ESC.001.1, AC-6.ESC.001.2, AC-6.ESC.001.3; AC-6.ESC.002.1; AC-6.ESC.003.1, AC-6.ESC.003.2, AC-6.ESC.003.3; AC-6.ESC.004.1, AC-6.ESC.004.2, AC-6.ESC.004.3.
- **NFR postures that must hold:** AC-NFR-SEC.013.1/.2 (no bypass path — the surface, `/`-commands, and mobile all run the identical gate); AC-NFR-OBS.007.1/.2 (this slice adds `flagged` + `awaiting_approval` as covered wait-points honouring `alert_escalation_window_hours`).
- **Gating spikes:** **AF-068 must be GREEN before ship** — the containment red-team (ISSUE-003) proves there is no authorized-but-dangerous autonomous path around the hard-approval floor (FR-6.APR.002); the floor is the approval-layer half of the containment posture, so it must not relax before AF-068 clears. (AF-068 is currently 🔴 in `feasibility-register.md`.)

## 5. Touches (complete blast radius, by ID)
- **DATA:** `guardrail_log` (write `approval_gate` rows; `status` pending→approved/rejected forward transition; `reviewed_by`/`reviewed_at`; `escalated_at` ⊕ net-new server-owned field; the `check (not (guardrail_type='hard_limit' and status='approved'))` already in schema); `task_queue` (read/consume `status` ∈ {awaiting_approval, flagged}, `requires_approval`, `approved_by`, `approved_at`, `originating_user_id` ⊕ for no-self-approval, `action_payload`); `injection_quarantine` (read — a quarantine's `flagged` item routes here, escalation timeout via `escalated_at`); `access_audit` (append — every Approve/Reject/Modify/Hold + sensitive view). Read-only joins: `agents` (proposing specialist), `memories`/`entities` (memory-targeting actions).
- **PERM:** `PERM-action.review` (minted per OD-117, homed under the existing **Approval Authority** category — FR-1.PERM.007; default-deny; per-item authority = node AND routed-reviewer/fallback AND not-initiator AND tier clearance). Consumes C1 clearance (FR-1.CLR.*) for sensitive-content view gating.
- **CFG:** `action_autonomy_matrix` (the tier policy — read here to explain an item's tier; edited on surface-01); `approval_soft_timeout` (default 10 min — drives the reversible-soft auto-run countdown); `approval_escalation_timeout` (default 4 h — un-actioned flagged/awaiting_approval escalation); `approval_staleness_alert_threshold` (default 4 h — reviewer nudge, C7 seam); `alert_escalation_window_hours`/`escalation_contacts`/`alert_routing_rules`/`quiet_hours` (C7 escalation routing — seam, not edited here); `realtime_connection_headroom_threshold` (queue-priority live-connection basis, C7 seam). Referenced-as-context: `rate_limit_*`, `anomaly_thresholds` (a flag cites which cap/check fired).
- **UI:** `UI-APPROVAL-QUEUE` (surface-04) — the single live queue, filter chips (All/Approvals/Safety-holds/Overdue), tier/hold badges, detail panel, Approve/Reject/Modify/View-detail/Queue-cleanup/Hold actions, live/◐polling/⟳reconnecting indicator, soft auto-run countdown; mobile treatment per surface-12.
- **Connectors:** none directly (external-comms actions flow through C3 connectors but this slice only gates them, it does not send).

## 6. Context manifest (the EXACT files to open — nothing more)
- `spec/01-requirements/component-06-guardrails.md` — the APR + ESC FRs/ACs (the spine of this slice); also the consumed HRD.003/004 and LOG.001/003 statements + the OD-047/060/063/064/010/161 resolutions.
- `spec/03-surfaces/surface-04-approval-queue.md` — the queue UI states, data bindings, actions, PERM/CFG wiring, and OD-117–120.
- `spec/04-data-model/schema.md` §7 Guardrails (`guardrail_log`, `injection_quarantine`) and §6 Execution/Harness (`task_queue` — the held-item source) and the §Global-rules append-only immutability trigger.
- `spec/05-non-functional/security.md` §NFR-SEC.013 (no back-door) and `spec/05-non-functional/observability.md` §NFR-OBS.007 (escalate-don't-abandon).
- `spec/00-foundations/adr/ADR-007-*.md` (containment-first / detection-as-signal — the hard-vs-approvable split); `spec/00-foundations/feasibility-register.md` (AF-068 status — the ship gate).

## 7. Dependencies
- **Blocked-by:** ISSUE-048 (`task_queue` permanent record + status machine + `requires_approval`/approval-block + priority — the state this slice sets policy over), ISSUE-076 (realtime/polling contract + connection budget + degrade — the transport surface-04 renders over). **Gating spike:** AF-068 (proven by ISSUE-003) must be GREEN before ship (see DoD).
- **Blocks:** ISSUE-028 (conflict quarantine + consolidation approval — reuses this approval/flagged workflow), ISSUE-053 (run pipeline — its pre-execution approval gate + mid-task quarantine land in this queue and use this tier policy), ISSUE-068 (proactivity modes / action-autonomy matrix, Prepare-only OD-161 — floors here), ISSUE-079 (mobile surface — renders this queue's held items + web-push).

## 8. Build order within the slice
1. **Schema deltas first (migration, expand-contract):** add the ⊕ net-new fields the surface + policy depend on — `guardrail_log.escalated_at` (nullable, server-owned) and `task_queue.originating_user_id` (already present in schema §6/§7; verify the migration lands them and the `hard_limit`≠`approved` CHECK is enforced). No `client_slug` (OD-096 — deleted from app tables).
2. **PERM node:** mint `PERM-action.review` under the Approval Authority category (FR-1.PERM.007), default-deny; it must appear in `PERMISSION_NODES.md` at build (FR-1.PERM.005 discipline). RLS on `task_queue`/`guardrail_log` reads: gated by the node, sensitive rows additionally by clearance (FR-1.CLR.*), realtime filter intra-silo.
3. **Tier classifier (FR-6.APR.001/002/004):** map an action to exactly one tier from `risk_level` + reversibility/sensitivity; enforce the mandatory-hard **floor** (FR-6.APR.002 — reads `action_autonomy_matrix` but the floored rows are non-downgradable in code, not config); default-hard-if-uncertain. Auto-approve executes immediately + logs the tier decision.
4. **C6/C5 seam wiring (FR-6.APR.006):** C6 sets `requires_approval` + the tier; C5 (ISSUE-048/053) moves the task to `awaiting_approval` and holds — do NOT re-implement the state machine here; call into it.
5. **Contextual routing + no-self-approval (FR-6.APR.005):** route by action-type/context to the configured reviewer role; default reviewer on no match; fallback + escalate on unavailable; reject the routing where candidate reviewer identity == `originating_user_id` (AC-6.APR.005.3, hard-limit-#6 human-tier).
6. **Soft-timeout auto-execute (FR-6.APR.003):** the server-owned timer auto-runs a soft item on `approval_soft_timeout` **only if reversible**; irreversible/floored are hard by definition and never auto-run; wire the **Hold-for-full-review** promotion (soft→explicit, one-directional; logs to `guardrail_log`).
7. **Flagged workflow (FR-6.ESC.001/002/003/004):** on a guardrail hit, C6 sets `status='flagged'` (via the C5 schema/OD-054), pauses; most-restrictive-governs on multi-fire (hard_limit dominates → killed, not queued; each hit still logs its own row); notify the routed reviewer + place in queue; the three resolutions (approve → C5 resumes; reject → C5 cancels + reason; modify → editable-params → requeue → re-enter gate); show already-applied side effects + queue a durable human-visible compensation task (via C5 AC-5.ASM.009.2), never auto-rollback; irreversible effect surfaced non-compensable; escalation timeout covers both `flagged` (this FR) and `awaiting_approval` (C5 AC-5.QUE.005.2).
8. **Surface-04 wiring:** render the single queue (filter chips per OD-118), tier/hold badges, detail panel with rationale + already-applied effects + clearance-gated preview, Approve/Reject/Modify/View/Queue-cleanup/Hold actions (each `PERM-action.review` + routed + not-initiator + tier clearance), the live/◐polling/⟳reconnecting indicator honesty (FR-7.RTP.004), and the server-authoritative soft countdown. Handle Loading/Empty/Error/Partial/Offline-stale states (disable resolve actions when known-stale; re-fetch on reconnect before re-enabling — a soft item may have auto-run server-side).
9. **Test to the ACs** (see Verification).

## 9. Verification (how DoD is proven)
- **Unit / policy layer:** the tier classifier — every action gets exactly one tier, default-hard-if-uncertain (AC-6.APR.001.1); the floor is non-downgradable in code regardless of `action_autonomy_matrix` config (AC-6.APR.002.1 — the load-bearing #2 test); soft auto-run only when reversible (AC-6.APR.003.1); no-self-approval rejection (AC-6.APR.005.3); most-restrictive multi-fire precedence with per-hit logging (AC-6.ESC.001.3).
- **Integration:** the C6→C5 seam (C6 sets tier, C5 holds/resumes — AC-6.APR.006.1, AC-6.ESC.003.1); the escalation timeout fires + widens for both wait-points (AC-6.ESC.004.1/.2/.3, AC-NFR-OBS.007.1/.2); Hold-for-full-review cancels the timer + promotes to explicit (AC-6.APR.003.3); compensation-task creation on reversible already-applied effect, non-compensable surfacing on irreversible (AC-6.ESC.003.2/.3).
- **Surface / E2E:** surface-04 renders held items live, degrades honestly, disables resolve actions when stale + re-fetches on reconnect; `PERM-action.review` entry gate (404 when absent); no-self-approval disabled at the item; a `hard_limit` row never appears with an Approve affordance (AC-6.ESC.001.2 / AC-6.LOG.001.2). Bypass test across desktop/mobile/`/`-command (AC-NFR-SEC.013.1/.2) — every path runs the identical node-gate + C6 tier pipeline.
- **Ship gate:** AF-068 red-team GREEN in `feasibility-register.md` (per OD-157/RP-1) — the hard-approval floor has no autonomous bypass — before this issue ships. Test layers per `spec/05-non-functional/test-strategy.md`.
