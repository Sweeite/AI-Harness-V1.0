# Pre-Phase-6 Whole-Spec Audit — Consolidated Report

**Scope:** Phases 0–5 of the AI-harness requirements repo, per `spec/00-foundations/pre-phase-6-audit-playbook.md`.
**Method:** 6 dimensions (ID Resolution, Traceability, Cross-phase Consistency, Change-control Integrity, Contradiction Hunt, Non-Negotiables #1/#2/#3), each run independently, followed by adversarial verification of every raw candidate finding before inclusion here.

---

## 1. Verdict

# RECONCILED (2026-07-02) — all 48 HIGH + 46 MED findings addressed — Phase 6 cleared

**Original verdict (this report, first pass): NOT YET CLEAN — 48 unresolved HIGH findings.** All 48 HIGH and 46 MED
findings below have since been reconciled: mechanical citation/naming-drift findings were fixed in place across ~30
files by a dedicated reconciliation pass (one agent per file/file-group, executing pre-decided fixes — no
independent judgment left to the fix agents); the genuine architectural-contradiction findings (H4–H8/H20/H21/H22/
H23/H32/H33/H36/H37/H47, plus companions) were resolved via seven new logged decisions, **OD-161…OD-167** in
`spec/00-foundations/open-decisions.md`, each with full rationale, options considered, and the resolution applied.
One finding (Dim5 H28, regex-triggered quarantine vs ADR-007) was reviewed against the actual ADR-007 text and
determined to be a misreading, not a defect — logged in the OD-161–167 block so it is not re-litigated. The 10 LOW
findings (cosmetic/unverified) were opportunistically fixed where a reconciliation agent was already touching that
file; a few were left as-is (logged as acceptable, non-blocking).

**The single most consequential resolution: OD-161** rolls back `FR-9.MODE.004`'s Act-tier autonomous external-send
capability to Prepare-only, reversing part of the previously **operator-decided** OD-088, because it collided with
ADR-007's locked "no config change can override a hard limit" text and reproduced the exact carve-out OD-047
(one day earlier) explicitly rejected. This is flagged for the operator's explicit awareness, not silently applied.

Per this audit's own pass criteria (§ playbook "Pass criteria," items 1–4): all six dimensions ran with adversarial
verification; 0 unresolved HIGH remain; every MED is fixed or logged; this report is updated with the resolution.
**Phase 6 (issue decomposition) is now cleared to begin**, per item 5 (README + SESSION-LOG updated, committed).

---

## 2. Summary table — finding counts by dimension × severity

| Dimension | HIGH | MED | LOW | Refuted | Total confirmed (H+M+L) |
|---|---:|---:|---:|---:|---:|
| Dim1 — ID Resolution | 12 | 4 | 0 | 0 | 16 |
| Dim2 — Traceability | 4 | 5 | 2 | 0 | 11 |
| Dim3 — Cross-phase Consistency | 2 | 11 | 5 | 0 | 18 |
| Dim4 — Change-control Integrity | 0 | 1 | 0 | 0 | 1 |
| Dim5 — Contradiction Hunt | 27 | 22 | 3 | 5 | 52 |
| Dim6 — Non-Negotiable #1 (never lose/corrupt knowledge) | 1 | 1 | 0 | 1 | 2 |
| Dim6 — Non-Negotiable #2 (never do something it shouldn't) | 1 | 1 | 0 | 0 | 2 |
| Dim6 — Non-Negotiable #3 (never fail silently) | 1 | 1 | 0 | 0 | 2 |
| **Total** | **48** | **46** | **10** | **6** | **104** |

Note: several findings describe the same underlying defect from two angles (e.g. the FR‑6.RTL.004 traceability gap is caught independently by Dim2 and Dim5; the FR‑5.ASM.007 injection-sanitization omission is caught by both Dim5 and Dim6‑#2). These are kept as separate line items below because each was independently verified against the repo and each cites a distinct piece of evidence — collapsing them is a decision for whoever reconciles the findings, not for this report.

---

## 3. Confirmed HIGH findings (48) — block Phase 6 until fixed or logged as OD/OOS/AF

### Dim1 — ID Resolution (12)

**H1. `spec/00-foundations/tool-integrations/gohighlevel.md:248-252`**
Summary: The 8 `CFG-GHL-*` keys coined in the GoHighLevel dossier were never transcribed into the Phase-2 config registry under any name.
Detail: `CFG-GHL-RATE-BURST`, `CFG-GHL-RATE-DAILY`, `CFG-GHL-ACCESS-TTL`, `CFG-GHL-REFRESH-TTL`, `CFG-GHL-VERSION-HEADER`, `CFG-GHL-SCOPES`, `CFG-GHL-WEBHOOK-PUBKEY`, `CFG-GHL-REVERIFY` appear nowhere in `config-registry.md`. The registry's connector section only has generic rate/token-refresh placeholders and `GOHIGHLEVEL_WEBHOOK_SECRET` — none cover the GHL-specific burst/daily caps, TTLs, pinned API version, 9-scope OAuth set, or the Ed25519 webhook pubkey. Safety-relevant because the webhook signature-verification pubkey and its OD-043 reverify date have no canonical, PERM-gated home.
Recommendation: Add the 8 GHL keys (or one structured Appendix-A object) to `config-registry.md` §F with class/default/validation/PERM-config.tools, then re-point the dossier citation at the registry rows.
Dimension: Dim1-ID-Resolution

**H2. `spec/01-requirements/component-03-tool-layer.md:495` (also 372, 469, 518, 541, 564, 587, 1037, 1129, 1151, 1396, 1419, 1441; `component-00-login.md:833,838,896,900,961,965,1032`; `surface-05-dashboard-ops.md:158,638`)**
Summary: `DATA-credentials` is genuinely dangling — schema.md has no `credentials` table; OD-P4-02 split it into `connector_credentials` (C3 OAuth tokens) and `webhook_secrets` (C0 webhook secrets), and `.slack_signing_secret` is not a real column anywhere.
Detail: schema.md defines only `connector_credentials` (access_token/refresh_token/expires_at/scopes/state) and `webhook_secrets` (generic secret_kind/secret_value/secret_version pair). `component-00-login.md:900` cites `DATA-credentials.slack_signing_secret` as if it were a column; the real schema stores it as a row value (secret_kind='slack_signing'). ~15 FR "Data touched" citations were never updated to the split names. Security-critical because these sit on token-custody (ADR-001) and webhook-verification FRs.
Recommendation: Replace every `DATA-credentials` citation with `DATA-connector_credentials` (C3 OAuth FRs) or `DATA-webhook_secrets` (C0 webhook FRs) per OD-P4-02; replace `.slack_signing_secret` with `webhook_secrets.secret_value` (secret_kind='slack_signing').
Dimension: Dim1-ID-Resolution

**H3. `spec/01-requirements/component-01-rbac.md:424`**
Summary: `DATA-memories.entity_type` is genuinely dangling — the `memories` table has no `entity_type` column, only `entity_ids uuid[]`, with the type living on the separate `entities` table.
Detail: FR-1.CLR.004's "Data touched" cites `DATA-memories.entity_type` directly, but that field does not exist anywhere in schema.md; entity type is `entities.type`, reachable only by joining through `memories.entity_ids`. This FR implements ADR-006 part 1 (entity-type-scoped clearance) and gates AC-1.CLR.004.1, a sensitivity/clearance exclusion rule.
Recommendation: Cite `DATA-memories.entity_ids` joined to `DATA-entities.type`, and note the join as the standard scoping mechanism.
Dimension: Dim1-ID-Resolution

**H4. `spec/04-data-model/rls-policies.md:51`**
Summary: `PERM-audit.view` gates `access_audit` reads but no `PERM-audit.*` family exists anywhere in the permission catalog or glossary.
Detail: The catalog's 12 seeded categories (FR-1.PERM.007) have no "audit" category and no node maps to an `access_audit` read. No OD resolves or homes `PERM-audit.view`.
Recommendation: Mint `PERM-audit.view` via change control (or map to an existing node if one truly covers it) and record it in `open-decisions.md`.
Dimension: Dim1-ID-Resolution

**H5. `spec/04-data-model/rls-policies.md:49-50`**
Summary: `PERM-clearance.grant` / `PERM-clearance.view` are cited for `sensitivity_clearances`/`restricted_grants` access, but the catalog only has `PERM-user.grant_clearance` under a different family prefix.
Detail: `PERM-clearance.*` appears nowhere in `PERMISSION_NODES.md` or `component-01-rbac.md`. There is also no read-equivalent "view" node under any family for this data.
Recommendation: Rename the rls-policies.md cells to `PERM-user.grant_clearance` (and add a read-equivalent node if genuinely needed), or mint `PERM-clearance.*` via change control — don't leave two parallel families.
Dimension: Dim1-ID-Resolution

**H6. `spec/04-data-model/rls-policies.md:50`**
Summary: `PERM-restricted.grant` is cited for `restricted_grants` writes but the catalog only has `PERM-user.grant_restricted`.
Detail: `PERM-restricted.grant` appears nowhere else in the repo; the catalogued node is `PERM-user.grant_restricted` (component-01-rbac.md lines 390/487/490/493/509/515/930).
Recommendation: Correct rls-policies.md to cite `PERM-user.grant_restricted`, or open change control if a distinct node is actually intended.
Dimension: Dim1-ID-Resolution

**H7. `spec/04-data-model/rls-policies.md:43,48`**
Summary: `PERM-user.manage` gates writes to `profiles`/`user_roles`, but the catalog only has granular nodes (`.assign_role`, `.deactivate`, `.reset_2fa`, `.grant_clearance`, `.grant_restricted`, `.invite`, `.view_activity`) — no coarse `.manage` node.
Detail: `PERM-user.manage` appears nowhere else in the repo. `PERM-user.view` (the read-gate on the same lines) is also undefined — only `.view_activity` exists.
Recommendation: Replace with the specific granular node(s) that actually apply to each write path, or mint `PERM-user.manage` via change control if a coarse node is genuinely intended.
Dimension: Dim1-ID-Resolution

**H8. `spec/04-data-model/rls-policies.md:43,48`**
Summary: `PERM-user.view` gates reads on `profiles`/`user_roles`, but the catalog only has `PERM-user.view_activity`, not a bare `PERM-user.view`.
Detail: `PERMISSION_NODES.md` line 62 defines only `PERM-user.view_activity`. `PERM-user.view` is used nowhere else in the repo except these two lines.
Recommendation: Correct to `PERM-user.view_activity` if that is the intended node, or mint a distinct `PERM-user.view` via change control if a broader read grant is actually needed.
Dimension: Dim1-ID-Resolution

**H9. `traceability-matrix.csv:348,350,351,352,354,360,362,366,375`**
Summary: `PERM-agent.edit_capability` (singular "agent") is cited as the live permissions value for 9 Approved Component-8 FRs, but the catalog only ever minted the plural `PERM-agents.edit_capability` (OD-137).
Detail: 9 rows (FR-8.REG.001/003/004/005, FR-8.SPC.001, FR-8.SCO.001/003, FR-8.PLAN.004, FR-8.COST.002) use the singular form, which has zero definition anywhere. Per Rule 0, Approved FRs cannot carry a citation to an undefined node.
Recommendation: Fix the singular→plural typo across all 9 rows to `PERM-agents.edit_capability`; also fix the same typo at `SESSION-LOG.md:1597` and `open-decisions.md:1221`.
Dimension: Dim1-ID-Resolution

**H10. `traceability-matrix.csv:271`**
Summary: `PERM-guardrail.hard_limit` is cited for FR-6.HRD.001 (hard-limit code enforcement) but component-06-guardrails.md's FR-6.HRD.001 defines no Permissions field at all, and no such node exists in the catalog.
Detail: Only `PERM-guardrail.edit_autonomy` (a different, unrelated node) is defined under the guardrail family. The hard-limit gate is code-enforced with no human role, so the citation may actually belong as `n/a`.
Recommendation: Change the cell to `n/a` (hard limits are non-overridable by any role, FR-6.HRD.003) or mint `PERM-guardrail.hard_limit` via change control if a real permission gate was intended.
Dimension: Dim1-ID-Resolution

**H11. `traceability-matrix.csv:276`**
Summary: `PERM-guardrail.approve_restricted` is cited for FR-6.APR.002 (mandatory hard-approval set) but that FR defines no Permissions field, and no such node exists in the catalog.
Detail: AC-6.APR.002.2 instead references the C1 Restricted/clearance model (grantee/Super-Admin) for routing, not a PERM node named `approve_restricted`.
Recommendation: Replace with `PERM-action.review` (OD-117), the closest catalogued equivalent, or mint `PERM-guardrail.approve_restricted` via change control if a distinct node is intended.
Dimension: Dim1-ID-Resolution

**H12. `traceability-matrix.csv:319`**
Summary: `PERM-approval.action` is cited for FR-7.ALR.003 (routing approval alerts) but no such node exists anywhere in the catalog or repo.
Detail: The closest catalogued equivalent is `PERM-action.review` (OD-117), a different node with a different scope (approval-queue decisions, not alert routing).
Recommendation: Correct the citation to `PERM-action.review` if that is the intended authority, or mint `PERM-approval.action` via change control if FR-7.ALR.003 needs a distinct notification-routing node.
Dimension: Dim1-ID-Resolution

### Dim2 — Traceability (4)

**H13. `spec/01-requirements/component-06-guardrails.md:3-6, 576-604, 874-876`**
Summary: FR-6.RTL.004 (cost-ladder enforcement, added via change control 2026-06-27) is missing from `traceability-matrix.csv` entirely, and the component file's own header/footer FR counts are stale (35/RTL×3 instead of 36/RTL×4).
Detail: The FR has Status: Approved and 3 well-formed ACs. Unlike C7's analogous change-control additions (FR-7.ALR.009, FR-7.LOG.008), which ARE in the matrix and updated the header/footer, C6's addition was never wired in, and `README.md`'s C6 status table also still reads "35 FRs / RTL×3."
Recommendation: Add a traceability-matrix.csv row for FR-6.RTL.004, and update component-06-guardrails.md's header/footer and README.md's C6 entry from 35/RTL×3 to 36/RTL×4.
Dimension: Dim2-Traceability

**H14. `traceability-matrix.csv` (row absent)**
Summary: FR-6.RTL.004 (a guardrail-class safety FR) exists in the component file but has no row anywhere in traceability-matrix.csv.
Detail: A full sweep of every FR-6.* id in the component file (36) against every fr_id in the matrix for component 6 (35) confirms FR-6.RTL.004 is the single missing one.
Recommendation: Add a row for FR-6.RTL.004 citing its ACs, source, and config/data dependencies (CFG-cost_ladder_*_threshold, DATA-guardrail_log).
Dimension: Dim2-Traceability

**H15. `traceability-matrix.csv` rows for FR-6.APR.002, FR-6.HRD.001, FR-10.DEL.006**
Summary: The permissions column cites PERM ids that do not exist anywhere in PERMISSION_NODES.md or in the cited component file, for three safety/compliance-critical FRs.
Detail: FR-6.APR.002 cites `PERM-guardrail.approve_restricted`; FR-6.HRD.001 cites `PERM-guardrail.hard_limit`; FR-10.DEL.006 cites `PERM-memory.delete-x2`. None exist in the 51-node catalog. FR-10.DEL.006's own "Permissions" field literally reads "Admin / Super Admin ×2 distinct" — no PERM- id at all.
Recommendation: Correct these three references to the actual catalogued nodes (or mint/log new ones per the catalog's add-on-ship rule), then re-sync the matrix.
Dimension: Dim2-Traceability

**H16. `traceability-matrix.csv` rows FR-8.REG.001/003/004/005, FR-8.SPC.001, FR-8.SCO.001/003, FR-8.PLAN.004, FR-8.COST.002**
Summary: Nine component-8 rows cite `PERM-agent.edit_capability` (singular), but the only catalogued node is `PERM-agents.edit_capability` (plural) — and OD-080 assigns FR-8.PLAN.004 to a *different* node (`PERM-agents.edit_description`).
Detail: `component-08-agent-design.md` contains zero occurrences of any `PERM-` id in its prose. OD-080 explicitly splits: `PERM-agents.edit_description` gates description/max_tokens/tuning *and* plan-version rollback (PLAN.004); `PERM-agents.edit_capability` gates memory_scope/tools_allowed/enabled (Super Admin only).
Recommendation: Fix the id typo matrix-wide, and re-map FR-8.PLAN.004 to `PERM-agents.edit_description` per OD-080.
Dimension: Dim2-Traceability

### Dim3 — Cross-phase Consistency (2)

**H17. `spec/01-requirements/component-01-rbac.md:424`**
Summary: FR-1.CLR.004 cites a nonexistent `DATA-memories.entity_type` field for entity-type-scoped clearance filtering, a core RBAC/security enforcement mechanism.
Detail: Same underlying defect as H3, independently caught from the cross-phase-consistency angle: `memories` carries no `entity_type` column; it feeds directly into FR-1.RLS.003's DB-level RLS predicate and FR-2.RET.004's retrieval filter, so a literal build against this citation either fails or risks an incorrectly-scoped clearance filter.
Recommendation: Correct to `DATA-sensitivity_clearances.entity_type_scope` evaluated against `DATA-entities.type` (joined via `memories.entity_ids`), matching how component-02-memory.md and rls-policies.md already model it; re-check FR-1.RLS.003 for the same mis-citation.
Dimension: Dim3-Cross-phase-Consistency

**H18. `spec/01-requirements/component-10-infra-compliance.md:381-416`**
Summary: FR-10.DEL.006(a)'s persistent, escalating "connector-deletion flag record" has no backing table in schema.md and is not tracked in the Phase-4 owed-back list.
Detail: AC-10.DEL.006.3 mandates the flag "escalates" over time if unacknowledged (a #3 never-silent requirement); AC-10.DEL.006.4 requires block/escalate on detection error. schema.md defines no such persistent, queryable, timestamped record distinct from the two-person-auth columns on `deletion_requests`. `_data-inventory.md`'s owed-back list has no entry for it.
Recommendation: Add a `connector_deletion_flags` table to schema.md §14 with per-system state + raised_at/acknowledged_at/acknowledged_by, and add it to `_data-inventory.md`'s owed-back list citing FR-10.DEL.006 / AC-10.DEL.006.1/.3/.4.
Dimension: Dim3-Cross-phase-Consistency

### Dim5 — Contradiction Hunt (27)

**H19. `spec/01-requirements/component-05-harness.md:518-525` (FR-5.ASM.007)**
Summary: C5's locked per-step execution order never names the injection-sanitization call site that C6's Approved AC-6.INJ.001.2 requires; tracked as an un-actioned carry-forward that a later C5 change-control session skipped.
Detail: FR-5.ASM.007's closed step order ("anomaly check → tool read → AI call → tool write → memory write") omits the ADR-007 sanitization/boundary-tagging pipeline. C6's AC-6.INJ.001.2 explicitly flags this gap. SESSION-LOG.md records it as un-actioned. Session 27's C5 change control (adding AC-5.TRG.001.3) touched the file but did not reconcile this.
Failure scenario: An implementer builds strictly to FR-5.ASM.007's sequence; no step is named as "run the C6 sanitization pipeline," so tool-read content could be concatenated straight into the AI-call prompt un-sanitized, defeating ADR-007's containment posture.
Recommendation: Amend FR-5.ASM.007 (via change control) to explicitly name the injection-sanitization/boundary-tagging step between tool-read and AI-call.
Dimension: Dim5-Contradiction-Hunt

**H20. `spec/01-requirements/component-05-harness.md:170-176` (FR-5.TRG.001.3)**
Summary: The C5 deployment-freeze dispatch gate requires the harness inside a client's own silo to read `client_registry.status`, but ADR-001 places `client_registry` exclusively in the separate management-plane deployment and mandates a strictly one-directional push (client → management plane), with no described mechanism for status to flow the other way.
Detail: FR-10.OFF.004/FR-10.DEL.007 invoke "the local mirror / FR-10.MGT.002" for this read, but FR-10.MGT.002 only defines the inbound (deployment→management-plane) ingest endpoint and explicitly states the management plane never pulls. "Local mirror" is undefined anywhere in the repo.
Failure scenario: A client is offboarded and frozen in the management-plane registry; because no mechanism propagates that status down, C5's dispatch gate has no local source of truth, so triggers/agents keep running against frozen data (#1/#2 violation).
Recommendation: Specify the missing downward-propagation mechanism as an explicit FR (a reviewed, narrow exception to push-only), or amend ADR-001 via change control; do not leave "the local mirror" undefined and load-bearing.
Dimension: Dim5-Contradiction-Hunt

**H21. `spec/01-requirements/component-09-proactive.md:231-281` (FR-9.MODE.004 / OD-088)**
Summary: FR-9.MODE.004's configurable autonomy grant for autonomous external-email sends contradicts the locked ADR-007 hard limit #1 ("never send external email autonomously, no config change can override") and was never reconciled against ADR-007 or FR-6.HRD.001.
Detail: OD-047 (resolved the day before C9) explicitly considered and rejected carving out low-risk automation from this limit. FR-9.MODE.004 (OD-088, approved the next day) does exactly what OD-047 rejected: `CFG-action_autonomy_matrix` lets a "low-risk external" send auto-execute after a trust period. OD-088's change-control note only amends C6's approval-tier FRs — it never supersedes ADR-007 or amends FR-6.HRD.001/FR-3.ACT.002, whose ACs still state the limit holds regardless of config.
Recommendation: Either formally supersede/amend ADR-007 and FR-6.HRD.001 to carve out the exception, or roll back FR-9.MODE.004's Act-tier autonomous-send capability to Prepare-only, consistent with OD-047.
Dimension: Dim5-Contradiction-Hunt

**H22. `spec/01-requirements/component-08-agent-design.md:601-627` (FR-8.SPC.003, AC-8.SPC.003.3)**
Summary: C8's Comms Agent invariant ("never sending autonomously," with any autonomous-send tool grant rejected at write as a negative code-level invariant) is mutually exclusive with C9's FR-9.MODE.004 requirement that a low-risk external send can auto-execute in Act mode — neither FR records the other as amended.
Detail: FR-8.SPC.001 establishes Comms as the sole agent owning the external-communications domain. For FR-9.MODE.004's auto-execute to run, some agent must hold a genuine external-send tool — which AC-8.SPC.003.3 says can never be written into any agent's tools_allowed. OD-088's change-control list never mentions C8 FR-8.SPC.003.
Recommendation: Amend FR-8.SPC.003/AC-8.SPC.003.3 via change control to carve out the OD-088 low-risk-external-nonclient Act path, and cross-reference FR-9.MODE.004 from C8.
Dimension: Dim5-Contradiction-Hunt

**H23. `spec/03-surfaces/surface-00-auth.md:295-297`**
Summary: UI-SUPPORT-REQUESTS is specced as a Realtime/WebSocket surface, contradicting the locked, repeatedly-cited architectural rule that there are "exactly two" Realtime surfaces in the whole product (FR-7.RTP.001 / AC-7.RTP.001.3).
Detail: Surface-04, surface-03, and surface-05 all agree the two Realtime surfaces are surface-04 (approval queue) and surface-07 (notification centre); none mention surface-00's support-requests queue. surface-00 was signed off one day before surface-04 formalized the "exactly two" constraint, and was never reconciled afterward.
Failure scenario: A developer builds UI-SUPPORT-REQUESTS as a genuine Realtime subscription, adding a third live WebSocket consumer the FR-7.RTP.003 connection-budget/prioritization logic never accounts for, silently miscalculating headroom.
Dimension: Dim5-Contradiction-Hunt

**H24. `spec/04-data-model/schema.md:341`**
Summary: schema.md states per-entity Maturity is "derived at read... not stored," directly contradicting locked ADR-002 and Approved FR-2.MAT.002, both of which mandate Maturity be stored per entity + aggregate.
Detail: ADR-002 Decision §2 is explicit: Maturity is "Stored, recomputed on the slow loop (daily) and on memory-write." FR-2.MAT.002 restates: "Maturity stored per entity." Only Retrieval Sufficiency (the other half of the sentence) is correctly described as computed inline. There is no maturity/aggregate-maturity column anywhere in schema.md — the storage the schema's own prose says isn't needed is in fact required and has nowhere to live.
Recommendation: Fix schema.md's sentence and add the missing maturity/aggregate-maturity storage to the `entities` table (or wherever ADR-002 intends it).
Dimension: Dim5-Contradiction-Hunt

**H25. `spec/04-data-model/schema.md:275-296`**
Summary: The `memories` table has no actual DB-level unique constraint (or dedicated idempotency-key column) enforcing the memory-write idempotency key that locked ADR-004 and Approved FR-2.WRT.006 both mandate, and the supporting `(entity_ids, updated_at)` watermark index is also missing from indexes.md.
Detail: ADR-004 §4 requires "a unique constraint on that key" so a retried step is a no-op insert. schema.md's `memories` table has no such column/constraint — only a trailing SQL comment, not real DDL. Contrast with `idempotency_ledger` (C3), which correctly implements this pattern elsewhere in the same file.
Failure scenario: An Inngest step retry re-inserts the same proposed memory because there is no DB-level uniqueness — a duplicate memory row, precisely the #1 (never lose/corrupt knowledge) failure ADR-004 exists to prevent.
Dimension: Dim5-Contradiction-Hunt

**H26. `spec/02-config/config-registry.md:286`**
Summary: config-registry's `recovery_tier` enum treats `daily_in_project` as an ordinary, unguarded config value, silently contradicting ADR-008's locked requirement that any downgrade below hourly off-platform backup go through a formal "logged downgrade exception per change-control.md."
Detail: ADR-008 §1 states verbatim that running below hourly is "a logged downgrade exception... never a silent default." config-registry.md's `recovery_tier` row has no distinct gate, no reference to change-control.md — only the generic audit-log treatment every other knob gets. No FR anywhere implements the change-control gate.
Recommendation: Add a dedicated validation/workflow requiring a change-control record when `recovery_tier` moves to `daily_in_project` (or below hourly), or route that transition through a distinct, explicitly-logged exception flow.
Dimension: Dim5-Contradiction-Hunt

**H27. `spec/01-requirements/component-02-memory.md:887`**
Summary: `amber_zone_threshold` (0.65) is numerically below `retrieval_confidence_threshold` (0.7), so the "proactive" amber early-warning flag can only ever fire AFTER a decaying memory has already stopped being retrievable/injected — inverting its stated purpose.
Detail: Since confidence only decreases monotonically under decay, a memory must cross below 0.7 (become invisible to retrieval) before it can ever reach 0.65 and trigger amber. For the entire 0.70→0.65 window, the memory has silently gone dark with zero warning. No cross-key constraint in config-registry.md catches this ordering bug.
Failure scenario: A memory decays from 0.72 to 0.68 in one daily soft-decay run — now below the retrieval floor, silently excluded from retrieval, with no amber alert (0.68 > 0.65) until a further decay run, well after the practical failure already occurred.
Dimension: Dim5-Contradiction-Hunt

**H28. `spec/01-requirements/component-06-guardrails.md:282-290 (OD-066), 700-712 (FR-6.INJ.002/003), 733-756 (FR-6.INJ.006, AC-6.INJ.006.3)`**
Summary: C6's OD-066 resolution lets the deterministic regex tripwire layer autonomously trigger a quarantine (a gate action) on a high-confidence match alone, directly contradicting ADR-007's locked text that regex tripwires' output is "log + alert + optional route-to-review, never an autonomous gate."
Detail: ADR-007 Decision part 2(b) states this restriction verbatim twice. OD-066's write-up only cites "ADR-007 ships the semantic scan off by default" — it never engages with the "never an autonomous gate" restriction, and no change-control/ADR amendment is recorded.
Recommendation: Either amend ADR-007 to carve out a high-confidence-literal exception for regex-triggered quarantine, or walk back OD-066 so regex-only hits can only log+alert+route-to-review.
Dimension: Dim5-Contradiction-Hunt

**H29. `spec/01-requirements/component-07-observability.md:291-303 (FR-7.LOG.001, AC-7.LOG.001.2), 494-498 (FR-7.ALR.004), 617-628 (FR-7.MGM.001.3)`**
Summary: FR-7.LOG.001's closed 8-value `event_type` enum has no value for most of what FR-7.ALR.004 ("every alert raised is recorded in the event_log") and FR-7.MGM.001.3 ("the reporter job logs each push attempt and failure to the local event_log") require it to record, while AC-7.LOG.001.2 explicitly rejects any event_type outside the enumerated set.
Detail: Of the seven FR-7.ALR.002 alert rules, only "hard limit hit" maps to an existing type (guardrail_hit); the other six (task failure spike, queue backup, memory confidence drop, approval queue stale, cost threshold breach, loop missed) have no matching event_type. FR-7.MGM.001.3's reporter-attempt log also has no matching type.
Recommendation: Extend the `event_type` enum to cover the alert/reporter-attempt writes, or redirect those writes to the `notifications` table and narrow FR-7.ALR.004/FR-7.MGM.001.3's wording accordingly.
Dimension: Dim5-Contradiction-Hunt

**H30. `spec/01-requirements/component-10-infra-compliance.md:1227-1253` vs `ADR-008-backup-dr.md L86-116`**
Summary: FR-10.ISO.002's "airtight... no shared store could retain a copy" claim is contradicted by ADR-008's off-platform backup, which is designed to survive Supabase project deletion, and the offboarding workflow never purges it.
Detail: ADR-008 mandates an independent hourly off-platform logical backup explicitly engineered to "survive a paused or deleted project." C10's own seams section claims "offboarding flags backups for purge via C2 AC-2.MNT.017.2," but FR-10.OFF.005's five enumerated sub-steps never mention it, and C2's own caller attribution ties that purge flag to the DEL (individual erasure) workflow, not OFF (offboarding).
Failure scenario: A client offboards, C10 deprovisions and certifies deletion is complete, but the off-platform backup (designed to survive deletion) is never flagged/purged — the client's data persists indefinitely despite the "airtight, provably complete" claim.
Dimension: Dim5-Contradiction-Hunt

**H31. `spec/03-surfaces/surface-01-config-admin.md:127-177, 482-516`**
Summary: Surface-01 (Config Admin) silently omits three config-registry keys that config-registry.md explicitly binds to its `#memory` and `#infra` sections — including the ADR-008 backup/recovery-tier knob and the ADR-003 Haiku trust-window knobs.
Detail: `recovery_tier` (tagged `UI-config-admin#infra`) and `haiku_audit_window_days`/`haiku_gate_disagree_threshold` (tagged `UI-config-admin#memory`) are absent from surface-01's respective Data-bindings tables, contradicting the surface's own completeness claim ("presents all 117 scalar keys... from the Phase 2 config registry").
Failure scenario: An operator opens Config Admin's #infra section to review the client's backup posture and never sees `recovery_tier` at all — no way to log a downgrade exception via this surface; similarly no way to extend the Haiku gate's trust window.
Dimension: Dim5-Contradiction-Hunt

**H32. `spec/03-surfaces/surface-05-dashboard-ops.md:139-140, 216-217, 346, 450-451, 611, 648-651`**
Summary: Surface-05's OD-121 gates DLQ Requeue/Discard and Connector Reconnect behind a "System-Functions" node and a "Tool-Access" node that were never minted into PERMISSION_NODES.md, contradicting the catalog's own "no owed-but-untranscribed node" closure claim.
Detail: PERMISSION_NODES.md (updated after surface-05's signoff) contains zero occurrences of "System Functions" or "Tool Access" as sections. The catalog's Status section closes debt for surfaces 03/04/06/07/08/09/11 but never mentions OD-121's two action-gate nodes.
Failure scenario: At build time, the DLQ Requeue/Discard buttons and Connector Reconnect action reference PERM nodes that don't exist — the gate either fails to build or defaults to unguarded, letting any authenticated dashboard user requeue/discard tasks or trigger a connector re-auth.
Dimension: Dim5-Contradiction-Hunt

**H33. `spec/00-foundations/adr/ADR-003-cost-model.md:90-93, 105, 184-187`**
Summary: ADR-003's locked cost-ladder config key names (`cost_alert_daily_usd`, `cost_alert_weekly_usd`, `cost_throttle_daily_usd`, `cost_hard_ceiling_daily_usd`, `cost.price_table`) were silently renamed in the built config-registry.md, and surfaces 06/07 cite the drifted names as if they were the ADR's own keys, with no change-control reconciling the ADR text.
Detail: config-registry.md instead defines `cost_ladder_soft_threshold`/`cost_ladder_throttle_threshold`/`cost_ladder_hard_kill_threshold` and `price_table` (no `cost.` namespace) — a differently-named, differently-shaped set (the alert row merges daily+weekly into one string).
Recommendation: Reconcile ADR-003's exact wording against the built registry via change control, or update the ADR to reflect the shipped key names.
Dimension: Dim5-Contradiction-Hunt

**H34. `spec/04-data-model/rls-policies.md:22-23; 39-79`**
Summary: rls-policies.md treats the aal2 predicate as a selective "step-up" gate and its per-table policy summary applies aal2 to zero tables, contradicting the locked, Approved FR-1.RLS.005 ("every protected table... no table reachable at aal1", no exemptions per OD-016).
Detail: FR-1.RLS.005's own edge-case text names this exact failure mode: "one protected table missing the aal2 clause = a silent aal1 bypass (#2/#3)." The FR-1.RLS.007 citation on rls-policies.md line 23 is also the wrong FR (that FR is the service_role mid-task re-check rule, unrelated to human-path aal2).
Recommendation: Add the aal2 predicate as a universal baseline clause on every protected table's policy, or open an OD if a narrower scope is intended; fix the FR-1.RLS.007 → FR-1.RLS.005 citation.
Dimension: Dim5-Contradiction-Hunt

**H35. `spec/05-non-functional/infrastructure.md:212`**
Summary: infrastructure.md and test-strategy.md swap what AF-112 and AF-063 actually verify, and infrastructure.md's AF-063 attribution contradicts locked ADR-004's own definition of AF-063.
Detail: ADR-004 defines AF-063 as "Inngest per-key concurrency does what we assume (serializes same-key steps)." infrastructure.md's NFR-INF.014 instead labels AF-063 as "catch-up / no stampede" (which is actually AF-112's job per the feasibility register and test-strategy.md's own correct table).
Recommendation: Reconcile infrastructure.md's NFR-INF.014 Verification line with ADR-004's canonical AF-063 definition; re-check any other NFR-INF row citing AF-112/AF-063.
Dimension: Dim5-Contradiction-Hunt

**H36. `spec/02-config/config-registry.md:194`**
Summary: Locked ADR-003 mandates the daily and weekly cost soft-alert figures as two separate, independently operator-editable config keys; config-registry.md (and cost.md) collapse them into one key with a compound default, removing independent editability.
Detail: ADR-003's Consequences explicitly requires four distinct, independently-editable keys and stresses the weekly figure is deliberately NOT a multiple of the daily figure. config-registry.md's `cost_ladder_soft_threshold` bundles both into one Default string ('$50/day, $200/wk') with one validation clause, and is not listed as a structured/Appendix-A object — so the $200/week figure has no independent edit surface anywhere, confirmed by surface-01's binding to a single flat `config_values.value` row.
Recommendation: Split `cost_ladder_soft_threshold` into two independently-editable keys matching ADR-003's four-key requirement, or open a change-control record explaining the merge.
Dimension: Dim5-Contradiction-Hunt

**H37. `spec/02-config/config-registry.md:191`**
Summary: The config key ADR-004 locks as `memory_writes_per_minute` was silently renamed to `rate_limit_memory_writes_per_minute` in the built config registry, with no change-control note reconciling either the ADR or the C2 FRs that still cite the old name.
Detail: ADR-004 names the key `memory_writes_per_minute: 30` twice in its locked text. Two Approved C2 FRs (FR-2.ING.010, FR-2.WRT.006) cite the identical bare name. The registry has only `rate_limit_memory_writes_per_minute`. No OD or change-control note ties them together.
Recommendation: Reconcile the naming drift across ADR-004, the two FRs, and config-registry.md via change control.
Dimension: Dim5-Contradiction-Hunt

**H38. `spec/01-requirements/component-06-guardrails.md:3`**
Summary: FR-6.RTL.004 (cost-ladder enforcement) is completely absent from traceability-matrix.csv, and C6's own FR-count/area-code header ("35 FRs" / "RTL ×3") was never updated after the FR was added by change control — the file actually contains 36 FRs (RTL ×4).
Detail: Same underlying gap as H13/H14, independently caught via the contradiction-hunt lens focused on the header/footer staleness itself. C4/C5/C7's declared FR counts all match their actual header counts and matrix row counts exactly (32/32, 43/43, 35/35) — only C6 has this gap.
Dimension: Dim5-Contradiction-Hunt

**H39. `spec/01-requirements/component-06-guardrails.md:342`**
Summary: AC-6.HRD.002.1 requires the hard-limit `guardrail_log` row to be written "in the same transaction as the block" (implying the block rolls back if the log write fails), directly contradicting the verification-gate-added AC-6.LOG.003.3, which mandates the block must hold even when the `guardrail_log` write independently fails.
Detail: AC-6.LOG.003.3 was added specifically by the verification gate to fix this failure mode ("a log-write failure must not roll back into the dangerous action proceeding"), but AC-6.HRD.002.1's near-identical "same transaction... never applied without the record" wording — for the single most safety-critical guardrail class — was never edited to match.
Recommendation: Reconcile AC-6.HRD.002.1's transactional language with AC-6.LOG.003.3's resolution (block holds even if the log write fails).
Dimension: Dim5-Contradiction-Hunt

**H40. `spec/01-requirements/component-08-agent-design.md:1142-1152`**
Summary: FR-8.COST.003's stated memory-write call-count ("up to three per memory-write event") restates the exact pre-ADR-003 design-doc figure that locked ADR-003 explicitly rejected and corrected, undercounting the priciest call.
Detail: ADR-003 §4 explicitly rejects "3 Sonnet calls per write" and corrects it to "exactly 1 Sonnet call wrapped in ≤3 Haiku calls" — 4 model calls total, dominated by the expensive Sonnet writer call, which FR-8.COST.003 omits and cites "L3598, ADR-003, OD-068" as if it reflects the correction.
Failure scenario: C7's per-call cost meter and C6's cost-ladder kill switch under-price/under-count memory-write events (missing the Sonnet writer call), drifting the daily-spend estimate low precisely on the item ADR-003 calls "the scariest cost line" — the opposite of the mandated round-up-early fail-safe bias.
Dimension: Dim5-Contradiction-Hunt

**H41. `spec/01-requirements/component-10-infra-compliance.md:430`**
Summary: FR-10.DEL.007's precondition claims erasure can read deployment status "via the local mirror / FR-10.MGT.002," but FR-10.MGT.002 defines only the management-plane's inbound (push) ingest endpoint — no FR anywhere defines a "local mirror" letting a client's own silo read back `client_registry.status`, and ADR-001 §7 mandates the flow is strictly push-only in the other direction.
Detail: Same underlying architectural gap as H20, cited from a different FR. `client_registry` lives exclusively in the management-plane deployment; FR-10.MGT.002/003 explicitly state the management plane never pulls. "Local mirror" appears nowhere else in the repo.
Failure scenario: During an offboarding retention freeze, an Admin attempts an individual erasure inside the frozen client's own deployment; the freeze check has no actual data source, so the precondition either can't be implemented or silently degrades to always-pass, letting an erasure race the offboarding deletion sequence.
Dimension: Dim5-Contradiction-Hunt

**H42. `spec/03-surfaces/surface-01-config-admin.md` (the `#loops` section) vs `config-registry.md §H` and surface-05 OD-123**
Summary: `dlq_stale_alert_hours` — the config key OD-123 minted specifically so surface-01's `#loops` section could make the DLQ-unattended-escalation age operator-configurable — is missing from surface-01's `#loops` Data-bindings table, so the surface OD-123 explicitly names as its home has no way to edit it.
Detail: config-registry.md §H's Status section confirms the row was added by this change control, with an explicit destination of "`#loops`, `PERM-config.loops`." Surface-01's `#loops` table lists only 11 keys, none of which is `dlq_stale_alert_hours`. Surface-01 also carries no Status/sign-off banner, consistent with never being revisited after OD-123 landed.
Recommendation: Add a `dlq_stale_alert_hours` row to surface-01's `#loops` Data-bindings table; add a change-control checklist item so future registry additions update surface-01.
Dimension: Dim5-Contradiction-Hunt

**H43. `spec/04-data-model/schema.md:37-65 (trigger fn), 56-57 (guardrail_log trigger binding), 473-485 (guardrail_log DDL, no redacted_at)`**
Summary: The generic append-only enforcement trigger unconditionally references `new.redacted_at`/`old.redacted_at`, but is bound to `guardrail_log`, which schema.md itself never gives a `redacted_at` column.
Detail: The trigger's fallback branch checks `redacted_at` for any UPDATE not matching the guardrail_log-specific pending→approved/rejected whitelist. `guardrail_log`'s own CREATE TABLE has no such column (the footnote explicitly names only event_log/access_audit/config_audit_log as getting it). Any UPDATE to `guardrail_log`'s real, designed `escalated_at` column (used by the C6 escalation path) that isn't the exact whitelisted status transition will hit the redacted_at branch and error on an undefined field.
Recommendation: Either give `guardrail_log` a `redacted_at` column and update the footnote/DDL, or branch the trigger by `tg_table_name` so the check is skipped for tables without the column.
Dimension: Dim5-Contradiction-Hunt

**H44. `spec/04-data-model/rls-policies.md:61, 67, 74`**
Summary: RLS's per-table policy summary claims clearance-gated/clearance-scoped read access on `task_queue`, `notifications`, and `proactive_suggestions`, but none of these three tables in schema.md carries a `sensitivity_tier`, `entity_ids`, or any other clearance-derivable column to filter on.
Detail: `task_queue` has only `payload`/`action_payload` jsonb blobs; `notifications` has `recipient`/`recipient_role` but no entity/sensitivity column; `proactive_suggestions` has `recipient_id`/`risk_type` text but no entity/sensitivity column. There is no schema-level mechanism by which an RLS policy on these tables could evaluate a row's sensitivity tier.
Recommendation: Either add the missing entity/sensitivity linkage columns (or specify the exact join path), or correct the RLS summary to state these tables rely on harness-level (not RLS-level) clearance checks, matching ADR-006's actual RLS-vs-harness division of labor.
Dimension: Dim5-Contradiction-Hunt

**H45. `spec/02-config/config-registry.md:135`**
Summary: config-registry.md lets `haiku_audit_window_days` be set to 0 ("go autonomous immediately"), bypassing the ADR-003 §8 / NFR-COST.009 trust-window safeguard that gates Haiku selective-writing autonomy on an evaluated operator disagree-rate.
Detail: OD-036 explicitly enumerates and rejects "trust the gate immediately, no window (rejected — unvalidated autonomy over what knowledge to discard, #1)." Setting the window to 0 elapsed days reproduces exactly that rejected scenario — the gate goes autonomous with zero calibration and no disagree-rate data. The registry's own validation text explicitly endorses 0 as a normal, unremarkable value, with no caveat or minimum-sample floor.
Recommendation: Raise the floor of `haiku_audit_window_days` to ≥1 (or a meaningful minimum), or add an explicit minimum-reviewed-decisions gate before autonomy; remove the "0 = go autonomous immediately" validation text.
Dimension: Dim5-Contradiction-Hunt

### Dim6 — Non-Negotiables (3)

**H46. `spec/05-non-functional/backup-dr.md:1-149` (whole file, no matching NFR); cf. `component-02-memory.md L1192-1215 (FR-2.MNT.017)`**
Summary: The off-platform backup-purge leg of compliance erasure has no owning requirement, no cadence, and is explicitly excluded from the erasure completeness-verification check.
Detail: FR-2.MNT.017 promises off-platform backups are "flagged for purge per ADR-008 (mechanics owned by Phase 5)." backup-dr.md IS that Phase-5 file, and none of its 8 NFR-DR rows mention receiving/processing an erasure-purge flag, a retention window, or a completion signal. AC-2.MNT.017.5's completeness check enumerates the legs it verifies and the backup-purge leg is not among them, even though AF-137 claims the spike covers it.
Failure scenario: A legally-erased individual's personal data can persist indefinitely, untracked, in off-platform backups — and if those backups are ever restored, the erased data would silently reappear with no detection path.
Recommendation: Add an NFR-DR row (or C2/C10 FR) naming a purge cadence/retention window for pre-erasure off-platform snapshots and add the backup-purge leg to AC-2.MNT.017.5's completeness check.
Non-negotiable threatened: #1 (never lose or corrupt knowledge) — inverted here to "never fail to erase," but same silent-persistence failure class.
Dimension: Dim6-NonNeg-1

**H47. `spec/01-requirements/component-09-proactive.md:1051-1085`**
Summary: Custom-command invocation (FR-9.CMD.008) asserts it runs the same C6 guardrail pipeline, but its own design removes the only mechanism the spec names for a soft/hard-approval hold — leaving no described way for such a hold to actually happen on this path.
Detail: AC-9.CMD.008.3 states no `task_queue` entry is created for a custom-command dispatch; AC-9.CMD.008.4 insists the assigned action's C6 tier "governs execution regardless." But the only mechanism the spec defines anywhere for enacting a soft/hard-approval hold is `task_queue`-based (FR-6.APR.006, FR-5.QUE.005). Nothing stops a custom-command's wrapped agent from resolving to a floored/hard-approval tier at execution time, and no AC, FR, OD, or surface describes what happens then.
Failure scenario: An Admin authors `/notify-client` bound to a Comms agent; a user invokes it and the underlying tool call resolves to the floored hard-approval tier (existing-client comms). Because no task_queue row exists, there is no specified state for "awaiting_approval" to land in — the spec does not describe what stops the send.
Recommendation: Add an explicit AC stating the mechanism: either the underlying agent action does create/reuse a task_queue row (routing to surface-04 like any other agent action), or a custom command is restricted at dispatch time to actions that cannot resolve above auto-approve/reversible-soft, with anything else rejected synchronously.
Non-negotiable threatened: #2 (never do something it shouldn't).
Dimension: Dim6-NonNeg-2

**H48. `spec/01-requirements/component-07-observability.md` (whole watcher chain)**
Summary: The entire "watcher watches the watcher" chain (alert-engine watchdog, mgmt-plane staleness evaluator, DLQ-liveness heartbeat) is self-hosted on the operator's own infrastructure, with no independent/external/out-of-band monitor of that infrastructure itself — so a total operator-side outage can go silently unnoticed.
Detail: FR-7.ALR.008/NFR-OBS.004 has an independent watchdog watch the alert-evaluation engine; FR-7.MGM.002/NFR-OBS.006 has a heartbeat evaluate management-plane push staleness; AC-5.JOB.006.2 has C5 emit a DLQ-liveness signal — but all three run on the same Railway-hosted operator infrastructure as everything they watch. AF-118 names the residual risk but its mitigation is still an in-system SPIKE, never reaching outside the operator's own hosting stack. No FR/NFR/AF anywhere requires a genuinely independent, third-party channel (external synthetic uptime check, dead-man's-switch monitor). Unlike almost every other risk in this disciplined spec, this one is not logged anywhere as an OD or AF.
Recommendation: Add an FR/NFR requiring a genuinely out-of-band monitor of the operator's own management-plane deployment (an externally-hosted uptime/heartbeat service outside Railway); at minimum log this as a new OD/AF.
Non-negotiable threatened: #3 (never fail silently) — this is the layer everything else's #3 guarantee depends on.
Dimension: Dim6-NonNeg-3

---

## 4. Confirmed MED findings (46) — need a fix or a logged decision, not necessarily a full Phase-6 block

### Dim1 — ID Resolution (4)

**M1. `spec/02-config/_HARVEST.md:55`** — `FR-0.WHK.009` is cited as the Source FR for config knob `webhook.failure_alert_threshold`, but only FR-0.WHK.001–008 are ever defined. Recommendation: draft FR-0.WHK.009 or repoint the citation (e.g. to FR-0.WHK.005). Dim1-ID-Resolution

**M2. `spec/02-config/_HARVEST.md:106`** — `FR-3.OBS.005` is cited as the Source FR for `drive_full_corpus_ingest`, but component-03-tool-layer.md's OBS area only defines FR-3.OBS.001–004. Recommendation: draft FR-3.OBS.005 or repoint the citation. Dim1-ID-Resolution

**M3. `traceability-matrix.csv:206,228-229,275,279,311-312,318,326-329,331,406`** — ~35 `CFG-` shorthand tokens in the matrix's config_deps column were never reconciled with config-registry.md's canonical key names; most are naming drift against a key that does exist, but a real subset (`business_context`, `l1_length_advisory`, `triggers`, `approval_tier_policy`, `approval_routing_rules`, `guardrail_log_retention`, `push_staleness_window`) has no corresponding registry entry under any name. Recommendation: do a single reconciliation pass; for the concepts with no registry row, add the row or open OD/AF entries. Dim1-ID-Resolution

**M4. `spec/01-requirements/component-00-login.md:123`** — `UI-CONFIG-AUTH` is cited as a literal surface ID but was never minted as its own surface heading; the intent was folded into `UI-config-admin#auth` per phase-playbooks.md, but the three literal citations (component-00-login.md:123, :1028, traceability-matrix.csv:8) were never rewritten. Already tracked as an open orphan in SESSION-LOG.md:1213. Recommendation: replace the three citations with `UI-config-admin#auth`. Dim1-ID-Resolution

### Dim2 — Traceability (5)

**M5. `spec/01-requirements/component-09-proactive.md:3, 1123`** — Stale FR-count in the file's own status header and Traceability footer (28) does not match the actual, correct FR count (31); the correct area-code tally two sentences later already sums to 31, and traceability-matrix.csv is actually current at 31 rows. Also propagated into README.md's C9 blurb. Recommendation: update the two "28" references to "31." Dim2-Traceability

**M6. `traceability-matrix.csv` row FR-4.BIZ.003** — cites `CFG-business_context.dynamic_fields` and `DATA-dynamic_field_store`, neither of which exists under that name in config-registry.md or schema.md (the real table is `dynamic_field_values`). Recommendation: register the declared-field-set config and correct the DATA citation to `DATA-dynamic_field_values`. Dim2-Traceability

**M7. `traceability-matrix.csv` rows FR-6.RTL.001/002/003** — all cite `CFG-rate_limits`, a collective name that does not exist as a literal key; only four (arguably five) individually-named `rate_limit_*` keys exist. Recommendation: replace with the actual semicolon-separated list of keys. Dim2-Traceability

**M8. `traceability-matrix.csv` row FR-7.ALR.003** — cites `PERM-approval.action`, which does not exist in PERMISSION_NODES.md; component-07-observability.md's own FR text names no PERM id at all (MED-severity companion to H12). Recommendation: drop the PERM citation or correct to `PERM-action.review`. Dim2-Traceability

**M9. `traceability-matrix.csv` rows FR-10.DEL.004/005/007, FR-7.RTP.004, FR-7.MGM.004, FR-9.PRO.003** — the `surfaces` column cites lowercase/underscore `UI-*` tokens (`UI-confirm`, `UI-audit_log`, `UI-state_conflict`, `UI-ops-dashboard`, `UI-super-admin`, `UI-approval_queue`) that appear nowhere in spec/03-surfaces/; actual minted IDs use ALL-CAPS-HYPHEN (`UI-DASHBOARD-OPS`, etc.). Likely a matrix-wide issue beyond this sample. Recommendation: reconcile the `surfaces` column against actual minted Surface IDs, matrix-wide. Dim2-Traceability

### Dim3 — Cross-phase Consistency (11)

**M10. `spec/01-requirements/component-03-tool-layer.md:372,469,495,518,541,564,587,1037,1129,1151,1396,1419,1441`** — Thirteen FRs (plus eight WHK FRs in component-00) reference `DATA-credentials` as a single table; per OD-P4-02 it was split into `webhook_secrets`/`connector_credentials`. MED-severity companion of H2 focused on the cross-phase-consistency angle. Recommendation: update every citation per the OD-P4-02 split. Dim3-Cross-phase-Consistency

**M11. `spec/01-requirements/component-02-memory.md:142-163`** — FR-2.ENT.002/AC-2.ENT.002.2 assume a new custom entity type is usable "with no deploy," but config-registry.md classifies `entity_types` as BOOT (effective on next deploy/boot), and config-edit-taxonomy.md uses `entity_types` as its own worked BOOT example. Recommendation: amend the AC to reflect BOOT semantics, or reclassify `entity_types` to LIVE and update the taxonomy example. Dim3-Cross-phase-Consistency

**M12. `spec/05-non-functional/compliance.md:39`** — NFR-CMP.002 ("the golden rule") cites "schema.md `entities.source_ref`" as evidence, but `entities` has no `source_ref` column — it has `external_refs jsonb` instead (multi-valued, per FR-2.ENT.004). `memories.source_ref` is correct; only the `entities` citation is wrong. Launch-blocking NFR. Recommendation: correct the citation to `entities.external_refs`. Dim3-Cross-phase-Consistency

**M13. `spec/01-requirements/component-04-prompt.md:336-339` (FR-4.STO.001)** — asserts `prompt_layers` has an `updated_at` column; schema.md's authoritative table has no such column (unlike the parallel `agents` table, which does). AC-4.STO.001.1 is untestable as written. Recommendation: drop `updated_at` from the field list (consistent with version-on-write) or add the column to schema.md. Dim3-Cross-phase-Consistency

**M14. `spec/01-requirements/component-06-guardrails.md:81, 141, 702, 709, 749`** — repeatedly names the config key `injection_semantic_detection`; config-registry.md's actual row is `injection_semantic_detection_enabled`. Values/semantics agree; pure naming drift, but AC-6.INJ.003.1/AC-6.INJ.006.3 reference the wrong name. Recommendation: rename the component-06 references to match the registry, or add an "aka" note. Dim3-Cross-phase-Consistency

**M15. `spec/01-requirements/component-06-guardrails.md:545-549` (AC-6.RTL.001.1)** — requires the config registry to enforce a "meaningful finite ceiling" (not just a floor) on each of the five rate-limit caps; config-registry.md's validation for those keys only enforces a floor ("int ≥ 1, never unlimited"), with no ceiling anywhere. The Phase-2-owed requirement was never implemented. Recommendation: add a per-cap maximum to each row's validation, or explicitly defer via OD/OOS. Dim3-Cross-phase-Consistency

**M16. `spec/01-requirements/component-10-infra-compliance.md:185`** — FR-10.RET.002 gates editing four retention/deletion CFG-* values on `PERM-config.edit`, but config-registry.md §M (which owns those exact keys) gates them on `PERM-config.infra`. surface-01's real UI write action ("Save Infra") is gated by `PERM-config.infra`, confirming the C10 FR is stale relative to the newer Phase-2 registry. Recommendation: retarget FR-10.RET.002 to `PERM-config.infra`, or document the two as distinct layered gates and reconcile PERMISSION_NODES.md's duplicate definitions. Dim3-Cross-phase-Consistency

**M17. `spec/01-requirements/component-09-proactive.md:719,883`** — FR-9.CST.003 gates editing three cold-start threshold CFG keys on `PERM-system.tune` (Admin+, via `/tune`), while config-registry.md §L assigns the same keys to `PERM-config.proactive`, which per registry convention defaults to Super-Admin-only. Two divergent, unreconciled authorization paths to the same config values. OD-086 resolves the node-vs-role-ladder question generally but never reconciles this specific conflict. Recommendation: resolve OD-086 for this specific FR — pick one authoritative node or document `/tune` as an intentionally-broader alternate path with equivalent guarantees. Dim3-Cross-phase-Consistency

**M18. `spec/03-surfaces/surface-01-config-admin.md:254-275` (#loops data-bindings table)** — missing the `dlq_stale_alert_hours` key that config-registry.md now assigns to that exact section/gate (Dim3 companion to H42). Dim3-Cross-phase-Consistency

**M19. `spec/05-non-functional/infrastructure.md:212`** — NFR-INF.014's verification line mislabels AF-063 as proving "catch-up / no stampede" (Dim3 companion to H35, same underlying mislabel, independently caught). Dim3-Cross-phase-Consistency

**M20. `spec/05-non-functional/test-strategy.md:91`** — the AF de-risking table cites AF-113 as holding NFR-PERF.010; AF-113 (parallel-DAG safety/approval ordering per FR-5.OPT.001/OD-056) has no relationship to NFR-PERF.010 (loop cadence + lazy spin-up), and performance.md never mentions AF-113 at all. Recommendation: fix the citation to point at FR-5.OPT.001/OD-056, or add a dedicated PERF/INF row if one is intended. Dim3-Cross-phase-Consistency

### Dim4 — Change-control Integrity (1)

**M21. `spec/00-foundations/adr/ADR-008-backup-dr.md:103,129`** — config-registry.md cites ADR-008 §1 as the owner of `recovery_tier`, but ADR-008 never names that key (or its enum values) verbatim — only in prose. The actual by-name citation exists one level removed, in backup-dr.md, which config-registry.md doesn't point to. Recommendation: update ADR-008 to name the key, or correct the config-registry source citation to backup-dr.md. Dim4-Change-control-Integrity

### Dim5 — Contradiction Hunt (22)

**M22. `spec/01-requirements/component-02-memory.md:947, 981`** — AC-2.MNT.005.2 and FR-2.MNT.007's Personal-tier branch cite the wrong FR ID for "never auto-consolidate Personal memories" (FR-2.MNT.016 — actually the unrelated feedback-loop FR); the correct rule is FR-2.MNT.014, already cited correctly elsewhere in the same file (line 938). The verification-gate changelog claims this exact slip was already fixed, but two live instances remain. Recommendation: correct both cross-references to FR-2.MNT.014. Dim5-Contradiction-Hunt

**M23. `spec/02-config/config-registry.md:189-192`** — the Phase-2 registry, which declares itself complete ("zero ???"), omits the "meaningful finite ceiling" validation on the four guardrail rate-limit caps that C6's own Approved AC-6.RTL.001.1 explicitly requires and flags as owed to this registry (Dim5 companion to M15). Dim5-Contradiction-Hunt

**M24. `spec/00-foundations/what-makes-it-great.md:40, 57-58`** — still marks compensation/rollback of partial task chains as a 🔴 unresolved gap tied to OD-010, but OD-010 was resolved 2026-06-26 and is now realized as FR-6.ESC.003 in component-06-guardrails.md. A future zero-context session reading this foundational Rule-0 document first could re-litigate a closed decision. Recommendation: update the row and summary paragraph to reflect the 🟢 resolution. Dim5-Contradiction-Hunt

**M25. `spec/03-surfaces/surface-02-user-mgmt.md:137-139`** — the Users tab's invite-delivery-status row hedges that it may "subscribe via the C7 RTP contract," again implying a third Realtime surface beyond the documented "exactly two" (lower-confidence companion to H23; hedged wording rather than a flat declaration). Dim5-Contradiction-Hunt

**M26. `spec/03-surfaces/surface-07-dashboard-agency.md:151, 349`** — cites the [Building]/thin-coverage entity-pill-mix signal to `FR-2.MNT.*` (twice), but the actual C2 requirement defining Maturity/[Building] is FR-2.MAT.001-003 + FR-2.RET.007; FR-2.MNT.* is the unrelated Maintenance family. surface-11 cites the same concept correctly. Root cause traces to component-07-observability.md L696-697. Recommendation: re-cite to FR-2.MAT.003/FR-2.RET.007 in both surface-07 and its component-07 source. Dim5-Contradiction-Hunt

**M27. `PERMISSION_NODES.md:27-38`** — the running node-count narrative ("37 real nodes at consolidation → ... → 51 catalogued") does not reconcile with the actual number of node rows physically in the table (52). Backing out the narrated later additions (14) from the actual 52 leaves 38 base nodes, not the claimed 37 — an unaccounted extra node (candidate: `PERM-guardrail.edit_autonomy`). Five surfaces (06/07/08/09/11) cite this running tally as verification evidence. Recommendation: recount and reconcile, identifying the unattributed node. Dim5-Contradiction-Hunt

**M28. `spec/00-foundations/adr/ADR-004-concurrency-model.md:153`** — the mandated config key `memory_write_serialization` (per_entity/global/off) is absent from the Phase-2 "authoritative, zero-???" config-registry.md; same class of gap as the `haiku_audit_window_days`/`recovery_tier` gaps the registry's own gap-sweep already caught and fixed elsewhere — this one was missed. Recommendation: add `memory_write_serialization` per the same gap-sweep pattern. Dim5-Contradiction-Hunt

**M29. `spec/05-non-functional/infrastructure.md:227`** — labels AF-004, AF-065, AF-135 as "blocking spikes... per RP-1," contradicting the canonical RP-1 six-spike launch-gate set (test-strategy.md/`_nfr-inventory.md`), which classifies all three as POSTURE (blocking-by-posture mechanisms), not one of the six go/no-go spikes. A reader of infrastructure.md alone would misclassify them. Recommendation: reword to "blocking-by-posture" per test-strategy.md's own terminology, reserving "RP-1"/"blocking spikes" language for the six. Dim5-Contradiction-Hunt

**M30. `spec/05-non-functional/test-strategy.md:91`** — the AF de-risking table cites the wrong "Holds" NFR for AF-113 and AF-116: AF-113 (parallel-DAG safety) has no relationship to NFR-PERF.010; AF-116 (anomaly-check accuracy) has no relationship to NFR-SEC.006 (which covers injection posture / AF-117 only). test-strategy.md is the keystone file indexing every other domain file's proofs. Recommendation: correct both citations; mint missing NFR rows if the properties genuinely have no home. Dim5-Contradiction-Hunt

**M31. `spec/01-requirements/component-01-rbac.md:947`** — OD-028's resolution promises a per-deployment "fail-closed" opt-in for overdue clearance reviews (auto-revoke instead of flag-and-persist), but this opt-in is never realized as a config key or FR behavior anywhere — not in FR-1.CLR.005 (the FR OD-028 explicitly unblocks) and not in config-registry.md. Recommendation: either add the config key/FR behavior, or log the gap as a formal deferral. Dim5-Contradiction-Hunt

**M32. `spec/01-requirements/component-06-guardrails.md:634-650 (FR-6.ESC.003), 760-777 (FR-6.LOG.001)`** — FR-6.LOG.001's `guardrail_log.status` enum (`pending`|`approved`|`rejected`) has no value for the "modify" resolution that FR-6.ESC.003 mandates as one of three human resolutions for a flagged item. Recording a modify outcome as "approved" loses the fact that a human changed the task's parameters — an integrity gap in a log meant as exportable client trust evidence. Recommendation: add a `modified` value to the enum (or a separate `resolution_detail` field). Dim5-Contradiction-Hunt

**M33. `spec/01-requirements/component-10-infra-compliance.md:837` vs 463-475, 659** — FR-10.MGT.001's authoritative `client_registry` schema names the offboarding timestamp column `offboarding_at`, while FR-10.OFF.001 and FR-10.OFF.006 both require writing/reading a differently-named field `offboarding_initiated_at` on the same table. Recommendation: reconcile the field name across all three FRs. Dim5-Contradiction-Hunt

**M34. `spec/01-requirements/component-01-rbac.md:323-331`** — FR-1.PERM.007 is titled and repeatedly cited as a "12-category" permission catalog, but its own body enumerates thirteen categories (matching the design doc's actual 13-category matrix). surface-02 propagates the "12-category" framing four times, and OD-110 bases the Permissions-tab layout decision on it. Failure scenario: a developer hard-codes 12 accordion sections, mis-grouping or dropping one of the thirteen. Recommendation: fix the count everywhere it's cited (FR-1.PERM.007, surface-02, OD-110, system-map). Dim5-Contradiction-Hunt

**M35. `spec/03-surfaces/surface-09-agent-builder.md:265`** — Section A's Agent-card data binding lists `model` as a field sourced from the `agents` table (FR-8.REG.001), directly contradicting the same file's own Section B, which explicitly states "FR-8.REG.001 defines no `agents.model` column" and that model is derived from config + complexity routing. The file's own verification-gate note (F3 LOW) records this fix as applied — but only to Section B. Recommendation: apply the same fix to Section A's card-binding row. Dim5-Contradiction-Hunt

**M36. `spec/04-data-model/migrations.md:24-33`** — Migration 0001's stated table-creation order places `restricted_grants` (grouped under RBAC/clearances) before `entities` is created, even though `restricted_grants.entity_id` is a real FK to `entities(id)` — an invalid forward reference, not the "circular ref" the footnote claims. The footnote also mischaracterizes `agents ⇄ prompt_layers` and `tools` as circular when no such bidirectional FK exists in schema.md. Recommendation: correct the ordering narrative (move `entities` earlier, or note the genuinely-needed later alter-table step for `restricted_grants.entity_id`); drop the inaccurate circular-ref framing for the other two pairs. Dim5-Contradiction-Hunt

**M37. `spec/05-non-functional/test-strategy.md:87`** — the AF table marks AF-013 and AF-020/021 as already "DOCS ✅ / DOCS (verified)," contradicting locked ADR-005 (which lists AF-020 as still paper-until-proven, "DOCS+SPIKE, sharpened") and infrastructure.md (which treats AF-020/021 as still-pending build-time checks and AF-013 as still-pending fast-follow). Also cites the wrong NFR-INF row for AF-013 (should be NFR-INF.007, not NFR-INF.006). Recommendation: correct the status framing and the NFR citation. Dim5-Contradiction-Hunt

**M38. `spec/01-requirements/component-03-tool-layer.md:13`** — C3's own Approved-status FR-count breakdown miscounts the TRIG area code: claims 5 generic-runtime TRIG FRs and 1 connector-instance TRIG FR, but the file actually contains 3 of each. The grand total (53) is only right because the two errors cancel. Recommendation: correct the category breakdown (generic 38, connector-instance 15, not 40/13). Dim5-Contradiction-Hunt

**M39. `spec/01-requirements/component-05-harness.md:145`** — C5's Seams table still asserts the C6 cost-ladder enforcement FR "is owed" (not yet written), even though C6 wrote and Approved it (FR-6.RTL.004) in a later session (2026-06-27) specifically to close that debt. The Seams table row was never revised to point at the now-existing FR. Recommendation: update the Seams table row to cite FR-6.RTL.004 and drop the "is owed" language. Dim5-Contradiction-Hunt

**M40. `spec/03-surfaces/surface-01-config-admin.md:12` (Context manifest) and `32` (Overview)** — claims to render "117 scalar keys, 10 structured objects, and 11 secret presence indicators," but a row-by-row count of config-registry.md groups A-M yields 151 total rows (139 non-object + 12 object-typed), and surface-01's own body labels 13 keys "Structured sub-table." None of the actual counts match the stated total. Recommendation: recompute and correct the counts, or make the claim non-numeric to avoid drift as the registry grows. Dim5-Contradiction-Hunt

**M41. `spec/03-surfaces/surface-12-mobile.md:117-122, 390-393`** — misattributes the config section/PERM gate for the two mobile push-frequency keys (`approval_push_frequency_minutes`, `stale_queue_push_hours`): says `#observability`/implicitly `PERM-config.observability`, but config-registry.md and surface-01 both place them under `#proactive`/`PERM-config.proactive`. Line citations are also off by two. Failure scenario: an admin holding the wrong PERM node is incorrectly blocked from or granted access to editing these settings. Recommendation: correct the section/PERM references and line citations. Dim5-Contradiction-Hunt

**M42. `spec/04-data-model/schema.md:15-17 vs 704-748`** — schema.md's own Global rule ("The only `client_slug` in the product is on `client_registry`") is contradicted two sections later by the same file, which gives `client_slug` columns to `deployment_health` and `offboarding_records` too. Doesn't threaten the isolation architecture (all three tables are confined to the management deployment, never a client silo), but is a literal, unreconciled wording inconsistency against ADR-001 §3's "exactly one place" phrasing. Recommendation: tighten the Global-rules wording to say client_slug is confined to the management-plane deployment (not literally one table). Dim5-Contradiction-Hunt

**M43. `spec/02-config/config-registry.md:253, 319`** — two separate, differently-gated config keys both purport to be "the" trust period before the AI may send external comms autonomously (`external_act_trust_period`, BOOT/`PERM-config.proactive`, and the nested `action_autonomy_matrix.low_risk_external_nonclient.act_trust_period_days`, LIVE/`PERM-guardrail.edit_autonomy`), same default value (14 days), no documented relationship between them. component-09-proactive.md lists both as separate, unreconciled Config dependencies. Recommendation: merge into a single source of truth, or add an explicit cross-reference note. Dim5-Contradiction-Hunt

### Dim6 — Non-Negotiables (3)

**M44. `spec/01-requirements/component-02-memory.md:305-326 (FR-2.ING.001)`; cf. `open-decisions.md OD-036 L581-598`** — Filter 1's post-trust-window "sampled audit" against Haiku-gate drift is asserted only in OD-036's resolution prose, not written into FR-2.ING.001's Behaviour/AC — no config key, cadence, threshold, or job-failure obligation makes it a testable, enforceable requirement, and it's not included in FR-2.MNT.015's "never fails silently" job-run logging. Recommendation: add an explicit AC naming the sampling rate/cadence/review surface, and fold it into FR-2.MNT.015's scope. Non-negotiable: #1. Dim6-NonNeg-1

**M45. `spec/01-requirements/component-05-harness.md:518-522`** — FR-5.ASM.007's per-step execution order still does not name the injection-sanitization pipeline call site (Dim6 companion to H19, same underlying gap, caught independently via the non-negotiable-#2 lens). Non-negotiable: #2. Dim6-NonNeg-2

**M46. `spec/01-requirements/component-02-memory.md:660-681 (FR-2.WRT.007)`** — the embedding write-failure/retry queue has no staleness/escalation mechanism analogous to C5's DLQ-liveness heartbeat (AC-5.JOB.006.2) or C2's own stuck-ingestion-queue scan (FR-2.MNT.010); it is the one queue in the spec's inventory (task_queue DLQ, ingestion_queue, write-failure queue) that lacks an explicit unattended/stale-item escalation FR — only a single initial alert fires. Recommendation: add an AC mirroring AC-5.JOB.006.2, or fold this queue into FR-2.MNT.010's weekly scan. Non-negotiable: #3. Dim6-NonNeg-3

---

## 5. Refuted (false positive) findings (6)

For transparency — these were raised by a dimension pass but did not survive adversarial re-verification against the actual repo content:

1. **C8 `agents.name` embeds `client_slug` string, allegedly contradicting ADR-001 §3** (`component-08-agent-design.md:396-401`) — Refuted: C8's own verification gate already deleted the dedicated `client_slug` column that actually violated ADR-001 §3; the remaining case is a human-readable name *string* containing the slug as a substring, which the FR itself explicitly distinguishes from a filterable identity column and is not the kind of artifact OD-096/FR-10.ISO.001 was sweeping.

2. **"Haiku decision log" table mandated by ADR-003 §8 allegedly missing from schema.md entirely** (`schema.md:343-395`) — Refuted: schema.md deliberately models trust-window shadow-drops as `ingestion_queue.state='shadow_dropped'` per an explicit inline comment citing OD-P4-03 ("no separate store"), backed by an RLS entry and a dedicated index — a documented architectural decision, not a silent gap. The finding's cited line range doesn't even contain the relevant table.

3. **surface-07 vs surface-08 cite mutually exclusive AC families (`AC-9.PRO.004.*` vs `AC-9.SUG.005.*`) for the same dismissal-safety-floor rule** — Refuted: both AC IDs genuinely exist and both correctly describe the same floor guarantee; AC-9.PRO.004.4 explicitly cross-references FR-9.SUG.005 by ID, and the component spec deliberately duplicates the guarantee across the two sibling FRs (OD-084). Each surface's wording tracks the AC it's actually paraphrasing.

4. **FR-2.ENT.003's Statement allegedly licenses the writer to autonomously assign Restricted sensitivity, contradicting FR-2.TAG.002's hard human-confirmation rule** — Refuted: FR-2.ENT.003's Statement explicitly points to "(TAG.002)" as the governing mechanism in the very same clause, and none of ENT.003's own testable ACs require autonomous Restricted assignment. Loose summary wording pointing at the owning FR, not a self-contained contradictory rule.

5. **FR-9.CMD.008 custom-command dispatch allegedly bypasses C8's FR-8.ORC.001 "route every task through a single orchestrator" invariant with no seamed exception recorded** — Refuted: FR-8.ORC.001's own Actor/trigger field scopes it to "a task reaching the front of the task_queue"; a synchronous command dispatch that never creates a task_queue row structurally falls outside that trigger by the FR's own definition. This pattern (direct-to-agent dispatch bypassing orchestrator scoring) also predates the custom-commands addendum (FR-9.CMD.001's `/ask`/`/research`) and is extensively cross-documented (OD-135, OD-142, OD-143, two surface docs) as an intentional architectural boundary, not a silent bypass.

6. **GoHighLevel has no event-delivery gap-reconciliation mechanism in FR-3.TRIG.006, unlike Slack/Google, allegedly an unaddressed silent-knowledge-loss risk** — Refuted: the gap is real but is not silently unaddressed — it is tracked through OD-104 (a fully resolved, dated decision explicitly analyzing this exact scenario and deliberately deferring it), gated on AF-094 (an open SPIKE on GHL's unconfirmed incremental-sync capability), and AF-097 (retry-policy ambiguity, already mitigated via OD-042's durable-queue-then-2xx pattern). This is the repo's own prescribed mechanism for exactly this situation, not an oversight.

---

## 6. LOW findings (unverified, cosmetic) (10)

1. `surface-00-auth.md:196,230,262` — three Empty states recorded as bare "N/A." with no justification, inconsistent with the file's own pattern elsewhere (UI-LOGIN, UI-2FA-ENROLL both explain their N/A). (Dim2)
2. `surface-06-dashboard-super-admin.md` and others (surface-07, surface-08, surface-12) — citations use `FR-N.AREA.NNN.N` where the actual ID is `AC-N.AREA.NNN.N` (4-segment sub-numbered IDs mis-prefixed as FR- instead of AC-). Content resolves correctly once re-prefixed. (Dim2)
3. `component-00-login.md:123` — FR-0.AUTH.003 cites surface `UI-CONFIG-AUTH`, which doesn't exist as a heading (already tracked open gap; LOW-severity restatement of M4). (Dim3)
4. `component-00-login.md:759` — prose/ACs write support-request status as `in-progress` (hyphen); schema.md's enum literal is `in_progress` (underscore). (Dim3)
5. `component-06-guardrails.md:248,556` — names the memory-write rate cap `memory_writes_per_minute`; registry row is `rate_limit_memory_writes_per_minute` (same drift as H37, LOW restatement in a second file). (Dim3)
6. `component-08-agent-design.md:290` — FR-8.ORC.005 cites `CFG-parallel_execution`; actual key is `parallel_execution_enabled`. (Dim3)
7. `surface-04-approval-queue.md:45` (and `surface-05-dashboard-ops.md:148`) — lists `task_queue.status` as including a `queued` value; the canonical enum has no such state (initial state is `pending`). (Dim3)
8. `surface-01b-config-audit-log.md:15-16` — calls `config_audit_log` the system's "third audit sink" while listing it alongside three other named sinks, making it the fourth by the sentence's own count — a wording/arithmetic ambiguity, not a functional defect. (Dim5)
9. `component-06-guardrails.md:652-657 (FR-6.ESC.004)` — describes itself as reusing the pattern used by "the system's three wait-points," but is itself a fourth (and C7's FR-7.ALR.005 makes it a fifth) — stale count the moment it was written. (Dim5)
10. `component-09-proactive.md:3,7,1123` — status header says "28 FRs Approved" while the area-code tally two lines later in the same paragraph sums to 31 (matching the actual file content); the closing Traceability line also still says "All 28 FRs wired" (LOW restatement/companion of M5). (Dim5)

---

## 7. Evidence trail

Per-dimension raw evidence (candidate findings before adversarial verification, full reasoning transcripts, and rejected/refuted-with-detail write-ups) lives in the sibling files in this directory:

- `spec/00-foundations/audit/dim-1-id-resolution.md`
- `spec/00-foundations/audit/dim-2-traceability.md`
- `spec/00-foundations/audit/dim-3-cross-phase-consistency.md`
- `spec/00-foundations/audit/dim-4-change-control.md`
- `spec/00-foundations/audit/dim-5-contradiction-hunt.md`
- `spec/00-foundations/audit/dim-6-non-negotiables.md`

`spec/00-foundations/audit/_mechanical-prepass.md` holds the pre-pass evidence (the mechanical ID/reference sweep that ran ahead of the six dimension passes and seeded several of the candidates independently confirmed above).

This file (`_audit-report.md`) is the definitive, consolidated output of the audit. **Update (2026-07-02): every HIGH
and MED finding above has since been reconciled** — see §1's updated verdict for the summary, `spec/00-foundations/
open-decisions.md` OD-161–167 for the seven findings that required a genuine decision (with full rationale), and
`spec/SESSION-LOG.md`'s entry for this session for the file-by-file list of what changed. This report's findings
list (§3–6) is left as originally written (the pre-fix state) — it is the historical record of what the audit found,
not a live status board; do not re-open a finding here without checking whether OD-161–167 or the SESSION-LOG entry
already closed it.
