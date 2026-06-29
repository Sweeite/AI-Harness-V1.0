# Session Log

Reverse-chronological. One entry per working session. This is cross-session memory — the
next session reads the top entry to know exactly where to resume.

---

## Session 30 — 2026-06-28 — PLAIN-ENGLISH DESCRIPTIONS ON EVERY CONFIG KNOB (registry) + DRY helper-text convention — **SIGNED OFF + PUSHED**

**✅ OPERATOR SIGN-OFF (2026-06-28):** "i confirm it and i want to sign off and push to main." Confirmed the
plain-English descriptions work, the DRY convention, and the self-sufficiency-test gap patches. Pushed to `main`.

**OD-104 CLOSED (2026-06-28, operator delegated "i trust your rec"):** missed/never-arriving webhook detection —
**verified the mechanism already exists, no new FR.** Owned by C3 **FR-3.TRIG.005** (watch re-arm, fail-loud on
lapse) + **FR-3.TRIG.006** (event-gap detect + reconcile from a persisted watermark — dropped/auto-disabled/
late events never become silent loss), alerted via FR-3.DSC.006 → C7. **C0 OWED-FR-1 closed.** One build-time
caveat logged: confirm GHL's incremental sync provides a TRIG.006 reconciliation read (GHL not in TRIG.006's
named happy-path arms; rides the generic detect-then-reconcile pattern). **No open items remain blocking Phase 3.**

**What happened:** Operator reviewed `surface-01-config-admin` (already signed off, session 29) plus an HTML
mockup and flagged that the config knobs are impossible to understand from their key names alone. Added a
**plain-English `What it does` description to every config row.**

**Scope of the change:**
- **`spec/02-config/config-registry.md`** — new `What it does (plain English)` column on all 14 group/secret
  tables (A–N), one jargon-free line per row, written for a non-technical agency admin. **170 knob/secret rows
  + 11 Appendix-A structured objects** — verified 100% coverage (0 empty descriptions). Method: 6 parallel
  subagents, each grounding its descriptions in the relevant `component-NN` requirement files (no invented
  behaviour). Conventions section documents the column as **canonical source text**.
- **`spec/03-surfaces/surface-01-config-admin.md`** — added a binding paragraph (Layout): the surface renders
  each key's registry description as the on-screen **helper line** beneath the key. **DRY decision (operator
  confirmed "keep it dry"):** the registry is the single source; the surface references it, never duplicates the
  170 strings. A key with no description is a registry defect, not a surface fallback.
- **`spec/03-surfaces/_TEMPLATE.md`** — added the **DRY rule for human-readable text** under Data bindings so
  every future surface follows the same bind-don't-duplicate pattern.

**Honest flag:** the trickiest descriptions (memory-retrieval dials especially) describe *intended* (paper)
behaviour; revisit if real tuning behaves differently once built. Consistent with the feasibility posture.

**Commits:** registry descriptions (b2316bd); template/README/SESSION-LOG alignment + this entry to follow.

**Resume point unchanged: next surface is `surface-00-auth.md`** (UI-LOGIN, UI-2FA-*, UI-INVITE-SETUP,
UI-REAUTH-PROMPT, UI-SUPPORT-REQUESTS). Follow the Phase 3 playbook steps; copy `_TEMPLATE.md`; the C0 FRs
(`component-00-login.md`) are the FR source. FR bindings (from the sufficiency test): UI-LOGIN → FR-0.AUTH.001/
.002/.004/.005/.009 + FR-0.REC.001; UI-2FA-ENROLL → FR-0.AUTH.006; UI-2FA-CHALLENGE → FR-0.AUTH.007/.008;
UI-INVITE-SETUP → FR-0.INV.004/.005 (+ FR-0.SEED.002 reuse); UI-REAUTH-PROMPT → FR-0.SESS.003/.004/.006/.007;
UI-SUPPORT-REQUESTS → FR-0.REC.002/.003/.005/.006/.007.

**Self-sufficiency test RUN before this handoff (zero-context agent, 2026-06-28) → verdict: resumable, and the
gaps it found are now PATCHED:**
- **Phantom role model (blocking-quality)** — `_TEMPLATE.md` + signed-off `surface-01` Access tables used
  non-existent "Advanced/Basic Member" roles. **FIXED** → the six canonical C1 roles (Super Admin, Admin,
  Finance, HR, Account Manager, Standard User); template now carries a "use the six roles, never invent" note.
- **`PERMISSION_NODES.md` did not exist** (referenced 35×, owed since ADR-006). **CREATED** at repo root — the
  canonical catalog, 37 nodes harvested from C0–C10 + config, fields per FR-1.PERM.005 (Description / Default
  roles / Scope / Added-in); 5 unseeded stubs flagged ⚠️ (default-deny per OD-030).
- **Surface count 13-vs-14** — playbook header said "13 files". **FIXED** → 14 (00–12 + 01b); README/SESSION-LOG
  already said 14.
- **`UI-CONFIG-AUTH` orphan + `surface-01b` listed-not-built** — **NOTED** in the playbook: UI-CONFIG-AUTH is
  absorbed into surface-01 `#auth` (not a standalone surface); surface-01b is a known not-yet-built link target.
- **Pre-existing, NOT patched (needs an operator decision, flagged for a future session):** C0 OWED-FR-1
  (missed/never-arriving webhook reconciliation homing, C0 L819–823) is still "confirm at sign-off" — it needs a
  component-ownership call (C2/C3/C7/C9) = a real OD, not a doc fix. Does not block surface-00.

---

## Session 29 — 2026-06-28 — PHASE 3 ENTERED (SURFACES) — PRE-ENTRY PASS + C9 CHANGE-CONTROL ADDENDUM

**Phase 3 entered.** Pre-entry pass completed: surface inventory collected (17 formal `UI-` stubs + 94 review-scaffolding entries + `UI-config-admin` 11 sections from Phase 2 Appendix B), consolidated into ~12 logical surface files, ordering agreed. `spec/03-surfaces/` exists and is empty — ready.

**Inputs reviewed:** operator's `AIOS_prototype.html` prototype (31 planned dashboards) + `AIOS Dashboard Planning.md`. Key finding: the vast majority of planned dashboards map cleanly to existing Phase 1 FRs. The `s-c-*` control-plane screens (Fleet Clients, Deploys, Health, Provisioning, Migrations, Workflows, Cost, Plugins) map to C7 MGM + C10 and will be Phase 3 surfaces.

**V2 deferrals logged (OOS-034–038):**
- OOS-034: Objectives / OKR hierarchy
- OOS-035: Projects (task grouping)
- OOS-036: Priority Matrix / Eisenhower grid
- OOS-037: Brain Dump (quick-capture scratchpad)
- OOS-038: Field Ops / Mission Manager

**Credential Vault resolved:** platform secrets = env-only (Phase 2, Group N, class SECRET — no UI). Connector OAuth status = visible via management-plane surfaces. No standalone vault UI.

**C9 change-control addendum — DONE:** +FR-9.CMD.006–008 (user-defined custom commands — the "Commands" feature):
- Operator vision: user-defined slash commands that work like Claude Code skills — `/command-name` → inline result in chat, no async queue, no task_queue entry.
- FR-9.CMD.006: custom command definition (slug, prompt template, assigned agent, PERM node) stored in `commands` table.
- FR-9.CMD.007: custom commands registered in CMD dispatch alongside system commands; slug collision with system commands rejected at save.
- FR-9.CMD.008: invocation — template resolved with `$ARGUMENTS`, dispatched to assigned agent, result inline with answer-mode pill; same C6 guardrail pipeline as any agent run.
- C9 header updated: CMD ×5 → ×8, 28 FRs → 31 FRs. Matrix rows added. PERM stub `PERM-commands.manage` (→ PERMISSION_NODES.md, C1 FR-1.PERM.005; default Super Admin + Admin). DATA stub: `commands` table (→ Phase 4).
- UI surface: `UI-COMMANDS` added to Phase 3 surface list (Commands management screen where admins create/edit custom commands).

**Surface ordering agreed for Phase 3:**

| # | File | Coverage |
|---|---|---|
| 00 | `surface-00-auth.md` | UI-LOGIN, UI-2FA-*, UI-INVITE-SETUP, UI-REAUTH-PROMPT, UI-SUPPORT-REQUESTS |
| 01 | `surface-01-config-admin.md` | UI-config-admin #auth…#secrets (11 sections) — Phase 2 Appendix B carry-in |
| 02 | `surface-02-user-mgmt.md` | UI-USER-MGMT, UI-ROLE-MGMT, UI-PERMISSION-MATRIX, UI-CLEARANCE-*, UI-RESTRICTED-GRANT |
| 03 | `surface-03-ingestion-queue.md` | UI-INGESTION-QUEUE, conflict review queue |
| 04 | `surface-04-approval-queue.md` | Approval queue dashboard (C6 tiers) |
| 05 | `surface-05-dashboard-ops.md` | Ops dashboard: system health, connector health, event log, DLQ, cost, guardrail log, self-improvement |
| 06 | `surface-06-dashboard-super-admin.md` | Super Admin dashboard + management-plane screens (s-c-*): fleet clients, deploys, health, provisioning, migrations, cost, plugins |
| 07 | `surface-07-dashboard-agency.md` | Agency Owner + Manager view, activity feed, notification centre |
| 08 | `surface-08-dashboard-user.md` | Standard user view: My Workspace, Inbox, Decisions, chat |
| 09 | `surface-09-agent-builder.md` | Agent Fleet, Agent Builder / specialist config, Orchestration |
| 10 | `surface-10-commands.md` | UI-COMMANDS — custom command management (FR-9.CMD.006–008) |
| 11 | `surface-11-memory-nav.md` | Memory navigation / entity browser |
| 12 | `surface-12-mobile.md` | Mobile surfaces (6 sub-surfaces) |

**Surface-01 (Config Admin) — DONE ✅**
`spec/03-surfaces/surface-01-config-admin.md` — 613 lines. All 11 sections (#auth #memory #tools #prompts #loops #guardrails #observability #agents #proactive #infra #secrets), all 117 scalar + 11 secret + 10 structured CFG rows wired, all 5 states per section. OD-098–103 resolved (operator: "take your recs"): "System Config" nav · `UI-config-audit-log` separate surface (added to Phase 3 list — now 14 surfaces total) · desktop banner mobile · BOOT confirm only when dirty · `secret_manifest` deploy-hook table · per-section save. Verification gate CLEAN (all 4 checks PASS). Phase 4 stubs: `config_values` · `config_audit_log` · `secret_manifest`.

**Next: `surface-00-auth.md`** — UI-LOGIN, UI-2FA-CHALLENGE, UI-2FA-ENROLL, UI-INVITE-SETUP, UI-REAUTH-PROMPT, UI-SUPPORT-REQUESTS. Carry-in: C0 FRs (AUTH/SESS/INV/SEED/REC/WHK areas), Block J feasibility findings (Supabase Auth vendor facts), ADR-006 §RLS session boundary.

---

## Session 28 — 2026-06-27 — PHASE 2 (CONFIG REGISTRY) ENTERED — HARVEST + REGISTRY DRAFTED, VERIFICATION-GATE CLEAN

**Phase 2 begun.** Output: `spec/02-config/config-registry.md` (authoritative) + `spec/02-config/_HARVEST.md`
(working artifact). **~117 scalar knobs + 11 secrets + 10 structured objects**, every row classified
(SECRET/BOOT/LIVE/REBUILD) · defaulted · validated · `PERM-`-gated · `UI-`-surfaced. **Zero `???`** —
Phase-2 gate met. Verification gate (independent zero-context subagent): **CLEAN PASS on all 6 checks**
(coverage 1:1 · zero-??? · class sanity · cross-key constraints satisfied by defaults · locks held ·
conflict resolutions applied).

**Method:** operator chose "full harvest first." 4 Explore subagents (C0–C3 / C4–C7 / C8–C10 component
sweeps + a design-doc tunable sweep). Then a 3-agent gap-hunt. Then descriptions added to every row (the
operator flagged the first draft was unreadable — descriptions had been stripped; restored). Then the
registry built with per-GROUP PERM/UI assignment (not per-key — every knob in a group shares one
`PERM-config.<group>` gate + one `UI-config-admin#<group>` section).

**The gap-hunt payoff (real omissions caught, not in any FR):**
- **8 platform SECRETs** missing → new group N: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `INNGEST_API_KEY`,
  `X_INTERNAL_TOKEN` (mgmt-plane push auth, ADR-001 §7), the 3 connector signing secrets, the Google
  Pub/Sub key.
- **`ef_search`** (memory recall/latency dial, design L1511) — no CFG stub existed.
- **12 design-block knobs** with no FR home (4 ranking weights, 6 polling intervals, default/lightweight
  model, checkpoint thresholds, push frequencies, a few alert thresholds) — registered, additive, no
  change-control needed.
- **Alert routing has NO owner** (genuine Phase-1 hole, not a harvest miss) → **OD-097**.

**Decisions (operator delegated, "i trust your recs"):**
- **3 conflicts** resolved locked-spec-beats-stale-design: `parallel_execution_enabled`=false ·
  `embedding_model`=REBUILD (not BOOT) · `invite_link_ttl`≤24h / `access_token_ttl`=1h (design's 72h/7d
  were refuted by Block J).
- **2 class calls:** `entity_types`=BOOT · `default_model`/`lightweight_model`=BOOT.
- **OD-097** → C7 owns a small alert-routing config (`SLACK_WEBHOOK_URL` secret + `alert_routing_rules` /
  `escalation_contacts` / `quiet_hours` editable, Slack+email), recipients via C1 roles.

**Three-tier mental model agreed with operator (frames the whole phase):** Tier 1 = day-to-day record
management (users/roles/agents/memory curation) → Phase 3 surfaces + Phase 4 data, NOT config. Tier 2 =
harness tuning knobs → this registry. Tier 3 = secrets → env-only. "Customisable where it *should* be" =
bounded on purpose: the seven hard limits, sole-writer identity, and floored autonomy rows are
deliberately LOCKED, marked as such, never specced as editable.

**Downstream wiring captured (Appendix B):** 11 new `PERM-config.*` nodes owed to `PERMISSION_NODES.md`
(C1 FR-1.PERM.005); new `UI-config-admin` surface + 11 sections owed to Phase 3.

**C7 alert-routing addendum — DONE (change-control, same session).** OD-097's behavioural half realised as
**`FR-7.ALR.009`**: C7 owns the routing config; an alert with no deliverable destination fails loud (persists on the
dashboard + raises an "alert delivery misconfigured" critical condition on the mgmt-plane push); quiet-hours can
never silence a critical/hard-limit alert; a config write that would strand a critical alert is rejected fail-closed.
C7 header 33→34 FRs (ALR ×8→×9), matrix row added, OD-097 CLOSED. (Reuses the ALR.005/006/008 patterns.)

**Proposed defaults — CONFIRMED & locked** (operator: "as long as i can edit these later i am happy", 2026-06-27).
~30 knobs Phase 1 left blank were given starting defaults; `(proposed)` tags stripped. All are LIVE/BOOT —
operator-editable post-deploy via `UI-config-admin`. Confirmed editability was the operator's only condition.

**PHASE 2 SIGNED OFF (2026-06-27).** Registry complete + verification-CLEAN + OD-097 closed + defaults confirmed.
README Phase-2 row → 🟢 COMPLETE.

**Next: Phase 3 — Surfaces.** First surface to spec is `UI-config-admin` (the screen that renders this whole
registry, sectioned per group), then the Tier-1 day-to-day management screens (User Management, Permission Matrix,
Agent Builder, the 5 observability dashboards, memory navigation). Carry-in for Phase 3: Appendix B's new
`UI-config-admin` + 11 sections; the per-component panel-signal seams C7 left for Phase 3.

**Commits:** registry (f607751); C7 addendum (254a2ff); defaults-confirmed + sign-off to follow this entry.

---

## Session 27 — 2026-06-27 — COMPONENT 10 (INFRASTRUCTURE & COMPLIANCE) DRAFTED, VERIFIED & APPROVED — **PHASE 1 COMPLETE** 🎉

**The FINAL Phase-1 component** — the deployment / management-plane / lawful-deletion layer. Output:
`spec/01-requirements/component-10-infra-compliance.md` (**34 FRs, all Approved**), `system-map/10-infra-compliance.md`,
34 matrix rows, OD-089…OD-096 logged+resolved, feasibility **block U (AF-132…AF-137)**, OOS-033. **Two carry-in
Phase-1 debts cleared via change-control (OD-068, OD-074).** With C10 Approved, **Phase 1 (C0–C10, all 11 components)
is COMPLETE.** Next: Phase 2 (Config).

**The key scope finding (set with the operator up front):** the design doc's literal `## 10.` section (**L3919–4112**)
is **only compliance** (retention / individual erasure / client offboarding). The **infrastructure** half is decided
in the **ADRs (001/005/008)** and lives in orphaned design lines (deployment model L15–36, migration propagation
L1138–1160, the management plane / `client_registry` L1164–1240) that **no component C0–C9 claimed**. Since "every
design line → ≥1 FR, no orphans" is the definition of done and C10 is the last component, those orphans had to land
here. **Operator chose (AskUserQuestion): "functional infra + compliance in C10; backup/DR → Phase 5."** Backup/DR
(ADR-008) is only *referenced* — already routed to Phase 5 (C2 AC-2.MNT.017.2, README Phase-5 row).

**Area codes:** RET ×2 · DEL ×7 · OFF ×6 · PRV ×4 · MGT ×4 · DEP ×5 · MIG ×2 · ISO ×3 · LEG ×1. **C10 owns:** the
**intentional-retention** principle + retention configs · the **individual right-to-erasure** workflow (intake queue →
identify → conditional delete → redaction → audit → connector-flag → two-person auth; **wraps C2 FR-2.MNT.017**, does
not re-spec it) · the **client offboarding** workflow (trigger → verified export + client sign-off → retention-freeze
→ hard-delete/deprovision → compliance meta-record) · **provisioning** orchestration (ADR-005 §5) · the **release
model** (Railway auto-deploy · canary/release-train promotion gate · rollback-by-redeploy/no-down-migration ·
version-skew alert · plugins-out-of-train) · **schema-migration propagation** + per-deployment failure isolation · the
**management plane** (`client_registry` schema/lifecycle + the ingest endpoint, push-only, ADR-001 §7) · **isolation**
(`client_slug` deleted from app tables) + **residency** (v1 Sydney lock, v2 selection). **Seams:** erasure mechanics →
C2; log redaction → C7; token revocation → C3; seed → C0/C1; reporter+dashboards+staleness → C7; backup/DR → Phase 5;
rendering → Phase 3.

**Drafting:** two Explore subagents — one decomposed the §10 compliance lines, one mapped the infra ADRs + orphaned
deployment/management-plane design lines + checked what's already owned. Caught up front: cold-storage tiering is
**already OOS-016** (v2-deferred), not a new FR; individual erasure overlaps C2 FR-2.MNT.017 (C10 wraps, C2
mechanises).

**8 ODs resolved (OD-089…096), all delegated to recommendation; 5 touch the non-negotiables:** **OD-089 (#2/#3)**
offboarding partial-deprovision → `deletion_failed` + escalate, never-complete-on-partial, no-auto-rollback (OD-010
consistent). **OD-090 (#1)** export verified-complete **and** client-acknowledged = hard gate before destruction.
**OD-091 (#2/#3)** deployment-freeze enforcement → C10 sets `status=frozen`, **C5 dispatch layer enforces + fails
closed** (applied via change-control to **AC-5.TRG.001.3**, mirroring the C8 OD-081 memory-scope wiring). **OD-092
(#1/#2)** erasure name-in-content → deterministic auto, fuzzy human-confirm. **OD-093 (#2)** two-person auth = distinct
authoriser (no self-second). OD-094 (manual promotion v1), OD-095 (skew defaults 3/14). **OD-096 (#2 isolation, raised
in drafting):** the `client_slug` **label-vs-delete** tension — ADR-001 §3 (Accepted) says "deleted from all app
tables" but prior components reconciled only to "a label, not an RLS key." Carried to the **ADR terminus: delete**
(the column was never load-bearing; reverses no prior decision; Phase-4 creates no column).

**Verification gate (2 independent zero-context subagents):**
- **Orphan/contradiction pass — CLEAN.** Zero orphans (every §10 + infra cross-cut intent maps to an FR/seam/OOS),
  **all 6 traps PASS** (`client_slug` deleted + OD-096 reconciled · backup/DR seamed-not-owned · management plane
  push-only + metadata-only · erasure delegated to C2 · deletion deliberate-never-partial-silent · 10/10 citations
  sound), all 3 change-control edits consistent.
- **Quality/failure pass — 9 findings (2 HIGH, 4 MED, 3 LOW), ALL reconciled in-file.** **H1** a frozen deployment
  would false-alarm as *dead* (and a dead one could hide as *frozen*) → **+AC-10.OFF.004.4** (`status`
  server-authoritative, consumed by C7 staleness — frozen = expected-quiet not dead-alert, while Supabase
  project-health is still independently monitored — a #1 silent-deletion guard). **H2** export-verification could fail
  *open* → **+AC-10.OFF.002.4** (fails closed; only affirmative verified-complete advances). **M1** the C2 erasure C10
  calls had no verify-complete/fail-closed guarantee (OD-074 widened it across a C2→C7 boundary) → **+AC-10.DEL.003.4**
  (verify C2 complete before the audit-done) + **C2 AC-2.MNT.017.5** (verified-complete-or-fails-loud) + **AF-137**.
  **M2** fail-open in two-person-config / connector-flag-raise / ack-write → +AC-10.DEL.006.4 + AC-10.OFF.003.4. **M3**
  offboarding progress + meta-record must be management-plane-resumable → +AC-10.OFF.005.4. **M4** token revoke could
  orphan a live credential → +AC-10.OFF.005.5 (revoke first / re-driven). **L1** RET.001 had no enforcement consumer →
  +AC-10.RET.001.3 (C2 sole-writer + tombstone is the detector). **L2** header count fixed (34). **L3** neighbouring
  stale notes cleaned (C5 header, C7 carry-forward).

**Two Phase-1 debts cleared this session (change-control — the last component is where they had to land or leak past
Phase 1):**
- **OD-068** → wrote the owed **C6 FR-6.RTL.004** (cost-ladder enforcement: C7 meters → C6 decides → C5 executes;
  soft→throttle→hard-kill; never overrides a hard limit; every rung writes `guardrail_log`). OD-068 carry-forward
  CLOSED.
- **OD-074** → amended **C2 FR-2.MNT.017** (**AC-2.MNT.017.4**) to trigger the C7 log redaction-tombstone
  (`event_log`/`guardrail_log`) on erasure, called from C10 FR-10.DEL.004. The two stale C7 carry-forward notes
  flipped to ✅ CLOSED.

**Sign-off:** user-authorized 2026-06-27 ("i approve, push to github and main"; OD-089…096 delegated, the
C2/C5/C6/C7 change-control amendments accepted). **34 FRs `Approved`.** **No build-time viability gate holds any C10
FR** — AF-132…137 gate the deprovision/export/erasure/freeze/legal/erasure-verify *claims* (block U), not the FR
machinery.

**Files changed:** `component-10-infra-compliance.md` (new, 34 FRs Approved); `component-06-guardrails.md`
(+FR-6.RTL.004, OD-068); `component-02-memory.md` (+AC-2.MNT.017.4/.5, OD-074 + gate M1); `component-05-harness.md`
(+AC-5.TRG.001.3 freeze gate, OD-091; header note); `component-07-observability.md` (2 carry-forward notes → CLOSED);
`open-decisions.md` (OD-089…096 → 🟢; OD-068 carry-forward CLOSED; next OD-097); `feasibility-register.md` (block U
AF-132…137; next AF-138); `out-of-scope.md` (OOS-033; next OOS-034); `traceability-matrix.csv` (34 C10 rows);
`glossary.md` (+7 terms — client_registry, internal_token, client offboarding, deployment freeze, individual erasure,
deletion audit log, offboarding meta-record); `system-map/10-infra-compliance.md` (new); `system-map/README.md` (10 ✅
built); `README.md` (Phase 1 → COMPLETE + C10 row); this log.

**Carry-forwards / housekeeping:** (1) **Phase 4 (data model):** create **no `client_slug` column** in any app table
(OD-096); the three "label, not RLS key" mentions (C5 FR-5.QUE.002, C2, C6 `guardrail_log`) get a one-line clerical
reconciliation note then. (2) **Phase 3 surface seam (H1):** wire C7's staleness path to read `client_registry.status`
(frozen ≠ dead-alert) + independently monitor Supabase project-health — a small C10↔C7 seam at the C7/Phase-3 pass.
(3) New nodes to register at C1 reconciliation / Phase 2: the C9 `PERM-guardrail.edit_autonomy` + `/`-command nodes
(carried from session 26). (4) AF-132…137 + the carried-in AF-004/013/020/064/065/066/071 are build-time MUST-TEST.

**NEXT STEP — Phase 1 is COMPLETE. Begin Phase 2 (Config registry).** Per the README plan: classify + surface every
tunable — "every CFG has a surface + edit-mechanism + validation; zero `???`." The `CFG-*` ids scattered across
C0–C10 FRs (e.g. C10's `client_offboarding_retention_days`, `deploy_max_version_skew`, `canary_soak_minutes`,
`deployment_region`; the C9 autonomy matrix; the C6 thresholds; the C2/C5 windows) are the raw input — Phase 2
consolidates them into the config registry (`spec/02-config/`). Read `phase-playbooks.md` for the Phase-2 procedure
before starting.

---

## Session 26 — 2026-06-27 — COMPONENT 9 (PROACTIVE INTELLIGENCE) DRAFTED, VERIFIED & APPROVED — "what it does without being asked"

Tenth Phase-1 component, the **proactive-generation + cold-start-gating + chat-command layer**. Output:
`spec/01-requirements/component-09-proactive.md` (**28 FRs, all `Ready`**, gate-clean, **awaiting operator
sign-off**), `system-map/09-proactive.md`, 28 matrix rows, OD-082…OD-088 logged+resolved, feasibility block T
(AF-127…AF-131), OOS-031/032. A C6 Approved FR amended via change-control (OD-088). Pattern-matched the C0–C8 loop.

**C9 = "what it does without being asked"** (L3654). Area codes: MODE ×4 · PRO ×7 · SUG ×5 · CST ×7 · CMD ×5. C9 owns
the **three proactivity modes** (Suggest/Prepare/Act, mode = f(C6 risk tier), **no-bypass** — every Act traverses the
same C6 pipeline), the **7 generators** (relationship/meeting/doc/derisking/opportunity/daily-briefing/pattern; each
independently enable/disable-able + thresholded), the **suggestion lifecycle** (`proactive_suggestions` store, rank /
explain-with-pill / deliver-route / **dismissal-learn-with-floor**), the **cold-start phase ladder** (consumes C2's
phase, owns proactive-suppression), and the `/` **command dispatch** (node-gated). Enforcement → C6, slow-loop +
briefing trigger → C5, Insight-Agent def → C8, coverage/`[Building]` → C2, delivery → C7, all rendering → Phase 3.

**Scope call (entry): generation + cold-start policy + command dispatch now; enforcement / delivery / surfaces / the
coverage metric stay seamed.** A large fraction of section 9 is owned by Approved components (the coverage metric
already C2 FR-2.MAT.002/RET.007; the slow loop C5 FR-5.LOP.001; the Insight Agent C8 FR-8.SPC.006; notification C7;
guardrails C6). C9 **produces** proactive items + assigns mode + gates the engine; home components enforce/schedule/
deliver/render. Mirrors C8's "produce signals, others act" + C7's "backbone now, surfaces → Phase 3."

**The founder-holiday problem (L3792–3864)** is handled as an **integration narrative** (no orphan — the 8
break-points map to C2/C4/C5/C6/C7/C8/C9); the founder-prep checklist + initialisation guide = operational documents
→ **OOS-031/032**.

**7 ODs delegated + 1 operator-decided (OD-082…OD-088):** OD-082 dedicated `proactive_suggestions` store
(never-dropped; Prepare → linked C5 task). **OD-083 (#2)** proactive Act never bypasses C6 (no second risk
classifier). **OD-084 (#1/#3)** dismissal-learning floor — tunes *volume*, never *safety*; a derisking signal is never
silenced + re-surfaces on escalation. OD-085 cold-start: C2 emits phase, C9 owns policy matrix + suppression, rest
seamed. **OD-086 (#2, contradiction caught)** `/`-command gating → **C1 permission nodes, not the design's "Agency
Owner" role** (which is NOT one of C1's six — same class as C7/C8 `client_slug`). OD-087 founder docs → OOS.
**OD-088 (operator-decided #2 → option b)** — the **configurable action-autonomy matrix**: the operator flagged that
C6's blanket "all external comms = hard" (FR-6.APR.002) is too blunt — a cold-lead nurture email can't even be
drafted. Split: **low-risk external** (cold-lead / templated nurture to **non-client** contacts) → configurable down
to Prepare or up to **Act after a trust period** (rate-capped + audited); **floored** (existing-client / SoR comms,
financial, Confidential/Restricted) → **fixed at hard, never configurable below**. **Applied via change-control to
C6 FR-6.APR.002 + FR-6.APR.003** (narrow the mandatory-hard "external" element; reconcile the no-irreversible-auto
rule to "floored-external") + **new FR-9.MODE.004** (the matrix + the floor; `CFG-action_autonomy_matrix`; edits
gated `PERM-guardrail.edit_autonomy` Super-Admin). Also added: each of the 7 PRO scanners individually
enable/disable-able (default on) + thresholds → `CFG-scanner_*_enabled` refs for Phase 2.

**Verification gate (2 independent zero-context subagents):**
- **Orphan/contradiction pass — CLEAN.** Every intent L3650–3918 maps to an FR / correct seam / OOS; **all 6 traps
  PASS** (no "Agency Owner" role — node gating · consumes C2 coverage, never recomputes · proactive Act never
  bypasses C6 · OD-088 floored set can't be lowered to Act/Prepare · Insight Agent not redefined / no second writer ·
  14/14 citations verified); no `client_slug`. Two editorial nits fixed (stale FR count; a MAT.002/003 citation).
- **Quality/failure pass — critical floor-check NO HOLE + 9 findings (2 HIGH, 4 MED, 3 LOW), ALL reconciled.** The
  **operator-requested critical check** confirmed **nothing financial / existing-client / SoR / Confidential /
  Restricted can reach autonomous Act** through the new matrix — defended in depth (write-time reject 004.2 →
  mode-assign floor 002.2 → C6 tier floor AC-6.APR.002.1/.3 → ambiguity-defaults-floored 004.3 → non-overridable
  hard-limit backstop), OD-056 irreversibility exception bounded to non-client low-risk + rate-capped. **H1** (the
  residual the floor-narrowing *introduced*): a *confident-but-wrong* client/content tag is the one unguarded route →
  **+AC-9.MODE.004.5** (re-resolve recipient client-status vs the system-of-record **at send time**, re-floor on
  match) + **AF-131** (classification-accuracy EVAL). **H2** Insight-detected escalating risks have no C6/C7 path →
  sharpened AC-9.CST.002.3 + **+AC-9.PRO.004.4** (OD-084 floor spans dismissal **+** cold-start suppression **+**
  scanner-disable). **M1** deferred floor item silent-expiry → +AC-9.SUG.002.3. **M2** stuck-`generated` →
  +AC-9.SUG.001.4 (escalate-don't-abandon). **M3** node-gate-before-confirm + `/forget`→C2 trace → +AC-9.CMD.003.3.
  **M4** floored-caps-mode precedence → +AC-9.MODE.004.6. **L1** scan-execution liveness, **L2** stale-phase
  fail-open, **L3** audit-critical command fail-closed on log failure — all added.

**Sign-off:** user-authorized 2026-06-27 ("i am happy"; OD-082…087 delegated, OD-088 operator-decided, the C6
change-control amendment accepted). **28 FRs `Approved`**; matrix rows + headers + README + system-map README flipped
to Approved; committed + pushed to `main`. **No build-time viability gate holds any C9 FR** — AF-127…131 gate the
detection/learning/ranking/ETA/tag-accuracy *claims* (block T), not the FR machinery; **AF-131** is the load-bearing
one (the OD-088 floor's #2 safety rests on the non-client/content classifier).

**Files changed:** `component-09-proactive.md` (new, 28 FRs Ready); `component-06-guardrails.md` (FR-6.APR.002/003
amended, change-control OD-088); `open-decisions.md` (OD-082…088 → 🟢; next OD-089); `feasibility-register.md` (block
T AF-127…131; next AF-132); `out-of-scope.md` (OOS-031/032; next OOS-033); `traceability-matrix.csv` (28 C9 rows);
`glossary.md` (+6 terms — proactivity mode, proactive suggestion, cold-start phase, action-autonomy matrix, floored
external comms, dismissal-learning floor); `system-map/09-proactive.md` (new); `system-map/README.md` (09 ✅ built);
`README.md` (status + Phase-1 row); this log.

**Carry-forwards / housekeeping:** (1) **AF-131** (non-client/content classification accuracy) is the new
load-bearing build-time gate — the OD-088 floor's #2 safety rests on it; MUST-TEST. (2) The OD-088 + OD-086 new nodes
(`PERM-guardrail.edit_autonomy` Super-Admin; the per-command `/` gating nodes) to register at the C1 reconciliation /
Phase-2 config. (3) Still owed from earlier: the **C6 cost-ladder enforcement FR** (OD-068) + **C2 FR-2.MNT.017**
log-sink erasure amendment (OD-074). (4) AF-127…131 are build-time MUST-TEST.

**NEXT STEP — component 10 (Infrastructure & Compliance), the FINAL Phase-1 component.** Design-doc section
**`## 10. Infrastructure & Compliance` = L3919+** (confirm the end bound — `## Where the quality actually lives` at
L4113 is likely the next `##`). Pattern-match the C0–C9 loop: Context Manifest → decompose → cite → log ODs (next
**OD-089**; new AFs from **AF-132**; next OOS **OOS-033**) → resolve → verification gate (2 zero-context subagents) →
sign-off → wire matrix + build `system-map/10-infra-compliance.md`. **C10 is where the deployment/infra ADRs land:**
ADR-001 (Silo isolation + hybrid ownership + the management plane), ADR-005 (deploy/provisioning — canary +
release-train + scripted provisioning), ADR-008 (backup/DR — hourly client-owned snapshot + PITR upsell +
operator-verified restore), and the **compliance** surface (data residency, the GHL PHI/BAA chain AF-098, erasure
already homed in C2 FR-2.MNT.017 + C7 redaction-tombstone). **Carry-ins:** the owed C6 cost-ladder FR (OD-068) + C2
MNT.017 log-sink amendment (OD-074); the self-hosted-Inngest deferral (OOS-028); build-time spikes AF-001/002/004 +
the provisioning AF-004; backup/DR block I (AF-069…072). **C10 may be a connector-research trigger** only if it
introduces a new external sink (e.g. a paging/infra vendor). **First, finish C9: get the operator's sign-off + commit.**

---

## Session 25 — 2026-06-26 — COMPONENT 8 (AGENT DESIGN) DRAFTED, VERIFIED & APPROVED — "who does the work"

Ninth Phase-1 component, the **routing + agent-definition layer**. Output: `spec/01-requirements/component-08-agent-design.md`
(**37 FRs, all Approved**), `system-map/08-agent-design.md`, 37 matrix rows, OD-075…OD-081 logged+resolved, feasibility
block S (AF-121…AF-126), OOS-030. Pattern-matched the C0–C7 loop end-to-end in one session.

**C8 = "who does the work"** (vs C5 what makes it run). Area codes: ORC ×8 · REG ×6 · SPC ×6 · SCO ×3 · PLAN ×4 ·
HLTH ×4 · LRN ×3 · COST ×3. C8 owns the **orchestrator + 7-step description-driven routing**, the **`agents`
registry** (data-driven, versioned, auto-discovered), the **8 specialist definitions** + their hard limits,
**per-agent memory scoping**, **per-step failure-mode ASSIGNMENT** (C5 executes), **agent-health / drift /
dead-agent metric PRODUCTION** (flag-never-auto-correct), **orchestrator learning + result caching**, and
**cost-routing by complexity** + the confidence dial.

**Scope call set at entry: routing + definitions + metric-production now; execution / surfaces / healing stay
seamed.** A large fraction of the design section (L3371–3649) is already owned by Approved components — the context
envelope + retry/skip/halt execution + parallel/warm-up/checkpoints (C5), self-healing mechanisms (C2/C3/C5), the
dashboards (C7 + Phase 3), suggestion generation (C9), cost metering/enforcement (C7/C6), prompt content (C4). C8
**produces signals**; their home components surface/enforce/act. This kept C8 at 37 FRs and mirrors C6's "seam, don't
absorb" + C7's "backbone now, surfaces → Phase 3."

**Drafting:** an Explore subagent decomposed L3371–3649 + the cross-cut sites (checklist L321–335, `agents_config`
L945–965, failure-map drift/dead-agent rows L2845–2847, observability intervals L3120–3128/L3210–3220, orchestrator
own Layer 1 L2390) into ~112 intents pre-classified C8-OWN vs SEAM→Cx. Read the primary section directly to ground
the routing/registry/scoping cites. **Carried in OD-048's deferral** — `agents.system_prompt` reconciled here.

**7 ODs logged then resolved (OD-075…OD-081), 3 user-delegated #1/#2/#3:** **OD-076 (#1)** agent result cache →
scope-aware + time-bounded invalidation (write-triggered by the Memory Agent commit, miss-on-uncertainty — never a
stale hit). **OD-077 (#3)** low-confidence clarification → tracked + escalating (reuse C5 AC-5.QUE.005.2), never
silent park/auto-proceed. **OD-080 (#2)** registry edits → split by authority: capability grants
(memory_scope/tools_allowed/enabled) = Super Admin only; description/weight tuning = Super Admin + Admin. Plus
OD-075 (drop `system_prompt`, closes OD-048), OD-078 (drift/dead-agent flag-only, never auto-disable), OD-079 (seed
roster at provisioning). **All delegated** ("accept all my recommendations"). **OD-081 (#2)** was raised *by the
gate* — see below.

**Verification gate (2 independent zero-context subagents):**
- **Orphan/contradiction pass CLEAN** — every intent L3371–3649 + cross-cut sites maps or is correctly seamed; 5/6
  traps PASS, the 6th (citations) clean in spot-check. **Caught a real contradiction:** the design's
  `agents.client_slug` column contradicts **ADR-001 §3** (Silo model deletes `client_slug` from app tables) — C8
  was mis-citing ADR-001 §3 to *keep* it. **Dropped the column**, mirroring C7 OD-067; AC-8.REG.001.3 rewritten.
  Plus a dead citation `FR-2.RST.003` → `FR-2.RET.006`/`C1 FR-1.RST.003`, and `FR-5.TRG.*` slow-loop → `FR-5.LOP.001`.
- **Quality/failure pass — 10 findings (3 HIGH, 4 MED, 3 LOW), ALL reconciled.** **H1 (the structural hole):** the
  per-agent `memory_scope` matrix (the whole SCO area) had **NO enforcement consumer** — C2 enforces clearance/RLS,
  C5 FR-5.ASM.006 invokes it with task-clearance + task-entities, but nothing applied "which agent is running" at
  retrieval (#2 unwired, most acute for the `service_role` orchestrator narrowed by *nothing*). → **OD-081 resolved +
  applied via change-control** (the C7 in-session-fix precedent): **+AC-5.ASM.006.2** (harness passes the agent's
  `memory_scope` into the C2 read, **fails closed**) + **+AC-2.RET.004.2** (C2 drops out-of-agent-scope candidates
  before ranking, narrow-within-clearance); SCO.001 rewritten as a real retrieval filter (+AC-8.SCO.001.3
  fail-closed). **H2** orchestrator crash mid-route (dequeue→plan-persist) → +AC-8.ORC.001.3 idempotent re-route,
  never dequeued-but-unplanned. **H3** metric-producer silent stall → +AC-8.HLTH.004.2 producer liveness/heartbeat
  for HLTH.001/003 + LRN.002 (mirrors HLTH.002.2 + C5 AC-5.JOB.006.2). MED/LOW: +AC-8.LRN.003.2/.3 (write-triggered
  cache invalidation + miss-on-uncertainty, M4), ORC.008 service_role note (M5), +AC-8.SPC.003.3/.004.3 +
  AC-8.REG.006.3 (Comms/Finance tool-grant reject-at-write + positive seed check, M6), C6 cost-ladder carry-forward
  kept tracked (M7), +AC-8.ORC.007.2 secondary sink (L8), +AC-8.REG.005.3 warn-at-disable-last-agent (L9),
  +AC-8.PLAN.002.2 halt-escalate staleness (L10). Meta: C8 upholds the three non-negotiables; the biggest residual
  (H1) is now wired, not asserted.

**Sign-off:** user-authorized ("Sign off — Approve C8"; OD resolution delegated). 37 FRs `Approved`. **No build-time
viability gate holds any C8 FR** — AF-121…126 gate the routing/detection/cache/learning *accuracy claims*, not the
FR machinery (gate analog of C4 AF-111 / C6 block-Q / C7 block-R).

**Files changed:** `component-08-agent-design.md` (new, Approved); `component-05-harness.md` (+AC-5.ASM.006.2,
change-control OD-081); `component-02-memory.md` (+AC-2.RET.004.2, change-control OD-081); `open-decisions.md`
(OD-075…081 → 🟢; next OD-082); `feasibility-register.md` (block S AF-121…126; next AF-127); `out-of-scope.md`
(OOS-030; next OOS-031); `traceability-matrix.csv` (37 C8 rows); `glossary.md` (+7 terms — agent registry, memory
scope, routing/confidence score, drift/dead-agent detection, agent result cache, execution-plan version);
`system-map/08-agent-design.md` (new); `system-map/README.md` (08 ✅ built); `README.md` (status + Phase-1 row); this log.

**Carry-forwards / housekeeping:** (1) The **C6 cost-ladder enforcement FR** is still owed (OD-068) — C8 feeds it
(COST.003) but the throttle/kill enforcer doesn't exist; action when C6 is next touched. (2) AF-121…126 are
build-time MUST-TEST. (3) The OD-080 permission split implies new nodes `PERM-agent.edit_capability`
(Super-Admin-only) vs `PERM-agent.edit_routing` (Admin-allowed) — to wire at the C1 reconciliation / Phase-2 config.

**NEXT STEP — component 9 (Proactive Intelligence).** Design-doc section **`## 9. Proactive Intelligence` = L3650+**
(confirm the end bound + next `##` at decomposition). Pattern-match the C0–C8 loop: Context Manifest → decompose →
cite → log ODs (next **OD-082**; new AFs from **AF-127**; next OOS **OOS-031**) → resolve → verification gate (2
zero-context subagents) → sign-off → wire matrix + build `system-map/09-proactive.md`. **C9 is where many C8/C7
seams land:** the **Insight Agent** (C8 SPC.006 produces its output; C9 owns the proactive/pattern generation), the
**self-improvement panel suggestions** (C7 reserves the surface + C8 produces the agent-health/drift/routing metrics;
C9 turns them into surfaced/guided suggestions — "agent X 40% failure", "version 3 outperformed 4", "type Y
rerouted"), and the **three proactivity modes** (L3658+). **Likely seams out:** the dashboards → C7 + Phase 3;
enforcement → C6; memory mechanisms → C2; routing metrics → C8 (done). **Carry-ins:** the C6 cost-ladder FR (owed,
OD-068) · build-time spikes AF-001/002/004 · the C8 block-S AFs · AF-068/116/117. **C9 is NOT a connector
component** (no research-first gate) unless it introduces a new external sink.

---

## Session 24 — 2026-06-26 — COMPONENT 7 (OBSERVABILITY) DRAFTED, VERIFIED & APPROVED — "how you know what it's doing"

Eighth Phase-1 component, the **observability backbone**. Output: `spec/01-requirements/component-07-observability.md`
(**33 FRs, all Approved**), `system-map/07-observability.md`, 33 matrix rows, OD-067…OD-074 logged+resolved,
feasibility block R (AF-118…AF-120), OOS-028/029. Pattern-matched the C0–C6 loop end-to-end in one session.

**C7 = "how you know what it's doing"** — the data + logic layer of the three pillars (logging · monitoring ·
alerting). Area codes: LOG ×7 · RTP ×4 · ALR ×8 · COST ×4 · MGM ×5 · VIEW ×3 · OPT ×2. C7 owns the `event_log`, the
real-time-vs-polling contract, alerting (the 7 rules + routing + escalation + the engine watchdog), the cost meter +
ladder signal, the management-plane cross-deployment push (ADR-001 §7) + backup-health (ADR-008), and log
retention/export (incl. the C7 side of `guardrail_log`).

**Scope decision set with the operator up front: backbone now, surfaces → Phase 3.** C7 specs the observability
*functions* as Phase-1 FRs; the five role dashboards (Super Admin · Operations · Manager · Standard User · Mobile)
get only a thin "this view exists + RBAC-routed + sources these signals" contract, with full layout/state deferred
to the dedicated Phase-3 Surfaces pass. Each panel's *signal* is produced by its home component (C2/C3/C5/C6/C8/C9) —
C7 displays, it does not recompute. This kept C7 at 33 FRs and avoided both duplicating Phase 3 and usurping the
producing components. Mirrors C6's "seam, don't absorb" call. **The operator chose this** (vs full-dashboards-in-C7).

**Drafting:** an Explore subagent mapped L3031–L3328 → 80 intents + candidate area codes + the cross-cut sites that
land in C7. Read the primary section directly to ground the `event_log`/alerting/polling cites. **Caught up front:**
the `event_log` (L3048) + `guardrail_log` (L2896) schemas + the Realtime filters (L3085/3159) carry `client_slug` —
stale under the Silo model (ADR-001 §3 deleted it). Also grounded the cross-deployment views as **push,
operational-metadata-only** (ADR-001 §7), cost as **estimate-grade never the invoice** (ADR-003), and the three
distinct log sinks (OD-065).

**8 ODs logged then resolved (OD-067…OD-074), 2 user-decided:** **OD-068 (#2, user-decided)** cost-ladder enforcement
ownership → **C7 meters + signals, C6 decides, C5 executes** — grounded in **ADR-003 §"Guardrails component"** (the
cost ladder IS a C6 guardrail class). **OD-074 (#1/compliance, user-decided, surfaced by the gate)** erasure vs
append-only logs → **redaction-tombstone** (scrub PII in place, retain row + audit metadata). OD-067 (client_slug
drop intra-silo), 069 (escalate-don't-abandon), 070 (Slack-independent notification durability), 071 (stale-not-green
push), 072 (three-sink retention), 073 (per-silo connection budget + degrade-to-polling) — all delegated, all land
on (a).

**Verification gate (2 independent zero-context subagents):**
- **Orphan/contradiction pass CLEAN** — zero orphaned design lines (every intent L3031–3328 + checklist L304–326 maps
  or is correctly seamed — surfaces→Phase 3, signals→home components, cost-enforcement→C5/C6); no contradictions with
  ADR-001/003/008, glossary, or consumed C1–C6 FRs; **all 6 traps PASS** (`client_slug` label-only · cross-deployment
  PUSH-not-pull, never mirrors business data · three distinct log sinks, C7 owns guardrail_log view/retention/export
  not its write-completeness · cost estimate-grade never the invoice · surfaces→Phase 3 no signal usurpation · 10/10
  citations clean). One finalization item (registers not yet wired) — done this session.
- **Quality/failure pass — 13 findings (4 HIGH, 5 MED, 4 LOW), ALL reconciled.** The reviewer's meta-finding: C7 has
  the strongest #3 instincts of any component so far; the residual risk was **the observability layer becoming its
  own silent single point of failure**, plus two real cross-component seam holes. **F1 (HIGH)** cost-ladder
  enforcement seam: verified against **ADR-003 §"Guardrails component" (L181–182)** → OD-068(a) is correct; the
  contradiction was **C5's seam line ("C7 enforces") + C6's never-written cost-ladder FR** → C5 line **corrected via
  change-control** (2 spots), the owed **C6 cost-ladder FR logged as a tracked carry-forward**, FR-7.COST.003
  re-cited to ADR-003. **F2 (HIGH)** → +AC-7.MGM.002.3 (independent-heartbeat stale-evaluator — the stale-detector
  can't itself fail silently) + AC-7.MGM.001.3 (reporter logs each push to the *local* event_log). **F3 (HIGH)/OD-074**
  → redaction-tombstone (+AC-7.LOG.006.3 / .007.4; **C2 FR-2.MNT.017 amendment owed** — carry-forward). **F7 (HIGH)**
  → +FR-7.ALR.008 (alert-engine heartbeat + independent watchdog — "the watcher is watched"). **F8** → AC-7.LOG.003.2
  out-of-band degraded path. **F9** → +AC-7.LOG.003.3 cross-sink event_log↔guardrail_log reconciliation. **F6** →
  server-authoritative timestamps (AC-7.MGM.002.4 / AC-7.ALR.005.3). **F10/F11/F12** → cost-unknown sentinel,
  configurable connection-headroom threshold, pill-coverage thresholding seamed to C2. **F4/F5** → registers wired +
  statuses reconciled. AF-118 (absence-of-signal liveness), AF-119 (out-of-band durability), AF-120 (clock-sync) —
  all build-time, none holds an FR.

**Sign-off:** user-authorized — OD-068 + OD-074 decided directly, the rest delegated; gate clean + all 13 findings
reconciled in-file. 33 FRs `Approved`. **No build-time viability gate holds any C7 FR** (AF-118…120 gate the
silent-failure-detector *liveness/durability/correctness claims*, not the FR machinery — gate analog of C6's block-Q).

**Files changed:** `component-07-observability.md` (new, Approved); `component-05-harness.md` (cost-ladder seam line
corrected, change-control); `open-decisions.md` (OD-067…074 → 🟢; next OD-075); `feasibility-register.md` (block R
AF-118…120; next AF-121); `out-of-scope.md` (OOS-028 self-hosted Inngest, OOS-029 cross-deployment benchmarking;
next OOS-030); `traceability-matrix.csv` (33 C7 rows); `glossary.md` (+7 terms — notification centre, Supabase
Realtime, health reporter/push, staleness window, cost meter, answer-mode pill, redaction-tombstone);
`system-map/07-observability.md` (new); `system-map/README.md` (07 ✅ built); `README.md` (status + Phase-1 row); this log.

**Carry-forwards / housekeeping:** (1) **C2 FR-2.MNT.017** owes a change-control amendment to extend its transitive
erasure walk to `event_log` + `guardrail_log` (redaction-tombstone, OD-074). (2) The **C6 cost-ladder enforcement
FR** is owed — ADR-003 spawned it but C6 (session 23) didn't write it; tracked in OD-068; action when C6 is next
touched. (3) AF-118/119/120 are build-time MUST-TEST.

**NEXT STEP — component 8 (Agent Design).** Design-doc section **`## 8. Agent Design` = L3371–L3649** (next
`## 9. Proactive Intelligence` at L3650). Pattern-match the C0–C7 loop: Context Manifest → decompose → cite → log ODs
(next **OD-075**; new AFs from **AF-121**; next OOS **OOS-030**) → resolve → verification gate (2 zero-context
subagents) → sign-off → wire matrix + build `system-map/08-agent-design.md`. **C8 is where many C5/C7 seams land:**
the **orchestrator** (routing + confidence threshold — "the highest-leverage single tunable for cost vs quality",
L3632), the **agent registry** (`agents.system_prompt` — reconcile with C4 OD-048's unify-on-`prompt_layers`
decision), **agent specialisation drift detection** (L3642 — C7 reserves the surface, C8 produces the metric), and
**agent health / success-rate** metrics (C7 VIEW.001 displays them). **C8 also resolves the `agents.system_prompt`
single-source-of-truth** that C4 OD-048 deferred to C8. Likely seams out: observability/event-log → C7 (done);
proactive/insight-agent → C9; infra → C10. **Carry-ins:** the C6 cost-ladder enforcement FR (if C8 touches
orchestration cost), build-time spikes AF-001/002/004, AF-068/116/117, the C5 block-P + C7 block-R AFs. **C8 is NOT a
connector component** (no research-first gate) unless it introduces a new external sink.

---

## Session 23 — 2026-06-26 — COMPONENT 6 (GUARDRAILS) DRAFTED, VERIFIED & APPROVED — "what stops it doing something catastrophic"

Seventh Phase-1 component, the **enforcement layer** ("the code half" of system safety). Output:
`spec/01-requirements/component-06-guardrails.md` (**35 FRs, all Approved**), `system-map/06-guardrails.md`, 35
matrix rows, OD-060…OD-066 logged+resolved + carry-forwards **OD-047** and **OD-010** resolved, feasibility
block Q (AF-116…AF-117). Pattern-matched the C0–C5 loop end-to-end in one session.

**C6 = "what stops it doing something catastrophic"** (vs C5 what makes it run). Area codes: HRD ×4 · APR ×6 ·
ANM ×5 · RTL ×3 · ESC ×4 · INJ ×6 · LOG ×4 · OPT ×2 · FMM ×1. C6 owns the code-side enforcement of the four
guardrail layers (hard limits · approval gates · anomaly detection · rate limits), the escalation/flagged
workflow, the 4-step injection sanitization pipeline, the `guardrail_log`, and the optimisations. **ADR-007 is the
spine** (containment-first; detection-as-signal; semantic scan off-by-default; quarantine retains-not-discards;
0.85/0.95 are signal knobs not safety dials).

**Two scoping calls set up front (the architectural judgment):** (1) **the failure-mode map (L2821–2862) stays
SEAMED, not absorbed** — it's a cross-component catalogue; each row's detection lives in its home component
(C2/C3/C5/C8) + alert path is C7; C6 owns only the guardrail-class responses + the no-silent invariant (OD-061).
This kept C6 at 35 FRs instead of ballooning to 60+ and usurping C2/C3/C5/C8. (2) **hard limits are the
un-overridable layer, kept distinct from approval gates** (which ARE human-overridable) — L2066 vs L2782.

**6 new ODs + 2 carry-forwards resolved (OD-060…066 + OD-047 + OD-010):** **OD-047** (carry-forward, operator's
C3 flag) → **keep the seven hard limits absolute; gate-don't-promote coverage gaps** (bulk export / mass-delete /
connector spend route to hard-approval + rate caps, not new absolute limits — they keep a legitimate
human-authorized path); enforceability still gated on **AF-068**. **OD-060** (#2) → hard-limit hit = block+log+
alert, **no approve affordance** (the `status→approved` transition is invalid for `hard_limit`). **OD-064** (#2) →
soft-approval auto-executes **reversible-only** (irreversible is hard-tier by definition, reconciling C5 OD-056).
**OD-010** (#2, carry-forward) → **no auto-rollback** of external side effects (auto-compensation is itself an
autonomous action); instead show already-applied effects at review + queue a **human-visible cleanup task**;
irreversible effects surfaced as non-compensable. OD-061 (failure-map scope), OD-062 (rate-limit ownership split),
OD-063 (anomaly-as-signal severity), OD-065 (guardrail_log vs access_audit/event_log), OD-066 (semantic-off +
regex-quarantine) delegated to recommendation. **The four #2-touching (047/060/064/010) were surfaced to the
operator, who delegated** ("what do you suggest").

**Verification gate (2 independent zero-context subagents):**
- **Orphan/contradiction pass CLEAN** — zero orphans (all L2746–3030 + the L2053–2066 / L2976–2980 cross-cuts map
  or are correctly seamed), no contradictions with ADR-007/003/004/006, glossary, or consumed C0/C1/C3/C4/C5 FRs;
  **all 6 traps PASS** (`client_slug` label-only · C6 never usurps C2/C3/C5/C8 detection — the failure-map scope ·
  hard-limit-not-overridable kept distinct · semantic-scan off-by-default + thresholds are signal knobs +
  quarantine retains · anomaly-as-signal · 12 citations spot-checked, no miscites).
- **Quality/failure pass found 12 findings (3 HIGH, 6 MED, 3 LOW), ALL reconciled in-file.** The reviewer's
  meta-finding: the posture-level safety logic was already sound; the real risk was **mechanism wiring** — a
  guardrail correctly designed but never run, or failing open. The 3 HIGH closed exactly those: **+AC-6.INJ.001.2**
  (the injection pipeline's named harness call site between tool-read and AI-call + a C5 step-order
  reconciliation note — H1, the silent-bypass seam); **+AC-6.FMM.001.3** (a guardrail check that **itself errors**
  fails CLOSED — the missing #3 invariant, H2); **+AC-6.LOG.003.3** (a `guardrail_log` write-failure is
  fail-closed — the block holds even if the row fails, never rolls back into the action proceeding — H3). MED/LOW:
  +AC-6.APR.005.3 (no self-approval at the human tier — initiator ≠ approver, M1), +AC-6.ESC.001.3 (multi-fire
  precedence — hard_limit dominates, M2), manifest tightened (mid-task re-check mechanism is C5 FR-5.ASM.005, M3),
  +AC-6.ESC.004.3 (every wait-point has a named staleness owner, M4), +AC-6.INJ.006.4 (quarantine-review
  staleness, M5), +AC-6.OPT.001.2 (un-actioned candidate persists, M6), +AC-6.LOG.001.3 (`pending` disambiguation,
  L1), AC-6.RTL.001.1 meaningful-ceiling clause (L2), OD-047 sub-question CLOSED so no open sub-question points at
  an Approved FR (L3). Confirmed great-tier: ADR-007 reconciliations faithful, hard-limit-vs-approval split handled
  at three layers (FR + AC + schema-status), failure-map scope discipline, OD-010's no-auto-rollback care.

**Sign-off:** user-authorized (delegated, "what do you suggest" on all four #2-touching ODs). 35 FRs `Approved`.
**No build-time viability gate holds any C6 FR** — AF-068 gates the *enforceability claim* of the hard limits
(HRD.001/OD-047), AF-116 the anomaly-accuracy claim, AF-117 the injection-library-coverage claim (the gate analog
of C4's AF-111 / C5's block-P).

**Files changed:** `component-06-guardrails.md` (new, Approved); `open-decisions.md` (OD-047 + OD-010 → 🟢,
OD-060…066 added → 🟢; next OD-067); `feasibility-register.md` (block Q AF-116…117; next AF-118);
`traceability-matrix.csv` (35 C6 rows); `glossary.md` (+7 terms — approval tier, anomaly detection, guardrail_log,
escalation timeout, contextual approval routing, quarantine, flagged); `system-map/06-guardrails.md` (new);
`system-map/README.md` (06 ✅ built); `README.md` (status table + Phase-1 row); this log.

**Carry-forward / housekeeping:** (1) **C5 step-order reconciliation (INJ.001.2)** — C5 FR-5.ASM.007's step order
should name the injection-sanitization step explicitly (it currently names only the anomaly check); raised as a
C5 change-control note, to action when convenient (does not block C7). (2) The self-hosted-Inngest deferral
(C5 FR-5.JOB.007) still owes an OOS id at C6/C10 — **deferred to C7/C10** (next OOS = OOS-028); not homed this
session as C6 didn't touch the Inngest hosting question. (3) AF-068/116/117 are build-time MUST-TEST.

**NEXT STEP — component 7 (Observability).** Design-doc section **`## 7. Observability` = L3031–L3328** (next
`## The complete system loop` at L3329, then `## 8. Agent Design` at L3371). Pattern-match the C0–C6 loop:
Context Manifest → decompose → cite → log ODs (next **OD-067**; new AFs from **AF-118**) → resolve → verification
gate (2 zero-context subagents) → sign-off → wire matrix + build `system-map/07-observability.md`. **C7 is where
many C5/C6 seams land:** the **event_log** + metrics sinks, **alert delivery** (the dashboard alerts + admin Slack
that C6 HRD.002/ESC.002 *require* but C6 produces only the event), the **guardrail_log dashboard view + retention
+ tamper-evidence + export mechanism** (C6 LOG.004 owns completeness, C7 owns where it lives), the **cost-ladder
enforcement** (ADR-003; C5 feeds, C7 enforces), the **management-plane push / backup-health** (ADR-008, ADR-001
§7), **access_audit retention** (C1 OD-024 seamed retention to C7), the **answer-mode pill rendering** + prompt-
health signals (C4/C2 seamed to C7/C8). Likely seams out: orchestrator → C8; enforcement → C6 (done). Carry-ins:
OD-010 (now resolved for C5/C6) · build-time spikes AF-001/002/004 · AF-068/116/117 · the C5 block-P AFs ·
the management-API field gaps AF-070/071. **C7 is NOT a connector component** (no research-first gate) unless it
introduces a new external sink (e.g. a metrics/paging vendor) — if it does, that triggers the
`tool-integration-research.md` gate.

---

## Session 22 — 2026-06-26 — COMPONENT 5 (AGENT HARNESS) DRAFTED, VERIFIED & APPROVED — "what makes it run"

Sixth Phase-1 component, the **execution layer**. Output: `spec/01-requirements/component-05-harness.md`
(**43 FRs, all Approved**), `system-map/05-harness.md`, 43 matrix rows, OD-054…OD-059 logged+resolved,
feasibility block P (AF-112…AF-115). Pattern-matched the C0–C4 loop end-to-end in one session.

**C5 = "what makes it run"** (vs C2 what it knows, C3 what it can do, C4 what it is). Area codes: TRG ×5 ·
QUE ×6 · GRP ×4 · ENV ×3 · LOP ×5 · JOB ×7 · ASM ×9 · OPT ×4. C5 owns triggering, the **`task_queue`**
(permanent audit record), **versioned task graphs**, the **context envelope**, the **three loops**, the
**Inngest** engine + dead letter queue, the **prompt-stack assembly + run pipeline** (assemble 4 layers → pin →
safety-validate → gate → execute step-by-step → pill → complete), and the optimisations. **Scope boundary set
with the operator at entry: strict — C5 calls, C6 enforces.** Seams out: enforcement/approval-policy/anomaly-
detection → **C6**; event-log/metrics/alert-delivery → **C7**; orchestrator routing + agent registry → **C8**;
memory mechanisms → C2; tool execution → C3; prompt content → C4; RBAC rules → C1.

**Drafting:** Explore subagent mapped the design section (L2493–2745) + system loop (L3329–3367) → 79 intents +
10 candidate area codes (refined to 8). Spot-verified load-bearing cites (task_queue L2517–2535, loops
L2561–2575, envelope L2591–2609, Inngest L2624–2742). **Caught up front** that the subagent's "service_role
mid-task re-check is an open ambiguity" is **already settled** by C1 FR-1.RLS.007 / OD-031 — C5 *implements* the
machinery (FR-5.ASM.005), doesn't re-open it. Also reconciled `client_slug`=label-not-RLS, `'flagged'` status
vs the enum (→ OD-054), Inngest-vs-task_queue double-retry (→ OD-058).

**6 ODs logged then resolved (OD-054…OD-059):** OD-054 status enum **+ explicit guardrail/quarantine state**
(C5 schema, C6-set, distinct from approval-wait); OD-055 compression **summarize-but-retain-originals** (economy
never loss); **OD-056 (user-decided) parallel × approval = step-level gating + no-irreversible-outrun** (#2);
OD-057 loops **no concurrent same-loop + single catch-up** (no backfill stampede); OD-058 **Inngest = single
retry authority**, task_queue = audit projection; **OD-059 (user-decided) chained-task = fresh envelope +
handoff + B re-retrieves under its own scope/clearance** (#2). The two #2-touching calls (056, 059) decided by
the user directly; 054/055/057/058 delegated to recommendation. All landed on option (a).

**Verification gate (2 independent zero-context subagents):**
- **Orphan/contradiction pass CLEAN** — all L2493–2745 + L3329–3367 intents map (the 3 deferred seams —
  observability→C7, ingestion-filter mechanism→C2, oversight→C6/C7 — correctly seamed, not orphaned); no
  contradictions with ADR-003/004/005/006/007, glossary, or consumed C0/C1/C2/C4 FRs; **all 6 traps PASS**
  (`client_slug` label-only · C5 never usurps C6 enforcement/anomaly-detection/approval-policy · mid-task
  re-check consumes C1 not re-decides · no Inngest/task_queue double-retry · citations spot-checked ·
  `flagged` reconciled). 2 cosmetic miscites fixed (extraneous L2349 in TRG.004, L2343 in QUE.005 dropped).
- **Quality/failure pass found 11 findings (3 HIGH, 5 MED, 3 LOW), ALL reconciled in-file:** **+FR-5.TRG.005**
  (verified-event→task **at-least-once**, the C3→C5 seam-atomicity hole — a one-shot event has no loop catch-up,
  HIGH); **+AC-5.JOB.005.2** (fan-out partial failure never silent — HIGH); **+AC-5.QUE.005.2** (approval-wait
  staleness escalation, reusing C1 OD-028 / C2 OD-032 don't-silently-abandon — HIGH); **+AC-5.GRP.003.2/.3**
  (crash-window key-committed-before-side-effect ordering + collision-resistance — M1/L2); **+AC-5.ASM.009.2**
  (durable chained-successor creation, the internal chain seam — M2); **retention clauses** on AC-5.ASM.005.1 +
  AC-5.QUE.003.2 (quarantine/halt **retains WIP** — you can't compensate (OD-010) what you didn't retain — M3);
  **+AF-115** + FR-5.ENV.003 note (the originals-store retention lifetime — Inngest cloud step-state TTL may be
  shorter than the chain + audit window — M4); **+AC-5.JOB.006.2** (C5-emitted DLQ-not-empty heartbeat so the
  failure-handler can't itself fail silently — M5); **+AC-5.ASM.004.2** (late-discovered consequential action
  re-enters the approval gate — L1); **+AC-5.GRP.001.2** (graph-less task fails loudly at creation — L3).
  The reviewer's meta-observation: H3/M2/M5 are all "a hold/handoff waiting on a human or downstream sink with
  no staleness escalation" — C5 now adopts the standardized C1 OD-028 / C2 OD-032 escalate-don't-abandon pattern
  at all three wait-points. Confirmed great-tier: the six resolved ODs land the hard #1/#2 calls.

**Sign-off:** user-authorized (delegated, "Sign off — Approve C5"). 43 FRs `Approved`. **No build-time viability
gate holds any C5 FR** — AF-112…115 are build-time validations of the catch-up/parallel/compression/retention
*claims*, not of the FR machinery (gate analog of C4's AF-111).

**Files changed:** `component-05-harness.md` (new, Approved); `open-decisions.md` (OD-054…OD-059 → 🟢; next
OD-060); `feasibility-register.md` (block P AF-112…115; next AF-116); `traceability-matrix.csv` (43 C5 rows);
`system-map/05-harness.md` (new); `system-map/README.md` (05 ✅ built); `README.md` (status table + Phase-1 row);
this log. No new OOS (self-hosted Inngest deferral noted on FR-5.JOB.007, to home formally at C6/C10).

**Carry-forward / housekeeping:** The self-hosted-Inngest deferral (FR-5.JOB.007) should get an OOS id at
C6/C10 (next OOS = OOS-028).

**Repo self-sufficiency / handoff test RUN (2026-06-26, end of session 22) — PASS, gaps patched.** A
zero-context subagent read only the repo (start-of-session order) and confirmed C6 is fully resumable from the
repo alone: component, design bounds (**L2746–L3030**, next `## 7.` at L3031), the per-component loop, spine
**ADR-007**, the inbound C5/C3 seams, the carry-forward ODs (047, 010 — both fully written with options+recs),
and the next counters (**OD-060 / AF-116 / OOS-028**, all stated in register footers). It flagged one defect
class — a **C6-vs-C7 "Guardrails" numbering drift** — now **fully patched:** (1) **OD-047** register entry
relabelled C7→**C6** (2 spots); (2) the **entire C3 file** relabelled to canonical (it had been authored under
the old C7=Guardrails / C8=Observability numbering — every Guardrails "C7"→C6, every Observability "C8"→C7, with
the agent-design `C5/C6/C8` carry-ins + "C8 agent UX" preserved; a dated clerical change-control note added to
the C3 header — no FR/AC/decision/vendor fact changed). C0/C1/C4/C5 were already canonical. Verified: zero
non-keep-set C8 and all Guardrails refs now C6 in C3. **The repo is handoff-clean for the C6 (Guardrails) chat.**

**NEXT STEP — component 6 (Guardrails).** Design-doc section **`## 6. Guardrails` = L2746–~L3000** (confirm the
end bound at decomposition; Layer 1 hard limits L2754–2768, Layer 2 approval gates L2772–2782, Layer 3 anomaly
detection L2791–2803, boundary/sanitization L2940–2980, the failure-mode map L2821–2862). Pattern-match the
C0–C5 loop: Context Manifest → decompose → cite → log ODs (next **OD-060**; new AFs from **AF-116**) → resolve →
verification gate (2 zero-context subagents) → sign-off → wire matrix + build `system-map/06-guardrails.md`.
**C6 is where many C5 seams land:** hard-limit **enforcement** (the code half of "both prompt AND code", paired
with C4 FR-4.CID.004 + C3 FR-3.ACT.002), the **approval-gate tier policy + routing** (C5 QUE.005/ASM.004 only
move tasks to `awaiting_approval`), **injection sanitization + boundary tagging** (ADR-007, the mechanism C4
FR-4.CID.003 only states), **anomaly detection + thresholds** (C5 ASM.007 only invokes the check), and setting
the **`flagged` status** (C5 OD-054 defined the state, C6 sets it). **C6 also actions OD-047** (review the seven
hard limits — set / rigidity / enforceability — with the **AF-068** containment red-team) and is where
**OD-010** (compensation/rollback) lands substantively alongside C5/C8. **ADR-007 is the spine** (containment-
first; detection-as-signal; embedding scan off by default). Likely seams out: event-log/alerts → C7;
orchestrator → C8. Carry-ins: build-time spikes AF-001/002/004 + the C5 block-P AFs (AF-112…115) + AF-068.

---

## Session 21 — 2026-06-26 — COMPONENT 4 (PROMPT ARCHITECTURE) DRAFTED, VERIFIED & APPROVED — "what the AI is"

Fifth Phase-1 component. Output: `spec/01-requirements/component-04-prompt.md` (**32 FRs, all Approved**),
`system-map/04-prompt.md`, 32 matrix rows, OD-048…OD-053 logged+resolved, AF-111 logged. A
**content-definition** component — the smallest so far, no connector research gate, most machinery is seams.

**C4 = "what the AI is"** (vs C2 what it knows, C3 what it can do). Area codes: LYR ×4 · CID ×6 · BIZ ×3 ·
INJ ×4 · TSK ×3 · PRIN ×3 · STO ×6 · OPT ×3. C4 owns the **four-layer model** (L1 core identity per-agent ·
L2 business context · L3 memory injection · L4 task instruction), the **seven operating principles** + the
safety floor, the **`prompt_layers` store** + version discipline, and the optimisations. It does NOT own
runtime **assembly** (→C5), memory retrieval/clearance gate (→C1/C2), injection sanitization (→C6), hard-limit
**enforcement** (→C6), answer-mode pill rendering (→C5/C8), or the prompt-health **signals** (→C7).

**Drafting:** offloaded a whole-doc prompt-architecture sweep to an Explore subagent (the primary section
L2384–2492 + 8 cross-cut sites: checklist L261–271, L2-config L840–856, perm rows L556–558, boundary
instruction L2976–2980, hard-limits L2756–2768, `agents.system_prompt` L3500–3517, runtime assembly
L3338–3347, prompt-health L3578/3589–3591). Spot-verified the load-bearing cites before drafting. Caught the
central contradiction up front: **Layer 1 is stored in two places** (`prompt_layers.content` where
`layer='core'` AND `agents.system_prompt`), each with its own versioning → OD-048.

**6 ODs logged then resolved (OD-048…OD-053):** OD-048 Layer-1 single source of truth = **unify on
`prompt_layers`**, drop/derive `agents.system_prompt` (reconcile in C8); **OD-049 (user-decided) operating-
principles block = editable, Super-Admin-ONLY** (new `PERM-prompt.edit_principles`, not Admin) + mandatory
change_reason + safety-audit + warning; OD-050 prompt-change = **version pinned at assembly** (in-flight tasks
finish on their version); OD-051 L1 length = **advisory warning**; OD-052 dynamic L2 values = **operator-
editable per-deployment store**; **OD-053 (user-decided) principles floor = hard-block** (reword yes, delete a
principle no). 5 delegated/rec-accepted; the two safety-posture calls (049, 053) decided by the user directly.

**Verification gate (2 independent zero-context subagents):**
- **Orphan/contradiction pass CLEAN** — all L2384–2492 intents + the 8 cross-cut sites map to FRs;
  `agents.system_prompt` + prompt-health correctly handled as seams not orphans; no contradictions with
  ADR-001/002/003/006/007, glossary, or consumed C1/C2/C3 FRs; **all 6 traps PASS** (no `client_slug` RLS key ·
  C4 never claims assembly · L1 duplication resolved to one store · boundary = C4 content + C6 mechanism ·
  principles Super-Admin-edit doesn't break "shared verbatim" · citations clean).
- **Quality/failure pass found 7 findings (2 HIGH, 3 MED, 2 LOW), ALL reconciled:** **+FR-4.LYR.004**
  (assembly-time required-element validation — assembly halts if the resolved L1 lacks the boundary instruction
  / hard-limit statement / principles block; C4 owns the requirement, C5 enforces — HIGH); **re-anchored
  AC-4.PRIN.002.2** (the principles-edit audit pointed at C1 FR-1.AUD.002 which doesn't cover prompt edits →
  re-homed to the immutable `prompt_layers` version chain + a distinct safety-event to C7 — HIGH); **+OD-053 +
  AC-4.PRIN.002.4** (the seven-principle **hard-floor** — HIGH, the #2 edge of OD-049); +AC-4.BIZ.003.3
  (present-but-stale dynamic field surfaced, required + configurable threshold — MED); reworded AC-4.PRIN.002.3
  (assembled-*after*-edit, removes the version-pin ambiguity — MED); +AC-4.INJ.003.3 (above-clearance memory
  in an assembled L3 = containment breach, halt-and-audit — MED); +AF-033 cross-ref at FR-4.CID.006 (said-vs-did
  pill accuracy, already tracked — LOW). Confirmed great-tier: version discipline + single-source-of-truth,
  principle-as-statement-not-enforcement (PRIN.003), boundary/hard-limit prompt-vs-code split, AF-111 honesty.

**Sign-off:** user-authorized — OD-048/050/051/052 recs accepted, **OD-049 + OD-053 decided by the user**
(principles editable by Super Admin only, with a hard floor against deletion), gate clean + all 7 findings
reconciled in-file. 32 FRs `Approved`. No build-time viability gate holds any C4 FR (AF-111 gates only the
*optimisation claim* — version-perf attribution + compression payoff — not the version-identity/pin machinery).

**Files changed:** `component-04-prompt.md` (new, Approved); `open-decisions.md` (OD-048…OD-053 → 🟢; next
OD-054); `feasibility-register.md` (block O AF-111; next AF-112); `traceability-matrix.csv` (32 C4 rows);
`system-map/04-prompt.md` (new); `system-map/README.md` (04 ✅ built); `README.md` (status table + Phase-1 row);
this log. No new OOS.

**NEXT STEP — component 5 (Agent Harness).** Design-doc section **`## 5. Agent Harness` = L2493–2745** (next
`## 6. Guardrails` at L2746); plus the **system loop** L3329–3370 (where C5's runtime assembly + execution
lives) and the C5 checklist overview. Pattern-match the C0–C4 loop: Context Manifest → decompose → cite → log
ODs (next **OD-054**; new AFs from **AF-112**) → resolve → verification gate (2 zero-context subagents) →
sign-off → wire matrix + build `system-map/05-harness.md`. **C5 is where many C4 seams land:** the **prompt-
stack assembly** (retrieve the 4 layers, inject dynamic/memory values, concatenate, send — L3338–3339), the
**FR-4.LYR.004 assembly-validation** (halt if a safety element is missing), **version pinning** (FR-4.STO.006),
the **answer-mode pill** evaluation (with C8), the **task_queue** (L2517–2535), checkpoints, context-envelope
compression (L2608–2609), and the per-agent run loop. **C5 consumes:** C3's tool runtime (tool calls), C4's
prompt layers, C2's memory read flow, C1's `service_role`/mid-task re-check (FR-1.RLS.007). **Likely seams
out:** hard-limit/approval **enforcement** + injection sanitization → C6; observability/event-log → C7;
orchestrator routing + agent registry → C8. **Carry-ins unchanged:** OD-010 (compensation/rollback) lands
substantively at C5/C6; build-time spikes AF-001/002/004 + AF-111.

---

## Session 20 — 2026-06-25 — COMPONENT 3 (TOOL LAYER) DRAFTED, VERIFIED & APPROVED — the connector runtime

Fourth Phase-1 component, the connector layer. Output: `spec/01-requirements/component-03-tool-layer.md`
(**53 FRs, all Approved**), `system-map/03-tool-layer.md`, 53 matrix rows, OD-046 logged+resolved, the
session-19 ODs already resolved. Built directly on the session-19 research gate (dossiers + spine decision).

**C3 = "how the AI reaches the outside world."** Specced as the session-19 spine: a **generic connector
contract + shared tool runtime** (safety machinery built ONCE) with **GHL / Google / Slack as the first
three instances**. Area codes: CONN ×5 · REG ×4 · TOK ×6 (+3 instance) · RL ×8 · ACT ×7 (2 generic limits +
5 instance writes) · TRIG ×5 (+1 instance) · OPT ×4 · DSC ×6 · OBS ×4. **53 FRs = 40 generic runtime + 13
connector instances.** Every vendor fact cites the **dossier**, not the (stale) design doc.

**Drafting:** offloaded the three dossiers to an Explore subagent → a precise citable vendor fact-sheet
(token TTLs, scopes, rate limits, signature schemes, idempotency), then wrote generic CONN-contract FRs
first (the runtime every instance plugs into), then the GHL/Google/Slack instances. Key reconciliations
carried in: `client_slug`=label-not-RLS (mirrors C1) · agent/tool path = `service_role` (ADR-006) · golden
rule (source_ref pointers, not copies) · the 7 hard limits are code gates (ADR-007) · OD-044's "verified
authenticated ingress" homes the per-vendor signature schemes (GHL Ed25519 / Google OIDC-JWT+channel-token
/ Slack HMAC).

**Verification gate (2 independent zero-context subagents):**
- **Orphan/contradiction pass CLEAN** — no orphaned design lines (all L1968–2382 intents map; stale
  per-connector numbers correctly superseded by dossiers), no internal C3 contradictions, citations clean,
  **all 6 traps PASS**. **Caught a real cross-component bug:** C0 **FR-0.WHK.002** (Approved) specced GHL
  webhook auth as **HMAC-SHA256** — stale; the dossier + ADR-007 OD-044 note make it **Ed25519** (legacy RSA
  `X-WH-Signature` deprecates 2026-07-01). Corrected in place via change-control → **OD-046** (operator
  accepted at sign-off); C0 FR re-cited to the dossier, Status kept Approved (corrected, not re-opened).
- **Quality/failure pass found 10 findings (2 HIGH, 7 MED, 1 LOW), ALL reconciled:** **+FR-3.TRIG.005**
  (watch/subscription re-arm — Gmail/Drive/Calendar watches expire with NO auto-renew; a missed re-arm now
  enters the degraded flow + health panel — closed a HIGH silent-ingest-loss hole); **+FR-3.TRIG.006**
  (event-delivery gap detection + reconciliation — Slack auto-disable/>2h-late-drop had no specced mechanism,
  only prose; HIGH); **+AC-3.CONN.004.4** (durable pre-call intent record); tightened **AC-3.TOK.005.2**
  (post-refresh-pre-persist crash → grace-window retry then degrade loudly; no false "prior state intact");
  **+AC-3.RL.006.2** (irreversible/billed writes route to halt-and-escalate, excluded from auto-retry);
  **+AC-3.DSC.003.2/.3 + AC-3.DSC.004.2** (resume re-checks authorization FR-1.RLS.007; paused-task set +
  escalation clock persisted across restart); **+AC-3.OPT.004.2** (gap flag structured/mandatory-to-read);
  **+AC-3.CONN.005.3** (delete-granting scopes excluded — cheapest gate for hard-limit #3) + FR-3.ACT.002
  note (financial/impersonation limits have **no** C3 mechanism — wholly C7+AF-068); persisted RL.004 queue
  + drain re-consults idempotency. Confirmed-adequate: token no-leak, the GHL rotating-refresh persist spine,
  draft-to-approval for email/calendar, fail-closed boundary tag, physical isolation, OD-044 per-vendor
  signatures, OD-010 named-not-solved at every write FR.

**Sign-off:** user-authorized (delegated, C1/C2-style — chose "Sign off — Approve C3 + C0 fix"). 53 FRs
`Approved`; the C0 FR-0.WHK.002 correction accepted. **3 viability gates** documented (FRs are Approved but
do NOT advance to build until cleared): Slack history ingest → AF-083/084; GHL webhook signing input →
AF-090; GHL PHI-location ingest → AF-098 (BAA chain).

**Files changed:** `component-03-tool-layer.md` (53 FRs Approved + gate summary); `component-00-login.md`
(FR-0.WHK.002 HMAC→Ed25519, change-control note); `open-decisions.md` (OD-046 logged+resolved; next OD-047);
`traceability-matrix.csv` (53 C3 rows); `system-map/03-tool-layer.md` (new); `system-map/README.md`
(03 ✅ built); `README.md` (status table + Phase-1 row); this log. No new AFs (findings mapped to existing
Block-N AFs); no new OOS.

**NEXT STEP — component 4 (Prompt Architecture).** Design-doc section **`## 4. Prompt Architecture` ≈
L2384+** (confirm the end bound at decomposition; next `## 5.` follows). Pattern-match the C0/C1/C2/C3 loop:
Context Manifest → decompose the design's prompt section → cite → log ODs (next **OD-047**; new AFs from
**AF-111**) → resolve → verification gate (2 zero-context subagents) → sign-off → wire matrix + build
`system-map/04-prompt.md`. **C4 consumes** C3's tool registry + descriptions (FR-3.REG.002 — the AI selects
tools by description) and ADR-007 containment (boundary-tagged content is data, never instructions). **Likely
seams:** the harness/agent-loop *execution* → C5; guardrail *enforcement* of the hard limits + approval gates
→ C7; observability/eval of prompt quality → C8. **Carry-ins:** OD-010 (compensation/rollback) at
C5/C6/C8; **OD-047 (NEW — review the seven hard limits: right set / rigidity / enforceability — flagged by
operator, lands at C7 with the AF-068 red-team)**; the C3 viability gates (AF-083/090/098) + build-time
spikes AF-001/002/004 on a runnable prototype.

---

## Session 19 — 2026-06-25 — COMPONENT 3 (TOOL LAYER): spine decision + research-first gate run, filed & reconciled (FRs next)

Entered C3 (the connector component). User raised a strategic point up front — **"factor in adding tools later"**
(research → plan → build, repeatably). Turned it into a locked design decision + ran the research-first gate.

**Spine decision (user-approved: "C3 spine + lifecycle standard", no new ADR):** C3 is specced as a **generic
connector contract + shared tool runtime**, with **GHL / Google / Slack as the first three *instances***. The
runtime builds the safety machinery ONCE (token-refresh-persist, rate-limit tracker+backoff, webhook verify,
boundary-tagging, idempotent retry, disconnection/recovery) so future tools inherit it and the three
non-negotiables can't regress per-tool. **Validated by the design doc itself — L1976: "built as a boilerplate
… the first implementations of the pattern, not the limit."** After C3 is done, the existing
`standards/tool-integration-research.md` grows from a research-only gate into the full Research→Spec→Build→Verify
lifecycle (extracted from the real example, not pre-guessed).

**Research-first gate run (4 background agents):** 3 primary-source dossiers (one per tool) + 1 Explore design-map.
Dossiers written to `tool-integrations/{slack,gohighlevel,google-gmail}.md`, each gate-passed (independent
re-check). **Statuses: GHL 🟢 · Google 🟢 · Slack 🟡** (Slack dossier complete; its *viability* — history ingest —
rests on AF-083 EVAL, kept honest-yellow). The design-map decomposed L1968–2382 into ~58 intents, pre-split
**generic (~35) vs tool-specific (~15) vs generic+param (~8)** → 9 area codes (CONN/REG/OBS/ACT/TRIG/OPT/RL/TOK/DSC).

**Three material vendor surprises the design doc missed** (now spec'd correctly, cite dossiers not design doc):
(1) **GHL webhook signing RSA→Ed25519**, legacy `X-WH-Signature` deprecated **2026-07-01** → use `X-GHL-Signature`;
(2) **Google webhooks have no HMAC** (Gmail Pub/Sub OIDC JWT; Drive/Calendar signed `X-Goog-Channel-Token`+TLS);
(3) **neither GHL nor Gmail has write-idempotency** → app-side send-once guards (GHL → `/contacts/upsert`).
Plus a compliance flag: **GHL data can carry PHI, downstream BAA chain unknown (AF-098)** — gates HIPAA-location ingest.

**Filed (Rule 0), collision-safe renumber (single-pass dict regex):** feasibility **Block N = AF-083–110** (Slack
083–088 · GHL 089–100 · Google 101–110; next AF = **AF-111**); **OD-011 RESOLVED** (Slack internal custom app per
workspace, gated AF-083 EVAL); **OD-039–045 logged then RESOLVED** per recommendation (next OD = **OD-046**);
**OOS-018–027** (next OOS = **OOS-028**); **+12 glossary terms**. `traceability-matrix.csv` NOT yet touched (no C3
FRs to wire yet).

**OD resolutions (operator delegated "what do you recommend"):** OD-039 Slack per-workspace default · OD-040 token
rotation OFF · OD-041 GHL pass Security Review (**implicit 5-GHL-agency cap until then** — flagged) · OD-042 GHL
webhook receiver durable-queue→2xx+dedup `deliveryId` · OD-043 GHL re-verify 90d+changelog poll · **OD-044 ⭐ ADR-007
webhook-auth reconciliation → clarification note added to ADR-007** (Consequences→Connector ingress, dated
2026-06-25: hard control = "verified authenticated ingress", HMAC one instance; CONN contract homes per-vendor
scheme — change-control satisfied via note, not supersede) · OD-045 Google Drive `drive.file` default (escalate to
`drive.readonly`+CASA only for full-corpus ingest).

**Files changed:** `component-03-tool-layer.md` (new — manifest, contract spine, intent inventory, seams, vendor-fact
supersedes, OD table now RESOLVED, FRs deferred); 3 dossiers (new); `tool-integrations/README.md` (3 rows);
`feasibility-register.md` (Block N); `open-decisions.md` (OD-011 + OD-039–045); `out-of-scope.md` (OOS-018–027);
`glossary.md` (+12); `adr/ADR-007-injection-posture.md` (2026-06-25 clarification note); `README.md` (status); this log.

**NEXT STEP — draft the C3 FRs.** Gate passed, all ODs resolved, ADR-007 reconciled → FR drafting is unblocked.
Order: **generic CONN connector-contract FRs first** (the runtime: registry/REG, token lifecycle/TOK, rate-limit
tracker+backoff/RL, webhook-verify + boundary-tag, idempotent retry, disconnection/recovery/DSC, optimisation/OPT,
the 7 hard limits under ACT, trigger model/TRIG), **then the three connector instances** (OBS/ACT/TOK params per
tool) each citing its dossier for vendor facts. Then OD-free ACs → the per-component verification gate (2 zero-context
subagents: orphan/contradiction + quality/failure) → sign-off. **Per-FR `Ready` is additionally gated on build-time
AFs** (Slack history-ingest → AF-083; GHL webhook → AF-090; GHL PHI ingest → AF-098). **Seams (don't double-spec):**
memory-write tool → C2 (FR-2.WRT.*); high-risk rate-limit halt/escalate + approval gates + hard-limit enforcement →
C7; health panels/alerts/event-logging → C8; webhook *authentication* → C0 (FR-0.WHK.*); service-role agent path +
mid-task revocation → C1 (FR-1.RLS.007). Build `system-map/03-tool-layer.md` alongside the FRs (per-component map
policy). Carry-ins unchanged: OD-010 (compensation/rollback) at C5/C6/C8 — every external-write ACT tool is an
exposure point; build-time spikes AF-001/002/004.

---

## Session 18 — 2026-06-25 — COMPONENT 2 (MEMORY) DRAFTED, RESOLVED, VERIFIED & APPROVED — the business brain

Third Phase-1 component, the heart of the system. Output: `spec/01-requirements/component-02-memory.md`
(**57 FRs**, 56 Approved + 1 v2-deferred), OD-032…038 resolved, AF-082 logged, OOS-016/017 logged, matrix +
system-map wired.

**C2 = "what the AI knows"** — the durable, entity-organised, sensitivity-tagged knowledge base every task reads
from (step 4) and writes back to (step 7). Area codes: MEM ×2 · ENT ×5 · TAG ×3 · ING ×10 · WRT ×7 · RET ×7 ·
MNT ×17 · VEC ×3 · MAT ×3. **Three ADRs converge:** ADR-002 (Maturity/Sufficiency), ADR-003 (≤1 Sonnet writer +
Haiku gates + "controls before gates"), ADR-004 (sole-writer service_role + validate-and-commit).

**Drafting:** offloaded the design-doc Memory map (L1338–1967 + the L906–926 config block + L1487–1559 vector) to an
Explore subagent → 78 fine-grained intents; spot-verified the load-bearing cites (memory types, the tag enumeration,
the two filters) before writing. **Key reconciliation caught up front:** the design's "Filter 1 / Filter 2" ARE
ADR-003's Haiku gates (selective-writing + sensitivity-classify), **not a third model layer** — C2 cites ADR-003
rather than inventing one. C2 **consumes** C1's FR-1.CLR.001/004/006, RST.003, RLS.003/007, AUD.001 and **owns the
mechanisms C1 only ruled on** (tagging, the retrieval pipeline, never-auto-inject-Restricted, the sole-writer path).

**7 ODs logged then resolved (OD-032…038):** OD-032 hard-conflict quarantine+escalate (mirrors C1 OD-028); OD-033
entity resolution external-ref-first + flag-ambiguous + soft-disable retire (gated by AF-082); **OD-034 cold storage
DEFERRED to v2 → OOS-016** (user-decided — adds a lose-a-memory failure mode for no launch-scale benefit; HNSW stays
fast past ≤20-user volume); OD-035 candidate filters apply uniformly to BOTH search arms (closes a stale-knowledge
leak); OD-036 ~3-week shadow-retain trust window, graduate on low disagree-rate + operator sign-off (ADR-003 §8
made concrete); OD-037 Personal-consolidation skip-by-default + audited approval queue; **OD-038 compliance-erasure
rule homed in C2 (FR-2.MNT.017), backup-purge seamed to Phase 5** (user-decided). 5 delegated C0/C1-style; the two
scope/legal calls (034, 038) taken to the user — both chose the recommendation.

**Verification gate (2 independent zero-context subagents):**
- **Orphan/contradiction pass CLEAN** — all design intents L1338–1967 mapped; the 3 deferrals (cold storage, re-rank/
  HyDE, structured-extraction/query-decomposition) correctly logged OOS-016/003/017; no contradictions with
  ADR-001/002/003/004/006/007 or the consumed C1 FRs; all 5 trap areas PASS. Caught a **citation slip** (Personal-
  no-consolidation cited L1407 → correct **L1414**) + two cross-ref slips (MNT.009→**008**, MNT.016→**014**) — all fixed.
- **Quality/failure pass found 7 findings, ALL reconciled:** **+FR-2.WRT.007** (embedding-failure halts commit, never
  stores a null/invalid embedding — a real #1/#3 silent-loss hole); **+AC-2.WRT.006.3** (mid-task revocation re-check
  at the commit boundary — C1 FR-1.RLS.007 stated the rule, no C2 FR enforced it); **FR-2.ING.003** escalation AC +
  `CFG-review_escalation_days`/`CFG-ingest_defer_resurface_days` and **FR-2.MNT.010** now scans the ingestion queue +
  null-embedding rows (closed a **Rule-0 dangling "Phase 2" decision**); **FR-2.MNT.017** hardened to erase
  **transitively** across the supersede chain + merged/summarised derived rows (+AC-2.MNT.017.3 — the residue hole
  OD-038's own rule forbids); escalation ACs on FR-2.WRT.002 / FR-2.MNT.014; FR-2.WRT.006 lexical-recheck note →
  FR-2.MNT.006 daily backstop; AC-2.VEC.003.2 re-embed completeness gate. Confirmed-adequate: clearance-before-
  ranking, Restricted, golden rule, decay-never-deletes, evidence layer, sole-writer.

**Sign-off:** user-authorized — OD resolution delegated (5) + the two scope/legal calls decided directly; gate clean
on orphans/contradictions, all 7 quality findings reconciled in-file. 56 FRs `Approved` + FR-2.MNT.012 `Deferred(v2)`.

**Files changed:** `component-02-memory.md` (new, Approved); `open-decisions.md` (OD-032…038 → 🟢; next OD-039);
`feasibility-register.md` (block M AF-082; next AF-083); `out-of-scope.md` (OOS-016 cold storage, OOS-017 structured-
extraction/query-decomposition; next OOS-018); `traceability-matrix.csv` (57 rows); `system-map/02-memory.md`
(reconciled-with-spec note); `system-map/README.md` (02-memory ✅ Approved); `README.md` (status table + Phase-1 row);
this log.

**NEXT STEP — component 3 (Tool layer).** **Design-doc section: `## 3. Tool Layer` = L1968–2383** (next section
`## 4. Prompt Architecture` at L2384), incl. Observation tools L2021, Action tools L2037, Tool registry L2070, Tool
optimisations L2101, Connector token management L2225, Connector disconnection flow L2301; plus the C3 checklist
overview **L245–~270**. This is the **connector** component, so it **triggers the research-first
gate** (`standards/tool-integration-research.md`) — open dated primary-source dossiers in `tool-integrations/` for
GHL / Google(Drive+Gmail) / Slack before speccing connector FRs, citing the dossier (not the design doc) for vendor
facts. C3 is where the **AF-003 corrected vendor values propagate** (F1 Gmail per-env quota, F2 GHL 100/10s+200k/day,
F5 GHL refresh-token-rotation-persist, F3 Slack throttle) and where **OD-011 (Slack app class — rec internal-custom-
app, EVAL-gated)** resolves. C3 **owns the seams C2 named:** the connectors behind C2's three ingestion pipelines
(FR-2.ING.006/007/008) and the **live-data fetch** for the relevance cross-check (FR-2.MNT.011); also the connector
OAuth + token lifecycle C0 deferred (AF-013/014). **Carry-ins unchanged:** OD-010 (compensation/rollback) at C5/C6/C8;
build-time spikes AF-001/002/004 + the C2 AFs (AF-019 HNSW-under-RLS, AF-031, AF-034, AF-043, AF-061–063, AF-067,
AF-082) on a runnable prototype. The C2 mid-task-quarantine **machinery** (AC-2.WRT.006.3) is a C5/C6/C8 build concern;
the answer-mode **pill rendering** (FR-2.RET.007) is C8.

---

## Session 17 — 2026-06-24 — COMPONENT 1 (RBAC) DRAFTED, RESOLVED, VERIFIED & APPROVED + `standards/rbac.md` written

Second Phase-1 component, pattern-matched to the C0 exemplar. Output: `spec/01-requirements/component-01-rbac.md`
(**37 FRs**, all `Approved`), the owed `standards/rbac.md`, `system-map/01-rbac.md`, 37 matrix rows, OD-024…031
resolved, AF-079/080/081 logged.

**C1 = authorization ("what you may do/see")** — the question C0 left open once `auth.uid()` is established.
**ADR-006 is the spine** (its 6 binding parts map ~1:1 onto the RLS/PERM/CLR FRs). Area codes: ROLE ×5 · PERM ×7 ·
CLR ×6 · RST ×3 · RLS ×8 · USR ×5 · AUD ×3. Every vendor/architecture fact cites ADR-006 or the design doc.

**Drafting:** offloaded the design-doc RBAC map (L397–639 + L717–736) to an Explore subagent; verified load-bearing
line anchors before citing. Homed the C0 PERM stubs (`PERM-user.invite`, `PERM-auth.provider_toggle`, support nodes)
+ the role tables (`user_roles`/`roles`) C0 read. **Caught a real design contradiction:** L438 lists "Restricted" as
a Super Admin *role* clearance, but L452/L620 make it strictly per-named-individual — resolved in favour of L452
(Restricted is never a role default; Super Admin holds the *authority to grant*).

**8 ODs resolved (OD-024…OD-031, all 🟢, delegated C0-style):** dedicated append-only `access_audit` table, C7 owns
retention (OD-024); role deletable iff zero users + not protected, Super Admin always protected (OD-025); denied
direct access = explicit 403 + security log, never silent empty (OD-026); `entity_type_scope` column + Restricted-
per-individual (OD-027); overdue clearance review = escalate, neither auto-revoke nor silently keep (OD-028); audit
every RBAC mutation + one-role-per-user v1 + last-Super-Admin protected on all removal paths (OD-029); seed default
matrix once at provisioning, edits authoritative after (OD-030); **OD-031** (gate-raised) mid-task revocation policy.

**Verification gate (2 independent zero-context subagents):**
- Orphan/contradiction pass **CLEAN** — all 27 design intents mapped; the 4 traps all avoided (no `client_slug` in
  policies; no FR assumes RLS guards the agent path; Restricted never a role-default; no role-name inside a policy);
  all 6 seams (C0/C2/C3/C7) acknowledged.
- Quality/failure pass found **5 findings, ALL reconciled**, clustered at the **service-role/mid-task seam** (the one
  path ADR-006 part 6 deliberately leaves off RLS): **+FR-1.RLS.007** (a `service_role` task binds its originating
  user; on mid-task **deactivation or clearance-revoke it halts + quarantines before the next consequential side
  effect** — while a benign **session-expiry continues**, reconciling C0 FR-0.SESS.006; mechanism seamed to C5/C6/C8,
  compensation → OD-010); **+FR-1.RLS.008** (RLS/harness divergence is logged, not silently zero-rowed, #3);
  **+OD-031**, **+AF-081** (agent-path audit completeness — no DB backstop, rests on harness discipline); reactivation
  re-grant branch on USR.002 (no stale grant silently restored). AF-080 sharpened to runtime divergence.

**`standards/rbac.md` written** (Binding, owed since ADR-006) — 12 rules: default-deny everywhere · one `can()` gate ·
`PERMISSION_NODES.md` build-time source of truth · static generic data-driven policies · the `(select …)` initPlan
rule (AF-067, non-negotiable for perf) · RLS owns only the row-access subset intra-client · human-path-RLS vs
agent-path-service_role · instant change · explicit/scoped/reviewed clearances · Restricted per-individual/logged/
never-auto-injected · dual-path audit completeness · no-lockout.

**Sign-off:** user-authorized ("lets sign off unless you think i need to review something") — I judged nothing needed
their specific review (gate clean on orphans/contradictions; findings reconciled on the locked ADRs). 37 FRs → `Approved`.

**Files changed:** `component-01-rbac.md` (new, Approved); `standards/rbac.md` (new, Binding); `system-map/01-rbac.md`
(new); `system-map/README.md` (01-rbac ✅); `traceability-matrix.csv` (37 rows); `open-decisions.md` (OD-024…031 → 🟢;
next OD-032); `feasibility-register.md` (block L AF-079–081, AF-080 sharpened; next AF-082); `README.md` (status table
+ Phase-1 row); this log.

**NEXT STEP — component 2 (Memory).** The exemplar zoom-in `system-map/02-memory.md` already exists (reflects
ADR-002/003/004). Pattern-match the C0/C1 loop: Context Manifest → decompose the design's memory section → cite → log
ODs (OD-032+; new AFs from AF-082) → verification gate → sign-off. **Design-doc section: `## 2. Memory System` =
L1338–1967** (memory types/entities, the two ingestion filters + contradiction check + memory writer write-flow, the
visibility×sensitivity orthogonal tags L1400–1418, retrieval/ranking, the maintenance schedule L1870, the three
ingestion pipelines L1908+); plus the C2 checklist overview **L222–243** and the memory-relevant config (e.g.
`retrieval_confidence_threshold` ~L906). Note the clearance-before-ranking lines C1 cited (L464, **L1725**) live inside
this section — C2 owns the *mechanism* there. Likely area codes (confirm at decomposition): MEM/ENT (entities) ·
ING (ingestion filters + pipelines) · WRT (write flow + contradiction check + sole writer) · RET (retrieval/ranking) ·
TAG (visibility×sensitivity) · MNT (maintenance/supersede/merge). **C2 consumes from C1:** the clearance/visibility/Restricted access model
(FR-1.CLR.*/RST.*), the `(select …)` data-driven RLS pattern (AF-067), and **owns the mechanisms C1 only stated the
rule for** — tagging memories with a sensitivity tier + entity type (FR-1.CLR.001/004), the retrieval/injection
pipeline that enforces clearance-before-ranking (FR-1.CLR.006) and never-auto-inject-Restricted (FR-1.RST.003), and the
service-role sole-writer path (ADR-004) whose mid-task authorization C1 governs (FR-1.RLS.007). **Carry-ins unchanged:**
OD-010 (compensation/rollback) at C5/C6/C8; OD-011 (Slack app class) at the C3 Slack connector; build-time spikes
AF-001/002/004 + AF-067/076/079/080/081 on a runnable prototype.

---

## Session 16 — 2026-06-24 — COMPONENT 0 (LOGIN) DRAFTED, RESOLVED, VERIFIED & APPROVED (the golden exemplar)

The full Phase-1 per-component loop, executed end-to-end on **component 0 (Login)** — the golden exemplar
every later component pattern-matches. Output: `spec/01-requirements/component-00-login.md` (**42 live FRs +
1 retired**, all `Approved`), its `system-map/00-login.md` zoom-in, 43 matrix rows, 12 OD resolutions.

**Drafting:** decomposed design-doc **L358–390 + L643–816** into 6 area codes (AUTH/SESS/INV/SEED/REC/WHK).
Every Supabase vendor fact cites **feasibility Block J (SA1–17)**, NOT the design doc; the **6 refuted
design-doc claims** are carried as a doc-reconciliation table up top. New **AF-078** (webhook verification,
block K). Glossary +AAL/aal2, +refresh-token rotation, +JWKS local verification.

**12 ODs logged then resolved (OD-012…OD-023, all 🟢):** session-lifetime = native rotating+inactivity
(OD-012); mid-task = `service_role` (OD-013, per ADR-004/006); invites = **24h native, no custom token**
(OD-014); HttpOnly pursued w/ AF-073 gate (OD-015); 2FA = deployment-wide aal2, no exemptions (OD-016);
same-page challenge + soft-lock (OD-017); **OD-018 (user-decided) = OAuth-only for all client-tenant users,
email+password+2FA ONLY for external (operator-side) Super Admins** who can't SSO; OD-019 **dissolved** by
OD-018 (no client password to reset → phone-verify flow retired); one-method-at-setup (OD-020); seed =
email+pw+2FA external bootstrap admin (OD-021); webhook secret rotation/replay (OD-022); webhook alert→Super
Admin+throttle (OD-023).

**OD-018 cascade (the key event):** since all client users are OAuth, the system holds no client password →
**FR-0.REC.004 (phone-verify credential change) RETIRED**, phone field + custom invite-token table dropped,
REC reframed to a generic login-support intake. A scope decision *deleted* complexity + an attack surface.

**Verification gate (2 independent zero-context subagents):**
- Orphan/contradiction pass **CLEAN** — all 49 design intents mapped; 6 deviations are the intended Block-J
  corrections; seams to C1/C2/C3 acknowledged; no unsupported claims.
- Quality/failure-overlay pass found **6 findings, ALL reconciled:** seed check-then-create race → hardened
  **FR-0.SEED.003** with an ADR-004 atomic guard (real bug caught); +**FR-0.AUTH.010** (audit completeness),
  +**FR-0.INV.007** (email bounce), +**FR-0.REC.007** (stale-request re-escalation); missed-webhook detection
  parked as a seam to **C2/C3/C7** (not C0); backup confirmed covered by ADR-008.

**Sign-off:** user-authorized/delegated ("I trust you and your recommendations"). 3 LOW items accepted (status
enum `contacted`→`in-progress`; phone-recovery retired; **ADR-007 webhook-ingress "component 1" cross-ref
reconciled** via a dated clarification note); FR-0.INV.007 full-bounce-wiring deferred → **OOS-015**.

**Files changed:** `spec/01-requirements/component-00-login.md` (new, Approved); `system-map/00-login.md` (new);
`traceability-matrix.csv` (43 rows); `open-decisions.md` (OD-012…023 → 🟢; next OD-024); `feasibility-register.md`
(block K, AF-078; next AF-079); `glossary.md` (+3 terms); `out-of-scope.md` (OOS-015; next OOS-016);
`adr/ADR-007-injection-posture.md` (C0-scoping reconciliation note); `system-map/README.md` (00-login ✅);
`README.md` (status + Phase-1 row); this log.

**NEXT STEP — component 1 (RBAC).** Pattern-match the C0 exemplar: create `component-01-rbac.md` with a Context
Manifest (ADR-006 data-driven RLS is the spine; ADR-001 intra-client; the C0 `auth.uid()`/`aal2` seam from
FR-0.AUTH.008/SESS.006), decompose the design's RBAC section, cite, log ODs, run the verification gate, sign
off. **C1 owes the `standards/rbac.md` standard** (two-level RBAC+RLS, default-deny, RLS-vs-harness division,
service-role caveat, `PERMISSION_NODES.md`) — promised since ADR-006. C1 also **homes the PERM-* nodes** C0
referenced as stubs (`PERM-user.invite`, `PERM-auth.provider_toggle`, `PERM-support.view/.resolve`) and the
**role tables** `user_roles`/`roles` that FR-0.INV.005/SEED.001 read. Carry-ins unchanged: OD-011 (Slack app
class) at the C3 Slack connector; OD-010 (compensation/rollback) at C5/C6; build-time spikes AF-001/002/004 +
AF-073–078 on a runnable prototype.

---

## Session 15 — 2026-06-24 — PHASE 1 ENTERED · component-0 scope finalized · Supabase Auth research-first gate run

User asked to confirm Phase 0 done + whether to reason about Phase 1 before starting (yes to both). Read the
whole repo + had subagents map the design-doc Login section and re-read every foundation file. **Phase 0 is
confirmed complete** (all 8 ADRs Accepted; the 3 SPIKE/EVAL priority spikes AF-001/002/004 are build-time by
design). **Phase 1 is now entered.** No FRs drafted yet — this session did the "finalize before entry" pass +
the research gate. **Nothing here is a code change; it's spec scaffolding for component 0 (the golden exemplar).**

**Two scope decisions locked (user-approved), recorded in `phase-playbooks.md` → "Component 0 — entry
finalization":**
1. **C0 = authentication only ("who you are").** In scope: dashboard login (Google/Microsoft as a *login-identity
   provider* via Supabase Auth), email+password, **2FA** (TOTP enroll+challenge), **sessions** (JWT, TTLs,
   cookies, expiry/re-auth), **invite-based account creation**, **first-boot Super Admin seed**, **"trouble
   signing in"** recovery + support-request handling, **inbound webhook authentication** (HMAC/JWT verify of
   GHL/Google/Slack webhooks — a hard control per ADR-007). Out of C0: roles/permissions/clearances/RLS → **C1**;
   **connector OAuth + token lifecycle** (the AI's data access to Gmail/Drive/GHL/Slack, AF-013/014) → **C3 Tool
   Layer**. The **seam** is the session establishing `auth.uid()`. NOTE: the design doc places much auth content
   **structurally under the `## 1.` RBAC header** (L643–816: app auth flow, sessions, webhook security) — we
   re-home it to C0 by semantics. C0's own header is only L358–390.
2. **Supabase Auth research-first gate done BEFORE drafting C0 FRs** (Supabase is a *platform* dep, so findings
   live in `feasibility-register.md`, not `tool-integrations/`).

**Supabase Auth research pass (2026-06-24, 4 parallel primary-source agents) → `feasibility-register.md` Block J
(findings SA1–SA17) + new AF-073–077 + sharpened AF-067.** It **refuted/corrected 6 design-doc claims** — these
MUST be cited from Block J, not the design doc, in C0 FRs:
- ⛔ **Refresh-token "7-day TTL" REFUTED** — Supabase refresh tokens **never expire**; single-use rotating, 10s
  reuse interval, reuse-detection revokes the whole session. Session bounds = optional time-box/inactivity
  (Pro+, no default, lazily enforced). The design's `auth.session_refresh_days:7` maps to **no native setting**.
- 🟠 **HTTP-only cookies** — NOT the documented default (`@supabase/ssr` says HttpOnly "not necessary") → AF-073.
- ⛔ **"Server-side session continues mid-task"** — no such object; either middleware refreshes the JWT or
  background runs as `service_role` (bypasses RLS, no `auth.uid()`).
- ⛔ **`two_factor_required` as a config flag** — no org-wide end-user MFA toggle exists; must be **built** via
  restrictive `aal2` RLS on every protected resource + post-login app gating → AF-076.
- ⛔ **72h invite links** — hard cap **24h (86400s)**, global setting, not per-link → AF-074 + custom-token fork.
- ⬜ **Microsoft Authenticator** — unnamed by Supabase; compat rests on open RFC-6238 → AF-075.
- ✅ Verified & useful: TOTP default-on; Google+Azure login IdP (pin tenant, require `email` scope, `xms_edov`);
  invite-only supported (admin API bypasses the signup toggle); **custom SMTP mandatory for prod** (built-in
  2/hr); **no per-account login lockout** (platform Cloudflare/fail2ban + CAPTCHA + leaked-pw Pro+) → AF-077;
  **asymmetric JWT (RS256/ES256) default since 2025-10-01** → local JWKS verification (`getClaims`), but
  `getUser` where revocation matters; API-key rename anon→`sb_publishable`, service_role→`sb_secret`.
- **AF-067 SHARPENED (load-bearing for C1/ADR-006):** `STABLE` alone ≠ once-per-statement; helper calls MUST be
  wrapped `(select …)` to force the initPlan (Supabase benchmark **178,000ms→12ms**), index policy cols, scope
  `TO authenticated`, wire the `auth_rls_initplan` lint. Now a binding implementation rule, not an open risk.

**Files changed:** `phase-playbooks.md` (Component 0 entry finalization), `feasibility-register.md` (Block J,
AF-073–077, AF-067 sharpened, next-AF→AF-078), `README.md` (Phase-1 row 🟡 + status line), this log.

**NEXT STEP — draft `spec/01-requirements/component-00-login.md`** (per Phase-1 playbook steps 1–5), as the golden
exemplar. Open with a **Context Manifest** (ADR-001 §2/§5 Supabase+secrets custody, ADR-006 §6 service-role
bypass, ADR-007 webhook-auth-as-hard-control; standards: config-edit-taxonomy, migration-discipline; glossary
auth terms; **feasibility Block J + AF-073–077**; design-doc **L358–390 + L643–816**). **Area codes:**
AUTH (login/OAuth/2FA), SESS (sessions/tokens), INV (invites), SEED (first-boot Super Admin), REC (recovery/
support), WHK (webhook auth). Decompose into atomic FRs citing **Block J** for vendor facts. Build
`system-map/00-login.md` zoom-in alongside (per-component map policy). Then user resolves ODs → ACs → verification
gate → sign-off.

**Component-0 OD candidates to LOG when drafting** (4 research forks + ~8 from the design-doc mapping — none
logged yet; will be OD-012+): (a) **session-lifetime model** — adopt Supabase rotating-never-expiring + inactivity
vs custom bounds [SA3]; (b) **mid-task continuation** — middleware JWT-refresh vs service_role [SA5]; (c) **invite/
setup-link expiry** — re-spec ≤24h vs custom invite-token layer [SA11/12, AF-074]; (d) **HttpOnly** — hard
requirement (spike AF-073) vs accept default [SA4]; (e) **2FA delivery UX** (same-page vs redirect) + wrong-code
rate-limiting; (f) **per-user 2FA override** vs deployment-wide; (g) **support-request notification** — who's
alerted on submit + phone capture/lookup + call logging + unreachable-user escalation; (h) **invite edge cases** —
expired→re-request? admin revoke-early? OAuth+password dual setup?; (i) **Super Admin seed** — OAuth option? bounced-
email recovery path?; (j) **RLS every-table coverage** discipline (ties to AF-076); (k) **webhook** — secret
rotation, replay beyond timestamp, accept-rate limits; (l) **webhook failure alert** — recipient, source-id,
escalation action.

**Carry-ins (unchanged):** GHL/Gmail/Slack connector findings (F1–F6, AF-013/014) are for **C3**, not C0; **OD-011**
(Slack app class) resolves at the C3 Slack connector; **`standards/rbac.md`** owed when C1/data-model specced
(from ADR-006); **OD-010** (compensation/rollback) is a C5/C6 item. Build-time spikes AF-001/002/004 + the new
AF-073–077 run on a runnable prototype.

---

## Session 14 — 2026-06-23 — ADR-008 ACCEPTED (backup & disaster recovery) — last Phase-0 blocker closed

User asked "what's next," chose **OD-009 (backup/DR)** — the last actionable Phase-0 item (the 3 SPIKE/EVAL
priority spikes are build-time, deferred). Then delegated the three forks to me ("what do you recommend and
why, explain simply"). Drafted → he probed two points (why PITR ~$100, the Storage-bucket caveat) → resolved
both → wrote **ADR-008**, closing OD-009. Phase 0 now has **no blockers left**.

**Research-first, per the AF-003 lesson (vendor facts go stale):** ran a dated primary-source pass on Supabase
backup/DR before asserting anything. It **reframed the whole decision** — the dominant loss path is **the
client's credit card, not a crash**: because ADR-001 puts the project on the client's account, a billing lapse
pauses it after ~7 days → restorable 90 days → then **the project AND all in-project backups (daily + PITR) are
permanently deleted together**. PITR alone can't save you (it lives inside the doomed project).

**Decided (6 binding parts):** *(Decision part 1 was revised later in the same session — see "In-session
revision" below; the entry reflects the final state.)*
- **Default = free daily in-project backups + an hourly off-platform snapshot** (~1-hour RPO, near-zero cost,
  AF-072-bounded). **PITR is an opt-in upsell** (off by default, ~$100+/mo on the client's card, for
  minute-level RPO or brains too big for an hourly logical dump). Running below hourly is a **logged downgrade
  exception**, never a silent default.
- **Independent off-platform `pg_dump` to a client-owned destination** (different region), run **hourly**,
  independent of the primary project lifecycle — the **only** defense against the deletion path. **Client-owned**
  so the operator never holds business data (preserves the ADR-001 boundary). Operator-held copy = logged
  per-client exception.
- **Ownership split:** client owns + pays; **operator operates + verifies** (the OD's core "whose job" ambiguity).
- **Tested restore rehearsal** to a throwaway project (Supabase verifies nothing; we do) — confirms DB + pgvector
  + auth rows come back queryable. ⚠️ AF-069.
- **Backup-health joins the management-plane push** (ADR-001 §7) — operational metadata only: recovery tier
  (daily+hourly, or PITR), last-backup time, **project status incl. pause/billing-at-risk**, off-platform-
  snapshot + rehearsal results; read via Supabase Management API (⚠️ AF-070); **loud Super Admin alert on
  lapse** → a failing client backup is *seen* before the deletion window (protects #1 + #3).
- **Golden rule governs scope + Storage buckets out of scope** (OOS-013): per `L1634` source files live in
  their system of record, **referenced (`source_ref`) not copied into Supabase**; v1 Storage holds only
  **regenerable offboarding exports** (`L97`), checked against the design doc — not source-of-truth. DR posture
  = restore-with-downtime, not hot failover (Enterprise-only; OOS-014).

**In-session revision (operator's call):** Austin pushed that ~$100/mo PITR-on-by-default is overkill, and
(correctly, citing the golden rule) that files should be **referenced in their system of record, not stored in
Supabase**. Both confirmed: (1) **default flipped to hourly off-platform snapshots + free daily; PITR demoted
to a documented opt-in upsell** — cheaper, and acceptable because memory is re-derivable from systems of record
that survive any incident (so AF-072 now gates the *default* hourly cadence). (2) The **golden rule (`L1634`)**
was already the design's law (only Storage use is the transient offboarding export); lifted it into the glossary
as a **binding principle** so no future component copies source files into Supabase. ADR-008 carries a dated
**Revision** note (Accepted-but-ink-wet, transparent amendment per change-control). Glossary +Golden rule,
+Off-platform snapshot, +RPO, +PITR upsell, +Restore rehearsal.

**Vendor facts that drove it (primary-source, 2026-06-23):** PITR = paid add-on, 2-min RPO, replaces daily,
not Spend-Cap-covered; free daily = Pro 7d/Team 14d, can lose ~24h; backups cover **DB only (incl. pgvector +
auth), NOT Storage buckets**; **Management API can read backup status** without business data; **no platform
restore-verification**; **no auto-failover** on Pro/Team. Could NOT verify from primary docs (→ AFs): backup
**region locality / AU residency** (AF-071), exact **Management-API payload fields** (AF-070).

**Captured as MUST-TEST:** new feasibility **block I** — AF-069 (restore actually works, SPIKE — the load-
bearing one), AF-070 (Management API exposes the health fields, SPIKE), AF-071 (backup region/AU residency,
DOCS/vendor confirmation — primary docs insufficient), AF-072 (off-platform dump completes in-window at scale,
LOAD).

**Files changed:** `adr/ADR-008-backup-dr.md` (new, Accepted); `open-decisions.md` (OD-009 → 🟢);
`adr/README.md` (ADR-008 row); `feasibility-register.md` (new block I AF-069–072; next AF-073);
`out-of-scope.md` (OOS-013 Storage buckets, OOS-014 HA/failover; next OOS-015); `what-makes-it-great.md`
(non-negotiable #1 watch + dimension-11 row cleared 🔴→🔵 + "one gap left" summary); `README.md` (ADR status
line — ADR-008, no Phase-0 blockers, next = Phase 1 component 0).

**Next step:** **Phase 0 is done — start Phase 1, component 0 (Login)** as the golden exemplar, building its
`system-map/` zoom-in alongside it (per the per-component map-build policy). Phase-1 carry-ins to honor:
**propagate the AF-003 corrected vendor values** into connector/token/rate-limit FRs (esp. GHL refresh-token
persistence F5, Gmail per-env quota F1, Slack app class **OD-011**); **OD-011** (Slack app registration,
🟡 rec (a) internal-custom-app) resolves when the Slack connector/ingestion component is specced;
**OD-010** (compensation/rollback) is a Phase-1 Harness/Guardrails item; write **`standards/rbac.md`** when
component 7 / data model is specced (owed from ADR-006). The 3 SPIKE/EVAL priority spikes (AF-001/002/004)
plus the new AF-069/070/072 are build-time, run on a runnable prototype.

---

## Session 13 — 2026-06-23 — AF-003 vendor-claims spike (DOCS pass) — first feasibility item verified

User asked "what's next," chose feasibility spikes, then asked whether "priority spikes" = "feasibility
spikes" (yes — priority = the run-first subset that can invalidate the architecture; same `AF-` register).
**Honest constraint surfaced:** 3 of the 4 priority spikes (AF-001 cost, AF-002 retrieval, AF-004
provisioning) are SPIKE/EVAL and **need a runnable prototype that doesn't exist** — can't run from inside a
spec repo without fabricating results (would violate non-negotiable #3 + anti-hallucination rule). The **one
doable now** is **AF-003 (vendor-claims, method DOCS)** — pure documentation verification. Ran it: 4 parallel
research agents over Google/Gmail, GHL+Slack, Supabase+pgvector, Inngest+Railway, all against current primary
vendor docs.

**Result — 3 claims stale/refuted, 1 design fork, rest verified:**
- ⛔ **AF-011 (GHL rate limit) REFUTED** — not "120/min, no burst"; real = **100 req/10s burst + 200k/day, per
  app per location**. No per-minute limit. Daily cap is the real ceiling.
- ⛔ **AF-014 (GHL OAuth refresh) PARTLY REFUTED** — refresh token is **NOT indefinite**; it **rotates per use**
  + dies after **1 yr unused**. ⚠️ **#1 risk:** harness must persist the new refresh token every refresh or
  silently lose access.
- 🟠 **AF-010 (Gmail quota) STALE** — "250/sec" gone → **6,000 QU/min/user**, and **date-dependent** on GCP
  project activation (pre/post 2026-05-01). Pin per-environment. +100-token-per-account cap.
- 🟠 **AF-017 (Edge Functions) STALE** — "150s" is Free-only; paid = 400s; real constraint = **2s CPU cap (all
  plans)**. Cite that, not 150s.
- 🔴 **AF-012 (Slack) → DESIGN FORK, logged OD-011** — since 2025-05-29 non-Marketplace apps have
  `conversations.history/.replies` throttled to **Tier 1 (1 call/min × 15 msgs)** = lethal for history ingest.
  **Exempt: Marketplace apps + internal custom apps.** OD-011 recommends **(a) internal custom app per client
  workspace** (fits ADR-001/005), EVAL-gated on a live workspace.
- 🟢 **Verified:** AF-013 (Google OAuth — sharper: Testing=7d expiry, 6mo-unused death, password-reset
  revoke, CASA annual reassessment ~weeks = onboarding critical path), AF-015 (Slack xoxb), AF-016 (Realtime —
  soft quotas + msgs/sec & joins/sec ceilings), AF-018 (Inngest — **per-key concurrency ✓ confirms ADR-004**;
  wording fixes: per-step ≤2h, `onFailure`/`inngest/function.failed` not "DLQ"; Free concurrency=5), AF-020
  (Railway — pre-deploy command blocks-on-fail ✓ confirms migrate-on-release + **branch-per-env corroborates
  AF-064 canary model**), AF-021 (cross-account Supabase works; ⚠️ service-role key = god-mode bypass-RLS, +
  static-egress-IP assumption for allowlisting).
- 🟡 **AF-019 (pgvector HNSW)** — HNSW verified, but **kept SPIKE/LOAD-open**: RLS/WHERE filters apply *after*
  the ANN scan, so per-client RLS (ADR-006) can starve recall; must LOAD-test **with RLS predicates applied**.

**Files changed:** `feasibility-register.md` (AF-003 row → 🟡; Block A all 12 statuses set; new "AF-003 DOCS
verification findings" subsection F1–F12 with corrected values + sources + design impacts); `open-decisions.md`
(new **OD-011** Slack app class, 🟡 rec (a); next OD-012); `README.md` (status line — spike progress + OD-011).

**Also built (user request) — the tool-integration research-first gate.** The tool set is open-ended and
client-driven; new connectors arrive per client/use case, and AF-003 just proved vendor facts go stale. So we
made a **repeatable research trigger**: no tool is specced until a dated, primary-source dossier exists.
- `standards/tool-integration-research.md` (new, **Binding**) — the 5-step procedure (open dossier → parallel
  research fan-out over 12 dimensions, primary docs only, date-stamped → file AF/OD/glossary outputs →
  verification re-check → only then spec the connector FRs) + the 12 research dimensions (auth/token lifecycle,
  rate limits, API, webhooks, data/sensitivity, provisioning, isolation, cost, failure, versioning) each tied to
  an ADR / non-negotiable, with the AF-003 finding that proves it matters + a **staleness / `Re-verify by`** rule.
- `tool-integrations/_TEMPLATE.md` (new) — the per-tool dossier shape.
- `tool-integrations/README.md` (new) — index; **pre-seeded** with Google/Gmail, GHL, Slack rows pointing at the
  AF-003 F1–F6 findings + OD-011 (so the spike work feeds the dossiers when those connectors are specced).
- `CLAUDE.md` — new section **"Adding a new tool / connector (research-first — this triggers research)"** after
  the feasibility rules; `README.md` repo map (+standard, +`tool-integrations/` folder).

**Next step:** **OD-009 (backup/DR — elevated, top-bar)** is now the last actionable Phase-0 item before
Phase 1 (the 3 SPIKE/EVAL priority spikes are build-time, deferred). Resolve OD-009 draft→approve (may spawn a
small ADR on the ownership question — client owns the Supabase, so backup ownership/verification is ambiguous;
underpins non-negotiable #1). **Then Phase 1 component 0 (Login)** as the golden exemplar + its `system-map/`
zoom-in. Corrected vendor values (F1–F12) must propagate into the Phase-1/2 connector, token-lifecycle, and
rate-limit FRs — esp. GHL refresh-token persistence (F5), Gmail per-env quota (F1), Slack app class (OD-011).
Carry-over from ADR-006: write `standards/rbac.md` when component 7 / data model is specced. OD-010
(compensation/rollback) is a Phase-1 Harness/Guardrails item.

---

## Session 12 — 2026-06-23 — ADR-007 ACCEPTED (prompt-injection posture) — last load-bearing ADR

Fourth **draft→approve** ADR, and the **last** of the seven. Closes OD-007. User was confused by the
first draft and asked to simplify — worked it through in plain language (Option A "spot the fakes" vs
Option B "lock the doors"; bank-teller-and-vault analogy landed). He then raised two sharp instincts
that *validated* the design: (1) detection is unreliable → that's why we lock the doors; (2) scanning
everything is expensive → that's why the one paid scanner is off by default. Approved, and explicitly
asked to "make sure to have the on/off switch for the smoke alarm" → captured as config
`injection_semantic_detection` (default **off**).

**Decided (6 binding parts):**
- **Containment-first, not detection-first.** The security boundary is the controls that **ignore
  prompt content entirely** — hard limits in code (`L2053`/`L2066`), default-deny RBAC + RLS (ADR-006),
  approval gates (`L2772`), rate limits (`L2809`), physical cross-client isolation (ADR-001),
  sole-writer + sensitivity-gated memory (ADR-004). A successful injection is **contained, not
  necessarily caught**. This is "controls before gates" (ADR-003) applied to injection, and the only
  posture consistent with non-negotiable #2.
- **Keep the cheap deterministic layers, always on:** external-data **boundary tagging** (`L2965`),
  high-precision **regex tripwires** (`L2943`, log/alert only — not a gate), **webhook HMAC auth**
  (`L742–809`, a real hard control = authentication, not content-detection).
- **Detection-as-signal:** the **embedding-similarity classifier** (`L2959`, the "partly theater" part)
  ships **off by default**; when on it may only flag for triage — **never** auto-quarantine/discard/
  block. Promotion past off-by-default is EVAL-gated.
- **Fail-safe = retain + route to human.** Quarantine **holds** content (shadow-retain) and never
  machine-discards it; **discard is a human-only logged decision** (protects non-negotiable #1). Every
  match logged loudly; every quarantine alerts (protects #3).
- **Thresholds (0.85/0.95) are signal-tuning knobs, not safety dials** — config registry must document
  them as such so no future requirement mistakes a threshold for the boundary.
- **Rejected:** A1 detection-primary (the review's "theater"; unbounded false-negatives + false-positive
  quarantine drops knowledge); mandating the embedding scan on the hot ingest path (read-path cost,
  unproven payoff); machine auto-discard (violates #1).

**Captured as MUST-TEST:** new feasibility block **H** —
- **AF-068 (SPIKE / red-team)** — the containment boundary holds end-to-end: **no authorized-but-
  dangerous autonomous action path** reaches a consequential side effect (external comm / financial /
  cross-client read / destructive write / memory poisoning) without hitting a code gate that ignores
  prompt content. The whole posture rests on this; a bypass must be **closed in code**, not patched with
  a detection rule.

**Files changed:** `adr/ADR-007-injection-posture.md` (new, Accepted); `open-decisions.md` (OD-007 →
🟢); `adr/README.md` (ADR-007 Accepted); `feasibility-register.md` (new block H AF-068; next AF-069);
`glossary.md` (+Containment-first injection posture, +External-data boundary tag, +Detection-as-signal);
`what-makes-it-great.md` (#2 ⚠️ flag cleared → now points at AF-068 red-team residual); `README.md`
(ADR status line — **all seven ADRs landed**).

**Next step:** **Phase 0 ADRs are done.** Remaining before Phase 1: the **priority feasibility spikes**
(AF-001 cost, AF-002 retrieval, AF-004 provisioning) and **OD-009 (backup/DR — elevated, top-bar)**.
Then **Phase 1 component 0 (Login)** as the golden exemplar, building its `system-map/` zoom-in
alongside. Note still-owed from ADR-006: the `standards/rbac.md` standard (write it when component 7 or
the data model is specced). OD-010 (compensation/rollback) is a Phase-1 Harness/Guardrails item.

---

## Session 11 — 2026-06-23 — The three non-negotiables captured (operator's top bar)

User noted (correctly, applying Rule 0) that the "what does *great* mean to you?" question lived
only in chat, never the repo. He answered: **wants all three** — never lose/corrupt knowledge,
never do something it shouldn't, never fail (silently). Affirmed coherent: the three don't conflict
(integrity / safety / observability), they only cost rigor.

**Captured:**
- `what-makes-it-great.md` — new top section **"The three non-negotiables (the operator's top bar)"**:
  each invariant + what upholds it + what threatens it. Framed as the **ranking rule** for Phase-1
  trade-offs (invariant wins over convenience/speed/scope).
- `process-overview.md` — added the three to "what the user wants."
- **OD-009 (backup/DR) ELEVATED** — it underpins non-negotiable #1, so it's now top-bar, not a
  Phase-5 nicety; resolve early.
- `CLAUDE.md` — added a binding **"three non-negotiables"** section right after Rule 0 (they were
  only transitively reachable via process-overview; now every chat treats them as the ranking rule).

**Consequence to remember:** invariant #1 leans on OD-009 (backup/DR — still a gap); invariant #2
leans on ADR-007 (injection — still open, next up). So the two open items both touch a non-negotiable.

**Next step:** unchanged — **ADR-007 (prompt-injection posture)**, draft→approve (last load-bearing
ADR); then priority spikes (AF-001/002/004); then Phase 1 (component 0 Login). Resolve OD-009 early
given its elevation.

---

## Session 10 — 2026-06-23 — ADR-006 ACCEPTED (dynamic roles vs static RLS)

Third **draft→approve** ADR. Closes OD-006 — roles are editable at runtime but RLS is authored at
migration time. User asked to "simplify" and worked through it interactively (anchored on "aren't we
using Supabase for login/OAuth?" — yes, and ADR-006 sits on top of it). The keycard analogy landed;
user pushed "why not make both [grant + revoke] instant?" — which pushed the design to the *simpler*
pole and removed a whole sub-problem.

**Decided (6 binding parts):**
- **False fork — keep both via static, data-driven RLS over *live* permission data.** Permissions
  live in **tables** (`roles`, `role_permissions`, `user_roles`, `sensitivity_clearances` w/
  entity-type scope, `restricted_grants`), edited from the dashboard with **no migration**. RLS
  policies are authored once, **generic** (never name a role), and look up the user's *current*
  permissions **live** each query via `STABLE SECURITY DEFINER` helpers keyed on `auth.uid()`.
- **Every change is instant** — grant *and* revoke — because nothing is cached on the token. This
  deleted the original "propagation latency" fork entirely (no JWT snapshot → no staleness window →
  no split grant-lazy/revoke-forced rule, no forced-logout machinery).
- **Division of labor:** RLS owns the visibility/sensitivity/Restricted **row-access** subset (DB
  backstop); the **harness** owns the full permission matrix in code. Both read the same tables →
  can't drift.
- **Two ADR-001 reconciliations baked in** (so nothing re-reads stale doc text): RLS is
  **intra-client only** — the doc's `client_slug` clause (`L724`) is **deleted**, cross-client
  isolation is physical; and RLS guards the **user-session** path only — the Memory Agent (sole
  writer, ADR-004) + backend run as the **service role**, which **bypasses RLS** (governed by harness
  RBAC). No requirement may assume RLS guards an agent write.
- **Rejected:** D1 one-policy-per-role (migration per edit, breaks `L471`/`L639`); D2 JWT-cached
  permission claims (faster reads but imports a staleness/propagation problem not worth it at ≤20
  users — kept only as the documented fallback, OOS-012).

**Captured as MUST-TEST:** new feasibility block **G** —
- **AF-067 (SPIKE+LOAD)** — live data-driven RLS performs on the **hot retrieval path** (the `STABLE`
  helper lookup, once per statement over tiny indexed tables, composing with pgvector ranking of a
  large memory batch). The whole D3 choice rests on this; D2 JWT-cache is the fallback if it fails.

**Files changed:** `adr/ADR-006-rls-dynamic-roles.md` (new, Accepted); `open-decisions.md`
(OD-006 → 🟢); `adr/README.md` (ADR-006 Accepted); `feasibility-register.md` (new block G AF-067;
next AF-068); `out-of-scope.md` (OOS-012 JWT-cached claims deferred; next OOS-013); `glossary.md`
(+Data-driven RLS, +Permission tables, +Restricted grant, +Entity-type-scoped clearance,
+Service-role bypass); `README.md` (ADR status line).

**Still owed (deferred to where context is richest, not now):** the new binding standard
`standards/rbac.md` (two-level RBAC + RLS model, default-deny, RLS-vs-harness division, service-role
caveat, `PERMISSION_NODES.md` convention) — write it when component 7 (RBAC/Guardrails) or the data
model is specced, per the ADR's Consequences. ADR-006 is the source of truth meanwhile.

**Next step:** **ADR-007 (prompt-injection posture)** — draft→approve (OD-007). The last load-bearing
ADR. Decide how much to lean on code-level hard limits vs regex/embedding detection (the doc calls the
latter "partly theater" + false-positive-quarantine risk); affects the Guardrails component. Note the
ADR-003 hard-limit precedent ("controls before gates") and `L2066` ("no user role, no agent
instruction, no config change can override a hard limit") as the lock-points. Then priority spikes
(AF-001 cost, AF-002 retrieval, AF-004 provisioning), then Phase 1 (component 0 Login).

---

## Session 9 — 2026-06-23 — Quality bar + failure overlay + honest "is it great?" audit

User pushed: the happy-path map looked too simple and lacked the finer detail separating a good vs
great harness, and asked whether the "great" stuff is actually in our system — capture it if not.

**Created:**
- `what-makes-it-great.md` — the great-vs-good quality bar across 12 dimensions, **plus an honest
  coverage audit** (where each lives in the design doc / ADRs + status: designed / ADR-hardened /
  paper-pending-test / gap). Headline: most great dimensions ARE designed in or ADR-hardened; the
  rest is "great on paper, must be tested" (AF register). Becomes a Phase-1 gate.
- `system-map/failure-overlay.md` — the shadow map: per step, what goes wrong + the mechanism that
  catches it (with cites). This is where the real depth/complexity lives.
- Rendered both as live visuals.

**Gaps surfaced & tracked:** **OD-010** (compensation/rollback of partially-completed task chains —
no undo story for external side effects when a chain halts; the one genuinely new gap from the
audit). OD-009 (backup/DR) reaffirmed. Everything else either designed, ADR-hardened, or in the AF
register as paper-pending-test.

**Wired:** README repo map; phase-playbooks Phase 1 step 8a (quality-bar + failure-overlay check
per component). 

**Answer to "is the great stuff in our system?":** mostly yes (dimensions 1–10 designed/hardened);
2 real gaps now tracked (OD-009, OD-010); the residual risk is paper-pending-test items, all logged.

**Next step:** unchanged — **ADR-006 (dynamic roles vs static RLS)**, draft→approve; then ADR-007;
then spikes; then Phase 1.

---

## Session 8 — 2026-06-23 — System map + per-component zoom-ins + grounding mode

User hit real anxiety: couldn't picture the system end-to-end ("blank in my head"), feared he
couldn't explain it / that the build won't match the vision stuck in his head. **Root cause = a
missing top-down VIEW** (we'd only ever built bottom-up: decisions/ADRs/requirements). Fix = make
the system visible, and build support for the user into the repo.

**Created:**
- `system-map.md` — top-down end-to-end route (8-stage "drive"), the continuous layer
  (loops/observability/proactive), the infra/compliance foundation, component legend C0–C10, and
  the **simulation technique** (walk a scenario down the map → each gap becomes an OD/requirement)
  with a worked GHL-lead example.
- `system-map/` — per-component zoom-in folder + index (all 11). **Build policy:** each zoom-in is
  built when we spec that component in Phase 1, so maps never drift from requirements. `02-memory.md`
  built now as the **exemplar** (reflects ADR-002/003/004). Out-of-order builds allowed if a
  component is causing anxiety.
- `working-with-me.md` — **grounding mode**: recognise the pattern (anxiety = missing-view signal,
  not a defect), do/don't list, and a 7-step "ground me" protocol.

**Wired:** CLAUDE.md now opens with a priority **grounding-mode** section + map pointers; README
repo map updated. Rendered the e2e map and the Memory zoom-in as live visuals in chat.

**Next step:** unchanged — **ADR-006 (dynamic roles vs static RLS)**, draft→approve; then ADR-007;
then priority spikes; then Phase 1 (component 0 Login as golden exemplar). When we spec each
component, build its `system-map/` zoom-in alongside it.

---

## Session 7 — 2026-06-23 — ADR-005 ACCEPTED (deploy fan-out & provisioning)

Second **draft→approve** ADR. Closes OD-005 — deploy fan-out, per-client provisioning, and version
skew, all asserted-not-designed in the doc. User chose the two forks in plain-language terms after I
explained them; then flagged a real gap (a brand-new business has no data to test a canary on), which
became a third decision axis.

**Decided (7 binding parts):**
- **Fan-out is already solved by ADR-001 §6** — no custom CI; each Railway project natively tracks the
  shared repo. `client_registry` is the observability map, not the deploy driver. Also re-stated
  ADR-001 §7 (push, not pull) for version/health reporting.
- **Blast radius = canary + release-train** (chose A3 over instant-global / per-deployment-manual):
  feature → `release` (canary tracks) → promote (fast-forward) → `main` (fleet auto-deploys). Promotion
  gated on tests + clean migration + green smoke battery + soak. Per-deployment migration-failure
  isolation retained (`L1141-1160`).
- **Version skew is normal + bounded, not an error** — made safe by **expand-contract migrations**
  (new binding standard `standards/migration-discipline.md`); rollback = code-redeploy + roll-forward,
  **never destructive down-migration**; `deploy_max_version_skew`/`deploy_max_skew_days` alert catches
  laggards.
- **Provisioning = scripted CLI + runbook** (chose B3 over full-IaC / pure-manual), **two-party** per
  ADR-001 hybrid: client creates cost-bearing accounts + card + delegated access (runbook); operator
  script does Railway link + env/`DEPLOYMENT_CONFIG` + `internal_token` mint/dual-store + `client_registry`
  insert + first-deploy→seed. **Operator-side registration** (no self-registration → no token chicken-and-egg).
- **OAuth apps per-client in the client's own accounts** (ADR-001 §5), redirect URIs → that deployment's
  Railway domain. ⚠️ Google **production verification** (AF-013) is a real onboarding **schedule dependency**.
- **Canary test method** (user's gap): **seeded synthetic client + deterministic smoke battery** now
  (catches boot/migration/connector + behavioral checks; shares the AF-001/AF-002 corpus), maturing into
  **operator dogfooding** its own deployment. Honest limit flagged: catches only what fixtures cover.
- **Plugins stay out of the release train** (per-deployment, manual; version-visibility only).

**Captured as MUST-TEST:** new feasibility block **F** —
- **AF-064 (DOCS+SPIKE)** — Railway supports the branch-based canary/promotion + build-history rollback model.
- **AF-065 (SPIKE)** — expand-contract keeps a mixed-version fleet safe (the skew + rollback premise). *Parts 3+4 rest on this.*
- **AF-066 (EVAL)** — the synthetic canary corpus is representative enough to catch behavioral regressions.
- Sharpened **AF-004** (full provisioning path) and **AF-020** (Railway auto-deploy + migrate-on-release).

**Files changed:** `adr/ADR-005-deploy-provisioning.md` (new, Accepted); `open-decisions.md` (OD-005 → 🟢);
`adr/README.md` (ADR-005 Accepted); `feasibility-register.md` (new block F AF-064–066; AF-004/020 sharpened;
next AF-067); `glossary.md` (+Canary deployment, +Release train/promotion, +Version skew, +Expand-contract
migration, +Provisioning script vs runbook, +Synthetic canary corpus/smoke battery); `out-of-scope.md`
(OOS-010 automated plugin distribution, OOS-011 full-IaC; next OOS-012); `standards/migration-discipline.md`
(new, Binding); `README.md` (ADR status line, repo map standards).

**Next step:** **ADR-006 (dynamic roles vs static RLS)** — draft→approve (OD-006). Roles are editable at
runtime but RLS is authored at migration time; ADR-001 made RLS **intra-client only** (role/visibility/
sensitivity, never client separation) — lock against that. Then ADR-007 (injection posture, OD-007), then
priority spikes (AF-001 cost, AF-002 retrieval, AF-004 provisioning), then Phase 1 (component 0 Login).

---

## Session 6 — 2026-06-23 — ADR-004 ACCEPTED (memory-write concurrency)

First **draft→approve** ADR (not a grill). Closes OD-004 — the contradiction-check-then-write
TOCTOU race under `parallel_execution`/fan-out.

**Decided:** **Per-entity serialization + optimistic validate-and-commit.**
- Serialize only **same-entity** writes (disjoint writes stay parallel → fan-out preserved). A
  contradiction is always same-entity, so that's the only race that matters.
- **Core insight:** can't hold a DB lock across the multi-second Sonnet writer (pool exhaustion +
  ADR-003 waste). So LLM work runs **unlocked**; then a **short** transaction under **sorted
  per-entity Postgres advisory locks** (`pg_advisory_xact_lock`, sorted = deadlock-free) re-checks
  a per-entity watermark `max(updated_at)` — unchanged → commit; changed → re-run only the cheap
  **DB** contradiction check (no LLM) and commit/re-target/bounce. Locks held ~ms.
- Three supports: **Memory Agent = sole writer** (invariant, locks design `L3435`); **unique
  idempotency constraint** `hash(source_ref, sorted entity_ids, content_hash)` kills retry
  double-writes; **CAS supersede** (`WHERE superseded_by IS NULL`) kills lost supersession.
- Daily supersede / weekly merge **demoted** from correctness to hygiene. `memory_writes_per_minute:30`
  makes serialization effectively free.
- **Rejected:** A do-nothing/daily-job (wrong for hours), B global-serialize (kills fan-out),
  C pessimistic-lock-across-LLM (wrong granularity + hold time), D optimistic-only (misses the
  duplicate-insert case — folded in as a support instead).
- **User-flagged knob (left as-is):** on a detected race the re-check re-runs the **DB** check, not
  a full Sonnet re-decision — deliberate "good enough" to avoid LLM livelock. User approved.

**Captured as MUST-TEST (user explicitly asked):** new feasibility block **E** —
- **AF-061 (SPIKE+EVAL)** — the validate-and-commit actually closes the window, no livelock. *The
  whole correctness claim rests on this.*
- **AF-062 (LOAD)** — advisory locks + short txns don't bottleneck at scale; multi-entity locks
  deadlock-free.
- **AF-063 (DOCS+SPIKE)** — Inngest per-key concurrency behaves as assumed; degrades safely to
  advisory-lock-only.

**Files changed:** `adr/ADR-004-concurrency-model.md` (new, Accepted); `open-decisions.md`
(OD-004 → 🟢); `adr/README.md` (ADR-004 Accepted); `feasibility-register.md` (new block E
AF-061–063; next AF-064); `glossary.md` (+TOCTOU race, +Per-entity serialization, +Advisory lock,
+Optimistic validate-and-commit, +Idempotency key); `README.md` (ADR status line).

**Next step:** **ADR-005 (deploy fan-out & provisioning automation)** — draft→approve (OD-005).
Push-deploy to N Railway projects + per-client Supabase/OAuth provisioning + version skew across
clients. Builds on ADR-001 (hybrid ownership). Priority spike AF-004 (provisioning) is its
companion. Remaining draft-approve ADRs after that: ADR-006 (RLS/dynamic roles, OD-006),
ADR-007 (injection posture, OD-007). Then priority spikes, then Phase 1 (component 0 Login).

---

## Session 5 — 2026-06-22 — Process fully externalized (full-optics docs)

User wanted the entire operating model written down now (not just-in-time), with full optics —
what/want/goal/why/how — so any future chat inherits the complete picture and never has to
*invent* methodology (only *follow* it).

**Created:**
- `spec/00-foundations/process-overview.md` — the optics bible: WHAT we're doing, WHAT the user
  wants, the GOAL (Point B / DoD), WHY (first principles), HOW (the machine), ID system,
  artifacts map, who-decides-what, current-state pointer.
- `spec/00-foundations/phase-playbooks.md` — repeatable procedure for all 6 phases. Phase 0 + 1
  at full mechanical detail (Phase 1 is the engine: 10-step per-component loop incl. parking
  cross-phase CFG/UI/DATA/PERM stubs, verification gate, sign-off). Phases 2–6 at goal+approach+
  done-when altitude, each finalized right before entry (living docs, change-controlled).

**Wired:** CLAUDE.md start-of-session reading list now includes both, + the **self-sufficiency
test** (repo alone must suffice, zero conversation). README repo map updated.

**Principle locked:** *author methodology where context is richest (now); future chats execute,
never invent.* The repo-self-sufficiency test is the guard against drift across chats.

**Next step:** unchanged — **ADR-004 (concurrency model for memory writes)**, draft→approve.
Then ADR-005/006/007, priority spikes (esp. AF-001 cost, AF-002 retrieval), then Phase 1
(component 0 Login as the golden exemplar).

---

## Session 4 — 2026-06-22 — Process hardening (5 additions) + retrofit pass

(Side chat, after ADR-003 committed `411364a`. This chat became the writer; working tree was
clean/synced first.) Added five process improvements the user requested:

1. **Backup & disaster recovery** — logged **OD-009** (whose job + strategy; ADR-001's
   client-owned Supabase makes backup ownership/verification ambiguous) and added it to Phase 5
   scope in README. Net-new gap, not a retrofit.
2. **out-of-scope.md created** (OOS-001..009) — seeded by **retrofitting deferrals already made**
   in ADR-001/002/003: region v2, confidence-weighted slot-fill v2, re-rank/HyDE off-by-default,
   self-host Inngest, full Model-A (client compute) exception-only, Pooled fallback, weekly cost
   auto-throttle out, HR ingestion off, cost reconcile deferred.
3. **Build-order / dependency map** — added to Phase 6 (README).
4. **Change-control standard** (`standards/change-control.md`) — Accepted ADRs immutable
   (supersede via new ADR); Ready/Approved FRs change via a new OD. Wired into CLAUDE.md +
   requirement-template.
5. **Component sign-off** — added `Approved` to the FR status lifecycle (requirement-template),
   the end-of-session ritual (CLAUDE.md), and the Definition of Done (README).

**Retrofit check — result: nothing needs reopening.** ADRs 001–003 stand as-is; they were
signed off via grilling, so the new `Approved` status applies to Phase-1 component FRs going
forward, not retroactively. The only retrofit was capturing their already-made deferrals into
out-of-scope.md (#2 above). Accepted ADRs are now under change-control from here on.

**Files changed:** `out-of-scope.md` (new), `standards/change-control.md` (new),
`open-decisions.md` (OD-009; next = OD-010), `requirement-template.md` (Approved status +
rules 7–8), `CLAUDE.md` (change-control + sign-off ritual), `README.md` (repo map, Phase 5
backup/DR, Phase 6 build-order, DoD).

**Next step:** unchanged — **ADR-004 (concurrency model for memory writes)**, draft→approve.
Lock against the ADR-003 write-path (code filter → Haiku gate → Haiku pre-check → Sonnet writer)
and the `memory_writes_per_minute:30` cap (per Session 3 note).

---

## Session 3 — 2026-06-22 — ADR-003 ACCEPTED (cost model — client-side viability + cost ladder)

**Decided (grill complete, all forks resolved; closes OD-003):**
- **Scope reframed by ADR-001:** opex client-borne → operator marginal cost ≈ $0. Cost is **not**
  operator P&L. ADR-003 commits to (a) a per-deployment viability **envelope** and (b) runaway
  **guarantees**. (Rejected operator-P&L framing — would reopen ADR-001; rejected mechanisms-only.)
- **Breach = tiered ladder, not alert-only** (modelled on the rate-limit 80/95/100 ladder):
  soft alert `$50/day` + `$200/week` (notification only) → **throttle** non-critical at `$75/day`
  (1.5×) → **hard kill** at `$100/day` (2×) = urgent + human-only. All keys per-deployment,
  operator-tunable to client spend tolerance. Daily≠weekly×7 is intentional (spike vs sustained).
- **Cost source = estimate-grade**, not invoice: event-log tokens × an operator-editable price
  table; **all vendors** (Sonnet+Haiku+OpenAI embeddings); **fail-safe rounded UP** so the ceiling
  fires early. Real invoice is unreachable (ADR-001 boundary).
- **Memory write corrected:** OD-003's "3 Sonnet calls" is **wrong** → ≤**1 Sonnet** (writer) +
  Haiku pre-checks; code noise-filter + Haiku selective-writing gate run first. `memory_writes_per_minute:30`
  caps Sonnet writer at 30/min, not 90.
- **Loops short-circuit in code** (DB/condition check) before waking the Sonnet orchestrator —
  idle-deployment loop floor ≈ free. Not an LLM gate.
- **Principle "controls before gates"** (binding): structural/code limits first; one self-funding
  Haiku gate only (selective-writing); **re-rank/HyDE NOT mandated** (AF-002-gated). User pushed on
  "do we need extra LLM gates" — answer: mostly no.
- **Viability target ≤ ~$20/day typical**, $50 = investigate, $100 = backstop. Lever order if AF-001
  shows over-budget: model routing → selective-writing → loop gating → injection limit → orchestrator
  confidence threshold (highest leverage).
- **Haiku decision log + trust window (user-requested, ADR-003 §8):** all 3 memory-path Haiku
  decisions logged (input + verdict + outcome) for manual review; **3-week trust window**
  (`haiku_audit_window_days:21`) in **shadow-retain** mode (would-drop memories written + tagged,
  never lost); after the window, if disagree-rate < threshold the gate goes autonomous. This audit
  log IS the validation data for AF-043/AF-035. Same pattern = template for auditing routing later.
- **Model-routing telemetry (user-requested):** standing **dual-track** — cost (model+task+$) AND
  quality (false-drops/mis-routes/classifier errors). A cost win is worthless if quality silently
  degrades. → AF-035 sharpened.

**Files changed:** `adr/ADR-003-cost-model.md` (new, Accepted; incl. §8 Haiku decision log + routing
telemetry); open-decisions (OD-003 → 🟢); glossary (+Estimated cost, +Cost ladder, +Critical work,
+Haiku decision log, +Trust window, +Shadow-retain; Guardrail row +cost ladder); feasibility-register
(AF-001/035/040/041 sharpened; **AF-042** estimator drift, **AF-043** gate ROI/trust added); adr/README
(ADR-003 Accepted); README (ADR status line — all 3 load-bearing grills done).

**Feasibility:** ⚠️ AF-001/040/041 (viability target paper-only until cost spike) · ⚠️ AF-042
(estimate-vs-invoice drift) · ⚠️ AF-043 (selective-writing gate must pay for itself).

**Next step:** **ADR-004 (concurrency model for memory writes)** — draft→approve (not a grill).
TOCTOU race on contradiction-check-then-write under parallel agents; no per-entity locking defined
(OD-004). Note for ADR-004: the ADR-003 write-path (code filter → Haiku gate → Haiku pre-check →
Sonnet writer) and `memory_writes_per_minute:30` cap are the concurrency surface to lock against.

---

## Session 2 — 2026-06-22 — ADR-002 ACCEPTED (coverage % → Maturity + Retrieval Sufficiency)

**Decided (grill complete, 5 forks resolved):**
- **Q1 — split** the overloaded "coverage %" into two metrics (vs one number for both jobs).
- **Q2 — denominator = expected knowledge slots** per entity type (vs volume / confidence-only).
  Binary slot-fill at v1.
- **Q2b — one slot substrate, two read-paths** (vs two independent engines) + three anti-bloat
  guardrails: thin Sufficiency (no bespoke model), 5–8 operator-editable slots/type, defer
  confidence-weighted fill to v2.
- **`[Building]` recurs per-entity:** deployment cold-start *mode* is one-time (off at 80%
  permanently); the `[Building]` *flag* reappears for new/thin entities (e.g. a year-two client).
  Resolved the doc's two self-contradictions (per-entity vs overall; "permanent" vs recurring).
- **OD-008 closed:** `[Building]` is a flag, not a 4th pill → 3 pills (Cited/Inferred/Unknown).

**Model:** Maturity = `filled slots / expected slots` (stored, daily + on-write, aggregate gates
cold-start 20/50/80). Retrieval Sufficiency = query-time threshold over existing retrieval
signals (slots-touched filled AND surfaced above relevance×confidence bar). Pill rule:
low Sufficiency + entity Maturity < proactive(50) → `[Building]`; else `[Unknown]`.

**Files changed:** `adr/ADR-002-coverage-metric.md` (new, Accepted); glossary (retired Coverage %,
added Maturity / Retrieval Sufficiency / Expected knowledge slot, resolved Answer mode + Cold
start); open-decisions (OD-002, OD-008 → 🟢); adr/README (ADR-002 Accepted); feasibility-register
(AF-034 sharpened); README (ADR status line).

**Feasibility:** ⚠️ AF-034 — slot-fill Maturity predicting "useful" + the Sufficiency threshold
separating `[Building]`/`[Unknown]` are **paper-only**, validated in the AF-002 retrieval spike.

**Next step:** Grill **ADR-003** (cost model & economic viability — last load-bearing grill).
Note from ADR-001: opex is client-borne, so cost tracking is *visibility-grade, not
invoice-grade* — fold that into the ADR-003 framing. AF-001 cost spike runs alongside.

---

## Session 1 — 2026-06-22 — Foundations + ADR-001

**Decided:**
- Method locked: git markdown repo · grill load-bearing ADRs / draft-approve the rest ·
  foundations first then components 0→10. (See README.)
- **ADR-001 (Isolation model) — Accepted.** Silo (one Supabase per client) · single
  codebase / N runtimes · `client_slug` deleted from all app tables · hybrid account
  ownership (client owns Supabase + API keys + opex on their card; operator owns Railway
  compute / the moat) · Railway GitHub auto-deploy · Super Admin = pushed operational
  metadata only, never client business data.

**Created:**
- Repo skeleton: `README.md`, `CLAUDE.md`, `spec/00-foundations/` (id-conventions,
  requirement-template, glossary, open-decisions, adr/, standards/config-edit-taxonomy),
  `traceability-matrix.csv`, `spec/source/` (design doc + review scaffolding copied in).
- `spec/00-foundations/adr/ADR-001-isolation-model.md`.

**Open decisions remaining:** OD-002..OD-008 (see open-decisions.md). Load-bearing grills
left: ADR-002 (coverage metric), ADR-003 (cost model). Draft-approve: ADR-004 (concurrency),
ADR-005 (provisioning/deploy), ADR-006 (RLS), ADR-007 (injection), OD-008 (pill count).

**Added (post-ADR-001):** Feasibility track — `spec/00-foundations/feasibility-register.md`
(AF-* IDs, seeded with 4 priority spikes + vendor/behavioural/cost/scale assumptions). Wired
into CLAUDE.md (feasibility flagging rule), id-conventions (AF- type), requirement template
(Feasibility field), README (parallel track). ACRONYMS.md added at repo root.

**Next step:** Grill ADR-002 — define "memory coverage %" (the metric behind cold-start
gating, the [Building] pill, proactive suppression). Currently a percentage with no
denominator. When defined, link it to AF-034 (is the metric actually meaningful — EVAL).
